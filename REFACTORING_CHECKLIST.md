---
name: refactoring_v1_tasks
description: "Safe refactoring checklist for V1 → V2 (REVISED after V1 audit: plain-script split not ES modules, INTEGER FKs not UUID)"
metadata: 
  node_type: memory
  type: project
  originSessionId: d187817f-9654-4e8e-b57b-1a4d26c9d83d
---

# 🛠️ Refactoring V1 Task Checklist (REVISED)

**Status:** Ready to execute
**Branch:** `refactor/v1-modularization`
**Risk Level:** LOW (revised from ES-modules to plain-script split)

---

## 🔍 Audit Findings (2026-07-08) — why the plan was revised

Pengecekan V1 aktual menemukan 2 masalah di plan asli yang akan memicu banyak debugging:

### ❌ Masalah 1: ES Modules = risiko tinggi → GANTI ke plain-script split
- `app.js` = **13.018 baris, 160 fungsi**
- **82 inline `onclick=`** handler (17 fungsi unik) → ES module scope bikin semua jadi "not defined"
- **~25 variabel state global mutable** (`currentUser`, `companySettings`, chart, pagination) → `import` binding read-only, setiap reassignment jadi SyntaxError
- **20 kode DOM top-level** + IIFE anti-flash → `type="module"` deferred+strict mengubah timing, flash muncul lagi
- **KEPUTUSAN:** Pecah jadi banyak file `<script>` biasa (global scope tetap sama, hanya dipecah fisik). Manfaat organisasi sama, risiko nyaris nol. TIDAK pakai import/export.

### ❌ Masalah 2: Shadow schema pakai UUID FK → tabel gagal dibuat
- `green_coffee.id`, `packed_coffee.id`, `roast_batches.id` semuanya **SERIAL (integer)**, bukan UUID
- Plan lama `UUID REFERENCES green_coffee(id)` = type mismatch, CREATE TABLE gagal
- **KEPUTUSAN:** FK pakai `INTEGER` (sudah dikoreksi di Task #6)

---

## ✅ Task #1: Pre-flight Backup & Git Setup
- [ ] Clean commit: `git add . && git commit -m "chore: cleanup before refactoring"`
- [ ] Branch: `git checkout -b refactor/v1-modularization`
- [ ] Tag: `git tag v1-pre-refactor-20260708`
- [ ] Verify: `node server.js` + `node --check js/app.js` OK
- [ ] Baseline: app.js = 13.018 baris, 160 fungsi, 82 onclick

**Done:** ☐

---

## ✅ Task #2: Split db.js (PLAIN SCRIPT, not ES module)
- [ ] Create `js/db.js` (plain, no export)
- [ ] MOVE: fetchData, saveData, deleteData, upsertData, _showSavingIndicator, _hideSavingIndicator, _clearSavingButton, _savingCount, _dbCache, invalidateCache
- [ ] index.html load order: `<script src="js/db.js">` BEFORE app.js
- [ ] `node --check js/db.js` + `node test.js` (no "not defined")
- [ ] Lokal: login→dashboard, greenbean CRUD, saving indicator
- [ ] Console: ZERO errors
- [ ] **Commit:** `refactor: split db.js into separate plain script`

**Done:** ☐

---

## ✅ Task #3: Split auth.js (PLAIN SCRIPT, not ES module)
**Depends on:** #2
- [ ] Create `js/auth.js` (plain)
- [ ] MOVE: checkAuthentication, loadUserProfile, hasPermission, roleHasPermission, PERMISSION_FALLBACKS, applyMenuVisibility, applyRoleAccess, syncCustomRolesFromSupabase, SECTION_PERMISSIONS, PERMISSION_GROUPS
- [ ] ⚠️ IIFE anti-flash (primeBrandFromCache, primeUserFromCache, primeMenuAccessFromCache) HARUS jalan sangat awal — jaga urutannya
- [ ] Load: db.js → auth.js → app.js
- [ ] `node --check` + `node test.js`
- [ ] Lokal: login email + Google, identitas instant, NO flash, menu role-based hidden, logout
- [ ] Hard-refresh berkali-kali (cek regresi flash)
- [ ] **Commit:** `refactor: split auth.js into separate plain script`

**Done:** ☐

---

## ✅ Task #4: Split UI files (PLAIN SCRIPTS, one commit each)
**Depends on:** #2, #3
- [ ] `js/greenbean.js` → check + test + klik semua tombol → commit
- [ ] `js/roasting.js` → check + test + klik semua tombol → commit
- [ ] `js/packing.js` → check + test + klik semua tombol → commit
- [ ] `js/sales.js` → check + test + klik semua tombol → commit
- [ ] `js/settings.js` → check + test + klik semua tombol → commit
- [ ] ⚠️ 17 fungsi onclick tetap global otomatis (karena plain script): openCustomerModal, deleteCustomer, viewCustomerHistory, filterCustomers, openEditGreenbeanStockModal, printSingleBarcode, printAllBarcodes, openFullscreenChart/closeFullscreenChart, openFullscreenTable, toggleSettingsCard, viewStockTake, exportTranslationsCSV, resetTranslations, saveTranslationsChanges
- [ ] Final load order: db → auth → greenbean → roasting → packing → sales → settings → app.js (LAST)

**Done:** ☐

---

## ✅ Task #5: Extract Inline CSS → Utility Classes
**Depends on:** #4 (or parallel)
- [ ] Scan: `grep -c 'style="' js/app.js`
- [ ] Group repeated inline styles (flex/pad/border/nowrap)
- [ ] Create `.util-*` classes in css/styles.css (documented)
- [ ] Replace inline → class, verify pixel-perfect identical
- [ ] **Commit:** `refactor: extract inline CSS to utility classes`

**Done:** ☐

---

## ✅ Task #6: Database Shadow Schema (FK types FIXED to INTEGER)
**Non-breaking — safe anytime, doesn't touch app.js**
- [ ] SQL Editor: create green_coffee_lots (green_coffee_id **INTEGER** REFERENCES green_coffee(id))
- [ ] SQL Editor: create packed_coffee_lots (packed_coffee_id/roast_batch_id **INTEGER**)
- [ ] RLS full_access on both + `NOTIFY pgrst, 'reload schema';`
- [ ] Trigger auto-populate: OPTIONAL, defer to real V2 build (jangan sentuh alur V1 tanpa test)
- [ ] Test FK: valid id inserts, garbage id rejected
- [ ] V1 unchanged verified
- [ ] Update database/supabase_schema.sql (INTEGER FKs)
- [ ] **Commit:** `feat: add V2 lot tracking tables (shadow schema, INTEGER FKs)`

**Done:** ☐

---

## ✅ Task #7: Integration Testing (all files together)
**Depends on:** #2-6
- [ ] Auth: login email/Google, instant identity, role enforcement, logout
- [ ] CRUD every section: greenbean, arrival, plans, batches, packing, sales, customers, settings
- [ ] Data integrity: persist after reload, no dup saves, delete cascade, permission instant
- [ ] `node test.js` + `node --check js/*.js` all OK
- [ ] Browser console: ZERO errors
- [ ] Startup < 2s, section load < 1s
- [ ] **Commit:** `test: integration testing all split files`

**Done:** ☐

---

## ✅ Task #8: Merge to Main & Verify Live
**Depends on:** #7
- [ ] Pre-merge: branch fully tested, atomic commits, no conflicts
- [ ] `git checkout main && git pull && git merge refactor/v1-modularization --no-ff && git push`
- [ ] ⚠️ Bump ALL new script `?v=` params so browsers reload every split file
- [ ] Live Vercel: deploy done, hard refresh, login, all sections, CRUD per section, console clean
- [ ] Rollback ready: `git reset --hard v1-pre-refactor-20260708` or revert merge
- [ ] **Commit:** `chore: merge refactoring branch to main`

**Done:** ☐

---

## ✅ Task #9: Document Refactoring & V2 Roadmap
**Depends on:** #8
- [ ] Update CLAUDE.md: new file structure (db/auth/greenbean/roasting/packing/sales/settings/app), load order, shadow schema
- [ ] Create REFACTORING.md: before/after, why plain-script not ES modules
- [ ] Create V2_ROADMAP.md: FIFO, Work Order, B2B, AI phases + deps
- [ ] **Commit:** `docs: refactoring complete, document V1 structure & V2 roadmap`

**Done:** ☐

---

## 🎯 Key Safety Principles
- **Plain `<script>` split, NOT ES modules** — preserves global scope, no onclick/state breakage
- **MOVE functions (cut), don't copy** — avoid duplicate definitions
- **Load order = dependency order** — db → auth → ui → app.js (last)
- **`node test.js` after every split** — catches "X is not defined" immediately
- **One commit per file** — easy revert if one breaks
- **Test by CLICKING buttons**, not just viewing — onclick errors only show at runtime
- **Shadow schema FKs = INTEGER** (green_coffee/packed_coffee/roast_batches are SERIAL)
- **Tag checkpoint** for instant rollback
