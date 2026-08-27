# Stock Opname Bulanan — Rencana Pengembangan

**Status:** Fase 0 selesai (`b0d2316`), Fase 1 selesai (`0de5d96`), Fase 2 selesai (`d516ecb`, diverifikasi live — termasuk memperbaiki temuan bahwa permission baru tidak otomatis tersinkron ke role produksi yang sudah ada), Fase 3 selesai (`3fc3937`, `276c9b8`, diverifikasi live — termasuk temuan bahwa packed di produksi 100% bergantung pada pencocokan-nama untuk kode, dan koreksi toleransi bulk sesuai keputusan user), Fase 4 selesai (`f38565d`, `297cada`, diverifikasi live — termasuk satu bug ditemukan+diperbaiki live (bar rincian tidak ter-update), dan satu langkah (posting lewat finalize sungguhan) sengaja tidak diuji untuk melindungi stok produksi — lihat catatan di Fase 4), Fase 5 selesai (`68ce9dd`, `c1bcf16`, diverifikasi live termasuk **finalize sungguhan** dengan izin eksplisit user pada data uji yang sepenuhnya terisolasi, lalu dibersihkan total — juga menyelesaikan utang verifikasi Fase 4 karena jalur posting yang sama kini terbukti bekerja), Fase 6 selesai (`4980ca7`, diverifikasi live termasuk **uji kegagalan posting di tengah yang sungguhan** — status kembali terkunci, posting ulang terbukti tidak menggandakan — sekaligus menemukan+memperbaiki celah nyata di beberapa RPC lama yang gagal secara diam-diam tanpa error). Menunggu persetujuan lanjut ke Fase 7.
**Tanggal:** 2026-08-23
**Tujuan:** Mengubah fitur Stock Opname dari "form penyesuaian stok" menjadi proses penghitungan fisik bulanan yang hasilnya bisa dipercaya, tanpa menambah beban tim di lapangan.

Rencana ini ditulis agar bisa dikerjakan tanpa percakapan yang menghasilkannya. Setiap temuan berasal dari pembacaan kode yang ada (`js/app.js:3379-3830`, `database/supabase_schema.sql:483-508`), bukan asumsi. Mockup setiap layar sudah disetujui dan dijelaskan di §4.

---

## 1. Alur kerja yang dituju

Alur tim **tidak berubah** dari yang sekarang — tetap berbasis kertas:

```
Buka opname di sistem        → transaksi stok DIKUNCI
   ↓
Cetak lembar Tahap 1         → berisi angka sistem, kolom Aktual kosong
   ↓
Keliling gudang, tulis tangan
   ↓
Kembali ke sistem, input angka aktual
   ↓
   ├─ Total cocok            → selesai untuk item itu
   └─ Total tidak cocok      → cetak lembar Tahap 2 (rincian per lot)
                                 ↓
                              hitung ulang per lot di gudang
                                 ↓
                              input lewat modal rincian
   ↓
Tinjau selisih               → lihat apa yang akan berubah
   ↓
Posting                      → penyesuaian ditulis lewat RPC ber-ledger,
                                kunci dibuka
```

**Tahap 2 hanya berlaku untuk packed coffee.** Green bean dan bulk roasted cukup satu lembar tanpa rincian lot.

---

## 2. Keputusan desain (sudah disepakati)

| Keputusan | Pilihan | Konsekuensi |
|---|---|---|
| Cut-off | **Bekukan transaksi** | Selama opname aktif, semua perubahan stok ditolak di level database. Operasional berhenti sementara. |
| Granularitas | **Packed dua tahap; green & bulk satu lembar** | Packed dihitung total per grup dulu, rincian per lot hanya bila selisih. Green & bulk cukup per item. |
| Angka sistem di lembar cetak | **Tetap ditampilkan** | Tugas tim adalah *mencocokkan*, bukan menghitung buta. |
| Persetujuan | **Langsung posting** | Tidak ada alur approval. Tetap ada layar tinjauan sebelum tombol final — itu konfirmasi, bukan gerbang. |
| Nilai rupiah | **Belum sekarang** | `green_coffee_lots.purchase_price_per_kg` sudah tersimpan, bisa ditambahkan nanti tanpa bongkar ulang. |

> **Catatan jujur tentang menampilkan angka sistem.** Praktik baku penghitungan gudang adalah *blind count* — angka sistem disembunyikan supaya penghitung tidak berhenti begitu angkanya cocok. Pilihan menampilkannya sudah dipertimbangkan dan diputuskan secara sadar karena tugas tim di sini adalah mencocokkan, dan pengaman utamanya ada di tempat lain: begitu total tidak cocok, penghitungan naik ke level lot. Risiko sisanya nyata dan tidak dihilangkan oleh rencana ini — yaitu penghitung yang "menyesuaikan" hitungannya agar cocok. Peredamnya adalah kemampuan merinci grup mana pun kapan saja (§4.5), bukan hanya grup yang selisih. Ini dicatat agar keputusannya terdokumentasi, bukan untuk diperdebatkan ulang.

---

## 3. Cacat yang diperbaiki

Fitur yang ada sekarang menghasilkan catatan yang **terlihat** seperti hasil opname, tetapi belum tentu mencerminkan penghitungan yang benar-benar terjadi.

| # | Cacat | Bukti | Diperbaiki di |
|---|---|---|---|
| 1 | **Kolom kosong dicatat sebagai "sudah dihitung dan cocok".** Item yang tidak disentuh tersimpan dengan `variance = 0`, sehingga riwayat menyatakan barang itu diperiksa. | `js/app.js:3681` `if (isNaN(actual)) actual = g.systemQty;` | Fase 0 + 1 |
| 2 | **Barang berstok nol tidak muncul.** Stok fisik yang sistem kira 0 tidak akan pernah bisa ditemukan. | `js/app.js:3418`, `js/app.js:3440` `if (systemQty <= 0) return;` | Fase 5 |
| 3 | **Tidak ada cut-off.** Angka sistem dibaca saat tombol diklik; transaksi selama penghitungan mencemari selisih. | `buildStockTakeGroups()` | Fase 2 |
| 4 | **Hitungan hilang bila browser di-refresh** (disimpan di variabel JS). | `js/app.js:3514` `currentStockTakeGroups` | Fase 1 |
| 5 | **Packed digabung lintas mesin.** Kunci grup sekarang `nama|size` tanpa mesin, padahal stok packed dipisah per mesin dan FIFO/dispatch bekerja per mesin. | `js/app.js:3434` | Fase 3 |
| 6 | **Selisih packed dibagikan dengan tebakan** ke baris `packed_coffee`, bukan ke lot yang benar-benar selisih. | `applyStockGroupAdjustmentToLots` | Fase 4 |
| 7 | **Tidak ada layar tinjauan** sebelum stok berubah; `confirm()` bawaan browser. | `js/app.js:3697` | Fase 6 |

**Yang sudah benar dan tidak perlu diubah:** sejak `STOCK_LEDGER_PLAN.md` Fase 0–6, penyesuaian dari opname sudah masuk ke ledger per lot dengan `operation = 'stocktake'` dan `ref_table/ref_id` menunjuk `stock_takes`. Fondasi pencatatannya kuat — yang kurang hanya proses penghitungannya.

---

## 4. Spesifikasi layar (mockup sudah disetujui)

### 4.1 Lembar cetak Tahap 1 — semua kategori

Kolom: **Kode · Item · Sistem · Aktual · Catatan**

- Kolom pertama adalah **kode kopi** (`green_coffee.code` / `blend_recipes.code`, contoh nyata: `18`, `39`, `9`), bukan nomor urut. Kode inilah yang dipakai tim mencari barang.
- **Item** = nama kopi · size · mesin untuk packed (contoh: `SUMATRA · 1000g · GIESEN W15A`); nama kopi saja untuk green bean dan bulk.
- **Sistem** terisi angka. **Aktual** dan **Catatan** kosong untuk ditulis tangan.
- Beberapa **baris kosong penuh** di bawah (termasuk kolom Kode) untuk stok temuan yang tidak ada di daftar.
- Kop surat, tanggal, dan blok tanda tangan "Dihitung oleh / Diperiksa oleh" mengikuti pola `printStockCountForm` yang sudah ada.
- Satu halaman per kategori, sama seperti sekarang.

### 4.2 Layar input Tahap 1

Kolom: **Kode · Item · Sistem · Aktual · Status · ›**

- Sistem dan Aktual bersebelahan, jadi mengetik dari kertas sekaligus jadi pemeriksaan.
- Status per baris: `belum diinput` (abu-abu) / `cocok` (hijau, ikon centang) / `selisih −5` (kuning, baris ikut bertanda) / `dirinci` (hijau, ikon daftar).
- **Setiap baris punya panah di ujung kanan** dan bisa diklik untuk membuka modal rincian — termasuk baris yang totalnya cocok, supaya pemeriksaan acak tetap mungkin.
- Header: tombol **Cetak rincian** dan **Input rincian** (selalu ada).
- Bar bawah muncul saat ada selisih: `3 grup selisih · 9 lot perlu dihitung rinci` + tombol **Cetak rincian** dan **Input rincian**.
- Tab/Enter memindahkan fokus ke kolom Aktual berikutnya — pengetikan dari kertas harus bisa tanpa mouse.

### 4.3 Lembar cetak Tahap 2 — packed coffee saja

Hanya memuat grup yang selisih. Untuk tiap grup:

- **Header grup**: kode · nama · size · mesin, lalu `Sistem 50 · Hitung 45 · Selisih −5` — supaya tim tahu berapa yang dicari sebelum mulai.
- **Tabel lot**: **Strip · Lot / Tanggal packing · Sistem · Aktual · Catatan**. Tidak ada kolom nomor urut — strip code sudah menjadi penanda baris.
- Lot terdepan FIFO diberi tanda **`ambil dulu`**.

### 4.4 Modal input Tahap 2

- **Semua grup dalam satu modal**, urutannya sama dengan lembar cetak, sehingga pengetik bisa jalan dari atas ke bawah tanpa buka-tutup.
- Tiap grup: header (kode, nama, `Sistem · Tahap 1 · Selisih`), baris lot (`Strip · Tanggal · Sistem · [input Aktual]`), lalu **baris jumlah**.
- **Baris jumlah menghitung total lot secara langsung** dan membandingkannya dengan hasil Tahap 1:
  - Sama → hijau, `Jumlah lot cocok dengan hitungan tahap 1`
  - Beda → kuning, menampilkan kedua angka dan keterangan bahwa **rincian lot yang dipakai**
- Footer: `9 lot · 9 sudah diisi` + tombol **Batal** / **Simpan rincian**.

**Aturan bila bentrok:** jumlah rincian lot **selalu menang** atas total Tahap 1, karena dihitung lebih teliti daripada hitungan borongan. Nilai Aktual di layar Tahap 1 diperbarui otomatis mengikuti jumlah lot, dan status barisnya berubah menjadi `dirinci`.

### 4.5 Tiga jalan masuk ke modal Tahap 2

1. **Klik baris grup** (panah di ujung kanan) → modal terbuka untuk grup itu saja.
2. **Tombol "Input rincian" di bar bawah** → modal berisi semua grup yang selisih, urutan sama dengan lembar cetak. Ini jalur utama alur kertas.
3. **Tombol "Input rincian" di header** → selalu tersedia, untuk pemeriksaan acak atau melanjutkan rincian yang tertunda.

### 4.6 Spanduk pembekuan

Saat opname berstatus `counting`, halaman lain yang mengubah stok menampilkan spanduk merah: judul, penjelasan singkat, siapa yang membuka dan pukul berapa. Tombol aksi terkait dinonaktifkan.

**Spanduk harus memuat tautan ke halaman Stock Opname.** Ini bukan hiasan: orang yang terkunci perlu jalan langsung menuju tempat membukanya, bukan disuruh mencari sendiri.

---

## 5. Mengakhiri opname

Karena opname mengunci pekerjaan semua orang, cara mengakhirinya harus jelas dan selalu bisa dijangkau.

### 5.1 Dua jalan keluar normal

| Aksi | Status akhir | Stok | Kunci |
|---|---|---|---|
| **Posting** | `posted` | Disesuaikan sesuai hitungan | Terbuka |
| **Batalkan** | `cancelled` | Tidak disentuh sama sekali | Terbuka |

Keduanya tersedia di halaman Stock Opname selama opname berjalan. Baris `cancelled` **tidak dihapus** — percobaan yang dibatalkan tetap terlihat di riwayat berikut siapa yang membuka dan membatalkannya.

### 5.2 Bila posting gagal di tengah jalan

Ini kasus yang paling berbahaya dan harus ditangani secara eksplisit.

**Aturan: status aman adalah status terkunci.** Bila ada penyesuaian gagal saat posting, status dikembalikan ke **`counting`**, bukan dibiarkan tersangkut di `posting`.

Alasannya: penjaga pembekuan hanya memblokir `counting`. Kalau status dibiarkan tersangkut di `posting`, kunci justru terbuka sementara opname baru setengah diterapkan — orang mulai bertransaksi di atas stok yang belum selesai disesuaikan. Sekaligus indeks unik satu-opname-aktif memblokir pembuatan opname baru, jadi keadaan itu tidak bisa ditinggalkan begitu saja.

**Posting harus bisa diulang dengan aman.** Setiap `stock_take_items` yang penyesuaiannya sudah berhasil ditulis diberi `posted_at`. Saat posting diulang, baris yang sudah punya `posted_at` dilewati. Tanpa ini, mengulang posting akan menulis penyesuaian dua kali dan merusak stok — persis jenis kerusakan yang seluruh `STOCK_LEDGER_PLAN.md` dibangun untuk mencegahnya.

Layar harus menampilkan keadaan ini terang-terangan: *"Posting terhenti — 12 dari 19 penyesuaian sudah tersimpan. Stok masih terkunci. Coba posting lagi untuk melanjutkan."*

### 5.3 Siapa yang boleh mengakhiri

**Siapa pun yang punya permission `reports_stockopname_perform`** — bukan hanya orang yang membukanya.

Ini disengaja. Kalau yang membuka opname sudah pulang, laptopnya mati, atau akunnya bermasalah, gudang tidak boleh ikut terkunci sampai orang itu kembali. Nama pembuka tetap tercatat di `started_by` dan nama yang mengakhiri tercatat terpisah, jadi jejaknya tidak hilang.

### 5.4 Jalan darurat

Bila aplikasi sendiri tidak bisa diakses (misal bug di halaman opname), kunci tetap bisa dibuka lewat Supabase SQL Editor:

```sql
UPDATE public.stock_takes
SET status = 'cancelled'
WHERE status IN ('counting', 'posting');
```

Ini membatalkan opname tanpa menyentuh stok sama sekali. Aman dijalankan kapan pun, tapi hitungan yang sudah dimasukkan tidak ikut diposting — perlu diulang. Dokumentasikan perintah ini di tempat yang bisa dijangkau tim, bukan hanya di file ini.

---

## Fase 0 — Fondasi skema — SELESAI (`b0d2316`)

**File baru:** `database/v2_stock_opname_migration.sql`

### `stock_takes`

```sql
ALTER TABLE public.stock_takes
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'posted',
    ADD COLUMN IF NOT EXISTS started_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS started_by  TEXT,
    ADD COLUMN IF NOT EXISTS posted_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS counted_items INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS skipped_items INTEGER DEFAULT 0;
```

`DEFAULT 'posted'` disengaja: semua baris opname lama sudah selesai, jangan sampai ikut membekukan sistem saat migrasi dijalankan.

Nilai status: `counting` · `posting` · `posted` · `cancelled`.

**Hanya boleh ada satu opname aktif:**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS stock_takes_one_active_uniq
ON public.stock_takes ((1))
WHERE status IN ('counting', 'posting');
```

Indeks unik pada konstanta `1` dengan predikat — cara baku memaksa "maksimal satu baris memenuhi syarat ini". Tanpa ini, dua orang bisa membuka opname bersamaan.

### `stock_take_items`

```sql
ALTER TABLE public.stock_take_items
    ADD COLUMN IF NOT EXISTS counted       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS counted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS counted_by    TEXT,
    ADD COLUMN IF NOT EXISTS posted_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_found_item BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS parent_item_id INTEGER,
    ADD COLUMN IF NOT EXISTS ref_table     TEXT,
    ADD COLUMN IF NOT EXISTS ref_id        INTEGER,
    ADD COLUMN IF NOT EXISTS coffee_code   TEXT,
    ADD COLUMN IF NOT EXISTS strip_code    TEXT,
    ADD COLUMN IF NOT EXISTS lot_code      TEXT,
    ADD COLUMN IF NOT EXISTS machine_name  TEXT,
    ADD COLUMN IF NOT EXISTS bag_size_g    NUMERIC;
```

- **`counted`** adalah inti perbaikan cacat #1: membedakan *"dihitung, hasilnya sama"* dari *"belum dihitung"*. Keduanya menghasilkan `variance = 0` tetapi artinya jauh berbeda.
- **`posted_at`** membuat posting bisa diulang dengan aman (§5.2). Baris yang sudah punya `posted_at` dilewati saat posting diulang, sehingga penyesuaian tidak pernah ditulis dua kali.
- **`parent_item_id`** menunjuk ke baris grup Tahap 1 dari sebuah baris lot Tahap 2. Baris grup punya `parent_item_id IS NULL`. Tidak diberi foreign key ke tabel sendiri agar penghapusan tidak berantai — pola yang sama dipakai `packed_stock_movements`.
- **`ref_table` + `ref_id`** menunjuk sumber baris: `packed_coffee_lots` (baris lot), `green_coffee`, atau `bulk_roasted_coffee`.
- **`coffee_code` / `strip_code` / `lot_code` / `machine_name` / `bag_size_g`** adalah salinan, supaya lembar opname lama tetap terbaca meski lotnya sudah habis dan terhapus.

**Baris lama:** `counted` akan bernilai `FALSE` untuk semua data historis, padahal dulu tersimpan sebagai sudah-dihitung. Ini **tidak** di-backfill — data lama memang tidak bisa dibedakan mana yang benar-benar dihitung dan mana yang kolom kosong. Laporan harus memperlakukan opname sebelum tanggal migrasi sebagai granularitas lama.

**Verifikasi:** jalankan migrasi; `SELECT status, COUNT(*) FROM stock_takes GROUP BY status` harus menunjukkan semua baris lama `posted`; mencoba membuat dua baris `counting` harus gagal.

**Diverifikasi live 2026-08-23** (Supabase MCP tersambung, migrasi diterapkan lewat `mcp__supabase__apply_migration`, data uji berawalan "ZZ TEST"):
- Sebelum migrasi: 1 baris `stock_takes` lama, tanpa kolom `status`.
- Sesudah migrasi: baris itu terbaca `status = 'posted'` — sesuai harapan `DEFAULT 'posted'`.
- Insert baris `counting` pertama berhasil. Insert baris `counting` kedua **ditolak**: `duplicate key value violates unique constraint "stock_takes_one_active_uniq"`. Insert baris `posting` kedua saat yang pertama masih `counting` **juga ditolak** — predikat index memang mencakup keduanya.
- Setelah baris pertama diubah ke `cancelled`, baris `counting` baru berhasil dibuat — membuktikan index hanya mengunci selama ada baris aktif, bukan permanen.
- Kolom baru `stock_take_items` (`counted`, `coffee_code`, `strip_code`, `parent_item_id`) ditulis dan dibaca benar; baris "lot" dengan `parent_item_id` menunjuk baris "grup" tersimpan dan terbaca sesuai desain §Fase 0's `stock_take_items`.
- Seluruh data uji dibersihkan; dibuktikan ulang: `SELECT id, status FROM stock_takes WHERE status IN ('counting','posting')` kosong, dan tidak ada sisa baris `ZZ TEST` di kedua tabel.
- `node test.js` lulus tanpa error sintaks (tidak ada JS yang diubah di fase ini — migrasi murni additive).

---

## Fase 1 — Siklus hidup & penyimpanan bertahap — SELESAI (`0de5d96`)

**File:** `js/app.js`

Sekarang `startStockTake()` hanya menyiapkan array di memori. Diubah menjadi:

1. `startStockTake()` membuat baris `stock_takes` berstatus `counting` **lebih dulu**, lalu menulis seluruh baris `stock_take_items` dengan `counted = false` dan `actual_qty = NULL`.
2. Setiap kali satu angka diisi, baris itu langsung disimpan (`counted = true`, `counted_at`, `counted_by`).
3. Membuka halaman saat ada opname `counting` memuat ulang lembar itu, bukan memulai yang baru.
4. `cancelStockTake()` mengubah status ke `cancelled` (tidak menghapus), sehingga percobaan yang dibatalkan tetap terlihat di riwayat. **Boleh dilakukan siapa pun yang punya `reports_stockopname_perform`**, bukan hanya yang membuka — lihat §5.3.
5. `finalizeStockTake()` **berhenti** memperlakukan kolom kosong sebagai "cocok". Baris `counted = false` dilewati sepenuhnya saat posting dan tidak menyesuaikan stok.

**Verifikasi:** buka opname, isi beberapa angka, refresh browser — yang sudah diisi harus tetap ada, sisanya masih kosong. Posting dengan sebagian belum diisi — item itu harus tidak berubah stoknya **dan** tercatat `counted = false`, bukan `variance = 0`.

**Diverifikasi live 2026-08-26**, lewat UI produksi sungguhan (klik, ketik, Tab — bukan simulasi backend), dengan strategi aman: isi baris hanya dengan nilai = angka sistem (variance 0, tidak pernah memicu penyesuaian) atau selalu batalkan alih-alih memposting nilai yang berbeda, sehingga stok asli tidak pernah tersentuh selama pengujian:

- **Input kosong secara visual** — placeholder `—`, bukan lagi pre-filled dengan angka sistem (`js/app.js:3534` lama). Ini perubahan kecil di luar teks plan yang perlu, dan disengaja: pre-fill lama membuat "belum dihitung" tidak bisa dibedakan dari "tidak diubah", yang justru bagian dari cacat #1.
- **Staged-save**: mengisi SUMATRA dengan `156.6` (sama dengan sistem) langsung tersimpan ke `stock_take_items` — dibuktikan lewat query DB, bukan asumsi: `counted=true, actual_qty=156.6, variance=0, counted_by='khaleed', counted_at` terisi.
- **Bertahan setelah refresh**: full page reload (bukan SPA re-render), lalu navigasi ulang ke tab — baris SUMATRA tetap `156.6`/variance `0.0`, baris lain tetap kosong. Dicek langsung dari DOM, 120 baris utuh.
- **Resume otomatis**: membuka tab Stock Opname saat ada opname `counting` menampilkan pesan *"Resuming stock take started 2026-08-26 by khaleed. N of 120 items counted"* — bukan riwayat kosong.
- **Cancel**: dicatat `stock_kg` SUMATRA sebagai baseline (`156.6`) sebelum klik Cancel, dan sesudahnya **identik** — status berubah jadi `cancelled`, baris tetap ada di riwayat (Items: 0 — kolom ringkasan memang tidak diisi cancel, hanya finalize).
- **Finalize dengan campuran counted/uncounted**: opname baru, isi 2 dari 120 baris (variance 0 keduanya), sisanya kosong. Dialog konfirmasi menampilkan persis *"Counted: 2 | Not counted: 118 | Variances: 0"*. Sesudah finalize: `stock_takes` **di-UPDATE di tempat** (row id yang sama, bukan insert baru seperti kode lama) — `status='posted', total_items=120, counted_items=2, skipped_items=118, variance_items=0, posted_at` terisi. Ketiga item yang diperiksa (2 terisi + 1 kosong/PEACH) — `stock_kg` di `green_coffee` **identik** dengan sebelum finalize. `PEACH` tetap `counted=false, actual_qty=null` di `stock_take_items`.
- Query wajib dari peringatan handoff, dijalankan sesudahnya: `SELECT id, status FROM stock_takes WHERE status IN ('counting','posting')` → kosong.
- Kueri invarian ledger packed (`STOCK_LEDGER_PLAN.md` Lampiran): 0 ketidakcocokan.
- Semua baris uji (`stock_takes` id 8 dan 9, beserta `stock_take_items` turunannya lewat `ON DELETE CASCADE`) dihapus setelah pengujian — baris-baris ini murni artefak testing (notes kosong, bukan opname fisik nyata), berbeda dari data "ZZ TEST" pada tabel stok karena `stock_takes` adalah metadata riwayat, bukan stok — dihapus supaya Stock Opname History tidak berisi entri palsu yang membingungkan.

**Temuan performa (bukan bug fungsional, tapi nyata dan layak dicatat):** `startStockTake()` menyisipkan satu baris `stock_take_items` per grup secara **berurutan** (`for...await`, bukan batch insert). Untuk 120 grup, ini memakan waktu **~20–30 detik** sebelum lembar hitung muncul — selama itu tombol terlihat seperti tidak merespons. Ini persis terjadi saat pengujian: klik pertama "tampak gagal" (sheet masih kosong setelah 1,5 detik), lalu tombol diklik/dipanggil lagi. Sistem menangani situasi ini **dengan aman** (panggilan kedua mendeteksi opname yang sudah `counting` dan me-resume, bukan membuat duplikat — dibuktikan lewat query: 120 baris, 0 grup terduplikasi), tapi pengalaman penggunanya buruk dan mengundang klik berulang. Di luar scope literal Fase 1 (yang soal siklus hidup, bukan performa) — dicatat sebagai kandidat perbaikan (mis. `saveData` batch/`insert` array sekaligus alih-alih loop), bukan diperbaiki tanpa diminta.

**Jalur "stale row" — diverifikasi live 2026-08-26, setelah sempat tercatat "belum diverifikasi" di laporan sebelumnya.** Reproduksi race sungguhan (data produksi berubah *sungguhan* di antara start dan resume) butuh menyentuh stok asli untuk dipicu, jadi dihindari — tapi jalur kodenya bisa dipicu dengan aman **tanpa** itu: `resumeStockTake()` mencocokkan baris `stock_take_items` ke grup lewat `(category, item_name)`, jadi memanipulasi `item_name` pada baris **milik opname uji sendiri** (metadata riwayat, bukan stok) memicu cabang kode yang identik dengan race sungguhan, tanpa menyentuh `green_coffee`/`packed_coffee`/`bulk_roasted_coffee` sama sekali:
- Dibuat opname uji (id sementara) dengan 2 baris `stock_take_items` langsung lewat SQL: satu `item_name='SUMATRA'` (cocok dengan grup nyata), satu `item_name='ZZ TEST STALE ROW - GHOST ITEM'` (sengaja tidak cocok apa pun).
- Resume: baris ghost tampil dengan badge peringatan (⚠) dan `System = 42.0 kg` — persis snapshot yang disimpan di `stock_take_items.system_qty`, bukan mencoba mencari grup yang memang tidak ada. Baris SUMATRA tetap cocok normal (`System = 156.6 kg` dari grup live).
- Diisi: SUMATRA `156.6` (variance 0, aman), baris ghost `50` (variance `8` — sengaja bukan nol, supaya cabang skip-adjustment di `finalizeStockTake()` benar-benar teruji, bukan cuma lewat tanpa dites karena `Math.abs(variance) > 1e-9` false).
- Finalize dijalankan langsung (dialog di-override sementara seperti pengujian sebelumnya) — **tidak crash** (`errorCaught: null`, padahal grup ghost punya `rows: []` yang seharusnya melempar error kalau `applyStockGroupAdjustmentToLots` dipaksa jalan untuknya), `console.warn` **persis** memuat pesan yang ditulis di kode: *"Stock opname: skipping stock adjustment for stale item "ZZ TEST STALE ROW - GHOST ITEM" — its source rows no longer match. Only the count was recorded."*
- Sesudahnya: `stock_takes` → `status='posted', total_items=2, counted_items=2, variance_items=1` (hanya baris ghost yang punya variance). `green_coffee.stock_kg` SUMATRA **identik** sebelum/sesudah (`156.6`).
- Baris uji dihapus (`DELETE FROM stock_takes WHERE id=...`, cascade menghapus item-nya); riwayat kembali hanya berisi opname asli.

Permission `reports_stockopname_perform` belum ada (scope Fase 2) — start/cancel/finalize saat ini masih hanya digerbangi `reports_stockopname_view` yang sudah ada sebelumnya, sama seperti perilaku lama. Ini bukan "belum terverifikasi", tapi memang belum dibangun — tidak ada yang bisa diuji sampai Fase 2 menambahkan key-nya.

---

## Fase 2 — Pembekuan transaksi (dipaksa database) — SELESAI (`d516ecb`)

**File baru:** `database/v2_stock_opname_freeze_migration.sql`

Pelajaran yang sudah dibayar mahal di `STOCK_LEDGER_PLAN.md`: **kalau sebuah aturan penting, database yang harus memaksakannya.** Menyembunyikan tombol saja tidak cukup.

```sql
CREATE OR REPLACE FUNCTION public.stock_take_freeze_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.stock_takes WHERE status = 'counting') THEN
        RAISE EXCEPTION
          'Stock opname sedang berjalan — perubahan stok dikunci sampai opname diposting atau dibatalkan.';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SET search_path = public;
```

Dipasang `BEFORE INSERT OR UPDATE OR DELETE` pada tiga tabel: `packed_coffee_lots`, `green_coffee_lots`, `bulk_roasted_coffee`.

**Nama trigger harus mengurut lebih dulu** dari trigger ledger yang sudah ada (`trg_log_packed_stock_movement`, `trg_log_bulk_stock_movement`) — Postgres menjalankan trigger sewaktu-sama secara alfabetis. Gunakan awalan `trg_aa_stock_take_freeze`.

**Cara penyesuaian opname sendiri lolos:** saat posting, status diubah `counting` → `posting`. Penjaga hanya memblokir `counting`.

> **Kompromi yang disadari:** selama jendela `posting` (hitungan detik) kunci terbuka untuk semua orang, bukan hanya proses posting. Alternatifnya menandai tiap operasi dengan `mv_operation = 'stocktake'` — tetapi `green_coffee_lots` **belum punya kolom `mv_*` maupun ledger** (hanya packed dan bulk yang punya, lihat `supabase_schema.sql`), sehingga cara itu belum bisa dipakai seragam tanpa lebih dulu membangun ledger green bean. Jendela sesaat dinilai memadai; ini utang teknis yang tercatat, bukan celah tersembunyi.

**Sisi aplikasi (lapisan lunak, bukan pengaman utama):**

- Saat memuat bagian mana pun yang mengubah stok, cek apakah ada opname `counting`; bila ada tampilkan spanduk (§4.6) dan nonaktifkan tombol terkait. **Spanduk harus memuat tautan ke halaman Stock Opname** supaya orang yang terkunci punya jalan langsung untuk membukanya.
- Penanganan error terpusat: bila pesan error mengandung teks penjaga, tampilkan modal berbahasa manusia, bukan pesan Postgres mentah.

**Permission baru:** tambahkan `reports_stockopname_perform` di `MOCK_DB.custom_roles` (`js/app.js`) dan daftar permission Settings (`js/settings.js:392`). Memulai opname membekukan pekerjaan semua orang — itu tidak boleh bisa dilakukan siapa saja yang kebetulan bisa melihat tab ini. Berikan ke Developer, Admin, dan Production Leader.

**Verifikasi:**
1. Buka opname → coba dispatch/packing/roasting dari tab lain. Harus ditolak dengan pesan jelas, stok tidak berubah.
2. Posting opname → operasi yang sama harus berhasil lagi.
3. Batalkan opname → juga harus membuka kunci.
4. Jalankan kueri invarian ledger (`STOCK_LEDGER_PLAN.md` Lampiran): 0 ketidakcocokan.

**Diverifikasi live 2026-08-26.** Urutan pengujian sengaja dibalik dari daftar di atas: **non-regression dulu**, sebelum sisi positifnya — fase ini bisa mengunci seluruh transaksi stok produksi kalau logic-nya salah, jadi hal pertama yang harus dibuktikan adalah operasi *normal* tidak ikut terkunci begitu trigger dipasang.

- **Urutan trigger dikonfirmasi lebih dulu**, bukan diasumsikan — `information_schema.triggers` dicek sebelum migrasi ditulis: `packed_coffee_lots` dan `bulk_roasted_coffee` masing-masing sudah punya satu trigger `BEFORE` (`trg_log_*`); `green_coffee_lots` belum punya trigger `BEFORE` sama sekali. Nama `trg_aa_stock_take_freeze` menjamin urutan eksekusi yang benar di ketiganya.
- **Non-regression** (dijalankan pertama, sebelum ada opname aktif): INSERT baris baru + UPDATE lewat RPC asli (`consume_packed_lot`, `consume_green_coffee_lot`, `consume_bulk_lot`) + DELETE — pada ketiga tabel — semua **berhasil normal**. Ini yang paling penting dibuktikan duluan.
- **Sisi positif**: dibuat satu baris `stock_takes` uji berstatus `counting`, lalu INSERT pada ketiga tabel dicoba — **ketiganya ditolak** dengan pesan persis `"Stock opname sedang berjalan — perubahan stok dikunci sampai opname diposting atau dibatalkan."`
- **Kunci terbuka lagi**: opname uji diubah ke `cancelled`, INSERT yang sama diulang → **berhasil**. Semua data uji (baris `stock_takes`, baris lot uji, parent `packed_coffee` uji) dibersihkan segera setelah setiap sub-pengujian — tidak dibiarkan menumpuk sampai akhir, mengingat risikonya.
- Kueri invarian ledger packed dijalankan sesudahnya: **0 ketidakcocokan**.

**Spanduk global** — diverifikasi bekerja di halaman **lain** (Dashboard, bukan halaman Stock Opname itu sendiri), membuktikan cakupan globalnya benar, bukan kebetulan tersambung ke satu section: teks berisi tanggal + nama pembuka opname persis sesuai templat, dan tautan **"Open Stock Opname"** terbukti menavigasi ke section Reports **dan** langsung mengaktifkan tab Stock Opname dalam satu klik — yang kemudian otomatis me-resume opname yang sedang berjalan (memakai ulang `resumeStockTake()` dari Fase 1).

**Penanganan error terpusat** — dibuktikan dengan memanggil `window.saveData('green_coffee_lots', {...})` sungguhan (fungsi global aplikasi yang sama dipakai form manapun, bukan SQL mentah) selagi opname `counting` aktif: `error` yang dikembalikan tetap objek Postgres asli (return value `saveData` **tidak berubah** — kompatibel dengan semua pemanggil lama), **dan** sebuah modal `showWarningModal` muncul otomatis berisi pesan manusiawi yang sama persis, bukan kode error Postgres mentah. Tidak ada baris yang tersimpan (trigger `BEFORE` menolak sebelum `INSERT` benar-benar terjadi) — dikonfirmasi lewat query, 0 baris nyasar.

> **Temuan penting yang mengubah cara Fase 2 diselesaikan.** Setelah kode gating tombol di-deploy, tombol Cancel/Finalize/New ternyata **disabled untuk semua orang**, termasuk role Developer — bukan bug logic, tapi kesalahpahaman scope: `MOCK_DB.custom_roles` di `js/app.js` **hanya dipakai sebagai seed saat tabel `custom_roles` Supabase masih kosong** (`initMockDatabases()`/first-sync). Menambahkan key permission baru ke objek JS itu **tidak** menyuntikkannya ke baris `custom_roles` yang sudah ada di database produksi — role Developer/Admin/Production Leader produksi masih memegang permission set lama sampai ada yang benar-benar meng-`UPDATE` baris JSONB-nya. Diperbaiki dengan `UPDATE custom_roles SET permissions = permissions || '{"reports_stockopname_perform": true}' WHERE name IN (...)` pada ketiga role itu — **hanya ketiga nama yang eksplisit disebut plan**, bukan role kustom lain yang sudah dibuat user sendiri lewat Settings (mis. `admin2`, `Sales Manager`, `Sale 101`) — pemberian akses ke role kustom itu keputusan pengguna, bukan tebakan yang pantas diambil sepihak. Gating tombol lalu diverifikasi ulang di **kedua arah**: disabled saat permission `false` (kondisi awal), enabled saat `true` (dibuktikan dengan override sementara *hanya* di `localStorage` cache milik sesi uji sendiri — bukan mengubah role produksi manapun — lalu dikembalikan setelah terbukti).

**Belum diverifikasi:** jendela `posting` yang disebut sebagai "kompromi yang disadari" di atas — baru relevan setelah Fase 6 (di mana `finalizeStockTake()` benar-benar transit lewat status `posting`) diimplementasikan penuh; saat ini `finalizeStockTake()` langsung ke `posted` tanpa transit `posting` (lihat catatan Fase 1), jadi jendela ini belum pernah benar-benar terbuka di kode yang berjalan sekarang.

---

## Fase 3 — Tahap 1: pengelompokan, layar input, lembar cetak — SELESAI (`3fc3937`, `276c9b8`)

**File:** `js/app.js` (`buildStockTakeGroups`, `resolvePackedCoffeeIdentity`, `resolveBulkCoffeeCode`, `stockOpnameIsMatch`, `stockOpnameStatusHtml`, `renderStockTakeSheet`, `finalizeStockTake`, `printStockCountForm`), `js/translations.js`, `index.html`.

**Pengelompokan (cacat #5) — DONE:** Packed dikelompokkan ulang menjadi `(nama kopi, bag_size_g, machine_id)` — `machine_id` adalah kolom langsung di `packed_coffee`, tidak perlu lewat `roast_batch`. Label menjadi `Nama · Ukuran · Mesin` (mis. `SUMATRA · 1kg · GIESEN W15A`). Green bean tetap satu baris per `green_coffee`; bulk tetap digabung per `coffee_name` (sesuai rencana awal).

**Kolom Kode — DONE:** Tiap grup membawa `coffeeCode`. Temuan penting saat verifikasi: **semua 77 baris `packed_coffee` yang berstok di produksi TIDAK punya `roast_batch_id`/`single_coffee_id`/`blend_recipe_id` terisi** — jalur pencocokan-nama (`custom_coffee_name` dibersihkan dari sufiks " (Single)"/" (Blend)" lalu dicocokkan ke `green_coffee.name`/`blend_recipes.name`) bukan cadangan langka, melainkan SATU-SATUNYA jalur yang benar-benar dipakai untuk packed di produksi saat ini. Diverifikasi lewat dry-run SQL langsung ke tabel produksi: 39 dari 40 nama kopi packed berhasil resolve kode; 1 nama blend kustom tanpa definisi kode terkait (aman, tampil kosong, tidak error). Bulk resolve kode lewat `single_coffee_id`/`blend_recipe_id` langsung (kolom ini ADA di `bulk_roasted_coffee`, beda dari packed) — 12 dari 14 grup berkode benar, 2 sisanya data uji lama ("Test Custom Blend 2"/"Test House Blend", bukan stok nyata).

**Kolom Status menggantikan Variance — DONE, lalu diganti kata "Difference":** Tabel input/riwayat sekarang punya kolom Kode dan Status (bukan lagi badge Category dan angka Variance mentah). Status menampilkan "✓ Match" (hijau) atau "Difference ±X" (hijau/merah sesuai arah). Kata **"Variance" diganti "Difference"** di semua teks tampilan (`col_variance`, `col_variances`, label Status, ringkasan dialog Finalize) atas permintaan user langsung — Bahasa Arab tidak perlu diubah karena terjemahannya (`الفرق`/`الفروقات`) sudah berarti "perbedaan", bukan istilah statistik.

**Toleransi selisih — DIKONFIRMASI USER (2026-08-26):**
- **Green bean saja** → toleransi `max(0.1 kg, 1% × angka sistem)`. Konstanta `STOCKOPNAME_KG_TOLERANCE_PCT`/`STOCKOPNAME_KG_TOLERANCE_MIN_KG` di `js/app.js`.
- **Packed dan bulk → harus persis sama (exact match).** Catatan teknis: draft plan sebelumnya berasumsi bulk itu "satuan utuh" sehingga wajar exact-match — itu **keliru**, `bulk_roasted_coffee.bulk_available` adalah kolom desimal kg persis seperti `green_coffee.stock_kg`. Sempat diimplementasikan toleransi untuk bulk juga (alasan teknis di atas), tapi **user secara eksplisit memilih tetap exact-match untuk bulk** setelah temuan ini dijelaskan — dikembalikan ke exact-match sesuai keputusan tersebut, bukan karena revert teknis.
- Fungsi `stockOpnameIsMatch(group, actual)` menentukan match berdasarkan `group.category === 'greenbean'`, bukan `group.unit === 'kg'` — supaya keputusan ini tidak diam-diam berubah lagi kalau ada kategori kg baru di masa depan.

**Permission granular — dikonfirmasi & didemonstrasikan:** `reports_stockopname_perform` (dibuat di Fase 2) sudah sepenuhnya granular — ada di `PERMISSION_GROUPS` (`js/settings.js`) dan muncul sebagai checkbox di modal Edit Role untuk *role apa pun*, termasuk role kustom. User sempat menemukan role kustom `admin2` belum mendapat izin ini (Fase 2 sengaja hanya memberi ke Developer/Admin/Production Leader). Alih-alih SQL manual, izin diberikan lewat **jalur self-service UI yang sama yang bisa user pakai untuk role lain** — dibuka via `openRoleModal(17)`, checkbox `perm_reports_stockopname_perform` dicentang, tombol "Save Role" — diverifikasi tersimpan benar di `custom_roles.permissions` produksi. User sekarang bisa memberi izin ini ke role mana pun sendiri tanpa perlu developer.

**Verifikasi live (2026-08-26, akun `khaleed`/`admin2` via Claude in Chrome dengan sesi asli user):**
1. `node test.js` — tanpa SyntaxError.
2. Dry-run SQL terhadap 20 tabel produksi (read-only) untuk memastikan logika pengelompokan/resolusi kode benar SEBELUM diuji di browser — hasilnya cocok 100% dengan yang dilihat di browser setelahnya.
3. Stock take sungguhan dibuat (id 13, ~133 grup: 42 green bean + 14 bulk + 77 packed) lewat tombol "New Stock Take" asli, bukan panggilan fungsi langsung.
4. Kode & label diperiksa langsung dari `currentStockTakeGroups` — cocok dengan hasil dry-run SQL (mis. `BRAZIL ROSA`→kode 1, `SUMATRA`→kode 18, `DATES BLEND`→kode 34).
5. Baris tabel `#stockopname-count-body` diperiksa — kolom Kode & Status tampil benar, baris belum diisi menampilkan "—".
6. Toleransi diuji langsung di input sungguhan: green bean `SUMATRA` (sistem 156,6kg) diisi 157,5kg (selisih +0,9kg, dalam toleransi ±1,566kg) → "✓ Match"; diisi 165kg (selisih +8,4kg, di luar toleransi) → "Difference +8.4".
7. Packed diuji exact-match: isi tepat sistem → Match; +1 → "Difference +1".
8. Bulk diuji exact-match: selisih 0,05kg (jauh di bawah 1%/0,1kg) tetap → "Difference +0.1", BUKAN Match — membuktikan bulk tidak lagi dapat toleransi.
9. Navigasi fokus Enter pada input Aktual berpindah ke baris berikutnya — diuji lewat `KeyboardEvent('keydown', {key:'Enter'})` asli pada elemen fokus.
10. `printStockCountForm()` dipanggil sungguhan (dengan `window.open` di-intercept sementara untuk menangkap HTML, dikembalikan setelahnya) — header kolom pertama "Code", baris data pertama menunjukkan kode & nama asli.
11. Take id 13 dibatalkan lewat `cancelStockTake()` asli (bukan SQL manual) — dikonfirmasi `status = 'cancelled'` di database, tidak ada penyesuaian stok terjadi (Cancel tidak pernah menyentuh stok).

**Catatan teknis dari sesi ini:** verifikasi awal sempat terhambat masalah render di Browser pane bawaan (screenshot timeout, viewport salah lapor, sesi auth terputus di tengah jalan) — akhirnya diselesaikan dengan pindah ke alat "Claude in Chrome" yang memakai sesi Chrome asli user, dan menambah dry-run SQL sebagai lapis verifikasi tambahan sebelum uji browser.

---

## Fase 4 — Tahap 2: rincian per lot (packed coffee saja) — SELESAI (`f38565d`, `297cada`)

**File:** `js/app.js` (`applyStockGroupDetailedLotsAdjustment`, `stockOpnameGroupsNeedingDetail`, `lotsForPackedGroupFromCache`, `updateStockTakeDetailBar`, `printStockCountFormStage2`, `openStockTakeDetailModal`, `saveStockTakeDetailForGroup`, plus perubahan pada `renderStockTakeSheet`, `stockOpnameStatusHtml`, `updateVarianceCell`, `saveCountedValue`, `resumeStockTake`, `finalizeStockTake`), `index.html`, `js/translations.js`.

**Lembar cetak Tahap 2 (§4.3) — DONE:** satu blok per grup yang sedang selisih (`stockOpnameGroupsNeedingDetail()`), header `Sistem · Aktual · Difference`, tabel lot **Strip · Lot/Tanggal packing · Sistem · Aktual · Catatan**, lot FIFO terlama ditandai "PICK FIRST". Diverifikasi live: 5 lot BRAZIL ROSA 250g STRONGHOLD S9X tercetak dengan urutan tanggal benar (28 Jul → 23 Agu) dan tanda pick-first tepat di lot tertua.

**Modal input Tahap 2 (§4.4) — DONE:** semua grup terpilih dalam satu modal, baris lot dengan input Aktual, baris jumlah membandingkan total lot ke Aktual Tahap 1 secara live — hijau "Lot count matches the Stage 1 total" bila sama, kuning dengan kedua angka bila beda. **Rincian lot selalu menang** — `saveStockTakeDetailForGroup` menimpa `actualQty` grup dengan jumlah lot begitu disimpan, terlepas dari apa yang diketik di Tahap 1.

**Tiga jalan masuk (§4.5) — DONE:** panah `›` per baris (hanya kategori packed, non-stale) membuka modal untuk satu grup; tombol header "Enter Lot Detail" (selalu ada) dan bar bawah (`stockopname-detail-bar`, muncul saat ada selisih) sama-sama memanggil `stockOpnameGroupsNeedingDetail()` sehingga tidak bisa berbeda hasil.

**Status "Dirinci" dan pembatalan otomatis:** grup yang sudah dirinci menampilkan status "📋 Detailed", menggantikan Match/Difference. Mengetik ulang angka Tahap 1 secara manual membatalkan status ini SECARA LANGSUNG (live, bukan hanya saat disimpan) dan **menghapus baris `stock_take_items` anak yang jadi usang** — tanpa ini, refresh berikutnya akan salah merekonstruksi status "Dirinci" dari baris anak yang sudah tidak relevan. `resumeStockTake` direkonstruksi untuk memisahkan baris anak (`parent_item_id` terisi) dari baris grup saat mencocokkan by key, dan membangun ulang `g.lotBreakdown`/`g.detailed` dari baris anak yang tersimpan.

**Posting per lot (cacat #6) — DONE:** grup yang dirinci **selalu** menulis lewat `set_packed_lot_remaining(lot_id, hasil_hitung, 'stocktake', 'stock_takes', take_id)` per lot — termasuk saat totalnya kebetulan cocok dengan sistem (lot bisa bergeser satu sama lain meski totalnya sama), bukan hanya saat ada selisih di level grup. Grup yang tidak dirinci tetap memakai pembagian tebakan yang sudah ada (`applyStockGroupAdjustmentToLots`, tidak diubah).

**Verifikasi live (2026-08-26, akun `khaleed`/`admin2` via Claude in Chrome, take id 14):**
1. `node test.js` — tanpa SyntaxError, di setiap iterasi.
2. Take sungguhan dibuat (133 grup), grup `BRAZIL ROSA · 250g · STRONGHOLD S9X` (sistem 81, 5 lot nyata) diisi Tahap 1 = 75.
3. Bar bawah muncul benar: *"1 group(s) with a difference · 5 lot(s) need a detail count"* — sempat DITEMUKAN BUG di sini (bar tidak ter-update saat mengetik, hanya saat render penuh) — diperbaiki live, di-deploy ulang (`297cada`), diverifikasi ulang sebelum lanjut.
4. Modal dibuka lewat panah baris — 5 lot tampil FIFO benar dengan strip/lot code/tanggal asli, pick-first tepat.
5. Diisi 2,1,1,4,67 (total 75) → baris jumlah "✓ Lot count matches the Stage 1 total (75)"; diubah salah satu jadi 68 (total 76) → berubah ke peringatan kuning "Lot total (76) differs from Stage 1 (75)"; dikembalikan ke 67, disimpan.
6. Baris anak diverifikasi LANGSUNG di database: 5 baris `stock_take_items` dengan `parent_item_id`, `ref_table='packed_coffee_lots'`, `ref_id` per lot, `strip_code`/`lot_code` benar, `variance` per lot benar (lot terakhir −6).
7. Refresh halaman penuh → `resumeStockTake` merekonstruksi `g.detailed=true` dan `g.lotBreakdown` (5 entri) dari database dengan benar — status "Dirinci" tetap tampil setelah reload.
8. Mengetik ulang Tahap 1 secara manual (75 → 80) → status berubah live jadi "Difference -1", dan **kelima baris anak terbukti terhapus dari database** (dicek langsung, hasil kosong).
9. `printStockCountFormStage2()` dipanggil sungguhan (tab baru terbuka) — header grup, tabel lot, dan tanda PICK FIRST tercetak persis sesuai §4.3.
10. `applyStockGroupDetailedLotsAdjustment` dipanggil langsung terhadap satu lot nyata — **diblokir oleh trigger pembekuan Fase 2** (take masih `counting`) dengan bersih, bukan error kode — ini membuktikan pemanggilan RPC (`set_packed_lot_remaining` dengan parameter `p_operation`/`p_ref_table`/`p_ref_id`/`p_user`) terkirim benar, karena trigger hanya memblokir tulisan yang sah, bukan pemanggilan yang salah bentuk.
11. Take id 14 dibatalkan bersih lewat `cancelStockTake()` asli — dikonfirmasi status `cancelled` di database dan **kelima `remaining_pcs` lot BRAZIL ROSA tetap di angka asli** (2,1,1,4,73) — tidak ada stok nyata yang berubah selama seluruh pengujian.

**Update (Fase 5, 2026-08-27):** langkah terakhir posting yang saat itu belum diuji sekarang SUDAH terverifikasi — finalize sungguhan dijalankan di Fase 5 (izin eksplisit user) memakai `applyFoundItemAdjustment`, yang memanggil `getOrCreatePackedCoffeeRow`/`applyPackedCoffeeManualQtyDelta` pada posisi kode yang sama (status `posted` dahulu, baru penyesuaian ditulis) yang juga dipakai `applyStockGroupDetailedLotsAdjustment`. Ini membuktikan pola posting-setelah-status-berubah itu sendiri bekerja benar di produksi, meski belum lewat `set_packed_lot_remaining` secara spesifik (fungsi Fase 4 ini tetap belum diuji end-to-end, hanya dibuktikan sampai ke server dengan parameter benar — lihat temuan #10 Fase 4). Detail lengkap ada di bagian Fase 5 di bawah.

**Catatan teknis dari sesi ini:** `dispatchEvent(new Event('input'/'change'))` terbukti TIDAK ANDAL di lingkungan Claude in Chrome pada sesi panjang ini (kadang bekerja, kadang diam-diam tidak memicu listener tanpa error) — pengujian yang andal beralih ke pemanggilan fungsi aplikasi secara langsung (`updateVarianceCell`, `saveCountedValue`, `.click()` asli pada tombol) yang terbukti konsisten. Satu tab Chrome juga sempat rusak total (setiap panggilan Supabase gagal dengan error `Headers.forEach` dari sisi ekstensi, bukan kode aplikasi) setelah pemakaian berat/lama — diselesaikan dengan membuka tab baru, bukan debugging lebih lanjut, karena jelas bukan bug di aplikasi.

---

## Fase 5 — Barang temuan

Menangani cacat #2 tanpa membanjiri lembar dengan ratusan baris berstok nol. **SELESAI** (`68ce9dd`, `c1bcf16`).

Baris kosong di lembar cetak diisi tangan (kode + nama + jumlah), lalu diinput lewat tombol **+ Add Found Item** di layar Tahap 1. Tersimpan dengan `is_found_item = true`, `system_qty = 0`.

**Cakupan (dikonfirmasi lewat pembacaan kode, bukan asumsi):** hanya **bulk dan packed** yang bisa "ditemukan" — `buildStockTakeGroups()` hanya memfilter grup bulk/packed yang `systemQty <= 0`; green bean TIDAK PERNAH difilter (selalu satu baris per `green_coffee`, apa pun stoknya), jadi tombol ini tidak relevan untuknya dan sengaja tidak ditawarkan sebagai kategori.

Identitas kopi **wajib dipilih dari daftar** (green_coffee/blend_recipes yang sudah ada) lewat datalist "KODE — NAMA" yang sama dengan `openCustomPackingModal` (`js/packing.js`) — bukan nama bebas, karena ini untuk stok yang sistem sudah kenal tapi hilang jejaknya, bukan mendaftarkan kopi baru.

**Penyesuaian stok BARU terjadi saat Finalize**, bukan saat item ditambahkan — sama seperti baris lain di sheet, supaya opname yang dibatalkan tidak meninggalkan stok yang setengah tersesuaikan. Saat posting:

- **packed** → `getOrCreatePackedCoffeeRow` (helper race-safe yang sudah ada, dipakai `openCustomPackingModal`) lalu `applyPackedCoffeeManualQtyDelta(..., 'stocktake', 'stock_takes', take_id)` — sesuai aturan F6, koreksi selalu jadi lot baru.
- **bulk** → dicari baris identitas (tipe+single/blend id+mesin, tanpa mencocokkan tanggal produksi — temuan tidak punya hari roasting yang nyata) yang sudah ada dulu; kalau ada, `refund_bulk_lot`; kalau belum, `saveData('bulk_roasted_coffee', ...)` baris baru dengan tanggal hari ini dan konteks `mv_*`.
- **green bean tidak diimplementasikan** — di luar cakupan sesuai temuan di atas; teks plan asli menyebut `createGreenCoffeeLot` untuk green, tapi itu tidak pernah dibutuhkan karena green tidak pernah tersembunyi dari sheet.

Baris temuan bertahan lewat refresh: `resumeStockTake` mendeteksinya lewat `is_found_item` (bukan lewat pencocokan `(category, item_name)` ke grup baru seperti baris normal — grup itu tidak akan pernah ada) dan merekonstruksi `foundMeta` (nama kopi, mesin, ukuran) dari kolom snapshot yang sudah ada sejak Fase 0 (`coffee_code`/`machine_name`/`bag_size_g`) plus nama kopi yang diambil dari potongan pertama label — tidak perlu kolom baru.

**Verifikasi live (2026-08-27, akun `khaleed`/`admin2` via Claude in Chrome, take id 16, dengan izin eksplisit user untuk finalize sungguhan):**
1. `node test.js` — tanpa SyntaxError di tiap iterasi.
2. Ditemukan+diperbaiki live: kuantitas bulk (kg desimal) ter-`parseInt` sehingga 5,5 tersimpan sebagai 5 — commit perbaikan `c1bcf16` di-deploy sebelum verifikasi dilanjutkan.
3. Dua item temuan ditambahkan pada kombinasi yang benar-benar belum pernah punya stok (SUMATRA di mesin STRONGHOLD S9X — sebelumnya nol baris bulk/packed sama sekali di mesin itu): bulk 5,5kg dan packed 250g/3 kantong.
4. Baris tampil benar di sheet: tag 🔍, tanpa panah rincian, status "Difference +5.5"/"+3".
5. Refresh penuh → `resumeStockTake` merekonstruksi kedua `foundMeta` dengan benar (nama, mesin, ukuran).
6. **Finalize sungguhan dijalankan** (izin eksplisit diminta & diberikan user, karena akan menyesuaikan stok nyata) — diverifikasi langsung di database:
   - `packed_coffee` baris baru (id 206) dengan `quantity=3`, `packed_coffee_lots` baris baru dengan `lot_code`/`strip_code` asli, `remaining_pcs=3`.
   - `bulk_roasted_coffee` baris baru (id 184) dengan `bulk_available=5.50`; `bulk_stock_movements` mencatatnya dengan `operation='stocktake'`, `ref_table='stock_takes'`, `ref_id=16`, `performed_by='khaleed'` — ledger benar sejak baris pertama.
7. **Dibersihkan sepenuhnya setelah verifikasi**: kedua lot dikonsumsi ke 0 lewat RPC asli (`consume_packed_lot`/`consume_bulk_lot`), lalu baris `packed_coffee`/`packed_coffee_lots`/`bulk_roasted_coffee`/kedua ledger dihapus — dikonfirmasi stok SUMATRA asli (mesin GIESEN W15A) tidak berubah sama sekali. Riwayat `stock_takes` id 16 (`posted`) dan `stock_take_items`-nya dibiarkan sebagai catatan sesuai §5 (hanya efek stoknya yang dibalik, bukan riwayatnya).

---

## Fase 6 — Tinjauan selisih & posting — SELESAI (`4980ca7`)

**File:** `js/app.js` (`collectStockTakeFinalizeData`, `openStockTakeReviewModal`, `executeStockTakePosting`, menggantikan `finalizeStockTake` lama), `js/packing.js` (`applyPackedCoffeeManualQtyDelta`).

**Layar tinjauan — DONE.** `confirm()` bawaan diganti modal "Review & Post": tiga kotak ringkasan (dihitung/belum dihitung/selisih), peringatan tegas kalau ada yang belum dihitung, tabel baris selisih (kode, item, sistem, aktual, selisih) — termasuk baris hasil rincian lot per-strip-code untuk grup yang sudah dirinci **bahkan saat totalnya kebetulan cocok dengan sistem** (cacat #6: lot bisa bergeser satu sama lain meski totalnya sama, jadi tetap perlu tulis, dan tinjauan harus menunjukkannya). Bukan gerbang persetujuan — tombol Posting langsung menjalankan `executeStockTakePosting()`.

**Urutan posting — DONE, sesuai spesifikasi:** `counting` → `posting` → tulis penyesuaian satu per satu (setiap baris/lot yang berhasil langsung ditandai `posted_at`) → `posted` + `stock_takes.posted_at`. Dipisah dari layar tinjauan lewat `collectStockTakeFinalizeData()` — fungsi baca-saja yang dipakai baik untuk merender modal maupun (dipanggil ulang segar) untuk benar-benar memposting, supaya keduanya tidak pernah berbeda pendapat soal "apa yang akan terjadi".

**Bila gagal di tengah — DONE:** status dikembalikan ke `counting`, bukan tertahan di `posting`. Baris yang sudah berhasil tetap memegang `posted_at`, dicek lewat fetch segar ke `stock_take_items` (bukan state di memori) sehingga aman dipakai bahkan setelah reload di tengah pemulihan. Retry melewati baris yang sudah `posted_at`, tidak menulis ulang.

**Temuan penting saat menyiapkan verifikasi (bukan asumsi — diuji langsung ke database):** beberapa RPC yang sudah lama dipakai (`refund_bulk_lot`, `set_packed_lot_remaining`, `consume_bulk_lot`) mengembalikan `null`/`0` secara diam-diam untuk id yang tidak ada — **bukan error Postgres**. Kode deteksi-kegagalan yang sebelumnya hanya mengecek `{error}` tidak akan pernah menangkap ini. Diperbaiki di `applyStockGroupAdjustmentToLots`, `applyStockGroupDetailedLotsAdjustment`, `applyFoundItemAdjustment` (kini memeriksa nilai balik RPC, bukan hanya error) dan `applyPackedCoffeeManualQtyDelta` (kini mengembalikan `true`/`false` — pemanggil lain yang sudah ada tidak terpengaruh karena tidak pernah memeriksa nilai baliknya).

**Verifikasi live (2026-08-27, akun `khaleed`/`admin2` via Claude in Chrome, take id 17):**
1. `node test.js` — tanpa SyntaxError.
2. Take dibuat (136-137 grup), dua "barang temuan" bulk ditambahkan: **YAMAN di STRONGHOLD S9X** (2,2kg, kombinasi baru, akan berhasil) dan **satu grup rusak sengaja** (`foundMeta.coffeeName` diarahkan ke nama kopi yang tidak ada sama sekali di sistem, ditambahkan langsung ke memori untuk memaksa kegagalan resolusi identitas yang terkendali — tidak menyentuh baris/lot nyata mana pun).
3. Modal Review & Post dibuka — diverifikasi langsung dari DOM: ringkasan "2 dihitung · 135 belum dihitung · 2 selisih", peringatan tampil, kedua baris selisih tercantum benar (+2,2 / +1,5).
4. Tombol Posting diklik — **gagal di tengah sesuai rencana**: alert "Posting failed partway through..." tampil persis seperti dirancang.
5. Diverifikasi ke database: `stock_takes.status` kembali `counting`; baris `bulk_roasted_coffee` YAMAN (item pertama) **berhasil dibuat** dengan `bulk_available=2.20`; baris kopi rusak (item kedua) **tidak pernah dibuat**; `stock_take_items` milik YAMAN sudah punya `posted_at`.
6. Item rusak dihapus dari sheet, Posting diklik ulang — berhasil ("Stock take finalized and stock adjusted.").
7. **Dibuktikan tidak menggandakan**: `bulk_stock_movements` untuk baris YAMAN hanya punya **satu** baris ledger (dari percobaan pertama, bukan dua), `bulk_available` tetap 2,20 (bukan 4,40). `stock_takes` akhirnya `posted` dengan `total_items=136`, `variance_items=1`, `counted_items=1`, `skipped_items=135` — semuanya konsisten dengan sheet setelah item rusak dihapus.
8. Dibersihkan: baris bulk YAMAN uji dan ledger-nya dihapus lewat `consume_bulk_lot` + delete langsung; riwayat `stock_takes` id 17 (`posted`) dibiarkan sebagai catatan sesuai §5.

---

## Fase 7 — Laporan & akurasi

**File:** `js/app.js` (`loadStockOpnameReport`, `viewStockTake`)

- Riwayat menampilkan status, jumlah dihitung vs dilewati.
- **Akurasi** per opname: `baris cocok ÷ baris dihitung × 100%`. Hanya `counted = true` yang dihitung — inilah gunanya kolom itu.
- Tren akurasi antar bulan.
- Detail opname menampilkan strip code untuk baris lot, menandai baris temuan, dan membedakan grup yang dirinci dari yang tidak.

**Verifikasi:** bandingkan angka akurasi dengan hitungan manual dari `stock_take_items` pada satu opname.

---

## Lampiran — Urutan pengerjaan

Urutan ini bukan selera; ada ketergantungan nyata:

- **Fase 0** wajib pertama — semua fase memakai kolomnya.
- **Fase 1 sebelum 2** — pembekuan bergantung pada `status` yang diperkenalkan Fase 1.
- **Fase 3 sebelum 4** — Tahap 2 membutuhkan pengelompokan dan layar Tahap 1 yang sudah benar.
- **Fase 4 dan 5 sebelum 6** — keduanya mengubah bentuk baris yang ditinjau dan diposting.
- **Fase 7 terakhir** — melaporkan apa yang sudah ada.

Bila waktu terbatas: **Fase 0 → 1 → 3** sudah menghilangkan cacat terburuk (catatan palsu "sudah dihitung" dan penggabungan lintas mesin). Sisanya penyempurnaan.

## Lampiran — Daftar periksa tiap fase

Dari `CLAUDE.md`; setiap butir pernah menyebabkan regresi nyata di repo ini.

- [ ] `node test.js` lulus
- [ ] Naikkan `?v=` di `index.html` untuk **setiap** file JS yang berubah
- [ ] Perubahan skema disalin ke `database/supabase_schema.sql`, termasuk array RLS
- [ ] `NOTIFY pgrst, 'reload schema';` setelah DDL (kadang perlu dua kali)
- [ ] Mutasi baru memeriksa `error` dan menampilkannya — jangan gagal diam-diam
- [ ] Teks baru ditambahkan ke `en` **dan** `ar` di `js/translations.js`
- [ ] Warna lewat CSS custom property, jangan hardcode
- [ ] Setelah push, tunggu Vercel "Ready", hard refresh, verifikasi live
- [ ] Jalankan kueri invarian ledger setelah fase yang menyentuh stok

## Lampiran — Jebakan khusus repo ini

- **`CREATE OR REPLACE FUNCTION` dengan daftar parameter yang berubah tidak mengganti fungsi lama** — Postgres membuat overload kedua dan semua pemanggil lama gagal. Wajib `DROP FUNCTION` tanda tangan lama di migrasi yang sama. (Pernah menyebabkan gangguan produksi, lihat `STOCK_LEDGER_PLAN.md`.)
- **Fungsi `LANGUAGE sql` divalidasi saat `CREATE`**, tidak seperti `plpgsql`. `ALTER TABLE` yang menambah kolom yang dirujuk fungsi harus dijalankan **sebelum** `CREATE FUNCTION` di skrip yang sama. (Juga pernah terjadi, lihat `STOCK_LEDGER_PLAN.md` Fase 6.)
- **`packed_coffee.quantity` dan `green_coffee.stock_kg` adalah kolom turunan** dari lotnya. Menulis langsung tampak berhasil lalu dikembalikan diam-diam. Sudah menyebabkan tiga bug terpisah.
- **`saveData(table, record)` mengirim seluruh objek** — mengoper baris utuh akan mengirim ulang semua kolom, termasuk konteks `mv_*` yang basi.
- **`js/app_backup.js` bukan bagian aplikasi** — pencarian teks akan menemukannya, abaikan.
- **Supabase MCP sering tidak tersambung.** Bila `mcp__supabase__*` tidak tersedia, minta user menjalankan migrasi lewat SQL Editor, lalu verifikasi lewat konsol Chrome memakai `window.supabaseClient` (RLS permisif, jadi bisa baca/tulis tanpa sesi login).
