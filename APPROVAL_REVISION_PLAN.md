# Rencana Revisi: Sales Order — Approval &amp; Penghentian

**Status:** Rencana, siap dikerjakan. Sebelas keputusan desain sudah diambil user (§3) dan sudah divisualkan dalam mockup yang disetujui — tidak ada yang tersisa untuk ditanyakan.
**Tanggal:** 2026-09-12 (revisi 3 — menggabungkan penghentian order dari sisi packing)
**Fase 0 SUDAH DIKERJAKAN** — lihat §6.

**Dua mockup yang disetujui, buka keduanya sebelum menulis kode:**
- Sisi approval: https://claude.ai/code/artifact/52ab2c9e-cdce-489b-b084-153894915d8e
- Sisi packing: https://claude.ai/code/artifact/2352254e-9973-4f2c-8af4-16f08f3bdc18

Letak tombol, isi kolom tabel, dan susunan modal di sana adalah spesifikasi, bukan saran.

---

## 1. Ringkasan

Tiga tambahan pada siklus hidup sales order, plus satu pengetatan:

1. **Pemenuhan sebagian saat approval.** Leader boleh menyetujui order dengan jumlah kurang dari yang diminta. Kekurangannya dicatat dan ditampilkan, tidak lagi lenyap diam-diam.
2. **Unable to Fulfill dari approval.** Leader bisa menyatakan order tidak bisa dipenuhi sebelum apa pun dikerjakan.
3. **Unable to Fulfill dari packing.** Order yang sudah masuk Preparing bisa dihentikan oleh tim packing — dengan membongkar stok, reservasi bulk, dan roasting plan yang sudah tercipta.
4. **Tombol Edit dikunci** begitu tim packing atau roasting sudah mulai bekerja.

Nomor 1, 2, dan 3 menyediakan kotak alasan opsional yang masuk ke kolom yang sama.

**Kenapa digabung jadi satu pekerjaan:** ketiganya memakai status `Unable to Fulfill` yang sama, empat kolom keputusan yang sama, satu kotak alasan, dan badge yang sama di tabel Sales Dispatch Request maupun Dispatch Approval. Dikerjakan terpisah berarti menulis bagian itu dua kali lalu menyatukannya.

---

## 2. Apa yang sudah ada dan dipakai ulang

| Yang ditiru / disentuh | Sumber |
|---|---|
| Tabel approval | `loadDispatchApprovalTable` di [js/sales.js:912](js/sales.js:912) |
| Modal approve + tiga input pemenuhan | `approveSalesOrder` di [js/sales.js:1307](js/sales.js:1307); input `.inp-fulfill` / `.inp-bulk` / `.inp-prod` |
| Popup detail order | `openOrderDetailPopup` di [js/sales.js:1103](js/sales.js:1103) |
| **Kartu Preparing di menu Packing** | `renderOrderRequestsTab` di [js/packing.js:1736](js/packing.js:1736) — kartu dibangun dari `preparingOrders` |
| **Pembongkaran stok per lot** | `undoCommittedQty` di [js/packing.js](js/packing.js) — pola refund lewat RPC `refund_packed_lot`, sudah terbukti dipakai |
| Bubble peringatan | `showFieldWarn` di [js/sales.js:3231](js/sales.js:3231) — kelas `.custom-empty-warn` |
| Kotak alasan opsional + banner keputusan | Pola yang sudah jadi di `js/purchasing.js` — tiru bentuk dan penamaannya |

### Lubang yang sudah ada dan diisi oleh revisi ini

**[js/sales.js:1052](js/sales.js:1052) berbunyi harfiah `const canEdit = true;`** pada cabang status `Preparing`. Variabelnya disiapkan untuk syarat yang tidak pernah ditulis. Bagian 4 mengisi tempat itu — jangan membuat variabel baru di sebelahnya.

**Tidak ada validasi yang mencegah pemenuhan kurang.** Leader sudah bisa mengisi packed + bulk + produksi lebih kecil dari `quantity_requested`, tanpa peringatan, dan selisihnya tidak tercatat. Bagian 1 sebagian besar **menambal lubang**, bukan menambah kemampuan.

**Order yang sudah Preparing tidak punya jalan keluar.** Tim packing hanya bisa Prepare atau Dispatch. Satu-satunya cara menghentikan adalah menghapus ordernya — yang menghapus permanen beserta riwayatnya. Bagian 3 mengisi itu.

---

## 3. Keputusan user

**3.1 — Istilah: `Unable to Fulfill`.** Ejaan Amerika dobel-L, mengikuti seluruh kode dan terjemahan yang ada. "Cancel" ditolak karena sudah dipakai sebagai tombol tutup di setiap modal, dan menyiratkan pembatalan oleh pemesan. "Reject" ditolak karena terkesan menilai. "Unable to Fulfill" menyalahkan keadaan, bukan permintaannya — dan itu memang yang terjadi di roastery: penolakan hampir selalu soal stok.

**3.2 — Di approval, tombolnya hanya di kaki modal Approve.** Bukan tombol ketiga di baris tabel. Keputusan diambil setelah leader melihat angka stok, dan angka itu baru terlihat di dalam modal.

**3.3 — Sisa yang tidak diproses hangus.** Order berjalan dengan jumlah yang disetujui saja. **Jangan** membangun mekanisme "sisa menunggu keputusan berikutnya".

**3.4 — Peringatan kekurangan muncul saat mengetik**, bukan saat menekan Confirm.

**3.5 — Kotak alasan opsional, satu kolom untuk semua jalur.** Approval sebagian, Unable to Fulfill dari approval, dan penghentian dari packing semuanya menulis ke `decision_note`.

**3.6 — Status `Unable to Fulfill` dari approval hanya ketika SELURUH item diproses nol.**

**3.7 — Keputusan Unable to Fulfill bisa dibuka kembali**, selama belum ada proses lanjutan. Definisi di §5.1.

**3.8 — Tombol Edit dimatikan, bukan disembunyikan**, saat tim sudah bekerja. Definisi di §5.2.

**3.9 — Packing boleh menghentikan order sendiri**, tanpa mengembalikannya ke leader. User menimbang kecepatan lebih penting daripada memusatkan wewenang komersial.

**3.10 — Penghentian dari packing mengembalikan semuanya**: stok yang sudah dipotong kembali ke lotnya, reservasi bulk dilepas, roasting plan yang belum jalan dibatalkan. Batch yang sudah terlanjur disangrai **tidak bisa dibatalkan** dan harus dilaporkan, lihat §5.3.

**3.11 — Tombol penghentian di kartu packing memakai baris aksi kedua sendiri**, di bawah Print/Prepare. Lebih tinggi satu baris per kartu, tapi paling sulit terlewat.

**Aplikasi Leader Android (`js/leader.js`, `dist/`) TIDAK disentuh.** Tombol Reject di sana tetap menghasilkan `Cancelled`, dan 4 order lama berstatus itu dibiarkan. Jangan menyeragamkannya.

---

## 4. Skema database

**SUDAH DITERAPKAN 2026-09-08** (lihat §6 Fase 0). Dicatat di sini sebagai rujukan:

```sql
ALTER TABLE public.request_orders
  ADD COLUMN IF NOT EXISTS decided_by_id   UUID,
  ADD COLUMN IF NOT EXISTS decided_by_name TEXT,
  ADD COLUMN IF NOT EXISTS decided_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_note   TEXT;

ALTER TABLE public.request_order_items
  ADD COLUMN IF NOT EXISTS quantity_unfulfilled INTEGER DEFAULT 0;
```

`request_orders.status` mendapat nilai baru **`'Unable to Fulfill'`**.

**Jangan pakai ulang `approved_by` / `approved_date` / `dispatched_by`.** Ketiganya kolom mati — diverifikasi: **0 dari 51 baris terisi**, tidak ada kode yang menulisnya. Kolom bernama `approved_by` berisi nama orang yang *menolak* akan menyesatkan pembaca.

**`quantity_unfulfilled` disimpan, bukan dihitung dari selisih.** `quantity_requested − allocated − pending` terlihat menggoda, tapi ketiganya terus berubah selama packing berjalan, sehingga selisihnya lama-lama tidak lagi berarti "sengaja tidak dipenuhi".

---

## 5. Tiga aturan turunan — definisikan persis seperti ini

### 5.1 — Syarat Reopen (§3.7)

Tombol Reopen pada order `Unable to Fulfill` muncul hanya bila **ketiganya kosong**:

| Pemeriksaan | Cara |
|---|---|
| Tidak ada stok packed terpotong | `packed_stock_movements` dengan `ref_table = 'request_order_items'` dan `ref_id` di antara item order ini |
| Tidak ada reservasi bulk | `bulk_reservations` lewat `request_order_item_id` |
| Tidak ada roasting plan | `roasting_plans` dengan `order_ref = order.order_number` |

Reopen mengembalikan `status` ke `'Pending Approval'`, mengosongkan keempat kolom `decided_*` / `decision_note`, dan me-nol-kan `quantity_unfulfilled` semua itemnya.

**Catatan:** untuk order yang dihentikan dari **approval**, ketiganya selalu kosong — yang menciptakannya adalah tombol Approve. Untuk order yang dihentikan dari **packing** (§5.3), ketiganya justru terisi sebelum dibongkar; setelah pembongkaran, stok dan reservasi kembali nol tapi **roasting plan yang sudah punya batch tetap ada**, sehingga Reopen tidak akan muncul. Itu perilaku yang benar.

### 5.2 — Syarat tombol Edit mati (§3.8)

Tombol Edit pada baris approval jadi meredup + inert bila **salah satu** terpenuhi:

| Pemeriksaan | Cara |
|---|---|
| Barang sudah diambil dari gudang | ada `dispatch_lot_items` yang `request_order_item_id`-nya milik order ini |
| Sudah ada batch roasting | `roasting_plans` dengan `order_ref = order.order_number`, lalu `roast_batches` dengan `roast_plan_id` di antara plan itu |

**Pemotongan stok saat Approve TIDAK dihitung.** Itu pekerjaan leader sendiri, bukan tim. Kalau ikut dihitung, setiap order yang disetujui langsung terkunci meski belum disentuh siapa pun. Ini sengaja berbeda dari §5.1; jangan disamakan.

### 5.3 — Pembongkaran saat penghentian dari packing (§3.10)

Urutan kerjanya, dan yang harus dilaporkan lebih dulu di dialog konfirmasi:

| Yang dibongkar | Cara | Bisa dibatalkan? |
|---|---|---|
| Stok packed | RPC `refund_packed_lot` per lot, pola sama persis dengan `undoCommittedQty` di js/packing.js | Ya |
| Reservasi bulk | Hapus baris `bulk_reservations` milik item order ini | Ya |
| Roasting plan **tanpa** batch | Batalkan plannya | Ya |
| Roasting plan yang **sudah** punya batch | **TIDAK BISA** — kopinya sudah ada sebagai bulk di gudang | Tidak |

Dialog konfirmasi **wajib** menyebutkan kilogram dari plan yang sudah disangrai, beserta kalimat bahwa kopi itu akan tetap ada tanpa order tujuan dan sebaiknya dialihkan lebih dulu. Tanpa itu, tim menemukan bulk menganggur berminggu-minggu kemudian tanpa tahu asalnya.

Setelah dibongkar: `status = 'Unable to Fulfill'`, keempat kolom `decided_*` diisi, dan `quantity_unfulfilled = quantity_requested` untuk semua item.

---

## 6. Fase pengerjaan

### Fase 0 — Skema ✅ SUDAH DIKERJAKAN 2026-09-08 (commit `c705750`)

Migrasi §4 diterapkan ke produksi, `database/supabase_schema.sql` disamakan, `NOTIFY pgrst` dijalankan. Diverifikasi: 5 kolom baru ada, 87 item bernilai `0` tanpa NULL. **Jangan diulang.**

### Fase 1 — Peringatan kekurangan di modal Approve (mockup approval layar 2)

Di bawah ketiga input pemenuhan tiap item, tampilkan kotak kuning begitu `packed + bulk + produksi < quantity_requested`, berbunyi "N dari M tidak akan diproses" plus kalimat bahwa sisanya hangus. Muncul/hilang **saat mengetik** (event `input`), bukan saat submit.

Tambahkan kotak **Reason (opsional)** di bawah daftar item, satu untuk seluruh order.

*Verifikasi:* buka modal Approve untuk order yang stoknya kurang, ubah angkanya naik-turun — kotak kuning harus mengikuti ketikan tanpa klik apa pun.

### Fase 2 — Simpan pemenuhan sebagian

Di submit handler `approveSalesOrder`: hitung `quantity_unfulfilled = quantity_requested − (fQty + bQty + pQty)` per item, minimal 0. Simpan juga `decision_note` bila diisi, beserta `decided_by_id` / `decided_by_name` / `decided_at`.

*Verifikasi:* setujui order `ZZ TEST` dengan 12 dari 20 pada satu item dan penuh pada item lain. Cek database: item pertama `quantity_unfulfilled = 8`, kedua `0` — **bukan NULL**. Pastikan `quantity_allocated` / `quantity_pending` / `quantity_prepared` tetap seperti sebelumnya.

### Fase 3 — Tampilkan kekurangan (mockup approval layar 1 dan 4)

- **Tabel approval:** chip kuning "12 dari 20 diproses" di bawah badge status, hanya bila ada item dengan `quantity_unfulfilled > 0`.
- **Popup detail:** kolom **Diminta / Diproses / Tidak diproses**; angka tidak diproses berwarna kuning, "—" bila nol.
- **Banner kuning** di atas popup berisi alasan + nama pemutus + tanggal, bila `decision_note` terisi.

*Verifikasi:* buka popup order dari Fase 2 — angkanya 20/12/8 dan 6/6/—.

### Fase 4 — Unable to Fulfill dari approval (mockup approval layar 2, 3, 5)

Tombol di kaki modal Approve (§3.2) membuka dialog kecil dengan kotak alasan **opsional** — tombolnya selalu aktif.

Saat dikonfirmasi: `status = 'Unable to Fulfill'`, isi keempat kolom `decided_*`, `quantity_unfulfilled = quantity_requested` untuk semua item. **Tidak ada stok dipotong, tidak ada reservasi, tidak ada plan dibuat.**

Badge merah di tabel + baris kecil "oleh [nama] · [tanggal]". Banner merah di popup hanya bila alasannya diisi.

Tombol **Reopen** di kaki popup, dijaga §5.1 — pemeriksaan yang sama diulang **di dalam** fungsinya, bukan hanya di tampilan.

*Verifikasi:* tandai order `ZZ TEST` tanpa alasan → tidak ada banner merah, stok packed **tidak berubah** (bandingkan sebelum/sesudah). Ulangi dengan alasan → banner merah muncul. Reopen → status kembali `Pending Approval`, `decision_note` kosong, `quantity_unfulfilled` kembali `0`.

### Fase 5 — Tombol Edit terkunci (mockup approval layar 1)

Isi `const canEdit = true;` di [js/sales.js:1052](js/sales.js:1052) dengan syarat §5.2. Tombol **tetap dirender** dengan `opacity: 0.45` dan `cursor: not-allowed`; klik memunculkan bubble bergaya `.custom-empty-warn` berisi alasan yang menyebut tim mana yang sudah bekerja.

*Verifikasi:* order yang sudah punya `dispatch_lot_items` → tombol meredup, klik memunculkan bubble, dan `openSalesRequestModal` **tidak** terbuka. Order yang baru disetujui tapi belum disentuh tim → tombol normal.

### Fase 6 — Penghentian dari kartu packing (mockup packing, seluruh layar)

Tombol **Unable to Fulfill** sebagai **baris aksi kedua** di bawah Print/Prepare pada setiap kartu Preparing (§3.11), digerbangi `packing_dispatch_checkout` — izin yang sama dengan Prepare, karena keduanya menggerakkan stok.

Dialog konfirmasi menampilkan rincian **dikelompokkan per jenis** (§5.3): stok per lot, jumlah reservasi bulk, plan yang dibatalkan, dan kotak amber untuk plan yang sudah menghasilkan batch. Untuk lot yang banyak, sebut tiga teratas lalu ringkas sisanya. Kotak alasan opsional di bawahnya.

*Verifikasi:* buat order `ZZ TEST`, setujui sehingga stok terpotong, lalu hentikan dari kartu packing. Cek database: stok tiap lot kembali ke nilai semula (catat sebelum/sesudah), `bulk_reservations` milik order itu terhapus, plan tanpa batch dibatalkan, `status = 'Unable to Fulfill'`, dan `quantity_unfulfilled = quantity_requested` di semua item. Pastikan juga plan yang **punya** batch tidak ikut dibatalkan dan disebutkan di dialog.

---

## 7. Ranjau yang harus diwaspadai

**7.1 — Jangan panggil fungsi dari tombol yang inert.** Guard harus di dalam handler, bukan hanya `pointer-events: none` di CSS. Pola repo ini memeriksa ulang di dalam fungsi — lihat `decidePurchaseRequest` di js/purchasing.js.

**7.2 — Emoji bubble.** Key `alert_field_required` sudah memuat emoji peringatan. Kalau membuat key baru untuk bubble Edit, ikuti pola `js/roasting.js:2070` — pakai hasil terjemahan apa adanya, **jangan** menambahkan emoji di templat. Baru diperbaiki 2026-09-07 (commit `9f50f50`).

**7.3 — `hasPermission` di dalam fungsi.** Unable to Fulfill dan Reopen dari approval digerbangi `dispatch_approval_approve`; penghentian dari packing digerbangi `packing_dispatch_checkout`. Keduanya diperiksa **di dalam** fungsinya juga, bukan hanya menyembunyikan tombol.

**7.4 — Jangan sentuh perhitungan yang sudah ada.** `quantity_allocated`, `quantity_pending`, `quantity_prepared`, pemotongan FIFO lewat `consume_packed_lot`, dan reservasi bulk sudah benar dan lama dipakai. Revisi ini hanya **menambah** `quantity_unfulfilled` di sampingnya. Komentar panjang di sekitar `quantity_prepared` menjelaskan bug pemotongan-ganda yang pernah terjadi — jangan diutak-atik.

**7.5 — Pencocokan `order_ref` kini AMAN.** §5.1 dan §5.2 mencocokkan roasting plan lewat `order_ref = order.order_number`. Nomor order sempat bisa kembar — order 80 dan 81 sama-sama `ما080926007` pada 2026-09-08, karena pemindai urutan memakai regex khusus huruf Latin sehingga kode agen Arab tak terbaca. **Sudah diperbaiki 2026-09-12 (commit `1839af5`)**: regex dijangkarkan di akhir string, data dirapikan, dan `request_orders.order_number` kini punya indeks unik. Jangan mengubah pencocokan ini jadi berbasis id — tidak perlu lagi.

**7.6 — Pembongkaran harus memakai RPC, bukan UPDATE langsung.** Stok packed dikembalikan lewat `refund_packed_lot` supaya trigger ledger mencatat pergerakannya. Menulis langsung ke `packed_coffee_lots.remaining_pcs` akan memulihkan angkanya tapi meninggalkan lubang di riwayat — persis yang membuat Undo dulu salah menilai.

**7.7 — Status `Cancelled` bukan urusan revisi ini.** Nilai itu hanya diproduksi aplikasi Leader Android. Tabel approval sudah punya tampilan untuknya; biarkan.

**7.8 — Cache-busting.** Naikkan `?v=` untuk setiap file JS yang berubah di [index.html](index.html).

**7.9 — i18n dan tema.** Semua string baru lewat `data-i18n` / `window.t()`, key ditambahkan ke `en` **dan** `ar`. Tidak ada warna hardcode; pakai CSS custom property.

**7.10 — Data uji wajib dibersihkan** setelah verifikasi. Produksi ini dipakai orang sungguhan setiap hari.

---

## 8. Di luar cakupan (sengaja)

- Menghidupkan kembali sisa yang hangus, atau merevisi approval sebagian — ditolak di §3.3
- Mengembalikan order dari packing ke leader untuk diputuskan — ditolak di §3.9
- Mengalihkan bulk menganggur ke order lain secara otomatis — hanya dilaporkan, bukan dikerjakan (§5.3)
- Menyeragamkan `Cancelled` dari aplikasi Leader — §3.11
- Mengubah `js/leader.js`, `dist/`, atau build Android apa pun
- Menambah tombol Unable to Fulfill di baris tabel approval — ditolak di §3.2
- Notifikasi ke sales saat ordernya dihentikan — belum diminta
