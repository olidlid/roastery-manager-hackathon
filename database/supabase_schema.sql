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
    slogan TEXT DEFAULT '',                     -- added 2026-07-06 (shown under company name in sidebar)
    label_layout JSONB DEFAULT '{"roasting":{"coffee_name":true,"machine":true,"coffee_code":true},"packed":{"code":true,"coffee_name":true,"dates":true,"machine":true}}'::jsonb,
                                                 -- added 2026-07-13: which text fields print alongside each
                                                 -- sticker's barcode (roasting log / packed coffee, both now
                                                 -- 50x25mm — see printStickerLabel/printLotBarcodeLabels).
                                                 -- Replaces the old label_show_* + label_width/label_height
                                                 -- columns above, which are no longer read by the app but were
                                                 -- left in place rather than dropped.
    label_rotate_90 BOOLEAN DEFAULT FALSE        -- LEGACY (added 2026-07-18, retired 2026-07-30, briefly
                                                 -- revived 2026-08-10, retired again same day): was a
                                                 -- Settings-facing toggle for a printer-driver rotation
                                                 -- workaround. Nothing reads/writes this column anymore —
                                                 -- js/packing.js and js/roasting.js now hardcode `rotate`
                                                 -- to match the printer's physical mounting instead, since
                                                 -- @page size and Chrome's Layout dropdown are mutually
                                                 -- exclusive either way. Left in place rather than dropped.
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    moisture_content NUMERIC,           -- V2 1E, nullable, shown on Tracking
    water_activity NUMERIC,             -- V2 1E, nullable, shown on Tracking
    density NUMERIC                     -- V2 1E, nullable, shown on Tracking
    -- stock_kg above is now a TRIGGER-MAINTAINED DERIVED value (V2 1·CHAIN):
    -- kept in sync from SUM(green_coffee_lots.remaining_kg) by
    -- sync_green_coffee_stock() (see database/v2_lot_tracking_migration.sql).
    -- No code needs to change to READ stock_kg; app code should stop WRITING
    -- it directly once 1A/1B ship (they write green_coffee_lots instead).
);

-- 4b. Code Definitions — added 2026-07-21. Maps a green_coffee.code value to a
-- stable Sales-facing trade name (e.g. code 2 = "Fantastica"), since one code
-- can be reused across multiple green_coffee rows over time as the actual
-- physical origin behind a trade name changes. No FK to green_coffee.code
-- (that column isn't unique/FK'd anywhere else — loose text match by design,
-- same convention as resolvePackedGreenCoffeeId in js/packing.js). See
-- database/v2_code_definitions_migration.sql.
CREATE TABLE IF NOT EXISTS public.code_definitions (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
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
    supplier TEXT,
    green_coffee_lot_id INTEGER REFERENCES public.green_coffee_lots(id) ON DELETE SET NULL  -- V2 1A: links back to the lot this intake created, so editing/deleting the intake can keep the lot's quantity_kg/remaining_kg in sync
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
    batch_size_g NUMERIC,
    is_post_blend BOOLEAN DEFAULT FALSE  -- V2 1I-b: Recipe tab's pre-blend/post-blend sub-tab flag
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
    request_order_item_id INTEGER,
    parent_plan_id INTEGER REFERENCES public.roasting_plans(id) ON DELETE CASCADE,  -- V2 1I-b: sub-plan → parent post-blend plan
    is_post_blend_component BOOLEAN DEFAULT FALSE                                    -- V2 1I-b: marks an exploded single-origin sub-plan
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
    input_weight_kg NUMERIC(10,3),              -- 1-gram precision; was undocumented NUMERIC(10,2) in production (silently rounded to nearest 10g) — see roast_batch_weight_precision_migration.sql
    output_weight_kg NUMERIC(10,3),              -- same fix as input_weight_kg above
    yield_percentage NUMERIC,
    roast_type TEXT DEFAULT 'Regular',
    qc_status TEXT DEFAULT 'Success',
    remaining_bulk_kg NUMERIC,
    roaster_operator TEXT,
    roast_degree NUMERIC  -- V2 1F: Agtron value, auto pre-filled from the last batch of the same coffee+machine, editable, shown on Tracking
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
    bulk_available NUMERIC DEFAULT 0,
    is_post_blend BOOLEAN DEFAULT FALSE,  -- V2 1I: true for both custom (1I-a) and recipe-assembled (1I-b) post-blends
    custom_blend_name TEXT,               -- V2 1I-a: user-typed name for a custom post-blend
    custom_blend_code TEXT,               -- V2 1I-a/1I-b: date-based identity code for a post-blend
    source_plan_id INTEGER REFERENCES public.roasting_plans(id) ON DELETE SET NULL,  -- V2 1I-b: links a recipe-assembled post-blend back to its parent roasting_plans row, so composition is derived from that parent's sub-plans (parent_plan_id) instead of a components table
    custom_coffee_code TEXT,              -- V2 Custom Blend: the registered Code Definitions code the blend sells as (distinct from custom_blend_code, which is the auto-generated date-based bulk/lot code). Picked from registered codes since 2026-09-29; older rows may hold a free-typed value
    custom_coffee_type TEXT,              -- V2 Custom Blend (2026-09-29): 'Single' | 'Blend' — the sales type of custom_coffee_code (a code can belong to both, e.g. 23). See v2_custom_blend_unregistered_migration.sql
    production_date DATE NOT NULL DEFAULT CURRENT_DATE,  -- V2: re-keys bulk pooling by (coffee, machine, roast day) instead of pooling indefinitely — see bulk_production_date_migration.sql
    is_return BOOLEAN DEFAULT FALSE,       -- Item Return (2026-10-04): bulk card made from returned coffee — see stock_returns_migration.sql
    is_repack BOOLEAN DEFAULT FALSE,       -- V2 Repack (applied to production 2026-08-03): true for a bulk row created by opening finished packed stock back into loose bulk for re-packing (never renames the coffee — see repack_sources below). See database/repack_migration.sql.
    -- Phase 6 (STOCK_LEDGER_PLAN.md, applied to production 2026-08-22):
    -- movement-context columns, single-use — see log_bulk_stock_movement()
    -- below. Each row here is already one "lot" (coffee+machine+production_
    -- date, or one post-blend/custom-blend/repack batch), so bulk_available
    -- is the atomically-written, ledger-logged value directly, not a
    -- derived sum the way packed_coffee.quantity is.
    mv_operation TEXT,
    mv_ref_table TEXT,
    mv_ref_id    INTEGER,
    mv_reason    TEXT,
    mv_user      TEXT
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
    roast_batch_id INTEGER,
    bulk_roasted_coffee_id INTEGER REFERENCES public.bulk_roasted_coffee(id) ON DELETE SET NULL,  -- V2 Close Lot: bulk lot this loss came from — see waste_inventory_bulk_link_migration.sql
    return_item_id INTEGER        -- Item Return: returned item this waste came from (source_type 'Return'); FK added in stock_returns_migration.sql
);

-- 13. Packaging sizes (250g / 500g / 1kg ...)
CREATE TABLE IF NOT EXISTS public.packaging_sizes (
    id SERIAL PRIMARY KEY,
    label TEXT,
    weight_g NUMERIC,                           -- legacy (app uses gram)
    min_stock INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    gram NUMERIC DEFAULT 250,
    is_visible BOOLEAN DEFAULT TRUE,
    carton_multiplier NUMERIC,                  -- V2 1G: pcs per carton for this size; NULL = no carton label option configured
    size_digit SMALLINT                         -- V2 FIFO strip code: single digit prefixing strip_code/barcode (Settings > Production > Packaging Sizes); NULL = size not yet wired into the feature
);

CREATE UNIQUE INDEX IF NOT EXISTS packaging_sizes_size_digit_uniq
ON public.packaging_sizes (size_digit)
WHERE size_digit IS NOT NULL;

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
    selling_price NUMERIC,
    -- Custom-blend packed stock only: the registered sales code it sells as
    -- and its type (see database/v2_custom_blend_unregistered_migration.sql,
    -- 2026-09-29). NULL for every other packed row.
    coffee_code TEXT,
    coffee_code_type TEXT   -- 'Single' | 'Blend'
);

-- Prevents two concurrent packing submits for the same coffee+size+machine
-- from creating duplicate packed_coffee rows (see
-- packed_coffee_dedup_migration.sql, applied 2026-07-28).
CREATE UNIQUE INDEX IF NOT EXISTS packed_coffee_custom_identity_uniq
ON public.packed_coffee (lower(custom_coffee_name), bag_size_g, machine_id)
WHERE roast_batch_id IS NULL;

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
    bag_size_g INTEGER,
    packed_coffee_lot_id INTEGER REFERENCES public.packed_coffee_lots(id) ON DELETE SET NULL  -- V2: links this log entry back to the packed_coffee_lots row it created/added to, so a correction flow can find/adjust it even after the lot is fully depleted
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- CRM_PAGE_PLAN.md §4 (2026-09-26): kepemilikan sales + jejak pembuatan.
    -- Kepemilikan TIDAK membatasi akses — pagarnya tetap kategori customer
    -- (CUSTOMER_CATEGORY_ROLE_PLAN.md); ini murni pengelompokan & manajemen.
    owner_sales_id UUID,                        -- profiles.id
    owner_sales_name TEXT,                      -- snapshot nama, pola decided_by_name
    owner_since TIMESTAMPTZ,
    created_by_id UUID,                         -- siapa yang membuka customer ini
    created_by_name TEXT,
    deactivated_at TIMESTAMPTZ                  -- is_active tidak punya tanggal; ini yang mencatatnya
);

-- 16b. Sejarah kepemilikan customer (CRM_JOURNEY_DATA.md §3.2) — HANYA DITAMBAH.
-- Tanpa tabel ini, memindah kepemilikan ikut mengubah atribusi bulan-bulan
-- sebelumnya dan sales lama kehilangan pencapaiannya, tanpa cara memulihkan.
CREATE TABLE IF NOT EXISTS public.customer_owner_history (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    from_sales_id UUID,
    from_sales_name TEXT,
    to_sales_id UUID,
    to_sales_name TEXT,
    changed_by_id UUID,
    changed_by_name TEXT,
    changed_at TIMESTAMPTZ DEFAULT NOW(),
    note TEXT
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
-- Nomor order WAJIB unik (indeks unik ditambahkan 2026-09-12). Sebelum itu,
-- pemindai urutan di js/sales.js memakai regex ^[A-Z0-9]+ sehingga awalan agen
-- berhuruf Arab tidak pernah terbaca dan urutannya mengulang: order id 80 dan 81
-- sama-sama bernomor 'ما080926007' pada 2026-09-08, membuat
-- roasting_plans.order_ref tidak bisa dipastikan miliknya yang mana.
CREATE TABLE IF NOT EXISTS public.request_orders (
    id SERIAL PRIMARY KEY,
    order_number TEXT,
    customer_name TEXT,                         -- legacy (app uses customer_id)
    order_date DATE,
    status TEXT DEFAULT 'Pending',               -- 'Pending Approval' | 'Preparing' | 'Dispatched' | 'Unable to Fulfill' (2026-09-08) | 'Cancelled' (hanya dihasilkan aplikasi Leader Android)
    items JSONB DEFAULT '[]'::jsonb,            -- legacy (app uses request_order_items table)
    notes TEXT,
    dispatch_date DATE,
    dispatched_by TEXT,
    approved_by TEXT,
    approved_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    customer_id INTEGER,
    sales_name TEXT,
    -- APPROVAL_REVISION_PLAN.md Fase 0 (2026-09-08): siapa yang memutuskan, kapan,
    -- dan alasannya. approved_by/approved_date SENGAJA tidak dipakai ulang - keduanya
    -- kolom mati (0 dari 51 baris terisi, tidak ada kode yang pernah menulisnya), dan
    -- nama "approved_by" yang berisi orang yang MENOLAK akan menyesatkan pembaca.
    -- Penamaan ini juga menyamakan modul ini dengan purchase_requests.
    decided_by_id UUID,
    decided_by_name TEXT,
    decided_at TIMESTAMPTZ,
    decision_note TEXT,                          -- alasan OPSIONAL; dipakai untuk pemenuhan sebagian MAUPUN Unable to Fulfill
    order_type TEXT                              -- snapshot of customers.type at order creation time, never re-derived (see CUSTOMER_CATEGORY_ROLE_PLAN.md §3.2); NULL for 9 pre-migration orders whose customer_id no longer resolves
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
    quantity_prepared INTEGER DEFAULT 0,        -- added 2026-07-06 (packing progress at Order Requests stage; distinct from quantity_allocated, which is set at Dispatch Approval time)
    quantity_unfulfilled INTEGER DEFAULT 0,     -- APPROVAL_REVISION_PLAN.md Fase 0 (2026-09-08): jumlah yang SENGAJA
                                                 -- tidak diproses saat approval. Disimpan, bukan dihitung dari
                                                 -- quantity_requested - allocated - pending: ketiga angka itu terus
                                                 -- berubah selama packing, sehingga selisihnya lama-lama tidak lagi
                                                 -- berarti "sengaja tidak dipenuhi".
    coffee_code TEXT                            -- added 2026-07-21: set (with single_coffee_id left NULL) when this
                                                 -- item is a trade-name product from code_definitions rather than
                                                 -- one specific green_coffee row — fulfillment can draw from any
                                                 -- green_coffee sharing this code (see code_definitions table below)
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Stock Opname Phase 0 (STOCK_OPNAME_PLAN.md, applied to production
    -- 2026-08-23): lifecycle columns. DEFAULT 'posted' is deliberate — every
    -- pre-migration row already finished via the old direct-adjust path, so
    -- it must never look like an in-progress take once Phase 2's freeze
    -- trigger reads this column. Valid values: 'counting' | 'posting' |
    -- 'posted' | 'cancelled' (validated app-side, not a CHECK constraint,
    -- so new values don't need another migration).
    status TEXT NOT NULL DEFAULT 'posted',
    started_at    TIMESTAMPTZ,
    started_by    TEXT,
    posted_at     TIMESTAMPTZ,
    counted_items INTEGER DEFAULT 0,
    skipped_items INTEGER DEFAULT 0,
    -- Added 2026-08-31: separates the opname PROCESS by inventory category
    -- (user request — previously one "New Stock Take" always counted green
    -- bean + bulk + packed together in one sheet, forcing all three to be
    -- done in the same sitting). Valid values: 'greenbean' | 'bulk' |
    -- 'packed'. NULL on every row created before this migration — those
    -- legacy takes really did cover all three categories at once, so the
    -- History table shows them as "All" rather than guessing one category.
    -- stock_takes_one_active_uniq below is intentionally UNCHANGED: still
    -- only one active take at a time regardless of category (explicit user
    -- decision — "di waktu yang berbeda", not concurrent), so no freeze-
    -- trigger or uniqueness changes were needed for this feature.
    category TEXT
);

-- At most one active (status IN ('counting','posting')) stock take at a
-- time — a unique index on the constant (1) with a partial predicate is the
-- standard way to enforce "at most one row matches this condition" in
-- Postgres. Without it, two people could open a stock take simultaneously
-- and clobber each other (STOCK_OPNAME_PLAN.md Phase 0). Verified live
-- 2026-08-23: a second 'counting' row is rejected with
-- "duplicate key value violates unique constraint", and a fresh row can be
-- created again immediately after the first is cancelled.
CREATE UNIQUE INDEX IF NOT EXISTS stock_takes_one_active_uniq
ON public.stock_takes ((1))
WHERE status IN ('counting', 'posting');

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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Stock Opname Phase 0 (applied to production 2026-08-23): staged-save
    -- + lot traceability for the paper-count workflow.
    -- counted distinguishes "counted, matched system" from "never touched" —
    -- both used to collapse into variance = 0 when finalize rewrote a blank
    -- input as system_qty (js/app.js:3681, STOCK_OPNAME_PLAN.md cacat #1).
    counted       BOOLEAN NOT NULL DEFAULT FALSE,
    counted_at    TIMESTAMPTZ,
    counted_by    TEXT,
    -- posted_at makes posting safely retryable: a row whose adjustment
    -- already landed is skipped if posting is retried after a mid-way
    -- failure (STOCK_OPNAME_PLAN.md §5.2) — without this, a retry would
    -- double-write the adjustment.
    posted_at     TIMESTAMPTZ,
    is_found_item BOOLEAN NOT NULL DEFAULT FALSE,
    -- Points from a Stage 2 (packed coffee) per-lot row back to its Stage 1
    -- group row; group rows themselves have parent_item_id IS NULL.
    -- Deliberately NOT a self-referencing foreign key (same reasoning as
    -- packed_stock_movements.packed_coffee_lot_id) so deleting a row never
    -- cascades.
    parent_item_id INTEGER,
    -- ref_table + ref_id point at the source row: 'packed_coffee_lots' for
    -- a Stage 2 lot row, 'green_coffee', or 'bulk_roasted_coffee'.
    ref_table     TEXT,
    ref_id        INTEGER,
    -- Snapshots, not lookups — an old count sheet must stay readable even
    -- after the source lot/code is long gone, same pattern
    -- packed_stock_movements uses for coffee_name/lot_code/etc.
    coffee_code   TEXT,
    strip_code    TEXT,
    lot_code      TEXT,
    machine_name  TEXT,
    bag_size_g    NUMERIC
);

CREATE INDEX IF NOT EXISTS stock_take_items_parent_idx
ON public.stock_take_items (parent_item_id);

-- 23. Green bean lots (shadow schema for V2 lot tracking)
CREATE TABLE IF NOT EXISTS public.green_coffee_lots (
    id SERIAL PRIMARY KEY,
    green_coffee_id INTEGER REFERENCES public.green_coffee(id) ON DELETE CASCADE,
    lot_code TEXT NOT NULL UNIQUE,
    quantity_kg NUMERIC NOT NULL DEFAULT 0,
    remaining_kg NUMERIC NOT NULL DEFAULT 0,
    supplier TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    arrival_date DATE DEFAULT CURRENT_DATE,
    purchase_price_per_kg NUMERIC  -- V2 1·CHAIN: per-lot price, data captured for future costing (1C, not built yet)
);

-- V2 Stock History ledger (applied to production 2026-08-19): per-lot
-- record of a manual stock DECREASE (Adjust Green Coffee Stock modal calls
-- consumeGreenCoffeeLotsFifo but previously never persisted which lot(s) it
-- drew from). Mirrors roast_batch_green_lots' per-lot-draw shape. See
-- database/v2_greenbean_ledger_migration.sql.
CREATE TABLE IF NOT EXISTS public.green_coffee_lot_adjustments (
    id SERIAL PRIMARY KEY,
    green_coffee_id INTEGER REFERENCES public.green_coffee(id) ON DELETE CASCADE,
    green_coffee_lot_id INTEGER REFERENCES public.green_coffee_lots(id) ON DELETE SET NULL,
    kg NUMERIC NOT NULL DEFAULT 0,
    adjustment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    adjusted_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Added 2026-08-30: tags which caller wrote this decrease, so the Stock
    -- History ledger (js/greenbean.js renderStockHistoryTab) can show a
    -- "Stock Opname" tag on rows the stock take posted, distinct from a
    -- plain manual edit (which leaves both columns NULL). Same ref_table/
    -- ref_id shape as bulk_stock_movements/packed_stock_movements.
    ref_table TEXT,
    ref_id INTEGER
);

-- V2 Stock History ledger: per-lot record of which green_coffee_lots an
-- Outbound Shipment drew from (FIFO) — Outbound previously wrote
-- green_coffee.stock_kg directly instead of going through the lots, unlike
-- every other consumption path in the app. green_coffee_outbound stays the
-- shipment header; this is its per-lot-draw child. See
-- database/v2_greenbean_ledger_migration.sql.
CREATE TABLE IF NOT EXISTS public.green_coffee_outbound_lots (
    id SERIAL PRIMARY KEY,
    green_coffee_outbound_id INTEGER REFERENCES public.green_coffee_outbound(id) ON DELETE CASCADE,
    green_coffee_lot_id INTEGER REFERENCES public.green_coffee_lots(id) ON DELETE SET NULL,
    kg NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- V2 FIFO strip code (see database/fifo_strip_code_migration.sql +
-- fifo_batch_no_cycle_adjustment.sql): shared by production_lots.batch_no
-- and packed_coffee_lots.batch_no (the latter only for lots with no
-- production_lot_id, i.e. manual/custom packing). Cycles at 9999 per
-- explicit user request — the client wants the number to wrap rather than
-- grow unbounded. Because production_lots is a permanent history table
-- (never deleted), batch_no is NOT unique on that table once the sequence
-- wraps; the constraint that actually matters is
-- packed_coffee_lots_strip_code_live_uniq below, scoped to lots that still
-- have stock.
CREATE SEQUENCE IF NOT EXISTS public.fifo_batch_no_seq MAXVALUE 9999 CYCLE;

-- 24. Packed coffee lots (shadow schema for V2 packed lot tracking)
CREATE TABLE IF NOT EXISTS public.packed_coffee_lots (
    id SERIAL PRIMARY KEY,
    packed_coffee_id INTEGER REFERENCES public.packed_coffee(id) ON DELETE CASCADE,
    roast_batch_id INTEGER REFERENCES public.roast_batches(id) ON DELETE SET NULL,
    lot_code TEXT NOT NULL,  -- UNIQUE dropped 2026-09-20 (see database/drop_packed_coffee_lots_lot_code_unique.sql):
                             -- lot_code's trailing number is now "total roast_batches for this
                             -- coffee+machine+day", a fixed count rather than a per-lot sequence,
                             -- so every packaging size packed from the same roast day legitimately
                             -- shares the same lot_code text — per explicit user request, since
                             -- strip_code (still unique among live stock) is what actually
                             -- distinguishes sizes.
    quantity_pcs INTEGER NOT NULL DEFAULT 0,
    remaining_pcs INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    packed_date DATE DEFAULT CURRENT_DATE,
    production_lot_id INTEGER REFERENCES public.production_lots(id) ON DELETE SET NULL,  -- V2 1·CHAIN: which production lot this was packed from (populated starting 1G-1)
    batch_no INTEGER DEFAULT nextval('public.fifo_batch_no_seq'), -- V2 FIFO strip code: copied
                                                 -- from production_lots.batch_no when linked
                                                 -- (getOrCreatePackedCoffeeLot passes it explicitly),
                                                 -- else this DEFAULT assigns a fresh one for
                                                 -- manual/unlinked lots. Fixed 2026-08-11: this DEFAULT
                                                 -- was missing from production since the column was
                                                 -- first added (this file's comment always claimed it
                                                 -- existed, but information_schema showed NULL) — every
                                                 -- manual "Add Manual Packed Stock" entry got batch_no
                                                 -- AND strip_code stuck at NULL ("no code" in Stock by
                                                 -- Lot) until this was caught and added via
                                                 -- fix_packed_coffee_lots_batch_no_default migration.
    strip_code TEXT                              -- V2 FIFO strip code: size_digit || lpad(batch_no, 4, '0'), e.g. "10021"
);

-- Guards against the exact race found+fixed in production 2026-07-28: two
-- concurrent Pack submissions for the same (packed_coffee, production_lot)
-- both finding no existing row and both inserting one. getOrCreatePackedCoffeeLot
-- already treats this pair as the merge key, so the app never intends more
-- than one row per pairing regardless of remaining stock.
CREATE UNIQUE INDEX IF NOT EXISTS packed_coffee_lots_packed_production_uniq
ON public.packed_coffee_lots (packed_coffee_id, production_lot_id)
WHERE production_lot_id IS NOT NULL;

-- Guarantees a strip_code search always resolves to exactly one rack among
-- CURRENT stock — not forever, since batch_no cycles (see fifo_batch_no_seq
-- above). A collision with an old, already-sold-through lot is the accepted
-- tradeoff of cycling; this only blocks a collision with something still on
-- the shelf.
CREATE UNIQUE INDEX IF NOT EXISTS packed_coffee_lots_strip_code_live_uniq
ON public.packed_coffee_lots (strip_code)
WHERE remaining_pcs > 0 AND strip_code IS NOT NULL;

-- packed_coffee.quantity becomes a DERIVED value (applied to production
-- 2026-08-19), mirroring green_coffee.stock_kg (section 12/22 above) — that
-- migration's own comment flagged this as "planned for 1G-1" but it was
-- never implemented, and quantity drifted from packed_coffee_lots'
-- remaining_pcs sum on ~9 separate write paths across js/packing.js
-- (checkout, pack bulk, repack, close lot, waste, stock release, ...),
-- some under by a few pcs, some over by 100+ (the table showing stock that
-- didn't physically exist). See
-- database/v2_packed_coffee_quantity_derived_migration.sql for the backfill.
CREATE OR REPLACE FUNCTION public.sync_packed_coffee_quantity() RETURNS TRIGGER AS $$
DECLARE
    target_id INTEGER;
BEGIN
    target_id := COALESCE(NEW.packed_coffee_id, OLD.packed_coffee_id);
    IF target_id IS NOT NULL THEN
        UPDATE public.packed_coffee
        SET quantity = (
            SELECT COALESCE(SUM(remaining_pcs), 0)
            FROM public.packed_coffee_lots
            WHERE packed_coffee_id = target_id
        )
        WHERE id = target_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- UPDATE OF list includes packed_coffee_id (fixed 2026-08-22, see
-- v2_packed_stock_movements_migration.sql) — the original list only covered
-- remaining_pcs, so reassigning a lot to a different parent (e.g. the
-- 2026-08-22 duplicate-row merge) never fired this trigger at all; 23 rows
-- went silently stale and had to be backfilled by hand.
DROP TRIGGER IF EXISTS trg_sync_packed_coffee_quantity ON public.packed_coffee_lots;
CREATE TRIGGER trg_sync_packed_coffee_quantity
AFTER INSERT OR UPDATE OF remaining_pcs, packed_coffee_id OR DELETE ON public.packed_coffee_lots
FOR EACH ROW EXECUTE FUNCTION sync_packed_coffee_quantity();

-- ============================================================================
-- PACKED STOCK MOVEMENT LEDGER (STOCK_LEDGER_PLAN.md Phase 2, applied to
-- production 2026-08-22)
-- ----------------------------------------------------------------------------
-- Every change to packed_coffee_lots.remaining_pcs is logged automatically —
-- not by application code remembering to call a logging function, because
-- that discipline already failed twice in this codebase before a trigger
-- fixed it (green_coffee.stock_kg, then packed_coffee.quantity itself).
-- Hard invariant checkable with one query from here on:
--   SUM(delta_pcs) per lot  ==  packed_coffee_lots.remaining_pcs
-- See database/v2_packed_stock_movements_migration.sql for the full
-- migration, backfill, and reasoning (including why this trigger is BEFORE
-- not AFTER, and why packed_coffee_lot_id has no FK).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.packed_stock_movements (
    id BIGSERIAL PRIMARY KEY,
    packed_coffee_lot_id INTEGER,   -- INTENTIONALLY no FK — see migration file
    packed_coffee_id INTEGER,
    lot_code TEXT,
    strip_code TEXT,
    coffee_name TEXT,
    machine_id INTEGER,
    bag_size_g INTEGER,
    delta_pcs INTEGER NOT NULL,
    balance_after INTEGER,
    operation TEXT,
    ref_table TEXT,
    ref_id INTEGER,
    reason TEXT,
    performed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS psm_lot_idx ON public.packed_stock_movements (packed_coffee_lot_id, id);
CREATE INDEX IF NOT EXISTS psm_created_idx ON public.packed_stock_movements (created_at);
CREATE INDEX IF NOT EXISTS psm_ref_idx ON public.packed_stock_movements (ref_table, ref_id);

ALTER TABLE public.packed_coffee_lots
    ADD COLUMN IF NOT EXISTS mv_operation TEXT,
    ADD COLUMN IF NOT EXISTS mv_ref_table TEXT,
    ADD COLUMN IF NOT EXISTS mv_ref_id    INTEGER,
    ADD COLUMN IF NOT EXISTS mv_reason    TEXT,
    ADD COLUMN IF NOT EXISTS mv_user      TEXT;

CREATE OR REPLACE FUNCTION public.log_packed_stock_movement() RETURNS TRIGGER AS $$
DECLARE
    v_parent public.packed_coffee%ROWTYPE;
    v_delta  INTEGER;
    v_op     TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT * INTO v_parent FROM public.packed_coffee WHERE id = OLD.packed_coffee_id;
        IF COALESCE(OLD.remaining_pcs, 0) <> 0 THEN
            INSERT INTO public.packed_stock_movements (
                packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
                coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
                operation, ref_table, ref_id, reason, performed_by)
            VALUES (OLD.id, OLD.packed_coffee_id, OLD.lot_code, OLD.strip_code,
                v_parent.custom_coffee_name, v_parent.machine_id, v_parent.bag_size_g,
                -OLD.remaining_pcs, 0,
                COALESCE(OLD.mv_operation, 'lot_deleted'), OLD.mv_ref_table, OLD.mv_ref_id,
                OLD.mv_reason, OLD.mv_user);
        END IF;
        RETURN OLD;
    END IF;

    SELECT * INTO v_parent FROM public.packed_coffee WHERE id = NEW.packed_coffee_id;

    IF TG_OP = 'INSERT' THEN
        v_delta := COALESCE(NEW.remaining_pcs, 0);
        v_op    := COALESCE(NEW.mv_operation, 'lot_created');
    ELSE
        v_delta := COALESCE(NEW.remaining_pcs, 0) - COALESCE(OLD.remaining_pcs, 0);
        v_op    := COALESCE(NEW.mv_operation, 'unspecified');

        IF NEW.packed_coffee_id IS DISTINCT FROM OLD.packed_coffee_id THEN
            INSERT INTO public.packed_stock_movements (
                packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
                coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
                operation, ref_table, ref_id, reason, performed_by)
            VALUES (OLD.id, OLD.packed_coffee_id, OLD.lot_code, OLD.strip_code,
                NULL, NULL, NULL,
                -COALESCE(OLD.remaining_pcs, 0), 0,
                'transfer_out', NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);
            INSERT INTO public.packed_stock_movements (
                packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
                coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
                operation, ref_table, ref_id, reason, performed_by)
            VALUES (NEW.id, NEW.packed_coffee_id, NEW.lot_code, NEW.strip_code,
                v_parent.custom_coffee_name, v_parent.machine_id, v_parent.bag_size_g,
                COALESCE(OLD.remaining_pcs, 0), COALESCE(OLD.remaining_pcs, 0),
                'transfer_in', NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);
        END IF;
    END IF;

    IF v_delta <> 0 THEN
        INSERT INTO public.packed_stock_movements (
            packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
            coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
            operation, ref_table, ref_id, reason, performed_by)
        VALUES (NEW.id, NEW.packed_coffee_id, NEW.lot_code, NEW.strip_code,
            v_parent.custom_coffee_name, v_parent.machine_id, v_parent.bag_size_g,
            v_delta, COALESCE(NEW.remaining_pcs, 0),
            v_op, NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);
    END IF;

    NEW.mv_operation := NULL;
    NEW.mv_ref_table := NULL;
    NEW.mv_ref_id    := NULL;
    NEW.mv_reason    := NULL;
    NEW.mv_user      := NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_packed_stock_movement ON public.packed_coffee_lots;
CREATE TRIGGER trg_log_packed_stock_movement
BEFORE INSERT OR UPDATE OF remaining_pcs, packed_coffee_id OR DELETE
ON public.packed_coffee_lots
FOR EACH ROW EXECUTE FUNCTION log_packed_stock_movement();

-- Phase 4 (F3, see STOCK_LEDGER_PLAN.md): packed_coffee_lots.packed_coffee_id
-- is ON DELETE CASCADE, so deleting a packed_coffee row used to silently
-- cascade-delete any of its lots even with live stock — reproduced live
-- 2026-08-22 (a 50-pc test lot vanished with no error, only recorded after
-- the fact as a 'lot_deleted' movement). This BEFORE trigger rejects the
-- delete outright instead of letting it happen and only logging it.
-- See database/v2_packed_coffee_delete_guard_migration.sql.
CREATE OR REPLACE FUNCTION public.prevent_packed_coffee_delete_with_stock()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.packed_coffee_lots
               WHERE packed_coffee_id = OLD.id AND COALESCE(remaining_pcs,0) > 0) THEN
        RAISE EXCEPTION
          'Cannot delete packed coffee %: lots still hold stock. Write it off or release it first.', OLD.id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_packed_coffee_delete ON public.packed_coffee;
CREATE TRIGGER trg_prevent_packed_coffee_delete
BEFORE DELETE ON public.packed_coffee
FOR EACH ROW EXECUTE FUNCTION prevent_packed_coffee_delete_with_stock();

-- ============================================================================
-- Phase 6 (STOCK_LEDGER_PLAN.md, applied to production 2026-08-22): the same
-- atomic-RPC + audit-ledger treatment packed_coffee_lots got in Phases 1-3,
-- for bulk_roasted_coffee. Built as ONE migration with the full 7-arg
-- signature from the start — the Phase 2->3 incident (CREATE OR REPLACE
-- with an extended argument list creates a second overload, not a true
-- replacement, breaking every existing 2-arg caller until the old signature
-- is explicitly DROPped) is avoided entirely by never having a narrower
-- signature to begin with.
-- See database/v2_bulk_stock_ledger_migration.sql.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.consume_bulk_lot(
    p_bulk_id INTEGER, p_kg NUMERIC,
    p_operation TEXT DEFAULT NULL, p_ref_table TEXT DEFAULT NULL,
    p_ref_id INTEGER DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
SET search_path = public
AS $$
    WITH before AS (
        SELECT bulk_available FROM public.bulk_roasted_coffee WHERE id = p_bulk_id FOR UPDATE
    ), updated AS (
        UPDATE public.bulk_roasted_coffee
        SET bulk_available = bulk_available - LEAST(bulk_available, GREATEST(p_kg, 0)),
            mv_operation = p_operation, mv_ref_table = p_ref_table,
            mv_ref_id = p_ref_id, mv_reason = p_reason, mv_user = p_user
        WHERE id = p_bulk_id
        RETURNING bulk_available
    )
    SELECT COALESCE((SELECT bulk_available FROM before), 0)
         - COALESCE((SELECT bulk_available FROM updated), 0);
$$;

CREATE OR REPLACE FUNCTION public.refund_bulk_lot(
    p_bulk_id INTEGER, p_kg NUMERIC,
    p_operation TEXT DEFAULT NULL, p_ref_table TEXT DEFAULT NULL,
    p_ref_id INTEGER DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE public.bulk_roasted_coffee
    SET bulk_available = bulk_available + GREATEST(p_kg, 0),
        mv_operation = p_operation, mv_ref_table = p_ref_table,
        mv_ref_id = p_ref_id, mv_reason = p_reason, mv_user = p_user
    WHERE id = p_bulk_id
    RETURNING bulk_available;
$$;

CREATE OR REPLACE FUNCTION public.set_bulk_lot_available(
    p_bulk_id INTEGER, p_kg NUMERIC,
    p_operation TEXT DEFAULT NULL, p_ref_table TEXT DEFAULT NULL,
    p_ref_id INTEGER DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE public.bulk_roasted_coffee
    SET bulk_available = GREATEST(0, p_kg),
        mv_operation = p_operation, mv_ref_table = p_ref_table,
        mv_ref_id = p_ref_id, mv_reason = p_reason, mv_user = p_user
    WHERE id = p_bulk_id
    RETURNING bulk_available;
$$;

GRANT EXECUTE ON FUNCTION public.consume_bulk_lot(INTEGER, NUMERIC, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_bulk_lot(INTEGER, NUMERIC, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_bulk_lot_available(INTEGER, NUMERIC, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.bulk_stock_movements (
    id BIGSERIAL PRIMARY KEY,
    bulk_roasted_coffee_id INTEGER,   -- INTENTIONALLY no FK, same reasoning as packed_stock_movements
    coffee_name TEXT,
    machine_id INTEGER,
    production_date DATE,
    delta_kg NUMERIC NOT NULL,        -- (+) in, (-) out
    balance_after NUMERIC,
    operation TEXT,
    ref_table TEXT,
    ref_id INTEGER,
    reason TEXT,
    performed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bsm_bulk_idx ON public.bulk_stock_movements (bulk_roasted_coffee_id, id);
CREATE INDEX IF NOT EXISTS bsm_created_idx ON public.bulk_stock_movements (created_at);
CREATE INDEX IF NOT EXISTS bsm_ref_idx ON public.bulk_stock_movements (ref_table, ref_id);

CREATE OR REPLACE FUNCTION public.log_bulk_stock_movement() RETURNS TRIGGER AS $$
DECLARE
    v_delta NUMERIC;
    v_op    TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF COALESCE(OLD.bulk_available, 0) <> 0 THEN
            INSERT INTO public.bulk_stock_movements (
                bulk_roasted_coffee_id, coffee_name, machine_id, production_date,
                delta_kg, balance_after, operation, ref_table, ref_id, reason, performed_by)
            VALUES (OLD.id, OLD.coffee_name, OLD.machine_id, OLD.production_date,
                -OLD.bulk_available, 0,
                COALESCE(OLD.mv_operation, 'lot_deleted'), OLD.mv_ref_table, OLD.mv_ref_id,
                OLD.mv_reason, OLD.mv_user);
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_delta := COALESCE(NEW.bulk_available, 0);
        v_op    := COALESCE(NEW.mv_operation, 'lot_created');
    ELSE
        v_delta := COALESCE(NEW.bulk_available, 0) - COALESCE(OLD.bulk_available, 0);
        v_op    := COALESCE(NEW.mv_operation, 'unspecified');
    END IF;

    IF v_delta <> 0 THEN
        INSERT INTO public.bulk_stock_movements (
            bulk_roasted_coffee_id, coffee_name, machine_id, production_date,
            delta_kg, balance_after, operation, ref_table, ref_id, reason, performed_by)
        VALUES (NEW.id, NEW.coffee_name, NEW.machine_id, NEW.production_date,
            v_delta, COALESCE(NEW.bulk_available, 0),
            v_op, NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);
    END IF;

    NEW.mv_operation := NULL;
    NEW.mv_ref_table := NULL;
    NEW.mv_ref_id    := NULL;
    NEW.mv_reason    := NULL;
    NEW.mv_user      := NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_bulk_stock_movement ON public.bulk_roasted_coffee;
CREATE TRIGGER trg_log_bulk_stock_movement
BEFORE INSERT OR UPDATE OF bulk_available OR DELETE
ON public.bulk_roasted_coffee
FOR EACH ROW EXECUTE FUNCTION log_bulk_stock_movement();

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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    batch_no INTEGER NOT NULL DEFAULT nextval('public.fifo_batch_no_seq')  -- V2 FIFO strip code: identifies one roast day for one bulk item; shared across every size it gets packed into
);

-- 26. Roast batch → green lot consumption (V2 1·CHAIN / 1B — see
-- database/v2_lot_tracking_migration.sql). One roast batch can draw from
-- several green lots (blend, or a single batch spilling across lots);
-- always recorded precisely in kg per lot. Feeds future costing (1C) and
-- Tracking traceability.
CREATE TABLE IF NOT EXISTS public.roast_batch_green_lots (
    id SERIAL PRIMARY KEY,
    roast_batch_id INTEGER REFERENCES public.roast_batches(id) ON DELETE CASCADE,
    green_coffee_lot_id INTEGER REFERENCES public.green_coffee_lots(id) ON DELETE SET NULL,
    kg_consumed NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 26b. Greenbean Data Analyze (V2) — NOT YET APPLIED TO PRODUCTION as of
-- 2026-08-18; run database/v2_greenbean_analysis_migration.sql (including
-- its custom_roles permission backfill) via the SQL Editor, then
-- NOTIFY pgrst, 'reload schema'; before removing this note. Per-lot lab
-- reading history (moisture/water_activity/density), replacing the old
-- single-value snapshot on green_coffee (those 3 columns are kept, but
-- become a read-only "latest reading" cache — see
-- js/greenbean.js's syncGreenCoffeeLabSnapshot()).
CREATE TABLE IF NOT EXISTS public.green_coffee_analysis (
    id SERIAL PRIMARY KEY,
    green_coffee_id INTEGER REFERENCES public.green_coffee(id) ON DELETE CASCADE,
    green_coffee_lot_id INTEGER NOT NULL REFERENCES public.green_coffee_lots(id) ON DELETE CASCADE,
    test_date DATE NOT NULL DEFAULT CURRENT_DATE,
    moisture_content NUMERIC,
    water_activity NUMERIC,
    density NUMERIC,
    source TEXT NOT NULL DEFAULT 'manual',        -- 'arrival' | 'manual'
    recorded_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Frozen (not live-linked) lab reading per origin, captured when a roast
-- batch is logged — see database/v2_greenbean_analysis_migration.sql.
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

-- 27. Production lot → roast batch, day-level precision (V2 1·CHAIN).
-- Snapshots the roast_batches of the same coffee+machine roasted on a
-- production_lot's production_date. Replaces the old single
-- latest_roast_batch_id approximation. Carryover from prior days is
-- deliberately not modeled (accepted inaccuracy).
CREATE TABLE IF NOT EXISTS public.production_lot_batches (
    id SERIAL PRIMARY KEY,
    production_lot_id INTEGER REFERENCES public.production_lots(id) ON DELETE CASCADE,
    roast_batch_id INTEGER REFERENCES public.roast_batches(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(production_lot_id, roast_batch_id)
);

-- 28. Dispatch lot items (V2 1G) — POS dispatch fulfillment record: which
-- packed lot, how much, went to which order line / customer. Powers the
-- "Customer Order History" lot→customer traceability UI.
CREATE TABLE IF NOT EXISTS public.dispatch_lot_items (
    id SERIAL PRIMARY KEY,
    request_order_item_id INTEGER REFERENCES public.request_order_items(id) ON DELETE CASCADE,
    packed_coffee_lot_id INTEGER REFERENCES public.packed_coffee_lots(id) ON DELETE SET NULL,
    customer_id INTEGER,
    qty INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 29. Post-blend components (V2 1I) — records what went into a post-blend
-- bulk. Used by both custom post-blend (1I-a: source_type 'Bulk'/'Packed',
-- pulling from existing stock) and, indirectly via the same bulk row, the
-- recipe-based post-blend (1I-b, whose components are fresh roast batches
-- tracked via roast_batch_green_lots/production_lot_batches instead).
CREATE TABLE IF NOT EXISTS public.post_blend_components (
    id SERIAL PRIMARY KEY,
    blend_bulk_id INTEGER REFERENCES public.bulk_roasted_coffee(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,  -- 'Bulk' | 'Packed' | 'Unregistered'
    source_bulk_id INTEGER REFERENCES public.bulk_roasted_coffee(id) ON DELETE SET NULL,
    source_packed_lot_id INTEGER REFERENCES public.packed_coffee_lots(id) ON DELETE SET NULL,
    kg NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Unregistered ingredient only (coffee not in inventory, no stock moves):
    -- see database/v2_custom_blend_unregistered_migration.sql (2026-09-29).
    source_name TEXT,   -- coffee name as typed
    source_note TEXT    -- free-text source/origin, required by the app
);

-- 30. V2 Repack (applied to production 2026-08-03): one row per source
-- packed_coffee_lots row opened into a repack bulk (bulk_roasted_coffee.
-- is_repack = true above). Mirrors post_blend_components' role, but always
-- points at packed_coffee_lots (repack only ever opens FINISHED packed
-- stock, never another bulk row directly) — js/tracking.js walks this to
-- resolve a repacked lot's full ancestry. See
-- database/repack_migration.sql.
CREATE TABLE IF NOT EXISTS public.repack_sources (
    id SERIAL PRIMARY KEY,
    repack_bulk_id INTEGER REFERENCES public.bulk_roasted_coffee(id) ON DELETE CASCADE,
    source_packed_lot_id INTEGER REFERENCES public.packed_coffee_lots(id) ON DELETE SET NULL,
    pcs INTEGER NOT NULL DEFAULT 0,
    kg NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 31/32. V2 Stock Release (applied to production 2026-08-03): finished goods
-- leaving stock WITHOUT a sales order (Packing > Stock Release), entered
-- directly by the packing team with no approval step. The finished-goods
-- sibling of green_coffee_outbound, but header+items (one release can carry
-- several coffees/sizes) and LOT-LEVEL (every line names the
-- packed_coffee_lots row consumed, like dispatch_lot_items does for sales —
-- a coarse quantity decrement would desync remaining_pcs and lose the
-- "which lot went where" answer). Damaged/discarded stock is deliberately
-- NOT modelled here — that stays with waste_inventory, so one loss can never
-- be counted twice. See database/stock_release_migration.sql.
CREATE TABLE IF NOT EXISTS public.stock_releases (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    category TEXT NOT NULL,                      -- 'Sales' | 'Sample' | 'Internal' | 'Marketing' | 'Other'
    sales_name TEXT,                             -- app-required when category = 'Sales'; free text, datalist-assisted from sales_agents. No customer link / invoice status by explicit user choice — billing reconciliation is manual.
    notes TEXT,                                  -- app-required when category = 'Other'
    released_by TEXT,                            -- audit trail: currentUser.name, same pattern as waste_inventory.recorded_by
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stock_release_items (
    id SERIAL PRIMARY KEY,
    stock_release_id INTEGER REFERENCES public.stock_releases(id) ON DELETE CASCADE,
    packed_coffee_lot_id INTEGER REFERENCES public.packed_coffee_lots(id) ON DELETE SET NULL,
    packed_coffee_id INTEGER REFERENCES public.packed_coffee(id) ON DELETE SET NULL,
    coffee_name TEXT,                            -- snapshot, keeps history readable after a lot/packed row is removed
    bag_size_g NUMERIC,                          -- snapshot, same reason
    qty INTEGER NOT NULL DEFAULT 0,              -- pcs released from this lot
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- V2 Sales fulfillment (applied 2026-08-16): reserves kg of a
-- bulk_roasted_coffee row for a specific request_order_item at approval
-- time, so a later order can't be offered/consume the same stock. Purely a
-- bookkeeping claim — does NOT move any physical stock; bulk_available only
-- actually decreases once the reserved portion is really packed
-- (js/packing.js openPackBulkModal), at which point the matching
-- reservation row should be deleted/reduced. One bulk row can be split
-- across several orders' reservations, same many-to-one pattern as
-- post_blend_components above.
CREATE TABLE IF NOT EXISTS public.bulk_reservations (
    id SERIAL PRIMARY KEY,
    bulk_roasted_coffee_id INTEGER REFERENCES public.bulk_roasted_coffee(id) ON DELETE CASCADE,
    request_order_item_id INTEGER REFERENCES public.request_order_items(id) ON DELETE CASCADE,
    kg NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- V2 Greenbean Data Analyze (applied to production 2026-08-18): per-lot lab
-- reading history (moisture/water_activity/density), replacing the old
-- single-value snapshot on green_coffee (those 3 columns are KEPT, but are
-- now a read-only "latest reading" cache synced by
-- js/greenbean.js's syncGreenCoffeeLabSnapshot()). One row per lab check,
-- tied to the specific arrival lot it was measured from. `source`
-- distinguishes the reading captured at intake time ('arrival') from later
-- manual re-checks ('manual') — the app enforces that whichever reading is
-- FIRST recorded for a given lot, from either entry point, is the one
-- tagged 'arrival'. See database/v2_greenbean_analysis_migration.sql.
CREATE TABLE IF NOT EXISTS public.green_coffee_analysis (
    id SERIAL PRIMARY KEY,
    green_coffee_id INTEGER REFERENCES public.green_coffee(id) ON DELETE CASCADE,
    green_coffee_lot_id INTEGER NOT NULL REFERENCES public.green_coffee_lots(id) ON DELETE CASCADE,
    test_date DATE NOT NULL DEFAULT CURRENT_DATE,
    moisture_content NUMERIC,
    water_activity NUMERIC,
    density NUMERIC,
    source TEXT NOT NULL DEFAULT 'manual',        -- 'arrival' | 'manual'
    recorded_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Frozen (not live-linked) lab reading per origin, captured at the moment a
-- roast batch is logged — a Single batch gets one row, a Blend batch gets
-- one row per recipe ingredient, each carrying the reading from whichever
-- lot that ingredient's FIRST FIFO draw came from. See
-- database/v2_greenbean_analysis_migration.sql.
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
    'green_coffee_lots','packed_coffee_lots','production_lots',
    'roast_batch_green_lots','production_lot_batches',
    'dispatch_lot_items','post_blend_components','code_definitions',
    'repack_sources', -- applied to production 2026-08-03
    'stock_releases','stock_release_items', -- applied to production 2026-08-03
    'bulk_reservations', -- applied to production 2026-08-16
    'green_coffee_analysis','roast_batch_analysis_snapshot', -- applied to production 2026-08-18
    'green_coffee_lot_adjustments','green_coffee_outbound_lots', -- applied to production 2026-08-19
    'packed_stock_movements', -- applied to production 2026-08-22
    'bulk_stock_movements' -- applied to production 2026-08-22 (Phase 6)
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

-- ============================================================================
-- GREENBEAN LOT ATOMIC FUNCTIONS (applied to production 2026-08-19)
-- ----------------------------------------------------------------------------
-- Every write to green_coffee_lots.remaining_kg previously went through a
-- client-side read-then-write (fetchData, compute in JS, saveData the
-- absolute result) with no locking — a lost-update race under concurrent
-- callers. These three functions do the read + write in ONE SQL statement
-- each, so Postgres's own row lock makes them atomic; the JS side
-- (consumeGreenCoffeeLotsFifo / refundGreenCoffeeLotsForBatch /
-- refundGreenCoffeeLotsForOutbound / adjustGreenCoffeeLotQuantity, all in
-- js/greenbean.js or js/roasting.js) calls these via
-- window.supabaseClient.rpc(...) instead of read-modify-write. See
-- database/v2_greenbean_lot_atomic_functions_migration.sql.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.consume_green_coffee_lot(p_lot_id INTEGER, p_kg_requested NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
AS $$
    WITH before AS (
        SELECT remaining_kg FROM public.green_coffee_lots WHERE id = p_lot_id FOR UPDATE
    ), updated AS (
        UPDATE public.green_coffee_lots
        SET remaining_kg = remaining_kg - LEAST(remaining_kg, GREATEST(p_kg_requested, 0))
        WHERE id = p_lot_id
        RETURNING remaining_kg
    )
    SELECT COALESCE((SELECT remaining_kg FROM before), 0) - COALESCE((SELECT remaining_kg FROM updated), 0);
$$;

CREATE OR REPLACE FUNCTION public.refund_green_coffee_lot(p_lot_id INTEGER, p_kg NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
AS $$
    UPDATE public.green_coffee_lots
    SET remaining_kg = remaining_kg + GREATEST(p_kg, 0)
    WHERE id = p_lot_id
    RETURNING remaining_kg;
$$;

CREATE OR REPLACE FUNCTION public.adjust_green_coffee_lot(p_lot_id INTEGER, p_delta_kg NUMERIC)
RETURNS TABLE(new_quantity_kg NUMERIC, new_remaining_kg NUMERIC)
LANGUAGE sql
AS $$
    UPDATE public.green_coffee_lots
    SET quantity_kg = GREATEST(0, quantity_kg + p_delta_kg),
        remaining_kg = GREATEST(0, remaining_kg + p_delta_kg)
    WHERE id = p_lot_id
    RETURNING quantity_kg, remaining_kg;
$$;

GRANT EXECUTE ON FUNCTION public.consume_green_coffee_lot(INTEGER, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_green_coffee_lot(INTEGER, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_green_coffee_lot(INTEGER, NUMERIC) TO anon, authenticated;

-- ============================================================================
-- PACKED COFFEE LOT ATOMIC FUNCTIONS (STOCK_LEDGER_PLAN.md Phase 1, applied
-- to production 2026-08-22)
-- ----------------------------------------------------------------------------
-- Same fix as the greenbean lot functions above, applied to
-- packed_coffee_lots.remaining_pcs: reproduced live on a throwaway test lot
-- before this migration — two concurrent takes of 30 and 20 pcs against a
-- 100-pc lot only deducted 20, leaving 30 pcs unaccounted for. The JS side
-- (submitDispatchCheckout / undoCommittedQty / applyPackedCoffeeManualQtyDelta
-- / getOrCreatePackedCoffeeLot / submitRepack / stock release / sales.js
-- order-approval auto-fulfil, all in js/packing.js or js/sales.js) calls
-- these via window.supabaseClient.rpc(...) instead of read-modify-write. See
-- database/v2_packed_lot_atomic_functions_migration.sql.
--
-- Signatures extended 2026-08-22 (STOCK_LEDGER_PLAN.md Phase 2->3 addendum)
-- with optional trailing p_operation/p_ref_table/p_ref_id/p_reason/p_user
-- parameters, so a caller can label a packed_stock_movements row (the
-- Phase 2 ledger) in the SAME atomic UPDATE that changes remaining_pcs,
-- instead of a separate preceding write that a concurrent call could race.
-- See database/v2_packed_lot_rpc_context_params_migration.sql.
--
-- IMPORTANT — this must stay CREATE OR REPLACE on the SAME 7-argument
-- signature, never a bare "add trailing defaults" over the original
-- 2-argument one. Postgres treats a changed argument list as a distinct
-- overload rather than a true replacement: applying the context-params
-- migration the first time left BOTH the old 2-argument and new
-- 7-argument functions defined side by side, and every existing 2-argument
-- call site (all of them, at the time) started failing with "Could not
-- choose the best candidate function" — broke every dispatch checkout,
-- undo, stock release, repack, and order-approval fulfillment in
-- production for the several minutes until
-- v2_packed_lot_rpc_drop_old_signature_HOTFIX.sql explicitly dropped the
-- old 2-argument overloads. If this function signature ever needs to
-- change again, DROP the old overload explicitly in the same migration
-- that adds the new one — do not rely on CREATE OR REPLACE alone.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.consume_packed_lot(
    p_lot_id INTEGER, p_pcs INTEGER,
    p_operation TEXT DEFAULT NULL, p_ref_table TEXT DEFAULT NULL,
    p_ref_id INTEGER DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
    WITH before AS (
        SELECT remaining_pcs FROM public.packed_coffee_lots WHERE id = p_lot_id FOR UPDATE
    ), updated AS (
        UPDATE public.packed_coffee_lots
        SET remaining_pcs = remaining_pcs - LEAST(remaining_pcs, GREATEST(p_pcs, 0)),
            mv_operation = p_operation, mv_ref_table = p_ref_table,
            mv_ref_id = p_ref_id, mv_reason = p_reason, mv_user = p_user
        WHERE id = p_lot_id
        RETURNING remaining_pcs
    )
    SELECT COALESCE((SELECT remaining_pcs FROM before), 0)
         - COALESCE((SELECT remaining_pcs FROM updated), 0);
$$;

CREATE OR REPLACE FUNCTION public.refund_packed_lot(
    p_lot_id INTEGER, p_pcs INTEGER,
    p_operation TEXT DEFAULT NULL, p_ref_table TEXT DEFAULT NULL,
    p_ref_id INTEGER DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE public.packed_coffee_lots
    SET remaining_pcs = remaining_pcs + GREATEST(p_pcs, 0),
        mv_operation = p_operation, mv_ref_table = p_ref_table,
        mv_ref_id = p_ref_id, mv_reason = p_reason, mv_user = p_user
    WHERE id = p_lot_id
    RETURNING remaining_pcs;
$$;

-- Deliberately does NOT touch quantity_pcs — that column is the lot's
-- historical "how much was originally packed" figure and must not be
-- rewritten by a stock correction (STOCK_LEDGER_PLAN.md F6).
CREATE OR REPLACE FUNCTION public.set_packed_lot_remaining(
    p_lot_id INTEGER, p_pcs INTEGER,
    p_operation TEXT DEFAULT NULL, p_ref_table TEXT DEFAULT NULL,
    p_ref_id INTEGER DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE public.packed_coffee_lots
    SET remaining_pcs = GREATEST(0, p_pcs),
        mv_operation = p_operation, mv_ref_table = p_ref_table,
        mv_ref_id = p_ref_id, mv_reason = p_reason, mv_user = p_user
    WHERE id = p_lot_id
    RETURNING remaining_pcs;
$$;

GRANT EXECUTE ON FUNCTION public.consume_packed_lot(INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_packed_lot(INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_packed_lot_remaining(INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;

-- ============================================================================
-- GREEN COFFEE STOCK SYNC TRIGGER (added V2 1·CHAIN, 2026-07-12 — see
-- database/v2_lot_tracking_migration.sql)
-- ============================================================================
-- green_coffee.stock_kg is a TRIGGER-MAINTAINED DERIVED value: kept in sync
-- from SUM(green_coffee_lots.remaining_kg) whenever green_coffee_lots
-- changes. No app code needs to change to READ stock_kg; app code should
-- stop WRITING it directly once 1A/1B ship (they write green_coffee_lots
-- instead, and this trigger guarantees stock_kg can never drift out of sync).
CREATE OR REPLACE FUNCTION public.sync_green_coffee_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_sync_green_coffee_stock ON public.green_coffee_lots;
CREATE TRIGGER trg_sync_green_coffee_stock
AFTER INSERT OR UPDATE OF remaining_kg OR DELETE ON public.green_coffee_lots
FOR EACH ROW EXECUTE FUNCTION public.sync_green_coffee_stock();

-- ============================================================================
-- STOCK OPNAME PHASE 2 — FREEZE GUARD (STOCK_OPNAME_PLAN.md, applied to
-- production 2026-08-26 — see database/v2_stock_opname_freeze_migration.sql)
-- ============================================================================
-- Rejects every INSERT/UPDATE/DELETE on the three stock-source tables while
-- any stock_takes row is 'counting' — the rule this enforces ("stock can't
-- move while a physical count is in progress") lives in the database, not
-- in the app's UI, per the lesson STOCK_LEDGER_PLAN.md already paid for
-- once. RAISE EXCEPTION here rolls back the whole calling statement,
-- including a write made from inside an RPC (consume_packed_lot etc.) —
-- the trigger fires on the underlying table UPDATE regardless of what
-- called it.
--
-- Trigger name is DELIBERATELY prefixed "trg_aa_" — Postgres runs same-event
-- BEFORE triggers in alphabetical order by trigger name, not creation order.
-- "aa" sorts before "log" (trg_log_packed_stock_movement,
-- trg_log_bulk_stock_movement) and "sync", so this guard always raises
-- before any ledger/derived-column trigger gets a chance to write anything.
-- Verified via information_schema.triggers before this migration was
-- written: packed_coffee_lots and bulk_roasted_coffee each already had one
-- BEFORE trigger (the ledger ones above); green_coffee_lots had none
-- (sync_green_coffee_stock is AFTER), so this guard is the only BEFORE
-- trigger there.
--
-- How the opname's own posting writes get through: finalizeStockTake()
-- (Phase 6) flips status 'counting' -> 'posting' BEFORE writing any
-- adjustment. This guard only blocks 'counting', not 'posting' — see
-- STOCK_OPNAME_PLAN.md §2 for the deliberately-accepted brief window this
-- leaves open.
--
-- Verified live 2026-08-26 on throwaway ZZ TEST rows: (a) normal
-- INSERT/UPDATE(via RPC)/DELETE on all three tables succeed with no
-- open take — non-regression; (b) with a 'counting' row open, the same
-- three operations on all three tables are rejected with this exact
-- message; (c) cancelling the take immediately unblocks them again.
CREATE OR REPLACE FUNCTION public.stock_take_freeze_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.stock_takes WHERE status = 'counting') THEN
        RAISE EXCEPTION
          'Stock opname sedang berjalan — perubahan stok dikunci sampai opname diposting atau dibatalkan.';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_aa_stock_take_freeze ON public.packed_coffee_lots;
CREATE TRIGGER trg_aa_stock_take_freeze
BEFORE INSERT OR UPDATE OR DELETE ON public.packed_coffee_lots
FOR EACH ROW EXECUTE FUNCTION stock_take_freeze_guard();

DROP TRIGGER IF EXISTS trg_aa_stock_take_freeze ON public.green_coffee_lots;
CREATE TRIGGER trg_aa_stock_take_freeze
BEFORE INSERT OR UPDATE OR DELETE ON public.green_coffee_lots
FOR EACH ROW EXECUTE FUNCTION stock_take_freeze_guard();

DROP TRIGGER IF EXISTS trg_aa_stock_take_freeze ON public.bulk_roasted_coffee;
CREATE TRIGGER trg_aa_stock_take_freeze
BEFORE INSERT OR UPDATE OR DELETE ON public.bulk_roasted_coffee
FOR EACH ROW EXECUTE FUNCTION stock_take_freeze_guard();

-- 31. Purchase requests (PURCHASE_REQUEST_PLAN.md) — permintaan pembelian
-- dari staff ke manager. Sengaja TIDAK terhubung ke stok/inventory sama
-- sekali: tidak ada FK ke green_coffee/bulk_roasted_coffee/packed_coffee,
-- tidak ada RPC ledger. Alur berakhir di status 'Approved' — tidak ada
-- 'Purchased'/'Received' (§3.3 keputusan user, sengaja tidak dibangun).
CREATE TABLE IF NOT EXISTS public.purchase_requests (
    id SERIAL PRIMARY KEY,
    request_number TEXT,                      -- PR-YYMMDD-NNN, dibuat aplikasi
    category TEXT NOT NULL,                   -- 'Raw Materials' | 'Equipment' | 'Housekeeping Supplies' | 'Other'
    status TEXT DEFAULT 'Requested',          -- 'Requested' | 'Approved' | 'Rejected' | 'Cancelled'
    purpose TEXT,                             -- keperluan, wajib diisi aplikasi
    notes TEXT,                               -- catatan tambahan untuk manager, opsional
    needed_by DATE,                           -- opsional
    requested_by_id UUID,                     -- profiles.id — sumber kebenaran kepemilikan, BUKAN nama (§7.2 plan)
    requested_by_name TEXT,                   -- snapshot nama saat dibuat, untuk tampilan & riwayat
    request_date DATE DEFAULT CURRENT_DATE,
    decided_by_id UUID,                       -- profiles.id manager yang memutuskan
    decided_by_name TEXT,                     -- snapshot nama
    decided_at TIMESTAMPTZ,
    decision_note TEXT,                       -- alasan; OPSIONAL bahkan saat Rejected (§3.7 plan)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 32. Purchase request items
CREATE TABLE IF NOT EXISTS public.purchase_request_items (
    id SERIAL PRIMARY KEY,
    purchase_request_id INTEGER,              -- FK ke purchase_requests.id (INTEGER, bukan UUID)
    item_name TEXT NOT NULL,
    qty NUMERIC,
    unit TEXT,                                -- 'pcs' | 'kg' | 'box' | dst, teks bebas
    estimated_price NUMERIC,                  -- NULL = peminta tidak tahu harganya (§3.4 plan) — tidak pernah dihitung sebagai 0
    item_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY full_access ON public.purchase_requests FOR ALL USING (true);
CREATE POLICY full_access ON public.purchase_request_items FOR ALL USING (true);

-- ============================================================================
-- Other Items (OTHER_ITEMS_PLAN.md, applied 2026-09-20) — stock for goods
-- bought from outside and resold as-is (paper filters, cups, merchandise).
-- Never touched by roasting/packing: no lot tracking, no FIFO, no expiry —
-- one item carries one running stock_qty, with every change written to
-- other_item_movements by a trigger (mv_* columns mirror
-- packed_coffee_lots' pattern, see log_packed_stock_movement above).
--
-- Named "Other Items", not "Retail" — Retail already means a customer
-- category in this app (customers.type, customer_cat_retail permission,
-- RTL- code prefix, "Retail Sales" custom role).
--
-- No price column, no code/SKU column (user decisions 2026-09-20):
-- request_order_items for coffee carries no price either, and the handful
-- of items this manages are identified by name alone — other_items.name is
-- UNIQUE (case-insensitive) and used as the item's identity everywhere.
--
-- request_order_other_items is a SEPARATE order-line table, not a new
-- column on request_order_items: js/leader.js renders every line as
-- `${item.bag_size_g}g (${item.quantity_requested} bags)`, and the whole
-- checkout/packing pipeline assumes a line is coffee with a lot/machine/
-- size. See OTHER_ITEMS_PLAN.md §4.6 for the full reasoning.
-- ============================================================================

-- 33. Other items — master item + running stock
CREATE TABLE IF NOT EXISTS public.other_items (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'pcs',           -- pcs | box | roll | pack
    stock_qty INTEGER NOT NULL DEFAULT 0,       -- the ONLY source of truth for stock
    min_stock INTEGER NOT NULL DEFAULT 0,       -- threshold for the "Low" badge
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- Movement context the ledger trigger reads (mirrors packed_coffee_lots.mv_*).
    mv_operation TEXT,
    mv_category  TEXT,
    mv_ref_table TEXT,
    mv_ref_id    INTEGER,
    mv_reason    TEXT,
    mv_user      TEXT,
    mv_date      DATE
);

CREATE UNIQUE INDEX IF NOT EXISTS other_items_name_uniq
ON public.other_items (lower(name));

-- 34. Other item stock movements (ledger). The Stock Release tab is a VIEW
-- of this table filtered to operation='release' — not its own table, and
-- NOT a reuse of stock_releases/stock_release_items (those are lot-shaped
-- for coffee: packed_coffee_lot_id, coffee_name, bag_size_g).
CREATE TABLE IF NOT EXISTS public.other_item_movements (
    id BIGSERIAL PRIMARY KEY,
    other_item_id INTEGER,           -- INTENTIONALLY no FK — history must
                                      -- survive the item being deleted
    item_name TEXT,                  -- snapshot
    unit TEXT,                       -- snapshot
    movement_date DATE NOT NULL DEFAULT CURRENT_DATE,  -- date the USER picked
    delta_qty INTEGER NOT NULL,
    balance_after INTEGER,
    operation TEXT,                  -- item_created | stock_in | dispatch | release
                                      -- | adjustment | undo | item_deleted
    category TEXT,                   -- only for operation='release':
                                      -- Sample | Internal | Marketing | Other
    ref_table TEXT,                  -- 'request_order_other_items' on dispatch
    ref_id INTEGER,
    reason TEXT,
    performed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oim_item_idx    ON public.other_item_movements (other_item_id, id);
CREATE INDEX IF NOT EXISTS oim_created_idx ON public.other_item_movements (created_at);
CREATE INDEX IF NOT EXISTS oim_op_idx      ON public.other_item_movements (operation, id);

CREATE OR REPLACE FUNCTION public.log_other_item_movement() RETURNS TRIGGER AS $$
DECLARE v_delta INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- A plain DELETE never sets the mv_* columns, so whatever is sitting
        -- in them is LEFTOVER from the last RPC call on this row. Reading
        -- them here would file the deletion as e.g. operation='stock_in'
        -- with a negative delta, crediting it to whoever last added stock.
        -- So this branch ignores mv_* entirely and states the plain fact.
        -- For an attributed deletion, the app calls
        -- other_item_set_qty(id, 0, 'item_deleted', ..., p_reason, p_user)
        -- FIRST; stock is then already 0 and this branch no-ops.
        IF COALESCE(OLD.stock_qty, 0) <> 0 THEN
            INSERT INTO public.other_item_movements (
                other_item_id, item_name, unit, movement_date,
                delta_qty, balance_after, operation, category,
                ref_table, ref_id, reason, performed_by)
            VALUES (OLD.id, OLD.name, OLD.unit, CURRENT_DATE,
                -OLD.stock_qty, 0, 'item_deleted', NULL,
                NULL, NULL, NULL, NULL);
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_delta := COALESCE(NEW.stock_qty, 0);
    ELSE
        v_delta := COALESCE(NEW.stock_qty, 0) - COALESCE(OLD.stock_qty, 0);
    END IF;

    IF v_delta = 0 THEN RETURN NEW; END IF;

    INSERT INTO public.other_item_movements (
        other_item_id, item_name, unit, movement_date,
        delta_qty, balance_after, operation, category,
        ref_table, ref_id, reason, performed_by)
    VALUES (NEW.id, NEW.name, NEW.unit, COALESCE(NEW.mv_date, CURRENT_DATE),
        v_delta, NEW.stock_qty,
        COALESCE(NEW.mv_operation, CASE WHEN TG_OP = 'INSERT' THEN 'item_created' ELSE 'unspecified' END),
        NEW.mv_category, NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_log_other_item_movement ON public.other_items;
CREATE TRIGGER trg_log_other_item_movement
AFTER INSERT OR UPDATE OR DELETE ON public.other_items
FOR EACH ROW EXECUTE FUNCTION log_other_item_movement();

-- RPCs — every stock change MUST go through one of these three; the app
-- must never write other_items.stock_qty directly via saveData().
CREATE OR REPLACE FUNCTION public.other_item_stock_in(
    p_item_id INTEGER, p_qty INTEGER, p_date DATE DEFAULT NULL,
    p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE sql SET search_path = public AS $$
    UPDATE public.other_items
    SET stock_qty   = stock_qty + GREATEST(p_qty, 0),
        updated_at  = NOW(),
        mv_operation='stock_in', mv_category=NULL,
        mv_ref_table=NULL, mv_ref_id=NULL,
        mv_reason=p_reason, mv_user=p_user, mv_date=COALESCE(p_date, CURRENT_DATE)
    WHERE id = p_item_id
    RETURNING stock_qty;
$$;

CREATE OR REPLACE FUNCTION public.other_item_consume(
    p_item_id INTEGER, p_qty INTEGER,
    p_operation TEXT DEFAULT 'dispatch', p_category TEXT DEFAULT NULL,
    p_ref_table TEXT DEFAULT NULL, p_ref_id INTEGER DEFAULT NULL,
    p_date DATE DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE sql SET search_path = public AS $$
    WITH before AS (
        SELECT stock_qty FROM public.other_items WHERE id = p_item_id FOR UPDATE
    ), updated AS (
        UPDATE public.other_items
        SET stock_qty   = stock_qty - LEAST(stock_qty, GREATEST(p_qty, 0)),
            updated_at  = NOW(),
            mv_operation=p_operation, mv_category=p_category,
            mv_ref_table=p_ref_table, mv_ref_id=p_ref_id,
            mv_reason=p_reason, mv_user=p_user, mv_date=COALESCE(p_date, CURRENT_DATE)
        WHERE id = p_item_id
        RETURNING stock_qty
    )
    SELECT COALESCE((SELECT stock_qty FROM before), 0)
         - COALESCE((SELECT stock_qty FROM updated), 0);
$$;

CREATE OR REPLACE FUNCTION public.other_item_set_qty(
    p_item_id INTEGER, p_qty INTEGER,
    p_operation TEXT DEFAULT 'adjustment',
    p_ref_table TEXT DEFAULT NULL, p_ref_id INTEGER DEFAULT NULL,
    p_date DATE DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE sql SET search_path = public AS $$
    UPDATE public.other_items
    SET stock_qty   = GREATEST(0, p_qty),
        updated_at  = NOW(),
        mv_operation=COALESCE(p_operation, 'adjustment'), mv_category=NULL,
        mv_ref_table=p_ref_table, mv_ref_id=p_ref_id,
        mv_reason=p_reason, mv_user=p_user, mv_date=COALESCE(p_date, CURRENT_DATE)
    WHERE id = p_item_id
    RETURNING stock_qty;
$$;

GRANT EXECUTE ON FUNCTION public.other_item_stock_in(INTEGER, INTEGER, DATE, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.other_item_consume(INTEGER, INTEGER, TEXT, TEXT, TEXT, INTEGER, DATE, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.other_item_set_qty(INTEGER, INTEGER, TEXT, TEXT, INTEGER, DATE, TEXT, TEXT) TO anon, authenticated;

-- 35. Request order other items — other-item lines on a Sales Request. No
-- quantity_prepared: nothing needs preparing, taken off the shelf at checkout.
CREATE TABLE IF NOT EXISTS public.request_order_other_items (
    id SERIAL PRIMARY KEY,
    request_order_id INTEGER REFERENCES public.request_orders(id) ON DELETE CASCADE,
    other_item_id INTEGER REFERENCES public.other_items(id) ON DELETE SET NULL,
    item_name TEXT,                              -- snapshot at order creation time
    unit TEXT,                                   -- snapshot
    quantity_requested INTEGER NOT NULL DEFAULT 0,
    quantity_dispatched INTEGER NOT NULL DEFAULT 0,
    quantity_unfulfilled INTEGER NOT NULL DEFAULT 0,
    item_status TEXT DEFAULT 'Pending Approval',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rooi_order_idx ON public.request_order_other_items (request_order_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'other_items','other_item_movements','request_order_other_items' -- applied 2026-09-21
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS full_access ON public.%I', t);
    EXECUTE format('CREATE POLICY full_access ON public.%I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Deliberately NOT wiring stock_take_freeze_guard onto other_items (see
-- stock_take_freeze_guard above) — stock opname in this app counts coffee
-- (green/bulk/packed); freezing other-item stock during a coffee opname
-- would block sales of filters/cups/merch for no connected reason.

-- NOTE — the 6 other_items_* permission keys need a one-time backfill into
-- custom_roles.permissions (a role row missing a key reads as false, so the
-- feature would be invisible to everyone, including Admin). That statement
-- is DML, not schema, and deliberately lives ONLY in
-- database/other_items_migration.sql §7 — putting it here would break this
-- file's promise at the top that running it against production is
-- non-destructive: it would silently reset those 6 keys on every role,
-- wiping any later adjustment an admin made in Settings > Role Management.

-- =====================================================================
-- Item Return (2026-10-04) — see database/stock_returns_migration.sql
-- (the returns_manage permission backfill is DML and lives only there).
-- bulk_roasted_coffee.is_return is added there too (ALTER below).
-- =====================================================================
-- 1. Header — one per Record Return.
CREATE TABLE IF NOT EXISTS public.stock_returns (
    id SERIAL PRIMARY KEY,
    return_number TEXT NOT NULL UNIQUE,          -- RET-YYYYMMDD-n
    return_date DATE NOT NULL DEFAULT CURRENT_DATE,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE SET NULL,  -- picked from the list (counts in CRM)
    origin_text TEXT,                            -- free-text origin when not a customer (not in CRM)
    reason TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Items — what came back. Identity:
--   coffee_kind 'single' | 'recipe' | 'custom' | 'unknown'
--     single  = a green coffee (single_coffee_id)
--     recipe  = a blend recipe (blend_recipe_id)
--     custom  = a custom blend (from its sticker; no recipe id)
--     unknown = no sticker and the roast log had 0 or several coffees for
--               code + machine + roast date; candidates keeps that list
--   coffee_code + coffee_type = how sales reads it (Code Definitions)
--   resolved_via 'sticker' | 'roast_log' | 'unknown'
CREATE TABLE IF NOT EXISTS public.stock_return_items (
    id SERIAL PRIMARY KEY,
    return_id INTEGER NOT NULL REFERENCES public.stock_returns(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL DEFAULT 1,
    coffee_kind TEXT NOT NULL,
    coffee_code TEXT NOT NULL,
    coffee_type TEXT NOT NULL,
    single_coffee_id INTEGER,
    blend_recipe_id INTEGER,
    coffee_name TEXT NOT NULL,                   -- green / recipe / custom blend name, or the trade name when unknown
    resolved_via TEXT NOT NULL,
    candidates JSONB,                            -- unknown only: [{"name":..., "batches":n}] roasted under the code that day
    source_packed_lot_id INTEGER REFERENCES public.packed_coffee_lots(id) ON DELETE SET NULL,  -- the scanned sticker's lot
    machine_id INTEGER,
    roast_date DATE NOT NULL,                    -- original roast date (from the sticker or typed)
    bag_size_g INTEGER NOT NULL,
    sealed_pcs INTEGER NOT NULL DEFAULT 0 CHECK (sealed_pcs >= 0),
    opened_kg NUMERIC NOT NULL DEFAULT 0 CHECK (opened_kg >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stock_return_items_return_idx ON public.stock_return_items (return_id);

-- 3. Actions — where each part of an item went. Never edited or deleted
-- once written (same rule as the stock ledgers); targets carry no FK on
-- purpose so a later lot/bulk/waste deletion can't erase the trail.
--   part   'sealed' (qty_pcs) | 'opened' (kg)
--   action 'inventory' | 'bulk' | 'waste'
CREATE TABLE IF NOT EXISTS public.stock_return_actions (
    id SERIAL PRIMARY KEY,
    return_item_id INTEGER NOT NULL REFERENCES public.stock_return_items(id) ON DELETE CASCADE,
    part TEXT NOT NULL,
    action TEXT NOT NULL,
    qty_pcs INTEGER NOT NULL DEFAULT 0,
    kg NUMERIC NOT NULL DEFAULT 0,
    target_packed_lot_id INTEGER,
    target_bulk_id INTEGER,
    target_waste_id INTEGER,
    roast_date_used DATE,                        -- roast date on the destination (differs from the item's when changed)
    label_mode TEXT,                             -- inventory only: 'old' | 'new'
    reason TEXT,
    performed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stock_return_actions_item_idx ON public.stock_return_actions (return_item_id);
CREATE INDEX IF NOT EXISTS stock_return_actions_lot_idx ON public.stock_return_actions (target_packed_lot_id);
CREATE INDEX IF NOT EXISTS stock_return_actions_bulk_idx ON public.stock_return_actions (target_bulk_id);

-- 4. Markers on existing tables.
ALTER TABLE public.bulk_roasted_coffee
    ADD COLUMN IF NOT EXISTS is_return BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN public.bulk_roasted_coffee.is_return IS
    'Item Return: bulk card made from returned coffee (tag RETURN). Its sources are the stock_return_actions rows pointing at it.';
ALTER TABLE public.waste_inventory
    ADD COLUMN IF NOT EXISTS return_item_id INTEGER REFERENCES public.stock_return_items(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.waste_inventory.return_item_id IS
    'Item Return: the returned item this waste came from (source_type ''Return'').';

-- 5. Same permissive full_access pattern as every other table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_returns', 'stock_return_items', 'stock_return_actions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS full_access ON public.%I', t);
    EXECUTE format('CREATE POLICY full_access ON public.%I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Edit Return — silent edit log (database/stock_return_edits_migration.sql,
-- 2026-10-05). One row per change from the Edit Return modal: who, when,
-- old → new. Investigation only; never shown in the app. No FKs on purpose.
CREATE TABLE IF NOT EXISTS public.stock_return_edits (
    id BIGSERIAL PRIMARY KEY,
    return_id INTEGER,
    return_number TEXT,
    return_item_id INTEGER,                      -- null for header changes
    change TEXT NOT NULL,                        -- header | item_update | item_identify | item_split | item_add | item_remove | remaining_remove
    details JSONB,                               -- { field: [old, new], ... } or the added/removed row
    edited_by TEXT,
    edited_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stock_return_edits_return_idx ON public.stock_return_edits (return_id, id);
ALTER TABLE public.stock_return_edits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.stock_return_edits;
CREATE POLICY full_access ON public.stock_return_edits FOR ALL USING (true) WITH CHECK (true);
