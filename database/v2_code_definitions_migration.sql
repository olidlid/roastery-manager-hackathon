-- V2: Code Definitions — "trade name" grouping for Sales.
--
-- One green_coffee.code can be reused across multiple green_coffee rows over
-- time (e.g. code 2 = both Cauca and Chambaku) as the actual physical origin
-- behind a trade name changes while the code/commercial name stays fixed.
-- code_definitions maps that code to the stable name Sales sees ("Fantastica"
-- for code 2), with stock shown as the total across every origin sharing it.
--
-- request_order_items.coffee_code (nullable) is set, with single_coffee_id
-- left NULL, when a Sales Request item is such a trade-name product rather
-- than one specific green_coffee row — fulfillment (packing/dispatch) can
-- then draw from any green_coffee sharing that code, FIFO-recommended.
--
-- Applied to production via mcp__supabase__apply_migration on 2026-07-21.
-- See js/settings.js (Code Definitions CRUD), js/sales.js
-- (openSalesRequestModal coffee picker + resolveOrderItemCoffeeName), and
-- js/packing.js (openDispatchCheckoutModal FIFO lot pool) for where this is
-- read/applied.

CREATE TABLE IF NOT EXISTS public.code_definitions (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.code_definitions IS
    'Trade-name definitions: maps a green_coffee.code value to a stable sales-facing product name, decoupling the commercial name from whichever physical origin currently backs it.';

ALTER TABLE public.request_order_items ADD COLUMN IF NOT EXISTS coffee_code TEXT;

COMMENT ON COLUMN public.request_order_items.coffee_code IS
    'Set (with single_coffee_id left NULL) when this item is a trade-name product from code_definitions rather than one specific green_coffee row. Fulfillment can draw from any green_coffee sharing this code.';

ALTER TABLE public.code_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.code_definitions;
CREATE POLICY full_access ON public.code_definitions FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
