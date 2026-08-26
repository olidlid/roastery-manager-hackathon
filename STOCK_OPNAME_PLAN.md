# Stock Opname Bulanan — Rencana Pengembangan

**Status:** Fase 0 selesai (`b0d2316`), Fase 1 selesai (`0de5d96`, diverifikasi live lewat UI produksi sungguhan). Menunggu persetujuan lanjut ke Fase 2.
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

## Fase 2 — Pembekuan transaksi (dipaksa database)

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

---

## Fase 3 — Tahap 1: pengelompokan, layar input, lembar cetak

**File:** `js/app.js` (`buildStockTakeGroups`, `startStockTake`, `printStockCountForm`)

**Pengelompokan (cacat #5):**

- **Packed** → kunci grup menjadi `(nama kopi, bag_size_g, machine_id)`. Sekarang `nama|size` tanpa mesin (`js/app.js:3434`), padahal stok packed dipisah per mesin dan FIFO/dispatch bekerja per mesin.
- **Green bean** → tetap satu baris per `green_coffee`.
- **Bulk** → tetap digabung per `coffee_name` (keputusan: bulk cukup per item).

Tiap grup membawa `coffee_code` untuk kolom Kode.

**Layar input** dan **lembar cetak** dibangun sesuai §4.1 dan §4.2.

**Toleransi selisih (belum diputuskan — asumsi yang dipakai):** packed dan bulk dalam satuan utuh, jadi cocok berarti persis sama. Green bean dalam kg tidak akan pernah pas sampai desimal terakhir, jadi dipakai **toleransi 1% dari angka sistem, minimum 0,1 kg**. Angka ini ditulis sebagai konstanta bernama di satu tempat agar mudah diubah, dan **wajib dikonfirmasi ke user** sebelum fase ini dianggap selesai.

**Verifikasi:** cetak lembar Tahap 1, pastikan kolom Kode terisi kode kopi asli dan baris kosong tersedia di bawah. Di layar input, isi satu angka yang cocok dan satu yang selisih — status kedua baris harus berbeda dan benar.

---

## Fase 4 — Tahap 2: rincian per lot (packed coffee saja)

**File:** `js/app.js`, `js/packing.js` (untuk helper lot bila perlu)

- **Lembar cetak Tahap 2** sesuai §4.3 — hanya grup selisih, header grup, tabel lot dengan tanda `ambil dulu` pada lot terdepan FIFO.
- **Modal input** sesuai §4.4 — semua grup dalam satu modal, jumlah lot dihitung langsung, aturan "rincian lot menang" bila bentrok.
- **Tiga jalan masuk** sesuai §4.5.
- Baris lot disimpan sebagai `stock_take_items` dengan `parent_item_id` menunjuk baris grupnya, `ref_table = 'packed_coffee_lots'`, `ref_id = lot.id`, plus salinan `strip_code`/`lot_code`.

**Posting menjadi tepat (cacat #6):** untuk grup yang sudah dirinci, penyesuaian ditulis per lot lewat
`set_packed_lot_remaining(lot_id, hasil_hitung, 'stocktake', 'stock_takes', take_id)` — tidak ada lagi tebakan. Untuk grup yang tidak dirinci, tetap memakai pembagian yang ada sekarang (surplus ke baris pertama, kekurangan FIFO).

**Verifikasi:** buat dua lot uji ber-strip-code berbeda untuk kopi yang sama, isi Tahap 1 dengan angka yang selisih, rinci per lot, simpan, posting. Hanya lot yang benar-benar selisih yang berubah, dan `packed_stock_movements` mencatatnya dengan `ref_id` opname yang benar.

---

## Fase 5 — Barang temuan

Menangani cacat #2 tanpa membanjiri lembar dengan ratusan baris berstok nol.

Baris kosong di lembar cetak diisi tangan (kode + nama + jumlah), lalu diinput lewat tombol **+ Tambah temuan** di layar Tahap 1. Tersimpan dengan `is_found_item = true`, `system_qty = 0`.

Saat posting:

- **packed** → `applyPackedCoffeeManualQtyDelta(..., 'stocktake', 'stock_takes', take_id)` — sesuai aturan F6 (`STOCK_LEDGER_PLAN.md` Fase 4), koreksi selalu jadi lot baru, tidak menimpa riwayat lot lama.
- **green** → `createGreenCoffeeLot` dengan supplier `Stock Take Adjustment` (pola yang sudah dipakai kode sekarang).
- **bulk** → `refund_bulk_lot` bila barisnya ada, atau `saveData('bulk_roasted_coffee', ...)` dengan konteks `mv_*` bila belum ada.

**Verifikasi:** tambahkan satu temuan untuk kopi yang stok sistemnya 0, posting, pastikan lot baru terbentuk dengan jumlah benar dan tercatat di ledger.

---

## Fase 6 — Tinjauan selisih & posting

**File:** `js/app.js` (`finalizeStockTake`)

Sebelum tombol final, tampilkan layar tinjauan:

- Ringkasan: berapa item dihitung, berapa belum, berapa yang selisih.
- Daftar **hanya baris yang selisih**, dengan angka sistem, hasil hitung, dan selisihnya. Baris hasil rincian lot ditampilkan dengan strip code-nya.
- Peringatan tegas bila ada yang belum dihitung: *"12 item belum dihitung dan tidak akan disesuaikan."*
- Baru kemudian tombol **Posting**.

Ini bukan gerbang persetujuan (sesuai keputusan) — hanya memastikan yang menekan tombol melihat dampaknya. `confirm()` bawaan browser di `js/app.js:3697` diganti modal aplikasi.

Urutan posting: `counting` → `posting` → tulis penyesuaian satu per satu (tandai `posted_at` di tiap baris yang berhasil) → `posted` + `stock_takes.posted_at`.

**Bila ada penyesuaian gagal di tengah:** kembalikan status ke **`counting`** — bukan dibiarkan di `posting`. Status aman adalah status terkunci. Baris yang sudah berhasil tetap memegang `posted_at`-nya, sehingga posting ulang melanjutkan dari titik terhenti tanpa menulis dua kali. Alasan lengkapnya di §5.2.

**Verifikasi:**
1. Opname dengan campuran item cocok, selisih, dirinci, dan belum dihitung. Hanya yang `counted = true` **dan** selisih yang boleh mengubah stok.
2. **Uji posting gagal**: paksa satu penyesuaian gagal di tengah (misal dengan lot id yang tidak ada), pastikan status kembali `counting`, stok tetap terkunci, dan posting ulang tidak menggandakan penyesuaian yang sudah tersimpan. Jalankan kueri invarian ledger sesudahnya.

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
