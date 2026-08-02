-- V2 Repack: opening finished packed stock (e.g. 2x1KG) and re-pooling it as
-- a normal bulk_roasted_coffee row so the team packs it back down (e.g. into
-- 8x250G) through the EXACT SAME Print Barcode / Pack pipeline used for a
-- fresh roast — no parallel code path, per explicit user design choice.
--
-- is_repack marks the bulk row so the UI can badge it (rose accent, see
-- css/styles.css .card-repack/.badge-repack) and so
-- addWeightToBulkRoastedCoffee (js/roasting.js) can exclude it from the
-- normal roast-output pooling match — a fresh roast finishing on the same
-- coffee+machine+day must never silently merge its weight into a repack
-- bulk.
--
-- repack_sources is this feature's version of post_blend_components (see
-- that table for the precedent this mirrors): one row per source lot opened
-- into a repack bulk, always pointing at packed_coffee_lots (unlike
-- post_blend_components, repack only ever opens FINISHED packed stock, never
-- another bulk row directly, so there's no source_type/source_bulk_id
-- split). This is also what js/tracking.js walks to render a repacked lot's
-- composition — each source lot's own origin chain (process, supplier,
-- roast date, green arrival) resolved via the existing resolveLotChain(),
-- exactly like a post-blend's composition today. Per explicit user
-- requirement, repacking never changes the coffee's name/identity: the new
-- bulk row copies coffee_type/single_coffee_id/blend_recipe_id/coffee_name
-- straight from the source packed_coffee row, no renaming or suffix.
ALTER TABLE public.bulk_roasted_coffee ADD COLUMN IF NOT EXISTS is_repack BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN public.bulk_roasted_coffee.is_repack IS 'V2 Repack: true for a bulk row created by opening finished packed stock back into loose bulk for re-packing, rather than by roasting. See database/repack_migration.sql.';

CREATE TABLE IF NOT EXISTS public.repack_sources (
    id SERIAL PRIMARY KEY,
    repack_bulk_id INTEGER REFERENCES public.bulk_roasted_coffee(id) ON DELETE CASCADE,
    source_packed_lot_id INTEGER REFERENCES public.packed_coffee_lots(id) ON DELETE SET NULL,
    pcs INTEGER NOT NULL DEFAULT 0,
    kg NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.repack_sources IS 'V2 Repack: one row per source packed_coffee_lots row opened into a repack_bulk_id bulk row. Mirrors post_blend_components'' role for traceability — js/tracking.js walks this to resolve a repacked lot''s full ancestry back to green bean.';

-- Same permissive full_access pattern as every other table (see
-- "Database Schema" rules in CLAUDE.md) — granular permission is enforced
-- client-side (packing_repack), not by RLS.
ALTER TABLE public.repack_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.repack_sources;
CREATE POLICY full_access ON public.repack_sources FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
