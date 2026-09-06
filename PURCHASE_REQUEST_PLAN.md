# Rencana Fitur: Purchase Request (Permintaan Pembelian)

**Status:** Rencana, siap dikerjakan. Semua keputusan desain sudah diambil user (§3) dan sudah divisualkan dalam mockup yang disetujui — tidak ada yang tersisa untuk ditanyakan.
**Tanggal:** 2026-09-06 (revisi 2)
**Mockup disetujui:** https://claude.ai/code/artifact/022d7708-4b3a-4109-8320-2409cd05d621 — 7 layar, memakai token desain asli aplikasi. **Buka ini dulu sebelum menulis kode**; layout, kolom tabel, dan susunan form di sana adalah spesifikasi, bukan saran.

---

## 1. Ringkasan

Fitur agar user mengajukan **permintaan pembelian** kepada manager, lalu manager menyetujui atau menolak. Tidak berhubungan sama sekali dengan stok — tidak ada `packed_coffee`, `bulk_roasted_coffee`, `green_coffee`, tidak ada RPC ledger, tidak ada pengurangan/penambahan kuantitas di mana pun. Ini murni alur izin.

Empat kategori pembelian:

| Bahasa Indonesia | Nilai di database & UI |
|---|---|
| Bahan baku | `Raw Materials` |
| Peralatan | `Equipment` |
| Kebutuhan rumah tangga | `Housekeeping Supplies` |
| Lain-lain | `Other` |

Istilah ketiga dipilih user dari tiga kandidat. "Household Needs" (terjemahan harfiah) sengaja **tidak** dipakai karena terdengar seperti belanja rumah pribadi, bukan istilah procurement. "Consumables" ditolak karena tumpang tindih dengan Raw Materials yang juga habis pakai; "General Supplies" ditolak karena batasnya kabur.

---

## 2. Apa yang sudah ada dan dipakai ulang

Fitur ini **tidak menciptakan pola baru**. Tiru yang sudah ada.

| Yang ditiru | Sumber |
|---|---|
| Section dengan 2 tab | `sec-handover` di [index.html](index.html) — `tab-dispatch-request` + `tab-dispatch-approval` |
| Header + items dua tabel | `request_orders` + `request_order_items` di [database/supabase_schema.sql:418](database/supabase_schema.sql:418) |
| **Form dua kolom** (input kiri, keranjang + tombol kanan) | **`.sr-grid` / `.sr-panel` / `.sr-cart-scroll` di [css/styles.css:952](css/styles.css:952)**, dipakai Stock Release di [js/packing.js:5914](js/packing.js:5914) — pakai kelas CSS yang sama persis, jangan bikin kelas baru |
| Popup detail saat baris diklik | `openOrderDetailPopup` di [js/sales.js:1103](js/sales.js:1103) |
| Tabel approval + approve/reject | `loadDispatchApprovalTable` / `approveSalesOrder` di [js/sales.js:1307](js/sales.js:1307) |
| Gate section berdasarkan permission | `SECTION_PERMISSIONS` di [js/auth.js:131](js/auth.js:131) |
| Grup permission di UI role | `PERMISSION_GROUPS` di [js/settings.js:303](js/settings.js:303) |

File baru: **`js/purchasing.js`**, dimuat sebagai `<script>` biasa sebelum `js/app.js`. `node test.js` otomatis ikut memeriksanya begitu tag `<script>`-nya ada — tidak perlu menyentuh `test.js`.

---

## 3. Keputusan user

**3.1 — Empat kategori**, termasuk `Other`. Lihat §1.

**3.2 — Approval satu tahap.** Satu manager approve atau reject, selesai. Tidak ada tahap kedua, tidak ada ambang nilai.

**3.3 — Alur berakhir di `Approved`.** Tidak ada status `Purchased` atau `Received`. Pembelian aktualnya diurus di luar sistem. **Jangan** membangun layar "tandai sudah dibeli" atau kolom tanggal terima.

**3.4 — Estimasi harga per item, opsional.** Karena opsional, **total tidak boleh dianggap angka final** — tampilkan sebagai "perkiraan" dan sebutkan berapa item yang harganya kosong. Jangan menghitung item kosong sebagai nol tanpa keterangan. Ini muncul di tiga tempat: daftar, form, dan popup detail.

**3.5 — Daftar bersifat GLOBAL.** Semua user melihat request semua orang. Tidak ada penyaringan baris berdasarkan pemilik. Yang dibatasi bukan *melihat*, melainkan *menyentuh*: tombol Edit dan Batalkan hanya muncul pada request milik sendiri. Tab-nya bernama **Purchase Request**, bukan "My Requests".

**3.6 — Tab Approval hanya untuk yang berhak.** Role tanpa `purchase_approval_view` **tidak melihat tab Approval sama sekali** — bukan tab kosong, bukan tab dengan pesan "tidak punya akses". Tabnya tidak dirender.

**3.7 — Alasan penolakan OPSIONAL.** Tombol Reject selalu aktif. Kolom alasan tetap ditampilkan menonjol dengan keterangan bahwa tanpa alasan, peminta hanya melihat status merah. Kalau kosong, banner alasan di popup detail tidak muncul — hanya baris "Rejected by [nama] · [tanggal]".

**3.8 — `purchase_request_view_own` disimpan tapi TIDAK diaktifkan.** Lihat §5.2 untuk aturan lengkapnya. Ini keputusan sadar user: barangkali suatu hari client ingin daftarnya dibatasi per pemilik.

---

## 4. Skema database

Dua tabel baru. Ikuti aturan repo: perbarui `database/supabase_schema.sql` **dan** jalankan migrasi di produksi dalam commit yang sama, lalu `NOTIFY pgrst, 'reload schema';`.

```sql
-- 21. Purchase requests (header)
CREATE TABLE IF NOT EXISTS public.purchase_requests (
    id SERIAL PRIMARY KEY,
    request_number TEXT,                      -- PR-YYMMDD-NNN, dibuat aplikasi
    category TEXT NOT NULL,                   -- 'Raw Materials' | 'Equipment' | 'Housekeeping Supplies' | 'Other'
    status TEXT DEFAULT 'Requested',          -- 'Requested' | 'Approved' | 'Rejected' | 'Cancelled'
    purpose TEXT,                             -- keperluan, WAJIB diisi aplikasi
    notes TEXT,                               -- catatan tambahan untuk manager, opsional
    needed_by DATE,                           -- opsional
    requested_by_id UUID,                     -- profiles.id — SUMBER KEBENARAN kepemilikan (§7.2)
    requested_by_name TEXT,                   -- snapshot nama saat dibuat, untuk tampilan & riwayat
    request_date DATE DEFAULT CURRENT_DATE,
    decided_by_id UUID,                       -- profiles.id manager yang memutuskan
    decided_by_name TEXT,                     -- snapshot nama
    decided_at TIMESTAMPTZ,
    decision_note TEXT,                       -- alasan; OPSIONAL bahkan saat Rejected (§3.7)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 22. Purchase request items
CREATE TABLE IF NOT EXISTS public.purchase_request_items (
    id SERIAL PRIMARY KEY,
    purchase_request_id INTEGER,              -- FK ke purchase_requests.id (INTEGER, bukan UUID — §7.5)
    item_name TEXT NOT NULL,
    qty NUMERIC,
    unit TEXT,                                -- 'pcs' | 'kg' | 'box' | dst, teks bebas
    estimated_price NUMERIC,                  -- NULL = peminta tidak tahu harganya (§3.4)
    item_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

RLS: pakai policy `full_access` (`FOR ALL USING (true)`) yang sama persis dengan semua tabel lain di proyek ini. Otorisasi ditegakkan di klien lewat `hasPermission()`, bukan RLS — jangan menyimpang dari pola itu, karena akan jadi satu-satunya tabel dengan aturan berbeda.

**Kategori disimpan di header, bukan di item.** Satu request = satu kategori. Kalau suatu hari ada approver yang dibatasi per kategori (seperti yang sudah dibangun untuk customer, lihat `CUSTOMER_CATEGORY_ROLE_PLAN.md`), request campur kategori jadi mustahil diputuskan. User yang butuh dua kategori cukup membuat dua request.

---

## 5. Permission keys

### 5.1 — Key yang aktif (enam)

```
🛒 Purchase Request
  purchase_request_view          Lihat daftar purchase request
  purchase_request_create        Buat purchase request
  purchase_request_edit          Ubah request sendiri selama masih Requested
  purchase_request_delete        Batalkan request sendiri

✅ Purchase Approval
  purchase_approval_view         Lihat tab Approval
  purchase_approval_decide       Approve / Reject
```

Section baru `sec-purchasing` didaftarkan di `SECTION_PERMISSIONS`:

```js
'sec-purchasing': ['purchase_request_view', 'purchase_approval_view'],
```

Peran default saat rollout:

| Role | Lihat daftar | Buat | Approve |
|---|---|---|---|
| Developer, Admin | ya | ya | ya |
| Production Leader | ya | ya | ya |
| Roaster, Packing Team | ya | ya | tidak |
| Sales Agent | ya | ya | tidak |

### 5.2 — Key ke-tujuh: `purchase_request_view_own` (DISIMPAN, TIDAK AKTIF)

Keputusan user §3.8. Aturannya ketat, ikuti persis:

1. **Ditulis ke data.** Masukkan ke seed `MOCK_DB.custom_roles` ([js/app.js](js/app.js)) dan ke backfill produksi (Fase 0), **bernilai `false` untuk semua role**. Tujuannya supaya key-nya sudah ada di setiap baris sejak awal — kalau baru ditambahkan nanti saat diaktifkan, semua role lama akan kehilangan key itu dan langsung terkena jebakan "absen = `false`" (§7.1).

2. **TIDAK dimasukkan ke `PERMISSION_GROUPS`.** Checkbox yang bisa dicentang tapi tidak melakukan apa-apa lebih berbahaya daripada tidak ada checkbox sama sekali: admin akan mencentangnya, mengira daftarnya jadi terbatas, padahal tidak. Key ini tidak boleh muncul di UI Role Management sampai benar-benar diaktifkan.

3. **TIDAK dibaca kode mana pun.** Jangan tulis `hasPermission('purchase_request_view_own')` di file mana pun. Jangan buat fungsi filter yang memanggilnya "untuk berjaga-jaga". Kode mati yang menunggu diaktifkan akan membusuk.

4. **Tinggalkan satu komentar** di `js/purchasing.js`, tepat di atas fungsi yang memuat daftar, yang berbunyi kira-kira: key `purchase_request_view_own` sudah ada di data tapi sengaja belum aktif (PURCHASE_REQUEST_PLAN.md §5.2); untuk mengaktifkannya nanti, tambahkan key-nya ke `PERMISSION_GROUPS` dan saring daftar di sini berdasarkan `requested_by_id === currentUser.id`. Satu komentar, bukan kode.

---

## 6. Fase pengerjaan

### Fase 0 — Skema, permission, backfill

1. Migrasi dua tabel di produksi + policy `full_access` + `NOTIFY pgrst, 'reload schema';`
2. Perbarui `database/supabase_schema.sql` di commit yang sama.
3. Tambah **enam** key aktif ke `PERMISSION_GROUPS` ([js/settings.js](js/settings.js)) dan **tujuh** key (enam aktif + `view_own` bernilai `false`) ke seed `MOCK_DB.custom_roles` ([js/app.js](js/app.js)) untuk keenam role default.
4. **Backfill eksplisit ketujuh key ke semua baris `custom_roles` produksi** — §7.1. Ini syarat rilis, bukan kerapian.

*Verifikasi:* query `custom_roles`, pastikan **tidak ada** role yang kehilangan salah satu dari ketujuh key (`permissions ? 'purchase_request_view_own'` harus `true` untuk semua baris, nilainya `false`). Login sebagai role non-admin, pastikan tidak ada perubahan perilaku apa pun di fase ini.

### Fase 1 — Kerangka section

Section `sec-purchasing` + menu sidebar (letakkan antara Item Request dan Reports, lihat mockup layar 1). Dua tab: **Purchase Request** dan **Approval**.

Tab Approval **tidak dirender** kalau `hasPermission('purchase_approval_view')` bernilai false (§3.6, mockup layar 2).

Semua string lewat `data-i18n`, key ditambahkan ke `en` **dan** `ar` di [js/translations.js](js/translations.js).

*Verifikasi:* role tanpa key purchasing tidak melihat menunya; role dengan `purchase_request_view` tapi tanpa `purchase_approval_view` melihat menu dan tab pertama saja — tab kedua tidak ada di DOM.

### Fase 2 — Form buat & ubah request (mockup layar 3)

**Tata letak dua kolom memakai `.sr-grid`, `.sr-panel`, `.sr-cart-scroll` yang sudah ada di `css/styles.css`.** Kiri: Request No. (readonly), Category, Needed By, Purpose, lalu blok tambah barang (Item Name, Qty, Unit, Est. Price, Catatan item) + tombol "Add to list". Kanan: panel berisi daftar barang, Notes, perkiraan total, dan tombol Cancel + Kirim Request.

Nomor request `PR-YYMMDD-NNN` dibuat otomatis dan readonly.

Simpan `requested_by_id` dari `currentUser.id` **dan** `requested_by_name` dari `currentUser.name`.

Ubah hanya boleh selama `status = 'Requested'` **dan** `requested_by_id === currentUser.id`.

*Verifikasi:* buat request `ZZ TEST` berisi 2 item, satu dengan harga, satu tanpa. Cek di database: `requested_by_id` terisi UUID yang benar, dan item tanpa harga tersimpan `NULL`, **bukan** `0`. Cek juga perkiraan total di panel kanan menyebutkan "1 dari 2 item belum ada harganya".

### Fase 3 — Daftar global (mockup layar 1)

Kolom: Request (nomor + tanggal + needed by), Requested By, Category, Items, Est. Total, Status, Actions.

- **Tanpa penyaringan pemilik** — semua request semua user (§3.5).
- Kolom Status berisi badge + baris kecil di bawahnya: `menunggu keputusan` untuk Requested, atau `oleh [nama pemutus] · [tanggal]` untuk Approved/Rejected.
- Baris milik sendiri diberi penanda: `box-shadow: inset 3px 0 0 var(--primary)` + label kecil "SAYA" di kolom Requested By.
- Tombol Edit dan Batalkan **hanya** pada baris milik sendiri yang masih `Requested`.
- Filter kategori: All + empat kategori.
- Klik baris membuka popup detail (Fase 5).

*Verifikasi:* login dua user berbeda — keduanya harus melihat jumlah baris yang sama persis. Tombol Edit/Batalkan hanya muncul di baris masing-masing.

### Fase 4 — Tab Approval (mockup layar 4)

Hanya berisi request berstatus `Requested`. Kolom: Request, Requested By, Category, Est. Total, Needed By. Klik baris membuka popup detail versi manager.

*Verifikasi:* request yang sudah Approved/Rejected tidak muncul di sini.

### Fase 5 — Popup detail + keputusan (mockup layar 5, 6, 7)

**Satu komponen popup untuk dua pemakai.** Kerangkanya identik; yang berbeda hanya:
- Kaki: manager dengan `purchase_approval_decide` mendapat tombol Tutup + Reject + Approve; selain itu hanya Tutup.
- Banner di atas: kalau `Rejected` **dan** `decision_note` terisi, tampilkan banner merah berisi alasan + "Rejected by [nama] · [tanggal]". Kalau `decision_note` kosong, tampilkan barisnya saja tanpa banner alasan. Kalau `Approved`, banner hijau berisi "Approved by [nama] · [tanggal]".

Reject membuka dialog kecil dengan kolom alasan **opsional** — tombol selalu aktif (§3.7).

Saat memutuskan, isi `decided_by_id`, `decided_by_name`, `decided_at`, dan `status`.

*Verifikasi:* approve satu request → status berubah, hilang dari tab Approval, muncul sebagai Approved di daftar lengkap dengan nama pemutus. Reject **tanpa** mengisi alasan → harus berhasil, dan popup peminta menampilkan "Rejected by ..." tanpa banner alasan. Reject **dengan** alasan → banner merah muncul. Pastikan user tanpa `purchase_approval_decide` tidak melihat tombolnya, **dan** panggilan fungsinya langsung juga ditolak (§7.3).

### Fase 6 — Cetak (opsional, boleh ditunda)

Cetak satu request untuk arsip, meniru pola cetak di sales.

---

## 7. Ranjau yang harus diwaspadai

**7.1 — Key permission yang absen berarti `false`.**
`roleHasPermission` mengembalikan `false` untuk key yang tidak ada ([js/auth.js:207](js/auth.js:207)), dan `js/settings.js:563` menulis **setiap** key eksplisit saat role disimpan (dibaca lewat atribut `name`, bukan `id`). Role lama yang belum di-backfill akan kehilangan akses diam-diam tanpa error. Backfill di Fase 0 adalah syarat rilis. Ini sudah terbukti sekali di fitur kategori customer.

**7.2 — Jangan tiru cara `filterOwnOrders` menentukan kepemilikan.**
Fungsi itu mencocokkan **nama** (`order.sales_name === currentUser.name`), dan komentarnya sendiri mengakui itu rapuh: dua user bernama sama saling melihat data, dan mengganti nama memutus hubungan dengan data lama. Di fitur ini pakai `requested_by_id` (UUID) untuk menentukan baris mana yang dapat tombol Edit/Batalkan, dan `requested_by_name` **hanya** untuk ditampilkan.

**7.3 — `hasPermission` memberi izin penuh kalau role tidak ditemukan.**
[js/auth.js:230](js/auth.js:230): `if (!role) return true;`. User yang `profiles.role`-nya salah ketik atau menunjuk role yang sudah dihapus mendapat **semua** izin, termasuk approve. Jangan mengandalkan sembunyi-tombol saja — periksa `hasPermission('purchase_approval_decide')` di dalam fungsi approve/reject itu sendiri.

**7.4 — Mata uang sudah `SAR` (diperbaiki 2026-09-06, commit `0c064a6`).**
Opsi Saudi Riyal ditambahkan ke dropdown Settings dan onboarding, dan nilai produksi disetel ke `SAR`. Baca dari `companySettings.currency`, **jangan pernah hardcode** simbolnya. Catatan: sampai hari ini `currency` belum dipakai menampilkan angka apa pun di seluruh aplikasi — fitur ini pemakai pertamanya, jadi kamu yang menentukan formatnya. Pakai `SAR 1,700.00` dan konsisten di daftar, form, popup, dan cetak.

**7.5 — Tipe foreign key: INTEGER, bukan UUID.**
`purchase_request_items.purchase_request_id` menunjuk `purchase_requests.id` bertipe `SERIAL` (integer). Perhatikan bahwa `requested_by_id`/`decided_by_id` justru **UUID** karena menunjuk `profiles.id` — dua tipe berbeda di satu tabel yang sama, mudah tertukar. Kesalahan ini pernah terjadi di proyek ini, tercatat di `REFACTORING.md`.

**7.6 — Total perkiraan bukan angka final.** Lihat §3.4.

**7.7 — Istilah status berbeda dengan Sales Order.**
Fitur ini memakai `Requested`; Sales Order memakai `Pending Approval` untuk keadaan yang sama. Ini disengaja mengikuti istilah user — **jangan** diam-diam menyamakan salah satunya.

**7.8 — Kategori `Other` tidak punya penjaga teknis.**
Kategori bebas cenderung menyedot segalanya sampai tiga kategori lain jadi sepi. Tidak ada kode tambahan yang diminta; cukup pastikan `purpose` tetap wajib diisi supaya isinya bisa ditinjau nanti.

**7.9 — Cache-busting.**
Setiap file JS yang berubah harus dinaikkan `?v=` miliknya sendiri di [index.html](index.html), termasuk `js/purchasing.js` yang baru. Tanpa ini fiturnya "tidak muncul" di live meski sudah ter-deploy — sudah pernah terjadi.

**7.10 — i18n dan tema.**
Tidak boleh ada teks Inggris yang ditulis langsung di HTML/JS; semua lewat `data-i18n` atau `window.t()`, key ditambahkan ke `en` **dan** `ar`. Tidak boleh ada warna hardcode; pakai CSS custom property (`var(--danger)`, `var(--warning)`, `var(--text-muted)`, dst).

---

## 8. Di luar cakupan (sengaja)

Jangan dikerjakan tanpa permintaan baru dari user:

- Status `Purchased` / `Received` dan pelacakan penerimaan barang — ditolak eksplisit di §3.3
- Approval bertingkat atau ambang nilai — ditolak eksplisit di §3.2
- Mengaktifkan `purchase_request_view_own` — §5.2
- Permission approver **per kategori** — skemanya sudah disiapkan, tapi ini penambahan terpisah
- Lampiran foto/dokumen — belum ada penyimpanan file di proyek ini
- Hubungan apa pun ke stok, supplier, atau green bean intake — user menegaskan fitur ini tidak berhubungan dengan stok
