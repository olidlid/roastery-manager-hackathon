-- V2 Packed coffee lot concurrency fix (STOCK_LEDGER_PLAN.md Phase 1).
-- Every write to packed_coffee_lots.remaining_pcs previously went through a
-- client-side read-then-write (fetchData in JS, compute new value, saveData
-- the absolute result) with no locking — a classic lost-update race.
--
-- Reproduced live 2026-08-22 on a throwaway test lot: two concurrent takes
-- of 30 and 20 pcs against a 100-pc lot (checkout + approval-fulfil racing,
-- or two checkouts racing) each read 100 and each computed their own
-- "correct" result independently — only one write survived, leaving the lot
-- showing 70 or 80 remaining instead of the true 50. The difference left the
-- warehouse with zero record (this is exactly what STOCK_LEDGER_PLAN.md's
-- ledger, Phase 2, needs correct numbers to log — hence Phase 1 before
-- Phase 2).
--
-- Modeled on database/v2_greenbean_lot_atomic_functions_migration.sql, the
-- same fix already proven in production for green_coffee_lots. Each
-- function does its read + write in ONE SQL statement so Postgres's own row
-- lock (implicit in any UPDATE) makes it atomic. SET search_path = public
-- is included here (a Supabase advisor WARN was raised on the green-bean
-- functions for omitting it — fixed there separately, included from the
-- start here).

-- Atomically takes up to p_pcs from a lot, clamped to what is REALLY left
-- at the moment of the update (not what the caller last read). Returns the
-- pcs actually taken so the caller can spill the shortfall to the next lot
-- in its FIFO chain instead of assuming it got the full amount.
CREATE OR REPLACE FUNCTION public.consume_packed_lot(p_lot_id INTEGER, p_pcs INTEGER)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
    WITH before AS (
        SELECT remaining_pcs FROM public.packed_coffee_lots WHERE id = p_lot_id FOR UPDATE
    ), updated AS (
        UPDATE public.packed_coffee_lots
        SET remaining_pcs = remaining_pcs - LEAST(remaining_pcs, GREATEST(p_pcs, 0))
        WHERE id = p_lot_id
        RETURNING remaining_pcs
    )
    SELECT COALESCE((SELECT remaining_pcs FROM before), 0)
         - COALESCE((SELECT remaining_pcs FROM updated), 0);
$$;

-- Atomically adds pcs back to a lot (undoing a previous consume, or an
-- approval/checkout reversal) — no clamping needed, a plain relative
-- increment.
CREATE OR REPLACE FUNCTION public.refund_packed_lot(p_lot_id INTEGER, p_pcs INTEGER)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE public.packed_coffee_lots
    SET remaining_pcs = remaining_pcs + GREATEST(p_pcs, 0)
    WHERE id = p_lot_id
    RETURNING remaining_pcs;
$$;

-- Sets an absolute remaining count (used by the Edit Packing Record
-- correction flow). Deliberately does NOT touch quantity_pcs — that column
-- is the lot's historical "how much was originally packed" figure and must
-- not be rewritten by a stock correction (STOCK_LEDGER_PLAN.md F6).
CREATE OR REPLACE FUNCTION public.set_packed_lot_remaining(p_lot_id INTEGER, p_pcs INTEGER)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE public.packed_coffee_lots
    SET remaining_pcs = GREATEST(0, p_pcs)
    WHERE id = p_lot_id
    RETURNING remaining_pcs;
$$;

GRANT EXECUTE ON FUNCTION public.consume_packed_lot(INTEGER, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_packed_lot(INTEGER, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_packed_lot_remaining(INTEGER, INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
