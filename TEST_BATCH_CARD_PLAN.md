# Kartu Test Batch di Ready to Pack — Rencana Pengerjaan

**Status:** Rancangan disetujui (mockup sudah final), belum dikerjakan
**Tanggal:** 2026-08-29
**Tujuan:** Batch log berstatus Test mendapat kartu sendiri yang tersemat di atas grid Ready to Pack sampai disetujui, dengan dua jalur approve — biasa dan "gabung ke bulk pilihan".

Rencana ini ditulis agar bisa dikerjakan tanpa percakapan yang menghasilkannya. Setiap anchor file/baris sudah diverifikasi terhadap kode yang ada per 2026-08-29.

---

## 1. Keputusan desain (sudah disepakati)

| Hal | Keputusan |
|---|---|
| Sumber data kartu | `roast_batches` dengan `roast_type='Test'` dan `qc_status='Pending'` — **bukan** dari `bulk_roasted_coffee` |
| Posisi | Tersemat di atas grid Ready to Pack, di atas kartu bulk manapun |
| Warna | Biru (`#1d4ed8` terang / `#60a5fa` gelap) — identitas baru, sengaja beda dari amber post-blend supaya dua jenis kartu tidak tertukar |
| Isi kartu | Nama kopi, mesin, badge "Test · Pending", **catatan (notes) di bawah badge**, lalu batch code/roast date/output/depreciation |
| Tombol Pack/Sticker | Tidak ada di kartu ini sama sekali — terbukti dari kode, bukan sekadar disembunyikan (lihat §2) |
| Tombol approve | **Dua tombol**: **Approve** (perilaku lama, pooling otomatis) dan **Approve & Combine** (baru, buka modal pilih target) |
| Modal Combine | Daftar lot bulk **kopi yang sama saja**, post-blend/repack dikecualikan. Lot dengan mesin+tanggal yang sama dengan batch (kandidat pooling otomatis) ditandai "sama mesin" |
| Modal Combine kosong | Tombol **tetap selalu ada**; kalau tidak ada kandidat, modal tetap terbuka dengan pesan kosong + saran pakai Approve biasa, hanya tombol Tutup |
| Permission | `roasting_batch_approve` **diperluas** ke Roaster (bukan permission baru) — dipakai bersama oleh tombol Approve di kartu ini maupun yang sudah ada di halaman Batch Log |

---

## 2. Hasil pengecekan yang mengubah rencana

**Batch Test yang belum disetujui saat ini tidak muncul di mana pun pada Ready to Pack.** `addWeightToBulkRoastedCoffee()` — satu-satunya jalan masuk ke `bulk_roasted_coffee` — hanya dipanggil saat `qc_status === 'Success'` ([js/roasting.js:3376](js/roasting.js:3376), [:3412](js/roasting.js:3412), [:4280](js/roasting.js:4280)). Batch Test selalu mulai dari `qc_status = 'Pending'` ([js/roasting.js:3199](js/roasting.js:3199), [:4182](js/roasting.js:4182)). Jadi **tidak ada baris bulk sama sekali** untuk batch Test yang belum disetujui — kartu barunya bukan "menampilkan ulang" bulk yang sudah ada, tapi sumber data yang benar-benar baru.

Konsekuensi baiknya: begitu disetujui, `roast_batches.qc_status` berubah jadi Success, kartu Test otomatis hilang dari render berikutnya (query filternya sudah tidak match), dan outputnya masuk lewat jalur yang sudah ada (pooling otomatis atau combine manual) — **tidak ada perubahan skema yang diperlukan.**

**`roastBatches` sudah tersedia di `renderReadyToPackCards`, tidak perlu fetch baru.** Dilewatkan sebagai parameter dari `loadPackingSection()` ([js/packing.js:80](js/packing.js:80), [:100](js/packing.js:100)) — sudah dipakai fungsi ini untuk `lotCodeFor()`. Tinggal difilter untuk kartu Test.

**Jebakan nyata: early-return kalau bulk kosong akan menyembunyikan kartu Test juga.**
```js
if (activeBulk.length === 0) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    ...
    return;
}
```
([js/packing.js:128](js/packing.js:128)) — kalau sebuah kopi **hanya** punya batch Test pending (belum ada bulk apa pun), kondisi ini akan menampilkan pesan "tidak ada bulk" dan kartu Test tidak pernah dirender. Harus diubah jadi: hitung `pendingTestBatches` **lebih dulu**, baru early-return kalau `activeBulk.length === 0 DAN pendingTestBatches.length === 0`.

**`roasting_batch_approve` adalah seed MOCK_DB, bukan sumber kebenaran produksi.** `js/app.js:213` (`roasting_batch_approve: false` untuk Roaster) hanya dipakai untuk mengisi tabel `custom_roles` **kalau kosong** (CLAUDE.md, bagian "Full Supabase Mode"). Tabel produksi sudah terisi, jadi mengubah baris ini di kode **tidak otomatis mengubah izin Roaster yang sudah live**. Harus disertai satu langkah manual: Settings → Role Management → Roaster → centang "Approve Test Batch" (`js/settings.js:346` sudah menyediakan toggle generik untuk key ini, tidak perlu UI baru) → Save.

**Modal Combine memakai RPC yang sudah ada, bukan yang baru.** `refund_bulk_lot` (Fase 6 `STOCK_LEDGER_PLAN.md`, `database/v2_bulk_stock_ledger_migration.sql`) sudah menerima `p_bulk_id, p_kg, p_operation, p_ref_table, p_ref_id, p_reason, p_user` dan sudah dipakai persis untuk kasus "tambah kg ke bulk yang sudah ada" di `addWeightToBulkRoastedCoffee`'s existing-match branch ([js/roasting.js](js/roasting.js), lihat komentar "Atomic RPC (STOCK_LEDGER_PLAN.md Phase 6)"). Combine tinggal memanggil RPC yang sama dengan `p_bulk_id` hasil pilihan user, bukan hasil pencocokan otomatis. **Tidak ada migrasi database baru untuk fase ini.**

**Post-blend dan repack dikecualikan dari daftar Combine bukan preferensi, tapi mengikuti aturan yang sudah ada.** Komentar di `renderReadyToPackCards` ([js/packing.js:137-141](js/packing.js:137)): *"Post-blends and repacks are deliberately never grouped... merging two of either into one pool would misrepresent separate events as one lot."* Modal Combine harus menghormati aturan yang sama — filter `!b.is_post_blend && !b.is_repack`.

---

## 3. Spesifikasi kartu Test

### Data yang dipakai (semua sudah ada di `roast_batches`, tidak ada kolom baru)

`coffee_type`, `single_coffee_id`/`blend_recipe_id`, `machine_id`, `batch_code`, `roast_date`, `output_weight_kg`, `yield_percentage` (dipakai untuk depreciation = `100 - yield_percentage`, sama seperti tabel Batch Log — [js/roasting.js:1417](js/roasting.js:1417)), `notes`.

Nama kopi & kode mesin diresolve dengan cara yang **sama persis** dengan tabel Batch Log ([js/roasting.js:1402-1413](js/roasting.js:1402)) supaya tidak ada logika pencarian nama kedua yang bisa berbeda hasil.

> **Tidak ada kolom "siapa yang mencatat"** — `roast_batches` tidak punya `created_by`. Kartu tidak menampilkan nama roaster.

### Markup & CSS

Kelas baru mengikuti pola `.badge-repack` / `.card-repack` persis ([css/styles.css:1453-1471](css/styles.css:1453)):

```css
.badge-test-batch {
    background: rgba(29, 78, 216, 0.12) !important;
    color: #1d4ed8 !important;
}
[data-theme="dark"] .badge-test-batch {
    background: rgba(96, 165, 250, 0.15) !important;
    color: #60a5fa !important;
}
.card-test-batch {
    background: rgba(29, 78, 216, 0.06);
    border: 1px solid rgba(29, 78, 216, 0.35) !important;
    border-left: 4px solid #1d4ed8 !important;
}
[data-theme="dark"] .card-test-batch {
    background: rgba(96, 165, 250, 0.08);
    border-color: rgba(96, 165, 250, 0.35) !important;
}
[data-theme="dark"] .card-test-batch { border-left-color: #60a5fa !important; }
```

Isi kartu (lihat mockup untuk tata letak persis):
1. Baris atas: nama kopi + mesin (kiri), badge `Test · Pending` (kanan)
2. Catatan (`notes`) — italic, kotak kecil, **hanya render kalau notes tidak kosong** (jangan tampilkan kotak kosong)
3. Grid 2×2: Batch code, Roast date, Output (gram), Depreciation
4. Tombol **Approve** (solid biru, penuh) lalu **Approve & Combine** (outline biru, penuh) — susun vertikal, Approve di atas karena itu jalur default

### Urutan & filter

- Kartu Test **tidak masuk `RTP_FILTER_DATA`** ([js/packing.js:413-425](js/packing.js:413)) — selalu tampil apa pun filter tanggal/mesin yang aktif. Alasan: sifatnya notifikasi yang butuh tindakan, bukan stok yang sedang dijelajah.
- Di antara sesama kartu Test: urutkan berdasarkan `roast_date` terlama dulu — yang paling lama menunggu approval tampil paling atas.
- Render kartu Test **sebelum** loop `groups.forEach` yang sudah ada, ke container yang sama (`#ready-to-pack-cards`).

### Permission

`hasPermission('roasting_batch_approve')` menggerbangi **kedua** tombol (Approve dan Approve & Combine) — sama seperti `.btn-approve-test-batch` yang sudah ada ([js/app.js:1286-1288](js/app.js:1286)). Kalau user tidak punya izin, kartu tetap tampil (supaya semua orang tahu ada batch menunggu) tapi kedua tombol disembunyikan — bukan seluruh kartu disembunyikan.

Update matrix ([js/app.js:213](js/app.js:213)): `roasting_batch_approve: false` → `true` untuk role Roaster. **Plus langkah manual di produksi** (lihat §2) karena ini seed, bukan sumber kebenaran live.

---

## 4. Spesifikasi alur Approve & Combine

### Refactor `approveTestBatch` ([js/roasting.js:2448](js/roasting.js:2448))

Pisahkan logika inti dari dialog konfirmasi supaya bisa dipakai dua jalur:

```
finalizeTestBatchApproval(batch, targetBulkId, onDone)
  1. Update roast_batches: qc_status = 'Success' (field yang sama seperti updateRecord sekarang)
  2. Kalau targetBulkId ada  → panggil refund_bulk_lot RPC langsung ke bulk itu
     Kalau tidak             → panggil addWeightToBulkRoastedCoffee(...) seperti sekarang (pooling otomatis)
  3. onDone() — refresh apa pun yang perlu (lihat catatan refresh di bawah)

approveTestBatch(id)                    // jalur lama: confirm dialog → finalizeTestBatchApproval(batch, null, ...)
openApproveAndCombineModal(id)          // jalur baru: buka modal pilih target → finalizeTestBatchApproval(batch, targetBulkId, ...)
```

**Refresh setelah approve harus menangani DUA kemungkinan lokasi pemicu** (tombol ini sekarang ada di Batch Log table maupun kartu Ready to Pack). Jangan asumsikan salah satu — cek keberadaan elemen sebelum memanggil, pola yang sama seperti `checkStockFreezeBanner`:
```js
if (document.getElementById('roast-batches-tbody')) loadRoastingBatches();
if (document.getElementById('ready-to-pack-cards')) loadPackingSection();
scheduleDashboardRefresh();
```

### Modal Approve & Combine

Fungsi baru `openApproveAndCombineModal(batchId)`, ditaruh di `js/roasting.js` berdekatan dengan `approveTestBatch` (precedent: `addWeightToBulkRoastedCoffee` juga sudah menyentuh `bulk_roasted_coffee` langsung dari file ini).

Query kandidat:
```js
const candidates = (bulkList || []).filter(b =>
    parseFloat(b.bulk_available) > 0.005 &&
    !b.is_post_blend && !b.is_repack &&
    b.coffee_type === batch.coffee_type &&
    (batch.coffee_type === 'Single'
        ? b.single_coffee_id === batch.single_coffee_id
        : b.blend_recipe_id === batch.blend_recipe_id)
);
```
Urutkan: yang mesin+tanggalnya sama dengan batch (kandidat pooling otomatis) di atas dan ditandai "sama mesin", sisanya di bawah diurutkan tanggal terbaru dulu.

Isi modal (lihat mockup untuk tata letak):
- Header: judul + subjudul `NAMA KOPI · N g dari batch KODE`
- Daftar radio: mesin, tanggal roast, kode lot, kg tersedia. Kandidat "sama mesin" diberi border aksen + label kecil
- **Kalau `candidates.length === 0`**: ganti isi body dengan pesan kosong (ikon + teks, lihat mockup), footer hanya tombol **Tutup** — tombol submit tidak dirender sama sekali, bukan disembunyikan
- Footer (kalau ada kandidat): **Batal** | **Approve & Combine**

Submit handler:
```js
const chosenId = parseInt(document.querySelector('input[name="combine-target"]:checked').value);
await finalizeTestBatchApproval(batch, chosenId, onDone);
```

Konteks RPC untuk cabang combine — samakan gaya dengan cabang auto-pool yang sudah ada:
```js
p_operation: 'roast', p_ref_table: 'roast_batches', p_ref_id: batch.id,
p_reason: `Test batch #${batch.id} digabung manual`, p_user: currentUser?.name || null
```

---

## 5. Fase pengerjaan

### Fase 0 — CSS

Tambahkan `.badge-test-batch` / `.card-test-batch` (§3) ke `css/styles.css`, persis setelah blok `.badge-repack`/`.card-repack` yang sudah ada.

**Verifikasi:** buka halaman apa pun, pastikan tidak ada gaya lama yang rusak.

### Fase 1 — Kartu Test tersemat (baca saja, belum ada tombol aktif)

- Filter `pendingTestBatches` dari `roastBatches` di `renderReadyToPackCards`.
- Perbaiki early-return kosong (§2) supaya tidak menyembunyikan kartu Test.
- Render kartu Test (markup §3) sebelum loop `groups.forEach`, urut roast_date terlama dulu.
- Belum wiring tombol — dulu pastikan tampilannya benar dulu.

**Verifikasi:**
1. `node test.js` lulus.
2. Buat batch Test lewat Log Roasting Batch (centang Batch Test) untuk kopi yang **belum** punya bulk sama sekali → kartu Test muncul, **bukan** pesan "tidak ada bulk".
3. Buat batch Test lain untuk kopi yang **sudah** punya kartu bulk → kartu Test muncul **di atas** kartu bulk itu.
4. Catatan kosong → kotak catatan tidak muncul. Catatan terisi → muncul di bawah badge.
5. Ganti filter tanggal/mesin di halaman Ready to Pack → kartu Test tetap tampil, tidak ikut tersaring.

### Fase 2 — Tombol Approve (jalur lama, dipasang di kartu baru)

- Refactor `approveTestBatch` → `finalizeTestBatchApproval` + wrapper (§4).
- Wire tombol Approve di kartu ke `approveTestBatch(batch.id)`, gated `hasPermission('roasting_batch_approve')`.
- Refresh dua-lokasi (§4).

**Verifikasi:**
1. Klik Approve dari kartu baru → kartu hilang, muncul di kartu bulk yang sesuai (pooling otomatis, sama seperti sebelumnya).
2. Klik Approve dari halaman Batch Log (jalur lama) → masih berfungsi sama seperti sebelum refactor — regresi paling mudah luput di sini.
3. Cek `roast_batches.qc_status` di Supabase berubah jadi `Success`.
4. Login sebagai role tanpa `roasting_batch_approve` → tombol tidak ada, kartu tetap terlihat.

### Fase 3 — Modal Approve & Combine

- Bangun `openApproveAndCombineModal` (§4), termasuk keadaan kosong.
- Wire tombol Approve & Combine di kartu.
- Submit modal memanggil `finalizeTestBatchApproval(batch, chosenId, onDone)`.

**Verifikasi (pakai baris ZZ TEST, bukan data asli):**
1. Buat batch Test untuk kopi yang punya ≥2 lot bulk berbeda mesin/tanggal → modal menampilkan semua, yang "sama mesin" ditandai benar.
2. Pilih lot yang **bukan** kandidat auto-pool → setelah submit, cek `bulk_stock_movements`: `delta_kg` bertambah pada lot yang **dipilih**, bukan yang biasanya otomatis.
3. Jalankan kueri invarian ledger (`STOCK_LEDGER_PLAN.md` Lampiran) setelahnya: 0 ketidakcocokan.
4. Batch Test untuk kopi yang **belum ada bulk sama sekali** → klik Approve & Combine → modal kosong dengan pesan yang benar, hanya tombol Tutup.
5. Batal dari modal (baik keadaan terisi maupun kosong) → batch tetap Pending, kartu Test tidak hilang.

### Fase 4 — Permission

- Ubah `js/app.js:213`: `roasting_batch_approve: false` → `true` untuk Roaster.
- **Terapkan manual di produksi**: Settings → Role Management → Roaster → centang "Approve Test Batch" → Save (§2 — seed tidak otomatis berlaku ke tabel yang sudah terisi).

**Verifikasi:** login sebagai Roaster → kedua tombol approve muncul di kartu Test **dan** di halaman Batch Log (satu kunci permission, dua tempat, sesuai keputusan yang disepakati).

### Fase 5 — i18n + pembersihan

- String baru (badge, tombol, isi modal, pesan kosong) ke **`en` dan `ar`** di `js/translations.js`.
- Bump `?v=` untuk `js/roasting.js`, `js/packing.js`, `css/styles.css`, `index.html`.

---

## Lampiran — Daftar periksa tiap fase

- [ ] `node test.js` lulus
- [ ] Bump `?v=` untuk setiap file yang berubah
- [ ] String baru ada di **`en` dan `ar`**
- [ ] Warna lewat kelas CSS baru (`.badge-test-batch`/`.card-test-batch`), bukan hardcode inline
- [ ] Refresh setelah approve diuji dari **dua lokasi** (Batch Log dan kartu Ready to Pack)
- [ ] Permission diterapkan di kode **dan** di produksi lewat Role Management (dua langkah berbeda, jangan lupa salah satu)
- [ ] Kueri invarian ledger dijalankan setelah menguji jalur Combine
- [ ] Setelah push, tunggu Vercel "Ready", hard refresh, verifikasi live

## Lampiran — Jebakan khusus repo ini

- **Early-return kosong di `renderReadyToPackCards` akan menyembunyikan kartu Test kalau tidak diperbaiki** (§2) — ini jebakan paling mudah terlewat karena baru kelihatan saat menguji kopi yang belum punya bulk sama sekali.
- **`roasting_batch_approve` di `js/app.js` adalah seed, bukan sumber kebenaran produksi** — mengubah kode saja tidak cukup, perlu langkah manual di Role Management.
- **Post-blend dan repack tidak boleh muncul di daftar Combine** — aturan ini sudah ada untuk pooling otomatis, jangan dilanggar ulang di jalur manual.
- **`js/app_backup.js` bukan bagian aplikasi** — pencarian teks akan menemukannya, abaikan.
