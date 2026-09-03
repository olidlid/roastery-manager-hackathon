# Label Test — Rencana Pengerjaan

**Status: SELESAI 2026-09-03.** Tab percobaan `Production → Label Test` sudah dibongkar setelah tujuannya tercapai; perbaikannya dipindahkan ke kode label yang asli (`buildFixedLabelDocument` di `js/packing.js`). Dokumen ini disimpan sebagai catatan, terutama §1 — daftar pendekatan yang sudah terbukti gagal secara fisik, supaya tidak ada yang mencobanya lagi.

## Hasil akhir

Ada **dua** masalah terpisah yang selama ini tersamar jadi satu:

1. **Orientasi — bukan di kode sama sekali.** Ukuran kertas driver diset "User defined" tanpa angka, jadi Chrome tidak punya kertas untuk dipetakan dan jatuh ke halaman portrait bawaannya. Perbaikannya di Windows, sekali per komputer: beri nama pada stock 50×25mm di driver Zebra (Print Server Properties → Forms **tidak berguna** — ZDesigner mengabaikan form Windows), lalu set Orientation = Landscape di **Printer properties → Advanced → Printing Defaults**, bukan di *Printing preferences*. Chrome membaca yang pertama. Perbedaan dua tempat inilah yang membuat percobaan lama menyimpulkan "orientasi driver sudah dicoba dan gagal".
2. **Ketajaman dan keterbacaan — ini di kode.** Barcode diregangkan ke lebar penuh (`width: 2.2` + `preserveAspectRatio="none"` + `width: 100%`), sehingga tepi modul jatuh di pecahan dot. Printer termal hanya bisa mencetak dot utuh, jadi sebagian batang membulat naik dan sebagian turun, perbandingan lebarnya tidak lagi sesuai Code128, dan pemindaian gagal meski labelnya terlihat rapi.

Perbaikan yang akhirnya masuk ke `js/packing.js`:

- Barcode memakai **dots-per-modul bilangan bulat** terbesar yang muat, lalu lebarnya ditetapkan dalam mm sehingga 1 unit SVG = 1 dot printer (terukur: viewBox 270 unit → 33,783mm → 269,998 dot).
- Jarak aman atas dan pemusatan vertikal: `padding: 1mm` simetris, plus `justify-content: center` pada `.barcode-label-main` — isinya ada satu tingkat lebih dalam, jadi memusatkan di tingkat luar saja tidak berpengaruh. Terukur seimbang: 2,29mm atas / 2,14mm bawah.

Tiga jalur diuji cetak fisik: **A bitmap** (geometri benar tapi kabur — kanvas mengabu-abukan tepi huruf, printer termal tidak punya abu-abu), **B ZPL** (jadi dan berfungsi, tidak dipakai), **C vektor** (menang, dan pendekatannya inilah yang dipindahkan ke kode lama).

Satu hal yang nyaris hilang kalau kode lama diganti total: barcode aslinya berisi `stripCode + multiplier` (`1032100` untuk bungkus, `1032112` untuk karton) — pembeda karton vs satuan yang tidak ada di kode percobaan.

---

**Tanggal:** 2026-09-03
**Tujuan awal:** Menulis ulang pencetakan label packed coffee dari nol di sebuah tab percobaan, tanpa membawa kode dan sejarah implementasi lama.

## Batasan yang diminta user

Kode proses cetak yang lama **tidak dibaca sama sekali** saat menyusun rencana ini. Yang dibaca hanya: skema tabel (`packed_coffee_lots`, `packaging_sizes`), struktur tab `#sec-roasting`, dan **sisi pemindai** (`matchAndSelectLot` di js/packing.js) — yang terakhir dipakai untuk memastikan isi barcode, bukan untuk meniru cara mencetak.

Desain dan komposisi label sudah final (sesuai foto) dan tidak diubah.

---

## 1. Kenapa yang lama gagal — dan apa yang belum pernah dicoba

Dari catatan uji cetak fisik sebelumnya (Zebra ZDesigner GK420t, label 50×25mm): hasilnya selalu **portrait dan terpotong**, padahal harus landscape.

Empat pendekatan sudah diuji cetak fisik dan **terbukti gagal** — tidak boleh diulang:

1. Tanpa `@page size`, item `width:100%` → tumpah ke label berikutnya.
2. `@page { size: 50mm 25mm }`, tanpa rotasi CSS, driver = Landscape → portrait/terpotong.
3. `@page { size: 25mm 50mm }` + `transform: rotate(90deg)`, driver = Landscape → terbaca menyamping.
4. `@page { size: 50mm 25mm }`, tanpa rotasi CSS, driver = Portrait → sama saja.

Juga sudah terbukti: **dropdown Portrait/Landscape di dialog cetak Chrome hanya mengubah pratinjau layar, tidak pernah mengubah kertas.**

Benang merahnya: keempatnya sama-sama menyerahkan **tata letak teks** ke mesin layout CSS, lalu berharap driver menghormati ukuran halaman. Itu yang tidak pernah terjadi. Maka trial ini sengaja tidak menambah kombinasi CSS baru — ia mencoba dua jalur yang secara mendasar berbeda.

**Konsekuensi cara kerja:** kegagalannya tidak terlihat di pratinjau Chrome (konten berukuran persen selalu terlihat pas). **Hanya cetak fisik yang membuktikan apa pun.** Tab ini dirancang untuk itu — mencetak beberapa varian cepat, lalu membandingkan kertasnya.

---

## 2. Komposisi label (tetap, sesuai foto)

Area kiri (utama):

1. Barcode Code128, melebar penuh
2. Di bawahnya `lot_code` — teks besar monospace, mis. `50-1090126-1`
3. Di bawahnya ukuran — tebal, lebih kecil, mis. `1KG`

Garis putus-putus vertikal sebagai pemisah sobek, lalu area kanan (strip sempit): `strip_code` diputar 90°, tebal, mis. `10321`.

### Isi data

| Bagian | Sumber |
|---|---|
| Barcode (isi terpindai) | `packed_coffee_lots.strip_code` |
| Teks besar | `packed_coffee_lots.lot_code` |
| Ukuran | `packaging_sizes.label` (fallback: `gram`, 1000 → `1KG`) |
| Strip vertikal | `packed_coffee_lots.strip_code` |

Barcode berisi `strip_code`, **bukan** `lot_code` — dibuktikan dari sisi pemindai: `matchAndSelectLot` menguji `/^\d{5,7}$/` lalu memotong 5 karakter pertama untuk dicocokkan ke `strip_code`, dan placeholder input scan-nya `20037`. (Pemindai sebenarnya menerima `lot_code` juga, jadi ini bisa diverifikasi ulang dengan memindai label hasil cetak trial.)

---

## 3. Dua jalur yang dicoba

### Jalur A — bitmap presisi dot printer

Gambar seluruh label ke `<canvas>` berukuran **400 × 200 piksel** (50×25mm pada 203 dpi, resolusi asli GK420t), lalu cetak canvas itu sebagai satu gambar berukuran fisik tepat 50mm × 25mm.

Bedanya dari keempat percobaan lama: tidak ada teks yang di-layout saat mencetak. Satu bitmap hanya bisa diskalakan atau dipotong — tidak bisa mengalir ulang. Kalau tetap terpotong, potongannya seragam dan langsung menunjukkan skala berapa yang dipakai driver, sesuatu yang tidak pernah bisa disimpulkan dari percobaan berbasis teks.

Barcode digambar dengan JsBarcode (sudah tersedia via CDN) ke canvas yang sama.

### Jalur B — ZPL, bahasa printer itu sendiri

GK420t berbicara ZPL II. Menyusun ZPL berarti melewati **mesin layout browser dan model halaman driver sekaligus** — printer yang menentukan posisi, dan barcode dirender oleh firmware printer (paling tajam, tanpa penskalaan).

Kerangka awal (koordinat disetel saat trial):

```
^XA
^PW400
^LL200
^FO16,16^BCN,80,N,N,N^FD{strip_code}^FS
^FO16,110^A0N,42,42^FD{lot_code}^FS
^FO16,160^A0N,28,28^FD{size}^FS
^FO360,30^A0B,30,30^FD{strip_code}^FS
^XZ
```

**Pengiriman ke printer — bertahap, jangan langsung yang rumit:**

- **B1 (dikerjakan di trial ini):** unduh berkas `.zpl`, kirim ke printer lewat Zebra Setup Utilities atau perintah `copy /b`. Jelek secara alur, tapi **membuktikan benar/tidaknya ZPL tanpa memasang apa pun**.
- **B2 (hanya kalau B1 terbukti benar):** Zebra Browser Print — agen lokal resmi Zebra + API JavaScript di localhost, sehingga tombol cetak bisa langsung jalan. Perlu pemasangan di PC roastery, dan perlu dicek apakah panggilan ke localhost lolos CSP halaman HTTPS.
- **B3 (cadangan):** WebUSB, tanpa pemasangan, tapi biasanya gagal karena driver Windows sudah mengklaim perangkatnya.

Urutan ini disengaja: B1 murah dan menjawab pertanyaan terpenting — *apakah ZPL menghasilkan label yang benar?* Investasi B2 baru masuk akal setelah itu terjawab.

---

## 4. Tab Label Test

Tab baru di `#sec-roasting` (index.html:794), setelah `Daily Achievement`. Dispatcher-nya `loadRoastingTabSpecificData` (js/roasting.js:11), izin didaftarkan di `TAB_PERMISSIONS` (js/app.js:1268).

Isi tab:

**Sumber data** — dua mode:

- *Lot nyata*: dropdown lot terbaru (`lot_code · strip_code · ukuran`)
- *Manual*: tiga kolom isian bebas (strip code, lot code, ukuran) supaya bisa menguji tanpa bergantung data asli

**Pratinjau layar** — render canvas 400×200 ditampilkan diperbesar, sebagai kontrol visual komposisi. Diberi catatan tegas bahwa **pratinjau tidak membuktikan hasil cetak**.

**Tombol cetak, satu per jalur:** "Cetak A (bitmap)" dan "Unduh B (ZPL)".

**Penanda varian** — huruf kecil `A`/`B` dicetak di pojok label selama trial, supaya saat beberapa label fisik sudah tercetak masih bisa dibedakan asalnya. Bisa dimatikan lewat centang. Ini murni alat bantu trial, tidak masuk ke label produksi.

**Catatan hasil** — kotak teks kecil untuk menuliskan hasil tiap percobaan (disimpan di localStorage saja, bukan database) supaya riwayat percobaan tidak hilang antar sesi dan tidak terulang seperti sebelumnya.

Tab digerbangi izin Developer/Admin — ini alat percobaan, bukan fitur untuk tim produksi.

---

## 5. Fase pengerjaan

**Fase 0 — kerangka tab.** Tab `Label Test`, dispatcher, izin, pemilih lot + mode manual. Belum ada pencetakan.
*Verifikasi:* `node test.js` lulus; tab muncul untuk Developer, tidak muncul untuk role lain.

**Fase 1 — renderer canvas.** Fungsi tunggal yang menggambar komposisi §2 ke canvas 400×200, dipakai bersama oleh pratinjau dan jalur A.
*Verifikasi:* pratinjau layar cocok dengan foto; teks panjang (`CHAMBAKUSI-2081526-2`) tidak meluber.

**Fase 2 — jalur A.** Cetak canvas sebagai gambar 50×25mm.
*Verifikasi:* **cetak fisik.** Catat: landscape atau portrait, terpotong atau tidak, dan berapa bagian area yang terpakai.

**Fase 3 — jalur B1.** Susun ZPL, unduh `.zpl`, kirim manual ke printer.
*Verifikasi:* **cetak fisik**, lalu **pindai label hasilnya** dengan input scan di Stock Release untuk memastikan barcode benar-benar terbaca sebagai `strip_code`.

**Fase 4 — putuskan.** Berdasarkan dua kertas fisik itu, pilih satu jalur untuk dijadikan implementasi tetap. Kalau ZPL yang menang, barulah pertimbangkan B2 (Zebra Browser Print) supaya tombolnya bisa langsung mencetak.

Tidak ada fase "ganti kode lama" dalam rencana ini. Selama trial, alur cetak label yang sekarang **dibiarkan utuh dan tidak disentuh** — penggantian baru dibahas setelah ada jalur yang terbukti secara fisik.

---

## Lampiran — jebakan khusus masalah ini

- **Pratinjau Chrome selalu terlihat benar.** Jangan pernah menyimpulkan apa pun darinya.
- **Dropdown Layout di dialog cetak Chrome tidak berpengaruh ke kertas.** Sudah terbukti fisik.
- **Radio Portrait/Landscape di driver juga tidak berpengaruh** (terbukti pada percobaan 2 dan 4).
- Driver Stocks terkalibrasi 1.97 × 0.98 inci, `rotate 180` tidak dicentang — jangan diubah tanpa mencatat, karena semua hasil uji lama mengacu ke kalibrasi ini.
- Kolom `Scale` di dialog cetak Chrome belum pernah diperiksa; kalau jalur A tercetak benar tapi ukurannya meleset, ke situ arah pemeriksaan berikutnya.
