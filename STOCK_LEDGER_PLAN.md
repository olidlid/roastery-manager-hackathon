# Stock Ledger — Execution Plan

**Status:** approved for execution, not started
**Audit date:** 2026-08-22 (live, against production)
**Goal:** every change to packed stock is atomic, lot-specific, and permanently traceable — so any future error can be found and reversed.

This plan is written to be executed without the conversation that produced it. Every finding below was **reproduced with a controlled test in the live app**, not inferred from reading code. Test rows were created and deleted; production data was verified clean afterward (100 `packed_coffee` rows / 248 lots / 0 quantity mismatches).

---

## 1. Why this keeps happening

Three failures this codebase has now repeated, each with the same root cause: **correctness was left to application discipline instead of being enforced by the database.**

- `green_coffee.stock_kg` drifted across ~9 call sites until a trigger made it derived.
- `packed_coffee.quantity` drifted across 13 rows the same way, until the same trigger fix (`sync_packed_coffee_quantity`, commit `e3abcd3`).
- That trigger's own migration then claimed leftover manual writes were *"redundant but harmless"* — which was **wrong**. Stale-snapshot writes clobbered the trigger's correct value and produced the Take/Undo bug (commit `cdc2694`).

**The rule this plan is built on:** if an invariant matters, a trigger or a database function must enforce it. Never a comment, never a convention, never "all call sites should remember to…".

### Hard invariant

After Phase 2, this must hold for every lot, forever:

```
SUM(packed_stock_movements.delta_pcs) per lot  ==  packed_coffee_lots.remaining_pcs
```

Because the trigger is the **sole** writer of the ledger, any deviation means something is structurally wrong and is detectable with one query — instead of surfacing months later as an unexplained stock difference.

---

## 2. Proven findings

| # | Finding | Severity | Proof |
|---|---|---|---|
| **F1** | **Stock Take is silently broken for packed AND green coffee.** `finalizeStockTake` writes the derived columns directly. | Critical — actively misleading operators today | Wrote 60, UI showed 60, one lot activity later it became 90. The physical count correction vanished (should have been 50). |
| **F2** | **Race condition is real.** All `packed_coffee_lots` writes are read-modify-write from a JS snapshot. | Critical | Two concurrent checkouts read 100, took 30 and 20; only 20 was deducted. **30 pcs left the warehouse with no record.** |
| **F3** | **Deleting a `packed_coffee` row destroys live stock silently.** FK cascades. | Critical | Deleted a parent whose lot held 80 pcs — no error, no warning, no waste record, lot gone. |
| **F4** | **Order-approval auto-fulfill writes no per-lot audit row** (`js/sales.js` ~1724). | High | This is precisely why `undoCommittedQty` cannot restore that portion. 1,213 pcs currently in this state. |
| **F5** | **Manual stock edits have no log at all** (`adjustPackedStock`, Edit Packed Stock modal). | High | Arithmetic is correct and FIFO-ordered, but untraceable. |
| **F6** | **Manual increase rewrites lot history.** `applyPackedCoffeeManualQtyDelta(+30)` raised an existing lot's `quantity_pcs` 100 → 130. | Medium | That column means "how much was originally packed"; a stocktake must not alter it. |

**Reconciliation baseline:** only 99 of 248 lots fully reconcile. 10,456 pcs left stock untraced overall — **3,176 of it in August alone**, so this is not merely pre-feature residue.

### Deliberately out of scope (with reasons)

- **Bulk roasted coffee** — 129 rows checked: 0 negative, 0 phantom stock lacking a roasting record, 1 row "impossible" by only 0.04 kg (rounding). 70 rows show drift, but that number is **not** evidence of corruption: 125 `packing_records` have no lot link, so outflow tracing is necessarily incomplete and real drift cannot be separated from untraceable-by-design. No active corruption found. Bulk still has no lot table and the same race exposure across ~10 sites — deferred to Phase 6, not ignored.
- **`js/leader.js` and the Capacitor Android app** — verified clean. A grep for every stock column returns nothing. There is no second code path to keep in sync.

---

## 3. Phase order is a dependency chain, not a preference

Phases are numbered because **order carries correctness**, not for presentation:

- Phase 1 (atomic writes) **must** precede Phase 2 (ledger). Build the ledger first and it will faithfully record numbers that F2 has already corrupted — a tidy audit trail of wrong data is worse than none, because it manufactures confidence.
- Phase 5 (undo reads the ledger) depends on Phase 3 having populated context.

---

## Phase 0 — Stop the active bug: Stock Take

**Why first:** operators are counting stock correctly right now, being told it saved, and having it silently reverted.

**File:** `js/app.js`
**Anchors:** `applyStockGroupAdjustment` (~line 3573), `finalizeStockTake` (~line 3594, the `saveData(row.table, row.rec)` loop ~line 3641)

`applyStockGroupAdjustment` mutates `group.field` on the source row, then `finalizeStockTake` persists it. For `packed` the field is `packed_coffee.quantity`; for `green` it is `green_coffee.stock_kg`. **Both are trigger-derived** and will be reverted. Only `bulk_available` is a real column and may keep the current path.

**Change:** route packed and green adjustments through the lots, keeping bulk as-is.

- **packed** → reuse the existing `applyPackedCoffeeManualQtyDelta(packedCoffeeId, delta)` in `js/packing.js` (loaded before `app.js`, so it is in scope). Split the group delta across the group's `packed_coffee` rows in the same order the current code deducts, then call it per row.
- **green** → same shape via the existing atomic RPCs, `adjust_green_coffee_lot` / `refund_green_coffee_lot`. Do **not** write `green_coffee.stock_kg`.
- **bulk** → unchanged.

**Ordering note:** Phase 4 changes `applyPackedCoffeeManualQtyDelta` (F6). Phase 0 only calls it, so the two do not conflict.

**Verify:**
1. `node test.js`
2. Run a Stock Take on a packed item, set a count different from system, finalize.
3. Then perform any lot activity on that item (e.g. a dispatch).
4. The corrected figure must survive. Before this fix it reverted — that is the exact regression test.
5. Repeat for a green coffee item.

---

## Phase 1 — Atomic lot writes (blocks Phase 2)

**Goal:** eliminate F2. Mirror the green-bean pattern that is already proven in production.

**New file:** `database/v2_packed_lot_atomic_functions_migration.sql`

Model these exactly on `database/v2_greenbean_lot_atomic_functions_migration.sql` — same `LANGUAGE sql`, single statement, `FOR UPDATE` row lock, `SET search_path = public` (a Supabase advisor WARN was raised on the green ones for omitting it).

```sql
-- Atomically consumes up to p_pcs from a lot, clamped to what exists.
-- Returns the pcs ACTUALLY taken, so the caller can spill the shortfall
-- to the next lot instead of assuming it got what it asked for.
CREATE OR REPLACE FUNCTION public.consume_packed_lot(p_lot_id INTEGER, p_pcs INTEGER)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
    WITH before AS (
        SELECT remaining_pcs FROM public.packed_coffee_lots WHERE id = p_lot_id FOR UPDATE
    ), updated AS (
        UPDATE public.packed_coffee_lots
        SET remaining_pcs = remaining_pcs - LEAST(remaining_pcs, GREATEST(p_pcs, 0))
        WHERE id = p_lot_id
        RETURNING remaining_pcs
    )
    SELECT COALESCE((SELECT remaining_pcs FROM before), 0)
         - COALESCE((SELECT remaining_pcs FROM updated), 0);
$$;

CREATE OR REPLACE FUNCTION public.refund_packed_lot(p_lot_id INTEGER, p_pcs INTEGER)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE public.packed_coffee_lots
    SET remaining_pcs = remaining_pcs + GREATEST(p_pcs, 0)
    WHERE id = p_lot_id
    RETURNING remaining_pcs;
$$;

-- Sets an absolute count (stocktake correction). Deliberately does NOT
-- touch quantity_pcs — see F6.
CREATE OR REPLACE FUNCTION public.set_packed_lot_remaining(p_lot_id INTEGER, p_pcs INTEGER)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
    UPDATE public.packed_coffee_lots
    SET remaining_pcs = GREATEST(0, p_pcs)
    WHERE id = p_lot_id
    RETURNING remaining_pcs;
$$;

GRANT EXECUTE ON FUNCTION public.consume_packed_lot(INTEGER, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_packed_lot(INTEGER, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_packed_lot_remaining(INTEGER, INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
```

**Call sites to convert** (every one is currently read-modify-write):

| File | Line | Flow | Replace with |
|---|---|---|---|
| `js/packing.js` | ~1222 | Custom blend source consumption | `consume_packed_lot` |
| `js/packing.js` | ~1457 | Edit packing record correction | `set_packed_lot_remaining` (+ `quantity_pcs` write stays, it is a genuine record correction) |
| `js/packing.js` | ~2081 | Undo committed qty | `refund_packed_lot` |
| `js/packing.js` | ~2419 | Dispatch checkout | `consume_packed_lot` |
| `js/packing.js` | ~3412 | `getOrCreatePackedCoffeeLot` merge-into-existing | `refund_packed_lot` (it is an increment) |
| `js/packing.js` | ~3551 | `applyPackedCoffeeManualQtyDelta` decrease | `consume_packed_lot` |
| `js/packing.js` | ~5342 | Repack source consumption | `consume_packed_lot` |
| `js/packing.js` | ~6057 | Stock release | `consume_packed_lot` |
| `js/sales.js` | ~1747 | Approval auto-fulfill | `consume_packed_lot` |

**Important:** `consume_packed_lot` returns pcs *actually* taken. Where the current code assumes it got the full amount, use the return value to drive the FIFO spill to the next lot. This is what makes an over-draw physically impossible rather than merely unlikely.

**Verify:** re-run the concurrency test — two simultaneous consumes of 30 and 20 against a 100-pc test lot must leave exactly 50. Before this phase it left 80.

---

## Phase 2 — The ledger

**New file:** `database/v2_packed_stock_movements_migration.sql`

### Table

```sql
CREATE TABLE IF NOT EXISTS public.packed_stock_movements (
    id BIGSERIAL PRIMARY KEY,
    packed_coffee_lot_id INTEGER,   -- INTENTIONALLY no FK: see note
    packed_coffee_id INTEGER,
    lot_code TEXT,                  -- snapshots, so the row stays readable
    strip_code TEXT,                -- after the lot itself is deleted
    coffee_name TEXT,
    machine_id INTEGER,
    bag_size_g INTEGER,
    delta_pcs INTEGER NOT NULL,     -- (+) in, (-) out
    balance_after INTEGER,
    operation TEXT,
    ref_table TEXT,
    ref_id INTEGER,
    reason TEXT,
    performed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS psm_lot_idx ON public.packed_stock_movements (packed_coffee_lot_id, id);
CREATE INDEX IF NOT EXISTS psm_created_idx ON public.packed_stock_movements (created_at);
CREATE INDEX IF NOT EXISTS psm_ref_idx ON public.packed_stock_movements (ref_table, ref_id);
```

> **No foreign key on `packed_coffee_lot_id` — this is deliberate.** A cascading FK would delete a lot's history at exactly the moment it becomes evidence (F3). The denormalized `lot_code` / `strip_code` / `coffee_name` keep the row human-readable after the lot is gone.

### Context columns

```sql
ALTER TABLE public.packed_coffee_lots
    ADD COLUMN IF NOT EXISTS mv_operation TEXT,
    ADD COLUMN IF NOT EXISTS mv_ref_table TEXT,
    ADD COLUMN IF NOT EXISTS mv_ref_id    INTEGER,
    ADD COLUMN IF NOT EXISTS mv_reason    TEXT,
    ADD COLUMN IF NOT EXISTS mv_user      TEXT;
```

### Trigger — must be BEFORE, not AFTER

Two non-obvious requirements, both learned the hard way:

1. **`BEFORE`, so the context columns can be cleared after being consumed.** `js/sales.js:1747` passes the *whole* lot object to `saveData`. If context persisted on the row, the next write would resend it and silently mislabel that movement.
2. **`packed_coffee_id` must be in the `UPDATE OF` list.** The existing `sync_packed_coffee_quantity` trigger omits it — which is exactly why 23 rows went stale during the duplicate-merge earlier and had to be repaired by hand.

```sql
CREATE OR REPLACE FUNCTION public.log_packed_stock_movement() RETURNS TRIGGER AS $$
DECLARE
    v_parent public.packed_coffee%ROWTYPE;
    v_delta  INTEGER;
    v_op     TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT * INTO v_parent FROM public.packed_coffee WHERE id = OLD.packed_coffee_id;
        IF COALESCE(OLD.remaining_pcs, 0) <> 0 THEN
            INSERT INTO public.packed_stock_movements (
                packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
                coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
                operation, ref_table, ref_id, reason, performed_by)
            VALUES (OLD.id, OLD.packed_coffee_id, OLD.lot_code, OLD.strip_code,
                v_parent.custom_coffee_name, v_parent.machine_id, v_parent.bag_size_g,
                -OLD.remaining_pcs, 0,
                COALESCE(OLD.mv_operation, 'lot_deleted'), OLD.mv_ref_table, OLD.mv_ref_id,
                OLD.mv_reason, OLD.mv_user);
        END IF;
        RETURN OLD;
    END IF;

    SELECT * INTO v_parent FROM public.packed_coffee WHERE id = NEW.packed_coffee_id;

    IF TG_OP = 'INSERT' THEN
        v_delta := COALESCE(NEW.remaining_pcs, 0);
        v_op    := COALESCE(NEW.mv_operation, 'lot_created');
    ELSE
        v_delta := COALESCE(NEW.remaining_pcs, 0) - COALESCE(OLD.remaining_pcs, 0);
        v_op    := COALESCE(NEW.mv_operation, 'unspecified');

        -- Lot reassigned to a different parent: record the transfer even
        -- when remaining_pcs itself did not change.
        IF NEW.packed_coffee_id IS DISTINCT FROM OLD.packed_coffee_id THEN
            INSERT INTO public.packed_stock_movements (
                packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
                coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
                operation, ref_table, ref_id, reason, performed_by)
            VALUES (OLD.id, OLD.packed_coffee_id, OLD.lot_code, OLD.strip_code,
                NULL, NULL, NULL,
                -COALESCE(OLD.remaining_pcs, 0), 0,
                'transfer_out', NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);
            INSERT INTO public.packed_stock_movements (
                packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
                coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
                operation, ref_table, ref_id, reason, performed_by)
            VALUES (NEW.id, NEW.packed_coffee_id, NEW.lot_code, NEW.strip_code,
                v_parent.custom_coffee_name, v_parent.machine_id, v_parent.bag_size_g,
                COALESCE(OLD.remaining_pcs, 0), COALESCE(OLD.remaining_pcs, 0),
                'transfer_in', NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);
        END IF;
    END IF;

    IF v_delta <> 0 THEN
        INSERT INTO public.packed_stock_movements (
            packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
            coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
            operation, ref_table, ref_id, reason, performed_by)
        VALUES (NEW.id, NEW.packed_coffee_id, NEW.lot_code, NEW.strip_code,
            v_parent.custom_coffee_name, v_parent.machine_id, v_parent.bag_size_g,
            v_delta, COALESCE(NEW.remaining_pcs, 0),
            v_op, NEW.mv_ref_table, NEW.mv_ref_id, NEW.mv_reason, NEW.mv_user);
    END IF;

    -- Context is single-use. Clearing it here is what prevents a stale
    -- label being resent by a caller that passes the whole row object.
    NEW.mv_operation := NULL;
    NEW.mv_ref_table := NULL;
    NEW.mv_ref_id    := NULL;
    NEW.mv_reason    := NULL;
    NEW.mv_user      := NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_packed_stock_movement ON public.packed_coffee_lots;
CREATE TRIGGER trg_log_packed_stock_movement
BEFORE INSERT OR UPDATE OF remaining_pcs, packed_coffee_id OR DELETE
ON public.packed_coffee_lots
FOR EACH ROW EXECUTE FUNCTION log_packed_stock_movement();
```

### Backfill the opening balance

Without this, every pre-existing lot shows a permanent phantom difference.

```sql
INSERT INTO public.packed_stock_movements (
    packed_coffee_lot_id, packed_coffee_id, lot_code, strip_code,
    coffee_name, machine_id, bag_size_g, delta_pcs, balance_after,
    operation, reason, created_at)
SELECT l.id, l.packed_coffee_id, l.lot_code, l.strip_code,
       p.custom_coffee_name, p.machine_id, p.bag_size_g,
       l.remaining_pcs, l.remaining_pcs,
       'opening_balance',
       'Ledger introduced 2026-08-22; movements before this date are not itemised',
       NOW()
FROM public.packed_coffee_lots l
LEFT JOIN public.packed_coffee p ON p.id = l.packed_coffee_id;

NOTIFY pgrst, 'reload schema';
```

### Also required

- Add `'packed_stock_movements'` to the RLS array in `database/supabase_schema.sql` (~line 852). **Omitting this leaves the table inaccessible to the app.** This project has a documented history of RLS drift causing silent no-op writes.
- Mirror the whole migration into `database/supabase_schema.sql` per the project's schema-sync rule.
- Run `NOTIFY pgrst, 'reload schema';` — occasionally needs running twice.

**Verify:** the hard invariant query in §Appendix must return zero rows.

---

## Phase 3 — Populate context

Set `mv_operation` / `mv_ref_table` / `mv_ref_id` / `mv_user` on every write from Phase 1's table. Suggested vocabulary — keep it closed, do not invent per-call-site variants:

`pack` · `dispatch` · `undo` · `approval_fulfil` · `release` · `repack` · `blend` · `manual_edit` · `stocktake` · `correction` · `lot_deleted` · `transfer_in` · `transfer_out`

Because the trigger logs regardless, completeness is already guaranteed — this phase only improves attribution. Drive it with the "what is still unattributed" query in the Appendix until it returns nothing.

---

## Phase 4 — Guards and history integrity

**F3 — block destructive deletes at the database level**, not only in the UI (the UI button is being removed anyway, but a guard must survive future UI changes):

```sql
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_packed_coffee_delete ON public.packed_coffee;
CREATE TRIGGER trg_prevent_packed_coffee_delete
BEFORE DELETE ON public.packed_coffee
FOR EACH ROW EXECUTE FUNCTION prevent_packed_coffee_delete_with_stock();
```

**F6 — stop rewriting lot history.** In `applyPackedCoffeeManualQtyDelta` (`js/packing.js` ~3535), an increase currently routes through `getOrCreatePackedCoffeeLot`, which adds to an existing lot's `quantity_pcs`. Change it so a manual increase creates a **new correction lot** instead. `quantity_pcs` must remain what was physically packed.

**Verify:** deleting a packed row that still holds stock must now fail with a clear message; existing lots' `quantity_pcs` must never change from a stocktake.

---

## Phase 5 — Undo reads the ledger

**File:** `js/packing.js`, `undoCommittedQty` (~line 2050)

It currently walks `dispatch_lot_items`, which only ever covered checkout — so the approval-fulfilled portion (F4) cannot be restored, and the function's own comments say so. Repoint it at `packed_stock_movements` filtered by `ref_table = 'request_order_items'` and `ref_id = itemId`, newest first, refunding via `refund_packed_lot`.

Keep `dispatch_lot_items` writes for now; retire only once the ledger has covered a full order cycle in production.

**Verify:** approve an order with auto-fulfil (no checkout at all), then Undo. Stock must return to its exact starting value — impossible before this phase.

---

## Phase 6 — Bulk roasted coffee (deferred)

Not started, and deliberately so: the audit found **no evidence of active corruption**. But `bulk_available` is a plain column mutated by read-modify-write across ~10 sites in `js/roasting.js` and `js/packing.js`, with no lot table, so it carries the same race exposure and cannot be reconciled per unit. Apply the same three steps in this order: atomic RPCs → derived/logged → context. Do not start before Phase 5 is verified in production.

---

## Phase 7 — Combined Stock by Lot + Edit modal

Design already approved by the user (mockups iterated and signed off). Build only after Phase 5.

- Merge `openPackedLotsModal` and `openEditPackedModal` into one modal.
- Two side-by-side columns split by bag size (1000g left, 250g right; further sizes become additional columns).
- One row per lot; machine shown as a small tag on the row itself, not as a separate grouping heading.
- Badges: `pick first` (FIFO), `blend` (post-blend), `repack` — reuse the existing `.badge-post-blend` / `.badge-repack` CSS classes.
- Read-only by default. An **Edit** button in the footer beside Close switches all figures to editable inputs and swaps the footer to Cancel / Save changes.
- Number inputs with spinner arrows suppressed — the whole field is for keyboard entry.
- A Delete button per lot, visible only in edit mode.
- Dates formatted `dd-mm-yyyy`.
- Lots with zero stock stay hidden (confirmed decision).
- Remove the Actions column from the Packed Coffee Stock table entirely.

All writes from this modal must go through Phase 1's RPCs with `mv_operation = 'manual_edit'`.

---

## Appendix — Verification queries

**The hard invariant. Must always return zero rows.**

```sql
SELECT l.id, l.lot_code, l.remaining_pcs, COALESCE(SUM(m.delta_pcs), 0) AS ledger_sum
FROM public.packed_coffee_lots l
LEFT JOIN public.packed_stock_movements m ON m.packed_coffee_lot_id = l.id
GROUP BY l.id, l.lot_code, l.remaining_pcs
HAVING l.remaining_pcs <> COALESCE(SUM(m.delta_pcs), 0);
```

**Derived-column check (pre-existing invariant, keep running it).**

```sql
SELECT pc.id, pc.quantity, COALESCE(SUM(l.remaining_pcs), 0) AS lot_sum
FROM public.packed_coffee pc
LEFT JOIN public.packed_coffee_lots l ON l.packed_coffee_id = pc.id
GROUP BY pc.id, pc.quantity
HAVING pc.quantity IS DISTINCT FROM COALESCE(SUM(l.remaining_pcs), 0);
```

**Attribution progress — drives Phase 3 to completion.**

```sql
SELECT operation, COUNT(*) AS movements, SUM(delta_pcs) AS net_pcs
FROM public.packed_stock_movements
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY operation
ORDER BY movements DESC;
```

**Sanity checks.**

```sql
SELECT COUNT(*) FROM public.packed_coffee_lots WHERE remaining_pcs < 0;
SELECT COUNT(*) FROM public.packed_coffee_lots WHERE remaining_pcs > quantity_pcs;
SELECT COUNT(*) FROM public.packed_coffee_lots l
  LEFT JOIN public.packed_coffee p ON p.id = l.packed_coffee_id
  WHERE l.packed_coffee_id IS NOT NULL AND p.id IS NULL;
```

---

## Appendix — Per-phase shipping checklist

From `CLAUDE.md`; every item has caused a real regression in this repo.

- [ ] `node test.js` passes (loads all split scripts exactly as the browser does)
- [ ] Bump `?v=` in `index.html` for **each** changed JS file — this is per-file, not global
- [ ] Any schema change mirrored into `database/supabase_schema.sql`, including the RLS array
- [ ] `NOTIFY pgrst, 'reload schema';` after DDL (sometimes twice)
- [ ] New mutations check `error` and surface it — never fail silently
- [ ] New user-facing strings added to **both** `en` and `ar` in `js/translations.js`
- [ ] Colors via CSS custom properties only — never hardcoded
- [ ] After push, wait for Vercel "Ready", hard-refresh, verify live
- [ ] Run the hard-invariant query after every phase touching stock

## Appendix — Traps specific to this codebase

- `saveData(table, record)` sends the **whole object**. Passing a full row re-sends every column, including stale context — the reason the trigger is `BEFORE` and clears `mv_*`.
- `packed_coffee.quantity` and `green_coffee.stock_kg` are **derived**. Writing them directly appears to work and is reverted later. This has now caused three separate bugs.
- `js/app_backup.js` is an untracked pre-split snapshot and is **not loaded**. Ignore it; greps will hit it.
- Scripts share one global scope in a fixed load order (`packing.js` before `sales.js` before `app.js`). Functions from earlier files are available to later ones — no imports needed, but the order matters.
- `dist/js/app.js` is a stale, unreferenced copy in the Android build folder. Do not edit it.
