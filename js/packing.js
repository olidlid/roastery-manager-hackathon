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
        { data: repackSources }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('post_blend_components'),
        fetchData('packed_coffee_lots'),
        fetchData('packed_coffee'),
        fetchData('roasting_plans'),
        fetchData('repack_sources')
    ]);

    renderReadyToPackCards(bulkList, machines, greenbeans, recipes, postBlendComponents, packedLots, packedList, roastingPlans, repackSources);
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
function renderReadyToPackCards(bulkList, machines, greenbeans, recipes, postBlendComponents, packedLots, packedList, roastingPlans, repackSources) {
    const container = document.getElementById('ready-to-pack-cards');
    const emptyEl = document.getElementById('ready-to-pack-empty');
    if (!container) return;
    container.innerHTML = '';

    const groupKey = (b) => `${b.coffee_type}|${b.single_coffee_id || ''}|${b.blend_recipe_id || ''}|${b.machine_id || ''}|${b.coffee_name}`;

    const activeBulk = (bulkList || [])
        .filter(b => parseFloat(b.bulk_available) > 0.005)
        .sort((a, b) => a.coffee_name.localeCompare(b.coffee_name) || (a.machine_id || 0) - (b.machine_id || 0) || (a.production_date || '').localeCompare(b.production_date || ''));

    if (activeBulk.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

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
        || buildLotCode(bulk, machines, greenbeans, recipes, bulk.production_date);
    const postBlendBadge = (bulk) => bulk.is_post_blend
        ? ' <span style="font-size:0.65rem; font-weight:700; text-transform:uppercase; color:var(--primary); background:var(--primary-glow); border-radius:4px; padding:1px 6px; vertical-align:middle;">Post-Blend</span>'
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

    // One roast date in this coffee+machine group — unchanged from before the
    // grouping, so a coffee that's only been roasted once costs no extra click.
    function buildSingleCard(bulk) {
        return `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                <div>
                    <div style="font-weight: 700; font-size: 1rem;">${bulk.coffee_name}${postBlendBadge(bulk)}${repackBadge(bulk)}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${machineLabel(bulk)}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${bulk.production_date || '-'}</div>
                    ${repackProvenanceHtmlFor(bulk)}
                </div>
                ${codeBadgeHtmlFor(bulk)}
            </div>
            <div style="font-family: monospace; font-size: 0.72rem; font-weight: 700; color: var(--primary); background: var(--primary-glow); border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; align-self: flex-start; letter-spacing: 0.3px;">${lotCodeFor(bulk)}</div>
            <div style="font-size: 1.4rem; font-weight: 700; color: var(--primary);">${parseFloat(bulk.bulk_available).toFixed(2)} kg</div>
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

    groups.forEach(rows => {
        const card = document.createElement('div');
        card.className = rows[0].is_repack ? 'card card-repack' : 'card';
        card.style.cssText = 'padding: 16px; display: flex; flex-direction: column; gap: 10px;';
        card.innerHTML = rows.length === 1 ? buildSingleCard(rows[0]) : buildGroupedCard(rows);
        container.appendChild(card);
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
    if (window.translatePage) window.translatePage();
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
    const [{ data: bulkList }, { data: machines }, { data: greenbeans }, { data: recipes }] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_recipes')
    ]);
    const bulk = (bulkList || []).find(b => b.id === bulkId);
    if (!bulk) return;

    const leftoverKg = parseFloat(bulk.bulk_available) || 0;
    const machine = (machines || []).find(m => m.id === bulk.machine_id);
    const lotCode = bulk.custom_blend_code || buildLotCode(bulk, machines, greenbeans, recipes, bulk.production_date);
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

        const { error: wasteErr } = await saveData('waste_inventory', {
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

        const { error: bulkErr } = await saveData('bulk_roasted_coffee', { id: bulk.id, bulk_available: 0 });
        if (bulkErr) {
            await showWarningModal('Could not close the lot: ' + bulkErr.message, false);
            return;
        }

        document.getElementById('btn-close-modal').click();
        await showWarningModal(window.t ? window.t('close_lot_saved') : 'Lot closed. The leftover was recorded as waste.', false);
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
        { data: greenbeans }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('packed_coffee'),
        fetchData('packed_coffee_lots'),
        fetchData('machines'),
        fetchData('green_coffee')
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

    // packed_coffee doesn't reliably carry single_coffee_id for rows created
    // outside the roast-log flow (e.g. getOrCreatePackedCoffeeRow) — same
    // name-matching convention used elsewhere (packing.js resolvePackedIdentity).
    function resolvePackedGreenCoffeeId(p) {
        if (p.single_coffee_id) return p.single_coffee_id;
        const cleanName = (p.custom_coffee_name || '').replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
        const gb = (greenbeans || []).find(g => g.name === cleanName);
        return gb ? gb.id : null;
    }

    // Every available SOURCE POOL, single-origin only (a custom blend's
    // ingredients are green-coffee origins, same as a recipe's) — one entry
    // per bulk item, one per packed item+size, each tagged with its
    // underlying green coffee so picks for the same ingredient can be
    // grouped/filtered by it.
    const bulkOptions = (bulkList || [])
        .filter(b => b.coffee_type === 'Single' && parseFloat(b.bulk_available) > 0.005 && !b.is_post_blend)
        .map(b => {
            const name = (greenbeans || []).find(g => g.id === b.single_coffee_id)?.name || b.coffee_name;
            return {
                key: `bulk:${b.id}`, kind: 'bulk', refId: b.id, greenCoffeeId: b.single_coffee_id, sortName: name,
                label: `${toBoldUnicode(name)} — Bulk (${machineName(b.machine_id)}, roasted ${b.production_date || '-'})`,
                availableKg: parseFloat(b.bulk_available) || 0
            };
        });

    const packedOptions = (packedList || [])
        .filter(p => (parseInt(p.quantity) || 0) > 0)
        .map(p => {
            const gcId = resolvePackedGreenCoffeeId(p);
            if (!gcId) return null;
            const gb = (greenbeans || []).find(g => g.id === gcId);
            const name = gb ? gb.name : (p.custom_coffee_name || 'Roasted Coffee');
            const lotsForThis = (packedLots || [])
                .filter(l => l.packed_coffee_id === p.id && (parseInt(l.remaining_pcs) || 0) > 0)
                .sort((a, b) => (a.packed_date || '').localeCompare(b.packed_date || '') || a.id - b.id);
            const availPcs = lotsForThis.reduce((s, l) => s + (parseInt(l.remaining_pcs) || 0), 0);
            const bagSizeG = parseFloat(p.bag_size_g) || 0;
            return {
                key: `packed:${p.id}`, kind: 'packed', refId: p.id, greenCoffeeId: gcId, bagSizeG, sortName: name,
                label: `${toBoldUnicode(name)} — Packed ${p.bag_size_g || '-'}g (${machineName(p.machine_id)})`,
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
        await showWarningModal('No single-origin bulk or packed stock available to build a custom blend from yet.', false);
        return;
    }

    function optionByKey(key) { return allOptions.find(o => o.key === key); }
    function optionsHtml(greenCoffeeId, selectedKey) {
        const list = greenCoffeeId ? allOptions.filter(o => o.greenCoffeeId === greenCoffeeId) : allOptions;
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
        if (submitBtn) submitBtn.disabled = anyIncomplete || anyOver || totalKg <= 0;
    }

    function renderAll() {
        renderIngredients();
    }

    document.getElementById('cb-add-ingredient').addEventListener('click', () => {
        ingredients.set(++ingSeq, { optionKey: '', lotId: null, amount: 0 });
        renderAll();
    });

    renderAll();

    document.getElementById('cb-submit').addEventListener('click', async () => {
        const name = (document.getElementById('cb-name').value || '').trim();
        const coffeeCode = (document.getElementById('cb-coffee-code').value || '').trim();

        if (!name) { await showWarningModal('Please enter a blend name.', false); return; }
        if (!coffeeCode) { await showWarningModal('Coffee Code is required.', false); return; }
        if (ingredients.size === 0) { await showWarningModal('Add at least one ingredient.', false); return; }

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

        await submitCustomBlend({ name, coffeeCode, sourceRows });
    });
}

async function submitCustomBlend({ name, coffeeCode, sourceRows }) {
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
            const avail = parseFloat(fresh.bulk_available) || 0;
            const kg = Math.min(row.amountKg, avail); // capped — never draws more than exists
            if (kg <= 0) continue;
            fresh.bulk_available = Math.max(0, avail - kg);
            await saveData('bulk_roasted_coffee', fresh);
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
            await saveData('packed_coffee_lots', { id: lot.id, remaining_pcs: Math.max(0, availPcs - bagsUsed) });
            if (packedRow) {
                packedRow.quantity = Math.max(0, (parseInt(packedRow.quantity) || 0) - bagsUsed);
                await saveData('packed_coffee', packedRow);
            }
            totalKg += kg;
            componentsToInsert.push({ source_type: 'Packed', source_bulk_id: null, source_packed_lot_id: row.lotId, kg });
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
        machine_id: null,
        single_coffee_id: null,
        blend_recipe_id: null,
        production_date: todayStr
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

    await showWarningModal(`Blend "${name}" created — ${totalKg.toFixed(2)} kg, code ${code}.`, false);
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

        await saveData('packed_coffee_lots', { id: lot.id, quantity_pcs: newQty, remaining_pcs: newRemaining });

        if (parentPacked) {
            const newParentQty = Math.max(0, (parseInt(parentPacked.quantity) || 0) + (newRemaining - currentRemaining));
            await saveData('packed_coffee', { id: parentPacked.id, quantity: newParentQty });
        }

        // More bags packed = more bulk kg consumed, so bulk moves the
        // opposite direction of the packed-quantity delta. Optional: the
        // correction might instead be about a QC/spoilage issue where the
        // bulk really was consumed as originally recorded, so this is
        // left as a checkbox rather than automatic.
        const adjustBulkEl = document.getElementById('m-correct-adjust-bulk');
        if (bulkRow && adjustBulkEl && adjustBulkEl.checked) {
            const bulkDeltaKg = -delta * bagSizeKg;
            const newBulkAvailable = Math.max(0, bulkAvailable + bulkDeltaKg);
            await saveData('bulk_roasted_coffee', { id: bulkRow.id, bulk_available: newBulkAvailable });
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
        await showWarningModal('Correction saved.', false);
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
    
    // V2 1G: cards instead of a table row per order — per-line "Ready"
    // inputs are gone, replaced by the "Prepare" button opening the POS
    // checkout modal (openDispatchCheckoutModal) where fulfillment happens
    // by scan or manual lot pick. A card still shows Dispatch directly when
    // every line is already fully prepared (nothing left to check out).
    let cardsHtml = '';
    for (const order of limitedPreparingOrders) {
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);

        const allItemsReady = items.length > 0 && items.every(i => {
            const req = parseInt(i.quantity_requested) || 0;
            const prep = parseInt(i.quantity_prepared) || 0;
            return prep >= req;
        });

        let linesHtml = '';
        for (const item of items) {
            const type = item.coffee_type;
            const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;

            let coffeeName = '';
            if (item.coffee_code) {
                const def = (codeDefinitions || []).find(d => d.code === item.coffee_code);
                coffeeName = def ? `${def.name} (Single)` : `Code ${item.coffee_code}`;
            } else if (type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === coffeeId);
                coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
            } else {
                const r = (recipes || []).find(rec => rec.id === coffeeId);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
            }

            const itemMachine = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;

            const totalRequested = parseInt(item.quantity_requested) || 0;
            const alreadyPrepared = parseInt(item.quantity_prepared) || 0;
            const isCompleted = alreadyPrepared >= totalRequested;

            linesHtml += `
                <div style="display: flex; align-items: baseline; gap: 8px; font-size: 0.82rem;">
                    <span style="font-weight: 600;">${coffeeName}</span>
                    <span style="color: var(--text-muted);">${item.bag_size_g}g${itemMachine ? ', ' + itemMachine.name : ''}</span>
                    <span style="margin-left: auto; font-weight: 600; color: ${isCompleted ? 'var(--success)' : 'var(--danger)'};">${alreadyPrepared} / ${totalRequested}</span>
                </div>
            `;
        }

        const cust = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null;

        // A fully-ready order used to only show Dispatch, with no way back
        // into the checkout modal to correct a wrong fulfillment (found
        // 2026-07-27: an order auto-marked "Ready" from stale packed stock
        // at approval had no path to reopen and fix it). Edit reopens the
        // same checkout modal regardless of ready state.
        const actionBtnHtml = allItemsReady
            ? `<button class="btn btn-secondary btn-sm btn-edit-ready-order" data-order="${order.id}" style="flex: 0 0 auto; padding-left: 14px; padding-right: 14px;" title="Edit / correct fulfillment" ${hasPermission('packing_dispatch_checkout') ? '' : 'disabled title="No permission to edit orders"'}>Edit</button><button class="btn btn-success btn-sm btn-dispatch-order" data-order="${order.id}" style="flex: 1; font-weight: 700;">Dispatch</button>`
            : `<button class="btn btn-primary btn-sm btn-prepare-order" data-order="${order.id}" style="flex: 1; font-weight: 700;" ${hasPermission('packing_dispatch_checkout') ? '' : 'disabled title="No permission to checkout orders"'}>Prepare</button>`;

        cardsHtml += `
            <div class="card" style="padding: 16px 18px; margin: 0;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                    <div>
                        <div style="font-weight: 600; font-size: 0.95rem;"><code>${order.order_number || '#ORD-' + order.id}</code></div>
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">${order.sales_name}${cust ? ` &middot; ${cust.name}` : ''}</div>
                    </div>
                    <span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 4px; background: rgba(217,119,6,0.12); color: #d97706; font-weight: 600; white-space: nowrap;">Preparing</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px;">
                    ${linesHtml}
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary btn-sm btn-print-order" data-id="${order.id}" style="flex: 1;">Print</button>
                    ${actionBtnHtml}
                </div>
            </div>
        `;
    }
    container.innerHTML = cardsHtml;

    // EVENT DELEGATION
    container.onclick = async function(e) {
        // Handle Prepare button — opens the POS checkout modal
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
    };
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
    // Which lot(s) fulfilled an already-prepared line, if the fulfillment
    // came from THIS modal (records a trail) rather than from stock-fulfill
    // at order approval (js/sales.js, no per-lot trail) — lets "Undo" below
    // restore the exact stock it came from instead of guessing.
    let dispatchLotItemsAll = (dispatchLotItemsData || []).filter(d => items.some(i => i.id === d.request_order_item_id));

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
            return def ? `${def.name} (Single)` : `Code ${item.coffee_code}`;
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
            ? (greenbeans || []).filter(g => g.code === item.coffee_code).map(g => g.id)
            : null;
        const matchingPacked = (packedGoods || []).filter(p => {
            if (parseInt(p.bag_size_g) !== parseInt(item.bag_size_g)) return false;
            const idn = resolvePackedIdentity(p);
            if (!idn) return false;
            if (codeGroupIds) return idn.type === 'Single' && codeGroupIds.includes(idn.coffeeId);
            return idn.type === item.coffee_type && idn.coffeeId === itemCoffeeId;
        });
        const packedIds = new Set(matchingPacked.map(p => p.id));
        const machineByPackedId = new Map(matchingPacked.map(p => [p.id, p.machine_id]));
        // Origin name/code per packed_coffee_id — the physical green bean
        // that lot's sticker was printed for, not the trade name. Needed so
        // the Lot dropdown/Cart can tell two same-code origins apart.
        const originByPackedId = new Map(matchingPacked.map(p => {
            const idn = resolvePackedIdentity(p);
            const gb = idn && idn.type === 'Single' ? (greenbeans || []).find(g => g.id === idn.coffeeId) : null;
            return [p.id, gb ? { name: gb.name, code: gb.code || '' } : { name: 'Unknown', code: '' }];
        }));
        const lots = (packedLots || [])
            .filter(l => packedIds.has(l.packed_coffee_id) && (parseInt(l.remaining_pcs) || 0) > 0)
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
    // cart rows are added, so a second add sees what the first one already
    // took, without needing another DB round-trip.
    const liveRemaining = {};
    Object.values(lotsByItem).flat().forEach(l => { liveRemaining[l.id] = l.remaining; });

    // Cart rows keyed by "orderItemId:lotId" — scanning/adding the same
    // coffee+lot+size again increments the existing row.
    const cart = new Map();

    const machineName = (id) => { const m = (machines || []).find(mm => mm.id === id); return m ? m.name : 'Unknown'; };
    const fifoLotForItemMachine = (itemId) => {
        const item = items.find(i => i.id === itemId);
        // A trade-name item isn't tied to one machine — the oldest lot from
        // ANY origin/machine sharing the code is the FIFO recommendation.
        if (item.coffee_code) return (lotsByItem[itemId] || [])[0] || null;
        return (lotsByItem[itemId] || []).find(l => l.machineId === item.machine_id) || null;
    };
    const alreadyInCartForItem = (itemId) => {
        let sum = 0;
        cart.forEach(row => { if (row.orderItemId === itemId) sum += row.qty; });
        return sum;
    };

    // Header row for one order line — Code / Coffee (+size) / Machine / Stock
    // / Ready, click to expand its lots. A coffee_code (trade-name) line has
    // no single machine (it can draw from any origin sharing the code), so
    // that column shows '-'.
    function itemHeaderHtml(item) {
        const lots = lotsByItem[item.id] || [];
        const stock = lots.reduce((s, l) => s + (liveRemaining[l.id] || 0), 0);
        const requested = parseInt(item.quantity_requested) || 0;
        const ready = (parseInt(item.quantity_prepared) || 0) + alreadyInCartForItem(item.id);
        const short = stock < (requested - (parseInt(item.quantity_prepared) || 0));
        return `
            <button type="button" class="dc-item-row" data-item="${item.id}" aria-expanded="false" aria-controls="dc-lots-${item.id}">
                <span class="dc-item-name">
                    <span class="dc-chev">&#9656;</span>
                    ${itemCode(item) !== '-' ? `<span class="dc-code">${itemCode(item)}</span>` : ''}
                    <span class="dc-title">${coffeeLabel(item)}</span>
                    <span class="dc-size">${item.bag_size_g}g</span>
                </span>
                <span class="dc-mach">${item.coffee_code ? '-' : machineName(item.machine_id)}</span>
                <span class="dc-stock" id="dc-stock-${item.id}" style="${short ? 'color: var(--warning, #d97706);' : ''}">${stock}</span>
                <span class="dc-ready" id="dc-ready-${item.id}" style="color: ${ready >= requested ? 'var(--success)' : 'var(--danger)'};">${ready} / ${requested}</span>
            </button>
            <div id="dc-lots-${item.id}" class="dc-lots hidden"></div>
        `;
    }

    // Rebuilds ONE item's lot list from current cart/liveRemaining state —
    // called after every Take/Cancel/qty edit so a Take that spills across
    // several lots (addCartEntry's existing FIFO-spill logic, unchanged)
    // shows correctly without hand-patching individual rows.
    function renderItemLots(itemId) {
        const item = items.find(i => i.id === itemId);
        const lots = lotsByItem[itemId] || [];
        const prepared = parseInt(item.quantity_prepared) || 0;
        const requested = parseInt(item.quantity_requested) || 0;

        const itemTrail = dispatchLotItemsAll.filter(d => d.request_order_item_id === itemId);
        const trailQty = itemTrail.reduce((s, d) => s + (parseInt(d.qty) || 0), 0);
        const untrackedQty = Math.max(0, prepared - trailQty);
        // An inline expand-in-place form, not a second openModal() — the
        // checkout body already occupies the app's single shared modal slot,
        // so stacking another openModal() on top would wipe out this modal's
        // own DOM instead of layering over it. A plain prompt() was tried
        // first but froze the page during testing (native dialogs block the
        // renderer this app's automation drives) and is inconsistent with
        // the rest of the UI besides, so this follows the same
        // hidden-attribute expand/collapse pattern as .dc-lots.
        const committedHtml = prepared > 0
            ? `<div class="dc-committed">
                    <div>
                        Already checked out earlier: <b>${prepared}</b>
                        <span style="opacity:0.75;">(${trailQty > 0 ? trailQty + ' from lots' : ''}${trailQty > 0 && untrackedQty > 0 ? ', ' : ''}${untrackedQty > 0 ? untrackedQty + ' from approval' : ''})</span>
                        <button type="button" class="dc-committed-undo-toggle" data-item="${itemId}">Undo&hellip;</button>
                    </div>
                    <div class="dc-committed-undo-form hidden" data-item="${itemId}">
                        ${trailQty > 0 ? `<div class="dc-undo-note">${trailQty} from tracked lots — stock will be restored</div>` : ''}
                        ${untrackedQty > 0 ? `<div class="dc-undo-note">${untrackedQty} from order approval — stock already deducted, can't be auto-restored</div>` : ''}
                        <div style="display:flex; gap:8px; align-items:center; margin-top:6px;">
                            <input type="number" class="dc-undo-qty" min="1" max="${prepared}" value="${prepared}">
                            <button type="button" class="btn btn-danger btn-sm dc-committed-undo-confirm" data-item="${itemId}">Undo</button>
                            <button type="button" class="btn btn-secondary btn-sm dc-committed-undo-cancel" data-item="${itemId}">Cancel</button>
                        </div>
                    </div>
               </div>`
            : '';

        // Suggested qty for a not-yet-taken lot = remaining shortfall for this
        // line, split across lots in the order they'd naturally fill (FIFO
        // first) — mirrors what addCartEntry's own spill would do, so what's
        // pre-filled matches what actually happens on Take.
        let shortfall = Math.max(0, requested - prepared - alreadyInCartForItem(itemId));

        const rowsHtml = lots.map(l => {
            const key = `${itemId}:${l.id}`;
            const cartRow = cart.get(key);
            const taken = cartRow ? cartRow.qty : 0;
            const avail = (liveRemaining[l.id] || 0) + taken;
            const mismatch = !item.coffee_code && l.machineId !== item.machine_id;
            const isFifo = (fifoLotForItemMachine(itemId) || {}).id === l.id;
            let suggestQty = 1;
            if (!cartRow) {
                suggestQty = Math.max(1, Math.min(shortfall, liveRemaining[l.id] || 0) || 1);
                shortfall = Math.max(0, shortfall - Math.min(shortfall, liveRemaining[l.id] || 0));
            }
            return `
                <div class="dc-lot${mismatch ? ' dc-lot-mismatch' : ''}${taken > 0 ? ' dc-lot-taken' : ''}" data-item="${itemId}" data-lot="${l.id}">
                    <div class="dc-lot-main">
                        <span class="dc-lot-code">${l.stripCode ? `<b>${l.stripCode}</b> &middot; ${l.lotCode}` : l.lotCode}${isFifo ? ' <span class="dc-pill dc-pill-fifo">FIFO</span>' : ''}${mismatch ? ' <span class="dc-pill dc-pill-mismatch">Different machine</span>' : ''}</span>
                        <span class="dc-lot-meta">${l.originName}${l.originCode ? ' (' + l.originCode + ')' : ''} &middot; packed ${l.packedDate || '-'}${!item.coffee_code ? '' : ' &middot; ' + machineName(l.machineId)}</span>
                    </div>
                    <span class="dc-lot-stock">${avail}</span>
                    <span class="dc-lot-add">
                        <span class="dc-lot-check" ${taken > 0 ? '' : 'hidden'}>&#10003;</span>
                        <input type="number" class="dc-lot-qty" min="1" value="${taken > 0 ? taken : suggestQty}" ${avail <= 0 && taken === 0 ? 'disabled' : ''}>
                        <button type="button" class="btn btn-primary btn-sm dc-lot-take" ${taken > 0 ? 'hidden' : ''} ${avail <= 0 ? 'disabled' : ''}>Take</button>
                        <button type="button" class="btn btn-sm dc-lot-cancel" style="border:1px solid var(--border); background:none; color: var(--danger);" ${taken > 0 ? '' : 'hidden'}>Cancel</button>
                    </span>
                </div>
            `;
        }).join('') || `<div class="dc-lot-empty">No packed stock available for this coffee/size.</div>`;

        document.getElementById(`dc-lots-${itemId}`).innerHTML = committedHtml + rowsHtml;
    }

    function renderAllHeaders() {
        items.forEach(item => {
            const lots = lotsByItem[item.id] || [];
            const stock = lots.reduce((s, l) => s + (liveRemaining[l.id] || 0), 0);
            const requested = parseInt(item.quantity_requested) || 0;
            const prepared = parseInt(item.quantity_prepared) || 0;
            const ready = prepared + alreadyInCartForItem(item.id);
            const short = stock < (requested - prepared);
            const stockEl = document.getElementById(`dc-stock-${item.id}`);
            const readyEl = document.getElementById(`dc-ready-${item.id}`);
            if (stockEl) { stockEl.textContent = stock; stockEl.style.color = short ? 'var(--warning, #d97706)' : ''; }
            if (readyEl) { readyEl.textContent = `${ready} / ${requested}`; readyEl.style.color = ready >= requested ? 'var(--success)' : 'var(--danger)'; }
        });

        const anyRemaining = items.some(item => {
            const requested = parseInt(item.quantity_requested) || 0;
            const fulfilled = (parseInt(item.quantity_prepared) || 0) + alreadyInCartForItem(item.id);
            return fulfilled < requested;
        });
        const warnEl = document.getElementById('dc-warning');
        if (anyRemaining && cart.size > 0) {
            warnEl.classList.remove('hidden');
            warnEl.style.display = '';
            warnEl.textContent = 'Some lines are still short — checking out now leaves this order partially open, to finish later.';
        } else {
            warnEl.classList.add('hidden');
            warnEl.style.display = 'none';
        }

        let totalTaken = 0;
        cart.forEach(row => { totalTaken += row.qty; });
        const totalEl = document.getElementById('dc-total-taken');
        if (totalEl) totalEl.textContent = totalTaken;
    }

    function renderAll() {
        items.forEach(item => renderItemLots(item.id));
        renderAllHeaders();
    }

    // Lets a wrongly-fulfilled line be walked back even after the order shows
    // fully "Ready" (see actionBtnHtml's Edit button). Restores stock for
    // whatever portion has a dispatch_lot_items trail (this modal's own past
    // checkouts), newest-first; anything beyond that trail came from order
    // approval's stock-fulfill (js/sales.js, no per-lot record) and can only
    // have its counted quantity reduced, not its stock restored.
    async function undoCommittedQty(itemId, requestedUndoQty) {
        const item = items.find(i => i.id === itemId);
        if (!item) return;
        const prepared = parseInt(item.quantity_prepared) || 0;
        if (prepared <= 0) return;

        const trail = dispatchLotItemsAll.filter(d => d.request_order_item_id === itemId).sort((a, b) => b.id - a.id);

        let undoQty = parseInt(requestedUndoQty) || 0;
        if (undoQty <= 0) return;
        if (undoQty > prepared) undoQty = prepared;

        const [{ data: freshLots }, { data: freshPacked }] = await Promise.all([
            fetchData('packed_coffee_lots'),
            fetchData('packed_coffee')
        ]);

        let remaining = undoQty;
        for (const d of trail) {
            if (remaining <= 0) break;
            const dQty = parseInt(d.qty) || 0;
            if (dQty <= 0) continue;
            const take = Math.min(dQty, remaining);

            if (d.packed_coffee_lot_id) {
                const lot = (freshLots || []).find(l => l.id === d.packed_coffee_lot_id);
                if (lot) {
                    const newRemainingPcs = (parseInt(lot.remaining_pcs) || 0) + take;
                    await saveData('packed_coffee_lots', { id: lot.id, remaining_pcs: newRemainingPcs });
                    liveRemaining[lot.id] = (liveRemaining[lot.id] || 0) + take;
                    const packedRow = (freshPacked || []).find(p => p.id === lot.packed_coffee_id);
                    if (packedRow) {
                        packedRow.quantity = (parseInt(packedRow.quantity) || 0) + take;
                        await saveData('packed_coffee', packedRow);
                    }
                }
            }

            const newDQty = dQty - take;
            if (newDQty <= 0) {
                await deleteData('dispatch_lot_items', d.id);
                d.qty = 0;
                d._undone = true;
            } else {
                d.qty = newDQty;
                await saveData('dispatch_lot_items', { id: d.id, qty: newDQty });
            }
            remaining -= take;
        }
        dispatchLotItemsAll = dispatchLotItemsAll.filter(d => !d._undone);

        const newPrepared = Math.max(0, prepared - undoQty);
        item.quantity_prepared = newPrepared;
        if (remaining > 0) {
            // Leftover after the trail is exhausted came out of the
            // untracked (approval-fulfilled) portion.
            item.quantity_allocated = Math.max(0, (parseInt(item.quantity_allocated) || 0) - remaining);
        }
        const requested = parseInt(item.quantity_requested) || 0;
        item.item_status = newPrepared >= requested ? 'Ready for Handover' : 'Packing';
        await saveData('request_order_items', item);

        renderAll();
        await loadPackingRequestsSection();
        scheduleDashboardRefresh();
        await showWarningModal(`Undid ${undoQty} unit(s) for ${coffeeLabel(item)}.`, false);
    }

    const itemsListHtml = items.map(item => `<div class="dc-item" id="dc-item-${item.id}">${itemHeaderHtml(item)}</div>`).join('');

    const html = `
        <div id="dispatch-checkout-body">
            <div class="dc-order-info">
                <div>
                    <div class="dc-order-info-value"><code>${order.order_number || '#ORD-' + order.id}</code></div>
                    <div class="dc-order-info-sub">${order.sales_name || '-'}${cust ? ' &middot; ' + cust.name : ''}</div>
                </div>
                <div class="dc-order-info-value">${order.order_date || '-'}</div>
            </div>
            <div class="dc-col-head">
                <span>Coffee</span><span>Machine</span><span class="text-right">Stock</span><span class="text-right">Ready</span>
            </div>
            <div id="dc-item-list" style="margin-bottom:16px;">${itemsListHtml}</div>

            <div style="display:flex; gap:8px; margin-bottom:6px;">
                <input type="text" id="dc-scan-input" class="form-control" placeholder="Scan a package or carton barcode (coming soon)" autocomplete="off" style="flex:1;" disabled>
            </div>
            <p style="font-size:0.78rem; color:var(--text-muted); margin: 0 0 12px;">Scanning isn't wired up yet — pick lots from the list above for now.</p>

            <div id="dc-warning" class="hidden" style="background: rgba(217,119,6,0.12); border: 1px solid #d97706; color: #d97706; padding: 8px 12px; border-radius: 8px; font-size: 0.8rem; margin-bottom: 12px;"></div>

            <div class="modal-footer-actions-lg" style="justify-content:space-between;">
                <span style="font-size:0.82rem; color:var(--text-muted);">Total taken: <strong id="dc-total-taken" style="color:var(--text-primary);">0</strong></span>
                <div style="display:flex; gap:10px;">
                    <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                    <button type="button" id="dc-btn-checkout" class="btn btn-primary">Checkout</button>
                </div>
            </div>
        </div>
        <style>
            /* .btn sets display:inline-flex, which beats the bare [hidden]
               attribute (author CSS always outranks the UA default that
               makes [hidden] work) — without this, a hidden Take/Cancel
               button stays visible instead of actually disappearing. */
            #dispatch-checkout-body [hidden] { display: none !important; }
            /* The shared modal header carries inline padding/margin (see
               index.html), so only !important can tighten it — and :has()
               keeps it scoped to THIS modal, reverting on its own for
               every other modal that reuses the same shell. */
            #modal-container:has(#dispatch-checkout-body) .overlay-card > div:has(> #modal-title) {
                padding-bottom: 6px !important;
                margin-bottom: 8px !important;
            }
            #dispatch-checkout-body .dc-order-info { display:flex; justify-content:space-between; align-items:flex-start; padding:0 12px 8px; margin-bottom:8px; border-bottom:1px solid var(--border); }
            #dispatch-checkout-body .dc-order-info-value { font-weight:600; font-size:0.86rem; color:var(--text-primary); }
            #dispatch-checkout-body .dc-order-info-sub { font-size:0.76rem; color:var(--text-muted); margin-top:1px; }
            #dispatch-checkout-body .dc-col-head { display:grid; grid-template-columns:1fr 130px 70px 70px; gap:10px; padding:0 12px 6px; font-size:0.66rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); }
            #dispatch-checkout-body .dc-col-head span:nth-child(3), #dispatch-checkout-body .dc-col-head span:nth-child(4) { text-align:right; }
            #dispatch-checkout-body .dc-item { border:1px solid var(--border); border-radius:10px; overflow:hidden; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,0.04); }
            #dispatch-checkout-body .dc-item-row { display:grid; grid-template-columns:1fr 130px 70px 70px; gap:10px; align-items:center; width:100%; padding:14px 14px; background:var(--bg-card, none); border:none; text-align:left; cursor:pointer; font-family:inherit; font-size:0.86rem; color:var(--text-primary); }
            #dispatch-checkout-body .dc-item-row:hover { background:var(--bg-app); }
            #dispatch-checkout-body .dc-item-name { display:flex; align-items:center; gap:9px; min-width:0; }
            #dispatch-checkout-body .dc-chev { display:inline-block; color:var(--text-muted); font-size:0.7rem; transition:transform 0.15s ease; }
            #dispatch-checkout-body .dc-item.open .dc-chev { transform:rotate(90deg); }
            #dispatch-checkout-body .dc-code { font-family:monospace; font-weight:800; font-size:0.76rem; color:var(--primary); background:var(--primary-glow); border:1px solid var(--primary); border-radius:6px; padding:2px 7px; letter-spacing:0.3px; flex:0 0 auto; }
            #dispatch-checkout-body .dc-title { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            #dispatch-checkout-body .dc-size { font-family:monospace; font-size:0.76rem; color:var(--text-muted); flex:0 0 auto; background:var(--bg-app); border-radius:5px; padding:2px 6px; }
            #dispatch-checkout-body .dc-mach { font-size:0.78rem; color:var(--text-muted); }
            #dispatch-checkout-body .dc-stock { font-family:monospace; font-size:0.85rem; text-align:right; }
            #dispatch-checkout-body .dc-ready { font-family:monospace; font-weight:700; font-size:0.85rem; text-align:right; }
            #dispatch-checkout-body .dc-lots { border-top:1px solid var(--border); background:var(--bg-app); padding:6px; }
            #dispatch-checkout-body .dc-committed { font-size:0.76rem; color:var(--text-muted); background:none; border:1px solid var(--border); border-radius:6px; padding:7px 9px; margin:2px 3px 6px; }
            #dispatch-checkout-body .dc-committed-undo-toggle { margin-left:8px; background:none; border:none; padding:0; cursor:pointer; color:var(--danger); text-decoration:underline; font-size:0.76rem; font-family:inherit; }
            #dispatch-checkout-body .dc-committed-undo-form { margin-top:8px; padding-top:8px; border-top:1px dashed var(--border); }
            #dispatch-checkout-body .dc-undo-note { font-size:0.72rem; color:var(--text-muted); margin-top:2px; }
            #dispatch-checkout-body .dc-undo-qty { width:60px; padding:4px 6px; border-radius:5px; border:1px solid var(--border); background:var(--bg-app); color:var(--text-primary); font-size:0.78rem; text-align:right; font-family:monospace; }
            #dispatch-checkout-body .dc-lot-empty { font-size:0.8rem; color:var(--text-muted); padding:10px; text-align:center; }
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
        </style>
    `;

    openModal(`Checkout — ${order.order_number || '#ORD-' + order.id}`, html, '760px');

    // Core shared logic for both scan and manual add. Returns nothing; shows
    // its own alerts/warnings and re-renders on success.
    async function addCartEntry(itemId, lotId, qtyRequested) {
        const item = items.find(i => i.id === itemId);
        if (!item) { alert('That coffee is not on this order.'); return; }

        const requested = parseInt(item.quantity_requested) || 0;
        const prepared = parseInt(item.quantity_prepared) || 0;
        const remainingForLine = requested - prepared - alreadyInCartForItem(itemId);
        if (remainingForLine <= 0) {
            await showWarningModal(`This line (${coffeeLabel(item)}, ${item.bag_size_g}g) is already fully allocated.`, false);
            return;
        }

        const lots = lotsByItem[itemId] || [];
        const chosenLot = lots.find(l => l.id === lotId);
        if (!chosenLot) { alert('That lot is not available for this coffee/size.'); return; }

        const fifoLot = fifoLotForItemMachine(itemId);
        // A trade-name item isn't tied to one machine/origin — no such thing
        // as a "different machine" mismatch, only a FIFO recommendation.
        const machineMismatch = !item.coffee_code && chosenLot.machineId !== item.machine_id;
        const fifoMismatch = !machineMismatch && fifoLot && fifoLot.id !== chosenLot.id;
        if (machineMismatch || fifoMismatch) {
            const msg = machineMismatch
                ? `This lot (${chosenLot.lotCode}) was packed on ${machineName(chosenLot.machineId)}, not ${machineName(item.machine_id)} as requested.\n\nUse it anyway?`
                : `An older lot is still in stock: ${fifoLot.lotCode} (packed ${fifoLot.packedDate}, ${liveRemaining[fifoLot.id]} left).\n\nThis is a newer lot (${chosenLot.lotCode}). Use the FIFO recommendation first, unless there's a good reason not to.\n\nProceed with this lot anyway?`;
            const proceed = await showWarningModal(msg, true);
            if (!proceed) return;
        }

        const cappedQty = Math.min(qtyRequested, remainingForLine);

        // Spill oldest-first within the CHOSEN lot's own machine group if it
        // runs short — same idea as the green-bean side (1B), just scoped to
        // whichever machine the operator actually committed to here. A
        // trade-name item spills across EVERY origin/machine sharing the
        // code instead, since none of them is "the" expected machine.
        let toDraw = cappedQty;
        const sameMachinePool = (item.coffee_code ? lots : lots.filter(l => l.machineId === chosenLot.machineId))
            .sort((a, b) => new Date(a.packedDate) - new Date(b.packedDate) || a.id - b.id);
        const startIdx = sameMachinePool.findIndex(l => l.id === chosenLot.id);
        for (let i = startIdx; i < sameMachinePool.length && toDraw > 0; i++) {
            const l = sameMachinePool[i];
            const avail = liveRemaining[l.id] || 0;
            if (avail <= 0) continue;
            const take = Math.min(avail, toDraw);
            liveRemaining[l.id] = avail - take;
            toDraw -= take;

            const key = `${itemId}:${l.id}`;
            const existing = cart.get(key);
            if (existing) {
                existing.qty += take;
            } else {
                cart.set(key, { orderItemId: itemId, lotId: l.id, lotCode: l.lotCode, machineId: l.machineId, machineName: machineName(l.machineId), sizeG: item.bag_size_g, qty: take, originName: l.originName, originCode: l.originCode });
            }
        }

        renderAll();
    }

    renderAll();

    // Expand/collapse — lazy nothing to compute, the lot list for every item
    // was already rendered above, this only toggles visibility.
    document.getElementById('dc-item-list').addEventListener('click', async (e) => {
        const headerBtn = e.target.closest('.dc-item-row');
        if (headerBtn) {
            const itemEl = headerBtn.closest('.dc-item');
            const list = document.getElementById(headerBtn.getAttribute('aria-controls'));
            const open = list.classList.toggle('hidden') === false;
            headerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            itemEl.classList.toggle('open', open);
            return;
        }

        const undoToggle = e.target.closest('.dc-committed-undo-toggle');
        if (undoToggle) {
            const itemId = undoToggle.getAttribute('data-item');
            const form = document.querySelector(`.dc-committed-undo-form[data-item="${itemId}"]`);
            if (form) form.classList.toggle('hidden');
            return;
        }

        const undoCancel = e.target.closest('.dc-committed-undo-cancel');
        if (undoCancel) {
            const form = undoCancel.closest('.dc-committed-undo-form');
            if (form) form.classList.add('hidden');
            return;
        }

        const undoConfirm = e.target.closest('.dc-committed-undo-confirm');
        if (undoConfirm) {
            const itemId = parseInt(undoConfirm.getAttribute('data-item'));
            const form = undoConfirm.closest('.dc-committed-undo-form');
            const qty = parseInt(form.querySelector('.dc-undo-qty').value) || 0;
            if (qty <= 0) return;
            if (!await showWarningModal(`Undo ${qty} unit(s) already checked out for this line?`, true)) return;
            await undoCommittedQty(itemId, qty);
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
    });

    // Editing the qty on an already-taken lot adjusts it directly — no need
    // to Cancel first just to fix a miscount.
    document.getElementById('dc-item-list').addEventListener('input', (e) => {
        const inp = e.target.closest('.dc-lot-qty');
        if (!inp) return;
        const lotEl = inp.closest('.dc-lot');
        if (!lotEl.classList.contains('dc-lot-taken')) return;
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
    });

    // V2 barcode label fix: a RMP:9{lotId:05d}{sizeG:04d}{mult:02d} barcode
    // is resolved here (by the packed_coffee_lots row's own numeric id, not
    // its lot_code text) while this modal is open — see
    // js/roasting.js handleBarcodeScan's PackLot dispatch branch. Scanning
    // itself isn't wired up in the UI yet (dc-scan-input is disabled — see
    // openDispatchCheckoutModal's HTML), so this only fires if something
    // else routes a scan here; left in place for when scanning ships.
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

    document.getElementById('dc-btn-checkout').addEventListener('click', async () => {
        await submitDispatchCheckout(order, items, cart, cust);
    });

    // Clear the active-scan hook whenever this modal closes by any route
    // (Cancel, the shared × close button, or after a successful checkout).
    const modalCloseBtn = document.getElementById('btn-close-modal');
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', () => { window.activeDispatchCheckoutHandler = null; }, { once: true });
    }
}

// V2 1G: persists the checkout modal's cart — supersedes the old single-line
// "Ready" flow (markOrderItemReady), since fulfillment is now lot-level and
// can touch multiple order lines from one screen. `items`/`cust` are the
// snapshot captured when the modal opened; DB rows are re-fetched fresh here
// since packed stock may have moved since then.
async function submitDispatchCheckout(order, items, cart, cust) {
    if (cart.size === 0) {
        await showWarningModal('Add at least one lot to the cart before checking out.', false);
        return;
    }

    const [{ data: freshItems }, { data: freshLots }, { data: freshPacked }] = await Promise.all([
        fetchData('request_order_items'),
        fetchData('packed_coffee_lots'),
        fetchData('packed_coffee')
    ]);

    // Sum cart qty per order line.
    const qtyByItem = new Map();
    cart.forEach(row => { qtyByItem.set(row.orderItemId, (qtyByItem.get(row.orderItemId) || 0) + row.qty); });

    // Deduct packed_coffee_lots (the per-lot source of truth) and keep the
    // parent packed_coffee row's flattened total in sync (not yet derived —
    // see V2_ROADMAP.md 1G), then record the fulfillment for traceability.
    for (const row of cart.values()) {
        const lot = (freshLots || []).find(l => l.id === row.lotId);
        if (!lot) continue;
        const newRemaining = Math.max(0, (parseInt(lot.remaining_pcs) || 0) - row.qty);
        await saveData('packed_coffee_lots', { id: lot.id, remaining_pcs: newRemaining });

        const packedRow = (freshPacked || []).find(p => p.id === lot.packed_coffee_id);
        if (packedRow) {
            packedRow.quantity = Math.max(0, (parseInt(packedRow.quantity) || 0) - row.qty);
            await saveData('packed_coffee', packedRow);
        }

        await saveData('dispatch_lot_items', {
            request_order_item_id: row.orderItemId,
            packed_coffee_lot_id: row.lotId,
            customer_id: cust ? cust.id : null,
            qty: row.qty
        });
    }

    // Credit each order line's quantity_prepared; full lines go straight to
    // 'Ready for Handover', partial lines stay 'Packing' so the order remains
    // an active card (existing allItemsReady logic in
    // loadPackingRequestsSection keeps it open until every line catches up).
    let stillShort = false;
    for (const [itemId, checkoutQty] of qtyByItem) {
        const item = (freshItems || []).find(i => i.id === itemId);
        if (!item) continue;
        const requested = parseInt(item.quantity_requested) || 0;
        const newPrepared = (parseInt(item.quantity_prepared) || 0) + checkoutQty;
        item.quantity_prepared = newPrepared;
        item.item_status = newPrepared >= requested ? 'Ready for Handover' : 'Packing';
        if (newPrepared < requested) stillShort = true;
        await saveData('request_order_items', item);
    }
    // Lines this checkout didn't touch at all might still be short too.
    items.forEach(item => {
        if (!qtyByItem.has(item.id) && (parseInt(item.quantity_prepared) || 0) < (parseInt(item.quantity_requested) || 0)) {
            stillShort = true;
        }
    });

    window.activeDispatchCheckoutHandler = null;
    const closeBtn = document.getElementById('btn-close-modal');
    if (closeBtn) closeBtn.click();

    await showWarningModal(
        stillShort
            ? 'Checkout saved. This order still has lines pending — it stays open for the remainder.'
            : 'Checkout saved. All lines are fulfilled — ready to dispatch.',
        false
    );

    const printNow = await showWarningModal('Print the waybill now?', true);
    if (printNow) await printOrderDetail(order.id);

    await loadPackingRequestsSection();
    scheduleDashboardRefresh();
}

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
    
    await showWarningModal('✅ Order dispatched! The sales team has picked up the packed items.', false);
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

function printLotBarcodeLabels(lot, requested, machines) {
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
    const showCoffeeName = cfg.coffee_name !== false;
    const showDates = cfg.dates !== false;
    const showMachine = cfg.machine !== false;

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
// Orientation is the BROWSER's job here, not the app's (changed 2026-07-30
// per explicit user request — the old companySettings.label_rotate_90
// setting and the per-print Landscape/Portrait radios are both gone).
// Two things are needed to make Chrome's own control work:
//   1. @page declares NO size. Chrome only offers its "Layout:
//      Portrait/Landscape" control when the page has no explicit @page
//      size — declaring one pins "Paper size: User defined" and REMOVES the
//      layout dropdown entirely, which is precisely why this app had to
//      carry its own toggle before. Paper size now comes from the printer
//      driver's selected media, which Chrome remembers per destination.
//   2. Chrome's Layout control rotates the PAPER, not the content. Left
//      alone it would reflow this label into a ~25mm-wide column and
//      squeeze the barcode to unscannable module widths (see the module
//      width note below). The `@media print and (orientation: portrait)`
//      block rotates the content back 90° so the barcode always runs along
//      the label's LONG edge either way. Sized in vh/vw (which resolve to
//      the page box) instead of hardcoded mm, so it adapts to whatever
//      media the driver is set to rather than assuming 50x25mm.
function buildFixedLabelDocument(labelsHtml, showCode, packedBarcodeHeightMm) {
    // 0.5mm page margin (was 1mm) to reclaim print area — most thermal roll
    // printers can hold 0.5mm reliably.
    const pageCss = `@page { margin: 0.5mm; }`;
    const itemCss = `.barcode-label-item {
                width: 100%;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
                padding: 0 1mm;
                page-break-after: always;
           }
           /* Portrait media selected in Chrome's print dialog: draw the label
              at landscape proportions — 100vh wide x 100vw tall, i.e. the
              page box with its axes swapped — then rotate 90 degrees about
              its own top-left corner and shift right by the page's width so
              it lands exactly filling the portrait page. Relative positioning
              only offsets the paint (the element stays in normal block flow),
              so page-break-after keeps working across multiple labels. */
           @media print and (orientation: portrait) {
               .barcode-label-item {
                   width: 100vh;
                   height: 100vw;
                   position: relative;
                   left: 100vw;
                   top: 0;
                   transform: rotate(90deg);
                   transform-origin: top left;
               }
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
            .barcode-label-main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; text-align: center; }
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
            .lbl-dates { font-size: 2mm; font-weight: 700; line-height: 1.15; margin-top: 0.15mm; }
        </style></head><body>
        ${labelsHtml}
        <script>
            document.querySelectorAll('.lot-barcode-svg').forEach(el => {
                JsBarcode(el, el.dataset.value, { format: 'CODE128', width: 2.2, height: 60, displayValue: ${showCode}, text: el.dataset.display, fontSize: 22, margin: 4 });
                el.setAttribute('preserveAspectRatio', 'none');
            });
            setTimeout(() => { window.print(); }, 500);
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
            const { data: freshBulkList } = await fetchData('bulk_roasted_coffee');
            const freshBulk = (freshBulkList || []).find(b => b.id === bulk.id);
            if (freshBulk) {
                freshBulk.bulk_available = Math.max(0, parseFloat(freshBulk.bulk_available) - totalKg);
                await saveData('bulk_roasted_coffee', freshBulk);
            }

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
                packedRow.quantity = (parseInt(packedRow.quantity) || 0) + add.qty;
                await saveData('packed_coffee', packedRow);

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
            await showWarningModal('Packing saved successfully.', false);
            await loadPackingSection();
            scheduleDashboardRefresh();
        } catch (err) {
            console.error('Pack bulk submit error:', err);
            alert('Error during packing save: ' + err.message);
        }
    });
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
async function getOrCreatePackedCoffeeLot(packedCoffeeId, qty, productionLotId) {
    const { data: existingLots } = await fetchData('packed_coffee_lots');

    if (productionLotId) {
        const existing = (existingLots || []).find(l => l.packed_coffee_id === packedCoffeeId && l.production_lot_id === productionLotId);
        if (existing) {
            const newQtyPcs = (parseInt(existing.quantity_pcs) || 0) + qty;
            const newRemaining = (parseInt(existing.remaining_pcs) || 0) + qty;
            await saveData('packed_coffee_lots', { id: existing.id, quantity_pcs: newQtyPcs, remaining_pcs: newRemaining });
            return { ...existing, quantity_pcs: newQtyPcs, remaining_pcs: newRemaining };
        }
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
        production_lot_id: productionLotId
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
    const findExisting = (list) => (list || []).find(p =>
        !p.roast_batch_id &&
        (p.custom_coffee_name || '').trim().toLowerCase() === (name || '').trim().toLowerCase() &&
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
        record.quantity = newQty;
        await saveData('packed_coffee', record);
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
                targetRec.bulk_available = newVal;
                await saveData('bulk_roasted_coffee', targetRec);
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
        { data: sizes }
    ] = await Promise.all([
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('packaging_sizes')
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
        if (!coffeeCode) {
            const gbMatch = greenbeans.find(g => g.name === coffeeName);
            const rMatch = recipes.find(r => r.name === coffeeName);
            coffeeCode = (gbMatch && gbMatch.code) || (rMatch && rMatch.code) || '';
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

    // Determine the active machine columns to display
    let hasUnknown = false;
    Object.values(grouped).forEach(group => {
        if (group.machines['Unknown'] && Object.values(group.machines['Unknown'].sizes).some(s => s.qty > 0)) {
            hasUnknown = true;
        }
    });

    const activeMachinesList = machines.slice().sort((a,b) => a.name.localeCompare(b.name));
    if (hasUnknown) {
        activeMachinesList.push({ id: 'unknown', name: 'Unknown' });
    }

    // Update thead — 2-row header (machine name spanning its active-size
    // columns, then a size sub-row) instead of one machine column that
    // stacked every size as its own line inside the body cell. Flattening to
    // one column per machine×size combo makes every body row exactly one
    // line tall, so far more coffees fit on screen without scrolling — same
    // rowspan/colspan pattern already used by the Daily Achievement table.
    const theadEl = document.getElementById('packed-coffee-stock-table-thead');
    const sizeCount = Math.max(1, activeSizes.length);
    if (theadEl) {
        let row1 = `<tr><th rowspan="2" data-i18n="col_name">${window.t ? window.t('col_name') : 'Coffee Name'}</th>`;
        activeMachinesList.forEach((m, idx) => {
            const groupBorder = idx > 0 ? 'border-left: 2px solid var(--border);' : '';
            row1 += `<th colspan="${sizeCount}" class="text-center" style="${groupBorder}">${m.name}</th>`;
        });
        row1 += `<th rowspan="2" data-i18n="col_action">${window.t ? window.t('col_action') : 'Action'}</th></tr>`;

        let row2 = '<tr>';
        activeMachinesList.forEach((m, mIdx) => {
            activeSizes.forEach((sz, szIdx) => {
                const groupBorder = (mIdx > 0 && szIdx === 0) ? 'border-left: 2px solid var(--border);' : '';
                row2 += `<th class="text-center" style="background-color: rgba(0,0,0,0.03); font-size: 0.72rem; ${groupBorder}">${sz.gram}g</th>`;
            });
        });
        row2 += '</tr>';

        theadEl.innerHTML = row1 + row2;
    }

    if (Object.keys(grouped).length === 0) {
        tbody.innerHTML = `<tr><td colspan="${activeMachinesList.length * sizeCount + 2}" class="text-center-muted">${window.t ? window.t("msg_no_packed_avail") : 'No packed coffee available.'}</td></tr>`;
        return;
    }

    Object.values(grouped).sort((a,b) => a.coffeeName.localeCompare(b.coffeeName)).forEach(group => {
        const tr = document.createElement('tr');

        const codeLabel = group.coffeeCode ? `<code style="font-size:0.78rem; color:var(--text-muted); margin-right:6px;">${group.coffeeCode}</code>` : '';
        let html = `<td>${codeLabel}<strong class="packed-stock-row-name" data-coffee="${encodeURIComponent(group.coffeeName)}" style="cursor:pointer; text-decoration:underline dotted;" title="Click to view stock by lot">${group.coffeeName}</strong></td>`;

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

        html += `
            <td style="white-space: nowrap;">
                <button class="btn btn-outline btn-sm btn-edit-packed" data-coffee="${encodeURIComponent(group.coffeeName)}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle-mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit
                </button>
                <button class="btn btn-danger btn-sm btn-delete-packed ml-1" data-coffee="${encodeURIComponent(group.coffeeName)}" >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
            </td>
        `;

        tr.innerHTML = html;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.packed-stock-row-name').forEach(el => {
        el.addEventListener('click', () => openPackedLotsModal(decodeURIComponent(el.getAttribute('data-coffee'))));
    });

    document.querySelectorAll('.btn-edit-packed').forEach(btn => {
        btn.addEventListener('click', () => openEditPackedModal(decodeURIComponent(btn.getAttribute('data-coffee'))));
    });

    document.querySelectorAll('.btn-delete-packed').forEach(btn => {
        btn.addEventListener('click', async () => {
            const coffeeName = decodeURIComponent(btn.getAttribute('data-coffee'));
            const confirmed = await showWarningModal(`Are you sure you want to delete all packed stock for "${coffeeName}"?\n\nThis action cannot be undone.`);
            if (!confirmed) return;
            const { data: allPacked } = await fetchData('packed_coffee');
            const toDelete = (allPacked || []).filter(p => (p.custom_coffee_name === coffeeName || p.custom_coffee_name === coffeeName.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '')));
            for (const item of toDelete) {
                await deleteData('packed_coffee', item.id);
            }
            await loadPackedCoffeeSection();
            scheduleDashboardRefresh();
        });
    });
}

// V2 1G-1: read-only drill-down of a coffee's packed stock by individual
// lot (machine + size + packed date + remaining pcs) — the first visible
// proof that packed_coffee_lots (populated by getOrCreatePackedCoffeeLot on
// every pack action) is actually tracking real per-lot stock, ahead of the
// bigger FIFO-dispatch rework that will make it the source of truth.
async function openPackedLotsModal(coffeeName) {
    const [
        { data: packed },
        { data: packedLots },
        { data: machines },
        { data: batches },
        { data: greenbeans },
        { data: recipes }
    ] = await Promise.all([
        fetchData('packed_coffee'),
        fetchData('packed_coffee_lots'),
        fetchData('machines'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes')
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

    const matchingPackedIds = new Set(resolved.filter(r => r.resolvedName === coffeeName).map(r => r.id));
    const lotRows = (packedLots || [])
        .filter(pl => matchingPackedIds.has(pl.packed_coffee_id) && parseInt(pl.remaining_pcs) > 0)
        .map(pl => {
            const parentPacked = resolved.find(r => r.id === pl.packed_coffee_id);
            const machine = parentPacked && parentPacked.machine_id ? (machines || []).find(m => m.id === parentPacked.machine_id) : null;
            return {
                lotCode: pl.lot_code,
                stripCode: pl.strip_code,
                machineName: machine ? machine.name : 'Unknown',
                sizeG: parentPacked ? parentPacked.bag_size_g : '-',
                packedDate: pl.packed_date,
                remaining: parseInt(pl.remaining_pcs) || 0
            };
        })
        // Grouped by machine+size first (so the same fulfillable bucket
        // stays together), oldest-first within each group — the top row of
        // each group is exactly the lot FIFO dispatch should pick next.
        .sort((a, b) =>
            a.machineName.localeCompare(b.machineName) ||
            (parseInt(a.sizeG) || 0) - (parseInt(b.sizeG) || 0) ||
            new Date(a.packedDate || 0) - new Date(b.packedDate || 0)
        );

    let rowsHtml = '';
    if (lotRows.length === 0) {
        rowsHtml = `<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">No per-lot stock recorded yet for this coffee — only packing done after this feature shipped is tracked by lot.</div>`;
    } else {
        let bodyRows = '';
        let prevGroupKey = null;
        let groupTotal = 0;
        const groupBlocks = [];
        let currentBlockRows = '';

        const flushGroup = () => {
            if (prevGroupKey !== null) {
                groupBlocks.push({ rows: currentBlockRows, total: groupTotal });
            }
            currentBlockRows = '';
            groupTotal = 0;
        };

        lotRows.forEach(r => {
            const groupKey = `${r.machineName}|${r.sizeG}`;
            const isNewGroup = groupKey !== prevGroupKey;
            if (isNewGroup) {
                flushGroup();
                prevGroupKey = groupKey;
            }
            groupTotal += r.remaining;
            currentBlockRows += `
                <tr>
                    <td>${r.stripCode ? `<b>${r.stripCode}</b> &middot; ` : ''}<code>${r.lotCode}</code>${isNewGroup ? ' <span style="font-size:0.68rem; font-weight:700; color:var(--primary); background:rgba(45,106,79,0.12); padding:1px 6px; border-radius:9999px; margin-left:6px;">PICK FIRST</span>' : ''}</td>
                    <td>${r.machineName}</td>
                    <td>${r.sizeG}g</td>
                    <td>${r.packedDate || '-'}</td>
                    <td style="text-align:right;"><strong>${r.remaining}</strong></td>
                </tr>
            `;
        });
        flushGroup();

        const grandTotal = lotRows.reduce((sum, r) => sum + r.remaining, 0);

        rowsHtml = `
            <table class="table" style="width:100%;">
                <thead><tr>
                    <th>Lot Code</th><th>Machine</th><th>Size</th><th>Packed Date</th><th style="text-align:right;">Remaining</th>
                </tr></thead>
                <tbody>
                    ${groupBlocks.map(g => g.rows).join('')}
                </tbody>
                <tfoot>
                    <tr style="border-top: 2px solid var(--border);">
                        <td colspan="4" style="text-align:right; font-weight:700;">Total (all lots)</td>
                        <td style="text-align:right; font-weight:700;">${grandTotal}</td>
                    </tr>
                </tfoot>
            </table>
        `;
    }

    const html = `
        <div>
            <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 16px;">Packed stock by lot for <strong>${displayName}</strong>, oldest first (FIFO order).</p>
            <div style="max-height: 400px; overflow-y: auto;">
                ${rowsHtml}
            </div>
            <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Close</button>
            </div>
        </div>
    `;
    openModal(`Stock by Lot — ${displayName}`, html, '650px');
}

async function openEditPackedModal(coffeeName) {
    const [
        { data: packed },
        { data: machines },
        { data: batches },
        { data: greenbeans },
        { data: recipes }
    ] = await Promise.all([
        fetchData('packed_coffee'),
        fetchData('machines'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes')
    ]);
    
    const resolved = packed.map(item => {
        let name = item.custom_coffee_name || 'Roasted Coffee';
        if (item.roast_batch_id) {
            const b = batches.find(x => x.id === item.roast_batch_id);
            if (b) {
                if (b.coffee_type === 'Single') {
                    const gb = greenbeans.find(g => g.id === b.single_coffee_id);
                    if (gb) name = gb.name;
                } else {
                    const r = recipes.find(rec => rec.id === b.blend_recipe_id);
                    if (r) name = r.name;
                }
            }
        }
        // Match loadPackedCoffeeSection's grouping key (it strips these
        // suffixes off custom_coffee_name rows) — without this, Edit on any
        // bulk-packed coffee (custom_coffee_name ending "(Single)"/"(Blend)")
        // always showed "never been packed" even with real stock (found
        // 2026-07-16 while building the lot drill-down view alongside it).
        name = name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
        return { ...item, resolvedName: name };
    });

    const records = resolved.filter(r => r.resolvedName === coffeeName);
    
    let rowsHtml = '';
    
    if (records.length === 0) {
        rowsHtml = `<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">This coffee has never been packed.<br>Please use the <strong>Packing</strong> feature to add stock first.</div>`;
    } else {
        records.sort((a,b) => (a.machine_id || 0) - (b.machine_id || 0) || (a.bag_size_g || 0) - (b.bag_size_g || 0)).forEach(rec => {
        let machineName = 'Unknown';
        if (rec.machine_id) {
            const m = machines.find(mac => mac.id === rec.machine_id);
            if (m) machineName = m.name;
        } else if (rec.roast_batch_id) {
            const b = batches.find(x => x.id === rec.roast_batch_id);
            if (b && b.machine_id) {
                const m = machines.find(mac => mac.id === b.machine_id);
                if (m) machineName = m.name;
            }
        }
        
        rowsHtml += `
            <div class="form-group" style="display:flex; justify-content:space-between; align-items:center; gap: 10px; border-bottom: 1px dashed var(--border); padding-bottom: 10px; margin-bottom: 10px;">
                <label class="form-label flex-1-mb-0" >
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">${machineName}</div>
                    <div style="font-weight: 600;">Size: ${rec.bag_size_g}g</div>
                </label>
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="number" class="form-control packed-edit-input" data-id="${rec.id}" value="${rec.quantity}" min="0" style="width: 100px;">
                    <span style="font-size:0.85rem; color:var(--text-secondary);">bags</span>
                </div>
            </div>
        `;
    });
    }
    
    const html = `
        <div id="modal-edit-packed-form">
            <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 20px;">Edit packed inventory for <strong>${coffeeName}</strong></p>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 10px;">
                ${rowsHtml}
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="button" id="btn-save-edit-packed" class="btn btn-primary">Save Changes</button>
            </div>
        </div>
    `;
    
    openModal('Edit Packed Stock', html);
    
    document.getElementById('btn-save-edit-packed').onclick = async () => {
        const inputs = document.querySelectorAll('.packed-edit-input');
        for (const inp of inputs) {
            const id = parseInt(inp.getAttribute('data-id'));
            const newVal = parseInt(inp.value);
            
            const targetRec = packed.find(p => p.id === id);
            if (targetRec && parseInt(targetRec.quantity) !== newVal) {
                targetRec.quantity = newVal;
                await saveData('packed_coffee', targetRec);
            }
        }
        
        modalContainer.classList.add('hidden');
        loadPackedCoffeeSection();
        scheduleDashboardRefresh();
    };
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

    // List of coffee name suggestions
    const coffeeNames = new Set();
    if (greenbeans) greenbeans.forEach(gb => coffeeNames.add(gb.name));
    if (recipes) recipes.forEach(r => coffeeNames.add(r.name));
    
    const datalistOptions = Array.from(coffeeNames).map(name => `<option value="${name}"></option>`).join('');
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
        
        const coffeeName = document.getElementById('m-custpack-coffee').value.trim();
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
            let packedCoffeeId = null;
            if (packedRow) {
                packedRow.quantity = (parseInt(packedRow.quantity) || 0) + item.qty;
                await saveData('packed_coffee', packedRow);
                packedCoffeeId = packedRow.id;
            }
            // V2 1G-1: no source bulk/production lot for a manual entry — link left null.
            if (packedCoffeeId) {
                await getOrCreatePackedCoffeeLot(packedCoffeeId, item.qty, null);
            }
        }

        modalContainer.classList.add('hidden');
        loadPackedCoffeeSection();
        scheduleDashboardRefresh();
        await showWarningModal("Custom packing stock added successfully.", false);
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
        is_repack: true
    });
    if (bulkError || !newBulk) {
        alert('Failed to create repack bulk: ' + (bulkError ? bulkError.message : 'unknown error'));
        return;
    }

    const { data: freshLots } = await fetchData('packed_coffee_lots');
    const { data: freshPacked } = await fetchData('packed_coffee');

    for (const r of rows) {
        const lot = (freshLots || []).find(l => l.id === r.lotId);
        if (lot) {
            const newRemaining = Math.max(0, (parseInt(lot.remaining_pcs) || 0) - r.pcs);
            await saveData('packed_coffee_lots', { id: lot.id, remaining_pcs: newRemaining });
        }
        const packedRow = (freshPacked || []).find(p => p.id === r.packedCoffeeId);
        if (packedRow) {
            const newQty = Math.max(0, (parseInt(packedRow.quantity) || 0) - r.pcs);
            await saveData('packed_coffee', { id: packedRow.id, quantity: newQty });
        }
        await saveData('repack_sources', {
            repack_bulk_id: newBulk.id,
            source_packed_lot_id: r.lotId,
            pcs: r.pcs,
            kg: (r.pcs * r.sizeG) / 1000
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
        { data: salesAgents }
    ] = await Promise.all([
        fetchData('packed_coffee'),
        fetchData('packed_coffee_lots'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('sales_agents')
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
        lotsForItem.forEach(l => {
            group.lots.push({
                lotId: l.id,
                lotCode: l.lot_code,
                stripCode: l.strip_code,
                sizeG: parseInt(item.bag_size_g) || 0,
                packedDate: l.packed_date,
                remaining: parseInt(l.remaining_pcs) || 0,
                packedCoffeeId: item.id,
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

    const todayStr = new Date().toISOString().split('T')[0];
    const categoryOptions = STOCK_RELEASE_CATEGORIES
        .map(c => `<option value="${c.value}">${window.t ? window.t(c.i18n) : c.fallback}</option>`)
        .join('');
    const agentOptions = (salesAgents || [])
        .filter(a => a.is_active !== false)
        .map(a => `<option value="${a.name}"></option>`)
        .join('');
    const coffeeOptions = groups.map((g, idx) => `<option value="${idx}">${g.code ? g.code + ' — ' + g.label : g.label}</option>`).join('');

    const html = `
        <form id="modal-stock-release-form">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" data-i18n="lbl_sr_date">Date</label>
                    <input type="date" id="sr-date" class="form-control" value="${todayStr}" required>
                </div>
                <div class="form-group">
                    <label class="form-label" data-i18n="lbl_sr_category">Category</label>
                    <select id="sr-category" class="form-control">${categoryOptions}</select>
                </div>
            </div>

            <div id="sr-sales-name-wrap" class="form-group hidden" style="background: var(--primary-glow); border-radius: 8px; padding: 10px 11px;">
                <label class="form-label" data-i18n="lbl_sr_sales_name">Sales Name</label>
                <input type="text" id="sr-sales-name" class="form-control" list="sr-agent-list" autocomplete="off" placeholder="e.g. Budi">
                <datalist id="sr-agent-list">${agentOptions}</datalist>
                <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;" data-i18n="hint_sr_sales_name">Pick a registered sales agent, or type a new name.</div>
            </div>

            <div class="form-group">
                <label class="form-label" data-i18n="lbl_sr_scan">Scan strip code, then Enter</label>
                <input type="text" id="sr-scan-input" class="form-control" placeholder="20037" autocomplete="off">
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" data-i18n="lbl_sr_coffee">Coffee</label>
                    <select id="sr-coffee-select" class="form-control">${coffeeOptions}</select>
                </div>
                <div class="form-group">
                    <label class="form-label" data-i18n="lbl_sr_lot">Lot</label>
                    <select id="sr-lot-select" class="form-control"></select>
                </div>
            </div>
            <div class="form-row" style="align-items: flex-end;">
                <div class="form-group">
                    <label class="form-label" data-i18n="lbl_sr_qty">Qty (pcs)</label>
                    <input type="number" id="sr-qty" class="form-control" value="1" min="1">
                    <div id="sr-stock-hint" style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;"></div>
                </div>
                <div class="form-group">
                    <button type="button" id="sr-btn-add" class="btn btn-secondary" style="width:100%;"><i class="icon-plus va-middle-mr-1"></i><span data-i18n="btn_sr_add">Add to list</span></button>
                </div>
            </div>

            <div style="margin-top: 4px;">
                <label class="form-label" data-i18n="lbl_sr_cart">Items to release</label>
                <div id="sr-cart" style="border:1px solid var(--border); border-radius:8px; overflow:hidden;"></div>
            </div>

            <div class="form-group" style="margin-top: 14px;">
                <label class="form-label" data-i18n="lbl_sr_notes">Notes</label>
                <input type="text" id="sr-notes" class="form-control" placeholder="optional">
                <div id="sr-notes-hint" style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;"></div>
            </div>

            <div style="display:flex; align-items:baseline; justify-content:space-between; border-top:1px solid var(--border); padding-top:12px; margin-top:6px;">
                <span style="font-size:0.8rem; color:var(--text-secondary);" data-i18n="lbl_sr_total">Total released</span>
                <span id="sr-total" style="font-size:1.5rem; font-weight:700; color:var(--primary);">0 pcs</span>
            </div>

            <div class="modal-footer-actions-lg">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                <button type="submit" class="btn btn-primary" data-i18n="btn_sr_submit">Record Release</button>
            </div>
        </form>
    `;

    openModal(window.t ? window.t('title_new_stock_release') : 'New Stock Release', html, '640px');

    const selCoffee = document.getElementById('sr-coffee-select');
    const selLot = document.getElementById('sr-lot-select');
    const inpQty = document.getElementById('sr-qty');
    const hintStock = document.getElementById('sr-stock-hint');
    const cartEl = document.getElementById('sr-cart');
    const totalEl = document.getElementById('sr-total');
    const selCategory = document.getElementById('sr-category');
    const salesWrap = document.getElementById('sr-sales-name-wrap');
    const notesHint = document.getElementById('sr-notes-hint');

    // cart: Map keyed by lotId so re-adding the same lot accumulates instead
    // of creating a duplicate line the submit loop would then double-deduct.
    const cart = new Map();

    const cleanup = () => { window.activeStockReleaseScanHandler = null; };
    document.getElementById('btn-close-modal').addEventListener('click', cleanup, { once: true });

    function allLots() {
        return groups.flatMap((g, gi) => g.lots.map(l => ({ ...l, groupIdx: gi, coffeeName: g.coffeeName, label: g.label })));
    }

    function currentGroup() {
        return groups[parseInt(selCoffee.value) || 0];
    }

    function renderLotOptions() {
        const group = currentGroup();
        const pickFirst = window.t ? window.t('badge_pick_first') : 'PICK FIRST';
        selLot.innerHTML = group.lots.map((l, idx) =>
            `<option value="${l.lotId}">${l.stripCode || l.lotCode} · ${l.sizeG}g · ${l.packedDate || '-'}${idx === 0 ? ' — ' + pickFirst : ''}</option>`
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
        const staged = cart.has(lot.lotId) ? cart.get(lot.lotId).qty : 0;
        return Math.max(0, lot.remaining - staged);
    }

    function updateStockHint() {
        const lot = selectedLot();
        const avail = availableFor(lot);
        const label = window.t ? window.t('lbl_sr_available') : 'available';
        hintStock.textContent = lot ? `${avail} pcs ${label}` : '';
        inpQty.max = avail;
    }

    function renderCart() {
        const emptyMsg = window.t ? window.t('msg_sr_cart_empty') : 'Nothing added yet.';
        if (cart.size === 0) {
            cartEl.innerHTML = `<div style="padding:14px; text-align:center; color:var(--text-muted); font-size:0.82rem;">${emptyMsg}</div>`;
        } else {
            cartEl.innerHTML = [...cart.values()].map((line, idx) => `
                <div style="display:flex; align-items:center; gap:10px; padding:9px 11px; ${idx > 0 ? 'border-top:1px solid var(--border);' : ''}">
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:0.82rem;">
                            <span style="font-family:monospace; font-weight:700; color:var(--primary);">${line.stripCode || line.lotCode}</span>
                            <span style="color:var(--text-secondary);"> · ${line.label} · ${line.sizeG}g</span>
                        </div>
                        <div style="font-size:0.72rem; color:var(--text-muted);">${line.packedDate || '-'}</div>
                    </div>
                    <div style="font-weight:700; font-size:0.9rem; white-space:nowrap;">${line.qty} pcs</div>
                    <button type="button" class="sr-cart-remove btn btn-danger btn-sm" data-lot-id="${line.lotId}" aria-label="Remove">&times;</button>
                </div>
            `).join('');
            cartEl.querySelectorAll('.sr-cart-remove').forEach(btn => {
                btn.addEventListener('click', () => {
                    cart.delete(parseInt(btn.getAttribute('data-lot-id')));
                    renderCart();
                    updateStockHint();
                });
            });
        }
        const total = [...cart.values()].reduce((s, l) => s + l.qty, 0);
        totalEl.textContent = `${total} pcs`;
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

    function applyCategoryRules() {
        const needs = stockReleaseCategoryNeeds(selCategory.value);
        salesWrap.classList.toggle('hidden', !needs.salesName);
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

    document.getElementById('modal-stock-release-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitStockRelease({
            date: document.getElementById('sr-date').value,
            category: selCategory.value,
            salesName: document.getElementById('sr-sales-name').value.trim(),
            notes: document.getElementById('sr-notes').value.trim(),
            lines: [...cart.values()]
        });
    });
}

// Validates, writes the header + one item row per cart line, and consumes the
// lots — same consumption pattern as submitDispatchCheckout (decrement
// packed_coffee_lots.remaining_pcs and the parent packed_coffee.quantity;
// quantity_pcs is the lot's original size and is never touched).
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

    const { data: freshPacked } = await fetchData('packed_coffee');

    for (const line of lines) {
        await saveData('stock_release_items', {
            stock_release_id: header.id,
            packed_coffee_lot_id: line.lotId,
            packed_coffee_id: line.packedCoffeeId,
            coffee_name: line.coffeeName,
            bag_size_g: line.sizeG,
            qty: line.qty
        });

        const lot = (freshLots || []).find(l => l.id === line.lotId);
        if (lot) {
            const newRemaining = Math.max(0, (parseInt(lot.remaining_pcs) || 0) - line.qty);
            await saveData('packed_coffee_lots', { id: lot.id, remaining_pcs: newRemaining });
        }
        const packedRow = (freshPacked || []).find(p => p.id === line.packedCoffeeId);
        if (packedRow) {
            const newQty = Math.max(0, (parseInt(packedRow.quantity) || 0) - line.qty);
            await saveData('packed_coffee', { id: packedRow.id, quantity: newQty });
        }
    }

    document.getElementById('btn-close-modal').click();
    await loadStockReleaseSection();
    await loadPackingSection();
    scheduleDashboardRefresh();
}
