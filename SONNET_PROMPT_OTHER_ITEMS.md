# Prompt Sonnet: Other Items (Barang Lain)

Kerjakan fitur ini di repo `roastery-manager-v2`.

## Baca dulu, keduanya, sebelum menulis kode

1. **`OTHER_ITEMS_PLAN.md`** di root repo. Semua keputusan user sudah final (§2). Nomor pasal di prompt ini merujuk ke sana.
2. **Mockup:** https://claude.ai/artifact/HEnfx3fXTVxEmVi7H25MKV — 7 layar.

Kolom tabel, isi form, dan susunan modal di mockup itu adalah **spesifikasi**. Kalau kode dan mockup berbeda, mockup yang benar. Yang tidak digambar di mockup, ikuti rencana. Yang tidak ada di keduanya, tanyakan — jangan karang sendiri.

## Apa yang dibangun, dalam satu paragraf

Inventory untuk barang yang dibeli dari luar lalu dijual lagi (filter kertas, gelas, kaos, tumbler). Tidak lewat roasting/packing, jadi tidak ada lot/FIFO/expiry — satu item satu angka stok, tapi setiap perubahannya masuk ledger. Section baru di dropdown Inventory dengan dua tab (Item List, Stock Release), dan barangnya bisa ikut dipesan di Sales Request yang sudah ada, bercampur dengan kopi dalam satu order.

## Kenapa pekerjaan ini lebih berbahaya dari tampilannya

Dua bagian menyentuh kode paling rapuh di aplikasi ini:

- **Fase 5 menyentuh `runCheckout()`** (js/packing.js:3364) — satu-satunya tempat stok benar-benar keluar saat dispatch. Repo ini sudah pernah kehilangan 71 pcs gara-gara satu klik ganda di sana (`cb599a4`). Jangan menambah jalur kedua yang bisa jalan dua kali; ikuti guard pengosongan keranjang yang sudah ada.
- **Fase 4 menyentuh alur order** yang dipakai aplikasi Android Leader. `js/leader.js:65` merender tiap baris sebagai `${item.bag_size_g}g` — kalau baris other item bocor ke sana tanpa penanganan, leader menyetujui order yang tampil rusak.

Rencana §4.6 menjelaskan kenapa baris other item disimpan di tabel terpisah (`request_order_other_items`) dan bukan sebagai kolom di `request_order_items`. Kalau kamu tergoda menyederhanakannya jadi satu tabel, **baca §4.6 dulu, lalu bilang kalau masih tidak setuju** — jangan diam-diam menyimpang.

## Enam fase, kerjakan berurutan

Rencana §11 memuat keenamnya lengkap dengan kriteria selesainya. Ringkasnya:

0. Migrasi SQL + **backfill permission** + seed `MOCK_DB` + update `supabase_schema.sql` + `NOTIFY pgrst`.
1. Section + submenu + tab + daftar item + form Add/Edit + Delete.
2. Add Stock + modal Stock History.
3. Tab Stock Release + modal Release.
4. Sales Request: picker, simpan baris other item, tampilkan di Leader + kartu Order Requests + cetakan.
5. Pemotongan stok saat checkout.
6. (Opsional) badge low-stock di Dashboard.

Uji setiap fase sebelum lanjut. Jangan menumpuk enam fase lalu menguji sekali di ujung.

## Yang paling sering terlupa (rencana §12)

- **Backfill permission itu wajib.** Key baru yang tidak ada di baris `custom_roles` dibaca `false` — fitur tidak terlihat oleh siapa pun, termasuk Admin. Ini persis yang terjadi pada `purchase_request_view_own`.
- **`applyMenuVisibility()` js/auth.js:427** punya daftar subitem Inventory yang di-hardcode. Lupa menambah `sec-other-items` di sana = menu Inventory hilang untuk role yang hanya punya akses ke section ini.
- **Jangan pernah menulis `other_items.stock_qty` langsung.** Semua naik-turun lewat tiga RPC di §4.4, kalau tidak ledger melenceng diam-diam.
- **Kreditkan order dengan angka yang dikembalikan RPC**, bukan angka yang diminta.
- **Approval tidak memotong stok** — hanya checkout.
- **Tidak boleh ada teks Bahasa Indonesia di UI.** Semua lewat `t()` dengan key di `en` dan `ar`. Commit `69ca581` adalah pekerjaan membersihkan kebocoran yang persis seperti ini.
- **Bump `?v=`** di `index.html` untuk tiap file JS yang diubah, dan jalankan **`node test.js`** sebelum commit.

## Sebelum lapor selesai

Sebutkan mana yang sudah kamu uji sendiri di browser dan mana yang belum. Jangan menulis "selesai" untuk bagian yang belum pernah dijalankan.
