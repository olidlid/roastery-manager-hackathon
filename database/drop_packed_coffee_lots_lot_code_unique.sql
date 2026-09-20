-- Drops the UNIQUE constraint on packed_coffee_lots.lot_code.
--
-- Context: lot_code's trailing number changed from a per-lot sequence
-- (always unique) to "total roast_batches for this coffee+machine+day"
-- (a fixed count for that day). One roast day is commonly packed into
-- several packaging sizes, and each size gets its own packed_coffee_lots
-- row — under the new rule, all of them legitimately compute the SAME
-- number, so lot_code text can now collide across sizes on purpose.
-- strip_code (packed_coffee_lots_strip_code_live_uniq, scoped to live
-- stock) remains the actual unique identifier used for scanning/lookup;
-- lot_code is now purely a human-readable "which coffee/machine/day"
-- label for the team, per explicit user request 2026-09-20.
--
-- Run this in the Supabase SQL Editor, then (per CLAUDE.md) it's good
-- practice to run: NOTIFY pgrst, 'reload schema';

ALTER TABLE public.packed_coffee_lots
    DROP CONSTRAINT IF EXISTS packed_coffee_lots_lot_code_key;

NOTIFY pgrst, 'reload schema';
