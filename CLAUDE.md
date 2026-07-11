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
├── js/                      # index.html loads these as plain (non-module) <script> tags, in this order:
│   ├── translations.js        # Translation dictionaries (EN/AR strings — see README_TRANSLATION.md)
│   ├── i18n.js                # i18n + RTL layout engine (data-i18n / data-i18n-placeholder)
│   ├── supabase.js            # Supabase client init (hardcoded credentials, shared by both apps)
│   ├── db.js                  # fetchData/saveData/deleteData/upsertData, _dbCache, saving-indicator helpers
│   ├── auth.js                 # checkAuthentication, loadUserProfile, hasPermission, applyRoleAccess, syncCustomRolesFromSupabase
│   ├── greenbean.js            # Green coffee inventory + arrival UI logic
│   ├── roasting.js             # Roasting plans & batches UI logic
│   ├── packing.js              # Packing UI logic
│   ├── sales.js                # Customers, requests, dispatch approval UI logic
│   ├── settings.js             # Settings page (roles, translations import/export, debug tools) UI logic
│   ├── app.js                 # Remaining core/shared app logic + bootstrap (~3,800 lines, down from ~13,000 pre-split — see REFACTORING.md); loaded LAST since it depends on everything above
│   ├── leader.js               # Logic for leader.html (separate from the app.js chain above)
│   └── app_backup.js           # Untracked local pre-split snapshot (~13,000 lines) — not loaded by index.html, not part of the app; safe to ignore/delete, kept locally as a rollback reference only
├── js/modules/ui/           # Empty directory, no files — leftover stub from refactor planning, not used
├── dist/                    # Capacitor build source for the Android "Leader" app.
│                             #   dist/index.html is leader.html and only loads js/supabase.js + js/leader.js
│                             #   (confirmed by its own <script> tags) — dist/js/app.js (6,359 lines) sits in
│                             #   this folder but is NOT referenced by dist/index.html and is a stale pre-split
│                             #   copy; ignore/remove it rather than treating it as "mirrors js/". capacitor.config.json
│                             #   (webDir: "dist", appId: com.roastery.leader) packages this into the Android app.
├── android/                  # Capacitor-generated Android project (Gradle) for the Leader app
├── whatsapp-service/          # Standalone Node service: polls Supabase for pending orders, notifies via WhatsApp
├── database/supabase_schema.sql  # Column-accurate snapshot of PRODUCTION schema (synced 2026-07-06)
├── server.js                 # Trivial static file server for local dev (node server.js, port 8000)
└── test.js                   # Parses <script src="js/..."> tags from index.html, concatenates them in order, evaluates in a jsdom/vm sandbox to catch SyntaxErrors
```

---

## Commands

- **Run locally:** `node server.js` → serves the app at http://localhost:8000 (plain static file server, no build step)
- **Syntax-check all split scripts:** `node test.js` (parses the `<script src="js/...">` tags out of `index.html` in document order, concatenates them exactly like the browser's shared global scope would, and evaluates the result in a jsdom `vm` context to catch SyntaxErrors/`X is not defined` — automatically picks up new files if `js/` is split further; there is no real test suite; `npm test` is a stub that always fails)
- **Quick syntax check alternative:** `node --check js/<file>.js` (run per file, e.g. `js/app.js`, `js/auth.js`, `js/greenbean.js`, etc.)
- **Android build:** standard Capacitor/Gradle flow from `android/` (`gradlew assembleDebug`, etc.); `dist/` must be (re)built/copied first since `capacitor.config.json` points `webDir` at it. ⚠️ `dist/js/app.js` (6,359 lines) was NOT updated by the V1 modularization — it's a separate, stale snapshot from before the split, not mirroring the current `js/*.js` split files. Confirm/resync before the next Android build.
- **WhatsApp service:** `cd whatsapp-service && npm install && node index.js` (requires `.env` with `SUPABASE_URL`, `SUPABASE_KEY`, `LEADER_PHONE` — see `.env.example`)

There is no bundler, transpiler, or package build for the main app — every `js/*.js` file is loaded directly by the browser as a plain script, in the load order listed above.

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
RLS: `full_access` (`FOR ALL USING (true)`), same permissive pattern as every other table — see "Database Schema" rules above (authorization is enforced client-side via `hasPermission('user_management')`, not by RLS). This line previously (incorrectly) documented "own row only" for UPDATE, which was stale/contradicted the schema file's own generic RLS block and caused Admin/Developer edits to another user's role to be silently rejected. If `profiles` UPDATE ever stops working for one user editing another's role, re-run the `full_access` policy for this table specifically (see 2026-07-06 fix).

### `custom_roles`
Role definitions with granular permissions. `id`, `name` (unique), `color`, `is_system`, `permissions` (jsonb, ~40 boolean keys like `greenbean_view`, `roasting_batch_approve`, `dispatch_approval_dispatch`, `settings_system`, `user_management`), `created_at`.
Default roles (seeded from `MOCK_DB.custom_roles` in `js/app.js` if the table is empty on first sync): **Developer, Admin, Production Leader, Roaster, Packing Team, Sales Agent** — each with a different permission matrix (see `hasPermission()` / `applyRoleAccess()`, both in `js/auth.js`).

⚠️ **Known RLS drift (found 2026-07-09):** production's actual RLS policy on this table stopped matching the `full_access` policy documented in `supabase_schema.sql` — `DELETE`/`UPDATE` silently no-op (HTTP 200, empty result, row untouched), same symptom class as the `profiles` UPDATE drift below. This means "Delete Role" in Settings → Role Management may silently fail. Fix: run `database/fix_custom_roles_rls.sql` in the Supabase SQL Editor to re-apply the `full_access` policy.

---

## Architecture

### Full Supabase Mode (no mock/demo mode in the UI)
As of commit `00699f1`, the app always talks to the live Supabase project:
- `isMockMode` is hardcoded to `false` at declaration (`js/app.js:64` — line number shifted after the V1 modularization split moved `db.js`/`auth.js`/UI modules out of `app.js`; see REFACTORING.md) and is only ever flipped back to `true` by the Developer-only "Reset Mock Database" debug tool (`window.resetMockDatabase`) — a local-cache-clearing utility, not a real mode switch for normal users.
- Supabase URL/anon key are hardcoded in `js/supabase.js` so every browser/device connects to the same project without any setup step.
- `MOCK_DB` and `initMockDatabases()` still exist in `js/app.js` (not moved during the split — see REFACTORING.md) — they're not dead weight, they double as (a) the seed data hydrated into Supabase's `custom_roles` table the first time it's empty, and (b) the reset target for the Developer debug tool. `fetchData`/`saveData`/`deleteData` (now in `js/db.js`) still branch on `isMockMode` for historical reasons, but that branch is effectively unreachable in normal use.
- `custom_roles` is the one table intentionally kept as a localStorage cache (`mock_custom_roles`) even in live mode — `syncCustomRolesFromSupabase()` (in `js/auth.js`) pulls it from Supabase into localStorage on load so `hasPermission()` can check permissions synchronously without an await on every render. `company_settings`, by contrast, is read directly from Supabase in `loadCompanySettings()` — it does not use the mock cache path.

### Authentication flow
1. `checkAuthentication()` runs on load, wires `supabaseClient.auth.onAuthStateChange` and checks the current session.
2. No session → `auth-overlay` shown (Email/Password or Google OAuth), app container hidden.
3. Session exists → `loadUserProfile(userId)` fetches the row from `profiles`, `syncCustomRolesFromSupabase()` runs, `applyRoleAccess()` shows/hides sidebar sections based on the resolved role's permissions, dashboard loads.
4. New signups get a `profiles` row via the `handle_new_user` DB trigger (see above), not application code.

### SPA structure (`index.html` / `js/db.js` + `js/auth.js` + `js/greenbean.js` + `js/roasting.js` + `js/packing.js` + `js/sales.js` + `js/settings.js` + `js/app.js`)
Since the V1 modularization (see REFACTORING.md), these load as separate plain `<script>` tags in the order listed in "Project Structure" above — all in one shared global scope (no ES modules, no bundler), so any function/global from an earlier-loaded file is available to later ones. `js/app.js` loads last and holds bootstrap + whatever core logic wasn't feature-specific enough to move to a UI module.
- Single page with `<section id="sec-*" class="page-section hidden">` blocks (dashboard, greenbean, roasting, packing, customers, handover, reports, settings, etc.); `navigateTo(sectionId)` toggles visibility and calls `loadSectionData(sectionId)` to lazy-load that section's data.
- `fetchData(table)` / `saveData(table, record)` / `deleteData(table, id)` (all in `js/db.js`) are the only data-access primitives used throughout — always Supabase-backed selects/upserts/deletes keyed by `id`, wrapped in try/catch that falls back to a cached mock read on fetch failure.
- `_dbCache` (a `Map`, in `js/db.js`) memoizes `getMockTable()` reads within a session; `invalidateCache(table)` is called after every mutating mock write. This is only relevant to the mock-cache code path described above.
- Permissions gate UI, not data: `hasPermission(key)` (in `js/auth.js`) reads the cached role permissions synchronously; there's no server-side RLS enforcement of the granular permission keys beyond Supabase's coarser table-level RLS policies.
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

## V1 Modularization (completed, merged 2026-07-08 via `160ce0e`)

`js/app.js` (13,018 lines, 160 functions) was split into 7 plain `<script>` files — `db.js`, `auth.js`, `greenbean.js`, `roasting.js`, `packing.js`, `sales.js`, `settings.js` — leaving `app.js` at ~3,800 lines. Plain-script split was chosen over ES modules specifically to avoid breaking 82 inline `onclick=` handlers and ~25 mutable global state variables. Also added shadow lot-tracking tables (`green_coffee_lots`, `packed_coffee_lots`, INTEGER FKs) for future V2 use. Full rationale, before/after metrics, and the FK-type gotcha (SERIAL/INTEGER, not UUID) are in **REFACTORING.md**. V2 phase scope (FIFO, Work Order, B2B, AI) is tracked in **V2_ROADMAP.md**.

## Current Status

**Working:** Email/Password + Google OAuth auth, RBAC via `custom_roles` (6 default roles / ~40 permission keys), dashboard, green coffee inventory CRUD, roasting plans & batches, packing, sales requests & dispatch approval, dark/light theme, EN/AR i18n, barcode scan → quick roast log, customer management, WhatsApp leader notifications.

**Needs more testing/completion:**
- Full end-to-end workflow across Green Bean → Roasting → Packing → Sales.
- Reports module (chart data binding, date filtering).
- Print output for requests/dispatch/waybill/labels.
- Mobile responsiveness.
- ~~`database/supabase_schema.sql` should be brought up to date with production~~ — DONE 2026-07-06 (full sync from production `information_schema`; keep it in sync per the rules in "Database Schema" above).

**Known technical debt:**
- ~~`js/app.js` is monolithic (~11,000 lines) with no module boundaries~~ — DONE 2026-07-08, split into `db.js`/`auth.js`/`greenbean.js`/`roasting.js`/`packing.js`/`sales.js`/`settings.js` + `app.js` (see "V1 Modularization" above and REFACTORING.md).
- Leftover `if (isMockMode)` branches throughout `js/app.js` are effectively dead in normal operation but are still exercised by the Developer "Reset Mock Database" debug tool — don't remove them without also removing/reworking that tool.
- `desktop-tutorial/` at the repo root is a leftover GitHub Desktop scaffold folder, unrelated to the app.
- `dist/js/app.js` (6,359 lines) is a stale, unreferenced pre-split copy sitting in the Android build source — `dist/index.html` doesn't even load it (only `js/supabase.js` + `js/leader.js`). Safe to delete; not part of the app.
- `js/app_backup.js` at the repo root (untracked, ~13,018 lines) is a local-only pre-split snapshot, not loaded anywhere — safe to delete once confirmed no longer needed as a rollback reference.
- `js/modules/ui/` is an empty directory with no files — leftover stub, safe to remove.

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

- No build tools/bundler for the web app — every `js/*.js` file runs as-is in the browser. External libraries (Supabase JS, Chart.js, Lucide, JsBarcode) are loaded via CDN `<script>` tags in `index.html`/`leader.html`, not npm.
- After editing any `js/*.js` file, run `node test.js` (or `node --check js/<file>.js` for a single file) to catch syntax errors before committing — there's a history of syntax-error regressions in this codebase (see commit `fc33261`).
- `index.html` cache-busts each split script with its own `?v=` query param (e.g. `js/app.js?v=53`, `js/auth.js?v=5`, `js/sales.js?v=2`) — bump the `?v=` of whichever file you changed when shipping, so browsers don't serve a stale cached copy of just that file.
- Any new user-facing string needs a `data-i18n`/`t()` key added to *both* `en` and `ar` in `js/translations.js` — see `.agents/AGENTS.md` for the localization/RTL/theming rules enforced in this repo (no hardcoded English text, no hardcoded colors, always null-check DOM elements before attaching listeners).
- `js/supabase.js` is shared by both `index.html` and `leader.html` — changes to Supabase client init affect both apps (and the Capacitor Android build in `dist/`, which must be kept in sync manually).

---

## Deployment Checklist

**Before pushing code to main / deploying to production:**

- [ ] **Syntax:** `node test.js` passes (checks all split `js/*.js` files together as the browser would load them)
- [ ] **Schema alignment:** Code changes match `database/supabase_schema.sql` (or production schema if ahead)
- [ ] **Hard refresh testing:** Hard refresh app (`Ctrl+Shift+R`), test changed features end-to-end
- [ ] **Documentation:** Schema file updated if any DB columns added/removed
- [ ] **Error handling:** New data mutations (saveData) check `error` and alert on failure (don't fail silently)
- [ ] **Cache busting:** If JS changes shipped, bump `?v=X` in `index.html` for each changed script (`app.js`, `auth.js`, `greenbean.js`, etc.) so browsers load a fresh copy of that file

**Schema Sync (Critical):**
- **Single source of truth:** `database/supabase_schema.sql` must reflect production schema
- **Before merge:** Code must match schema; if schema and code diverge, update both in same PR
- **Before deploy:** Verify production schema = file schema (or run migrations if ahead)
- **Lesson:** All 6 bugs in July 2026 session were schema mismatches between development file and production DB

**Rollout:**
- After push to main, wait for Vercel deployment to complete (check dashboard — status should be "Ready")
- Hard refresh app and test again to ensure new code is live
- Monitor browser console for errors on first user interactions with new features
