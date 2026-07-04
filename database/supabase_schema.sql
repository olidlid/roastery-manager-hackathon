-- SCHEMA INITIALIZATION FOR SUPABASE (POSTGRESQL) - ROASTERY MANAGER V2
-- Copy and paste this script into the Supabase SQL Editor and run it.

-- Drop existing tables if they exist (clean setup)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP TABLE IF EXISTS public.handover_logs CASCADE;
DROP TABLE IF EXISTS public.request_order_items CASCADE;
DROP TABLE IF EXISTS public.request_orders CASCADE;
DROP TABLE IF EXISTS public.packed_coffee CASCADE;
DROP TABLE IF EXISTS public.waste_inventory CASCADE;
DROP TABLE IF EXISTS public.roast_batches CASCADE;
DROP TABLE IF EXISTS public.roasting_plans CASCADE;
DROP TABLE IF EXISTS public.machines CASCADE;
DROP TABLE IF EXISTS public.blend_ingredients CASCADE;
DROP TABLE IF EXISTS public.blend_recipes CASCADE;
DROP TABLE IF EXISTS public.green_coffee CASCADE;
DROP TABLE IF EXISTS public.company_settings CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- 1. User Profiles linked to Supabase Auth
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'Roaster' CHECK (role IN ('Leader', 'Roaster', 'Packing', 'Sales', 'Developer')),
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Company & Global Settings Table
CREATE TABLE public.company_settings (
    id SERIAL PRIMARY KEY,
    company_name TEXT NOT NULL DEFAULT 'Roastery Premium Corp',
    address TEXT,
    phone TEXT,
    email TEXT,
    logo_base64 TEXT, -- Stores base64 logo for portability
    handover_title TEXT NOT NULL DEFAULT 'GOODS HANDOVER SLIP',
    show_logo_in_print BOOLEAN NOT NULL DEFAULT TRUE,
    print_footer_text TEXT NOT NULL DEFAULT 'All goods transferred are the responsibility of the sales team.',
    currency TEXT NOT NULL DEFAULT 'USD',
    weight_unit TEXT NOT NULL DEFAULT 'kg' CHECK (weight_unit IN ('kg', 'lbs', 'g')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default company settings row
INSERT INTO public.company_settings (id, company_name) VALUES (1, 'Roastery Premium Corp');

-- 3. Greenbean Inventory
CREATE TABLE public.green_coffee (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    origin TEXT,
    process TEXT,
    stock_kg NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
    purchase_price_per_kg NUMERIC(12,2),
    supplier TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Blend Recipes
CREATE TABLE public.blend_recipes (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    machine_id INTEGER, -- Preferred machine for target default
    batch_size_g INTEGER NOT NULL DEFAULT 5000, -- Batch size in grams
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Blend Ingredients (Many-to-Many Greenbean -> Blend Recipes)
CREATE TABLE public.blend_ingredients (
    id SERIAL PRIMARY KEY,
    blend_recipe_id INTEGER NOT NULL REFERENCES public.blend_recipes(id) ON DELETE CASCADE,
    green_coffee_id INTEGER NOT NULL REFERENCES public.green_coffee(id) ON DELETE CASCADE,
    percentage NUMERIC(5,2) NOT NULL CHECK (percentage >= 0.00 AND percentage <= 100.00),
    quantity_g NUMERIC(10,2) NOT NULL DEFAULT 0.00 -- Ingredient weight in grams per batch
);

-- 6. Roasting Machines
CREATE TABLE public.machines (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    ideal_batch_size_g INTEGER NOT NULL DEFAULT 5000, -- Ideal capacity in grams
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed initial machines
INSERT INTO public.machines (code, name, ideal_batch_size_g) VALUES 
('M1', 'Probat 5kg (Machine #1)', 5000),
('M2', 'Giesen W6 6kg (Machine #2)', 6000),
('M3', 'Bullet R1 1kg (Sample Machine)', 1000);

-- Link blend_recipes machine foreign key if needed
ALTER TABLE public.blend_recipes ADD CONSTRAINT fk_recipe_machine FOREIGN KEY (machine_id) REFERENCES public.machines(id) ON DELETE SET NULL;

-- 7. Roasting Plans
CREATE TABLE public.roasting_plans (
    id SERIAL PRIMARY KEY,
    day TEXT NOT NULL,
    plan_date DATE NOT NULL,
    coffee_type TEXT NOT NULL CHECK (coffee_type IN ('Single', 'Blend')),
    single_coffee_id INTEGER REFERENCES public.green_coffee(id) ON DELETE SET NULL,
    blend_recipe_id INTEGER REFERENCES public.blend_recipes(id) ON DELETE SET NULL,
    target_roasted_kg NUMERIC(10,2) NOT NULL,
    fulfilled_roasted_kg NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Completed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Roast Batches
CREATE TABLE public.roast_batches (
    id SERIAL PRIMARY KEY,
    batch_code TEXT UNIQUE NOT NULL,
    roast_date DATE NOT NULL DEFAULT CURRENT_DATE,
    roast_type TEXT NOT NULL DEFAULT 'Regular' CHECK (roast_type IN ('Regular', 'Test', 'Custom')),
    qc_status TEXT NOT NULL DEFAULT 'Success' CHECK (qc_status IN ('Success', 'Failed', 'Pending')),
    coffee_type TEXT CHECK (coffee_type IN ('Single', 'Blend')),
    single_coffee_id INTEGER REFERENCES public.green_coffee(id) ON DELETE SET NULL,
    blend_recipe_id INTEGER REFERENCES public.blend_recipes(id) ON DELETE SET NULL,
    machine_id INTEGER REFERENCES public.machines(id) ON DELETE SET NULL,
    roasting_plan_id INTEGER REFERENCES public.roasting_plans(id) ON DELETE SET NULL,
    input_weight_kg NUMERIC(10,2),
    output_weight_kg NUMERIC(10,2),
    yield_percentage NUMERIC(5,2),
    remaining_bulk_kg NUMERIC(10,2), -- Unpacked bulk roasted coffee
    roaster_operator TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Waste Inventory (For failed test batches)
CREATE TABLE public.waste_inventory (
    id SERIAL PRIMARY KEY,
    roast_batch_id INTEGER NOT NULL REFERENCES public.roast_batches(id) ON DELETE CASCADE,
    weight_kg NUMERIC(10,2) NOT NULL,
    discard_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Packed Coffee Inventory (Finished Goods)
CREATE TABLE public.packed_coffee (
    id SERIAL PRIMARY KEY,
    roast_batch_id INTEGER REFERENCES public.roast_batches(id) ON DELETE SET NULL,
    custom_coffee_name TEXT, -- Fallback for manual outside packing
    bag_size_g INTEGER NOT NULL, -- e.g. 250, 500, 1000
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    selling_price NUMERIC(12,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. Request Orders (from Sales)
CREATE TABLE public.request_orders (
    id SERIAL PRIMARY KEY,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    sales_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending Approval' CHECK (status IN ('Pending Approval', 'Approved', 'Completed', 'Cancelled')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. Request Order Items (Items ordered by Sales)
CREATE TABLE public.request_order_items (
    id SERIAL PRIMARY KEY,
    request_order_id INTEGER NOT NULL REFERENCES public.request_orders(id) ON DELETE CASCADE,
    coffee_type TEXT NOT NULL CHECK (coffee_type IN ('Single', 'Blend')),
    single_coffee_id INTEGER REFERENCES public.green_coffee(id) ON DELETE SET NULL,
    blend_recipe_id INTEGER REFERENCES public.blend_recipes(id) ON DELETE SET NULL,
    bag_size_g INTEGER NOT NULL,
    quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
    quantity_allocated INTEGER NOT NULL DEFAULT 0, -- Allocated from packed stock
    quantity_pending INTEGER NOT NULL DEFAULT 0 -- Backordered quantity
);

-- 13. Handover Logs (Tracks physical pickup of packed stock)
CREATE TABLE public.handover_logs (
    id SERIAL PRIMARY KEY,
    handover_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    request_order_id INTEGER NOT NULL REFERENCES public.request_orders(id) ON DELETE CASCADE,
    packed_coffee_id INTEGER NOT NULL REFERENCES public.packed_coffee(id) ON DELETE CASCADE,
    quantity_transferred INTEGER NOT NULL CHECK (quantity_transferred > 0),
    sales_recipient TEXT NOT NULL,
    production_dispatcher TEXT NOT NULL,
    leader_approver TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -------------------------------------------------------------
-- AUTOMATION TRIGGER FOR USER SIGNUPS
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, name, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'user_name', new.email),
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    'Roaster'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Seed initial greenbeans to have demo data
INSERT INTO public.green_coffee (code, name, origin, process, stock_kg, purchase_price_per_kg, supplier) VALUES 
('GB1', 'Aceh Gayo Arabica', 'Aceh, Indonesia', 'Wet Hulled', 250.0, 8.50, 'Gayo Estate'),
('GB2', 'Sidikalang Robusta', 'Dairi, Indonesia', 'Full Wash', 180.0, 5.00, 'Sidikalang Coop'),
('GB3', 'Toraja Arabica', 'Sulawesi, Indonesia', 'Natural', 100.0, 10.00, 'Toraja Highlands');
