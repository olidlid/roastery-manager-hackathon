-- V2: split "Ready to Pack" bulk pooling by roast day, not just coffee+machine.
-- bulk_roasted_coffee was previously keyed only by (coffee, machine) —
-- roasting the same coffee on the same machine on a different day silently
-- accumulated into the same row/card, even though the roastery keeps bulk
-- physically separated per roast day. This also fed inaccurate roast dates
-- into the packed-coffee lot code (js/packing.js getOrCreateProductionLot
-- hardcoded "today" because bulk_roasted_coffee had no date of its own).
--
-- Backfill: existing rows already mix multiple unrecoverable roast days, so
-- production_date is best-guessed from the most recent matching
-- roast_batches.roast_date for that coffee+machine, falling back to
-- created_at::date, then CURRENT_DATE. coffee_type also has a third literal
-- ('PostBlendCustom') and post-blend rows have machine_id = NULL — both
-- correctly fail the subquery's join (SQL NULL semantics never matches) and
-- fall through to created_at::date, which is the desired behavior.

ALTER TABLE public.bulk_roasted_coffee ADD COLUMN IF NOT EXISTS production_date DATE;

UPDATE public.bulk_roasted_coffee b
SET production_date = COALESCE(
    (SELECT MAX(rb.roast_date) FROM public.roast_batches rb
     WHERE rb.machine_id = b.machine_id AND rb.coffee_type = b.coffee_type
       AND ((b.coffee_type = 'Single' AND rb.single_coffee_id = b.single_coffee_id)
         OR (b.coffee_type = 'Blend'  AND rb.blend_recipe_id  = b.blend_recipe_id))),
    b.created_at::date,
    CURRENT_DATE
)
WHERE b.production_date IS NULL;

ALTER TABLE public.bulk_roasted_coffee ALTER COLUMN production_date SET DEFAULT CURRENT_DATE;
ALTER TABLE public.bulk_roasted_coffee ALTER COLUMN production_date SET NOT NULL;
COMMENT ON COLUMN public.bulk_roasted_coffee.production_date IS 'V2: re-keys bulk pooling to include roast day — see js/roasting.js addWeightToBulkRoastedCoffee. NULL machine_id (post-blend rows) never matches roast_batches by design, correctly falls to created_at::date fallback.';

NOTIFY pgrst, 'reload schema';
