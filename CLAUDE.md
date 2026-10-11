# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Last reviewed against the code: 2026-09-30.** If something here contradicts the code, the code wins — and fix this file in the same commit.

## Project Overview
Roastery Manager Pro is a web-based coffee roastery management system. It manages the full production lifecycle — from green bean inventory to roasted coffee packing and sales dispatch.

**Live URL (staging, hackathon copy):** _TBD — set when the Vercel project is created_
**GitHub:** https://github.com/olidlid/roastery-manager-hackathon

This repository is a public copy of a privately deployed production app, with its own Supabase project and seed data. Never point tests at the production deployment.
**Tech Stack:** HTML, CSS, JavaScript (Vanilla), Supabase (PostgreSQL + Auth)
**Deployment:** Vercel (auto-deploy from GitHub main branch, rewrites all routes to index.html — see vercel.json)

---

## Project Structure

```
roastery-manager-v2/
├── index.html              # Main SPA — every page lives here as a <section>
├── leader.html              # Lightweight "Leader" approval app (approve/reject sales requests)
├── css/styles.css           # Design system (CSS custom properties / design tokens in :root)
├── js/                      # index.html loads these as plain (non-module) <script> tags, IN THIS ORDER:
│   ├── translations.js        # EN/AR dictionaries (see README_TRANSLATION.md)
│   ├── i18n.js                # i18n + RTL engine (data-i18n / data-i18n-placeholder)
│   ├── supabase.js            # Supabase client init (hardcoded credentials, shared with leader.html)
│   ├── db.js                  # fetchData/saveData/deleteData/upsertData, computeOrderStatsByKey,
│   │                          #   median/daysBetween, stock-opname guards (see "Stock safety" below)
│   ├── auth.js                # checkAuthentication, loadUserProfile, hasPermission, SECTION_PERMISSIONS,
│   │                          #   applyMenuVisibility, filterCustomersByAccess, syncCustomRolesFromSupabase
│   ├── greenbean.js           # Green coffee inventory, arrivals, outbound, lab analysis
│   ├── roasting.js            # Roasting plans, batches, blends, test-batch approval
│   ├── packing.js             # Packing, unpack/repack, stock release, waste, dispatch checkout (largest file)
│   ├── sales.js               # Customer directory, Segments (RFM), sales requests, dispatch approval
│   ├── crm.js                 # CRM page: customers by sales, reorder prediction, sales performance
│   ├── otheritems.js          # Non-coffee goods bought and resold (OTHER_ITEMS_PLAN.md)
│   ├── settings.js            # Settings: roles/permissions, translations import/export, debug tools
│   ├── tracking.js            # Lot barcode lookup → traces a pack back to its coffee/batch/supplier
│   ├── purchasing.js          # Purchase requests + approval (PURCHASE_REQUEST_PLAN.md)
│   ├── app.js                 # Bootstrap, navigation, modals, dashboard, reports, stock opname
│   ├── leader.js              # Logic for leader.html (separate from the chain above)
│   └── app_backup.js          # Untracked pre-split snapshot — NOT loaded, safe to delete
├── database/                 # supabase_schema.sql (source of truth) + ~38 migration files
├── docs/                     # PRD.html, CRM mockups, reorder_backtest.js (console tool)
├── server.js                 # Static file server for local dev (node server.js, port 8000)
└── test.js                   # Concatenates every js/*.js in load order, evaluates in jsdom → catches SyntaxErrors
```

There is **no bundler, transpiler, or build step**. Every `js/*.js` file is loaded directly by the browser as a plain script, and they all share ONE global scope. A name declared in one file collides with the same name in another and kills the whole app with "Identifier has already been declared" — `js/crm.js` prefixes everything `crmpg*` for exactly this reason.

---

## Commands

- **Run locally:** `node server.js` → http://localhost:8000
- **Syntax-check everything:** `node test.js` — parses the `<script src="js/...">` tags out of `index.html` in document order, concatenates them exactly as the browser's shared global scope would, and evaluates the result in jsdom. Catches SyntaxErrors AND duplicate declarations. There is no real test suite; `npm test` is a stub that always fails.
- **Single file:** `node --check js/<file>.js`
- **Android build:** standard Capacitor/Gradle flow from `android/`; `dist/` must be (re)built first. ⚠️ `dist/js/app.js` is a stale pre-split snapshot that `dist/index.html` doesn't even load — ignore it.

---

## Supabase Configuration

**Project URL:** _TBD — the staging Supabase project_ (hardcoded in `js/supabase.js`)
**Anon key:** hardcoded in `js/supabase.js` (both apps load this file) — intentional.
**Auth providers:** Email/Password + Google OAuth (`flowType: 'implicit'`, `detectSessionInUrl: true`)

### Google OAuth Setup
- **Client ID / secret:** configured in the staging Supabase project's Auth settings, not in this repo
- **Authorized JavaScript Origins:** `https://<staging-vercel-domain>`, `https://<staging-project>.supabase.co`
- **Authorized Redirect URI:** `https://<staging-project>.supabase.co/auth/v1/callback`

### `handle_new_user` trigger
A trigger on `auth.users` auto-creates a `public.profiles` row on signup (role defaults to `'Roaster'`). Change the `profiles` schema and this trigger must change too, or new signups silently get no profile.

---

## Database Schema

`database/supabase_schema.sql` is the **column-level source of truth**, now ~49 tables. Every schema change follows the same three steps, in order:

1. Update `database/supabase_schema.sql` **first**.
2. Apply the same ALTER/CREATE to production via the Supabase SQL Editor.
3. Run `NOTIFY pgrst, 'reload schema';` — PostgREST caches the schema, and without this the REST API throws *"Could not find the '&lt;col&gt;' column ... in the schema cache"* even though the column exists. Occasionally needs running twice.

Never add columns through the Supabase dashboard without mirroring them in the file. Many tables carry **legacy columns** marked `-- legacy`; don't reuse them for new features.

### Stock safety — read this before touching any stock path

This is the part of the codebase that has cost the most real money, and every rule below exists because something went wrong.

**Source of truth is the LOT tables, never the summary columns:**

| Real stock | Derived, trigger-maintained — NEVER write directly |
|---|---|
| `green_coffee_lots.remaining_kg` | `green_coffee.stock_kg` (via `sync_green_coffee_stock`) |
| `packed_coffee_lots.remaining_pcs` | `packed_coffee.quantity` (via `sync_packed_coffee_quantity`) |
| `bulk_roasted_coffee.bulk_available` | — |

**Every movement goes through an atomic RPC**, never a bare UPDATE: `consume_/refund_green_coffee_lot`, `adjust_green_coffee_lot`, `consume_/refund_packed_lot`, `set_packed_lot_remaining`, `consume_/refund_bulk_lot`, `set_bulk_lot_available`, `other_item_consume/stock_in/set_qty`. **Credit the caller with the number the RPC returns, not the number you asked for.**

**Movement ledgers are append-only** and never deleted: `packed_stock_movements`, `bulk_stock_movements`, `green_coffee_lot_adjustments`, `other_item_movements`.

**Stock opname (stock take) freezes stock.** While a `stock_takes` row is `'counting'` or `'posting'`, the `stock_take_freeze_guard` trigger blocks writes on `green_coffee_lots`, `packed_coffee_lots` and `bulk_roasted_coffee`. Call `ensureNoStockOpname()` (js/db.js) BEFORE starting any stock write, and surface the failure — a swallowed freeze error is what produced the "packing didn't go in" complaints (`d6703f8`).

**Every stock path is all-or-nothing** (convention set in `ee14598`): lock the screen, do the work, **verify by reading back**, then report success — or roll back and say plainly that nothing was saved. `showStockFailed()` (nothing changed, safe to retry) and `showStockPartial()` (half-done, do NOT repeat) in js/db.js exist to keep that distinction honest.

### `profiles`
`id (uuid, PK)`, `name`, `email`, `role`, `avatar_url`, `created_at`. RLS is `full_access` (`FOR ALL USING (true)`) like every other table — authorization is enforced client-side, not by RLS.

### `custom_roles`
`id`, `name` (unique), `color`, `is_system`, `permissions` (jsonb, ~80 boolean keys), `created_at`.

⚠️ **Role names in production are NOT the seeded names.** `MOCK_DB.custom_roles` in js/app.js seeds Developer / Admin / Production Leader / Roaster / Packing Team / Sales Agent, but production actually runs roles like **`admin2`**, `Sales Manager`, `Supermarket Sales`, `Retail Sales`, `Sale 101`, `Procurement`. Any migration that switches a permission on **by role name** will miss the real admins. This already happened once with `crm_manage` (2026-09-27).

⚠️ **A permission key missing from a role's jsonb reads as `false`.** Every new permission key must be backfilled into the existing `custom_roles` rows in production, or the feature is invisible to everyone including Admin. This already happened with `purchase_request_view_own`.

⚠️ **Permissions are read from a localStorage cache** (`mock_custom_roles`), refreshed by `syncCustomRolesFromSupabase()` on page load. After changing a role, the page must be **reloaded** before the change takes effect.

⚠️ **Known RLS drift:** production's policy on `custom_roles` stopped matching the documented `full_access` policy — DELETE/UPDATE silently no-op (HTTP 200, empty result, row untouched). Fix: run `database/fix_custom_roles_rls.sql`.

---

## Architecture

### Full Supabase Mode (no mock/demo mode in the UI)
The app always talks to the live Supabase project. `isMockMode` is hardcoded `false` and is only flipped by the Developer-only "Reset Mock Database" debug tool. `MOCK_DB` still exists in js/app.js as (a) seed data for `custom_roles` on first sync and (b) the reset target for that debug tool. Leftover `if (isMockMode)` branches are effectively dead but still exercised by the debug tool — don't remove them without reworking the tool.

### Authentication flow
1. `checkAuthentication()` wires `supabaseClient.auth.onAuthStateChange` and checks the session.
2. No session → `auth-overlay` shown, app container hidden.
3. Session → `loadUserProfile(userId)` reads `profiles`, `syncCustomRolesFromSupabase()` fills the permission cache, `applyRoleAccess()` shows/hides menus, dashboard loads.
4. New signups get their `profiles` row from the DB trigger, not app code.

### SPA structure
One page, one `<section id="sec-*" class="page-section hidden">` per screen. `navigateTo(sectionId)` toggles visibility, sets the header from `PAGE_METADATA`, restores the last tab, and calls `loadSectionData(sectionId)`.

Current sidebar: **Dashboard · Inventory** (Greenbean / Bulk Roasted / Packed Coffee / Other Items) **· Production · Packing · CRM · Goods Handover · Purchasing · Reports · Tracking · Setting**.

- `fetchData(table)` / `saveData(table, record)` / `deleteData(table, id)` (js/db.js) are the only data-access primitives. `saveData` updates when the record has an `id`, inserts when it doesn't.
- Permissions gate the UI, not the data: `hasPermission(key)` reads the synchronous cache; `SECTION_PERMISSIONS` gates sections (an array means OR), `TAB_PERMISSIONS` in js/app.js gates individual tab buttons.
- Modals go through `openModal(title, htmlContent, customWidth)`; confirmations through `showWarningModal()`; long operations through `lockProcessingScreen(text)` which returns `{setText, release}`. There is no toast framework.
- **i18n:** every user-facing string goes through `data-i18n` / `data-i18n-placeholder` (HTML) or `window.t('key')` (JS), with the key added to **both** `en` and `ar` in js/translations.js. Arabic triggers RTL via js/i18n.js. There must be **no hardcoded Indonesian or English text in the UI** — commit `69ca581` was the cleanup for exactly that leak.
- **Theming:** colors go through the CSS custom properties in css/styles.css (`var(--bg-app)`, `var(--danger)`, …). Never hardcode a color; the same variables drive dark and light mode.

### CRM page (`js/crm.js`, `#sec-crm`) — added 2026-09-26/27
The Customers menu was **merged into CRM** on 2026-09-27; there is no separate Customers section any more. The page has two main tabs, each with its own permission:

| Main tab | Permission | Sub-tabs |
|---|---|---|
| **Customer** | `customer_view` | **Directory** (the old customer directory) · **Segments** (RFM: VIP / Regular / At Risk / Dormant / New) |
| **Performance** | `crm_manage` | **By customer** (reorder prediction table) · **By sales** (per-sales scorecard) |

`SECTION_PERMISSIONS['sec-crm']` is `['customer_view', 'crm_manage']` — either reaches the section, and `TAB_PERMISSIONS` hides the individual tab buttons. `loadCrmSectionEntry()` then forces the section onto a tab the user may actually open; without it, a hidden-but-active tab would still show its contents.

Sub-tabs deliberately do **not** use `.tab-btn`/`.tab-content`: `restoreLastTab()` sweeps every `.tab-btn` inside a section, so nested tabs would kill each other. They use `.crm-subtab`/`.crm-subpane` handled by `crmpgSubTab(btn, paneId)`, scoped to the panel the button lives in.

**Reorder prediction** (CRM_PAGE_PLAN.md §6.2) mixes order rhythm with consumption rate, weighted per customer by that customer's own past error, clamped to 0.5×–2.5× their usual gap. Under 3 orders there is no date at all; a customer past 2× their rhythm gets no date either. Overall accuracy is printed under the table so the method can't rot unnoticed. Re-verify any change with `docs/reorder_backtest.js` (paste into the browser console).

**Two different status vocabularies, on purpose:** Performance answers *rhythm* (Steady / Loyal / Slipping / Dormant / Ordered once / Never ordered); Segments answers *rank against peers of the same customer type* (VIP / Regular / At Risk / …).

### `leader.html` / `js/leader.js`
A minimal companion page (also the source for the Capacitor Android "Leader" app via `dist/`) that lists pending sales orders and lets a leader approve/reject them, reusing `window.fetchData`/`saveData` from the shared `js/supabase.js` client.

---

## Roles & Permissions Matrix

| Role | Dashboard | Inventory | Production | Packing | CRM | Sales | Reports | Settings |
|------|-----------|-----------|------------|---------|-----|-------|---------|----------|
| Developer | Yes | Full | Full | Full | Both tabs | Full | Yes | All + Debug Tools |
| Admin | Yes | Full | Full | Full | Both tabs | Full | Yes | All |
| Production Leader | Yes | Full | Full | Full | Both tabs | View only | Yes | Production only |
| Roaster | Yes | View only | Batches only | No | No | No | No | No |
| Packing Team | Yes | No | No | Full | No | Request view only | No | No |
| Sales Agent | Yes | No | No | No | Customer tab only | Full | Yes | No |

Exact keys live in each role's `permissions` jsonb (seeded from `MOCK_DB.custom_roles` in js/app.js). Notable keys added recently: `crm_manage` (CRM Performance tab), `packing_waste_control` (Close Lot above 5 kg + Return from Waste), `other_items_*`, `purchase_*`, `reports_stockopname_*`, `customer_cat_retail/wholesale/supermarket`.

---

## Plan documents

Feature work in this repo is planned in a root-level `*_PLAN.md` before the code is written, and the plan stays as the record. Read the relevant one before changing that area:

`CRM_PAGE_PLAN.md` (CRM page + prediction) · `CRM_JOURNEY_DATA.md` (what the unbuilt Journey tab needs) · `CRM_INSIGHTS_PLAN.md` (Segments sub-tab) · `CUSTOMER_CATEGORY_ROLE_PLAN.md` (category access) · `STOCK_LEDGER_PLAN.md` · `STOCK_OPNAME_PLAN.md` · `OTHER_ITEMS_PLAN.md` · `PURCHASE_REQUEST_PLAN.md` · `APPROVAL_REVISION_PLAN.md` · `CHECKOUT_AUTOFILL_PLAN.md` · `CUSTOMER_TYPEAHEAD_PLAN.md` · `TEST_BATCH_CARD_PLAN.md` · `REFACTORING.md` (why plain scripts, not ES modules) · `V2_ROADMAP.md`.

`SONNET_PROMPT_*.md` files are handoff prompts for separate implementation sessions; each points at its plan.

---

## Current Status

**Working:** Email/Password + Google OAuth, RBAC via `custom_roles`, dashboard, green coffee inventory with lot tracking + lab analysis, roasting plans/batches/blends, packing with unpack/repack/waste, stock release, dispatch checkout, stock ledgers for packed and bulk, stock opname (stock take) with freeze, sales requests + dispatch approval, purchase requests, other items, lot tracking lookup, CRM page, dark/light theme, EN/AR i18n.

**Needs more testing/completion:** Reports module (chart binding, date filtering), print output (requests/dispatch/waybill/labels), mobile responsiveness.

**Known technical debt:**
- `js/packing.js` is 8,400 lines and `js/app.js` 6,600 — the next split candidates.
- `js/app_backup.js` (untracked, ~13,000 lines) is a pre-split snapshot loaded by nothing — safe to delete.
- `dist/js/app.js` is a stale pre-split copy that `dist/index.html` doesn't reference — safe to delete.
- Leftover `if (isMockMode)` branches (see "Full Supabase Mode").
- `handover_logs` is referenced by `MOCK_DB` but does not exist in production.

---

## Test Credentials

- One test account per role on the staging project; credentials live in the team password manager — never commit them.
- **Developer role:** (Developer-only UI is gated on `currentUser.role === 'Developer'`, not a permission key).

---

## Development Guidelines

- No build tools. External libraries (Supabase JS, Chart.js, Lucide, JsBarcode) come from CDN `<script>` tags, not npm.
- After editing any `js/*.js`, run **`node test.js`** before committing. This repo has a history of syntax-error regressions (`fc33261`).
- **Bump the `?v=` query param** in index.html for every file you changed (`js/crm.js?v=10`, `css/styles.css?v=35`, …), or browsers serve a stale copy of just that file.
- Any new user-facing string needs a key in **both** `en` and `ar` in js/translations.js.
- **Null-check DOM elements** before attaching listeners — sections are all in one document and may not be the visible one.
- `js/supabase.js` is shared by index.html, leader.html and the Android build — changes there affect all three.
- See `.agents/AGENTS.md` for the localization/RTL/theming rules enforced in this repo.

---

## Deployment Checklist

- [ ] **Syntax:** `node test.js` passes
- [ ] **Schema alignment:** code matches `database/supabase_schema.sql`; if they diverged, both change in the same commit
- [ ] **Migration applied** to production + `NOTIFY pgrst, 'reload schema';`
- [ ] **New permission keys backfilled** into production `custom_roles` — including the real role names (`admin2`, not just `Admin`)
- [ ] **Cache busting:** `?v=` bumped for every changed file
- [ ] **Hard refresh** (`Ctrl+Shift+R`) and test the changed feature end to end
- [ ] **Error handling:** new data mutations check `error` and tell the user; stock paths follow the all-or-nothing convention above
- [ ] After pushing to main, wait for Vercel to report "Ready", then hard refresh and re-test on production

**Lesson worth repeating:** every one of the six bugs in the July 2026 session was a mismatch between this file's schema and the production schema. Keeping them in sync is not bookkeeping — it is the difference between a working deploy and a silent failure.
