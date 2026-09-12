# Rencana: Field Customer Bisa Diketik (Typeahead) di Modal Sales Request

**Status:** Rencana, siap dikerjakan — **tapi harus menunggu**, lihat §7.1.
**Tanggal:** 2026-09-12

---

## 1. Masalahnya

Field Customer di modal Submit Sales Request adalah `<select>` biasa. User hanya bisa menggulir dan memilih; mengetik tidak melakukan apa-apa selain lompat ke huruf pertama.

Saat ini ada **38 customer** (34 Wholesale, 2 Retail, 2 Supermarket). Daftar sepanjang itu dalam dropdown yang tingginya terbatas membuat mencari satu nama jadi menggulir berkali-kali.

**Yang diminta user:**
- User bisa mengetik di field itu
- Daftar menyaring sendiri mengikuti huruf yang diketik, **atau nomor customer**
- Customer yang **belum terdaftar tidak boleh** masuk

---

## 2. Polanya sudah ada di aplikasi ini — tiru, jangan cipta ulang

Modal **Found Item** (Stock Opname) sudah menyelesaikan persoalan yang sama persis untuk kopi:

| Bagian | Di mana |
|---|---|
| `<input list="fi-coffee-list">` + `<datalist>` | `openFoundItemModal` di [js/app.js:5270](js/app.js:5270) |
| Format nilai `KODE — NAMA` | [js/app.js:5229](js/app.js:5229) — komentarnya menyebut ini "konvensi datalist" yang dipakai juga oleh `openCustomPackingModal` di js/packing.js |
| Peta `displayToName` untuk memulihkan identitas dari teks | [js/app.js:5235](js/app.js:5235) |
| Penolakan kalau yang diketik tidak ada di daftar | [js/app.js:5324](js/app.js:5324), key `alert_stockopname_found_unknown_coffee` |

Kalimat penolakannya bahkan sudah bernada tepat: *"Please pick a coffee from the list — this is for stock the system already knows about, not a brand new coffee."*

Datalist juga sudah dipakai di `js/greenbean.js:386` (origin) dan `sr-agent-list` di Stock Release. Jadi ini konvensi yang mapan, bukan barang baru.

**Penyaringan datalist mencocokkan substring dari `value`.** Dengan nilai `WHL-002 — jomo`, mengetik `jomo` maupun `WHL-002` sama-sama menemukannya — kedua syarat user terpenuhi tanpa kode penyaring buatan sendiri.

---

## 3. Yang hilang, dan kenapa itu tidak masalah di sini

`<datalist>` **tidak punya optgroup**, jadi tiga kepala kategori yang sekarang ada — 🏭 Wholesale, ☕ Retail, 🏬 Supermarket — akan hilang.

Menurut hitungan, itu kehilangan yang kecil:

- Dari 38 customer, **34 ada di Wholesale**. Satu grup memuat 89% isinya, jadi pengelompokan hampir tidak memisahkan apa pun.
- Kategorinya **tetap terbaca dari kodenya sendiri** — `WHL-`, `RTL-`, `SPM-`. Informasinya tidak hilang, hanya pindah tempat.
- Begitu user mengetik untuk menyaring, pengelompokan memang kehilangan gunanya.

**Alternatif yang ditolak:** combobox buatan sendiri (input + daftar kustom) mempertahankan kepala kategori dan bisa ditema gelap/terang. Tapi itu sekitar 150 baris dengan penanganan fokus, papan ketik, klik-di-luar, dan RTL — untuk mengembalikan pengelompokan yang 89% isinya menumpuk di satu grup. Tidak sepadan.

---

## 4. Aturan resolusi teks → customer

Nilai datalist: **`{customer_id} — {name}`**, contoh `WHL-002 — jomo`. Gunakan em-dash berspasi persis seperti konvensi yang ada, bukan tanda hubung biasa.

Saat submit, teks yang ada di input dipulihkan jadi `customer_id` (integer) dengan urutan:

1. Cocokkan **persis** dengan peta `displayToCustomerId` yang dibangun saat modal dibuka. Ini jalur normal — user memilih dari daftar.
2. Kalau gagal, ambil bagian sebelum ` — ` dan cocokkan dengan `customers.customer_id`. Ini menyelamatkan user yang mengetik `WHL-002` lalu berhenti tanpa memilih.
3. Kalau keduanya gagal → **tolak**, jangan simpan. Tampilkan bubble `showFieldWarn` di field itu dengan pesan yang menyebut bahwa customer harus dipilih dari daftar, dan arahkan ke tombol **Add New** di sebelahnya kalau memang customer baru.

**Jangan** mencoba mencocokkan hanya berdasarkan nama. Dua customer bisa bernama mirip, dan nama bisa berubah; `customer_id` unik dan stabil.

---

## 5. Empat hal yang WAJIB tetap bekerja

Field ini bukan dropdown polos — ada empat perilaku yang sudah melekat padanya dan gampang hilang saat diganti.

**5.1 — Penyaringan kategori.** Daftar yang ditawarkan harus tetap melewati `filterCustomersByAccess()`. Role yang hanya boleh Retail tetap hanya melihat customer Retail. Lihat `CUSTOMER_CATEGORY_ROLE_PLAN.md`.

**5.2 — Pengaman saat mengedit order.** Kalau order yang diedit memiliki customer di luar kategori role tersebut, customer itu **tetap harus ada** di daftar — kalau tidak, menyimpan ulang akan mengosongkan `customer_id`-nya. Logika ini sudah ada di `openSalesRequestModal`; pertahankan apa adanya, hanya ubah bentuk penyajiannya.

**5.3 — Tombol Add New.** Setelah customer baru dibuat lewat `openAddCustomerShortcutModal`, sekarang kodenya melakukan `customerSelect.value = newCustomer.id`. Dengan input, itu harus jadi: isi teks input dengan `{customer_id} — {name}` milik customer baru itu, **dan** perbarui peta resolusi supaya lolos validasi §4.

**5.4 — Field tetap wajib.** Handler submit memeriksa semua elemen `[required]` yang kosong lalu memanggil `showFieldWarn`. Input yang baru harus tetap membawa `required` supaya pemeriksaan itu ikut menangkapnya.

---

## 6. Fase pengerjaan

### Fase 1 — Ganti select jadi input + datalist

Di `openSalesRequestModal`: ganti `<select id="m-req-customer">` menjadi `<input type="text" id="m-req-customer" list="m-req-customer-list" required autocomplete="off">` plus `<datalist id="m-req-customer-list">`.

Bangun opsinya dari daftar yang **sudah tersaring** (§5.1 dan §5.2) dengan format `{customer_id} — {name}`, sekaligus membangun peta `displayToCustomerId`.

Saat mengedit order yang sudah punya customer, isi teks input dengan format yang sama.

*Verifikasi:* buka modal, ketik `jomo` → muncul `WHL-002 — jomo`. Ketik `WHL-03` → muncul semua customer berkode WHL-030 ke atas. Buka modal edit untuk order lama → nama customernya sudah terisi.

### Fase 2 — Resolusi dan penolakan

Terapkan §4 di handler submit. Teks yang tidak bisa dipulihkan → `showFieldWarn` pada field, dan submit dibatalkan.

Tambahkan key i18n baru di `en` dan `ar`, contoh `alert_customer_not_in_list`. Tiru nada kalimat `alert_stockopname_found_unknown_coffee`: sebutkan bahwa customer harus sudah terdaftar, dan sebut tombol Add New sebagai jalan keluarnya.

*Verifikasi:* ketik `pelanggan baru` lalu Review Order → ditolak dengan bubble, tidak ada yang tersimpan. Ketik `WHL-002` saja tanpa memilih → **diterima**, tersimpan dengan customer_id yang benar. Pilih dari daftar → tersimpan seperti biasa.

### Fase 3 — Tombol Add New

Perbarui callback `openAddCustomerShortcutModal` sesuai §5.3.

*Verifikasi:* klik Add New, buat customer, lalu langsung Review Order tanpa menyentuh field customer → tersimpan dengan customer baru itu, bukan kosong.

### Fase 4 — Uji batas kategori

*Verifikasi:* dengan role yang hanya boleh Retail, datalist hanya menawarkan customer Retail. Ketik kode Wholesale seperti `WHL-002` secara manual → **ditolak**, karena tidak ada di peta yang dibangun dari daftar tersaring. Ini penting: penyaringan kategori tidak boleh bisa ditembus dengan mengetik.

---

## 7. Ranjau yang harus diwaspadai

**7.1 — TUNGGU pekerjaan revisi approval selesai lebih dulu.**
Saat rencana ini ditulis, `APPROVAL_REVISION_PLAN.md` sedang dikerjakan dan sudah menambah ~422 baris di `js/sales.js` yang belum di-commit, termasuk di dalam handler submit `openSalesRequestModal` — file dan fungsi yang sama persis dengan yang disentuh rencana ini. Mengerjakan keduanya bersamaan berarti salah satu menimpa yang lain. **Mulai hanya setelah pekerjaan itu ter-commit.**

**7.2 — Datalist hanya menyarankan, tidak membatasi.**
Elemen `<input>` menerima teks apa pun. Yang menegakkan aturan "harus terdaftar" adalah kode di §4, bukan elemennya. Jangan berasumsi browser yang menjaga.

**7.3 — Penyaringan kategori harus dibangun dari daftar tersaring, bukan disaring saat validasi.**
Kalau peta resolusi dibangun dari seluruh customer lalu baru dicek izinnya saat submit, ada dua tempat yang bisa berbeda. Bangun peta itu dari hasil `filterCustomersByAccess()` saja — maka §4 dan §5.1 otomatis sejalan, dan Fase 4 lolos tanpa kode tambahan.

**7.4 — `value` datalist tidak boleh memuat kutip ganda mentah.**
Nama customer datang dari input user. Lolos begitu saja ke atribut `value="..."` akan merusak HTML-nya. Tangani seperti `buildCustomerFormFieldsHtml` menangani nama di js/sales.js.

**7.5 — Tampilan datalist dikendalikan browser.**
Popup-nya tidak mengikuti tema gelap aplikasi dan tidak bisa ditema. Ini konsekuensi yang diterima (§3), sama seperti tiga datalist lain yang sudah ada. Jangan menghabiskan waktu mencoba menemakannya.

**7.6 — Cache-busting.** Naikkan `?v=` untuk `js/sales.js` dan `js/translations.js`.

**7.7 — i18n.** Key baru wajib ada di `en` **dan** `ar`.

---

## 8. Di luar cakupan

- Mengubah field customer di layar lain (Customer Directory, laporan) — hanya modal Sales Request
- Membuat combobox kustom bertema — ditolak di §3
- Pencarian fuzzy atau toleransi salah ketik — penyaringan substring bawaan sudah cukup
- Mengizinkan pembuatan customer langsung dari ketikan — user secara eksplisit menolak; tombol Add New tetap satu-satunya jalan
