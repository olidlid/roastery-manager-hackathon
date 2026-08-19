-- V2 Greenbean Data Analyze: per-lot lab reading history (moisture,
-- water activity, density), replacing the old single-value snapshot that
-- lived directly on green_coffee (moisture_content/water_activity/density —
-- those columns are KEPT, but become a read-only "latest reading" cache from
-- now on, synced by js/greenbean.js's syncGreenCoffeeLabSnapshot()).
--
-- One row per lab check, tied to the specific arrival lot (green_coffee_lots)
-- it was measured from, not just the coffee in general — a coffee can have
-- many lots in stock at once with different readings. `source` distinguishes
-- the reading captured at intake time ('arrival') from later manual re-checks
-- ('manual'); the app enforces that whichever reading is FIRST recorded for a
-- given lot — whether entered right at arrival or, if that was skipped,
-- later via the Data Analyze tab — is the one tagged 'arrival'.
CREATE TABLE IF NOT EXISTS public.green_coffee_analysis (
    id SERIAL PRIMARY KEY,
    green_coffee_id INTEGER REFERENCES public.green_coffee(id) ON DELETE CASCADE,
    green_coffee_lot_id INTEGER NOT NULL REFERENCES public.green_coffee_lots(id) ON DELETE CASCADE,
    test_date DATE NOT NULL DEFAULT CURRENT_DATE,
    moisture_content NUMERIC,
    water_activity NUMERIC,
    density NUMERIC,
    source TEXT NOT NULL DEFAULT 'manual',        -- 'arrival' | 'manual'
    recorded_by TEXT,                             -- currentUser.name at entry time
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.green_coffee_analysis IS 'V2 Greenbean Data Analyze: per-lot moisture/water_activity/density readings over time. See database/v2_greenbean_analysis_migration.sql.';

-- Frozen (not live-linked) lab reading per origin, captured at the moment a
-- roast batch is logged — so a later re-check of the same lot never
-- retroactively rewrites a historical batch's record. One row per origin: a
-- Single batch gets one row (ingredient_percentage NULL), a Blend batch gets
-- one row per recipe ingredient with its recipe percentage, each carrying the
-- reading from whichever lot that ingredient's FIRST FIFO draw came from.
CREATE TABLE IF NOT EXISTS public.roast_batch_analysis_snapshot (
    id SERIAL PRIMARY KEY,
    roast_batch_id INTEGER REFERENCES public.roast_batches(id) ON DELETE CASCADE,
    green_coffee_id INTEGER REFERENCES public.green_coffee(id) ON DELETE SET NULL,
    green_coffee_lot_id INTEGER REFERENCES public.green_coffee_lots(id) ON DELETE SET NULL,
    ingredient_percentage NUMERIC,                 -- NULL for Single; recipe % for a Blend ingredient
    moisture_content NUMERIC,
    water_activity NUMERIC,
    density NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.roast_batch_analysis_snapshot IS 'V2 Greenbean Data Analyze: frozen lab reading per origin, captured when a roast batch is logged. See database/v2_greenbean_analysis_migration.sql.';

-- Same permissive full_access pattern as every other table (see "Database
-- Schema" rules in CLAUDE.md) — the granular gate is client-side
-- (greenbean_analysis_add / greenbean_analysis_edit), not RLS.
ALTER TABLE public.green_coffee_analysis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.green_coffee_analysis;
CREATE POLICY full_access ON public.green_coffee_analysis FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.roast_batch_analysis_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.roast_batch_analysis_snapshot;
CREATE POLICY full_access ON public.roast_batch_analysis_snapshot FOR ALL USING (true) WITH CHECK (true);

-- Backfill the two new permission keys onto the LIVE custom_roles rows.
-- js/app.js's MOCK_DB.custom_roles was updated with the same true/false
-- split, but that seed only fires when custom_roles is empty (first sync on
-- a fresh project) — it does nothing for an already-populated table like
-- this one, so the keys must be merged in here or the new Add/Edit buttons
-- stay hidden for everyone (hasPermission() treats a missing key as false).
UPDATE public.custom_roles
SET permissions = permissions || jsonb_build_object('greenbean_analysis_add', true, 'greenbean_analysis_edit', true)
WHERE name IN ('Developer', 'Admin', 'Production Leader');

UPDATE public.custom_roles
SET permissions = permissions || jsonb_build_object('greenbean_analysis_add', false, 'greenbean_analysis_edit', false)
WHERE name IN ('Roaster', 'Packing Team', 'Sales Agent');

NOTIFY pgrst, 'reload schema';
