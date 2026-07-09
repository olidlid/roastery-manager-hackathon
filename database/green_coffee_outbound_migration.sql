-- ============================================================================
-- GREEN COFFEE OUTBOUND (shipments to other roasteries)
-- Run this in your Supabase SQL Editor, then hard-refresh the app.
-- ============================================================================
-- Mirrors green_coffee_intake, but records green beans LEAVING the warehouse
-- (sold/shipped to another roastery). The app deducts the quantity from
-- green_coffee.stock_kg on save and adds it back on delete/edit. No price is
-- stored — the production team only tracks the physical in/out of beans.

CREATE TABLE IF NOT EXISTS public.green_coffee_outbound (
    id SERIAL PRIMARY KEY,
    green_coffee_id INTEGER,                     -- optional link to the source green_coffee row
    date DATE,
    code TEXT,                                   -- snapshot of the coffee's code at ship time
    name TEXT,                                   -- snapshot of the coffee's name at ship time
    origin TEXT,
    process TEXT,
    quantity NUMERIC DEFAULT 0,                  -- kg shipped out
    destination TEXT,                            -- receiving roastery (free text)
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Same permissive RLS pattern as every other table (authorization is enforced
-- client-side via hasPermission(), see CLAUDE.md).
ALTER TABLE public.green_coffee_outbound ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.green_coffee_outbound;
CREATE POLICY full_access ON public.green_coffee_outbound FOR ALL USING (true) WITH CHECK (true);

-- PostgREST caches the schema — without this the REST API throws
-- "Could not find the table ... in the schema cache". Run twice if needed.
NOTIFY pgrst, 'reload schema';
