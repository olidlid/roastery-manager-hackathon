-- V2: link packing_records (the append-only packing history log) back to the
-- exact packed_coffee_lots row it created/added to, so a past pack action
-- can be found and corrected even after that lot's stock has since been
-- fully dispatched (Ready to Pack cards and the Stock by Lot drill-down
-- both filter to remaining/available > 0, so they can't serve as a "find
-- any pack action ever made" entry point — packing_records, being an
-- unfiltered complete history, is the right place. Corrections still
-- operate on packed_coffee_lots, the actual source of truth — this column
-- is what makes that possible from a Packing Records row).
--
-- Nullable: older rows created before this column existed have no lot to
-- link back to and simply can't be corrected via this flow.

ALTER TABLE public.packing_records
    ADD COLUMN IF NOT EXISTS packed_coffee_lot_id INTEGER REFERENCES public.packed_coffee_lots(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.packing_records.packed_coffee_lot_id IS 'V2: links this pack-action log entry to the packed_coffee_lots row it created/added to, so the Packing Records tab can offer a correction flow even after the lot is fully depleted. NULL for rows created before this column existed.';

NOTIFY pgrst, 'reload schema';
