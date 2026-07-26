-- Fix: roast_batches.input_weight_kg / output_weight_kg were NUMERIC(10,2)
-- in production (undocumented — database/supabase_schema.sql listed them
-- as plain NUMERIC with no precision noted, a schema-drift case per the
-- "Database Schema" rules in CLAUDE.md). 2 decimal places of kg = rounds
-- to the nearest 10 grams, silently dropping the last digit of any gram
-- value the Batch Log form's "step=1" gram inputs actually allow (e.g.
-- 6521g stored as 6.52kg -> displays as 6520g).
--
-- Widened to NUMERIC(10,3) — 1 gram precision, matching what the form lets
-- the user type. Existing rows are already valid at 2 decimals and are
-- untouched; only future writes gain the extra digit.

ALTER TABLE public.roast_batches ALTER COLUMN input_weight_kg TYPE NUMERIC(10,3);
ALTER TABLE public.roast_batches ALTER COLUMN output_weight_kg TYPE NUMERIC(10,3);

COMMENT ON COLUMN public.roast_batches.input_weight_kg IS 'Green bean weight in kg, 1-gram precision (NUMERIC(10,3)) — was NUMERIC(10,2) in production, silently rounding to the nearest 10g.';
COMMENT ON COLUMN public.roast_batches.output_weight_kg IS 'Roasted weight in kg, 1-gram precision (NUMERIC(10,3)) — was NUMERIC(10,2) in production, silently rounding to the nearest 10g.';

NOTIFY pgrst, 'reload schema';
