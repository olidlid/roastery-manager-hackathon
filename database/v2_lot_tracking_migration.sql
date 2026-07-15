-- ============================================================================
-- V2 PHASE 1 — FIFO LOT TRACKING & TRACEABILITY: SCHEMA FOUNDATION
-- Run this in your Supabase SQL Editor (sandbox project), then hard-refresh.
-- See V2_ROADMAP.md section "1·CHAIN" for the full design rationale.
-- ============================================================================
-- This migration only adds tables/columns and the stock-sync trigger. It does
-- NOT change any application code — js/*.js still writes/reads exactly as
-- before until the corresponding V2 tasks (1A, 1B, 1G-1, 1I, ...) are built.
-- Running this migration alone is safe and inert for the current live app.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. BASE SHADOW TABLES (found 2026-07-15 to be MISSING from production,
--    despite CLAUDE.md/REFACTORING.md documenting them as already created
--    during the V1 refactor). Created here with IF NOT EXISTS so this
--    migration stays safe to re-run even after they exist.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.green_coffee_lots (
    id SERIAL PRIMARY KEY,
    green_coffee_id INTEGER REFERENCES public.green_coffee(id) ON DELETE CASCADE,
    lot_code TEXT NOT NULL UNIQUE,
    quantity_kg NUMERIC NOT NULL DEFAULT 0,
    remaining_kg NUMERIC NOT NULL DEFAULT 0,
    supplier TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    arrival_date DATE DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS public.packed_coffee_lots (
    id SERIAL PRIMARY KEY,
    packed_coffee_id INTEGER REFERENCES public.packed_coffee(id) ON DELETE CASCADE,
    roast_batch_id INTEGER REFERENCES public.roast_batches(id) ON DELETE SET NULL,
    lot_code TEXT NOT NULL UNIQUE,
    quantity_pcs INTEGER NOT NULL DEFAULT 0,
    remaining_pcs INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    packed_date DATE DEFAULT CURRENT_DATE
);


-- ----------------------------------------------------------------------------
-- 1. green_coffee_lots: add per-lot purchase price (needed for future costing,
--    see 1C — data captured now, no COGS calculation built yet).
-- ----------------------------------------------------------------------------
ALTER TABLE public.green_coffee_lots
    ADD COLUMN IF NOT EXISTS purchase_price_per_kg NUMERIC;


-- ----------------------------------------------------------------------------
-- 2. roast_batch_green_lots (NEW) — one roast batch can draw from several
--    green lots (blend, or a single batch spilling across lots). Always
--    recorded precisely in kg per lot, regardless of what the Tracking UI
--    surfaces. Feeds 1C (future costing) and Tracking traceability.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roast_batch_green_lots (
    id SERIAL PRIMARY KEY,
    roast_batch_id INTEGER REFERENCES public.roast_batches(id) ON DELETE CASCADE,
    green_coffee_lot_id INTEGER REFERENCES public.green_coffee_lots(id) ON DELETE SET NULL,
    kg_consumed NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rbgl_batch ON public.roast_batch_green_lots(roast_batch_id);
CREATE INDEX IF NOT EXISTS idx_rbgl_lot ON public.roast_batch_green_lots(green_coffee_lot_id);


-- ----------------------------------------------------------------------------
-- 3. production_lot_batches (NEW) — day-level precision link from a
--    production_lot (the barcode printed at Ready to Pack) to the
--    roast_batches of the same coffee+machine roasted that same day.
--    Replaces the old single production_lots.latest_roast_batch_id
--    approximation. Carryover from prior days is deliberately not modeled
--    (accepted inaccuracy — see V2_ROADMAP.md 1·CHAIN).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_lot_batches (
    id SERIAL PRIMARY KEY,
    production_lot_id INTEGER REFERENCES public.production_lots(id) ON DELETE CASCADE,
    roast_batch_id INTEGER REFERENCES public.roast_batches(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(production_lot_id, roast_batch_id)
);
CREATE INDEX IF NOT EXISTS idx_plb_lot ON public.production_lot_batches(production_lot_id);


-- ----------------------------------------------------------------------------
-- 4. packed_coffee_lots: link each packed lot back to the production_lot it
--    was packed from. Table already exists (V1 shadow schema) but nothing
--    populates it yet — that starts with 1G-1.
-- ----------------------------------------------------------------------------
ALTER TABLE public.packed_coffee_lots
    ADD COLUMN IF NOT EXISTS production_lot_id INTEGER REFERENCES public.production_lots(id) ON DELETE SET NULL;


-- ----------------------------------------------------------------------------
-- 5. dispatch_lot_items (NEW) — POS dispatch fulfillment record: which packed
--    lot, how much, went to which order line / customer. See 1G.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispatch_lot_items (
    id SERIAL PRIMARY KEY,
    request_order_item_id INTEGER REFERENCES public.request_order_items(id) ON DELETE CASCADE,
    packed_coffee_lot_id INTEGER REFERENCES public.packed_coffee_lots(id) ON DELETE SET NULL,
    customer_id INTEGER,
    qty INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dli_order_item ON public.dispatch_lot_items(request_order_item_id);
CREATE INDEX IF NOT EXISTS idx_dli_customer ON public.dispatch_lot_items(customer_id);
CREATE INDEX IF NOT EXISTS idx_dli_lot ON public.dispatch_lot_items(packed_coffee_lot_id);


-- ----------------------------------------------------------------------------
-- 6. post_blend_components (NEW) — records what went into a post-blend bulk
--    (custom post-blend, 1I-a, and recipe-based post-blend, 1I-b both use
--    this). source_type distinguishes whether the component came from an
--    existing bulk or an existing packed lot (1I-a only — 1I-b components are
--    always fresh roast batches, tracked via roast_batch_green_lots +
--    production_lot_batches instead, not this table).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_blend_components (
    id SERIAL PRIMARY KEY,
    blend_bulk_id INTEGER REFERENCES public.bulk_roasted_coffee(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,  -- 'Bulk' | 'Packed'
    source_bulk_id INTEGER REFERENCES public.bulk_roasted_coffee(id) ON DELETE SET NULL,
    source_packed_lot_id INTEGER REFERENCES public.packed_coffee_lots(id) ON DELETE SET NULL,
    kg NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pbc_blend ON public.post_blend_components(blend_bulk_id);


-- ----------------------------------------------------------------------------
-- 7. green_coffee: new nullable fields (1E) shown on the Tracking page.
-- ----------------------------------------------------------------------------
ALTER TABLE public.green_coffee ADD COLUMN IF NOT EXISTS moisture_content NUMERIC;
ALTER TABLE public.green_coffee ADD COLUMN IF NOT EXISTS water_activity NUMERIC;
ALTER TABLE public.green_coffee ADD COLUMN IF NOT EXISTS density NUMERIC;


-- ----------------------------------------------------------------------------
-- 8. roast_batches: Roast Degree / Agtron (1F), shown on the Tracking page.
-- ----------------------------------------------------------------------------
ALTER TABLE public.roast_batches ADD COLUMN IF NOT EXISTS roast_degree NUMERIC;


-- ----------------------------------------------------------------------------
-- 9. bulk_roasted_coffee: support post-blend bulks (both 1I-a custom and
--    1I-b recipe-based assembled blends).
-- ----------------------------------------------------------------------------
ALTER TABLE public.bulk_roasted_coffee ADD COLUMN IF NOT EXISTS is_post_blend BOOLEAN DEFAULT FALSE;
ALTER TABLE public.bulk_roasted_coffee ADD COLUMN IF NOT EXISTS custom_blend_name TEXT;   -- 1I-a: user-typed name
ALTER TABLE public.bulk_roasted_coffee ADD COLUMN IF NOT EXISTS custom_blend_code TEXT;   -- 1I-a: date-based identity code


-- ----------------------------------------------------------------------------
-- 10. blend_recipes: pre/post flag (1I-b) — Recipe tab's two sub-tabs read
--     off this.
-- ----------------------------------------------------------------------------
ALTER TABLE public.blend_recipes ADD COLUMN IF NOT EXISTS is_post_blend BOOLEAN DEFAULT FALSE;


-- ----------------------------------------------------------------------------
-- 11. roasting_plans: sub-plan linkage for post-blend recipe explosion
--     (1I-b) — a post-blend plan explodes into one single-origin sub-plan
--     per ingredient, each linked back to its parent.
-- ----------------------------------------------------------------------------
ALTER TABLE public.roasting_plans ADD COLUMN IF NOT EXISTS parent_plan_id INTEGER REFERENCES public.roasting_plans(id) ON DELETE CASCADE;
ALTER TABLE public.roasting_plans ADD COLUMN IF NOT EXISTS is_post_blend_component BOOLEAN DEFAULT FALSE;


-- ----------------------------------------------------------------------------
-- 12. green_coffee.stock_kg becomes a DERIVED value (2026-07-12 decision —
--     single source of truth, mirrors the packed_coffee restructure planned
--     for 1G-1). Implemented as a trigger-maintained column rather than a
--     true generated column (Postgres GENERATED columns can't aggregate
--     across another table) — reads of green_coffee.stock_kg need NO code
--     changes; only 1A/1B stop writing it directly (they write
--     green_coffee_lots instead, and this trigger keeps stock_kg in sync
--     automatically, so no code path can drift it).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_green_coffee_stock() RETURNS TRIGGER AS $$
DECLARE
    target_id INTEGER;
BEGIN
    target_id := COALESCE(NEW.green_coffee_id, OLD.green_coffee_id);
    IF target_id IS NOT NULL THEN
        UPDATE public.green_coffee
        SET stock_kg = (
            SELECT COALESCE(SUM(remaining_kg), 0)
            FROM public.green_coffee_lots
            WHERE green_coffee_id = target_id
        )
        WHERE id = target_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_green_coffee_stock ON public.green_coffee_lots;
CREATE TRIGGER trg_sync_green_coffee_stock
AFTER INSERT OR UPDATE OF remaining_kg OR DELETE ON public.green_coffee_lots
FOR EACH ROW EXECUTE FUNCTION sync_green_coffee_stock();

-- One-time seed: every green_coffee row with existing stock_kg > 0 gets one
-- "opening balance" lot so pre-lot-tracking stock isn't lost when 1A/1B go
-- live. Skipped for coffees that already have a lot (safe to re-run).
-- The trigger above will immediately recompute stock_kg from this seed lot,
-- which is a no-op since quantity_kg = the stock_kg it was seeded from.
INSERT INTO public.green_coffee_lots (green_coffee_id, lot_code, quantity_kg, remaining_kg, supplier, arrival_date, purchase_price_per_kg)
SELECT
    gc.id,
    COALESCE(NULLIF(gc.code, ''), 'C' || gc.id) || '-GL-OPENING-' || gc.id,
    gc.stock_kg,
    gc.stock_kg,
    gc.supplier,
    COALESCE(gc.purchase_date, CURRENT_DATE),
    gc.purchase_price_per_kg
FROM public.green_coffee gc
WHERE gc.stock_kg > 0
  AND NOT EXISTS (SELECT 1 FROM public.green_coffee_lots gl WHERE gl.green_coffee_id = gc.id);


-- ----------------------------------------------------------------------------
-- RLS — same permissive full_access pattern as every other table (see
-- CLAUDE.md "Database Schema"). Authorization is enforced client-side.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'green_coffee_lots','packed_coffee_lots',
    'roast_batch_green_lots','production_lot_batches',
    'dispatch_lot_items','post_blend_components'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS full_access ON public.%I', t);
    EXECUTE format('CREATE POLICY full_access ON public.%I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 13. green_coffee_intake: link back to the lot it created (added 2026-07-15,
--     applied separately as migration v2_link_intake_to_green_lot). Without
--     this, editing/deleting an intake has no way to find & adjust the lot
--     that green_coffee.stock_kg is now derived from.
-- ----------------------------------------------------------------------------
ALTER TABLE public.green_coffee_intake
    ADD COLUMN IF NOT EXISTS green_coffee_lot_id INTEGER REFERENCES public.green_coffee_lots(id) ON DELETE SET NULL;

-- PostgREST caches the schema — without this the REST API throws
-- "Could not find the column/table ... in the schema cache". Run twice if needed.
NOTIFY pgrst, 'reload schema';
