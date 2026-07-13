-- ============================================================================
-- MIGRATION: company_settings.label_layout (2026-07-13)
-- Run this in your Supabase SQL Editor, then hard-refresh the app.
-- ============================================================================
-- Backs the new Settings → Production → Label Layout checklists: which text
-- fields print alongside each sticker's barcode. Both the roasting batch log
-- sticker (printStickerLabel, js/roasting.js) and the packed coffee lot
-- sticker (printLotBarcodeLabels, js/packing.js) are now a fixed 50x25mm with
-- a scannable CODE128 barcode that always prints (batch_code / lot_code
-- respectively) — this column only controls the optional text lines below it.
--
-- A single JSONB column (not one boolean column per field, unlike the older
-- label_show_* columns) so future field additions don't need another
-- migration — just a new key in the JSON.

ALTER TABLE public.company_settings
ADD COLUMN IF NOT EXISTS label_layout JSONB DEFAULT '{"roasting":{"coffee_name":true,"machine":true,"coffee_code":true},"packed":{"code":true,"coffee_name":true,"dates":true,"machine":true}}'::jsonb;

-- Backfill the existing row (id=1) in case it predates this column and ended
-- up with NULL instead of the column default.
UPDATE public.company_settings
SET label_layout = '{"roasting":{"coffee_name":true,"machine":true,"coffee_code":true},"packed":{"code":true,"coffee_name":true,"dates":true,"machine":true}}'::jsonb
WHERE id = 1 AND label_layout IS NULL;

-- PostgREST caches the schema — without this the REST API can 404/ignore the
-- new column. Run twice if the first NOTIFY doesn't take.
NOTIFY pgrst, 'reload schema';
