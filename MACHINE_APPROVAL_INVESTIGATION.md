# Investigasi: "Approval mengurangi stok dari mesin yang salah" (task_5220ed75)

**Status:** Kemungkinan besar **sudah selesai** — perlu verifikasi, bukan perburuan akar masalah.
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

### Langkah 1 — Pastikan `machine_id` wajib atau tidak (murah, tanpa risiko)
Baca form pembuatan order (`js/sales.js`, modal Submit Sales Request). Cek apakah select mesin `required` dan apakah ada jalur simpan yang bisa melewatkannya.
- **Wajib** → §4.2 turun jadi catatan defensif saja; tambahkan guard + `console.error` supaya kalau suatu hari terpicu, tidak diam.
- **Opsional** → §4.2 naik jadi bug nyata yang harus diperbaiki, bukan laten.

### Langkah 2 — Verifikasi FIFO lintas-mesin (inti dari task ini)
Pakai pola pengujian yang sudah terbukti sepanjang sesi ini:
1. Cari kopi trade-name yang **sudah** punya lot di dua mesin dengan tanggal berbeda — jangan buat stok baru kalau tidak perlu.
2. Catat `remaining_pcs` **kedua** lot sebagai baseline (query langsung, bukan dari UI).
3. Buat order uji khusus (pola `RTL-007 - test` seperti investigasi 2026-08-21), approve dengan jumlah yang hanya menyentuh sebagian lot tertua.
4. Query ulang kedua lot → bandingkan dengan prediksi tabel §4.1.
5. Periksa `packed_stock_movements` mencatat pengurangan itu dengan `ref_id` order yang benar.
6. **Bersihkan**: undo/hapus order uji, kembalikan `remaining_pcs` ke baseline, konfirmasi lewat query.

### Langkah 3 — Tutup atau buka kembali
- **FIFO benar** → tutup task_5220ed75 dengan bukti; perbarui memori proyek (catatan "NOT yet fixed" di `project_packed_coffee_derived_quantity_completion.md` baris 29 sudah basi dan menyesatkan).
- **Masih salah** → baru cari akar masalah di `js/sales.js:1724-1745`, dengan data repro yang sudah di tangan.

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
