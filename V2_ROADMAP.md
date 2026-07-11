# V2 Roadmap

Scope for this document was clarified with the user on 2026-07-11, after the V1 modularization (REFACTORING.md) closed out Task #9 of the original refactor checklist, which had only *named* these phases (FIFO, Work Order, B2B, AI) without scoping any of them.

**Current sandbox:** V2 development happens on the existing project (`roasterymanagerv2.vercel.app` + Supabase project `YOUR_PROJECT_REF`). The client handover (separate, deferred effort — see project memory) forks a copy of the codebase to the client's own infra; V2 work is not part of what ships in that fork.

---

## In scope for V2

### Phase 1 — FIFO Lot Tracking (costing + freshness)
Two goals, both driven by the same underlying lot data:
- **Costing:** track green coffee intake in arrival-order batches/lots, and when a lot is consumed by a roast, use the *oldest* lot's cost first — so cost-of-goods reflects actual purchase price per batch, not a blended average.
- **Freshness/rotation:** the same lot ordering also drives which stock should physically be used first, so older green coffee doesn't sit unused while newer stock is roasted.

**Foundation already in place (from the V1 refactor):** the shadow schema tables `green_coffee_lots` and `packed_coffee_lots` (INTEGER FKs — see REFACTORING.md for why not UUID) already exist in the database, created specifically for this phase. They currently have **no auto-populate triggers and nothing in the app reads/writes them yet** — that wiring is the actual Phase 1 work:
- [ ] Populate `green_coffee_lots` on every `green_coffee_intake` (arrival) — one row per intake batch, ordered by arrival date.
- [ ] Roasting batch logic consumes lots oldest-first, decrementing remaining lot quantity, and captures which lot(s) a batch drew from (for cost roll-up).
- [ ] Extend cost calculations (wherever COGS/batch cost is currently computed) to use lot-weighted cost instead of a flat green coffee cost field.
- [ ] Surface remaining lot age/quantity somewhere in the Green Bean inventory UI so rotation can actually be acted on by staff, not just computed in the background.
- [ ] Decide & implement the same lot mechanics for `packed_coffee_lots` on the packing side, if packed-goods rotation/costing matters as much as green coffee (confirm with user before building — not yet discussed).

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

- Whether `packed_coffee_lots` rotation/costing matters as much as `green_coffee_lots` (see Phase 1 checklist above).
- Forecasting model approach and specific data sources for Phase 2 — deliberately left open until Phase 1 is done and Reports is stable.
