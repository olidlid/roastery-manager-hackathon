-- Follow-up to fifo_strip_code_migration.sql: switches fifo_batch_no_seq to
-- cycle at 9999 (explicit user instruction 2026-07-28, overriding that
-- migration's original no-cycle design), and fixes the uniqueness
-- constraint accordingly.
--
-- production_lots is a permanent history table (rows are never deleted), so
-- a flat UNIQUE(batch_no) on it would start rejecting inserts the moment
-- the sequence wraps and collides with an old row — dropped in favor of no
-- constraint there at all (batch_no is just a historical stamp on that
-- table). The constraint that actually matters is on
-- packed_coffee_lots.strip_code, and only among lots that still have live
-- stock (remaining_pcs > 0) — that's what guarantees "search 0412" always
-- resolves to exactly one rack right now. A recycled number matching an
-- old, already-sold-through lot is the accepted tradeoff of cycling; a
-- collision with something still on the shelf is what this index prevents.
--
-- Also fixes a second race found while building this: two concurrent Pack
-- submissions for the same (packed_coffee_id, production_lot_id) could
-- both find no existing packed_coffee_lots row and both insert one
-- (confirmed live in production — ids 19/21 and 22/23/24, same underlying
-- race as packed_coffee_dedup_migration.sql, just one level down). Merged
-- via the app's own fetchData/saveData/deleteData before adding this index.

DROP INDEX IF EXISTS public.production_lots_batch_no_uniq;

ALTER SEQUENCE public.fifo_batch_no_seq MAXVALUE 9999 CYCLE;

CREATE UNIQUE INDEX IF NOT EXISTS packed_coffee_lots_packed_production_uniq
ON public.packed_coffee_lots (packed_coffee_id, production_lot_id)
WHERE production_lot_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS packed_coffee_lots_strip_code_live_uniq
ON public.packed_coffee_lots (strip_code)
WHERE remaining_pcs > 0 AND strip_code IS NOT NULL;

NOTIFY pgrst, 'reload schema';
