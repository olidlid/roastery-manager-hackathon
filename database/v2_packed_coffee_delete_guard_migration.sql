-- Phase 4 (F3): prevent deleting a packed_coffee row while any of its lots
-- still hold live stock. Without this, deleting the row silently orphans/
-- cascades any lots with remaining_pcs > 0, destroying stock with no trace
-- beyond whatever packed_stock_movements already logged up to that point.
--
-- BEFORE DELETE + RAISE EXCEPTION so the delete itself is rejected outright
-- (not an AFTER trigger that can only react after the row is already gone).

CREATE OR REPLACE FUNCTION public.prevent_packed_coffee_delete_with_stock()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.packed_coffee_lots
               WHERE packed_coffee_id = OLD.id AND COALESCE(remaining_pcs,0) > 0) THEN
        RAISE EXCEPTION
          'Cannot delete packed coffee %: lots still hold stock. Write it off or release it first.', OLD.id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_packed_coffee_delete ON public.packed_coffee;
CREATE TRIGGER trg_prevent_packed_coffee_delete
BEFORE DELETE ON public.packed_coffee
FOR EACH ROW EXECUTE FUNCTION prevent_packed_coffee_delete_with_stock();

NOTIFY pgrst, 'reload schema';
