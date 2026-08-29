# Perombakan Modal Sales Order — Rencana Pengerjaan

**Status:** Rancangan disetujui (mockup sudah final), belum dikerjakan
**Tanggal:** 2026-08-29
**Tujuan:** Mengubah modal Submit Sales Request Order dari daftar baris menumpuk menjadi layout dua kolom seperti Stock Release, menambahkan konfirmasi sebelum submit, dan menambahkan modal Potential Production.

Rencana ini ditulis agar bisa dikerjakan tanpa percakapan yang menghasilkannya. Setiap anchor file/baris di bawah sudah diverifikasi terhadap kode yang ada per 2026-08-29.

---

## 1. Keputusan desain (sudah disepakati)

| Hal | Keputusan |
|---|---|
| Layout | Dua kolom mengikuti `.sr-grid` milik Stock Release — kiri form perakit item, kanan panel keranjang |
| Ukuran modal | Sangat besar, hampir memenuhi layar |
| Item | Dirakit di kiri lalu **Add to list** → jadi kartu di keranjang kanan (bukan baris berulang) |
| Edit item | Tombol edit per kartu → field kiri terisi item itu, panel kiri masuk mode edit (judul `Edit item — NAMA`, tombol jadi **Save**/**Cancel**), kartu terkait ditandai di kanan |
| Item duplikat | Kopi+mesin+size sama digabung, qty dijumlah. **Kecuali di mode edit order lama** (lihat §3.4) |
| Nama sales | Ditampilkan (readonly) di samping Order Number — sekarang masih `<input type="hidden">` |
| Tombol customer | `+ Add` → **Add New** |
| Info stok | Judul jadi **Available stock**, bentuk tabel: kolom pertama mesin, kolom berikutnya per size, ditutup baris Total. Ditempatkan **tepat di atas tombol Add to list** |
| Bar pemenuhan | **Dua lapis saja**: dari stok packed, dan ke produksi. Bulk tidak ditampilkan ke sales |
| Bulk | Wewenang leader sepenuhnya. Sales tidak melihat, tidak menghitung, tidak menyebut bulk di mana pun |
| Konfirmasi submit | Langkah kedua di modal yang sama (pola `sr-step-form`/`sr-step-confirm`), berisi detail order, item + jumlah, blok "Diteruskan ke produksi", dan total. Ada tombol **Back** |
| Tombol Potential Production | Di samping nama sales, **warna khusus** (ungu, belum dipakai badge lain) |
| Potential Production (blend) | Memakai **resep terbaru** di bawah kode itu — perubahan perilaku, lihat §4 |

---

## 2. Hasil pengecekan kompatibilitas hilir

Ditelusuri: submit → `approveSalesOrder` → tabel Sales Order di menu Packing.

**Aman secara struktural.** Kontrak antara modal dan alur hilir hanyalah baris `request_order_items`. `approveSalesOrder` (`js/sales.js:1185`) mengambil ulang 13 tabel segar dari database dan tidak pernah membaca satu pun angka yang dihitung modal. `loadPackingRequestsSection` (`js/packing.js:1616`) juga hanya membaca `request_orders` + `request_order_items`.

Field yang wajib tetap ditulis, sama persis seperti sekarang:

```
request_order_id, coffee_type, single_coffee_id, blend_recipe_id,
coffee_code, machine_id, bag_size_g, quantity_requested,
quantity_allocated, quantity_pending, item_status
```

`quantity_prepared` **tidak** ditulis modal — default 0 di DB (`supabase_schema.sql:458`), diisi saat approval. Jangan diubah.

Selama tiga hal itu terjaga, perombakan tampilan tidak menyentuh approval maupun packing sama sekali.

---

## 3. Empat hal yang wajib dijaga saat merombak

### 3.1 Submit membaca angka dari elemen DOM

`js/sales.js:2778-2780` membaca `r.dataset.packedStock`, `r.dataset.bulkBags`, `r.dataset.potentialBags` dari tiap `.sales-item-row`. Nilai itu ditulis `updateAllRowsStockDisplays()` (`js/sales.js:2631-2633`) yang **ber-debounce 500ms**.

Di model keranjang, angka ini harus disimpan di entri keranjang saat item ditambahkan/diubah, bukan dibaca dari DOM.

> **Bonus: ini memperbaiki bug laten.** Sekarang kalau operator mengetik qty lalu menekan Submit dalam waktu <500ms, dataset belum sempat terisi, `parseInt(undefined) || 0` menghasilkan 0, dan order salah dianggap kekurangan stok. Model keranjang menghitung saat item ditambahkan, jadi tidak ada balapan waktu.

### 3.2 Tiga fungsi alokasi membaca DOM

`getAllocations()` (`:2411`), `getBulkAllocations()` (`:2439`), `getGreenbeanAllocations()` (`:2186`) semuanya melakukan `querySelectorAll('.sales-item-row')`. Ketiganya harus dialihkan membaca struktur keranjang.

`getBulkAllocations()` **dihapus seluruhnya** (lihat §3.3).

### 3.3 Bulk dikeluarkan dari sisi sales

Karena alokasi bulk sepenuhnya wewenang leader, seluruh perhitungan bulk di modal sales dihapus:

- `getBulkAllocations()` (`:2439`)
- `perMachineBulkKg` dan pengurangan `bulk_reservations` (`:2170-2183`)
- `currentBulkBags` / `availBulkKg` di `updateAllRowsStockDisplays` (`:2572-2586`)
- tier `tierBulk` pada bar (`:2598`) dan label `lbl_tier_bulk`
- `dataset.bulkBags`

**Konsekuensi pada validasi submit.** `js/sales.js:2786` sekarang berbunyi `if (qty > packed + bulk)` untuk memutuskan munculnya prompt *"masuk antrean produksi?"*. Setelah bulk keluar:

- Prompt `prompt_roasting_queue` (`:2803-2806`) **dihapus**. Modal konfirmasi baru sudah menampilkan informasi yang sama secara lebih jelas, dan pertanyaannya sebenarnya salah alamat — bukan sales yang memutuskan.
- Peringatan `alert_stock_absolutely_insufficient` (`:2795-2801`) **dipertahankan**, tapi ambangnya jadi `qty > packed + potential` (tanpa bulk). Sifatnya beda: ini soal apakah pesanan mungkin dipenuhi sama sekali, bukan soal siapa yang memutuskan.

> **Catat sebagai perilaku yang disengaja:** angka "ke produksi" yang dilihat sales adalah **maksimum**. Kalau leader kemudian mengambil sebagian dari sisa bulk, jumlah yang benar-benar masuk produksi lebih kecil dari yang tertera di konfirmasi. Ini bukan bug. Layar approval tetap punya kolom bulk sendiri (`inp-fulfill` / `inp-bulk` / `inp-prod`, `js/sales.js:1751-1753`) dan tetap otoritatif.

### 3.4 Mode edit order lama memetakan baris lewat `originalItemId`

Untuk order berstatus Preparing/Approved, submit mencocokkan baris DOM ke `request_order_items` yang sudah ada lewat `r.dataset.originalItemId` (`:2842`), lalu menyinkronkan `target_roasted_kg` pada `roasting_plans` yang tertaut (`:2859-2874`).

Maka:

1. Tiap entri keranjang **wajib membawa** `originalItemId`.
2. **Penggabungan duplikat harus dimatikan** di mode edit order lama. Kalau dua item lama yang berbeda digabung jadi satu entri, pemetaan putus dan satu `roasting_plans` tertinggal menggantung dengan target basi.

---

## 4. Perubahan perilaku yang disengaja: potential blend

`getPotentialBags()` (`js/sales.js:2232`) sekarang, untuk nama dagang Blend, mengambil **kapasitas terbesar** di antara resep yang berbagi kode (`:2253`, `Math.max` atas `maxGbKgForRecipe`). Alasannya tertulis di komentar: resep mana pun yang akhirnya dipakai, cukup resep itu sendiri yang punya bahan.

**Diubah menjadi: memakai resep terbaru.** Urutkan resep dengan kode itu berdasarkan `blend_recipes.created_at` menurun, seri dipecah dengan `id` terbesar (kolom keduanya ada — `supabase_schema.sql:172-182`).

> **Konsekuensi jujur:** kalau resep terbaru kebetulan bahan bakunya paling sedikit, angka potential akan **turun** dibanding sekarang, padahal secara fisik masih mungkin memproduksi lebih banyak lewat resep lama. Ini konsekuensi wajar bila produksi memang selalu memakai resep terbaru, tapi harus disadari.

Perubahan ini berlaku di **dua tempat sekaligus** karena keduanya memanggil fungsi yang sama: bar pemenuhan di modal sales order, dan kolom Potential Production di modal baru. Jangan sampai keduanya memberi angka berbeda.

---

## 5. Spesifikasi layar

### 5.1 Layout utama

Ikuti `.sr-grid` (`css/styles.css:952-956`): `grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr)`, gap 18px, runtuh jadi satu kolom di bawah 1000px (`:975-982`).

Kelas baru untuk modal ini (jangan pakai ulang `.sr-*` supaya perubahan di Stock Release tidak merembet):
- `.so-grid` — sama seperti `.sr-grid`
- `.so-panel` — sama seperti `.sr-panel`
- `.so-cart-scroll` — sama seperti `.sr-cart-scroll`

Lebar modal: `openModal(title, html, '1400px')` — Stock Release memakai `'1000px'` (`js/packing.js:5802`). Tambahkan `width: 95vw` lewat kelas agar benar-benar hampir memenuhi layar tanpa melebihi viewport di monitor kecil.

### 5.2 Kolom kiri

Urutan dari atas:

1. Baris dua kolom: **Order Number** (readonly) | **Sales** (readonly) + tombol **Potential** berwarna ungu
2. **Customer** — select + tombol **Add New** (sudah ada, `js/sales.js` `btn-req-add-customer`, tinggal ganti teksnya)
3. Pembatas `tambah item` — di mode edit berubah jadi judul `Edit item — NAMA` dengan ikon dan warna aksen
4. **Coffee** | **Machine** (dua kolom)
5. **Size** | **Qty** (dua kolom)
6. Card **Available stock** (§5.3)
7. Tombol **Add to list** — di mode edit jadi **Cancel** | **Save**

Di mode edit, seluruh blok 3–7 dibungkus border/latar aksen agar jelas sedang mengedit.

### 5.3 Card Available stock

Judul: `Available stock — NAMA KOPI`.

Tabel: kolom pertama nama mesin, satu kolom per size aktif (`packaging_sizes` yang `is_visible`), ditutup baris **Total** per size. Sel yang cocok dengan mesin+size yang sedang dipilih diberi sorotan warna aksen.

Angka **harus sudah dikurangi isi keranjang** — ini mempertahankan perilaku yang sudah ada (`js/sales.js:2525-2535`), yang lahir dari bug nyata 2026-07-16: dua baris untuk kopi+size+mesin yang sama sama-sama menampilkan stok penuh dan bersama-sama melebihi stok.

Di bawah tabel, dipisah garis putus-putus: **bar pemenuhan dua lapis** untuk qty yang sedang diketik — hijau `N dari stok`, kuning `N ke produksi`. Kalau bahkan setelah roasting masih kurang, tambahkan segmen merah `N kurang`.

> Kalau nanti size aktif bertambah jadi 3–4, kolom kiri akan sempit. Solusi saat itu: tampilkan hanya size yang ada stoknya, atau geser tabel jadi selebar penuh di bawah.

### 5.4 Panel kanan (keranjang)

- Judul **Order items** + badge jumlah item
- Kartu per item: nama kopi, `mesin · size`, qty, tombol **edit** dan **hapus**
- Kartu yang sedang diedit: border aksen + badge `diedit`, tombol edit/hapus diganti badge itu
- Kartu yang qty-nya melebihi stok: latar kuning + keterangan singkat `N ke produksi`
- **Order Notes**
- **Total** — jumlah seluruh bags
- Tombol **Cancel** | **Submit Request**

### 5.5 Langkah konfirmasi

Pola persis Stock Release (`js/packing.js:5723` untuk struktur, `:6061-6117` untuk isi & tombol): dua div dalam satu `<form>`, `so-step-form` disembunyikan, `so-step-confirm` ditampilkan. Tombol **Back** mengembalikan tanpa kehilangan keranjang.

Isi:
1. Banner aksen: `Konfirmasi Sales Request` + `Periksa detail di bawah. Order dikirim untuk persetujuan leader.`
2. Grid meta: Order Number, Tanggal, Sales, Customer
3. Daftar item: nama, `mesin · size`, qty, dan keterangan sumber — `dari stok` (hijau) atau pecahan `12 dari stok · 13 ke produksi`
4. Blok kuning **Diteruskan ke produksi**: hanya item yang butuh produksi, dengan mesin dan `setara N kg`
5. Ringkasan: `Diambil dari stok packed` / `Diteruskan ke produksi` / `Total pesanan`
6. Tombol **Back** | **Submit Request**

**Tidak boleh menyebut bulk atau keputusan leader di layar ini.**

Tombol konfirmasi harus di-`disabled` selama proses submit berjalan — pola yang sudah dipakai Stock Release (`js/packing.js:6113`) untuk mencegah klik ganda menulis order dua kali.

### 5.6 Modal Potential Production

Dibuka dari tombol ungu di samping nama sales. Modal terpisah — **harus overlay bertumpuk sendiri**, bukan lewat `openModal`, karena `openModal` memakai satu `#modal-container` bersama dan akan menimpa form sales order yang sedang diisi. Pakai pola yang sama seperti `openAddCustomerShortcutModal` di `js/sales.js` (overlay sendiri, `z-index: 2000`).

Kolom tabel:

1. **Kopi** — kode + nama dagang. Sumbernya `codeGroups` dan `blendCodeGroups` (`js/sales.js:2030-2051`): hanya kopi yang kodenya punya baris di `code_definitions`. Baris blend diberi badge `blend` + keterangan kecil resep terbaru yang dipakai beserta tanggalnya.
2. **Per mesin** — satu grup kolom per mesin, sub-kolom per size aktif, isinya stok packed global.
3. **Potential Production** — dua sub-kolom: total stok green bean (kg) dan yield (kg). Global, tidak dipecah per mesin, karena green bean adalah bahan mentah yang belum terikat mesin.

Footer keterangan: angka mesin adalah stok packed siap kirim; Potential dihitung dari green bean × 85%; untuk blend dipakai resep terbaru dan dibatasi bahan baku paling sedikit menurut resep itu.

Bungkus tabel dengan `overflow-x: auto` — dengan 3+ mesin tabelnya melebar.

---

## 6. Fase pengerjaan

Urutannya bukan selera; Fase 1 adalah fondasi yang dipakai semua fase lain.

### Fase 0 — Fondasi CSS

- Tambahkan `.so-grid`, `.so-panel`, `.so-cart-scroll` di `css/styles.css` (salin pola `.sr-*` di `:952-982`, termasuk media query 1000px).
- Tambahkan kelas warna tombol Potential mengikuti pola `badge-*` yang sudah ada (`css/styles.css:1421-1461`), dengan varian `[data-theme="dark"]`. **Jangan hardcode warna** — aturan proyek ini.

**Verifikasi:** buka modal apa pun, pastikan tidak ada gaya lama yang rusak.

### Fase 1 — Keranjang + layout dua kolom

Ini fase terbesar. Target: **paritas fungsional** dengan modal sekarang — record yang tersimpan identik.

- Ganti `addSalesItemRow()` (`:2639`) dengan model keranjang (`Map` di-key `coffee|machine|size`, sama seperti cart Stock Release yang di-key `lotId`, `js/packing.js:5822`).
- Tiap entri menyimpan: nilai coffee/machine/size/qty, angka stok yang dihitung saat ditambahkan (§3.1), dan `originalItemId` bila berasal dari order lama (§3.4).
- Alihkan `getAllocations()` dan `getGreenbeanAllocations()` membaca keranjang, bukan DOM.
- Alihkan submit (`:2773-2793`) membaca keranjang.
- Gabungkan duplikat, **kecuali** saat `existingOrder` berstatus Preparing/Approved.
- Pastikan ketiga cabang submit (`isApprovedEdit`, edit non-approved, order baru — `:2837-2930`) tetap menulis field yang sama.

**Verifikasi wajib:**
1. `node test.js` lulus.
2. Buat order baru 2 item → cek di Supabase bahwa `request_order_items` berisi field yang sama persis seperti sebelum perombakan.
3. Buka order **Pending Approval** yang sudah ada, ubah, simpan → item lama terhapus dan dibuat ulang dengan benar.
4. Buka order **Preparing/Approved**, ubah qty, simpan → `quantity_requested`/`quantity_pending` ter-update, dan `roasting_plans.target_roasted_kg` yang tertaut ikut berubah. **Ini titik paling rawan.**
5. Setujui satu order dari layar approval → pastikan alurnya normal sampai muncul di tabel Sales Order menu Packing.

### Fase 2 — Edit item dari keranjang

- Tombol edit per kartu → isi field kiri, panel kiri masuk mode edit, tombol jadi Save/Cancel, kartu ditandai.
- Save menimpa entri itu (bukan menambah baru). Cancel mengembalikan form ke keadaan kosong tanpa mengubah keranjang.
- Saat mode edit aktif, tombol **Add to list** tidak boleh tersedia.

**Verifikasi:** edit qty item di tengah keranjang, simpan, pastikan hanya item itu berubah dan urutannya tetap.

### Fase 3 — Available stock + bar dua lapis

- Bangun card tabel §5.3 menggantikan `machineCardsHtml` (`:2512-2548`).
- Hapus seluruh perhitungan bulk (§3.3).
- Bar jadi dua/tiga segmen (packed / produksi / kurang), tanpa bulk.
- Hapus prompt `prompt_roasting_queue`; sesuaikan ambang `alert_stock_absolutely_insufficient`.

**Verifikasi:** pilih kopi yang stoknya kurang, pastikan angka di tabel berkurang sesuai isi keranjang, dan bar menampilkan pecahan yang benar.

### Fase 4 — Langkah konfirmasi

- Tambah `so-step-confirm`, pindahkan submit sebenarnya ke tombol di layar konfirmasi.
- Tombol Back mengembalikan keranjang utuh.
- Tombol konfirmasi di-disable selama submit.

**Verifikasi:** klik Submit → konfirmasi muncul → Back → keranjang masih utuh → Submit lagi → order tersimpan **satu kali** (cek tidak ada duplikat di `request_orders`).

### Fase 5 — Modal Potential Production

- Ubah `getPotentialBags()` untuk blend: resep terbaru, bukan `Math.max` (§4).
- Bangun modal §5.6 sebagai overlay bertumpuk sendiri.

**Verifikasi:** untuk satu kode blend yang punya ≥2 resep, cocokkan angka Potential dengan hitungan manual memakai resep terbaru. Pastikan angka di modal ini **sama** dengan yang dipakai bar di modal sales order.

### Fase 6 — Mode edit order terkunci

- Untuk order Preparing/Approved: sembunyikan kolom kiri sepenuhnya, keranjang hanya menampilkan item dengan qty yang bisa diedit, tanpa tombol hapus dan tanpa Add to list. Ini menggantikan pengunciannya field satu per satu (`:2694-2703`).

**Verifikasi:** buka order Preparing, pastikan tidak ada cara menambah/menghapus item, dan hanya qty yang bisa diubah.

### Fase 7 — i18n + pembersihan

- Kunci baru ke **`en` dan `ar`** di `js/translations.js`. Kunci lama yang tidak terpakai lagi (`btn_add_another_item`, `lbl_tier_bulk`, `prompt_roasting_queue`) boleh dihapus setelah dipastikan tidak dipakai di tempat lain.
- Bump `?v=` untuk `js/sales.js` dan `css/styles.css` di `index.html`.

---

## Lampiran — Daftar periksa tiap fase

Dari `CLAUDE.md`; tiap butir pernah menyebabkan regresi nyata di repo ini.

- [ ] `node test.js` lulus
- [ ] Bump `?v=` di `index.html` untuk **setiap** file yang berubah
- [ ] String baru ditambahkan ke **`en` dan `ar`**
- [ ] Warna lewat CSS custom property, jangan hardcode
- [ ] Mutasi baru memeriksa `error` dan menampilkannya
- [ ] Setelah push, tunggu Vercel "Ready", hard refresh, verifikasi live
- [ ] Cek `request_order_items` di Supabase setelah tiap fase yang menyentuh submit

## Lampiran — Jebakan khusus repo ini

- **`openModal` memakai satu `#modal-container` bersama.** Modal apa pun yang dibuka di atas modal lain akan menimpanya. Untuk overlay bertumpuk pakai pola `openAddCustomerShortcutModal` (`js/sales.js`) — overlay sendiri, `z-index: 2000`.
- **`.btn` mengalahkan atribut `[hidden]`.** `display:inline-flex` dari `.btn` menang atas default UA untuk `[hidden]`. Modal Stock by Lot harus menambahkan override `[hidden] { display: none !important; }` — modal ini akan butuh hal yang sama untuk tombol yang berganti-ganti (Add to list ↔ Save/Cancel).
- **`saveData(table, record)` mengirim seluruh objek.** Mengoper baris utuh akan mengirim ulang semua kolom.
- **`js/app_backup.js` bukan bagian aplikasi** — pencarian teks akan menemukannya, abaikan.
- **Sales hanya boleh memesan nama dagang ber-kode.** Kopi tanpa baris `code_definitions` tidak muncul di dropdown (`js/sales.js:2030-2051`). Jangan "perbaiki" ini jadi menampilkan semua kopi.
