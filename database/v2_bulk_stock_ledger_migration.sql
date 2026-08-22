-- Phase 6 (STOCK_LEDGER_PLAN.md): bulk_roasted_coffee gets the same
-- atomic-RPC + audit-ledger treatment packed_coffee_lots got in Phases 1-3
-- — combined into ONE migration this time. Lesson from the Phase 2->3
-- incident: adding context parameters to an RPC after the fact via
-- CREATE OR REPLACE creates a SECOND overload instead of replacing it,
-- breaking every existing caller until the old signature is explicitly
-- dropped. Building the final signature up front avoids that entirely.
--
-- No separate "bulk lots" table is needed: each bulk_roasted_coffee row IS
-- already one lot (one coffee + machine + production_date combination, or
-- one post-blend/custom-blend/repack batch — see the production_date
-- column's own comment on this table). bulk_available IS the lot's current
-- stock, not an aggregate of child rows the way packed_coffee.quantity is,
-- so there is nothing to "derive" it from — it becomes the atomically-
-- written, ledger-logged value directly.

-- mv_* columns must exist BEFORE the RPC functions below are created:
-- CREATE FUNCTION for a LANGUAGE sql function is validated against the
-- schema immediately (unlike plpgsql, which only checks at first call), so
-- this ALTER TABLE has to run first or every CREATE FUNCTION below fails
-- with "column mv_operation does not exist" (hit exactly this live
-- 2026-08-22 with the statements in the other order — fixed here, not just
-- worked around).
ALTER TABLE public.bulk_roasted_coffee
    ADD COLUMN IF NOT EXISTS mv_operation TEXT,
    ADD COLUMN IF NOT EXISTS mv_ref_table TEXT,
    ADD COLUMN IF NOT EXISTS mv_ref_id    INTEGER,
    ADD COLUMN IF NOT EXISTS mv_reason    TEXT,
    ADD COLUMN IF NOT EXISTS mv_user      TEXT;

CREATE OR REPLACE FUNCTION public.consume_bulk_lot(
    p_bulk_id INTEGER, p_kg NUMERIC,
    p_operation TEXT DEFAULT NULL, p_ref_table TEXT DEFAULT NULL,
    p_ref_id INTEGER DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
SET search_path = public
AS $$
    WITH before AS (
        SELECT bulk_available FROM public.bulk_roasted_coffee WHERE id = p_bulk_id FOR UPDATE
    ), updated AS (
        UPDATE public.bulk_roasted_coffee
        SET bulk_available = bulk_available - LEAST(bulk_available, GREATEST(p_kg, 0)),
            mv_operation = p_operation, mv_ref_table = p_ref_table,
            mv_ref_id = p_ref_id, mv_reason = p_reason, mv_user = p_user
        WHERE id = p_bulk_id
        RETURNING bulk_available
    )
    SELECT COALESCE((SELECT bulk_available FROM before), 0)
         - COALESCE((SELECT bulk_available FROM updated), 0);
$$;

CREATE OR REPLACE FUNCTION public.refund_bulk_lot(
    p_bulk_id INTEGER, p_kg NUMERIC,
    p_operation TEXT DEFAULT NULL, p_ref_table TEXT DEFAULT NULL,
    p_ref_id INTEGER DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE public.bulk_roasted_coffee
    SET bulk_available = bulk_available + GREATEST(p_kg, 0),
        mv_operation = p_operation, mv_ref_table = p_ref_table,
        mv_ref_id = p_ref_id, mv_reason = p_reason, mv_user = p_user
    WHERE id = p_bulk_id
    RETURNING bulk_available;
$$;

-- Absolute set (stocktake / manual correction). Mirrors set_packed_lot_remaining.
CREATE OR REPLACE FUNCTION public.set_bulk_lot_available(
    p_bulk_id INTEGER, p_kg NUMERIC,
    p_operation TEXT DEFAULT NULL, p_ref_table TEXT DEFAULT NULL,
    p_ref_id INTEGER DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE public.bulk_roasted_coffee
    SET bulk_available = GREATEST(0, p_kg),
        mv_operation = p_operation, mv_ref_table = p_ref_table,
        mv_ref_id = p_ref_id, mv_reason = p_reason, mv_user = p_user
    WHERE id = p_bulk_id
    RETURNING bulk_available;
$$;

GRANT EXECUTE ON FUNCTION public.consume_bulk_lot(INTEGER, NUMERIC, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_bulk_lot(INTEGER, NUMERIC, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_bulk_lot_available(INTEGER, NUMERIC, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;

-- ============================================================================
-- Ledger table — same shape and reasoning as packed_stock_movements
-- (database/v2_packed_stock_movements_migration.sql): no FK on
-- bulk_roasted_coffee_id (deleting a lot must not destroy its history right
-- when it becomes evidence), denormalized coffee_name/machine_id/
-- production_date snapshots keep a row human-readable after the source row
-- is gone, BEFORE trigger (not AFTER) so the mv_* context columns can be
-- cleared after being consumed — a caller that saveData()s the whole row
-- object must not resend stale context on its next unrelated write.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.bulk_stock_movements (
    id BIGSERIAL PRIMARY KEY,
    bulk_roasted_coffee_id INTEGER,   -- INTENTIONALLY no FK: see note above
    coffee_name TEXT,
    machine_id INTEGER,
    production_date DATE,
    delta_kg NUMERIC NOT NULL,        -- (+) in, (-) out
    balance_after NUMERIC,
    operation TEXT,
    ref_table TEXT,
    ref_id INTEGER,
    reason TEXT,
    performed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bsm_bulk_idx ON public.bulk_stock_movements (bulk_roasted_coffee_id, id);
CREATE INDEX IF NOT EXISTS bsm_created_idx ON public.bulk_stock_movements (created_at);
CREATE INDEX IF NOT EXISTS bsm_ref_idx ON public.bulk_stock_movements (ref_table, ref_id);

CREATE OR REPLACE FUNCTION public.log_bulk_stock_movement() RETURNS TRIGGER AS $$
DECLARE
    v_delta NUMERIC;
    v_op    TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF COALESCE(OLD.bulk_available, 0) <> 0 THEN
            INSERT INTO public.bulk_stock_movements (
                bulk_roasted_coffee_id, coffee_name, machine_id, production_date,
                delta_kg, balance_after, operation, ref_table, ref_id, reason, performed_by)
            VALUES (OLD.id, OLD.coffee_name, OLD.machine_id, OLD.production_date,
                -OLD.bulk_available, 0,
                COALESCE(OLD.mv_operation, 'lot_deleted'), OLD.mv_ref_table, OLD.mv_ref_id,
                OLD.mv_reason, OLD.mv_user);
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_delta := COALESCE(NEW.bulk_available, 0);
        v_op    := COALESCE(NEW.mv_operation, 'lot_created');
    ELSE
        v_delta := COALESCE(NEW.bulk_available, 0) - COALESCE(OLD.bulk_available, 0);
        v_op    := COALESCE(NEW.mv_operation, 'unspecified');
    END IF;

    IF v_delta <> 0 THEN
        INSERT INTO public.bulk_stock_movements (
            bulk_roasted_coffee_id, coffee_name, machine_id, production_date,
            delta_kg, balance_after, operation, ref_table, ref_id, reason, performed_by)
        VALUES (NEW.id, NEW.coffee_name, NEW.machine_id, NEW.production_date,
            v_delta, COALESCE(NEW.bulk_available, 0),
            v_op, NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);
    END IF;

    -- Context is single-use — see the BEFORE-trigger note above.
    NEW.mv_operation := NULL;
    NEW.mv_ref_table := NULL;
    NEW.mv_ref_id    := NULL;
    NEW.mv_reason    := NULL;
    NEW.mv_user      := NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_bulk_stock_movement ON public.bulk_roasted_coffee;
CREATE TRIGGER trg_log_bulk_stock_movement
BEFORE INSERT OR UPDATE OF bulk_available OR DELETE
ON public.bulk_roasted_coffee
FOR EACH ROW EXECUTE FUNCTION log_bulk_stock_movement();

-- Backfill opening balance for existing rows so the hard invariant holds
-- from day one instead of showing a permanent phantom difference.
INSERT INTO public.bulk_stock_movements (
    bulk_roasted_coffee_id, coffee_name, machine_id, production_date,
    delta_kg, balance_after, operation, reason, created_at)
SELECT id, coffee_name, machine_id, production_date,
       bulk_available, bulk_available,
       'opening_balance',
       'Ledger introduced 2026-08-22; movements before this date are not itemised',
       NOW()
FROM public.bulk_roasted_coffee
WHERE COALESCE(bulk_available, 0) <> 0;

-- RLS: same permissive pattern as every other table (see supabase_schema.sql
-- "Production pattern" block) — add 'bulk_stock_movements' to that array too.
ALTER TABLE public.bulk_stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.bulk_stock_movements;
CREATE POLICY full_access ON public.bulk_stock_movements FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
