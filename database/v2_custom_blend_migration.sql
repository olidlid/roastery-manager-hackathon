-- V2 Custom Blend: gets its own tab (Production) instead of living inside
-- Ready to Pack, and gains a required user-typed "Coffee Code" separate
-- from the auto-generated date-based custom_blend_code. Reuses the
-- existing bulk_roasted_coffee (is_post_blend/custom_blend_name/
-- custom_blend_code) and post_blend_components tables from 1I-a rather
-- than a brand-new schema — the "history" the user asked for is this same
-- data, just surfaced in its own tab instead of mixed into Blend Recipes.

ALTER TABLE public.bulk_roasted_coffee ADD COLUMN IF NOT EXISTS custom_coffee_code TEXT;
COMMENT ON COLUMN public.bulk_roasted_coffee.custom_coffee_code IS 'V2 Custom Blend: user-typed short code for a custom blend (distinct from custom_blend_code, which is the date-based auto-generated bulk/lot code).';

NOTIFY pgrst, 'reload schema';
