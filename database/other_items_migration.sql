-- Other Items (OTHER_ITEMS_PLAN.md): stock for goods bought from outside and
-- resold as-is — paper filters, cups, merchandise. They never pass through
-- roasting or packing, so there is no lot tracking, no FIFO, no expiry: one
-- item carries one running stock_qty, and every change to it is written to
-- other_item_movements by a trigger, the same pattern packed_coffee_lots
-- uses for packed_stock_movements (see mv_* columns / log_packed_stock_movement
-- in supabase_schema.sql).
--
-- Deliberately NAMED "Other Items", not "Retail" — this app's Retail already
-- means a customer category (customers.type, customer_cat_retail permission,
-- RTL- customer code prefix, the "Retail Sales" custom role). A table named
-- retail_items would read as "stock for Retail-category customers", which is
-- wrong (see OTHER_ITEMS_PLAN.md §3).
--
-- Deliberately NO price column and NO code/SKU column (user decisions,
-- 2026-09-20): Sales Requests in this app are quantity documents, not priced
-- ones (request_order_items has no price either — billing is handled
-- outside the app), and the handful of items this feature manages are
-- identified by name alone. other_items.name is therefore made UNIQUE
-- (case-insensitive) and used as the item's identity everywhere.
--
-- Deliberately a SEPARATE order-line table (request_order_other_items),
-- not a new column on request_order_items: js/leader.js renders every order
-- line as `${item.bag_size_g}g (${item.quantity_requested} bags)`, and the
-- whole checkout/packing pipeline (openDispatchCheckoutModal, runCheckout,
-- consume_packed_lot, autofill) assumes a line is coffee with a lot/machine/
-- size. A separate table means none of that old code can ever be handed an
-- other-item row by accident — see OTHER_ITEMS_PLAN.md §4.6.

-- ============================================================================
-- 1. other_items — master item + running stock
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.other_items (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'pcs',           -- pcs | box | roll | pack
    stock_qty INTEGER NOT NULL DEFAULT 0,       -- the ONLY source of truth for stock
    min_stock INTEGER NOT NULL DEFAULT 0,       -- threshold for the "Low" badge
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- Movement context the ledger trigger reads. Mirrors
    -- packed_coffee_lots.mv_* so the app never writes the ledger itself.
    mv_operation TEXT,
    mv_category  TEXT,
    mv_ref_table TEXT,
    mv_ref_id    INTEGER,
    mv_reason    TEXT,
    mv_user      TEXT,
    mv_date      DATE
);

-- The item's name is its identity (no SKU column) — keep it unique.
CREATE UNIQUE INDEX IF NOT EXISTS other_items_name_uniq
ON public.other_items (lower(name));

-- ============================================================================
-- 2. other_item_movements — ledger (stock in / dispatch / release / adjustment)
-- ============================================================================
-- The "Stock Release" tab is NOT a separate table — it is this ledger
-- filtered to operation = 'release'. Do not reuse stock_releases /
-- stock_release_items for this: those are shaped for coffee lots
-- (packed_coffee_lot_id, coffee_name, bag_size_g), which have no meaning
-- for a T-shirt.
CREATE TABLE IF NOT EXISTS public.other_item_movements (
    id BIGSERIAL PRIMARY KEY,
    other_item_id INTEGER,          -- INTENTIONALLY no FK: history must survive
                                     -- the item being deleted (same pattern as
                                     -- packed_stock_movements.packed_coffee_lot_id)
    item_name TEXT,                 -- snapshot
    unit TEXT,                      -- snapshot
    movement_date DATE NOT NULL DEFAULT CURRENT_DATE,  -- the date the USER picked
    delta_qty INTEGER NOT NULL,
    balance_after INTEGER,
    operation TEXT,                  -- item_created | stock_in | dispatch | release
                                      -- | adjustment | undo | item_deleted
    category TEXT,                   -- only for operation='release':
                                      -- Sample | Internal | Marketing | Other
    ref_table TEXT,                  -- 'request_order_other_items' on dispatch
    ref_id INTEGER,
    reason TEXT,
    performed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oim_item_idx    ON public.other_item_movements (other_item_id, id);
CREATE INDEX IF NOT EXISTS oim_created_idx ON public.other_item_movements (created_at);
CREATE INDEX IF NOT EXISTS oim_op_idx      ON public.other_item_movements (operation, id);

-- ============================================================================
-- 3. Ledger trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION public.log_other_item_movement() RETURNS TRIGGER AS $$
DECLARE v_delta INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- A plain DELETE never sets the mv_* columns, so whatever is sitting
        -- in them is LEFTOVER from the last RPC call on this row. Reading
        -- them here would file the deletion as e.g. operation='stock_in'
        -- with a negative delta, crediting it to whoever last added stock.
        -- So this branch ignores mv_* entirely and states the plain fact.
        -- For an attributed deletion, the app calls
        -- other_item_set_qty(id, 0, 'item_deleted', ..., p_reason, p_user)
        -- FIRST; stock is then already 0 and this branch no-ops.
        IF COALESCE(OLD.stock_qty, 0) <> 0 THEN
            INSERT INTO public.other_item_movements (
                other_item_id, item_name, unit, movement_date,
                delta_qty, balance_after, operation, category,
                ref_table, ref_id, reason, performed_by)
            VALUES (OLD.id, OLD.name, OLD.unit, CURRENT_DATE,
                -OLD.stock_qty, 0, 'item_deleted', NULL,
                NULL, NULL, NULL, NULL);
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_delta := COALESCE(NEW.stock_qty, 0);
    ELSE
        v_delta := COALESCE(NEW.stock_qty, 0) - COALESCE(OLD.stock_qty, 0);
    END IF;

    -- Editing name/unit/min_stock without touching stock writes no ledger row.
    IF v_delta = 0 THEN RETURN NEW; END IF;

    INSERT INTO public.other_item_movements (
        other_item_id, item_name, unit, movement_date,
        delta_qty, balance_after, operation, category,
        ref_table, ref_id, reason, performed_by)
    VALUES (NEW.id, NEW.name, NEW.unit, COALESCE(NEW.mv_date, CURRENT_DATE),
        v_delta, NEW.stock_qty,
        COALESCE(NEW.mv_operation, CASE WHEN TG_OP = 'INSERT' THEN 'item_created' ELSE 'unspecified' END),
        NEW.mv_category, NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_log_other_item_movement ON public.other_items;
CREATE TRIGGER trg_log_other_item_movement
AFTER INSERT OR UPDATE OR DELETE ON public.other_items
FOR EACH ROW EXECUTE FUNCTION log_other_item_movement();

-- ============================================================================
-- 4. RPCs — every stock change MUST go through one of these three. The app
--    must never write other_items.stock_qty directly via saveData().
-- ============================================================================

-- Manual stock in.
CREATE OR REPLACE FUNCTION public.other_item_stock_in(
    p_item_id INTEGER, p_qty INTEGER, p_date DATE DEFAULT NULL,
    p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE sql SET search_path = public AS $$
    UPDATE public.other_items
    SET stock_qty   = stock_qty + GREATEST(p_qty, 0),
        updated_at  = NOW(),
        mv_operation='stock_in', mv_category=NULL,
        mv_ref_table=NULL, mv_ref_id=NULL,
        mv_reason=p_reason, mv_user=p_user, mv_date=COALESCE(p_date, CURRENT_DATE)
    WHERE id = p_item_id
    RETURNING stock_qty;
$$;

-- Stock going out (a sales dispatch OR a release). Locks the row, clamps at
-- 0, and RETURNS the quantity actually taken (never trust the requested
-- amount — same contract as consume_packed_lot).
CREATE OR REPLACE FUNCTION public.other_item_consume(
    p_item_id INTEGER, p_qty INTEGER,
    p_operation TEXT DEFAULT 'dispatch', p_category TEXT DEFAULT NULL,
    p_ref_table TEXT DEFAULT NULL, p_ref_id INTEGER DEFAULT NULL,
    p_date DATE DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE sql SET search_path = public AS $$
    WITH before AS (
        SELECT stock_qty FROM public.other_items WHERE id = p_item_id FOR UPDATE
    ), updated AS (
        UPDATE public.other_items
        SET stock_qty   = stock_qty - LEAST(stock_qty, GREATEST(p_qty, 0)),
            updated_at  = NOW(),
            mv_operation=p_operation, mv_category=p_category,
            mv_ref_table=p_ref_table, mv_ref_id=p_ref_id,
            mv_reason=p_reason, mv_user=p_user, mv_date=COALESCE(p_date, CURRENT_DATE)
        WHERE id = p_item_id
        RETURNING stock_qty
    )
    SELECT COALESCE((SELECT stock_qty FROM before), 0)
         - COALESCE((SELECT stock_qty FROM updated), 0);
$$;

-- Count correction / undo: set an exact figure.
CREATE OR REPLACE FUNCTION public.other_item_set_qty(
    p_item_id INTEGER, p_qty INTEGER,
    p_operation TEXT DEFAULT 'adjustment',
    p_ref_table TEXT DEFAULT NULL, p_ref_id INTEGER DEFAULT NULL,
    p_date DATE DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE sql SET search_path = public AS $$
    UPDATE public.other_items
    SET stock_qty   = GREATEST(0, p_qty),
        updated_at  = NOW(),
        mv_operation=COALESCE(p_operation, 'adjustment'), mv_category=NULL,
        mv_ref_table=p_ref_table, mv_ref_id=p_ref_id,
        mv_reason=p_reason, mv_user=p_user, mv_date=COALESCE(p_date, CURRENT_DATE)
    WHERE id = p_item_id
    RETURNING stock_qty;
$$;

GRANT EXECUTE ON FUNCTION public.other_item_stock_in(INTEGER, INTEGER, DATE, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.other_item_consume(INTEGER, INTEGER, TEXT, TEXT, TEXT, INTEGER, DATE, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.other_item_set_qty(INTEGER, INTEGER, TEXT, TEXT, INTEGER, DATE, TEXT, TEXT) TO anon, authenticated;

-- ============================================================================
-- 5. request_order_other_items — other-item lines on a Sales Request
-- ============================================================================
-- No quantity_prepared: nothing needs preparing, the item is taken straight
-- off the shelf at checkout.
CREATE TABLE IF NOT EXISTS public.request_order_other_items (
    id SERIAL PRIMARY KEY,
    request_order_id INTEGER REFERENCES public.request_orders(id) ON DELETE CASCADE,
    other_item_id INTEGER REFERENCES public.other_items(id) ON DELETE SET NULL,
    item_name TEXT,                              -- snapshot at order creation time
    unit TEXT,                                   -- snapshot
    quantity_requested INTEGER NOT NULL DEFAULT 0,
    quantity_dispatched INTEGER NOT NULL DEFAULT 0,
    quantity_unfulfilled INTEGER NOT NULL DEFAULT 0,
    item_status TEXT DEFAULT 'Pending Approval',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rooi_order_idx ON public.request_order_other_items (request_order_id);

-- ============================================================================
-- 6. RLS — same permissive full_access pattern as every other table in this
--    app (granular authorization is enforced client-side via hasPermission()).
-- ============================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'other_items','other_item_movements','request_order_other_items' -- applied 2026-09-20
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS full_access ON public.%I', t);
    EXECUTE format('CREATE POLICY full_access ON public.%I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Deliberately NOT wiring stock_take_freeze_guard onto other_items. Stock
-- opname in this app counts coffee (green/bulk/packed) — freezing other-item
-- stock while a coffee opname is running would block sales of filters/cups/
-- merch for no reason connected to what's actually being counted.

-- ============================================================================
-- 7. Permission backfill — REQUIRED, not optional.
-- ============================================================================
-- custom_roles.permissions is a JSONB object; a key that is ABSENT reads as
-- false via hasPermission(). Without this backfill the feature is invisible
-- to every role, including Admin and Developer, until someone notices —
-- this is exactly what happened to purchase_request_view_own before it.
--
-- User decision 2026-09-21: "Sales Manager", "Retail Sales" and "Supermarket
-- Sales" (custom roles, not part of the six defaults) also get
-- other_items_view — they sell these items and need to see stock. Any OTHER
-- custom role (e.g. "admin2") gets false from every key below — a safe
-- default; add its name to whichever line it needs and re-run.
UPDATE public.custom_roles
SET permissions = COALESCE(permissions, '{}'::jsonb)   -- NULL || x = NULL: a role
                                                        -- row with NULL permissions
                                                        -- would silently keep none
                                                        -- of the keys below
    || jsonb_build_object(
        'other_items_view',     name IN ('Developer','Admin','Production Leader','Packing Team','Sales Agent','Sales Manager','Retail Sales','Supermarket Sales'),
        'other_items_add',      name IN ('Developer','Admin','Production Leader'),
        'other_items_edit',     name IN ('Developer','Admin','Production Leader'),
        'other_items_delete',   name IN ('Developer','Admin','Production Leader'),
        'other_items_stock_in', name IN ('Developer','Admin','Production Leader'),
        'other_items_release',  name IN ('Developer','Admin','Production Leader')
    );

-- After running this file: NOTIFY pgrst, 'reload schema'; (run twice if the
-- REST API still reports missing columns/tables on the first try).
