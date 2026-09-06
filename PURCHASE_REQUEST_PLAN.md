# Rencana Fitur: Purchase Request (Permintaan Pembelian)

**Status:** Rencana, belum dikerjakan. Empat keputusan desain sudah diambil user 2026-09-06 (§3) — tidak ada yang tersisa untuk ditanyakan.
**Tanggal:** 2026-09-06

---

## 1. Ringkasan

Fitur agar user mengajukan **permintaan pembelian** kepada manager, lalu manager menyetujui atau menolak. Tidak berhubungan sama sekali dengan stok — tidak ada `packed_coffee`, `bulk_roasted_coffee`, `green_coffee`, tidak ada RPC ledger, tidak ada pengurangan/penambahan kuantitas di mana pun. Ini murni alur izin.

Tiga kategori pembelian:

| Bahasa Indonesia | Nilai di database & UI |
|---|---|
| Bahan baku | `Raw Materials` |
| Peralatan | `Equipment` |
| Kebutuhan rumah tangga | `Housekeeping Supplies` |

Istilah ketiga dipilih user 2026-09-06 dari tiga kandidat. "Household Needs" (terjemahan harfiah) sengaja **tidak** dipakai karena terdengar seperti belanja rumah pribadi, bukan istilah procurement. "Consumables" ditolak karena tumpang tindih dengan Raw Materials yang juga habis pakai; "General Supplies" ditolak karena batasnya kabur dan cenderung jadi tempat pembuangan barang yang membingungkan.

---

## 2. Apa yang sudah ada dan dipakai ulang

Fitur ini **tidak menciptakan pola baru**. Alur "user membuat request → leader menyetujui" sudah ada persis di Sales Dispatch Request → Dispatch Approval. Tiru bentuknya.

| Yang ditiru | Sumber |
|---|---|
| Section dengan 2 tab (buat request / approval) | `sec-handover` di [index.html](index.html), lihat `tab-dispatch-request` + `tab-dispatch-approval` |
| Header + items dua tabel | `request_orders` + `request_order_items` di [database/supabase_schema.sql:418](database/supabase_schema.sql:418) |
| Modal isi request dengan keranjang item | `openSalesRequestModal` di [js/sales.js](js/sales.js) |
| Tabel approval + tombol approve/reject | `loadDispatchApprovalTable` / `approveSalesOrder` di [js/sales.js:1307](js/sales.js:1307) |
| Filter "hanya milik saya" | `filterOwnOrders` di [js/auth.js:233](js/auth.js:233) — **tiru idenya, jangan tiru caranya**, lihat §7 |
| Gate section berdasarkan permission | `SECTION_PERMISSIONS` di [js/auth.js:131](js/auth.js:131) |
| Grup permission di UI role | `PERMISSION_GROUPS` di [js/settings.js:303](js/settings.js:303) |

File baru: **`js/purchasing.js`**, dimuat sebagai `<script>` biasa sebelum `js/app.js` (urutannya bebas selama sebelum `app.js`, karena hanya bergantung pada `db.js`/`auth.js`). `node test.js` otomatis ikut memeriksanya begitu tag `<script>`-nya ada — tidak perlu menyentuh `test.js`.

---

## 3. Keputusan user (2026-09-06)

**3.1 — Kategori ketiga: `Housekeeping Supplies`.** Sudah final, lihat §1.

**3.2 — Approval satu tahap.** Satu manager approve atau reject, selesai. Tidak ada tahap kedua, tidak ada ambang nilai yang memaksa naik ke atasan. Konsekuensi: tidak perlu status antara, tidak perlu kolom "tahap saat ini", dan permission approval cukup satu key.

**3.3 — Alur berakhir di `Approved`.** Tidak ada status `Purchased` atau `Received`. Pembelian aktualnya diurus di luar sistem. Konsekuensi penting: **jangan** membangun layar "tandai sudah dibeli" atau kolom tanggal terima — kalau nanti diminta, itu fase terpisah, bukan diselundupkan sekarang.

**3.4 — Estimasi harga per item, opsional.** Peminta boleh mengisi perkiraan harga tiap item, boleh dikosongkan. Sistem menjumlahkan yang terisi supaya manager melihat perkiraan total saat memutuskan. Karena opsional, **total tidak boleh dianggap angka final** — tampilkan sebagai "perkiraan" dan beri tanda kalau ada item yang harganya kosong, jangan diam-diam menghitung item kosong sebagai nol.

---

## 4. Skema database

Dua tabel baru. Ikuti aturan repo: perbarui `database/supabase_schema.sql` **dan** jalankan migrasi di produksi dalam commit yang sama, lalu `NOTIFY pgrst, 'reload schema';`.

```sql
-- 21. Purchase requests (header)
CREATE TABLE IF NOT EXISTS public.purchase_requests (
    id SERIAL PRIMARY KEY,
    request_number TEXT,                      -- PR-YYMMDD-NNN, dibuat aplikasi
    category TEXT NOT NULL,                   -- 'Raw Materials' | 'Equipment' | 'Housekeeping Supplies'
    status TEXT DEFAULT 'Pending Approval',   -- 'Pending Approval' | 'Approved' | 'Rejected' | 'Cancelled'
    purpose TEXT,                             -- alasan/keperluan, diisi peminta
    needed_by DATE,                           -- kapan dibutuhkan (opsional)
    requested_by_id UUID,                     -- profiles.id — SUMBER KEBENARAN kepemilikan (§7.2)
    requested_by_name TEXT,                   -- snapshot nama saat dibuat, untuk tampilan & riwayat
    request_date DATE DEFAULT CURRENT_DATE,
    decided_by_id UUID,                       -- profiles.id manager yang memutuskan
    decided_by_name TEXT,                     -- snapshot nama
    decided_at TIMESTAMPTZ,
    decision_note TEXT,                       -- WAJIB diisi aplikasi saat Rejected (§6 Fase 4)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 22. Purchase request items
CREATE TABLE IF NOT EXISTS public.purchase_request_items (
    id SERIAL PRIMARY KEY,
    purchase_request_id INTEGER,              -- FK ke purchase_requests.id (INTEGER, bukan UUID — lihat §7.5)
    item_name TEXT NOT NULL,
    qty NUMERIC,
    unit TEXT,                                -- 'pcs' | 'kg' | 'box' | dst, teks bebas
    estimated_price NUMERIC,                  -- NULL = peminta tidak tahu harganya (§3.4)
    item_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

RLS: pakai policy `full_access` (`FOR ALL USING (true)`) yang sama persis dengan semua tabel lain di proyek ini. Otorisasi ditegakkan di klien lewat `hasPermission()`, bukan RLS — jangan menyimpang dari pola itu di sini, karena akan jadi satu-satunya tabel dengan aturan berbeda dan membingungkan orang berikutnya.

**Kategori disimpan di header, bukan di item.** Satu request = satu kategori. Alasannya bukan kesederhanaan semata: kalau suatu hari kamu ingin role approver yang dibatasi per kategori (persis seperti yang baru dibangun untuk customer, lihat `CUSTOMER_CATEGORY_ROLE_PLAN.md`), request yang isinya campur kategori jadi mustahil diputuskan — approver Equipment tidak boleh menyetujui baris Raw Materials di request yang sama, dan "persetujuan sebagian" bukan alur yang diminta. Menaruh kategori di header menutup masalah itu sebelum lahir. User yang butuh dua kategori cukup membuat dua request.

---

## 5. Permission keys

Tujuh key baru, dua grup di `PERMISSION_GROUPS`:

```
🛒 Purchase Request
  purchase_request_view          Lihat semua purchase request
  purchase_request_view_own      Lihat hanya request sendiri
  purchase_request_create        Buat purchase request
  purchase_request_edit          Ubah request sendiri selama masih Pending
  purchase_request_delete        Hapus/batalkan request

✅ Purchase Approval
  purchase_approval_view         Lihat antrean approval
  purchase_approval_decide       Approve / Reject
```

`purchase_request_view` vs `purchase_request_view_own` mengikuti pasangan yang sudah ada di sales — key penuh menang atas key "own" (lihat urutan pengecekan di `filterOwnOrders`).

Peran default yang masuk akal saat rollout (silakan sesuaikan):

| Role | Buat request | Lihat | Approve |
|---|---|---|---|
| Developer, Admin | ya | semua | ya |
| Production Leader | ya | semua | ya |
| Roaster, Packing Team | ya | sendiri | tidak |
| Sales Agent | ya | sendiri | tidak |

Section baru `sec-purchasing` didaftarkan di `SECTION_PERMISSIONS` dengan array — sama seperti `sec-handover`:

```js
'sec-purchasing': ['purchase_request_view', 'purchase_request_view_own', 'purchase_approval_view'],
```

---

## 6. Fase pengerjaan

### Fase 0 — Skema, permission, backfill

1. Jalankan migrasi dua tabel di produksi + policy `full_access` + `NOTIFY pgrst, 'reload schema';`
2. Perbarui `database/supabase_schema.sql` di commit yang sama.
3. Tambah tujuh key ke `PERMISSION_GROUPS` ([js/settings.js](js/settings.js)) dan ke seed `MOCK_DB.custom_roles` ([js/app.js](js/app.js)) untuk keenam role default.
4. **Backfill eksplisit ke semua baris `custom_roles` produksi** — lihat §7.1, ini bagian yang paling gampang terlewat dan paling berbahaya.

*Verifikasi:* query `custom_roles`, pastikan **tidak ada** role yang kehilangan salah satu dari tujuh key itu (`permissions ? 'purchase_request_create'` harus `true` untuk semua baris, apa pun nilainya). Login sebagai role non-admin, pastikan tidak ada perubahan perilaku apa pun di fase ini.

### Fase 1 — Kerangka section

Section `sec-purchasing` dengan dua tab: **My Requests** dan **Approval**. Menu sidebar baru. Semua string lewat `data-i18n`, key ditambahkan ke `en` **dan** `ar` di [js/translations.js](js/translations.js).

*Verifikasi:* role tanpa satu pun key purchasing tidak melihat menunya sama sekali; role dengan `purchase_request_view_own` saja melihat menu tapi hanya tab My Requests.

### Fase 2 — Buat & ubah request

Modal berisi: kategori (dropdown 3 pilihan), keperluan, tanggal dibutuhkan, lalu keranjang item (nama, qty, satuan, estimasi harga opsional, catatan). Nomor request `PR-YYMMDD-NNN` dibuat otomatis dan readonly, meniru `m-req-orderno` di sales.

Simpan `requested_by_id` dari `currentUser.id` **dan** `requested_by_name` dari `currentUser.name`.

Ubah hanya boleh selama `status = 'Pending Approval'` — sekali diputuskan, request terkunci.

*Verifikasi:* buat request `ZZ TEST` berisi 2 item, satu dengan harga, satu tanpa. Cek di database: header punya `requested_by_id` terisi UUID yang benar, dan item tanpa harga tersimpan `NULL`, **bukan** `0`.

### Fase 3 — Daftar request

Tabel My Requests: nomor, tanggal, kategori, jumlah item, perkiraan total, status, aksi. Terapkan filter kepemilikan (§7.2). Badge status berwarna: Pending kuning, Approved hijau, Rejected merah, Cancelled abu.

*Verifikasi:* login dua user berbeda dengan role `..._view_own`, pastikan masing-masing hanya melihat miliknya. Lalu satu user dengan `purchase_request_view` penuh melihat keduanya.

### Fase 4 — Approval

Tabel antrean berisi request `Pending Approval` saja, dengan detail item dapat dibuka. Tombol Approve dan Reject.

**Reject wajib mengisi alasan** — simpan ke `decision_note`. Tanpa ini peminta tidak tahu harus memperbaiki apa, dan fiturnya jadi kotak hitam. Approve boleh tanpa catatan.

Isi `decided_by_id`, `decided_by_name`, `decided_at` saat memutuskan.

*Verifikasi:* approve satu request → status berubah, hilang dari antrean, muncul sebagai Approved di daftar peminta lengkap dengan nama pemutus. Coba Reject tanpa mengisi alasan → harus ditolak form. Pastikan user tanpa `purchase_approval_decide` tidak melihat tombolnya, **dan** panggilan fungsinya langsung juga ditolak (bukan hanya tombolnya disembunyikan).

### Fase 5 — Cetak (opsional, boleh ditunda)

Cetak satu request untuk arsip fisik, meniru pola cetak yang sudah ada di sales.

---

## 7. Ranjau yang harus diwaspadai

**7.1 — Key permission yang absen berarti `false`.**
`roleHasPermission` mengembalikan `false` untuk key yang tidak ada di objek permissions ([js/auth.js:207](js/auth.js:207)), dan `js/settings.js:563` menulis **setiap** key secara eksplisit saat role disimpan. Artinya begitu fitur ini rilis, role lama yang belum di-backfill akan kehilangan akses secara diam-diam tanpa pesan error. Backfill di Fase 0 bukan kerapian, itu syarat rilis. Pelajaran ini sudah terbukti sekali di fitur kategori customer.

**7.2 — Jangan tiru cara `filterOwnOrders` menentukan kepemilikan.**
Fungsi itu mencocokkan **nama** (`order.sales_name === currentUser.name`), dan komentarnya sendiri mengakui itu rapuh: dua user bernama sama akan saling melihat data, dan mengganti nama user memutus hubungannya dengan data lama. Untuk fitur ini pakai `requested_by_id` (UUID dari `profiles.id`) sebagai penentu kepemilikan, dan `requested_by_name` **hanya** untuk ditampilkan. Ini memperbaiki kerapuhan lama, bukan mengulanginya.

**7.3 — `hasPermission` memberi izin penuh kalau role tidak ditemukan.**
[js/auth.js:230](js/auth.js:230): `if (!role) return true;`. Jadi user yang `profiles.role`-nya salah ketik atau menunjuk role yang sudah dihapus akan mendapat **semua** izin, termasuk approve. Jangan mengandalkan sembunyi-tombol saja untuk approval — periksa `hasPermission('purchase_approval_decide')` di dalam fungsi approve/reject itu sendiri (Fase 4).

**7.4 — Mata uang produksi masih `USD`.**
`company_settings.currency` bernilai `USD` padahal perusahaannya BICA.sa. Harga di fitur ini akan tampil sebagai USD sampai diubah di Settings. Ubah dulu sebelum rollout, atau angka estimasinya akan menyesatkan manager yang memutuskan. Baca nilainya dari `companySettings`, jangan pernah hardcode simbol mata uang.

**7.5 — Tipe foreign key: INTEGER, bukan UUID.**
`purchase_request_items.purchase_request_id` menunjuk ke `purchase_requests.id` yang bertipe `SERIAL` (integer). Kesalahan ini pernah terjadi di proyek ini saat menambah tabel lot — tercatat di `REFACTORING.md`. Perhatikan bahwa `requested_by_id`/`decided_by_id` justru **UUID** karena menunjuk `profiles.id`; dua tipe berbeda di satu tabel yang sama, mudah tertukar.

**7.6 — Total perkiraan bukan angka final.**
Karena harga opsional (§3.4), jangan tampilkan total polos seolah pasti. Tampilkan sebagai perkiraan dan sebutkan berapa item yang harganya belum diisi, supaya manager tidak menyetujui berdasarkan angka yang sebenarnya setengah kosong.

**7.7 — Cache-busting.**
Setiap file JS yang berubah harus dinaikkan `?v=` miliknya sendiri di [index.html](index.html), termasuk `js/purchasing.js` yang baru. Tanpa ini browser menyajikan salinan lama dan fiturnya "tidak muncul" di live meski sudah ter-deploy — sudah pernah terjadi di sesi sebelumnya.

**7.8 — i18n dan tema.**
Tidak boleh ada teks Inggris yang ditulis langsung di HTML/JS; semua lewat `data-i18n` atau `window.t()`, dengan key ditambahkan ke `en` dan `ar`. Tidak boleh ada warna hardcode; pakai CSS custom property (`var(--danger)`, `var(--text-muted)`, dst) supaya mode gelap/terang tetap benar.

---

## 8. Di luar cakupan (sengaja)

Jangan dikerjakan sekarang tanpa permintaan baru dari user:

- Status `Purchased` / `Received` dan pelacakan penerimaan barang — ditolak eksplisit di §3.3
- Approval bertingkat atau ambang nilai — ditolak eksplisit di §3.2
- Permission approver **per kategori** — skemanya sudah disiapkan (kategori ada di header, §4), tapi ini penambahan terpisah
- Lampiran foto/dokumen — belum ada penyimpanan file di proyek ini
- Hubungan apa pun ke stok, supplier, atau modul green bean intake — user menegaskan fitur ini tidak berhubungan dengan stok
