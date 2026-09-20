# Rencana Fitur: Other Items (Barang Lain)

**Status:** Rencana, siap dikerjakan. Semua keputusan desain sudah diambil user (§2) dan sudah divisualkan di mockup.
**Tanggal:** 2026-09-20
**Mockup:** https://claude.ai/artifact/HEnfx3fXTVxEmVi7H25MKV — 7 layar, memakai token desain asli aplikasi. **Buka ini dulu sebelum menulis kode**; layout, kolom tabel, dan susunan form di sana adalah spesifikasi, bukan saran.
(Versi kanvas lama: https://claude.ai/artifact/Py9GN9DvTa14ceCfWbaF9B — isi sama, format lebih sulit dibaca. Pakai yang pertama.)

---

## 1. Ringkasan

Inventory untuk barang yang **dibeli dari luar lalu dijual lagi** — kertas filter V60, gelas kertas, kaos, tumbler, label roll. Barang ini tidak pernah melewati roasting maupun packing, jadi tidak punya lot, tidak punya FIFO, tidak punya expiry. Satu item = satu angka stok.

Tiga hal yang ditambahkan:

1. **Section baru** di dropdown Inventory (urutan ke-4, setelah Packed Coffee) dengan dua tab: Item List dan Stock Release.
2. **Ledger pergerakan stok** — setiap perubahan stok tercatat (masuk, terjual, release, koreksi) lengkap dengan saldo sesudahnya.
3. **Integrasi penjualan**: satu Sales Request boleh memuat baris kopi DAN baris other item sekaligus. Stok dipotong saat checkout/dispatch, bukan saat approval.

---

## 2. Keputusan user (sudah final, jangan ditanya ulang)

| # | Keputusan |
|---|---|
| 1 | Stok masuk = **input manual sederhana**. Tidak lewat alur Purchase Request/approval. |
| 2 | Dijual lewat **Sales Request yang sudah ada**, digabung satu order dengan kopi. |
| 3 | **Tidak** ada lot/FIFO/expiry — cukup satu angka stok per item. |
| 4 | Ditaruh di **dropdown Inventory**, bukan tab di dalam Packing. (Keputusan ini merevisi arah awal.) |
| 5 | Yang boleh mengelola: **Admin, Developer, Production Leader**. |
| 6 | **Perlu riwayat stok** masuk-keluar sebagai jejak audit. |
| 7 | **Stock Release berlaku juga** untuk barang ini (sample, internal, marketing, other). |

---

## 3. Penamaan: "Other Items", JANGAN "Retail"

Nama tabel dan label UI memakai **Other Items** / `other_items`.

**Jangan** memakai kata "retail" di mana pun untuk fitur ini. Di aplikasi ini `Retail` sudah punya arti lain dan sudah dipakai: `customers.type` bernilai `'Retail' | 'Wholesale' | 'Supermarket'`, permission `customer_cat_retail`, awalan kode customer `RTL-`, dan role kustom bernama "Retail Sales". Tabel bernama `retail_items` akan terbaca sebagai "barang untuk customer kategori Retail" — arti yang salah, dan pembaca berikutnya pasti salah tafsir.

| Konteks | Istilah |
|---|---|
| Label UI (EN) | Other Items |
| Label UI (AR) | أصناف أخرى |
| Nama tabel | `other_items`, `other_item_movements`, `request_order_other_items` |
| Nama file JS | `js/otheritems.js` |
| Prefix permission | `other_items_*` |
| Section id | `sec-other-items` |

---

## 4. Skema database

Semua DDL di bawah masuk ke file baru `database/other_items_migration.sql`, dan **isi yang sama disalin ke `database/supabase_schema.sql`** (aturan wajib di CLAUDE.md — file itu adalah satu-satunya sumber kebenaran skema).

### 4.1 `other_items` — master item + stok berjalan

```sql
CREATE TABLE IF NOT EXISTS public.other_items (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'pcs',           -- pcs | box | roll | pack
    stock_qty INTEGER NOT NULL DEFAULT 0,       -- SATU-SATUNYA sumber kebenaran stok
    min_stock INTEGER NOT NULL DEFAULT 0,       -- ambang badge "Low"
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- Konteks pergerakan yang dibaca trigger ledger. Pola ini menyalin
    -- packed_coffee_lots.mv_* (supabase_schema.sql ~baris 788) supaya
    -- ledger tidak perlu ditulis manual oleh aplikasi.
    mv_operation TEXT,
    mv_category  TEXT,
    mv_ref_table TEXT,
    mv_ref_id    INTEGER,
    mv_reason    TEXT,
    mv_user      TEXT,
    mv_date      DATE
);

-- Nama item adalah identitasnya. Cegah dua item bernama sama.
CREATE UNIQUE INDEX IF NOT EXISTS other_items_name_uniq
ON public.other_items (lower(name));
```

`stock_qty` sengaja **INTEGER**, bukan NUMERIC: semua barang dihitung per satuan kemasannya (pcs/roll/box). Kalau suatu saat ada barang yang dijual per kg, catat per kemasan (mis. "Sack 25kg"), jangan ubah tipe kolomnya.

**Tidak ada kolom kode/SKU** (keputusan user 2026-09-20). Barangnya sedikit dan dikenali dari namanya; kode hanya akan jadi kolom kosong yang harus diisi orang. Karena itu `name` yang dibuat unik, dan `name` pula yang dipakai sebagai label di semua layar. Kalau suatu saat butuh SKU (mis. untuk barcode), itu pekerjaan tersendiri beserta konsekuensinya di pencarian dan cetakan.

**Tidak ada kolom harga** (keputusan user 2026-09-20). Ini konsisten dengan sisa aplikasi: `request_order_items` untuk kopi pun tidak menyimpan harga — Sales Request adalah dokumen jumlah, penagihan diurus di luar aplikasi. Jangan menambahkan `selling_price`/`cost_price` "sekalian" tanpa diminta; begitu ada satu kolom harga, layar order, cetakan, dan laporan akan dituntut ikut menampilkannya.

### 4.2 `other_item_movements` — ledger

```sql
CREATE TABLE IF NOT EXISTS public.other_item_movements (
    id BIGSERIAL PRIMARY KEY,
    other_item_id INTEGER,          -- SENGAJA tanpa FK: riwayat harus tetap ada
                                    -- walau itemnya dihapus (pola sama dengan
                                    -- packed_stock_movements.packed_coffee_lot_id)
    item_name TEXT,                 -- snapshot
    unit TEXT,                      -- snapshot
    movement_date DATE NOT NULL DEFAULT CURRENT_DATE,  -- tanggal yang DIPILIH user
    delta_qty INTEGER NOT NULL,
    balance_after INTEGER,
    operation TEXT,                 -- item_created | stock_in | dispatch | release
                                    -- | adjustment | undo | item_deleted
    category TEXT,                  -- hanya untuk operation='release':
                                    -- Sample | Internal | Marketing | Other
    ref_table TEXT,                 -- 'request_order_other_items' saat dispatch
    ref_id INTEGER,
    reason TEXT,
    performed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oim_item_idx    ON public.other_item_movements (other_item_id, id);
CREATE INDEX IF NOT EXISTS oim_created_idx ON public.other_item_movements (created_at);
CREATE INDEX IF NOT EXISTS oim_op_idx      ON public.other_item_movements (operation, id);
```

**Tab Stock Release bukan tabel tersendiri** — ia hanyalah tampilan ledger yang difilter `operation = 'release'`. Jangan membuat tabel `other_item_releases`, dan jangan menumpang di `stock_releases`/`stock_release_items` (dua tabel itu berbentuk lot kopi: `packed_coffee_lot_id`, `coffee_name`, `bag_size_g` — tidak ada artinya untuk kaos).

### 4.3 Trigger penulis ledger

```sql
CREATE OR REPLACE FUNCTION public.log_other_item_movement() RETURNS TRIGGER AS $$
DECLARE v_delta INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF COALESCE(OLD.stock_qty, 0) <> 0 THEN
            INSERT INTO public.other_item_movements (
                other_item_id, item_name, unit, movement_date,
                delta_qty, balance_after, operation, category,
                ref_table, ref_id, reason, performed_by)
            VALUES (OLD.id, OLD.name, OLD.unit, COALESCE(OLD.mv_date, CURRENT_DATE),
                -OLD.stock_qty, 0, COALESCE(OLD.mv_operation, 'item_deleted'), OLD.mv_category,
                OLD.mv_ref_table, OLD.mv_ref_id, OLD.mv_reason, OLD.mv_user);
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_delta := COALESCE(NEW.stock_qty, 0);
    ELSE
        v_delta := COALESCE(NEW.stock_qty, 0) - COALESCE(OLD.stock_qty, 0);
    END IF;

    -- Edit nama/harga/min tanpa mengubah stok tidak menghasilkan baris ledger.
    IF v_delta = 0 THEN RETURN NEW; END IF;

    INSERT INTO public.other_item_movements (
        other_item_id, item_name, unit, movement_date,
        delta_qty, balance_after, operation, category,
        ref_table, ref_id, reason, performed_by)
    VALUES (NEW.id, NEW.name, NEW.unit, COALESCE(NEW.mv_date, CURRENT_DATE),
        v_delta, NEW.stock_qty,
        COALESCE(NEW.mv_operation, CASE WHEN TG_OP = 'INSERT' THEN 'item_created' ELSE 'unspecified' END),
        NEW.mv_category, NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_log_other_item_movement ON public.other_items;
CREATE TRIGGER trg_log_other_item_movement
AFTER INSERT OR UPDATE OR DELETE ON public.other_items
FOR EACH ROW EXECUTE FUNCTION log_other_item_movement();
```

### 4.4 RPC (semua perubahan stok WAJIB lewat sini)

```sql
-- Stok masuk manual.
CREATE OR REPLACE FUNCTION public.other_item_stock_in(
    p_item_id INTEGER, p_qty INTEGER, p_date DATE DEFAULT NULL,
    p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE sql SET search_path = public AS $$
    UPDATE public.other_items
    SET stock_qty   = stock_qty + GREATEST(p_qty, 0),
        updated_at  = NOW(),
        mv_operation='stock_in', mv_category=NULL,
        mv_ref_table=NULL, mv_ref_id=NULL,
        mv_reason=p_reason, mv_user=p_user, mv_date=COALESCE(p_date, CURRENT_DATE)
    WHERE id = p_item_id
    RETURNING stock_qty;
$$;

-- Stok keluar (dispatch penjualan ATAU release). Mengunci baris, menjepit di 0,
-- dan MENGEMBALIKAN jumlah yang BENAR-BENAR terambil.
CREATE OR REPLACE FUNCTION public.other_item_consume(
    p_item_id INTEGER, p_qty INTEGER,
    p_operation TEXT DEFAULT 'dispatch', p_category TEXT DEFAULT NULL,
    p_ref_table TEXT DEFAULT NULL, p_ref_id INTEGER DEFAULT NULL,
    p_date DATE DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE sql SET search_path = public AS $$
    WITH before AS (
        SELECT stock_qty FROM public.other_items WHERE id = p_item_id FOR UPDATE
    ), updated AS (
        UPDATE public.other_items
        SET stock_qty   = stock_qty - LEAST(stock_qty, GREATEST(p_qty, 0)),
            updated_at  = NOW(),
            mv_operation=p_operation, mv_category=p_category,
            mv_ref_table=p_ref_table, mv_ref_id=p_ref_id,
            mv_reason=p_reason, mv_user=p_user, mv_date=COALESCE(p_date, CURRENT_DATE)
        WHERE id = p_item_id
        RETURNING stock_qty
    )
    SELECT COALESCE((SELECT stock_qty FROM before), 0)
         - COALESCE((SELECT stock_qty FROM updated), 0);
$$;

-- Koreksi hitungan / undo: set angka pasti.
CREATE OR REPLACE FUNCTION public.other_item_set_qty(
    p_item_id INTEGER, p_qty INTEGER,
    p_operation TEXT DEFAULT 'adjustment',
    p_ref_table TEXT DEFAULT NULL, p_ref_id INTEGER DEFAULT NULL,
    p_date DATE DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE sql SET search_path = public AS $$
    UPDATE public.other_items
    SET stock_qty   = GREATEST(0, p_qty),
        updated_at  = NOW(),
        mv_operation=COALESCE(p_operation, 'adjustment'), mv_category=NULL,
        mv_ref_table=p_ref_table, mv_ref_id=p_ref_id,
        mv_reason=p_reason, mv_user=p_user, mv_date=COALESCE(p_date, CURRENT_DATE)
    WHERE id = p_item_id
    RETURNING stock_qty;
$$;

GRANT EXECUTE ON FUNCTION public.other_item_stock_in(INTEGER, INTEGER, DATE, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.other_item_consume(INTEGER, INTEGER, TEXT, TEXT, TEXT, INTEGER, DATE, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.other_item_set_qty(INTEGER, INTEGER, TEXT, TEXT, INTEGER, DATE, TEXT, TEXT) TO anon, authenticated;
```

**Aturan keras:** aplikasi tidak boleh pernah menulis `other_items.stock_qty` langsung lewat `saveData()`. Semua naik-turun stok lewat tiga RPC di atas. `saveData('other_items', ...)` hanya untuk field non-stok (name, unit, min_stock, is_active, notes) — dan saat menyimpan, jangan ikut mengirim `stock_qty`, karena mengirim nilai lama pun aman tapi mengirim nilai baru akan melewati jalur RPC.

### 4.5 `request_order_other_items` — baris other item di sebuah Sales Request

```sql
CREATE TABLE IF NOT EXISTS public.request_order_other_items (
    id SERIAL PRIMARY KEY,
    request_order_id INTEGER REFERENCES public.request_orders(id) ON DELETE CASCADE,
    other_item_id INTEGER REFERENCES public.other_items(id) ON DELETE SET NULL,
    item_name TEXT,                             -- snapshot saat order dibuat
    unit TEXT,                                  -- snapshot
    quantity_requested INTEGER NOT NULL DEFAULT 0,
    quantity_dispatched INTEGER NOT NULL DEFAULT 0,
    quantity_unfulfilled INTEGER NOT NULL DEFAULT 0,
    item_status TEXT DEFAULT 'Pending Approval',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rooi_order_idx ON public.request_order_other_items (request_order_id);
```

Tidak ada `quantity_prepared` — tidak ada yang perlu disiapkan; barang diambil dari rak saat checkout.

### 4.6 Kenapa tabel terpisah, bukan kolom di `request_order_items`

Alternatif yang **ditolak**: menambah kolom `other_item_id` ke `request_order_items` lalu memakai `coffee_type='Other'`.

Alasannya konkret, bukan selera:

- `js/leader.js:65` merender tiap baris sebagai `${item.bag_size_g}g (${item.quantity_requested} bags)`. Baris kaos akan tampil `"undefinedg (5 bags)"` di aplikasi Android Leader.
- Alur pemenuhan kopi (`openDispatchCheckoutModal` js/packing.js:2267, `runCheckout` js/packing.js:3364) menarik stok dari `packed_coffee_lots` per lot, per mesin, per ukuran. Baris tanpa lot/mesin/ukuran harus di-skip di setiap titik itu.
- Order Requests, Ready to Pack, roasting plan linkage, autofill, dan `coffeeLabel()` semuanya mengasumsikan baris = kopi.

Dengan tabel terpisah, kode lama **tidak mungkin** kejatuhan baris other item — query lamanya tidak menyentuh tabel baru sama sekali. Ongkosnya: ~5 tempat yang memang HARUS menampilkannya perlu ditambah secara eksplisit (§7). Itu pekerjaan menambah, bukan pekerjaan bertahan. Repo ini punya sejarah panjang bug akibat asumsi bersama yang melenceng (bug partisi mesin, identitas lot, checkout double-submit) — pilih yang tidak bisa bocor.

### 4.7 RLS

Ikuti pola blok `DO $$ ... full_access ... $$` di `supabase_schema.sql` (~baris 1258): tambahkan `'other_items'`, `'other_item_movements'`, `'request_order_other_items'` ke array-nya, dengan komentar tanggal seperti entri lain.

**Jangan** memasang trigger `stock_take_freeze_guard` pada `other_items`. Stock opname di aplikasi ini menghitung kopi (green/bulk/packed); membekukan stok barang lain saat opname kopi berjalan akan memblokir penjualan tanpa alasan. Tulis alasan ini sebagai komentar di file skema supaya tidak dianggap kelupaan.

---

## 5. Permission

### 5.1 Enam key baru

Tambahkan satu grup ke `PERMISSION_GROUPS` (js/settings.js:302), letakkan **setelah** grup "📦 Packed Coffee Stock" supaya urutannya mengikuti urutan sidebar:

```js
{ label: '🏷️ Other Items', keys: [
    { key: 'other_items_view',    label: 'View' },
    { key: 'other_items_add',     label: 'Add Item' },
    { key: 'other_items_edit',    label: 'Edit Item / Correct Stock' },
    { key: 'other_items_delete',  label: 'Delete Item' },
    { key: 'other_items_stock_in',label: 'Add Stock (goods in)' },
    { key: 'other_items_release', label: 'Stock Release (non-sales goods out)' }
]},
```

### 5.2 Matriks default

| Role | view | add | edit | delete | stock_in | release |
|---|---|---|---|---|---|---|
| Developer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Production Leader | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Packing Team | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sales Agent | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Roaster | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Packing Team dan Sales Agent dapat `view` karena merekalah yang menyerahkan/menjual barangnya dan perlu tahu sisa stok. Kalau user ingin lain, cukup diubah lewat Settings → Role Management setelah rilis.

### 5.3 Backfill WAJIB — ini jebakan yang sudah pernah menggigit

Role di produksi tersimpan sebagai objek `permissions` JSONB. Key yang **tidak ada** dibaca sebagai `false` oleh `hasPermission()`. Artinya: tanpa backfill, fitur ini tidak akan terlihat oleh siapa pun — termasuk Admin dan Developer — sampai seseorang menyadarinya.

Jalankan di SQL Editor bersamaan dengan migrasi:

```sql
UPDATE public.custom_roles
SET permissions = permissions
    || jsonb_build_object(
        'other_items_view',     name IN ('Developer','Admin','Production Leader','Packing Team','Sales Agent'),
        'other_items_add',      name IN ('Developer','Admin','Production Leader'),
        'other_items_edit',     name IN ('Developer','Admin','Production Leader'),
        'other_items_delete',   name IN ('Developer','Admin','Production Leader'),
        'other_items_stock_in', name IN ('Developer','Admin','Production Leader'),
        'other_items_release',  name IN ('Developer','Admin','Production Leader')
    );
```

Catatan: di produksi ada role kustom di luar enam default (mis. "Sales Manager", "Retail Sales", "Supermarket Sales", "admin2"). Query di atas memberi mereka semua `false` — aman secara default. Tanyakan user apakah "Sales Manager" perlu `other_items_view`; kalau ya, tambahkan namanya di baris `other_items_view`.

Selain itu, perbarui juga seed `MOCK_DB.custom_roles` di `js/app.js:137` dengan enam key yang sama, supaya instalasi baru (tabel `custom_roles` kosong) ikut membawanya.

**Tidak perlu** entri di `PERMISSION_FALLBACKS` (js/auth.js:161): fallback hanya untuk key yang dipecah dari permission lama. Ini fitur baru — tidak ada akses sebelumnya yang harus dipertahankan.

### 5.4 Aturan penting: baris order TIDAK digerbangi `other_items_view`

`other_items_view` hanya menggerbangi **section Inventory → Other Items**. Baris other item yang muncul di Sales Request, kartu Order Requests, layar checkout, waybill, dan aplikasi Leader digerbangi permission penjualan yang sudah ada (`sales_request_*`, `dispatch_approval_*`, `packing_*`) — sama seperti baris kopi.

Kalau aturan ini dilanggar, orang packing yang tidak punya `other_items_view` akan melakukan checkout tanpa melihat 50 filter yang harus ikut dimasukkan ke kardus, dan barangnya tidak akan terkirim.

---

## 6. Struktur UI & file

### 6.1 File baru

`js/otheritems.js` — seluruh logika section ini. Pola dan urutan isinya mengikuti `js/purchasing.js` (modul terbaru, paling bersih):

```
// header komentar: apa, kenapa, keputusan yang sudah diambil
const OTHER_ITEM_UNITS = ['pcs','box','roll','pack'];
const OTHER_RELEASE_CATEGORIES = [...]   // Sample | Internal | Marketing | Other
async function loadOtherItemsSection()
async function loadOtherItemsList()
async function loadOtherItemsReleaseTab()
function openOtherItemFormModal(itemId)  // Add + Edit, satu form (mockup layar 2)
function openOtherItemStockInModal(itemId)
function openOtherItemHistoryModal(itemId)
function openOtherItemReleaseModal()
async function deleteOtherItem(itemId)
```

Daftarkan di `index.html` **setelah** `js/sales.js` dan **sebelum** `js/app.js`:

```html
<script src="js/otheritems.js?v=1"></script>
```

### 6.2 index.html

1. **Submenu**: satu `<li class="menu-subitem" data-target="sec-other-items" id="subitem-other-items">` di dalam `<ul id="submenu-inventory">` (baris ~264), setelah `subitem-packed-coffee`. Ikon: tag (`icon-tag`) — beda dari `icon-archive` yang sudah dipakai Packed Coffee/Packing.
2. **Section**: `<section id="sec-other-items" class="page-section hidden">` dengan dua tab. Pakai pola tab `data-target` + `.tab-btn` seperti `sec-packing` (baris 1132-1143), bukan pola `data-tab` milik `sec-greenbean` — `sec-packing` lebih baru dan tab-nya lebih sedikit.
3. **Header tabel daftar item harus bisa difilter** (permintaan user 2026-09-20, lihat mockup layar 1): kolom Item name, Unit, dan Updated memakai pola yang sudah ada di aplikasi — `<th class="filterable-th" data-col="N">` berisi `<div class="th-content"><span>Label</span><button class="filter-trigger-btn">…corong…</button></div>`. Salin persis bentuknya dari tabel Packing Records (index.html ~baris 1203).

   Filternya **tidak perlu kode baru**: `initTableFilters()` (js/app.js:2557) sudah memasang listener global yang menangani semua tabel dengan markup itu. **Tapi ada syaratnya** — handler-nya melakukan `th.closest('.tab-content') || th.closest('.packing-tab-content')` lalu `if (!tabContent) return;` (js/app.js:2566-2568), dan memakai `id` elemen itu sebagai kunci penyimpanan filter. Jadi pembungkus tab di section ini **wajib** memakai salah satu dari dua class tersebut dan punya `id` unik (mis. `<div id="tab-oi-list" class="packing-tab-content">`). Kalau dipakai nama class karangan sendiri, tombol corongnya akan tampil tapi diam saja saat diklik — tanpa error apa pun.

4. Bump `?v=` untuk setiap file JS yang diubah.

### 6.3 js/auth.js

| Tempat | Perubahan |
|---|---|
| `SECTION_PERMISSIONS` (~baris 131) | `'sec-other-items': 'other_items_view',` |
| `getFirstAllowedSection()` (~baris 374) | Tambah `'sec-other-items'` ke array, setelah `'sec-packed-coffee'` |
| `applyMenuVisibility()` (~baris 427) | **Tambahkan `'sec-other-items'` ke array `subItems`.** Array ini yang memutuskan apakah induk "Inventory" ditampilkan. Kalau tidak ditambahkan, role yang HANYA punya `other_items_view` akan melihat menu Inventory tersembunyi seluruhnya dan tidak bisa membuka sectionnya sama sekali. |

### 6.4 js/app.js

Tambah `case 'sec-other-items':` di `loadSectionData()` (js/app.js:1244, cari `case 'sec-packed-coffee':` di dalamnya) yang memanggil `loadOtherItemsSection()`, plus penanganan tab aktif seperti `sec-packing`.

---

## 7. Integrasi Sales Request

Urutannya: order dibuat → approval (tidak memotong stok) → checkout/dispatch (memotong stok).

### 7.1 Membuat / mengedit order — js/sales.js

- Modal Sales Request: picker item ditambah grup kedua "Other Items" (mockup layar 7). Simpan keranjang other item di variabel terpisah (`otherCartEntries`), **jangan** dicampur ke `cartEntries` yang sudah ada.
- Tiga cabang penyimpanan di `saveSalesOrder` (sekitar baris 4687, 4730, 4755) masing-masing perlu menulis/menghapus `request_order_other_items`. Snapshot `item_name` dan `unit` saat menyimpan — jangan mengandalkan join ke `other_items` saat menampilkan riwayat, karena item bisa diubah/dihapus nanti.
- Validasi: qty > 0; qty melebihi stok **boleh** (stok bisa dibeli sebelum dikirim), tapi tampilkan sisa stok di picker seperti di mockup.
- Hapus order: FK `ON DELETE CASCADE` sudah menangani, tidak perlu loop hapus manual.

### 7.2 Approval — js/sales.js

`approveSalesOrder()` (baris 2049) dan `markOrderUnableToFulfill()` (baris 2877) juga harus mengatur `item_status` baris other item.

**Approval TIDAK memotong stok** — ini aturan yang sudah ditetapkan untuk kopi (commit `dabc7e1`) dan berlaku sama di sini. Pemotongan hanya terjadi di §7.4.

### 7.3 Tampilan yang WAJIB ditambah

| File | Fungsi | Yang ditambahkan |
|---|---|---|
| `js/leader.js` | render daftar (baris ~65) | Blok baris other item. **Jangan** memakai `bag_size_g` — tampilkan `item_name` + qty + unit. Tanpa ini, Leader menyetujui order tanpa melihat separuh isinya. |
| `js/packing.js` | `loadPackingRequestsSection()` (baris 1716) | Blok "Other Items" terpisah di kartu order, ditandai "no packing needed". Jangan masuk hitungan progres packing. |
| `js/packing.js` | `printOrderDetail()` (baris 3762) | Baris other item di cetakan. |
| `js/packing.js` | `printWaybill()` (baris 6250) | Baris other item di waybill — tanpa ini sopir menyerahkan barang yang salah. |
| `js/sales.js` | tabel Dispatch Request / Dispatch Approval | Jumlah baris & ringkasan ikut menghitung baris other item. |

### 7.4 Pemotongan stok saat checkout — js/packing.js

Di `runCheckout()` (baris 3364), setelah loop `consume_packed_lot` yang sudah ada, tambahkan loop kedua untuk baris other item:

```js
const { data: takenQty, error } = await window.supabaseClient.rpc('other_item_consume', {
    p_item_id: row.otherItemId, p_qty: row.qty,
    p_operation: 'dispatch', p_category: null,
    p_ref_table: 'request_order_other_items', p_ref_id: row.orderOtherItemId,
    p_date: null,
    p_reason: order && order.order_number ? `Checkout ${order.order_number}` : null,
    p_user: (currentUser && currentUser.name) || null
});
```

Dua aturan yang tidak boleh dilanggar:

1. **Kreditkan order dengan angka yang DIKEMBALIKAN RPC**, bukan dengan yang diminta. RPC menjepit di stok yang tersedia; kalau diminta 50 tapi hanya ada 30, order hanya boleh tercatat menerima 30. Ini aturan yang sama dengan `consume_packed_lot` (lihat komentar di js/packing.js:3376-3381).
2. **Ikuti guard double-submit yang sudah ada** — keranjang dikosongkan sebelum pemotongan pertama (js/packing.js:3367-3370, perbaikan `cb599a4`). Jangan menambahkan jalur kedua yang bisa dijalankan dua kali.

Sisa yang tidak terpenuhi masuk ke `quantity_unfulfilled` pada baris other item, mengikuti logika `choice === 'finish'` yang sudah ada untuk kopi.

---

## 8. Stock Release

Tab kedua di section yang sama. Empat kategori, sama persis dengan yang dipakai packed coffee (`STOCK_RELEASE_CATEGORIES`, js/packing.js:6951): `Sample`, `Internal`, `Marketing`, `Other`.

Kategori `Sales` milik packed coffee **tidak dipakai di sini** — penjualan barang ini sudah punya jalurnya sendiri lewat Sales Request, dan menyediakan dua jalur penjualan akan membuat angka penjualan tidak bisa direkonsiliasi.

Implementasi: satu panggilan `other_item_consume` dengan `p_operation='release'` dan `p_category=<kategori>`. Tabel riwayatnya adalah `other_item_movements` yang difilter `operation='release'`.

**Release bukan tempat mencatat barang rusak.** Aturan ini diwarisi dari packed coffee (lihat komentar js/packing.js:6943-6945: release mencatat barang keluar dalam kondisi BAIK, kerusakan masuk `waste_inventory`, dan kategori 'Damaged' sengaja tidak ada supaya satu kerugian tidak tercatat dua kali). Untuk other items, barang rusak/hilang dicatat lewat **koreksi stok di form Edit Item** (mockup layar 2) yang menghasilkan `operation='adjustment'` dengan alasan wajib. Tulis aturan ini di komentar header `js/otheritems.js`.

---

## 9. i18n

Semua teks UI **wajib** lewat `data-i18n` / `window.t()`, dengan key ditambahkan di `en` **dan** `ar` pada `js/translations.js`.

**Tidak boleh ada teks Bahasa Indonesia di UI.** Aplikasi ini berbahasa Inggris/Arab; commit `69ca581` adalah pekerjaan membersihkan teks Indonesia yang sempat bocor dari fitur checkout. Jangan mengulanginya. (Dokumen rencana dan pesan commit tetap boleh Bahasa Indonesia.)

Awalan key yang konsisten: `oi_*` (mis. `oi_title`, `oi_tab_list`, `oi_tab_release`, `oi_col_item_name`, `oi_btn_add_item`, `oi_btn_add_stock`, `oi_modal_history_title`, `oi_cat_sample`, ...).

---

## 10. Di luar cakupan (jangan dikerjakan tanpa diminta)

- **Stock opname** — barang ini tidak ikut dihitung dan tidak dibekukan saat opname kopi berjalan (§4.7).
- **Harga, nilai stok, dan margin** — tidak ada kolom harga sama sekali (§4.1). Karena itu statistik di halaman ini menampilkan Items / Low stock / Out of stock, bukan nilai uang.
- **Barcode / label cetak** untuk other items.
- **Harga per kategori customer.**
- **Reports** — tidak ada tab baru di Reports pada putaran ini (lihat memori: user masih punya rencana perubahan Reports yang belum dikerjakan).

---

## 11. Fase pengerjaan

| Fase | Isi | Selesai bila |
|---|---|---|
| 0 | Migrasi SQL + backfill permission + seed `MOCK_DB` + update `supabase_schema.sql` + `NOTIFY pgrst, 'reload schema';` | Tabel & RPC ada di produksi, `custom_roles` sudah punya 6 key baru |
| 1 | Section + submenu + tab + daftar item + form Add/Edit + Delete | Item bisa dibuat, diubah, dihapus; badge Low muncul sesuai `min_stock` |
| 2 | Add Stock + modal Stock History | Stok bertambah lewat RPC, tiap baris ledger menampilkan saldo yang benar |
| 3 | Tab Stock Release + modal Release | Release memotong stok dan muncul di tab & di history item |
| 4 | Sales Request: picker + simpan `request_order_other_items` + tampil di Leader, kartu Order Requests, cetakan | Order campuran bisa dibuat dan terbaca utuh di semua layar |
| 5 | Pemotongan stok di checkout + `quantity_unfulfilled` | Stok berkurang tepat saat dispatch, tercatat di ledger dengan `ref_table='request_order_other_items'` |
| 6 | (Opsional) badge low-stock di Dashboard | — |

Setiap fase: `node test.js` harus lolos, dan `?v=` file yang diubah dinaikkan sebelum push.

---

## 12. Ranjau (baca sebelum mulai)

1. **Jangan pakai kata "retail"** untuk fitur ini — `Retail` sudah berarti kategori customer (§3).
2. **Backfill permission itu wajib, bukan opsional** (§5.3). Pelajaran dari `purchase_request_view_own`: key yang hanya ada di kode tapi tidak ada di baris `custom_roles` = fitur tak terlihat, dan role yang dibuat setelah rilis tidak otomatis mendapatkannya.
3. **`applyMenuVisibility()` js/auth.js:427** punya daftar subitem yang di-hardcode. Lupa menambahkannya = menu Inventory hilang untuk role yang hanya punya akses ke section ini (§6.3).
4. **`NOTIFY pgrst, 'reload schema';`** setelah migrasi — tanpa ini PostgREST masih memakai cache skema lama dan REST API menolak kolom yang jelas-jelas sudah ada. Kadang perlu dijalankan dua kali.
5. **Jangan pernah menulis `stock_qty` langsung.** Semua lewat RPC, kalau tidak ledger akan melenceng dari stok dan tidak ada yang tahu sampai ada selisih (§4.4).
6. **Kreditkan order dengan angka kembalian RPC**, bukan angka yang diminta (§7.4).
7. **Approval tidak memotong stok** — hanya checkout (§7.2).
8. **`js/leader.js` merender `bag_size_g`** — baris other item tidak punya itu (§7.3).
9. **Release ≠ waste.** Barang rusak lewat koreksi stok, bukan release (§8).
10. **Tidak ada teks Indonesia di UI** (§9).
11. **Bump `?v=`** di `index.html` untuk setiap file JS yang diubah, termasuk `js/translations.js`.
12. **Tombol filter di header tabel butuh pembungkus `.tab-content`/`.packing-tab-content` ber-`id`** (§6.2). Tanpa itu filternya diam tanpa error.
13. Jalankan **`node test.js`** sebelum commit — repo ini punya sejarah regresi syntax error (commit `fc33261`).
