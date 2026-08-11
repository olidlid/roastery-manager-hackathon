-- ============================================================================
-- ONE-OFF STOCK RESET — 2026-08-11
-- ============================================================================
-- Purpose: the packed stock currently in the app came from a team trial and
-- does not reflect the physical warehouse. This zeroes the packed layers so
-- actual counts can be re-entered via Packing > Ready to Pack > "Add Manual
-- Packed Stock", and closes the trial orders that would otherwise be left
-- unfulfillable.
--
-- ⚠️ NOT a schema migration. Run ONCE, deliberately, when nobody is dispatching.
-- ⚠️ Rollback file must be REGENERATED from live data immediately before this
--    runs — see scratchpad/ROLLBACK_stock_reset.sql. The 2026-08-09 version
--    went stale within two days (+777 bags, 12 new lots, seq 107 -> 119), which
--    is exactly why it gets regenerated at execution time, not in advance.
--
-- SCOPE (revised with the user 2026-08-11):
--   ✓ packed_coffee.quantity            → 0   (aggregate layer)
--   ✓ packed_coffee_lots.remaining_pcs  → 0   (lot layer — what dispatch reads)
--   ✓ request_orders 'Preparing'        → 'Cancelled'  (4 orders)
--   ✗ bulk_roasted_coffee.bulk_available→ UNTOUCHED as of the 2026-08-11
--     revision. Originally in scope, removed deliberately: loadBulkRoastedSection
--     (js/packing.js) only lists rows with bulk_available > 0.005, so zeroing
--     them would drop every row out of the Bulk Roasted edit table and leave NO
--     UI path to re-enter bulk stock (it can otherwise only be created by
--     logging a roast batch). Don't add it back here without first building a
--     manual bulk-entry path.
--   ✗ green_coffee / green_coffee_lots  → UNTOUCHED, deliberately
--   ✗ roast_batches, packing_records, production_lots, dispatch_lot_items,
--     packed_coffee_lots rows themselves → UNTOUCHED (history kept auditable)
--
-- Both packed layers must be zeroed together. They had already drifted apart
-- before this reset (aggregate 9781 vs lot-level 9333 — a 448 bag gap that has
-- stayed exactly 448 across two days, so it's old structural drift, not a
-- widening leak). Zeroing only one of them is what breaks the app: Sales
-- Request reads the aggregate to decide what's sellable, while dispatch
-- checkout reads remaining_pcs to decide what's physically pickable. Leave them
-- mismatched and sales can accept orders packing has no lots to fulfil.
--
-- quantity_pcs on packed_coffee_lots is deliberately NOT zeroed — that column
-- is the lot's original size (history), remaining_pcs is what's left.
--
-- fifo_batch_no_seq is deliberately NOT reset (currently at 119). Old lots keep
-- their batch_no/strip_code even at remaining_pcs = 0, and
-- packed_coffee_lots_strip_code_live_uniq only constrains lots with stock — so
-- resetting the sequence would legally let a NEW lot mint a strip code already
-- printed on a physical bag from the trial. Continuing at 120 guarantees every
-- newly printed code is unique against anything ever printed before.
--
-- Zeroing remaining_pcs (rather than deleting the lots) is also what makes the
-- re-entry flow mint fresh codes correctly: getOrCreatePackedCoffeeLot only
-- merges a manual entry into an existing lot when that lot still has
-- remaining_pcs > 0, so after this reset the first manual entry per
-- coffee+machine+size starts a clean lot instead of resurrecting a trial lot
-- whose sticker code is already on old packaging.
-- ============================================================================

BEGIN;

-- 1. Packed stock — aggregate layer
UPDATE public.packed_coffee
SET quantity = 0
WHERE COALESCE(quantity, 0) <> 0;

-- 2. Packed stock — lot layer (the one dispatch checkout actually reads).
--    Zeroed lots drop out of every FIFO list and the Checkout lot picker
--    automatically, since both filter on remaining_pcs > 0.
UPDATE public.packed_coffee_lots
SET remaining_pcs = 0
WHERE COALESCE(remaining_pcs, 0) <> 0;

-- 3. Close the in-flight trial orders. Only the order-level status matters for
--    stock math: sales.js counts committed stock from orders whose status is
--    'Pending Approval' or 'Preparing', so 'Cancelled' releases those claims.
--    Verified beforehand: none of these 4 orders has a linked roasting_plans
--    row, so nothing is left dangling in Production.
UPDATE public.request_orders
SET status = 'Cancelled'
WHERE status = 'Preparing';

COMMIT;

-- ============================================================================
-- VERIFY — the two packed figures and the order count must read 0.
-- Bulk and green bean must be UNCHANGED from their pre-reset values.
-- ============================================================================
-- SELECT 'packed_coffee qty'        AS check, COALESCE(sum(quantity),0)::text      AS val FROM public.packed_coffee
-- UNION ALL SELECT 'lots remaining',        COALESCE(sum(remaining_pcs),0)::text   FROM public.packed_coffee_lots
-- UNION ALL SELECT 'orders Preparing',      count(*)::text                          FROM public.request_orders WHERE status = 'Preparing'
-- UNION ALL SELECT 'bulk (must be 638.53)', ROUND(COALESCE(sum(bulk_available),0),2)::text FROM public.bulk_roasted_coffee
-- UNION ALL SELECT 'green bean (untouched)',ROUND(COALESCE(sum(stock_kg),0),2)::text FROM public.green_coffee;
