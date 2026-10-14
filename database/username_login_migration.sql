-- ============================================================================
-- Username login (2026-10-14)
-- ----------------------------------------------------------------------------
-- The login form takes ONE field that accepts either an email or a username.
-- Supabase Auth still signs in by email, so a username is resolved to its
-- account's email first (resolve_login_email below), then the normal
-- signInWithPassword runs. Every account still has an email in auth.users.
--
-- Usernames are lowercase, 3-30 chars of [a-z0-9._-] and never contain '@',
-- so the login field can tell the two apart by the '@' alone.
--
-- Already folded into supabase_schema.sql; run this file only on a database
-- built before this date. Re-runnable.
-- ============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_username_format') THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_username_format CHECK (username ~ '^[a-z0-9._-]{3,30}$');
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_uniq ON public.profiles (username);

-- Username -> email for the login form. SECURITY DEFINER because anon (not
-- logged in yet) can't read auth.users; it reads the email from auth.users,
-- not profiles.email, since that is the address Auth actually signs in with.
-- Exposes nothing new: profiles (name, email, role) is already readable under
-- the full_access policy. Returns NULL for an unknown username.
CREATE OR REPLACE FUNCTION public.resolve_login_email(p_login TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.email
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE p.username = lower(btrim(p_login))
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_login_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(TEXT) TO anon, authenticated;

-- Signup trigger: take the username from the signup metadata (Settings >
-- Add User sends it). Only a valid, still-free username is stored — anything
-- else becomes NULL, because a constraint violation here would be swallowed
-- by the EXCEPTION block and the new user would silently get NO profile.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_username TEXT := lower(btrim(new.raw_user_meta_data->>'username'));
BEGIN
    IF v_username !~ '^[a-z0-9._-]{3,30}$'
       OR EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username) THEN
        v_username := NULL;
    END IF;
    INSERT INTO public.profiles (id, name, email, role, username, created_at)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        new.email,
        'Roaster',
        v_username,
        NOW()
    );
    RETURN new;
EXCEPTION WHEN others THEN
    RAISE WARNING 'Error in handle_new_user: %', SQLERRM;
    RETURN new;
END;
$$;

NOTIFY pgrst, 'reload schema';
