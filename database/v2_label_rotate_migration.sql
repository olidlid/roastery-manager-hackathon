-- V2: printer-driver orientation workaround for fixed 50x25mm labels.
--
-- Some thermal printer drivers force their own fixed (portrait) media
-- orientation regardless of the page's own declared @page size, so a
-- correctly-landscape 50x25mm label preview still prints rotated on paper.
-- This is a per-printer quirk, not universal, so it's an opt-in company
-- setting rather than a hardcoded behavior change.
--
-- Applied to production via mcp__supabase__apply_migration on 2026-07-18.
-- See js/app.js (companySettings default), js/settings.js (save handler),
-- index.html (Settings > Production > Label Layout > Print Orientation),
-- js/packing.js (buildFixedLabelDocument), and js/roasting.js
-- (printStickerLabel) for where this flag is read/applied.

ALTER TABLE public.company_settings
    ADD COLUMN IF NOT EXISTS label_rotate_90 BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.company_settings.label_rotate_90 IS
    'Printer-driver workaround: rotates fixed 50x25mm label content 90 degrees for printers that force portrait media regardless of the declared @page size.';

NOTIFY pgrst, 'reload schema';
