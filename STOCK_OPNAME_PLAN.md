# Stock Opname Bulanan — Rencana Pengembangan

**Status:** Rancangan, belum dikerjakan
**Tanggal:** 2026-08-23
**Tujuan:** Mengubah fitur Stock Opname yang ada dari "form penyesuaian stok" menjadi proses penghitungan fisik bulanan yang hasilnya bisa dipercaya.

Rencana ini ditulis agar bisa dikerjakan tanpa percakapan yang menghasilkannya. Setiap temuan di bawah berasal dari pembacaan kode yang ada (`js/app.js:3379-3760`, `database/supabase_schema.sql:483-508`), bukan asumsi.

---

## Keputusan desain (sudah disepakati)

| Keputusan | Pilihan | Konsekuensi |
|---|---|---|
| Cut-off | **Bekukan transaksi** | Selama opname aktif, semua perubahan stok ditolak di level database. Operasional berhenti sementara. |
| Granularitas | **Campuran** | Packed coffee dihitung per lot (strip code); green bean & bulk dihitung per item. |
| Persetujuan | **Langsung posting** | Tidak ada alur approval. Tetap ada layar tinjauan selisih sebelum tombol final — itu konfirmasi, bukan gerbang persetujuan. |
| Nilai rupiah | **Belum sekarang** | Fokus jumlah fisik. `green_coffee_lots.purchase_price_per_kg` sudah tersimpan, bisa ditambahkan nanti tanpa bongkar ulang. |

---

## 1. Mengapa ini perlu dibenahi

Fitur yang ada sekarang menghasilkan catatan yang **terlihat** seperti hasil opname, tetapi belum tentu mencerminkan penghitungan yang benar-benar terjadi. Tiga hal yang paling berbahaya:

**a. Kolom kosong dicatat sebagai "sudah dihitung dan cocok".**
Di `js/app.js:3681`: `if (isNaN(actual)) actual = g.systemQty;` — item yang tidak disentuh sama sekali tersimpan ke `stock_take_items` dengan `variance = 0`. Riwayat opname jadi menyatakan barang itu diperiksa dan cocok, padahal tidak pernah dilihat. Ini bukan sekadar kurang fitur; ini catatan yang keliru.

**b. Angka sistem sudah terisi di kolom hitungan.**
Di `js/app.js:3534`: `value="${g.systemQty}"`. Dalam praktik penghitungan gudang, ini membuat orang menghitung sampai angka yang tertera lalu berhenti. Standarnya adalah *blind count* — penghitung tidak melihat angka sistem.

**c. Barang berstok nol tidak muncul.**
Di `js/app.js:3418` dan `3440`: `if (systemQty <= 0) return;`. Kalau sistem mengira stok 0 padahal fisiknya ada di rak, barang itu tidak akan pernah muncul untuk dihitung. Selisih ke arah ini permanen tak terdeteksi.

Ketiganya membuat opname bisa "bersih" tanpa ada yang benar-benar diperiksa.

**Celah lain yang juga ditangani rencana ini:**

| # | Celah | Lokasi |
|---|---|---|
| 4 | Tidak ada cut-off — angka sistem dibaca saat tombol diklik, transaksi selama penghitungan mencemari selisih | `buildStockTakeGroups()` |
| 5 | Hitungan hilang bila browser di-refresh (disimpan di variabel JS `currentStockTakeGroups`) | `js/app.js:3514` |
| 6 | Packed dihitung agregat per nama+size, padahal gudang tersusun per lot ber-strip-code — saat posting, sistem menebak lot mana yang selisih | `js/app.js:3429-3450` |
| 7 | Tidak ada layar tinjauan selisih sebelum stok berubah | `finalizeStockTake()` |
| 8 | Satu `performed_by` untuk seluruh opname, tidak ada jejak siapa menghitung baris mana | `stock_takes` |

**Yang sudah benar dan tidak perlu diubah:** sejak `STOCK_LEDGER_PLAN.md` Fase 0–6, penyesuaian dari opname sudah masuk ke ledger per lot dengan operasi `stocktake` dan referensi ke `stock_takes.id`. Fondasi pencatatannya sudah kuat — yang kurang adalah proses penghitungannya.

---

## 2. Bentuk akhir yang dituju

```
Buka opname                → status 'counting', transaksi DIKUNCI
   ↓
Hitung (bisa berhari-hari, banyak orang, aman di-refresh)
   ↓
Tinjau selisih             → lihat apa yang akan berubah
   ↓
Posting                    → status 'posting', kunci dibuka sesaat,
                             penyesuaian ditulis lewat RPC ber-ledger
   ↓                       → status 'posted', kunci dibuka penuh
Laporan & akurasi
```

Pembatalan di tengah jalan (`status = 'cancelled'`) juga membuka kunci tanpa menyentuh stok sama sekali.

---

## Fase 0 — Fondasi skema

**File baru:** `database/v2_stock_opname_migration.sql`

### `stock_takes`

```sql
ALTER TABLE public.stock_takes
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'posted',
    ADD COLUMN IF NOT EXISTS started_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS started_by  TEXT,
    ADD COLUMN IF NOT EXISTS posted_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS counted_items  INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS skipped_items  INTEGER DEFAULT 0;
```

`DEFAULT 'posted'` disengaja: semua baris opname lama sudah selesai diposting, jadi tidak boleh ikut membekukan sistem saat migrasi dijalankan.

Nilai status: `counting` · `posting` · `posted` · `cancelled`.

**Hanya boleh ada satu opname aktif:**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS stock_takes_one_active_uniq
ON public.stock_takes ((1))
WHERE status IN ('counting', 'posting');
```

Indeks unik pada konstanta `1` dengan predikat — cara baku memaksa "maksimal satu baris memenuhi syarat ini". Tanpa ini, dua orang bisa membuka opname bersamaan dan saling menimpa.

### `stock_take_items`

```sql
ALTER TABLE public.stock_take_items
    ADD COLUMN IF NOT EXISTS counted      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS counted_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS counted_by   TEXT,
    ADD COLUMN IF NOT EXISTS is_found_item BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ref_table    TEXT,
    ADD COLUMN IF NOT EXISTS ref_id       INTEGER,
    ADD COLUMN IF NOT EXISTS strip_code   TEXT,
    ADD COLUMN IF NOT EXISTS lot_code     TEXT,
    ADD COLUMN IF NOT EXISTS machine_name TEXT,
    ADD COLUMN IF NOT EXISTS bag_size_g   NUMERIC;
```

`counted` adalah inti perbaikan (a): membedakan **"dihitung, hasilnya sama"** dari **"belum dihitung"**. Keduanya menghasilkan `variance = 0`, tetapi artinya jauh berbeda dan selama ini tidak terbedakan.

`ref_table` + `ref_id` menunjuk ke sumber baris: `packed_coffee_lots` (per lot), `green_coffee`, atau nama bulk. `strip_code`/`lot_code`/`machine_name`/`bag_size_g` adalah salinan — supaya lembar opname lama tetap terbaca meski lotnya sudah habis dan terhapus, pola yang sama dipakai `packed_stock_movements`.

**Baris lama:** `counted` akan bernilai `FALSE` untuk semua data historis, padahal dulu memang tersimpan sebagai sudah-dihitung. Ini tidak diperbaiki dengan backfill — data lama memang tidak bisa dibedakan mana yang benar-benar dihitung dan mana yang kolom kosong. Laporan harus memperlakukan opname sebelum tanggal migrasi sebagai "granularitas lama".

### RLS

Tambahkan tidak ada tabel baru di fase ini, jadi tidak ada perubahan pada blok RLS `supabase_schema.sql`.

**Verifikasi:** jalankan migrasi, pastikan `SELECT status, COUNT(*) FROM stock_takes GROUP BY status` menunjukkan semua baris lama = `posted`, dan mencoba membuat dua baris `counting` gagal karena indeks unik.

---

## Fase 1 — Siklus hidup & penyimpanan bertahap

**File:** `js/app.js`

Saat ini `startStockTake()` hanya menyiapkan array di memori. Diubah menjadi:

1. `startStockTake()` membuat baris `stock_takes` berstatus `counting` **lebih dulu**, lalu menulis seluruh baris `stock_take_items` dengan `counted = false` dan `actual_qty = NULL`.
2. Setiap kali penghitung mengisi satu angka, baris itu langsung disimpan (`counted = true`, `counted_at`, `counted_by`).
3. Membuka kembali halaman saat ada opname berstatus `counting` akan memuat ulang lembar itu, bukan memulai yang baru.
4. `cancelStockTake()` mengubah status ke `cancelled` (tidak menghapus), sehingga percobaan yang dibatalkan tetap terlihat di riwayat.

Penyimpanan per baris ini yang membuat opname bisa dikerjakan berjam-jam oleh beberapa orang tanpa risiko kehilangan hitungan.

**Verifikasi:** buka opname, isi beberapa angka, refresh browser — hitungan yang sudah masuk harus tetap ada dan sisanya masih kosong.

---

## Fase 2 — Blind count

**File:** `js/app.js` (`startStockTake` / render lembar)

- Kolom **Sistem** disembunyikan selama status `counting`. Muncul hanya di layar tinjauan selisih (Fase 6).
- Input **dikosongkan**, bukan diisi `systemQty`. Placeholder `—`.
- Setiap baris punya keadaan jelas: *belum dihitung* (abu-abu) / *sudah dihitung* (normal).
- Indikator kemajuan di atas lembar: `45 / 210 item dihitung`.
- Baris yang sengaja dilewati bisa ditandai **Lewati** dengan alasan — tersimpan sebagai `counted = false` dan **tidak menyesuaikan stok**.
- `finalizeStockTake()` tidak lagi mengubah kolom kosong menjadi "cocok". Item `counted = false` dilewati sepenuhnya saat posting.

Ini memperbaiki temuan (a) dan (b) sekaligus, dan merupakan bagian terpenting dari seluruh rencana.

**Verifikasi:** buka opname, isi hanya sebagian, posting. Item yang tidak diisi harus tidak berubah stoknya **dan** tercatat di `stock_take_items` sebagai `counted = false`, bukan `variance = 0`.

---

## Fase 3 — Pembekuan transaksi (dipaksa database)

**File:** `database/v2_stock_opname_freeze_migration.sql`

Pelajaran yang sudah dibayar mahal di `STOCK_LEDGER_PLAN.md`: **kalau sebuah aturan penting, database yang harus memaksakannya — bukan disiplin aplikasi.** Menyembunyikan tombol saja tidak cukup.

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

Dipasang sebagai `BEFORE INSERT OR UPDATE OR DELETE` pada tiga tabel: `packed_coffee_lots`, `green_coffee_lots`, `bulk_roasted_coffee`.

**Nama trigger harus mengurut lebih dulu** dari trigger ledger yang sudah ada (`trg_log_packed_stock_movement`, `trg_log_bulk_stock_movement`) — Postgres menjalankan trigger dengan waktu yang sama secara alfabetis. Gunakan awalan yang pasti lebih awal, misal `trg_aa_stock_take_freeze`.

**Cara penyesuaian opname sendiri bisa lolos:** saat posting, status diubah `counting` → `posting`. Penjaga hanya memblokir `counting`, sehingga penyesuaian bisa ditulis, lalu status menjadi `posted`.

> **Kompromi yang disadari:** selama jendela `posting` (hitungan detik) kunci terbuka untuk semua orang, bukan hanya untuk proses posting. Alternatifnya adalah menandai setiap operasi dengan konteks `mv_operation = 'stocktake'` — tetapi `green_coffee_lots` **belum punya kolom `mv_*` maupun ledger** (hanya packed dan bulk yang punya, lihat `supabase_schema.sql` Fase 2 & 6), sehingga cara itu tidak bisa dipakai seragam tanpa terlebih dulu membangun ledger green bean. Jendela sesaat dinilai memadai; catat sebagai utang teknis, bukan celah tersembunyi.

**Sisi aplikasi (lapisan lunak, bukan pengaman utama):**
- Saat memuat bagian mana pun yang mengubah stok, cek apakah ada opname `counting`. Bila ada, tampilkan spanduk peringatan dan nonaktifkan tombol terkait.
- Tambahkan penanganan error terpusat: bila pesan error mengandung teks penjaga di atas, tampilkan modal berbahasa manusia, bukan pesan Postgres mentah.

**Permission baru:** tambahkan `reports_stockopname_perform` di `MOCK_DB.custom_roles` (`js/app.js`) dan daftar permission Settings (`js/settings.js:392`). Memulai opname membekukan pekerjaan semua orang — itu tidak boleh bisa dilakukan siapa saja yang kebetulan bisa melihat tab ini. Berikan ke Developer, Admin, dan Production Leader.

**Verifikasi:**
1. Buka opname → coba dispatch / packing / roasting dari tab lain. Harus ditolak dengan pesan yang jelas, dan stok tidak berubah.
2. Posting opname → operasi yang sama harus berhasil lagi.
3. Batalkan opname → juga harus membuka kunci.
4. Jalankan kueri invarian ledger (`STOCK_LEDGER_PLAN.md` Lampiran) sesudahnya: 0 ketidakcocokan.

---

## Fase 4 — Packed dihitung per lot

**File:** `js/app.js` (`buildStockTakeGroups`, `applyStockGroupAdjustmentToLots`)

Sekarang packed dikelompokkan `nama|size` lalu selisih dibagikan ke baris `packed_coffee` dengan konvensi (surplus ke baris pertama, kekurangan FIFO). Gudang Anda menyimpan barang per rak ber-strip-code, jadi hitungan sebenarnya sudah per lot — informasi itu hilang saat digabung.

Perubahan: satu baris lembar = satu `packed_coffee_lots` dengan `remaining_pcs > 0`, menampilkan strip code, nama kopi, size, mesin, tanggal packing.

Posting menjadi jauh lebih tepat: `set_packed_lot_remaining(lot_id, hasil_hitung, 'stocktake', 'stock_takes', take_id)` per lot. Tidak ada lagi tebakan.

**Green bean & bulk tetap per item** sesuai keputusan.

> **Catatan untuk bulk:** baris `bulk_roasted_coffee` sebenarnya sudah per (kopi, mesin, tanggal roasting) dan fisiknya memang disimpan terpisah per hari roasting. Menghitung agregat per nama kopi berarti penghitung harus menimbang semua wadah lalu menjumlahkannya, dan saat ada selisih sistem tetap harus memilih baris mana yang menyerap. Bila nanti terasa mengganggu, naikkan bulk ke per-baris — perubahannya kecil karena strukturnya sudah mendukung.

**Verifikasi:** buat dua lot uji ber-strip-code berbeda untuk kopi yang sama, hitung salah satunya berbeda, posting. Pastikan hanya lot itu yang berubah dan `packed_stock_movements` mencatatnya dengan `ref_id` opname yang benar.

---

## Fase 5 — Barang temuan (tidak ada di lembar)

Menangani temuan (c) tanpa membanjiri lembar dengan ratusan baris berstok nol.

Tombol **+ Tambah temuan** pada lembar opname: pilih kopi / size / mesin (atau ketik bebas), masukkan jumlah. Tersimpan dengan `is_found_item = true`, `system_qty = 0`.

Saat posting:
- **packed** → buat lot baru lewat `applyPackedCoffeeManualQtyDelta(..., 'stocktake', 'stock_takes', take_id)` — sesuai aturan F6 (`STOCK_LEDGER_PLAN.md` Fase 4), koreksi selalu menjadi lot baru, tidak menimpa riwayat lot lama.
- **green** → `createGreenCoffeeLot` dengan supplier `Stock Take Adjustment` (pola yang sudah dipakai kode sekarang).
- **bulk** → `refund_bulk_lot` bila barisnya ada, atau buat baris `bulk_roasted_coffee` baru bila belum ada.

**Verifikasi:** tambahkan satu temuan untuk kopi yang stok sistemnya 0, posting, pastikan lot baru terbentuk dengan jumlah benar dan tercatat di ledger.

---

## Fase 6 — Tinjauan selisih & posting

**File:** `js/app.js` (`finalizeStockTake`)

Sebelum tombol final, tampilkan layar tinjauan:
- Ringkasan: berapa item dihitung, berapa belum, berapa yang selisih.
- Daftar **hanya baris yang selisih**, dengan angka sistem, hasil hitung, dan selisihnya.
- Peringatan tegas bila ada item belum dihitung: *"12 item belum dihitung dan tidak akan disesuaikan."*
- Baru kemudian tombol **Posting**.

Ini bukan gerbang persetujuan (sesuai keputusan) — hanya memastikan yang menekan tombol melihat dampaknya lebih dulu. `confirm()` bawaan browser di `js/app.js:3697` diganti dengan modal aplikasi agar konsisten.

Urutan posting: `counting` → `posting` → tulis semua penyesuaian → `posted` + `posted_at`. Bila ada penyesuaian gagal di tengah, status **tetap** `posting` dan ditampilkan sebagai perlu perhatian — jangan diam-diam ditandai selesai.

**Verifikasi:** opname dengan campuran item cocok, selisih, dan belum dihitung. Pastikan hanya yang selisih **dan** `counted = true` yang mengubah stok.

---

## Fase 7 — Laporan & akurasi

**File:** `js/app.js` (`loadStockOpnameReport`, `viewStockTake`)

- Riwayat menampilkan status (`counting` / `posted` / `cancelled`), jumlah dihitung vs dilewati.
- **Akurasi** per opname: `baris cocok ÷ baris dihitung × 100%`. Hanya baris `counted = true` yang dihitung — inilah gunanya kolom itu.
- Tren bulanan akurasi, supaya terlihat apakah pengelolaan gudang membaik atau memburuk.
- Detail opname menampilkan strip code untuk baris packed, dan menandai baris temuan.

**Verifikasi:** bandingkan angka akurasi dengan hitungan manual dari `stock_take_items` pada satu opname.

---

## Lampiran — Urutan pengerjaan

Urutan ini bukan selera; ada ketergantungan nyata:

- **Fase 0** wajib pertama — semua fase lain memakai kolomnya.
- **Fase 1 sebelum 2** — blind count tanpa penyimpanan bertahap berbahaya: sekali refresh, hitungan hilang dan tidak bisa dipulihkan dari angka sistem karena memang sengaja disembunyikan.
- **Fase 3 setelah 1** — pembekuan bergantung pada status yang diperkenalkan Fase 1.
- **Fase 4 dan 5 sebelum 6** — keduanya mengubah bentuk baris yang harus ditinjau dan diposting.
- **Fase 7 terakhir** — melaporkan apa yang sudah ada.

Fase 2 (blind count) adalah yang paling berdampak pada kebenaran data. Bila waktunya terbatas, Fase 0 → 1 → 2 saja sudah menghilangkan cacat terburuk.

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
- **Fungsi `LANGUAGE sql` divalidasi saat `CREATE`**, tidak seperti `plpgsql`. `ALTER TABLE` yang menambah kolom yang dirujuk fungsi harus dijalankan **sebelum** `CREATE FUNCTION` di skrip yang sama.
- **`packed_coffee.quantity` dan `green_coffee.stock_kg` adalah kolom turunan** dari lotnya. Menulis langsung tampak berhasil lalu dikembalikan diam-diam. Sudah menyebabkan tiga bug terpisah.
- **`saveData(table, record)` mengirim seluruh objek** — mengoper baris utuh akan mengirim ulang semua kolom, termasuk konteks `mv_*` yang basi.
- **`js/app_backup.js` bukan bagian aplikasi** — pencarian teks akan menemukannya, abaikan.
