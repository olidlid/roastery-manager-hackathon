-- Custom Blend — unregistered ingredients + sales code on packed stock (2026-09-29)
--
-- A custom blend can now include coffee that is NOT in inventory (a supplier
-- sample, leftovers from a cupping session, ...). Such an ingredient has no
-- bulk card and no packed lot to point at, so it is recorded by the name and
-- free-text source the user typed:
--
--   source_type = 'Unregistered'
--   source_bulk_id = NULL, source_packed_lot_id = NULL
--   source_name  = coffee name as typed ("Ethiopia Guji")
--   source_note  = where it came from ("Sample from Al Mahmoud Trading")
--
-- No stock moves for these rows. Existing 'Bulk' / 'Packed' rows are
-- untouched; both new columns simply stay NULL for them.
--
-- Run in the Supabase SQL Editor, then keep the NOTIFY line (PostgREST caches
-- the schema — without it the REST API reports the new columns as missing).

ALTER TABLE public.post_blend_components
    ADD COLUMN IF NOT EXISTS source_name TEXT,
    ADD COLUMN IF NOT EXISTS source_note TEXT;

COMMENT ON COLUMN public.post_blend_components.source_type IS
    '''Bulk'' | ''Packed'' | ''Unregistered''';
COMMENT ON COLUMN public.post_blend_components.source_name IS
    'Unregistered ingredient only: coffee name as typed by the user.';
COMMENT ON COLUMN public.post_blend_components.source_note IS
    'Unregistered ingredient only: free-text source/origin, required by the app.';

-- Packed stock made from a custom blend carries the registered sales code
-- it sells as. A custom blend's name is free text, so it never matches a
-- green_coffee / blend_recipes name — before this column, sales, approval
-- and checkout (which recognise packed stock by name) could not see its
-- stock at all unless the typed name happened to equal an existing recipe.
-- NULL for every other packed row, whose identity keeps coming from its
-- roast batch or name exactly as before.
-- The type travels with the code because a code is not always one type:
-- code 23 is used by a green coffee AND a blend recipe, so "sells as 23"
-- alone can't say whether sales sees it as Single or Blend.
ALTER TABLE public.packed_coffee
    ADD COLUMN IF NOT EXISTS coffee_code TEXT,
    ADD COLUMN IF NOT EXISTS coffee_code_type TEXT;

COMMENT ON COLUMN public.packed_coffee.coffee_code IS
    'Custom-blend packed stock only: the Code Definitions code it sells as.';
COMMENT ON COLUMN public.packed_coffee.coffee_code_type IS
    'Custom-blend packed stock only: ''Single'' | ''Blend'' — how sales groups coffee_code.';

-- The custom blend bulk card remembers the same choice, so packing copies it
-- onto the packed stock it creates. custom_coffee_code already exists.
ALTER TABLE public.bulk_roasted_coffee
    ADD COLUMN IF NOT EXISTS custom_coffee_type TEXT;

COMMENT ON COLUMN public.bulk_roasted_coffee.custom_coffee_type IS
    'Custom blend only: ''Single'' | ''Blend'' — the sales type of custom_coffee_code.';

NOTIFY pgrst, 'reload schema';
