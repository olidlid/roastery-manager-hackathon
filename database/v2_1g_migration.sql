-- ============================================================================
-- V2 PHASE 1 — 1G PACKED COFFEE DISPATCH FIFO: SCHEMA ADDITIONS
-- Applied to production 2026-07-16 via Supabase MCP.
-- See V2_ROADMAP.md section "1G" for the full design rationale.
-- ============================================================================

-- V2 1G: configurable carton pack-count per packaging size. NULL means no
-- carton label option configured for this size yet (Ready to Pack's Print
-- Barcode step only offers a Carton option for sizes where this is set).
ALTER TABLE public.packaging_sizes ADD COLUMN IF NOT EXISTS carton_multiplier NUMERIC;

NOTIFY pgrst, 'reload schema';
