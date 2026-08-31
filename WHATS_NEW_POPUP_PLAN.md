# Popup "What's New" — Rencana Pengerjaan

**Status:** Rancangan, belum dikerjakan
**Tanggal:** 2026-08-29
**Tujuan:** Memberi tahu pengguna bahwa aplikasi baru saja diperbarui, lewat popup yang muncul sekali saat mereka membuka halaman Item Request.

Rencana ini ditulis agar bisa dikerjakan tanpa percakapan yang menghasilkannya. Anchor file/baris sudah diverifikasi terhadap kode per 2026-08-29.

---

## 1. Keputusan desain (sudah disepakati)

| Hal | Keputusan | Alasan |
|---|---|---|
| Pemicu | Saat membuka halaman **Item Request** (`sec-handover`) | Permintaan eksplisit; pembaruan terbesar memang ada di alur itu |
| Bentuk | **Satu fitur per halaman**, dengan tombol Berikutnya sampai halaman terakhir | Tiap perubahan dapat ruang untuk gambar before/after-nya sendiri |
| Selesai membaca | Menekan **Selesai** di halaman terakhir → rilis ini ditandai sudah dilihat | |
| Ditutup di tengah | Lewati / tombol X / Escape → **ditunda 1 jam**, lalu muncul lagi saat membuka Item Request berikutnya | User yang sedang buru-buru tidak dipaksa, tapi pengumumannya tidak hilang begitu saja |
| Kotak centang | **Mematikan permanen untuk semua rilis berikutnya**, bukan hanya rilis ini | Pilihan sadar user yang memang tidak mau diganggu sama sekali |
| Jalan kembali | Wajib ada entri **Setting › What's new** | Tanpa ini, sekali centang berarti terputus permanen tanpa cara membatalkan — lihat §7 |
| Penyimpanan status | `localStorage` | Tanpa migrasi database. Kalau user buka di HP, muncul sekali lagi di sana — untuk pengumuman ini wajar |
| Sumber konten | Array di dalam file JS | Entri ditambahkan di commit yang sama dengan fiturnya, jadi konten dan kode selalu sinkron |
| Cakupan | Semua yang punya akses Item Request | Sederhana, tidak ada yang terlewat |

---

## 2. Cara kerja

```
User klik "Item Request"
   ↓
navigateTo('sec-handover')  →  loadSectionData('sec-handover')
   ↓
checkWhatsNewPopup()  (fire-and-forget, tidak memblokir loading halaman)
   ↓
Baca localStorage
   ↓
   ├─ opt-out permanen aktif        →  tidak melakukan apa-apa
   ├─ versi terlihat == versi kini  →  tidak melakukan apa-apa
   ├─ ditunda & belum lewat 1 jam   →  tidak melakukan apa-apa
   └─ selain itu                    →  tampilkan popup di halaman 1
                                          ↓
                        ┌─────────────────┴─────────────────┐
                        ↓                                   ↓
              Selesai (halaman akhir)            Lewati / X / Escape
                        ↓                                   ↓
              simpan versi terlihat              simpan waktu tunda = sekarang
              (+ opt-out bila dicentang)         (versi TIDAK ditandai terlihat)
```

**Tiga kunci `localStorage` terpisah**, jangan digabung jadi satu:

| Kunci | Isi | Guna |
|---|---|---|
| `whatsnew_seen_version` | string versi, mis. `'2026-08-29'` | Rilis yang sudah benar-benar tuntas dibaca |
| `whatsnew_snoozed_at` | timestamp epoch | Penundaan 1 jam saat ditutup di tengah |
| `whatsnew_opt_out` | `'1'` | Mematikan permanen untuk semua rilis |

Yang disimpan di kunci pertama adalah **versi**, bukan flag benar/salah — dengan begitu rilis berikutnya otomatis memunculkan popup lagi tanpa perlu menghapus apa pun.

**Penundaan harus dibersihkan saat rilis berganti.** Kalau `whatsnew_snoozed_at` masih tersisa dari rilis sebelumnya, rilis baru bisa ikut tertunda tanpa alasan. Simpan versi bersama timestamp-nya, atau hapus kunci tunda begitu versi terdeteksi berbeda.

---

## 3. Titik sambung di kode

| Kebutuhan | Lokasi | Catatan |
|---|---|---|
| Pemicu | `js/app.js:896-903`, `case 'sec-handover':` di dalam `loadSectionData()` | Panggil `checkWhatsNewPopup()` di akhir case ini |
| Pola fungsi | `checkStockFreezeBanner()` (`js/app.js:572-594`) | Contoh yang sudah ada: async, dibungkus try/catch, gagal diam-diam tanpa merusak navigasi |
| Pola overlay | `openAddCustomerShortcutModal()` (`js/sales.js`) | Overlay sendiri dengan `z-index: 2000` |
| Nama section | `sec-handover` = "Item Request" (`js/translations.js:9`, `nav_handover`) | Jangan tertukar dengan tab "Order Requests" di menu Packing |

**Jangan pakai `openModal()`.** Fungsi itu memakai satu `#modal-container` bersama (`js/app.js:1402-1413`); kalau nanti ada modal lain terbuka, popup ini akan menimpanya. Pakai overlay sendiri seperti pola quick-add-customer.

---

## 4. Struktur konten

Satu konstanta di bagian atas file, isinya daftar rilis terbaru lebih dulu:

```js
const WHATS_NEW_VERSION = '2026-08-29';   // dibandingkan dengan localStorage

const WHATS_NEW_RELEASES = [
    {
        version: '2026-08-29',
        date: '29-08-2026',
        items: [
            {
                en: 'Add a new customer directly from the Sales Request form',
                ar: '...',
                // Opsional — hanya untuk perubahan yang memang layak
                // ditunjukkan. Butir tanpa gambar tetap sah.
                before: 'images/whatsnew/2026-08-29/add-customer-before.png',
                after:  'images/whatsnew/2026-08-29/add-customer-after.png',
                alt: { en: 'Sales Request form', ar: '...' }
            },
            // ...
        ]
    },
    // rilis lama boleh tetap di sini untuk riwayat
];
```

**Aturan i18n berlaku untuk konten ini juga.** Proyek ini mensyaratkan setiap teks yang dilihat pengguna tersedia dalam `en` dan `ar` (lihat `CLAUDE.md`). Jadi tiap butir perubahan ditulis dua bahasa. Judul popup, tombol, dan label tanggal tetap lewat `window.t()` dengan kunci di `js/translations.js` seperti biasa.

> **Konsekuensi yang harus disadari:** mulai sekarang, setiap kali ship fitur yang terlihat pengguna, ada satu langkah tambahan — menambah entri di sini (dua bahasa) dan menaikkan `WHATS_NEW_VERSION`. Kalau langkah ini terlupa, popup tidak muncul dan pengguna tidak tahu ada pembaruan. Ini konsekuensi wajar dari memilih konten di dalam kode, bukan kelemahan yang bisa dihilangkan.

### Isi untuk rilis pertama

Ambil dari commit yang sudah live sejak beberapa hari terakhir:

- Tombol **Add New** untuk menambah customer langsung dari form Sales Request, tanpa kehilangan isian yang sedang dikerjakan (`aeadc33`)
- Tanggal batch roasting kini mengikuti tanggal terakhir yang dipilih pada hari itu, dan otomatis kembali ke hari ini setiap ganti hari (`a028b78`)
- Kartu Preparing Sales Orders dirapikan — ukuran dan mesin tidak lagi terpotong ke baris berikutnya (`b0d6800`)
- Semua customer kini bertipe Wholesale (`14c361c`)

Sesuaikan lagi saat mengerjakan; kalau perombakan modal Sales Order (`SALES_ORDER_REDESIGN_PLAN.md`) sudah live lebih dulu, itu justru butir yang paling penting untuk diumumkan.

---

## 5. Tampilan popup

- Overlay gelap, kartu di tengah, lebar sekitar **760px** (perlu ruang untuk sepasang gambar berdampingan), tinggi maksimal `85vh` dengan isi yang bisa digulung
- Judul: **What's new** + tanggal rilis, tetap terlihat di semua halaman
- **Satu fitur per halaman**: judul fitur, penjelasan singkat, lalu pasangan gambar Sebelum/Sesudah (§5.1)
- **Titik indikator** di kiri bawah menunjukkan jumlah halaman dan posisi saat ini — tanpa ini alur "berikutnya" terasa tidak berujung
- Tombol kanan bawah: **Berikutnya** di halaman non-terakhir, **Selesai** di halaman terakhir
- **Kembali** muncul mulai halaman kedua
- **Lewati** di halaman non-terakhir — menutup dengan penundaan 1 jam, sama seperti X
- Tombol X dan Escape: sama dengan Lewati (tunda 1 jam), **bukan** menandai sudah dibaca
- **Kotak centang hanya di halaman terakhir.** Labelnya harus menyebut konsekuensinya secara eksplisit — bukan sekadar "jangan tampilkan lagi", tapi bahwa pembaruan berikutnya ikut dimatikan, beserta cara mengaktifkannya kembali

Ikuti token warna yang ada (`var(--bg-app)`, `var(--text-primary)`, dst.) — **jangan hardcode warna**, aturan proyek ini.

### 5.1 Gambar before/after

**Penyimpanan: file statis biasa.** Sudah diverifikasi live 2026-08-29 bahwa `vercel.json` yang me-rewrite semua rute ke `index.html` **tidak** mengganggu file statis — Vercel melayani berkas yang benar-benar ada lebih dulu. Diuji dengan `curl`: PNG di root kembali sebagai `image/png` (200), sementara path yang tidak ada baru jatuh ke `index.html`. Jadi tidak perlu base64, dan `js/app.js` tidak ikut membengkak.

Letakkan di folder ber-versi:

```
images/whatsnew/2026-08-29/add-customer-before.png
images/whatsnew/2026-08-29/add-customer-after.png
```

Folder per tanggal rilis supaya gambar rilis lama tidak tertimpa saat rilis berikutnya memakai nama file yang mirip.

**Tata letak.** Dua gambar berdampingan dengan label kecil *Sebelum* dan *Sesudah* di atasnya; menumpuk jadi satu kolom di layar sempit (`grid-template-columns: 1fr 1fr` → `1fr` di bawah ~640px). Beri `border` tipis dan `border-radius` supaya batas gambar jelas terhadap latar kartu.

**Wajib pada tiap `<img>`:**
- `loading="lazy"` — popup bisa memuat beberapa pasang gambar
- `width`/`height` atau `aspect-ratio` — mencegah isi melompat saat gambar selesai dimuat
- `alt` yang bermakna, diambil dari `alt.en`/`alt.ar` sesuai bahasa aktif
- `max-width: 100%` — jangan sampai gambar melebarkan kartu

**Ukuran berkas.** Lebar sumber cukup ~1200px, kompres hingga di bawah ~150KB per gambar. Repo ini sudah punya PNG ~45KB sebagai pembanding. Gambar ikut ter-commit selamanya, jadi jangan memasukkan tangkapan layar mentah beresolusi penuh.

> **Keputusan (2026-08-29): tema terang saja.** Semua tangkapan layar before/after diambil dalam mode terang, apa pun tema yang sedang aktif di browser user saat popup tampil. Diredam dengan bingkai netral (`border` + `border-radius`, §5.1 di atas) supaya tetap terlihat rapi di atas kartu bertema gelap. Tidak perlu menyiapkan dua set gambar per rilis.

**RTL.** Dalam mode Arab, urutan Sebelum/Sesudah akan terbalik mengikuti arah baca — itu benar dan diinginkan. Yang perlu dipastikan hanya labelnya ikut berpindah bersama gambarnya, bukan tertukar.

---

## 6. Fase pengerjaan

Tiga fase. Fase 1 sudah menghasilkan popup yang berfungsi; gambar menyusul di Fase 2 supaya kalau ada masalah, jelas bagian mana penyebabnya.

### Fase 1 — Popup bertahap + tiga status penyimpanan

- Tambahkan `WHATS_NEW_VERSION` dan `WHATS_NEW_RELEASES` di `js/app.js`.
- Tambahkan `checkWhatsNewPopup()` mengikuti bentuk `checkStockFreezeBanner()` — async, try/catch, tidak memblokir.
- Panggil dari `case 'sec-handover':` di `loadSectionData()`.
- Overlay sendiri, bukan `openModal()`.
- Navigasi antar halaman: Berikutnya / Kembali / titik indikator / Lewati.
- Terapkan tiga kunci `localStorage` (§2) berikut pembersihan kunci tunda saat versi berganti.
- Bungkus **setiap** akses `localStorage` dengan try/catch — mode privat browser bisa melempar error, dan popup yang gagal tidak boleh merusak halaman.

**Verifikasi:**
1. `node test.js` lulus.
2. Buka Item Request → popup muncul di halaman 1.
3. Berikutnya sampai halaman terakhir → titik indikator ikut berpindah → **Selesai** → tutup.
4. Kembali ke Item Request → **tidak muncul lagi**.
5. Ubah `WHATS_NEW_VERSION` → buka lagi → **muncul lagi** (bukti rilis berikutnya terdeteksi).
6. Buka halaman selain Item Request → popup **tidak** muncul.
7. **Uji penundaan:** buka popup → tekan Lewati → langsung buka Item Request lagi → **tidak muncul**. Lalu majukan `whatsnew_snoozed_at` mundur >1 jam lewat console → buka lagi → **muncul lagi**. Ulangi untuk tombol X dan Escape.
8. **Uji penundaan tidak bocor antar rilis:** dalam keadaan tertunda, ubah `WHATS_NEW_VERSION` → buka lagi → harus **langsung muncul**, tidak ikut tertunda.
9. **Uji opt-out:** centang di halaman terakhir → Selesai → ubah `WHATS_NEW_VERSION` → buka lagi → tetap **tidak muncul**.

### Fase 2 — Gambar before/after

- Buat folder `images/whatsnew/<versi>/`, masukkan pasangan gambar yang sudah dikompres.
- Tambahkan dukungan field `before`/`after`/`alt` pada renderer butir (§4). Butir **tanpa** gambar harus tetap tampil normal — jangan sampai renderer mengasumsikan gambar selalu ada.
- Terapkan tata letak §5.1: dua kolom, menumpuk di layar sempit, `loading="lazy"`, dimensi eksplisit, `alt` sesuai bahasa.
- Ambil keputusan soal tema tangkapan layar (§5.1) dan catat pilihannya di komentar kode, supaya rilis berikutnya konsisten.

**Verifikasi:**
1. Popup menampilkan pasangan gambar dengan label Sebelum/Sesudah.
2. Butir tanpa gambar tetap tampil rapi di daftar yang sama.
3. Perkecil lebar jendela → gambar menumpuk, kartu tidak melebar keluar layar.
4. Cek di tema terang **dan** gelap.
5. Buka lewat URL produksi (bukan hanya localhost) → gambar benar-benar termuat, bukan 404 yang jatuh ke `index.html`. Ini pembuktian nyata bahwa rewrite Vercel tidak mengganggu.
6. Matikan jaringan setelah halaman termuat lalu buka popup → gambar gagal muat tidak boleh merusak tata letak (`alt` tampil, kartu tetap utuh).

### Fase 3 — Jalan kembali di Setting + i18n + rilis

- **Tambahkan entri "What's new" di Setting.** Fungsinya dua: membuka kembali popup kapan saja, dan **membatalkan opt-out permanen**. Tanpa ini, kotak centang di Fase 1 adalah pintu satu arah.
- Kunci baru (judul, tombol, label, teks penjelas kotak centang) ke **`en` dan `ar`** di `js/translations.js`.
- Isi butir perubahan dua bahasa.
- Bump `?v=` untuk `js/app.js` dan `js/translations.js` di `index.html`.
- Ganti bahasa ke Arab, buka Item Request, pastikan popup ikut berganti bahasa dan tata letaknya tidak rusak dalam mode RTL.

**Verifikasi:** centang opt-out → pastikan popup mati → buka Setting › What's new → popup terbuka lagi dan opt-out ikut batal → buka Item Request pada rilis berikutnya → muncul normal.

---

## 7. Yang sengaja tidak dikerjakan

Dicatat supaya tidak dianggap kelalaian:

> **Catatan: satu hal yang tadinya di daftar ini sekarang WAJIB dikerjakan.** Rencana versi awal menyebut "tidak ada cara membuka ulang popup" sebagai kelalaian yang bisa diterima — karena saat itu popup otomatis muncul lagi tiap rilis. Setelah kotak centang berubah arti menjadi **mematikan permanen untuk semua rilis**, tidak adanya jalan kembali berarti sekali centang user terputus selamanya tanpa cara membatalkan. Entri **Setting › What's new** karena itu masuk lingkup kerja (Fase 3), bukan opsional.
- **Gambar tidak bisa diperbesar (tanpa lightbox).** Gambar tampil apa adanya di dalam kartu. Kalau detailnya terlalu kecil untuk dibaca, obat pertamanya adalah memotong tangkapan layar lebih rapat pada bagian yang berubah — bukan menambah lightbox. Memotong lebih rapat juga membuat berkasnya lebih kecil.
- **Gambar tidak diterjemahkan.** Tangkapan layar akan menampilkan antarmuka dalam satu bahasa saja, apa pun bahasa yang sedang aktif. Hanya teks `alt` yang mengikuti bahasa. Menyiapkan tangkapan layar per bahasa berarti menggandakan pekerjaan tiap rilis, dan tidak sepadan untuk pengumuman sesaat.
- **Tidak per-user lintas perangkat.** Konsekuensi memilih `localStorage`: user yang membuka di HP akan melihatnya sekali lagi di sana. Kalau ini mengganggu, pindahkan ke kolom di tabel `profiles` — perlu migrasi kolom nullable (aman terhadap trigger `handle_new_user` karena trigger itu menulis kolom tertentu saja).
- **Tidak ada penargetan per role.** Semua yang bisa membuka Item Request akan melihatnya.

---

## Lampiran — Daftar periksa

- [ ] `node test.js` lulus
- [ ] Bump `?v=` di `index.html` untuk setiap file yang berubah
- [ ] String baru ada di **`en` dan `ar`**
- [ ] Warna lewat CSS custom property
- [ ] Akses `localStorage` dibungkus try/catch
- [ ] Penundaan 1 jam diuji, termasuk tidak bocor ke rilis berikutnya
- [ ] Opt-out permanen diuji, **dan** bisa dibatalkan lewat Setting
- [ ] Label kotak centang menyebut konsekuensinya secara eksplisit
- [ ] Diuji dalam mode RTL (bahasa Arab)
- [ ] Gambar dikompres (<150KB) dan diletakkan di folder ber-versi
- [ ] Tiap `<img>` punya `alt`, `loading="lazy"`, dan dimensi eksplisit
- [ ] Butir tanpa gambar tetap tampil normal
- [ ] Gambar diuji termuat di **URL produksi**, bukan hanya localhost
- [ ] Setelah push, tunggu Vercel "Ready", hard refresh, verifikasi live

## Lampiran — Jebakan khusus repo ini

- **`openModal` memakai satu `#modal-container` bersama** — modal apa pun yang dibuka di atasnya akan menimpanya. Pakai overlay sendiri.
- **`.btn` mengalahkan atribut `[hidden]`** (`display:inline-flex` menang atas default UA). Kalau ada tombol yang disembunyikan lewat `[hidden]`, tambahkan override `[hidden] { display: none !important; }`.
- **`js/app_backup.js` bukan bagian aplikasi** — pencarian teks akan menemukannya, abaikan.
- **`vercel.json` me-rewrite semua rute ke `index.html`, tapi file statis tetap aman.** Vercel melayani berkas yang benar-benar ada lebih dulu; rewrite hanya menangkap rute yang tidak cocok dengan berkas mana pun. Sudah diuji 2026-08-29. Konsekuensinya: gambar yang **salah nama/path tidak akan memberi 404** — ia mengembalikan `index.html` dengan status 200, dan `<img>` gagal tanpa pesan yang jelas. Kalau gambar tidak muncul, periksa nama berkasnya lebih dulu sebelum mencurigai hal lain.
