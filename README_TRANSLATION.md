# Panduan Edit Terjemahan via Excel / Translation Guide via Excel

Dokumen ini menjelaskan tata cara melakukan pengeditan kamus terjemahan aplikasi Roastery Manager v2 menggunakan Microsoft Excel, Google Sheets, atau aplikasi spreadsheet lainnya, lalu mengimpornya kembali ke website.

---

## 🇮🇩 Bahasa Indonesia

### 📋 Aturan Pengeditan (Boleh vs Tidak Boleh)

#### ✅ Yang BOLEH Diubah:
1. **Kolom B (English)**: Anda bebas mengedit, memperbaiki typo, atau menulis ulang teks bahasa Inggris untuk key tersebut.
2. **Kolom C (Arabic)**: Anda bebas mengedit, memperbaiki typo, atau menulis ulang teks bahasa Arab untuk key tersebut.

#### ❌ Yang TIDAK BOLEH Diubah:
1. **Kolom A (Key)**: **JANGAN PERNAH** mengubah nama, menghapus, memodifikasi, atau memindahkan teks kunci terjemahan di kolom ini. Kolom ini adalah pengenal unik (ID) yang digunakan oleh kode sistem untuk mencocokkan teks di layar.
2. **Struktur Header**: Jangan mengubah baris pertama (header) yang bertuliskan `"Key","English","Arabic"`.
3. **Menambah/Menghapus Baris**: Jangan menambahkan baris baru atau menghapus baris yang ada di Excel secara manual. Jika ingin menambah kata baru, harus melalui perubahan kode sistem.

---

### 💾 Cara Membuka dan Menyimpan di Microsoft Excel
Karena kamus ini menggunakan karakter Arab (Unicode), ada langkah khusus agar karakter Arab tidak berubah menjadi teks rusak (garbled text) saat disimpan kembali ke CSV.

#### Membuka File di Excel:
1. Klik **Export to Excel/CSV** di menu Translation Manager Settings. File `roastery_translations.csv` akan terunduh.
2. Buka Microsoft Excel.
3. Klik **File > Open**, pilih file yang diunduh. Excel akan otomatis membukanya dengan benar karena file telah disisipi **UTF-8 BOM** secara otomatis dari sistem.

#### Menyimpan File dari Excel:
1. Setelah selesai mengedit, klik **File > Save As**.
2. Pada bagian *Save as type*, pilih **CSV UTF-8 (Comma delimited) (*.csv)**. Ini adalah langkah wajib agar teks Arab tetap tersimpan sebagai Unicode UTF-8.
3. Klik **Save**.

#### Mengimpor Kembali ke Aplikasi:
1. Masuk ke halaman **Settings > Translation Manager**.
2. Klik tombol **Import from Excel/CSV**, lalu pilih file CSV yang baru saja Anda simpan dari Excel.
3. Aplikasi akan menampilkan hasil editan di tabel. Tinjau kembali nilainya.
4. Klik **Save Changes** untuk menerapkan terjemahan baru tersebut secara langsung pada aplikasi.

---

---

## 🇬🇧 English Version

### 📋 Editing Rules (Do's and Don't's)

#### ✅ Allowed to Edit:
1. **Column B (English)**: You can freely edit, fix typos, or rewrite the English texts.
2. **Column C (Arabic)**: You can freely edit, fix typos, or rewrite the Arabic texts.

#### ❌ DO NOT Edit:
1. **Column A (Key)**: **NEVER** edit, delete, modify, or move the translation keys in this column. These are unique identifiers used by the codebase to target UI elements.
2. **Header Row**: Do not modify the first row (`"Key","English","Arabic"`).
3. **Add/Delete Rows**: Do not manually insert new rows or delete existing rows in Excel.

---

### 💾 Opening & Saving in Excel (Unicode/Arabic Support)

#### Opening in Excel:
1. Click **Export to Excel/CSV** to download `roastery_translations.csv`.
2. Open Excel, click **File > Open**, and select the CSV file. The Arabic characters will display correctly because the export automatically includes the **UTF-8 BOM**.

#### Saving in Excel:
1. After editing, click **File > Save As**.
2. In the *Save as type* dropdown, select **CSV UTF-8 (Comma delimited) (*.csv)**. This is required to preserve Arabic characters.
3. Click **Save**.

#### Importing Back:
1. Go to **Settings > Translation Manager**.
2. Click **Import from Excel/CSV** and select your saved CSV.
3. Review the changes inside the table, then click **Save Changes** to apply them instantly to the application.
