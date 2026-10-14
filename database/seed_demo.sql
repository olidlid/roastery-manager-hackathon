-- ============================================================================
-- DEMO SEED — realistic, fully consistent dummy data for the STAGING project.
-- Run after supabase_schema.sql + staging_setup.sql (see STAGING_SETUP.md).
-- ----------------------------------------------------------------------------
-- WIPES every business table and rebuilds ~8 months of history. Re-run it any
-- time to reset staging to a known state (e.g. after a test run went wild).
--
-- Every date is relative to CURRENT_DATE, so the data never goes stale: the
-- CRM reorder prediction, "last order" badges and low-stock alerts look the
-- same whether this runs today or during judging.
--
-- Nothing is written as a bare number. The history is replayed day by day
-- through the same atomic RPCs the app uses (consume_green_coffee_lot,
-- refund/consume_bulk_lot, consume/refund_packed_lot), in the same FIFO order
-- the app uses, so the derived columns (green_coffee.stock_kg,
-- packed_coffee.quantity) and the movement ledgers agree with the lots — the
-- same invariants the app relies on (see CLAUDE.md "Stock safety").
--
-- Built-in test fixtures (asserted at the bottom of this file):
--   * FIFO   — Aceh Gayo has an OLD lot with 10 kg left and a NEWER lot with
--              60 kg untouched. A 15 kg roast must take 10 kg from the old lot
--              and 5 kg from the new one.
--   * Spill  — one Toraja batch drew from two lots (5 kg + 1 kg).
--   * Trace  — every packed lot links production lot → roast batches →
--              green lots → supplier (Tracking page).
--   * CRM    — customers with steady, slipping, dormant, once-only and
--              never-ordered patterns.
--   * Workflow — orders waiting for approval, one approved and waiting for
--              checkout, a bulk card ready to pack, one low-stock green bean.
-- ============================================================================

-- 0. Safety: only ever on the staging project.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.company_settings WHERE id = 1 AND company_name = 'Demo Roastery (Hackathon)') THEN
        RAISE EXCEPTION 'company_settings is not the demo marker — run staging_setup.sql first. Nothing was changed.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.stock_takes WHERE status IN ('counting', 'posting')) THEN
        RAISE EXCEPTION 'A stock take is open (its freeze would block the seed). Cancel it first. Nothing was changed.';
    END IF;
END $$;

-- 1. Wipe business data (profiles, custom_roles, company_settings are kept).
TRUNCATE
    public.green_coffee, public.green_coffee_lots, public.green_coffee_intake,
    public.green_coffee_outbound, public.green_coffee_outbound_lots,
    public.green_coffee_lot_adjustments, public.green_coffee_analysis,
    public.code_definitions, public.blend_recipes, public.blend_ingredients,
    public.machines, public.roasting_plans, public.roast_batches,
    public.roast_batch_green_lots, public.roast_batch_analysis_snapshot,
    public.bulk_roasted_coffee, public.bulk_stock_movements, public.bulk_reservations,
    public.production_lots, public.production_lot_batches,
    public.packaging_sizes, public.packed_coffee, public.packed_coffee_lots,
    public.packed_stock_movements, public.packing_records,
    public.post_blend_components, public.repack_sources,
    public.waste_inventory, public.stock_releases, public.stock_release_items,
    public.customers, public.customer_owner_history, public.sales_agents,
    public.request_orders, public.request_order_items, public.request_order_other_items,
    public.dispatch_lot_items, public.sales_orders,
    public.stock_takes, public.stock_take_items,
    public.other_items, public.other_item_movements,
    public.purchase_requests, public.purchase_request_items,
    public.stock_returns, public.stock_return_items, public.stock_return_actions,
    public.stock_return_edits
RESTART IDENTITY CASCADE;
ALTER SEQUENCE public.fifo_batch_no_seq RESTART WITH 1;

-- 2. Helpers (session-only, pg_temp — gone when the session ends).
CREATE OR REPLACE FUNCTION pg_temp.d(n INTEGER) RETURNS DATE
LANGUAGE sql AS $$ SELECT CURRENT_DATE - n $$;

CREATE OR REPLACE FUNCTION pg_temp.ts(n INTEGER, hh INTEGER DEFAULT 9) RETURNS TIMESTAMPTZ
LANGUAGE sql AS $$ SELECT (CURRENT_DATE - n) + make_interval(hours => hh) $$;

-- Same sanitizer as buildLotCode()/createGreenCoffeeLot() in the app.
CREATE OR REPLACE FUNCTION pg_temp.san(s TEXT) RETURNS TEXT
LANGUAGE sql AS $$ SELECT COALESCE(NULLIF(left(regexp_replace(upper(COALESCE(s, '')), '[^A-Z0-9]', '', 'g'), 10), ''), 'X') $$;

-- Green bean arrival: lot ({code}-GL-{YYMMDD}-{NN}, NN = global daily
-- sequence, as createGreenCoffeeLot) + the arrival record linked to it.
CREATE OR REPLACE FUNCTION pg_temp.intake(p_gc INTEGER, p_day INTEGER, p_kg NUMERIC, p_price NUMERIC, p_supplier TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE g public.green_coffee%ROWTYPE; v_seq INTEGER; v_lot INTEGER;
BEGIN
    SELECT * INTO g FROM public.green_coffee WHERE id = p_gc;
    SELECT COUNT(*) + 1 INTO v_seq FROM public.green_coffee_lots WHERE arrival_date = pg_temp.d(p_day);
    INSERT INTO public.green_coffee_lots (green_coffee_id, lot_code, quantity_kg, remaining_kg, supplier, arrival_date, purchase_price_per_kg, created_at)
    VALUES (p_gc, pg_temp.san(g.code) || '-GL-' || to_char(pg_temp.d(p_day), 'YYMMDD') || '-' || lpad(v_seq::TEXT, 2, '0'),
            p_kg, p_kg, p_supplier, pg_temp.d(p_day), p_price, pg_temp.ts(p_day, 8))
    RETURNING id INTO v_lot;
    INSERT INTO public.green_coffee_intake (green_coffee_id, date, code, name, origin, process, quantity, supplier, green_coffee_lot_id, created_at)
    VALUES (p_gc, pg_temp.d(p_day), g.code, g.name, g.origin, g.process, p_kg, p_supplier, v_lot, pg_temp.ts(p_day, 8));
    INSERT INTO public.green_coffee_analysis (green_coffee_id, green_coffee_lot_id, test_date, moisture_content, water_activity, density, source, recorded_by, created_at)
    VALUES (p_gc, v_lot, pg_temp.d(p_day), 10.2 + (p_gc % 3) * 0.6, 0.52 + (p_gc % 4) * 0.02, 680 + p_gc * 12, 'arrival', 'Hendra Leader', pg_temp.ts(p_day, 8));
    UPDATE public.green_coffee
    SET moisture_content = 10.2 + (p_gc % 3) * 0.6, water_activity = 0.52 + (p_gc % 4) * 0.02, density = 680 + p_gc * 12
    WHERE id = p_gc;
    RETURN v_lot;
END $$;

-- FIFO draw from one coffee's green lots, oldest arrival first (the app's
-- consumeGreenCoffeeLotsFifo order), only lots that had arrived by that day.
CREATE OR REPLACE FUNCTION pg_temp.draw_green(p_batch INTEGER, p_gc INTEGER, p_kg NUMERIC, p_day INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE l RECORD; v_need NUMERIC := p_kg; v_taken NUMERIC;
BEGIN
    FOR l IN SELECT id FROM public.green_coffee_lots
             WHERE green_coffee_id = p_gc AND remaining_kg > 0 AND arrival_date <= pg_temp.d(p_day)
             ORDER BY arrival_date, id LOOP
        EXIT WHEN v_need <= 0;
        v_taken := public.consume_green_coffee_lot(l.id, v_need);
        IF v_taken > 0 THEN
            INSERT INTO public.roast_batch_green_lots (roast_batch_id, green_coffee_lot_id, kg_consumed, created_at)
            VALUES (p_batch, l.id, v_taken, pg_temp.ts(p_day, 10));
            v_need := v_need - v_taken;
        END IF;
    END LOOP;
    IF v_need > 0.0001 THEN
        RAISE EXCEPTION 'seed bug: green coffee % short by % kg on day -%', p_gc, v_need, p_day;
    END IF;
END $$;

-- One roast batch: batch code as the roasting modal generates it
-- ({coffee code}-{machine code}{DDMM}-{n}), green drawn FIFO, output added to
-- that day's bulk card for coffee+machine (one card per roast day).
CREATE OR REPLACE FUNCTION pg_temp.roast(p_day INTEGER, p_type TEXT, p_ref INTEGER, p_machine INTEGER,
                                         p_in NUMERIC, p_yield NUMERIC, p_degree NUMERIC)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v_code TEXT; v_name TEXT; v_mcode TEXT; v_prefix TEXT; v_seq INTEGER; v_batch INTEGER;
        v_out NUMERIC := round(p_in * p_yield, 3); v_bulk INTEGER; ing RECORD;
BEGIN
    IF p_type = 'Single' THEN SELECT code, name INTO v_code, v_name FROM public.green_coffee WHERE id = p_ref;
    ELSE SELECT code, name INTO v_code, v_name FROM public.blend_recipes WHERE id = p_ref; END IF;
    SELECT code INTO v_mcode FROM public.machines WHERE id = p_machine;
    v_prefix := v_code || '-' || v_mcode || to_char(pg_temp.d(p_day), 'DDMM') || '-';
    SELECT COUNT(*) + 1 INTO v_seq FROM public.roast_batches WHERE batch_code LIKE v_prefix || '%';

    INSERT INTO public.roast_batches (batch_code, roast_date, coffee_type, single_coffee_id, blend_recipe_id, machine_id,
        input_weight_kg, output_weight_kg, yield_percentage, roast_type, qc_status, roaster_operator, roast_degree, created_at)
    VALUES (v_prefix || v_seq, pg_temp.d(p_day), p_type,
        CASE WHEN p_type = 'Single' THEN p_ref END, CASE WHEN p_type = 'Blend' THEN p_ref END, p_machine,
        p_in, v_out, round(v_out / p_in * 100, 2), 'Regular', 'Success', 'Gavin Roaster', p_degree, pg_temp.ts(p_day, 10))
    RETURNING id INTO v_batch;

    IF p_type = 'Single' THEN
        PERFORM pg_temp.draw_green(v_batch, p_ref, p_in, p_day);
    ELSE
        FOR ing IN SELECT green_coffee_id, percentage FROM public.blend_ingredients WHERE blend_recipe_id = p_ref ORDER BY id LOOP
            PERFORM pg_temp.draw_green(v_batch, ing.green_coffee_id, round(p_in * ing.percentage / 100, 3), p_day);
        END LOOP;
    END IF;

    SELECT id INTO v_bulk FROM public.bulk_roasted_coffee
    WHERE coffee_type = p_type AND machine_id = p_machine AND production_date = pg_temp.d(p_day)
      AND COALESCE(single_coffee_id, -1) = COALESCE(CASE WHEN p_type = 'Single' THEN p_ref END, -1)
      AND COALESCE(blend_recipe_id, -1) = COALESCE(CASE WHEN p_type = 'Blend' THEN p_ref END, -1)
      AND NOT is_post_blend AND NOT is_repack AND NOT is_return;
    IF v_bulk IS NULL THEN
        INSERT INTO public.bulk_roasted_coffee (coffee_type, single_coffee_id, blend_recipe_id, machine_id, coffee_name,
            bulk_available, production_date, created_at, mv_operation, mv_ref_table, mv_ref_id, mv_user)
        VALUES (p_type, CASE WHEN p_type = 'Single' THEN p_ref END, CASE WHEN p_type = 'Blend' THEN p_ref END, p_machine, v_name,
            v_out, pg_temp.d(p_day), pg_temp.ts(p_day, 10), 'roast', 'roast_batches', v_batch, 'Gavin Roaster');
    ELSE
        PERFORM public.refund_bulk_lot(v_bulk, v_out, 'roast', 'roast_batches', v_batch, NULL, 'Gavin Roaster');
    END IF;
    RETURN v_batch;
END $$;

-- Pack from the bulk card roasted on p_roast_day into p_pcs x p_size g, on
-- p_day: production lot (one per bulk card + day, lot code as buildLotCode),
-- its roast batches, the packed product, the packed lot (lot code + strip
-- code as getOrCreatePackedCoffeeLot), the bulk deduction and the history row.
CREATE OR REPLACE FUNCTION pg_temp.pack(p_day INTEGER, p_type TEXT, p_ref INTEGER, p_machine INTEGER,
                                        p_roast_day INTEGER, p_size INTEGER, p_pcs INTEGER)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE b public.bulk_roasted_coffee%ROWTYPE; v_code TEXT; v_mcode TEXT; v_pl public.production_lots%ROWTYPE;
        v_pcs INTEGER; v_packed INTEGER; v_lot INTEGER; v_batches INTEGER; v_digit SMALLINT; v_rec INTEGER;
BEGIN
    SELECT * INTO b FROM public.bulk_roasted_coffee
    WHERE coffee_type = p_type AND machine_id = p_machine AND production_date = pg_temp.d(p_roast_day)
      AND COALESCE(single_coffee_id, blend_recipe_id) = p_ref AND NOT is_post_blend AND NOT is_repack AND NOT is_return;
    IF b.id IS NULL THEN RAISE EXCEPTION 'seed bug: no bulk for % #% roasted day -%', p_type, p_ref, p_roast_day; END IF;
    v_pcs := LEAST(p_pcs, floor(b.bulk_available * 1000 / p_size)::INTEGER);
    IF v_pcs <= 0 THEN RETURN NULL; END IF;

    IF p_type = 'Single' THEN SELECT code INTO v_code FROM public.green_coffee WHERE id = p_ref;
    ELSE SELECT code INTO v_code FROM public.blend_recipes WHERE id = p_ref; END IF;
    SELECT code INTO v_mcode FROM public.machines WHERE id = p_machine;

    SELECT * INTO v_pl FROM public.production_lots WHERE bulk_roasted_coffee_id = b.id AND production_date = b.production_date;
    IF v_pl.id IS NULL THEN
        INSERT INTO public.production_lots (lot_code, bulk_roasted_coffee_id, coffee_type, single_coffee_id, blend_recipe_id,
            machine_id, coffee_name, production_date, latest_roast_batch_id, created_at)
        SELECT pg_temp.san(v_code) || '-' || pg_temp.san(v_mcode) || to_char(b.production_date, 'MMDDYY')
                 || (SELECT COUNT(*) + 1 FROM public.production_lots l
                     WHERE l.coffee_type = b.coffee_type AND l.machine_id = b.machine_id
                       AND COALESCE(l.single_coffee_id, l.blend_recipe_id) = p_ref),
               b.id, b.coffee_type, b.single_coffee_id, b.blend_recipe_id, b.machine_id, b.coffee_name, b.production_date,
               (SELECT MAX(id) FROM public.roast_batches r WHERE r.coffee_type = b.coffee_type AND r.machine_id = b.machine_id
                  AND r.roast_date = b.production_date AND COALESCE(r.single_coffee_id, r.blend_recipe_id) = p_ref),
               pg_temp.ts(p_day, 11)
        RETURNING * INTO v_pl;
        INSERT INTO public.production_lot_batches (production_lot_id, roast_batch_id, created_at)
        SELECT v_pl.id, r.id, pg_temp.ts(p_day, 11) FROM public.roast_batches r
        WHERE r.coffee_type = b.coffee_type AND r.machine_id = b.machine_id AND r.roast_date = b.production_date
          AND COALESCE(r.single_coffee_id, r.blend_recipe_id) = p_ref
        ON CONFLICT DO NOTHING;
    END IF;

    SELECT id INTO v_packed FROM public.packed_coffee
    WHERE lower(custom_coffee_name) = lower(b.coffee_name) AND bag_size_g = p_size AND machine_id = p_machine AND roast_batch_id IS NULL;
    IF v_packed IS NULL THEN
        INSERT INTO public.packed_coffee (roast_batch_id, machine_id, custom_coffee_name, bag_size_g, quantity, selling_price, created_at)
        VALUES (NULL, p_machine, b.coffee_name, p_size, 0,
                CASE p_size WHEN 250 THEN 8.50 WHEN 500 THEN 16.00 ELSE 30.00 END, pg_temp.ts(p_day, 11))
        RETURNING id INTO v_packed;
    END IF;

    INSERT INTO public.packing_records (date, pack_date, source_type, source_id, coffee_name, machine_id, bag_size_g, size_g,
        quantity, status, packed_by, created_at)
    VALUES (pg_temp.d(p_day), pg_temp.d(p_day), b.coffee_type, p_ref, b.coffee_name, p_machine, p_size, p_size,
        v_pcs, 'Completed', 'Putri Packing', pg_temp.ts(p_day, 11))
    RETURNING id INTO v_rec;

    SELECT id INTO v_lot FROM public.packed_coffee_lots WHERE packed_coffee_id = v_packed AND production_lot_id = v_pl.id;
    IF v_lot IS NULL THEN
        SELECT COUNT(*) INTO v_batches FROM public.roast_batches r
        WHERE r.machine_id = p_machine AND r.roast_date = b.production_date AND COALESCE(r.single_coffee_id, r.blend_recipe_id) = p_ref;
        SELECT size_digit INTO v_digit FROM public.packaging_sizes WHERE gram = p_size;
        INSERT INTO public.packed_coffee_lots (packed_coffee_id, roast_batch_id, lot_code, quantity_pcs, remaining_pcs, packed_date,
            production_lot_id, batch_no, strip_code, created_at, mv_operation, mv_ref_table, mv_ref_id, mv_reason, mv_user)
        VALUES (v_packed, NULL,
            pg_temp.san(v_code) || '-' || pg_temp.san(v_mcode) || to_char(b.production_date, 'DDMMYY') || '-' || v_batches,
            v_pcs, v_pcs, pg_temp.d(p_day), v_pl.id, v_pl.batch_no,
            v_digit::TEXT || lpad(v_pl.batch_no::TEXT, 4, '0'), pg_temp.ts(p_day, 11),
            'pack', 'production_lots', v_pl.id, 'production_lot #' || v_pl.id, 'Putri Packing')
        RETURNING id INTO v_lot;
    ELSE
        UPDATE public.packed_coffee_lots SET quantity_pcs = quantity_pcs + v_pcs WHERE id = v_lot;
        PERFORM public.refund_packed_lot(v_lot, v_pcs, 'pack', 'production_lots', v_pl.id, NULL, 'Putri Packing');
    END IF;
    UPDATE public.packing_records SET packed_coffee_lot_id = v_lot WHERE id = v_rec;

    PERFORM public.consume_bulk_lot(b.id, round(v_pcs * p_size / 1000.0, 3), 'pack', NULL, NULL,
                                    'Packed ' || v_pcs || 'x' || p_size || 'g', 'Putri Packing');
    RETURN v_lot;
END $$;

-- Sales request with its lines. p_items: [{"t":"Single"|"Blend","id":n,"m":machine,"g":grams,"q":bags}].
-- order_number = {agent code}{DDMMYY}{NNN}, as the Sales Request modal builds it.
CREATE OR REPLACE FUNCTION pg_temp.new_order(p_day INTEGER, p_cust TEXT, p_items JSONB, p_status TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE c public.customers%ROWTYPE; v_agent TEXT; v_seq INTEGER; v_order INTEGER; it JSONB; v_decided BOOLEAN;
BEGIN
    SELECT * INTO c FROM public.customers WHERE customer_id = p_cust;
    SELECT code INTO v_agent FROM public.sales_agents WHERE name = c.owner_sales_name;
    SELECT COUNT(*) + 1 INTO v_seq FROM public.request_orders WHERE order_number LIKE '%' || to_char(pg_temp.d(p_day), 'DDMMYY') || '___';
    v_decided := p_status NOT IN ('Pending Approval');
    INSERT INTO public.request_orders (order_number, order_date, status, customer_id, sales_name, order_type, notes,
        decided_by_name, decided_at, created_at)
    VALUES (v_agent || to_char(pg_temp.d(p_day), 'DDMMYY') || lpad(v_seq::TEXT, 3, '0'), pg_temp.d(p_day), p_status, c.id,
        c.owner_sales_name, c.type, NULL,
        CASE WHEN v_decided THEN 'Hendra Leader' END, CASE WHEN v_decided THEN pg_temp.ts(p_day, 13) END, pg_temp.ts(p_day, 9))
    RETURNING id INTO v_order;
    FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        INSERT INTO public.request_order_items (request_order_id, coffee_type, single_coffee_id, blend_recipe_id, machine_id,
            bag_size_g, quantity_requested, quantity_allocated, quantity_pending, item_status, created_at)
        VALUES (v_order, it->>'t',
            CASE WHEN it->>'t' = 'Single' THEN (it->>'id')::INTEGER END,
            CASE WHEN it->>'t' = 'Blend' THEN (it->>'id')::INTEGER END,
            (it->>'m')::INTEGER, (it->>'g')::INTEGER, (it->>'q')::INTEGER,
            CASE WHEN v_decided THEN (it->>'q')::INTEGER ELSE 0 END,
            CASE WHEN v_decided THEN 0 ELSE (it->>'q')::INTEGER END,
            CASE WHEN p_status = 'Preparing' THEN 'Packing' ELSE 'Pending Approval' END,
            pg_temp.ts(p_day, 9));
    END LOOP;
    RETURN v_order;
END $$;

-- Packing checkout + dispatch: each line drawn FIFO from packed lots that
-- existed that day (packed_date, then id — the checkout modal's order),
-- recorded in dispatch_lot_items. A line that can't be fully covered is
-- finished as unfulfilled (the modal's "finish" choice). p_with_lots = false
-- for history older than lot tracking: the line is simply marked shipped.
CREATE OR REPLACE FUNCTION pg_temp.dispatch(p_order INTEGER, p_day INTEGER, p_with_lots BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE o public.request_orders%ROWTYPE; i RECORD; l RECORD; v_need INTEGER; v_taken INTEGER; v_got INTEGER;
        v_name TEXT; v_total INTEGER := 0;
BEGIN
    SELECT * INTO o FROM public.request_orders WHERE id = p_order;
    FOR i IN SELECT * FROM public.request_order_items WHERE request_order_id = p_order ORDER BY id LOOP
        v_got := 0;
        IF p_with_lots THEN
            IF i.coffee_type = 'Single' THEN SELECT name INTO v_name FROM public.green_coffee WHERE id = i.single_coffee_id;
            ELSE SELECT name INTO v_name FROM public.blend_recipes WHERE id = i.blend_recipe_id; END IF;
            v_need := i.quantity_requested;
            FOR l IN SELECT pl.id FROM public.packed_coffee_lots pl JOIN public.packed_coffee pc ON pc.id = pl.packed_coffee_id
                     WHERE lower(pc.custom_coffee_name) = lower(v_name) AND pc.bag_size_g = i.bag_size_g AND pc.machine_id = i.machine_id
                       AND pl.remaining_pcs > 0 AND pl.packed_date <= pg_temp.d(p_day)
                     ORDER BY pl.packed_date, pl.id LOOP
                EXIT WHEN v_need <= 0;
                v_taken := public.consume_packed_lot(l.id, v_need, 'dispatch', 'request_order_items', i.id,
                                                     'Checkout ' || o.order_number, 'Putri Packing');
                IF v_taken > 0 THEN
                    INSERT INTO public.dispatch_lot_items (request_order_item_id, packed_coffee_lot_id, customer_id, qty, created_at)
                    VALUES (i.id, l.id, o.customer_id, v_taken, pg_temp.ts(p_day, 15));
                    v_need := v_need - v_taken; v_got := v_got + v_taken;
                END IF;
            END LOOP;
        ELSE
            v_got := i.quantity_requested;
        END IF;
        UPDATE public.request_order_items
        SET quantity_allocated = i.quantity_requested, quantity_pending = 0, quantity_prepared = v_got,
            quantity_unfulfilled = i.quantity_requested - v_got, item_status = 'Ready for Handover'
        WHERE id = i.id;
        v_total := v_total + v_got;
    END LOOP;
    UPDATE public.request_orders
    SET status = CASE WHEN v_total > 0 THEN 'Dispatched' ELSE 'Unable to Fulfill' END,
        dispatch_date = CASE WHEN v_total > 0 THEN pg_temp.d(GREATEST(p_day - 1, 0)) END,
        dispatched_by = CASE WHEN v_total > 0 THEN 'Putri Packing' END,
        decided_by_name = 'Hendra Leader', decided_at = pg_temp.ts(p_day, 13),
        decision_note = CASE WHEN v_total = 0 THEN 'Out of stock' END
    WHERE id = p_order;
END $$;

-- 3. Master data.
INSERT INTO public.machines (id, code, name, capacity_g, ideal_batch_size_g) VALUES
    (1, 'M1', 'Probat P5 (Machine #1)', 5000, 5000),
    (2, 'M2', 'Giesen W6 (Machine #2)', 6000, 6000),
    (3, 'M3', 'Sample Roaster 1kg', 1000, 1000);

INSERT INTO public.packaging_sizes (id, label, gram, weight_g, is_visible, min_stock, carton_multiplier, size_digit) VALUES
    (1, '250g', 250, 250, TRUE, 20, 20, 1),
    (2, '500g', 500, 500, TRUE, 10, 12, 2),
    (3, '1000g', 1000, 1000, TRUE, 5, 6, 3);

INSERT INTO public.code_definitions (code, name) VALUES
    ('11', 'Gayo Highland'), ('12', 'Toraja Sunrise'), ('13', 'Kintamani Bright'),
    ('14', 'Robusta Strong'), ('15', 'Flores Classic'), ('21', 'House Espresso');

INSERT INTO public.green_coffee (id, code, name, origin, process, purchase_price_per_kg, supplier, purchase_date) VALUES
    (1, '11', 'Aceh Gayo Arabica',      'Aceh, Indonesia',            'Wet Hulled', 9.20,  'Gayo Highland Cooperative', pg_temp.d(80)),
    (2, '12', 'Toraja Sapan Arabica',   'South Sulawesi, Indonesia',  'Natural',    11.50, 'Sapan Valley Estate',       pg_temp.d(75)),
    (3, '13', 'Bali Kintamani Arabica', 'Bali, Indonesia',            'Honey',      10.40, 'Kintamani Farmers Union',   pg_temp.d(72)),
    (4, '14', 'Sidikalang Robusta',     'North Sumatra, Indonesia',   'Full Wash',  4.80,  'Dairi Robusta Collective',  pg_temp.d(90)),
    (5, '15', 'Flores Bajawa Arabica',  'Flores, Indonesia',          'Wet Hulled', 9.80,  'Bajawa Growers Group',      pg_temp.d(100));

INSERT INTO public.blend_recipes (id, code, name, description, machine_id, batch_size_g) VALUES
    (1, '21', 'House Espresso Blend', 'Kintamani brightness over a Robusta base — the cafe espresso.', 2, 6000);
INSERT INTO public.blend_ingredients (blend_recipe_id, green_coffee_id, percentage, quantity_g) VALUES
    (1, 3, 60, 3600), (1, 4, 40, 2400);

INSERT INTO public.sales_agents (id, name, code, phone, email, region) VALUES
    (1, 'Rina Sales',  'RS', '+62 811 0000 001', 'rina@demo-roastery.test',  'Jakarta'),
    (2, 'Dimas Sales', 'DS', '+62 811 0000 002', 'dimas@demo-roastery.test', 'Bandung');

-- owner_sales_id is linked to the real test accounts by seed_test_users.sql.
INSERT INTO public.customers (id, customer_id, name, type, contact_person, phone, city, address, is_active,
                              owner_sales_name, owner_since, created_by_name, created_at) VALUES
    (1,  'WHL-001', 'Kedai Senja',             'Wholesale',   'Arif',  '+62 812 1000 001', 'Jakarta',  'Jl. Senja 12',      TRUE, 'Rina Sales',  pg_temp.ts(240), 'Rina Sales',  pg_temp.ts(240)),
    (2,  'WHL-002', 'Hotel Cendana',           'Wholesale',   'Lina',  '+62 812 1000 002', 'Bandung',  'Jl. Cendana 3',     TRUE, 'Dimas Sales', pg_temp.ts(230), 'Dimas Sales', pg_temp.ts(230)),
    (3,  'WHL-003', 'Cafe Daun Hijau',         'Wholesale',   'Yogi',  '+62 812 1000 003', 'Bandung',  'Jl. Dago 88',       TRUE, 'Rina Sales',  pg_temp.ts(200), 'Rina Sales',  pg_temp.ts(200)),
    (4,  'WHL-004', 'Warung Kopi Pojok',       'Wholesale',   'Bayu',  '+62 812 1000 004', 'Bogor',    'Jl. Pojok 1',       TRUE, 'Dimas Sales', pg_temp.ts(260), 'Dimas Sales', pg_temp.ts(260)),
    (5,  'RTL-001', 'Budi Santoso',            'Retail',      NULL,    '+62 813 2000 001', 'Jakarta',  NULL,                TRUE, 'Rina Sales',  pg_temp.ts(190), 'Rina Sales',  pg_temp.ts(190)),
    (6,  'RTL-002', 'Siti Rahma',              'Retail',      NULL,    '+62 813 2000 002', 'Depok',    NULL,                TRUE, 'Rina Sales',  pg_temp.ts(25),  'Rina Sales',  pg_temp.ts(25)),
    (7,  'RTL-003', 'Andi Wijaya',             'Retail',      NULL,    '+62 813 2000 003', 'Tangerang', NULL,               TRUE, 'Dimas Sales', pg_temp.ts(8),   'Dimas Sales', pg_temp.ts(8)),
    (8,  'RTL-004', 'Maya Putri',              'Retail',      NULL,    '+62 813 2000 004', 'Jakarta',  NULL,                TRUE, 'Dimas Sales', pg_temp.ts(70),  'Dimas Sales', pg_temp.ts(70)),
    (9,  'SPM-001', 'FreshMart Kemang',        'Supermarket', 'Rudi',  '+62 814 3000 001', 'Jakarta',  'Jl. Kemang Raya 5', TRUE, 'Dimas Sales', pg_temp.ts(120), 'Dimas Sales', pg_temp.ts(120)),
    (10, 'SPM-002', 'Pasar Segar Supermarket', 'Supermarket', 'Wati',  '+62 814 3000 002', 'Bekasi',   'Jl. Pasar 20',      TRUE, 'Rina Sales',  pg_temp.ts(130), 'Rina Sales',  pg_temp.ts(130)),
    (11, 'SPM-003', 'Grand Mart BSD',          'Supermarket', 'Joko',  '+62 814 3000 003', 'Tangerang', 'BSD City Blok A',  TRUE, 'Dimas Sales', pg_temp.ts(12),  'Dimas Sales', pg_temp.ts(12));
INSERT INTO public.customer_owner_history (customer_id, to_sales_name, changed_by_name, changed_at, note)
SELECT id, owner_sales_name, created_by_name, created_at, 'Customer created' FROM public.customers;

-- 4. The timeline. Each event is (day offset, kind, args); replayed oldest first.
DROP TABLE IF EXISTS pg_temp.seed_event;
CREATE TEMP TABLE seed_event (day INTEGER, ord INTEGER, kind TEXT, args JSONB);

-- Arrivals: Gayo's OLD lot (day -80) is the FIFO fixture; the NEW one (-25)
-- must still be untouched at the end.
INSERT INTO seed_event VALUES
    (100, 0, 'intake', '{"gc":5,"kg":15,"price":9.80,"sup":"Bajawa Growers Group"}'),
    (90,  0, 'intake', '{"gc":4,"kg":30,"price":4.80,"sup":"Dairi Robusta Collective"}'),
    (80,  0, 'intake', '{"gc":1,"kg":130,"price":9.20,"sup":"Gayo Highland Cooperative"}'),
    (75,  0, 'intake', '{"gc":2,"kg":35,"price":11.50,"sup":"Sapan Valley Estate"}'),
    (72,  0, 'intake', '{"gc":3,"kg":40,"price":10.40,"sup":"Kintamani Farmers Union"}'),
    (35,  0, 'intake', '{"gc":4,"kg":50,"price":5.10,"sup":"Dairi Robusta Collective"}'),
    (25,  0, 'intake', '{"gc":1,"kg":60,"price":9.60,"sup":"Gayo Highland Cooperative"}'),
    (15,  0, 'intake', '{"gc":2,"kg":40,"price":11.90,"sup":"Sapan Valley Estate"}');

-- Roasts: {"t","id","m","in":[batch kg...],"y":yield,"deg":agtron}
INSERT INTO seed_event (day, ord, kind, args)
SELECT day, 1, 'roast', args::JSONB FROM (VALUES
    (85, '{"t":"Single","id":5,"m":1,"in":[5,5],"y":0.84,"deg":62}'),
    (74, '{"t":"Single","id":1,"m":1,"in":[5,5,5,5],"y":0.84,"deg":58}'),
    (70, '{"t":"Single","id":2,"m":1,"in":[5,5],"y":0.84,"deg":64}'),
    (66, '{"t":"Blend","id":1,"m":2,"in":[6,6],"y":0.85,"deg":52}'),
    (60, '{"t":"Single","id":1,"m":1,"in":[5,5,5,5],"y":0.84,"deg":58}'),
    (56, '{"t":"Single","id":4,"m":2,"in":[6,6],"y":0.83,"deg":48}'),
    (49, '{"t":"Single","id":2,"m":1,"in":[5,5],"y":0.84,"deg":63}'),
    (46, '{"t":"Single","id":1,"m":1,"in":[5,5,5,5],"y":0.84,"deg":57}'),
    (45, '{"t":"Blend","id":1,"m":2,"in":[6,6],"y":0.85,"deg":51}'),
    (32, '{"t":"Single","id":1,"m":1,"in":[5,5,5,5],"y":0.84,"deg":59}'),
    (28, '{"t":"Single","id":2,"m":1,"in":[5,5],"y":0.84,"deg":64}'),
    (24, '{"t":"Blend","id":1,"m":2,"in":[6,6],"y":0.85,"deg":52}'),
    (21, '{"t":"Single","id":4,"m":2,"in":[6,6],"y":0.83,"deg":47}'),
    (18, '{"t":"Single","id":1,"m":1,"in":[5,5,5,5],"y":0.84,"deg":58}'),
    (7,  '{"t":"Single","id":2,"m":1,"in":[6,4],"y":0.84,"deg":63}'),
    (4,  '{"t":"Single","id":1,"m":1,"in":[5,5,5,5],"y":0.84,"deg":58}'),
    (3,  '{"t":"Blend","id":1,"m":2,"in":[6,6],"y":0.85,"deg":52}')
) AS r(day, args);

-- Packing, the day after each roast: {"t","id","m","rd":roast day,"sizes":[[g,pcs],...]}
-- The last Gayo roast (-4) is only partly packed and the last blend roast (-3)
-- not at all, so Ready to Pack has bulk waiting.
INSERT INTO seed_event (day, ord, kind, args)
SELECT day, 2, 'pack', args::JSONB FROM (VALUES
    (84, '{"t":"Single","id":5,"m":1,"rd":85,"sizes":[[250,30]]}'),
    (73, '{"t":"Single","id":1,"m":1,"rd":74,"sizes":[[250,26],[500,10],[1000,5]]}'),
    (69, '{"t":"Single","id":2,"m":1,"rd":70,"sizes":[[250,20],[1000,3]]}'),
    (65, '{"t":"Blend","id":1,"m":2,"rd":66,"sizes":[[1000,10]]}'),
    (59, '{"t":"Single","id":1,"m":1,"rd":60,"sizes":[[250,26],[500,10],[1000,5]]}'),
    (55, '{"t":"Single","id":4,"m":2,"rd":56,"sizes":[[500,10],[1000,4]]}'),
    (48, '{"t":"Single","id":2,"m":1,"rd":49,"sizes":[[250,20],[1000,3]]}'),
    (45, '{"t":"Single","id":1,"m":1,"rd":46,"sizes":[[250,26],[500,10],[1000,5]]}'),
    (44, '{"t":"Blend","id":1,"m":2,"rd":45,"sizes":[[1000,10]]}'),
    (31, '{"t":"Single","id":1,"m":1,"rd":32,"sizes":[[250,26],[500,10],[1000,5]]}'),
    (27, '{"t":"Single","id":2,"m":1,"rd":28,"sizes":[[250,20],[1000,3]]}'),
    (23, '{"t":"Blend","id":1,"m":2,"rd":24,"sizes":[[1000,10]]}'),
    (20, '{"t":"Single","id":4,"m":2,"rd":21,"sizes":[[500,10],[1000,4]]}'),
    (17, '{"t":"Single","id":1,"m":1,"rd":18,"sizes":[[250,26],[500,10],[1000,5]]}'),
    (6,  '{"t":"Single","id":2,"m":1,"rd":7,"sizes":[[250,20],[1000,3]]}'),
    (3,  '{"t":"Single","id":1,"m":1,"rd":4,"sizes":[[250,20]]}')
) AS p(day, args);

-- Shipped orders. Recurring patterns per customer drive the CRM page:
--   cust, first day, every n days, last day, items
-- Older than 60 days = history from before lot tracking (no lot links);
-- the last 60 days are checked out from real packed lots.
INSERT INTO seed_event (day, ord, kind, args)
SELECT g.day, 3, 'order', jsonb_build_object('cust', s.cust, 'items', s.items::JSONB)
FROM (VALUES
    ('WHL-001', 196, 14, 14,  '[{"t":"Single","id":1,"m":1,"g":1000,"q":3},{"t":"Blend","id":1,"m":2,"g":1000,"q":2}]'),  -- steady
    ('WHL-002', 189, 21, 21,  '[{"t":"Single","id":2,"m":1,"g":1000,"q":2},{"t":"Blend","id":1,"m":2,"g":1000,"q":3}]'),  -- steady, due now
    ('WHL-003', 155, 20, 35,  '[{"t":"Single","id":1,"m":1,"g":500,"q":4},{"t":"Single","id":4,"m":2,"g":1000,"q":2}]'), -- slipping
    ('WHL-004', 240, 30, 120, '[{"t":"Single","id":4,"m":2,"g":1000,"q":3}]'),                                          -- dormant
    ('RTL-001', 180, 30, 30,  '[{"t":"Single","id":1,"m":1,"g":250,"q":2},{"t":"Single","id":2,"m":1,"g":250,"q":1}]'),  -- monthly
    ('RTL-002', 20,  1,  20,  '[{"t":"Single","id":2,"m":1,"g":250,"q":2}]'),                                          -- ordered once
    ('RTL-004', 60,  10, 10,  '[{"t":"Single","id":1,"m":1,"g":250,"q":1},{"t":"Single","id":5,"m":1,"g":250,"q":1}]'),  -- frequent
    ('SPM-001', 98,  7,  7,   '[{"t":"Single","id":1,"m":1,"g":250,"q":6},{"t":"Single","id":2,"m":1,"g":250,"q":4}]'),  -- weekly
    ('SPM-002', 100, 10, 40,  '[{"t":"Single","id":1,"m":1,"g":500,"q":4}]'),                                          -- slipping
    ('SPM-003', 9,   1,  9,   '[{"t":"Single","id":1,"m":1,"g":250,"q":6},{"t":"Single","id":4,"m":2,"g":500,"q":4}]')   -- new
) AS s(cust, first_day, every_n, last_day, items)
CROSS JOIN LATERAL generate_series(s.first_day, s.last_day, -s.every_n) AS g(day);

-- 5. Replay.
DO $$
DECLARE e RECORD; v_in NUMERIC; v_size JSONB; v_order INTEGER;
        v_psm BIGINT; v_bsm BIGINT; v_psm_after BIGINT; v_bsm_after BIGINT;
BEGIN
    FOR e IN SELECT * FROM seed_event ORDER BY day DESC, ord LOOP
        SELECT COALESCE(MAX(id), 0) INTO v_psm FROM public.packed_stock_movements;
        SELECT COALESCE(MAX(id), 0) INTO v_bsm FROM public.bulk_stock_movements;

        IF e.kind = 'intake' THEN
            PERFORM pg_temp.intake((e.args->>'gc')::INTEGER, e.day, (e.args->>'kg')::NUMERIC,
                                   (e.args->>'price')::NUMERIC, e.args->>'sup');
        ELSIF e.kind = 'roast' THEN
            FOR v_in IN SELECT jsonb_array_elements_text(e.args->'in')::NUMERIC LOOP
                PERFORM pg_temp.roast(e.day, e.args->>'t', (e.args->>'id')::INTEGER, (e.args->>'m')::INTEGER,
                                      v_in, (e.args->>'y')::NUMERIC, (e.args->>'deg')::NUMERIC);
            END LOOP;
        ELSIF e.kind = 'pack' THEN
            FOR v_size IN SELECT * FROM jsonb_array_elements(e.args->'sizes') LOOP
                PERFORM pg_temp.pack(e.day, e.args->>'t', (e.args->>'id')::INTEGER, (e.args->>'m')::INTEGER,
                                     (e.args->>'rd')::INTEGER, (v_size->>0)::INTEGER, (v_size->>1)::INTEGER);
            END LOOP;
        ELSIF e.kind = 'order' THEN
            v_order := pg_temp.new_order(e.day, e.args->>'cust', e.args->'items', 'Preparing');
            PERFORM pg_temp.dispatch(v_order, e.day, e.day <= 60);
        END IF;

        -- Ledger rows were stamped "now" by their triggers; move them to the
        -- day they belong to so Stock History reads as a real timeline.
        SELECT COALESCE(MAX(id), 0) INTO v_psm_after FROM public.packed_stock_movements;
        SELECT COALESCE(MAX(id), 0) INTO v_bsm_after FROM public.bulk_stock_movements;
        UPDATE public.packed_stock_movements SET created_at = pg_temp.ts(e.day, 9 + e.ord * 2) WHERE id > v_psm AND id <= v_psm_after;
        UPDATE public.bulk_stock_movements  SET created_at = pg_temp.ts(e.day, 9 + e.ord * 2) WHERE id > v_bsm AND id <= v_bsm_after;
    END LOOP;
END $$;

-- Packers close the scale-difference leftover on each bulk card two days
-- after packing (Close Lot: waste row + set_bulk_lot_available to 0, as
-- js/packing.js does). The last 10 days stay open, so Ready to Pack still has
-- a small leftover to close and the two big unpacked cards.
DO $$
DECLARE b RECORD; v_waste INTEGER; v_lot TEXT; v_bsm BIGINT;
BEGIN
    FOR b IN SELECT * FROM public.bulk_roasted_coffee
             WHERE bulk_available > 0 AND bulk_available < 1 AND production_date < CURRENT_DATE - 10
             ORDER BY production_date, id LOOP
        SELECT lot_code INTO v_lot FROM public.production_lots WHERE bulk_roasted_coffee_id = b.id;
        INSERT INTO public.waste_inventory (source_type, source_name, bulk_roasted_coffee_id, waste_kg, discard_date, reason, recorded_by, created_at)
        VALUES ('Bulk', b.coffee_name || ' (' || COALESCE(v_lot, '-') || ')', b.id, b.bulk_available, b.production_date + 3,
                'Finished — scale difference', 'Putri Packing', b.production_date + 3 + TIME '16:00')
        RETURNING id INTO v_waste;
        SELECT COALESCE(MAX(id), 0) INTO v_bsm FROM public.bulk_stock_movements;
        PERFORM public.set_bulk_lot_available(b.id, 0, 'close_lot', 'waste_inventory', v_waste, 'Finished — scale difference', 'Putri Packing');
        UPDATE public.bulk_stock_movements SET created_at = b.production_date + 3 + TIME '16:00' WHERE id > v_bsm;
    END LOOP;
END $$;

-- 6. Open work for the demo / tests (left exactly where a user would find it).
SELECT pg_temp.new_order(2, 'WHL-001', '[{"t":"Single","id":1,"m":1,"g":1000,"q":3},{"t":"Blend","id":1,"m":2,"g":1000,"q":2}]', 'Preparing');
SELECT pg_temp.new_order(1, 'SPM-003', '[{"t":"Single","id":1,"m":1,"g":250,"q":6}]', 'Pending Approval');
SELECT pg_temp.new_order(0, 'WHL-002', '[{"t":"Single","id":2,"m":1,"g":1000,"q":2},{"t":"Blend","id":1,"m":2,"g":1000,"q":3}]', 'Pending Approval');

-- 7. Other items (stock goes through the RPCs, so the ledger is complete).
INSERT INTO public.other_items (id, name, unit, stock_qty, min_stock, notes, created_at) VALUES
    (1, 'V60 Paper Filter (100 pcs)', 'box',  0, 10, 'Resold as-is', pg_temp.ts(60)),
    (2, 'Ceramic Cup 8oz',            'pcs',  0, 12, NULL,           pg_temp.ts(60)),
    (3, 'Demo Roastery Tote Bag',     'pcs',  0, 10, 'Merchandise',  pg_temp.ts(45));
SELECT public.other_item_stock_in(1, 50, pg_temp.d(60), 'Initial stock', 'Hendra Leader');
SELECT public.other_item_stock_in(2, 36, pg_temp.d(60), 'Initial stock', 'Hendra Leader');
SELECT public.other_item_stock_in(3, 15, pg_temp.d(45), 'First batch from vendor', 'Hendra Leader');
SELECT public.other_item_consume(1, 12, 'release', 'Sample', NULL, NULL, pg_temp.d(30), 'Cafe trial kits', 'Putri Packing');
SELECT public.other_item_consume(3, 7, 'release', 'Marketing', NULL, NULL, pg_temp.d(10), 'Coffee festival booth', 'Putri Packing');
UPDATE public.other_item_movements m SET created_at = m.movement_date + TIME '10:00';

-- 8. Purchase requests (one per status the approval page shows).
INSERT INTO public.purchase_requests (id, request_number, category, status, purpose, needed_by, requested_by_name,
                                      request_date, decided_by_name, decided_at, decision_note, created_at) VALUES
    (1, 'PR-' || to_char(pg_temp.d(20), 'YYMMDD') || '-001', 'Equipment', 'Approved', 'Replace worn grinder burrs on the QC grinder',
        pg_temp.d(5), 'Gavin Roaster', pg_temp.d(20), 'Hendra Leader', pg_temp.ts(19, 14), NULL, pg_temp.ts(20)),
    (2, 'PR-' || to_char(pg_temp.d(9), 'YYMMDD') || '-001', 'Raw Materials', 'Rejected', 'Valve bags 1kg — current stock low',
        pg_temp.d(2), 'Putri Packing', pg_temp.d(9), 'Hendra Leader', pg_temp.ts(8, 14), 'Supplier delivery already scheduled', pg_temp.ts(9)),
    (3, 'PR-' || to_char(pg_temp.d(1), 'YYMMDD') || '-001', 'Housekeeping Supplies', 'Requested', 'Cleaning tablets for the espresso machine',
        pg_temp.d(-7), 'Putri Packing', pg_temp.d(1), NULL, NULL, NULL, pg_temp.ts(1));
INSERT INTO public.purchase_request_items (purchase_request_id, item_name, qty, unit, estimated_price) VALUES
    (1, 'Burr set 64mm', 1, 'set', 85), (2, 'Valve bag 1kg kraft', 500, 'pcs', 0.35),
    (3, 'Cleaning tablets', 2, 'box', 18), (3, 'Microfiber cloth', 10, 'pcs', NULL);

-- 9. Settings that drive alerts: Flores (5 kg left) shows as low stock.
UPDATE public.company_settings SET min_stock_greenbean_kg = 10 WHERE id = 1;

-- 10. Explicit ids above → move every sequence past them.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT c.table_name, c.column_name, pg_get_serial_sequence('public.' || c.table_name, c.column_name) AS seq
             FROM information_schema.columns c
             WHERE c.table_schema = 'public' AND c.column_default LIKE 'nextval(%'
               AND pg_get_serial_sequence('public.' || c.table_name, c.column_name) IS NOT NULL LOOP
        EXECUTE format('SELECT setval(%L, GREATEST((SELECT COALESCE(MAX(%I), 0) FROM public.%I), 1))', r.seq, r.column_name, r.table_name);
    END LOOP;
END $$;

-- 11. Self-check: the invariants the app depends on, and the fixtures tests rely on.
DO $$
DECLARE v_bad INTEGER; v_old NUMERIC; v_new NUMERIC;
BEGIN
    SELECT COUNT(*) INTO v_bad FROM public.green_coffee g
    WHERE g.stock_kg <> (SELECT COALESCE(SUM(remaining_kg), 0) FROM public.green_coffee_lots WHERE green_coffee_id = g.id);
    IF v_bad > 0 THEN RAISE EXCEPTION 'check failed: green_coffee.stock_kg out of sync on % rows', v_bad; END IF;

    SELECT COUNT(*) INTO v_bad FROM public.packed_coffee p
    WHERE p.quantity <> (SELECT COALESCE(SUM(remaining_pcs), 0) FROM public.packed_coffee_lots WHERE packed_coffee_id = p.id);
    IF v_bad > 0 THEN RAISE EXCEPTION 'check failed: packed_coffee.quantity out of sync on % rows', v_bad; END IF;

    SELECT COUNT(*) INTO v_bad FROM public.packed_coffee_lots l
    WHERE l.remaining_pcs <> (SELECT COALESCE(SUM(delta_pcs), 0) FROM public.packed_stock_movements WHERE packed_coffee_lot_id = l.id);
    IF v_bad > 0 THEN RAISE EXCEPTION 'check failed: packed ledger does not sum to remaining_pcs on % lots', v_bad; END IF;

    SELECT COUNT(*) INTO v_bad FROM public.bulk_roasted_coffee b
    WHERE round(b.bulk_available, 3) <> round((SELECT COALESCE(SUM(delta_kg), 0) FROM public.bulk_stock_movements WHERE bulk_roasted_coffee_id = b.id), 3);
    IF v_bad > 0 THEN RAISE EXCEPTION 'check failed: bulk ledger does not sum to bulk_available on % cards', v_bad; END IF;

    SELECT COUNT(*) INTO v_bad FROM public.roast_batches r
    WHERE abs(r.input_weight_kg - (SELECT COALESCE(SUM(kg_consumed), 0) FROM public.roast_batch_green_lots WHERE roast_batch_id = r.id)) > 0.001;
    IF v_bad > 0 THEN RAISE EXCEPTION 'check failed: % roast batches did not draw exactly their input weight', v_bad; END IF;

    SELECT remaining_kg INTO v_old FROM public.green_coffee_lots WHERE green_coffee_id = 1 ORDER BY arrival_date LIMIT 1;
    SELECT remaining_kg INTO v_new FROM public.green_coffee_lots WHERE green_coffee_id = 1 ORDER BY arrival_date DESC LIMIT 1;
    IF v_old <> 10 OR v_new <> 60 THEN
        RAISE EXCEPTION 'check failed: FIFO fixture expected Gayo old lot 10 kg / new lot 60 kg, got % / %', v_old, v_new;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.roast_batch_green_lots GROUP BY roast_batch_id HAVING COUNT(*) > 1
                   AND MIN(green_coffee_lot_id) IN (SELECT id FROM public.green_coffee_lots WHERE green_coffee_id = 2)) THEN
        RAISE EXCEPTION 'check failed: expected one Toraja batch drawing from two lots';
    END IF;

    IF EXISTS (SELECT 1 FROM public.packed_coffee_lots WHERE production_lot_id IS NULL OR strip_code IS NULL) THEN
        RAISE EXCEPTION 'check failed: a packed lot has no production lot or strip code (traceability broken)';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
