-- ============================================================================
-- CRM Management Page — Fase 0
-- CRM_PAGE_PLAN.md §4 + §5.4, CRM_JOURNEY_DATA.md §3
--
-- Jalankan SEKALI di Supabase SQL Editor, lalu jalankan blok verifikasi di
-- bagian paling bawah dan bandingkan hasilnya dengan angka yang tertulis di
-- sana.
--
-- Aman untuk aplikasi yang sedang berjalan: semuanya penambahan (kolom baru
-- yang nullable, tabel baru, key baru di jsonb). Tidak ada kolom yang diubah
-- tipenya, tidak ada data lama yang ditimpa, tidak ada yang dihapus.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Kolom kepemilikan & jejak pembuatan pada customers
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS owner_sales_id   UUID,          -- profiles.id
  ADD COLUMN IF NOT EXISTS owner_sales_name TEXT,          -- snapshot nama, pola sama seperti decided_by_name
  ADD COLUMN IF NOT EXISTS owner_since      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by_id    UUID,
  ADD COLUMN IF NOT EXISTS created_by_name  TEXT,
  ADD COLUMN IF NOT EXISTS deactivated_at   TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 2. Sejarah kepemilikan — HANYA DITAMBAH, tidak pernah diubah/dihapus
--    (CRM_JOURNEY_DATA.md §3.2: tanpa ini, memindah kepemilikan ikut mengubah
--     atribusi bulan-bulan sebelumnya dan sales lama kehilangan pencapaiannya)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_owner_history (
    id              SERIAL PRIMARY KEY,
    customer_id     INTEGER NOT NULL,
    from_sales_id   UUID,
    from_sales_name TEXT,
    to_sales_id     UUID,
    to_sales_name   TEXT,
    changed_by_id   UUID,
    changed_by_name TEXT,
    changed_at      TIMESTAMPTZ DEFAULT NOW(),
    note            TEXT
);

CREATE INDEX IF NOT EXISTS idx_customer_owner_history_customer
  ON public.customer_owner_history (customer_id, changed_at);

ALTER TABLE public.customer_owner_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS full_access ON public.customer_owner_history;
CREATE POLICY full_access ON public.customer_owner_history
  FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. Backfill kepemilikan — sales yang paling banyak mengorder untuk customer
--    itu (CRM_PAGE_PLAN.md §2.5). Cancelled tidak dihitung.
--    owner_since = tanggal order pertama sales tersebut untuk customer itu.
-- ---------------------------------------------------------------------------
WITH ranked AS (
    SELECT ro.customer_id,
           ro.sales_name,
           COUNT(*)            AS order_count,
           MIN(ro.order_date)  AS first_order,
           ROW_NUMBER() OVER (
               PARTITION BY ro.customer_id
               ORDER BY COUNT(*) DESC, MIN(ro.order_date) ASC
           ) AS rn
    FROM public.request_orders ro
    WHERE ro.customer_id IS NOT NULL
      AND COALESCE(ro.sales_name, '') <> ''
      AND COALESCE(ro.status, '') <> 'Cancelled'
    GROUP BY ro.customer_id, ro.sales_name
)
UPDATE public.customers c
SET owner_sales_name = r.sales_name,
    owner_sales_id   = p.id,
    owner_since      = r.first_order::timestamptz
FROM ranked r
LEFT JOIN public.profiles p ON p.name = r.sales_name
WHERE r.rn = 1
  AND c.id = r.customer_id
  AND c.owner_sales_name IS NULL;   -- idempoten: tidak menimpa yang sudah terisi

-- ---------------------------------------------------------------------------
-- 4. Backfill pembuat customer — sales pada order PALING AWAL customer itu.
--    Customer tanpa order sama sekali dibiarkan NULL, jangan ditebak.
-- ---------------------------------------------------------------------------
WITH firsts AS (
    SELECT DISTINCT ON (ro.customer_id)
           ro.customer_id, ro.sales_name
    FROM public.request_orders ro
    WHERE ro.customer_id IS NOT NULL
      AND COALESCE(ro.sales_name, '') <> ''
    ORDER BY ro.customer_id, ro.order_date ASC, ro.id ASC
)
UPDATE public.customers c
SET created_by_name = f.sales_name,
    created_by_id   = p.id
FROM firsts f
LEFT JOIN public.profiles p ON p.name = f.sales_name
WHERE c.id = f.customer_id
  AND c.created_by_name IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Baris history pertama untuk setiap kepemilikan hasil backfill,
--    supaya asal-usul owner_since ada jejaknya sejak hari pertama.
-- ---------------------------------------------------------------------------
INSERT INTO public.customer_owner_history
       (customer_id, from_sales_id, from_sales_name, to_sales_id, to_sales_name,
        changed_by_id, changed_by_name, changed_at, note)
SELECT c.id, NULL, NULL, c.owner_sales_id, c.owner_sales_name,
       NULL, 'system', COALESCE(c.owner_since, NOW()),
       'backfill: sales dengan order terbanyak untuk customer ini'
FROM public.customers c
WHERE c.owner_sales_name IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.customer_owner_history h WHERE h.customer_id = c.id
  );

-- ---------------------------------------------------------------------------
-- 6. Backfill permission crm_manage ke SEMUA baris custom_roles.
--    Key yang tidak ada di baris role dibaca false oleh hasPermission() —
--    tanpa langkah ini halaman baru tidak terlihat oleh siapa pun, termasuk
--    Admin (persis yang pernah terjadi pada purchase_request_view_own).
-- ---------------------------------------------------------------------------
UPDATE public.custom_roles
SET permissions = permissions || jsonb_build_object(
        'crm_manage',
        name IN ('Developer', 'Admin', 'Production Leader')
    )
WHERE NOT (permissions ? 'crm_manage');

-- ---------------------------------------------------------------------------
-- 7. PostgREST menyimpan cache skema — tanpa ini REST API tetap berkata
--    kolomnya tidak ada. Kadang perlu dijalankan dua kali.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFIKASI — jalankan setelah blok di atas selesai.
-- Angka acuan per 2026-09-26: 47 customer, 39 punya order, 8 tanpa order.
-- ============================================================================
SELECT
    (SELECT COUNT(*) FROM public.customers)                                        AS customers_total,
    (SELECT COUNT(*) FROM public.customers WHERE owner_sales_id   IS NOT NULL)     AS punya_owner_id,
    (SELECT COUNT(*) FROM public.customers WHERE owner_sales_name IS NOT NULL)     AS punya_owner_nama,
    (SELECT COUNT(*) FROM public.customers WHERE created_by_name  IS NOT NULL)     AS punya_pembuat,
    (SELECT COUNT(*) FROM public.customer_owner_history)                           AS baris_history,
    (SELECT COUNT(*) FROM public.custom_roles WHERE permissions ? 'crm_manage')    AS role_punya_key,
    (SELECT COUNT(*) FROM public.custom_roles WHERE (permissions->>'crm_manage')::boolean IS TRUE) AS role_crm_aktif;
-- Harapan: punya_owner_id = punya_owner_nama = 39, punya_pembuat = 39,
--          baris_history = 39, role_punya_key = jumlah seluruh role,
--          role_crm_aktif = 3 (Developer, Admin, Production Leader).
-- Kalau punya_owner_id < punya_owner_nama, ada sales_name yang tidak cocok
-- dengan profiles.name — periksa dengan query di bawah, JANGAN dibiarkan.

SELECT DISTINCT c.owner_sales_name
FROM public.customers c
WHERE c.owner_sales_name IS NOT NULL
  AND c.owner_sales_id IS NULL;
-- Harapan: 0 baris.
