-- ============================================================================
-- ROASTERY MANAGER V2 - PRODUCTION SCHEMA SNAPSHOT
-- ============================================================================
-- Synced from the LIVE production database via information_schema on 2026-07-06.
-- This file is the column-level source of truth: code that reads/writes a table
-- must match the columns listed here.
--
-- SYNC RULE (see CLAUDE.md "Deployment Checklist"):
--   Any schema change goes here FIRST, then is applied to production via
--   ALTER/CREATE in the Supabase SQL Editor, followed by:
--     NOTIFY pgrst, 'reload schema';
--   (PostgREST caches the schema; without the NOTIFY the REST API returns
--    "Could not find the '<col>' column ... in the schema cache" errors.)
--
-- NOTES:
--  * Statements use CREATE TABLE IF NOT EXISTS and carry no DROPs, so running
--    this file against production is non-destructive (it will simply no-op on
--    existing tables). It can bootstrap a fresh project, minus historic data.
--  * Many tables carry LEGACY columns from earlier app generations (marked
--    "legacy"). They still exist in production; do not reuse them for new
--    features without checking what old rows contain.
--  * FK constraints in production are largely unverified (most tables were
--    created ad-hoc); only known constraints are included.
--  * `handover_logs` existed in older versions of this file but does NOT exist
--    in production (the app's MOCK_DB still references it — live fetches fall
--    back to the local cache).
-- ============================================================================

-- 1. User profiles (linked to auth.users by the signup trigger below)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'Roaster',
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Roles & granular permissions (seeded from MOCK_DB.custom_roles in js/app.js
--    by syncCustomRolesFromSupabase() when empty)
CREATE TABLE IF NOT EXISTS public.custom_roles (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#0369a1',
    is_system BOOLEAN DEFAULT FALSE,
    permissions JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Company & global settings (single row, id = 1)
CREATE TABLE IF NOT EXISTS public.company_settings (
    id SERIAL PRIMARY KEY,
    key TEXT,                                   -- legacy (old key/value design)
    value TEXT,                                 -- legacy
    created_at TIMESTAMPTZ DEFAULT NOW(),
    company_name TEXT DEFAULT '',
    weight_unit TEXT DEFAULT 'kg',
    currency TEXT DEFAULT 'USD',
    logo_url TEXT DEFAULT '',                   -- legacy (app uses logo_base64)
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    handover_title TEXT DEFAULT 'GOODS HANDOVER SLIP',
    min_stock_packed_sizes JSONB DEFAULT '{}'::jsonb,
    logo_base64 TEXT,
    show_logo_in_print BOOLEAN DEFAULT TRUE,
    print_footer_text TEXT DEFAULT 'All goods transferred are the responsibility of the sales team.',
    email TEXT DEFAULT '',
    min_stock_greenbean_kg NUMERIC DEFAULT 0,
    min_production_potential_kg NUMERIC DEFAULT 0,
    label_width INTEGER DEFAULT 100,
    label_height INTEGER DEFAULT 50,
    label_show_code BOOLEAN DEFAULT TRUE,
    label_show_coffee BOOLEAN DEFAULT TRUE,
    label_show_date BOOLEAN DEFAULT TRUE,
    label_show_machine BOOLEAN DEFAULT TRUE,
    label_show_weight BOOLEAN DEFAULT TRUE,
    label_show_operator BOOLEAN DEFAULT FALSE,
    label_show_qr BOOLEAN DEFAULT FALSE,
    label_show_dep BOOLEAN DEFAULT TRUE,        -- added 2026-07-06 (label print: show Depreciation %)
    developer_key TEXT DEFAULT 'dev2026',
    slogan TEXT DEFAULT ''                      -- added 2026-07-06 (shown under company name in sidebar)
);

-- 4. Green bean inventory
CREATE TABLE IF NOT EXISTS public.green_coffee (
    id SERIAL PRIMARY KEY,
    code TEXT,
    name TEXT,
    origin TEXT,
    process TEXT,
    stock_kg NUMERIC DEFAULT 0,
    purchase_date DATE,
    purchase_price_per_kg NUMERIC,
    supplier TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Green bean intake / arrival history
CREATE TABLE IF NOT EXISTS public.green_coffee_intake (
    id SERIAL PRIMARY KEY,
    green_coffee_id INTEGER,
    lot_number TEXT,                            -- legacy
    weight_kg NUMERIC,                          -- legacy (app uses quantity)
    arrival_date DATE,                          -- legacy (app uses date)
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    date DATE,
    code TEXT,
    name TEXT,
    origin TEXT,
    process TEXT,
    quantity NUMERIC DEFAULT 0,
    supplier TEXT
);

-- 5b. Green bean outbound (shipments to other roasteries) — added 2026-07-09
--     Mirror of green_coffee_intake but deducts stock instead of adding it.
--     See database/green_coffee_outbound_migration.sql. No price stored.
CREATE TABLE IF NOT EXISTS public.green_coffee_outbound (
    id SERIAL PRIMARY KEY,
    green_coffee_id INTEGER,
    date DATE,
    code TEXT,
    name TEXT,
    origin TEXT,
    process TEXT,
    quantity NUMERIC DEFAULT 0,
    destination TEXT,                           -- receiving roastery (free text)
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Blend recipes
CREATE TABLE IF NOT EXISTS public.blend_recipes (
    id SERIAL PRIMARY KEY,
    name TEXT,
    code TEXT,
    description TEXT,
    components JSONB DEFAULT '[]'::jsonb,       -- legacy (app uses blend_ingredients table)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    machine_id INTEGER,
    batch_size_g NUMERIC
);

-- 7. Blend ingredients (green_coffee -> blend_recipes)
CREATE TABLE IF NOT EXISTS public.blend_ingredients (
    id SERIAL PRIMARY KEY,
    blend_recipe_id INTEGER,
    green_coffee_id INTEGER,
    percentage NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    quantity_g NUMERIC NOT NULL DEFAULT 0
);

-- 8. Roasting machines
CREATE TABLE IF NOT EXISTS public.machines (
    id SERIAL PRIMARY KEY,
    name TEXT,
    code TEXT,
    capacity_g NUMERIC,
    ideal_batch_size_g NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ideal_batch_g NUMERIC                       -- legacy (app uses ideal_batch_size_g)
);

-- 9. Roasting plans
--    NOTE: production sequence is named roast_plans_id_seq (table was renamed
--    from roast_plans at some point); harmless, but don't be surprised by it.
CREATE TABLE IF NOT EXISTS public.roasting_plans (
    id SERIAL PRIMARY KEY,
    plan_date DATE,
    green_coffee_id INTEGER,                    -- legacy (app uses single_coffee_id)
    machine_id INTEGER,
    target_weight_kg NUMERIC,                   -- legacy (app uses target_roasted_kg)
    roast_level TEXT,
    status TEXT DEFAULT 'Planned',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    day TEXT,
    coffee_type TEXT,
    single_coffee_id INTEGER,
    blend_recipe_id INTEGER,
    target_roasted_kg NUMERIC DEFAULT 0,
    fulfilled_roasted_kg NUMERIC DEFAULT 0,
    order_ref TEXT,
    request_order_item_id INTEGER
);

-- 10. Roast batches
--     This table accumulated TWO column generations. The app currently WRITES:
--       batch_number, roast_date, roast_plan_id, green_coffee_id, machine_id,
--       green_weight_g, roasted_weight_g
--     but still READS several of the older columns (coffee_type, qc_status,
--     input/output_weight_kg, ...) that also exist in production.
CREATE TABLE IF NOT EXISTS public.roast_batches (
    id SERIAL PRIMARY KEY,
    batch_number TEXT,
    roast_plan_id INTEGER,
    green_coffee_id INTEGER,
    machine_id INTEGER,
    green_weight_g NUMERIC,
    roasted_weight_g NUMERIC,
    weight_loss_pct NUMERIC,
    roast_date DATE,
    roast_level TEXT,
    roast_duration_min NUMERIC,
    charge_temp_c NUMERIC,
    drop_temp_c NUMERIC,
    is_test_batch BOOLEAN DEFAULT FALSE,
    test_batch_approved BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    plan_id INTEGER,                            -- legacy
    coffee_name TEXT,                           -- legacy
    green_weight_kg NUMERIC DEFAULT 0,          -- legacy
    roasted_weight_kg NUMERIC DEFAULT 0,        -- legacy
    duration_min INTEGER,                       -- legacy
    first_crack_temp NUMERIC,                   -- legacy
    drop_temp NUMERIC,                          -- legacy
    status TEXT DEFAULT 'Completed',            -- legacy
    batch_code TEXT,                            -- legacy (app uses batch_number)
    blend_recipe_id INTEGER,
    coffee_type TEXT,
    single_coffee_id INTEGER,
    roasting_plan_id INTEGER,
    input_weight_kg NUMERIC,
    output_weight_kg NUMERIC,
    yield_percentage NUMERIC,
    roast_type TEXT DEFAULT 'Regular',
    qc_status TEXT DEFAULT 'Success',
    remaining_bulk_kg NUMERIC,
    roaster_operator TEXT
);

-- 11. Bulk roasted coffee (roasted, not yet packed)
CREATE TABLE IF NOT EXISTS public.bulk_roasted_coffee (
    id SERIAL PRIMARY KEY,
    coffee_name TEXT NOT NULL,
    source_type TEXT DEFAULT 'Single',          -- legacy (app uses coffee_type)
    source_id INTEGER,                          -- legacy
    roast_level TEXT,
    stock_kg NUMERIC DEFAULT 0,                 -- legacy (app uses bulk_available)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    machine_id INTEGER,
    single_coffee_id INTEGER,
    blend_recipe_id INTEGER,
    coffee_type TEXT,
    bulk_available NUMERIC DEFAULT 0
);

-- 12. Waste inventory (failed test batches etc.)
CREATE TABLE IF NOT EXISTS public.waste_inventory (
    id SERIAL PRIMARY KEY,
    source_type TEXT,
    source_name TEXT,
    waste_kg NUMERIC DEFAULT 0,
    reason TEXT,
    recorded_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    discard_date DATE DEFAULT CURRENT_DATE,
    roast_batch_id INTEGER
);

-- 13. Packaging sizes (250g / 500g / 1kg ...)
CREATE TABLE IF NOT EXISTS public.packaging_sizes (
    id SERIAL PRIMARY KEY,
    label TEXT,
    weight_g NUMERIC,                           -- legacy (app uses gram)
    min_stock INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    gram NUMERIC DEFAULT 250,
    is_visible BOOLEAN DEFAULT TRUE
);

-- 14. Packed coffee stock (finished goods)
CREATE TABLE IF NOT EXISTS public.packed_coffee (
    id SERIAL PRIMARY KEY,
    coffee_name TEXT,                           -- legacy (app uses custom_coffee_name)
    source_type TEXT,                           -- legacy
    source_id INTEGER,                          -- legacy
    grind TEXT,
    size_g NUMERIC,                             -- legacy (app uses bag_size_g)
    quantity INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    bag_size_g NUMERIC,
    machine_id INTEGER,
    single_coffee_id INTEGER,
    blend_recipe_id INTEGER,
    custom_coffee_name TEXT,
    roast_batch_id INTEGER,
    selling_price NUMERIC
);

-- 15. Packing records (daily packing history)
CREATE TABLE IF NOT EXISTS public.packing_records (
    id SERIAL PRIMARY KEY,
    source_type TEXT,
    source_id INTEGER,
    coffee_name TEXT,
    grind TEXT,
    size_g NUMERIC,
    quantity INTEGER,
    pack_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    packed_by TEXT,
    order_id INTEGER,
    status TEXT DEFAULT 'Packed',
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    machine_id INTEGER,
    bag_size_g INTEGER
);

-- 16. Customers (WHL/RTL)
CREATE TABLE IF NOT EXISTS public.customers (
    id SERIAL PRIMARY KEY,
    customer_id TEXT NOT NULL,                  -- display code e.g. RTL-001
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Retail',
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. Sales agents
CREATE TABLE IF NOT EXISTS public.sales_agents (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    region TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    code TEXT
);

-- 18. Request orders (sales dispatch requests)
CREATE TABLE IF NOT EXISTS public.request_orders (
    id SERIAL PRIMARY KEY,
    order_number TEXT,
    customer_name TEXT,                         -- legacy (app uses customer_id)
    order_date DATE,
    status TEXT DEFAULT 'Pending',
    items JSONB DEFAULT '[]'::jsonb,            -- legacy (app uses request_order_items table)
    notes TEXT,
    dispatch_date DATE,
    dispatched_by TEXT,
    approved_by TEXT,
    approved_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    customer_id INTEGER,
    sales_name TEXT
);

-- 19. Request order items
CREATE TABLE IF NOT EXISTS public.request_order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER,                           -- legacy (app uses request_order_id)
    product_name TEXT,                          -- legacy
    grind TEXT,                                 -- legacy
    size_g NUMERIC,                             -- legacy (app uses bag_size_g)
    quantity INTEGER DEFAULT 0,                 -- legacy (app uses quantity_requested)
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    coffee_name TEXT,                           -- legacy
    coffee_type TEXT,
    coffee_id INTEGER,                          -- legacy (app uses single_coffee_id/blend_recipe_id)
    bag_size_g NUMERIC,
    quantity_requested INTEGER DEFAULT 0,
    quantity_fulfilled INTEGER DEFAULT 0,       -- legacy (app uses quantity_allocated)
    machine_id INTEGER,
    item_status TEXT DEFAULT 'Pending Approval',
    single_coffee_id INTEGER,
    blend_recipe_id INTEGER,
    request_order_id INTEGER REFERENCES public.request_orders(id) ON DELETE CASCADE, -- added 2026-07-06
    quantity_allocated INTEGER DEFAULT 0,       -- added 2026-07-06
    quantity_pending INTEGER DEFAULT 0,         -- added 2026-07-06
    quantity_prepared INTEGER DEFAULT 0         -- added 2026-07-06 (packing progress at Order Requests stage; distinct from quantity_allocated, which is set at Dispatch Approval time)
);

-- 20. Sales orders — LEGACY table from an earlier generation of the app.
--     The current app uses request_orders/request_order_items instead.
CREATE TABLE IF NOT EXISTS public.sales_orders (
    id SERIAL PRIMARY KEY,
    order_number TEXT,
    customer_name TEXT,
    order_date DATE,
    status TEXT DEFAULT 'Pending',
    items JSONB DEFAULT '[]'::jsonb,
    notes TEXT,
    dispatch_date DATE,
    dispatched_by TEXT,
    approved_by TEXT,
    approved_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 21. Stock takes (monthly stock opname / physical count sessions) — added 2026-07-06
CREATE TABLE IF NOT EXISTS public.stock_takes (
    id SERIAL PRIMARY KEY,
    take_date DATE DEFAULT CURRENT_DATE,
    performed_by TEXT,
    notes TEXT,
    total_items INTEGER DEFAULT 0,            -- number of counted line items
    variance_items INTEGER DEFAULT 0,         -- how many of those had a non-zero variance
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 22. Stock take line items — one row per counted unit (audit snapshot) — added 2026-07-06
--     system_qty is what the app believed at count time; actual_qty is the physical
--     count; variance = actual_qty - system_qty. On finalize the app writes actual_qty
--     back into the source table (green_coffee.stock_kg / bulk_roasted_coffee.bulk_available
--     / packed_coffee.quantity) and keeps this row as the immutable audit trail.
CREATE TABLE IF NOT EXISTS public.stock_take_items (
    id SERIAL PRIMARY KEY,
    stock_take_id INTEGER REFERENCES public.stock_takes(id) ON DELETE CASCADE,
    category TEXT,                            -- 'greenbean' | 'bulk' | 'packed'
    item_name TEXT,
    unit TEXT,                               -- 'kg' | 'bags'
    system_qty NUMERIC DEFAULT 0,
    actual_qty NUMERIC DEFAULT 0,
    variance NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 23. Green bean lots (shadow schema for V2 lot tracking)
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

-- 24. Packed coffee lots (shadow schema for V2 packed lot tracking)
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

-- 25. Production lots (traceability for "Ready to Pack" barcode workflow —
-- see database/production_lots_migration.sql for the migration + full notes).
-- One row per (bulk_roasted_coffee row, production_date); the Tracking page
-- searches this table by lot_code to show coffee/process/supplier/dates.
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

-- ============================================================================
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Production pattern (verified on roast_batches & packing_records, and implied
-- everywhere by the app doing all CRUD from the browser with the anon key):
-- RLS enabled with a single permissive "full_access" policy per table.
-- Granular permissions are enforced client-side via custom_roles/hasPermission,
-- NOT by the database.
-- ============================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','custom_roles','company_settings','green_coffee',
    'green_coffee_intake','blend_recipes','blend_ingredients','machines',
    'roasting_plans','roast_batches','bulk_roasted_coffee','waste_inventory',
    'packaging_sizes','packed_coffee','packing_records','customers',
    'sales_agents','request_orders','request_order_items','sales_orders',
    'stock_takes','stock_take_items',
    'green_coffee_lots','packed_coffee_lots','production_lots'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS full_access ON public.%I', t);
    EXECUTE format('CREATE POLICY full_access ON public.%I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ============================================================================
-- SIGNUP TRIGGER (fixed 2026-07-05 to match the real profiles columns;
-- the old version inserted into a non-existent "username" column and broke
-- every signup)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role, created_at)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    'Roaster',
    NOW()
  );
  RETURN new;
EXCEPTION WHEN others THEN
  RAISE WARNING 'Error in handle_new_user: %', SQLERRM;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
