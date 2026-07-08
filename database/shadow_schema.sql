-- ============================================================================
-- SHADOW SCHEMA MIGRATION FOR V2 LOT TRACKING
-- Run this in your Supabase SQL Editor
-- ============================================================================

-- 1. Create green_coffee_lots table (with INTEGER FK referencing green_coffee.id)
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

-- 2. Create packed_coffee_lots table (with INTEGER FK referencing packed_coffee.id and roast_batches.id)
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

-- 3. Enable RLS and create full_access policy for both tables
ALTER TABLE public.green_coffee_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.green_coffee_lots;
CREATE POLICY full_access ON public.green_coffee_lots FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.packed_coffee_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.packed_coffee_lots;
CREATE POLICY full_access ON public.packed_coffee_lots FOR ALL USING (true) WITH CHECK (true);

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
