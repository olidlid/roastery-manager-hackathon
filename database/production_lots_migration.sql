-- ============================================================================
-- PRODUCTION LOTS (traceability for the "Ready to Pack" barcode workflow)
-- Run this in your Supabase SQL Editor, then hard-refresh the app.
-- ============================================================================
-- One row per (bulk_roasted_coffee row, production_date) — i.e. one lot code
-- per coffee+machine per day. Printing barcodes for a given bulk item on a
-- given day reuses the same lot_code if one was already generated that day;
-- otherwise a new one is created. latest_roast_batch_id is a snapshot of the
-- most recent roast_batches row feeding that bulk item at print time, used
-- for the "roasting date" shown by the Tracking page — since bulk_available
-- is a running total, this is an approximation (the pool may also contain
-- unpacked carryover from earlier days), not a precise per-batch trace. True
-- per-batch precision is deferred to the V2 FIFO lot-tracking phase (see
-- V2_ROADMAP.md), which the green_coffee_lots/packed_coffee_lots shadow
-- tables (database/shadow_schema.sql) were prepared for.

CREATE TABLE IF NOT EXISTS public.production_lots (
    id SERIAL PRIMARY KEY,
    lot_code TEXT NOT NULL UNIQUE,
    bulk_roasted_coffee_id INTEGER REFERENCES public.bulk_roasted_coffee(id) ON DELETE SET NULL,
    coffee_type TEXT,
    single_coffee_id INTEGER,
    blend_recipe_id INTEGER,
    machine_id INTEGER,
    coffee_name TEXT,
    production_date DATE NOT NULL DEFAULT CURRENT_DATE,
    latest_roast_batch_id INTEGER REFERENCES public.roast_batches(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_lots_bulk_date
    ON public.production_lots(bulk_roasted_coffee_id, production_date);

-- Same permissive RLS pattern as every other table (authorization is enforced
-- client-side via hasPermission(), see CLAUDE.md).
ALTER TABLE public.production_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.production_lots;
CREATE POLICY full_access ON public.production_lots FOR ALL USING (true) WITH CHECK (true);

-- PostgREST caches the schema — without this the REST API throws
-- "Could not find the table ... in the schema cache". Run twice if needed.
NOTIFY pgrst, 'reload schema';
