-- ============================================================================
-- TEST ACCOUNTS — give each staging test account its role and demo name.
-- ----------------------------------------------------------------------------
-- 1. Create the accounts first: Supabase dashboard → Authentication → Users →
--    Add user → "Create new user", tick "Auto Confirm User". Passwords go in
--    the team password manager, never in this repo.
-- 2. Replace the REPLACE_ME emails below IN THE SQL EDITOR ONLY (don't commit
--    real addresses — this repo is public), then run.
-- Safe to re-run. Accounts missing from auth.users are listed, not created.
--
-- The names matter: seed_demo.sql records history under these people (the
-- roaster on every batch, the packer on every checkout, the owner of each
-- customer), and this script links customers to the sales accounts by name.
--
-- Each account also gets a username, so it can sign in with e.g. "admin"
-- instead of the full email (username_login_migration.sql).
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.company_settings WHERE id = 1 AND company_name = 'Demo Roastery (Hackathon)') THEN
        RAISE EXCEPTION 'Not the staging project (company_settings marker missing). Nothing was changed.';
    END IF;
END $$;

DROP TABLE IF EXISTS pg_temp.test_accounts;
CREATE TEMP TABLE test_accounts (email TEXT, role TEXT, name TEXT, username TEXT);
INSERT INTO test_accounts VALUES
    ('REPLACE_ME_admin@example.com',     'Admin',             'Admin Demo',     'admin'),
    ('REPLACE_ME_leader@example.com',    'Production Leader', 'Hendra Leader',  'leader'),
    ('REPLACE_ME_roaster@example.com',   'Roaster',           'Gavin Roaster',  'roaster'),
    ('REPLACE_ME_packing@example.com',   'Packing Team',      'Putri Packing',  'packing'),
    ('REPLACE_ME_sales@example.com',     'Sales Agent',       'Rina Sales',     'sales'),
    ('REPLACE_ME_sales2@example.com',    'Sales Agent',       'Dimas Sales',    'sales2'),    -- optional
    ('REPLACE_ME_developer@example.com', 'Developer',         'Lead Developer', 'developer'); -- optional

-- A profile row normally comes from the handle_new_user trigger; create it
-- here if the trigger was missing when the account was made.
INSERT INTO public.profiles (id, name, email, role)
SELECT u.id, a.name, u.email, a.role
FROM test_accounts a JOIN auth.users u ON lower(u.email) = lower(a.email)
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- Free the usernames first (from whoever holds them, and from the listed
-- accounts themselves), or a re-run that shuffles names would hit the
-- profiles_username_uniq index halfway through.
UPDATE public.profiles p SET username = NULL
WHERE p.username IN (SELECT username FROM test_accounts)
   OR p.id IN (SELECT u.id FROM test_accounts a JOIN auth.users u ON lower(u.email) = lower(a.email));

UPDATE public.profiles p
SET role = a.role, name = a.name, email = u.email, username = a.username
FROM test_accounts a JOIN auth.users u ON lower(u.email) = lower(a.email)
WHERE p.id = u.id;

-- Customer ownership by the seeded sales names (CRM "By sales" scorecard).
UPDATE public.customers c SET owner_sales_id = p.id
FROM public.profiles p WHERE p.name = c.owner_sales_name;
UPDATE public.customers c SET created_by_id = p.id
FROM public.profiles p WHERE p.name = c.created_by_name;
UPDATE public.customer_owner_history h SET to_sales_id = p.id
FROM public.profiles p WHERE p.name = h.to_sales_name;

-- Result: every listed account and whether it was found.
SELECT a.email, a.username, a.role, a.name,
       CASE WHEN u.id IS NULL THEN 'NOT FOUND — create it in Authentication → Users' ELSE 'ok' END AS status
FROM test_accounts a LEFT JOIN auth.users u ON lower(u.email) = lower(a.email)
ORDER BY a.role;
