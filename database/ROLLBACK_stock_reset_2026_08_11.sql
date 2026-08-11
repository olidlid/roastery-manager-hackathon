-- ============================================================================
-- ROLLBACK for stock_reset_2026_08_11.sql
-- ============================================================================
-- Restores the exact pre-reset packed stock and order statuses from the backup
-- tables captured in production immediately before the reset ran:
--   public.stock_reset_bak_20260811_packed_coffee   (79 rows, sum quantity 9781)
--   public.stock_reset_bak_20260811_packed_lots     (143 rows, sum remaining 9333)
--   public.stock_reset_bak_20260811_request_orders  (4 rows, all 'Preparing')
--
-- Backup-table snapshot rather than generated UPDATE literals on purpose: the
-- previous attempt kept a hand-generated 297-statement .sql file in the
-- scratchpad, which silently went stale within two days as the team kept
-- packing (+777 bags, 12 new lots). Reading the numbers straight out of a
-- table captured in the same session as the reset removes that whole failure
-- mode — there is nothing to re-transcribe or forget to refresh.
--
-- ⚠️ Only valid for stock that has NOT been re-entered since the reset. Once
--    the team starts adding real warehouse counts via "Add Manual Packed
--    Stock", running this would overwrite those new figures with the old trial
--    ones. Check that packed stock is still all-zero before using this.
--
-- Does NOT touch bulk_roasted_coffee or green_coffee — the reset didn't either.
-- ============================================================================

BEGIN;

UPDATE public.packed_coffee p
SET quantity = b.quantity
FROM public.stock_reset_bak_20260811_packed_coffee b
WHERE p.id = b.id;

UPDATE public.packed_coffee_lots l
SET remaining_pcs = b.remaining_pcs,
    quantity_pcs  = b.quantity_pcs
FROM public.stock_reset_bak_20260811_packed_lots b
WHERE l.id = b.id;

UPDATE public.request_orders o
SET status = b.status
FROM public.stock_reset_bak_20260811_request_orders b
WHERE o.id = b.id;

COMMIT;

-- Verify: these must match the pre-reset figures 9781 / 9333 / 4.
-- SELECT 'packed_coffee qty' AS check, COALESCE(sum(quantity),0)::text AS val FROM public.packed_coffee
-- UNION ALL SELECT 'lots remaining', COALESCE(sum(remaining_pcs),0)::text FROM public.packed_coffee_lots
-- UNION ALL SELECT 'orders Preparing', count(*)::text FROM public.request_orders WHERE status = 'Preparing';

-- ============================================================================
-- CLEANUP — only after the reset is confirmed good and the rollback is no
-- longer wanted. These three tables are the only safety net, so don't drop
-- them the same day.
-- ============================================================================
-- DROP TABLE IF EXISTS public.stock_reset_bak_20260811_packed_coffee;
-- DROP TABLE IF EXISTS public.stock_reset_bak_20260811_packed_lots;
-- DROP TABLE IF EXISTS public.stock_reset_bak_20260811_request_orders;
