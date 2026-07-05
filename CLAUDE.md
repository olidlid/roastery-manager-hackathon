# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Roastery Manager Pro is a web-based coffee roastery management system. It manages the full production lifecycle — from green bean inventory to roasted coffee packing and sales dispatch.

**Live URL:** https://roasterymanagerv2.vercel.app
**GitHub:** https://github.com/olidlid/roasterymanagerv2 (public)
**Tech Stack:** HTML, CSS, JavaScript (Vanilla), Supabase (PostgreSQL + Auth)
**Deployment:** Vercel (auto-deploy from GitHub main branch, rewrites all routes to index.html — see vercel.json)

---

## Project Structure

```
roastery-manager-v2/
├── index.html              # Main SPA (login, dashboard, all pages)
├── leader.html              # Lightweight "Leader" approval app (approve/reject sales requests)
├── css/styles.css           # Design system (CSS custom properties / design tokens in :root)
├── js/
│   ├── app.js                # Core app logic for index.html (~11,000 lines, monolithic)
│   ├── leader.js              # Logic for leader.html
│   ├── supabase.js            # Supabase client init (hardcoded credentials, shared by both apps)
│   ├── i18n.js                # i18n + RTL layout engine (data-i18n / data-i18n-placeholder)
│   └── translations.js        # Translation dictionaries (EN/AR strings — see README_TRANSLATION.md)
├── dist/                    # Capacitor build source for the Android "Leader" app — NOT stale.
│                             #   dist/index.html is leader.html; dist/js mirrors js/. capacitor.config.json
│                             #   (webDir: "dist", appId: com.roastery.leader) packages this into the Android app.
├── android/                  # Capacitor-generated Android project (Gradle) for the Leader app
├── whatsapp-service/          # Standalone Node service: polls Supabase for pending orders, notifies via WhatsApp
├── database/supabase_schema.sql  # Column-accurate snapshot of PRODUCTION schema (synced 2026-07-06)
├── server.js                 # Trivial static file server for local dev (node server.js, port 8000)
└── test.js                   # One-off script that evaluates js/app.js in a jsdom/vm sandbox to catch SyntaxErrors
```

---

## Commands

- **Run locally:** `node server.js` → serves the app at http://localhost:8000 (plain static file server, no build step)
- **Syntax-check app.js:** `node test.js` (loads js/app.js into a jsdom `vm` context and reports SyntaxErrors — there is no real test suite; `npm test` is a stub that always fails)
- **Quick syntax check alternative:** `node --check js/app.js`
- **Android build:** standard Capacitor/Gradle flow from `android/` (`gradlew assembleDebug`, etc.); `dist/` must be (re)built/copied first since `capacitor.config.json` points `webDir` at it
- **WhatsApp service:** `cd whatsapp-service && npm install && node index.js` (requires `.env` with `SUPABASE_URL`, `SUPABASE_KEY`, `LEADER_PHONE` — see `.env.example`)

There is no bundler, transpiler, or package build for the main app — `js/app.js` is loaded directly by the browser as a plain script.

---

## Supabase Configuration

**Project URL:** `https://YOUR_PROJECT_REF.supabase.co`
**Anon key:** hardcoded in `js/supabase.js` (both `index.html` and `leader.html` load this same file) — intentional, see "Full Supabase Mode" below.
**Auth providers:** Email/Password + Google OAuth (`flowType: 'implicit'`, `detectSessionInUrl: true`)

### Google OAuth Setup
- **Google Cloud Project:** RoasteryManagerV2
- **Client ID:** `241927420519-c8gngv7uov9indmfdt1naomqjhihj891.apps.googleusercontent.com`
- **Authorized JavaScript Origins:** `https://roasterymanagerv2.vercel.app`, `https://YOUR_PROJECT_REF.supabase.co`
- **Authorized Redirect URI:** `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
- **Publishing status:** In Production (External)

### `handle_new_user` trigger
`database/supabase_schema.sql` defines a trigger on `auth.users` that auto-creates a row in `public.profiles` on signup (role defaults to `'Roaster'`). If you change the `profiles` schema, this trigger must be updated to match or new signups will silently fail to get a profile row.

---

## Database Schema

`database/supabase_schema.sql` is a **column-accurate snapshot of production** (synced 2026-07-06 from `information_schema`). It covers all 20 production tables: `profiles`, `custom_roles`, `company_settings`, `green_coffee`, `green_coffee_intake`, `blend_recipes`, `blend_ingredients`, `machines`, `roasting_plans`, `roast_batches`, `bulk_roasted_coffee`, `waste_inventory`, `packaging_sizes`, `packed_coffee`, `packing_records`, `customers`, `sales_agents`, `request_orders`, `request_order_items`, `sales_orders` (legacy).

**Rules for keeping it in sync (this drift caused all 6 production bugs on 2026-07-05/06):**
- Any schema change: update the file first, apply the same ALTER/CREATE to production via SQL Editor, then run `NOTIFY pgrst, 'reload schema';` (PostgREST caches the schema — without this, the REST API throws "Could not find the '<col>' column ... in the schema cache" even when the column exists; occasionally needs running twice).
- Never add columns via the Supabase dashboard without mirroring them in the file.
- Many tables carry **legacy columns** from earlier app generations (marked `-- legacy` in the file). Don't reuse them for new features.
- `handover_logs` does **not** exist in production even though `MOCK_DB` in `js/app.js` still references it — live fetches for it fall back to the local mock cache.

### `profiles`
`id (uuid, PK)`, `name`, `email`, `role` (default `'Roaster'`), `avatar_url`, `created_at`.
RLS: anyone can SELECT; users can UPDATE their own row; INSERT open (for the signup trigger).

### `custom_roles`
Role definitions with granular permissions. `id`, `name` (unique), `color`, `is_system`, `permissions` (jsonb, ~40 boolean keys like `greenbean_view`, `roasting_batch_approve`, `dispatch_approval_dispatch`, `settings_system`, `user_management`), `created_at`.
Default roles (seeded from `MOCK_DB.custom_roles` in `js/app.js` if the table is empty on first sync): **Developer, Admin, Production Leader, Roaster, Packing Team, Sales Agent** — each with a different permission matrix (see `hasPermission()` / `applyRoleAccess()` in `js/app.js`).

---

## Architecture

### Full Supabase Mode (no mock/demo mode in the UI)
As of commit `00699f1`, the app always talks to the live Supabase project:
- `isMockMode` is hardcoded to `false` at declaration (`js/app.js:23`) and is only ever flipped back to `true` by the Developer-only "Reset Mock Database" debug tool (`window.resetMockDatabase`) — a local-cache-clearing utility, not a real mode switch for normal users.
- Supabase URL/anon key are hardcoded in `js/supabase.js` so every browser/device connects to the same project without any setup step.
- `MOCK_DB` and `initMockDatabases()` still exist in `js/app.js` — they're not dead weight, they double as (a) the seed data hydrated into Supabase's `custom_roles` table the first time it's empty, and (b) the reset target for the Developer debug tool. `fetchData`/`saveData`/`deleteData` still branch on `isMockMode` for historical reasons, but that branch is effectively unreachable in normal use.
- `custom_roles` is the one table intentionally kept as a localStorage cache (`mock_custom_roles`) even in live mode — `syncCustomRolesFromSupabase()` pulls it from Supabase into localStorage on load so `hasPermission()` can check permissions synchronously without an await on every render. `company_settings`, by contrast, is read directly from Supabase in `loadCompanySettings()` — it does not use the mock cache path.

### Authentication flow
1. `checkAuthentication()` runs on load, wires `supabaseClient.auth.onAuthStateChange` and checks the current session.
2. No session → `auth-overlay` shown (Email/Password or Google OAuth), app container hidden.
3. Session exists → `loadUserProfile(userId)` fetches the row from `profiles`, `syncCustomRolesFromSupabase()` runs, `applyRoleAccess()` shows/hides sidebar sections based on the resolved role's permissions, dashboard loads.
4. New signups get a `profiles` row via the `handle_new_user` DB trigger (see above), not application code.

### SPA structure (`index.html` / `js/app.js`)
- Single page with `<section id="sec-*" class="page-section hidden">` blocks (dashboard, greenbean, roasting, packing, customers, handover, reports, settings, etc.); `navigateTo(sectionId)` toggles visibility and calls `loadSectionData(sectionId)` to lazy-load that section's data.
- `fetchData(table)` / `saveData(table, record)` / `deleteData(table, id)` are the only data-access primitives used throughout — always Supabase-backed selects/upserts/deletes keyed by `id`, wrapped in try/catch that falls back to a cached mock read on fetch failure.
- `_dbCache` (a `Map`) memoizes `getMockTable()` reads within a session; `invalidateCache(table)` is called after every mutating mock write. This is only relevant to the mock-cache code path described above.
- Permissions gate UI, not data: `hasPermission(key)` reads the cached role permissions synchronously; there's no server-side RLS enforcement of the granular permission keys beyond Supabase's coarser table-level RLS policies.
- Modals are rendered via `openModal(title, htmlContent)`; confirmations via `showWarningModal()`; the app has no toast/notification framework beyond these overlay-style modals.
- i18n: any user-facing string must go through `data-i18n` / `data-i18n-placeholder` attributes (HTML) or `window.t('key')` (JS), with the key added to both `en` and `ar` in `js/translations.js`. Arabic triggers RTL layout via `js/i18n.js` (`adjustSidebarLayoutForRTL`). See `README_TRANSLATION.md` for the Excel/CSV import-export workflow non-technical users use to edit translations.
- Theming: colors must go through CSS custom properties in `css/styles.css` (`var(--bg-app)`, `var(--text-primary)`, etc.) — never hardcode colors, since the same variables drive dark/light mode.

### `leader.html` / `js/leader.js`
A minimal companion page (also the source for the Capacitor Android "Leader" app via `dist/`) that only lists pending sales orders and lets a leader Approve/Reject them, reusing `window.fetchData`/`saveData` from the shared `js/supabase.js` client.

### `whatsapp-service/`
Independent Node process (`whatsapp-web.js` + Puppeteer) that polls `request_orders` for `status = 'Pending Approval'` every 10s and sends a WhatsApp message to `LEADER_PHONE` when a new one appears. Runs completely outside the web app's process; only shares the Supabase project as an integration point.

---

## Recent Changes (as of 2026-07-05)

- Fixed `handle_new_user()` trigger to match the actual `profiles` schema (it previously inserted into a non-existent `username` column, breaking every signup).
- Fixed Google OAuth by adding the missing Authorized JavaScript Origins in Google Cloud Console.
- Removed dual localStorage/Supabase ("mock"/"demo") mode from the *login/setup* flow specifically — hardcoded Supabase credentials and `custom_roles` sync so all browsers/devices share one dataset (`00699f1`). Note this did not remove the underlying `MOCK_DB`/cache machinery described above, only the user-facing demo-mode UI and the "Setup Database Connection" / developer-bypass login screens.

## Current Status

**Working:** Email/Password + Google OAuth auth, RBAC via `custom_roles` (6 default roles / ~40 permission keys), dashboard, green coffee inventory CRUD, roasting plans & batches, packing, sales requests & dispatch approval, dark/light theme, EN/AR i18n, barcode scan → quick roast log, customer management, WhatsApp leader notifications.

**Needs more testing/completion:**
- Full end-to-end workflow across Green Bean → Roasting → Packing → Sales.
- Reports module (chart data binding, date filtering).
- Print output for requests/dispatch/waybill/labels.
- Mobile responsiveness.
- ~~`database/supabase_schema.sql` should be brought up to date with production~~ — DONE 2026-07-06 (full sync from production `information_schema`; keep it in sync per the rules in "Database Schema" above).

**Known technical debt:**
- `js/app.js` is monolithic (~11,000 lines) with no module boundaries — could be split by feature (greenbean, roasting, packing, sales, reports, settings) if it keeps growing.
- Leftover `if (isMockMode)` branches throughout `js/app.js` are effectively dead in normal operation but are still exercised by the Developer "Reset Mock Database" debug tool — don't remove them without also removing/reworking that tool.
- `desktop-tutorial/` at the repo root is a leftover GitHub Desktop scaffold folder, unrelated to the app.

---

## Roles & Permissions Matrix

| Role | Dashboard | Inventory | Production | Packing | Sales | Reports | Settings |
|------|-----------|-----------|------------|---------|-------|---------|----------|
| Developer | Yes | Full | Full | Full | Full | Yes | All + Debug Tools |
| Admin | Yes | Full | Full | Full | Full | Yes | All |
| Production Leader | Yes | Full | Full | Full | View only | Yes | Production only |
| Roaster | Yes | View only | Batches only (add, no edit/delete/approve) | No | No | No | No |
| Packing Team | Yes | No | No | Full | Request view only | No | No |
| Sales Agent | Yes | No | No | No | Full | Yes | No |

Exact keys live in each role's `permissions` object in `custom_roles` (seeded from `MOCK_DB.custom_roles` in `js/app.js`) — check there before assuming a permission key exists.

---

## Test Credentials

- **Email:** cholidulasyhar00@gmail.com
- **Password:** [See team shared document or ask team for current password]
- **Role:** Developer (Developer-only UI, e.g. Settings → Debug Tools, is gated on `currentUser.role === 'Developer'`, not a permission key).

⚠️ **Security Note:** This repo is now private. If credentials are ever exposed, reset the password in Supabase Dashboard → Authentication → Users.

---

## Development Guidelines

- No build tools/bundler for the web app — `js/app.js` runs as-is in the browser. External libraries (Supabase JS, Chart.js, Lucide, JsBarcode) are loaded via CDN `<script>` tags in `index.html`/`leader.html`, not npm.
- After editing `js/app.js`, run `node test.js` (or `node --check js/app.js`) to catch syntax errors before committing — there's a history of syntax-error regressions in this file (see commit `fc33261`).
- `index.html` cache-busts `js/app.js` with a `?v=` query param (`js/app.js?v=2`); bump it when shipping a change so browsers don't serve a stale cached copy.
- Any new user-facing string needs a `data-i18n`/`t()` key added to *both* `en` and `ar` in `js/translations.js` — see `.agents/AGENTS.md` for the localization/RTL/theming rules enforced in this repo (no hardcoded English text, no hardcoded colors, always null-check DOM elements before attaching listeners).
- `js/supabase.js` is shared by both `index.html` and `leader.html` — changes to Supabase client init affect both apps (and the Capacitor Android build in `dist/`, which must be kept in sync manually).

---

## Deployment Checklist

**Before pushing code to main / deploying to production:**

- [ ] **Syntax:** `node --check js/app.js` passes
- [ ] **Schema alignment:** Code changes match `database/supabase_schema.sql` (or production schema if ahead)
- [ ] **Hard refresh testing:** Hard refresh app (`Ctrl+Shift+R`), test changed features end-to-end
- [ ] **Documentation:** Schema file updated if any DB columns added/removed
- [ ] **Error handling:** New data mutations (saveData) check `error` and alert on failure (don't fail silently)
- [ ] **Cache busting:** If JS changes shipped, bump `app.js?v=X` in `index.html` so browsers load fresh copy

**Schema Sync (Critical):**
- **Single source of truth:** `database/supabase_schema.sql` must reflect production schema
- **Before merge:** Code must match schema; if schema and code diverge, update both in same PR
- **Before deploy:** Verify production schema = file schema (or run migrations if ahead)
- **Lesson:** All 6 bugs in July 2026 session were schema mismatches between development file and production DB

**Rollout:**
- After push to main, wait for Vercel deployment to complete (check dashboard — status should be "Ready")
- Hard refresh app and test again to ensure new code is live
- Monitor browser console for errors on first user interactions with new features
