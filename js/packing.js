// PACKING MODULE - ROASTERY MANAGER V2
// Plain script (shared global scope — NOT an ES module). Split out of app.js
// during the V1 refactor. Covers Packing (daily sheet, order requests,
// records, history), Bulk Roasted Coffee, and Packed Coffee Stock. Load
// order: after db.js/auth.js/greenbean.js/roasting.js, before app.js.

// ==========================================================================
// SECTION 4: PACKING & RETAIL INVENTORY
// ==========================================================================
async function loadPackingSection() {
    // 1. Initialize Tabs (run once)
    const nav = document.getElementById('packing-tabs-nav');
    if (nav && !nav.hasAttribute('data-init')) {
        nav.setAttribute('data-init', 'true');
        const tabBtns = nav.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                // Remove active from all
                tabBtns.forEach(b => {
                    b.classList.remove('active');
                    b.style.color = 'var(--text-secondary)';
                    b.style.borderBottomColor = 'transparent';
                });
                // Add active to clicked
                btn.classList.add('active');
                btn.style.color = 'var(--primary)';
                btn.style.borderBottomColor = 'var(--primary)';
                
                // Hide all contents
                document.querySelectorAll('.packing-tab-content').forEach(c => c.classList.add('hidden'));
                
                // Show target
                const target = document.getElementById(btn.getAttribute('data-target'));
                if (target) target.classList.remove('hidden');

                saveLastTab('sec-packing', btn.getAttribute('data-target'));

                // If it's the requests tab, load data
                if (btn.getAttribute('data-target') === 'tab-order-request') {
                    loadPackingRequestsSection();
                } else if (btn.getAttribute('data-target') === 'tab-packing-history') {
                    loadPackingHistorySection();
                } else if (btn.getAttribute('data-target') === 'tab-packing-records') {
                    loadPackingRecordsTable();
                } else if (btn.getAttribute('data-target') === 'tab-waste-inventory') {
                    loadWasteInventorySection();
                } else if (btn.getAttribute('data-target') === 'tab-repack') {
                    loadRepackHistorySection();
                } else if (btn.getAttribute('data-target') === 'tab-stock-release') {
                    loadStockReleaseSection();
                }
            });
        });
    }

    const btnNewRepack = document.getElementById('btn-new-repack');
    if (btnNewRepack && !btnNewRepack.hasAttribute('data-init')) {
        btnNewRepack.setAttribute('data-init', 'true');
        btnNewRepack.addEventListener('click', () => openNewRepackModal());
        btnNewRepack.style.display = hasPermission('packing_repack') ? '' : 'none';
    }

    const btnNewStockRelease = document.getElementById('btn-new-stock-release');
    if (btnNewStockRelease && !btnNewStockRelease.hasAttribute('data-init')) {
        btnNewStockRelease.setAttribute('data-init', 'true');
        btnNewStockRelease.addEventListener('click', () => openNewStockReleaseModal());
        btnNewStockRelease.style.display = hasPermission('packing_stock_release') ? '' : 'none';
    }

    const [
        { data: bulkList },
        { data: machines },
        { data: greenbeans },
        { data: recipes },
        { data: postBlendComponents },
        { data: packedLots },
        { data: packedList },
        { data: roastingPlans },
        { data: repackSources },
        { data: roastBatches },
        { data: bulkReservations },
        { data: requestOrderItems },
        { data: requestOrders }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('post_blend_components'),
        fetchData('packed_coffee_lots'),
        fetchData('packed_coffee'),
        fetchData('roasting_plans'),
        fetchData('repack_sources'),
        fetchData('roast_batches'),
        fetchData('bulk_reservations'),
        fetchData('request_order_items'),
        fetchData('request_orders')
    ]);

    renderReadyToPackCards(bulkList, machines, greenbeans, recipes, postBlendComponents, packedLots, packedList, roastingPlans, repackSources, roastBatches, bulkReservations, requestOrderItems, requestOrders);
    // btn-custom-packing's click handler (openCustomPackingModal) is already
    // wired once at parse time in roasting.js — not re-wired here to avoid
    // attaching a second listener that would fire the modal twice per click.
}

// Renders the "Ready to Pack" cards. Bulk is date-scoped (one row per
// coffee+machine+roast day — see database/bulk_production_date_migration.sql),
// which made a frequently-roasted coffee spread across several near-identical
// cards. Cards are therefore GROUPED by coffee+machine: a group with one roast
// date renders exactly as before, a group with several renders one card
// showing the combined kg plus an expandable list of its dates, oldest first
// (FIFO order). Print Barcode / Pack stay per roast date either way — each
// date is its own lot and must never be conflated.
function renderReadyToPackCards(bulkList, machines, greenbeans, recipes, postBlendComponents, packedLots, packedList, roastingPlans, repackSources, roastBatches, bulkReservations, requestOrderItems, requestOrders) {
    const container = document.getElementById('ready-to-pack-cards');
    const emptyEl = document.getElementById('ready-to-pack-empty');
    const filterBar = document.getElementById('rtp-filter-bar');
    const noMatchEl = document.getElementById('ready-to-pack-no-match');
    if (!container) return;
    container.innerHTML = '';

    const groupKey = (b) => `${b.coffee_type}|${b.single_coffee_id || ''}|${b.blend_recipe_id || ''}|${b.machine_id || ''}|${b.coffee_name}`;

    const activeBulk = (bulkList || [])
        .filter(b => parseFloat(b.bulk_available) > 0.005)
        .sort((a, b) => a.coffee_name.localeCompare(b.coffee_name) || (a.machine_id || 0) - (b.machine_id || 0) || (a.production_date || '').localeCompare(b.production_date || ''));

    // TEST_BATCH_CARD_PLAN.md: a Test batch never touches bulk_roasted_coffee
    // until it's approved (addWeightToBulkRoastedCoffee's callers are all
    // gated on qc_status === 'Success' — see js/roasting.js), so a pending
    // one has no row in bulkList at all. Sourced straight from roast_batches
    // instead, oldest roast_date first (longest-waiting approval on top).
    const pendingTestBatches = (roastBatches || [])
        .filter(b => b.roast_type === 'Test' && b.qc_status === 'Pending')
        .sort((a, b) => (a.roast_date || '').localeCompare(b.roast_date || ''));

    // A coffee that ONLY has a pending Test batch (no bulk yet at all) must
    // still render its Test card — the empty-state return below used to fire
    // before pendingTestBatches existed and would have hidden it.
    if (activeBulk.length === 0 && pendingTestBatches.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (filterBar) filterBar.classList.add('hidden');
        if (noMatchEl) noMatchEl.classList.add('hidden');
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    // The filter bar only ever filters bulk cards (RTP_FILTER_DATA below) —
    // no point showing it when there's nothing to filter yet, even if Test
    // cards are on screen.
    if (filterBar) filterBar.classList.toggle('hidden', activeBulk.length === 0);

    // Post-blends and repacks are deliberately never grouped: a post-blend
    // carries its own custom_blend_code (CB-/PB-) and a repack's identity is
    // "this specific opening event" (see repack_sources), so merging two of
    // either into one pool would misrepresent separate events as one lot —
    // same reasoning, same `type:${id}` key shape for both.
    const groups = [];
    const groupPos = new Map();
    activeBulk.forEach(b => {
        const k = b.is_post_blend ? `postblend:${b.id}` : (b.is_repack ? `repack:${b.id}` : groupKey(b));
        if (!groupPos.has(k)) { groupPos.set(k, groups.length); groups.push([]); }
        groups[groupPos.get(k)].push(b);
    });

    // Newest-first at the card-grid level (explicit user request) — each
    // group's own rows stay oldest-first internally (the FIFO "pick first"
    // logic in buildGroupedCard depends on that ordering), this only
    // reorders which group's card appears first in the grid. "Newest" =
    // the group's most recent production/roast date (its last row, since
    // rows arrive oldest-first from the sort above), tied by the highest
    // bulk_roasted_coffee id (the most recently inserted row wins).
    groups.sort((rowsA, rowsB) => {
        const dateA = rowsA[rowsA.length - 1].production_date || '';
        const dateB = rowsB[rowsB.length - 1].production_date || '';
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        const idA = Math.max(...rowsA.map(r => r.id));
        const idB = Math.max(...rowsB.map(r => r.id));
        return idB - idA;
    });

    // ---- per-bulk fragments shared by both card shapes ----

    // Composition breakdown shown on post-blend cards as a mixing reference —
    // sourced from post_blend_components for a custom post-blend (1I-a,
    // existing stock mixed ad-hoc) or from the parent plan's sub-plans for a
    // recipe-based post-blend (1I-b, assembled from fresh roast batches — see
    // bulk_roasted_coffee.source_plan_id / finalizePostBlendPlan in
    // js/roasting.js).
    function compositionHtmlFor(bulk) {
        let compositionHtml = '';
        if (bulk.is_post_blend && bulk.source_plan_id) {
            const subPlans = (roastingPlans || []).filter(p => p.parent_plan_id === bulk.source_plan_id);
            const totalKg = subPlans.reduce((s, p) => s + (parseFloat(p.fulfilled_roasted_kg) || 0), 0);
            const rowsHtml = subPlans.map(p => {
                const gb = (greenbeans || []).find(g => g.id === p.single_coffee_id);
                const label = gb ? gb.name : 'Unknown';
                const kg = parseFloat(p.fulfilled_roasted_kg) || 0;
                const pct = totalKg > 0 ? (kg / totalKg * 100) : 0;
                return `<li style="display:flex; justify-content:space-between; font-size:0.72rem; padding:2px 0;"><span>${label}</span><span style="font-family:monospace; color:var(--text-muted);">${kg.toFixed(2)}kg · ${pct.toFixed(0)}%</span></li>`;
            }).join('');
            compositionHtml = `
                <div style="background: var(--bg-app); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px;">
                    <div style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted); margin-bottom: 3px;">Composition</div>
                    <ul style="list-style:none; margin:0; padding:0;">${rowsHtml || '<li style="font-size:0.72rem; color:var(--text-muted);">No components recorded</li>'}</ul>
                </div>
            `;
        } else if (bulk.is_post_blend) {
            const comps = (postBlendComponents || []).filter(c => c.blend_bulk_id === bulk.id);
            const totalKg = comps.reduce((s, c) => s + (parseFloat(c.kg) || 0), 0);
            const rowsHtml = comps.map(c => {
                let label;
                if (c.source_type === 'Bulk') {
                    const src = (bulkList || []).find(b => b.id === c.source_bulk_id);
                    label = src ? src.coffee_name : 'Unknown';
                } else {
                    const lot = (packedLots || []).find(l => l.id === c.source_packed_lot_id);
                    const packed = lot ? (packedList || []).find(p => p.id === lot.packed_coffee_id) : null;
                    label = packed ? (packed.custom_coffee_name || 'Roasted Coffee') : 'Unknown';
                }
                const kg = parseFloat(c.kg) || 0;
                const pct = totalKg > 0 ? (kg / totalKg * 100) : 0;
                return `<li style="display:flex; justify-content:space-between; font-size:0.72rem; padding:2px 0;"><span>${label}</span><span style="font-family:monospace; color:var(--text-muted);">${kg.toFixed(2)}kg · ${pct.toFixed(0)}%</span></li>`;
            }).join('');
            compositionHtml = `
                <div style="background: var(--bg-app); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px;">
                    <div style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted); margin-bottom: 3px;">Composition</div>
                    <ul style="list-style:none; margin:0; padding:0;">${rowsHtml || '<li style="font-size:0.72rem; color:var(--text-muted);">No components recorded</li>'}</ul>
                </div>
            `;
        }

        return compositionHtml;
    }

    // Coffee code badge, top-right — the green_coffee/blend_recipes code (or
    // the manually-typed custom_coffee_code for a post-blend), so the crew can
    // identify the coffee at a glance next to the name.
    function codeBadgeHtmlFor(bulk) {
        let coffeeCode = null;
        if (bulk.is_post_blend) {
            coffeeCode = bulk.custom_coffee_code || null;
        } else if (bulk.coffee_type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === bulk.single_coffee_id);
            coffeeCode = gb ? gb.code : null;
        } else if (bulk.coffee_type === 'Blend') {
            const r = (recipes || []).find(rec => rec.id === bulk.blend_recipe_id);
            coffeeCode = r ? r.code : null;
        }
        return coffeeCode
            ? `<div style="font-family: monospace; font-weight: 800; font-size: 0.95rem; color: var(--primary); background: var(--primary-glow); border: 1px solid var(--primary); border-radius: 8px; padding: 5px 11px; letter-spacing: 0.3px; flex: 0 0 auto;">${coffeeCode}</div>`
            : '';
    }

    const machineLabel = (bulk) => {
        const machine = (machines || []).find(m => m.id === bulk.machine_id);
        return machine ? machine.name : (bulk.is_post_blend ? 'Assembled blend' : 'Unknown Machine');
    };
    const lotCodeFor = (bulk) => bulk.custom_blend_code
        || buildPreviewLotCode(bulk, machines, greenbeans, recipes, roastBatches, bulk.production_date);
    const postBlendBadge = (bulk) => bulk.is_post_blend
        ? ' <span class="badge-post-blend" style="font-size:0.65rem; font-weight:700; text-transform:uppercase; border-radius:4px; padding:1px 6px; vertical-align:middle;">Post-Blend</span>'
        : '';
    // Post-blend/custom blend cards only — coffee_name for these is a
    // freely-typed label entered in the Add Custom Blend modal (or a plan's
    // finalized name), not derived from a green_coffee/blend_recipes row
    // like every other card, so it's the one card type where a rename
    // afterwards makes sense without touching any other table.
    const editNameButtonFor = (bulk) => bulk.is_post_blend
        ? ` <button type="button" class="btn-edit-blend-name" data-bulk-id="${bulk.id}" title="${window.t ? window.t('tt_edit_blend_name') : 'Edit name'}" style="background:none; border:none; padding:0; margin-left:2px; cursor:pointer; color:var(--text-muted); vertical-align:middle; line-height:0;"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>`
        : '';
    // V2 Repack: rose badge — see css/styles.css .badge-repack, deliberately
    // the one hue not already used by any other badge in this app (single,
    // blend, pre-blend, post-blend), and reused as-is for the New Repack
    // modal's accent so a repack reads as one consistent visual thread from
    // card to modal (explicit user request).
    const repackBadge = (bulk) => bulk.is_repack
        ? ` <span class="badge-repack" style="font-size:0.65rem; font-weight:700; text-transform:uppercase; border-radius:4px; padding:1px 6px; vertical-align:middle;" data-i18n="badge_repack">Repack</span>`
        : '';
    // "dari 2·0037 ×2 · 1·0041 ×4" — which source lots this bulk was opened
    // from, so the team can see provenance without opening the Repack tab's
    // history. Reads strip_code (short FIFO code) when the source lot has
    // one, else falls back to its long-form lot_code — same fallback a size
    // with no size_digit configured yet would need elsewhere in this file.
    // No data-i18n here on purpose: this div's content is dynamic (the
    // strip-code list), and translatePage() replaces an element's full
    // textContent by key (js/i18n.js:43) — tagging it would wipe that list
    // out on every language switch. This whole card is rebuilt fresh on
    // every render call anyway, so the label is just resolved inline below.
    const repackProvenanceHtmlFor = (bulk) => {
        if (!bulk.is_repack) return '';
        const sources = (repackSources || []).filter(s => s.repack_bulk_id === bulk.id);
        if (sources.length === 0) return '';
        const parts = sources.map(s => {
            const srcLot = (packedLots || []).find(l => l.id === s.source_packed_lot_id);
            const code = srcLot ? (srcLot.strip_code || srcLot.lot_code) : '?';
            return `${code} &times;${s.pcs}`;
        });
        const prefix = window.t ? window.t('lbl_repack_from_prefix') : 'from';
        return `<div class="text-repack" style="font-family: monospace; font-size: 0.72rem; margin-top: 2px;">${prefix} ${parts.join(' &middot; ')}</div>`;
    };

    // V2 sales fulfillment (stage 4, explicit user request): a bulk lot the
    // approval modal already promised to one or more sales orders
    // (bulk_reservations — see js/sales.js approveSalesOrder) is still
    // physically sitting here as loose bulk, indistinguishable from
    // unclaimed stock, until someone packs it. Surfaces which order(s) it's
    // spoken for so the packing team doesn't treat it as free-for-anyone —
    // one bulk row can carry reservations from several orders (FIFO-split
    // across whichever bulk rows an order's approval drew from), so this
    // lists all of them, not just one.
    const reservationsByBulkId = {};
    (bulkReservations || []).forEach(res => {
        const kg = parseFloat(res.kg) || 0;
        if (kg <= 0.0001) return;
        const item = (requestOrderItems || []).find(i => i.id === res.request_order_item_id);
        const order = item ? (requestOrders || []).find(o => o.id === item.request_order_id) : null;
        const orderNo = order ? order.order_number : `#${item ? item.request_order_id : '?'}`;
        if (!reservationsByBulkId[res.bulk_roasted_coffee_id]) reservationsByBulkId[res.bulk_roasted_coffee_id] = [];
        reservationsByBulkId[res.bulk_roasted_coffee_id].push({ orderNo, kg });
    });
    const reservationLabelFor = (bulk) => {
        const resList = reservationsByBulkId[bulk.id];
        if (!resList || resList.length === 0) return '';
        const parts = resList.map(r => `${r.kg.toFixed(1)}kg &rarr; ${r.orderNo}`).join(', ');
        return `<div style="font-size:0.68rem; color:#b45309; background:rgba(180,83,9,0.1); border-radius:4px; padding:2px 7px; margin-top:3px; display:inline-flex; align-items:center; gap:4px; align-self:flex-start;"><i class="icon-lock va-middle-mr-1"></i>${parts}</div>`;
    };

    // Print/Pack keep the full-width row they've always had; Close Lot goes on
    // its own line as a quiet text button — it's an occasional end-of-lot
    // tidy-up for leftover grams, so it shouldn't crowd the two primary
    // actions (squeezing three buttons onto one row wrapped "Print Barcode"
    // onto two lines).
    // Icons are siblings of a <span data-i18n>, never children of it: i18n.js
    // translates via `el.textContent = t(key)` (js/i18n.js:43), which wipes
    // every child node — an <i> placed inside the data-i18n element would
    // vanish the moment a language is applied. Same wrap-the-text pattern as
    // index.html's sidebar/scan buttons. Classes are `icon-*` (the
    // lucide-static webfont's real prefix), not `lucide-*`.
    const actionButtons = (bulk) => `
        <div style="display: flex; gap: 8px;">
            <button type="button" class="btn btn-secondary btn-sm btn-print-lot-barcode" data-bulk-id="${bulk.id}" style="flex: 1;"><i class="icon-barcode va-middle-mr-1"></i><span data-i18n="btn_print_barcode">Barcode</span></button>
            <button type="button" class="btn btn-primary btn-sm btn-pack-bulk" data-bulk-id="${bulk.id}" style="flex: 1;"><i class="icon-package va-middle-mr-1"></i><span data-i18n="btn_pack">Pack</span></button>
        </div>
        <button type="button" class="btn-close-lot" data-bulk-id="${bulk.id}"
            style="align-self: flex-end; background: none; border: none; padding: 2px 0; cursor: pointer; color: var(--text-muted); font-size: 0.74rem; text-decoration: underline; font-family: inherit;"><i class="icon-archive va-middle-mr-1"></i><span data-i18n="btn_close_lot">Close Lot</span></button>
    `;

    // TEST_BATCH_CARD_PLAN.md §3: pinned card for a roast_batches row still
    // awaiting QC approval. Coffee name/machine/depreciation are resolved
    // the exact same way as the Batch Log table (js/roasting.js, the
    // sortedBatches.forEach loop) on purpose — two independent lookups for
    // the same batch could otherwise silently disagree.
    function buildTestBatchCard(batch) {
        let coffeeName = '';
        if (batch.coffee_type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === batch.single_coffee_id);
            coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === batch.blend_recipe_id);
            coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
        }
        const mach = (machines || []).find(m => m.id === batch.machine_id);
        const machineName = mach ? mach.name : 'Unknown';
        const outputG = (parseFloat(batch.output_weight_kg || 0) * 1000).toFixed(0);
        const depVal = (100 - parseFloat(batch.yield_percentage || 0)).toFixed(1);

        const notesHtml = batch.notes
            ? `<div style="font-size:0.76rem; font-style:italic; color:var(--text-secondary); background:var(--bg-app); border:1px solid var(--border); border-radius:6px; padding:5px 8px;">${batch.notes}</div>`
            : '';

        // Card stays visible to everyone (so the whole team can see a batch
        // is waiting), but the two approve actions only render for whoever
        // holds the permission — same gate as the Batch Log table's own
        // Approve button (js/app.js, .btn-approve-test-batch wiring).
        // No margin-top:auto here on purpose (unlike buildSingleCard's
        // actionButtons) — this card's grid row often sits next to a taller
        // bulk card, and stretch-to-row-height + auto-margin left a big gap
        // above the buttons (found live 2026-08-30). This card reads better
        // staying compact than aligning its buttons to the row's bottom.
        const actionsHtml = hasPermission('roasting_batch_approve') ? `
            <div style="display:flex; flex-direction:column; gap:5px;">
                <button type="button" class="btn btn-primary btn-sm btn-rtp-approve-test" data-id="${batch.id}" data-i18n="btn_approve_test_card">Approve</button>
                <button type="button" class="btn btn-secondary btn-sm btn-rtp-approve-combine-test" data-id="${batch.id}" data-i18n="btn_approve_combine_test">Approve &amp; Combine</button>
            </div>
        ` : '';

        return `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                <div>
                    <div style="font-weight: 700; font-size: 1rem;">${coffeeName}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${machineName}</div>
                </div>
                <span class="badge-test-batch" style="font-size:0.7rem; font-weight:700; text-transform:uppercase; border-radius:9999px; padding:3px 10px; white-space:nowrap;" data-i18n="badge_test_pending">Test &middot; Pending</span>
            </div>
            ${notesHtml}
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 10px; font-size:0.78rem;">
                <div><span style="color:var(--text-muted);" data-i18n="lbl_test_batch_code">Batch Code</span> <code>${batch.batch_code || '-'}</code></div>
                <div><span style="color:var(--text-muted);" data-i18n="lbl_test_roast_date">Roast Date</span> ${batch.roast_date || '-'}</div>
                <div><span style="color:var(--text-muted);" data-i18n="lbl_test_output">Output</span> ${outputG} g</div>
                <div><span style="color:var(--text-muted);" data-i18n="lbl_test_depreciation">Depreciation</span> ${depVal}%</div>
            </div>
            ${actionsHtml}
        `;
    }

    // One roast date in this coffee+machine group — unchanged from before the
    // grouping, so a coffee that's only been roasted once costs no extra click.
    function buildSingleCard(bulk) {
        return `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                <div>
                    <div style="font-weight: 700; font-size: 1rem;">${bulk.coffee_name}${postBlendBadge(bulk)}${repackBadge(bulk)}${editNameButtonFor(bulk)}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${machineLabel(bulk)}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${bulk.production_date || '-'}</div>
                    ${repackProvenanceHtmlFor(bulk)}
                </div>
                ${codeBadgeHtmlFor(bulk)}
            </div>
            <div style="font-family: monospace; font-size: 0.72rem; font-weight: 700; color: var(--primary); background: var(--primary-glow); border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; align-self: flex-start; letter-spacing: 0.3px;">${lotCodeFor(bulk)}</div>
            <div style="font-size: 1.4rem; font-weight: 700; color: var(--primary);">${parseFloat(bulk.bulk_available).toFixed(2)} kg</div>
            ${reservationLabelFor(bulk)}
            ${compositionHtmlFor(bulk)}
            <div style="display: flex; flex-direction: column; gap: 5px; margin-top: auto;">
                ${actionButtons(bulk)}
            </div>
        `;
    }

    // Several roast dates for the same coffee+machine — combined kg up front,
    // dates collapsed behind a toggle. `rows` arrives oldest-first from the
    // sort above, so the first row is the FIFO pick.
    function buildGroupedCard(rows) {
        const head = rows[0];
        const totalKg = rows.reduce((sum, b) => sum + (parseFloat(b.bulk_available) || 0), 0);
        const listId = `rtp-dates-${head.id}`;
        const datesLabel = (window.t ? window.t('rtp_roast_dates') : '{n} roast dates').replace('{n}', rows.length);
        const oldestLabel = (window.t ? window.t('rtp_oldest') : 'oldest {date}').replace('{date}', head.production_date || '-');
        const pickFirst = `<span style="font-size:0.62rem; font-weight:700; color:var(--primary); background:rgba(45,106,79,0.12); padding:1px 6px; border-radius:9999px;" data-i18n="badge_pick_first">PICK FIRST</span>`;

        const dateRows = rows.map((bulk, idx) => `
            <div style="padding: 9px 10px; ${idx > 0 ? 'border-top: 1px solid var(--border);' : ''} display: flex; flex-direction: column; gap: 7px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="min-width: 0;">
                        <div style="display: flex; align-items: center; gap: 7px; flex-wrap: wrap;">
                            <span style="font-weight: 700; font-size: 0.86rem;">${bulk.production_date || '-'}</span>
                            ${idx === 0 ? pickFirst : ''}
                        </div>
                        <div style="font-family: monospace; font-size: 0.68rem; color: var(--text-muted); margin-top: 2px;">${lotCodeFor(bulk)}</div>
                    </div>
                    <div style="margin-left: auto; font-weight: 700; font-size: 0.95rem; color: var(--primary); white-space: nowrap;">${parseFloat(bulk.bulk_available).toFixed(2)} kg</div>
                </div>
                ${reservationLabelFor(bulk)}
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    ${actionButtons(bulk)}
                </div>
            </div>
        `).join('');

        return `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                <div>
                    <div style="font-weight: 700; font-size: 1rem;">${head.coffee_name}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${machineLabel(head)}</div>
                </div>
                ${codeBadgeHtmlFor(head)}
            </div>
            <div style="font-size: 1.4rem; font-weight: 700; color: var(--primary);">${totalKg.toFixed(2)} kg</div>
            <button type="button" class="btn-rtp-dates-toggle" data-target="${listId}" aria-expanded="false" aria-controls="${listId}"
                style="display: flex; align-items: center; gap: 7px; background: none; border: none; padding: 0; cursor: pointer; color: var(--text-muted); font-size: 0.78rem; align-self: flex-start; font-family: inherit;">
                <span class="rtp-chev" style="display: inline-block; transition: transform 0.15s ease;">&#9656;</span>
                <span>${datesLabel} &middot; ${oldestLabel}</span>
            </button>
            <div id="${listId}" class="rtp-dates-list hidden" style="border: 1px solid var(--border); border-radius: 8px; background: var(--bg-app); margin-top: -2px;">
                ${dateRows}
            </div>
        `;
    }

    // Pinned Test cards render first (DOM order = grid visual order) and
    // deliberately never enter RTP_FILTER_DATA below — they're a
    // notification that needs action, not stock being browsed, so they stay
    // visible regardless of whatever coffee/machine/date filter is active.
    pendingTestBatches.forEach(batch => {
        const card = document.createElement('div');
        card.className = 'card card-test-batch';
        // align-self: start (not the grid's default stretch) — this card
        // often shares a row with a taller bulk card; stretching to match
        // left a big empty gap at the bottom (found live 2026-08-30). This
        // card's height should always be just its own content.
        card.style.cssText = 'padding: 14px; display: flex; flex-direction: column; gap: 8px; align-self: start;';
        card.innerHTML = buildTestBatchCard(batch);
        container.appendChild(card);
    });
    container.querySelectorAll('.btn-rtp-approve-test').forEach(btn => {
        btn.addEventListener('click', () => approveTestBatch(parseInt(btn.getAttribute('data-id'))));
    });
    container.querySelectorAll('.btn-rtp-approve-combine-test').forEach(btn => {
        btn.addEventListener('click', () => openApproveAndCombineModal(parseInt(btn.getAttribute('data-id'))));
    });

    // Filter metadata, one entry per rendered card — kept in a module-level
    // array (not re-derived from the DOM) so the filter bar can re-evaluate
    // instantly on every keystroke/dropdown change without re-fetching or
    // re-rendering. Cards stay exactly as built (Option A, per user
    // decision): a card matches the Roast Date filter if ANY of its dates
    // matches, so a grouped card's own "N roast dates" summary never lies —
    // filtering only ever hides/shows whole cards.
    RTP_FILTER_DATA = [];
    groups.forEach(rows => {
        const card = document.createElement('div');
        card.className = rows[0].is_repack ? 'card card-repack' : (rows[0].is_post_blend ? 'card card-post-blend' : 'card');
        card.style.cssText = 'padding: 16px; display: flex; flex-direction: column; gap: 10px;';
        card.innerHTML = rows.length === 1 ? buildSingleCard(rows[0]) : buildGroupedCard(rows);
        container.appendChild(card);
        RTP_FILTER_DATA.push({
            el: card,
            coffeeLabel: rows[0].coffee_name,
            machineName: machineLabel(rows[0]),
            dates: new Set(rows.map(r => r.production_date).filter(Boolean))
        });
    });

    container.querySelectorAll('.btn-rtp-dates-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const list = document.getElementById(btn.getAttribute('data-target'));
            if (!list) return;
            const open = list.classList.toggle('hidden') === false;
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            const chev = btn.querySelector('.rtp-chev');
            if (chev) chev.style.transform = open ? 'rotate(90deg)' : '';
        });
    });
    container.querySelectorAll('.btn-print-lot-barcode').forEach(btn => {
        btn.addEventListener('click', () => openPrintBarcodeModal(parseInt(btn.getAttribute('data-bulk-id'))));
        btn.style.display = hasPermission('packing_print_barcode') ? '' : 'none';
    });
    container.querySelectorAll('.btn-pack-bulk').forEach(btn => {
        btn.addEventListener('click', () => openPackBulkModal(parseInt(btn.getAttribute('data-bulk-id'))));
        btn.style.display = hasPermission('packing_daily') ? '' : 'none';
    });
    container.querySelectorAll('.btn-close-lot').forEach(btn => {
        btn.addEventListener('click', () => openCloseLotModal(parseInt(btn.getAttribute('data-bulk-id'))));
        btn.style.display = hasPermission('packing_daily') ? '' : 'none';
    });
    container.querySelectorAll('.btn-edit-blend-name').forEach(btn => {
        btn.addEventListener('click', () => openEditBlendNameModal(parseInt(btn.getAttribute('data-bulk-id'))));
        btn.style.display = hasPermission('packing_daily') ? '' : 'none';
    });
    if (window.translatePage) window.translatePage();

    initReadyToPackFilters();
    populateReadyToPackFilterDropdowns();
    applyReadyToPackFilters();
}

// Module-level so the filter bar (search + 3 cascading dropdowns) can react
// instantly to input without re-fetching — rebuilt fresh on every
// renderReadyToPackCards call, read by populate/apply below.
let RTP_FILTER_DATA = [];
let RTP_FILTERS_INITED = false;

// Wires the search box + 3 selects once (idempotent guard, same pattern as
// btn-custom-packing elsewhere in this file) — renderReadyToPackCards runs
// on every Packing tab load/refresh, so this must not accumulate listeners.
function initReadyToPackFilters() {
    if (RTP_FILTERS_INITED) return;
    RTP_FILTERS_INITED = true;

    const searchInput = document.getElementById('rtp-filter-search');
    const selCoffee = document.getElementById('rtp-filter-coffee');
    const selMachine = document.getElementById('rtp-filter-machine');
    const selDate = document.getElementById('rtp-filter-date');

    if (searchInput) searchInput.addEventListener('input', applyReadyToPackFilters);
    [selCoffee, selMachine, selDate].forEach(sel => {
        if (!sel) return;
        sel.addEventListener('change', () => {
            // Any dropdown change can invalidate the OTHER two dropdowns'
            // current selection (their available options are computed from
            // the other filters), so all three are always repopulated
            // together rather than just the one that changed.
            populateReadyToPackFilterDropdowns();
            applyReadyToPackFilters();
        });
    });
}

// Two-way cascading: each dropdown's option list is computed from the OTHER
// two filters' current values (never its own), so picking any dropdown
// first still narrows the rest — there's no dead-end combination that zeros
// out a dropdown's own options. If a dropdown's current selection is no
// longer among its recomputed options, it resets to "All" for that
// dimension only, rather than leaving a stale value selected that could no
// longer possibly match anything.
function populateReadyToPackFilterDropdowns() {
    const selCoffee = document.getElementById('rtp-filter-coffee');
    const selMachine = document.getElementById('rtp-filter-machine');
    const selDate = document.getElementById('rtp-filter-date');
    if (!selCoffee || !selMachine || !selDate) return;

    const curCoffee = selCoffee.value;
    const curMachine = selMachine.value;
    const curDate = selDate.value;

    function optionsFor(dimension) {
        const matches = RTP_FILTER_DATA.filter(g => {
            if (dimension !== 'coffee' && curCoffee && g.coffeeLabel !== curCoffee) return false;
            if (dimension !== 'machine' && curMachine && g.machineName !== curMachine) return false;
            if (dimension !== 'date' && curDate && !g.dates.has(curDate)) return false;
            return true;
        });
        if (dimension === 'date') {
            const all = new Set();
            matches.forEach(g => g.dates.forEach(d => all.add(d)));
            return [...all].sort((a, b) => b.localeCompare(a)); // newest first
        }
        const key = dimension === 'coffee' ? 'coffeeLabel' : 'machineName';
        return [...new Set(matches.map(g => g[key]))].sort((a, b) => a.localeCompare(b));
    }

    function rebuild(sel, values, currentVal, allLabelKey, allLabelFallback) {
        const stillValid = currentVal && values.includes(currentVal);
        const allLabel = window.t ? window.t(allLabelKey) : allLabelFallback;
        sel.innerHTML = `<option value="">${allLabel}</option>` + values.map(v => `<option value="${v}">${v}</option>`).join('');
        sel.value = stillValid ? currentVal : '';
    }

    rebuild(selCoffee, optionsFor('coffee'), curCoffee, 'rtp_filter_all_coffee', 'All Coffees');
    rebuild(selMachine, optionsFor('machine'), curMachine, 'rtp_filter_all_machine', 'All Machines');
    rebuild(selDate, optionsFor('date'), curDate, 'rtp_filter_all_date', 'All Roast Dates');
}

// Show/hide pass — search is a substring match against the card's full
// rendered text (so it also reaches dates/lot codes hidden inside a
// collapsed grouped card), ANDed with the 3 dropdowns.
function applyReadyToPackFilters() {
    const searchInput = document.getElementById('rtp-filter-search');
    const selCoffee = document.getElementById('rtp-filter-coffee');
    const selMachine = document.getElementById('rtp-filter-machine');
    const selDate = document.getElementById('rtp-filter-date');
    const countEl = document.getElementById('rtp-filter-count');
    const noMatchEl = document.getElementById('ready-to-pack-no-match');
    if (!selCoffee || !selMachine || !selDate) return;

    const term = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const coffee = selCoffee.value;
    const machine = selMachine.value;
    const date = selDate.value;

    let visibleCount = 0;
    RTP_FILTER_DATA.forEach(g => {
        let matches = true;
        if (coffee && g.coffeeLabel !== coffee) matches = false;
        if (machine && g.machineName !== machine) matches = false;
        if (date && !g.dates.has(date)) matches = false;
        if (matches && term && !g.el.textContent.toLowerCase().includes(term)) matches = false;

        g.el.style.display = matches ? '' : 'none';
        if (matches) visibleCount++;
    });

    if (countEl) {
        const template = window.t ? window.t('rtp_filter_count') : '{n} of {total}';
        countEl.textContent = template.replace('{n}', visibleCount).replace('{total}', RTP_FILTER_DATA.length);
    }
    if (noMatchEl) noMatchEl.classList.toggle('hidden', visibleCount > 0 || RTP_FILTER_DATA.length === 0);
}

// Renames a post-blend/custom blend's display name (bulk_roasted_coffee.
// coffee_name) — the one card type whose name was freely typed at creation
// time (Add Custom Blend modal) rather than looked up from green_coffee/
// blend_recipes, so a typo or a later rename request has nowhere else to be
// fixed. Only touches this bulk row; already-printed labels or already-
// packed stock keep whatever name they were created with (see coffee_name
// snapshots at packedRow creation elsewhere in this file) — this is a
// forward-looking rename of the still-unpacked bulk lot only.
async function openEditBlendNameModal(bulkId) {
    const { data: bulkList } = await fetchData('bulk_roasted_coffee');
    const bulk = (bulkList || []).find(b => b.id === bulkId);
    if (!bulk) return;

    const html = `
        <div class="form-group">
            <label data-i18n="lbl_blend_name">Blend Name</label>
            <input type="text" id="ebn-name" class="form-control" value="${(bulk.coffee_name || '').replace(/"/g, '&quot;')}" maxlength="100">
        </div>
        <button type="button" id="ebn-save" class="btn btn-primary" style="width:100%; margin-top:12px;" data-i18n="btn_save_name">Save</button>
    `;
    openModal(window.t ? window.t('title_edit_blend_name') : 'Edit Blend Name', html, '420px');

    document.getElementById('ebn-save').addEventListener('click', async () => {
        const newName = document.getElementById('ebn-name').value.trim();
        if (!newName) {
            alert(window.t ? window.t('alert_blend_name_empty') : 'Name cannot be empty.');
            return;
        }
        const { error } = await saveData('bulk_roasted_coffee', { id: bulk.id, coffee_name: newName });
        if (error) {
            alert('Failed to update name: ' + error.message);
            return;
        }
        const closeBtn = document.getElementById('btn-close-modal');
        if (closeBtn) closeBtn.click();
        await showWarningModal(window.t ? window.t('msg_blend_name_updated') : 'Name updated.', false, null, null, 'success');
        await loadPackingSection();
    });
}

// Retires a bulk lot whose physical stock is finished while the system still
// shows a leftover — the everyday "0.03 kg that isn't really there" case.
// Deliberately NOT a delete: production_lots.bulk_roasted_coffee_id is
// ON DELETE SET NULL, so deleting the row would sever every already-printed
// label's link back to its origin. Instead bulk_available goes to 0 (which
// drops the card from Ready to Pack, since renderReadyToPackCards filters
// > 0.005) and the leftover is written to waste_inventory, keeping the
// discrepancy visible rather than silently absorbed.
async function openCloseLotModal(bulkId) {
    const [{ data: bulkList }, { data: machines }, { data: greenbeans }, { data: recipes }, { data: roastBatches }] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('roast_batches')
    ]);
    const bulk = (bulkList || []).find(b => b.id === bulkId);
    if (!bulk) return;

    const leftoverKg = parseFloat(bulk.bulk_available) || 0;
    const machine = (machines || []).find(m => m.id === bulk.machine_id);
    const lotCode = bulk.custom_blend_code || buildPreviewLotCode(bulk, machines, greenbeans, recipes, roastBatches, bulk.production_date);
    // Anything sizeable is far more likely a mis-click or a real stock
    // discrepancy than end-of-lot residue — say so and point at Stock Take.
    const BIG_LEFTOVER_KG = 1;
    const isBig = leftoverKg > BIG_LEFTOVER_KG;

    const html = `
        <form id="modal-close-lot-form">
            <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.55; margin: 0 0 16px;" data-i18n="close_lot_intro">Use this when the physical stock for this lot is finished but the system still shows a leftover. The lot stops appearing in Ready to Pack, its history stays intact, and the leftover is recorded as waste.</p>
            <div class="form-group">
                <label class="form-label" data-i18n="close_lot_lbl_lot">Lot</label>
                <input type="text" class="form-control" value="${lotCode}" readonly>
            </div>
            <div class="form-group">
                <label class="form-label" data-i18n="close_lot_lbl_coffee">Coffee</label>
                <input type="text" class="form-control" value="${bulk.coffee_name}${machine ? ' · ' + machine.name : ''}${bulk.production_date ? ' · ' + bulk.production_date : ''}" readonly>
            </div>
            <div class="form-group">
                <label class="form-label" data-i18n="close_lot_lbl_leftover">Leftover in system</label>
                <input type="text" class="form-control" value="${leftoverKg.toFixed(2)} kg" readonly>
            </div>
            ${isBig ? `<p style="background: rgba(217,119,6,0.12); border: 1px solid #d97706; color: #d97706; padding: 9px 12px; border-radius: 8px; font-size: 0.8rem; line-height: 1.5; margin-bottom: 14px;">${(window.t ? window.t('close_lot_big_warning') : 'This lot still holds {kg} kg. Closing it writes all of it off as waste. For a real stock count, use Stock Take in Inventory instead.').replace('{kg}', leftoverKg.toFixed(2))}</p>` : ''}
            <div class="form-group">
                <label class="form-label" data-i18n="close_lot_lbl_reason">Reason</label>
                <select id="m-closelot-reason" class="form-control">
                    <option value="Finished — scale difference" data-i18n="close_lot_reason_finished">Finished — scale difference</option>
                    <option value="Spilled / discarded" data-i18n="close_lot_reason_spilled">Spilled / discarded</option>
                    <option value="Moisture loss" data-i18n="close_lot_reason_moisture">Moisture loss</option>
                    <option value="Other" data-i18n="close_lot_reason_other">Other</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" data-i18n="close_lot_lbl_notes">Notes (optional)</label>
                <input type="text" id="m-closelot-notes" class="form-control" placeholder="e.g. residue left in the hopper" data-i18n-placeholder="close_lot_notes_ph">
            </div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-danger" data-i18n="btn_close_lot">Close Lot</button>
            </div>
        </form>
    `;

    openModal(window.t ? window.t('close_lot_title') : 'Close Lot', html, '480px');
    if (window.translatePage) window.translatePage();

    document.getElementById('modal-close-lot-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const reason = document.getElementById('m-closelot-reason').value;
        const notes = document.getElementById('m-closelot-notes').value.trim();

        if (!await showWarningModal(window.t ? window.t('close_lot_confirm') : 'Close this lot?')) return;

        const { data: wasteRow, error: wasteErr } = await saveData('waste_inventory', {
            source_type: 'Bulk',
            source_name: `${bulk.coffee_name} (${lotCode})`,
            bulk_roasted_coffee_id: bulk.id,
            waste_kg: leftoverKg,
            discard_date: new Date().toISOString().split('T')[0],
            reason: notes ? `${reason} — ${notes}` : reason,
            recorded_by: (currentUser && currentUser.name) || null
        });
        if (wasteErr) {
            await showWarningModal('Could not record the leftover as waste: ' + wasteErr.message, false);
            return;
        }

        // Atomic RPC (STOCK_LEDGER_PLAN.md Phase 6) — an absolute set to 0,
        // logged with a ref back to the waste_inventory row it just created.
        const { error: bulkErr } = await window.supabaseClient.rpc('set_bulk_lot_available', {
            p_bulk_id: bulk.id, p_kg: 0,
            p_operation: 'close_lot', p_ref_table: 'waste_inventory', p_ref_id: wasteRow ? wasteRow.id : null,
            p_reason: reason, p_user: (currentUser && currentUser.name) || null
        });
        if (bulkErr) {
            await showWarningModal('Could not close the lot: ' + bulkErr.message, false);
            return;
        }

        document.getElementById('btn-close-modal').click();
        await showWarningModal(window.t ? window.t('close_lot_saved') : 'Lot closed. The leftover was recorded as waste.', false, null, null, 'success');
        await loadPackingSection();
        scheduleDashboardRefresh();
    });
}

// Waste tab — the only place waste_inventory is actually visible. Fed by
// Close Lot above (source_type 'Bulk') and by a failed-QC roast batch
// (source_type 'Roast Batch', see roasting.js openRoastBatchModal/
// openQuickRoastModal submit handlers). Read-only: corrections happen at the
// source (re-open via a new lot, or re-log the batch), not here.
async function loadWasteInventorySection() {
    const { data: waste } = await fetchData('waste_inventory');
    const tbody = document.getElementById('waste-inventory-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const rows = (waste || []).slice().sort((a, b) => new Date(b.discard_date) - new Date(a.discard_date) || b.id - a.id);

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center-muted">${window.t ? window.t('waste_inventory_empty') : 'No waste recorded.'}</td></tr>`;
        return;
    }

    const sourceLabel = (r) => {
        if (r.source_type === 'Bulk') return window.t ? window.t('waste_source_bulk') : 'Bulk';
        if (r.source_type === 'Roast Batch') return window.t ? window.t('waste_source_batch') : 'Roast Batch';
        return r.source_type || '-';
    };

    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${r.discard_date || '-'}</td>
            <td><strong>${r.source_name || '-'}</strong></td>
            <td>${sourceLabel(r)}</td>
            <td class="text-right">${(parseFloat(r.waste_kg) || 0).toFixed(2)}</td>
            <td>${r.reason || '-'}</td>
            <td>${r.recorded_by || '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('btn-export-waste-inventory').addEventListener('click', async () => {
    const { data: waste } = await fetchData('waste_inventory');
    const rows = (waste || [])
        .slice()
        .sort((a, b) => new Date(b.discard_date) - new Date(a.discard_date) || b.id - a.id)
        .map(r => ({
            'Date': r.discard_date || '-',
            'Item': r.source_name || '-',
            'Source': r.source_type || '-',
            'Kg': (parseFloat(r.waste_kg) || 0).toFixed(2),
            'Reason': r.reason || '-',
            'Recorded By': r.recorded_by || '-'
        }));
    if (rows.length === 0) {
        await showWarningModal('No waste recorded to export.', false);
        return;
    }
    exportToExcel(rows, `Waste_Inventory_${new Date().toISOString().split('T')[0]}`);
});

// V2 Custom Blend: mixes existing single-origin bulk (kg) and packed (bags)
// stock into a brand-new bulk_roasted_coffee row (is_post_blend=true), so it
// then flows through the normal Ready to Pack -> production_lot -> packing
// path like any other bulk item. Deliberately NOT saved as a reusable
// recipe (blend_recipes/blend_ingredients) — composition is typed fresh
// every time; history lives in the dedicated "Custom Blend" tab
// (loadCustomBlendSection, js/roasting.js), reading these same rows plus
// post_blend_components (unchanged table from 1I-a).
async function openCustomBlendModal() {
    const [
        { data: bulkList },
        { data: packedList },
        { data: packedLots },
        { data: machines },
        { data: greenbeans },
        { data: recipes }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('packed_coffee'),
        fetchData('packed_coffee_lots'),
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_recipes')
    ]);

    function machineName(id) {
        const m = (machines || []).find(x => x.id === id);
        return m ? m.name : 'Unknown Machine';
    }

    // Native <select><option> ignores HTML, so <b>/<strong> can't bold part
    // of an option's text — map letters/digits to their Unicode "Mathematical
    // Bold" code points instead so the coffee name still reads bold in the
    // source-pool dropdown.
    function toBoldUnicode(str) {
        return String(str).replace(/[A-Za-z0-9]/g, ch => {
            const code = ch.charCodeAt(0);
            if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D400 + (code - 65));
            if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D41A + (code - 97));
            if (code >= 48 && code <= 57) return String.fromCodePoint(0x1D7CE + (code - 48));
            return ch;
        });
    }

    // Clean (unsuffixed) display name for a Single/Blend identity — "(Single)"/
    // "(Blend)" is added explicitly by the caller below instead of relying on
    // whatever suffix state the raw stored name happens to carry, so the tag
    // is always present and consistent regardless of source.
    function resolveCoffeeName(type, id) {
        if (type === 'Single') return (greenbeans || []).find(g => g.id === id)?.name || null;
        if (type === 'Blend') return (recipes || []).find(r => r.id === id)?.name || null;
        return null;
    }

    // packed_coffee doesn't reliably carry single_coffee_id/blend_recipe_id
    // for rows created outside the roast-log flow (e.g.
    // getOrCreatePackedCoffeeRow) — same name-matching convention used
    // elsewhere (packing.js resolvePackedIdentity), tried against green
    // coffee first and blend recipes second.
    function resolvePackedCoffeeIdentity(p) {
        if (p.single_coffee_id) return { type: 'Single', id: p.single_coffee_id };
        if (p.blend_recipe_id) return { type: 'Blend', id: p.blend_recipe_id };
        const cleanName = (p.custom_coffee_name || '').replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
        const gb = (greenbeans || []).find(g => g.name === cleanName);
        if (gb) return { type: 'Single', id: gb.id };
        const r = (recipes || []).find(rec => rec.name === cleanName);
        if (r) return { type: 'Blend', id: r.id };
        return null;
    }

    // Every available SOURCE POOL — single-origin AND already-blended stock
    // both qualify (a custom blend can be built from raw green-coffee
    // origins, from another blend, or a mix of both) — one entry per bulk
    // item, one per packed item+size, each tagged with its coffee identity
    // (`coffeeKey`, e.g. "Single:12" or "Blend:5") so picks for the same
    // ingredient can be grouped/filtered by it. Post-blend bulk (already an
    // assembled mix, not a single recipe/origin) stays excluded either way —
    // that's a separate concept from coffee_type and applies regardless of
    // Single vs Blend.
    const bulkOptions = (bulkList || [])
        .filter(b => (b.coffee_type === 'Single' || b.coffee_type === 'Blend') && parseFloat(b.bulk_available) > 0.005 && !b.is_post_blend)
        .map(b => {
            const id = b.coffee_type === 'Single' ? b.single_coffee_id : b.blend_recipe_id;
            const name = resolveCoffeeName(b.coffee_type, id) || b.coffee_name;
            return {
                key: `bulk:${b.id}`, kind: 'bulk', refId: b.id, coffeeKey: `${b.coffee_type}:${id}`, sortName: name, machineId: b.machine_id || null,
                label: `${toBoldUnicode(name)} (${b.coffee_type}) — Bulk (${machineName(b.machine_id)}, roasted ${b.production_date || '-'})`,
                availableKg: parseFloat(b.bulk_available) || 0
            };
        });

    const packedOptions = (packedList || [])
        .filter(p => (parseInt(p.quantity) || 0) > 0)
        .map(p => {
            const identity = resolvePackedCoffeeIdentity(p);
            if (!identity) return null;
            const name = resolveCoffeeName(identity.type, identity.id) || p.custom_coffee_name || 'Roasted Coffee';
            const lotsForThis = (packedLots || [])
                .filter(l => l.packed_coffee_id === p.id && (parseInt(l.remaining_pcs) || 0) > 0)
                .sort((a, b) => (a.packed_date || '').localeCompare(b.packed_date || '') || a.id - b.id);
            const availPcs = lotsForThis.reduce((s, l) => s + (parseInt(l.remaining_pcs) || 0), 0);
            const bagSizeG = parseFloat(p.bag_size_g) || 0;
            return {
                key: `packed:${p.id}`, kind: 'packed', refId: p.id, coffeeKey: `${identity.type}:${identity.id}`, bagSizeG, sortName: name, machineId: p.machine_id || null,
                label: `${toBoldUnicode(name)} (${identity.type}) — Packed ${p.bag_size_g || '-'}g (${machineName(p.machine_id)})`,
                availableKg: availPcs * (bagSizeG / 1000),
                lots: lotsForThis.map(l => ({ id: l.id, lotCode: l.lot_code, packedDate: l.packed_date, remainingPcs: parseInt(l.remaining_pcs) || 0 }))
            };
        })
        .filter(Boolean);

    // Sorted by coffee name alone (user's call — Bulk vs Packed / roast date
    // no longer determine dropdown order, just the name each option starts with).
    const allOptions = [...bulkOptions, ...packedOptions]
        .sort((a, b) => a.sortName.localeCompare(b.sortName));

    if (allOptions.length === 0) {
        await showWarningModal('No single-origin or blend bulk/packed stock available to build a custom blend from yet.', false);
        return;
    }

    function optionByKey(key) { return allOptions.find(o => o.key === key); }
    function optionsHtml(coffeeKey, selectedKey) {
        const list = coffeeKey ? allOptions.filter(o => o.coffeeKey === coffeeKey) : allOptions;
        const rows = list.map(o => {
            const lotsNote = o.kind === 'packed' ? ` (${o.lots.length} lot${o.lots.length === 1 ? '' : 's'})` : '';
            return `<option value="${o.key}" ${o.key === selectedKey ? 'selected' : ''}>${o.label} — ${o.availableKg.toFixed(2)}kg avail.${lotsNote}</option>`;
        }).join('');
        return `<option value="">— pick a source —</option>${rows}`;
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const html = `
        <div class="form-row">
            <div class="form-group flex-1">
                <label class="form-label">Blend Name</label>
                <input type="text" id="cb-name" class="form-control" placeholder="e.g. Weekend House Blend">
            </div>
            <div class="form-group flex-1">
                <label class="form-label">Coffee Code <span style="color:var(--danger-color, #dc2626); font-weight:700;">*</span></label>
                <input type="text" id="cb-coffee-code" class="form-control" placeholder="e.g. CB1" required>
            </div>
        </div>
        <div class="form-group" style="max-width:230px;">
            <label class="form-label">Bulk Code (auto)</label>
            <input type="text" id="cb-bulk-code-preview" class="form-control" value="CB-${dateStr}" disabled style="color:var(--text-muted);">
        </div>

        <label class="form-label" style="display:block; margin-top:12px;">Ingredients</label>
        <div id="cb-ingredients"></div>
        <button type="button" id="cb-add-ingredient" class="btn btn-secondary btn-sm" style="width:100%; margin-top:8px;">+ Add Ingredient</button>

        <div id="cb-stock-banner" class="hidden" style="background:rgba(220,38,38,0.1); border:1px solid #dc2626; color:#dc2626; padding:8px 12px; border-radius:6px; font-size:0.8rem; margin-top:12px;">One or more ingredients exceed available stock — reduce the amount or pick a different lot.</div>

        <div class="form-group" style="margin-top:12px; background:var(--primary-glow); border-radius:8px; padding:10px 12px;">
            <label class="form-label">Produce As <span style="color:var(--danger-color, #dc2626); font-weight:700;">*</span></label>
            <select id="cb-produce-as" class="form-control"></select>
            <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">Which machine this blend counts as, so it shows up correctly in packed stock later.</div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:12px; border-top:1px solid var(--border-color);">
            <div style="color:var(--text-muted); font-size:0.85rem;">Total blend size <strong id="cb-total-kg" style="color:var(--text-primary); font-family:monospace;">0.00 kg</strong></div>
            <button type="button" id="cb-submit" class="btn btn-primary">Create Blend</button>
        </div>
    `;

    openModal('Add Custom Blend', html, '760px');

    // ingredients: Map(ingId -> { optionKey, lotId, amount }) — one row per
    // pick, no percentage/target math. The same coffee can appear in several
    // rows (e.g. two different lots) simply by adding it twice via "+ Add
    // Ingredient"; there's no nested "picks" sub-list to manage anymore.
    const ingredients = new Map();
    let ingSeq = 0;

    // "Produce As" (V2 explicit user request): required so a Custom Blend's
    // resulting bulk_roasted_coffee row gets a real machine_id instead of
    // the null it always got before — that null is exactly why these items
    // showed no code/machine breakdown in the Packed Coffee Stock table
    // (only ever landing in its silent "Unknown" bucket, counted in Total
    // only). `manualMachineId` is the user's explicit override (null = "no
    // override, follow auto-detection"); `selectedMachineId` is the
    // resolved value actually saved on submit.
    let manualMachineId = null;
    let selectedMachineId = null;

    // Only offers "same as source machine" when every picked ingredient
    // traces back to one single machine — mixed-machine or packed-with-no-
    // machine ingredients return null, forcing a manual pick instead of
    // guessing.
    function detectCommonMachineId() {
        let common;
        let any = false;
        for (const ing of ingredients.values()) {
            if (!ing.optionKey) continue;
            const opt = optionByKey(ing.optionKey);
            if (!opt || !opt.machineId) return null;
            any = true;
            if (common === undefined) common = opt.machineId;
            else if (common !== opt.machineId) return null;
        }
        return any ? common : null;
    }

    function renderProduceAs() {
        const sel = document.getElementById('cb-produce-as');
        if (!sel) return;
        const detected = detectCommonMachineId();
        let optsHtml = '';
        if (detected) optsHtml += `<option value="same">Same as source machine (${machineName(detected)})</option>`;
        optsHtml += (machines || []).map(m => `<option value="${m.id}">${m.name}</option>`).join('');
        sel.innerHTML = `<option value="" disabled>Select a machine…</option>${optsHtml}`;

        if (manualMachineId !== null && (machines || []).some(m => m.id === manualMachineId)) {
            sel.value = String(manualMachineId);
        } else if (detected) {
            sel.value = 'same';
        } else {
            sel.value = '';
        }
        selectedMachineId = sel.value === 'same' ? detected : (sel.value ? parseInt(sel.value) : null);
    }

    function totalAvailableKg(opt, lotId) {
        if (!opt) return 0;
        if (opt.kind === 'bulk') return opt.availableKg;
        const lot = opt.lots.find(l => l.id === lotId);
        return lot ? lot.remainingPcs * (opt.bagSizeG / 1000) : 0;
    }

    // How much of THIS row's source is still free to use, after subtracting
    // what every OTHER row already claims from the exact same source (same
    // bulk item, or same packed lot) — lets two rows share a source pool
    // without silently double-booking its stock.
    function remainingAvailableKg(ingId) {
        const ing = ingredients.get(ingId);
        if (!ing || !ing.optionKey) return 0;
        const opt = optionByKey(ing.optionKey);
        if (!opt) return 0;
        const total = totalAvailableKg(opt, ing.lotId);
        let usedElsewhere = 0;
        ingredients.forEach((other, otherId) => {
            if (otherId === ingId || other.optionKey !== ing.optionKey) return;
            if (opt.kind === 'packed' && other.lotId !== ing.lotId) return;
            usedElsewhere += other.amount || 0;
        });
        return Math.max(0, total - usedElsewhere);
    }

    function renderIngredients() {
        const container = document.getElementById('cb-ingredients');
        if (!container) return;
        container.innerHTML = '';

        ingredients.forEach((ing, ingId) => {
            const opt = optionByKey(ing.optionKey);
            const wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex; align-items:flex-end; gap:8px; margin-bottom:2px; flex-wrap:wrap;';

            let lotHtml = '<option value="">— single pool —</option>';
            if (opt && opt.kind === 'packed') {
                lotHtml = opt.lots.map(l => `<option value="${l.id}" ${ing.lotId === l.id ? 'selected' : ''}>${l.lotCode} — ${l.remainingPcs} left</option>`).join('') || '<option value="">No lots</option>';
            }

            wrap.innerHTML = `
                <div class="form-group flex-1" style="min-width:230px; margin-bottom:0;">
                    <label class="form-label">Coffee (source pool)</label>
                    <select class="form-control cb-opt-select" data-ing="${ingId}">${optionsHtml(null, ing.optionKey)}</select>
                </div>
                <div class="form-group flex-1" style="min-width:150px; margin-bottom:0;">
                    <label class="form-label">Source Lot</label>
                    <select class="form-control cb-lot-select" data-ing="${ingId}" ${!opt || opt.kind !== 'packed' ? 'disabled' : ''}>${lotHtml}</select>
                </div>
                <div class="form-group" style="max-width:110px; margin-bottom:0;">
                    <label class="form-label">Amount (kg)</label>
                    <input type="number" min="0" step="0.01" class="form-control cb-amount-input" data-ing="${ingId}" value="${ing.amount || ''}">
                </div>
                <button type="button" class="btn btn-danger btn-sm cb-remove-ing" data-ing="${ingId}" style="height:38px;">🗑</button>
            `;
            container.appendChild(wrap);

            const availLine = document.createElement('div');
            availLine.id = `cb-avail-${ingId}`;
            availLine.style.cssText = 'font-size:0.75rem; margin:-2px 0 10px; color:var(--text-muted);';
            container.appendChild(availLine);
        });

        container.querySelectorAll('.cb-opt-select').forEach(sel => {
            sel.addEventListener('change', () => {
                const ingId = parseInt(sel.getAttribute('data-ing'));
                const ing = ingredients.get(ingId);
                ing.optionKey = sel.value;
                ing.lotId = null;
                const opt = optionByKey(sel.value);
                if (opt && opt.kind === 'packed' && opt.lots[0]) ing.lotId = opt.lots[0].id;
                renderAll();
            });
        });
        container.querySelectorAll('.cb-lot-select').forEach(sel => {
            sel.addEventListener('change', () => {
                const ingId = parseInt(sel.getAttribute('data-ing'));
                ingredients.get(ingId).lotId = sel.value ? parseInt(sel.value) : null;
                renderAll();
            });
        });
        container.querySelectorAll('.cb-amount-input').forEach(inp => {
            inp.addEventListener('input', () => {
                const ingId = parseInt(inp.getAttribute('data-ing'));
                ingredients.get(ingId).amount = parseFloat(inp.value) || 0;
                // Annotations only — a full renderIngredients() rebuild here
                // would recreate this very input mid-keystroke and steal focus.
                updateAnnotations();
            });
        });
        container.querySelectorAll('.cb-remove-ing').forEach(btn => {
            btn.addEventListener('click', () => {
                ingredients.delete(parseInt(btn.getAttribute('data-ing')));
                renderAll();
            });
        });

        updateAnnotations();
    }

    function updateAnnotations() {
        let totalKg = 0;
        let anyOver = false;
        let anyIncomplete = ingredients.size === 0;

        ingredients.forEach((ing, ingId) => {
            totalKg += ing.amount || 0;
            if (!ing.optionKey || ing.amount <= 0) anyIncomplete = true;

            const amtInput = document.querySelector(`.cb-amount-input[data-ing="${ingId}"]`);
            const availLine = document.getElementById(`cb-avail-${ingId}`);
            if (!ing.optionKey) return;

            const cap = remainingAvailableKg(ingId);
            const over = ing.amount > cap + 0.001;
            if (over) anyOver = true;

            if (amtInput) amtInput.style.borderColor = over ? '#dc2626' : '';
            if (availLine) {
                availLine.textContent = over
                    ? `Only ${cap.toFixed(2)} kg available here — reduce by ${(ing.amount - cap).toFixed(2)} kg`
                    : `${cap.toFixed(2)} kg available`;
                availLine.style.color = over ? '#dc2626' : 'var(--text-muted)';
            }
        });

        const totalEl = document.getElementById('cb-total-kg');
        if (totalEl) totalEl.textContent = totalKg.toFixed(2) + ' kg';

        const banner = document.getElementById('cb-stock-banner');
        if (banner) banner.classList.toggle('hidden', !anyOver);

        const submitBtn = document.getElementById('cb-submit');
        if (submitBtn) submitBtn.disabled = anyIncomplete || anyOver || totalKg <= 0 || !selectedMachineId;
    }

    function renderAll() {
        renderIngredients();
        renderProduceAs();
        updateAnnotations();
    }

    document.getElementById('cb-add-ingredient').addEventListener('click', () => {
        ingredients.set(++ingSeq, { optionKey: '', lotId: null, amount: 0 });
        renderAll();
    });

    document.getElementById('cb-produce-as').addEventListener('change', () => {
        const sel = document.getElementById('cb-produce-as');
        manualMachineId = sel.value === 'same' ? null : (sel.value ? parseInt(sel.value) : null);
        selectedMachineId = sel.value === 'same' ? detectCommonMachineId() : manualMachineId;
        updateAnnotations();
    });

    renderAll();

    document.getElementById('cb-submit').addEventListener('click', async () => {
        const name = (document.getElementById('cb-name').value || '').trim();
        const coffeeCode = (document.getElementById('cb-coffee-code').value || '').trim();

        if (!name) { await showWarningModal('Please enter a blend name.', false); return; }
        if (!coffeeCode) { await showWarningModal('Coffee Code is required.', false); return; }
        if (ingredients.size === 0) { await showWarningModal('Add at least one ingredient.', false); return; }
        if (!selectedMachineId) { await showWarningModal('Please select which machine to produce this blend as.', false); return; }

        let anyIncomplete = false;
        let anyOver = false;
        ingredients.forEach((ing, ingId) => {
            if (!ing.optionKey || ing.amount <= 0) { anyIncomplete = true; return; }
            if (ing.amount > remainingAvailableKg(ingId) + 0.001) anyOver = true;
        });
        if (anyIncomplete) { await showWarningModal('Every ingredient needs a source and an amount greater than 0.', false); return; }
        if (anyOver) { await showWarningModal('One or more ingredients exceed available stock — reduce the amount or pick a different lot.', false); return; }

        const sourceRows = [];
        ingredients.forEach(ing => {
            const opt = optionByKey(ing.optionKey);
            if (!opt || ing.amount <= 0) return;
            sourceRows.push({ kind: opt.kind, refId: opt.refId, lotId: ing.lotId, amountKg: ing.amount });
        });

        await submitCustomBlend({ name, coffeeCode, sourceRows, machineId: selectedMachineId });
    });
}

async function submitCustomBlend({ name, coffeeCode, sourceRows, machineId }) {
    // Re-fetch fresh right before mutating, same idiom used elsewhere (e.g.
    // openPackBulkModal's bulk_available decrement), to avoid acting on a
    // stale snapshot.
    const [
        { data: freshBulkList },
        { data: freshPackedLots },
        { data: freshPacked }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('packed_coffee_lots'),
        fetchData('packed_coffee')
    ]);

    let totalKg = 0;
    const componentsToInsert = [];

    for (const row of sourceRows) {
        if (row.kind === 'bulk') {
            const fresh = (freshBulkList || []).find(b => b.id === row.refId);
            if (!fresh) continue;
            // Atomic RPC (STOCK_LEDGER_PLAN.md Phase 6) — clamps and locks in
            // the DB instead of trusting this read-then-write's stale avail
            // snapshot; kg actually taken comes back from the RPC, same
            // pattern as consume_packed_lot below.
            const { data: kgTaken, error: consumeErr } = await window.supabaseClient.rpc('consume_bulk_lot', {
                p_bulk_id: fresh.id, p_kg: row.amountKg,
                p_operation: 'blend', p_reason: `Custom blend: ${name}`, p_user: (currentUser && currentUser.name) || null
            });
            if (consumeErr) { console.error('consume_bulk_lot RPC failed:', consumeErr); continue; }
            const kg = parseFloat(kgTaken) || 0;
            if (kg <= 0) continue;
            totalKg += kg;
            componentsToInsert.push({ source_type: 'Bulk', source_bulk_id: row.refId, source_packed_lot_id: null, kg });
        } else {
            const lot = (freshPackedLots || []).find(l => l.id === row.lotId);
            if (!lot) continue;
            const packedRow = (freshPacked || []).find(p => p.id === lot.packed_coffee_id);
            const bagSizeG = packedRow ? (parseFloat(packedRow.bag_size_g) || 0) : 0;
            const availPcs = parseInt(lot.remaining_pcs) || 0;
            const availKg = availPcs * (bagSizeG / 1000);
            const kg = Math.min(row.amountKg, availKg); // capped
            if (kg <= 0) continue;
            const bagsUsed = bagSizeG > 0 ? Math.round(kg / (bagSizeG / 1000)) : 0;
            // Atomic RPC (STOCK_LEDGER_PLAN.md Phase 1) — clamps and locks
            // in the DB instead of trusting this read-then-write's stale
            // availPcs snapshot, and packed_coffee.quantity is trigger-
            // derived from this write (sync_packed_coffee_quantity), so no
            // separate packed_coffee write is needed either.
            const { data: bagsTaken, error: consumeErr } = await window.supabaseClient.rpc('consume_packed_lot', {
                p_lot_id: lot.id, p_pcs: bagsUsed,
                p_operation: 'blend', p_reason: `Custom blend: ${name}`, p_user: (currentUser && currentUser.name) || null
            });
            if (consumeErr) { console.error('consume_packed_lot RPC failed:', consumeErr); continue; }
            const actualBags = parseInt(bagsTaken) || 0;
            if (actualBags <= 0) continue;
            const actualKg = bagSizeG > 0 ? (actualBags * bagSizeG) / 1000 : 0;
            totalKg += actualKg;
            componentsToInsert.push({ source_type: 'Packed', source_bulk_id: null, source_packed_lot_id: row.lotId, kg: actualKg });
        }
    }

    if (totalKg <= 0) {
        await showWarningModal('Nothing could be drawn from the selected sources (they may be out of stock).', false);
        return;
    }

    // Date-based bulk/lot code, collision-safe (same retry idea as the green
    // coffee lot codes in 1A — append a numeric suffix if today's base code
    // is already taken by an earlier blend made the same day). CB- prefix
    // (Custom Blend) keeps it visually distinct from 1I-b's PB- (recipe-
    // assembled post-blend) codes, even though both share the same
    // custom_blend_code column/uniqueness check.
    const todayStr = new Date().toISOString().split('T')[0];
    const dateStr = todayStr.replace(/-/g, '');
    let code = `CB-${dateStr}`;
    let suffix = 2;
    while ((freshBulkList || []).some(b => b.custom_blend_code === code)) {
        code = `CB-${dateStr}-${suffix++}`;
    }

    const { data: newBulk, error } = await saveData('bulk_roasted_coffee', {
        coffee_name: name,
        coffee_type: 'PostBlendCustom',
        is_post_blend: true,
        custom_blend_name: name,
        custom_blend_code: code,
        custom_coffee_code: coffeeCode,
        bulk_available: totalKg,
        machine_id: machineId || null,
        single_coffee_id: null,
        blend_recipe_id: null,
        production_date: todayStr,
        // Movement context on the fresh INSERT (STOCK_LEDGER_PLAN.md
        // Phase 4 addendum lesson).
        mv_operation: 'blend', mv_reason: `Custom blend: ${name}`, mv_user: (currentUser && currentUser.name) || null
    });

    if (error || !newBulk) {
        await showWarningModal('Failed to save the new blend. Please try again.', false);
        return;
    }

    for (const comp of componentsToInsert) {
        await saveData('post_blend_components', { ...comp, blend_bulk_id: newBulk.id });
    }

    const closeBtn = document.getElementById('btn-close-modal');
    if (closeBtn) closeBtn.click();

    await showWarningModal(`Blend "${name}" created — ${totalKg.toFixed(2)} kg, code ${code}.`, false, null, null, 'success');
    await loadCustomBlendSection();
    scheduleDashboardRefresh();
}

async function loadPackingRecordsTable() {
    const [
        { data: records },
        { data: machines },
        { data: packedLots }
    ] = await Promise.all([
        fetchData('packing_records'),
        fetchData('machines'),
        fetchData('packed_coffee_lots')
    ]);
    const tbody = document.getElementById('packing-records-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center-muted">No packing records found.</td></tr>`;
        return;
    }

    const sorted = [...records].sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);

    sorted.forEach(rec => {
        const machine = rec.machine_id ? (machines || []).find(m => m.id === rec.machine_id) : null;
        const machineName = rec.machine_name || (machine ? machine.name : '-');
        // Only records created after the packed_coffee_lot_id link shipped
        // (see database/packing_records_lot_link_migration.sql) can be
        // corrected here — older rows have no lot to safely adjust.
        const lot = rec.packed_coffee_lot_id ? (packedLots || []).find(l => l.id === rec.packed_coffee_lot_id) : null;
        const lotCode = lot ? lot.lot_code : '-';
        const isCorrection = rec.status === 'Correction';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${rec.date || '-'}</td>
            <td><strong>${rec.coffee_name || '-'}</strong>${isCorrection ? ' <span style="font-size:0.68rem; font-weight:700; color:var(--primary); background:rgba(45,106,79,0.12); padding:1px 6px; border-radius:9999px;">CORRECTION</span>' : ''}</td>
            <td>${machineName}</td>
            <td>${rec.size_label || (rec.bag_size_g ? (rec.bag_size_g >= 1000 ? `${rec.bag_size_g/1000}kg` : `${rec.bag_size_g}g`) : '-')}</td>
            <td>${rec.quantity || 0}</td>
            <td><code>${lotCode}</code></td>
            <td>${lot ? `<button type="button" class="btn btn-secondary btn-sm btn-edit-packing-record" data-id="${rec.id}">Edit</button>` : ''}</td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-edit-packing-record').forEach(btn => {
        btn.addEventListener('click', () => openEditPackingRecordModal(parseInt(btn.getAttribute('data-id'))));
    });
}

// Corrects a past pack action found via the Packing Records tab — the one
// place a pack action can still be located after its lot's stock has since
// been fully dispatched (Ready to Pack and Stock by Lot both filter to
// available/remaining > 0, so neither works as a "find any past pack,
// anytime" entry point — see packed_coffee_lot_id migration notes). Adjusts
// packed_coffee_lots (the real source of truth) by the delta between the
// corrected and original total, shifts remaining_pcs by the same delta
// (clamped to 0 if more than the correction has already shipped), syncs the
// parent packed_coffee.quantity, and logs a new 'Correction' packing_records
// row — the original entry is never edited/deleted, keeping history intact.
async function openEditPackingRecordModal(recordId) {
    const [
        { data: records },
        { data: packedLots },
        { data: packedList },
        { data: productionLots },
        { data: bulkList }
    ] = await Promise.all([
        fetchData('packing_records'),
        fetchData('packed_coffee_lots'),
        fetchData('packed_coffee'),
        fetchData('production_lots'),
        fetchData('bulk_roasted_coffee')
    ]);

    const record = (records || []).find(r => r.id === recordId);
    const lot = record && record.packed_coffee_lot_id ? (packedLots || []).find(l => l.id === record.packed_coffee_lot_id) : null;
    if (!record || !lot) {
        await showWarningModal('This record has no linked lot to correct — it may predate lot tracking.', false);
        return;
    }
    const parentPacked = (packedList || []).find(p => p.id === lot.packed_coffee_id);

    // A pack action always draws from a production lot's bulk source, EXCEPT
    // manual/custom packing (no bulk to trace back to — production_lot_id is
    // null in that case, same as elsewhere in this file).
    const productionLot = lot.production_lot_id ? (productionLots || []).find(pl => pl.id === lot.production_lot_id) : null;
    const bulkRow = productionLot ? (bulkList || []).find(b => b.id === productionLot.bulk_roasted_coffee_id) : null;
    const bagSizeKg = (parseFloat((parentPacked && parentPacked.bag_size_g) || record.bag_size_g) || 0) / 1000;
    const bulkAvailable = bulkRow ? parseFloat(bulkRow.bulk_available) || 0 : 0;

    const currentQty = parseInt(lot.quantity_pcs) || 0;
    const currentRemaining = parseInt(lot.remaining_pcs) || 0;
    const alreadyShipped = Math.max(0, currentQty - currentRemaining);

    const bulkSectionHtml = bulkRow ? `
        <div class="form-group" style="display:flex; align-items:flex-start; gap:8px; background: var(--bg-app); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px;">
            <input type="checkbox" id="m-correct-adjust-bulk" checked style="margin-top:2px;">
            <label for="m-correct-adjust-bulk" style="margin:0; font-size:0.85rem; cursor:pointer;">
                Also adjust bulk stock (${bulkRow.coffee_name}, roasted ${bulkRow.production_date || '-'})
                <div id="m-correct-bulk-delta" style="font-family:monospace; font-size:0.8rem; color:var(--text-secondary); margin-top:2px;"></div>
            </label>
        </div>
        <p id="m-correct-bulk-warning" class="hidden" style="font-size: 0.82rem; color: var(--warning, #c9a227); margin-top: -4px;">
            That lot's bulk source only has ${bulkAvailable.toFixed(2)} kg left — the adjustment will be capped at 0 kg rather than going negative.
        </p>
    ` : `
        <p style="font-size: 0.82rem; color: var(--text-secondary);">This pack has no traceable bulk source (manual/custom packing) — only the packed stock will be adjusted.</p>
    `;

    const html = `
        <form id="modal-edit-packing-record-form">
            <div class="form-group">
                <label class="form-label">Lot</label>
                <input type="text" class="form-control" value="${lot.lot_code}" readonly>
            </div>
            <div class="form-group">
                <label class="form-label">Coffee</label>
                <input type="text" class="form-control" value="${record.coffee_name || '-'}" readonly>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Currently packed (total)</label>
                    <input type="text" class="form-control" value="${currentQty} bags" readonly>
                </div>
                <div class="form-group">
                    <label class="form-label">Already dispatched</label>
                    <input type="text" class="form-control" value="${alreadyShipped} bags" readonly>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Corrected total packed (bags)</label>
                <input type="number" id="m-correct-qty" class="form-control" value="${currentQty}" min="0" required>
            </div>
            <p id="m-correct-warning" class="hidden" style="font-size: 0.82rem; color: var(--warning, #c9a227); margin-top: -4px;">
                ${alreadyShipped} bag(s) from this lot are already dispatched — the corrected total can't go below that.
            </p>
            ${bulkSectionHtml}
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Correction</button>
            </div>
        </form>
    `;
    openModal('Correct Packing Record', html, '480px');

    const qtyInput = document.getElementById('m-correct-qty');
    const warningEl = document.getElementById('m-correct-warning');
    const bulkDeltaEl = document.getElementById('m-correct-bulk-delta');
    const bulkWarningEl = document.getElementById('m-correct-bulk-warning');

    const refreshPreview = () => {
        const newQty = parseInt(qtyInput.value) || 0;
        warningEl.classList.toggle('hidden', newQty >= alreadyShipped);
        if (bulkRow && bulkDeltaEl) {
            const delta = newQty - currentQty;
            const bulkDeltaKg = -delta * bagSizeKg;
            const wouldGoNegative = bulkAvailable + bulkDeltaKg < 0;
            bulkDeltaEl.textContent = bulkDeltaKg === 0
                ? 'No change to bulk stock.'
                : `${bulkDeltaKg > 0 ? '+' : ''}${bulkDeltaKg.toFixed(2)} kg (${bulkAvailable.toFixed(2)} → ${Math.max(0, bulkAvailable + bulkDeltaKg).toFixed(2)} kg)`;
            if (bulkWarningEl) bulkWarningEl.classList.toggle('hidden', !wouldGoNegative);
        }
    };
    qtyInput.addEventListener('input', refreshPreview);
    refreshPreview();

    document.getElementById('modal-edit-packing-record-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newQty = Math.max(0, parseInt(qtyInput.value) || 0);
        const delta = newQty - currentQty;
        if (delta === 0) {
            document.getElementById('btn-close-modal').click();
            return;
        }

        const newRemaining = Math.max(0, currentRemaining + delta);

        // packed_coffee.quantity is trigger-derived from this lots write
        // (sync_packed_coffee_quantity) — no separate packed_coffee write
        // needed. remaining_pcs goes through the atomic RPC (STOCK_LEDGER_
        // PLAN.md Phase 1); quantity_pcs is a plain write since this flow —
        // unlike a stocktake/manual-adjust — IS meant to correct the lot's
        // historical "originally packed" figure.
        const { error: setErr } = await window.supabaseClient.rpc('set_packed_lot_remaining', {
            p_lot_id: lot.id, p_pcs: newRemaining,
            p_operation: 'correction', p_ref_table: 'packing_records', p_ref_id: record.id,
            p_reason: `${currentQty} → ${newQty} bags`, p_user: (currentUser && currentUser.name) || null
        });
        if (setErr) { console.error('set_packed_lot_remaining RPC failed:', setErr); return; }
        await saveData('packed_coffee_lots', { id: lot.id, quantity_pcs: newQty });

        // More bags packed = more bulk kg consumed, so bulk moves the
        // opposite direction of the packed-quantity delta. Optional: the
        // correction might instead be about a QC/spoilage issue where the
        // bulk really was consumed as originally recorded, so this is
        // left as a checkbox rather than automatic.
        const adjustBulkEl = document.getElementById('m-correct-adjust-bulk');
        if (bulkRow && adjustBulkEl && adjustBulkEl.checked) {
            const bulkDeltaKg = -delta * bagSizeKg;
            // Atomic RPC (STOCK_LEDGER_PLAN.md Phase 6) — delta applied
            // server-side instead of computed from this modal's
            // possibly-stale bulkAvailable snapshot.
            const rpcName = bulkDeltaKg >= 0 ? 'refund_bulk_lot' : 'consume_bulk_lot';
            const { error: bulkErr } = await window.supabaseClient.rpc(rpcName, {
                p_bulk_id: bulkRow.id, p_kg: Math.abs(bulkDeltaKg),
                p_operation: 'correction', p_ref_table: 'packing_records', p_ref_id: record.id,
                p_reason: `${currentQty} → ${newQty} bags`, p_user: (currentUser && currentUser.name) || null
            });
            if (bulkErr) console.error(`${rpcName} RPC failed:`, bulkErr);
        }

        await saveData('packing_records', {
            date: new Date().toISOString().split('T')[0],
            pack_date: new Date().toISOString().split('T')[0],
            source_type: record.source_type,
            source_id: record.source_id,
            coffee_name: record.coffee_name,
            machine_id: record.machine_id,
            bag_size_g: record.bag_size_g,
            size_g: record.bag_size_g,
            quantity: delta,
            status: 'Correction',
            packed_coffee_lot_id: lot.id,
            notes: `Correction of record #${record.id} (${lot.lot_code}): ${currentQty} → ${newQty} bags`
        });

        document.getElementById('btn-close-modal').click();
        await showWarningModal('Correction saved.', false, null, null, 'success');
        loadPackingRecordsTable();
        loadPackedCoffeeSection();
        loadPackingSection();
        scheduleDashboardRefresh();
    });
}

// === Export: Packing Records ===
document.getElementById('btn-export-packing-records').addEventListener('click', () => {
    openExportPackingRecordsModal();
});

async function openExportPackingRecordsModal() {
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = today.substring(0, 8) + '01';
    const html = `
        <form id="modal-export-packing-records-form">
            <div style="margin-bottom: 16px; color: var(--text-secondary); font-size: 0.9rem;">
                Select the date range for the packing records you want to export.
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">From Date</label>
                    <input type="date" id="m-export-pack-from" class="form-control" value="${firstOfMonth}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">To Date</label>
                    <input type="date" id="m-export-pack-to" class="form-control" value="${today}" required>
                </div>
            </div>
            <div id="export-pack-preview-count" style="margin-bottom: 16px; font-size: 0.85rem; color: var(--text-muted); font-style: italic;"></div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Export
                </button>
            </div>
        </form>
    `;
    openModal('Export Packing Records', html, '450px');

    const fromEl = document.getElementById('m-export-pack-from');
    const toEl = document.getElementById('m-export-pack-to');
    const previewEl = document.getElementById('export-pack-preview-count');
    const { data: records } = await fetchData('packing_records');

    const updatePreview = () => {
        const from = fromEl.value;
        const to = toEl.value;
        if (!from || !to) { previewEl.textContent = ''; return; }
        const count = (records || []).filter(r => r.date >= from && r.date <= to).length;
        previewEl.textContent = `${count} record(s) found in selected range.`;
    };
    fromEl.addEventListener('change', updatePreview);
    toEl.addEventListener('change', updatePreview);
    updatePreview();

    document.getElementById('modal-export-packing-records-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fromDate = fromEl.value;
        const toDate = toEl.value;
        if (fromDate > toDate) { alert('From Date must be before or equal to To Date.'); return; }

        const filtered = (records || [])
            .filter(r => r.date >= fromDate && r.date <= toDate)
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        if (filtered.length === 0) {
            await showWarningModal('No packing records found in the selected date range.', false);
            return;
        }

        const rows = filtered.map(r => ({
            'Date': r.date || '-',
            'Coffee Name': r.coffee_name || '-',
            'Machine': r.machine_name || '-',
            'Size': r.size_label || '-',
            'Quantity': r.quantity || 0
        }));
        exportToExcel(rows, `Packing_Records_${fromDate}_to_${toDate}`);
        document.getElementById('btn-close-modal').click();
    });
}

async function loadPackingRequestsSection() {
    const [
        { data: orders },
        { data: orderItems },
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: customers },
        { data: codeDefinitions },
        { data: dispatchLotItemsForCards }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('customers'),
        fetchData('code_definitions'),
        fetchData('dispatch_lot_items')
    ]);

    // Pcs per order line that left through a PACKING checkout — the same
    // rule openDispatchCheckoutModal's packingOutQty/orderMode use, so the
    // card and the modal never disagree about whether an order is "partially
    // dispatched". Approval-time deductions don't write this table.
    const packingOutByItem = new Map();
    (dispatchLotItemsForCards || []).forEach(d => {
        packingOutByItem.set(d.request_order_item_id, (packingOutByItem.get(d.request_order_item_id) || 0) + (parseInt(d.qty) || 0));
    });

    const container = document.getElementById('packing-requests-cards');
    const emptyEl = document.getElementById('packing-requests-empty');
    if (!container) return;
    container.innerHTML = '';

    // Filter only orders in "Preparing" status
    const preparingOrders = (orders || []).filter(o => o.status === 'Preparing');

    if (preparingOrders.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    // Sort by order_date descending
    preparingOrders.sort((a, b) => new Date(b.order_date) - new Date(a.order_date) || b.id - a.id);
    const limitedPreparingOrders = preparingOrders.slice(0, 50);

    // CHECKOUT_AUTOFILL_PLAN.md §4/§8/§9 — a line is "done" once nothing more
    // will ever be prepared for it: either it's genuinely fully packed, OR
    // an earlier Checkout finalized its shortfall as unfulfilled (Pilihan 1).
    // Without accounting for quantity_unfulfilled here, a Pilihan-1-finalized
    // order would keep showing "Prepare" forever with no way to reach
    // Dispatch, even though every line's item_status is already
    // 'Ready for Handover' — this is what makes "order keluar dari daftar
    // packing lewat jalur yang sudah ada" (the plan's own §4 point 4 and §9)
    // literally true, using the EXISTING Dispatch/dispatchOrder() flow.
    const isLineDone = (i) => {
        const req = parseInt(i.quantity_requested) || 0;
        const prep = parseInt(i.quantity_prepared) || 0;
        const unful = parseInt(i.quantity_unfulfilled) || 0;
        return (prep + unful) >= req;
    };

    // V2 1G: cards instead of a table row per order — per-line "Ready"
    // inputs are gone, replaced by the "Prepare" button opening the POS
    // checkout modal (openDispatchCheckoutModal) where fulfillment happens
    // by scan or manual lot pick. A card still shows Dispatch directly when
    // every line is already fully prepared (nothing left to check out).
    let cardsHtml = '';
    for (const order of limitedPreparingOrders) {
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);

        const allDone = items.length > 0 && items.every(isLineDone);
        const totalRequested = items.reduce((s, i) => s + (parseInt(i.quantity_requested) || 0), 0);
        const totalPrepared = items.reduce((s, i) => s + (parseInt(i.quantity_prepared) || 0), 0);
        // "Partially dispatched" — an order that has been checked out FROM
        // PACKING at least once but still has a line to fill. Same rule as the
        // modal's orderMode (user decision 2026-09-16): stock deducted at
        // approval alone doesn't count, otherwise nearly every approved order
        // would wear this status (68 of 94 recent lines were fully covered at
        // approval with no packing checkout at all).
        const totalPackingOut = items.reduce((s, i) => s + (packingOutByItem.get(i.id) || 0), 0);
        const isPartial = !allDone && totalPackingOut > 0;

        const cust = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null;

        let linesHtml = '';
        for (const item of items) {
            const type = item.coffee_type;
            const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;

            let coffeeName = '';
            if (item.coffee_code) {
                const def = (codeDefinitions || []).find(d => d.code === item.coffee_code);
                coffeeName = def ? `${def.name} (${type})` : `Code ${item.coffee_code}`;
            } else if (type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === coffeeId);
                coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
            } else {
                const r = (recipes || []).find(rec => rec.id === coffeeId);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
            }

            const itemMachine = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;

            const totalRequestedLine = parseInt(item.quantity_requested) || 0;
            const alreadyPrepared = parseInt(item.quantity_prepared) || 0;
            const isCompleted = isLineDone(item);

            if (isPartial) {
                // §8 — item-level view for a still-open, partially-dispatched
                // order: Keluar/Diminta instead of a plain fraction, a
                // shortfall note, and a Dispatched badge on any line that has
                // stock out at all — never on a line that's untouched.
                const shortfall = Math.max(0, totalRequestedLine - alreadyPrepared);
                linesHtml += `
                    <div>
                        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 0.82rem;">
                            <span style="font-weight: 600;">${coffeeName}${(packingOutByItem.get(item.id) || 0) > 0 ? `<span class="dc-card-badge-dispatched" data-i18n="card_badge_dispatched">${window.t ? window.t('card_badge_dispatched') : 'Dispatched'}</span>` : ''}</span>
                            <span style="font-weight: 600; color: ${shortfall > 0 ? 'var(--danger)' : 'var(--success)'}; white-space: nowrap; flex-shrink: 0; text-align:right;">${alreadyPrepared} / ${totalRequestedLine}${shortfall > 0 ? `<span style="display:block; font-size:0.68rem; font-weight:500; color:var(--text-muted);">kurang ${shortfall}</span>` : ''}</span>
                        </div>
                        <div style="color: var(--text-muted); font-size: 0.76rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.bag_size_g}g${itemMachine ? ', ' + itemMachine.name : ''}</div>
                    </div>
                `;
            } else {
                // Dispatched badge shown here too, not just in the isPartial
                // branch above — a fully-done order's card used this plain
                // layout and never got the badge at all, even though its
                // lines have stock out just as genuinely (found in review
                // after 7af6953: "user meminta badge untuk item yang keluar
                // sebagian maupun penuh").
                linesHtml += `
                    <div>
                        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 0.82rem;">
                            <span style="font-weight: 600;">${coffeeName}${(packingOutByItem.get(item.id) || 0) > 0 ? `<span class="dc-card-badge-dispatched" data-i18n="card_badge_dispatched">${window.t ? window.t('card_badge_dispatched') : 'Dispatched'}</span>` : ''}</span>
                            <span style="font-weight: 600; color: ${isCompleted ? 'var(--success)' : 'var(--danger)'}; white-space: nowrap; flex-shrink: 0;">${alreadyPrepared} / ${totalRequestedLine}</span>
                        </div>
                        <div style="color: var(--text-muted); font-size: 0.76rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.bag_size_g}g${itemMachine ? ', ' + itemMachine.name : ''}</div>
                    </div>
                `;
            }
        }

        // A fully-ready order used to only show Dispatch, with no way back
        // into the checkout modal to correct a wrong fulfillment (found
        // 2026-07-27: an order auto-marked "Ready" from stale packed stock
        // at approval had no path to reopen and fix it). Edit reopens the
        // same checkout modal regardless of ready state.
        const actionBtnHtml = allDone
            ? `<button class="btn btn-secondary btn-sm btn-edit-ready-order" data-order="${order.id}" style="flex: 0 0 auto; padding-left: 14px; padding-right: 14px;" title="Edit / correct fulfillment" ${hasPermission('packing_dispatch_checkout') ? '' : 'disabled title="No permission to edit orders"'}>Edit</button><button class="btn btn-success btn-sm btn-dispatch-order" data-order="${order.id}" style="flex: 1; font-weight: 700;">Dispatch</button>`
            : `<button class="btn btn-primary btn-sm btn-prepare-order" data-order="${order.id}" style="flex: 1; font-weight: 700;" ${hasPermission('packing_dispatch_checkout') ? '' : 'disabled title="No permission to checkout orders"'}>${isPartial ? (window.t ? window.t('btn_continue_packing') : 'Continue') : 'Prepare'}</button>`;

        const statusBadgeHtml = isPartial
            ? `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 4px; background: rgba(239,68,68,0.12); color: var(--danger); font-weight: 600; white-space: nowrap;">${window.t ? window.t('status_partially_dispatched') : 'Partially Dispatched'}</span>`
            : `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 4px; background: rgba(217,119,6,0.12); color: #d97706; font-weight: 600; white-space: nowrap;">Preparing</span>`;

        // §8 — a summary strip with a progress bar, shown only for a still-
        // open partially-dispatched order. This is the one number ops staff
        // keep having to hunt for today (how much of THIS order already left
        // the shelf) — see CHECKOUT_AUTOFILL_PLAN.md §8.
        const outStripHtml = isPartial
            ? `<div class="dc-card-out-strip">
                    <b>${totalPrepared}</b> dari <b>${totalRequested}</b> pcs sudah keluar dari stok &middot; sisa <b>${Math.max(0, totalRequested - totalPrepared)}</b> pcs
                    <div class="dc-card-bar"><i style="width:${totalRequested > 0 ? Math.min(100, Math.round((totalPrepared / totalRequested) * 100)) : 0}%;"></i></div>
               </div>`
            : '';

        cardsHtml += `
            <div class="card" style="padding: 16px 18px; margin: 0; ${isPartial ? 'border-color: rgba(239,68,68,0.35);' : ''}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                    <div>
                        <div style="font-weight: 600; font-size: 0.95rem;"><code>${order.order_number || '#ORD-' + order.id}</code></div>
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">${order.sales_name}${cust ? ` &middot; ${cust.name}` : ''}</div>
                    </div>
                    ${statusBadgeHtml}
                </div>
                ${outStripHtml}
                <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; ${isPartial ? 'margin-top: 12px;' : ''}">
                    ${linesHtml}
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary btn-sm btn-print-order" data-id="${order.id}" style="flex: 1;">Print</button>
                    ${actionBtnHtml}
                </div>
                <div style="display: flex; gap: 8px; margin-top: 8px;">
                    <button class="btn btn-sm btn-stop-order" data-order="${order.id}" style="flex: 1; background: transparent; border: 1px solid rgba(239,68,68,0.45); color: var(--danger);" ${hasPermission('packing_dispatch_checkout') ? '' : 'disabled title="No permission to stop orders"'} data-i18n="btn_unable_to_fulfill">Unable to Fulfill</button>
                </div>
            </div>
        `;
    }
    container.innerHTML = cardsHtml;

    // Scoped once per render, alongside the cards it styles — cheap for a
    // handful of ops-facing cards, and keeps the badge/strip styling right
    // next to the markup that uses it instead of a separate global rule.
    if (!container.querySelector('#dc-card-partial-style')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'dc-card-partial-style';
        styleEl.textContent = `
            .dc-card-badge-dispatched { display:inline-block; font-size:0.6rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--danger); background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.32); border-radius:4px; padding:1px 6px; margin-left:6px; vertical-align:1px; }
            .dc-card-out-strip { border:1px solid rgba(239,68,68,0.28); background:rgba(239,68,68,0.07); border-radius:6px; padding:8px 10px; font-size:0.74rem; color:var(--text-secondary); }
            .dc-card-out-strip b { color:var(--text-primary); font-variant-numeric:tabular-nums; }
            .dc-card-bar { height:4px; border-radius:999px; background:rgba(127,127,127,0.18); margin-top:7px; overflow:hidden; }
            .dc-card-bar > i { display:block; height:100%; background:var(--danger); border-radius:999px; }
        `;
        container.appendChild(styleEl);
    }

    // EVENT DELEGATION
    container.onclick = async function(e) {
        // Handle Prepare/Lanjutkan button — opens the POS checkout modal
        const btnPrepare = e.target.closest('.btn-prepare-order');
        if (btnPrepare) {
            const orderId = parseInt(btnPrepare.getAttribute('data-order'));
            await openDispatchCheckoutModal(orderId);
            return;
        }

        // Handle Edit button on an already-fully-ready order — same modal,
        // so a wrong fulfillment can still be corrected (see actionBtnHtml).
        const btnEditReady = e.target.closest('.btn-edit-ready-order');
        if (btnEditReady) {
            const orderId = parseInt(btnEditReady.getAttribute('data-order'));
            await openDispatchCheckoutModal(orderId);
            return;
        }

        // Handle Dispatch button
        const btnDispatch = e.target.closest('.btn-dispatch-order');
        if (btnDispatch) {
            const orderId = parseInt(btnDispatch.getAttribute('data-order'));
            if (!await showWarningModal('Dispatch this order? This confirms the sales team has picked up the packed items.')) return;
            await dispatchOrder(orderId);
            return;
        }

        // Handle Print Order button
        const btnPrint = e.target.closest('.btn-print-order');
        if (btnPrint) {
            const orderId = parseInt(btnPrint.getAttribute('data-id'));
            await printOrderDetail(orderId);
        }

        // APPROVAL_REVISION_PLAN.md Fase 6 — Unable to Fulfill from packing
        // (§3.9/§3.11: packing decides on its own, second action row).
        const btnStop = e.target.closest('.btn-stop-order');
        if (btnStop) {
            const orderId = parseInt(btnStop.getAttribute('data-order'));
            await openStopOrderDialog(orderId);
        }
    };
}

// ==========================================================================
// APPROVAL_REVISION_PLAN.md Fase 6 — UNABLE TO FULFILL FROM PACKING
// ==========================================================================
// Standalone from openDispatchCheckoutModal's resetCommittedItem on purpose:
// this runs from the Order Requests card, not from inside that modal's
// closure, and always unwinds the FULL committed amount for every item of
// the order at once — not a partial, operator-typed undo. §5.3.

// Gathers everything that would need to be reversed for one order, without
// writing anything yet — used both to render the confirmation dialog and,
// on confirm, to drive the actual refund/delete calls, so the numbers shown
// to the operator are exactly the numbers acted on (same reasoning as
// committedQtyBreakdown being shared between display and reset in
// resetCommittedItem above).
async function buildOrderUnwindBreakdown(orderId) {
    const [{ data: orders }, { data: itemsAll }] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items')
    ]);
    const order = (orders || []).find(o => o.id === orderId);
    if (!order) return null;
    const orderItems = (itemsAll || []).filter(i => i.request_order_id === orderId);
    const itemIds = orderItems.map(i => i.id);

    const [movementsRes, bulkResRes, dispatchLotItemsRes] = await Promise.all([
        itemIds.length
            ? window.supabaseClient.from('packed_stock_movements').select('id, packed_coffee_lot_id, delta_pcs, ref_id').eq('ref_table', 'request_order_items').in('ref_id', itemIds)
            : Promise.resolve({ data: [] }),
        itemIds.length
            ? window.supabaseClient.from('bulk_reservations').select('id, kg, request_order_item_id').in('request_order_item_id', itemIds)
            : Promise.resolve({ data: [] }),
        itemIds.length
            ? window.supabaseClient.from('dispatch_lot_items').select('id, packed_coffee_lot_id, qty, request_order_item_id').in('request_order_item_id', itemIds)
            : Promise.resolve({ data: [] })
    ]);
    const movements = movementsRes.data || [];
    const bulkReservations = bulkResRes.data || [];
    const dispatchLotItemsForOrder = dispatchLotItemsRes.data || [];

    const { data: packedLots } = await fetchData('packed_coffee_lots');
    const lotById = new Map((packedLots || []).map(l => [l.id, l]));
    function lotLabel(lotId) {
        const l = lotById.get(lotId);
        if (!l) return `Lot #${lotId}`;
        return l.strip_code ? `${l.strip_code} · ${l.lot_code}` : (l.lot_code || `Lot #${lotId}`);
    }

    // Net outstanding per (item, lot) — same shape/logic as
    // committedQtyBreakdown further up this file, just keyed across every
    // item of the order at once instead of one item at a time, since the
    // refund calls below need the real item id as p_ref_id.
    const perItemLotNet = new Map(); // "itemId:lotId" -> net delta
    for (const m of movements) {
        if (!m.packed_coffee_lot_id) continue;
        const key = `${m.ref_id}:${m.packed_coffee_lot_id}`;
        perItemLotNet.set(key, (perItemLotNet.get(key) || 0) + (parseInt(m.delta_pcs) || 0));
    }
    const ledgerCoveredKeys = new Set();
    const refundTasks = []; // { itemId, lotId, qty, label } — the ledger-tracked ones
    for (const [key, net] of perItemLotNet.entries()) {
        const qty = -net;
        if (qty <= 0) continue;
        const [itemIdStr, lotIdStr] = key.split(':');
        const lotId = parseInt(lotIdStr);
        refundTasks.push({ itemId: parseInt(itemIdStr), lotId, qty, label: lotLabel(lotId) });
        ledgerCoveredKeys.add(key);
    }
    // Legacy fallback: a dispatch_lot_items row whose (item, lot) pair has
    // no ledger movement at all (pre-Phase-3 draw — same case
    // committedQtyBreakdown's legacyRows/legacyQty handles).
    for (const d of dispatchLotItemsForOrder) {
        const key = `${d.request_order_item_id}:${d.packed_coffee_lot_id}`;
        if (ledgerCoveredKeys.has(key)) continue;
        const qty = parseInt(d.qty) || 0;
        if (qty <= 0 || !d.packed_coffee_lot_id) continue;
        refundTasks.push({ itemId: d.request_order_item_id, lotId: d.packed_coffee_lot_id, qty, label: lotLabel(d.packed_coffee_lot_id) });
    }

    // Aggregated purely for DISPLAY — two items in the same order can share
    // a lot, and the confirmation dialog shows one number per lot, not one
    // per item.
    const byLotDisplay = new Map();
    for (const t of refundTasks) {
        byLotDisplay.set(t.lotId, { label: t.label, qty: (byLotDisplay.get(t.lotId)?.qty || 0) + t.qty });
    }
    const lotRefundsForDisplay = [...byLotDisplay.values()].sort((a, b) => b.qty - a.qty);
    const totalLotQty = lotRefundsForDisplay.reduce((s, e) => s + e.qty, 0);

    const bulkKg = bulkReservations.reduce((s, r) => s + (parseFloat(r.kg) || 0), 0);

    const [{ data: plans }, { data: batches }, { data: greenbeans }, { data: recipes }] = await Promise.all([
        fetchData('roasting_plans'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes')
    ]);
    const orderPlans = (plans || []).filter(p => order.order_number && p.order_ref === order.order_number);
    function planCoffeeName(p) {
        if (p.coffee_type === 'Single') {
            const g = (greenbeans || []).find(x => x.id === p.single_coffee_id);
            return g ? g.name : 'Single Origin';
        }
        const r = (recipes || []).find(x => x.id === p.blend_recipe_id);
        return r ? r.name : 'Blend Recipe';
    }
    // §5.3 — a plan with a logged batch cannot be cancelled: the coffee
    // already exists as physical bulk stock. A plan with none is a paper
    // plan only and gets deleted, same as deletePlan() elsewhere does for a
    // plan with no batches.
    const plansWithBatch = [];
    const plansWithoutBatch = [];
    for (const p of orderPlans) {
        const hasBatch = (batches || []).some(b => b.roast_plan_id === p.id);
        if (hasBatch) {
            plansWithBatch.push({ id: p.id, date: p.plan_date, name: planCoffeeName(p), kg: parseFloat(p.fulfilled_roasted_kg) || parseFloat(p.target_roasted_kg) || 0 });
        } else {
            plansWithoutBatch.push(p);
        }
    }

    return {
        order, orderItems, itemIds,
        refundTasks, lotRefundsForDisplay, totalLotQty,
        bulkReservationIds: bulkReservations.map(r => r.id), bulkReservationCount: bulkReservations.length, bulkKg,
        dispatchLotItemIdsToDelete: dispatchLotItemsForOrder.map(d => d.id),
        plansWithoutBatch, plansWithBatch,
        hasAnythingToUnwind: refundTasks.length > 0 || bulkReservations.length > 0 || orderPlans.length > 0
    };
}

async function openStopOrderDialog(orderId) {
    if (!hasPermission('packing_dispatch_checkout')) {
        await showWarningModal(window.t ? window.t('alert_stop_order_denied') : "You don't have permission to stop this order.", false);
        return;
    }

    const bd = await buildOrderUnwindBreakdown(orderId);
    if (!bd) return;
    const order = bd.order;

    const lotRows = bd.lotRefundsForDisplay.slice(0, 3)
        .map(e => `<div style="display:flex; justify-content:space-between; gap:12px; padding:6px 0; font-size:0.82rem;"><span style="font-family:monospace;">${e.label}</span><span style="font-variant-numeric:tabular-nums;">+${e.qty} pcs</span></div>`).join('');
    const lotMoreCount = bd.lotRefundsForDisplay.length - 3;
    const lotMoreRow = lotMoreCount > 0
        ? `<div style="display:flex; justify-content:space-between; gap:12px; padding:6px 0; font-size:0.82rem; color:var(--text-muted);"><span>${(window.t ? window.t('lbl_and_n_more_lots') : 'and {count} more').replace('{count}', lotMoreCount)}</span></div>`
        : '';
    const stockSectionHtml = bd.refundTasks.length > 0 ? `
        <div style="border:1px solid var(--border); border-radius:9px; overflow:hidden; margin-top:14px;">
            <div style="padding:9px 13px; font-size:0.7rem; font-weight:800; letter-spacing:0.05em; text-transform:uppercase; color:var(--text-muted); border-bottom:1px solid var(--border);">${(window.t ? window.t('lbl_stock_returned') : 'Stock returned') + ' · ' + bd.totalLotQty + ' pcs'}</div>
            <div style="padding:2px 13px 8px;">${lotRows}${lotMoreRow}</div>
        </div>` : '';

    const bulkSectionHtml = bd.bulkReservationCount > 0 ? `
        <div style="border:1px solid var(--border); border-radius:9px; overflow:hidden; margin-top:10px;">
            <div style="padding:9px 13px; font-size:0.7rem; font-weight:800; letter-spacing:0.05em; text-transform:uppercase; color:var(--text-muted);">${window.t ? window.t('lbl_bulk_released') : 'Bulk reservations released'}</div>
            <div style="padding:0 13px 9px; font-size:0.82rem;">${bd.bulkReservationCount} (${bd.bulkKg.toFixed(1)} kg)</div>
        </div>` : '';

    const plansCancelledHtml = bd.plansWithoutBatch.length > 0 ? `
        <div style="border:1px solid var(--border); border-radius:9px; overflow:hidden; margin-top:10px;">
            <div style="padding:9px 13px; font-size:0.7rem; font-weight:800; letter-spacing:0.05em; text-transform:uppercase; color:var(--text-muted);">${window.t ? window.t('lbl_plans_cancelled') : 'Roasting plans cancelled'}</div>
            <div style="padding:0 13px 9px; font-size:0.82rem;">${bd.plansWithoutBatch.length}</div>
        </div>` : '';

    // §5.3 — the one part of this dialog that's mandatory whenever it
    // applies, not just informative: without it, the bulk this produces has
    // no visible link back to why it exists.
    const stuckBatchHtml = bd.plansWithBatch.map(p => {
        const line = (window.t ? window.t('hint_batch_already_roasted') : 'Plan {date} · {coffee} already roasted {kg} kg. That coffee now exists as bulk stock with no destination order — consider reassigning it to another order before continuing.')
            .replace('{date}', p.date || '').replace('{coffee}', p.name).replace('{kg}', p.kg.toFixed(1));
        return `<div style="margin-top:10px; background:rgba(255,209,102,0.14); border:1px solid rgba(255,209,102,0.42); border-left-width:3px; border-radius:8px; padding:11px 13px;">
                    <div style="font-size:0.8rem; font-weight:800; color:var(--warning);">${window.t ? window.t('lbl_batch_already_roasted_title') : '⚠️ One roasting plan already produced a batch'}</div>
                    <p style="font-size:0.81rem; margin-top:4px; color:var(--text-secondary);">${line}</p>
                </div>`;
    }).join('');

    const nothingHtml = !bd.hasAnythingToUnwind
        ? `<p style="font-size:0.85rem; color:var(--text-muted); margin-top:14px;">${window.t ? window.t('lbl_nothing_to_unwind') : 'No stock, reservations, or roasting plans need to be reversed for this order.'}</p>`
        : '';

    const html = `
        <form id="modal-stop-order-form">
            <p style="font-size:0.86rem; color:var(--text-secondary);">${(window.t ? window.t('hint_stop_order_intro') : 'This order will be stopped and not processed further.').replace('{number}', order.order_number || ('#ORD-' + order.id))}</p>
            ${stockSectionHtml}
            ${bulkSectionHtml}
            ${plansCancelledHtml}
            ${stuckBatchHtml}
            ${nothingHtml}
            <div class="form-group" style="margin-top:16px;">
                <label class="form-label" data-i18n="lbl_decision_reason">Reason (optional)</label>
                <textarea id="stop-order-reason" class="form-control" rows="2"></textarea>
            </div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                <button type="submit" class="btn btn-danger" data-i18n="btn_stop_order">Stop order</button>
            </div>
        </form>
    `;
    openModal((window.t ? window.t('modal_stop_order_title') : 'Unable to Fulfill {number}').replace('{number}', order.order_number || ('#ORD-' + order.id)), html);

    document.getElementById('modal-stop-order-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const reasonEl = document.getElementById('stop-order-reason');
        const reason = reasonEl ? reasonEl.value.trim() : '';
        await stopOrderFromPacking(bd, reason || null);
    });
}

async function stopOrderFromPacking(breakdown, reason) {
    // §7.3 — re-checked here, not just at the dialog-open gate, matching
    // every other decision path in this revision.
    if (!hasPermission('packing_dispatch_checkout')) {
        await showWarningModal(window.t ? window.t('alert_stop_order_denied') : "You don't have permission to stop this order.", false);
        return;
    }
    const { order, orderItems, refundTasks, bulkReservationIds, dispatchLotItemIdsToDelete, plansWithoutBatch } = breakdown;

    // 1) Refund every outstanding lot — §7.6: through the RPC, not a direct
    // UPDATE, so the movement ledger records the refund instead of just the
    // final number changing with no trail.
    for (const t of refundTasks) {
        const { error: refundErr } = await window.supabaseClient.rpc('refund_packed_lot', {
            p_lot_id: t.lotId, p_pcs: t.qty,
            p_operation: 'unable_to_fulfill', p_ref_table: 'request_order_items', p_ref_id: t.itemId,
            p_reason: `Order ${order.order_number || order.id} marked Unable to Fulfill from packing`,
            p_user: (currentUser && currentUser.name) || null
        });
        if (refundErr) console.error('refund_packed_lot RPC failed while stopping order:', refundErr);
    }

    // 2) Drop the dispatch_lot_items trail for this order — it no longer
    // reflects anything real once every unit behind it has been refunded.
    for (const id of dispatchLotItemIdsToDelete) {
        await deleteData('dispatch_lot_items', id);
    }

    // 3) Release bulk reservations. Deleting the row IS the release — it
    // never touched bulk_available in the first place (see the reservation
    // comment in js/sales.js's approveSalesOrder), so there's nothing else
    // to restore.
    for (const id of bulkReservationIds) {
        await deleteData('bulk_reservations', id);
    }

    // 4) Cancel roasting plans that never produced a batch — same as
    // deletePlan() elsewhere in the app for a batch-less plan. Plans WITH a
    // batch are deliberately left untouched (§5.3) — reported in the dialog
    // instead of acted on.
    for (const p of plansWithoutBatch) {
        await deleteData('roasting_plans', p.id);
    }

    // 5) Close the books on the order itself.
    order.status = 'Unable to Fulfill';
    order.decided_by_id = currentUser ? currentUser.id : null;
    order.decided_by_name = currentUser ? currentUser.name : null;
    order.decided_at = new Date().toISOString();
    order.decision_note = reason || null;
    await saveData('request_orders', order);

    for (const item of orderItems) {
        item.quantity_unfulfilled = parseInt(item.quantity_requested) || 0;
        // Everything committed for this item was just refunded above, so
        // these no longer describe anything real either.
        item.quantity_allocated = 0;
        item.quantity_pending = 0;
        item.quantity_prepared = 0;
        item.item_status = 'Pending Approval';
        await saveData('request_order_items', item);
    }

    const modalCloseBtn = document.getElementById('btn-close-modal');
    if (modalCloseBtn) modalCloseBtn.click();

    await loadPackingRequestsSection();
    if (typeof scheduleDashboardRefresh === 'function') scheduleDashboardRefresh();
}

// ==========================================================================
// V2 1G — DISPATCH CHECKOUT (POS-style fulfillment)
// ==========================================================================
// Which checkout modal (if any) is currently open, so the global barcode
// scanner listener (js/roasting.js handleBarcodeScan) can route a
// RMP:PackLot:... scan here instead of falling through to Quick Roast Log.
// Set on open, cleared on close/cancel/successful checkout. See
// database/v2_1g_migration.sql / V2_ROADMAP.md 1G.
window.activeDispatchCheckoutHandler = null;

async function openDispatchCheckoutModal(orderId) {
    const [
        { data: orders },
        { data: orderItemsAll },
        { data: packedGoods },
        { data: packedLots },
        { data: machines },
        { data: greenbeans },
        { data: recipes },
        { data: customers },
        { data: roastBatches },
        { data: codeDefinitions },
        { data: dispatchLotItemsData }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('packed_coffee'),
        fetchData('packed_coffee_lots'),
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('customers'),
        fetchData('roast_batches'),
        fetchData('code_definitions'),
        fetchData('dispatch_lot_items')
    ]);

    const order = (orders || []).find(o => o.id === orderId);
    if (!order) return;
    const items = (orderItemsAll || []).filter(i => i.request_order_id === orderId);
    const cust = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null;
    // Which lot(s) a checkout session in THIS modal drew from — Reset prefers
    // the ledger (packedMovementsAll below) and only falls back to this trail
    // for pre-Phase-3 rows the ledger query can't see (no ref on their row).
    let dispatchLotItemsAll = (dispatchLotItemsData || []).filter(d => items.some(i => i.id === d.request_order_item_id));

    // Every lot by id, drained ones included. lotsByItem below only keeps lots
    // with remaining_pcs > 0 (it drives the pickable rows), but the
    // "already checked out earlier" breakdown has to name lots that an earlier
    // checkout emptied completely — those are exactly the ones missing from
    // that list. Built from the full packed_coffee_lots fetch instead.
    const lotById = new Map((packedLots || []).map(l => [l.id, l]));
    function lotLabel(lotId) {
        const l = lotById.get(lotId);
        if (!l) return `Lot #${lotId}`;
        return l.strip_code ? `${l.strip_code} · ${l.lot_code}` : (l.lot_code || `Lot #${lotId}`);
    }

    // STOCK_LEDGER_PLAN.md Phase 5: packed_stock_movements is the real
    // source of truth for what can be restored — both a checkout draw AND
    // an approval-time deduction (js/sales.js consume_packed_lot) leave a
    // row here, tagged ref_table='request_order_items'. Fetched once for
    // the whole order (not per item, not on every render) and read
    // synchronously by committedQtyBreakdown below.
    let packedMovementsAll = [];
    if (items.length > 0) {
        const { data: pmData, error: pmErr } = await window.supabaseClient
            .from('packed_stock_movements')
            .select('id, packed_coffee_lot_id, delta_pcs, ref_id')
            .eq('ref_table', 'request_order_items')
            .in('ref_id', items.map(i => i.id));
        if (pmErr) console.error('Failed to read packed_stock_movements for reset classification:', pmErr);
        packedMovementsAll = pmData || [];
    }

    // Shared by the display (renderItemLots) and the actual restore
    // (resetCommittedItem) so they can never drift apart. Returns, for one
    // order item: which lots the ledger can restore from (newest movement
    // first, per STOCK_LEDGER_PLAN.md Phase 5), the legacy dispatch_lot_items
    // rows for anything pre-ledger, and whatever's left over that genuinely
    // has no record anywhere (CHECKOUT_AUTOFILL_PLAN.md §5.1).
    function committedQtyBreakdown(itemId) {
        const perLot = new Map();
        for (const m of packedMovementsAll) {
            if (m.ref_id !== itemId || !m.packed_coffee_lot_id) continue;
            const entry = perLot.get(m.packed_coffee_lot_id) || { net: 0, lastId: m.id };
            entry.net += (parseInt(m.delta_pcs) || 0);
            entry.lastId = Math.max(entry.lastId, m.id);
            perLot.set(m.packed_coffee_lot_id, entry);
        }
        const ledgerLots = [...perLot.entries()]
            .map(([lotId, e]) => ({ lotId, outstanding: -e.net, lastId: e.lastId }))
            .filter(e => e.outstanding > 0)
            .sort((a, b) => b.lastId - a.lastId);
        const ledgerQty = ledgerLots.reduce((s, e) => s + e.outstanding, 0);
        const ledgerLotIds = new Set(ledgerLots.map(e => e.lotId));

        const legacyRows = dispatchLotItemsAll
            .filter(d => d.request_order_item_id === itemId && !d._undone && !ledgerLotIds.has(d.packed_coffee_lot_id))
            .sort((a, b) => b.id - a.id);
        const legacyQty = legacyRows.reduce((s, d) => s + (parseInt(d.qty) || 0), 0);

        const prepared = parseInt((items.find(i => i.id === itemId) || {}).quantity_prepared) || 0;
        const untrackedQty = Math.max(0, prepared - ledgerQty - legacyQty);

        return { ledgerLots, ledgerQty, legacyRows, legacyQty, untrackedQty, prepared };
    }

    // Resolve a packed_coffee row's (type, coffeeId) identity — same matching
    // pattern used throughout sales.js/packing.js for coffee+machine lookups.
    function resolvePackedIdentity(p) {
        if (p.roast_batch_id) {
            const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
            if (!batch) return null;
            return { type: batch.coffee_type, coffeeId: batch.coffee_type === 'Single' ? batch.single_coffee_id : batch.blend_recipe_id };
        }
        if (p.custom_coffee_name) {
            const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
            const gb = (greenbeans || []).find(g => g.name === cleanName);
            if (gb) return { type: 'Single', coffeeId: gb.id };
            const rec = (recipes || []).find(r => r.name === cleanName);
            if (rec) return { type: 'Blend', coffeeId: rec.id };
        }
        return null;
    }

    function coffeeLabel(item) {
        if (item.coffee_code) {
            const def = (codeDefinitions || []).find(d => d.code === item.coffee_code);
            return def ? `${def.name} (${item.coffee_type})` : `Code ${item.coffee_code}`;
        }
        if (item.coffee_type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === item.single_coffee_id);
            return gb ? `${gb.name} (Single)` : 'Single Origin';
        }
        const r = (recipes || []).find(rec => rec.id === item.blend_recipe_id);
        return r ? `${r.name} (Blend)` : 'Blend Recipe';
    }

    // Code shown alongside coffeeLabel — the trade code for a coffee_code
    // item, or the specific green_coffee's own code otherwise.
    function itemCode(item) {
        if (item.coffee_code) return item.coffee_code;
        if (item.coffee_type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === item.single_coffee_id);
            return gb ? (gb.code || '-') : '-';
        }
        return '-';
    }

    // For every order line, find ALL packed_coffee_lots for that coffee+size
    // (across every machine, so a machine-mismatch pick is still visible —
    // just flagged, per the "warn instead of block" decision), oldest first.
    // A coffee_code (trade-name) item widens this further: it can draw from
    // ANY origin sharing the code, not one exact single_coffee_id — deciding
    // which origin fulfills a "Fantastica" order is exactly what this modal
    // is for, FIFO-recommended via the existing tag/override UX below.
    const lotsByItem = {};
    items.forEach(item => {
        const itemCoffeeId = item.coffee_type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
        const codeGroupIds = item.coffee_code
            ? (item.coffee_type === 'Single'
                ? (greenbeans || []).filter(g => g.code === item.coffee_code).map(g => g.id)
                : (recipes || []).filter(r => r.code === item.coffee_code).map(r => r.id))
            : null;
        const matchingPacked = (packedGoods || []).filter(p => {
            if (parseInt(p.bag_size_g) !== parseInt(item.bag_size_g)) return false;
            const idn = resolvePackedIdentity(p);
            if (!idn) return false;
            if (codeGroupIds) return idn.type === item.coffee_type && codeGroupIds.includes(idn.coffeeId);
            return idn.type === item.coffee_type && idn.coffeeId === itemCoffeeId;
        });
        const packedIds = new Set(matchingPacked.map(p => p.id));
        const machineByPackedId = new Map(matchingPacked.map(p => [p.id, p.machine_id]));
        // Origin/recipe name+code per packed_coffee_id — the physical green
        // bean (or blend recipe) that lot's sticker was printed for, not the
        // trade name. Needed so the Lot dropdown/Cart can tell two same-code
        // origins/recipes apart.
        const originByPackedId = new Map(matchingPacked.map(p => {
            const idn = resolvePackedIdentity(p);
            let identity = null;
            if (idn && idn.type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === idn.coffeeId);
                identity = gb ? { name: gb.name, code: gb.code || '' } : null;
            } else if (idn && idn.type === 'Blend') {
                const r = (recipes || []).find(rec => rec.id === idn.coffeeId);
                identity = r ? { name: r.name, code: r.code || '' } : null;
            }
            return [p.id, identity || { name: 'Unknown', code: '' }];
        }));
        // Deliberately NOT filtered to remaining_pcs > 0 here — see §6.2 of
        // CHECKOUT_AUTOFILL_PLAN.md. This array is built once when the modal
        // opens and is the only place a lot's metadata (code, date, machine,
        // origin) exists for this session, so a lot excluded now can never
        // come back, even after its stock does. Emptiness is decided per
        // render from liveRemaining instead (see visibleLots below), which is
        // the value Take/Cancel/Autofill/Reset actually move.
        const lots = (packedLots || [])
            .filter(l => packedIds.has(l.packed_coffee_id))
            .map(l => ({
                id: l.id,
                lotCode: l.lot_code,
                stripCode: l.strip_code,
                packedDate: l.packed_date,
                remaining: parseInt(l.remaining_pcs) || 0,
                machineId: machineByPackedId.get(l.packed_coffee_id) || null,
                originName: (originByPackedId.get(l.packed_coffee_id) || {}).name || 'Unknown',
                originCode: (originByPackedId.get(l.packed_coffee_id) || {}).code || ''
            }))
            .sort((a, b) => new Date(a.packedDate) - new Date(b.packedDate) || a.id - b.id);
        lotsByItem[item.id] = lots;
    });

    // Live per-lot remaining stock for this checkout session — decremented as
    // cart rows are added and incremented back by Cancel/Autofill-undo and by
    // a successful Reset, so a second add/reset sees what earlier ones
    // already did, without needing another DB round-trip. CHECKOUT_AUTOFILL_
    // PLAN.md §6.1: every stock change in this modal MUST update this map —
    // it, not a fresh fetch, is what the STOCK column reads.
    const liveRemaining = {};
    Object.values(lotsByItem).flat().forEach(l => { liveRemaining[l.id] = l.remaining; });

    // Cart rows keyed by "orderItemId:lotId" — scanning/adding the same
    // coffee+lot+size again increments the existing row. Nothing in `cart`
    // has touched the database yet.
    const cart = new Map();

    const machineName = (id) => { const m = (machines || []).find(mm => mm.id === id); return m ? m.name : 'Unknown'; };
    const fifoLotForItemMachine = (itemId) => {
        const item = items.find(i => i.id === itemId);
        // Only recommend a lot that still has live stock — otherwise a
        // fully-taken lot (liveRemaining 0, not yet persisted since Checkout
        // hasn't been clicked) keeps winning "oldest" and triggers the FIFO
        // warning against itself, contradicting its own "0 left" message.
        const available = (lotsByItem[itemId] || []).filter(l => (liveRemaining[l.id] || 0) > 0);
        // The oldest lot on the machine Sales Request asked for — for every
        // line, trade-name ones included (user decision 2026-09-17: packing
        // fills from the requested machine first, and only reaches other
        // machines when the operator agrees). A line with no machine at all
        // has nothing to match, so the oldest lot anywhere is the pick.
        if (!item.machine_id) return available[0] || null;
        return available.find(l => l.machineId === item.machine_id) || null;
    };
    const alreadyInCartForItem = (itemId) => {
        let sum = 0;
        cart.forEach(row => { if (row.orderItemId === itemId) sum += row.qty; });
        return sum;
    };

    // ------------------------------------------------------------------
    // CHECKOUT_AUTOFILL_PLAN.md — shared item-state helpers. One formula,
    // used everywhere in this modal, so "how much does this line still
    // need" can never drift between the header row, the two-panel split,
    // and the checkout dialog.
    // ------------------------------------------------------------------
    const itemRequested = (item) => parseInt(item.quantity_requested) || 0;
    const itemPreparedQty = (item) => parseInt(item.quantity_prepared) || 0;
    const itemUnfulfilledQty = (item) => parseInt(item.quantity_unfulfilled) || 0;
    // §5.3 fix (found live 2026-09-16 testing 7af6953): quantity_unfulfilled
    // isn't only written by this modal's own Pilihan 1 — the LEADER can also
    // write it at approval time via a partial fulfillment (a leader approving
    // 3 of 10 bags). The two are indistinguishable from the column alone, so
    // "how much this line is actually still asked to deliver" is
    // requested MINUS whatever's been excused, not requested outright.
    // Every other measure in this modal derives from that one target now —
    // there is no second formula anywhere else to keep in sync with this one.
    const itemTarget = (item) => Math.max(0, itemRequested(item) - itemUnfulfilledQty(item));
    const itemShortfall = (item) => Math.max(0, itemTarget(item) - itemPreparedQty(item));
    // A line with nothing left to pick, full stop — closed is just
    // "shortfall is zero" under the definition above. No separate check on
    // item_status or quantity_unfulfilled: either of those already shows up
    // as zero shortfall once itemTarget accounts for them.
    const itemIsClosed = (item) => itemShortfall(item) <= 0;
    // STOCK column = what this line can actually be filled from without a
    // judgement call: the requested machine's lots (every lot only when the
    // line has no machine). That is exactly the pool Autofill draws from first
    // (fifoLotForItemMachine), so the number the operator reads and the
    // number Autofill can deliver are the same number. Summing every machine
    // here (as this used to) could show stock that Autofill then refuses to
    // take, with no hint why. Other-machine stock is still counted, just
    // shown separately (stockLabelHtml) — it can still be Taken manually,
    // behind the existing mismatch warning.
    const lotUsableForItem = (item, lot) => !item.machine_id || lot.machineId === item.machine_id;
    const stockForItem = (itemId) => {
        const item = items.find(i => i.id === itemId);
        return (lotsByItem[itemId] || []).filter(l => lotUsableForItem(item, l)).reduce((s, l) => s + (liveRemaining[l.id] || 0), 0);
    };
    const otherMachineStockForItem = (itemId) => {
        const item = items.find(i => i.id === itemId);
        return (lotsByItem[itemId] || []).filter(l => !lotUsableForItem(item, l)).reduce((s, l) => s + (liveRemaining[l.id] || 0), 0);
    };
    const stockLabelHtml = (itemId) => {
        const other = otherMachineStockForItem(itemId);
        return `${stockForItem(itemId)}${other > 0 ? `<span class="dc-stock-other" title="${other} pcs on another machine — can still be taken manually">+${other}</span>` : ''}`;
    };

    // How much of a line left stock through a PACKING checkout, as opposed to
    // being deducted at approval. Only a packing checkout writes
    // dispatch_lot_items (approval's consume_packed_lot never does), so that
    // table is the clean way to tell the two apart. Right-pane Reset
    // decrements these rows (syncDispatchLotItems) and marks drained ones
    // _undone, so this stays accurate within a session too.
    const packingOutQty = (itemId) => dispatchLotItemsAll
        .filter(d => d.request_order_item_id === itemId && !d._undone)
        .reduce((s, d) => s + (parseInt(d.qty) || 0), 0);
    const approvalOutQty = (item) => Math.max(0, itemPreparedQty(item) - packingOutQty(item.id));

    // Two-panel ("continuing") mode only for an order that has actually been
    // checked out partially FROM PACKING — user decision 2026-09-16
    // (CHECKOUT_AUTOFILL_PLAN.md §1 decision 6), applied literally.
    //
    // It used to also trigger on approval-time deductions. Measured on
    // production 2026-09-16: 68 of 94 recent order lines were covered in full
    // at approval and never went through a packing checkout at all, so that
    // rule opened almost every approved order in two panels and the
    // single-column view in the mockup was practically never seen. Stock
    // deducted at approval is still shown in the single-column view — see
    // approvalNoteHtml and the lot list in renderItemLots — because those
    // bags still have to be physically picked.
    const orderMode = () => (items.some(i => packingOutQty(i.id) > 0) ? 'continuing' : 'fresh');

    const RESET_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/></svg>';

    // Header + expandable lot list for one order line. `showMachine` drops
    // the Machine column in the two-panel left pane (mockup: 4 columns
    // there, 5 in the single-panel view) to make room for the action button
    // without the row getting cramped.
    function itemRowHtml(item, showMachine) {
        const requested = itemRequested(item);
        const prepared = itemPreparedQty(item);
        const shortfall = itemShortfall(item);
        const cartQty = alreadyInCartForItem(item.id);
        const stock = stockForItem(item.id);
        const remainingToFill = Math.max(0, shortfall - cartQty);
        const isShort = stock < remainingToFill;
        // "Dispatched" = left through a packing checkout (user: "item yang
        // sudah keluar/checkout"), the same rule orderMode uses.
        const showDispatchedBadge = packingOutQty(item.id) > 0;
        const approvalQty = orderMode() === 'fresh' ? approvalOutQty(item) : 0;
        // Enabled whenever ANY machine has stock: with none on the requested
        // machine, Autofill still has something to offer — the "use other
        // machines?" question.
        const hasFifoLot = stockForItem(item.id) + otherMachineStockForItem(item.id) > 0;

        let actionHtml;
        if (cartQty > 0) {
            actionHtml = `<button type="button" class="btn dc-icon-btn dc-row-reset" data-item="${item.id}" title="Kosongkan baris ini">${RESET_ICON_SVG}</button>`;
        } else {
            actionHtml = `<button type="button" class="btn btn-primary btn-sm dc-row-autofill" data-item="${item.id}" ${(remainingToFill <= 0 || !hasFifoLot) ? 'disabled' : ''}>Autofill</button>`;
        }

        // A <button> for the row (as this used to be) can't contain the
        // Autofill/Reset <button> next to it — the HTML parser closes the
        // outer button at the first nested one, so the inner button ends up
        // as a stray sibling BELOW the row instead of inside it (found live
        // testing 7af6953: clicking the row's own Autofill did nothing —
        // that click landed on the row toggle, not the button, because the
        // real button had already been ejected outside it by the parser).
        // A plain div with role="button" avoids the nesting rule entirely;
        // Enter/Space are wired in the keydown handler below to keep it
        // keyboard-operable.
        return `
            <div role="button" tabindex="0" class="dc-item-row${showMachine ? '' : ' dc-item-row-compact'}" data-item="${item.id}" aria-expanded="false" aria-controls="dc-lots-${item.id}">
                <span class="dc-item-name">
                    <span class="dc-chev">&#9656;</span>
                    ${itemCode(item) !== '-' ? `<span class="dc-code">${itemCode(item)}</span>` : ''}
                    <span class="dc-title">${coffeeLabel(item)}</span>
                    <span class="dc-size">${item.bag_size_g}g</span>
                    ${showDispatchedBadge ? '<span class="dc-badge-dispatched">Dispatched</span>' : ''}
                    ${approvalQty > 0 ? `<span class="dc-approval-note" title="Deducted from stock at approval — still to be picked from the lots listed when this row is opened">+${approvalQty} from approval</span>` : ''}
                </span>
                ${showMachine ? `<span class="dc-mach">${item.coffee_code ? '-' : machineName(item.machine_id)}</span>` : ''}
                <span class="dc-stock" id="dc-stock-${item.id}" style="${isShort ? 'color: var(--warning, #d97706);' : ''}">${stockLabelHtml(item.id)}</span>
                <span class="dc-ready" id="dc-ready-${item.id}" style="color: ${cartQty >= shortfall ? 'var(--success)' : 'var(--danger)'};">${cartQty} / ${shortfall}</span>
                <span class="dc-act" id="dc-act-${item.id}">${actionHtml}</span>
            </div>
            <div id="dc-lots-${item.id}" class="dc-lots hidden"></div>
        `;
    }

    // Rebuilds ONE item's lot list from current cart/liveRemaining state —
    // called after every Take/Cancel/Autofill/qty edit so a Take that spills
    // across several lots (addCartEntry's existing FIFO-spill logic,
    // unchanged) shows correctly without hand-patching individual rows. The
    // "already checked out earlier" breakdown that used to live here moved
    // to the right-hand pane (renderRightPane) — this list is cart-only now.
    function renderItemLots(itemId) {
        const item = items.find(i => i.id === itemId);
        const lots = lotsByItem[itemId] || [];
        const requested = itemRequested(item);
        const prepared = itemPreparedQty(item);
        const shortfall = itemShortfall(item);

        // Stock already deducted for this line at approval, with the lots it
        // came from — shown in the single-column view only, where there's no
        // right pane to carry it. Those bags are gone from the system count
        // but still sit on the shelf and must be picked; without this list
        // the operator would see "0 / 6" for a 10-bag line and have no way to
        // know which 4 bags to add. In this mode no packing checkout has
        // happened for the order, so every outstanding ledger lot for the
        // item IS the approval deduction.
        let approvalHtml = '';
        const approvalQty = orderMode() === 'fresh' ? approvalOutQty(item) : 0;
        if (approvalQty > 0) {
            const { ledgerLots, untrackedQty } = committedQtyBreakdown(itemId);
            const lotLines = ledgerLots.map(e => `<div><span class="dc-committed-lot-code">${lotLabel(e.lotId)}</span><span class="dc-committed-lot-qty">${e.outstanding} pcs</span></div>`).join('');
            approvalHtml = `
                <div class="dc-approval-block">
                    <div><b>${approvalQty} pcs</b> already deducted at approval — pick these too:</div>
                    <div class="dc-committed-lots">${lotLines}${untrackedQty > 0 ? `<div><span class="dc-committed-lot-code" style="opacity:0.7;">lot not recorded</span><span class="dc-committed-lot-qty">${untrackedQty} pcs</span></div>` : ''}</div>
                </div>`;
        }

        // lotsByItem carries every lot for this coffee/size, empty ones
        // included, but the "is there anything to pick" decision is made
        // against liveRemaining, which Reset/Cancel update. A lot with
        // nothing left still renders while it's held in the cart, otherwise
        // its Cancel button would vanish mid-session.
        const visibleLots = lots.filter(l => (liveRemaining[l.id] || 0) > 0 || cart.has(`${itemId}:${l.id}`));

        const rowsHtml = visibleLots.map(l => {
            const key = `${itemId}:${l.id}`;
            const cartRow = cart.get(key);
            const taken = cartRow ? cartRow.qty : 0;
            const avail = (liveRemaining[l.id] || 0) + taken;
            const mismatch = !!item.machine_id && l.machineId !== item.machine_id;
            const isFifo = (fifoLotForItemMachine(itemId) || {}).id === l.id;
            // No suggested quantity, on any lot — CHECKOUT_AUTOFILL_PLAN.md §1
            // decision 1 ("semua kolom jumlah mulai dari 0"). A number appears
            // only once the operator types one or presses Autofill; Take stays
            // disabled until then (onModalBodyInput enables it on typing).
            // 7af6953 still pre-filled the lots covering the shortfall here,
            // with Take already enabled, which is the accidental-draw risk the
            // decision was made to remove.
            return `
                <div class="dc-lot${mismatch ? ' dc-lot-mismatch' : ''}${taken > 0 ? ' dc-lot-taken' : ''}" data-item="${itemId}" data-lot="${l.id}">
                    <div class="dc-lot-main">
                        <span class="dc-lot-code">${l.stripCode ? `<b>${l.stripCode}</b> &middot; ${l.lotCode}` : l.lotCode}${isFifo ? ' <span class="dc-pill dc-pill-fifo">FIFO</span>' : ''}${mismatch ? ' <span class="dc-pill dc-pill-mismatch">Different machine</span>' : ''}</span>
                        <span class="dc-lot-meta">${l.originName}${l.originCode ? ' (' + l.originCode + ')' : ''} &middot; packed ${l.packedDate || '-'} &middot; ${machineName(l.machineId)}</span>
                    </div>
                    <span class="dc-lot-stock">${avail}</span>
                    <span class="dc-lot-add">
                        <span class="dc-lot-check" ${taken > 0 ? '' : 'hidden'}>&#10003;</span>
                        <input type="number" class="dc-lot-qty" min="1" placeholder="0" value="${taken > 0 ? taken : ''}" ${avail <= 0 && taken === 0 ? 'disabled' : ''}>
                        <button type="button" class="btn btn-primary btn-sm dc-lot-take" ${taken > 0 ? 'hidden' : ''} ${(avail <= 0 || taken === 0) ? 'disabled' : ''}>Take</button>
                        <button type="button" class="btn btn-sm dc-lot-cancel" style="border:1px solid var(--border); background:none; color: var(--danger);" ${taken > 0 ? '' : 'hidden'}>Cancel</button>
                    </span>
                </div>
            `;
        }).join('') || `<div class="dc-lot-empty">No packed stock available for this coffee/size.</div>`;

        const lotsEl = document.getElementById(`dc-lots-${itemId}`);
        if (lotsEl) lotsEl.innerHTML = approvalHtml + rowsHtml;
    }

    function refreshItemRowState(itemId) {
        const item = items.find(i => i.id === itemId);
        if (!item) return;
        const requested = itemRequested(item);
        const prepared = itemPreparedQty(item);
        const shortfall = itemShortfall(item);
        const cartQty = alreadyInCartForItem(itemId);
        const stock = stockForItem(itemId);
        const remainingToFill = Math.max(0, shortfall - cartQty);
        const isShort = stock < remainingToFill;

        const stockEl = document.getElementById(`dc-stock-${itemId}`);
        const readyEl = document.getElementById(`dc-ready-${itemId}`);
        const actEl = document.getElementById(`dc-act-${itemId}`);
        if (stockEl) { stockEl.innerHTML = stockLabelHtml(itemId); stockEl.style.color = isShort ? 'var(--warning, #d97706)' : ''; }
        if (readyEl) { readyEl.textContent = `${cartQty} / ${shortfall}`; readyEl.style.color = cartQty >= shortfall ? 'var(--success)' : 'var(--danger)'; }
        if (actEl) {
            const hasFifoLot = stockForItem(itemId) + otherMachineStockForItem(itemId) > 0;
            actEl.innerHTML = cartQty > 0
                ? `<button type="button" class="btn dc-icon-btn dc-row-reset" data-item="${itemId}" title="Kosongkan baris ini">${RESET_ICON_SVG}</button>`
                : `<button type="button" class="btn btn-primary btn-sm dc-row-autofill" data-item="${itemId}" ${(remainingToFill <= 0 || !hasFifoLot) ? 'disabled' : ''}>Autofill</button>`;
        }
    }

    function renderAllHeaders() {
        items.forEach(item => refreshItemRowState(item.id));

        let totalTaken = 0;
        cart.forEach(row => { totalTaken += row.qty; });
        const totalEl = document.getElementById('dc-total-taken');
        if (totalEl) totalEl.textContent = totalTaken;

        updateCheckoutButtonState();
    }

    function updateCheckoutButtonState() {
        const btn = document.getElementById('dc-btn-checkout');
        if (btn) btn.disabled = cart.size === 0;
    }

    function renderAllOpenLots() {
        items.forEach(item => {
            const lotsEl = document.getElementById(`dc-lots-${item.id}`);
            if (lotsEl && !lotsEl.classList.contains('hidden')) renderItemLots(item.id);
        });
    }

    function renderAll() {
        renderAllOpenLots();
        renderAllHeaders();
    }

    // ------------------------------------------------------------------
    // Right-hand "Sudah keluar" pane — every item on the order (open or
    // closed), Diminta/Keluar/Kurang, with a Reset icon on any row that has
    // stock out (CHECKOUT_AUTOFILL_PLAN.md §5, §8). Only rendered in
    // 'continuing' mode.
    // ------------------------------------------------------------------
    function buildRightPaneHtml() {
        const rows = items.map(item => {
            const requested = itemRequested(item);
            const prepared = itemPreparedQty(item);
            const unfulfilled = itemUnfulfilledQty(item);
            const shortfall = itemShortfall(item);
            const canReset = prepared > 0;
            // A leader's partial approval (or an earlier Pilihan 1) can leave
            // quantity_unfulfilled > 0 while this row still shows a nonzero
            // Kurang against a SMALLER target — e.g. Diminta 10, Keluar 0,
            // Kurang 3, with 7 excused. Without this note that reads like a
            // math error; said explicitly here instead.
            const excusedNote = unfulfilled > 0 ? `<div class="dc-sum-meta">${unfulfilled} tidak terpenuhi</div>` : '';
            return `
                <tr>
                    <td>${coffeeLabel(item)}<div class="dc-sum-meta">${item.bag_size_g}g</div></td>
                    <td>${requested}${excusedNote}</td>
                    <td class="${shortfall === 0 ? 'dc-sum-ok' : ''}">${prepared}</td>
                    <td class="${shortfall > 0 ? 'dc-sum-short' : ''}">${shortfall > 0 ? shortfall : '&mdash;'}</td>
                    <td class="dc-sum-act">${canReset ? `<button type="button" class="btn dc-icon-btn dc-icon-btn-danger dc-committed-reset" data-item="${item.id}" title="Kembalikan ke stok">${RESET_ICON_SVG}</button>` : ''}</td>
                </tr>
            `;
        }).join('');
        const totalRequested = items.reduce((s, i) => s + itemRequested(i), 0);
        const totalPrepared = items.reduce((s, i) => s + itemPreparedQty(i), 0);
        const totalShort = items.reduce((s, i) => s + itemShortfall(i), 0);
        return `
            <div class="dc-pane">
                <div class="dc-pane-head"><span>Sudah keluar</span><span>Order ini</span></div>
                <table class="dc-sum-table">
                    <thead><tr><th>Item</th><th>Diminta</th><th>Keluar</th><th>Kurang</th><th></th></tr></thead>
                    <tbody>${rows}</tbody>
                    <tfoot><tr><td>Total</td><td>${totalRequested}</td><td class="dc-sum-ok">${totalPrepared}</td><td class="${totalShort > 0 ? 'dc-sum-short' : ''}">${totalShort > 0 ? totalShort : '&mdash;'}</td><td></td></tr></tfoot>
                </table>
                <div class="dc-pane-note">Angka di kolom Keluar sudah benar-benar berkurang dari stok. Tombol reset memulangkan seluruh jumlah item itu ke lot asalnya lewat jalur resmi, tercatat di buku besar, lalu item itu kembali ke daftar kiri dengan target penuh.</div>
            </div>
        `;
    }

    function buildLeftPaneHtml(openItems) {
        const totalShort = openItems.reduce((s, i) => s + itemShortfall(i), 0);
        const itemsHtml = openItems.length
            ? openItems.map(item => `<div class="dc-item" id="dc-item-${item.id}">${itemRowHtml(item, false)}</div>`).join('')
            : `<div class="dc-lot-empty">Semua item sudah lengkap — tidak ada yang perlu diambil lagi.</div>`;
        return `
            <div class="dc-pane">
                <div class="dc-pane-head"><span>Masih kurang &middot; ${openItems.length} item</span><span>${totalShort} pcs</span></div>
                <div>${itemsHtml}</div>
            </div>
        `;
    }

    // ------------------------------------------------------------------
    // Top-level render — decides single-panel vs two-panel and rebuilds the
    // whole modal body. Re-invoked after every mutation (cart edit, Autofill,
    // Reset, coming back from the choice dialog) rather than patched in
    // place, so there is exactly one source of truth for what's on screen.
    // Safe to call repeatedly: openModal() only reassigns #modal-body-
    // content's innerHTML, so the ONE delegated listener bound below
    // (outside this function) survives every re-render.
    // ------------------------------------------------------------------
    function render() {
        const mode = orderMode();
        // openModal sets textContent, not innerHTML — an HTML entity here
        // would render as the literal text "&middot;" (found live testing
        // 7af6953). Use the character directly.
        const titleSuffix = mode === 'continuing' ? ' · Continued' : '';
        const orderInfoHtml = `
            <div class="dc-order-info">
                <div>
                    <div class="dc-order-info-value"><code>${order.order_number || '#ORD-' + order.id}</code></div>
                    <div class="dc-order-info-sub">${order.sales_name || '-'}${cust ? ' &middot; ' + cust.name : ''}</div>
                </div>
                <div class="dc-order-info-value">${order.order_date || '-'}</div>
            </div>
        `;

        let bodyHtml;
        if (mode === 'fresh') {
            const itemsListHtml = items.map(item => `<div class="dc-item" id="dc-item-${item.id}">${itemRowHtml(item, true)}</div>`).join('');
            bodyHtml = `
                ${orderInfoHtml}
                <div class="dc-col-head">
                    <span>Coffee</span><span>Machine</span><span class="text-right">Stock</span><span class="text-right">Ready</span><span></span>
                </div>
                <div id="dc-item-list" style="margin-bottom:16px;">${itemsListHtml}</div>
            `;
        } else {
            const openItems = items.filter(i => !itemIsClosed(i));
            bodyHtml = `
                ${orderInfoHtml}
                <div class="dc-split">
                    <div>
                        <div class="dc-col-head dc-col-head-compact">
                            <span>Coffee</span><span class="text-right">Stock</span><span class="text-right">Ready</span><span></span>
                        </div>
                        <div id="dc-item-list">${buildLeftPaneHtml(openItems)}</div>
                    </div>
                    <div>${buildRightPaneHtml()}</div>
                </div>
            `;
        }

        const anyRemaining = items.some(i => !itemIsClosed(i) && itemShortfall(i) - alreadyInCartForItem(i.id) > 0);
        const footMsg = anyRemaining
            ? (mode === 'fresh'
                ? 'Belum ada yang disiapkan. Tekan Autofill di baris yang diinginkan, atau buka daftar lot untuk memilih sendiri.'
                : 'Masih ada item yang kurang. Tekan Checkout untuk memutuskan langkah selanjutnya.')
            : 'Semua baris sudah terisi.';

        const html = `
            <div id="dispatch-checkout-body">
                ${bodyHtml}

                <div style="display:flex; gap:8px; margin-bottom:6px; margin-top:4px;">
                    <input type="text" id="dc-scan-input" class="form-control" placeholder="Scan a package or carton barcode (coming soon)" autocomplete="off" style="flex:1;" disabled>
                </div>
                <p style="font-size:0.78rem; color:var(--text-muted); margin: 0 0 12px;">Scanning isn't wired up yet — pick lots from the list above for now.</p>

                <div class="modal-footer-actions-lg" style="justify-content:space-between;">
                    <span id="dc-foot-msg" style="font-size:0.8rem; color:var(--text-muted); max-width:48ch;">${footMsg}</span>
                    <div style="display:flex; align-items:center; gap:14px;">
                        <span style="font-size:0.82rem; color:var(--text-muted);">Total taken: <strong id="dc-total-taken" style="color:var(--text-primary);">0</strong></span>
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                        <button type="button" id="dc-btn-checkout" class="btn btn-primary" disabled>Checkout</button>
                    </div>
                </div>
            </div>
            <style>${DISPATCH_CHECKOUT_STYLE}</style>
        `;

        openModal(`Checkout — ${order.order_number || '#ORD-' + order.id}${titleSuffix}`, html, mode === 'continuing' ? '980px' : '760px');
        wireCheckoutButton();
        renderAll();
    }

    function wireCheckoutButton() {
        const btnCheckout = document.getElementById('dc-btn-checkout');
        if (!btnCheckout) return;
        btnCheckout.addEventListener('click', onCheckoutClicked);
    }

    // ------------------------------------------------------------------
    // Core shared logic for both scan and manual add. Returns nothing; shows
    // its own alerts/warnings and re-renders on success.
    // ------------------------------------------------------------------
    async function addCartEntry(itemId, lotId, qtyRequested) {
        const item = items.find(i => i.id === itemId);
        if (!item) { alert('That coffee is not on this order.'); return; }

        const shortfall = itemShortfall(item);
        const remainingForLine = shortfall - alreadyInCartForItem(itemId);
        if (remainingForLine <= 0) {
            await showWarningModal(`This line (${coffeeLabel(item)}, ${item.bag_size_g}g) is already fully allocated.`, false);
            return;
        }

        const lots = lotsByItem[itemId] || [];
        const chosenLot = lots.find(l => l.id === lotId);
        if (!chosenLot) { alert('That lot is not available for this coffee/size.'); return; }

        const fifoLot = fifoLotForItemMachine(itemId);
        // Machine check applies to EVERY line that names a machine, trade-name
        // ones included (user decision 2026-09-17). A manual pick from another
        // machine is allowed — it just has to be a deliberate one.
        const machineMismatch = !!item.machine_id && chosenLot.machineId !== item.machine_id;
        const fifoMismatch = !machineMismatch && fifoLot && fifoLot.id !== chosenLot.id;
        if (machineMismatch) {
            const proceed = await showWarningModal(
                `This lot (${chosenLot.lotCode}) was packed on ${machineName(chosenLot.machineId)}, but the sales request asked for ${machineName(item.machine_id)}.\n\nContinue with this machine, or go back and edit?`,
                true, 'Different machine', 'Continue', 'warning', 'Edit'
            );
            if (!proceed) return;
        } else if (fifoMismatch) {
            const proceed = await showWarningModal(
                `An older lot is still in stock: ${fifoLot.lotCode} (packed ${fifoLot.packedDate}, ${liveRemaining[fifoLot.id]} left).\n\nThis is a newer lot (${chosenLot.lotCode}). Use the FIFO recommendation first, unless there's a good reason not to.\n\nProceed with this lot anyway?`,
                true
            );
            if (!proceed) return;
        }

        const cappedQty = Math.min(qtyRequested, remainingForLine);

        // Spill oldest-first within the CHOSEN lot's own machine if it runs
        // short — the machine the operator committed to by picking this lot.
        // Never spills onto a different machine: that would bypass the
        // machine confirmation above.
        const sameMachinePool = lots.filter(l => l.machineId === chosenLot.machineId)
            .sort((a, b) => new Date(a.packedDate) - new Date(b.packedDate) || a.id - b.id);
        const startIdx = sameMachinePool.findIndex(l => l.id === chosenLot.id);
        fillFromLots(item, sameMachinePool.slice(startIdx), cappedQty);

        expandItemLots(itemId);
        renderAll();
    }

    // Puts up to `qty` pcs into the cart for `item`, walking `pool` in the
    // order given and taking from each lot's live remaining stock. Returns
    // how many were actually placed. Cart only — never touches the database.
    function fillFromLots(item, pool, qty) {
        let toDraw = qty;
        for (const l of pool) {
            if (toDraw <= 0) break;
            const avail = liveRemaining[l.id] || 0;
            if (avail <= 0) continue;
            const take = Math.min(avail, toDraw);
            liveRemaining[l.id] = avail - take;
            toDraw -= take;

            const key = `${item.id}:${l.id}`;
            const existing = cart.get(key);
            if (existing) {
                existing.qty += take;
            } else {
                cart.set(key, { orderItemId: item.id, lotId: l.id, lotCode: l.lotCode, machineId: l.machineId, machineName: machineName(l.machineId), sizeG: item.bag_size_g, qty: take, originName: l.originName, originCode: l.originCode });
            }
        }
        return qty - toDraw;
    }

    // Freshly expand an item's lot list if it wasn't already, so the operator
    // immediately sees what Take or Autofill just put in the cart.
    function expandItemLots(itemId) {
        const lotsEl = document.getElementById(`dc-lots-${itemId}`);
        const rowEl = document.getElementById(`dc-item-${itemId}`);
        if (lotsEl && lotsEl.classList.contains('hidden')) {
            lotsEl.classList.remove('hidden');
            const headerBtn = rowEl ? rowEl.querySelector('.dc-item-row') : null;
            if (headerBtn) { headerBtn.setAttribute('aria-expanded', 'true'); rowEl.classList.add('open'); }
        }
    }

    // Autofill (user decision 2026-09-17):
    //   1. Fill FIFO from the machine the sales request asked for.
    //   2. If that machine can't cover the line, ASK whether to take the rest
    //      from other machines. Yes → the rest comes from the other machines'
    //      lots, oldest first across all of them. No → the line stays short.
    // Cart only — nothing is written until Checkout. A line with no machine
    // has no "other" machine, so step 1 simply uses every lot.
    const byPackedDate = (a, b) => new Date(a.packedDate) - new Date(b.packedDate) || a.id - b.id;
    async function autofillItem(itemId) {
        const item = items.find(i => i.id === itemId);
        if (!item) return;
        const remaining = itemShortfall(item) - alreadyInCartForItem(itemId);
        if (remaining <= 0) return;

        const lots = lotsByItem[itemId] || [];
        const ownPool = lots.filter(l => lotUsableForItem(item, l)).sort(byPackedDate);
        const placed = fillFromLots(item, ownPool, remaining);
        const stillShort = remaining - placed;

        if (stillShort > 0 && item.machine_id) {
            const otherPool = lots.filter(l => !lotUsableForItem(item, l)).sort(byPackedDate);
            const otherAvail = otherPool.reduce((s, l) => s + (liveRemaining[l.id] || 0), 0);
            if (otherAvail > 0) {
                // Show what's already in the cart before asking, so the
                // operator can see the partial fill the question is about.
                expandItemLots(itemId);
                renderAll();
                const fromOther = Math.min(stillShort, otherAvail);
                const useOther = await showWarningModal(
                    `${machineName(item.machine_id)} only has ${placed} of the ${remaining} pcs needed for ${coffeeLabel(item)} (${item.bag_size_g}g).\n\n` +
                    `Fill the remaining ${stillShort} pcs from other machines? ${otherAvail} pcs available there` +
                    (fromOther < stillShort ? `, so the line would still be ${stillShort - fromOther} pcs short.` : '.'),
                    true, 'Not enough on requested machine', 'Yes, use other machines', 'warning', 'No, leave it short'
                );
                if (useOther) fillFromLots(item, otherPool, stillShort);
            }
        }

        expandItemLots(itemId);
        renderAll();
    }

    // Empties the cart for one line — never touches the database. Shown as
    // the row action once a line has anything in the cart (§10.6 / mockup
    // screen 5's lighter confirmation, since no stock has moved).
    async function resetCartForItem(itemId) {
        const item = items.find(i => i.id === itemId);
        const qty = alreadyInCartForItem(itemId);
        if (!item || qty <= 0) return;
        const ok = await showWarningModal(
            `Kosongkan ${coffeeLabel(item)}? ${qty} pcs yang sudah diisi akan hilang dari keranjang. Belum ada yang dikeluarkan dari stok.`,
            true
        );
        if (!ok) return;
        for (const [key, row] of [...cart.entries()]) {
            if (row.orderItemId === itemId) {
                liveRemaining[row.lotId] = (liveRemaining[row.lotId] || 0) + row.qty;
                cart.delete(key);
            }
        }
        renderAll();
    }

    // Decrements/deletes this item's dispatch_lot_items rows for one lot so
    // the right pane's numbers stay in sync with a refund made via the
    // ledger path. Loops across rows because multiple checkout sessions can
    // each leave their own row for the same lot.
    async function syncDispatchLotItems(lotId, takeTotal) {
        let left = takeTotal;
        const rows = dispatchLotItemsAll.filter(x => x.packed_coffee_lot_id === lotId && !x._undone);
        for (const d of rows) {
            if (left <= 0) break;
            const dQty = parseInt(d.qty) || 0;
            if (dQty <= 0) continue;
            const t = Math.min(dQty, left);
            const newDQty = dQty - t;
            if (newDQty <= 0) {
                await deleteData('dispatch_lot_items', d.id);
                d.qty = 0;
                d._undone = true;
            } else {
                d.qty = newDQty;
                await saveData('dispatch_lot_items', { id: d.id, qty: newDQty });
            }
            left -= t;
        }
    }

    // ------------------------------------------------------------------
    // Reset (right pane) — CHECKOUT_AUTOFILL_PLAN.md §5. The one place in
    // this modal that ADDS stock back. Always returns the item's FULL
    // committed amount (§1 decision 9) and always reopens the line fully —
    // clearing quantity_unfulfilled too, since reversing a dispatch is
    // exactly what un-does an earlier "leave it short" decision (§4).
    // ------------------------------------------------------------------
    const resettingItems = new Set();
    async function resetCommittedItem(itemId) {
        if (resettingItems.has(itemId)) return; // §10.1 — in-flight guard
        const item = items.find(i => i.id === itemId);
        if (!item) return;
        const prepared = itemPreparedQty(item);
        if (prepared <= 0) return;

        // Guard claimed BEFORE the confirmation dialog, not after (found live
        // testing 7af6953): showWarningModal binds a fresh keydown listener
        // on every call, so two of its dialogs open at once could both be
        // dismissed by one Enter press — and refund_packed_lot has no upper
        // bound (§5.5.2), so a double-fire here would double the refund.
        // Released again below if the operator cancels.
        resettingItems.add(itemId);
        const iconBtn = document.querySelector(`.dc-committed-reset[data-item="${itemId}"]`);
        if (iconBtn) iconBtn.disabled = true;

        const breakdown = committedQtyBreakdown(itemId);
        const lines = [
            ...breakdown.ledgerLots.map(e => `${lotLabel(e.lotId)} — ${e.outstanding} pcs`),
            ...breakdown.legacyRows.map(d => `${lotLabel(d.packed_coffee_lot_id)} — ${parseInt(d.qty) || 0} pcs`)
        ];
        let msg = `Kembalikan ${coffeeLabel(item)} (${item.bag_size_g}g) ke stok?\n\n`;
        if (lines.length) msg += lines.join('\n') + '\n\n';
        if (breakdown.untrackedQty > 0) {
            // §5.5.3 — this part has no lot to send it back to; said here so
            // the operator isn't surprised the number below doesn't fall to 0.
            msg += `${breakdown.untrackedQty} pcs tidak punya catatan lot dan tidak bisa dikembalikan otomatis.\n\n`;
        }
        // Target here is itemTarget, not the raw quantity_requested — a line
        // the leader already partially excused (quantity_unfulfilled from
        // approval) reopens to THAT target, not to the original full order
        // quantity, since Reset never touches quantity_unfulfilled (below).
        msg += `Total akan kembali ke lot asalnya dan tercatat di buku besar. Item ini akan muncul lagi di daftar kiri dengan target penuh (${itemTarget(item)} pcs).`;

        const ok = await showWarningModal(msg, true, 'Reset Stock?', 'Yes, Return to Stock');
        if (!ok) {
            resettingItems.delete(itemId);
            if (iconBtn && document.body.contains(iconBtn)) iconBtn.disabled = false;
            return;
        }

        try {
            let refunded = 0;
            const justRefunded = [];

            // 1) Ledger-tracked draws — covers both a checkout draw and an
            // approval-time deduction, since both leave a row here.
            for (const { lotId, outstanding } of breakdown.ledgerLots) {
                const { data: newBalance, error: refundErr } = await window.supabaseClient.rpc('refund_packed_lot', {
                    p_lot_id: lotId, p_pcs: outstanding,
                    p_operation: 'undo', p_ref_table: 'request_order_items', p_ref_id: itemId,
                    p_reason: `Reset for request_order_items #${itemId}`, p_user: (currentUser && currentUser.name) || null
                });
                // §5.5.1 — refund_packed_lot returns null (no error) when the
                // lot row no longer exists. Treat that as a failed refund,
                // not a silent success.
                if (refundErr || newBalance === null || newBalance === undefined) {
                    console.error('refund_packed_lot failed or lot missing:', lotId, refundErr);
                    continue;
                }
                liveRemaining[lotId] = (liveRemaining[lotId] || 0) + outstanding;
                await syncDispatchLotItems(lotId, outstanding);
                justRefunded.push({ lotId, take: outstanding });
                refunded += outstanding;
            }

            // 2) Legacy fallback for pre-ledger checkout draws.
            for (const d of breakdown.legacyRows) {
                const take = parseInt(d.qty) || 0;
                if (take <= 0 || !d.packed_coffee_lot_id) continue;
                const { data: newBalance, error: refundErr } = await window.supabaseClient.rpc('refund_packed_lot', {
                    p_lot_id: d.packed_coffee_lot_id, p_pcs: take,
                    p_operation: 'undo', p_ref_table: 'request_order_items', p_ref_id: itemId,
                    p_reason: `Reset of dispatch_lot_items #${d.id}`, p_user: (currentUser && currentUser.name) || null
                });
                if (refundErr || newBalance === null || newBalance === undefined) {
                    console.error('refund_packed_lot failed or lot missing:', d.packed_coffee_lot_id, refundErr);
                    continue;
                }
                liveRemaining[d.packed_coffee_lot_id] = (liveRemaining[d.packed_coffee_lot_id] || 0) + take;
                await syncDispatchLotItems(d.packed_coffee_lot_id, take);
                justRefunded.push({ lotId: d.packed_coffee_lot_id, take });
                refunded += take;
            }

            dispatchLotItemsAll = dispatchLotItemsAll.filter(d => !d._undone);
            // committedQtyBreakdown only looks at NET delta per lot, so a
            // synthetic positive-delta row per actual refund keeps this
            // session's own breakdown accurate without a re-fetch (§10.3).
            for (const { lotId, take } of justRefunded) {
                packedMovementsAll.push({ id: Date.now() + Math.random(), packed_coffee_lot_id: lotId, delta_pcs: take, ref_id: itemId });
            }

            // §6.2 — if a refunded lot isn't one this modal already knows
            // about (its metadata was never loaded, e.g. a trade-name item's
            // code group changed after this modal opened), the STOCK column
            // for that lot's item can't be trusted to include it. Reopen the
            // whole modal fresh rather than show an undercounted number.
            const knownLotIds = new Set((lotsByItem[itemId] || []).map(l => l.id));
            const sawUnknownLot = justRefunded.some(r => !knownLotIds.has(r.lotId));

            // §5.3 — written from `refunded` (what actually succeeded), never
            // from the nominal `prepared`. quantity_allocated rides along as
            // min(old, newPrepared): a partial-refund failure always leaves
            // the newest (checkout) draws refunded first per §5.1 point 3, so
            // this never wrongly zeroes out the approval-time portion.
            const newPrepared = Math.max(0, prepared - refunded);
            item.quantity_prepared = newPrepared;
            item.quantity_allocated = Math.min(parseInt(item.quantity_allocated) || 0, newPrepared);
            // §5.3, as written: quantity_unfulfilled is NOT touched by Reset.
            // It can hold a LEADER's decision from a partial approval, and
            // Reset is a stock action, not a fulfillment decision — bringing
            // stock back for a line the leader excused part of must not also
            // erase that exclusion (found live testing 7af6953: it did,
            // silently raising the line's target back to the full order
            // quantity and letting Autofill overdraw past what was approved).
            const unfulfilled = itemUnfulfilledQty(item);
            const requested = itemRequested(item);
            item.item_status = (newPrepared + unfulfilled) >= requested ? 'Ready for Handover' : 'Packing';
            await saveData('request_order_items', item);

            if (sawUnknownLot) {
                await showWarningModal(`Returned ${refunded} pcs for ${coffeeLabel(item)}. Reopening this order to refresh the stock figures.`, false, null, null, 'success');
                window.activeDispatchCheckoutHandler = null;
                document.getElementById('btn-close-modal').click();
                await loadPackingRequestsSection();
                scheduleDashboardRefresh();
                await openDispatchCheckoutModal(order.id);
                return;
            }

            if (refunded < prepared) {
                await showWarningModal(`Only ${refunded} of ${prepared} pcs could be returned automatically — one or more lots no longer exist. The remaining ${prepared - refunded} pcs stay recorded as dispatched.`, false);
            }

            render();
            await loadPackingRequestsSection();
            scheduleDashboardRefresh();
        } finally {
            resettingItems.delete(itemId);
            // Only reached if something threw before the success path's own
            // render() rebuilt this button fresh — re-enable it rather than
            // leave it stuck disabled with no way to retry.
            if (iconBtn && document.body.contains(iconBtn)) iconBtn.disabled = false;
        }
    }

    // ------------------------------------------------------------------
    // Checkout / the two-choice dialog — CHECKOUT_AUTOFILL_PLAN.md §4.
    // ------------------------------------------------------------------
    let checkoutInFlight = false;

    async function onCheckoutClicked() {
        if (checkoutInFlight) return;
        if (cart.size === 0) {
            await showWarningModal('Add at least one lot to the cart before checking out.', false);
            return;
        }

        // Predict, from current DB state + the cart (nothing written yet),
        // which lines would still be short after this checkout — decides
        // whether the choice dialog is needed at all. Through itemShortfall,
        // not a second formula — a line the leader already excused part of
        // via quantity_unfulfilled must not come back here asking for the
        // full original quantity_requested.
        const shortAfter = items
            .map(item => ({ item, short: Math.max(0, itemShortfall(item) - alreadyInCartForItem(item.id)) }))
            .filter(x => x.short > 0 && !itemIsClosed(x.item));

        if (shortAfter.length === 0) {
            checkoutInFlight = true;
            const btn = document.getElementById('dc-btn-checkout');
            if (btn) btn.disabled = true;
            try { await runCheckout(null); }
            finally {
                checkoutInFlight = false;
                // Only reached if runCheckout threw before closing the modal
                // (the success path already closed it) — re-enable rather
                // than leave the button stuck disabled.
                if (btn && document.body.contains(btn)) btn.disabled = false;
            }
            return;
        }

        showChoiceDialog(shortAfter);
    }

    function showChoiceDialog(shortAfter) {
        const totalShort = shortAfter.reduce((s, x) => s + x.short, 0);
        const linesHtml = shortAfter.map(x => `
            <div class="dc-short-line"><span>${coffeeLabel(x.item)} &middot; ${x.item.bag_size_g}g</span><span>kurang <b>${x.short}</b></span></div>
        `).join('');
        const html = `
            <div id="dispatch-checkout-body">
                <div class="dc-choice-dialog">
                    <h4>${shortAfter.length === 1 ? '1 item belum lengkap' : `${shortAfter.length} item belum lengkap`}</h4>
                    <div class="dc-short-list">${linesHtml}</div>
                    <div class="dc-choice-list">
                        <div class="dc-opt dc-opt-primary">
                            <div class="dc-opt-title">Proses apa adanya, order selesai</div>
                            <button type="button" class="btn btn-primary" id="dc-choice-finish">Pilih</button>
                            <div class="dc-opt-desc">Yang sudah disiapkan dikeluarkan sekarang. Kekurangan ${totalShort} pcs dicatat sebagai tidak terpenuhi dan tidak ditunggu lagi. Order ini tidak akan muncul lagi di daftar packing setelah dikirim.</div>
                        </div>
                        <div class="dc-opt">
                            <div class="dc-opt-title">Proses sebagian, order tetap terbuka</div>
                            <button type="button" class="btn btn-secondary" id="dc-choice-continue">Pilih</button>
                            <div class="dc-opt-desc">Yang sudah disiapkan dikeluarkan sekarang, sisanya tetap ditunggu. Order bertahan di daftar packing sampai ${totalShort} pcs itu terpenuhi.</div>
                        </div>
                    </div>
                    <div class="dc-dialog-foot"><button type="button" class="btn btn-secondary" id="dc-choice-back">Kembali</button></div>
                </div>
            </div>
            <style>${DISPATCH_CHECKOUT_STYLE}</style>
        `;
        openModal(`Beberapa Item Belum Lengkap`, html, '560px');

        const finishBtn = document.getElementById('dc-choice-finish');
        const continueBtn = document.getElementById('dc-choice-continue');
        const backBtn = document.getElementById('dc-choice-back');
        backBtn.addEventListener('click', () => render());
        finishBtn.addEventListener('click', async () => {
            if (checkoutInFlight) return;
            checkoutInFlight = true;
            finishBtn.disabled = true; continueBtn.disabled = true; backBtn.disabled = true;
            try { await runCheckout('finish'); }
            finally {
                checkoutInFlight = false;
                if (document.body.contains(finishBtn)) { finishBtn.disabled = false; continueBtn.disabled = false; backBtn.disabled = false; }
            }
        });
        continueBtn.addEventListener('click', async () => {
            if (checkoutInFlight) return;
            checkoutInFlight = true;
            finishBtn.disabled = true; continueBtn.disabled = true; backBtn.disabled = true;
            try { await runCheckout('continue'); }
            finally {
                checkoutInFlight = false;
                if (document.body.contains(finishBtn)) { finishBtn.disabled = false; continueBtn.disabled = false; backBtn.disabled = false; }
            }
        });
    }

    // The actual write path. `choice` is null when nothing was predicted
    // short (ordinary full checkout, unchanged from before this feature),
    // 'finish' for Pilihan 1 (§4), or 'continue' for Pilihan 2 (§4).
    async function runCheckout(choice) {
        // Snapshot and empty the cart before the first deduction, so any
        // second entry into this function finds nothing left to consume
        // rather than drawing the same lots twice (double-submit guard,
        // same shape as cb599a4's fix for the old single-choice Checkout).
        const cartRows = [...cart.values()];
        cart.clear();

        const [{ data: freshItems }, { data: freshLots }] = await Promise.all([
            fetchData('request_order_items'),
            fetchData('packed_coffee_lots')
        ]);

        // Deduct packed_coffee_lots (the per-lot source of truth) via the
        // atomic RPC — clamps and locks in the DB instead of trusting a
        // freshLots snapshot. quantity_prepared below is credited from the
        // pcs ACTUALLY taken (qtyByItem), not the cart's requested amount —
        // if a race clamps a take below what was requested, the order must
        // not be credited for stock it never got.
        const qtyByItem = new Map();
        for (const row of cartRows) {
            const lot = (freshLots || []).find(l => l.id === row.lotId);
            if (!lot) continue;
            const { data: taken, error: consumeErr } = await window.supabaseClient.rpc('consume_packed_lot', {
                p_lot_id: lot.id, p_pcs: row.qty,
                p_operation: 'dispatch', p_ref_table: 'request_order_items', p_ref_id: row.orderItemId,
                p_reason: order && order.order_number ? `Checkout ${order.order_number}` : null,
                p_user: (currentUser && currentUser.name) || null
            });
            if (consumeErr) { console.error('consume_packed_lot RPC failed:', consumeErr); continue; }
            const actualQty = parseInt(taken) || 0;
            if (actualQty <= 0) continue;
            qtyByItem.set(row.orderItemId, (qtyByItem.get(row.orderItemId) || 0) + actualQty);

            await saveData('dispatch_lot_items', {
                request_order_item_id: row.orderItemId,
                packed_coffee_lot_id: row.lotId,
                customer_id: cust ? cust.id : null,
                qty: actualQty
            });
        }

        // Credit each line, decide its status, and — for Pilihan 1 only —
        // finalize any still-short line as unfulfilled. Every line is
        // visited (not just ones this checkout touched), because a line the
        // operator never added anything for can still be short and still
        // needs finalizing under Pilihan 1 (§4 point 1: "setiap baris").
        //
        // No skip for a line that already carries quantity_unfulfilled > 0
        // from before this call (removed after 7af6953's live test) — under
        // itemShortfall's unified target, such a line simply has nothing in
        // the cart to begin with (the UI never offered it), so touching it
        // here is a no-op in the common case, and stops being a silent gap
        // the day a scan or another path credits it directly.
        //
        // Bug 1 fix (found live testing 7af6953): quantity_unfulfilled can
        // already carry a LEADER's decision from a partial approval — adding
        // to it, never overwriting it, is what keeps that decision intact.
        let stillShort = false;
        for (const item of items) {
            const fresh = (freshItems || []).find(i => i.id === item.id);
            if (!fresh) continue;

            const checkoutQty = qtyByItem.get(item.id) || 0;
            const requested = parseInt(fresh.quantity_requested) || 0;
            const unfulfilledOld = parseInt(fresh.quantity_unfulfilled) || 0;
            const newPrepared = (parseInt(fresh.quantity_prepared) || 0) + checkoutQty;
            fresh.quantity_prepared = newPrepared;

            if (choice === 'finish') {
                const shortAfterThis = Math.max(0, requested - unfulfilledOld - newPrepared);
                if (shortAfterThis > 0) fresh.quantity_unfulfilled = unfulfilledOld + shortAfterThis;
                const unfulfilledNew = parseInt(fresh.quantity_unfulfilled) || 0;
                fresh.item_status = (newPrepared + unfulfilledNew) >= requested ? 'Ready for Handover' : 'Packing';
            } else {
                const done = (newPrepared + unfulfilledOld) >= requested;
                fresh.item_status = done ? 'Ready for Handover' : 'Packing';
                if (!done) stillShort = true;
            }
            await saveData('request_order_items', fresh);
        }

        window.activeDispatchCheckoutHandler = null;
        const closeBtn = document.getElementById('btn-close-modal');
        if (closeBtn) closeBtn.click();

        const message = choice === 'finish'
            ? 'Checkout saved. The remaining shortfall is recorded as unfulfilled — this order is done.'
            : stillShort
                ? 'Checkout saved. This order still has lines pending — it stays open for the remainder.'
                : 'Checkout saved. All lines are fulfilled — ready to dispatch.';
        await showWarningModal(message, false, null, null, 'success');

        const printNow = await showWarningModal('Print the waybill now?', true);
        if (printNow) await printOrderDetail(order.id);

        await loadPackingRequestsSection();
        scheduleDashboardRefresh();
    }

    // ------------------------------------------------------------------
    // First paint, then one delegated listener bound directly to the modal's
    // stable body container (#modal-body-content survives every openModal()
    // call this function makes — only its innerHTML is reassigned) so it
    // keeps working across every re-render, including the choice dialog and
    // the fresh/continuing mode switch.
    // ------------------------------------------------------------------
    render();

    const modalBody = document.getElementById('modal-body-content');

    // #modal-body-content is a single persistent element reused by every
    // call to openDispatchCheckoutModal — opening the checkout modal for one
    // order, closing it, then opening it for a DIFFERENT order in the same
    // page session (completely ordinary use) does NOT tear down the
    // previous call's listeners, since closing only hides #modal-container
    // via CSS. Without this, listeners stack indefinitely, and anything that
    // reads DOM state by id rather than through its own closure — exactly
    // what toggleItemRow does — fires once per stacked listener on a single
    // click/keypress. For a plain boolean toggle (expand/collapse) two
    // stacked calls cancel each other out, which is how this was actually
    // found: real-clicking a row to expand it silently did nothing once a
    // second order's modal had been opened in the same session. Removing
    // whichever handlers the previous invocation left here, before adding
    // this invocation's own, keeps exactly one set live at a time.
    if (modalBody._dispatchCheckoutHandlers) {
        const old = modalBody._dispatchCheckoutHandlers;
        modalBody.removeEventListener('click', old.click);
        modalBody.removeEventListener('input', old.input);
        modalBody.removeEventListener('keydown', old.keydown);
    }

    // Bug 2 fix (found live testing 7af6953): .dc-item-row is a div with
    // role="button", not a real <button> (real buttons can't nest the
    // Autofill/Reset button next to them — see itemRowHtml's comment), so
    // Enter/Space have to be wired by hand for it to stay keyboard-operable.
    function toggleItemRow(headerEl) {
        const itemEl = headerEl.closest('.dc-item');
        const list = document.getElementById(headerEl.getAttribute('aria-controls'));
        if (!list) return;
        const open = list.classList.toggle('hidden') === false;
        headerEl.setAttribute('aria-expanded', open ? 'true' : 'false');
        itemEl.classList.toggle('open', open);
        if (open) renderItemLots(parseInt(headerEl.getAttribute('data-item')));
    }

    const onModalBodyClick = async (e) => {
        const autofillBtn = e.target.closest('.dc-row-autofill');
        if (autofillBtn && !autofillBtn.disabled) {
            const itemId = parseInt(autofillBtn.getAttribute('data-item'));
            await autofillItem(itemId);
            return;
        }

        const rowResetBtn = e.target.closest('.dc-row-reset');
        if (rowResetBtn) {
            const itemId = parseInt(rowResetBtn.getAttribute('data-item'));
            await resetCartForItem(itemId);
            return;
        }

        const committedResetBtn = e.target.closest('.dc-committed-reset');
        if (committedResetBtn && !committedResetBtn.disabled) {
            const itemId = parseInt(committedResetBtn.getAttribute('data-item'));
            await resetCommittedItem(itemId);
            return;
        }

        // Checked AFTER the action buttons above on purpose: with
        // stopPropagation gone from .dc-act (Bug 2 fix), a click on Autofill/
        // Reset also bubbles up to here, but those three checks already
        // `return` first, so this only ever fires for a click elsewhere on
        // the row.
        const headerBtn = e.target.closest('.dc-item-row');
        if (headerBtn) {
            toggleItemRow(headerBtn);
            return;
        }

        const takeBtn = e.target.closest('.dc-lot-take');
        if (takeBtn) {
            const lotEl = takeBtn.closest('.dc-lot');
            const itemId = parseInt(lotEl.getAttribute('data-item'));
            const lotId = parseInt(lotEl.getAttribute('data-lot'));
            const qty = parseInt(lotEl.querySelector('.dc-lot-qty').value) || 0;
            if (qty <= 0) return;
            await addCartEntry(itemId, lotId, qty);
            return;
        }

        const cancelBtn = e.target.closest('.dc-lot-cancel');
        if (cancelBtn) {
            const lotEl = cancelBtn.closest('.dc-lot');
            const itemId = parseInt(lotEl.getAttribute('data-item'));
            const lotId = parseInt(lotEl.getAttribute('data-lot'));
            const key = `${itemId}:${lotId}`;
            const row = cart.get(key);
            if (row) { liveRemaining[lotId] = (liveRemaining[lotId] || 0) + row.qty; }
            cart.delete(key);
            renderAll();
        }
    };

    // Editing the qty on an already-taken lot adjusts it directly — no need
    // to Cancel first just to fix a miscount.
    const onModalBodyInput = (e) => {
        const inp = e.target.closest('.dc-lot-qty');
        if (!inp) return;
        const lotEl = inp.closest('.dc-lot');

        // Not-yet-taken row: the qty box starts blank for any lot the order
        // doesn't actually need, and Take stays disabled until a real number
        // is typed.
        if (!lotEl.classList.contains('dc-lot-taken')) {
            const takeBtnEl = lotEl.querySelector('.dc-lot-take');
            if (takeBtnEl && !takeBtnEl.hidden) {
                const typed = parseInt(inp.value) || 0;
                const lotIdForRow = parseInt(lotEl.getAttribute('data-lot'));
                takeBtnEl.disabled = typed <= 0 || (liveRemaining[lotIdForRow] || 0) <= 0;
            }
            return;
        }
        const itemId = parseInt(lotEl.getAttribute('data-item'));
        const lotId = parseInt(lotEl.getAttribute('data-lot'));
        const key = `${itemId}:${lotId}`;
        const row = cart.get(key);
        if (!row) return;
        const maxAvail = (liveRemaining[lotId] || 0) + row.qty;
        let newQty = parseInt(inp.value) || 0;
        if (newQty < 1) newQty = 1;
        if (newQty > maxAvail) newQty = maxAvail;
        liveRemaining[lotId] = maxAvail - newQty;
        row.qty = newQty;
        inp.value = newQty;
        renderAllHeaders();
        // "avail" shown on the row = liveRemaining + taken, a constant pool
        // size regardless of how newQty splits it — unchanged by this edit.
        lotEl.querySelector('.dc-lot-stock').textContent = maxAvail;
    };

    // Enter/Space activation for .dc-item-row (Bug 2 fix — see toggleItemRow
    // above). The action buttons inside it are real <button> elements, so
    // they already get their own native Enter/Space handling from the
    // browser and must not also trigger the row toggle underneath them.
    const onModalBodyKeydown = (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const headerEl = e.target.closest('.dc-item-row');
        if (!headerEl) return;
        if (e.target.closest('.dc-act')) return;
        e.preventDefault();
        toggleItemRow(headerEl);
    };

    modalBody.addEventListener('click', onModalBodyClick);
    modalBody.addEventListener('input', onModalBodyInput);
    modalBody.addEventListener('keydown', onModalBodyKeydown);
    modalBody._dispatchCheckoutHandlers = { click: onModalBodyClick, input: onModalBodyInput, keydown: onModalBodyKeydown };

    // V2 barcode label fix: a RMP:9{lotId:05d}{sizeG:04d}{mult:02d} barcode
    // is resolved here (by the packed_coffee_lots row's own numeric id, not
    // its lot_code text) while this modal is open — see
    // js/roasting.js handleBarcodeScan's PackLot dispatch branch. Scanning
    // itself isn't wired up in the UI yet (dc-scan-input is disabled — see
    // render()'s HTML), so this only fires if something else routes a scan
    // here; left in place for when scanning ships.
    window.activeDispatchCheckoutHandler = async function (lotId, sizeG, multiplier) {
        const targetItem = items.find(item => {
            const lots = lotsByItem[item.id] || [];
            return parseInt(item.bag_size_g) === parseInt(sizeG) && lots.some(l => l.id === lotId);
        });
        if (!targetItem) {
            await showWarningModal(`Scanned lot #${lotId} (${sizeG}g) is not part of this order.`, false);
            return;
        }
        const lot = (lotsByItem[targetItem.id] || []).find(l => l.id === lotId);
        if (!lot) return;
        await addCartEntry(targetItem.id, lot.id, multiplier || 1);
    };

    // Clear the active-scan hook whenever this modal closes by any route
    // (Cancel, the shared × close button, or after a successful checkout).
    const modalCloseBtn = document.getElementById('btn-close-modal');
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', () => { window.activeDispatchCheckoutHandler = null; }, { once: true });
    }
}

// Scoped styling for the checkout modal — embedded in every render() call
// (cheap: a handful of ops staff use this modal, not a hot path) so it
// travels with #dispatch-checkout-body through every openModal() re-render,
// including the two-panel and choice-dialog views.
const DISPATCH_CHECKOUT_STYLE = `
    /* .btn sets display:inline-flex, which beats the bare [hidden]
       attribute — without this, a hidden Take/Cancel button stays visible
       instead of actually disappearing. */
    #dispatch-checkout-body [hidden] { display: none !important; }
    #dispatch-checkout-body .dc-stock-other { font-size: 0.68rem; font-weight: 600; color: var(--text-muted); margin-left: 4px; }
    #dispatch-checkout-body .dc-approval-note { font-size: 0.62rem; font-weight: 600; color: var(--text-muted); border: 1px dashed var(--border); border-radius: 4px; padding: 1px 6px; flex: 0 0 auto; white-space: nowrap; }
    #dispatch-checkout-body .dc-approval-block { font-size: 0.78rem; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; background: rgba(255,255,255,0.03); display: flex; flex-direction: column; gap: 6px; }
    #dispatch-checkout-body .dc-committed-lots > div { display: flex; justify-content: space-between; gap: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.74rem; }
    #modal-container:has(#dispatch-checkout-body) .overlay-card > div:has(> #modal-title) {
        padding-bottom: 6px !important;
        margin-bottom: 8px !important;
    }
    #dispatch-checkout-body .dc-order-info { display:flex; justify-content:space-between; align-items:flex-start; padding:0 12px 8px; margin-bottom:8px; border-bottom:1px solid var(--border); }
    #dispatch-checkout-body .dc-order-info-value { font-weight:600; font-size:0.86rem; color:var(--text-primary); }
    #dispatch-checkout-body .dc-order-info-sub { font-size:0.76rem; color:var(--text-muted); margin-top:1px; }
    #dispatch-checkout-body .dc-col-head { display:grid; grid-template-columns:1fr 130px 70px 70px 96px; gap:10px; padding:0 12px 6px; font-size:0.66rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); }
    #dispatch-checkout-body .dc-col-head span:nth-child(3), #dispatch-checkout-body .dc-col-head span:nth-child(4) { text-align:right; }
    #dispatch-checkout-body .dc-col-head-compact { grid-template-columns:1fr 60px 70px 96px; }
    #dispatch-checkout-body .dc-item { border:1px solid var(--border); border-radius:10px; overflow:hidden; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04); }
    #dispatch-checkout-body .dc-item-row { display:grid; grid-template-columns:1fr 130px 70px 70px 96px; gap:10px; align-items:center; width:100%; padding:14px 14px; background:var(--bg-card, none); border:none; text-align:left; cursor:pointer; font-family:inherit; font-size:0.86rem; color:var(--text-primary); }
    #dispatch-checkout-body .dc-item-row-compact { grid-template-columns:1fr 60px 70px 96px; }
    #dispatch-checkout-body .dc-item-row:hover { background:var(--bg-app); }
    #dispatch-checkout-body .dc-item-name { display:flex; align-items:center; gap:9px; min-width:0; flex-wrap:wrap; }
    #dispatch-checkout-body .dc-chev { display:inline-block; color:var(--text-muted); font-size:0.7rem; transition:transform 0.15s ease; }
    #dispatch-checkout-body .dc-item.open .dc-chev { transform:rotate(90deg); }
    #dispatch-checkout-body .dc-code { font-family:monospace; font-weight:800; font-size:0.76rem; color:var(--primary); background:var(--primary-glow); border:1px solid var(--primary); border-radius:6px; padding:2px 7px; letter-spacing:0.3px; flex:0 0 auto; }
    #dispatch-checkout-body .dc-title { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #dispatch-checkout-body .dc-size { font-family:monospace; font-size:0.76rem; color:var(--text-muted); flex:0 0 auto; background:var(--bg-app); border-radius:5px; padding:2px 6px; }
    #dispatch-checkout-body .dc-badge-dispatched { font-size:0.6rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--danger); background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.32); border-radius:4px; padding:1px 6px; flex:0 0 auto; }
    #dispatch-checkout-body .dc-mach { font-size:0.78rem; color:var(--text-muted); }
    #dispatch-checkout-body .dc-stock { font-family:monospace; font-size:0.85rem; text-align:right; }
    #dispatch-checkout-body .dc-ready { font-family:monospace; font-weight:700; font-size:0.85rem; text-align:right; }
    #dispatch-checkout-body .dc-act { display:flex; justify-content:flex-end; }
    #dispatch-checkout-body .dc-icon-btn { display:inline-flex; align-items:center; justify-content:center; width:30px; height:28px; border-radius:6px; background:none; border:1px solid rgba(239,68,68,0.42); color:var(--danger); padding:0; }
    #dispatch-checkout-body .dc-icon-btn[disabled] { opacity:0.35; }
    /* A disabled Take / Autofill / Checkout used to render exactly like an
       active one — full-colour green, with the hover glow — because nothing
       in the app styles .btn:disabled. Operators read that as "clickable"
       (reported 2026-09-16). Scoped to this modal on purpose; other screens
       may rely on their own disabled look. */
    #dispatch-checkout-body .btn:disabled,
    #dispatch-checkout-body .btn:disabled:hover {
        background-color: var(--bg-input);
        border-color: var(--border);
        color: var(--text-muted);
        box-shadow: none;
        transform: none;
        cursor: not-allowed;
        opacity: 0.7;
    }
    #dispatch-checkout-body .dc-icon-btn-danger { border-color:rgba(239,68,68,0.5); }
    #dispatch-checkout-body .dc-lots { border-top:1px solid var(--border); background:var(--bg-app); padding:6px; }
    #dispatch-checkout-body .dc-lot-empty { font-size:0.8rem; color:var(--text-muted); padding:14px; text-align:center; }
    #dispatch-checkout-body .dc-lot { display:grid; grid-template-columns:1fr 64px 190px; gap:10px; align-items:center; padding:8px 9px; border-radius:6px; font-size:0.82rem; }
    #dispatch-checkout-body .dc-lot + .dc-lot { margin-top:2px; }
    #dispatch-checkout-body .dc-lot:hover { background:rgba(127,127,127,0.08); }
    #dispatch-checkout-body .dc-lot-mismatch { background:rgba(190,72,52,0.1); box-shadow:inset 2px 0 0 rgba(190,72,52,0.55); }
    #dispatch-checkout-body .dc-lot-taken { background:rgba(45,106,79,0.12); box-shadow:inset 2px 0 0 var(--primary); }
    #dispatch-checkout-body .dc-lot-mismatch.dc-lot-taken { box-shadow:inset 2px 0 0 var(--primary), inset 0 0 0 1px rgba(190,72,52,0.4); }
    #dispatch-checkout-body .dc-lot-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
    #dispatch-checkout-body .dc-lot-code { font-family:monospace; font-size:0.78rem; }
    #dispatch-checkout-body .dc-lot-meta { font-size:0.7rem; color:var(--text-muted); }
    #dispatch-checkout-body .dc-lot-stock { font-family:monospace; font-size:0.8rem; text-align:right; color:var(--text-muted); }
    #dispatch-checkout-body .dc-pill { font-size:0.6rem; font-weight:700; padding:1px 6px; border-radius:9999px; white-space:nowrap; }
    #dispatch-checkout-body .dc-pill-fifo { color:var(--primary); background:var(--primary-glow); }
    #dispatch-checkout-body .dc-pill-mismatch { color:var(--danger); background:rgba(190,72,52,0.14); }
    #dispatch-checkout-body .dc-lot-add { display:flex; gap:6px; justify-content:flex-end; align-items:center; }
    #dispatch-checkout-body .dc-lot-check { color:var(--primary); font-weight:700; }
    #dispatch-checkout-body .dc-lot-qty { width:52px; padding:4px 6px; border-radius:5px; border:1px solid var(--border); background:var(--bg-app); color:var(--text-primary); font-size:0.78rem; text-align:right; font-family:monospace; }
    #dispatch-checkout-body .dc-split { display:grid; grid-template-columns:1.35fr 1fr; gap:14px; }
    #dispatch-checkout-body .dc-pane { border:1px solid var(--border); border-radius:10px; padding:12px; background:var(--bg-app); }
    #dispatch-checkout-body .dc-pane-head { display:flex; justify-content:space-between; gap:10px; font-size:0.68rem; letter-spacing:0.08em; text-transform:uppercase; color:var(--text-muted); margin-bottom:10px; }
    #dispatch-checkout-body .dc-sum-table { width:100%; border-collapse:collapse; font-size:0.78rem; }
    #dispatch-checkout-body .dc-sum-table th { text-align:right; font-weight:500; color:var(--text-muted); font-size:0.64rem; letter-spacing:0.06em; text-transform:uppercase; padding-bottom:7px; }
    #dispatch-checkout-body .dc-sum-table th:first-child { text-align:left; }
    #dispatch-checkout-body .dc-sum-table td { padding:7px 0; border-top:1px solid var(--border); text-align:right; font-variant-numeric:tabular-nums; }
    #dispatch-checkout-body .dc-sum-table td:first-child { text-align:left; }
    #dispatch-checkout-body .dc-sum-meta { font-size:0.66rem; color:var(--text-muted); }
    #dispatch-checkout-body .dc-sum-short { color:var(--warning, #d97706); font-weight:700; }
    #dispatch-checkout-body .dc-sum-ok { color:var(--success); }
    #dispatch-checkout-body .dc-sum-table tfoot td { font-weight:700; border-top:2px solid var(--border); }
    #dispatch-checkout-body .dc-sum-act { width:38px; }
    #dispatch-checkout-body .dc-pane-note { font-size:0.72rem; color:var(--text-muted); margin-top:12px; padding-top:10px; border-top:1px solid var(--border); }
    #dispatch-checkout-body .dc-choice-dialog { display:flex; flex-direction:column; gap:14px; }
    #dispatch-checkout-body .dc-choice-dialog h4 { margin:0; font-size:1rem; font-weight:700; color:var(--text-primary); }
    #dispatch-checkout-body .dc-short-list { display:flex; flex-direction:column; gap:6px; border:1px solid rgba(255,209,102,0.35); background:rgba(255,209,102,0.08); border-radius:8px; padding:10px 12px; }
    #dispatch-checkout-body .dc-short-line { display:flex; justify-content:space-between; gap:12px; font-size:0.82rem; color:var(--text-secondary); }
    #dispatch-checkout-body .dc-short-line b { color:var(--warning, #d97706); font-family:monospace; }
    #dispatch-checkout-body .dc-choice-list { display:flex; flex-direction:column; gap:10px; }
    #dispatch-checkout-body .dc-opt { display:grid; grid-template-columns:1fr auto; gap:8px 14px; align-items:center; border:1px solid var(--border); border-radius:10px; padding:12px 14px; }
    #dispatch-checkout-body .dc-opt-primary { border-color:var(--primary); background:var(--primary-glow); }
    #dispatch-checkout-body .dc-opt-title { font-size:0.88rem; font-weight:700; color:var(--text-primary); }
    #dispatch-checkout-body .dc-opt-desc { font-size:0.76rem; color:var(--text-muted); grid-column:1/-1; }
    #dispatch-checkout-body .dc-dialog-foot { display:flex; justify-content:flex-end; }
`;

// V2 1G: persists the checkout modal's cart — supersedes the old single-line
// "Ready" flow (markOrderItemReady), since fulfillment is now lot-level and
// can touch multiple order lines from one screen. The choice-driven finish
// (Pilihan 1) / continue (Pilihan 2) split lives inside runCheckout, nested
// in openDispatchCheckoutModal above, next to the render/cart state it needs
// — CHECKOUT_AUTOFILL_PLAN.md §4.

// ============================================================
// PRINT ORDER DETAIL - Sales Order Request A4
// ============================================================
async function printOrderDetail(orderId) {
    const [
        { data: orders },
        { data: orderItems },
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: codeDefinitions }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('code_definitions')
    ]);

    const order = (orders || []).find(o => o.id === orderId);
    if (!order) return;
    const items = (orderItems || []).filter(i => i.request_order_id === orderId);

    let itemsTableRows = '';
    let totalBags = 0;
    let totalWeightKg = 0;

    for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const type = item.coffee_type;
        const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
        let coffeeName = '';
        if (item.coffee_code) {
            const def = (codeDefinitions || []).find(d => d.code === item.coffee_code);
            coffeeName = def ? def.name : `Code ${item.coffee_code}`;
        } else if (type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === coffeeId);
            coffeeName = gb ? gb.name : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === coffeeId);
            coffeeName = r ? r.name : 'Blend';
        }
        const mach = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
        const machName = mach ? mach.name : '-';
        const qty = parseInt(item.quantity_requested) || 0;
        const sizeG = parseInt(item.bag_size_g) || 0;
        const weightKg = (qty * sizeG) / 1000;
        const allocated = parseInt(item.quantity_allocated) || 0;
        const pending = parseInt(item.quantity_pending) || 0;
        totalBags += qty;
        totalWeightKg += weightKg;

        // V2 1G: partial fulfillment shows "prepared/requested" plus a
        // shortfall marker — coffee name only, no lot code, per
        // V2_ROADMAP.md 1G. A fully-prepared line reads as a plain qty with
        // a checked "Completed" box, unchanged from before.
        const prepared = parseInt(item.quantity_prepared) || 0;
        const isFull = prepared >= qty;
        const qtyCellHtml = isFull
            ? `${qty}`
            : `${prepared}/${qty} <span style="color:#b45309;">(short ${qty - prepared})</span>`;
        const statusCellHtml = isFull
            ? `<span style="display:inline-block; width:13px; height:13px; border:1.5px solid #555; background:#555; border-radius:2px; vertical-align:middle; margin-right:6px;"></span> Completed`
            : `<span style="display:inline-block; width:13px; height:13px; border:1.5px solid #b45309; border-radius:2px; vertical-align:middle; margin-right:6px;"></span> Partial`;

        const sizeLabel = sizeG >= 1000 ? `${sizeG/1000}kg` : `${sizeG}g`;
        itemsTableRows += `
            <tr>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${idx + 1}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; font-weight:600;">${coffeeName}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${machName}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${sizeLabel}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${qtyCellHtml}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;"></td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:left;">${statusCellHtml}</td>
            </tr>`;
    }
    
    // Use the live companySettings (loaded from Supabase by loadCompanySettings()) —
    // do NOT read the 'mock_company_settings' localStorage cache here, it is seeded
    // once on first-ever page load and never refreshed by real saves.
    const cs = companySettings;

    const printContent = `<!DOCTYPE html>
<html>
<head>
    <title>Sales Order - ${order.order_number || '#ORD-'+order.id}</title>
    <style>
        @page { size: A4; margin: 18mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 13px; }
        .order-doc { max-width: 210mm; margin: 0 auto; padding: 20px; }

        /* Letterhead */
        .letterhead { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 3px solid #2d5016; margin-bottom: 20px; }
        .letterhead-left { display: flex; align-items: center; gap: 14px; }
        .letterhead-logo { width: 52px; height: 52px; border-radius: 8px; object-fit: cover; }
        .letterhead-name { font-size: 20px; font-weight: 800; color: #2d5016; line-height: 1.2; }
        .letterhead-contact { font-size: 10px; color: #666; line-height: 1.5; margin-top: 2px; }
        .letterhead-right { text-align: right; }
        .letterhead-right .doc-title { font-size: 18px; font-weight: 800; color: #2d5016; letter-spacing: 0.5px; text-transform: uppercase; }
        .letterhead-right .doc-subtitle { font-size: 10px; color: #888; margin-top: 2px; }

        /* Info section */
        .info-section { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; }
        .info-section .info-left { font-size: 12px; color: #666; }
        .info-block { text-align: right; }
        .info-block .info-row { display: flex; justify-content: flex-end; gap: 12px; font-size: 12px; line-height: 2; }
        .info-block .info-label { color: #888; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.3px; }
        .info-block .info-value { color: #1a1a1a; font-weight: 700; min-width: 140px; text-align: left; }

        /* Table */
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        thead th { background: #2d5016; color: #fff; padding: 9px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid #2d5016; }
        tbody td { padding: 8px 10px; border: 1px solid #ddd; font-size: 12px; }
        tfoot td { background: #f0f5eb; font-weight: 700; padding: 9px 10px; border: 1px solid #ddd; font-size: 12px; }

        /* Notes */
        .notes { border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin-top: 16px; }
        .notes .label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #888; margin-bottom: 4px; }

        /* Footer */
        .print-footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #eee; font-size: 10px; color: #999; text-align: center; }
        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
    </style>
</head>
<body>
    <div class="order-doc">
        <div class="letterhead">
            <div class="letterhead-left">
                ${cs.show_logo_in_print && cs.logo_base64 ? '<img class="letterhead-logo" src="' + cs.logo_base64 + '" alt="Logo">' : ''}
                <div>
                    <div class="letterhead-name">${cs.company_name || 'Coffee Roastery'}</div>
                    <div class="letterhead-contact">
                        ${cs.address ? cs.address + '<br>' : ''}${cs.phone ? cs.phone : ''}${cs.email ? ' · ' + cs.email : ''}
                    </div>
                </div>
            </div>
            <div class="letterhead-right">
                <div class="doc-title">Sales Order</div>
                <div class="doc-subtitle">${order.order_number || '#ORD-'+order.id}</div>
            </div>
        </div>

        <div class="info-section">
            <div class="info-left"></div>
            <div class="info-block">
                <div class="info-row">
                    <span class="info-label">Order Number</span>
                    <span class="info-value">${order.order_number || '#ORD-'+order.id}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Order Date</span>
                    <span class="info-value">${order.order_date}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Sales Agent</span>
                    <span class="info-value">${order.sales_name || '-'}</span>
                </div>
            </div>
        </div>

        <table>
            <thead>
                <tr>
                    <th style="width:30px;">#</th>
                    <th>Coffee Name</th>
                    <th style="width:100px;">Machine</th>
                    <th style="width:55px;">Size</th>
                    <th style="width:45px;">Qty</th>
                    <th style="width:70px;">Prepared</th>
                    <th style="width:110px;">Status</th>
                </tr>
            </thead>
            <tbody>${itemsTableRows}</tbody>
            <tfoot>
                <tr>
                    <td colspan="4" style="text-align:right; border:1px solid #ddd;">Total</td>
                    <td style="text-align:center; border:1px solid #ddd;">${totalBags}</td>
                    <td colspan="2" style="border:1px solid #ddd;"></td>
                </tr>
            </tfoot>
        </table>
        ${order.notes ? '<div class="notes"><div class="label">Notes / Customer Info</div><div>' + order.notes + '</div></div>' : ''}
    </div>
    <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
}

async function dispatchOrder(orderId) {
    const { data: orders } = await fetchData('request_orders');
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    
    order.status = 'Dispatched';
    await saveData('request_orders', order);
    
    await showWarningModal('Order dispatched! The sales team has picked up the packed items.', false, null, null, 'success');
    loadPackingRequestsSection();
    scheduleDashboardRefresh();
}

// Builds a short, deterministic lot code for a bulk item on a given date:
// {coffee code}-{machine code}{MMDDYY}{lot number} — machine code, date and
// lot number are concatenated with no separators (only the leading dash
// after the coffee code stays). No 'LOT-' prefix — unified with the packed-
// coffee lot code style ({coffee code}-{machine code}{MMDDYY}-{seq}, see
// getOrCreatePackedCoffeeLot) per user request, so the two lot-code spaces
// in the app read consistently. Deliberately doesn't start with 'RMP:' so it
// never collides with the global quick-roast-log scanner listener in app.js
// (which only reacts to that exact prefix). The trailing lot number is how
// many production_lots rows already exist for this exact coffee+machine
// combination (across all dates) — a running "Lot #N of this coffee on this
// machine" count, not a roast-batch sequence (that was tried and reverted
// per feedback).
function buildLotCode(bulk, machines, greenbeans, recipes, dateStr, lotNumber) {
    const sanitize = (s) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'X';
    const machine = (machines || []).find(m => m.id === bulk.machine_id);
    const machineCode = machine ? (machine.code || machine.name) : 'M';

    let coffeeCode;
    if (bulk.coffee_type === 'Single') {
        const gb = (greenbeans || []).find(g => g.id === bulk.single_coffee_id);
        coffeeCode = gb ? (gb.code || gb.name) : bulk.coffee_name;
    } else {
        const r = (recipes || []).find(rec => rec.id === bulk.blend_recipe_id);
        coffeeCode = r ? (r.code || r.name) : bulk.coffee_name;
    }

    const [y, m, d] = dateStr.split('-');
    const mmddyy = `${m}${d}${y.slice(2)}`;

    // lotNumber is optional: the printed label / stored lot_code includes it,
    // but the Ready-to-Pack card shows the base code (same format, minus the
    // trailing lot number) as a preview badge before a lot actually exists.
    const base = `${sanitize(coffeeCode)}-${sanitize(machineCode)}${mmddyy}`;
    return (lotNumber === undefined || lotNumber === null) ? base : `${base}${lotNumber}`;
}

// Ready to Pack / Close Lot preview badge ONLY (explicit user request) —
// deliberately a separate function from buildLotCode above, which stays
// untouched since it also generates the PERMANENT production_lots.lot_code
// once Print Barcode is clicked (already printed on physical labels,
// referenced by Tracking lookups and packed_coffee_lots provenance — not
// safe to reformat). Format: {coffeeCode}-{machineCode}{ddmmyy}-{totalBatches}
// — day-month-year (swapped from buildLotCode's month-day-year), plus a
// trailing count of every roast_batches row that fed this exact bulk
// lot (same coffee+machine+day match getOrCreateProductionLot already uses
// to find them). This count is live, not stored — it's read fresh on every
// render, so it grows if one more batch gets logged for the same day later.
function buildPreviewLotCode(bulk, machines, greenbeans, recipes, roastBatches, dateStr) {
    const sanitize = (s) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'X';
    const machine = (machines || []).find(m => m.id === bulk.machine_id);
    const machineCode = machine ? (machine.code || machine.name) : 'M';

    let coffeeCode;
    if (bulk.coffee_type === 'Single') {
        const gb = (greenbeans || []).find(g => g.id === bulk.single_coffee_id);
        coffeeCode = gb ? (gb.code || gb.name) : bulk.coffee_name;
    } else {
        const r = (recipes || []).find(rec => rec.id === bulk.blend_recipe_id);
        coffeeCode = r ? (r.code || r.name) : bulk.coffee_name;
    }

    const [y, m, d] = dateStr.split('-');
    const ddmmyy = `${d}${m}${y.slice(2)}`;

    const totalBatches = (roastBatches || []).filter(b =>
        b.coffee_type === bulk.coffee_type &&
        (bulk.coffee_type === 'Single' ? b.single_coffee_id === bulk.single_coffee_id : b.blend_recipe_id === bulk.blend_recipe_id) &&
        b.machine_id === bulk.machine_id &&
        b.roast_date === dateStr
    ).length;

    return `${sanitize(coffeeCode)}-${sanitize(machineCode)}${ddmmyy}-${totalBatches}`;
}

// One production_lots row per (bulk item, day) — reuses the lot already
// printed for this bulk item, otherwise creates it. bulk.production_date is
// now the actual roast day (bulk_roasted_coffee is date-scoped — see
// database/bulk_production_date_migration.sql), not "today the print button
// was clicked" — using it here (instead of literal "today") is what makes
// the roast-date segment on printed packed-coffee lot codes accurate.
async function getOrCreateProductionLot(bulk, machines, greenbeans, recipes, roastBatches) {
    const bulkDate = bulk.production_date || new Date().toISOString().split('T')[0];
    const { data: lots } = await fetchData('production_lots');
    const existing = (lots || []).find(l => l.bulk_roasted_coffee_id === bulk.id && l.production_date === bulkDate);
    if (existing) {
        // Re-printing the same lot after more batches were logged —
        // keep production_lot_batches current (see syncProductionLotBatches).
        await syncProductionLotBatches(existing, bulk, roastBatches);
        return existing;
    }

    // Scoped to the bulk row's own roast day — previously picked the
    // single globally-most-recent batch for this coffee+machine, which
    // could point at an unrelated day's batch now that bulk rows are
    // pinned to one date each.
    const matchingBatches = (roastBatches || [])
        .filter(b => b.coffee_type === bulk.coffee_type &&
            (bulk.coffee_type === 'Single' ? b.single_coffee_id === bulk.single_coffee_id : b.blend_recipe_id === bulk.blend_recipe_id) &&
            b.machine_id === bulk.machine_id &&
            b.roast_date === bulkDate)
        .sort((a, b) => new Date(b.roast_date || 0) - new Date(a.roast_date || 0) || b.id - a.id);
    const latestBatch = matchingBatches[0] || null;

    const sameCoffeeAndMachineLots = (lots || []).filter(l =>
        l.coffee_type === bulk.coffee_type && l.machine_id === bulk.machine_id &&
        (bulk.coffee_type === 'Single' ? l.single_coffee_id === bulk.single_coffee_id : l.blend_recipe_id === bulk.blend_recipe_id)
    );
    const lotNumber = sameCoffeeAndMachineLots.length + 1;

    const newLot = {
        lot_code: buildLotCode(bulk, machines, greenbeans, recipes, bulkDate, lotNumber),
        bulk_roasted_coffee_id: bulk.id,
        coffee_type: bulk.coffee_type,
        single_coffee_id: bulk.single_coffee_id,
        blend_recipe_id: bulk.blend_recipe_id,
        machine_id: bulk.machine_id,
        coffee_name: bulk.coffee_name,
        production_date: bulkDate,
        latest_roast_batch_id: latestBatch ? latestBatch.id : null
    };
    const { data: saved, error } = await saveData('production_lots', newLot);
    if (error) {
        console.error('Failed to create production lot:', error);
        return newLot;
    }
    const savedLot = saved || newLot;
    await syncProductionLotBatches(savedLot, bulk, roastBatches);
    return savedLot;
}

// V2 1·CHAIN precision: snapshots every roast_batches row of the same
// coffee+machine roasted on this lot's OWN production_date into
// production_lot_batches — replacing the single latest_roast_batch_id
// approximation for Tracking purposes (js/tracking.js resolves through this
// table now, not latest_roast_batch_id). Carryover from prior days is
// deliberately not modeled, per V2_ROADMAP.md 1·CHAIN. Idempotent: skips
// batches already linked, so re-printing the same day's lot never duplicates
// rows (production_lot_batches also has a UNIQUE(production_lot_id,
// roast_batch_id) constraint as a backstop).
async function syncProductionLotBatches(lot, bulk, roastBatches) {
    if (!lot || !lot.id) return;
    const sameDayBatches = (roastBatches || []).filter(b =>
        b.coffee_type === bulk.coffee_type &&
        (bulk.coffee_type === 'Single' ? b.single_coffee_id === bulk.single_coffee_id : b.blend_recipe_id === bulk.blend_recipe_id) &&
        b.machine_id === bulk.machine_id &&
        b.roast_date === lot.production_date
    );
    if (sameDayBatches.length === 0) return;

    const { data: existingLinks } = await fetchData('production_lot_batches');
    const alreadyLinked = new Set(
        (existingLinks || []).filter(l => l.production_lot_id === lot.id).map(l => l.roast_batch_id)
    );

    for (const b of sameDayBatches) {
        if (alreadyLinked.has(b.id)) continue;
        const { error } = await saveData('production_lot_batches', { production_lot_id: lot.id, roast_batch_id: b.id });
        if (error) console.error('Failed to link production_lot_batches row:', error);
    }
}

// opts.priorityMark — "KELUAR DULU" sticker for stock counted straight off the
// warehouse shelf (Stock by Lot > Print Sticker), as opposed to a normal
// just-packed run. It deliberately drops the coffee name, machine and date
// lines: those bags already carry their own printed roast date, and stamping
// the ENTRY date next to it would put two conflicting dates on one package.
// What's left is the scannable identity (barcode + strip code), the size, and
// the priority band the packing team actually sorts by. Omitted opts keeps the
// normal production label byte-identical.
function printLotBarcodeLabels(lot, requested, machines, opts = {}) {
    const priorityMark = opts.priorityMark === true;
    const priorityLabel = window.t ? window.t('lbl_sticker_priority') : 'OUT FIRST';
    // Production date = the lot's roast/pack date (production_date). Expiry
    // is a fixed 1-year shelf life from that date — no separate field to
    // track, just computed at print time. dd-mm-yyyy per the label spec
    // (not toLocaleDateString — that doesn't reliably give dash-separated
    // day-month-year across browsers/locales).
    const prodDate = lot.production_date ? new Date(lot.production_date + 'T00:00:00') : null;
    const expDate = prodDate ? new Date(prodDate.getFullYear() + 1, prodDate.getMonth(), prodDate.getDate()) : null;
    // Compact ddmmyy — no internal separators, matching the lot code's own
    // MMDDYY digit style, joined as "ddmmyy - ddmmyy" (prod - exp).
    const fmtDDMMYY = (d) => {
        if (!d) return '-';
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        return `${dd}${mm}${yy}`;
    };
    const dateRangeStr = `${fmtDDMMYY(prodDate)} - ${fmtDDMMYY(expDate)}`;
    const machineName = ((machines || []).find(m => m.id === lot.machine_id) || {}).name || '';

    // Which lines print alongside the barcode — see Settings → Production →
    // Label Layout (companySettings.label_layout.packed). "code" controls
    // JsBarcode's own displayValue (the lot code text under the bars), not a
    // separate line — the barcode graphic itself always prints regardless.
    const cfg = (companySettings.label_layout && companySettings.label_layout.packed) || {};
    const showCode = cfg.code !== false;
    // A priority sticker overrides these three regardless of the Settings
    // toggles — see the opts.priorityMark note on the signature above.
    const showCoffeeName = priorityMark ? false : cfg.coffee_name !== false;
    const showDates = priorityMark ? false : cfg.dates !== false;
    const showMachine = priorityMark ? false : cfg.machine !== false;

    // Physical sticker is exactly 50×25mm — one label per printed page (roll
    // printer), content flex-centered/space-evenly so it fills the sticker
    // instead of floating in whitespace.
    let labelsHtml = '';
    requested.forEach(r => {
        if (!r.packedCoffeeLotId) return; // couldn't resolve/reserve a lot for this size — skip rather than print an unscannable label

        // V2 FIFO strip code re-encode: package barcode is now
        // {sizeDigit}{batchNo:04d}{multiplier:02d} — a pure 6-7 digit
        // number with no "RMP:9{lotId}" prefix. Dropping the lotId lookup
        // entirely (not just shortening the prefix) is what actually buys
        // back scan reliability: fewer digits means CODE128's Code-Set-C
        // pairing compresses further, so bars come out thicker despite the
        // 50mm label being unchanged. mult=00 means "no carton multiplier"
        // (a plain package scan) — never byte-identical to a carton
        // barcode of the same size/batch, so the POS checkout scanner still
        // tells them apart. A size with no size_digit configured yet
        // (Settings > Production > Packaging Sizes) has no strip_code
        // either — skipped rather than printing an unscannable label, same
        // as the missing-lot case above.
        if (!r.stripCode) return;
        const barcodeValue = `${r.stripCode}${String(r.multiplier || 0).padStart(2, '0')}`;
        // Human-readable strip text (see barcode-label-strip below): the
        // multiplier is appended with a hyphen ONLY for a carton print, so
        // "20021" (plain package) vs "20021-12" (carton of 12) — never
        // "-00" for a non-carton print, per user request.
        const stripDisplayText = r.multiplier ? `${r.stripCode}-${r.multiplier}` : r.stripCode;

        for (let i = 0; i < r.qty; i++) {
            let linesHtml = '';
            if (showCoffeeName) linesHtml += `<div class="lbl-coffee">${lot.coffee_name}</div>`;
            linesHtml += `<div class="lbl-size">${r.label}</div>`;
            if (showMachine && machineName) linesHtml += `<div class="lbl-machine">${machineName}</div>`;
            if (showDates) linesHtml += `<div class="lbl-dates">${dateRangeStr}</div>`;
            if (priorityMark) linesHtml += `<div class="lbl-priority">${priorityLabel}</div>`;
            labelsHtml += `
                <div class="barcode-label-item">
                    <div class="barcode-label-row">
                        <div class="barcode-label-main">
                            <svg class="lot-barcode-svg" data-value="${barcodeValue}" data-display="${r.lotCode || ''}"></svg>
                            ${linesHtml}
                        </div>
                        <div class="barcode-label-strip"><span>${stripDisplayText}</span></div>
                    </div>
                </div>
            `;
        }
    });

    const printWin = window.open('', '_blank', 'width=900,height=700');
    if (!printWin) {
        alert('Could not open the print window — please allow pop-ups for this site and try again.');
        return;
    }
    const barcodeHeightMm = parseFloat((companySettings.label_layout && companySettings.label_layout.packed && companySettings.label_layout.packed.barcode_height_mm)) || 18;
    printWin.document.write(buildFixedLabelDocument(labelsHtml, showCode, barcodeHeightMm));
    printWin.document.close();
}

// V2 barcode label fix (packed coffee + green bean "Kecil"): the shared
// single-barcode-per-sticker document — same @page/CSS/JsBarcode config for
// both, so the two never drift out of sync the way packed/green did before.
//
// Root cause of "scans inconsistent, two printers print different sizes":
// the barcode zone's HEIGHT is a fixed mm value (independent of which
// optional text lines are toggled on — they're separate sibling elements,
// never sharing the SVG's own box), so toggling label_layout fields on/off
// never changes barcode size. All text sizing is in mm (not px) so it scales
// with the SAME physical unit as the page across different printer DPIs,
// instead of px being reinterpreted per-driver. Module width bumped from the
// old 1.1 to 2.2 (JsBarcode units) — the old value produced sub-0.2mm bars
// once scaled into the 8mm-tall zone, well under the ~0.33mm minimum most
// thermal printers can reproduce without dot-gain merging adjacent bars.
// LABEL PRINT GEOMETRY — read this before changing @page or adding any
// rotation. The physical label is 50mm wide x 25mm tall (landscape), so
// @page MUST be `50mm 25mm` to match it, and the content must NOT be
// rotated here. There must be exactly ONE source of rotation in the whole
// pipeline, and on this printer that source is the ZDesigner driver's own
// Paper Format radio, which must be set to PORTRAIT (= no rotation).
//
// Why this took several tries on a real Zebra GK420t: the driver's
// "landscape" radio applies its own 90 degree rotation on top of whatever
// page Chrome sends, and it was left ON for every earlier test — so every
// attempt came out portrait no matter what the code did:
//   - @page 50x25, no CSS rotation, driver landscape -> driver rotates it
//     -> portrait output (cropped).
//   - @page 25x50 + CSS rotate(90deg), driver landscape -> CSS makes it
//     landscape, driver rotates it again -> portrait output (cropped).
//   - no @page size at all, trusting Chrome's own print-dialog Layout
//     dropdown -> confirmed on a physical print that that dropdown only
//     changes the on-screen preview, never the paper.
// Hence: match the page to the label, rotate nowhere in code, and let the
// driver sit at Portrait. Driver Stocks must also stay calibrated to
// 1.97 x 0.98in (= 50 x 25mm) with "rotate 180" unchecked.
function buildFixedLabelDocument(labelsHtml, showCode, packedBarcodeHeightMm) {
    // 0.5mm page margin (was 1mm) to reclaim print area — most thermal roll
    // printers can hold 0.5mm reliably. Content box is then 49x24mm.
    const pageCss = `@page { size: 50mm 25mm; margin: 0.5mm; }`;
    const itemCss = `.barcode-label-item {
                width: 49mm;
                height: 24mm;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
                /* Top padding added 2026-09-03: content was printing hard against
                   the label's top edge. Calibrated against a physically-verified
                   trial print rather than guessed (LABEL_TEST_PLAN.md), which
                   sat 1.5mm from the top edge and printed with comfortable
                   clearance. justify-content below then balances what is left:
                   measured 2.29mm top / 2.14mm bottom.
                   box-sizing:border-box keeps the sticker itself
                   at 24mm; only the content area shrinks, and there was ~3mm of
                   vertical slack to give. */
                padding: 1mm;
                justify-content: center;
                page-break-after: always;
           }`;
    // Barcode height: for packed-coffee labels (the only caller that passes
    // packedBarcodeHeightMm) this is now a Settings-configurable value
    // (Settings > Production > Label Layout > Packed Coffee, default 18mm)
    // instead of a fixed number — per user request, since the "right" height
    // depends on the physical printer/label stock, not something guessable
    // from here. Width is intentionally NOT a fixed mm value: it's 100% of
    // whatever space .barcode-label-main (flex:1) has left after
    // .barcode-label-strip's own fixed width, so it auto-adapts instead of
    // needing its own setting. Green bean's Kecil stickers (js/greenbean.js)
    // don't pass this argument at all, so they keep the fixed 46x12mm sizing
    // they were already effectively getting (the old rotate-dependent
    // 44x14mm variant went away with the orientation toggle, which defaulted
    // to landscape anyway) — completely unaffected by this
    // packed-coffee-specific setting.
    const barcodeCss = packedBarcodeHeightMm
        ? `.lot-barcode-svg { width: 100%; height: ${packedBarcodeHeightMm}mm; display: block; margin: 0.15mm auto 0; }`
        : `.lot-barcode-svg { width: 46mm; height: 12mm; display: block; margin: 0.3mm auto 0; }`;
    return `
        <html><head><title>Barcode Labels</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <style>
            ${pageCss}
            body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
            ${itemCss}
            .barcode-label-item:last-child { page-break-after: auto; }
            /* V2 FIFO strip code: packed-coffee labels wrap their content in
               this row (main column + vertical strip) instead of using
               .barcode-label-item's own children directly — green bean's
               Kecil stickers (js/greenbean.js) still put their svg/text as
               DIRECT children of .barcode-label-item unchanged, so this new
               row only affects labels that opt into it, not every label
               sharing this document builder. */
            .barcode-label-row { width: 100%; height: 100%; display: flex; flex-direction: row; align-items: stretch; }
            .barcode-label-main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
            /* justify-content added 2026-09-03: packed labels put their content
               in this column, and .barcode-label-row already fills the item's
               full height — so centring on .barcode-label-item alone does
               nothing for them. Without this the block sat flush at the top
               with all the slack pooling at the bottom. */
            .barcode-label-strip { flex: 0 0 6mm; display: flex; align-items: center; justify-content: center; overflow: hidden; border-left: 0.25mm dashed #999; }
            .barcode-label-strip span { display: inline-block; transform: rotate(-90deg); white-space: nowrap; font-family: monospace; font-weight: 700; font-size: 4mm; }
            /* Barcode zone is a FIXED mm box, set once here — it never
               grows/shrinks based on which optional text lines print below
               it (those are separate sibling divs, not part of this box).
               Both width and height are explicit (not width:auto preserving
               JsBarcode's native aspect ratio) — preserveAspectRatio="none"
               (set on the SVG right after JsBarcode renders it, see below)
               makes it stretch to fill this exact box every time, always
               using the label's full available width for maximum module
               thickness regardless of how many digits the payload has. */
            ${barcodeCss}
            .lbl-coffee { font-size: 2.3mm; font-weight: 700; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; margin-top: 0.2mm; }
            .lbl-size { font-size: 2.1mm; font-weight: 700; line-height: 1.15; margin-top: 0.15mm; }
            .lbl-machine { font-size: 1.7mm; font-weight: 600; line-height: 1.15; color: #333; margin-top: 0.1mm; }
            .lbl-dates { font-size: 2.8mm; font-weight: 700; line-height: 1.15; margin-top: 0.15mm; }
            /* Priority band (see opts.priorityMark in printLotBarcodeLabels).
               Boxed + letter-spaced rather than plain bold text so it reads
               across a shelf at a glance, which is the whole point of this
               sticker. It only ever appears when the coffee-name/machine/date
               lines are suppressed, so there's room on the 25mm height without
               squeezing the barcode.
               Deliberately a BORDER with black text, not white-on-black:
               Chrome's print dialog defaults "Background graphics" to OFF, and
               with it off a background-filled band prints as blank paper with
               invisible white text. Borders and text are content, not
               background, so this survives that setting either way. */
            .lbl-priority { font-size: 2.8mm; font-weight: 800; line-height: 1.2; letter-spacing: 0.3mm; margin-top: 0.4mm; color: #000; border: 0.4mm solid #000; padding: 0.25mm 1mm; border-radius: 0.6mm; width: 100%; box-sizing: border-box; text-align: center; }
        </style></head><body>
        ${labelsHtml}
        <script>
            /* Bars must land on WHOLE printer dots. The GK420t is 203 dpi and can
               only fire whole dots, so a barcode stretched to an arbitrary width
               (what this did before: width 2.2 modules + preserveAspectRatio
               "none" against a 100% box) puts module edges on fractional dots —
               some bars round up, some round down, the widths stop matching
               Code128, and scans fail even though the label looks perfect to the
               eye. Diagnosed and fixed 2026-09-03 — the approach was proven on
               paper in a throwaway trial tab first, then brought here; that tab
               is gone, the findings are in LABEL_TEST_PLAN.md.

               The fix: pick the largest INTEGER dots-per-module that still fits,
               then size the SVG so 1 of its internal units renders as exactly 1
               printer dot. preserveAspectRatio stays "none" on purpose — the X
               scale is now exact, and height is free to fill its own mm box. */
            var DOTS_PER_MM = 203 / 25.4;
            document.querySelectorAll('.lot-barcode-svg').forEach(function (el) {
                var availPx = el.clientWidth || (el.parentElement ? el.parentElement.clientWidth : 0);
                var availDots = Math.floor(availPx * 25.4 / 96 * DOTS_PER_MM);
                var natural = 0;
                for (var w = 4; w >= 1; w--) {
                    JsBarcode(el, el.dataset.value, { format: 'CODE128', width: w, height: 60, displayValue: ${showCode}, text: el.dataset.display, fontSize: 22, margin: 0 });
                    natural = parseFloat(el.getAttribute('width')) || 0;
                    if (!availDots || natural <= availDots || w === 1) break;
                }
                el.setAttribute('preserveAspectRatio', 'none');
                el.removeAttribute('width');
                el.removeAttribute('height');
                /* Only ever shrink below the exact mapping if the symbol genuinely
                   cannot fit even at 1 dot per module — better a slightly
                   imprecise barcode than one running off the label. */
                var finalDots = availDots ? Math.min(natural, availDots) : natural;
                el.style.width = (finalDots / DOTS_PER_MM).toFixed(3) + 'mm';
                el.style.marginLeft = 'auto';
                el.style.marginRight = 'auto';
            });
            setTimeout(function () { window.print(); }, 500);
        <\/script>
        </body></html>
    `;
}

// Print Barcode modal — one form, all active packaging sizes at once, per
// the "Ready to Pack" workflow: print now, physical packing/qty entry
// happens later via the Pack button (openPackBulkModal), possibly a
// different count than what was printed.
async function openPrintBarcodeModal(bulkId) {
    const [
        { data: bulkList },
        { data: machines },
        { data: greenbeans },
        { data: recipes },
        { data: packagingSizes },
        { data: roastBatches }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('packaging_sizes'),
        fetchData('roast_batches')
    ]);
    const bulk = (bulkList || []).find(b => b.id === bulkId);
    if (!bulk) return;

    const activeSizes = (packagingSizes || []).filter(s => s.is_visible).sort((a, b) => a.gram - b.gram);
    if (activeSizes.length === 0) {
        alert('No packaging sizes configured. Please add sizes in Settings.');
        return;
    }

    // V2 1G: each package barcode now encodes its size (RMP:PackLot:{lot_code}:
    // {sizeG}), and any size with a configured carton_multiplier also gets a
    // Carton label option encoding a multiplier (RMP:PackLot:{lot_code}:
    // {sizeG}:{multiplier}) — a carton barcode is never byte-identical to a
    // package barcode, so the POS checkout scanner can tell them apart and
    // register the full carton count in one scan.
    const sizesHtml = activeSizes.map(s => {
        let html = `
        <div class="form-group flex-1-mb-0">
            <label class="form-label">${s.label}</label>
            <input type="number" min="0" class="form-control print-barcode-qty-input" data-label="${s.label}" data-gram="${s.gram}" value="0" placeholder="0">
        </div>
        `;
        if (s.carton_multiplier) {
            html += `
        <div class="form-group flex-1-mb-0">
            <label class="form-label">${s.label} carton (&times;${s.carton_multiplier})</label>
            <input type="number" min="0" class="form-control print-barcode-qty-input" data-label="${s.label} Carton" data-gram="${s.gram}" data-multiplier="${s.carton_multiplier}" value="0" placeholder="0">
        </div>
            `;
        }
        return html;
    }).join('');

    const html = `
        <form id="modal-print-barcode-form">
            <div class="form-group">
                <label class="form-label">Coffee</label>
                <input type="text" class="form-control" value="${bulk.coffee_name} (${parseFloat(bulk.bulk_available).toFixed(2)} kg available)" readonly>
            </div>
            <!-- Orientation is chosen in the browser's own print dialog
                 (Layout: Portrait/Landscape) rather than here — see
                 buildFixedLabelDocument for why the app no longer carries
                 its own control. -->
            <div style="margin-top: 16px;">
                <label class="form-label">Number of labels to print per size</label>
                <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    ${sizesHtml}
                </div>
            </div>
            <div class="modal-footer-actions-lg">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Print Labels</button>
            </div>
        </form>
    `;

    openModal('Print Barcode Labels', html, '600px');

    document.getElementById('modal-print-barcode-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const requested = Array.from(document.querySelectorAll('.print-barcode-qty-input'))
            .map(inp => ({
                label: inp.getAttribute('data-label'),
                gram: parseFloat(inp.getAttribute('data-gram')),
                multiplier: inp.getAttribute('data-multiplier') ? parseFloat(inp.getAttribute('data-multiplier')) : null,
                qty: parseInt(inp.value) || 0
            }))
            .filter(r => r.qty > 0);

        if (requested.length === 0) {
            alert('Please enter a quantity for at least one size.');
            return;
        }

        const lot = await getOrCreateProductionLot(bulk, machines, greenbeans, recipes, roastBatches);

        // V2 barcode label fix: each requested size needs its OWN
        // packed_coffee_lots identity for the barcode to encode — resolve
        // (or reserve, qty 0) one per size, keyed the same way Pack keys
        // its own lots (packed_coffee + this production lot), so whichever
        // of Print/Pack happens first, the other converges on the same row.
        for (const r of requested) {
            const packedRow = await getOrCreatePackedCoffeeRow(bulk.coffee_name, r.gram, bulk.machine_id);
            if (!packedRow) continue;
            const packedLot = await getOrCreatePackedCoffeeLot(packedRow.id, 0, lot ? lot.id : null);
            r.packedCoffeeLotId = packedLot ? packedLot.id : null;
            r.lotCode = packedLot ? packedLot.lot_code : null;
            r.stripCode = packedLot ? packedLot.strip_code : null;
        }

        printLotBarcodeLabels(lot, requested, machines);
        document.getElementById('btn-close-modal').click();
    });
}

// Pack modal, scoped to a single bulk item's card — same deduction logic the
// old Daily Packing sheet used (decrement bulk_available, upsert
// packed_coffee, log packing_records), just triggered per-card instead of
// via a manual coffee+machine dropdown. Only the packed quantity per size is
// entered — no carton count, per the Packing team's workflow.
async function openPackBulkModal(bulkId) {
    const [
        { data: bulkList },
        { data: packagingSizes },
        { data: machines },
        { data: greenbeans },
        { data: recipes },
        { data: roastBatches }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('packaging_sizes'),
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('roast_batches')
    ]);
    const bulk = (bulkList || []).find(b => b.id === bulkId);
    if (!bulk) return;

    const activeSizes = (packagingSizes || []).filter(s => s.is_visible).sort((a, b) => a.gram - b.gram);
    if (activeSizes.length === 0) {
        alert('No packaging sizes configured. Please add sizes in Settings.');
        return;
    }

    const sizesHtml = activeSizes.map(s => `
        <div class="form-group flex-1-mb-0">
            <label class="form-label">${s.label}</label>
            <input type="number" min="0" class="form-control pack-bulk-qty-input" data-gram="${s.gram}" data-label="${s.label}" value="0" placeholder="0">
        </div>
    `).join('');

    const html = `
        <form id="modal-pack-bulk-form">
            <div class="form-group">
                <label class="form-label">Source Bulk Coffee</label>
                <input type="text" class="form-control" value="${bulk.coffee_name} (Available: ${parseFloat(bulk.bulk_available).toFixed(2)} kg)" readonly>
            </div>
            <div style="margin-top: 16px;">
                <label class="form-label">Quantity packed per size</label>
                <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    ${sizesHtml}
                </div>
            </div>
            <div id="pack-bulk-warning" class="hidden" style="background: rgba(234, 88, 12, 0.15); border: 1px solid #ea580c; color: #ea580c; padding: 6px 10px; border-radius: 6px; font-size: 0.8rem; margin-top: 10px;"></div>
            <div class="modal-footer-actions-lg">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Packing</button>
            </div>
        </form>
    `;

    openModal(`Pack: ${bulk.coffee_name}`, html, '600px');

    const getQtyInputs = () => Array.from(document.querySelectorAll('.pack-bulk-qty-input'));
    const warningEl = document.getElementById('pack-bulk-warning');
    const avail = parseFloat(bulk.bulk_available) || 0;

    const recalcWarning = () => {
        const totalKg = getQtyInputs().reduce((sum, inp) => {
            const gram = parseFloat(inp.getAttribute('data-gram')) || 0;
            const qty = parseInt(inp.value) || 0;
            return sum + (gram * qty) / 1000;
        }, 0);
        if (totalKg > avail) {
            warningEl.classList.remove('hidden');
            warningEl.textContent = `Required quantity ${totalKg.toFixed(2)} kg exceeds available stock ${avail.toFixed(2)} kg.`;
        } else {
            warningEl.classList.add('hidden');
        }
    };
    getQtyInputs().forEach(inp => inp.addEventListener('input', recalcWarning));

    document.getElementById('modal-pack-bulk-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const additions = getQtyInputs()
            .map(inp => ({ gram: parseFloat(inp.getAttribute('data-gram')), label: inp.getAttribute('data-label'), qty: parseInt(inp.value) || 0 }))
            .filter(a => a.qty > 0);

        if (additions.length === 0) {
            alert('Please input quantity for at least one size.');
            return;
        }

        const totalKg = additions.reduce((sum, a) => sum + (a.gram * a.qty) / 1000, 0);
        if (totalKg > avail) {
            const proceed = await showWarningModal(`Warning: required ${totalKg.toFixed(2)} kg exceeds available stock ${avail.toFixed(2)} kg.\n\nDo you want to proceed anyway?`);
            if (!proceed) return;
        }

        try {
            // Atomic RPC (STOCK_LEDGER_PLAN.md Phase 6) — this used to
            // re-fetch fresh first specifically to dodge a stale read (see
            // the removed comment), which the RPC's row lock makes
            // unnecessary.
            const { error: consumeErr } = await window.supabaseClient.rpc('consume_bulk_lot', {
                p_bulk_id: bulk.id, p_kg: totalKg,
                p_operation: 'pack', p_reason: `Packed ${additions.map(a => `${a.qty}x${a.gram}g`).join(', ')}`,
                p_user: (currentUser && currentUser.name) || null
            });
            if (consumeErr) console.error('consume_bulk_lot RPC failed:', consumeErr);

            // Release whatever sales-order reservation(s) this bulk carried
            // (see database bulk_reservations comment / js/sales.js
            // approveSalesOrder) — the kg just packed is no longer "loose
            // bulk waiting to be packed", so it shouldn't keep counting
            // against what a future order sees as reserved-and-unavailable.
            // Oldest reservation first, same FIFO convention used
            // everywhere else in this file; a reservation not fully covered
            // by this pack just shrinks instead of clearing.
            await releaseBulkReservations(bulk.id, totalKg);

            const packingDate = new Date().toISOString().split('T')[0];

            // V2 1G-1 (packed_coffee_lots foundation): resolve/create today's
            // production lot for this bulk so each size packed can be linked
            // back to it — same lot the "Print Barcode" step uses, so a
            // sticker printed either before or after packing points at the
            // same lot record.
            const productionLot = await getOrCreateProductionLot(bulk, machines, greenbeans, recipes, roastBatches);

            for (const add of additions) {
                const packedRow = await getOrCreatePackedCoffeeRow(bulk.coffee_name, add.gram, bulk.machine_id);
                if (!packedRow) continue;
                // packed_coffee.quantity is trigger-derived (sync_packed_coffee_quantity)
                // from the packed_coffee_lots write below — no separate write needed.
                const packedLot = await getOrCreatePackedCoffeeLot(packedRow.id, add.qty, productionLot ? productionLot.id : null);
                await saveData('packing_records', {
                    date: packingDate,
                    pack_date: packingDate,
                    source_type: bulk.coffee_type,
                    source_id: bulk.coffee_type === 'Single' ? bulk.single_coffee_id : bulk.blend_recipe_id,
                    coffee_name: bulk.coffee_name,
                    machine_id: bulk.machine_id,
                    bag_size_g: add.gram,
                    size_g: add.gram,
                    quantity: add.qty,
                    status: 'Completed',
                    packed_coffee_lot_id: packedLot ? packedLot.id : null
                });
            }

            document.getElementById('btn-close-modal').click();
            await showWarningModal('Packing saved successfully.', false, null, null, 'success');
            await loadPackingSection();
            scheduleDashboardRefresh();
        } catch (err) {
            console.error('Pack bulk submit error:', err);
            alert('Error during packing save: ' + err.message);
        }
    });
}

// Shrinks/deletes bulk_reservations rows for one bulk_roasted_coffee_id by
// `kgToRelease`, oldest reservation first — called whenever that bulk
// actually gets packed (openPackBulkModal above). Without this, a
// reservation never clears once the physical stock it was protecting has
// already turned into packed_coffee, permanently hiding that kg from every
// future order even though it was never really lost, just already
// accounted for a different way (packed stock's own order-linkage, via
// dispatch checkout).
async function releaseBulkReservations(bulkId, kgToRelease) {
    let remaining = kgToRelease;
    if (remaining <= 0.0001) return;
    const { data: reservations } = await fetchData('bulk_reservations');
    const mine = (reservations || [])
        .filter(r => r.bulk_roasted_coffee_id === bulkId)
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0) || a.id - b.id);
    for (const res of mine) {
        if (remaining <= 0.0001) break;
        const kg = parseFloat(res.kg) || 0;
        if (kg <= 0.0001) continue;
        if (kg <= remaining) {
            await deleteData('bulk_reservations', res.id);
            remaining -= kg;
        } else {
            await saveData('bulk_reservations', { id: res.id, kg: kg - remaining });
            remaining = 0;
        }
    }
}

// V2 barcode label fix: Print Barcode and Pack are deliberately kept as two
// separate steps (Print may happen before the bags are actually filled),
// but a barcode printed ahead of packing has to resolve to the SAME
// packed_coffee_lots row that Pack later adds real quantity to — otherwise
// dispatch-checkout scanning never matches what's actually stuck on the bag.
// Fix: key the lot by (packed_coffee_id, production_lot_id) instead of by
// "which action created it first". Whichever of Print/Pack runs first
// creates the row; the other just adds to it. Custom/manual packing (no
// source bulk lot, productionLotId null) keeps the old one-row-per-action
// behavior, since there's no shared production lot to converge multiple
// actions onto.
//
// lot_code used to be `PKL-{id}-${Date.now()}` (13-digit ms timestamp, too
// dense to scan reliably), then `PKL{id}-{YYMMDD}-{seq}` (packed_coffee_id +
// pack date). Now built as `{coffee code}-{machine code}{roast MMDDYY}-{seq}`
// — same shape as production_lots.lot_code (buildLotCode above, which also
// dropped its old 'LOT-' prefix so both lot-code spaces read consistently)
// — per user request: the packing team reads this code directly off the
// sticker to judge FIFO order (older roast date = pack first), so it needs
// to be a human-meaningful lot identity, not an opaque id+timestamp. `seq`
// counts existing packed_coffee_lots for this exact coffee+machine pairing
// (all-time, not per-day) — same counting rule as production_lots' own lot
// numbering. Still only ever shown as
// human-readable text under the barcode — the barcode itself encodes this
// row's numeric id (see printLotBarcodeLabels).
async function getOrCreatePackedCoffeeLot(packedCoffeeId, qty, productionLotId, movementOperation = 'pack', movementRefTable = null, movementRefId = null, forceNewLot = false) {
    const { data: existingLots } = await fetchData('packed_coffee_lots');

    // A production-linked pack merges on (packed_coffee_id, production_lot_id).
    // A MANUAL pack (no production lot) merges on packed_coffee_id alone —
    // packed_coffee is itself already keyed by coffee name + size + machine
    // (see getOrCreatePackedCoffeeRow), so this is exactly "same coffee, same
    // machine, same size = same lot", which is what warehouse stock entry
    // wants: one stable strip code per shelf position instead of a new code
    // per entry session. Before this, manual entries always inserted a fresh
    // lot, so finding 10 more bags of something already entered produced a
    // second lot with a second sticker code for the same physical shelf.
    //
    // remaining_pcs > 0 is deliberate, not incidental: zeroed-out lots stay in
    // this table as history, and merging into one would resurrect it and
    // inherit its strip_code — a code that may already be printed on older
    // physical packaging. Requiring live stock means a fresh entry always
    // starts a clean code, and only genuinely-current stock accumulates.
    //
    // forceNewLot skips this merge entirely (STOCK_LEDGER_PLAN.md F6): a
    // stocktake/manual-edit correction is not a real new pack, and merging
    // its delta into an existing lot would rewrite that lot's quantity_pcs
    // — its historical "how much was originally packed" figure — which must
    // stay whatever was physically packed at the time. A correction gets
    // its own lot instead. applyPackedCoffeeManualQtyDelta's increase path
    // is the only caller that sets this.
    const existing = forceNewLot ? null : (productionLotId
        ? (existingLots || []).find(l => l.packed_coffee_id === packedCoffeeId && l.production_lot_id === productionLotId)
        : (existingLots || []).find(l => l.packed_coffee_id === packedCoffeeId && !l.production_lot_id && (parseInt(l.remaining_pcs) || 0) > 0));
    if (existing) {
        // remaining_pcs goes through the atomic RPC (STOCK_LEDGER_PLAN.md
        // Phase 1) — two concurrent "pack more into this shelf lot" actions
        // must not silently lose pcs the way a plain read-modify-write did.
        const newQtyPcs = (parseInt(existing.quantity_pcs) || 0) + qty;
        const { data: newRemainingResult, error: refundErr } = await window.supabaseClient.rpc('refund_packed_lot', {
            p_lot_id: existing.id, p_pcs: qty,
            p_operation: movementOperation, p_ref_table: movementRefTable || 'packed_coffee', p_ref_id: movementRefId || packedCoffeeId,
            p_reason: productionLotId ? `production_lot #${productionLotId}` : 'manual pack',
            p_user: (currentUser && currentUser.name) || null
        });
        if (refundErr) { console.error('refund_packed_lot RPC failed:', refundErr); return null; }
        const newRemaining = parseInt(newRemainingResult) || 0;
        await saveData('packed_coffee_lots', { id: existing.id, quantity_pcs: newQtyPcs });
        return { ...existing, quantity_pcs: newQtyPcs, remaining_pcs: newRemaining };
    }

    const [
        { data: packedList },
        { data: machines },
        { data: greenbeans },
        { data: recipes },
        { data: productionLots },
        { data: packagingSizes }
    ] = await Promise.all([
        fetchData('packed_coffee'),
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('production_lots'),
        fetchData('packaging_sizes')
    ]);

    const sanitize = (s) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'X';
    const packedRow = (packedList || []).find(p => p.id === packedCoffeeId);
    const productionLot = productionLotId ? (productionLots || []).find(l => l.id === productionLotId) : null;

    // Coffee identity: prefer the linked production lot's (bulk source is
    // authoritative), else the packed row's own single/blend id, else fall
    // back to matching the typed custom name against a real coffee/recipe
    // (manual/custom packing has no id link, only a free-text name).
    const singleId = productionLot ? productionLot.single_coffee_id : (packedRow ? packedRow.single_coffee_id : null);
    const blendId = productionLot ? productionLot.blend_recipe_id : (packedRow ? packedRow.blend_recipe_id : null);
    const customName = (productionLot && productionLot.coffee_name) || (packedRow && packedRow.custom_coffee_name) || '';

    let coffeeCode;
    if (singleId) {
        const gb = (greenbeans || []).find(g => g.id === singleId);
        coffeeCode = gb ? (gb.code || gb.name) : customName;
    } else if (blendId) {
        const r = (recipes || []).find(rec => rec.id === blendId);
        coffeeCode = r ? (r.code || r.name) : customName;
    } else {
        const gbMatch = (greenbeans || []).find(g => g.name === customName);
        const rMatch = (recipes || []).find(r => r.name === customName);
        coffeeCode = gbMatch ? (gbMatch.code || gbMatch.name) : (rMatch ? (rMatch.code || rMatch.name) : customName);
    }
    coffeeCode = sanitize(coffeeCode);

    const machineId = productionLot ? productionLot.machine_id : (packedRow ? packedRow.machine_id : null);
    const machine = (machines || []).find(m => m.id === machineId);
    const machineCode = sanitize(machine ? (machine.code || machine.name) : 'M');

    const todayStr = new Date().toISOString().split('T')[0];
    // Roast date = the linked production lot's production_date; manual/
    // custom packing has no roast date to draw from, so falls back to
    // today (the pack date) — same fallback pattern used elsewhere for
    // lots that predate/lack richer traceability data.
    const roastDateStr = productionLot ? productionLot.production_date : todayStr;
    const [ry, rm, rd] = roastDateStr.split('-');
    const mmddyy = `${rm}${rd}${ry.slice(2)}`;

    const packedById = new Map((packedList || []).map(p => [p.id, p]));
    const sameCoffeeMachineCount = (existingLots || []).filter(l => {
        const p = packedById.get(l.packed_coffee_id);
        if (!p || p.machine_id !== machineId) return false;
        if (singleId) return p.single_coffee_id === singleId;
        if (blendId) return p.blend_recipe_id === blendId;
        return (p.custom_coffee_name || '') === customName;
    }).length;

    let seq = sameCoffeeMachineCount + 1;
    let lotCode = `${coffeeCode}-${machineCode}${mmddyy}-${seq}`;
    while ((existingLots || []).some(l => l.lot_code === lotCode)) {
        seq++;
        lotCode = `${coffeeCode}-${machineCode}${mmddyy}-${seq}`;
    }

    const insertPayload = {
        packed_coffee_id: packedCoffeeId,
        roast_batch_id: null,
        lot_code: lotCode,
        quantity_pcs: qty,
        remaining_pcs: qty,
        packed_date: todayStr,
        production_lot_id: productionLotId,
        // Movement context so the log_packed_stock_movement trigger records
        // WHY this lot exists (STOCK_LEDGER_PLAN.md Phase 3/4) — without
        // this, every new lot logs as an opaque 'lot_created' with no ref,
        // which is especially misleading for a forceNewLot correction lot
        // (it would be indistinguishable from a genuine new pack).
        mv_operation: movementOperation,
        mv_ref_table: movementRefTable,
        mv_ref_id: movementRefId,
        mv_reason: productionLotId ? `production_lot #${productionLotId}` : (forceNewLot ? 'correction' : 'manual pack'),
        mv_user: (currentUser && currentUser.name) || null
    };
    // V2 FIFO strip code: a production-lot-linked pack copies that lot's
    // batch_no (every size packed from the same bulk/day shares one number —
    // see database/fifo_strip_code_migration.sql). A manual/unlinked pack
    // has no production lot to copy from, so batch_no is left out of the
    // payload entirely and the column's own DEFAULT (nextval on the shared
    // sequence) assigns one — atomic, so concurrent manual packs can't
    // collide the way the old read-then-write lot lookup could (see
    // packed_coffee_dedup_migration.sql for that exact bug elsewhere).
    if (productionLot && productionLot.batch_no !== null && productionLot.batch_no !== undefined) {
        insertPayload.batch_no = productionLot.batch_no;
    }

    const { data: newLot, error } = await saveData('packed_coffee_lots', insertPayload);
    if (error) { console.error('Failed to create packed_coffee_lots row:', error); return null; }

    // strip_code depends on batch_no, which for a manual/unlinked pack we
    // only learn AFTER insert (the DB assigned it) — so it's computed and
    // persisted as a quick follow-up write rather than in the same insert.
    if (newLot.batch_no !== null && newLot.batch_no !== undefined) {
        const sizeDef = (packagingSizes || []).find(s => parseInt(s.gram) === parseInt(packedRow ? packedRow.bag_size_g : NaN));
        if (sizeDef && sizeDef.size_digit !== null && sizeDef.size_digit !== undefined) {
            const stripCode = `${sizeDef.size_digit}${String(newLot.batch_no).padStart(4, '0')}`;
            const { error: stripErr } = await saveData('packed_coffee_lots', { id: newLot.id, strip_code: stripCode });
            if (!stripErr) newLot.strip_code = stripCode;
        }
    }

    return newLot;
}

// packed_coffee.quantity is trigger-derived (sync_packed_coffee_quantity) from
// SUM(packed_coffee_lots.remaining_pcs) — a manual stock-count correction (Adjust
// Stock / Edit Packed Stock) can no longer write packed_coffee.quantity directly,
// since the trigger would silently revert it the next time ANY lot for that row
// changes. Instead this applies the requested delta to the lots themselves:
// an increase lands in the existing/newest manual lot (via getOrCreatePackedCoffeeLot,
// same as a fresh manual pack); a decrease is drawn FIFO (oldest packed_date
// first, same convention as every other consumption flow in this file) across
// however many lots it takes, clamped so no lot goes negative.
// Returns true/false for whether the full delta was actually applied —
// added for Stock Opname Fase 6, which needs to detect a failed adjustment
// mid-posting to revert status safely (STOCK_OPNAME_PLAN.md §5.2). Existing
// callers that ignore the return value are unaffected.
async function applyPackedCoffeeManualQtyDelta(packedCoffeeId, delta, movementOperation = 'manual_edit', movementRefTable = null, movementRefId = null) {
    if (!delta) return true;
    if (delta > 0) {
        const lot = await getOrCreatePackedCoffeeLot(packedCoffeeId, delta, null, movementOperation, movementRefTable, movementRefId, true);
        return !!lot;
    }
    let remaining = -delta;
    const { data: lots } = await fetchData('packed_coffee_lots');
    const ordered = (lots || [])
        .filter(l => l.packed_coffee_id === packedCoffeeId && (parseInt(l.remaining_pcs) || 0) > 0)
        .sort((a, b) => (a.packed_date || '').localeCompare(b.packed_date || '') || a.id - b.id);
    for (const lot of ordered) {
        if (remaining <= 0) break;
        // Atomic RPC (STOCK_LEDGER_PLAN.md Phase 1) — clamps in the DB
        // against the lot's real current remaining_pcs, not this stale
        // `lots` snapshot.
        const { data: taken, error: consumeErr } = await window.supabaseClient.rpc('consume_packed_lot', {
            p_lot_id: lot.id, p_pcs: remaining,
            p_operation: movementOperation, p_ref_table: movementRefTable, p_ref_id: movementRefId,
            p_user: (currentUser && currentUser.name) || null
        });
        if (consumeErr) { console.error('consume_packed_lot RPC failed:', consumeErr); continue; }
        remaining -= parseInt(taken) || 0;
    }
    // Any shortfall (asking to remove more than the lots actually hold) is
    // simply not applied further — quantity floors at whatever the lots sum to.
    return remaining <= 0;
}

// Shared by openPackBulkModal, openPrintBarcodeModal, AND
// openCustomPackingModal so none of them can create two separate
// packed_coffee rows for the same name+size+machine — quantity starts at 0
// either way; callers add to it themselves (Pack/manual entry add the real
// count; Print Barcode never touches quantity, it's just reserving/reusing
// the row's identity for the barcode). Name match is case-insensitive —
// callers type/store the coffee name inconsistently in case.
//
// Race-safe: two concurrent callers both finding no existing row will both
// attempt an insert, but the partial unique index on (lower(custom_coffee_name),
// bag_size_g, machine_id) WHERE roast_batch_id IS NULL (see
// database/packed_coffee_dedup_migration.sql) lets only one insert succeed.
// The loser catches the unique-violation (Postgres 23505) and re-fetches to
// pick up the winner's row instead of creating a duplicate. This exact race
// was live in production 2026-07-28 (pre-fix): 3 concurrent Pack submissions
// for the same coffee+size+machine created 3 separate packed_coffee rows,
// each with its own quantity and its own packed_coffee_lots, fragmenting
// stock across them (surfaced as duplicate entries in the Custom Blend
// source-pool dropdown, and as the root risk for the new lot fifo_code below
// — two duplicate rows would each mint their own conflicting number).
async function getOrCreatePackedCoffeeRow(name, gram, machineId) {
    // Match with the " (Single)"/" (Blend)" type suffix stripped from BOTH
    // sides — callers are inconsistent about including it (roasting.js's
    // normal batch-completion path always appends it; its post-blend
    // leftover-distribution path and packing.js's manual/custom entry form
    // never do), and an exact-string match treated "BRAZIL ROSA (Single)"
    // and "BRAZIL ROSA" as two different coffees. Found 2026-08-22 via a
    // live duplicate: two packed_coffee rows for the same GIESEN/250g stock,
    // splitting what should have been one pool. The DB's own dedup index
    // (packed_coffee_dedup_migration.sql) only catches an EXACT repeat name,
    // so it never caught this — this in-memory match is what actually
    // prevents it now.
    const stripType = (s) => (s || '').trim().replace(/ \(Single\)$/i, '').replace(/ \(Blend\)$/i, '');
    const findExisting = (list) => (list || []).find(p =>
        !p.roast_batch_id &&
        stripType(p.custom_coffee_name).toLowerCase() === stripType(name).toLowerCase() &&
        parseInt(p.bag_size_g) === parseInt(gram) &&
        parseInt(p.machine_id) === parseInt(machineId)
    );

    const { data: packedList } = await fetchData('packed_coffee');
    const existing = findExisting(packedList);
    if (existing) return existing;

    const { data: savedPacked, error } = await saveData('packed_coffee', {
        roast_batch_id: null,
        machine_id: machineId,
        custom_coffee_name: name,
        bag_size_g: gram,
        quantity: 0,
        selling_price: 12.00
    });
    if (!error) return savedPacked;

    if (error.code === '23505') {
        const { data: freshList } = await fetchData('packed_coffee');
        const winner = findExisting(freshList);
        if (winner) return winner;
    }
    console.error('Failed to create packed_coffee row:', error);
    return null;
}

// Adjust Packed Coffee Stock level manually
async function adjustPackedStock(id) {
    const { data: packed } = await fetchData('packed_coffee');
    const record = packed.find(p => p.id === id);
    if (!record) return;

    const newQtyStr = prompt("Enter new inventory bag quantity count:", record.quantity);
    if (newQtyStr === null) return;
    const newQty = parseInt(newQtyStr);
    
    if (!isNaN(newQty) && newQty >= 0) {
        // quantity is trigger-derived from packed_coffee_lots — apply the
        // change as a lot delta, not a direct write (see applyPackedCoffeeManualQtyDelta).
        await applyPackedCoffeeManualQtyDelta(id, newQty - (parseInt(record.quantity) || 0), 'manual_edit', 'packed_coffee', id);
        loadPackingSection();
        scheduleDashboardRefresh();
    } else {
        alert(window.t("alert_invalid_qty"));
    }
}

async function loadBulkRoastedSection() {
    const [
        { data: bulkList },
        { data: machines }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('machines')
    ]);
    const tbody = document.getElementById('bulk-roasted-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Rewrite Header Dynamically
    const thead = tbody.parentElement.querySelector('thead');
    if (thead) {
        let thHtml = `<th data-i18n="col_name">${window.t ? window.t('col_name') || 'Coffee Name' : 'Coffee Name'}</th>`;
        machines.forEach(m => {
            thHtml += `<th>${m.name}</th>`;
        });
        thHtml += `<th>Action</th>`;
        thead.innerHTML = `<tr>${thHtml}</tr>`;
    }

    const activeBulk = [...bulkList]
        .filter(b => parseFloat(b.bulk_available) > 0.005);

    if (activeBulk.length === 0) {
        const colCount = 2 + machines.length;
        tbody.innerHTML = `<tr><td colspan="${colCount}" class="text-center-muted">${window.t ? window.t("msg_no_bulk_avail") || "No bulk coffee available." : "No bulk coffee available."}</td></tr>`;
        return;
    }

    const grouped = {};
    activeBulk.forEach(rec => {
        if (!grouped[rec.coffee_name]) {
            grouped[rec.coffee_name] = {
                coffee_name: rec.coffee_name,
                machineTotals: {}
            };
        }
        
        if (!grouped[rec.coffee_name].machineTotals[rec.machine_id]) {
            grouped[rec.coffee_name].machineTotals[rec.machine_id] = 0;
        }
        grouped[rec.coffee_name].machineTotals[rec.machine_id] += parseFloat(rec.bulk_available);
    });

    const groupedArr = Object.values(grouped).sort((a,b) => a.coffee_name.localeCompare(b.coffee_name));

    groupedArr.forEach(grp => {
        const tr = document.createElement('tr');
        let tds = `<td><strong>${grp.coffee_name}</strong></td>`;
        
        machines.forEach(m => {
            const val = grp.machineTotals[m.id] || 0;
            tds += `<td>${val > 0 ? `<strong>${val.toFixed(1)} kg</strong>` : '<span class="text-muted-color">-</span>'}</td>`;
        });
        
        tds += `
            <td class="text-nowrap">
                <button class="btn btn-outline btn-sm btn-edit-bulk" data-coffee="${encodeURIComponent(grp.coffee_name)}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle-mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>
                <button class="btn btn-danger btn-sm btn-delete-bulk ml-1" data-coffee="${encodeURIComponent(grp.coffee_name)}" ><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
            </td>
        `;
        tr.innerHTML = tds;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-edit-bulk').forEach(btn => {
        btn.addEventListener('click', () => openEditBulkModal(decodeURIComponent(btn.getAttribute('data-coffee'))));
    });

    document.querySelectorAll('.btn-delete-bulk').forEach(btn => {
        btn.addEventListener('click', async () => {
            const coffeeName = decodeURIComponent(btn.getAttribute('data-coffee'));
            const confirmed = await showWarningModal(`Are you sure you want to delete all bulk stock for "${coffeeName}"?\n\nThis action cannot be undone.`);
            if (!confirmed) return;
            const { data: allBulk } = await fetchData('bulk_roasted_coffee');
            const toDelete = (allBulk || []).filter(b => b.coffee_name === coffeeName);
            for (const item of toDelete) {
                await deleteData('bulk_roasted_coffee', item.id);
            }
            await loadBulkRoastedSection();
            scheduleDashboardRefresh();
        });
    });
}

async function openEditBulkModal(coffeeName) {
    const [
        { data: bulkList },
        { data: machines }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('machines')
    ]);
    
    const records = bulkList
        .filter(b => b.coffee_name === coffeeName)
        .sort((a, b) => (a.machine_id || 0) - (b.machine_id || 0) || (a.production_date || '').localeCompare(b.production_date || ''));

    let rowsHtml = '';
    records.forEach(rec => {
        const m = machines.find(m => m.id === rec.machine_id);
        const machineName = m ? m.name : 'Unknown';

        rowsHtml += `
            <div class="form-group" style="display:flex; justify-content:space-between; align-items:center; gap: 10px;">
                <label class="form-label flex-1-mb-0" >${machineName} <span style="font-weight:400; color:var(--text-muted); font-size:0.8rem;">(roasted ${rec.production_date || '-'})</span></label>
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="number" class="form-control bulk-edit-input" data-id="${rec.id}" value="${parseFloat(rec.bulk_available).toFixed(2)}" step="0.01" min="0" style="width: 100px;">
                    <span style="font-size:0.85rem; color:var(--text-secondary);">kg</span>
                </div>
            </div>
        `;
    });
    
    const html = `
        <div id="modal-edit-bulk-form">
            <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 20px;">Edit stock for <strong>${coffeeName}</strong></p>
            ${rowsHtml}
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="button" id="btn-save-edit-bulk" class="btn btn-primary">Save Changes</button>
            </div>
        </div>
    `;
    
    openModal('Edit Bulk Stock', html);
    
    document.getElementById('btn-save-edit-bulk').onclick = async () => {
        const inputs = document.querySelectorAll('.bulk-edit-input');
        for (const inp of inputs) {
            const id = parseInt(inp.getAttribute('data-id'));
            const newVal = parseFloat(inp.value);
            
            const targetRec = bulkList.find(b => b.id === id);
            if (targetRec && parseFloat(targetRec.bulk_available) !== newVal) {
                // Atomic RPC (STOCK_LEDGER_PLAN.md Phase 6).
                const { error: setErr } = await window.supabaseClient.rpc('set_bulk_lot_available', {
                    p_bulk_id: id, p_kg: newVal,
                    p_operation: 'manual_edit', p_ref_table: 'bulk_roasted_coffee', p_ref_id: id,
                    p_reason: `${targetRec.bulk_available} → ${newVal} kg`, p_user: (currentUser && currentUser.name) || null
                });
                if (setErr) console.error('set_bulk_lot_available RPC failed:', setErr);
            }
        }
        
        modalContainer.classList.add('hidden');
        loadBulkRoastedSection();
        scheduleDashboardRefresh();
    };
}

async function loadPackedCoffeeSection() {
    const [
        { data: packed },
        { data: batches },
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: sizes },
        { data: bulkRows }
    ] = await Promise.all([
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('packaging_sizes'),
        fetchData('bulk_roasted_coffee')
    ]);
    const activeSizes = (sizes || []).filter(s => s.is_visible).sort((a, b) => a.gram - b.gram);
    const tbody = document.getElementById('packed-coffee-stock-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // One-time cleanup for the user's specific requested row
    if (packed) {
        const filteredPacked = packed.filter(p => !(p.custom_coffee_name === 'Sidikalang Robusta (Single)' && parseInt(p.quantity) === 0));
        if (filteredPacked.length !== packed.length) {
            setMockTable('packed_coffee', filteredPacked);
            // update local variable
            packed.length = 0;
            packed.push(...filteredPacked);
        }
    }

    const resolved = (packed || []).map(item => {
        let coffeeName = item.custom_coffee_name || 'Roasted Coffee';
        let coffeeCode = '';
        if (item.roast_batch_id) {
            const b = batches.find(x => x.id === item.roast_batch_id);
            if (b) {
                if (b.coffee_type === 'Single') {
                    const gb = greenbeans.find(g => g.id === b.single_coffee_id);
                    if (gb) { coffeeName = gb.name; coffeeCode = gb.code || ''; }
                } else {
                    const r = recipes.find(rec => rec.id === b.blend_recipe_id);
                    if (r) { coffeeName = r.name; coffeeCode = r.code || ''; }
                }
            }
        }

        // Normalize names to avoid duplicates like "Sidikalang Robusta (Single)" vs "Sidikalang Robusta"
        if (coffeeName.endsWith(' (Single)')) {
            coffeeName = coffeeName.replace(' (Single)', '');
        }
        if (coffeeName.endsWith(' (Blend)')) {
            coffeeName = coffeeName.replace(' (Blend)', '');
        }
        // Custom/manual packing entries have no roast_batch_id to resolve a
        // code from directly — fall back to matching by name against the
        // greenbean/recipe lists, same identity loadPackedCoffeeSection groups by.
        // Custom Blend/Post-Blend items match neither (their name is freely
        // typed, not a real green_coffee/blend_recipes row) — their code
        // lives on the originating bulk_roasted_coffee row's
        // custom_coffee_code instead, matched by the same coffee_name.
        if (!coffeeCode) {
            const gbMatch = greenbeans.find(g => g.name === coffeeName);
            const rMatch = recipes.find(r => r.name === coffeeName);
            const pbMatch = (bulkRows || []).find(b => b.is_post_blend && b.coffee_name === coffeeName);
            coffeeCode = (gbMatch && gbMatch.code) || (rMatch && rMatch.code) || (pbMatch && pbMatch.custom_coffee_code) || '';
        }

        return { ...item, coffeeName, coffeeCode };
    });

    // Group by coffee name and then machine
    const grouped = {};

    // First, ensure ALL green beans and blend recipes are present in the grouped object
    (greenbeans || []).forEach(gb => {
        if (!grouped[gb.name]) grouped[gb.name] = { coffeeName: gb.name, coffeeCode: gb.code || '', machines: {} };
    });
    (recipes || []).forEach(r => {
        if (!grouped[r.name]) grouped[r.name] = { coffeeName: r.name, coffeeCode: r.code || '', machines: {} };
    });

    resolved.forEach(item => {
        let machineName = 'Unknown';
        if (item.machine_id) {
            const m = machines.find(mac => mac.id === item.machine_id);
            if (m) machineName = m.name;
        } else if (item.roast_batch_id) {
            const b = batches.find(x => x.id === item.roast_batch_id);
            if (b && b.machine_id) {
                const m = machines.find(mac => mac.id === b.machine_id);
                if (m) machineName = m.name;
            }
        }

        item.machineName = machineName;
        const groupKey = item.coffeeName;

        if (!grouped[groupKey]) grouped[groupKey] = { coffeeName: item.coffeeName, coffeeCode: item.coffeeCode, machines: {} };
        if (!grouped[groupKey].machines[machineName]) {
            grouped[groupKey].machines[machineName] = { machineName: machineName, sizes: {} };
        }
        
        const sizeKey = item.bag_size_g || 0;
        if (!grouped[groupKey].machines[machineName].sizes[sizeKey]) {
            grouped[groupKey].machines[machineName].sizes[sizeKey] = { sizeG: sizeKey, qty: 0 };
        }
        grouped[groupKey].machines[machineName].sizes[sizeKey].qty += parseInt(item.quantity) || 0;
    });
    
    // For any coffee that has NO machines (never packed), give it an 'Unknown' machine with 0 stock for active sizes
    Object.values(grouped).forEach(group => {
        if (Object.keys(group.machines).length === 0) {
            group.machines['Unknown'] = { machineName: 'Unknown', sizes: {} };
            activeSizes.forEach(sz => {
                group.machines['Unknown'].sizes[sz.gram] = { sizeG: sz.gram, qty: 0 };
            });
        }
    });

    // Machine columns come straight from the real machines table — no
    // synthetic "Unknown" column. Stock that couldn't be attributed to a
    // machine (grouped['...'].machines['Unknown'] above — e.g. old rows from
    // before manual packing required picking a machine) is not silently
    // dropped from the table: it's still counted in the Total column below,
    // just not broken out into its own per-machine column.
    const activeMachinesList = machines.slice().sort((a,b) => a.name.localeCompare(b.name));

    // Update thead — 2-row header (machine name spanning its active-size
    // columns, then a size sub-row) instead of one machine column that
    // stacked every size as its own line inside the body cell. Flattening to
    // one column per machine×size combo makes every body row exactly one
    // line tall, so far more coffees fit on screen without scrolling — same
    // rowspan/colspan pattern already used by the Daily Achievement table.
    // A final "Total" group (one column per size, summed across every
    // machine bucket including any unattributed "Unknown" stock) closes out
    // the header/body so the grand total per size is always visible without
    // needing to add up the machine columns by hand.
    const theadEl = document.getElementById('packed-coffee-stock-table-thead');
    const sizeCount = Math.max(1, activeSizes.length);
    if (theadEl) {
        let row1 = `<tr><th rowspan="2" data-i18n="col_name">${window.t ? window.t('col_name') : 'Coffee Name'}</th>`;
        activeMachinesList.forEach((m, idx) => {
            const groupBorder = idx > 0 ? 'border-left: 2px solid var(--border);' : '';
            row1 += `<th colspan="${sizeCount}" class="text-center" style="${groupBorder}">${m.name}</th>`;
        });
        row1 += `<th colspan="${sizeCount}" class="text-center" style="border-left: 2px solid var(--border); font-weight:700;" data-i18n="col_total">${window.t ? window.t('col_total') : 'Total'}</th></tr>`;

        let row2 = '<tr>';
        activeMachinesList.forEach((m, mIdx) => {
            activeSizes.forEach((sz, szIdx) => {
                const groupBorder = (mIdx > 0 && szIdx === 0) ? 'border-left: 2px solid var(--border);' : '';
                row2 += `<th class="text-center" style="background-color: rgba(0,0,0,0.03); font-size: 0.72rem; ${groupBorder}">${sz.gram}g</th>`;
            });
        });
        activeSizes.forEach((sz, szIdx) => {
            const groupBorder = szIdx === 0 ? 'border-left: 2px solid var(--border);' : '';
            row2 += `<th class="text-center" style="background-color: rgba(0,0,0,0.03); font-size: 0.72rem; font-weight:700; ${groupBorder}">${sz.gram}g</th>`;
        });
        row2 += '</tr>';

        theadEl.innerHTML = row1 + row2;
    }

    if (Object.keys(grouped).length === 0) {
        tbody.innerHTML = `<tr><td colspan="${(activeMachinesList.length + 1) * sizeCount + 1}" class="text-center-muted">${window.t ? window.t("msg_no_packed_avail") : 'No packed coffee available.'}</td></tr>`;
        return;
    }

    Object.values(grouped).sort((a,b) => a.coffeeName.localeCompare(b.coffeeName)).forEach(group => {
        const tr = document.createElement('tr');

        tr.classList.add('packed-stock-row');
        tr.setAttribute('data-coffee', encodeURIComponent(group.coffeeName));
        tr.style.cursor = 'pointer';
        tr.title = 'Click to view/edit stock by lot';

        const codeLabel = group.coffeeCode ? `<code style="font-size:0.78rem; color:var(--text-muted); margin-right:6px;">${group.coffeeCode}</code>` : '';
        let html = `<td>${codeLabel}<strong>${group.coffeeName}</strong></td>`;

        activeMachinesList.forEach((mach, mIdx) => {
            const machData = group.machines[mach.name] || { sizes: {} };
            activeSizes.forEach((sz, szIdx) => {
                const qty = machData.sizes[sz.gram] ? machData.sizes[sz.gram].qty : 0;
                const minSizes = companySettings.min_stock_packed_sizes || {};
                const minQty = minSizes[sz.gram] || 0;
                const isLow = qty < minQty;
                const colorStyle = isLow ? 'color:var(--danger); font-weight:700;' : 'color:var(--text-secondary); font-weight:600;';
                const groupBorder = (mIdx > 0 && szIdx === 0) ? 'border-left: 2px solid var(--border);' : '';
                html += `<td class="text-center" style="${colorStyle} ${groupBorder}">${qty}</td>`;
            });
        });

        // Total per size across every machine bucket in this group,
        // including any "Unknown" (unattributed) stock — see the comment on
        // activeMachinesList above for why that bucket has no column of its
        // own but must still be counted here.
        activeSizes.forEach((sz, szIdx) => {
            const total = Object.values(group.machines).reduce((sum, md) => sum + (md.sizes[sz.gram] ? md.sizes[sz.gram].qty : 0), 0);
            const groupBorder = szIdx === 0 ? 'border-left: 2px solid var(--border);' : '';
            html += `<td class="text-center" style="font-weight:700; ${groupBorder}">${total}</td>`;
        });

        tr.innerHTML = html;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.packed-stock-row').forEach(row => {
        row.addEventListener('click', () => openStockByLotModal(decodeURIComponent(row.getAttribute('data-coffee'))));
    });
}

// V2 1G/Phase 7 (STOCK_LEDGER_PLAN.md): combined "Stock by Lot" view and
// edit — merges what used to be two separate modals (a read-only drill-down
// and a stocktake-correction form) into one, so there's a single place to
// see and correct a coffee's per-lot stock. Read-only by default; the
// footer's Edit button switches every row's quantity to an input and swaps
// in a per-lot Delete button. All edits go through set_packed_lot_remaining
// (STOCK_LEDGER_PLAN.md Phase 1, mv_operation='manual_edit') so every
// correction is logged the same way a stocktake or checkout draw is.
async function openStockByLotModal(coffeeName) {
    const [
        { data: packed },
        { data: packedLots },
        { data: machines },
        { data: batches },
        { data: greenbeans },
        { data: recipes },
        { data: productionLots },
        { data: bulkRoasted }
    ] = await Promise.all([
        fetchData('packed_coffee'),
        fetchData('packed_coffee_lots'),
        fetchData('machines'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('production_lots'),
        fetchData('bulk_roasted_coffee')
    ]);

    const resolved = (packed || []).map(item => {
        let name = item.custom_coffee_name || 'Roasted Coffee';
        if (item.roast_batch_id) {
            const b = (batches || []).find(x => x.id === item.roast_batch_id);
            if (b) {
                if (b.coffee_type === 'Single') {
                    const gb = (greenbeans || []).find(g => g.id === b.single_coffee_id);
                    if (gb) name = gb.name;
                } else {
                    const r = (recipes || []).find(rec => rec.id === b.blend_recipe_id);
                    if (r) name = r.name;
                }
            }
        }
        // Match loadPackedCoffeeSection's grouping key exactly — it strips
        // these suffixes off custom_coffee_name-sourced rows (e.g. bulk-pack
        // entries are named "X (Single)"/"X (Blend)"), so coffeeName arrives
        // here already stripped.
        name = name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
        return { ...item, resolvedName: name };
    });

    const gbMatch = (greenbeans || []).find(g => g.name === coffeeName);
    const rMatch = (recipes || []).find(r => r.name === coffeeName);
    const coffeeCode = (gbMatch && gbMatch.code) || (rMatch && rMatch.code) || '';
    const displayName = coffeeCode ? `${coffeeCode} — ${coffeeName}` : coffeeName;

    // dd-mm-yyyy per STOCK_LEDGER_PLAN.md Phase 7 — string split, not a Date
    // round-trip, since these are already plain YYYY-MM-DD DATE columns and
    // a Date object would risk a timezone-shifted day.
    const fmtDate = (iso) => {
        if (!iso) return '-';
        const parts = iso.split('-');
        return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : iso;
    };

    const matchingPackedIds = new Set(resolved.filter(r => r.resolvedName === coffeeName).map(r => r.id));
    const packedById = new Map((packed || []).map(p => [p.id, p]));
    const allLots = (packedLots || [])
        // Zero-stock lots stay hidden (STOCK_LEDGER_PLAN.md Phase 7,
        // confirmed decision) — they remain in packed_coffee_lots/the
        // movement ledger as history, just not shown in this working view.
        .filter(pl => matchingPackedIds.has(pl.packed_coffee_id) && (parseInt(pl.remaining_pcs) || 0) > 0)
        .map(pl => {
            const parentPacked = packedById.get(pl.packed_coffee_id);
            const machine = parentPacked && parentPacked.machine_id ? (machines || []).find(m => m.id === parentPacked.machine_id) : null;
            // Roast date only exists for production-linked lots (production_lots
            // is one row per bulk-roasted day, production_date IS the roast
            // date). Manual/warehouse-counted lots have no production_lot_id
            // and therefore no roast date to show — deliberate, per the
            // decision that physical packaging already carries it for those.
            const productionLot = pl.production_lot_id ? (productionLots || []).find(l => l.id === pl.production_lot_id) : null;
            const bulk = productionLot && productionLot.bulk_roasted_coffee_id
                ? (bulkRoasted || []).find(b => b.id === productionLot.bulk_roasted_coffee_id) : null;
            return {
                lotId: pl.id,
                lotCode: pl.lot_code,
                stripCode: pl.strip_code,
                machineName: machine ? machine.name : 'Unknown',
                machineId: parentPacked ? parentPacked.machine_id : null,
                sizeG: parentPacked ? parseInt(parentPacked.bag_size_g) || 0 : 0,
                roastDate: productionLot ? productionLot.production_date : null,
                packedDate: pl.packed_date,
                remaining: parseInt(pl.remaining_pcs) || 0,
                // No production lot behind it = counted straight off the shelf
                // rather than produced through Ready to Pack, which is exactly
                // the stock the KELUAR DULU sticker is for — so the checkbox
                // in the print dialog defaults to this.
                isManual: !pl.production_lot_id,
                isBlend: !!(bulk && bulk.is_post_blend),
                isRepack: !!(bulk && bulk.is_repack)
            };
        });

    // Two side-by-side columns split by bag size (further sizes become
    // additional columns) — machine is shown as a tag on each row instead
    // of the old modal's separate machine-heading groups. Rows within a
    // column stay sorted machine-then-date so "pick first" still marks
    // exactly the lot FIFO dispatch would pick next for that machine.
    const sizeGroups = new Map();
    allLots.forEach(l => {
        if (!sizeGroups.has(l.sizeG)) sizeGroups.set(l.sizeG, []);
        sizeGroups.get(l.sizeG).push(l);
    });
    // Largest size first (STOCK_LEDGER_PLAN.md Phase 7 spec: "1000g left,
    // 250g right") — descending, not the ascending order that would put
    // the smallest size on the left.
    const sortedSizes = [...sizeGroups.keys()].sort((a, b) => b - a);
    sortedSizes.forEach(sz => {
        const rows = sizeGroups.get(sz);
        rows.sort((a, b) => a.machineName.localeCompare(b.machineName) || new Date(a.packedDate || 0) - new Date(b.packedDate || 0));
        let prevMachine = null;
        rows.forEach(r => {
            r.pickFirst = r.machineName !== prevMachine;
            prevMachine = r.machineName;
        });
    });

    // Same gate as the Barcode button on Ready to Pack cards — printing a
    // sticker is the same privilege wherever it happens.
    const canPrintSticker = hasPermission('packing_print_barcode');
    const allLotsById = new Map(allLots.map(r => [r.lotId, r]));

    const rowHtml = (r, editMode) => `
        <div class="sbl-row" data-lot-id="${r.lotId}">
            <div class="sbl-row-top">
                <span class="sbl-row-code">${r.stripCode ? `<b>${r.stripCode}</b>` : `<code>${r.lotCode}</code>`}</span>
                <span class="sbl-tag-machine">${r.machineName}</span>
                ${r.pickFirst ? '<span class="sbl-badge sbl-badge-pick">PICK FIRST</span>' : ''}
                ${r.isBlend ? '<span class="badge-post-blend sbl-badge" style="border-radius:4px;">Blend</span>' : ''}
                ${r.isRepack ? '<span class="badge-repack sbl-badge" style="border-radius:4px;" data-i18n="badge_repack">Repack</span>' : ''}
            </div>
            <div class="sbl-row-bottom">
                <span class="sbl-row-dates">Roast ${fmtDate(r.roastDate)} &middot; Packed ${fmtDate(r.packedDate)}</span>
                <span class="sbl-row-qty">
                    <span class="sbl-qty-view" ${editMode ? 'hidden' : ''}>${r.remaining} pcs</span>
                    <input type="number" class="form-control sbl-qty-input" data-lot-id="${r.lotId}" value="${r.remaining}" min="0" ${editMode ? '' : 'hidden'}>
                    ${!editMode && r.stripCode ? `<button type="button" class="btn btn-secondary btn-sm sbl-print-lot" data-lot-id="${r.lotId}" title="${canPrintSticker ? 'Print sticker' : ''}"><i class="icon-printer"></i></button>` : ''}
                    <button type="button" class="btn btn-danger btn-sm sbl-delete-lot" data-lot-id="${r.lotId}" title="Delete this lot" ${editMode ? '' : 'hidden'}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                    </button>
                </span>
            </div>
        </div>
    `;

    const renderColumns = (editMode, deletedLotIds) => {
        if (allLots.length === 0) {
            return `<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">No per-lot stock recorded yet for this coffee — only packing done after this feature shipped is tracked by lot.</div>`;
        }
        const cols = sortedSizes.map(sz => {
            const rows = (sizeGroups.get(sz) || []).filter(r => !deletedLotIds.has(r.lotId));
            const total = rows.reduce((s, r) => s + r.remaining, 0);
            return `
                <div class="sbl-column">
                    <div class="sbl-column-head"><span>${sz}g</span><span class="sbl-column-total">${total} pcs</span></div>
                    <div class="sbl-column-body">${rows.length ? rows.map(r => rowHtml(r, editMode)).join('') : '<div class="sbl-empty">No stock</div>'}</div>
                </div>
            `;
        });
        return `<div class="sbl-columns" style="grid-template-columns: repeat(${sortedSizes.length}, minmax(230px, 1fr));">${cols.join('')}</div>`;
    };

    const html = `
        <div id="stock-by-lot-modal">
            <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 14px;">Packed stock by lot for <strong>${displayName}</strong>.</p>
            <div class="sbl-scroll" style="max-height: 480px; overflow-y: auto; overflow-x: auto;">${renderColumns(false, new Set())}</div>
            <div class="modal-footer-actions-lg" style="justify-content:space-between; align-items:center;">
                <span id="sbl-edit-hint" style="font-size:0.76rem; color:var(--text-muted);" hidden>Changes are logged as manual corrections.</span>
                <span id="sbl-view-spacer"></span>
                <div style="display:flex; gap:10px;">
                    <button type="button" id="sbl-btn-cancel" class="btn btn-secondary" hidden>Cancel</button>
                    <button type="button" id="sbl-btn-close" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Close</button>
                    <button type="button" id="sbl-btn-edit" class="btn btn-outline">Edit</button>
                    <button type="button" id="sbl-btn-save" class="btn btn-primary" hidden>Save changes</button>
                </div>
            </div>
        </div>
        <style>
            #stock-by-lot-modal .sbl-columns { display: grid; gap: 14px; align-items: start; }
            #stock-by-lot-modal .sbl-column { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
            #stock-by-lot-modal .sbl-column-head { display:flex; justify-content:space-between; align-items:center; padding: 8px 12px; background: var(--bg-glass-active); font-weight:700; font-size:0.85rem; }
            #stock-by-lot-modal .sbl-column-total { font-weight:600; color: var(--text-secondary); font-size:0.78rem; }
            #stock-by-lot-modal .sbl-column-body { display:flex; flex-direction:column; }
            #stock-by-lot-modal .sbl-row { padding: 8px 12px; border-top: 1px solid var(--border); display:flex; flex-direction:column; gap:4px; }
            #stock-by-lot-modal .sbl-column-body .sbl-row:first-child { border-top: none; }
            #stock-by-lot-modal .sbl-row-top { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:0.82rem; }
            #stock-by-lot-modal .sbl-row-bottom { display:flex; justify-content:space-between; align-items:center; gap:8px; }
            #stock-by-lot-modal .sbl-row-dates { font-size:0.72rem; color: var(--text-muted); white-space:nowrap; }
            #stock-by-lot-modal .sbl-row-qty { display:flex; align-items:center; gap:6px; }
            #stock-by-lot-modal .sbl-qty-view { font-weight:700; font-size:0.85rem; }
            #stock-by-lot-modal .sbl-qty-input { width: 72px; height: 30px; padding: 2px 8px; }
            #stock-by-lot-modal .sbl-tag-machine { font-size:0.68rem; font-weight:600; color: var(--text-secondary); background: var(--bg-glass-active); border-radius:4px; padding:1px 6px; }
            #stock-by-lot-modal .sbl-badge { font-size:0.62rem; font-weight:700; text-transform:uppercase; padding:1px 6px; vertical-align:middle; }
            #stock-by-lot-modal .sbl-badge-pick { color:var(--primary); background:rgba(45,106,79,0.12); border-radius:9999px; }
            #stock-by-lot-modal .sbl-empty { padding: 14px 12px; font-size:0.78rem; color: var(--text-muted); }
            /* .btn sets display:inline-flex, which beats the bare [hidden]
               attribute (author CSS always outranks the UA default that
               makes [hidden] work) — same fix already used by the dispatch
               checkout modal's Take/Cancel buttons, needed here too for the
               footer buttons and the per-row print/delete buttons. */
            #stock-by-lot-modal [hidden] { display: none !important; }
            /* Spinner arrows suppressed — the field is for keyboard entry only. */
            #stock-by-lot-modal input[type=number]::-webkit-outer-spin-button,
            #stock-by-lot-modal input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
            #stock-by-lot-modal input[type=number] { -moz-appearance: textfield; }
        </style>
    `;
    openModal(`Stock by Lot — ${displayName}`, html, '920px');

    let editMode = false;
    const deletedLotIds = new Set();

    const wireRowButtons = () => {
        if (canPrintSticker) {
            document.querySelectorAll('.sbl-print-lot').forEach(btn => {
                btn.addEventListener('click', () => {
                    const row = allLotsById.get(parseInt(btn.getAttribute('data-lot-id')));
                    if (row) openPrintLotStickerModal(row, coffeeName, machines);
                });
            });
        } else {
            document.querySelectorAll('.sbl-print-lot').forEach(btn => btn.style.display = 'none');
        }
        document.querySelectorAll('.sbl-delete-lot').forEach(btn => {
            btn.addEventListener('click', async () => {
                const lotId = parseInt(btn.getAttribute('data-lot-id'));
                const row = allLotsById.get(lotId);
                if (!row) return;
                const confirmed = await showWarningModal(`Delete lot ${row.stripCode || row.lotCode}? This removes ${row.remaining} pcs from stock. The lot is logged, not silently erased.`);
                if (!confirmed) return;
                deletedLotIds.add(lotId);
                rerender();
            });
        });
    };

    const rerender = () => {
        document.querySelector('#stock-by-lot-modal .sbl-scroll').innerHTML = renderColumns(editMode, deletedLotIds);
        wireRowButtons();
    };

    wireRowButtons();

    document.getElementById('sbl-btn-edit').addEventListener('click', () => {
        editMode = true;
        document.getElementById('sbl-btn-edit').hidden = true;
        document.getElementById('sbl-btn-close').hidden = true;
        document.getElementById('sbl-btn-cancel').hidden = false;
        document.getElementById('sbl-btn-save').hidden = false;
        document.getElementById('sbl-edit-hint').hidden = false;
        rerender();
    });

    document.getElementById('sbl-btn-cancel').addEventListener('click', () => {
        editMode = false;
        deletedLotIds.clear();
        document.getElementById('sbl-btn-edit').hidden = false;
        document.getElementById('sbl-btn-close').hidden = false;
        document.getElementById('sbl-btn-cancel').hidden = true;
        document.getElementById('sbl-btn-save').hidden = true;
        document.getElementById('sbl-edit-hint').hidden = true;
        rerender();
    });

    document.getElementById('sbl-btn-save').addEventListener('click', async () => {
        const inputs = document.querySelectorAll('.sbl-qty-input');
        for (const inp of inputs) {
            const lotId = parseInt(inp.getAttribute('data-lot-id'));
            if (deletedLotIds.has(lotId)) continue;
            const newVal = parseInt(inp.value);
            if (isNaN(newVal) || newVal < 0) continue;
            const row = allLotsById.get(lotId);
            if (row && row.remaining !== newVal) {
                // packed_coffee.quantity is trigger-derived from this write
                // (sync_packed_coffee_quantity) — no separate packed_coffee
                // write needed. Only remaining_pcs changes here, not
                // quantity_pcs — this corrects "how much is actually left",
                // not the historical record of what was originally packed.
                // Atomic RPC (STOCK_LEDGER_PLAN.md Phase 1).
                const { error: setErr } = await window.supabaseClient.rpc('set_packed_lot_remaining', {
                    p_lot_id: lotId, p_pcs: newVal,
                    p_operation: 'manual_edit', p_ref_table: 'packed_coffee_lots', p_ref_id: lotId,
                    p_reason: `${row.remaining} → ${newVal} pcs (Stock by Lot)`, p_user: (currentUser && currentUser.name) || null
                });
                if (setErr) console.error('set_packed_lot_remaining RPC failed:', setErr);
            }
        }
        // A straight DELETE, not an RPC — Phase 1's RPCs exist to make a
        // read-modify-write atomic, and a delete has no such race. The
        // BEFORE DELETE trigger (STOCK_LEDGER_PLAN.md Phase 2) already logs
        // it as 'lot_deleted' with the lot's own remaining_pcs as the
        // negative delta, so this is a fully audited write-off, not a
        // silent loss.
        for (const lotId of deletedLotIds) {
            await deleteData('packed_coffee_lots', lotId);
        }

        document.getElementById('btn-close-modal').click();
        loadPackedCoffeeSection();
        scheduleDashboardRefresh();
    });
}

// Sticker reprint for ONE already-existing packed lot, independent of the
// Ready to Pack > Barcode flow. That flow is anchored to a bulk_roasted_coffee
// row (it needs bulk_available > 0 to even render a card), so it can't reach
// stock that was counted straight into the app rather than produced — and it
// can't reprint a torn sticker for a lot whose bulk is long gone.
function openPrintLotStickerModal(row, coffeeName, machines) {
    const priorityLabel = window.t ? window.t('lbl_sticker_priority') : 'OUT FIRST';
    const html = `
        <form id="modal-print-sticker-form">
            <div style="background: var(--bg-glass-active); border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; font-size: 0.85rem;">
                <div><strong style="font-family:monospace;">${row.stripCode}</strong> &middot; <code style="font-size:0.78rem;">${row.lotCode}</code></div>
                <div style="color: var(--text-muted); font-size: 0.78rem; margin-top: 2px;">${coffeeName} &middot; ${row.sizeG}g &middot; ${row.machineName} &middot; ${row.remaining} pcs in stock</div>
            </div>
            <div class="form-group">
                <label class="form-label" data-i18n="lbl_sticker_qty">Number of stickers</label>
                <input type="number" id="m-sticker-qty" class="form-control" min="1" value="${row.remaining}" required>
                <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;" data-i18n="hint_sticker_qty">Defaults to the full remaining stock — one sticker per package.</div>
            </div>
            <label class="checkbox-container" style="display:flex; align-items:center; gap:8px; margin-top:14px;">
                <input type="checkbox" id="m-sticker-priority" ${row.isManual ? 'checked' : ''}>
                <span>Mark as &ldquo;${priorityLabel}&rdquo;</span>
            </label>
            <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;" data-i18n="hint_sticker_priority">Prints only the barcode, code and size plus the priority mark — no coffee name or dates, since the packaging already carries its own roast date.</div>
            <div class="modal-footer-actions-lg">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                <button type="submit" class="btn btn-primary" data-i18n="btn_print_stickers">Print Stickers</button>
            </div>
        </form>
    `;

    openModal(window.t ? window.t('title_print_sticker') : 'Print Sticker', html, '460px');

    document.getElementById('modal-print-sticker-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const qty = parseInt(document.getElementById('m-sticker-qty').value) || 0;
        if (qty < 1) {
            await showWarningModal('Enter how many stickers to print (at least 1).', false);
            return;
        }
        const priorityMark = document.getElementById('m-sticker-priority').checked;

        // printLotBarcodeLabels only ever reads production_date, machine_id and
        // coffee_name off this first argument (verified) — it does NOT need a
        // real production_lots row, so a plain shape is enough here. The date
        // is irrelevant for a priority sticker (dates are suppressed) but is
        // still passed so a non-priority reprint keeps its date line correct.
        const lotShape = {
            production_date: row.packedDate || null,
            machine_id: row.machineId,
            coffee_name: coffeeName
        };
        const requested = [{
            packedCoffeeLotId: row.lotId,
            stripCode: row.stripCode,
            lotCode: row.lotCode,
            label: `${row.sizeG}g`,
            multiplier: null,
            qty
        }];

        document.getElementById('btn-close-modal').click();
        printLotBarcodeLabels(lotShape, requested, machines, { priorityMark });
    });
}

async function openCustomPackingModal() {
    const [
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: sizes }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('packaging_sizes')
    ]);
    const activeSizes = (sizes || []).filter(s => s.is_visible).sort((a, b) => a.gram - b.gram);

    // List of coffee name suggestions, with each option's displayed/selected
    // value prefixed with its code (e.g. "9 — CHAMBAKU") the same way
    // openPackedLotsModal's displayName does, so it's easy to tell apart
    // near-identical names — and sorted by name so a long list stays
    // scannable. Deduped by name (green bean wins over a same-named recipe,
    // matching the previous Set-based behavior) since this datalist also
    // accepts a fully custom typed name that matches neither list.
    const coffeeByName = new Map();
    if (greenbeans) greenbeans.forEach(gb => { if (!coffeeByName.has(gb.name)) coffeeByName.set(gb.name, gb.code || ''); });
    if (recipes) recipes.forEach(r => { if (!coffeeByName.has(r.name)) coffeeByName.set(r.name, r.code || ''); });

    // Maps the "CODE — NAME" string shown/selected in the datalist back to
    // the plain coffee name the rest of this modal's logic needs — done via
    // closure instead of parsing the string back apart on submit, so a name
    // or code containing " — " itself can never be misparsed.
    const displayToName = new Map();
    const sortedCoffeeNames = Array.from(coffeeByName.keys()).sort((a, b) => a.localeCompare(b));
    const datalistOptions = sortedCoffeeNames.map(name => {
        const code = coffeeByName.get(name);
        const display = code ? `${code} — ${name}` : name;
        displayToName.set(display, name);
        return `<option value="${display}"></option>`;
    }).join('');
    const machineOptions = machines.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    const sizesHtml = activeSizes.map(sz => `
        <div class="form-group flex-1-mb-0" >
            <label class="form-label">${sz.gram}g</label>
            <input type="number" min="0" class="form-control custom-pack-size-input" data-gram="${sz.gram}" value="0" placeholder="0">
        </div>
    `).join('');

    const html = `
        <form id="modal-custom-packing-form" novalidate>
            <div class="form-group">
                <label class="form-label">Coffee Name</label>
                <input type="text" id="m-custpack-coffee" class="form-control" placeholder="Select or type coffee name..." list="custpack-coffee-list" required>
                <datalist id="custpack-coffee-list">
                    ${datalistOptions}
                </datalist>
            </div>
            
            <div class="form-row mt-3" >
                <div class="form-group">
                    <label class="form-label">Roaster Machine</label>
                    <select id="m-custpack-machine" class="form-control" required>
                        <option value="" disabled selected>-- Select Machine --</option>
                        ${machineOptions}
                    </select>
                </div>
            </div>

            <div style="margin-top: 20px;">
                <label class="form-label">Quantity per Package size</label>
                <div style="display: flex; gap: 12px; align-items: flex-end;">
                    ${sizesHtml}
                </div>
            </div>

            <div class="modal-footer-actions-lg">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Packing</button>
            </div>
        </form>
    `;

    openModal('Add Manual Packed Stock', html, '600px');
    
    document.getElementById('modal-custom-packing-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const typedCoffee = document.getElementById('m-custpack-coffee').value.trim();
        const coffeeName = displayToName.get(typedCoffee) || typedCoffee;
        const machineId = parseInt(document.getElementById('m-custpack-machine').value);
        
        if (!coffeeName || isNaN(machineId)) {
            alert("Please complete the coffee name and select a machine.");
            return;
        }

        const sizeInputs = document.querySelectorAll('.custom-pack-size-input');
        const packsToSave = [];
        
        sizeInputs.forEach(inp => {
            const qty = parseInt(inp.value) || 0;
            const gram = parseInt(inp.getAttribute('data-gram'));
            if (qty > 0) {
                packsToSave.push({ gram, qty });
            }
        });

        if (packsToSave.length === 0) {
            alert("Please input quantity for at least one package size.");
            return;
        }

        for (const item of packsToSave) {
            // getOrCreatePackedCoffeeRow (shared with the bulk-pack flow,
            // race-safe via the DB's partial unique index) resolves the row
            // then we add this entry's qty on top — same two-step shape as
            // openPackBulkModal.
            const packedRow = await getOrCreatePackedCoffeeRow(coffeeName, item.gram, machineId);
            const packedCoffeeId = packedRow ? packedRow.id : null;
            // packed_coffee.quantity is trigger-derived (sync_packed_coffee_quantity)
            // from the packed_coffee_lots write below — no separate write needed.
            // V2 1G-1: no source bulk/production lot for a manual entry — link left null.
            if (packedCoffeeId) {
                await getOrCreatePackedCoffeeLot(packedCoffeeId, item.qty, null);
            }
        }

        modalContainer.classList.add('hidden');
        loadPackedCoffeeSection();
        scheduleDashboardRefresh();
        await showWarningModal("Custom packing stock added successfully.", false, null, null, 'success');
    });
}

async function loadPackingHistorySection() {
    const [
        { data: orders },
        { data: orderItems },
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: codeDefinitions }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('code_definitions')
    ]);
    const tbody = document.getElementById('packing-history-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!orders || orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center-muted">No completed orders found.</td></tr>`;
        return;
    }

    // Only show orders where all items are Ready for Handover, or status is Dispatched
    const historyOrders = [...orders]
        .filter(o => {
            if (o.status === 'Dispatched') return true;
            // Checked on the ORDER, never inferred from items: a stopped
            // order's item_status can still read 'Ready for Handover' (orders
            // stopped before c7fa3e8, or a later roasting-plan status sync),
            // and would otherwise surface here with a Print Waybill button
            // for stock that was already returned.
            if (o.status === 'Unable to Fulfill') return false;
            // Include orders where ALL items are Ready for Handover
            const items = (orderItems || []).filter(i => i.request_order_id === o.id);
            if (items.length > 0 && items.every(i => i.item_status === 'Ready for Handover')) return true;
            return false;
        })
        .sort((a, b) => new Date(b.order_date) - new Date(a.order_date) || b.id - a.id);

    if (historyOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center-muted">No completed orders found.</td></tr>`;
        return;
    }

    let tbodyHtml = '';
    for (const order of historyOrders) {
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);
        
        // Build items detail
        let itemsDetailHtml = '';
        if (items.length > 0) {
            itemsDetailHtml = `<div style="display: flex; flex-direction: column; gap: 4px;">`;
            for (const item of items) {
                const type = item.coffee_type;
                const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
                let coffeeName = '';
                if (item.coffee_code) {
                    const def = (codeDefinitions || []).find(d => d.code === item.coffee_code);
                    coffeeName = def ? def.name : `Code ${item.coffee_code}`;
                } else if (type === 'Single') {
                    const gb = (greenbeans || []).find(g => g.id === coffeeId);
                    coffeeName = gb ? gb.name : 'Single Origin';
                } else {
                    const r = (recipes || []).find(rec => rec.id === coffeeId);
                    coffeeName = r ? r.name : 'Blend';
                }
                const sizeG = item.bag_size_g || '?';
                const requested = parseInt(item.quantity_requested) || 0;
                const histMach = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
                const histMachTag = histMach ? `<span style="font-size:0.68rem; color:#0891b2; font-weight:600; background:rgba(6,182,212,0.1); padding:0px 5px; border-radius:3px; margin-left:4px;">${histMach.name}</span>` : '';
                
                itemsDetailHtml += `
                    <div style="display:flex; align-items:center; gap:8px; font-size:0.82rem;">
                        <span style="font-weight:600; color:var(--text-primary);">${coffeeName}</span>${histMachTag}
                        <span style="display:inline-flex; align-items:center; gap:4px; background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:6px; padding:1px 8px; font-size:0.78rem; font-weight:600; color:var(--text-secondary);">
                            ${sizeG}g: <strong style="color:var(--primary);">${requested} bags</strong>
                        </span>
                    </div>`;
            }
            itemsDetailHtml += `</div>`;
        } else {
            itemsDetailHtml = '<span class="text-muted-color">-</span>';
        }
        
        // Ready date
        const readyDate = order.ready_date || order.order_date;
        
        // Dispatched column
        const isDispatched = order.status === 'Dispatched';
        const dispatchedCell = isDispatched 
            ? `<span style="font-weight:600; font-size:0.85rem;">${order.dispatched_date || order.order_date}</span>`
            : `<span style="font-size:0.72rem; color:var(--warning); font-weight:600; display:inline-flex; align-items:center; gap:3px;"><span style="display:inline-block; width:5px; height:5px; background:var(--warning); border-radius:50%;"></span>Waiting for Dispatch</span>`;
        
        // Status badge
        const statusBadge = isDispatched
            ? `<span style="font-size:0.75rem; padding:2px 10px; border-radius:9999px; font-weight:700; background:rgba(6,182,212,0.15); color:#0891b2; display:inline-block;">Dispatched</span>`
            : `<span style="font-size:0.75rem; padding:2px 10px; border-radius:9999px; font-weight:700; background:rgba(16,185,129,0.15); color:var(--success); display:inline-block;">Ready</span>`;
        
        tbodyHtml += `
        <tr>
            <td><strong>${order.order_date}</strong></td>
            <td><code style="font-size:0.8rem;">${order.order_number || '#ORD-'+order.id}</code></td>
            <td><strong>${order.sales_name || '-'}</strong></td>
            <td>${itemsDetailHtml}</td>
            <td><span style="font-size:0.8rem;">${readyDate}</span></td>
            <td>${dispatchedCell}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn btn-secondary btn-sm btn-print-waybill" data-id="${order.id}" style="display:inline-flex; align-items:center; gap:4px; white-space:nowrap;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    Print Waybill
                </button>
            </td>
        </tr>`;
    }
    tbody.innerHTML = tbodyHtml;

    // Attach print waybill handlers
    document.querySelectorAll('.btn-print-waybill').forEach(btn => {
        btn.addEventListener('click', () => printWaybill(parseInt(btn.getAttribute('data-id'))));
    });

    applyFiltersForTable(document.querySelector('#tab-packing-history table'));
}

// ============================================================
// PRINT WAYBILL - A4 Format
// ============================================================
async function printWaybill(orderId) {
    const [
        { data: orders },
        { data: orderItems },
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: customers },
        { data: codeDefinitions }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('customers'),
        fetchData('code_definitions')
    ]);

    const order = (orders || []).find(o => o.id === orderId);
    if (!order) return;
    const items = (orderItems || []).filter(i => i.request_order_id === orderId);
    const customer = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null;

    let itemsTableRows = '';
    let totalBags = 0;
    let totalWeightKg = 0;

    for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const type = item.coffee_type;
        const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
        let coffeeName = '';
        if (item.coffee_code) {
            const def = (codeDefinitions || []).find(d => d.code === item.coffee_code);
            coffeeName = def ? def.name : `Code ${item.coffee_code}`;
        } else if (type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === coffeeId);
            coffeeName = gb ? gb.name : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === coffeeId);
            coffeeName = r ? r.name : 'Blend';
        }
        const mach = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
        const machCode = mach ? (mach.code || mach.name) : '-';
        const qty = parseInt(item.quantity_requested) || 0;
        const sizeG = parseInt(item.bag_size_g) || 0;
        const weightKg = (qty * sizeG) / 1000;
        totalBags += qty;
        totalWeightKg += weightKg;

        const sizeLabel = sizeG >= 1000 ? `${sizeG/1000}kg` : `${sizeG}g`;
        itemsTableRows += `
            <tr>
                <td class="text-center">${idx + 1}</td>
                <td style="font-weight:600;">${coffeeName}</td>
                <td>${machCode}</td>
                <td>${sizeLabel}</td>
                <td class="text-center">${qty}</td>
                <td class="text-center">${weightKg.toFixed(1)} kg</td>
            </tr>`;
    }
    
    // Use the live companySettings (loaded from Supabase by loadCompanySettings()) —
    // do NOT read the 'mock_company_settings' localStorage cache here, it is seeded
    // once on first-ever page load and never refreshed by real saves.
    const cs = companySettings;

    const printContent = `<!DOCTYPE html>
<html>
<head>
    <title>Waybill - ${order.order_number || '#ORD-'+order.id}</title>
    <style>
        @page { size: A4; margin: 16mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 13px; background: #fff; }
        .waybill { max-width: 210mm; margin: 0 auto; padding: 8px; }

        /* Letterhead */
        .letterhead { display: flex; justify-content: space-between; align-items: center; padding-bottom: 16px; border-bottom: 3px solid #2d5016; margin-bottom: 24px; }
        .letterhead-left { display: flex; align-items: center; gap: 14px; }
        .letterhead-logo { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; border: 1px solid #e5e5e5; }
        .letterhead-name { font-size: 21px; font-weight: 800; color: #2d5016; line-height: 1.2; }
        .letterhead-contact { font-size: 10px; color: #777; line-height: 1.6; margin-top: 3px; }
        .letterhead-right { text-align: right; }
        .letterhead-right .doc-title { font-size: 19px; font-weight: 800; color: #2d5016; letter-spacing: 0.5px; text-transform: uppercase; }
        .letterhead-right .doc-subtitle { font-size: 11px; color: #999; margin-top: 3px; font-weight: 600; }

        /* Info cards */
        .info-section { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
        .info-card { background: #f7f9f5; border: 1px solid #e2e8dc; border-radius: 8px; padding: 14px 16px; }
        .info-card .card-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #2d5016; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #dde5d3; }
        .info-card .info-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 3px 0; }
        .info-card .info-label { color: #888; font-weight: 600; }
        .info-card .info-value { color: #1a1a1a; font-weight: 700; text-align: right; }
        .info-card .customer-name { font-size: 15px; font-weight: 800; color: #1a1a1a; margin-bottom: 2px; }
        .info-card .customer-code { display: inline-block; font-size: 10px; font-weight: 700; color: #2d5016; background: #e2e8dc; padding: 2px 8px; border-radius: 10px; margin-bottom: 8px; }

        /* Table */
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; border-radius: 8px; overflow: hidden; }
        thead th { background: #2d5016; color: #fff; padding: 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; }
        thead th:first-child { text-align: center; }
        tbody tr:nth-child(even) { background: #f7f9f5; }
        tbody td { padding: 9px 10px; border-bottom: 1px solid #e5e5e5; font-size: 12px; }
        tfoot td { background: #eef3e8; font-weight: 700; padding: 10px; border-top: 2px solid #2d5016; font-size: 12px; }

        /* Notes */
        .notes { border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px 14px; margin-bottom: 24px; background: #fafafa; }
        .notes .label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #888; margin-bottom: 4px; }

        /* Signature */
        .signature-area { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; margin-top: 40px; }
        .sig-box { text-align: center; }
        .sig-box .sig-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #666; margin-bottom: 60px; }
        .sig-box .sig-line { border-top: 1px solid #333; padding-top: 6px; font-size: 11px; color: #999; }

        /* Footer */
        .print-footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e5e5e5; text-align: center; font-size: 10px; color: #999; }

        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
    </style>
</head>
<body>
    <div class="waybill">
        <div class="letterhead">
            <div class="letterhead-left">
                ${cs.show_logo_in_print && cs.logo_base64 ? '<img class="letterhead-logo" src="' + cs.logo_base64 + '" alt="Logo">' : ''}
                <div>
                    <div class="letterhead-name">${cs.company_name || 'Coffee Roastery'}</div>
                    <div class="letterhead-contact">
                        ${cs.address ? cs.address + '<br>' : ''}${cs.phone ? cs.phone : ''}${cs.email ? ' · ' + cs.email : ''}
                    </div>
                </div>
            </div>
            <div class="letterhead-right">
                <div class="doc-title">Delivery Waybill</div>
                <div class="doc-subtitle">${order.order_number || '#ORD-'+order.id}</div>
            </div>
        </div>

        <div class="info-section">
            <div class="info-card">
                <div class="card-title">Bill To</div>
                ${customer ? `
                    <div class="customer-name">${customer.name}</div>
                    <div class="customer-code">${customer.customer_id}</div>
                    ${customer.city ? `<div class="info-row"><span class="info-label">City</span><span class="info-value">${customer.city}</span></div>` : ''}
                    ${customer.phone ? `<div class="info-row"><span class="info-label">Phone</span><span class="info-value">${customer.phone}</span></div>` : ''}
                ` : `
                    <div class="customer-name">-</div>
                `}
                <div class="info-row">
                    <span class="info-label">Sales Agent</span>
                    <span class="info-value">${order.sales_name || '-'}</span>
                </div>
            </div>
            <div class="info-card">
                <div class="card-title">Order Details</div>
                <div class="info-row">
                    <span class="info-label">Order Number</span>
                    <span class="info-value">${order.order_number || '#ORD-'+order.id}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Order Date</span>
                    <span class="info-value">${order.order_date}</span>
                </div>
            </div>
        </div>

        <table>
            <thead>
                <tr>
                    <th style="width:30px;">#</th>
                    <th>Coffee Name</th>
                    <th style="width:100px;">Type</th>
                    <th style="width:60px;">Size</th>
                    <th style="width:50px; text-align:center;">Qty</th>
                    <th style="width:80px; text-align:center;">Weight</th>
                </tr>
            </thead>
            <tbody>${itemsTableRows}</tbody>
            <tfoot>
                <tr>
                    <td colspan="4" style="text-align:right;">Total</td>
                    <td class="text-center">${totalBags}</td>
                    <td class="text-center">${totalWeightKg.toFixed(1)} kg</td>
                </tr>
            </tfoot>
        </table>
        ${order.notes ? '<div class="notes"><div class="label">Notes</div><div>' + order.notes + '</div></div>' : ''}
        <div class="signature-area">
            <div class="sig-box"><div class="sig-label">Prepared By</div><div class="sig-line">Name / Date</div></div>
            <div class="sig-box"><div class="sig-label">Checked By</div><div class="sig-line">Name / Date</div></div>
            <div class="sig-box"><div class="sig-label">Received By</div><div class="sig-line">Name / Date</div></div>
        </div>
        ${cs.print_footer_text ? '<div class="print-footer">' + cs.print_footer_text + '</div>' : ''}
    </div>
    <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
}

// ============================================================================
// V2 REPACK — open finished packed stock (e.g. 2x1KG) back into loose bulk so
// the team packs it back down (e.g. 8x250G) through the SAME Print Barcode /
// Pack pipeline used for a fresh roast, per explicit user design choice — no
// parallel pack path. See database/repack_migration.sql (bulk_roasted_coffee
// .is_repack, repack_sources) — NOT YET APPLIED to production as of writing.
// ============================================================================

async function loadRepackHistorySection() {
    const [
        { data: bulkList },
        { data: repackSources },
        { data: packedLots }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('repack_sources'),
        fetchData('packed_coffee_lots')
    ]);

    const tbody = document.getElementById('repack-history-tbody');
    const emptyEl = document.getElementById('repack-history-empty');
    if (!tbody) return;
    tbody.innerHTML = '';

    const repackBulks = (bulkList || [])
        .filter(b => b.is_repack)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    if (emptyEl) emptyEl.classList.toggle('hidden', repackBulks.length > 0);

    tbody.innerHTML = repackBulks.map(bulk => {
        const sources = (repackSources || []).filter(s => s.repack_bulk_id === bulk.id);
        const openedText = sources.map(s => {
            const srcLot = (packedLots || []).find(l => l.id === s.source_packed_lot_id);
            const code = srcLot ? (srcLot.strip_code || srcLot.lot_code) : '?';
            return `${code} &times;${s.pcs}`;
        }).join(' &middot; ') || '-';
        // "Became Bulk" is the historical total at repack time (sum of source
        // rows' kg), not bulk.bulk_available — that number drains as the
        // repack bulk gets packed down, so it would misreport an old repack
        // as if it produced less than it actually did.
        const becameKg = sources.reduce((s, r) => s + (parseFloat(r.kg) || 0), 0);
        return `
            <tr>
                <td>${bulk.production_date || '-'}</td>
                <td>${bulk.coffee_name}</td>
                <td style="font-family: monospace; font-size: 0.8rem;">${openedText}</td>
                <td style="text-align:right; font-weight:700;">${becameKg.toFixed(2)} kg</td>
            </tr>
        `;
    }).join('');
}

// Coffee dropdown + FIFO-sorted lot list, mirroring openPackedLotsModal's own
// identity resolution (custom name vs. roast_batch_id-backed Single/Blend) so
// the "Coffee" list here matches what's shown everywhere else in Packing —
// grouped here (not per-item) since one coffee can have several packed_coffee
// rows (one per size), and repack needs to pick across all of them at once.
async function openNewRepackModal() {
    const [
        { data: packedList },
        { data: packedLots },
        { data: roastBatches },
        { data: greenbeans },
        { data: recipes },
        { data: productionLots }
    ] = await Promise.all([
        fetchData('packed_coffee'),
        fetchData('packed_coffee_lots'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('production_lots')
    ]);

    const resolved = (packedList || []).map(item => {
        // `rawName` is what actually gets copied onto the new bulk row's
        // coffee_name — kept EXACTLY as stored, suffix and all. A
        // custom/manual packed_coffee row (no roast_batch_id) stores its
        // name as "X (Single)"/"X (Blend)", which is also the naming
        // convention every bulk_roasted_coffee row in this app already uses
        // (see any Ready to Pack card) — stripping that suffix here would
        // both violate "repack never renames the coffee" and desync the new
        // bulk from the packed_coffee row getOrCreatePackedCoffeeRow later
        // re-derives from bulk.coffee_name when this repack gets packed back
        // down, silently splitting it into a differently-named stock row.
        // `groupKey` strips the suffix ONLY for grouping/dropdown-label
        // purposes (same stripping openPackedLotsModal already does for its
        // own display), so "X (Single)" and a same-named roast_batch-linked
        // "X" still group into one dropdown entry.
        let rawName = item.custom_coffee_name || 'Roasted Coffee';
        let coffeeType = item.single_coffee_id ? 'Single' : (item.blend_recipe_id ? 'Blend' : null);
        let singleId = item.single_coffee_id || null;
        let blendId = item.blend_recipe_id || null;
        if (item.roast_batch_id) {
            const b = (roastBatches || []).find(x => x.id === item.roast_batch_id);
            if (b) {
                coffeeType = b.coffee_type;
                singleId = b.single_coffee_id;
                blendId = b.blend_recipe_id;
                if (b.coffee_type === 'Single') {
                    const gb = (greenbeans || []).find(g => g.id === b.single_coffee_id);
                    if (gb) rawName = gb.name;
                } else {
                    const r = (recipes || []).find(rec => rec.id === b.blend_recipe_id);
                    if (r) rawName = r.name;
                }
            }
        }
        const groupKey = rawName.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
        return { ...item, rawName, groupKey, coffeeType, singleId, blendId };
    });

    // V2 Repack must never rename a coffee — the group's identity
    // (coffeeType/singleId/blendId/coffeeName) is captured ONCE here, from
    // whichever item is encountered first for this groupKey, and copied
    // verbatim onto the new bulk row in submitRepack regardless of which
    // specific lot within the group gets opened. coffeeName keeps the raw
    // (suffixed) name; the dropdown label below uses the clean groupKey.
    const groupMap = new Map();
    resolved.forEach(item => {
        const lotsForItem = (packedLots || []).filter(l => l.packed_coffee_id === item.id && (parseInt(l.remaining_pcs) || 0) > 0);
        if (lotsForItem.length === 0) return;
        if (!groupMap.has(item.groupKey)) {
            groupMap.set(item.groupKey, {
                label: item.groupKey,
                coffeeName: item.rawName,
                coffeeType: item.coffeeType,
                singleId: item.singleId,
                blendId: item.blendId,
                lots: []
            });
        }
        const group = groupMap.get(item.groupKey);
        lotsForItem.forEach(l => {
            // roastDate is the lot's TRUE roast/production date — pulled from
            // production_lots.production_date via the lot's own
            // production_lot_id — NOT packed_date (when it was physically
            // bagged, which can be days after the roast and is today's date
            // for anything packed today). Getting this wrong here isn't
            // cosmetic: it's what the oldest/newest/today picker below
            // decides between, and what ultimately becomes the new repack
            // bulk's own production_date (used for the printed exp date AND
            // FIFO age) — the exact roast-date honesty the user asked for
            // when this feature was designed. A manual/unlinked lot (no
            // production_lot_id) has no roast date to draw from, so it falls
            // back to packed_date — same fallback getOrCreatePackedCoffeeLot
            // itself uses.
            const productionLot = l.production_lot_id
                ? (productionLots || []).find(pl => pl.id === l.production_lot_id)
                : null;
            const roastDate = productionLot ? productionLot.production_date : l.packed_date;
            group.lots.push({
                lotId: l.id,
                lotCode: l.lot_code,
                stripCode: l.strip_code,
                sizeG: parseInt(item.bag_size_g) || 0,
                roastDate,
                remaining: parseInt(l.remaining_pcs) || 0,
                packedCoffeeId: item.id,
                machineId: item.machine_id
            });
        });
    });

    const groups = [...groupMap.values()].filter(g => g.lots.length > 0);
    if (groups.length === 0) {
        await showWarningModal('No packed stock with remaining lots is available to repack.', false);
        return;
    }
    // Sorted by the TRUE roast date (not packed_date) — this modal's whole
    // point is picking the oldest ROASTED coffee, unlike Stock by Lot /
    // dispatch checkout's FIFO elsewhere in the app, which intentionally
    // sorts by packed_date (see openPackedLotsModal) since those screens are
    // answering a different question ("which bag was filled first").
    groups.forEach(g => g.lots.sort((a, b) => (a.roastDate || '').localeCompare(b.roastDate || '') || a.lotId - b.lotId));

    // Same name-match resolution openPackedLotsModal / openNewStockReleaseModal
    // already use to show a coffee's code next to its name — this dropdown
    // otherwise lists 20+ similarly-worded names with nothing to tell them
    // apart at a glance.
    groups.forEach(g => {
        const gbMatch = (greenbeans || []).find(x => x.name === g.label);
        const rMatch = (recipes || []).find(x => x.name === g.label);
        g.code = (gbMatch && gbMatch.code) || (rMatch && rMatch.code) || '';
    });
    // Numeric-aware, same comparator as renderCodeDefinitionsRows — "2" sorts
    // before "10", not after. Codeless entries (custom/manual packs with no
    // matching code_definitions row) sort to the end by name instead of
    // colliding with "" at the front. Sorting `groups` itself (not a copy) is
    // safe: option values below are indices into this exact array, built
    // AFTER this sort, so they still resolve correctly via currentGroup().
    groups.sort((a, b) => {
        if (!a.code && !b.code) return a.label.localeCompare(b.label);
        if (!a.code) return 1;
        if (!b.code) return -1;
        return a.code.localeCompare(b.code, undefined, { numeric: true });
    });

    const coffeeOptionsHtml = groups.map((g, idx) => `<option value="${idx}">${g.code ? g.code + ' — ' + g.label : g.label}</option>`).join('');

    const html = `
        <form id="modal-new-repack-form">
            <div class="form-group">
                <label class="form-label" data-i18n="lbl_repack_coffee">Coffee</label>
                <select id="repack-coffee-select" class="form-control">${coffeeOptionsHtml}</select>
            </div>
            <div style="margin: 14px 0 6px; display:flex; align-items:center; gap:8px;">
                <span style="font-size:0.78rem; color:var(--text-secondary);" data-i18n="lbl_repack_scan_hint">Scan or type strip code, then Enter</span>
            </div>
            <input type="text" id="repack-scan-input" class="form-control" placeholder="20037" style="margin-bottom:10px;">
            <div id="repack-lots-list" style="border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-bottom:14px;"></div>
            <div id="repack-roastdate-panel" class="hidden card-repack" style="border-radius:8px; padding:10px 11px; margin-bottom:14px;">
                <div style="font-size:0.78rem; margin-bottom:7px;" class="text-repack" data-i18n="lbl_repack_roastdate_conflict">New bulk's roast date — selected lots have different dates</div>
                <div id="repack-roastdate-options" style="display:flex; flex-direction:column; gap:5px;"></div>
            </div>
            <div style="display:flex; align-items:baseline; justify-content:space-between; border-top:1px solid var(--border); padding-top:12px;">
                <span style="font-size:0.8rem; color:var(--text-secondary);" data-i18n="lbl_repack_total">Total becomes bulk</span>
                <span id="repack-total-kg" class="text-repack" style="font-size:1.5rem; font-weight:700;">0.00 kg</span>
            </div>
            <div class="modal-footer-actions-lg">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                <button type="submit" class="btn btn-repack-accent" data-i18n="btn_create_repack_bulk">Create Repack Bulk</button>
            </div>
        </form>
    `;

    openModal(window.t ? window.t('title_new_repack') : 'New Repack', html, '620px');

    // The shared #modal-container is reused by every modal in the app, so
    // the rose header accent (user's explicit "modal matches card" request)
    // is added/removed around just this modal's lifetime, never left as a
    // permanent restyle of the shared shell.
    const modalHeaderEl = document.getElementById('modal-title') ? document.getElementById('modal-title').parentElement : null;
    if (modalHeaderEl) modalHeaderEl.classList.add('modal-repack-header');
    const cleanup = () => {
        if (modalHeaderEl) modalHeaderEl.classList.remove('modal-repack-header');
        window.activeRepackScanHandler = null;
    };
    document.getElementById('btn-close-modal').addEventListener('click', cleanup, { once: true });

    const listEl = document.getElementById('repack-lots-list');
    const totalEl = document.getElementById('repack-total-kg');
    const roastPanel = document.getElementById('repack-roastdate-panel');
    const roastOptionsEl = document.getElementById('repack-roastdate-options');
    const selectEl = document.getElementById('repack-coffee-select');

    function currentGroup() {
        return groups[parseInt(selectEl.value) || 0];
    }

    function recomputeTotals() {
        let totalKg = 0;
        listEl.querySelectorAll('.repack-lot-row').forEach(row => {
            const pcs = parseInt(row.querySelector('.repack-lot-pcs').value) || 0;
            const sizeG = parseFloat(row.getAttribute('data-size-g')) || 0;
            const kg = (pcs * sizeG) / 1000;
            row.querySelector('.repack-lot-kg').textContent = kg.toFixed(2) + ' kg';
            totalKg += kg;
        });
        totalEl.textContent = totalKg.toFixed(2) + ' kg';

        // Roast date conflict panel: only shown when the CURRENTLY SELECTED
        // (pcs > 0) rows actually span more than one date — a group that
        // happens to contain older stock the user isn't opening this time
        // must not force a decision that doesn't apply to this repack.
        const selectedDates = [...listEl.querySelectorAll('.repack-lot-row')]
            .filter(row => (parseInt(row.querySelector('.repack-lot-pcs').value) || 0) > 0)
            .map(row => row.getAttribute('data-roast-date'))
            .filter(Boolean);
        const distinctDates = [...new Set(selectedDates)].sort();

        if (distinctDates.length > 1) {
            const oldest = distinctDates[0];
            const newest = distinctDates[distinctDates.length - 1];
            const todayStr = new Date().toISOString().split('T')[0];
            const oldestLbl = window.t ? window.t('opt_repack_roastdate_oldest') : 'Oldest';
            const newestLbl = window.t ? window.t('opt_repack_roastdate_newest') : 'Newest';
            const todayLbl = window.t ? window.t('opt_repack_roastdate_today') : 'Today';
            roastOptionsEl.innerHTML = `
                <label style="display:flex; align-items:center; gap:7px; font-size:0.78rem;" class="text-repack">
                    <input type="radio" name="repack-roastdate" value="${oldest}" checked> ${oldestLbl} &mdash; <span style="font-family:monospace;">${oldest}</span>
                </label>
                <label style="display:flex; align-items:center; gap:7px; font-size:0.78rem;" class="text-repack">
                    <input type="radio" name="repack-roastdate" value="${newest}"> ${newestLbl} &mdash; <span style="font-family:monospace;">${newest}</span>
                </label>
                <label style="display:flex; align-items:center; gap:7px; font-size:0.78rem;" class="text-repack">
                    <input type="radio" name="repack-roastdate" value="${todayStr}"> ${todayLbl} &mdash; <span style="font-family:monospace;">${todayStr}</span>
                </label>
            `;
            roastPanel.classList.remove('hidden');
        } else {
            roastPanel.classList.add('hidden');
            roastOptionsEl.innerHTML = '';
        }
    }

    function renderLotRows() {
        const group = currentGroup();
        const pickFirstLabel = window.t ? window.t('badge_pick_first') : 'PICK FIRST';
        listEl.innerHTML = group.lots.map((lot, idx) => `
            <div class="repack-lot-row" data-lot-id="${lot.lotId}" data-remaining="${lot.remaining}" data-size-g="${lot.sizeG}" data-roast-date="${lot.roastDate || ''}" data-packed-coffee-id="${lot.packedCoffeeId}" data-machine-id="${lot.machineId || ''}"
                style="display:flex; align-items:center; gap:10px; padding:9px 11px; ${idx > 0 ? 'border-top:1px solid var(--border);' : ''}">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:0.78rem;">
                        <span class="text-repack" style="font-family:monospace; font-weight:700;">${lot.stripCode || lot.lotCode}</span>
                        <span style="color:var(--text-secondary);"> &middot; ${lot.sizeG}g &middot; roast ${lot.roastDate || '-'}</span>
                        ${idx === 0 ? `<span class="badge-repack" style="font-size:0.6rem; padding:1px 6px; border-radius:9999px; margin-left:4px;">${pickFirstLabel}</span>` : ''}
                    </div>
                    <div style="font-size:0.72rem; color:var(--text-muted);">${(window.t ? window.t('lbl_repack_stock_prefix') : 'stock')} ${lot.remaining} pcs</div>
                </div>
                <input type="number" class="form-control repack-lot-pcs" value="0" min="0" max="${lot.remaining}" style="width:56px; height:30px; font-size:0.78rem; text-align:center;">
                <span class="repack-lot-kg" style="font-size:0.72rem; color:var(--text-secondary); width:50px; text-align:right;">0.00 kg</span>
            </div>
        `).join('');

        listEl.querySelectorAll('.repack-lot-pcs').forEach(input => {
            input.addEventListener('input', () => {
                const max = parseInt(input.getAttribute('max')) || 0;
                let val = parseInt(input.value) || 0;
                if (val < 0) val = 0;
                if (val > max) val = max;
                input.value = val;
                recomputeTotals();
            });
        });
        recomputeTotals();
    }

    selectEl.addEventListener('change', renderLotRows);
    renderLotRows();

    // Scan handling has two independent paths, both landing on the same
    // local matcher: (1) this field's own Enter-key listener — works with
    // any real USB/BT scanner today, since a scanner just types into
    // whichever input currently has focus, no dependency on the app's
    // global 'RMP:'-gated buffer (see app.js GLOBAL BARCODE SCANNER
    // LISTENER, which doesn't recognize the bare-digit FIFO format at all).
    // (2) window.activeRepackScanHandler — a dormant hook, forward-
    // compatible with that global buffer the same way dispatch checkout
    // already left one in place (js/packing.js openDispatchCheckoutModal),
    // in case a future change extends it to bare-digit codes too.
    function matchAndSelectLot(raw) {
        const code = (raw || '').trim();
        if (!code) return false;
        const stripCandidate = /^\d{5,7}$/.test(code) ? code.slice(0, 5) : code;
        const row = [...listEl.querySelectorAll('.repack-lot-row')].find(r => {
            const lotId = parseInt(r.getAttribute('data-lot-id'));
            const lot = currentGroup().lots.find(l => l.lotId === lotId);
            return lot && (lot.stripCode === stripCandidate || lot.lotCode === code);
        });
        if (!row) return false;
        const pcsInput = row.querySelector('.repack-lot-pcs');
        const max = parseInt(pcsInput.getAttribute('max')) || 0;
        const current = parseInt(pcsInput.value) || 0;
        pcsInput.value = Math.min(current + 1, max);
        recomputeTotals();
        row.scrollIntoView({ block: 'nearest' });
        return true;
    }

    const scanInput = document.getElementById('repack-scan-input');
    scanInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const found = matchAndSelectLot(scanInput.value);
        scanInput.value = '';
        if (!found) {
            await showWarningModal('No lot with that code was found for the selected coffee, or it has no stock remaining.', false);
        }
    });

    window.activeRepackScanHandler = async function (lotId, sizeG, multiplier) {
        const row = listEl.querySelector(`.repack-lot-row[data-lot-id="${lotId}"]`);
        if (!row) {
            await showWarningModal(`Scanned lot #${lotId} is not part of the currently selected coffee.`, false);
            return;
        }
        const pcsInput = row.querySelector('.repack-lot-pcs');
        const max = parseInt(pcsInput.getAttribute('max')) || 0;
        const current = parseInt(pcsInput.value) || 0;
        pcsInput.value = Math.min(current + (multiplier || 1), max);
        recomputeTotals();
    };

    document.getElementById('modal-new-repack-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const group = currentGroup();
        const rows = [...listEl.querySelectorAll('.repack-lot-row')]
            .map(row => ({
                lotId: parseInt(row.getAttribute('data-lot-id')),
                pcs: parseInt(row.querySelector('.repack-lot-pcs').value) || 0,
                sizeG: parseFloat(row.getAttribute('data-size-g')) || 0,
                packedCoffeeId: parseInt(row.getAttribute('data-packed-coffee-id')),
                machineId: row.getAttribute('data-machine-id') ? parseInt(row.getAttribute('data-machine-id')) : null,
                roastDate: row.getAttribute('data-roast-date') || null
            }))
            .filter(r => r.pcs > 0);

        if (rows.length === 0) {
            await showWarningModal('Enter a quantity for at least one lot before creating the repack bulk.', false);
            return;
        }
        for (const r of rows) {
            const lot = group.lots.find(l => l.lotId === r.lotId);
            if (lot && r.pcs > lot.remaining) {
                await showWarningModal(`Cannot open ${r.pcs} pcs from lot ${lot.stripCode || lot.lotCode} — only ${lot.remaining} pcs remaining.`, false);
                return;
            }
        }

        const distinctDates = [...new Set(rows.map(r => r.roastDate).filter(Boolean))];
        let roastDate;
        if (distinctDates.length > 1) {
            const picked = document.querySelector('input[name="repack-roastdate"]:checked');
            roastDate = picked ? picked.value : distinctDates.sort()[0];
        } else {
            roastDate = distinctDates[0] || new Date().toISOString().split('T')[0];
        }

        await submitRepack(group, rows, roastDate);
        document.getElementById('btn-close-modal').click();
    });
}

// Core transaction: decrement each opened source lot, create ONE new
// is_repack bulk_roasted_coffee row carrying the source coffee's identity
// UNCHANGED (no renaming — explicit user requirement), and record one
// repack_sources row per opened lot for traceability (js/tracking.js walks
// this exactly like it already walks post_blend_components).
async function submitRepack(group, rows, roastDate) {
    const totalKg = rows.reduce((sum, r) => sum + (r.pcs * r.sizeG) / 1000, 0);

    const { data: newBulk, error: bulkError } = await saveData('bulk_roasted_coffee', {
        coffee_name: group.coffeeName,
        coffee_type: group.coffeeType,
        single_coffee_id: group.singleId,
        blend_recipe_id: group.blendId,
        machine_id: rows[0].machineId,
        bulk_available: totalKg,
        production_date: roastDate,
        is_repack: true,
        // Movement context on the fresh INSERT (STOCK_LEDGER_PLAN.md
        // Phase 4 addendum lesson).
        mv_operation: 'repack', mv_reason: `Repacked from ${rows.length} lot(s)`, mv_user: (currentUser && currentUser.name) || null
    });
    if (bulkError || !newBulk) {
        alert('Failed to create repack bulk: ' + (bulkError ? bulkError.message : 'unknown error'));
        return;
    }

    for (const r of rows) {
        // Atomic RPC (STOCK_LEDGER_PLAN.md Phase 1) — packed_coffee.quantity
        // is trigger-derived (sync_packed_coffee_quantity) from this lots
        // write, no separate packed_coffee write needed. repack_sources
        // below records the pcs ACTUALLY taken, in case a race clamped it
        // below what was requested.
        const { data: taken, error: consumeErr } = await window.supabaseClient.rpc('consume_packed_lot', {
            p_lot_id: r.lotId, p_pcs: r.pcs,
            p_operation: 'repack', p_ref_table: 'bulk_roasted_coffee', p_ref_id: newBulk.id,
            p_user: (currentUser && currentUser.name) || null
        });
        if (consumeErr) { console.error('consume_packed_lot RPC failed:', consumeErr); continue; }
        const actualPcs = parseInt(taken) || 0;
        if (actualPcs <= 0) continue;
        await saveData('repack_sources', {
            repack_bulk_id: newBulk.id,
            source_packed_lot_id: r.lotId,
            pcs: actualPcs,
            kg: (actualPcs * r.sizeG) / 1000
        });
    }

    await loadPackingSection();
    await loadRepackHistorySection();
    scheduleDashboardRefresh();
}

// ============================================================================
// V2 STOCK RELEASE — finished goods leaving stock WITHOUT a sales order
// (Packing > Stock Release). The finished-goods sibling of
// green_coffee_outbound, but header+items and lot-level. Entered directly by
// the packing team, no approval step (explicit user decision) — the audit
// trail is stock_releases.released_by + the packing_stock_release permission.
// See database/stock_release_migration.sql — NOT YET APPLIED to production as
// of writing.
//
// Deliberately NOT a Waste replacement: this records stock leaving in GOOD
// condition, waste_inventory records damaged/discarded stock. There is no
// 'Damaged' category on purpose, so one loss can never land in both.
// ============================================================================

// Category values are stored verbatim in stock_releases.category. 'Sales'
// additionally requires sales_name, 'Other' additionally requires notes — see
// stockReleaseCategoryNeeds() and the submit validation.
const STOCK_RELEASE_CATEGORIES = [
    { value: 'Sales', i18n: 'sr_cat_sales', fallback: 'Sales' },
    { value: 'Sample', i18n: 'sr_cat_sample', fallback: 'Sample' },
    { value: 'Internal', i18n: 'sr_cat_internal', fallback: 'Internal use' },
    { value: 'Marketing', i18n: 'sr_cat_marketing', fallback: 'Marketing / event' },
    { value: 'Other', i18n: 'sr_cat_other', fallback: 'Other' }
];

function stockReleaseCategoryLabel(value) {
    const def = STOCK_RELEASE_CATEGORIES.find(c => c.value === value);
    if (!def) return value || '-';
    return window.t ? window.t(def.i18n) : def.fallback;
}

function stockReleaseCategoryNeeds(value) {
    return {
        salesName: value === 'Sales',
        notes: value === 'Other'
    };
}

async function loadStockReleaseSection() {
    const [
        { data: releases },
        { data: releaseItems }
    ] = await Promise.all([
        fetchData('stock_releases'),
        fetchData('stock_release_items')
    ]);

    const tbody = document.getElementById('stock-release-history-tbody');
    const emptyEl = document.getElementById('stock-release-history-empty');
    if (!tbody) return;
    tbody.innerHTML = '';

    const rows = (releases || []).slice().sort((a, b) =>
        (b.date || '').localeCompare(a.date || '') || (b.id || 0) - (a.id || 0)
    );

    if (emptyEl) emptyEl.classList.toggle('hidden', rows.length > 0);

    tbody.innerHTML = rows.map(rel => {
        const items = (releaseItems || []).filter(i => i.stock_release_id === rel.id);
        const itemsText = items.length > 0
            ? items.map(i => `${i.coffee_name || '?'} ${i.bag_size_g ? parseInt(i.bag_size_g) + 'g' : ''} &times;${i.qty}`).join('<br>')
            : '-';
        const totalQty = items.reduce((s, i) => s + (parseInt(i.qty) || 0), 0);
        // "For / Notes" collapses the two category-specific fields into one
        // readable column: Sales shows who took it, everything else shows the
        // note. Both can be present, so they're joined rather than picked.
        const forParts = [];
        if (rel.sales_name) forParts.push(rel.sales_name);
        if (rel.notes) forParts.push(rel.notes);
        const isSales = rel.category === 'Sales';
        return `
            <tr>
                <td style="white-space:nowrap;">${rel.date || '-'}</td>
                <td>${isSales
                    ? `<span style="font-size:0.7rem; font-weight:700; color:var(--primary); background:var(--primary-glow); padding:2px 7px; border-radius:9999px;">${stockReleaseCategoryLabel(rel.category)}</span>`
                    : `<span style="color:var(--text-secondary);">${stockReleaseCategoryLabel(rel.category)}</span>`}</td>
                <td style="font-size:0.82rem;">${itemsText}</td>
                <td style="color:var(--text-secondary); font-size:0.82rem;">${forParts.join(' &middot; ') || '-'}</td>
                <td style="color:var(--text-secondary); font-size:0.82rem;">${rel.released_by || '-'}</td>
                <td style="text-align:right; font-weight:700; white-space:nowrap;">${totalQty} pcs</td>
            </tr>
        `;
    }).join('');
}

// Cart-based picker (user's explicit choice over a flat searchable list):
// coffee select -> lot select -> qty -> Add, repeated per coffee, with the
// cart listing every line across coffees. The one weakness of a
// coffee-filtered picker — a scan for a DIFFERENT coffee failing — is solved
// by resolving scans against ALL lots and switching the selects to whatever
// matched (see the scan handler below), so scanning never depends on which
// coffee happens to be selected.
async function openNewStockReleaseModal() {
    const [
        { data: packedList },
        { data: packedLots },
        { data: roastBatches },
        { data: greenbeans },
        { data: recipes },
        { data: salesAgents },
        { data: machines }
    ] = await Promise.all([
        fetchData('packed_coffee'),
        fetchData('packed_coffee_lots'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('sales_agents'),
        fetchData('machines')
    ]);

    // Same identity resolution as openNewRepackModal / openPackedLotsModal, so
    // the coffee list reads identically everywhere in Packing. rawName keeps
    // any "(Single)"/"(Blend)" suffix for the stored snapshot; groupKey strips
    // it for grouping and display.
    const resolved = (packedList || []).map(item => {
        let rawName = item.custom_coffee_name || 'Roasted Coffee';
        if (item.roast_batch_id) {
            const b = (roastBatches || []).find(x => x.id === item.roast_batch_id);
            if (b) {
                if (b.coffee_type === 'Single') {
                    const gb = (greenbeans || []).find(g => g.id === b.single_coffee_id);
                    if (gb) rawName = gb.name;
                } else {
                    const r = (recipes || []).find(rec => rec.id === b.blend_recipe_id);
                    if (r) rawName = r.name;
                }
            }
        }
        const groupKey = rawName.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
        return { ...item, rawName, groupKey };
    });

    const groupMap = new Map();
    resolved.forEach(item => {
        const lotsForItem = (packedLots || []).filter(l => l.packed_coffee_id === item.id && (parseInt(l.remaining_pcs) || 0) > 0);
        if (lotsForItem.length === 0) return;
        if (!groupMap.has(item.groupKey)) {
            groupMap.set(item.groupKey, { label: item.groupKey, coffeeName: item.rawName, lots: [] });
        }
        const group = groupMap.get(item.groupKey);
        const machine = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
        lotsForItem.forEach(l => {
            group.lots.push({
                lotId: l.id,
                lotCode: l.lot_code,
                stripCode: l.strip_code,
                sizeG: parseInt(item.bag_size_g) || 0,
                packedDate: l.packed_date,
                remaining: parseInt(l.remaining_pcs) || 0,
                packedCoffeeId: item.id,
                machineName: machine ? machine.name : 'Unknown',
                // Carried on the LOT, not just the group: cart lines are built
                // from selectedLot() (the Add button and, after switching, the
                // scan path), which reads straight out of group.lots and never
                // sees the group object. Without these here the cart rendered
                // "undefined" and — worse — wrote a null coffee_name snapshot
                // into stock_release_items, silently breaking the history's
                // readability. label is the clean display name, coffeeName the
                // raw suffixed one that gets persisted.
                label: item.groupKey,
                coffeeName: item.rawName
            });
        });
    });

    const groups = [...groupMap.values()].filter(g => g.lots.length > 0);
    if (groups.length === 0) {
        await showWarningModal('No packed stock with remaining lots is available to release.', false);
        return;
    }
    groups.forEach(g => g.lots.sort((a, b) => (a.packedDate || '').localeCompare(b.packedDate || '') || a.lotId - b.lotId));

    // Same name-match resolution openPackedLotsModal already uses to show a
    // coffee's code next to its name — the dropdown otherwise lists over 20
    // similarly-worded blend names with nothing to tell them apart at a
    // glance (e.g. two "BLEND" names differing only by a code the operator
    // actually recognizes).
    groups.forEach(g => {
        const gbMatch = (greenbeans || []).find(x => x.name === g.label);
        const rMatch = (recipes || []).find(x => x.name === g.label);
        g.code = (gbMatch && gbMatch.code) || (rMatch && rMatch.code) || '';
    });
    // Numeric-aware, same comparator as renderCodeDefinitionsRows — "2" sorts
    // before "10", not after. Codeless entries sort to the end by name.
    // Sorting `groups` itself is safe: option values below are indices into
    // this exact array, built after this sort.
    groups.sort((a, b) => {
        if (!a.code && !b.code) return a.label.localeCompare(b.label);
        if (!a.code) return 1;
        if (!b.code) return -1;
        return a.code.localeCompare(b.code, undefined, { numeric: true });
    });

    const todayStr = new Date().toISOString().split('T')[0];
    const categoryOptions = STOCK_RELEASE_CATEGORIES
        .map(c => `<option value="${c.value}">${window.t ? window.t(c.i18n) : c.fallback}</option>`)
        .join('');
    const agentOptions = (salesAgents || [])
        .filter(a => a.is_active !== false)
        .map(a => `<option value="${a.name}"></option>`)
        .join('');
    const coffeeOptions = groups.map((g, idx) => `<option value="${idx}">${g.code ? g.code + ' — ' + g.label : g.label}</option>`).join('');

    // Two-column layout (see .sr-grid in styles.css): every input lives in the
    // left column, while the right column is a panel holding the staged items,
    // the notes, the running total and the action buttons. Before this, the
    // cart and the submit button sat at the bottom of one long single-column
    // stack — on a 720px modal the operator had to scroll past the whole form
    // to see what they were about to record, which is exactly how a form that
    // was silently blocked from submitting went unnoticed. Scan is promoted to
    // its own tinted panel above an "or pick manually" divider because it's the
    // fast path; Coffee/Lot/Qty are the fallback. The Lot select still gets a
    // full column width so its strip code / machine / size / stock / date line
    // doesn't truncate — see renderLotOptions above.
    const fg = 'style="margin-bottom:10px;"';
    const html = `
        <form id="modal-stock-release-form">
            <div id="sr-step-form" class="sr-grid">
                <div>
                    <div style="display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; margin-bottom:12px;">
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label" data-i18n="lbl_sr_date">Date</label>
                            <input type="date" id="sr-date" class="form-control" value="${todayStr}" required>
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label" data-i18n="lbl_sr_category">Category</label>
                            <select id="sr-category" class="form-control">${categoryOptions}</select>
                        </div>
                        <div class="form-group" id="sr-sales-name-wrap" style="margin-bottom:0;">
                            <label class="form-label" data-i18n="lbl_sr_sales_name">Sales Name</label>
                            <input type="text" id="sr-sales-name" class="form-control" list="sr-agent-list" autocomplete="off" placeholder="e.g. Budi">
                            <datalist id="sr-agent-list">${agentOptions}</datalist>
                        </div>
                    </div>
                    <div id="sr-sales-name-hint" style="font-size:0.72rem; color:var(--text-muted); margin:-6px 0 12px;" data-i18n="hint_sr_sales_name">Pick a registered sales agent, or type a new name.</div>

                    <div style="background: var(--primary-glow); border:1px solid var(--border-focus); border-radius:10px; padding:11px 12px; margin-bottom:14px;">
                        <label class="form-label" style="display:flex; align-items:center; gap:7px; margin-bottom:6px;">
                            <i class="icon-scan-line"></i><span data-i18n="lbl_sr_scan">Scan strip code, then Enter</span>
                        </label>
                        <input type="text" id="sr-scan-input" class="form-control" placeholder="20037" autocomplete="off" style="font-family:monospace; font-size:1rem; letter-spacing:1px;">
                    </div>

                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                        <div style="flex:1; height:1px; background:var(--border);"></div>
                        <span style="font-size:0.72rem; color:var(--text-muted);" data-i18n="lbl_sr_or_manual">or pick manually</span>
                        <div style="flex:1; height:1px; background:var(--border);"></div>
                    </div>

                    <div class="form-group" ${fg}>
                        <label class="form-label" data-i18n="lbl_sr_coffee">Coffee</label>
                        <select id="sr-coffee-select" class="form-control">${coffeeOptions}</select>
                    </div>
                    <div class="form-group" ${fg}>
                        <label class="form-label" data-i18n="lbl_sr_lot">Lot</label>
                        <select id="sr-lot-select" class="form-control"></select>
                    </div>
                    <div style="display:grid; grid-template-columns:110px minmax(0,1fr); gap:10px; align-items:end;">
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label" data-i18n="lbl_sr_qty">Qty (pcs)</label>
                            <input type="number" id="sr-qty" class="form-control" value="1" min="1">
                        </div>
                        <button type="button" id="sr-btn-add" class="btn btn-secondary"><i class="icon-plus va-middle-mr-1"></i><span data-i18n="btn_sr_add">Add to list</span></button>
                    </div>
                    <div id="sr-stock-hint" style="font-size:0.72rem; color:var(--text-muted); margin-top:6px;"></div>
                </div>

                <div class="sr-panel">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                        <span style="font-size:0.85rem; font-weight:700;" data-i18n="lbl_sr_cart">Items to release</span>
                        <span id="sr-cart-count" style="font-size:0.7rem; color:var(--primary); background:var(--primary-glow); border-radius:20px; padding:2px 9px;"></span>
                    </div>
                    <div id="sr-cart" class="sr-cart-scroll"></div>

                    <div class="form-group" style="margin:12px 0 0;">
                        <label class="form-label" data-i18n="lbl_sr_notes">Notes</label>
                        <input type="text" id="sr-notes" class="form-control" placeholder="optional">
                        <div id="sr-notes-hint" style="font-size:0.72rem; color:var(--text-muted); margin-top:3px;"></div>
                    </div>

                    <div style="display:flex; align-items:baseline; justify-content:space-between; border-top:1px solid var(--border); padding-top:10px; margin-top:12px;">
                        <span style="font-size:0.8rem; color:var(--text-secondary);" data-i18n="lbl_sr_total">Total released</span>
                        <span id="sr-total" style="font-size:1.5rem; font-weight:700; color:var(--primary);">0 pcs</span>
                    </div>

                    <div style="display:flex; gap:8px; margin-top:14px;">
                        <button type="button" class="btn btn-secondary" style="flex:1;" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                        <button type="submit" class="btn btn-primary" style="flex:1.5;" data-i18n="btn_sr_proceed">Proceed</button>
                    </div>
                </div>
            </div>

            <div id="sr-step-confirm" class="hidden" style="max-width:640px; margin:0 auto;"></div>
        </form>
    `;

    openModal(window.t ? window.t('title_new_stock_release') : 'New Stock Release', html, '1000px');

    const selCoffee = document.getElementById('sr-coffee-select');
    const selLot = document.getElementById('sr-lot-select');
    const inpQty = document.getElementById('sr-qty');
    const btnAdd = document.getElementById('sr-btn-add');
    const hintStock = document.getElementById('sr-stock-hint');
    const cartEl = document.getElementById('sr-cart');
    const totalEl = document.getElementById('sr-total');
    const countEl = document.getElementById('sr-cart-count');
    const selCategory = document.getElementById('sr-category');
    const salesWrap = document.getElementById('sr-sales-name-wrap');
    const salesInput = document.getElementById('sr-sales-name');
    const salesHint = document.getElementById('sr-sales-name-hint');
    const notesHint = document.getElementById('sr-notes-hint');
    const stepForm = document.getElementById('sr-step-form');
    const stepConfirm = document.getElementById('sr-step-confirm');

    // cart: Map keyed by lotId so re-adding the same lot accumulates instead
    // of creating a duplicate line the submit loop would then double-deduct.
    const cart = new Map();
    // Which cart line is currently loaded back into the left form for editing
    // (user request 2026-09-03, mirroring the Sales Order cart). null = the
    // form is in normal "add a new line" mode.
    let editingLotId = null;

    const cleanup = () => { window.activeStockReleaseScanHandler = null; };
    document.getElementById('btn-close-modal').addEventListener('click', cleanup, { once: true });

    function allLots() {
        return groups.flatMap((g, gi) => g.lots.map(l => ({ ...l, groupIdx: gi, coffeeName: g.coffeeName, label: g.label })));
    }

    function currentGroup() {
        return groups[parseInt(selCoffee.value) || 0];
    }

    // Full info in one line — machine and remaining stock included (not just
    // strip code/size/date) so the operator can tell same-name lots on
    // different machines apart without leaving this dropdown. The oldest
    // lot (FIFO pick) is flagged with a leading ★ instead of an appended
    // "— PICK FIRST" suffix — same information, but ~11 fewer characters,
    // which is what keeps the line from getting cut off in the select box.
    function renderLotOptions() {
        const group = currentGroup();
        selLot.innerHTML = group.lots.map((l, idx) =>
            `<option value="${l.lotId}">${idx === 0 ? '★ ' : ''}${l.stripCode || l.lotCode} · ${l.machineName} · ${l.sizeG}g · ${l.remaining} pcs · ${l.packedDate || '-'}</option>`
        ).join('');
        updateStockHint();
    }

    function selectedLot() {
        const lotId = parseInt(selLot.value);
        return currentGroup().lots.find(l => l.lotId === lotId) || null;
    }

    // Remaining shown here is the lot's stock MINUS whatever is already in the
    // cart for it, so the operator can't be told "12 available" while 10 are
    // already staged.
    function availableFor(lot) {
        if (!lot) return 0;
        // A line being edited must not count its own staged qty against
        // itself — otherwise re-saving it unchanged, or nudging it up by one,
        // would read as "not enough stock".
        const staged = (cart.has(lot.lotId) && lot.lotId !== editingLotId) ? cart.get(lot.lotId).qty : 0;
        return Math.max(0, lot.remaining - staged);
    }

    // Disables Qty/Add (instead of just clamping max down to 0) once a lot's
    // stock is fully staged in the cart — a bare `inpQty.max = 0` alongside
    // the input's static min="1" leaves the field in an impossible min>max
    // state, which the browser's native validation then blocks the ENTIRE
    // form's submit on, even though every item the operator actually wants
    // is already sitting correctly in the cart (found live: "Minimum value
    // (1) must be less than the maximum value (0)" on Record Release, with
    // no way to tell which field was even at fault). A disabled input is
    // excluded from constraint validation entirely, so this sidesteps the
    // conflict instead of trying to keep min/max consistent by hand.
    function updateStockHint() {
        const lot = selectedLot();
        const avail = availableFor(lot);
        const label = window.t ? window.t('lbl_sr_available') : 'available';
        hintStock.textContent = lot ? `${avail} pcs ${label}` : '';
        const soldOut = !lot || avail <= 0;
        inpQty.disabled = soldOut;
        btnAdd.disabled = soldOut;
        if (soldOut) {
            inpQty.removeAttribute('max');
        } else {
            inpQty.max = avail;
        }
    }

    // One bordered card per staged lot (instead of the old flat divided list)
    // so each line still reads as a distinct object inside the narrower right
    // column, followed by a dashed "scan another" hint that keeps the panel
    // from looking broken while it's still nearly empty.
    // Totals only — split out of renderCart so editing a qty inline can
    // refresh the footer on every keystroke without rebuilding the list and
    // yanking focus out of the field being typed into.
    function updateCartTotals() {
        const total = [...cart.values()].reduce((s, l) => s + l.qty, 0);
        totalEl.textContent = `${total} pcs`;
        const lotWord = cart.size === 1
            ? (window.t ? window.t('lbl_sr_lot_count') : 'lot')
            : (window.t ? window.t('lbl_sr_lot_count_plural') : 'lots');
        // Hidden rather than emptied — an empty pill still paints its tinted
        // background, which reads as a stray smudge next to the heading.
        countEl.textContent = cart.size === 0 ? '' : `${cart.size} ${lotWord}`;
        countEl.style.display = cart.size === 0 ? 'none' : '';
    }

    function renderCart() {
        const emptyMsg = window.t ? window.t('msg_sr_cart_empty') : 'Nothing added yet.';
        const scanMore = window.t ? window.t('msg_sr_scan_more') : 'Scan another strip code to add more';
        const editingLbl = window.t ? (window.t('lbl_sr_editing') || 'Editing...') : 'Editing...';
        if (cart.size === 0) {
            cartEl.innerHTML = `<div style="border:1px dashed var(--border); border-radius:10px; padding:22px 12px; text-align:center; color:var(--text-muted); font-size:0.8rem;">${emptyMsg}</div>`;
        } else {
            cartEl.innerHTML = [...cart.values()].map(line => {
                const isEditing = line.lotId === editingLotId;
                const cardStyle = isEditing
                    ? 'background:var(--primary-glow); border:1px solid var(--primary); box-shadow:0 0 0 1px var(--primary);'
                    : 'background:var(--bg-input); border:1px solid var(--border);';
                return `
                <div class="sr-cart-card" data-lot-id="${line.lotId}" style="${cardStyle} border-radius:10px; padding:10px 11px; margin-bottom:8px; cursor:pointer;">
                    <div style="display:flex; align-items:flex-start; gap:8px;">
                        <div style="flex:1; min-width:0;">
                            <div style="font-family:monospace; font-weight:700; color:var(--primary); font-size:0.9rem;">${line.stripCode || line.lotCode}</div>
                            <div style="font-size:0.78rem; color:var(--text-secondary); overflow-wrap:anywhere;">${line.label} &middot; ${line.sizeG}g</div>
                            <div style="font-size:0.7rem; color:var(--text-muted);">${line.packedDate || '-'}</div>
                            ${isEditing ? `<div style="font-size:0.7rem; font-weight:700; color:var(--primary); margin-top:3px;">${editingLbl}</div>` : ''}
                        </div>
                        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:5px; flex:0 0 auto;">
                            <input type="number" class="sr-cart-qty form-control" data-lot-id="${line.lotId}"
                                   value="${line.qty}" min="1" max="${line.remaining}"
                                   style="width:74px; height:30px; text-align:center; font-weight:700; padding:2px 6px;">
                            <button type="button" class="sr-cart-remove btn btn-danger btn-sm" data-lot-id="${line.lotId}" aria-label="Remove">&times;</button>
                        </div>
                    </div>
                </div>
            `;
            }).join('') + `<div style="border:1px dashed var(--border); border-radius:10px; padding:10px; text-align:center; font-size:0.7rem; color:var(--text-muted);">${scanMore}</div>`;

            // Qty is edited in place. Clicks inside it must not bubble to the
            // card's own click-to-edit handler, or typing a quantity would
            // also drag the line back into the left form.
            cartEl.querySelectorAll('.sr-cart-qty').forEach(inp => {
                inp.addEventListener('click', (e) => e.stopPropagation());
                inp.addEventListener('input', () => {
                    const line = cart.get(parseInt(inp.getAttribute('data-lot-id')));
                    if (!line) return;
                    const raw = parseInt(inp.value);
                    if (isNaN(raw)) return; // mid-typing (field momentarily empty) — settle on blur
                    line.qty = Math.max(1, Math.min(raw, line.remaining));
                    updateCartTotals();
                    updateStockHint();
                });
                // Normalise on blur. Rebuilding here rather than on every
                // keystroke is what lets a clamped or emptied value settle
                // back to a legal number without the field losing focus.
                inp.addEventListener('change', () => renderCart());
            });

            cartEl.querySelectorAll('.sr-cart-remove').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const lotId = parseInt(btn.getAttribute('data-lot-id'));
                    // Removing the line under edit would leave the form saving
                    // into a key that no longer exists.
                    if (lotId === editingLotId) exitEditMode({ silent: true });
                    cart.delete(lotId);
                    renderCart();
                    updateStockHint();
                });
            });

            cartEl.querySelectorAll('.sr-cart-card').forEach(card => {
                card.addEventListener('click', () => {
                    const lotId = parseInt(card.getAttribute('data-lot-id'));
                    if (lotId === editingLotId) exitEditMode();
                    else enterEditMode(lotId);
                });
            });
        }
        updateCartTotals();
    }

    // Loads a cart line back into the left form so the LOT itself can be
    // corrected — the quantity alone is editable inline on the card, so this
    // is for "I scanned the wrong lot". Same interaction as the Sales Order
    // cart, per user request 2026-09-03.
    function enterEditMode(lotId) {
        const line = cart.get(lotId);
        if (!line) return;
        editingLotId = lotId;
        selCoffee.value = String(line.groupIdx);
        renderLotOptions();
        selLot.value = String(line.lotId);
        inpQty.value = line.qty;
        syncAddButton();
        updateStockHint();
        renderCart();
        inpQty.focus();
        inpQty.select();
    }

    function exitEditMode(opts = {}) {
        editingLotId = null;
        inpQty.value = 1;
        syncAddButton();
        if (!opts.silent) {
            updateStockHint();
            renderCart();
        }
    }

    // One button, two jobs: "Add to list" normally, "Save changes" while a
    // line is loaded for editing.
    function syncAddButton() {
        const span = btnAdd.querySelector('span');
        const icon = btnAdd.querySelector('i');
        const editing = editingLotId !== null;
        const key = editing ? 'btn_sr_save' : 'btn_sr_add';
        const fallback = editing ? 'Save changes' : 'Add to list';
        if (span) {
            span.setAttribute('data-i18n', key);
            span.textContent = window.t ? (window.t(key) || fallback) : fallback;
        }
        if (icon) icon.className = (editing ? 'icon-check' : 'icon-plus') + ' va-middle-mr-1';
    }

    function addToCart(lot, qty) {
        const avail = availableFor(lot);
        if (qty <= 0) return false;
        const take = Math.min(qty, avail);
        if (take <= 0) return false;
        if (cart.has(lot.lotId)) {
            cart.get(lot.lotId).qty += take;
        } else {
            cart.set(lot.lotId, { ...lot, qty: take });
        }
        renderCart();
        updateStockHint();
        return true;
    }

    // Sales Name keeps its column instead of being toggled out of the DOM: in
    // the 3-across top row, hiding it made Date/Category jump sideways every
    // time the category changed. Disabled + dimmed communicates the same thing
    // without the layout shift, and clearing the value keeps a name typed under
    // "Sales" from silently riding along into a "Waste" release.
    function applyCategoryRules() {
        const needs = stockReleaseCategoryNeeds(selCategory.value);
        salesInput.disabled = !needs.salesName;
        salesWrap.style.opacity = needs.salesName ? '1' : '0.45';
        salesHint.style.display = needs.salesName ? '' : 'none';
        if (!needs.salesName) salesInput.value = '';
        notesHint.textContent = needs.notes
            ? (window.t ? window.t('hint_sr_notes_required') : 'Required for the "Other" category.')
            : '';
    }

    selCoffee.addEventListener('change', renderLotOptions);
    selLot.addEventListener('change', updateStockHint);
    selCategory.addEventListener('change', applyCategoryRules);

    document.getElementById('sr-btn-add').addEventListener('click', async () => {
        const lot = selectedLot();
        if (!lot) return;
        const qty = parseInt(inpQty.value) || 0;
        if (qty <= 0) {
            await showWarningModal('Enter a quantity of at least 1.', false);
            return;
        }
        if (qty > availableFor(lot)) {
            await showWarningModal(`Only ${availableFor(lot)} pcs of lot ${lot.stripCode || lot.lotCode} are still available (stock minus what you've already added).`, false);
            return;
        }
        // Saving an edit rather than adding a new line. A changed lot means
        // the cart key changes too, so the old line is dropped and the new
        // one goes through addToCart — which merges if that lot was already
        // staged, instead of leaving two lines for the same lot.
        if (editingLotId !== null) {
            const originalId = editingLotId;
            if (lot.lotId === originalId) {
                cart.get(originalId).qty = qty;
            } else {
                cart.delete(originalId);
                editingLotId = null;
                addToCart(lot, qty);
            }
            exitEditMode();
            return;
        }

        addToCart(lot, qty);
        inpQty.value = 1;
    });

    // Resolves a strip code (or full lot code) against EVERY coffee's lots,
    // not just the selected one — then switches the coffee/lot selects to the
    // match before adding, so the operator sees what was picked up and the
    // cart works regardless of which coffee was showing.
    function matchAndAdd(raw, qty) {
        const code = (raw || '').trim();
        if (!code) return null;
        const stripCandidate = /^\d{5,7}$/.test(code) ? code.slice(0, 5) : code;
        const hit = allLots().find(l => l.stripCode === stripCandidate || l.lotCode === code);
        if (!hit) return null;
        selCoffee.value = String(hit.groupIdx);
        renderLotOptions();
        selLot.value = String(hit.lotId);
        updateStockHint();
        const lot = selectedLot();
        if (!lot) return null;
        return addToCart(lot, qty || 1) ? lot : null;
    }

    const scanInput = document.getElementById('sr-scan-input');
    scanInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const raw = scanInput.value;
        scanInput.value = '';
        const hit = matchAndAdd(raw, 1);
        if (!hit) {
            await showWarningModal('No lot with that code has stock remaining, or it is already fully staged in the list below.', false);
        }
    });

    window.activeStockReleaseScanHandler = async function (lotId, sizeG, multiplier) {
        const hit = allLots().find(l => l.lotId === lotId);
        if (!hit) {
            await showWarningModal(`Scanned lot #${lotId} has no stock remaining.`, false);
            return;
        }
        selCoffee.value = String(hit.groupIdx);
        renderLotOptions();
        selLot.value = String(hit.lotId);
        updateStockHint();
        const lot = selectedLot();
        if (lot) addToCart(lot, multiplier || 1);
    };

    renderLotOptions();
    renderCart();
    applyCategoryRules();

    // "Proceed" no longer writes anything — it swaps the form out for a
    // read-only review of exactly what is about to be deducted. Stock release
    // is irreversible from the UI (there is no un-release), so the operator
    // gets one deliberate look at the header + every lot line before the
    // deduction happens. Both steps live inside the same <form>, so the cart
    // Map and all listeners survive going Back.
    function currentHeader() {
        return {
            date: document.getElementById('sr-date').value,
            category: selCategory.value,
            salesName: salesInput.value.trim(),
            notes: document.getElementById('sr-notes').value.trim()
        };
    }

    function showConfirmStep() {
        const h = currentHeader();
        const lines = [...cart.values()];
        const total = lines.reduce((s, l) => s + l.qty, 0);
        const catDef = STOCK_RELEASE_CATEGORIES.find(c => c.value === h.category);
        const catLabel = catDef ? (window.t ? window.t(catDef.i18n) : catDef.fallback) : h.category;
        const dash = '<span style="color:var(--text-muted);">—</span>';

        const metaRow = (labelKey, fallback, value) => `
            <div>
                <div style="font-size:0.7rem; color:var(--text-muted);" data-i18n="${labelKey}">${fallback}</div>
                <div style="font-size:0.88rem; overflow-wrap:anywhere;">${value || dash}</div>
            </div>`;

        stepConfirm.innerHTML = `
            <div style="display:flex; align-items:flex-start; gap:10px; background:var(--primary-glow); border:1px solid var(--border-focus); border-radius:10px; padding:12px 14px; margin-bottom:16px;">
                <i class="icon-alert-circle" style="color:var(--primary); font-size:1.1rem;"></i>
                <div>
                    <div style="font-weight:700; font-size:0.92rem;" data-i18n="title_sr_confirm">Confirm Stock Release</div>
                    <div style="font-size:0.78rem; color:var(--text-secondary);" data-i18n="hint_sr_confirm">Check the details below. Recording this will deduct the stock immediately.</div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px,1fr)); gap:12px; padding-bottom:14px; border-bottom:1px solid var(--border); margin-bottom:14px;">
                ${metaRow('lbl_sr_date', 'Date', h.date)}
                ${metaRow('lbl_sr_category', 'Category', catLabel)}
                ${metaRow('lbl_sr_sales_name', 'Sales Name', h.salesName)}
                ${metaRow('lbl_sr_notes', 'Notes', h.notes)}
            </div>

            <div style="border:1px solid var(--border); border-radius:10px; overflow:hidden; margin-bottom:14px;">
                ${lines.map((line, idx) => `
                    <div style="display:flex; align-items:center; gap:12px; padding:10px 12px; ${idx > 0 ? 'border-top:1px solid var(--border);' : ''}">
                        <span style="font-family:monospace; font-weight:700; color:var(--primary); font-size:0.9rem;">${line.stripCode || line.lotCode}</span>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:0.85rem; overflow-wrap:anywhere;">${line.label} · ${line.sizeG}g</div>
                            <div style="font-size:0.7rem; color:var(--text-muted);">${line.packedDate || '-'}</div>
                        </div>
                        <span style="font-weight:700; font-size:0.95rem; white-space:nowrap;">${line.qty} pcs</span>
                    </div>
                `).join('')}
            </div>

            <div style="display:flex; align-items:baseline; justify-content:space-between; border-top:1px solid var(--border); padding-top:10px;">
                <span style="font-size:0.8rem; color:var(--text-secondary);" data-i18n="lbl_sr_total">Total released</span>
                <span style="font-size:1.5rem; font-weight:700; color:var(--primary);">${total} pcs</span>
            </div>

            <div class="modal-footer-actions-lg" style="margin-top:16px;">
                <button type="button" id="sr-btn-back" class="btn btn-secondary"><i class="icon-arrow-left va-middle-mr-1"></i><span data-i18n="btn_sr_back">Back</span></button>
                <button type="button" id="sr-btn-confirm" class="btn btn-primary" data-i18n="btn_sr_submit">Record Release</button>
            </div>
        `;

        stepForm.classList.add('hidden');
        stepConfirm.classList.remove('hidden');
        if (typeof window.translatePage === 'function') window.translatePage();

        document.getElementById('sr-btn-back').addEventListener('click', () => {
            stepConfirm.classList.add('hidden');
            stepForm.classList.remove('hidden');
        });
        document.getElementById('sr-btn-confirm').addEventListener('click', async (ev) => {
            // Guards a double-click from writing the release twice — the whole
            // submit path is async and the button stays clickable until the
            // modal closes.
            ev.target.disabled = true;
            await submitStockRelease({ ...currentHeader(), lines: [...cart.values()] });
            ev.target.disabled = false;
        });
    }

    document.getElementById('modal-stock-release-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const h = currentHeader();
        const needs = stockReleaseCategoryNeeds(h.category);
        // Validated here rather than only inside submitStockRelease so the
        // operator is sent back to the field that's wrong, instead of getting
        // the warning on a review screen that can't be edited.
        if (cart.size === 0) {
            await showWarningModal('Add at least one item before recording the release.', false);
            return;
        }
        if (needs.salesName && !h.salesName) {
            await showWarningModal('Enter the sales name — it is required for the Sales category.', false);
            salesInput.focus();
            return;
        }
        if (needs.notes && !h.notes) {
            await showWarningModal('Enter a note — it is required for the "Other" category.', false);
            document.getElementById('sr-notes').focus();
            return;
        }
        showConfirmStep();
    });
}

// Validates, writes the header + one item row per cart line, and consumes the
// lots — same consumption pattern as openDispatchCheckoutModal's runCheckout
// (decrementing packed_coffee_lots.remaining_pcs and the parent
// packed_coffee.quantity; quantity_pcs is the lot's original size and is
// never touched).
async function submitStockRelease({ date, category, salesName, notes, lines }) {
    if (!lines || lines.length === 0) {
        await showWarningModal('Add at least one item before recording the release.', false);
        return;
    }
    const needs = stockReleaseCategoryNeeds(category);
    if (needs.salesName && !salesName) {
        await showWarningModal('Enter the sales name — it is required for the Sales category.', false);
        return;
    }
    if (needs.notes && !notes) {
        await showWarningModal('Enter a note — it is required for the "Other" category.', false);
        return;
    }

    // Re-check against freshly fetched rows rather than the modal's snapshot:
    // stock can move while this modal is open (another dispatch, a repack),
    // and releasing more than a lot actually has would drive remaining_pcs
    // negative and silently corrupt FIFO.
    const { data: freshLots } = await fetchData('packed_coffee_lots');
    for (const line of lines) {
        const lot = (freshLots || []).find(l => l.id === line.lotId);
        const live = lot ? (parseInt(lot.remaining_pcs) || 0) : 0;
        if (line.qty > live) {
            await showWarningModal(`Lot ${line.stripCode || line.lotCode} only has ${live} pcs left now (someone else may have used it while this form was open). Adjust the quantity and try again.`, false);
            return;
        }
    }

    const { data: header, error: headerError } = await saveData('stock_releases', {
        date: date || new Date().toISOString().split('T')[0],
        category: category,
        sales_name: salesName || null,
        notes: notes || null,
        released_by: (currentUser && currentUser.name) || null
    });
    if (headerError || !header) {
        alert('Failed to record stock release: ' + (headerError ? headerError.message : 'unknown error'));
        return;
    }

    for (const line of lines) {
        // Atomic RPC (STOCK_LEDGER_PLAN.md Phase 1) — packed_coffee.quantity
        // is trigger-derived (sync_packed_coffee_quantity) from this lots
        // write, no separate packed_coffee write needed. Consumed first so
        // stock_release_items below records the pcs ACTUALLY taken, in case
        // a race clamped it below what was requested.
        const { data: taken, error: consumeErr } = await window.supabaseClient.rpc('consume_packed_lot', {
            p_lot_id: line.lotId, p_pcs: line.qty,
            p_operation: 'release', p_ref_table: 'stock_releases', p_ref_id: header.id,
            p_user: (currentUser && currentUser.name) || null
        });
        if (consumeErr) { console.error('consume_packed_lot RPC failed:', consumeErr); continue; }
        const actualQty = parseInt(taken) || 0;
        if (actualQty <= 0) continue;

        await saveData('stock_release_items', {
            stock_release_id: header.id,
            packed_coffee_lot_id: line.lotId,
            packed_coffee_id: line.packedCoffeeId,
            coffee_name: line.coffeeName,
            bag_size_g: line.sizeG,
            qty: actualQty
        });
    }

    document.getElementById('btn-close-modal').click();
    await loadStockReleaseSection();
    await loadPackingSection();
    scheduleDashboardRefresh();
}
