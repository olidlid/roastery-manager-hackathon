# Staging project setup

How to build the hackathon staging environment from an empty Supabase project.
Production is never touched: every script below refuses to run unless the
database carries the staging marker (`company_settings.company_name =
'Demo Roastery (Hackathon)'`), which only `staging_setup.sql` writes, and
`staging_setup.sql` itself refuses to run on a database with pre-October 2026 history.

## 1. Database (Supabase SQL Editor, in this order)

| # | File | What it does | Re-runnable |
|---|------|--------------|-------------|
| 1 | `supabase_schema.sql` | All 51 tables, triggers, stock RPCs, RLS, signup trigger | Yes |
| 2 | `staging_setup.sql` | API grants, `company_settings` row, the six roles with all 80 permission keys | Yes (resets those six roles) |
| 3 | `seed_demo.sql` | Wipes business data and replays ~8 months of demo history | Yes — this is the "reset staging" button |

`fix_custom_roles_rls.sql` is not needed: step 1 already creates the
`full_access` policy it restores.

The individual `*_migration.sql` files are history. They are already folded
into `supabase_schema.sql`; don't run them on a fresh project.

## 2. Test accounts

1. Authentication → Users → **Add user → Create new user**, tick **Auto Confirm User**.
   One per role: Admin, Production Leader, Roaster, Packing Team, Sales Agent
   (a second Sales Agent and a Developer are optional).
2. Open `seed_test_users.sql` in the SQL Editor, replace the `REPLACE_ME` emails
   there (don't commit real addresses), and run it. The result table shows any
   account it could not find. Each account also gets a username (`admin`,
   `leader`, `roaster`, `packing`, `sales`, …), so it can sign in with that
   instead of the email.

Passwords live in the password manager, never in this repo.

## 3. Point the app at the project

- `js/supabase.js` → `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Project Settings → API).
- `index.html` and `leader.html` → the `connect-src` entry of the
  Content-Security-Policy meta tag (`https://<ref>.supabase.co wss://<ref>.supabase.co`).
- Bump the `?v=` of `js/supabase.js` in both HTML files, run `node test.js`.

## 4. Auth settings

- Authentication → URL Configuration: **Site URL** and **Redirect URLs** = the staging Vercel domain.
- Google provider (optional): a client whose authorized origin is the Vercel
  domain and whose redirect URI is `https://<ref>.supabase.co/auth/v1/callback`.
- Edge Function `admin-reset-password` (optional, Settings → Users → Reset
  Password): `supabase functions deploy admin-reset-password --project-ref <ref>`.

## 5. Keeping it awake

Free projects pause after 7 days without traffic.
`.github/workflows/keep-alive.yml` reads one row every 3 days using the public
URL and anon key from `js/supabase.js`. It skips while those are placeholders.

## What the demo data contains

Every date is relative to the day `seed_demo.sql` runs, so it never goes stale.

| Area | Contents |
|------|----------|
| Green bean | 5 coffees, 8 lots. **FIFO fixture:** Aceh Gayo has an old lot with 10 kg left and a newer lot with 60 kg untouched, so a 15 kg roast must take 10 kg from the old lot and 5 kg from the new one. Flores (5 kg) sits below the 10 kg low-stock threshold. |
| Roasting | 17 roast days on 2 machines, single origins and a 60/40 blend. One Toraja batch draws from two lots. |
| Bulk | One leftover (0.4 kg) to try Close Lot on, plus two unpacked cards (11.8 kg Gayo, 10.2 kg blend) in Ready to Pack. Older leftovers were closed to waste. |
| Packed | 9 products across 250 g / 500 g / 1 kg. Every lot has a strip code and traces back production lot → roast batches → green lots → supplier. |
| Sales | 11 customers (Wholesale / Retail / Supermarket), 70 dispatched orders. Orders from the last 60 days were checked out from real lots. 2 orders await approval, 1 is approved and waiting for checkout. |
| CRM | Steady, due, slipping, dormant, once-only, new and never-ordered customers. |
| Other | 3 other items with stock-in and release history, 3 purchase requests (requested / approved / rejected). |

The seed ends with a self-check. It stops with an error unless `stock_kg`
and `quantity` match their lots, both movement ledgers sum to the live stock,
every roast batch drew exactly its input weight, and the FIFO and traceability
fixtures are in place.
