# Prompt Sonnet: Autofill + checkout bertanya di modal packing

Kerjakan fitur ini di repo `roastery-manager-v2`.

## Baca dulu, keduanya, sebelum menulis kode

1. **`CHECKOUT_AUTOFILL_PLAN.md`** di root repo. Semua keputusan sudah final, termasuk keputusan terakhir di §9. Nomor pasal di prompt ini merujuk ke sana.
2. **Mockup:** https://claude.ai/artifact/GZRJRkeNaCCgQiPKdm67xa

Letak tombol, isi kolom, dan susunan kedua panel di mockup itu adalah **spesifikasi**. Kalau kode dan mockup berbeda, mockup yang benar. Yang tidak digambar di mockup, ikuti rencana. Yang tidak ada di keduanya, tanyakan — jangan karang sendiri.

## Kenapa pekerjaan ini lebih berbahaya dari tampilannya

Fitur ini menambah **satu-satunya jalur di modal itu yang menambah stok**. Dua minggu terakhir sudah dua kali membuktikan betapa mahalnya salah kecil di sini: satu klik ganda pada Checkout mengeluarkan 71 pcs lebih banyak dari pesanan pada 15 September, dan satu penyuntingan stok manual pada 14 September masih menyisakan selisih 7 pcs sampai hari ini.

Jadi bacalah §2, §3, §5, dan §6 rencana itu sampai benar-benar paham sebelum menyentuh apa pun. Kalau ada satu kalimat di sana yang menurutmu keliru, **berhenti dan katakan** — jangan diam-diam menyimpang.

## Enam fase, kerjakan berurutan

Rencana §11 memuat keenamnya lengkap dengan verifikasinya. Ringkasnya:

1. Semua kolom jumlah mulai dari 0; tombol **Autofill** di baris item.
2. Ikon reset di baris kiri + konfirmasinya.
3. Dialog dua pilihan saat ada baris kurang.
4. Panel kanan + reset per item (**bagian paling berbahaya**).
5. Kartu packing: penanda status, baris ringkasan, badge `Dispatched`.
6. Perbaikan §7 pada perhitungan ketersediaan di `js/sales.js`.

Commit boleh sekali di akhir, tapi **jalankan verifikasi setiap fase** sebelum lanjut ke fase berikutnya. Jangan menumpuk enam fase lalu menguji sekali di ujung.

## Delapan hal yang paling mudah salah

Semuanya sudah dijelaskan di rencana; diulang di sini karena ini yang akan menggigit.

1. **Daftar lot untuk pengembalian HARUS dari `committedQtyBreakdown`** (§5.1) — net per lot, bukan "pernah ada barisnya", dan jangan memakai `dispatch_lot_items` sendirian. Fungsinya sudah ada; pakai, jangan tulis ulang.
2. **`refund_packed_lot` mengembalikan `null` tanpa error kalau lotnya sudah tidak ada** (§5.5.1). Kode Undo yang ada sekarang hanya memeriksa `error`, jadi lot yang lenyap terbaca sukses. Perlakukan `null` sebagai **gagal**.
3. **`refund_packed_lot` tidak punya batas atas** dan mengembalikan saldo baru, bukan jumlah yang ditambahkan (§5.5.2). Beda dengan `consume_packed_lot`. Karena itu tombol reset **wajib** punya penjaga klik ganda seperti `cb599a4` — bendera in-flight, tombol `disabled`, dibebaskan di `finally`.
4. **`quantity_allocated` memakai `min(allocated_lama, prepared_baru)`**, bukan pengurangan (§5.3). Pengembalian berjalan dari pergerakan terbaru, jadi kalau gagal sebagian, yang pulang adalah bagian checkout sementara bagian approval masih di luar.
5. **`liveRemaining` wajib dinaikkan setiap pengembalian berhasil** (§6.1), dan **`packedMovementsAll` wajib disisipi baris sintetis positif** (§10.3). Tanpa yang pertama, kolom STOCK di layar tetap membaca angka lama walau basis data sudah benar. Tanpa yang kedua, reset kedua pada item yang sama mengembalikan stok dua kali.
6. **Autofill berangkat dari `fifoLotForItemMachine(itemId)`** dan membiarkan limpahan FIFO bawaan `addCartEntry` bekerja (§5.5.4). Kalau fungsi itu mengembalikan `null` — stok hanya ada di mesin lain — Autofill **tidak mengambil apa pun**. Operator yang memutuskan lintas mesin, bukan tombol.
7. **Bagian tanpa jejak lot tidak bisa dipulangkan** (§5.5.3). Sebutkan di konfirmasi, dan kurangi `quantity_prepared` hanya sebesar yang benar-benar pulang.
8. **Badge `Dispatched` hanya untuk stok yang sudah benar-benar keluar** (§8), bukan untuk isi keranjang. Beda itu yang paling penting dibaca operator di layar ini.

## Yang TIDAK boleh disentuh

- **Alur `Unable to Fulfill`** (`stopOrderFromPacking`) — sudah diuji live dan mengembalikan stok dengan benar. Pilihan 1 di §4 bukan alur itu dan tidak boleh memakai fungsinya.
- **Approval, Reopen, dan edit-lock** — semuanya sudah live dan teruji end-to-end.
- **Syarat tombol Dispatch di kartu** — sudah benar apa adanya (§9). Jangan membuat pengiriman per item.
- **Arti `quantity_pending`** — dibaca juga sebagai "To Production Plan" di popup detail order. Yang diperbaiki hanya satu perhitungan ketersediaan (§7).
- **`UPDATE remaining_pcs` langsung, tulisan ke `packed_coffee.quantity`, dan penghapusan baris `packed_stock_movements`** — tiga larangan lama, tidak berubah.

## Uji tutup, wajib sebelum menyatakan selesai

Untuk setiap order yang kamu pakai menguji, jalankan kueri di §11 rencana. Kolom `selisih` harus **nol di semua baris**. Kalau bukan nol, stok dan catatan order sudah berpisah — berhenti, laporkan, jangan lanjut.

Selain itu:

- Pakai **order uji** yang kamu buat sendiri lewat modal Sales Request, jangan order pelanggan sungguhan.
- **Hapus data uji** dari produksi setelah selesai, dan pastikan stok lot kembali ke angka semula.
- `node test.js` lulus.
- Key i18n baru ada di `en` **dan** `ar`.
- Naikkan `?v=` untuk setiap berkas yang berubah: saat ini `packing.js?v=127`, `sales.js?v=54`, `translations.js?v=67`.

## Yang kuharapkan di laporanmu

Sebutkan per fase: apa yang kamu ubah, verifikasi apa yang kamu jalankan, dan **angka sebelum-sesudah** untuk setiap lot yang tersentuh saat menguji reset. Kalau ada bagian rencana yang ternyata keliru saat kamu kerjakan, katakan — temuan seperti itu lebih berharga daripada laporan yang mulus.
