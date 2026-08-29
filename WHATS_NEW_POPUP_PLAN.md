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
| Frekuensi | Sekali per versi, per perangkat | |
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
Baca localStorage: versi terakhir yang sudah dilihat
   ↓
   ├─ sama dengan versi terbaru  →  tidak melakukan apa-apa
   └─ beda / belum ada           →  tampilkan popup
                                      ↓
                                 user menutup  →  simpan versi terbaru ke localStorage
```

**Penting:** yang disimpan adalah **versi rilis terakhir yang dilihat**, bukan flag benar/salah. Dengan begitu rilis berikutnya otomatis memunculkan popup lagi tanpa perlu menghapus apa pun.

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
                ar: '...'
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

Sederhana, tidak perlu berlebihan:

- Overlay gelap, kartu di tengah, lebar sekitar 480px
- Judul: **What's New** + tanggal rilis
- Daftar butir perubahan, tiap butir dengan penanda kecil
- Tombol tunggal: **Mengerti** / **Got it** — menutup dan menyimpan versi
- Tombol X di pojok juga menutup dan menyimpan (perlakuan sama, supaya popup tidak muncul lagi hanya karena user menutup lewat X)
- Tutup dengan tombol Escape juga menyimpan

Ikuti token warna yang ada (`var(--bg-app)`, `var(--text-primary)`, dst.) — **jangan hardcode warna**, aturan proyek ini.

---

## 6. Fase pengerjaan

Kecil, cukup dua fase.

### Fase 1 — Popup + penyimpanan versi

- Tambahkan `WHATS_NEW_VERSION` dan `WHATS_NEW_RELEASES` di `js/app.js`.
- Tambahkan `checkWhatsNewPopup()` mengikuti bentuk `checkStockFreezeBanner()` — async, try/catch, tidak memblokir.
- Panggil dari `case 'sec-handover':` di `loadSectionData()`.
- Overlay sendiri, bukan `openModal()`.
- Simpan versi ke `localStorage` saat ditutup (lewat tombol, X, maupun Escape).
- Bungkus akses `localStorage` dengan try/catch — mode privat browser bisa melempar error, dan popup yang gagal tidak boleh merusak halaman.

**Verifikasi:**
1. `node test.js` lulus.
2. Buka Item Request → popup muncul.
3. Tutup → buka halaman lain → kembali ke Item Request → **tidak muncul lagi**.
4. Hapus kunci di localStorage lewat console → buka lagi → muncul lagi.
5. Ubah `WHATS_NEW_VERSION` ke nilai baru → buka lagi → muncul lagi (ini yang membuktikan rilis berikutnya akan terdeteksi).
6. Buka halaman selain Item Request → popup **tidak** muncul.
7. Tutup lewat tombol X dan lewat Escape → keduanya harus ikut menyimpan.

### Fase 2 — i18n + rilis

- Kunci baru (judul, tombol, label) ke **`en` dan `ar`** di `js/translations.js`.
- Isi butir perubahan dua bahasa.
- Bump `?v=` untuk `js/app.js` dan `js/translations.js` di `index.html`.
- Ganti bahasa ke Arab, buka Item Request, pastikan popup ikut berganti bahasa dan tata letaknya tidak rusak dalam mode RTL.

---

## 7. Yang sengaja tidak dikerjakan

Dicatat supaya tidak dianggap kelalaian:

- **Tidak ada cara membuka ulang popup.** Setelah ditutup, user tidak bisa melihatnya lagi sampai rilis berikutnya. Kalau nanti terasa perlu, tambahkan tautan kecil "What's new" di Settings — perubahannya kecil karena datanya sudah ada.
- **Tidak per-user lintas perangkat.** Konsekuensi memilih `localStorage`: user yang membuka di HP akan melihatnya sekali lagi di sana. Kalau ini mengganggu, pindahkan ke kolom di tabel `profiles` — perlu migrasi kolom nullable (aman terhadap trigger `handle_new_user` karena trigger itu menulis kolom tertentu saja).
- **Tidak ada penargetan per role.** Semua yang bisa membuka Item Request akan melihatnya.

---

## Lampiran — Daftar periksa

- [ ] `node test.js` lulus
- [ ] Bump `?v=` di `index.html` untuk setiap file yang berubah
- [ ] String baru ada di **`en` dan `ar`**
- [ ] Warna lewat CSS custom property
- [ ] Akses `localStorage` dibungkus try/catch
- [ ] Diuji dalam mode RTL (bahasa Arab)
- [ ] Setelah push, tunggu Vercel "Ready", hard refresh, verifikasi live

## Lampiran — Jebakan khusus repo ini

- **`openModal` memakai satu `#modal-container` bersama** — modal apa pun yang dibuka di atasnya akan menimpanya. Pakai overlay sendiri.
- **`.btn` mengalahkan atribut `[hidden]`** (`display:inline-flex` menang atas default UA). Kalau ada tombol yang disembunyikan lewat `[hidden]`, tambahkan override `[hidden] { display: none !important; }`.
- **`js/app_backup.js` bukan bagian aplikasi** — pencarian teks akan menemukannya, abaikan.
