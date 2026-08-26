-- Stock Opname Fase 2 (STOCK_OPNAME_PLAN.md): pembekuan transaksi stok
-- dipaksa di level database — bukan disembunyikan tombolnya saja.
-- Pelajaran STOCK_LEDGER_PLAN.md: kalau sebuah aturan penting, database
-- yang harus memaksakannya.
--
-- BEFORE INSERT OR UPDATE OR DELETE pada tiga tabel sumber stok: menolak
-- SEMUA perubahan selama ada baris stock_takes berstatus 'counting'.
--
-- Nama trigger SENGAJA diawali "trg_aa_" — trigger BEFORE dengan event
-- yang sama dieksekusi Postgres urut alfabetis nama trigger, bukan urutan
-- pembuatan. "aa" mengurut sebelum "log" (trg_log_packed_stock_movement,
-- trg_log_bulk_stock_movement) dan "sync", jadi penjaga ini SELALU
-- RAISE EXCEPTION sebelum trigger ledger/derived-column sempat menulis
-- apa pun. Diverifikasi lewat information_schema.triggers sebelum migrasi
-- ini ditulis: packed_coffee_lots & bulk_roasted_coffee masing-masing
-- sudah punya satu trigger BEFORE (log_packed_stock_movement /
-- log_bulk_stock_movement); green_coffee_lots belum punya trigger BEFORE
-- sama sekali (sync_green_coffee_stock-nya AFTER), jadi di situ penjaga
-- ini otomatis jadi satu-satunya BEFORE trigger.
--
-- Cara opname sendiri lolos: saat posting, status diubah 'counting' ->
-- 'posting' SEBELUM penyesuaian ditulis (lihat js/app.js finalizeStockTake,
-- Fase 6). Penjaga ini hanya memblokir 'counting', bukan 'posting' — lihat
-- STOCK_OPNAME_PLAN.md §2 untuk kompromi jendela 'posting' yang disadari.
CREATE OR REPLACE FUNCTION public.stock_take_freeze_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.stock_takes WHERE status = 'counting') THEN
        RAISE EXCEPTION
          'Stock opname sedang berjalan — perubahan stok dikunci sampai opname diposting atau dibatalkan.';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_aa_stock_take_freeze ON public.packed_coffee_lots;
CREATE TRIGGER trg_aa_stock_take_freeze
BEFORE INSERT OR UPDATE OR DELETE ON public.packed_coffee_lots
FOR EACH ROW EXECUTE FUNCTION stock_take_freeze_guard();

DROP TRIGGER IF EXISTS trg_aa_stock_take_freeze ON public.green_coffee_lots;
CREATE TRIGGER trg_aa_stock_take_freeze
BEFORE INSERT OR UPDATE OR DELETE ON public.green_coffee_lots
FOR EACH ROW EXECUTE FUNCTION stock_take_freeze_guard();

DROP TRIGGER IF EXISTS trg_aa_stock_take_freeze ON public.bulk_roasted_coffee;
CREATE TRIGGER trg_aa_stock_take_freeze
BEFORE INSERT OR UPDATE OR DELETE ON public.bulk_roasted_coffee
FOR EACH ROW EXECUTE FUNCTION stock_take_freeze_guard();
