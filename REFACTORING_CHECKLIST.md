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

### ❌ Masalah 3 (ditemukan saat Task #1): `node test.js` hanya benar-benar mengecek ~22% file
- `jsdom` **belum pernah ter-install** — `node test.js` selama ini gagal MODULE_NOT_FOUND, bukan cuma di sesi ini
- Setelah jsdom di-install: sandbox DOM-nya kosong (`<body></body>`), padahal app.js punya 17 titik top-level `document.getElementById(x).addEventListener(...)` tanpa null-check. Titik PERTAMA yang elemennya tidak ada di sandbox kosong → crash → sisa ~78% file tidak pernah dievaluasi/di-cek sama sekali oleh test ini, dari dulu.
- **KEPUTUSAN:** `test.js` diperbaiki untuk (1) load body `index.html` asli, (2) auto-baca semua `<script src="js/...">` dari index.html sesuai urutan & gabungkan sebelum eval — otomatis tetap valid saat app.js dipecah jadi banyak file di fase berikutnya, tidak perlu edit test.js lagi tiap fase. `jsdom` ditambahkan ke devDependencies.

---

## ✅ Task #1: Pre-flight Backup & Git Setup
- [x] Clean commit: checklist file dikomit (`a9e5644`)
- [x] Branch: `refactor/v1-modularization` dibuat
- [x] Tag: `v1-pre-refactor-20260708` dibuat
- [x] Verify: `node server.js` OK (login page render sempurna, 0 console error) + `node --check js/app.js` OK
- [x] Verify: `node test.js` diperbaiki (lihat Masalah 3 di atas) — sekarang exit 0, "Script evaluated successfully without SyntaxErrors" untuk SELURUH file
- [x] Baseline dicatat: app.js = 13.018 baris, 160 fungsi, 35 `onclick=` di app.js (+47 lagi di index.html = 82 total)
- [x] File asing `js/app_backup.js` (identik dengan app.js) ditemukan — dibiarkan untracked atas keputusan user, tidak ikut di-commit
- [x] **Commit:** `da20161` — fix test.js + install jsdom

**Done:** ☑

---

## ✅ Task #2: Split db.js (PLAIN SCRIPT, not ES module)
- [x] Create `js/db.js` (plain, no export) — 193 lines
- [x] MOVE (cut, not copy): fetchData, saveData, deleteData, upsertData, saveDataImpl, deleteDataImpl, getMockTable/setMockTable, _dbCache/getCachedTable/invalidateCache, _showSavingIndicator/_hideSavingIndicator/_clearSavingButton/_savingCount, submit-listener
- [x] index.html load order: `<script src="js/db.js?v=1">` right before app.js (bumped to `?v=41`)
- [x] `node --check js/db.js` + `js/app.js` OK; `node test.js` exit 0, no "not defined"
- [x] Lokal (preview browser): confirmed fetchData/saveData/deleteData/upsertData are callable globals
- [x] Lokal: full insert→fetch→update→delete→upsert cycle against stubbed Supabase — correct at every step
- [x] Lokal: real `loadGreenbeanInventory()` renders data via the moved fetchData()
- [x] Lokal: real form submit → is-saving spinner + pill appear during save, clear cleanly after (no stuck-spinner regression)
- [x] Console: ZERO errors
- [x] app.js: 13,018 → 12,833 lines
- [x] **Commit:** `c717b80` — refactor: split db.js into separate plain script

**Done:** ☑

---

## ✅ Task #3: Split auth.js (PLAIN SCRIPT, not ES module)
**Depends on:** #2
- [x] Create `js/auth.js` (plain) — 332 lines
- [x] MOVE (cut, not copy): syncCustomRolesFromSupabase, configOverlay/authOverlay/onboardingOverlay, checkDatabaseConnection, updateGreeting, SECTION_PERMISSIONS, PERMISSION_FALLBACKS, roleHasPermission, hasPermission, getFirstAllowedSection, applyMenuVisibility, applyRoleAccess, checkAuthentication, loadUserProfile
- [x] ⚠️ **Revisi ditemukan saat kerja:** PERMISSION_GROUPS TIDAK dipindah — dipakai eksklusif oleh role-management UI (Settings), jadi itu wilayah Task #4, bukan #3
- [x] ⚠️ **Revisi kedua (penting):** 3 IIFE anti-flash (primeBrandFromCache, primeUserFromCache, primeMenuAccessFromCache) SENGAJA TIDAK dipindah — mereka eksekusi langsung saat parse, dan primeMenuAccessFromCache assign ke `currentUser` (`let` di app.js). Karena auth.js load SEBELUM app.js, itu akan kena temporal-dead-zone error. Ketiga IIFE tetap di app.js; fungsi yang mereka panggil (hasPermission dkk, sekarang di auth.js) aman karena hanya dipanggil belakangan saat runtime.
- [x] Load: db.js → auth.js → app.js (index.html `?v=1` untuk auth.js, app.js bump ke `?v=42`)
- [x] `node --check` kedua file OK + `node test.js` exit 0, auth.js otomatis terbaca di urutan benar
- [x] Lokal: seeded role Roaster2 terbatas + cache identitas → reload → menu terfilter benar (Dashboard+Roasting saja) DAN nama/role tampil instan, SEMUA sebelum auth overlay hilang — NOL regresi flash
- [x] Lokal: logout membersihkan cached_user_identity dengan benar
- [x] Lokal: alur nyata checkAuthentication→loadUserProfile→applyRoleAccess→updateGreeting dieksekusi end-to-end lintas file (auth.js memanggil fungsi app.js) — berhasil, cache tertulis benar
- [x] Console: NOL error di semua skenario di atas
- [x] app.js: 12,833 → 12,517 lines
- [x] **Commit:** `2459094` — refactor: split auth.js into separate plain script

**Done:** ☑

---

## ✅ Task #4: Split UI files (PLAIN SCRIPTS, one commit each)
**Depends on:** #2, #3
- [x] `js/greenbean.js` (539 lines) → check + test + klik semua tombol → commit `8e877ef`. Bukan blok kontigu (kode roasting terselip di antaranya) — dipindah sebagai 3 sub-blok terpisah. Diverifikasi: render inventory+intake dari data asli, modal edit sungguhan (isi field→submit→cek record tersimpan benar), adjustGreenbeanStock matematikanya benar (100kg−8.5/0.85=90kg). app.js: 12,517→11,983 baris.
- [x] `js/roasting.js` (26 fungsi, 6 sub-blok terpisah via sed) → commit `80999a2`. ⚠️ **Bug TDZ nyata tertangkap oleh `node test.js`**: baris top-level lama `if (!hasPermission('roasting_plan_add')) ...style.display='none'` (sengaja jalan SETELAH primeMenuAccessFromCache agar tombol Add Plan langsung sinkron dengan cache) — dipindah balik ke app.js tepat setelah primeMenuAccessFromCache untuk menjaga urutan & perilaku persis sama. Diverifikasi: tombol Add Plan tersembunyi instan sesuai cache role (sebelum auth selesai), render Plans/Batches/Recipes/Potential dari data asli, modal recipe terbuka, semua fungsi lintas-file (adjustGreenbeanStock, addWeightToBulkRoastedCoffee, dll) resolve benar. app.js: 11,983→8,808 baris (pengurangan terbesar).
- [x] `js/packing.js` (19 fungsi, 3 sub-blok via sed) → commit `042bb2d`. Tidak ada bug TDZ (sudah dicek pola sama seperti roasting.js, aman). Diverifikasi: Bulk Roasted & Packed Coffee render data asli, modal edit bulk terbuka, semua fungsi (submitPackingSheet, dispatchOrder, printWaybill, dll) resolve lintas-file. app.js: 8,808→6,675 baris.
- [x] `js/sales.js` (16 fungsi + activeSelectedOrderId, 3 sub-blok via sed) → commit `c496f93`. ⚠️ Batas Group C hampir salah — heuristik "next top-level declaration" nyaris menyeret bootstrap IIFE inti ikut pindah (tidak ada declaration di antara initHandoverPagination dan bootstrap); ketahuan karena baca isi fungsi langsung, bukan cuma percaya heuristik. Diverifikasi: Customers, Sales Dispatch Request & Approval render data asli (join nama customer/kopi benar), modal customer terbuka, semua fungsi resolve lintas-file. app.js: 6,675→4,797 baris.
- [x] `js/settings.js` (20 fungsi, 2 sub-blok via sed) → commit `accdf21`. **TASK #4 SELESAI PENUH.** ⚠️ Heuristik batas salah LAGI (ke-3 kalinya) — blok antara openPackagingSizeModal dan showSetNewPasswordModal ternyata berisi wiring LOGIN (Google/email/forgot-password), bukan settings; ketahuan karena baca isi langsung, bukan percaya gap baris. ⚠️ **Bug TDZ kedua tertangkap `test.js`**: blok "REGISTER DYNAMIC ENTITY MODAL TRIGGER BUTTONS" mencampur tombol Add dari 3 modul berbeda (greenbean, roasting, settings) dengan 2 baris top-level hasPermission — dipindah UTUH balik ke app.js (bukan dipecah lagi) karena secara konsep bukan milik satu modul manapun. Diverifikasi: tombol Add Lot & tab Arrival tersembunyi benar sesuai role (setelah stub Supabase karena preview ini connect ke production sungguhan yang menimpa data test — quirk testing, bukan bug), Users/Machines/Packaging Sizes/Role Management render data asli. app.js: 4,797→**3,614 baris** (dari awal 13,018).
- [x] 17 fungsi onclick tetap global otomatis (karena plain script) — terbukti sepanjang Task #4, tidak ada yang perlu window.expose manual
- [x] Final load order: db → auth → greenbean → roasting → packing → sales → settings → app.js (LAST) — sudah diterapkan di index.html

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
