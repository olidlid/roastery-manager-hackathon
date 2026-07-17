# V2 Roadmap

Scope for this document was clarified with the user on 2026-07-11, after the V1 modularization (REFACTORING.md) closed out Task #9 of the original refactor checklist, which had only *named* these phases (FIFO, Work Order, B2B, AI) without scoping any of them.

**Current sandbox:** V2 development happens on the existing project (`roasterymanagerv2.vercel.app` + Supabase project `YOUR_PROJECT_REF`). The client handover (separate, deferred effort — see project memory) forks a copy of the codebase to the client's own infra; V2 work is not part of what ships in that fork.

---

## In scope for V2

### Phase 1 — FIFO Lot Tracking (costing + freshness)
Two goals, both driven by the same underlying lot data:
- **Costing:** track green coffee intake in arrival-order batches/lots, and when a lot is consumed by a roast, use the *oldest* lot's cost first — so cost-of-goods reflects actual purchase price per batch, not a blended average.
- **Freshness/rotation:** the same lot ordering also drives which stock should physically be used first, so older green coffee doesn't sit unused while newer stock is roasted.

**Foundation already in place (from the V1 refactor):** the shadow schema tables `green_coffee_lots` and `packed_coffee_lots` (INTEGER FKs — see REFACTORING.md for why not UUID) already exist in the database, created specifically for this phase.

**Progress update (2026-07-12):** a *third*, separate lot table — `production_lots` — was built as part of the "Ready to Pack" tab + "Tracking" page feature (see [[project_ready_to_pack_tracking_feature]]). It generates a lot code per (bulk_roasted_coffee row, day), prints it on packaging/carton labels, and looks it up later for traceability (coffee/process/supplier/dates). This is **adjacent groundwork, not the FIFO costing/rotation engine itself** — don't mistake it for Phase 1 being done. It proves out the "lot code" pattern end-to-end (generate → print → look up) but doesn't touch cost calculation or stock rotation.

**Workflow clarified with the user 2026-07-12 (not yet built — full detail below):**

#### 1·CHAIN. Traceability data model (resolved 2026-07-12) — build this first
Underpins 1A–1G and the Tracking page; design it holistically before the per-feature work.

**Full chain:** `green lot → roast batch → (day's production lot) → packed lot → dispatch → customer`

**Linkage tables / columns:**
- `green_coffee_lots` — **add `purchase_price_per_kg`** (per-lot price, needed for 1C lot-weighted costing; the shadow table doesn't have it today).
- **Green stock model (resolved 2026-07-12): `green_coffee.stock_kg` becomes DERIVED** = `SUM(green_coffee_lots.remaining_kg)` — single source of truth, parallels the `packed_coffee` restructure in 1G. **Migration:** seed each coffee's existing `stock_kg` as one "opening balance" lot so pre-lot stock isn't lost.
- **NEW `roast_batch_green_lots`** (`roast_batch_id`, `green_coffee_lot_id`, `kg_consumed`) — one batch → many green lots. Green consumption is **always recorded precisely per-lot in kg** at batch-save time (e.g. 3 kg from lot A + 2 kg from lot B), regardless of how much precision the Tracking UI surfaces — it's cheap and future-proofs everything.
- **production lot → roast batch = DAY-LEVEL** (chosen precision): when a `production_lot` is created (barcode printed), **snapshot the ids of all `roast_batches` of the same coffee+machine roasted on that same `production_date`** into a **NEW join table `production_lot_batches`**. This replaces the current single `latest_roast_batch_id` approximation. **Carryover is explicitly ignored** — a production lot ties only to *that day's* batches; accepted as a small, deliberate inaccuracy (the honest "full mixed-pool" alternative was rejected as too heavy). Edge to handle: a production lot whose `production_date` has no matching batches (packed purely from carryover) — decide a fallback (e.g. most recent prior batches) when building.
- `packed_coffee_lots` — **add `production_lot_id`**, populate on packing (currently the table exists but nothing writes to it).
- **NEW `dispatch_lot_items`** (`request_order_item_id`, `packed_coffee_lot_id`, `qty`, `customer_id`) — from 1G.

**Tracking page display (chosen): show ALL values as lists.** When a scanned packed lot resolves to multiple green lots / batches (blend, or spanning lots), the result page lists every value — Supplier: A, B; Arrival: 2 Jun & 10 Jun; Roast degree: 55, 58; moisture/water-activity/density per lot; roast date(s). No representative-single collapsing.

**Reverse direction (lot → customer):** walk `production_lot → packed_coffee_lots → dispatch_lot_items → customer`, surfaced in the new **Customer Order History** UI (1G) with lot search/filter.

#### 1A. Green Bean arrival & lot generation (resolved 2026-07-12)
- One intake = one green lot (a lot may span several sacks sharing the same lot code). **This green-bean lot code is separate from the packed-side `production_lots` code** (already built for Ready to Pack / Tracking) — two different codes at two different stages of the chain.
- [ ] **Green lot code = `{coffee code}-GL-{YYMMDD}-{NN}`** (e.g. `YAM-GL-260712-01`). `GL` marks it a green lot (distinct from the packed-side production-lot code). `{NN}` is a **GLOBAL daily running sequence across ALL green intakes that day** (not per-coffee) — this is what guarantees uniqueness even when two different coffees share the same non-unique `green_coffee.code` (they'd get `-01` and `-02`). The **barcode payload encodes `green_coffee_lots.id` + machine id** (numeric PK, always resolves to exactly one lot) so scanning is robust regardless of the human text code. Edges: if a coffee's `code` is blank, fall back to its internal id (e.g. `C12`) for that segment; `green_coffee_lots.lot_code` still carries a UNIQUE constraint as a safety net.
- [ ] Populate `green_coffee_lots` on every `green_coffee_intake`: `lot_code`, `quantity_kg`, `remaining_kg`, `arrival_date`, `supplier`, and `purchase_price_per_kg` (new col — see 1·CHAIN).
- [ ] **Sticker count = a free number the user types** at intake (NOT derived from sack count / standard sack weight).
- [ ] **Sticker content:** coffee **code** (not the lot-code string) + entry/arrival date + coffee name (human-readable), plus **one barcode per machine** (each encodes coffee+lot+machine, per 1B).

#### 1B. Barcode scan → FIFO age check → Quick Roast Log (resolved 2026-07-12)
Extends the existing `RMP:...` scanner flow (`showBarcodeLabels()` in `js/app.js`, `handleBarcodeScan()`/`openQuickRoastModal()` in `js/roasting.js`).

**Barcode formats:**
- [ ] **Single** (on the sack) → encodes `green_coffee_lots.id` + machine id (numeric, per 1A) — resolves to an exact lot + machine.
- [ ] **Blend** → printed from the **Blend Recipe page** (not a sack), per machine, encodes `blend_recipe_id` + machine id. On scan the system auto-resolves each ingredient's oldest lot (see 1D).

**On scan (single only):** check whether an **older** lot (earlier `arrival_date`, `remaining_kg` > 0) of the same green coffee exists.
- [ ] Yes → warn with that older lot's code, offer **Proceed / Cancel**. **Cancel aborts entirely — the Quick Roast Log modal does not open.**
- [ ] No / Proceed → open the Quick Roast Log modal **unchanged** (no new visible lot fields; the check is purely background).
- [ ] **Blends get no older-lot warning** — they always auto-consume oldest per ingredient, so there's no "wrong lot" case.

**On batch save — green consumption (recorded silently in `roast_batch_green_lots`):**
- [ ] **Single (chosen): scanned lot first, then oldest-first for any shortfall.** Deduct fully from the scanned lot; if the batch green weight exceeds it, the remainder is pulled **FIFO oldest-first** from the coffee's other lots (this *will* draw from an older lot the operator skipped, by design).
- [ ] **Blend:** each ingredient consumes **oldest-first**, amount = ingredient `percentage` × batch green weight (percentage basis chosen; revisit if a different basis is wanted).
- [ ] **Insufficient total stock (chosen): warn, but clamp consumption at what's available — never go negative.** The shortfall is simply not deducted (min(needed, available)); the batch still saves. Flag it so stock can be corrected.
- [ ] Recording which lot(s) were drawn (with kg each) is what enables cost roll-up (1C) and precise per-lot traceability.

#### 1C. Cost roll-up (deferred 2026-07-12 — capture data only, don't build COGS yet)
- **COGS is not needed right now.** Do **not** build cost calculation or display in this phase.
- [ ] Only ensure the underlying data is captured so costing can be computed later with zero rework: `green_coffee_lots.purchase_price_per_kg` (per-lot price, see 1·CHAIN) + the per-lot kg draws in `roast_batch_green_lots` (see 1B). With those two, lot-weighted COGS becomes a pure read-side calculation whenever it's wanted.
- [ ] The actual roll-up (lot-weighted batch/bulk/packed COGS + wherever it'd surface) is a **later, separate task** — revisit only when the business actually needs cost reporting.

#### 1D. Blend Recipe — FIFO recommendation column
- [ ] Add a column next to Ingredient/Percentage in the Blend Recipe form showing the **currently FIFO-recommended lot code** per ingredient — live/informational only, not itself a control.
- [ ] Blend barcode stays exactly as it is today (no format change) — scanning it silently resolves and consumes each ingredient's current oldest lot automatically, same mechanism as 1B.

#### 1E. New Green Coffee fields (nullable — can be left blank)
- [ ] `moisture_content`
- [ ] `water_activity`
- [ ] `density`
- [ ] Show all three on the Tracking result page.

#### 1F. New Roasting Batch field — Roast Degree (Agtron)
- [ ] Add `roast_degree` to `roast_batches`.
- [ ] Add the field to the Batch Log modal, both the scan-triggered Quick Roast Log and the manual entry form.
- [ ] Auto pre-fill from the most recently entered `roast_degree` for the same coffee name + same machine; leave blank if no prior value exists. Field stays editable (user can override).
- [ ] Show `roast_degree` on the Tracking result page.

#### 1G. Packed Coffee dispatch FIFO (Packing → Order Requests tab)
Full workflow clarified with the user 2026-07-12 — **POS-style barcode-scan fulfillment, not yet built.** Decisions below are confirmed unless marked "⚠️ still to dissect".

**Order lifecycle (confirmed):** sales creates order → **approval** (leader approves the incoming *sales* request — this is the only approval step, upstream of packing) → order appears as an **order request** in the Packing menu → POS **Checkout = Ready (for handover)** → **Dispatch = goods physically picked up by sales** (final). Map this onto the existing `request_orders` status machine when building (`Pending Approval → Preparing → Ready for Handover → Dispatched`).

**Card list + detail modal:**
- [ ] Redesign the sales-order-request list in the Packing menu as **cards** (currently a table — see `loadPackingRequestsSection()` in `js/packing.js`). Each card shows: order number, customer, sales agent, the list of ordered coffees, and a **Print** button (reuse the existing print button/behavior).
- [ ] Clicking a card opens a **detail modal** showing the full order plus the **FIFO-recommended lot code** to pick per coffee (oldest `packed_date` lot of that coffee+size with remaining stock).

**Barcode scanned = the packaging lot barcode from Ready to Pack** (`production_lots.lot_code`, printed & stuck on packaging in the already-built Ready-to-Pack flow — this links 1G to the Tracking feature):
- [ ] **Package barcode** scan = +1 pc of that coffee+lot+size.
- [ ] **Carton barcode** — resolved 2026-07-12: the carton gets its **own label option in the Ready to Pack "Print Barcode" step** (alongside the package sizes), encoding a **carton multiplier** so the carton barcode is NOT byte-identical to a package barcode and the scanner can tell them apart. Scanning a carton registers its full count at once (e.g. 10 pcs of 1 kg). Carton pack-count per size must be configurable. → this means the already-built Ready-to-Pack print-label UI gains a carton size/multiplier option (extends the existing `openPrintBarcodeModal` / `production_lots` flow).

**POS-style fulfillment inside the modal** (cashier/POS pattern):
- [ ] **Row identity = coffee + production lot + size.** Scanning the same coffee+lot+size again adds to / edits that row; any different combination creates a **new row** with its own quantity input.
- [ ] **Auto-match** each scanned row against the order's lines by coffee+size+lot. **Scanning a coffee that isn't on the order → rejected.**
- [ ] Scanned lot **doesn't match** the FIFO recommendation → warn, offer **Proceed / Cancel** (same pattern as the green-bean older-lot warning in 1B).
- [ ] **Two distinct "over" cases, don't conflate them:**
  - **Lot runs short** (entered qty > that lot's physical remaining): allowed — the excess **automatically spills to the next-oldest lot** (same oldest-first spill logic as the green-bean side in 1B). This is about *which lot* fills the qty.
  - **Over-ordering** (total scanned for a line > the qty the customer ordered): **capped at the ordered qty** — extra scans beyond the order line are rejected.
- [ ] Rows are **editable** (change qty / remove a row) before checkout.
- [ ] **Partial fulfillment (resolved 2026-07-12):** Checkout is allowed even when some lines aren't fully met. The order **stays open** — the packed portion is dispatched, the shortfall stays pending. The order **remains an active card** in the request list (showing remaining qty) so the team can reopen it later and continue scanning the rest until complete. (`quantity_prepared` per item already exists in `request_order_items` to support this.)
- [ ] **Checkout** → sets the order (or its fulfilled portion) to **Ready (for handover)**; a partially-filled order stays open for the remainder.
- [ ] After checkout → offer **Print / skip**, using the **existing waybill print** (same as today). Output shows **coffee name only — NOT the lot code**. On a partial checkout, the waybill shows the **originally ordered qty with a shortfall marker** (e.g. "60/100, kurang 40"), not just the packed qty.

**Persistence / traceability:**
- [ ] Persist the full POS fulfillment data in a **new linkage table** (e.g. `dispatch_lot_items`: `request_order_item` ↔ `packed_coffee_lot` ↔ qty ↔ order/customer) — there is no such linkage today.
- [ ] Surface it as a **new "Customer Order History" UI in the Customer menu** — per-customer view of orders including which production lots they received. **Add search + filter (confirmed)** so you can also query by lot code to answer "which customers received lot X" (the reverse direction).
- [ ] Permission (confirmed): view via existing `packing_order_view`, checkout via a **new `packing_dispatch_checkout`** key.

**Known architectural gap (found 2026-07-12):** `packed_coffee.quantity` is a flattened running total per coffee+size(+machine) — packing merges into one row rather than keeping distinct dated lots, so today there's no way to tell "older" packed stock from "newer" at the data level. FIFO dispatch requires `packed_coffee_lots` to become the actual source of truth for available quantity per size, with `packed_coffee.quantity` turned into a derived/cached total. **The POS flow both depends on and drives this restructure** — it needs distinct scannable per-lot packed stock to exist in the first place. This is the single biggest structural change in Phase 1; the green-bean side (1A–1F) does not need it.

#### 1I. Post-Blend Coffee (new feature — being scoped 2026-07-12)
Blending **after** roasting (mix already-roasted coffee), vs. the existing **pre-blend** (blend greens, roast together). Two kinds:

**(a) Custom post-blend** — ad-hoc mix of existing roasted stock into a new product (resolved 2026-07-12):
- **Sources: bulk roasted AND packed, mixable in one blend** (e.g. 3 kg from bulk YAMAN + 5×1 kg bags SAKURA). Consuming reduces each source's stock (`bulk_available`; and `packed_coffee`/`packed_coffee_lots` bag count for packed sources — i.e. packed bags get "un-packed" back into the blend).
- **Source picking = FIFO-recommended but free (resolved 2026-07-12):** the picker flags/recommends the **oldest** source lot; the user may pick any lot, with a **warning if it's not the oldest** (same pattern as roasting 1B and dispatch 1G).
- **Naming:** custom blend **name is user-typed**; its identity **code is date-based** (per the day it's made).
- **Amount input in each source's native unit:** bulk components in **kg**, packed components in **number of bags** (auto-converted to kg via bag size).
- **Output = a NEW bulk** — a "custom blend" `bulk_roasted_coffee` entry whose identity is a **date-based blend code**. It then flows through the normal **Ready to Pack → production_lot → packing** step, where the **new packing date + final label** are assigned (consistent with the existing flow). So: the date-based code = the blended-bulk identity at creation; packing date/label land later at Ready-to-Pack, NOT at blend creation.
- **Record components** in a **NEW linkage table** (e.g. `post_blend_components`: `blend_bulk_id` ↔ source ref (bulk id or packed lot id) ↔ kg).
- **Tracking = full nested chain (chosen):** scanning the final label resolves `production_lot → blended bulk → each component → each component's OWN full chain` back to origin (green lot / supplier / arrival / roast date for bulk-sourced components; the packed lot's own chain for packed-sourced ones). This is a **recursive resolve** — a real extension to the Tracking resolver, shown as a nested/indented list.
- **Data-model note:** `bulk_roasted_coffee` has no slot today for a machine-less, recipe-less custom blend — needs a new `coffee_type` (e.g. `PostBlendCustom`) + custom name + date code.
- **Composition on the card:** like the recipe-based post-blend (1b), the custom post-blend's Ready-to-Pack card **shows its component composition** (coffee name, amount, derived %) as a mixing/reference guide.

**(b) Recipe-based post-blend** — the Recipe tab gains **two sub-tabs**:
- **Pre-blend:** the existing blend recipe table (unchanged).
- **Post-blend:** identical recipe content to pre-blend; recipes just need a **pre/post flag** so the plan flow knows which behavior to apply.

**Roasting-plan behavior for a post-blend recipe (described 2026-07-12):**
- Creating a roasting plan for a post-blend recipe with a **target weight** makes the system **explode it into one single-origin sub-plan per component**, sized `percentage × target`. Example: recipe 50% Brazil / 30% Guji / 20% Sumatra, target 100 kg → three sub-plans: **50 kg Brazil, 30 kg Guji, 20 kg Sumatra**.
- Each sub-plan shows a **blend-name badge + a "post-blend" badge**, and is **linked back to the parent post-blend plan**.
- **Auto-assembly:** once all component targets are met by batch logs, the system **automatically creates a new Ready-to-Pack card** for the blend (the full 100 kg) with the blend name + post-blend badge — no manual step.
- **Over-yield:** any component roasted **beyond** its blend reservation spills into a **new single-origin card** (e.g. Brazil yields 55 kg → 50 kg to the blend, 5 kg becomes a Brazil single card).
- The blend takes exactly the recipe proportion; the assembled blend bulk records its component roast batches → green lots (feeds the nested traceability chain, same idea as 1a).
- **Under-yield (resolved 2026-07-12): scale down, keep the ratio.** If a component falls short, assemble at the limiting scale factor `s = min(Yᵢ / Tᵢ)` across components (Y = actual yield, T = target): blend total = `s × target`, each component contributes `s × Tᵢ`, and each component's remainder (`Yᵢ − s×Tᵢ`) → its own single card. Example: Brazil 45/50, Guji 30/30, Sumatra 20/20 → s = 0.9 → blend **90 kg** (45/27/18), leftovers Guji 3 kg & Sumatra 2 kg → single cards. Ratio preserved, total shrinks.
- **Assembly trigger:** all targets met → **auto-assemble** at full ratio (happy path). Under-yield can't auto-complete (a component never hits target), so a **manual "Finalize" action** on the post-blend plan triggers the scaled-down assembly with whatever's roasted so far. (Derived from the scale-down choice — confirm.)
- **Machine (resolved 2026-07-12): user assigns a machine per component** at plan-creation time (Brazil→M1, Guji→M2, …); each exploded sub-plan carries its own `machine_id`.
- **Composition shown on the Ready-to-Pack card (2026-07-12):** the post-blend bulk card **displays its composition** — each component's **coffee name, percentage, and amount (kg)**. This is the **mixing reference** for the crew physically combining the roasted singles (the system auto-creates the card/stock record, but the actual blending on the floor is manual). Under scale-down the amounts shown reflect the **scaled** composition (e.g. 45 / 27 / 18 kg for a 90 kg blend), so the team mixes to the correct proportions even when a component fell short.
- **Batch attribution (resolved 2026-07-12): automatic by coffee + assigned machine + open sub-plan.** While a component sub-plan is open, batches of that coffee on its assigned machine count toward the blend target first; once the target is met, further batches of that coffee overflow to single stock. ⚠️ **Accepted limitation:** if the same coffee is roasted on the same machine for a *normal single* order while the sub-plan is still open, those batches get mis-counted toward the blend — the workflow assumes that coffee+machine is dedicated to the sub-plan until its target is met.
- **Stock mechanics:** component roast output flows **straight into the blend's reservation** — component singles do NOT first appear as separate single stock; only over-yield beyond the reservation becomes a single card. (1b = fresh roasting to meet the plan; drawing from existing stock is what 1a is for.)
- **Blend identity:** the assembled bulk carries the recipe's `blend_recipe_id` + a post-blend flag + a date code; name from the recipe.

#### 1J. Granular role — "own sales orders only" (resolved 2026-07-12)
A new role capability: a user sees only their **own** sales orders, not other users'. **This is the first permission that filters DATA (row-level), not just UI** — a new precedent for this codebase (until now permissions only gated UI visibility).
- [ ] New permission key **`sales_request_view_own`**: a role with `sales_request_view` sees all orders; a role with only `sales_request_view_own` sees just its own; neither → no access.
- [ ] **"Own" = name match: `order.sales_name === currentUser.name`** (chosen). Uses the existing `sales_name` text field — no schema change (orders already store the creator's name, filled from `currentUser.name` at creation — see `js/sales.js`). ⚠️ Accepted fragility: two users with the same name would see each other's orders, and renaming a user detaches their old orders.
- [ ] **Scope = ALL order views** (chosen): applies everywhere orders appear — Sales Dispatch Request list, sales reports, and the new Customer Order History (1G). Since others' orders are invisible everywhere, edit/delete of others' is naturally prevented too.
- [ ] **Update the `sec-handover` section gate** (currently `['sales_request_view','dispatch_approval_view']` in `js/auth.js`) to also admit `sales_request_view_own`.
- [ ] Add the key to `PERMISSION_GROUPS` (Sales group, `js/settings.js`) and to the `MOCK_DB` role defaults in `js/app.js` (default off for existing roles).

#### Build notes & minor deferrals (2026-07-12)
Implementation decisions (no further input needed) + small items to settle at build time:
- **Tracking resolver branches:** a normal single/pre-blend bulk traces via `production_lot_batches`; a post-blend bulk traces via `post_blend_components` (recursive). Two bulk kinds → two resolve paths.
- **Scanner routing:** the same physical scanner is used in different contexts (roast log, POS dispatch, Tracking search) — the global listener must respect the active context so a scan lands in the right place.
- **Post-blend explode rounding:** `percentage × target` is rounded; any rounding remainder folds into the last component.
- **Minor / at build:** carton pack-count config location (Settings → packaging sizes); editing/deleting a green intake whose lot is already partly consumed; permission for creating custom/recipe post-blends (reuse existing blend permissions).

#### 1H. `production_lots` vs `packed_coffee_lots` (resolved 2026-07-17) — stay separate
- [x] **Decision: stay separate, not merged.** The relationship is genuinely one-to-many, not one-to-one: one `production_lots` row (a day's bulk roasted output) can be packed across several `packed_coffee_lots` rows (different sizes, different packing sessions, different days) — linked via the existing nullable `packed_coffee_lots.production_lot_id` FK. Merging would either duplicate the production-lot data across every packed row or force both concepts to one granularity, hurting whichever side lost precision.
- [x] Confirmed in practice via 1I (Post-Blend): custom post-blend (1I-a) reads straight from `packed_coffee_lots` with zero need to touch `production_lots` (its sources are existing packed/bulk stock, not a fresh roast); keeping them separate kept that branch simple.
- [x] The "easy full-chain traceability" motivation for merging is already achieved without merging — the Tracking resolver recursively walks `packed_coffee_lots.production_lot_id → production_lots → roast batches/green lots` (and the 1I nested post-blend chain) without needing one unified table.

**Done so far:** ✅ barcode/lot-code generation + print + traceability lookup (`production_lots`, Ready to Pack tab, Tracking page) — 2026-07-12. ✅ Decision resolved 2026-07-17 — no schema change needed.
**Dependency:** none blocking — can start independently of Phase 2.

### Phase 2 — AI: Forecasting + Reports Insights
Two features, both sitting on top of the Reports module:
- **Demand/stock forecasting:** predict green coffee needs or sales demand from historical data (which tables/date ranges to train on needs scoping once this phase starts).
- **Automatic insights in Reports:** surface a plain-language summary/analysis alongside the existing charts, instead of leaving all interpretation to the raw chart data.

**Dependency:** the Reports module itself is flagged in CLAUDE.md's "Needs more testing/completion" list (chart data binding, date filtering) — that needs to be solid *before* building forecasting/insights on top of it, otherwise Phase 2 inherits Reports' existing bugs. There's also a separate pending-changes item on Reports (user has changes in mind, deferred "nanti saja") that should be resolved or at least reviewed before starting Phase 2, since those changes could affect what data forecasting/insights are built against.

**Suggested order:** Phase 1 (FIFO) can start now since its foundation already exists and has no dependency on Reports. Phase 2 (AI) should wait until (a) Reports pending changes are addressed and (b) Reports module testing gaps are closed.

---

## Explicitly out of scope for V2

- **Work Order** — the phase name from the original refactor checklist. Confirmed 2026-07-11: this is **already covered by the existing V1 Roasting Plans/Batches workflow** (plan creation → batch execution, with role-gated approval). No new "Work Order" entity is being built. If a concrete gap in the current Roasting Plans flow surfaces later (e.g. a customer-driven production request that needs approval *before* becoming a Roasting Plan), scope that as its own item then — don't resurrect this as a blanket phase.
- **B2B** — deferred to **V3**. Confirmed 2026-07-11: not needed for V2. (Likely direction per earlier discussion: either a self-serve customer portal or per-customer pricing/contracts — neither has been scoped, since it's not this phase's concern.)

---

## Not yet scoped / revisit later

- Packed Coffee dispatch FIFO workflow — see 1G above, conversation was mid-explanation when this document was last updated.
- Forecasting model approach and specific data sources for Phase 2 — deliberately left open until Phase 1 is done and Reports is stable.
