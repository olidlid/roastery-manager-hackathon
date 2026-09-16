# Prompt Sonnet: perbaikan hasil uji live fitur Autofill checkout

## Konteks

Pekerjaanmu di commit `7af6953` sudah **diuji live di produksi** (packing.js v128, sales.js v55) memakai satu order uji BRAZIL ROSA 250g yang disetujui sungguhan: 4 pcs dari stok saat approval, 6 pcs ke produksi. Order uji itu sudah dihapus dan semua lot kembali persis ke saldo awal.

**Yang terbukti benar dan jangan dibongkar:** Autofill mengikuti FIFO tanpa menulis ke basis data; dialog dua pilihan dan tombol Kembali menjaga isi keranjang; pilihan 1 dan pilihan 2 mencatat kolom dengan benar, dengan jumlah terpotong di buku besar selalu sama dengan `quantity_prepared`; kartu Partially Dispatched; dan **reset panel kanan memulangkan stok persis per lot**, kolom STOCK naik tanpa menutup modal, rumus `min(allocated_lama, prepared_baru)` benar, penanganan `null` dari `refund_packed_lot` benar. Sesudah reset, Autofill kembali mengambil lot tertua yang baru dipulangkan — perilaku FIFO yang benar.

Ada dua bug nyata dan beberapa temuan kecil. Kerjakan semuanya dalam satu commit.

---

## Bug 1 — Reset menghapus keputusan leader (menyangkut stok)

### Masalahnya

`resetCommittedItem` di `js/packing.js:3039` menulis `item.quantity_unfulfilled = 0` tanpa syarat.

Kolom itu diisi oleh **dua** pihak yang berbeda:
- **Leader saat approval**, lewat pemenuhan sebagian (`APPROVAL_REVISION_PLAN.md`) — misalnya menyetujui 3 dari 10 bag.
- **Operator packing**, lewat pilihan 1 di checkout.

Keduanya tidak bisa dibedakan dari kolom item. Akibatnya, kalau leader menyetujui 3 dari 10 lalu operator menekan reset, keputusan leader lenyap, targetnya kembali 10, dan Autofill akan mengeluarkan **lebih banyak dari yang disetujui**.

Penolakan kolom ini sudah dibuktikan live pada baris yang ditutup lewat pilihan 1 (sebelum reset `quantity_unfulfilled = 5`, sesudahnya `0`, target kembali 10). Kasus leader memakai baris kode yang sama.

Ini melanggar `CHECKOUT_AUTOFILL_PLAN.md` §5.3, yang menulis `quantity_unfulfilled` **tidak disentuh** oleh reset: *reset bukan keputusan pemenuhan*.

### Akar masalah yang lebih dalam

Modal dan kartu memakai definisi "selesai" yang berbeda:

| Tempat | Definisinya | Menghitung `quantity_unfulfilled`? |
|---|---|---|
| Kartu, `isLineDone` | `prepared + unfulfilled >= requested` | **Ya** — benar |
| Modal, `itemShortfall` (`js/packing.js:2484`) | `requested − prepared` | Tidak |
| Modal, `itemIsClosed` (`js/packing.js:2483`) | `Ready for Handover` atau `unfulfilled > 0` | Hanya sebagai jalan pintas |
| `addCartEntry`, `remainingForLine` | `itemShortfall − inCart` | Ikut `itemShortfall` |
| `onCheckoutClicked`, `shortAfter` | `requested − prepared − inCart` | Tidak |
| Ketersediaan di `js/sales.js` | `requested − prepared − unfulfilled` | **Ya** — benar |

Selama definisi di modal mengabaikan kolom itu, jalan pintas `unfulfilled > 0` di `itemIsClosed` dan penolakan di reset adalah tambalan untuk menutupi ketidakcocokan tersebut.

### Yang harus dilakukan

Satukan semua tempat di modal ke **satu** definisi target:

```
target(item)    = quantity_requested − quantity_unfulfilled
shortfall(item) = max(0, target − quantity_prepared)
tertutup(item)  = shortfall(item) <= 0
```

Lalu:

1. **`itemShortfall`** memakai rumus di atas.
2. **`itemIsClosed`** menjadi `itemShortfall(item) <= 0`. Hapus jalan pintas `unfulfilled > 0`.
3. **`addCartEntry`** sudah menurunkan `remainingForLine` dari `itemShortfall`, jadi ia ikut benar begitu langkah 1 selesai. **Jangan** menulis rumus kedua di sana — cukup pastikan Take, limpahan Autofill, dan jalur pindai semuanya tetap lewat `itemShortfall`.
4. **`onCheckoutClicked`**, `shortAfter` ikut mengurangi `quantity_unfulfilled`.
5. **`resetCommittedItem`**: hapus baris `item.quantity_unfulfilled = 0`. `item_status` dihitung dari `newPrepared + unfulfilled >= requested`.
6. **`runCheckout`**, dua perubahan sekaligus:
   - **Hapus lompatan di `js/packing.js:3222`** (`if (quantity_unfulfilled > 0) continue;`). Lompatan itu melewati pencatatan `quantity_prepared` sama sekali — kalau suatu saat ada stok yang terpotong untuk baris seperti itu (misalnya lewat pindai, yang sekarang masih mati), stok berkurang tapi order tidak mencatatnya. Dengan definisi baru, baris tertutup memang tidak punya isi keranjang, jadi lompatan tidak diperlukan lagi.
   - Untuk pilihan 1, kekurangan dihitung terhadap target dan **ditambahkan**, bukan ditimpa:
     ```
     shortAfterThis = max(0, requested − unfulfilled_lama − newPrepared)
     unfulfilled_baru = unfulfilled_lama + shortAfterThis
     ```
     Memakai `=` akan menghapus keputusan leader yang sudah ada di kolom itu.
   - `item_status = (newPrepared + unfulfilled_baru >= requested) ? 'Ready for Handover' : 'Packing'`.
7. **Kalimat konfirmasi reset** yang sekarang menyebut *"target penuh (N pcs)"* harus memakai `requested − unfulfilled`, bukan `requested`.
8. **Panel kanan**: kalau `quantity_unfulfilled > 0`, tampilkan keterangan kecil *"N tidak terpenuhi"* di bawah angka Diminta. Tanpa itu, baris yang terbaca *Diminta 10 · Keluar 0 · Kurang 3* akan terlihat seperti salah hitung.

**Jangan** menyentuh `isLineDone` di kartu dan perhitungan ketersediaan di `js/sales.js` — keduanya sudah benar dan justru menjadi acuan.

---

## Bug 2 — Tombol Autofill di baris tidak bisa diklik

### Masalahnya

Dibuktikan live dengan klik mouse sungguhan: menekan Autofill di baris item tidak melakukan apa pun, bahkan barisnya tidak terbuka. Sementara itu **muncul satu tombol Autofill cadangan di bawah baris**, dan justru yang itu yang berfungsi.

### Akar masalahnya, dua lapis

1. **`<button>` di dalam `<button>`.** Baris item dirender sebagai `<button class="dc-item-row">` (`js/packing.js` sekitar baris 2521), dan tombol Autofill ada di dalamnya. HTML tidak mengizinkan tombol bersarang; parser menutup tombol luar lebih dulu, sehingga lahir tombol cadangan yang tercecer di bawah baris.
2. **`onclick="event.stopPropagation()"`** pada `<span class="dc-act">`. Pendengar klik modal dipasang secara delegasi di `#modal-body-content`. Karena rambatannya dihentikan di `dc-act`, klik pada tombol di dalamnya tidak pernah sampai ke pendengar itu. Tombol cadangan bekerja semata-mata karena ia tercecer di luar `dc-act`.

### Yang harus dilakukan

- Ubah `dc-item-row` menjadi `<div role="button" tabindex="0" aria-expanded aria-controls>`, dan tangani Enter serta Spasi untuk membuka-tutup, supaya keyboard tetap bisa dipakai.
- Hapus `onclick="event.stopPropagation()"` dari `dc-act`, di **kedua** tempat render: `itemHeaderHtml` dan `refreshItemRowState` (sekitar baris 2625).
- Di pendengar delegasi, periksa tombol aksi lebih dulu (Autofill dan reset baris), lalu **abaikan** klik buka-tutup baris kalau `e.target.closest('.dc-act')` ada.
- Pastikan tidak ada lagi tombol Autofill yang tercecer di bawah baris.

---

## Temuan kecil

- **Judul modal** menampilkan kode `&middot;` mentah (`js/packing.js:2719`), karena judul dipasang sebagai teks, bukan HTML. Pakai karakter `·` langsung.
- **Penjaga klik ganda reset** dipasang *sesudah* dialog konfirmasi (`resettingItems.add` di baris 2964). Pindahkan ke **sebelum** `showWarningModal`, dan lepaskan kalau operator memilih Cancel. `showWarningModal` memasang pendengar `keydown` baru pada setiap pemanggilan, jadi dua dialog yang terbuka bersamaan bisa sama-sama selesai oleh satu tekanan Enter — dan `refund_packed_lot` tidak punya batas atas.
- **Badge Dispatched** tidak muncul pada kartu order yang semua barisnya sudah selesai, karena badge hanya dirender di cabang `isPartial`. User meminta badge untuk item yang keluar *sebagian maupun penuh*. Tampilkan di kedua cabang selama `quantity_prepared > 0`.

---

## Yang TIDAK boleh diubah

- **`orderMode`** — mode dua panel yang aktif untuk setiap order dengan alokasi saat approval. Ini masih menunggu keputusan user. Biarkan apa adanya.
- **Alur `Unable to Fulfill`, approval, Reopen, dan edit-lock.**
- **`isLineDone` di kartu dan perhitungan ketersediaan di `js/sales.js`.**
- **Penanganan `null` dan rumus alokasi di `resetCommittedItem`** — sudah terbukti benar live.
- Tiga larangan lama: tidak ada `UPDATE remaining_pcs` langsung, tidak ada tulisan ke `packed_coffee.quantity`, tidak ada penghapusan baris `packed_stock_movements`.

---

## Verifikasi wajib

**Browser harus sudah login.** Kalau tab yang kamu pakai tidak login, **berhenti dan minta user login sendiri**. Jangan pernah mengetik alamat email atau kata sandi ke kolom login.

Jalankan dua skenario dengan order uji yang kamu buat sendiri lewat modal Sales Request, bukan order pelanggan.

**Skenario A — keputusan leader.** Buat order 10 bag. Setujui dengan pemenuhan sebagian: 3 dari stok, bulk 0, produksi 0, sehingga `quantity_unfulfilled = 7`.
1. Kartu menampilkan Dispatch, dan modal tidak menawarkan apa pun untuk dipetik.
2. Reset baris itu di panel kanan → 3 pcs kembali ke lot asalnya, `quantity_prepared = 0`, **`quantity_unfulfilled` tetap 7**, daftar kiri menampilkan `0 / 3`, bukan `0 / 10`.
3. Autofill → keranjang terisi **3**, bukan 10.
4. Checkout → tidak ada dialog kekurangan, `item_status = Ready for Handover`.

**Skenario B — pilihan 1 di atas keputusan leader.** Pada order yang sama sesudah langkah 2 di atas, isi hanya 1 pcs, Checkout, pilih *proses apa adanya* → `quantity_unfulfilled` menjadi **9** (7 + 2), bukan 2.

**Skenario C — tombol Autofill.** Klik tombol Autofill di baris **dengan mouse sungguhan**, bukan `element.click()` dari skrip. Keranjang harus terisi, dan tidak ada tombol Autofill kedua di mana pun. Coba juga Enter dan Spasi pada baris untuk membuka-tutupnya.

**Uji tutup untuk setiap order:** jalankan kueri di `CHECKOUT_AUTOFILL_PLAN.md` §11. Kolom `selisih` harus nol di semua baris.

**Pembersihan yang sudah terbukti bekerja:** tombol Unable to Fulfill di kartu packing (sekaligus menghapus rencana roasting tanpa batch) → Reopen dari popup detail order → Delete dari tabel Sales Dispatch Request. Catat saldo lot sebelum mulai, dan pastikan saldonya kembali persis sesudah pembersihan.

Lalu: `node test.js` lulus, dan naikkan `?v=` untuk setiap berkas yang berubah. Saat ini `packing.js?v=128`, `sales.js?v=55`, `translations.js?v=68`.

## Laporan yang kuharapkan

Per bug: apa yang diubah, skenario mana yang dijalankan, dan angka sebelum-sesudah untuk `quantity_prepared`, `quantity_unfulfilled`, serta setiap lot yang tersentuh. Kalau kamu tidak bisa menjalankan verifikasi live, katakan itu di kalimat pertama laporanmu.
