-- FIFO strip code feature (V2): a short, human-readable code printed as a
-- vertical strip beside the packed-coffee barcode, alongside the existing
-- long-form lot_code (e.g. "12-1072226-3"), which stays exactly as-is per
-- the client's explicit request to keep it. Full design discussion is in
-- the conversation; this migration is the data-layer half.
--
-- Format: strip_code = {size_digit}{batch_no zero-padded to 4 digits}
-- e.g. "10021" = 1kg (size_digit 1), batch 21. batch_no identifies one
-- production day for one bulk item (production_lots), NOT one packed lot —
-- packing the same bulk into two sizes gives both packed_coffee_lots rows
-- the SAME batch_no, differing only by size_digit, so a rack sorted by the
-- numeric part alone still reflects roast-day FIFO order within a size.
--
-- batch_no is a plain non-cycling sequence (NOT the MAXVALUE...CYCLE
-- pattern used elsewhere in this codebase for cosmetic codes) because this
-- number is also encoded into the scannable barcode itself (see
-- js/packing.js printLotBarcodeLabels) — a recycled number would let an old
-- physical sticker scan as a different, currently-live lot. At the
-- observed rate of ~5-10 new production lots/day this exhausts a 4-digit
-- range in single-digit years; when it gets within range of overflowing,
-- widen batch_no's zero-padding (and the barcode/strip length) rather than
-- cycling it.

-- 1. Packaging sizes get a single configurable digit (Settings > Production
--    > Packaging Sizes) that becomes the first character of both the strip
--    code and the barcode payload. Seeded for the two sizes that exist
--    today; any size added later needs a digit assigned before it
--    participates in this feature (its packed lots simply won't get a
--    strip_code/re-encoded barcode until then — falls back to the existing
--    long-form lot_code only).
ALTER TABLE public.packaging_sizes ADD COLUMN IF NOT EXISTS size_digit SMALLINT;

UPDATE public.packaging_sizes SET size_digit = 1 WHERE gram = 1000 AND size_digit IS NULL;
UPDATE public.packaging_sizes SET size_digit = 2 WHERE gram = 250 AND size_digit IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS packaging_sizes_size_digit_uniq
ON public.packaging_sizes (size_digit)
WHERE size_digit IS NOT NULL;

-- 2. The shared sequence. Both production_lots.batch_no (the common case —
--    a lot resolved from a bulk item) and packed_coffee_lots.batch_no (only
--    when NOT linked to a production_lot, i.e. manual/custom packing with
--    no bulk source) draw from this same sequence, so a manual entry can
--    never collide with a production-lot-backed one.
CREATE SEQUENCE IF NOT EXISTS public.fifo_batch_no_seq;

ALTER TABLE public.production_lots ADD COLUMN IF NOT EXISTS batch_no INTEGER;
ALTER TABLE public.production_lots ALTER COLUMN batch_no SET DEFAULT nextval('public.fifo_batch_no_seq');

-- Backfill existing production_lots chronologically (oldest roast day = smallest
-- batch_no) so the numbers mean something for lots that already exist —
-- safe to do since this environment is still in trial (confirmed with the
-- user 2026-07-28).
WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY production_date, id) AS rn
    FROM public.production_lots
    WHERE batch_no IS NULL
)
UPDATE public.production_lots pl
SET batch_no = ordered.rn
FROM ordered
WHERE pl.id = ordered.id;

SELECT setval('public.fifo_batch_no_seq', COALESCE((SELECT MAX(batch_no) FROM public.production_lots), 0));

ALTER TABLE public.production_lots ALTER COLUMN batch_no SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS production_lots_batch_no_uniq ON public.production_lots (batch_no);

-- 3. packed_coffee_lots gets its own batch_no (copied from the linked
--    production_lot at creation time, or freshly assigned for a
--    manual/unlinked lot — see js/packing.js getOrCreatePackedCoffeeLot)
--    plus the derived strip_code text.
ALTER TABLE public.packed_coffee_lots ADD COLUMN IF NOT EXISTS batch_no INTEGER;
ALTER TABLE public.packed_coffee_lots ADD COLUMN IF NOT EXISTS strip_code TEXT;

-- Backfill: copy batch_no from the linked production lot where one exists...
UPDATE public.packed_coffee_lots pcl
SET batch_no = pl.batch_no
FROM public.production_lots pl
WHERE pcl.production_lot_id = pl.id
  AND pcl.batch_no IS NULL;

-- ...and assign a fresh number (from the SAME sequence) to every lot that
-- has no production_lot link (manual/custom packing).
UPDATE public.packed_coffee_lots
SET batch_no = nextval('public.fifo_batch_no_seq')
WHERE production_lot_id IS NULL
  AND batch_no IS NULL;

-- Compute strip_code now that every lot has a batch_no, via each lot's
-- packed_coffee row's bag size -> packaging_sizes.size_digit. Lots whose
-- size has no configured digit yet are left with a NULL strip_code (falls
-- back to lot_code-only display) rather than blocking the whole backfill.
UPDATE public.packed_coffee_lots pcl
SET strip_code = ps.size_digit::text || lpad(pcl.batch_no::text, 4, '0')
FROM public.packed_coffee pc
JOIN public.packaging_sizes ps ON ps.gram = pc.bag_size_g AND ps.size_digit IS NOT NULL
WHERE pcl.packed_coffee_id = pc.id
  AND pcl.strip_code IS NULL;

NOTIFY pgrst, 'reload schema';
