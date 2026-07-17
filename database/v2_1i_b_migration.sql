-- V2 1I-b: Recipe-based Post-Blend
-- Links a recipe-assembled post-blend's bulk_roasted_coffee row back to the
-- parent roasting_plans row it was assembled from, so the Ready to Pack
-- composition card and Tracking resolver can derive per-component kg from
-- that parent's sub-plans (roasting_plans.parent_plan_id) instead of a
-- separate components table (unlike 1I-a's custom post-blend, which uses
-- post_blend_components since its sources are existing stock, not fresh
-- roast batches).
--
-- All other columns needed for 1I-b (blend_recipes.is_post_blend,
-- roasting_plans.parent_plan_id, roasting_plans.is_post_blend_component)
-- were already added as shadow schema during 1A — see
-- v2_lot_tracking_migration.sql.

ALTER TABLE public.bulk_roasted_coffee ADD COLUMN IF NOT EXISTS source_plan_id INTEGER REFERENCES public.roasting_plans(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.bulk_roasted_coffee.source_plan_id IS 'V2 1I-b: links a recipe-based post-blend assembled bulk row back to its parent roasting_plans row, so composition can be derived from that parent''s sub-plans (parent_plan_id) instead of a separate components table.';

NOTIFY pgrst, 'reload schema';
