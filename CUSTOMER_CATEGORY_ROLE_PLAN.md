# Kategori Customer + Role Akses per Kategori — Rencana Pengerjaan

**Status:** Rencana, belum dikerjakan. Semua keputusan desain sudah diambil user 2026-09-04 (§3.1, §3.2, §3.3) — tidak ada yang tersisa untuk ditanyakan.
**Tanggal:** 2026-09-04
**Untuk dikerjakan oleh:** sesi Sonnet 5 terpisah

**Tujuan:**

1. Customer punya **3 kategori**: Retail, Wholesale, Supermarket — semuanya dalam satu tabel, dengan filter kategori di atas tabel.
2. Tambah **role granular per kategori**. User/sales yang diberi salah satu atau beberapa kategori hanya bisa melihat/mengakses customer sesuai kategorinya.
3. **Tipe order mengikuti tipe customer** yang dipilih.

---

## 1. Yang SUDAH ada — jangan dibangun ulang

Sebagian dari permintaan nomor 1 sudah berdiri. Baca ini dulu sebelum menulis kode apa pun.

| Sudah ada | Lokasi |
|---|---|
| Tombol filter All / Wholesale / Retail | [index.html:1372](index.html:1372) |
| `filterCustomers(type)` + state `_customerFilterType` | [js/sales.js:20](js/sales.js:20) |
| Logika filter tabel (sudah generik: `c.type !== _customerFilterType`) | [js/sales.js:39](js/sales.js:39) |
| Kolom `customers.type` (TEXT, default `'Retail'`) | `database/supabase_schema.sql` |

**Mesin filternya sudah generik.** Menambah Supermarket = menambah satu tombol dan satu nilai enum, bukan membangun sistem filter baru.

Yang masih **hardcoded dua kategori** dan harus dibuka jadi tiga:

| Hardcoded 2 kategori | Lokasi |
|---|---|
| Badge tipe (ternary Wholesale/Retail) | [js/sales.js:52](js/sales.js:52) |
| `buildCustomerOptionsHtml` — hanya 2 `<optgroup>` | [js/sales.js:94](js/sales.js:94) |
| Pilihan tipe di form customer | [js/sales.js:120](js/sales.js:120) |
| `generateCustomerId` — prefix `WHL`/`RTL` | [js/sales.js:171](js/sales.js:171) |

Data produksi saat ini: **31 Wholesale, 2 Retail**, belum ada Supermarket.

**Preseden penting:** `filterOwnOrders` ([js/auth.js:233](js/auth.js:233)) sudah menjadi permission pertama di aplikasi ini yang **menyaring DATA, bukan sekadar menyembunyikan UI** — komentarnya sendiri menyebut itu. Fitur ini kelas yang sama; ikuti polanya, termasuk kejujurannya soal keterbatasan.

---

## 2. JEBAKAN UTAMA — baca sebelum menyentuh permission

Ini bagian paling berbahaya dari seluruh rencana. Kalau salah, gejalanya baru muncul beberapa hari kemudian sebagai "tiba-tiba sales tidak bisa lihat customer sama sekali".

**Fakta 1.** `roleHasPermission` mengembalikan **`false`** untuk key yang belum ada di role ([js/auth.js:207](js/auth.js:207)). Jadi begitu kode membaca `hasPermission('customer_cat_wholesale')`, **semua role lama langsung kehilangan akses customer**, karena tidak satu pun punya key itu.

**Fakta 2 — yang lebih berbahaya.** Menyimpan role lewat Settings → Role Management menulis **SEMUA** key secara eksplisit, termasuk yang tidak dicentang, sebagai `false`:

```js
permissions[k.key] = cb ? cb.checked : false;   // js/settings.js:551
```

Artinya strategi "kalau ketiganya belum diset, anggap boleh semua" adalah **bom waktu**: benar saat baru rilis, lalu diam-diam rusak begitu ada admin menyimpan role itu untuk alasan yang sama sekali tidak berhubungan. `PERMISSION_FALLBACKS` ([js/auth.js:157](js/auth.js:157)) juga tidak menyelamatkan, karena fallback hanya berlaku selama key-nya masih `undefined`.

**Maka: jangan bergantung pada key yang tidak ada.** Yang benar:

1. Daftarkan 3 key baru di `PERMISSION_GROUPS` ([js/settings.js:302](js/settings.js:302)) agar bisa dikelola admin.
2. Daftarkan juga di `PERMISSION_FALLBACKS` → `customer_view` (jaring pengaman untuk role yang dibuat di luar UI).
3. **Backfill tabel `custom_roles` produksi lewat SQL**, set ketiganya `true` untuk semua role yang sudah ada — **dijalankan SEBELUM kode pembacanya rilis**. Setelah ini tidak ada lagi kondisi `undefined`, jadi tidak ada yang bergantung pada semantik fallback.
4. Perbarui juga seed `MOCK_DB.custom_roles` di [js/app.js](js/app.js) — ingat seed ini hanya mengisi tabel yang **kosong**, jadi mengubahnya saja tidak cukup (langkah 3 tetap wajib).

---

## 3. Keputusan yang perlu diambil

### 3.1 Sejauh mana pembatasan berlaku?

Ini keputusan terpenting. Daftar customer diambil di **13 tempat**. Sudah saya klasifikasikan:

**Grup A — WAJIB dibatasi** (ini yang user maksud: "hanya bisa melihat/akses daftar customer"):

| Fungsi | Lokasi |
|---|---|
| `loadCustomersSection` — tabel Customer Directory | [js/sales.js:33](js/sales.js:33) |
| `openSalesRequestModal` — dropdown customer saat buat order | [js/sales.js:2410](js/sales.js:2410) |
| refresh dropdown setelah "+ Add Customer" | [js/sales.js:2548](js/sales.js:2548) |
| `openCustomerModal` — edit customer | [js/sales.js:219](js/sales.js:219) |
| `openAddCustomerShortcutModal` — tambah cepat | [js/sales.js:252](js/sales.js:252) |
| `viewCustomerHistory` | [js/sales.js:309](js/sales.js:309) |

Untuk edit/tambah/history: bukan cuma menyaring daftar, tapi **menolak akses langsung** ke customer di luar kategori yang diizinkan (kalau tidak, id-nya masih bisa dipanggil manual).

**Grup B — JANGAN dibatasi** (kalau dibatasi, operasional packing rusak):

| Fungsi | Lokasi | Alasan |
|---|---|---|
| `loadPackingRequestsSection` | [js/packing.js:1726](js/packing.js:1726) | Tim packing melayani semua order apa pun kategorinya |
| `openDispatchCheckoutModal` | [js/packing.js:1897](js/packing.js:1897) | idem |
| `printWaybill` | [js/packing.js:5026](js/packing.js:5026) | Nama customer wajib tercetak di surat jalan |

**Grup C — perlu diputuskan user:**

| Fungsi | Lokasi |
|---|---|
| `loadSalesDispatchRequestsTable` | [js/sales.js:533](js/sales.js:533) |
| `loadDispatchApprovalTable` | [js/sales.js:812](js/sales.js:812) |
| `loadCustomerReport` | [js/app.js:3456](js/app.js:3456) |
| `searchLotCodeLookup` | [js/sales.js:446](js/sales.js:446) |

**KEPUTUSAN USER (2026-09-04): Grup C ikut dibatasi.** Alasannya: kalau tidak, nama customer yang disembunyikan di direktori tetap terbaca di daftar order sebelahnya, dan pembatasannya jadi kosmetik saja.

Konsekuensi yang harus ditangani pelaksana: order milik customer di luar kategori yang diizinkan **hilang dari daftar** Dispatch Request, Dispatch Approval, dan Customer Report bagi role tersebut. Ini bertumpuk dengan `filterOwnOrders` yang sudah ada ([js/auth.js:233](js/auth.js:233)) — dua penyaring berlapis pada daftar yang sama. Terapkan keduanya, jangan saling menggantikan.

### 3.2 Tipe order — diturunkan atau disimpan?

`request_orders` **tidak punya kolom tipe** sama sekali saat ini.

**KEPUTUSAN USER (2026-09-04): disimpan saat order dibuat** (snapshot), supaya kalau suatu hari tipe customer berubah, riwayat order lama tetap sesuai keadaan saat dipesan.

Artinya:

- Tambah kolom `request_orders.order_type TEXT` (migrasi, lihat Fase 0).
- Diisi dari tipe customer **saat order dibuat**, lalu tidak pernah ikut berubah lagi.
- **Backfill 50 order yang sudah ada** dari tipe customer mereka saat ini. Ini akurat hari ini karena belum ada customer yang pindah kategori — dan begitu kolomnya terisi, order-order itu ikut terlindungi dari perubahan kategori di masa depan. Semua 50 order punya `customer_id`, jadi tidak ada yang tertinggal null.
- Jangan pernah menurunkan ulang nilai ini dari customer saat membaca — itu justru membatalkan seluruh tujuan snapshot.

### 3.3 Prefix kode customer untuk Supermarket

Sekarang `WHL-xxx` / `RTL-xxx`. **Pakai `SPM-xxx`** kecuali user menentukan lain. Begitu dipakai, mengubahnya berarti menomori ulang seperti yang pernah dilakukan sebelumnya, jadi jangan diubah sepihak di tengah jalan.

---

## 4. Fase pengerjaan

### Fase 0 — Migrasi & backfill (WAJIB duluan)

1. `PERMISSION_GROUPS`: tambah grup baru, mis. `👥 Customers — Kategori`, isi 3 key: `customer_cat_retail`, `customer_cat_wholesale`, `customer_cat_supermarket`.
2. `PERMISSION_FALLBACKS`: ketiganya → `customer_view`.
3. `MOCK_DB.custom_roles` di `js/app.js`: tambahkan ketiganya ke setiap role, nilai mengikuti `customer_view` role tersebut.
4. **SQL backfill produksi** — set ketiganya `true` di semua baris `custom_roles` yang ada, lalu `NOTIFY pgrst, 'reload schema';`.
5. **Migrasi `request_orders.order_type TEXT`** (§3.2), lalu backfill 50 order yang ada dari tipe customer masing-masing. Perbarui juga `database/supabase_schema.sql` di commit yang sama — aturan repo ini: file skema harus ikut berubah bersama migrasinya.

*Verifikasi:* setelah backfill, query `custom_roles` dan pastikan **tidak ada** role yang masih kehilangan ketiga key itu. Query `request_orders` dan pastikan tidak ada `order_type` yang null. Login sebagai role non-admin, pastikan daftar customer masih tampil utuh seperti sebelumnya (belum ada perubahan perilaku di fase ini).

### Fase 1 — Kategori ketiga (tanpa permission)

- Tambah `Supermarket` di: badge tipe, `buildCustomerOptionsHtml`, pilihan form, `generateCustomerId` (prefix baru), dan tombol filter di `index.html`.
- Pilih ikon/warna badge yang berbeda dari dua yang ada.

*Verifikasi:* `node test.js` lulus. Buat customer Supermarket uji coba (`ZZ TEST`), pastikan kodenya benar, muncul di filter Supermarket, tidak muncul di filter Retail/Wholesale, dan muncul di grup yang benar pada dropdown order. **Hapus data uji setelahnya.**

### Fase 2 — Helper akses kategori

Satu fungsi tunggal, dipakai semua pemanggil — jangan menyebar logikanya:

```js
// Kategori customer yang boleh diakses role saat ini.
function allowedCustomerTypes() { /* baca 3 key permission */ }
function canAccessCustomer(customer) { /* dipakai untuk edit/history/tambah */ }
```

*Verifikasi:* uji dengan beberapa kombinasi role — satu kategori, dua kategori, ketiganya.

### Fase 3 — Terapkan ke Grup A

Terapkan `allowedCustomerTypes()` / `canAccessCustomer()` ke enam pemanggil Grup A. Untuk edit/history/tambah, tolak akses (bukan sekadar sembunyikan). Tombol filter kategori yang tidak diizinkan juga disembunyikan.

*Verifikasi (paling penting di seluruh rencana):* login sebagai role yang **hanya** punya Retail. Pastikan:
- Direktori hanya menampilkan Retail
- Dropdown saat buat order hanya berisi Retail
- Memanggil `openCustomerModal(<id customer Wholesale>)` langsung dari console **ditolak**
- Idem `viewCustomerHistory`
- Tambah customer baru hanya bisa dengan kategori yang diizinkan

### Fase 4 — Tipe order

Isi `order_type` dari tipe customer saat order dibuat ([js/sales.js](js/sales.js), submit handler `openSalesRequestModal`), lalu tampilkan pada daftar/detail/cetak order.

*Verifikasi:* buat order `ZZ TEST` untuk customer Wholesale → `order_type` tersimpan `Wholesale`. Lalu ubah customer itu jadi Retail → order tadi **harus tetap** Wholesale. Itulah inti keputusan §3.2; kalau ikut berubah, berarti nilainya masih diturunkan dari customer di suatu tempat.

### Fase 5 — Grup C

Terapkan pembatasan ke empat pemanggil Grup C sesuai keputusan §3.1, **berlapis** dengan `filterOwnOrders` yang sudah ada.

*Verifikasi:* login sebagai role Retail-saja, pastikan order milik customer Wholesale tidak muncul di Dispatch Request, Dispatch Approval, maupun Customer Report — sementara tim packing (Grup B) masih melihat order yang sama dengan normal.

### Fase 6 — i18n + rilis

- Semua string baru ke **`en` dan `ar`** di `js/translations.js`.
- Bump `?v=` untuk setiap file yang berubah.
- Setelah push: tunggu Vercel "Ready", hard refresh, verifikasi live.

---

## Lampiran — jebakan khusus repo ini

- **Key permission yang tidak ada = `false`, bukan "boleh".** Dan menyimpan role menulis semua key sebagai eksplisit. Backfill SQL di Fase 0 bukan opsional — tanpa itu, fitur ini akan mengunci akses semua orang, cepat atau lambat.
- **`MOCK_DB.custom_roles` hanya seed untuk tabel kosong** — mengubahnya tidak mengubah role produksi yang sudah ada.
- **Jangan batasi Grup B.** Tim packing harus melihat semua order; membatasinya menghentikan operasional, bukan sekadar menyembunyikan data.
- **Menyaring daftar saja tidak cukup.** Fungsi yang menerima `customerId` langsung (edit, history) harus menolak sendiri, kalau tidak pembatasannya bisa dilewati.
- **Pakai data `ZZ TEST` untuk pengujian**, dan bersihkan setelahnya. Ada 33 customer nyata di produksi.
- **`js/app_backup.js` bukan bagian aplikasi** — pencarian teks akan menemukannya, abaikan.
