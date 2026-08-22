-- V2 Extend packed lot atomic RPCs with optional movement-context
-- parameters (STOCK_LEDGER_PLAN.md Phase 2->3 addendum).
--
-- Phase 2's ledger trigger reads mv_operation/mv_ref_table/mv_ref_id/
-- mv_reason/mv_user off the packed_coffee_lots row being updated. Setting
-- those via a SEPARATE saveData() call before calling consume_packed_lot
-- works in isolation but is not safe under concurrency: another request's
-- RPC call could land between the two writes and either consume this
-- context for itself or overwrite it before this call's UPDATE runs —
-- exactly what Phase 1's atomic RPCs exist to prevent. These new
-- parameters let a caller set context in the SAME UPDATE that changes
-- remaining_pcs.
--
-- CREATE OR REPLACE FUNCTION can add new parameters to the end of an
-- existing function's argument list as long as they have defaults, without
-- needing to DROP the function first — the existing 2-argument call sites
-- (10 of them across js/packing.js and js/sales.js) keep working unchanged,
-- falling back to NULL context (the trigger's own COALESCE turns that into
-- 'unspecified'). Phase 3 goes through those 10 sites and adds the
-- trailing arguments one at a time.

CREATE OR REPLACE FUNCTION public.consume_packed_lot(
    p_lot_id INTEGER, p_pcs INTEGER,
    p_operation TEXT DEFAULT NULL, p_ref_table TEXT DEFAULT NULL,
    p_ref_id INTEGER DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
    WITH before AS (
        SELECT remaining_pcs FROM public.packed_coffee_lots WHERE id = p_lot_id FOR UPDATE
    ), updated AS (
        UPDATE public.packed_coffee_lots
        SET remaining_pcs = remaining_pcs - LEAST(remaining_pcs, GREATEST(p_pcs, 0)),
            mv_operation = p_operation, mv_ref_table = p_ref_table,
            mv_ref_id = p_ref_id, mv_reason = p_reason, mv_user = p_user
        WHERE id = p_lot_id
        RETURNING remaining_pcs
    )
    SELECT COALESCE((SELECT remaining_pcs FROM before), 0)
         - COALESCE((SELECT remaining_pcs FROM updated), 0);
$$;

CREATE OR REPLACE FUNCTION public.refund_packed_lot(
    p_lot_id INTEGER, p_pcs INTEGER,
    p_operation TEXT DEFAULT NULL, p_ref_table TEXT DEFAULT NULL,
    p_ref_id INTEGER DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE public.packed_coffee_lots
    SET remaining_pcs = remaining_pcs + GREATEST(p_pcs, 0),
        mv_operation = p_operation, mv_ref_table = p_ref_table,
        mv_ref_id = p_ref_id, mv_reason = p_reason, mv_user = p_user
    WHERE id = p_lot_id
    RETURNING remaining_pcs;
$$;

-- Deliberately does NOT touch quantity_pcs — that column is the lot's
-- historical "how much was originally packed" figure and must not be
-- rewritten by a stock correction (STOCK_LEDGER_PLAN.md F6).
CREATE OR REPLACE FUNCTION public.set_packed_lot_remaining(
    p_lot_id INTEGER, p_pcs INTEGER,
    p_operation TEXT DEFAULT NULL, p_ref_table TEXT DEFAULT NULL,
    p_ref_id INTEGER DEFAULT NULL, p_reason TEXT DEFAULT NULL, p_user TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE public.packed_coffee_lots
    SET remaining_pcs = GREATEST(0, p_pcs),
        mv_operation = p_operation, mv_ref_table = p_ref_table,
        mv_ref_id = p_ref_id, mv_reason = p_reason, mv_user = p_user
    WHERE id = p_lot_id
    RETURNING remaining_pcs;
$$;

GRANT EXECUTE ON FUNCTION public.consume_packed_lot(INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_packed_lot(INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_packed_lot_remaining(INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
