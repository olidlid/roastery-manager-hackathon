-- ============================================================================
-- Edit Return — silent edit log (2026-10-05)
-- ----------------------------------------------------------------------------
-- Every save from the Edit Return modal (js/returns.js openEditReturnModal)
-- writes one row per change: who, when, what, old → new. Kept for
-- investigation only — the app never shows it (user ruling 2026-10-05).
-- Edits never move stock; the processed part of an item is locked.
--
-- No FK on return_id / return_item_id on purpose: the log must outlive a
-- removed item, and return_number is snapshotted so a row stays readable.
--
-- Run in the Supabase SQL Editor, then keep the NOTIFY line.
-- ============================================================================

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

NOTIFY pgrst, 'reload schema';
