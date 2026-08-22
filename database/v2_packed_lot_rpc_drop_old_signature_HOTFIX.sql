-- HOTFIX — apply immediately.
--
-- v2_packed_lot_rpc_context_params_migration.sql assumed CREATE OR REPLACE
-- FUNCTION with added trailing default parameters replaces the function
-- in place. It does not: Postgres treats a different parameter list as a
-- DIFFERENT overload, so the database now has BOTH the old 2-argument
-- consume_packed_lot/refund_packed_lot/set_packed_lot_remaining AND the
-- new 7-argument versions side by side. Every existing call site (10 of
-- them, calling with just {p_lot_id, p_pcs}) now matches both overloads
-- ambiguously and PostgREST rejects the call outright:
-- "Could not choose the best candidate function between:
--  public.consume_packed_lot(p_lot_id => integer, p_pcs => integer),
--  public.consume_packed_lot(p_lot_id => integer, p_pcs => integer,
--    p_operation => text, ...)"
--
-- This breaks EVERY dispatch checkout, undo, stock release, repack, and
-- order-approval fulfillment in production right now. Drop the old
-- 2-argument overloads so only the 7-argument version (with defaults)
-- remains — 2-argument calls then resolve to it unambiguously, exactly as
-- intended.

DROP FUNCTION IF EXISTS public.consume_packed_lot(INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.refund_packed_lot(INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.set_packed_lot_remaining(INTEGER, INTEGER);

NOTIFY pgrst, 'reload schema';
