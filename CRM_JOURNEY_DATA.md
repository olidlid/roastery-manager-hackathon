# CRM — Kebutuhan Data untuk Tab Journey (persiapan)

**Status:** Persiapan data saja. Tab Journey **belum dirancang** dan belum boleh dibangun.
**Tanggal:** 2026-09-26
**Tujuan dokumen ini:** memastikan hal-hal yang **tidak bisa diambil kembali di kemudian hari** mulai dicatat saat halaman CRM dibangun. Sisanya bisa dihitung ulang kapan saja, jadi tidak perlu diburu sekarang.

Terkait: `CRM_INSIGHTS_PLAN.md` (sub-tab di halaman Customers — halaman sales, berbeda dari halaman CRM management ini), `CUSTOMER_CATEGORY_ROLE_PLAN.md` (kategori customer + akses per kategori).

---

## 1. Aturan pemisahnya

Ada dua jenis data:

| Jenis | Contoh | Perlu tindakan sekarang? |
|---|---|---|
| **Turunan** — bisa dihitung ulang dari order lama kapan saja | kg per bulan, jumlah order, jeda antar order, repeat rate, komposisi kopi, pelanggan yang menghilang, rekor bulan terbesar | **Tidak.** Order lama tidak ke mana-mana. |
| **Kejadian** — hanya ada saat terjadi, hilang kalau tidak dicatat | siapa yang membuka pelanggan, kapan kepemilikan pindah sales, kapan pelanggan dinonaktifkan | **Ya.** Ini isi §3. |

Journey sebagian besar berisi data turunan. Yang perlu disiapkan hanya sedikit — tapi kalau terlewat, tidak ada cara memperbaikinya selain menebak.

---

## 2. Yang sudah aman — sudah diverifikasi di produksi (2026-09-26)

| Fakta | Angka | Artinya untuk Journey |
|---|---|---|
| `customers.created_at` bisa dipercaya sebagai tanggal akuisisi | dari 39 pelanggan yang pernah order, **38** dibuat di hari yang sama dengan order pertamanya, dan **0** dibuat setelah order pertamanya | "Pelanggan baru bulan Agustus" bisa dihitung mundur dengan benar |
| `request_orders.sales_name` terisi penuh | **81 dari 81** order punya nama sales; 0 kosong | Atribusi kg/order per sales bisa dihitung mundur sampai order pertama |
| Semua nama sales di order cocok persis dengan `profiles.name` | 4 dari 4 (`Abdullah Al Modaifer`, `محمد الجبري`, `khaleed`, `Ahmad`) | Backfill `owner_sales_id` dari nama **masih bisa dilakukan hari ini** — lihat §3.3 kenapa ini tidak akan bertahan lama |
| `request_orders` lengkap | 0 order tanpa `customer_id`, 0 tanpa `order_date` | Timeline tidak akan bolong |

Jadi: kg, order, ritme, repeat rate, kopi favorit, pelanggan menghilang, rekor — **semua sudah aman**, tidak perlu kolom baru.

---

## 3. Yang harus dicatat mulai sekarang (tidak bisa dibackfill nanti)

### 3.1 Siapa yang membuka pelanggan

Hari ini `customers` tidak punya `created_by` sama sekali. Yang bisa dipakai hanyalah nama sales di order pertamanya — dan itu gagal untuk **8 pelanggan yang belum pernah order sama sekali** (`test`, `test 2`, `pooq`, `nahyah`, `بيكا`, `thra coffe`, `3 pro`, `اسواق الرشيد فرع بريدة2`). Pelanggan yang dibuka tapi belum pernah order justru salah satu angka paling berguna untuk Journey sales.

Tambahkan saat membangun halaman CRM:

```sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS created_by_id   UUID,   -- profiles.id
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;   -- snapshot nama saat itu
```

Isi otomatis dari `currentUser` setiap kali customer baru dibuat. Backfill untuk yang lama: ambil `sales_name` dari order paling awal pelanggan itu (dapat 39 dari 47); sisanya biarkan NULL — jangan ditebak.

### 3.2 Kepemilikan sales, berikut sejarahnya

Kolom kepemilikan yang sudah direncanakan untuk halaman CRM:

```sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS owner_sales_id   UUID,          -- profiles.id
  ADD COLUMN IF NOT EXISTS owner_sales_name TEXT,          -- snapshot, pola sama seperti order_type
  ADD COLUMN IF NOT EXISTS owner_since      TIMESTAMPTZ;
```

**Ini bagian yang paling mudah terlewat:** kalau `owner_sales_id` ditimpa setiap kali kepemilikan dipindah, sejarahnya hilang. Journey yang berbunyi "Agustus: 5 pelanggan baru" akan salah begitu satu pelanggan dipindah tangan di Oktober — pelanggan itu akan terhitung milik sales baru sejak awal waktu, dan Journey sales lama kehilangan pencapaiannya.

Maka kepemilikan dicatat sebagai kejadian, bukan sekadar nilai:

```sql
CREATE TABLE IF NOT EXISTS public.customer_owner_history (
    id             SERIAL PRIMARY KEY,
    customer_id    INTEGER NOT NULL,
    from_sales_id  UUID,          -- NULL = kepemilikan pertama
    from_sales_name TEXT,
    to_sales_id    UUID,
    to_sales_name  TEXT,
    changed_by_id  UUID,
    changed_by_name TEXT,
    changed_at     TIMESTAMPTZ DEFAULT NOW(),
    note           TEXT           -- opsional, alasan pemindahan
);
```

Aturannya sama seperti ledger stok: **barisnya hanya ditambah, tidak pernah diubah atau dihapus.** Tombol pensil "ganti sales" di tabel CRM menulis satu baris ke sini setiap kali dipakai, dalam operasi yang sama dengan update `customers` (all-or-nothing, konvensi `ee14598`).

### 3.3 Sales disimpan sebagai id, bukan nama

`request_orders.sales_name` adalah TEXT. Hari ini keempat nilainya masih cocok dengan `profiles.name`, jadi backfill id masih bisa. Itu tidak akan bertahan: begitu ada yang mengganti nama profilnya, tautannya putus tanpa suara. Dan sudah ada dua profil berawalan sama — `Abdullah Al Modaifer` dan `Abdullah al Rasheed` — jadi pencocokan nama belakangan justru berbahaya, bukan sekadar rapuh.

Tindakan: saat membangun CRM, jalankan backfill `owner_sales_id`/`created_by_id` dari nama **sekali**, lalu setelah itu id yang jadi acuan; nama hanya snapshot untuk ditampilkan.

Catatan: acuannya `profiles`, **bukan** tabel `sales_agents`. `sales_agents` masih menyimpan baris usang (`QA_TEST_BLEND_CODE`, `101`) dan tidak dipakai untuk login.

### 3.4 Kapan pelanggan berhenti

`customers.is_active` tidak punya tanggal. Journey yang ingin menulis "pelanggan ini lepas di September" tidak punya sumbernya. Cukup satu kolom:

```sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
```

Diisi saat `is_active` diubah ke FALSE, dikosongkan saat diaktifkan lagi.

---

## 4. Yang sengaja TIDAK dicatat

- **Aktivitas harian** (kunjungan, telepon, catatan follow-up). App tidak punya log seperti ini, dan Journey tidak boleh memancing pembuatannya diam-diam. Kalau nanti diinginkan, itu keputusan tersendiri, bukan efek samping tab Journey.
- **Angka uang.** Sesuai ruling 2026-09-25: tidak ada perhitungan keuangan di sistem ini. Journey memakai kg, sama seperti seluruh halaman CRM. Struktur data tetap dijaga agar siap kalau klien memintanya nanti.

---

## 5. Saat tab Journey benar-benar dirancang

Pengingat yang perlu dibaca ulang saat itu:

1. **Guardrail data tipis.** Order baru dimulai Juli 2026. Di bawah 3 bulan data, tampilkan "belum cukup data", jangan grafik kosong — aturan yang sama dengan "di bawah 3 order → tidak ada estimasi tanggal".
2. **Pakai ulang yang sudah ada.** `computeOrderStatsByKey()` di `js/db.js` dan `getCustomerSegment()`/`computePeerMedians()` di `js/sales.js` sudah menghitung sebagian besar yang dibutuhkan (lihat `CRM_INSIGHTS_PLAN.md`). Jangan menghitung ulang dari nol.
3. **Satu izin.** Seluruh halaman CRM termasuk Journey berada di bawah `crm_manage`. Journey tidak dibuka ke sesama sales — halaman ini tentang orang, dan isinya harus tetap hasil kerja (kg, pelanggan, repeat), bukan pengawasan aktivitas.
4. **Setiap perubahan skema** mengikuti aturan di CLAUDE.md: update `database/supabase_schema.sql` lebih dulu, terapkan ke produksi, lalu `NOTIFY pgrst, 'reload schema';`.

---

## 6. Ringkas — checklist saat membangun halaman CRM

- [ ] `customers.created_by_id` + `created_by_name`, diisi otomatis untuk customer baru
- [ ] `customers.owner_sales_id` + `owner_sales_name` + `owner_since`
- [ ] Tabel `customer_owner_history`, append-only, ditulis setiap kepemilikan berpindah
- [ ] `customers.deactivated_at`
- [ ] Backfill sekali dari `request_orders.sales_name` → id (39 dari 47 customer dapat; sisanya NULL)
- [ ] `database/supabase_schema.sql` diperbarui + `NOTIFY pgrst, 'reload schema';`
