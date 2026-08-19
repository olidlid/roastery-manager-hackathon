-- V2 Greenbean lot concurrency fix: every write to green_coffee_lots'
-- remaining_kg previously went through a client-side read-then-write
-- (fetchData in JS, compute new value, saveData the absolute result) with
-- no locking — a classic lost-update race. Two overlapping actions (a
-- roast batch logged while someone else edits an intake, or two batches
-- logged back-to-back before the first write lands) can each read the same
-- stale remaining_kg and each "succeed" independently, silently letting a
-- lot's tracked consumption exceed what it ever actually held. Found while
-- investigating a lot (id 43, "1-GL-260721-01") whose roast_batch_green_lots
-- draws total 2166.16kg against a recorded quantity_kg of only 104 —
-- consistent with this class of bug (not concurrency in that specific case,
-- most likely a since-lost intake edit after consumption had already begun,
-- but the underlying read-then-write pattern is the same root cause either
-- way and needed fixing regardless).
--
-- Each function below does its read + write in ONE SQL statement, so
-- Postgres's own row lock (implicit in any UPDATE) makes it atomic — no
-- explicit FOR UPDATE needed, since the SET expressions reference the
-- table's own current column values under that lock.

-- Atomically takes up to p_kg_requested from a lot, clamped to whatever is
-- REALLY left at the moment of the update (not what the caller last read),
-- and returns the amount actually taken so the caller can move on to the
-- next lot in its FIFO chain if there's a shortfall.
CREATE OR REPLACE FUNCTION public.consume_green_coffee_lot(p_lot_id INTEGER, p_kg_requested NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
AS $$
    WITH before AS (
        SELECT remaining_kg FROM public.green_coffee_lots WHERE id = p_lot_id FOR UPDATE
    ), updated AS (
        UPDATE public.green_coffee_lots
        SET remaining_kg = remaining_kg - LEAST(remaining_kg, GREATEST(p_kg_requested, 0))
        WHERE id = p_lot_id
        RETURNING remaining_kg
    )
    SELECT COALESCE((SELECT remaining_kg FROM before), 0) - COALESCE((SELECT remaining_kg FROM updated), 0);
$$;

-- Atomically adds kg back to a lot (undoing a previous consume) — no
-- clamping needed, a plain relative increment.
CREATE OR REPLACE FUNCTION public.refund_green_coffee_lot(p_lot_id INTEGER, p_kg NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
AS $$
    UPDATE public.green_coffee_lots
    SET remaining_kg = remaining_kg + GREATEST(p_kg, 0)
    WHERE id = p_lot_id
    RETURNING remaining_kg;
$$;

-- Atomically moves both quantity_kg and remaining_kg by the same delta
-- (used when an Arrival intake's recorded quantity is edited) — same
-- floor-at-0 semantics the previous client-side version had.
CREATE OR REPLACE FUNCTION public.adjust_green_coffee_lot(p_lot_id INTEGER, p_delta_kg NUMERIC)
RETURNS TABLE(new_quantity_kg NUMERIC, new_remaining_kg NUMERIC)
LANGUAGE sql
AS $$
    UPDATE public.green_coffee_lots
    SET quantity_kg = GREATEST(0, quantity_kg + p_delta_kg),
        remaining_kg = GREATEST(0, remaining_kg + p_delta_kg)
    WHERE id = p_lot_id
    RETURNING quantity_kg, remaining_kg;
$$;

GRANT EXECUTE ON FUNCTION public.consume_green_coffee_lot(INTEGER, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_green_coffee_lot(INTEGER, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_green_coffee_lot(INTEGER, NUMERIC) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
