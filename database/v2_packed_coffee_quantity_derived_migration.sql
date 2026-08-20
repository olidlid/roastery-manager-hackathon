-- V2 packed_coffee.quantity becomes a DERIVED value, mirroring
-- green_coffee.stock_kg (see v2_lot_tracking_migration.sql section 12,
-- whose own comment already flagged this as "planned for 1G-1" but it was
-- never implemented). Until now, packed_coffee.quantity was a plain column
-- manually kept in sync with packed_coffee_lots.remaining_pcs by ~9
-- separate call sites across js/packing.js (checkout, pack bulk, repack,
-- close lot, waste, stock release, ...) — two non-atomic writes per
-- operation with nothing enforcing they stay consistent. Found via a live
-- audit (2026-08-19): 13 packed_coffee rows had drifted from their lots'
-- true sum, some UNDER by a few pcs, some OVER by 100+ pcs (i.e. the table
-- was showing stock that didn't physically exist).
--
-- This trigger makes quantity self-correcting: any INSERT/UPDATE/DELETE on
-- packed_coffee_lots recomputes the parent row's quantity from the lots'
-- current remaining_pcs sum, in the SAME transaction as the write — no
-- application code path can drift it again, even ones that still write
-- quantity directly (redundant now, but harmless; the trigger re-asserts
-- the correct value regardless).
CREATE OR REPLACE FUNCTION public.sync_packed_coffee_quantity() RETURNS TRIGGER AS $$
DECLARE
    target_id INTEGER;
BEGIN
    target_id := COALESCE(NEW.packed_coffee_id, OLD.packed_coffee_id);
    IF target_id IS NOT NULL THEN
        UPDATE public.packed_coffee
        SET quantity = (
            SELECT COALESCE(SUM(remaining_pcs), 0)
            FROM public.packed_coffee_lots
            WHERE packed_coffee_id = target_id
        )
        WHERE id = target_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_packed_coffee_quantity ON public.packed_coffee_lots;
CREATE TRIGGER trg_sync_packed_coffee_quantity
AFTER INSERT OR UPDATE OF remaining_pcs OR DELETE ON public.packed_coffee_lots
FOR EACH ROW EXECUTE FUNCTION sync_packed_coffee_quantity();

-- One-time backfill: recompute every packed_coffee row's quantity from its
-- lots right now, correcting the 13 (and any other) rows already drifted
-- before this trigger existed. Safe to re-run.
UPDATE public.packed_coffee pc
SET quantity = sub.total
FROM (
    SELECT packed_coffee_id, COALESCE(SUM(remaining_pcs), 0) AS total
    FROM public.packed_coffee_lots
    GROUP BY packed_coffee_id
) sub
WHERE sub.packed_coffee_id = pc.id
  AND pc.quantity IS DISTINCT FROM sub.total;

-- Rows with NO lots at all (never lot-tracked, or all lots deleted) should
-- read 0, not whatever stale number they last had.
UPDATE public.packed_coffee pc
SET quantity = 0
WHERE pc.quantity != 0
  AND NOT EXISTS (SELECT 1 FROM public.packed_coffee_lots l WHERE l.packed_coffee_id = pc.id);

NOTIFY pgrst, 'reload schema';
