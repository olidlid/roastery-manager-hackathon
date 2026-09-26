# Halaman CRM Management — Rencana Pengerjaan

**Status:** Rencana. Belum ada satu baris kode pun. Semua keputusan desain sudah diambil user (§2) — tidak ada yang tersisa untuk ditanyakan kecuali yang ditandai TANYAKAN.
**Tanggal:** 2026-09-26
**Untuk dikerjakan oleh:** sesi Sonnet terpisah
**Mockup (spesifikasi visual):** `docs/crm_mockup.html` — buka di browser, satu halaman scroll.

Dokumen pendamping:
- `CRM_JOURNEY_DATA.md` — kebutuhan data tab Journey. **Bagian skema di §4 rencana ini berasal dari sana.**
- `CRM_INSIGHTS_PLAN.md` — halaman **lain** (sub-tab di dalam Customers). Sudah jadi dan sudah live. Jangan disentuh.
- `CUSTOMER_CATEGORY_ROLE_PLAN.md` — akses customer per kategori. Tetap berlaku penuh.

---

## 1. Yang SUDAH ada — jangan dibangun ulang

Baca ini sebelum menulis kode apa pun. Sebagian besar perhitungan yang dibutuhkan halaman CRM **sudah berdiri**.

| Sudah ada | Lokasi |
|---|---|
| `computeOrderStatsByKey(orders, items, {groupByFn, startDate, endDate, statuses})` → `{orderCount, bags, kg, firstOrderDate, lastOrderDate, avgIntervalDays, orderDates}` | `js/db.js:74` |
| `median()`, `daysBetween()` | `js/db.js` |
| `getCustomerOrdersRaw(forceRefresh)` — cache order+item yang sudah difilter permission | `js/sales.js:144` |
| `computePeerMedians()`, `getCustomerSegment()`, `getReorderBadge()`, `REORDER_BADGE_META`, `SEGMENT_BADGE_META` | `js/sales.js:47-143` |
| `allowedCustomerTypes()`, `filterCustomersByAccess()`, `filterOrdersByCustomerCategory()`, `filterOwnOrders()` | `js/auth.js:307-390` |
| Sub-tab **CRM Insights** di dalam `#sec-customers` (`tab-cust-crm`) — halaman sales, sudah live | `js/sales.js` + `js/app.js:1226` |
| `openModal(title, htmlContent)`, `showWarningModal()`, `lockProcessingScreen()` | `js/app.js` |

**Halaman CRM yang dibangun di sini adalah halaman KEDUA dan TERPISAH.** Sub-tab CRM Insights yang sudah live tetap di tempatnya, tidak diubah, tidak dipindah, tidak dihapus. Dua halaman ini memang sengaja berdampingan: yang lama untuk sales, yang baru untuk management.

---

## 2. Keputusan user — final, jangan ditawar ulang

1. **Halaman baru sendiri**, bukan tab di dalam Customers. Alasannya manajemen role: satu role memegang satu halaman utuh, bukan dipecah-pecah seperti `customer_view`/`customer_add`/`customer_edit`.
2. **Satu izin saja: `crm_manage`**, menggerbangi seluruh item sidebar dan semua isinya.
3. **Customer dibagi per sales.** Kepemilikan mengikuti siapa yang membuat customer itu.
4. **Kepemilikan TIDAK membatasi akses.** Pagar aksesnya tetap kategori (`customer_cat_retail/wholesale/supermarket`) seperti sekarang. Sales boleh memakai customer milik sales lain selama kategorinya cocok. Kepemilikan murni untuk pengelompokan dan manajemen. *Konsekuensinya: fitur ini tidak mengambil akses siapa pun — aman untuk operasional harian.*
5. **Backfill kepemilikan otomatis**: setiap customer lama diberikan ke sales yang paling banyak mengorder untuknya. Yang tidak punya order sama sekali dibiarkan kosong.
6. **Ada keranjang "Unassigned"** untuk customer tanpa pemilik, terlihat oleh leader.
7. **Tidak ada angka uang di mana pun.** Semua dalam kg dan bag. Struktur datanya tetap dijaga agar siap kalau klien memintanya nanti (`project-no-money-in-scope`).
8. **Tab Journey pada modal sales sengaja dikosongkan** — akan dirancang setelah halaman ini berdiri. Bangun tabnya, isinya kosong sesuai mockup.

---

## 3. Mockup adalah spesifikasi

`docs/crm_mockup.html` memuat: susunan halaman, dua tab halaman, tile, kartu KPI, kolom tabel, filter, isi modal customer, isi tab Sales Performance, dan modal sales.

Aturannya sama seperti pekerjaan sebelumnya di repo ini:
- Kalau kode dan mockup berbeda → **mockup yang benar**.
- Yang tidak digambar di mockup → ikuti rencana ini.
- Yang tidak ada di keduanya → **tanyakan**, jangan karang sendiri.

**Satu hal yang TIDAK boleh disalin dari mockup:** angka-angkanya. Semua angka di mockup dihitung dari **seluruh** order tanpa menyaring status, sekadar agar mockup terisi data nyata. Implementasi harus memakai aturan status di §6.1, jadi angkanya akan sedikit berbeda — itu benar, bukan bug.

Warna, spasi, dan gaya visual mockup adalah mockup. Di aplikasi, pakai komponen dan token yang sudah ada (`var(--bg-app)`, `.tab-btn`, `.btn`, dst). **Tidak boleh ada warna hardcoded.**

---

## 4. Perubahan skema

Semua dari `CRM_JOURNEY_DATA.md`. Kerjakan sekaligus di Fase 0, termasuk yang baru dipakai nanti — justru itu intinya: yang tidak dicatat sekarang hilang selamanya.

```sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS owner_sales_id   UUID,          -- profiles.id
  ADD COLUMN IF NOT EXISTS owner_sales_name TEXT,          -- snapshot nama, pola sama seperti decided_by_name
  ADD COLUMN IF NOT EXISTS owner_since      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by_id    UUID,
  ADD COLUMN IF NOT EXISTS created_by_name  TEXT,
  ADD COLUMN IF NOT EXISTS deactivated_at   TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.customer_owner_history (
    id              SERIAL PRIMARY KEY,
    customer_id     INTEGER NOT NULL,
    from_sales_id   UUID,
    from_sales_name TEXT,
    to_sales_id     UUID,
    to_sales_name   TEXT,
    changed_by_id   UUID,
    changed_by_name TEXT,
    changed_at      TIMESTAMPTZ DEFAULT NOW(),
    note            TEXT
);
ALTER TABLE public.customer_owner_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY full_access ON public.customer_owner_history FOR ALL USING (true) WITH CHECK (true);
```

**Backfill sekali jalan, di migrasi yang sama:**

1. `owner_sales_id`/`owner_sales_name`/`owner_since` ← sales yang paling banyak mengorder untuk customer itu (keputusan §2.5), dicocokkan `request_orders.sales_name` → `profiles.name`, `owner_since` = tanggal order pertama sales tersebut untuk customer itu.
2. `created_by_id`/`created_by_name` ← `sales_name` dari order **paling awal** customer itu.
3. Customer tanpa order sama sekali → semua kolom NULL. **Jangan ditebak.**

Kenapa pencocokan nama boleh dipakai di sini padahal rapuh: per 2026-09-26 keempat nilai `sales_name` masih cocok persis dengan `profiles.name`, jadi backfill sekali ini akurat. Setelah itu **id yang jadi acuan**; nama hanya snapshot tampilan. Sudah ada dua profil berawalan "Abdullah" (`Abdullah Al Modaifer` dan `Abdullah al Rasheed`), jadi mencocokkan nama belakangan berbahaya, bukan sekadar rapuh.

Acuan identitas sales adalah **`profiles`**, bukan tabel `sales_agents` — tabel itu masih menyimpan baris usang (`QA_TEST_BLEND_CODE`, `101`) dan tidak dipakai untuk login.

Setelah migrasi: perbarui `database/supabase_schema.sql` lalu jalankan `NOTIFY pgrst, 'reload schema';` (kadang perlu dua kali).

---

## 5. Izin `crm_manage`

Enam tempat, semuanya wajib — melewatkan salah satu membuat fitur tak terlihat oleh siapa pun:

1. `SECTION_PERMISSIONS` di `js/auth.js` → `'sec-crm': 'crm_manage'`.
2. Daftar izin di Settings → Role Management, `js/settings.js:380` area → `{ key: 'crm_manage', label: 'CRM management page' }`.
3. `MOCK_DB.custom_roles` di `js/app.js:137` → tambahkan `crm_manage` ke **keenam** role bawaan. Nilai: `true` untuk Developer, Admin, Production Leader; `false` untuk Roaster, Packing Team, Sales Agent.
4. **Backfill key ke baris `custom_roles` di produksi.** Key yang tidak ada di baris role dibaca `false` — ini persis yang pernah terjadi pada `purchase_request_view_own`. Jalankan UPDATE jsonb untuk keenam role.
5. Item sidebar di `index.html` dengan `data-target="sec-crm"`.
6. Tidak perlu diapa-apakan di `applyMenuVisibility()` — daftar subitem yang di-hardcode di `js/auth.js:427` hanya untuk dropdown Inventory, dan CRM adalah menu tingkat atas.

**Jangan** menambahkan `crm_manage` ke `PERMISSION_FALLBACKS`. Halaman ini memang harus dinyalakan secara sadar per role.

---

## 6. Perhitungan

### 6.1 Order mana yang dihitung — keputusan yang tidak boleh diubah diam-diam

Dua aturan berbeda, sengaja:

| Untuk | Status yang dipakai | Alasan |
|---|---|---|
| **Volume** (kg, bag, kg per bulan, komposisi kopi, performa sales) | `['Dispatched', 'Completed']` — default `computeOrderStatsByKey` | Yang benar-benar keluar dari gudang |
| **Ritme & perkiraan order** (jeda antar order, tanggal berikutnya, menghilang) | semua status **kecuali** `Cancelled` dan `Unable to Fulfill` | Yang menentukan ritme adalah **tindakan memesan**, bukan pengirimannya. `Unable to Fulfill` dikecualikan karena itu kegagalan produksi, bukan perilaku pelanggan |

Kalau kamu merasa aturan ini salah, **bilang dulu** — jangan diam-diam menyeragamkannya.

### 6.2 Perkiraan tanggal order berikutnya

Metodenya sudah diuji ulang terhadap riwayat order asli (18 prediksi, 10 customer). Rata-rata meleset: **campuran berbobot 5,28 hari** · rhythm saja 5,33 · campuran tetap 70/30 6,31 · konsumsi saja 16,49. Alat ujinya ada di `docs/reorder_backtest.js` — tempel di console browser untuk menjalankan ulang kapan saja.

Per customer:

1. `gaps` = selisih hari antar order berurutan.
2. **rhythm** = median dari **6 gap terakhir**.
3. **consumption** = kg order terakhir ÷ (total kg sebelum order terakhir ÷ rentang hari order pertama→terakhir).
4. **Campuran berbobot**, bobot dihitung **per customer dari kesalahannya sendiri**: putar ulang riwayat customer itu ke depan (walk-forward), dapatkan rata-rata kesalahan tiap metode, lalu `w = 1/(kesalahan + 1)`; hasil = rata-rata tertimbang keduanya.

**Guardrail — semuanya wajib:**

| Kondisi | Yang ditampilkan |
|---|---|
| < 3 order | Tidak ada tanggal sama sekali |
| 3–5 order | rhythm saja, rentang ± lebar |
| ≥ 6 order | campuran berbobot menyala |
| hasil di luar 0,5×–2,5× rhythm | dijepit ke batas itu |
| sudah lewat 2× rhythm tanpa order | **tidak ada tanggal** — tampilkan "quiet N days" |
| rentang ± | dari kesalahan masa lalu customer itu sendiri, minimal ±1 hari |

Perkiraan **ukuran** order (kg) memakai median kg dari 3 order terakhir; komposisi kopinya juga dari 3 order terakhir. kg dipakai untuk menebak **besarnya** order, bukan tanggalnya.

**Akurasi dicetak di bawah tabel** ("± 4 days over the last 30 orders"), dihitung dari prediksi yang sudah terbukti. Ini bukan hiasan: tanpanya, metode yang membusuk tidak akan ketahuan sampai ada yang komplain.

### 6.3 Performa sales

Kumpulkan per `owner_sales_id` (bukan per `sales_name` di order — lihat mockup tab Sales Performance untuk kolomnya). Aturan keadilan yang harus ikut terbangun, bukan sekadar hiasan di mockup:

1. **Tiap sales dibandingkan dengan periode sebelumnya milik dirinya sendiri**, bukan diadu satu sama lain.
2. **Angka per customer ditampilkan bersebelahan dengan total** — 30 customer lawan 9 customer bukan perbandingan yang jujur.
3. **`Unable to Fulfill` tidak dihitung sebagai kegagalan sales** — itu stok kurang, urusan produksi.
4. **Akun yang tidak memegang customer sama sekali tidak diberi peringkat** (di produksi: `khaleed`, `Ahmad`). Ujinya "tidak memegang customer", bukan jabatannya.
5. **Tidak ada metrik aktivitas** (kunjungan, telepon). App ini tidak punya lognya — jangan mengarang.

---

## 7. Struktur UI

- Section baru `<section id="sec-crm" class="page-section hidden">` di `index.html`.
- **Dua tab halaman**: `Customers` | `Sales Performance`, memakai konvensi `.tab-btn` / `.tab-content` yang sudah ada (tiru pola Reports di `js/app.js`), **bukan** toggle buatan sendiri.
- File baru **`js/crm.js`**, dimuat setelah `js/sales.js` dan sebelum `js/app.js` di `index.html` (butuh helper dari sales.js, dipakai oleh bootstrap app.js).
- `loadSectionData()` di `js/app.js` → `case 'sec-crm':` memuat tab yang sedang aktif, ikuti pola `sec-customers` di `js/app.js:1226`.
- Semua modal lewat `openModal(title, htmlContent)` yang sudah ada — **jangan** membuat overlay sendiri. Overlay di mockup itu batasan mockup, bukan pola untuk ditiru.

---

## 8. Menulis kepemilikan — satu operasi, tidak boleh setengah jadi

Tombol pensil "ganti sales" dan "Assign sales…" massal menulis **dua** hal: update `customers` dan satu baris `customer_owner_history`. Ikuti konvensi jalur stok (`ee14598`): kunci layar, kerjakan, **verifikasi**, baru laporkan sukses. Kalau baris history gagal ditulis, kembalikan update `customers`-nya — kepemilikan tanpa jejak lebih buruk daripada perubahan yang gagal, karena sejarahnya tidak bisa dipulihkan.

Baris `customer_owner_history` **hanya ditambah** — tidak pernah diubah, tidak pernah dihapus, sama seperti ledger stok.

---

## 9. Fase pengerjaan — kerjakan berurutan, uji tiap fase

| # | Isi | Selesai kalau |
|---|---|---|
| 0 | Migrasi SQL + backfill data + backfill permission + seed `MOCK_DB` + `supabase_schema.sql` + `NOTIFY pgrst` | Query cek: tiap customer ber-order punya `owner_sales_id`; 6 role punya key `crm_manage` |
| 1 | Section + sidebar + izin + dua tab halaman (isi kosong) | Menu muncul hanya untuk role ber-`crm_manage`; tab berpindah |
| 2 | Tab Customers: tile sales + kategori, 6 kartu KPI yang jadi filter, tabel, filter corong di header Category/Sales/Status, tombol Reset | Klik kartu → tabel tersaring + halaman scroll ke tabel; Reset mengembalikan semuanya |
| 3 | Mesin perkiraan order (§6.2) + kolom Next order + baris akurasi di bawah tabel | Guardrail terbukti: customer <3 order tidak dapat tanggal, yang menghilang tampil "quiet N days" |
| 4 | Kepemilikan: tombol pensil, modal ganti sales, assign massal, tulis history (§8) | Ganti sales → baris baru di `customer_owner_history`, `owner_since` ikut berubah |
| 5 | Modal customer — tab Performance | Angka di modal sama dengan angka di baris tabelnya |
| 6 | Tab Sales Performance + modal sales (tab Performance + Customers, tab Journey **kosong**) | Klik baris sales → modal terbuka, tab Journey tampil kosong sesuai mockup |
| 7 | Modal customer — tab Journey (kartu rekap + milestone terhitung) | Milestone muncul tanpa ada yang mengetikkannya |

Fase 7 boleh ditunda kalau waktunya habis — fase 0–6 sudah halaman yang utuh dan berguna. Fase 0 tidak boleh ditunda sebagian: kolom yang tidak dibuat sekarang berarti data yang hilang selamanya.

---

## 10. Yang paling sering terlupa di repo ini

- **Backfill permission itu wajib** (§5.4). Tanpa itu fitur tak terlihat bahkan oleh Admin.
- **Tidak boleh ada teks Bahasa Indonesia di UI.** Semua lewat `t()` dengan key ditambahkan di **`en` dan `ar`** di `js/translations.js`. Commit `69ca581` adalah pekerjaan membersihkan kebocoran seperti ini.
- **Tidak boleh ada warna hardcoded** — semua lewat CSS custom property, karena variabel yang sama menggerakkan mode gelap/terang.
- **Null-check setiap elemen DOM** sebelum memasang listener.
- **Bump `?v=`** di `index.html` untuk setiap file JS yang diubah, dan **tambahkan `js/crm.js?v=1`**.
- **`node test.js`** harus lolos sebelum commit.
- **Jangan menulis kolom turunan** (`customers` selain kolom kepemilikan/aktivasi) dari halaman ini. Halaman CRM tidak mengedit data customer — untuk itu sudah ada halaman Customers.
- **Jangan menyentuh `#sec-customers`** sama sekali (§1).

---

## 11. Sebelum lapor selesai

Sebutkan mana yang sudah diuji sendiri di browser dan mana yang belum. Jangan menulis "selesai" untuk bagian yang belum pernah dijalankan. Untuk Fase 0, sertakan hasil query verifikasinya, bukan asumsi.
