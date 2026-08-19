-- V2 Greenbean Stock History ledger: fills the two gaps that would have
-- made the Greenbean Inventory row-click detail modal's in/out ledger
-- visibly incomplete.
--
-- 1. A manual stock DECREASE (Adjust Green Coffee Stock modal) already
--    calls consumeGreenCoffeeLotsFifo() to draw down green_coffee_lots, but
--    never persisted which lot(s) it drew from — invisible to any later
--    reconstruction. green_coffee_lot_adjustments gives it the same
--    per-lot-draw record every other consumption path already has
--    (roast_batch_green_lots, dispatch_lot_items, stock_release_items).
--
-- 2. Outbound Shipment (js/greenbean.js openOutboundModal) wrote
--    green_coffee.stock_kg directly instead of going through
--    green_coffee_lots — inconsistent with the rest of the app, where
--    stock_kg is a DERIVED value (trigger-summed from
--    green_coffee_lots.remaining_kg — see v2_lot_tracking_migration.sql),
--    and left Outbound rows with no lot to attribute. green_coffee_outbound
--    is kept as the shipment header; green_coffee_outbound_lots is its new
--    per-lot-draw child, same shape as the above.
CREATE TABLE IF NOT EXISTS public.green_coffee_lot_adjustments (
    id SERIAL PRIMARY KEY,
    green_coffee_id INTEGER REFERENCES public.green_coffee(id) ON DELETE CASCADE,
    green_coffee_lot_id INTEGER REFERENCES public.green_coffee_lots(id) ON DELETE SET NULL,
    kg NUMERIC NOT NULL DEFAULT 0,               -- positive = amount removed from this lot
    adjustment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    adjusted_by TEXT,                            -- currentUser.name at entry time
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.green_coffee_lot_adjustments IS 'V2 Stock History ledger: per-lot record of a manual stock DECREASE (Adjust Green Coffee Stock modal). See database/v2_greenbean_ledger_migration.sql.';

CREATE TABLE IF NOT EXISTS public.green_coffee_outbound_lots (
    id SERIAL PRIMARY KEY,
    green_coffee_outbound_id INTEGER REFERENCES public.green_coffee_outbound(id) ON DELETE CASCADE,
    green_coffee_lot_id INTEGER REFERENCES public.green_coffee_lots(id) ON DELETE SET NULL,
    kg NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.green_coffee_outbound_lots IS 'V2 Stock History ledger: per-lot record of which green_coffee_lots an Outbound Shipment drew from (FIFO). See database/v2_greenbean_ledger_migration.sql.';

-- Same permissive full_access pattern as every other table (see "Database
-- Schema" rules in CLAUDE.md) — authorization stays client-side.
ALTER TABLE public.green_coffee_lot_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.green_coffee_lot_adjustments;
CREATE POLICY full_access ON public.green_coffee_lot_adjustments FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.green_coffee_outbound_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.green_coffee_outbound_lots;
CREATE POLICY full_access ON public.green_coffee_outbound_lots FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
