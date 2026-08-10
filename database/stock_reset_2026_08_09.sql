-- ============================================================================
-- ONE-OFF STOCK RESET — 2026-08-09
-- ============================================================================
-- Purpose: the packed + bulk stock currently in the app came from a team trial
-- and does not reflect the physical warehouse. This zeroes those two layers so
-- actual counts can be re-entered, and closes the trial orders that would
-- otherwise be left unfulfillable.
--
-- ⚠️ NOT a schema migration. Run ONCE, deliberately, when nobody is dispatching.
-- ⚠️ Rollback file (generated from a verified API dump of the pre-reset state):
--    scratchpad/ROLLBACK_stock_reset.sql  — 297 UPDATE statements
--
-- SCOPE (decided with the user 2026-08-09):
--   ✓ packed_coffee.quantity            → 0   (aggregate layer)
--   ✓ packed_coffee_lots.remaining_pcs  → 0   (lot layer — what dispatch reads)
--   ✓ bulk_roasted_coffee.bulk_available→ 0
--   ✓ request_orders 'Preparing'        → 'Cancelled'  (4 orders, 5 items)
--   ✗ green_coffee / green_coffee_lots  → UNTOUCHED, deliberately
--   ✗ roast_batches, packing_records, production_lots, dispatch_lot_items,
--     packed_coffee_lots rows themselves → UNTOUCHED (history kept auditable)
--
-- Both packed layers must be zeroed together. They had already drifted apart
-- before this reset (aggregate 9004 vs lot-level 8556 — a 448 bag gap), and
-- zeroing only one of them is exactly what breaks the app: Sales Request reads
-- the aggregate to decide what's sellable, while dispatch checkout reads
-- remaining_pcs to decide what's physically pickable. Leave them mismatched
-- and sales can accept orders that packing has no lots to fulfil.
--
-- quantity_pcs on packed_coffee_lots is deliberately NOT zeroed — that column
-- is the lot's original size (history), remaining_pcs is what's left.
--
-- fifo_batch_no_seq is deliberately NOT reset (currently at 107). Old lots keep
-- their batch_no/strip_code even at remaining_pcs = 0, and
-- packed_coffee_lots_strip_code_live_uniq only constrains lots with stock — so
-- resetting the sequence would legally let a NEW lot mint a strip code already
-- printed on a physical bag from the trial. Continuing at 108 guarantees every
-- newly printed code is unique against anything ever printed before.
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

-- 3. Bulk roasted stock. Ready to Pack cards filter on bulk_available > 0.005,
--    so these disappear from that tab without deleting the rows.
UPDATE public.bulk_roasted_coffee
SET bulk_available = 0
WHERE COALESCE(bulk_available, 0) <> 0;

-- 4. Close the in-flight trial orders. Only the order-level status matters for
--    stock math: sales.js counts committed stock from orders whose status is
--    'Pending Approval' or 'Preparing', so 'Cancelled' releases those claims.
--    Verified beforehand: none of these 4 orders has a linked roasting_plans
--    row, so nothing is left dangling in Production.
UPDATE public.request_orders
SET status = 'Cancelled'
WHERE status = 'Preparing';

COMMIT;

-- ============================================================================
-- VERIFY — every figure below must read 0 (except the untouched green bean row)
-- ============================================================================
-- SELECT 'packed_coffee qty'        AS check, COALESCE(sum(quantity),0)::text      AS val FROM public.packed_coffee
-- UNION ALL SELECT 'lots remaining',        COALESCE(sum(remaining_pcs),0)::text   FROM public.packed_coffee_lots
-- UNION ALL SELECT 'bulk available',        COALESCE(sum(bulk_available),0)::text  FROM public.bulk_roasted_coffee
-- UNION ALL SELECT 'orders Preparing',      count(*)::text                          FROM public.request_orders WHERE status = 'Preparing'
-- UNION ALL SELECT 'green bean (untouched)',ROUND(COALESCE(sum(stock_kg),0),2)::text FROM public.green_coffee;
