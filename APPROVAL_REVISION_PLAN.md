# Rencana Revisi: Sales Order Approval

**Status:** Rencana, siap dikerjakan. Delapan keputusan desain sudah diambil user 2026-09-07 (§3) — tidak ada yang tersisa untuk ditanyakan.
**Tanggal:** 2026-09-07
**Mockup disetujui:** https://claude.ai/code/artifact/52ab2c9e-cdce-489b-b084-153894915d8e — 5 layar, memakai token desain asli aplikasi. **Buka ini dulu sebelum menulis kode**; letak tombol, isi kolom tabel, dan susunan modal di sana adalah spesifikasi, bukan saran.

---

## 1. Ringkasan

Dua tambahan pada alur persetujuan sales order, plus satu pengetatan:

1. **Pemenuhan sebagian.** Leader boleh menyetujui order dengan jumlah kurang dari yang diminta. Kekurangannya dicatat dan ditampilkan, tidak lagi lenyap diam-diam.
2. **Unable to Fulfill.** Leader bisa menyatakan sebuah order tidak bisa dipenuhi sama sekali.
3. **Tombol Edit dikunci** begitu tim packing atau roasting sudah mulai bekerja pada order tersebut.

Keduanya (1 dan 2) menyediakan kotak alasan yang opsional, masuk ke kolom yang sama.

---

## 2. Apa yang sudah ada dan dipakai ulang

| Yang ditiru / disentuh | Sumber |
|---|---|
| Tabel approval | `loadDispatchApprovalTable` di [js/sales.js:912](js/sales.js:912) |
| Modal approve + tiga input pemenuhan | `approveSalesOrder` di [js/sales.js:1307](js/sales.js:1307); input `.inp-fulfill` / `.inp-bulk` / `.inp-prod` |
| Popup detail order | `openOrderDetailPopup` di [js/sales.js:1103](js/sales.js:1103) |
| Bubble peringatan | `showFieldWarn` di [js/sales.js:3231](js/sales.js:3231) — **kelas `.custom-empty-warn`**, pakai gaya yang sama untuk bubble tombol Edit |
| Kotak alasan opsional + banner keputusan | Pola yang sudah jadi di `js/purchasing.js` (Purchase Request) — tiru bentuk dan penamaannya |

### Lubang yang sudah ada dan diisi oleh revisi ini

**[js/sales.js:1052](js/sales.js:1052) berbunyi harfiah `const canEdit = true;`** pada cabang status `Preparing`. Variabelnya disiapkan untuk syarat yang tidak pernah ditulis. Bagian 3 dari revisi ini mengisi tempat itu — jangan membuat variabel baru di sebelahnya.

**Tidak ada validasi yang mencegah pemenuhan kurang.** Hari ini leader sudah bisa mengisi packed + bulk + produksi lebih kecil dari `quantity_requested`, tanpa peringatan apa pun, dan selisihnya tidak tercatat di mana pun. Jadi bagian 1 sebagian besar **menambal lubang**, bukan menambah kemampuan.

---

## 3. Keputusan user (2026-09-07)

**3.1 — Istilah: `Unable to Fulfill`.** Ejaan Amerika dobel-L, mengikuti seluruh kode dan terjemahan yang sudah ada (`js/sales.js`, `js/roasting.js`, `js/translations.js`). "Cancel" ditolak karena sudah dipakai sebagai tombol tutup di setiap modal, dan karena menyiratkan pembatalan oleh pemesan. "Reject" ditolak karena terkesan menilai. "Unable to Fulfill" dipilih karena menyalahkan keadaan, bukan permintaannya — dan itu memang yang sebenarnya terjadi di roastery: penolakan hampir selalu soal stok.

**3.2 — Letak tombol: hanya di kaki modal Approve.** Bukan tombol ketiga di baris tabel. Keputusan menolak diambil setelah leader melihat angka stok, dan angka itu baru terlihat di dalam modal. Konsekuensi yang diterima: menolak butuh dua klik.

**3.3 — Sisa yang tidak diproses hangus.** Order berjalan dengan jumlah yang disetujui saja. Sisanya dicatat sebagai keterangan, bukan sebagai pekerjaan yang menunggu. Kalau masih dibutuhkan, sales membuat order baru. **Jangan** membangun mekanisme "sisa menunggu keputusan berikutnya".

**3.4 — Peringatan kekurangan muncul saat mengetik**, bukan saat menekan Confirm. Kalau baru muncul di akhir, leader sudah merasa selesai dan cenderung mengklik terus.

**3.5 — Kotak alasan opsional, satu kolom untuk dua jalur.** Alasan dari modal Approve (pemenuhan sebagian) dan dari dialog Unable to Fulfill masuk ke `decision_note` yang sama. Dari sudut pandang sales tidak ada bedanya: dia ingin tahu kenapa pesanannya tidak terpenuhi penuh.

**3.6 — Status `Unable to Fulfill` hanya ketika SELURUH item diproses nol.** Kalau sebagian item ada isinya, order tetap berjalan normal dan kekurangannya muncul sebagai keterangan. Menolak seluruhnya bukan konsep terpisah — itu ujung ekstrem dari skala yang sama.

**3.7 — Keputusan Unable to Fulfill bisa dibuka kembali**, selama belum ada proses lanjutan. Definisi tepatnya di §5.1.

**3.8 — Tombol Edit dimatikan, bukan disembunyikan**, saat tim sudah bekerja. Tetap terlihat, meredup, dan memunculkan bubble berisi alasan saat diklik. Definisi "tim sudah bekerja" di §5.2.

**Aplikasi Leader Android (`js/leader.js`, `dist/`) TIDAK disentuh** atas keputusan user. Tombol Reject di sana tetap menghasilkan status `Cancelled` seperti sekarang, dan 4 order lama berstatus `Cancelled` dibiarkan apa adanya. Jangan menyeragamkannya.

---

## 4. Skema database

```sql
ALTER TABLE public.request_orders
  ADD COLUMN IF NOT EXISTS decided_by_id   UUID,        -- profiles.id pemutus
  ADD COLUMN IF NOT EXISTS decided_by_name TEXT,        -- snapshot nama, untuk tampilan & riwayat
  ADD COLUMN IF NOT EXISTS decided_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_note   TEXT;        -- alasan, OPSIONAL (§3.5)

ALTER TABLE public.request_order_items
  ADD COLUMN IF NOT EXISTS quantity_unfulfilled INTEGER DEFAULT 0;  -- sengaja tidak diproses
```

`request_orders.status` mendapat nilai baru **`'Unable to Fulfill'`** — tidak ada perubahan skema, hanya nilai baru pada kolom TEXT yang sudah ada. Catat nilai itu sebagai komentar di `database/supabase_schema.sql`.

**Jangan pakai ulang `approved_by` / `approved_date` / `dispatched_by`.** Ketiganya kolom mati — diverifikasi 2026-09-07: **0 dari 51 baris terisi**, dan tidak ada kode yang pernah menulisnya. Lebih penting lagi, kolom bernama `approved_by` yang berisi nama orang yang *menolak* akan menyesatkan siapa pun yang membaca database nanti. Penamaan `decided_by_*` juga menyamakan modul ini dengan `purchase_requests` yang sudah memakai pola itu.

**`quantity_unfulfilled` disimpan, bukan dihitung dari selisih.** Menghitung `quantity_requested − allocated − pending` terlihat menggoda, tapi ketiga angka itu terus berubah selama proses packing berjalan — sehingga selisihnya lama-lama tidak lagi berarti "sengaja tidak dipenuhi", bisa saja berarti "masih dikerjakan". Disimpan tersendiri, maknanya tidak pernah kabur.

Ikuti aturan repo: perbarui `database/supabase_schema.sql` **dan** jalankan migrasi di produksi dalam commit yang sama, lalu `NOTIFY pgrst, 'reload schema';`.

---

## 5. Dua aturan turunan — definisikan persis seperti ini

### 5.1 — Syarat Reopen (§3.7)

Tombol Reopen pada order `Unable to Fulfill` muncul hanya bila **ketiganya kosong** untuk order tersebut:

| Pemeriksaan | Cara |
|---|---|
| Tidak ada stok packed terpotong | `packed_stock_movements` dengan `ref_table = 'request_orders'` dan `ref_id = order.id` |
| Tidak ada reservasi bulk | `bulk_reservations` lewat `request_order_item_id` milik item order ini |
| Tidak ada roasting plan | `roasting_plans` dengan `order_ref = order.order_number` |

Reopen mengembalikan `status` ke `'Pending Approval'`, mengosongkan keempat kolom `decided_*` / `decision_note`, dan me-nol-kan `quantity_unfulfilled` semua itemnya.

**Yang perlu kamu tahu:** di alur yang ada sekarang ketiganya **selalu** kosong untuk order yang ditolak, karena yang menciptakan ketiganya justru tombol Approve — order yang ditolak melewatkan semuanya. Jadi tombol Reopen praktis selalu aktif. Pemeriksaannya tetap ditulis supaya niatnya terekam dan tetap benar kalau nanti alurnya berubah. **Jangan** menyederhanakannya jadi "selalu boleh".

### 5.2 — Syarat tombol Edit mati (§3.8)

Tombol Edit pada baris approval jadi meredup + inert bila **salah satu** terpenuhi:

| Pemeriksaan | Cara |
|---|---|
| Barang sudah diambil dari gudang | ada `dispatch_lot_items` yang `request_order_item_id`-nya milik order ini |
| Sudah ada batch roasting | `roasting_plans` dengan `order_ref = order.order_number`, lalu `roast_batches` dengan `roast_plan_id` di antara plan itu |

**Pemotongan stok saat Approve TIDAK dihitung.** Itu pekerjaan leader sendiri, bukan tim. Kalau ikut dihitung, setiap order yang disetujui akan langsung terkunci meski belum ada yang menyentuhnya — dan leader kehilangan kesempatan memperbaiki salah ketik. Ini sengaja berbeda dari §5.1; jangan disamakan.

`order_ref` diisi `order.order_number` (fallback `#ORD-{id}`) di [js/sales.js:2053](js/sales.js:2053).

---

## 6. Fase pengerjaan

### Fase 0 — Skema

Migrasi §4 di produksi + perbarui `database/supabase_schema.sql` + `NOTIFY pgrst, 'reload schema';`

*Verifikasi:* query `request_orders` dan `request_order_items`, pastikan kelima kolom ada dan `quantity_unfulfilled` bernilai `0` (bukan NULL) untuk semua baris lama. Muat aplikasi, pastikan tidak ada perubahan perilaku apa pun di fase ini.

### Fase 1 — Peringatan kekurangan di modal Approve (mockup layar 2)

Di bawah ketiga input pemenuhan tiap item, tampilkan kotak kuning begitu `packed + bulk + produksi < quantity_requested`, berbunyi "N dari M tidak akan diproses" plus kalimat bahwa sisanya hangus. Muncul dan hilang **saat mengetik** (event `input`), bukan saat submit.

Tambahkan kotak **Reason (opsional)** di bawah daftar item, satu untuk seluruh order.

*Verifikasi:* buka modal Approve untuk order yang stoknya kurang, ubah angkanya naik-turun — kotak kuning harus muncul/hilang mengikuti ketikan tanpa perlu klik apa pun.

### Fase 2 — Simpan pemenuhan sebagian

Di submit handler `approveSalesOrder`: hitung `quantity_unfulfilled = quantity_requested − (fQty + bQty + pQty)` per item, minimal 0, dan simpan. Simpan juga `decision_note` bila diisi, beserta `decided_by_id` / `decided_by_name` / `decided_at`.

*Verifikasi:* setujui order `ZZ TEST` dengan 12 dari 20 pada satu item dan penuh pada item lain. Cek database: item pertama `quantity_unfulfilled = 8`, item kedua `0` — **bukan NULL**. Pastikan `quantity_allocated` / `quantity_pending` / `quantity_prepared` tetap seperti sebelumnya untuk jumlah yang benar-benar diproses.

### Fase 3 — Tampilkan kekurangan (mockup layar 1 dan 4)

- **Tabel approval:** chip kuning "12 dari 20 diproses" di bawah badge status, hanya bila ada item dengan `quantity_unfulfilled > 0`.
- **Popup detail:** tabel item dengan kolom **Diminta / Diproses / Tidak diproses**; angka yang tidak diproses berwarna kuning, tanda "—" bila nol.
- **Banner kuning** di atas popup berisi alasan + nama pemutus + tanggal, bila `decision_note` terisi.

*Verifikasi:* buka popup order dari Fase 2 — angkanya harus 20/12/8 dan 6/6/—.

### Fase 4 — Unable to Fulfill (mockup layar 2, 3, 5)

Tombol **Unable to Fulfill** di kaki modal Approve (§3.2), membuka dialog kecil dengan kotak alasan **opsional** — tombolnya selalu aktif.

Saat dikonfirmasi: `status = 'Unable to Fulfill'`, isi keempat kolom `decided_*`, dan set `quantity_unfulfilled = quantity_requested` untuk **semua** item. **Tidak ada stok yang dipotong, tidak ada reservasi, tidak ada plan yang dibuat.**

Badge merah di tabel + baris kecil "oleh [nama] · [tanggal]". Banner merah di popup hanya bila alasannya diisi; kalau kosong, cukup baris keterangannya.

Tombol **Reopen** di kaki popup, dijaga §5.1 — dan pemeriksaan yang sama diulang **di dalam** fungsinya, bukan hanya di tampilan.

*Verifikasi:* tandai order `ZZ TEST` sebagai Unable to Fulfill tanpa alasan → tidak ada banner merah, hanya baris keterangan; stok packed **tidak berubah** (bandingkan sebelum/sesudah). Ulangi dengan alasan → banner merah muncul. Klik Reopen → status kembali `Pending Approval`, `decision_note` kosong, `quantity_unfulfilled` semua item kembali `0`.

### Fase 5 — Tombol Edit terkunci (mockup layar 1)

Isi `const canEdit = true;` di [js/sales.js:1052](js/sales.js:1052) dengan syarat §5.2. Tombolnya **tetap dirender** dengan `opacity: 0.45` dan `cursor: not-allowed`; klik memunculkan bubble bergaya `.custom-empty-warn` berisi alasan yang menyebut tim mana yang sudah bekerja.

*Verifikasi:* order yang sudah punya `dispatch_lot_items` → tombol meredup, klik memunculkan bubble, dan `openSalesRequestModal` **tidak** terbuka. Order yang baru disetujui tapi belum disentuh tim → tombol tetap normal dan bisa diklik.

---

## 7. Ranjau yang harus diwaspadai

**7.1 — Jangan panggil `openSalesRequestModal` dari tombol yang inert.** Guardnya harus di dalam handler, bukan hanya `pointer-events: none` di CSS — pola di repo ini adalah memeriksa ulang di dalam fungsi (lihat `decidePurchaseRequest` di js/purchasing.js).

**7.2 — Emoji bubble.** Key `alert_field_required` sudah memuat emoji peringatan. Kalau membuat key baru untuk bubble Edit, ikuti pola `js/roasting.js:2070` — pakai hasil terjemahan apa adanya, **jangan** menambahkan emoji di templat. Kesalahan ini baru diperbaiki 2026-09-07 (commit `9f50f50`).

**7.3 — `hasPermission` untuk Unable to Fulfill dan Reopen.** Keduanya keputusan, jadi gerbangnya `dispatch_approval_approve` — dan diperiksa **di dalam** fungsinya juga, bukan hanya menyembunyikan tombol.

**7.4 — Jangan sentuh perhitungan yang sudah ada.** `quantity_allocated`, `quantity_pending`, `quantity_prepared`, pemotongan FIFO lewat `consume_packed_lot`, dan reservasi bulk semuanya sudah benar dan sudah lama dipakai. Revisi ini hanya **menambah** `quantity_unfulfilled` di sampingnya. Komentar panjang di sekitar `quantity_prepared` (js/sales.js) menjelaskan bug pemotongan-ganda yang pernah terjadi — jangan diutak-atik.

**7.5 — Status `Cancelled` bukan urusan revisi ini.** Nilai itu hanya diproduksi aplikasi Leader Android. Tabel approval sudah punya tampilan untuknya; biarkan.

**7.6 — Cache-busting.** Naikkan `?v=` untuk setiap file JS yang berubah di [index.html](index.html). Tanpa ini fiturnya "tidak muncul" di live meski sudah ter-deploy — sudah pernah terjadi.

**7.7 — i18n dan tema.** Semua string baru lewat `data-i18n` / `window.t()`, key ditambahkan ke `en` **dan** `ar`. Tidak ada warna hardcode; pakai CSS custom property.

**7.8 — Data uji wajib dibersihkan** setelah verifikasi. Produksi ini dipakai orang sungguhan setiap hari.

---

## 8. Di luar cakupan (sengaja)

- Menghidupkan kembali sisa yang hangus, atau merevisi approval sebagian — ditolak di §3.3
- Menyeragamkan `Cancelled` dari aplikasi Leader — §3.8
- Mengubah `js/leader.js`, `dist/`, atau build Android apa pun
- Menambah tombol Unable to Fulfill di baris tabel — ditolak di §3.2
- Notifikasi ke sales saat ordernya ditolak (email/bubble) — belum diminta
