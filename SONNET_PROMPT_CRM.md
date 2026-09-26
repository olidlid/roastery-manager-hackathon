# Prompt Sonnet: Halaman CRM Management

Kerjakan fitur ini di repo `roastery-manager-v2`.

## Baca dulu, ketiganya, sebelum menulis kode

1. **`CRM_PAGE_PLAN.md`** di root repo — semua keputusan user sudah final (§2). Nomor pasal di prompt ini merujuk ke sana.
2. **`docs/crm_mockup.html`** — buka di browser, satu halaman scroll. Susunan halaman, kolom tabel, isi modal: ini **spesifikasi**.
3. **`CRM_JOURNEY_DATA.md`** — kenapa kolom-kolom di Fase 0 harus dibuat sekarang meskipun baru dipakai nanti.

Kalau kode dan mockup berbeda, **mockup yang benar**. Yang tidak digambar di mockup, ikuti rencana. Yang tidak ada di keduanya, **tanyakan** — jangan karang sendiri.

## Apa yang dibangun, dalam satu paragraf

Halaman baru khusus management untuk mengelola customer: customer dikelompokkan per kategori **dan** per sales pemiliknya, dengan perkiraan kapan tiap customer akan order lagi, plus tab kedua berisi performa tiap sales. Satu izin `crm_manage` menggerbangi seluruh halaman — itu justru alasan halaman ini dipisah. Halaman Customers yang sekarang **tetap seperti apa adanya**; itu halaman untuk sales, yang ini untuk leader.

## Tiga hal yang membuat pekerjaan ini lebih berbahaya dari tampilannya

**1. Fase 0 tidak bisa diperbaiki belakangan.** Kg, jumlah order, ritme, dan repeat rate bisa dihitung ulang dari order lama kapan pun — itu aman. Tapi **siapa yang membuka customer** dan **kapan kepemilikan berpindah** hanya ada saat kejadiannya. Kalau `owner_sales_id` ditimpa tanpa menulis `customer_owner_history`, atribusi bulan-bulan sebelumnya ikut berubah: sales lama kehilangan pencapaiannya dan tidak ada cara memulihkannya. Baris history **hanya ditambah**, sama seperti ledger stok. Rencana §4 dan §8.

**2. Backfill dari nama hanya bisa hari ini.** Keempat `request_orders.sales_name` masih cocok persis dengan `profiles.name` (diverifikasi 2026-09-26), jadi backfill id akurat sekarang. Sudah ada dua profil berawalan "Abdullah" — begitu ada yang mengganti nama profilnya, pencocokan nama jadi salah, bukan sekadar gagal. Jalankan backfill **sekali di Fase 0**, setelah itu id yang jadi acuan. Acuannya `profiles`, **bukan** `sales_agents` (tabel itu masih berisi baris usang seperti `QA_TEST_BLEND_CODE`).

**3. Sebagian besar perhitungan sudah ada — jangan ditulis ulang.** `computeOrderStatsByKey()` di `js/db.js:74`, `getCustomerOrdersRaw()`/`computePeerMedians()`/`getCustomerSegment()` di `js/sales.js`, `filterCustomersByAccess()` di `js/auth.js`. Rencana §1 memuat daftar lengkapnya dengan nomor baris. Kalau kamu menemukan dirinya menghitung median jeda order dari nol, berhenti dan cari fungsinya dulu.

## Dua keputusan yang sering tergoda untuk "dirapikan" — jangan

- **Status order dipakai dengan dua aturan berbeda** (§6.1): volume memakai `Dispatched`+`Completed`, sedangkan ritme/perkiraan memakai semua status kecuali `Cancelled` dan `Unable to Fulfill`. Ini disengaja — yang menentukan ritme adalah tindakan memesan, bukan pengirimannya. Kalau menurutmu salah, **bilang dulu**, jangan diseragamkan diam-diam.
- **Kepemilikan sales TIDAK membatasi akses** (§2.4). Pagarnya tetap kategori customer seperti sekarang. Jangan menambahkan filter kepemilikan ke Sales Request — itu akan mencabut akses yang selama ini dipakai orang.

## Delapan fase, kerjakan berurutan

Rencana §9 memuat kedelapannya lengkap dengan kriteria selesainya. Ringkasnya:

0. Migrasi SQL + backfill data + **backfill permission** + seed `MOCK_DB` + `supabase_schema.sql` + `NOTIFY pgrst`.
1. Section + sidebar + izin + dua tab halaman (masih kosong).
2. Tab Customers: tile, 6 kartu KPI yang sekaligus filter, tabel, filter corong, Reset.
3. Mesin perkiraan order berikutnya + kolom Next order + baris akurasi.
4. Kepemilikan: tombol pensil, assign massal, tulis history.
5. Modal customer — tab Performance.
6. Tab Sales Performance + modal sales (tab Journey **sengaja dikosongkan**).
7. Modal customer — tab Journey.

Uji tiap fase sebelum lanjut. Jangan menumpuk delapan fase lalu menguji sekali di ujung. Fase 7 boleh ditunda kalau waktu habis; Fase 0 tidak boleh ditunda sebagian.

## Mesin perkiraan order (§6.2) — ini bagian yang paling mudah dibuat asal jalan

Metodenya sudah diuji terhadap riwayat asli: campuran berbobot meleset rata-rata **5,28 hari**, konsumsi-saja **16,49 hari**, campuran tetap 70/30 justru **lebih buruk** daripada rhythm saja. Jadi bobotnya harus **dihitung per customer dari kesalahannya sendiri**, bukan angka tetap. Alat ujinya ada di `docs/reorder_backtest.js` — tempel di console browser untuk membuktikan hasilmu, jangan percaya angka di prompt ini begitu saja.

Guardrail di §6.2 bukan opsional. Yang paling penting: **customer yang sudah menghilang tidak diberi tanggal sama sekali** — "seharusnya order 8 Juli" itu sampah, bukan informasi. Dan **akurasinya dicetak di bawah tabel**, supaya metode yang membusuk ketahuan dari layar, bukan dari komplain.

## Yang paling sering terlupa di repo ini

- **Backfill permission itu wajib** (§5.4). Key baru yang tidak ada di baris `custom_roles` dibaca `false` — fitur tidak terlihat oleh siapa pun, termasuk Admin. Ini persis yang terjadi pada `purchase_request_view_own`.
- **Jangan menambahkan `crm_manage` ke `PERMISSION_FALLBACKS`.** Halaman ini harus dinyalakan secara sadar per role.
- **Tidak boleh ada teks Bahasa Indonesia di UI.** Semua lewat `t()` dengan key di **`en` dan `ar`**. Commit `69ca581` adalah pekerjaan membersihkan kebocoran seperti ini.
- **Tidak boleh ada warna hardcoded** — variabel CSS yang sama menggerakkan mode gelap dan terang.
- **Tidak ada angka uang di mana pun.** Semua kg dan bag. Ini ruling user, bukan keterbatasan teknis.
- **Angka di mockup bukan hasil yang benar** — mockup dihitung tanpa menyaring status agar terisi data nyata. Implementasi memakai §6.1, jadi angkanya memang akan berbeda.
- **Bump `?v=`** di `index.html` untuk tiap file JS yang diubah, tambahkan `js/crm.js?v=1`, lalu jalankan **`node test.js`** sebelum commit.

## Sebelum lapor selesai

Sebutkan mana yang sudah kamu uji sendiri di browser dan mana yang belum. Jangan menulis "selesai" untuk bagian yang belum pernah dijalankan. Untuk Fase 0, sertakan hasil query verifikasinya — bukan asumsi bahwa migrasinya jalan.
