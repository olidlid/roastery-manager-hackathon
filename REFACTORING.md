# V1 Modularization — Refactoring Notes

**Status:** Completed and merged to `main` (`160ce0e`), live in production.
**Branch:** `refactor/v1-modularization` (merged, can be deleted).
**Tag:** `v1-pre-refactor-20260708` — rollback point if ever needed (`git reset --hard v1-pre-refactor-20260708` or revert the merge commit).

This document explains *why* the refactor was shaped the way it was, since the reasoning isn't visible from the code itself. For the day-to-day mechanics (file list, load order), see CLAUDE.md's "Project Structure" and "V1 Modularization" sections. For what comes next, see V2_ROADMAP.md.

---

## Before / After

| File | Before | After |
|---|---|---|
| `js/app.js` | 13,018 lines, 160 functions, all app logic in one file | ~3,800 lines — bootstrap + shared logic not specific to one feature |
| `js/db.js` | (didn't exist) | 193 lines — `fetchData`/`saveData`/`deleteData`/`upsertData`, `_dbCache`, saving-indicator helpers |
| `js/auth.js` | (didn't exist) | 383 lines — `checkAuthentication`, `loadUserProfile`, `hasPermission`, `applyRoleAccess`, `syncCustomRolesFromSupabase`, permission tables |
| `js/greenbean.js` | (didn't exist) | 842 lines — green coffee inventory + arrival UI |
| `js/roasting.js` | (didn't exist) | 3,216 lines — roasting plans & batches UI |
| `js/packing.js` | (didn't exist) | 2,163 lines — packing UI |
| `js/sales.js` | (didn't exist) | 2,001 lines — customers, requests, dispatch approval UI |
| `js/settings.js` | (didn't exist) | 1,240 lines — settings page (roles, translation import/export, debug tools) |

The post-split total is somewhat higher than the pre-split 13,018 because feature work landed in the split files after the refactor merged — the split itself was a pure move, not a rewrite.

`node --check` and `node test.js` were run after every single file split (see Task #2–#4 commits in `git log`), and each split shipped as its own commit specifically so a regression could be bisected/reverted to exactly one file.

---

## Why plain `<script>` split, not ES modules

The original plan (before the 2026-07-08 audit) was to convert `app.js` into ES modules. That was abandoned after auditing the actual codebase surfaced two blockers:

1. **82 inline `onclick="..."` handlers in the HTML (17 unique functions).** ES modules are scoped, not global — every one of those handlers would break with "function is not defined" the moment the function they call moved into a `type="module"` script. Plain `<script>` files stay in the same global `window` scope as before, so `onclick=` keeps working with zero changes.
2. **~25 mutable global state variables** (`currentUser`, `companySettings`, chart instances, pagination state, `isMockMode`, etc.). `import` bindings are read-only live references — any `export let currentUser` reassigned from another module throws a `SyntaxError`/`TypeError` at the reassignment site. Keeping everything as plain scripts sharing one global scope avoids this entirely.
3. A secondary factor: the app has ~20 top-level DOM-touching statements plus an IIFE-based anti-flash mechanism (`primeBrandFromCache`, `primeUserFromCache`, `primeMenuAccessFromCache`) that depends on running synchronously, in order, before first paint. `type="module"` scripts are deferred by default, which would reintroduce the flash-of-unstyled-content bug the IIFEs exist to prevent.

**Net decision:** split `app.js` into multiple physical files, each still loaded as an ordinary non-module `<script src="...">` tag, in dependency order (`db.js` → `auth.js` → feature UI files → `app.js` last). Same organizational benefit as ES modules (find-in-file becomes tractable, feature boundaries are visible), essentially none of the risk.

This is also why `test.js` was rewritten to parse the `<script src="js/...">` tags out of `index.html` and concatenate them in that order before evaluating — it mirrors exactly what the browser does with several global-scope scripts, and it means the test automatically covers any *future* split without needing to be edited again.

---

## Shadow schema: lot tracking tables (V2 prep)

Two new tables were added as part of this refactor, intentionally non-breaking (additive only, touch nothing in the V1 code path):

- `green_coffee_lots`
- `packed_coffee_lots`

**The FK type bug that the original plan had:** the first draft of this schema used `UUID REFERENCES green_coffee(id)` etc. Production's actual PK types on `green_coffee.id`, `packed_coffee.id`, and `roast_batches.id` are all `SERIAL` (integer), not UUID — so the original `CREATE TABLE` would have failed outright on a type mismatch. Corrected to `INTEGER` FKs before the tables were created. If a future migration touches these tables, double-check the referenced column's actual type in `database/supabase_schema.sql` rather than assuming UUID.

These tables exist now but auto-populate triggers were deliberately **not** wired up — that's deferred to whichever V2 phase actually needs lot tracking (see V2_ROADMAP.md), so as not to touch the V1 data path without a concrete feature driving it.

---

## Known loose ends from this refactor

- `dist/js/app.js` (the Capacitor Android build source for the Leader app) was **not** touched by this split — it's a stale 6,359-line pre-split copy, and isn't even referenced by `dist/index.html` (which only loads `js/supabase.js` + `js/leader.js`). Safe to delete; wasn't in scope for this refactor since it doesn't affect the main web app.
- `js/app_backup.js` at the repo root is an untracked local snapshot of the pre-split `app.js`, kept as a manual rollback reference. The git tag `v1-pre-refactor-20260708` already serves this purpose — this file can be deleted once you're confident you won't need a non-git-based reference copy.
- `js/modules/ui/` is an empty directory with no files, left over from early planning for a different (ES-module-based) split layout that was abandoned. Safe to remove.
