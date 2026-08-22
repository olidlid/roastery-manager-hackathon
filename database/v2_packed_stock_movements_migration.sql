-- V2 Packed stock movement ledger (STOCK_LEDGER_PLAN.md Phase 2).
-- Every change to packed_coffee_lots.remaining_pcs is now logged
-- automatically by a trigger — not by application code remembering to call
-- a logging function, because that discipline has already failed twice in
-- this codebase (green_coffee.stock_kg, then packed_coffee.quantity itself,
-- both needed a trigger before they became reliable). Depends on Phase 1
-- (atomic RPCs) already being live — logging a race-corrupted number would
-- just manufacture false confidence.
--
-- Hard invariant this table exists to make checkable with one query, from
-- here on:
--   SUM(delta_pcs) per lot  ==  packed_coffee_lots.remaining_pcs

CREATE TABLE IF NOT EXISTS public.packed_stock_movements (
    id BIGSERIAL PRIMARY KEY,
    packed_coffee_lot_id INTEGER,   -- INTENTIONALLY no FK: see note below
    packed_coffee_id INTEGER,
    lot_code TEXT,                  -- snapshots, so the row stays readable
    strip_code TEXT,                -- after the lot itself is deleted
    coffee_name TEXT,
    machine_id INTEGER,
    bag_size_g INTEGER,
    delta_pcs INTEGER NOT NULL,     -- (+) in, (-) out
    balance_after INTEGER,
    operation TEXT,
    ref_table TEXT,
    ref_id INTEGER,
    reason TEXT,
    performed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS psm_lot_idx ON public.packed_stock_movements (packed_coffee_lot_id, id);
CREATE INDEX IF NOT EXISTS psm_created_idx ON public.packed_stock_movements (created_at);
CREATE INDEX IF NOT EXISTS psm_ref_idx ON public.packed_stock_movements (ref_table, ref_id);

-- No foreign key on packed_coffee_lot_id — deliberate. A cascading FK would
-- delete a lot's history at exactly the moment it becomes evidence (a
-- deleted-with-stock-still-in-it lot, STOCK_LEDGER_PLAN.md F3). The
-- denormalized lot_code / strip_code / coffee_name keep the row
-- human-readable after the lot itself is gone.

-- Context columns: the trigger knows WHAT changed but not WHY. Application
-- code sets these in the SAME UPDATE that changes remaining_pcs/
-- packed_coffee_id; the trigger reads them, writes the movement row, then
-- clears them (see BEFORE trigger below) so they're strictly single-use and
-- can never be resent by a caller that passes a whole stale row object back
-- to saveData() (js/sales.js's order-approval path does exactly that).
ALTER TABLE public.packed_coffee_lots
    ADD COLUMN IF NOT EXISTS mv_operation TEXT,
    ADD COLUMN IF NOT EXISTS mv_ref_table TEXT,
    ADD COLUMN IF NOT EXISTS mv_ref_id    INTEGER,
    ADD COLUMN IF NOT EXISTS mv_reason    TEXT,
    ADD COLUMN IF NOT EXISTS mv_user      TEXT;

-- BEFORE, not AFTER — two reasons, both learned the hard way in this
-- codebase:
--   1. The context columns must be cleared on the row that actually gets
--      persisted. An AFTER trigger can log correctly but can't un-write
--      stale context that's already landed on the row.
--   2. packed_coffee_id is in the UPDATE OF list here. The EXISTING
--      sync_packed_coffee_quantity trigger omits it, which is exactly why
--      23 rows went silently stale during a duplicate-merge earlier and had
--      to be repaired by hand — a lot moved to a new parent never fired
--      that trigger at all. This trigger must not repeat that mistake.
CREATE OR REPLACE FUNCTION public.log_packed_stock_movement() RETURNS TRIGGER AS $$
DECLARE
    v_parent public.packed_coffee%ROWTYPE;
    v_delta  INTEGER;
    v_op     TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT * INTO v_parent FROM public.packed_coffee WHERE id = OLD.packed_coffee_id;
        IF COALESCE(OLD.remaining_pcs, 0) <> 0 THEN
            INSERT INTO public.packed_stock_movements (
                packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
                coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
                operation, ref_table, ref_id, reason, performed_by)
            VALUES (OLD.id, OLD.packed_coffee_id, OLD.lot_code, OLD.strip_code,
                v_parent.custom_coffee_name, v_parent.machine_id, v_parent.bag_size_g,
                -OLD.remaining_pcs, 0,
                COALESCE(OLD.mv_operation, 'lot_deleted'), OLD.mv_ref_table, OLD.mv_ref_id,
                OLD.mv_reason, OLD.mv_user);
        END IF;
        RETURN OLD;
    END IF;

    SELECT * INTO v_parent FROM public.packed_coffee WHERE id = NEW.packed_coffee_id;

    IF TG_OP = 'INSERT' THEN
        v_delta := COALESCE(NEW.remaining_pcs, 0);
        v_op    := COALESCE(NEW.mv_operation, 'lot_created');
    ELSE
        v_delta := COALESCE(NEW.remaining_pcs, 0) - COALESCE(OLD.remaining_pcs, 0);
        v_op    := COALESCE(NEW.mv_operation, 'unspecified');

        -- Lot reassigned to a different parent: record the transfer even
        -- when remaining_pcs itself did not change in this same statement.
        IF NEW.packed_coffee_id IS DISTINCT FROM OLD.packed_coffee_id THEN
            INSERT INTO public.packed_stock_movements (
                packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
                coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
                operation, ref_table, ref_id, reason, performed_by)
            VALUES (OLD.id, OLD.packed_coffee_id, OLD.lot_code, OLD.strip_code,
                NULL, NULL, NULL,
                -COALESCE(OLD.remaining_pcs, 0), 0,
                'transfer_out', NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);
            INSERT INTO public.packed_stock_movements (
                packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
                coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
                operation, ref_table, ref_id, reason, performed_by)
            VALUES (NEW.id, NEW.packed_coffee_id, NEW.lot_code, NEW.strip_code,
                v_parent.custom_coffee_name, v_parent.machine_id, v_parent.bag_size_g,
                COALESCE(OLD.remaining_pcs, 0), COALESCE(OLD.remaining_pcs, 0),
                'transfer_in', NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);
        END IF;
    END IF;

    IF v_delta <> 0 THEN
        INSERT INTO public.packed_stock_movements (
            packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
            coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
            operation, ref_table, ref_id, reason, performed_by)
        VALUES (NEW.id, NEW.packed_coffee_id, NEW.lot_code, NEW.strip_code,
            v_parent.custom_coffee_name, v_parent.machine_id, v_parent.bag_size_g,
            v_delta, COALESCE(NEW.remaining_pcs, 0),
            v_op, NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);
    END IF;

    -- Context is single-use. Clearing it here is what prevents a stale
    -- label being resent by a caller that passes the whole row object back
    -- to saveData() (js/sales.js's order-approval path does exactly that).
    NEW.mv_operation := NULL;
    NEW.mv_ref_table := NULL;
    NEW.mv_ref_id    := NULL;
    NEW.mv_reason    := NULL;
    NEW.mv_user      := NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_packed_stock_movement ON public.packed_coffee_lots;
CREATE TRIGGER trg_log_packed_stock_movement
BEFORE INSERT OR UPDATE OF remaining_pcs, packed_coffee_id OR DELETE
ON public.packed_coffee_lots
FOR EACH ROW EXECUTE FUNCTION log_packed_stock_movement();

-- Fixes the SAME class of bug in the pre-existing sync_packed_coffee_quantity
-- trigger (v2_packed_coffee_quantity_derived_migration.sql) while we're
-- here: its UPDATE OF list only covered remaining_pcs, not packed_coffee_id,
-- so reassigning a lot to a different parent (e.g. the 2026-08-22 duplicate-
-- row merge) never fired it — 23 rows went silently stale and had to be
-- backfilled by hand. Re-declaring with the same function body, just adding
-- packed_coffee_id to the UPDATE OF list.
DROP TRIGGER IF EXISTS trg_sync_packed_coffee_quantity ON public.packed_coffee_lots;
CREATE TRIGGER trg_sync_packed_coffee_quantity
AFTER INSERT OR UPDATE OF remaining_pcs, packed_coffee_id OR DELETE ON public.packed_coffee_lots
FOR EACH ROW EXECUTE FUNCTION sync_packed_coffee_quantity();

-- One-time backfill: every lot's CURRENT remaining_pcs becomes its opening
-- balance. Without this, every pre-existing lot would show a permanent
-- phantom difference against the hard invariant forever. Safe to re-run —
-- guarded so it never double-inserts an opening balance for a lot that
-- already has one.
INSERT INTO public.packed_stock_movements (
    packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
    coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
    operation, reason, created_at)
SELECT l.id, l.packed_coffee_id, l.lot_code, l.strip_code,
       p.custom_coffee_name, p.machine_id, p.bag_size_g,
       l.remaining_pcs, l.remaining_pcs,
       'opening_balance',
       'Ledger introduced 2026-08-22; movements before this date are not itemised',
       NOW()
FROM public.packed_coffee_lots l
LEFT JOIN public.packed_coffee p ON p.id = l.packed_coffee_id
WHERE NOT EXISTS (
    SELECT 1 FROM public.packed_stock_movements m
    WHERE m.packed_coffee_lot_id = l.id AND m.operation = 'opening_balance'
);

-- RLS: same permissive full_access pattern every other table in this app
-- uses (granular permissions are enforced client-side via
-- hasPermission(), not by the database — see supabase_schema.sql's RLS
-- block). Without this the table is created but the anon-key client the
-- app runs as can't read or write it at all.
ALTER TABLE public.packed_stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.packed_stock_movements;
CREATE POLICY full_access ON public.packed_stock_movements FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
