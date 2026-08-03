-- V2 Stock Release: recording finished-goods leaving stock WITHOUT going
-- through the sales order flow (Packing > Stock Release), entered directly by
-- the packing team with no approval step — per explicit user decision, the
-- audit trail is stock_releases.released_by plus the packing_stock_release
-- permission rather than a Pending Approval gate.
--
-- This is the finished-goods sibling of green_coffee_outbound (which does the
-- same job for green beans: physical out, no price). Two differences, both
-- deliberate:
--
--   1. Header + items instead of one flat row. green_coffee_outbound records
--      one coffee per shipment; one stock release realistically carries
--      several coffees/sizes at once (a sample pack might be 2x250g of one
--      coffee plus 1x1kg of another), so it follows the request_orders /
--      request_order_items shape the app already uses for orders.
--
--   2. Consumption is LOT-LEVEL, not a coarse stock decrement. green beans
--      just subtract green_coffee.stock_kg, but packed coffee is lot-tracked
--      (packed_coffee_lots.remaining_pcs, FIFO order, strip codes). Releasing
--      without naming the lot would desync remaining_pcs from
--      packed_coffee.quantity, break FIFO ordering, and lose the answer to
--      "which lot went out as a sample, and to whom" — so every line stores
--      packed_coffee_lot_id, exactly like dispatch_lot_items does for sales.
--
-- Deliberately NOT covered here: damaged/discarded goods. That stays with
-- waste_inventory — a release records stock leaving in GOOD condition, so
-- there is no 'Damaged' category on purpose. Keeping the two apart is what
-- stops the same loss being counted twice.
--
-- Note on the 'Sales' category (explicit user choice): it stores only a
-- free-text sales_name (picklist-assisted), with no customer link and no
-- invoice status.
-- Reconciling those releases against actual billing is therefore a manual
-- process, and nothing here can detect the same goods later also being
-- entered as a formal sales order. This was chosen knowingly over the
-- heavier customer + "not yet invoiced" alternative.

CREATE TABLE IF NOT EXISTS public.stock_releases (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    category TEXT NOT NULL,                      -- 'Sales' | 'Sample' | 'Internal' | 'Marketing' | 'Other'
    sales_name TEXT,                             -- required by the app when category = 'Sales' (datalist of sales_agents, free text allowed)
    notes TEXT,                                  -- required by the app when category = 'Other'
    released_by TEXT,                            -- audit trail: currentUser.name at entry time, same pattern as waste_inventory.recorded_by
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.stock_releases IS 'V2 Stock Release header: one row per non-sales finished-goods release event (Packing > Stock Release). Finished-goods sibling of green_coffee_outbound. See database/stock_release_migration.sql.';

CREATE TABLE IF NOT EXISTS public.stock_release_items (
    id SERIAL PRIMARY KEY,
    stock_release_id INTEGER REFERENCES public.stock_releases(id) ON DELETE CASCADE,
    packed_coffee_lot_id INTEGER REFERENCES public.packed_coffee_lots(id) ON DELETE SET NULL,
    packed_coffee_id INTEGER REFERENCES public.packed_coffee(id) ON DELETE SET NULL,
    coffee_name TEXT,                            -- snapshot, so history stays readable after a lot/packed row is removed
    bag_size_g NUMERIC,                          -- snapshot, same reason
    qty INTEGER NOT NULL DEFAULT 0,              -- pcs released from this lot
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.stock_release_items IS 'V2 Stock Release lines: one row per packed_coffee_lots lot consumed by a release. Mirrors dispatch_lot_items'' traceability role for the non-sales path.';

-- Same permissive full_access pattern as every other table (see "Database
-- Schema" rules in CLAUDE.md) — the granular gate is client-side
-- (packing_stock_release), not RLS.
ALTER TABLE public.stock_releases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.stock_releases;
CREATE POLICY full_access ON public.stock_releases FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.stock_release_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.stock_release_items;
CREATE POLICY full_access ON public.stock_release_items FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
