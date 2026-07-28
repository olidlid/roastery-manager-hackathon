-- Fixes a race condition (confirmed live in production 2026-07-28): two
-- concurrent packing submits for the same coffee+size+machine both found no
-- existing packed_coffee row and both inserted one, fragmenting stock across
-- duplicate rows (e.g. YIRGACH GEDEB CHECHELE 250g/machine 2 split into 3
-- rows: 48/16/16 pcs, all still with live packed_coffee_lots pointing at
-- them). js/packing.js's getOrCreatePackedCoffeeRow now retries on a unique
-- violation from this index instead of racing; this index is what actually
-- makes that race impossible instead of just less likely.
--
-- Scoped to roast_batch_id IS NULL because every current packed_coffee row
-- is created that way (see js/packing.js) — custom_coffee_name is the only
-- identity these rows have. Case-insensitive (lower()) because the two
-- insert call sites historically compared case differently.
CREATE UNIQUE INDEX IF NOT EXISTS packed_coffee_custom_identity_uniq
ON public.packed_coffee (lower(custom_coffee_name), bag_size_g, machine_id)
WHERE roast_batch_id IS NULL;

NOTIFY pgrst, 'reload schema';
