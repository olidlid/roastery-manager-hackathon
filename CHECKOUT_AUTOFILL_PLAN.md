# Rencana: Autofill, Checkout Bertanya, dan Setiap Akibatnya pada Stok

**Status:** Siap dikerjakan. Semua keputusan sudah diambil. Diperiksa ulang 2026-09-16 terhadap definisi RPC dan kode yang ada — empat koreksi masuk di §5.5, satu benturan struktural di §9.
**Tanggal:** 2026-09-16
**Mockup:** https://claude.ai/artifact/GZRJRkeNaCCgQiPKdm67xa
**Berkas yang tersentuh:** `js/packing.js` (modal checkout + kartu), `js/sales.js` (satu perhitungan ketersediaan), `js/translations.js`, `index.html`.

Dokumen ini menaruh bobot terbesar pada §3 sampai §7 — bukan pada tampilannya, melainkan pada **setiap perpindahan angka stok** yang disebabkan fitur ini. Alasannya sederhana: dua minggu terakhir sudah menunjukkan dua kali bagaimana kesalahan kecil di sini berubah jadi selisih stok yang mahal dilacak.

---

## 1. Keputusan yang sudah diambil user

| # | Keputusan |
|---|---|
| 1 | Semua kolom jumlah mulai dari **0**. Tidak ada angka saran dari sistem. |
| 2 | Tombol **Autofill** ada di **baris item**, bukan di dalam daftar lot. Sekali klik, baris itu terpenuhi mengikuti FIFO. |
| 3 | Checkout saat ada baris kurang **tidak ditolak dan tidak diam-diam jalan** — muncul dua pilihan (§4). |
| 4 | Pilihan 1: proses apa adanya, **kekurangan dicatat sebagai tidak terpenuhi**, order selesai. |
| 5 | Pilihan 2: proses sebagian, order tetap terbuka, modal berubah jadi **dua panel**. |
| 6 | Panel kanan **hanya** untuk order yang sudah pernah di-checkout sebagian. |
| 7 | Kolom kiri dihitung terhadap **kekurangan**, bukan pesanan penuh (`0 / 8`, bukan `12 / 20`). |
| 8 | Tombol reset (baris kiri dan panel kanan) memakai **ikon panah melingkar merah** dan selalu **meminta konfirmasi**. |
| 9 | Reset di panel kanan mengembalikan **seluruh jumlah satu item**, dan **pemilihan lot dilakukan otomatis** oleh sistem. |

---

## 2. Model stok hari ini — siapa memegang kebenaran

Ini fondasi seluruh rencana. Salah menebak satu baris di tabel ini berarti salah stok.

| Tempat | Perannya | Siapa yang menulis |
|---|---|---|
| `packed_coffee_lots.remaining_pcs` | **Sumber kebenaran** sisa stok per lot | HANYA lewat RPC `consume_packed_lot` / `refund_packed_lot` |
| `packed_coffee.quantity` | Total pipih per kopi+ukuran+mesin, dipakai banyak layar | **Turunan** — trigger `sync_packed_coffee_quantity` dari tulisan lot di atas. Jangan pernah ditulis langsung |
| `packed_stock_movements` | Buku besar tiap perpindahan | Trigger BEFORE pada lot; RPC mengisi konteks `mv_*` |
| `dispatch_lot_items` | Jejak "order ini mengambil dari lot itu" | `submitDispatchCheckout`, dan dikurangi oleh undo |
| `request_order_items.quantity_prepared` | Berapa pcs order ini sudah benar-benar keluar | approval + checkout + undo |
| `request_order_items.quantity_allocated` | Bagian yang diambil dari stok **saat approval** | approval |
| `request_order_items.quantity_pending` | Bagian yang saat approval diserahkan ke bulk/produksi | approval |
| `request_order_items.quantity_unfulfilled` | Kekurangan yang diputuskan tidak ditunggu lagi | approval, penghentian, dan **Pilihan 1** (baru) |

**Aturan yang tidak boleh dilanggar:** jangan pernah `UPDATE remaining_pcs` langsung, jangan pernah menulis `packed_coffee.quantity`, dan jangan pernah menghapus baris `packed_stock_movements`. Tiga larangan ini sudah ada sejak `STOCK_LEDGER_PLAN.md`; fitur ini tidak mengubahnya sedikit pun.

---

## 3. Efek stok setiap tindakan di modal ini

| Tindakan | Stok basis data | Buku besar | Keterangan |
|---|---|---|---|
| Membuka modal | Tidak berubah | — | Hanya membaca |
| **Autofill** di baris item | **Tidak berubah** | — | Hanya mengisi keranjang di layar |
| **Take** satu lot | **Tidak berubah** | — | Sama, hanya keranjang |
| **Reset baris kiri** (ikon merah kiri) | **Tidak berubah** | — | Mengosongkan keranjang baris itu |
| Tombol **Cancel** modal | **Tidak berubah** | — | Keranjang dibuang seluruhnya |
| **Checkout** | Berkurang | Satu baris per lot | `consume_packed_lot`, terkunci dan terpotong di basis data |
| **Pilihan 1** (proses apa adanya) | Berkurang sebesar isi keranjang saja | idem | + `quantity_unfulfilled` diisi |
| **Pilihan 2** (order tetap terbuka) | Berkurang sebesar isi keranjang saja | idem | Sisanya tetap ditunggu |
| **Reset panel kanan** (ikon merah kanan) | **Bertambah** | Satu baris per lot | `refund_packed_lot` — satu-satunya jalur yang menambah stok di modal ini |

Kesimpulan penting untuk operator, dan wajib tercermin di kalimat konfirmasi: **hanya dua tindakan yang menyentuh stok**, yaitu Checkout dan Reset panel kanan. Sisanya gratis.

---

## 4. Pilihan saat ada baris kurang

Muncul setelah Checkout ditekan, bukan sebelumnya, dan hanya kalau ada baris yang belum penuh.

**Pilihan 1 — proses apa adanya, order selesai.**
1. Keranjang dikonsumsi seperti biasa (`consume_packed_lot` per baris keranjang).
2. Untuk setiap baris yang masih kurang: `quantity_unfulfilled = quantity_requested − quantity_prepared`.
3. `item_status` seluruh baris menjadi `Ready for Handover`, termasuk yang kurang — karena tidak ada lagi yang akan disiapkan untuk baris itu.
4. Order keluar dari daftar packing lewat jalur yang sudah ada (`loadPackingRequestsSection` menyaring `status = 'Preparing'`, dan tab Completed Order membaca semua item `Ready for Handover`).
5. Kolom `quantity_unfulfilled` **sudah dipakai** oleh tabel Sales Dispatch Request dan Dispatch Approval sejak revisi approval (`APPROVAL_REVISION_PLAN.md`), lengkap dengan chip dan kolom **Not Fulfilled**. Tidak perlu tampilan baru di sisi sales.

**Pilihan 2 — proses sebagian, order tetap terbuka.**
1. Keranjang dikonsumsi seperti biasa.
2. `quantity_unfulfilled` **tidak** disentuh.
3. Baris yang penuh jadi `Ready for Handover`, yang kurang tetap `Packing`.
4. Order tetap `Preparing`, kartunya tetap ada di daftar packing dengan tampilan §8.

---

## 5. Reset di panel kanan — algoritma stok, ditulis rinci

Ini bagian paling berbahaya di seluruh rencana, jadi ditulis selangkah demi selangkah.

### 5.1 Lot mana yang dikembalikan

**Jangan menebak, jangan pakai `dispatch_lot_items` sendirian.** Sumbernya adalah `committedQtyBreakdown(itemId)` yang sudah ada di `js/packing.js`, dan sudah dipakai oleh Undo yang lama. Isinya:

- `ledgerLots` — **net per lot** dari `packed_stock_movements` yang `ref_table = 'request_order_items'` dan `ref_id = itemId`, dengan konvensi `outstanding = −net`, hanya yang `outstanding > 0`, diurutkan **dari pergerakan terbaru**.
- `legacyRows` — baris `dispatch_lot_items` untuk lot yang **tidak** ada di buku besar (pengambilan sebelum buku besar ada).
- `untrackedQty` — sisa yang tidak punya jejak di mana pun.

Tiga hal yang membuat ini benar dan tidak boleh diubah:

1. **Net per lot, bukan "pernah ada barisnya".** Lot yang pernah diambil lalu sudah dikembalikan penuh bernilai net 0 dan **tidak boleh** ikut dikembalikan lagi. Ini persis bug yang ditemukan Sonnet sendiri pada `canReopenOrder`.
2. **Pengambilan saat approval ikut terbawa.** Approval memakai `consume_packed_lot` dengan `ref_table` yang sama, jadi bagiannya ada di buku besar dan ikut pulang. Konsekuensinya: `quantity_allocated` juga harus ikut disesuaikan — dengan rumus `min(allocated_lama, prepared_baru)` di §5.3, **bukan** selalu dinolkan.
3. **Terbaru dulu.** Walau reset selalu diniatkan untuk seluruh item, urutan ini **tetap berpengaruh**: kalau satu RPC gagal di tengah, yang sudah pulang adalah pergerakan terbaru (biasanya bagian checkout), sedangkan bagian approval masih di luar. Itulah alasan rumus `quantity_allocated` di §5.3. Jangan diubah.

### 5.2 Urutan eksekusi

```
1. Kunci tombol (lihat §10.1). Tampilkan konfirmasi yang menyebut lot + jumlah.
2. breakdown = committedQtyBreakdown(itemId)
3. refunded = 0
   untuk setiap {lotId, outstanding} di breakdown.ledgerLots:
       rpc refund_packed_lot(lotId, outstanding, 'undo',
                             'request_order_items', itemId, alasan, user)
       kalau gagal  -> catat, LANJUT ke lot berikutnya, JANGAN batalkan yang sudah berhasil
       kalau sukses -> refunded += outstanding
                       liveRemaining[lotId] += outstanding
                       syncDispatchLotItems(lotId, outstanding)
                       catat baris sintetis +outstanding ke packedMovementsAll
4. ulangi hal yang sama untuk breakdown.legacyRows
5. tulis kolom item berdasarkan `refunded` YANG BENAR-BENAR BERHASIL (§5.3)
6. render ulang seluruh modal + kartu packing + dashboard
```

**Kenapa `refunded` dan bukan "langsung nol":** kalau satu RPC gagal di tengah, stok yang sudah kembali tetap kembali, dan kolom item harus mencerminkan kenyataan itu, bukan niatnya. Buku besar tetap jadi wasit.

### 5.3 Kolom yang ikut berubah

| Kolom | Nilai baru | Alasan |
|---|---|---|
| `quantity_prepared` | `max(0, prepared − refunded)` | Hanya yang benar-benar pulang |
| `quantity_allocated` | `min(allocated_lama, prepared_baru)` | Bagian approval ikut pulang (§5.1 poin 2). **Bukan** `allocated − refunded`: pengembalian berjalan dari pergerakan terbaru, jadi kalau hanya sebagian yang berhasil, yang pulang adalah bagian checkout, sedangkan bagian approval masih di luar. Rumus pengurangan akan menolkannya secara keliru |
| `item_status` | `prepared_baru >= requested ? 'Ready for Handover' : 'Packing'` | Pola yang sudah dipakai checkout dan undo lama |
| `quantity_pending` | **tidak disentuh** | Artinya "diserahkan ke bulk/produksi saat approval", bukan "sisa yang harus diambil" (§7) |
| `quantity_unfulfilled` | **tidak disentuh** | Reset bukan keputusan pemenuhan |

### 5.4 Yang tampil di layar sesudahnya

- Item itu **kembali ke daftar kiri** dengan target penuh. Contoh: kiri `3 / 8` dan kanan keluar 12 → sesudah reset jadi kiri `3 / 20`, kanan keluar 0. Angka yang sudah diketik operator (3) **tidak hilang**, hanya targetnya melebar.
- Baris ringkasan di panel kanan dan di kartu packing dihitung ulang.

### 5.5 Empat kasus yang harus ditangani eksplisit

Ditemukan saat memeriksa ulang rencana ini terhadap definisi RPC dan kode yang ada. Tiga di antaranya adalah lubang yang juga ada pada Undo yang lama.

**5.5.1 — `refund_packed_lot` tidak memberi tahu kalau lotnya hilang.**
Badan fungsinya hanyalah `UPDATE ... WHERE id = p_lot_id RETURNING remaining_pcs`. Kalau baris lotnya sudah tidak ada, tidak ada baris yang diperbarui, **tidak ada error**, dan hasilnya `null`. Kode Undo yang ada sekarang hanya memeriksa `error`, jadi lot yang lenyap akan terbaca sukses: `quantity_prepared` berkurang padahal tidak ada satu pcs pun yang pulang.
**Wajib:** perlakukan hasil `null` sebagai **gagal**, jangan tambahkan ke `refunded`, dan sebut lot itu di pesan akhir.

**5.5.2 — `refund_packed_lot` tidak punya batas atas.**
Berbeda dengan `consume_packed_lot` yang memotong di `LEAST(remaining_pcs, ...)` dan mengembalikan jumlah yang benar-benar terambil, pengembalian menambah apa adanya dan mengembalikan **saldo baru**, bukan jumlah yang ditambahkan. Artinya dua panggilan yang sama akan menaikkan stok dua kali tanpa perlawanan dari basis data. Ini yang membuat penjaga klik ganda (§10.1) bukan sekadar kenyamanan.

**5.5.3 — Bagian yang tidak punya jejak lot (`untrackedQty`).**
Sisa yang tidak tercatat di buku besar maupun di `dispatch_lot_items` **tidak bisa dipulangkan otomatis** — tidak ada lot tujuannya. Jangan diam-diam menganggapnya pulang.
**Wajib:** sebutkan di kotak konfirmasi (*"x pcs tidak punya catatan lot dan tidak bisa dikembalikan otomatis"*), dan kurangi `quantity_prepared` hanya sebesar yang benar-benar pulang. Sisa itu tetap tercatat sebagai sudah keluar sampai diselesaikan lewat Stock Take.

**5.5.4 — Autofill tidak boleh mengambil keputusan yang butuh pertimbangan manusia.**
`addCartEntry` memunculkan konfirmasi untuk dua hal: lot dari mesin lain, dan lot yang melompati FIFO. Autofill harus **selalu** berangkat dari `fifoLotForItemMachine(itemId)`, yang sudah menyaring hanya lot bermesin benar dan berstok hidup, lalu membiarkan limpahan FIFO bawaan `addCartEntry` bekerja. Kalau fungsi itu mengembalikan `null` — stok hanya ada di mesin lain — **Autofill tidak mengambil apa pun** dan baris itu dibiarkan kurang. Operator yang memutuskan lintas mesin, bukan tombol.

---

### 5.6 Apa yang terjadi pada urutan FIFO sesudah pengembalian

Pertanyaan yang paling penting untuk dijawab lurus: **pcs yang pulang kembali ke lot asalnya**, bukan ke lot termuda, dan bukan dibagi rata. Lot asal itulah yang tercatat di buku besar, dan itu juga yang benar secara fisik — bag yang belum jadi dikirim memang kembali ke tumpukan tempat ia diambil.

Akibatnya pada FIFO justru pemulihan yang benar:

- Lot lama yang sempat kosong akan **hidup lagi** dengan `packed_date` aslinya yang lebih tua.
- Autofill berikutnya membaca `fifoLotForItemMachine`, yang mengurutkan berdasarkan `packed_date`, jadi lot lama itu **kembali menjadi pilihan pertama** — persis seperti sebelum checkout terjadi.
- Tidak ada lot yang "naik pangkat" karena pengembalian, karena `quantity_pcs` dan `packed_date` tidak pernah disentuh oleh pengembalian.

Satu catatan untuk item bertrade-name (`coffee_code`): item seperti ini boleh ditarik dari beberapa origin sekaligus. Sesudah pengembalian lalu Autofill ulang, sistem bisa memilih **origin yang berbeda** dari yang tadi, kalau ada lot yang lebih tua di origin lain. Itu memang perilaku FIFO yang diinginkan dan bukan cacat — tapi perlu diketahui supaya tidak dikira pengembaliannya salah lot.

---

## 6. Kolom STOCK di modal — dari mana angkanya, dan kapan bohong

Kolom STOCK (kotak merah pada tangkapan layar user) **bukan** dibaca ulang dari basis data setiap saat. Ia dijumlahkan dari peta `liveRemaining` di sesi modal itu:

```js
const stock = lots.reduce((s, l) => s + (liveRemaining[l.id] || 0), 0);
```

`liveRemaining` diisi sekali saat modal dibuka, lalu digeser oleh Take, Cancel, dan pengembalian. Artinya:

**6.1 — Setiap pengembalian WAJIB menaikkan `liveRemaining[lotId]`**, bukan hanya menulis ke basis data. Kalau tidak, stok benar di basis data tapi layar tetap membaca angka lama. Ini persis keluhan user 2026-09-08: "undo, stok tidak kembali jadi 5, tapi setelah ditunggu kembali 5" — basis datanya sudah benar sejak awal, yang basi hanya layar.

**6.2 — Jebakan lot di luar daftar.** `lotsByItem` dibangun sekali saat modal dibuka, memuat **semua** lot untuk kopi+ukuran itu termasuk yang sudah kosong (komentar panjangnya sudah ada di kode, jangan dihapus). Tapi ia hanya memuat lot yang **cocok kopi+ukurannya**. Kalau pengembalian menyentuh lot di luar himpunan itu — misalnya item bertrade-name yang kelompok kodenya berubah setelah modal dibuka — penjumlahan STOCK tidak akan melihatnya.
**Pengaman:** sesudah semua RPC selesai, periksa apakah setiap `lotId` yang dikembalikan ada di `lotsByItem[itemId]`. Kalau ada yang tidak, muat ulang data modal (tutup-buka secara program) daripada menampilkan angka yang diam-diam kurang.

**6.3 — Angka merah pada STOCK** memakai `short = stock < (requested − prepared)`. Sesudah reset, `prepared` mengecil sehingga ambangnya naik; ini benar dan tidak perlu diubah.

**6.4 — Layar lain tidak ikut basi.** `packed_coffee.quantity` adalah turunan trigger, jadi Dashboard, Ready to Pack, Stock by Lot, dan modal Sales Request otomatis benar begitu lot ditulis. Yang perlu disegarkan hanya modal ini, kartu packing, dan dashboard — ketiganya sudah dipanggil oleh undo yang lama (`renderAll`, `loadPackingRequestsSection`, `scheduleDashboardRefresh`).

---

## 7. Satu ketidakcocokan lama yang jadi lebih penting karena fitur ini

Ditemukan saat merencanakan, **bukan** disebabkan fitur ini, tapi fitur ini membuatnya sering terjadi.

`submitDispatchCheckout` menaikkan `quantity_prepared` tetapi **tidak** menurunkan `quantity_pending`. Sementara itu, perhitungan ketersediaan di `openSalesRequestModal` (js/sales.js, blok `committedPackedMap`) mengurangi stok dengan `quantity_pending` untuk setiap order berstatus `Pending Approval` / `Preparing`, kecuali bila `item_status = 'Ready for Handover'`.

Akibatnya, selama sebuah baris berada di tengah jalan — sudah diambil sebagian, statusnya masih `Packing` — klaimnya dihitung dua kali: stoknya sudah benar-benar berkurang dari lot, **dan** `quantity_pending` masih dikurangkan lagi dari ketersediaan. Agen sales melihat stok lebih sedikit daripada kenyataan.

Hari ini keadaan itu jarang dan sebentar. Dengan Pilihan 2, keadaan itu justru jadi normal dan bisa bertahan berhari-hari.

**Perbaikan yang diusulkan, satu tempat saja:** pada blok itu, untuk item yang bukan `Ready for Handover`, pakai
`outstanding = max(0, quantity_requested − quantity_prepared − quantity_unfulfilled)`
sebagai pengganti `quantity_pending`.

**Sengaja TIDAK mengubah arti `quantity_pending`.** Kolom itu dibaca juga oleh popup detail order sebagai "To Production Plan" dan oleh alur edit order. Mengubah artinya berarti menyentuh sisi roasting — di luar cakupan, dan berisiko. Yang diperbaiki hanya satu perhitungan ketersediaan.

---

## 8. Kartu di daftar packing

Sumber angkanya sudah ada: `loadPackingRequestsSection` membaca `quantity_prepared` dan `quantity_requested` per item. Yang berubah hanya penyajian.

- Penanda status **Sebagian keluar** (merah) menggantikan `Preparing` ketika `0 < Σ prepared < Σ requested`.
- Baris ringkasan: `Σ prepared` dari `Σ requested` pcs sudah keluar, sisa selisihnya, dengan batang kemajuan.
- Angka per item berarti **sudah keluar / diminta**, dengan keterangan kurang berapa.
- Tombol `Prepare` berganti `Lanjutkan`. `Unable to Fulfill` tetap, dan tetap memakai `stopOrderFromPacking` yang sudah terbukti mengembalikan stok lot per lot.

**Badge `Dispatched` per item.** Menempel pada setiap baris item yang `quantity_prepared > 0`, baik sebagian maupun penuh. Muncul di **dua tempat dengan syarat yang sama**: baris item di kartu ini, dan baris item di dalam modal checkout (daftar kiri pada tampilan dua panel).

Satu batas yang tidak boleh kabur: badge ini **tidak** dipasang untuk angka yang baru masuk keranjang dan belum di-checkout. Keranjang belum menyentuh stok. Beda antara "sudah keluar" dan "baru di keranjang" justru hal terpenting yang dibaca operator di layar ini — menyamakan keduanya menghapus pembeda itu dan membuat orang membatalkan sesuatu yang dikiranya masih aman. Badge ikut hilang sesudah reset di panel kanan, karena tidak ada lagi yang di luar.

---

## 9. Keputusan terakhir: kirim duluan — SUDAH TERJAWAB, tanpa perubahan kode

Pertanyaannya: order yang dibuka lewat Pilihan 2, barang yang sudah keluar boleh dikirim duluan?

Ternyata ini **tidak bebas dipilih**. `dispatchOrder` menyetel `status = 'Dispatched'` untuk **seluruh order**, sedangkan daftar packing hanya menampilkan order berstatus `Preparing`. Jadi begitu order dikirim duluan, kartunya hilang dari packing dan baris yang masih kurang tidak punya tempat untuk dilanjutkan.

**Kabar baiknya: perilaku yang benar sudah berjalan hari ini.** Di `loadPackingRequestsSection`, tombol `Dispatch` hanya dirender ketika **setiap** baris sudah `quantity_prepared >= quantity_requested`; selama masih ada yang kurang, yang muncul adalah tombol `Prepare`. Jadi order yang sebagian keluar memang tidak bisa dikirim duluan, dan itu memang yang kita inginkan.

**Yang harus dilakukan: tidak ada.** Jangan menyentuh syarat tombol Dispatch, dan jangan membuat pengiriman per item — itu pekerjaan tersendiri yang menyentuh surat jalan dan riwayat, bukan bagian dari rencana ini.

---

## 10. Ranjau

**10.1 — Kunci setiap tombol yang menyentuh stok selama prosesnya berjalan.** Checkout sudah dikunci sejak `cb599a4`. Tombol reset di panel kanan harus mendapat penjaga yang sama: satu bendera in-flight, tombol `disabled`, dan dibebaskan di `finally`. Klik ganda pada pengembalian akan **menggandakan stok**, dan basis data tidak akan menahannya sama sekali (§5.5.2) — arah kerusakan berlawanan dengan bug 15 September, tapi sama besar.

**10.2 — Buku besar adalah wasit, bukan layar.** Jangan pernah menghitung jumlah yang dikembalikan dari apa yang tampil di panel kanan. Selalu dari `committedQtyBreakdown`, dibaca ulang tepat sebelum menulis.

**10.3 — `packedMovementsAll` hanya diambil sekali saat modal dibuka.** Sesudah setiap pengembalian berhasil, sisipkan baris sintetis positif ke dalamnya, seperti yang sudah dilakukan undo lama. Tanpa itu, reset kedua pada item yang sama akan membaca saldo sebelum pengembalian pertama dan mengembalikan stok dua kali.

**10.4 — Jangan menyentuh alur `Unable to Fulfill`.** `stopOrderFromPacking` sudah diuji live dan mengembalikan stok dengan benar. Pilihan 1 di §4 **bukan** alur itu dan tidak boleh memakai fungsinya.

**10.5 — Autofill tidak boleh melewati batas yang ada.** Ia mengisi keranjang memakai jalur yang sama dengan Take (`addCartEntry` dengan limpahan FIFO-nya), bukan jalur baru. Dengan begitu peringatan lot beda mesin dan batas `liveRemaining` tetap berlaku.

**10.6 — Kosong berarti nol, bukan satu.** Nilai awal setiap kolom jumlah adalah 0 dan tombol Take mati sampai ada angka. Prefill 1 pcs pernah menyebabkan pengambilan tidak sengaja dan sudah dihapus `55e884d`; jangan dihidupkan lagi lewat pintu belakang Autofill.

**10.7 — i18n dan cache-bust.** Setiap kalimat baru wajib ada di `en` dan `ar`. Naikkan `?v=` untuk `js/packing.js`, `js/sales.js`, dan `js/translations.js`.

---

## 11. Fase pengerjaan

**Fase 1 — Semua nol + Autofill di baris.** Hapus angka saran; tambah tombol per baris; Take tetap mati sampai ada angka.
*Verifikasi:* buka modal, semua kolom nol; Autofill satu baris memenuhi tepat sebesar kekurangan; **tidak ada** baris `packed_stock_movements` baru sebelum Checkout ditekan.

**Fase 2 — Reset baris kiri + konfirmasinya.** Ikon merah, konfirmasi ringan, nilai baris kembali nol.
*Verifikasi:* stok lot di basis data tidak berubah sama sekali sebelum dan sesudah.

**Fase 3 — Dialog dua pilihan.**
*Verifikasi:* Pilihan 1 menutup order dan mengisi `quantity_unfulfilled = requested − prepared`; Pilihan 2 membiarkannya nol. Bandingkan `Σ −delta_pcs` di buku besar dengan `quantity_prepared` — **harus sama persis** di kedua jalur.

**Fase 4 — Panel kanan + reset per item.** Termasuk §5, §6.1, §6.2, dan penjaga §10.1.
*Verifikasi:* satu item yang sudah keluar 12 pcs dari 2 lot direset → kedua lot naik persis 12 seluruhnya, `quantity_prepared` jadi 0, kolom STOCK di layar naik tanpa perlu menutup modal, dan `Σ −delta_pcs` untuk item itu jadi 0.

**Fase 5 — Kartu packing.**
*Verifikasi:* order yang sebagian keluar menampilkan penanda merah dan ringkasan yang cocok dengan jumlah di modal.

**Fase 6 — Perbaikan §7.**
*Verifikasi:* satu order dengan baris setengah jalan; buka modal Sales Request untuk kopi yang sama dan pastikan angka tersedianya sama dengan `remaining_pcs` nyata dikurangi klaim yang benar-benar tersisa.

**Uji tutup di setiap fase** (jalankan sebelum menyatakan selesai):
```sql
-- untuk order yang diuji: tiap baris harus 0
select i.id,
       i.quantity_prepared,
       -coalesce(sum(m.delta_pcs),0) as terpotong,
       i.quantity_prepared + coalesce(sum(m.delta_pcs),0) as selisih
from request_order_items i
left join packed_stock_movements m
       on m.ref_table = 'request_order_items' and m.ref_id = i.id
where i.request_order_id = :order_id
group by i.id, i.quantity_prepared;
```
Kolom `selisih` yang bukan nol berarti stok dan catatan order sudah berpisah — hentikan, jangan lanjut.

---

## 12. Di luar cakupan

- Mengubah arti `quantity_pending` (§7).
- Menyentuh alur approval, `Unable to Fulfill`, atau Reopen — semuanya sudah live dan teruji.
- Pengembalian sebagian dari satu item. Reset selalu untuk seluruh item.
- Membersihkan baris buku besar lama. Buku besar tidak pernah dihapus.
