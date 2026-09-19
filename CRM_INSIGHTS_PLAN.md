# CRM Insights Plan

## Context

Roastery Manager's Customers section has no signal for which customers are overdue to reorder, which are high-value, or their purchase history at a glance — sales agents work from a plain directory. An earlier pass in this same effort built the underlying computation (reorder prediction + RFM-style segmentation) and rendered it as inline badges on each Customer Directory row. That approach was **rejected after a live demo** (badges cluttered the directory row) in favor of a dedicated **"CRM Insights" sub-tab**, designed iteratively as an interactive mockup (see chat history) before writing any production code. This document is the locked-in spec for that sub-tab, to be implemented next.

No new database tables or columns are needed anywhere in this plan — everything is computed client-side from `request_orders`/`request_order_items`/`customers` already in Supabase, same constraint as the original CRM research (no reliable price data exists, so "value" is volume in kg + order frequency, never an estimated Rupiah figure).

## What already exists and must be reused, not rebuilt

Built and working from the earlier pass — do not re-derive:

- **`js/db.js`**: `computeOrderStatsByKey(orders, items, {groupByFn, startDate, endDate, statuses})` — shared aggregation returning `{orderCount, bags, kg, firstOrderDate, lastOrderDate, avgIntervalDays, orderDates}` per group key. `median(numbers)`, `daysBetween(dateStrA, dateStrB)`.
- **`js/sales.js`**: `REORDER_BADGE_META` (overdue/due_soon), `SEGMENT_BADGE_META` (new/vip/regular/at_risk/dormant/none), `renderCrmBadge(meta)`, `getReorderBadge(stat)`, `todayDateStr()`, `computePeerMedians(customers, statsByCustomerId, minPeers=3)`, `getCustomerSegment(customer, allTimeStat, trailing90Stat, peerMediansTrailing90, peerMediansAllTime)`, `getCustomerOrdersRaw(forceRefresh)` (module-level cache of permission-filtered `request_orders`+`request_order_items`, only force-refreshed on Customers section nav entry).
- **`js/app.js`**: `loadCustomerReport` already refactored to use `computeOrderStatsByKey`. `loadAgentLeaderboardReport` (Reports → Sales Agents tab) — unrelated to this plan, already shipped.
- **Customer Leaderboard card** (segmented by type, period selector) — already shipped under the Directory tab in `#sec-customers`. **Out of scope for this plan** — stays exactly where it is.
- **Permission mechanism** (`js/auth.js`): `allowedCustomerTypes()`, `filterCustomersByAccess(customers)`, `filterOrdersByCustomerCategory(orders)`, `filterOwnOrders(orders)` — reused verbatim, no new permission keys.

## Decisions locked in (from mockup iteration)

1. **Revert the inline badges.** `loadCustomersSection`'s Directory table row goes back to plain `<strong>${c.name}</strong>` — no `crmBadgesHtml`. The stats computation stays (still needed for CRM Insights and the leaderboard), only the row-injection is removed.
2. **New sub-tab inside `#sec-customers`**: "Customer Directory" | "CRM Insights", using the app's existing `.tab-btn` / `.tab-content` convention (same pattern as Reports/Greenbean/Roasting — see `js/app.js` `reportsTabBtns` wiring for the exact pattern to mirror), **not** a bespoke one-off toggle.
3. **Segment summary tiles** (All / VIP / Regular / At Risk / Dormant / New / No Order) double as the segment filter — clicking a tile filters the table below; no separate pill row. Only VIP (⭐), At Risk (⚠️), Dormant (💤) keep icons; every other label is plain text.
4. **Type summary tiles** (All / Wholesale / Retail / Supermarket) are a second row, same visual style, filtering by `customer.type`. Combined with the segment filter as **AND** logic (both must match).
5. **Both tile rows are permission-scoped** exactly like the existing `.customer-filter-btn` row in the Directory tab: a type tile for a category the current role can't access is not rendered at all (via `allowedCustomerTypes()`), and every count/row underneath is pre-filtered through `filterCustomersByAccess()`. No new permission key — this reuses the same `customer_cat_retail/wholesale/supermarket` keys already in Settings → Role Management.
6. **Hover tooltips** on the segment tiles only (not type tiles) explain what each segment means — short text, shown on `mouseenter`/hidden on `mouseleave`, positioned above the tile.
7. **Filtered table** columns: Customer, Type, Segment (badge), Reorder (badge or `-`), Last order, Kg (90d).
8. **Row click opens the app's existing generic modal** (`openModal(title, htmlContent)` — do **not** build a bespoke overlay div; the mockup's overlay was a visualize-widget constraint, not a pattern to carry into production) containing, top to bottom:
   - Customer name + type, **phone number and address** (so staff can contact them directly — added per explicit request), segment + reorder badges
   - Two stat blocks side by side: **Lifetime** (total kg, total orders, first-order date) and **Month-to-Date** (kg, orders, plus the cadence text e.g. "Rata-rata order tiap ~10 hari")
   - **Purchase history table**: date, coffee/blend name, bags, kg, status — most recent first; empty state "Belum ada riwayat pembelian" when the customer has never ordered.

## Implementation

### 1. `js/sales.js` — revert inline badges

In `loadCustomersSection`, remove the `crmBadgesHtml` construction and its injection into the Name `<td>`. Keep `allTimeStats`/`trailing90Stats`/`peerMediansTrailing90`/`peerMediansAllTime` computation as-is (still consumed by the code below).

### 2. `index.html` — restructure `#sec-customers`

- Wrap the existing Customer Directory card (filter buttons, search, table) in `<div id="tab-cust-directory" class="tab-content">` and the Customer Leaderboard card alongside it (both stay under Directory — leaderboard is unrelated to this plan).
- Add a tab bar above both: `<button class="tab-btn active" data-tab="tab-cust-directory">Customer Directory</button><button class="tab-btn" data-tab="tab-cust-crm">CRM Insights</button>`.
- Add `<div id="tab-cust-crm" class="tab-content hidden">` containing:
  - `<div id="cust-crm-seg-tiles">` (segment tiles, JS-rendered)
  - `<div id="cust-crm-type-tiles">` (type tiles, JS-rendered)
  - A table (`cust-crm-table` / `cust-crm-table-body`) with the 6 columns above
  - No modal markup needed here — reuse `openModal()`.

### 3. `js/app.js` — tab wiring + section routing

- Add `customersTabBtns`/`customersTabContents` click wiring at top level, mirroring `reportsTabBtns` (lines ~1176-1197): toggle `.active`/`.hidden`, `saveLastTab('sec-customers', targetTab)`, then call `loadCustomersSection()` for `tab-cust-directory` or `loadCrmInsightsTab()` for `tab-cust-crm`.
- Update `loadSectionData`'s `case 'sec-customers'` to check `#sec-customers .tab-btn.active` and route to whichever tab is active (mirror the `sec-greenbean`/`sec-roasting` pattern at lines ~1224-1238), instead of unconditionally calling `loadCustomersSection`.

### 4. `js/sales.js` — new CRM Insights logic

- `async function loadCrmInsightsTab()`:
  - `fetchData('customers')` → `filterCustomersByAccess(customers)` → `accessible`.
  - `getCustomerOrdersRaw()` (cache-backed, no force-refresh — Directory tab's nav-entry refresh already keeps it current).
  - Compute `allTimeStats`, `trailing90Stats` (existing helpers), plus **new**: `mtdStats = computeOrderStatsByKey(ordersRaw.orders, ordersRaw.items, {groupByFn: o => o.customer_id || null, startDate: <first-of-month>, endDate: todayDateStr()})`.
  - Compute `peerMediansTrailing90`/`peerMediansAllTime` (existing `computePeerMedians`).
  - For every accessible customer, compute its segment (existing `getCustomerSegment`) and reorder badge (existing `getReorderBadge`) once; build segment/type tile counts from these (respecting `allowedCustomerTypes()` for which type tiles even exist).
  - Render tiles (segment + type), wire click handlers that update module-level `_crmActiveSeg`/`_crmActiveType` and re-render the table.
  - Render the filtered table; each row's click handler calls `openCrmCustomerModal(customer, allTimeStats[c.id], mtdStats[c.id], segment, reorderBadge)`.
- `async function getCustomerPurchaseHistory(customerId)`: fetches (or reuses) `request_orders`/`request_order_items`/`green_coffee`/`blend_recipes`, filters orders to `customer_id === customerId` and `status` in `['Dispatched','Completed']`, resolves each item's coffee name using the exact same branch `loadCustomerReport`'s Coffee Preference section already uses (`item.coffee_type === 'Single'` → look up `green_coffee` by `single_coffee_id`, else `blend_recipes` by `blend_recipe_id`), returns rows `{date, coffeeName, bags, kg, status}` sorted newest-first.
- `function openCrmCustomerModal(customer, allTimeStat, mtdStat, segment, reorderBadge)`: builds the HTML string (badges via `renderCrmBadge`, phone/address from `customer.phone`/`customer.address`, lifetime/MTD blocks, a loading state for the history table swapped in once `getCustomerPurchaseHistory` resolves) and calls `openModal(customer.name, html)` — matches how every other modal in this app is opened (`openCustomerModal`, `viewCustomerHistory`, etc. — check `js/sales.js` for the exact existing call signature before wiring this one so it matches, e.g. whether history needs to be fetched before or after the modal is shown).

### 5. i18n — `js/translations.js`

Reuse existing `crm_segment_*`/`crm_badge_*` keys from the earlier pass. New keys needed (en + ar), e.g.: `tab_cust_directory`, `tab_cust_crm`, `crm_tile_all`, `crm_tip_all`, `crm_tip_vip`, `crm_tip_regular`, `crm_tip_at_risk`, `crm_tip_dormant`, `crm_tip_new`, `crm_tip_none`, `lbl_lifetime`, `lbl_month_to_date`, `lbl_purchase_history`, `msg_no_purchase_history`, `col_purchase_date` (or reuse an existing date column key if one fits), `col_coffee` (or reuse `col_top_coffee`).

### 6. Cache-busting

Bump `?v=` in `index.html` for `js/sales.js`, `js/app.js`, `js/translations.js` (whichever changed) — `js/db.js` is untouched by this plan (no new shared helpers needed beyond what already exists).

## Verification

- `node test.js` after each file edit.
- Manual browser check: Directory tab shows plain rows again (no badges) but the Leaderboard card still works; CRM Insights tab shows correct tile counts, tile clicks filter the table (segment and type combined), tooltips appear on hover for segment tiles, row click opens a modal with phone/address/lifetime/MTD/purchase history (including the empty-history case for a customer with zero orders).
- Test with a role restricted to one customer category (e.g. Retail-only Sales Agent) to confirm type tiles for other categories don't render and all counts/rows stay within the allowed category — this is the main regression risk since it's a new surface consuming the existing permission functions.
- Toggle `ar`/RTL to confirm no missing-translation-key console warnings.
