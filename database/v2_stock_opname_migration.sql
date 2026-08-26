-- Stock Opname Fase 0 (STOCK_OPNAME_PLAN.md): fondasi skema — siklus hidup
-- (status), penyimpanan bertahap per baris (counted), dan traceability lot
-- untuk rincian Tahap 2. Migrasi ini murni ADDITIVE: tidak ada perilaku
-- aplikasi yang berubah sampai Fase 1+ membaca kolom-kolom ini. Baris lama
-- di kedua tabel tetap terbaca persis seperti sebelumnya.

-- ============================================================================
-- stock_takes: kolom siklus hidup
-- ============================================================================
-- DEFAULT 'posted' disengaja: semua baris lama sudah selesai diproses lewat
-- jalur lama (finalizeStockTake langsung menyesuaikan stok, tidak pernah
-- melalui status 'counting'). Default lain akan membuat baris lama ikut
-- kelihatan sebagai opname yang sedang berjalan begitu Fase 2 memasang
-- trigger pembekuan berdasarkan status ini.
ALTER TABLE public.stock_takes
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'posted',
    ADD COLUMN IF NOT EXISTS started_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS started_by    TEXT,
    ADD COLUMN IF NOT EXISTS posted_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS counted_items INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS skipped_items INTEGER DEFAULT 0;

-- Nilai status yang valid: 'counting' | 'posting' | 'posted' | 'cancelled'.
-- Tidak diberi CHECK constraint eksplisit supaya nilai baru bisa ditambah
-- tanpa migrasi skema lagi — divalidasi di sisi aplikasi.

-- Hanya boleh ada satu opname aktif (status 'counting' atau 'posting') di
-- seluruh tabel pada satu waktu. Index unik pada konstanta (1) dengan
-- predikat parsial adalah cara baku Postgres memaksa "maksimal satu baris
-- memenuhi kondisi ini" — tanpa ini, dua orang bisa membuka opname
-- bersamaan dan saling menimpa (STOCK_OPNAME_PLAN.md §Fase 0).
CREATE UNIQUE INDEX IF NOT EXISTS stock_takes_one_active_uniq
ON public.stock_takes ((1))
WHERE status IN ('counting', 'posting');

-- ============================================================================
-- stock_take_items: penyimpanan bertahap + traceability lot
-- ============================================================================
ALTER TABLE public.stock_take_items
    -- counted membedakan "dihitung, hasilnya sama dengan sistem" dari
    -- "belum disentuh sama sekali" — sebelum migrasi ini keduanya tidak
    -- bisa dibedakan karena kolom kosong ditulis ulang jadi system_qty
    -- saat finalize (js/app.js:3681, cacat #1 di STOCK_OPNAME_PLAN.md).
    ADD COLUMN IF NOT EXISTS counted       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS counted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS counted_by    TEXT,
    -- posted_at membuat proses posting bisa diulang dengan aman: baris yang
    -- penyesuaiannya sudah berhasil ditulis dilewati saat posting diulang
    -- setelah gagal di tengah jalan (STOCK_OPNAME_PLAN.md §5.2).
    ADD COLUMN IF NOT EXISTS posted_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_found_item BOOLEAN NOT NULL DEFAULT FALSE,
    -- parent_item_id menunjuk baris grup Tahap 1 dari sebuah baris lot
    -- Tahap 2 (packed coffee saja). Baris grup sendiri punya
    -- parent_item_id IS NULL. Sengaja TANPA foreign key ke tabel yang sama
    -- — pola yang sama dipakai packed_stock_movements.packed_coffee_lot_id
    -- — supaya penghapusan tidak berantai.
    ADD COLUMN IF NOT EXISTS parent_item_id INTEGER,
    -- ref_table + ref_id menunjuk sumber baris: 'packed_coffee_lots' untuk
    -- baris lot Tahap 2, 'green_coffee', atau 'bulk_roasted_coffee'.
    ADD COLUMN IF NOT EXISTS ref_table     TEXT,
    ADD COLUMN IF NOT EXISTS ref_id        INTEGER,
    -- Salinan (snapshot), bukan lookup — supaya lembar opname lama tetap
    -- terbaca meski lot/kode sumbernya sudah habis dan terhapus, sama
    -- seperti packed_stock_movements menyalin coffee_name/lot_code/dst.
    ADD COLUMN IF NOT EXISTS coffee_code   TEXT,
    ADD COLUMN IF NOT EXISTS strip_code    TEXT,
    ADD COLUMN IF NOT EXISTS lot_code      TEXT,
    ADD COLUMN IF NOT EXISTS machine_name  TEXT,
    ADD COLUMN IF NOT EXISTS bag_size_g    NUMERIC;

CREATE INDEX IF NOT EXISTS stock_take_items_parent_idx
ON public.stock_take_items (parent_item_id);

NOTIFY pgrst, 'reload schema';
