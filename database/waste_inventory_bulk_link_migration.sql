-- V2 "Close Lot": lets the packing team retire a bulk lot whose physical stock
-- is finished while the system still shows a few grams (scale differences,
-- spillage, moisture loss). Rather than deleting the bulk_roasted_coffee row —
-- which would break traceability, since production_lots.bulk_roasted_coffee_id
-- is ON DELETE SET NULL and every already-printed label from that lot would
-- lose its link back — the row is kept and bulk_available set to 0, with the
-- leftover recorded here as waste so the discrepancy stays visible instead of
-- silently vanishing.
--
-- waste_inventory only had roast_batch_id, so a bulk-side loss had nothing to
-- point at. Same pattern as packing_records.packed_coffee_lot_id.

ALTER TABLE public.waste_inventory
    ADD COLUMN IF NOT EXISTS bulk_roasted_coffee_id INTEGER REFERENCES public.bulk_roasted_coffee(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.waste_inventory.bulk_roasted_coffee_id IS 'V2 Close Lot: the bulk lot this loss came from, so a retired lot''s leftover kg can be traced back. NULL for waste logged from other sources (e.g. a failed QC roast batch, which uses roast_batch_id instead).';

NOTIFY pgrst, 'reload schema';
