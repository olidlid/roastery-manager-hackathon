-- Item Return (Packing → Returns), 2026-10-04.
--
-- Returned coffee is recorded first, without touching stock ("floating"
-- stock), then sent per item to packed inventory, a bulk card, or waste —
-- either right away from the Record Return modal ("Send to") or later via
-- Action on each item. One return = one header + several items; every
-- movement an item makes is one stock_return_actions row, so the remaining
-- quantity of an item is sealed_pcs / opened_kg minus its actions.
--
-- Stock itself still only moves through the existing RPCs / triggers
-- (refund_packed_lot, packed_coffee_lots inserts, bulk_roasted_coffee
-- inserts with mv_operation 'return', waste_inventory rows); these tables
-- record where each returned bag went, for the Returns tab and Tracking.
--
-- Run in the Supabase SQL Editor, then keep the NOTIFY line.

-- 1. Header — one per Record Return.
CREATE TABLE IF NOT EXISTS public.stock_returns (
    id SERIAL PRIMARY KEY,
    return_number TEXT NOT NULL UNIQUE,          -- RET-YYYYMMDD-n
    return_date DATE NOT NULL DEFAULT CURRENT_DATE,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE SET NULL,  -- picked from the list (counts in CRM)
    origin_text TEXT,                            -- free-text origin when not a customer (not in CRM)
    reason TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Items — what came back. Identity:
--   coffee_kind 'single' | 'recipe' | 'custom' | 'unknown'
--     single  = a green coffee (single_coffee_id)
--     recipe  = a blend recipe (blend_recipe_id)
--     custom  = a custom blend (from its sticker; no recipe id)
--     unknown = no sticker and the roast log had 0 or several coffees for
--               code + machine + roast date; candidates keeps that list
--   coffee_code + coffee_type = how sales reads it (Code Definitions)
--   resolved_via 'sticker' | 'roast_log' | 'unknown'
CREATE TABLE IF NOT EXISTS public.stock_return_items (
    id SERIAL PRIMARY KEY,
    return_id INTEGER NOT NULL REFERENCES public.stock_returns(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL DEFAULT 1,
    coffee_kind TEXT NOT NULL,
    coffee_code TEXT NOT NULL,
    coffee_type TEXT NOT NULL,
    single_coffee_id INTEGER,
    blend_recipe_id INTEGER,
    coffee_name TEXT NOT NULL,                   -- green / recipe / custom blend name, or the trade name when unknown
    resolved_via TEXT NOT NULL,
    candidates JSONB,                            -- unknown only: [{"name":..., "batches":n}] roasted under the code that day
    source_packed_lot_id INTEGER REFERENCES public.packed_coffee_lots(id) ON DELETE SET NULL,  -- the scanned sticker's lot
    machine_id INTEGER,
    roast_date DATE NOT NULL,                    -- original roast date (from the sticker or typed)
    bag_size_g INTEGER NOT NULL,
    sealed_pcs INTEGER NOT NULL DEFAULT 0 CHECK (sealed_pcs >= 0),
    opened_kg NUMERIC NOT NULL DEFAULT 0 CHECK (opened_kg >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stock_return_items_return_idx ON public.stock_return_items (return_id);

-- 3. Actions — where each part of an item went. Never edited or deleted
-- once written (same rule as the stock ledgers); targets carry no FK on
-- purpose so a later lot/bulk/waste deletion can't erase the trail.
--   part   'sealed' (qty_pcs) | 'opened' (kg)
--   action 'inventory' | 'bulk' | 'waste'
CREATE TABLE IF NOT EXISTS public.stock_return_actions (
    id SERIAL PRIMARY KEY,
    return_item_id INTEGER NOT NULL REFERENCES public.stock_return_items(id) ON DELETE CASCADE,
    part TEXT NOT NULL,
    action TEXT NOT NULL,
    qty_pcs INTEGER NOT NULL DEFAULT 0,
    kg NUMERIC NOT NULL DEFAULT 0,
    target_packed_lot_id INTEGER,
    target_bulk_id INTEGER,
    target_waste_id INTEGER,
    roast_date_used DATE,                        -- roast date on the destination (differs from the item's when changed)
    label_mode TEXT,                             -- inventory only: 'old' | 'new'
    reason TEXT,
    performed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stock_return_actions_item_idx ON public.stock_return_actions (return_item_id);
CREATE INDEX IF NOT EXISTS stock_return_actions_lot_idx ON public.stock_return_actions (target_packed_lot_id);
CREATE INDEX IF NOT EXISTS stock_return_actions_bulk_idx ON public.stock_return_actions (target_bulk_id);

-- 4. Markers on existing tables.
ALTER TABLE public.bulk_roasted_coffee
    ADD COLUMN IF NOT EXISTS is_return BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN public.bulk_roasted_coffee.is_return IS
    'Item Return: bulk card made from returned coffee (tag RETURN). Its sources are the stock_return_actions rows pointing at it.';
ALTER TABLE public.waste_inventory
    ADD COLUMN IF NOT EXISTS return_item_id INTEGER REFERENCES public.stock_return_items(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.waste_inventory.return_item_id IS
    'Item Return: the returned item this waste came from (source_type ''Return'').';

-- 5. Same permissive full_access pattern as every other table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_returns', 'stock_return_items', 'stock_return_actions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS full_access ON public.%I', t);
    EXECUTE format('CREATE POLICY full_access ON public.%I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- 6. One-time permission backfill (DML — lives only here, not in
-- supabase_schema.sql): returns_manage for the admin roles only.
UPDATE public.custom_roles
SET permissions = COALESCE(permissions, '{}'::jsonb) || jsonb_build_object('returns_manage', name IN ('Developer', 'Admin', 'admin2'))
WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'returns_manage');

NOTIFY pgrst, 'reload schema';
