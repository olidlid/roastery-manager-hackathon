# Investigasi: "Approval mengurangi stok dari mesin yang salah" (task_5220ed75)

**Status:** ✅ **SELESAI — ditutup dengan bukti live.** FIFO lintas-mesin terbukti benar di produksi (Langkah 2, 2026-08-27).
**Tanggal:** 2026-08-27
**Asal laporan:** ditemukan sebagai efek samping investigasi lain, 2026-08-21. Dicatat waktu itu sebagai *"Root cause not yet located... Not a data-integrity risk today... worth prioritizing"*.

---

## 1. Ringkasan temuan awal (sebelum rencana ini dieksekusi)

Pembacaan kode hari ini menunjukkan laporan asli itu kemungkinan besar **menggabungkan dua hal berbeda**, dan keduanya sudah tidak berlaku lagi:

| Yang dilaporkan | Kenyataan di kode sekarang |
|---|---|
| "Order Machine=GIESEN mengurangi stok STRONGHOLD" | Untuk kopi ber-**trade name** (`coffee_code`), ini **perilaku yang disengaja**, bukan bug — lihat §2 |
| "Akar masalah belum ditemukan" | Ada cacat nyata di sekitarnya (urutan pengambilan bukan FIFO) — **sudah diperbaiki 2026-08-22** oleh `c7726ae` + `050aa4a` |

Memori proyek yang mencatat bug ini ditulis **2026-08-22 pukul 06:28 UTC**, sementara kedua commit perbaikan mendarat di hari yang sama. Jadi catatan "belum diperbaiki" itu kemungkinan besar **basi**, bukan salah saat ditulis.

**Konsekuensi:** rencana ini bukan rencana perbaikan. Ini rencana **pembuktian** — untuk menutup task_5220ed75 dengan bukti, atau menemukan sisa masalah yang benar-benar masih ada.

---

## 2. Kenapa "mesin salah" belum tentu salah

`findMatchingPacked()` (`js/sales.js:1166`) sengaja bercabang dua:

- **Item punya `coffee_code`** (trade name, mis. BRAZIL ROSA) → mengembalikan **semua** baris `packed_coffee` dalam grup kode itu, **tanpa filter mesin sama sekali** (baris 1169-1190). Ini fitur *Code Definitions*: satu nama dagang menaungi beberapa origin/mesin, dan keputusan "origin/mesin mana yang akhirnya dipakai" sengaja ditunda ke tahap packing/dispatch.
- **Item tanpa `coffee_code`** → difilter ketat `batch.machine_id === item.machine_id` / `p.machine_id === item.machine_id` (baris 1191-1210), dengan komentar eksplisit: *"packed stock from a different machine is not a valid fulfillment source for this item"*.

BRAZIL ROSA — kopi yang dipakai saat bug dilaporkan — **punya** trade-name group (tercatat di memori investigasi 2026-08-22). Jadi mengambil dari STRONGHOLD untuk order bertanda GIESEN adalah jalur yang benar untuk kopi itu.

Pola yang sama dipakai konsisten di `js/packing.js`: peringatan ketidakcocokan mesin sengaja **dimatikan** bila `item.coffee_code` ada (`js/packing.js:2022`, `js/packing.js:2348` — `const mismatch = !item.coffee_code && ...`).

---

## 3. Cacat nyata yang memang ada — dan sudah diperbaiki

Yang *benar-benar* salah bukan lintas-mesinnya, tapi **urutannya**. Komentar di `js/sales.js:1712-1723` mendokumentasikan ini dengan gejala yang identik dengan laporan asli:

> *"draws happened row-by-row (fully drain one packed_coffee row before touching the next) in whatever order fetch returned them — not FIFO. Found 2026-08-22 via a live repro: a GIESEN-tagged order line drew from STRONGHOLD stock instead while GIESEN's own stock sat untouched."*

Perbaikannya (`js/sales.js:1729-1731`): semua lot dari seluruh baris dalam pool **diratakan jadi satu daftar**, lalu diurutkan `packed_date` menaik. Komentar itu juga menjelaskan kenapa mengurutkan *baris*-nya saja tidak cukup.

**Commit:**
- `c7726ae` — *fix: cross-machine packed-stock deduction wasn't FIFO for trade-name items*
- `050aa4a` — *fix: make trade-name packed-stock deduction true FIFO across the whole pool*

---

## 4. Yang masih benar-benar terbuka

Dua hal. Sisanya sudah terjawab oleh pembacaan kode.

### 4.1 Apakah FIFO lintas-pool benar-benar bekerja di produksi? (prioritas utama)

Perbaikannya **belum pernah diverifikasi live** setelah mendarat — commit-nya menyebut repro, tapi tidak ada catatan verifikasi sesudah perbaikan. Yang perlu dibuktikan: saat pool punya lot dari dua mesin, pengambilan mengikuti **tanggal**, bukan urutan baris.

Kasus uji yang membedakan benar dan salah:

| | Mesin | Lot | `packed_date` |
|---|---|---|---|
| A | GIESEN | lot lama | lebih tua |
| B | STRONGHOLD | lot baru | lebih muda |

Approve order trade-name yang jumlahnya **hanya cukup untuk sebagian lot A**.
- **Benar:** hanya lot A berkurang, B utuh.
- **Masih bug:** B ikut/lebih dulu berkurang.

Lalu ulangi dengan urutan tanggal dibalik untuk memastikan hasilnya mengikuti tanggal, bukan kebetulan urutan `id`.

### 4.2 Risiko laten: item tanpa `coffee_code` **dan** tanpa `machine_id`

`js/sales.js:1726`:

```js
const szItems = (item.coffee_code || item.machine_id) ? matchingPacked.filter(...) : [];
```

Bila item tidak punya keduanya, `szItems` kosong → **tidak ada stok yang dikurangi sama sekali**, padahal `item.quantity_prepared = fQty` tetap dikredit di baris 1695. Artinya order tercatat "sudah disiapkan" tanpa stok pernah berkurang — persis pola *ghost stock* yang mahal diperbaiki di sesi-sesi sebelumnya.

**Sudah dicek terhadap data produksi hari ini — belum terjadi:**

| | Jumlah |
|---|---|
| Total `request_order_items` | 50 |
| Punya `coffee_code` | 40 |
| Tanpa kode, tapi punya `machine_id` | 10 |
| **Tanpa keduanya** | **0** |
| Tanpa keduanya **dan** `quantity_prepared > 0` | **0** |

Jadi ini **risiko laten, bukan bug aktif**. Yang perlu dipastikan: apakah `machine_id` bisa dibiarkan kosong dari form order? Kalau bisa, cabang ini suatu saat akan terpicu dan gagal diam-diam.

---

## 5. Rencana eksekusi

Urutannya sengaja: yang paling murah dan paling menentukan dulu.

### Langkah 1 — Pastikan `machine_id` wajib atau tidak (murah, tanpa risiko) — ✅ SELESAI 2026-08-27

**Hasil: WAJIB.** Form (`#modal-request-form`, `js/sales.js:2229`) punya `novalidate`, jadi validasi HTML5 native dimatikan — tapi submit handler-nya (`js/sales.js:2646-2665`) punya validator custom sendiri: `form.querySelectorAll('[required]').forEach(...)` memblokir submit dengan bubble merah kalau kosong. Select mesin (`js/sales.js:2548`, opsi placeholder `disabled selected` di baris 2201) tetap membawa atribut `required`, jadi tetap tertangkap validator ini. Diperiksa di **kedua** jalur simpan — order baru (baris ~2804-2831) dan edit (baris ~2770-2803) — sama-sama lewat validator yang sama.

Dicek juga semua pemanggil `saveData('request_order_items', ...)` lain di repo (`js/leader.js:120`, `js/packing.js:2229`/`2574`, beberapa di `js/sales.js` sendiri) — semuanya menyimpan ulang objek item yang **sudah ada** (hasil fetch dari DB), bukan membuat baris baru. `js/leader.js`'s `handleApprove()` khususnya hanya mengubah `item_status`/`quantity_pending` pada baris yang sudah ada, tidak pernah menyentuh `machine_id` dan tidak membuat baris baru — dan (dicatat sebagai pengamatan sampingan, di luar cakupan investigasi ini) jalur approve di leader.js sama sekali tidak memanggil logika deduksi stok `findMatchingPacked`/FIFO — itu murni transisi status, bukan bug.

**Kesimpulan sesuai percabangan rencana:** §4.2 turun jadi catatan defensif. Guard + `console.error` sudah ditambahkan di `js/sales.js:1726` (persis sebelum baris `szItems = ...`) — kalau cabang tanpa `coffee_code` dan tanpa `machine_id` ini suatu hari benar-benar terpicu, sekarang akan gagal dengan jejak log, bukan diam-diam mengkredit `quantity_prepared` tanpa mengurangi stok apa pun. Perubahan ini murni tambahan (tidak mengubah perilaku jalur normal), disyntax-check via `node --check js/sales.js` + `node test.js`, versi di `index.html` dinaikkan ke `js/sales.js?v=28`.

### Langkah 2 — Verifikasi FIFO lintas-mesin (inti dari task ini) — ✅ SELESAI 2026-08-27, TERBUKTI BENAR

**Kandidat & baseline.** BRAZIL ROSA (kode dagang `"1"` di `green_coffee`, size 250g) sudah punya lot di dua mesin. Lot dengan sisa >0 tertua **tanpa ambiguitas tanggal**: lot 156 (GIESEN W15A, `packed_date` 2026-08-11, sisa 50 pcs). Semua lot lain — baik GIESEN maupun STRONGHOLD — bertanggal lebih baru (2026-08-13 s.d. 2026-08-25). Baseline penuh (9 lot bersisa) dicatat via query langsung sebelum menyentuh apa pun.

**Order uji.** Dibuat lewat form order asli (bukan simulasi SQL): `KH270826002` (id 48), customer `WHL-009 - test`, item BRAZIL ROSA 250g × 10, field mesin diisi GIESEN (nilai form saja — sesuai §2, tidak dipakai untuk pooling trade-name). Modal Approve Order mengonfirmasi "Packed Stock 165, combined across 1 origin" (= 81 STRONGHOLD + 84 GIESEN, cocok dengan baseline) dan "10 ready". Diklik **Confirm Approval** dengan izin eksplisit dari user.

**Hasil — persis sesuai prediksi "benar" di §4.1:**
| Lot | Sebelum | Sesudah |
|---|---|---|
| 156 (GIESEN, tertua, 2026-08-11) | 50 | **40** (−10, persis sejumlah order) |
| Semua 8 lot lain (kedua mesin, termasuk lot 233 STRONGHOLD 2026-08-13) | — | **tidak berubah** |

`packed_stock_movements` mencatat **satu** baris: `operation: 'approval_fulfil'`, `delta_pcs: -10`, `balance_after: 40`, `ref_table: 'request_order_items'`, `ref_id: 79` (item order uji) — jejak audit benar dan tunggal, tidak ada duplikasi.

**Kesimpulan: FIFO lintas-mesin bekerja benar di produksi.** Pengambilan mengikuti `packed_date` global lintas pool, bukan urutan baris/mesin — order bertanda mesin GIESEN mengambil dari lot GIESEN yang memang tertua, dan lot STRONGHOLD yang lebih muda maupun lot GIESEN lain sama sekali tidak tersentuh.

**Bersih-bersih (sudah dikonfirmasi lewat query):** `packed_coffee_lots.remaining_pcs` lot 156 dikembalikan ke 50, baris `packed_stock_movements` sintetis (id 427) dihapus, item + order uji (`request_order_items` id 79, `request_orders` id 48) dihapus. Query ulang penuh atas 9 lot BRAZIL ROSA 250g menghasilkan angka **identik** dengan baseline sebelum uji.

*Catatan proses:* tab Chrome pertama sempat rusak di tengah pengujian (`Supabase fetch failed ... switching to mock`, gejala yang sama seperti dicatat di audit 2026-08-22) — diselesaikan dengan membuka tab baru, bukan men-debug tab yang rusak, sesuai catatan lama. Juga ditemukan tombol Approve ada di tab "Dispatch Approval" (bukan "Sales Dispatch Request" yang aktif secara default) — bukan bug, hanya salah tab saat pertama kali mencoba klik.

### Langkah 3 — Tutup atau buka kembali — ✅ DITUTUP DENGAN BUKTI

FIFO lintas-mesin **benar**. task_5220ed75 ditutup. Catatan "NOT yet fixed" di `project_packed_coffee_derived_quantity_completion.md` baris ~29 sudah basi dan perlu diperbarui — lihat pembaruan memori terkait.

---

## 6. Aturan main selama investigasi

Sama seperti sepanjang pengerjaan Stock Opname — setiap butir di bawah pernah menyelamatkan atau merusak sesuatu di repo ini:

- **Jangan pernah** menyentuh order/stok nyata sebagai efek samping "coba cek dulu". Pelajaran mahal 2026-08-21: sebuah `deleteData()` ad-hoc di konsol menghapus baris audit order asli milik user. Pakai order uji sekali pakai.
- Catat baseline lewat **query**, bukan angka dari UI, sebelum menyentuh apa pun.
- Bersihkan segera setelah tiap sub-uji, jangan menumpuk sampai akhir.
- Jalankan kueri invarian ledger (`STOCK_LEDGER_PLAN.md` Lampiran) sesudahnya.
- Hard refresh (`Ctrl+Shift+R`) sebelum menyimpulkan ada regresi — laporan bug 2026-08-21 sebelumnya ternyata berasal dari `packing.js` versi cache.
- Pastikan tidak ada stock opname berstatus `counting`/`posting` sebelum mulai, atau semua tulisan stok akan ditolak trigger pembekuan.

---

## 7. Perkiraan

Langkah 1 sekitar sepuluh menit. Langkah 2 adalah bagian terbesar — satu siklus order uji, mirip verifikasi Fase 5/6 Stock Opname. Kemungkinan besar berakhir di "tutup dengan bukti", bukan perbaikan kode.
