-- ============================================================================
-- FIX: custom_roles RLS drift (DELETE/UPDATE silently no-op)
-- Run this in your Supabase SQL Editor, then hard-refresh the app.
-- ============================================================================
-- Found 2026-07-09 while cleaning up test data before go-live: DELETE and
-- UPDATE against public.custom_roles returned HTTP 200 with an empty result
-- (no error) and the row was left untouched — the classic PostgREST symptom
-- of an RLS policy that doesn't match what supabase_schema.sql documents.
-- Same root cause as the profiles UPDATE drift fixed 2026-07-06 (see
-- CLAUDE.md "Database Schema" section): production's actual policy on this
-- table no longer matches the generic full_access policy the schema file
-- says every table should have. This also means the "Delete Role" button in
-- Settings → Role Management has been silently failing for every admin.

ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON public.custom_roles;
CREATE POLICY full_access ON public.custom_roles FOR ALL USING (true) WITH CHECK (true);

-- PostgREST caches the schema — without this the REST API can keep serving
-- the old (broken) behavior. Run twice if the first NOTIFY doesn't take.
NOTIFY pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- Once the policy above is confirmed fixed (try deleting a role from the
-- Settings UI, or re-run the delete below), clean up the test roles found
-- during the same audit:
-- DELETE FROM public.custom_roles WHERE id IN (13, 14, 15, 16); -- Roaster 2, HUHUHU, jiji, ihugu
