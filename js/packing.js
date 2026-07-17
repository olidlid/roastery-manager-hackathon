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
                }
            });
        });
    }

    const [
        { data: bulkList },
        { data: machines },
        { data: greenbeans },
        { data: recipes },
        { data: postBlendComponents },
        { data: packedLots },
        { data: packedList },
        { data: roastingPlans }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('post_blend_components'),
        fetchData('packed_coffee_lots'),
        fetchData('packed_coffee'),
        fetchData('roasting_plans')
    ]);

    renderReadyToPackCards(bulkList, machines, greenbeans, recipes, postBlendComponents, packedLots, packedList, roastingPlans);
    // btn-custom-packing's click handler (openCustomPackingModal) is already
    // wired once at parse time in roasting.js — not re-wired here to avoid
    // attaching a second listener that would fire the modal twice per click.
}

// Renders the "Ready to Pack" cards — one card per bulk_roasted_coffee row
// (i.e. per coffee+machine combination with stock still available). Each
// card offers Print Barcode (generates/reuses today's lot code for that
// bulk item, then prints labels) and Pack (moves kg from bulk into
// packed_coffee, scoped to just this card's bulk item).
function renderReadyToPackCards(bulkList, machines, greenbeans, recipes, postBlendComponents, packedLots, packedList, roastingPlans) {
    const container = document.getElementById('ready-to-pack-cards');
    const emptyEl = document.getElementById('ready-to-pack-empty');
    if (!container) return;
    container.innerHTML = '';

    const today = new Date().toISOString().split('T')[0];

    const activeBulk = (bulkList || [])
        .filter(b => parseFloat(b.bulk_available) > 0.005)
        .sort((a, b) => a.coffee_name.localeCompare(b.coffee_name));

    if (activeBulk.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    activeBulk.forEach(bulk => {
        const machine = (machines || []).find(m => m.id === bulk.machine_id);
        // Base lot code (same format as the printed label, minus the trailing
        // production-lot number) shown as a preview badge.
        const baseLotCode = buildLotCode(bulk, machines, greenbeans, recipes, today);

        // Post-blend cards show a composition breakdown (coffee, amount,
        // share) as a mixing reference for the crew — sourced from
        // post_blend_components for a custom post-blend (1I-a, existing
        // stock mixed ad-hoc) or from the parent plan's sub-plans for a
        // recipe-based post-blend (1I-b, assembled from fresh roast batches
        // — see bulk_roasted_coffee.source_plan_id / finalizePostBlendPlan
        // in js/roasting.js).
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

        const card = document.createElement('div');
        card.className = 'card';
        card.style.cssText = 'padding: 16px; display: flex; flex-direction: column; gap: 10px;';
        card.innerHTML = `
            <div>
                <div style="font-weight: 700; font-size: 1rem;">${bulk.coffee_name}${bulk.is_post_blend ? ' <span style="font-size:0.65rem; font-weight:700; text-transform:uppercase; color:var(--primary); background:var(--primary-glow); border-radius:4px; padding:1px 6px; vertical-align:middle;">Post-Blend</span>' : ''}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">${machine ? machine.name : (bulk.is_post_blend ? 'Assembled blend' : 'Unknown Machine')}</div>
            </div>
            <div style="font-family: monospace; font-size: 0.72rem; font-weight: 700; color: var(--primary); background: var(--primary-glow); border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; align-self: flex-start; letter-spacing: 0.3px;">${bulk.custom_blend_code || baseLotCode}</div>
            <div style="font-size: 1.4rem; font-weight: 700; color: var(--primary);">${parseFloat(bulk.bulk_available).toFixed(2)} kg</div>
            ${compositionHtml}
            <div style="display: flex; gap: 8px; margin-top: auto;">
                <button type="button" class="btn btn-secondary btn-sm btn-print-lot-barcode" data-bulk-id="${bulk.id}" style="flex: 1;" data-i18n="btn_print_barcode">Print Barcode</button>
                <button type="button" class="btn btn-primary btn-sm btn-pack-bulk" data-bulk-id="${bulk.id}" style="flex: 1;" data-i18n="btn_pack">Pack</button>
            </div>
        `;
        container.appendChild(card);
    });

    container.querySelectorAll('.btn-print-lot-barcode').forEach(btn => {
        btn.addEventListener('click', () => openPrintBarcodeModal(parseInt(btn.getAttribute('data-bulk-id'))));
        btn.style.display = hasPermission('packing_print_barcode') ? '' : 'none';
    });
    container.querySelectorAll('.btn-pack-bulk').forEach(btn => {
        btn.addEventListener('click', () => openPackBulkModal(parseInt(btn.getAttribute('data-bulk-id'))));
        btn.style.display = hasPermission('packing_daily') ? '' : 'none';
    });
}

// V2 1I-a: Custom Post-Blend — mixes existing bulk (kg) and packed (bags)
// stock into a brand-new bulk_roasted_coffee row (is_post_blend=true), so it
// then flows through the normal Ready to Pack -> production_lot -> packing
// path like any other bulk item. Each source is recorded in
// post_blend_components for the Tracking resolver to walk later.
async function openCustomPostBlendModal() {
    const [
        { data: bulkList },
        { data: packedList },
        { data: packedLots }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('packed_coffee'),
        fetchData('packed_coffee_lots')
    ]);

    // Only offer bulk rows with real stock; excludes other post-blends so a
    // custom blend can't (yet) be built out of another custom blend.
    const availableBulk = (bulkList || []).filter(b => parseFloat(b.bulk_available) > 0.005 && !b.is_post_blend);

    // FIFO-sortable packed lots (oldest packed_date first), same identity
    // concept as the dispatch checkout modal — one lot per coffee+size+machine.
    const availablePackedLots = (packedLots || [])
        .filter(l => (parseInt(l.remaining_pcs) || 0) > 0)
        .map(l => {
            const packed = (packedList || []).find(p => p.id === l.packed_coffee_id);
            return packed ? { ...l, packed } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (a.packed_date || '').localeCompare(b.packed_date || '') || a.id - b.id);

    function fifoLotIdFor(packedCoffeeId) {
        const match = availablePackedLots.find(l => l.packed_coffee_id === packedCoffeeId);
        return match ? match.id : null;
    }

    const todayCode = 'PB-' + new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const html = `
        <div class="form-row">
            <div class="form-group flex-1">
                <label class="form-label">Blend Name</label>
                <input type="text" id="pb-name" class="form-control" placeholder="e.g. Weekend House Blend">
            </div>
            <div class="form-group" style="max-width:180px;">
                <label class="form-label">Blend Code (preview)</label>
                <input type="text" id="pb-code-preview" class="form-control" value="${todayCode}" disabled style="color:var(--text-muted);">
            </div>
        </div>
        <label class="form-label" style="margin-top:12px; display:block;">Sources</label>
        <div id="pb-source-rows"></div>
        <button type="button" id="pb-add-source" class="btn btn-secondary btn-sm" style="width:100%; margin-top:8px;">+ Add source</button>

        <table class="data-table" style="width:100%; margin-top:16px;">
            <thead><tr><th>Component</th><th style="text-align:right;">Amount</th><th style="text-align:right;">Share</th></tr></thead>
            <tbody id="pb-composition-body"><tr><td colspan="3" class="table-empty-state">No sources added yet</td></tr></tbody>
        </table>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:12px; border-top:1px solid var(--border-color);">
            <div style="color:var(--text-muted); font-size:0.85rem;">Total blend size <strong id="pb-total-kg" style="color:var(--text-primary); font-family:monospace;">0.00 kg</strong></div>
            <button type="button" id="pb-submit" class="btn btn-primary">Create Blend</button>
        </div>
    `;

    openModal('Create Custom Post-Blend', html, '700px');

    // Map-keyed dynamic rows, same pattern as the dispatch checkout cart.
    const rows = new Map(); // rowId -> { kind: 'bulk'|'packed', refId, amount }
    let rowSeq = 0;

    function bulkLabel(id) {
        const b = availableBulk.find(x => x.id === id);
        return b ? b.coffee_name : 'Unknown';
    }
    function packedLabel(lotId) {
        const l = availablePackedLots.find(x => x.id === lotId);
        if (!l) return 'Unknown';
        return `${l.packed.custom_coffee_name || 'Roasted Coffee'} (${l.packed.bag_size_g || '-'}g, lot ${l.lot_code})`;
    }
    function packedBagSizeG(lotId) {
        const l = availablePackedLots.find(x => x.id === lotId);
        return l ? (parseFloat(l.packed.bag_size_g) || 0) : 0;
    }
    function rowKg(row) {
        if (row.kind === 'bulk') return row.amount || 0;
        return (row.amount || 0) * (packedBagSizeG(row.refId) / 1000);
    }

    function renderComposition() {
        const body = document.getElementById('pb-composition-body');
        const totalEl = document.getElementById('pb-total-kg');
        if (!body || !totalEl) return;
        const valid = [...rows.values()].filter(r => r.refId && r.amount > 0);
        const totalKg = valid.reduce((s, r) => s + rowKg(r), 0);
        totalEl.textContent = totalKg.toFixed(2) + ' kg';
        if (valid.length === 0) {
            body.innerHTML = '<tr><td colspan="3" class="table-empty-state">No sources added yet</td></tr>';
            return;
        }
        body.innerHTML = valid.map(r => {
            const kg = rowKg(r);
            const pct = totalKg > 0 ? (kg / totalKg * 100) : 0;
            const label = r.kind === 'bulk' ? bulkLabel(r.refId) : packedLabel(r.refId);
            const amountText = r.kind === 'bulk' ? `${r.amount.toFixed(2)} kg` : `${r.amount} bags (${kg.toFixed(2)} kg)`;
            return `<tr><td>${label}</td><td style="text-align:right; font-family:monospace;">${amountText}</td><td style="text-align:right; font-family:monospace;">${pct.toFixed(1)}%</td></tr>`;
        }).join('');
    }

    function renderSourceRows() {
        const container = document.getElementById('pb-source-rows');
        if (!container) return;
        container.innerHTML = '';
        rows.forEach((row, rowId) => {
            const wrap = document.createElement('div');
            wrap.className = 'form-row';
            wrap.style.cssText = 'display:flex; align-items:flex-end; gap:8px; margin-bottom:8px; flex-wrap:wrap;';
            const refOptions = row.kind === 'bulk'
                ? (availableBulk.map(b => `<option value="${b.id}" ${row.refId === b.id ? 'selected' : ''}>${b.coffee_name} — ${parseFloat(b.bulk_available).toFixed(2)} kg avail.</option>`).join('') || '<option value="">No bulk stock available</option>')
                : (availablePackedLots.map(l => `<option value="${l.id}" ${row.refId === l.id ? 'selected' : ''}>${l.packed.custom_coffee_name || 'Roasted Coffee'} — ${l.packed.bag_size_g || '-'}g — lot ${l.lot_code} (${l.remaining_pcs} left)</option>`).join('') || '<option value="">No packed stock available</option>');

            wrap.innerHTML = `
                <div class="form-group" style="max-width:110px;">
                    <label class="form-label">Type</label>
                    <select class="form-control pb-row-kind" data-row="${rowId}">
                        <option value="bulk" ${row.kind === 'bulk' ? 'selected' : ''}>Bulk (kg)</option>
                        <option value="packed" ${row.kind === 'packed' ? 'selected' : ''}>Packed (bags)</option>
                    </select>
                </div>
                <div class="form-group flex-1">
                    <label class="form-label">Source</label>
                    <select class="form-control pb-row-ref" data-row="${rowId}">${refOptions}</select>
                </div>
                <div class="form-group" style="max-width:130px;">
                    <label class="form-label">${row.kind === 'bulk' ? 'Amount (kg)' : 'Amount (bags)'}</label>
                    <input type="number" min="0" step="0.01" class="form-control pb-row-amount" data-row="${rowId}" value="${row.amount || ''}">
                </div>
                <button type="button" class="btn btn-danger btn-sm pb-row-remove" data-row="${rowId}" style="height:38px;">×</button>
            `;
            container.appendChild(wrap);
        });

        container.querySelectorAll('.pb-row-kind').forEach(sel => {
            sel.addEventListener('change', () => {
                const rowId = parseInt(sel.getAttribute('data-row'));
                const row = rows.get(rowId);
                row.kind = sel.value;
                row.refId = null;
                renderSourceRows();
            });
        });
        container.querySelectorAll('.pb-row-ref').forEach(sel => {
            sel.addEventListener('change', () => {
                const rowId = parseInt(sel.getAttribute('data-row'));
                const row = rows.get(rowId);
                row.refId = sel.value ? parseInt(sel.value) : null;
                renderComposition();
            });
        });
        container.querySelectorAll('.pb-row-amount').forEach(inp => {
            inp.addEventListener('input', () => {
                const rowId = parseInt(inp.getAttribute('data-row'));
                const row = rows.get(rowId);
                row.amount = parseFloat(inp.value) || 0;
                renderComposition();
            });
        });
        container.querySelectorAll('.pb-row-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                rows.delete(parseInt(btn.getAttribute('data-row')));
                renderSourceRows();
                renderComposition();
            });
        });

        renderComposition();
    }

    function addSourceRow() {
        rows.set(++rowSeq, { kind: 'bulk', refId: null, amount: 0 });
        renderSourceRows();
    }

    document.getElementById('pb-add-source').addEventListener('click', addSourceRow);
    addSourceRow();

    document.getElementById('pb-submit').addEventListener('click', async () => {
        const name = (document.getElementById('pb-name').value || '').trim();
        if (!name) { await showWarningModal('Please enter a blend name.', false); return; }

        const valid = [...rows.values()].filter(r => r.refId && r.amount > 0);
        if (valid.length === 0) { await showWarningModal('Add at least one source.', false); return; }

        // FIFO check for packed sources: warn (Proceed/Cancel) if a picked
        // lot isn't the oldest available lot for that coffee+size — same
        // pattern as the dispatch checkout modal's mismatch warning.
        for (const r of valid) {
            if (r.kind !== 'packed') continue;
            const lot = availablePackedLots.find(l => l.id === r.refId);
            if (!lot) continue;
            const fifoLotId = fifoLotIdFor(lot.packed_coffee_id);
            if (fifoLotId && fifoLotId !== lot.id) {
                const fifoLot = availablePackedLots.find(l => l.id === fifoLotId);
                const proceed = await showWarningModal(
                    `An older lot is still in stock: ${fifoLot.lot_code} (packed ${fifoLot.packed_date}).\n\nThis is a newer lot (${lot.lot_code}). Use it anyway?`,
                    true
                );
                if (!proceed) return;
            }
        }

        await submitCustomPostBlend(name, valid);
    });
}

async function submitCustomPostBlend(name, sourceRows) {
    // Re-fetch fresh right before mutating, same idiom as openPackBulkModal's
    // bulk_available decrement, to avoid acting on a stale snapshot.
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
            const kg = Math.min(row.amount, avail); // capped — never draws more than exists
            if (kg <= 0) continue;
            fresh.bulk_available = Math.max(0, avail - kg);
            await saveData('bulk_roasted_coffee', fresh);
            totalKg += kg;
            componentsToInsert.push({ source_type: 'Bulk', source_bulk_id: row.refId, source_packed_lot_id: null, kg });
        } else {
            const lot = (freshPackedLots || []).find(l => l.id === row.refId);
            if (!lot) continue;
            const packedRow = (freshPacked || []).find(p => p.id === lot.packed_coffee_id);
            const bagSizeG = packedRow ? (parseFloat(packedRow.bag_size_g) || 0) : 0;
            const availPcs = parseInt(lot.remaining_pcs) || 0;
            const bags = Math.min(row.amount, availPcs); // capped
            if (bags <= 0) continue;
            const kg = bags * (bagSizeG / 1000);
            await saveData('packed_coffee_lots', { id: lot.id, remaining_pcs: Math.max(0, availPcs - bags) });
            if (packedRow) {
                packedRow.quantity = Math.max(0, (parseInt(packedRow.quantity) || 0) - bags);
                await saveData('packed_coffee', packedRow);
            }
            totalKg += kg;
            componentsToInsert.push({ source_type: 'Packed', source_bulk_id: null, source_packed_lot_id: row.refId, kg });
        }
    }

    if (totalKg <= 0) {
        await showWarningModal('Nothing could be drawn from the selected sources (they may be out of stock).', false);
        return;
    }

    // Date-based blend code, collision-safe (same retry idea as the green
    // coffee lot codes in 1A — append a numeric suffix if today's base code
    // is already taken by an earlier blend made the same day).
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    let code = `PB-${dateStr}`;
    let suffix = 2;
    while ((freshBulkList || []).some(b => b.custom_blend_code === code)) {
        code = `PB-${dateStr}-${suffix++}`;
    }

    const { data: newBulk, error } = await saveData('bulk_roasted_coffee', {
        coffee_name: name,
        coffee_type: 'PostBlendCustom',
        is_post_blend: true,
        custom_blend_name: name,
        custom_blend_code: code,
        bulk_available: totalKg,
        machine_id: null,
        single_coffee_id: null,
        blend_recipe_id: null
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
    await loadPackingSection();
}

async function loadPackingRecordsTable() {
    const { data: records } = await fetchData('packing_records');
    const tbody = document.getElementById('packing-records-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center-muted">No packing records found.</td></tr>`;
        return;
    }

    const sorted = [...records].sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);

    sorted.forEach(rec => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${rec.date || '-'}</td>
            <td><strong>${rec.coffee_name || '-'}</strong></td>
            <td>${rec.machine_name || '-'}</td>
            <td>${rec.size_label || (rec.bag_size_g ? (rec.bag_size_g >= 1000 ? `${rec.bag_size_g/1000}kg` : `${rec.bag_size_g}g`) : '-')}</td>
            <td>${rec.quantity || 0}</td>
        `;
        tbody.appendChild(tr);
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
        { data: customers }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('customers')
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
            if (type === 'Single') {
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

        const actionBtnHtml = allItemsReady
            ? `<button class="btn btn-success btn-sm btn-dispatch-order" data-order="${order.id}" style="flex: 1; font-weight: 700;">Dispatch</button>`
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
        { data: roastBatches }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('packed_coffee'),
        fetchData('packed_coffee_lots'),
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('customers'),
        fetchData('roast_batches')
    ]);

    const order = (orders || []).find(o => o.id === orderId);
    if (!order) return;
    const items = (orderItemsAll || []).filter(i => i.request_order_id === orderId);
    const cust = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null;

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

    function coffeeLabel(type, coffeeId) {
        if (type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === coffeeId);
            return gb ? `${gb.name} (Single)` : 'Single Origin';
        }
        const r = (recipes || []).find(rec => rec.id === coffeeId);
        return r ? `${r.name} (Blend)` : 'Blend Recipe';
    }

    // For every order line, find ALL packed_coffee_lots for that coffee+size
    // (across every machine, so a machine-mismatch pick is still visible —
    // just flagged, per the "warn instead of block" decision), oldest first.
    const lotsByItem = {};
    items.forEach(item => {
        const itemCoffeeId = item.coffee_type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
        const matchingPacked = (packedGoods || []).filter(p => {
            if (parseInt(p.bag_size_g) !== parseInt(item.bag_size_g)) return false;
            const idn = resolvePackedIdentity(p);
            return idn && idn.type === item.coffee_type && idn.coffeeId === itemCoffeeId;
        });
        const packedIds = new Set(matchingPacked.map(p => p.id));
        const machineByPackedId = new Map(matchingPacked.map(p => [p.id, p.machine_id]));
        const lots = (packedLots || [])
            .filter(l => packedIds.has(l.packed_coffee_id) && (parseInt(l.remaining_pcs) || 0) > 0)
            .map(l => ({
                id: l.id,
                lotCode: l.lot_code,
                packedDate: l.packed_date,
                remaining: parseInt(l.remaining_pcs) || 0,
                machineId: machineByPackedId.get(l.packed_coffee_id) || null
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
        return (lotsByItem[itemId] || []).find(l => l.machineId === item.machine_id) || null;
    };
    const alreadyInCartForItem = (itemId) => {
        let sum = 0;
        cart.forEach(row => { if (row.orderItemId === itemId) sum += row.qty; });
        return sum;
    };

    const itemOptionsHtml = items.map(item => {
        const label = `${coffeeLabel(item.coffee_type, item.coffee_type === 'Single' ? item.single_coffee_id : item.blend_recipe_id)} — ${item.bag_size_g}g, ${machineName(item.machine_id)}`;
        return `<option value="${item.id}">${label}</option>`;
    }).join('');

    const html = `
        <div id="dispatch-checkout-body">
            <table class="nested-table-rows" style="width:100%; margin-bottom:16px;">
                <thead><tr>
                    <th>Coffee</th><th>Size / Machine</th>
                    <th class="text-right">Requested</th><th class="text-right">Fulfilled</th><th class="text-right">Remaining</th>
                </tr></thead>
                <tbody id="dc-summary-body"></tbody>
            </table>

            <div style="display:flex; gap:8px; margin-bottom:6px;">
                <input type="text" id="dc-scan-input" class="form-control" placeholder="Scan a package or carton barcode" autocomplete="off" style="flex:1;">
                <button type="button" id="dc-btn-manual-toggle" class="btn btn-secondary">Add manually</button>
            </div>
            <p style="font-size:0.78rem; color:var(--text-muted); margin: 0 0 12px;">Stays focused while this checkout is open.</p>

            <div id="dc-manual-form" class="hidden" style="display:none; gap:8px; align-items:flex-end; padding:12px; background:rgba(0,0,0,0.03); border-radius:8px; margin-bottom:16px;">
                <div class="form-group flex-1-mb-0" style="flex:1.4;">
                    <label class="form-label">Coffee</label>
                    <select id="dc-manual-item" class="form-control">${itemOptionsHtml}</select>
                </div>
                <div class="form-group flex-1-mb-0" style="flex:1.6;">
                    <label class="form-label">Lot (FIFO first)</label>
                    <select id="dc-manual-lot" class="form-control"></select>
                </div>
                <div class="form-group flex-1-mb-0" style="width:70px;">
                    <label class="form-label">Qty</label>
                    <input type="number" id="dc-manual-qty" class="form-control" value="1" min="1">
                </div>
                <button type="button" id="dc-btn-manual-add" class="btn btn-primary">Add</button>
            </div>

            <p style="font-weight:600; font-size:0.85rem; margin-bottom:6px;">Cart</p>
            <table class="nested-table-rows" style="width:100%; margin-bottom:12px;">
                <thead><tr><th>Lot</th><th>Machine</th><th>Size</th><th class="text-right">Stock</th><th class="text-right">Qty</th><th></th></tr></thead>
                <tbody id="dc-cart-body"></tbody>
            </table>

            <div id="dc-warning" class="hidden" style="background: rgba(217,119,6,0.12); border: 1px solid #d97706; color: #d97706; padding: 8px 12px; border-radius: 8px; font-size: 0.8rem; margin-bottom: 12px;"></div>

            <div class="modal-footer-actions-lg">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="button" id="dc-btn-checkout" class="btn btn-primary">Checkout</button>
            </div>
        </div>
    `;

    openModal(`Checkout — ${order.order_number || '#ORD-' + order.id}`, html, '700px');

    function renderSummary() {
        const rows = items.map(item => {
            const requested = parseInt(item.quantity_requested) || 0;
            const prepared = parseInt(item.quantity_prepared) || 0;
            const inCart = alreadyInCartForItem(item.id);
            const fulfilled = prepared + inCart;
            const remaining = Math.max(0, requested - fulfilled);
            return `
                <tr>
                    <td>${coffeeLabel(item.coffee_type, item.coffee_type === 'Single' ? item.single_coffee_id : item.blend_recipe_id)}</td>
                    <td class="text-secondary-xs">${item.bag_size_g}g, ${machineName(item.machine_id)}</td>
                    <td class="text-right">${requested}</td>
                    <td class="text-right">${fulfilled}</td>
                    <td class="text-right" style="font-weight:600; color:${remaining === 0 ? 'var(--success)' : 'var(--danger)'};">${remaining}</td>
                </tr>
            `;
        }).join('');
        document.getElementById('dc-summary-body').innerHTML = rows;

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
    }

    function renderCart() {
        const rows = [];
        cart.forEach((row, key) => {
            rows.push(`
                <tr data-key="${key}">
                    <td class="text-secondary-xs">${row.lotCode}</td>
                    <td>${row.machineName}</td>
                    <td>${row.sizeG}g</td>
                    <td class="text-right text-secondary-xs">${liveRemaining[row.lotId] + row.qty}</td>
                    <td class="text-right"><input type="number" min="1" class="form-control dc-cart-qty" data-key="${key}" value="${row.qty}" style="width:64px; text-align:right;"></td>
                    <td class="text-right"><button type="button" class="btn btn-danger btn-sm dc-cart-remove" data-key="${key}">&times;</button></td>
                </tr>
            `);
        });
        document.getElementById('dc-cart-body').innerHTML = rows.join('') || `<tr><td colspan="6" class="text-center-muted">No lots added yet.</td></tr>`;
    }

    function populateManualLotOptions() {
        const itemId = parseInt(document.getElementById('dc-manual-item').value);
        const item = items.find(i => i.id === itemId);
        const lots = lotsByItem[itemId] || [];
        const lotSelect = document.getElementById('dc-manual-lot');
        lotSelect.innerHTML = lots.map(l => {
            const isFifo = fifoLotForItemMachine(itemId) && fifoLotForItemMachine(itemId).id === l.id && l.machineId === item.machine_id;
            const mismatch = l.machineId !== item.machine_id;
            const tag = mismatch ? ` — ${machineName(l.machineId)} (different machine)` : (isFifo ? ' (FIFO)' : '');
            return `<option value="${l.id}">${l.lotCode} — ${liveRemaining[l.id]} left${tag}</option>`;
        }).join('') || `<option value="">No stock available</option>`;
    }

    // Core shared logic for both scan and manual add. Returns nothing; shows
    // its own alerts/warnings and re-renders on success.
    async function addCartEntry(itemId, lotId, qtyRequested) {
        const item = items.find(i => i.id === itemId);
        if (!item) { alert('That coffee is not on this order.'); return; }

        const requested = parseInt(item.quantity_requested) || 0;
        const prepared = parseInt(item.quantity_prepared) || 0;
        const remainingForLine = requested - prepared - alreadyInCartForItem(itemId);
        if (remainingForLine <= 0) {
            await showWarningModal(`This line (${coffeeLabel(item.coffee_type, item.coffee_type === 'Single' ? item.single_coffee_id : item.blend_recipe_id)}, ${item.bag_size_g}g) is already fully allocated.`, false);
            return;
        }

        const lots = lotsByItem[itemId] || [];
        const chosenLot = lots.find(l => l.id === lotId);
        if (!chosenLot) { alert('That lot is not available for this coffee/size.'); return; }

        const fifoLot = fifoLotForItemMachine(itemId);
        const machineMismatch = chosenLot.machineId !== item.machine_id;
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
        // whichever machine the operator actually committed to here.
        let toDraw = cappedQty;
        const sameMachinePool = lots.filter(l => l.machineId === chosenLot.machineId).sort((a, b) => new Date(a.packedDate) - new Date(b.packedDate) || a.id - b.id);
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
                cart.set(key, { orderItemId: itemId, lotId: l.id, lotCode: l.lotCode, machineId: l.machineId, machineName: machineName(l.machineId), sizeG: item.bag_size_g, qty: take });
            }
        }

        renderSummary();
        renderCart();
    }

    renderSummary();
    renderCart();
    document.getElementById('dc-manual-item').addEventListener('change', populateManualLotOptions);
    populateManualLotOptions();

    document.getElementById('dc-btn-manual-toggle').addEventListener('click', () => {
        const form = document.getElementById('dc-manual-form');
        const showing = form.style.display !== 'none';
        form.style.display = showing ? 'none' : 'flex';
        form.classList.toggle('hidden', showing);
    });

    document.getElementById('dc-btn-manual-add').addEventListener('click', async () => {
        const itemId = parseInt(document.getElementById('dc-manual-item').value);
        const lotId = parseInt(document.getElementById('dc-manual-lot').value);
        const qty = parseInt(document.getElementById('dc-manual-qty').value) || 0;
        if (!lotId || qty <= 0) return;
        await addCartEntry(itemId, lotId, qty);
        populateManualLotOptions();
    });

    document.getElementById('dc-cart-body').addEventListener('click', (e) => {
        const btn = e.target.closest('.dc-cart-remove');
        if (!btn) return;
        const key = btn.getAttribute('data-key');
        const row = cart.get(key);
        if (row) { liveRemaining[row.lotId] = (liveRemaining[row.lotId] || 0) + row.qty; }
        cart.delete(key);
        renderSummary();
        renderCart();
        populateManualLotOptions();
    });

    document.getElementById('dc-cart-body').addEventListener('input', (e) => {
        const inp = e.target.closest('.dc-cart-qty');
        if (!inp) return;
        const key = inp.getAttribute('data-key');
        const row = cart.get(key);
        if (!row) return;
        const maxAvail = liveRemaining[row.lotId] + row.qty;
        let newQty = parseInt(inp.value) || 0;
        if (newQty < 1) newQty = 1;
        if (newQty > maxAvail) newQty = maxAvail;
        liveRemaining[row.lotId] = maxAvail - newQty;
        row.qty = newQty;
        inp.value = newQty;
        renderSummary();
    });

    // V2 1G scan routing: a RMP:PackLot:{lot_code}:{sizeG}[:{multiplier}]
    // barcode is resolved here while this modal is open (see task in
    // js/roasting.js handleBarcodeScan for the 'PackLot' dispatch branch).
    window.activeDispatchCheckoutHandler = async function (lotCode, sizeG, multiplier) {
        const targetItem = items.find(item => {
            const lots = lotsByItem[item.id] || [];
            return parseInt(item.bag_size_g) === parseInt(sizeG) && lots.some(l => l.lotCode === lotCode);
        });
        if (!targetItem) {
            await showWarningModal(`Scanned lot ${lotCode} (${sizeG}g) is not part of this order.`, false);
            return;
        }
        const lot = (lotsByItem[targetItem.id] || []).find(l => l.lotCode === lotCode);
        if (!lot) return;
        await addCartEntry(targetItem.id, lot.id, multiplier || 1);
    };
    const scanInput = document.getElementById('dc-scan-input');
    if (scanInput) scanInput.focus();

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
        { data: machines }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines')
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
        if (type === 'Single') {
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
// LOT-{coffee code}-{machine code}{MMDDYY}{lot number} — machine code, date
// and lot number are concatenated with no separators (only the LOT prefix
// and the coffee code keep their dashes), per user request. Deliberately
// doesn't start with 'RMP:' so it never collides with the global
// quick-roast-log scanner listener in app.js (which only reacts to that
// exact prefix). The trailing lot number is how many production_lots rows
// already exist for this exact coffee+machine combination (across all
// dates) — a running "Lot #N of this coffee on this machine" count, not a
// roast-batch sequence (that was tried and reverted per feedback).
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
    const base = `LOT-${sanitize(coffeeCode)}-${sanitize(machineCode)}${mmddyy}`;
    return (lotNumber === undefined || lotNumber === null) ? base : `${base}${lotNumber}`;
}

// One production_lots row per (bulk item, day) — reuses today's lot if one
// was already printed for this bulk item, otherwise creates it. See
// database/production_lots_migration.sql and V2_ROADMAP.md for why this is
// an approximation (bulk_available is a running total, so the "latest batch"
// snapshot may not cover every batch that fed the pool if it wasn't fully
// packed on the day it was roasted).
async function getOrCreateProductionLot(bulk, machines, greenbeans, recipes, roastBatches) {
    const today = new Date().toISOString().split('T')[0];
    const { data: lots } = await fetchData('production_lots');
    const existing = (lots || []).find(l => l.bulk_roasted_coffee_id === bulk.id && l.production_date === today);
    if (existing) {
        // Re-printing the same day's lot after more batches were logged —
        // keep production_lot_batches current (see syncProductionLotBatches).
        await syncProductionLotBatches(existing, bulk, roastBatches);
        return existing;
    }

    const matchingBatches = (roastBatches || [])
        .filter(b => b.coffee_type === bulk.coffee_type &&
            (bulk.coffee_type === 'Single' ? b.single_coffee_id === bulk.single_coffee_id : b.blend_recipe_id === bulk.blend_recipe_id) &&
            b.machine_id === bulk.machine_id)
        .sort((a, b) => new Date(b.roast_date || 0) - new Date(a.roast_date || 0) || b.id - a.id);
    const latestBatch = matchingBatches[0] || null;

    const sameCoffeeAndMachineLots = (lots || []).filter(l =>
        l.coffee_type === bulk.coffee_type && l.machine_id === bulk.machine_id &&
        (bulk.coffee_type === 'Single' ? l.single_coffee_id === bulk.single_coffee_id : l.blend_recipe_id === bulk.blend_recipe_id)
    );
    const lotNumber = sameCoffeeAndMachineLots.length + 1;

    const newLot = {
        lot_code: buildLotCode(bulk, machines, greenbeans, recipes, today, lotNumber),
        bulk_roasted_coffee_id: bulk.id,
        coffee_type: bulk.coffee_type,
        single_coffee_id: bulk.single_coffee_id,
        blend_recipe_id: bulk.blend_recipe_id,
        machine_id: bulk.machine_id,
        coffee_name: bulk.coffee_name,
        production_date: today,
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
        // V2 1G: package barcode = RMP:PackLot:{lot_code}:{sizeG}; a carton
        // (r.multiplier set) appends the multiplier so it's never byte-
        // identical to a plain package barcode of the same size — the POS
        // checkout scanner tells them apart on this alone.
        const barcodeValue = r.multiplier
            ? `RMP:PackLot:${lot.lot_code}:${r.gram}:${r.multiplier}`
            : `RMP:PackLot:${lot.lot_code}:${r.gram}`;
        for (let i = 0; i < r.qty; i++) {
            let linesHtml = '';
            if (showCoffeeName) linesHtml += `<div class="lbl-coffee">${lot.coffee_name}</div>`;
            linesHtml += `<div class="lbl-size">${r.label}</div>`;
            if (showMachine && machineName) linesHtml += `<div class="lbl-machine">${machineName}</div>`;
            if (showDates) linesHtml += `<div class="lbl-dates">${dateRangeStr}</div>`;
            labelsHtml += `
                <div class="barcode-label-item">
                    <svg class="lot-barcode-svg" data-value="${barcodeValue}" data-display="${lot.lot_code}"></svg>
                    ${linesHtml}
                </div>
            `;
        }
    });

    const printWin = window.open('', '_blank', 'width=900,height=700');
    if (!printWin) {
        alert('Could not open the print window — please allow pop-ups for this site and try again.');
        return;
    }
    printWin.document.write(`
        <html><head><title>Lot Barcode Labels</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <style>
            @page { size: 50mm 25mm; margin: 1mm; }
            body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
            .barcode-label-item {
                width: 100%;
                height: 100vh;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 0.6mm;
                text-align: center;
                padding: 0 1mm;
                page-break-after: always;
            }
            .barcode-label-item:last-child { page-break-after: auto; }
            /* Stretch the barcode across the full sticker width so it fills
               the label like the marked box, rather than sitting small and
               centered. JsBarcode's SVG carries a viewBox, so width:100%
               scales it (bars stay proportional → still scannable) instead of
               clipping. min-width:0 is required because this SVG is a flex
               item, whose default min-width:auto would otherwise pin it to its
               intrinsic width and overflow the sticker. */
            /* max-height (not width:100%/height:auto) — a shorter code would
               otherwise stretch proportionally TALLER than a longer one to
               fill the sticker's width, making the rendered height depend on
               how many characters the code has. Capping height and letting
               width shrink-to-fit keeps it predictable either way. */
            .lot-barcode-svg { max-width: 100%; max-height: 8mm; width: auto; height: auto; display: block; margin: 0 auto; }
            .lbl-coffee { font-size: 11px; font-weight: 700; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
            .lbl-size { font-size: 10px; font-weight: 700; line-height: 1; }
            .lbl-machine { font-size: 9px; font-weight: 600; line-height: 1; color: #333; }
            .lbl-dates { font-size: 12px; font-weight: 700; line-height: 1; }
        </style></head><body>
        ${labelsHtml}
        <script>
            document.querySelectorAll('.lot-barcode-svg').forEach(el => {
                JsBarcode(el, el.dataset.value, { format: 'CODE128', width: 1.1, height: 46, displayValue: ${showCode}, text: el.dataset.display, fontSize: 9, margin: 2 });
            });
            setTimeout(() => { window.print(); }, 500);
        <\/script>
        </body></html>
    `);
    printWin.document.close();
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

            const { data: packedList } = await fetchData('packed_coffee');
            const packingDate = new Date().toISOString().split('T')[0];

            // V2 1G-1 (packed_coffee_lots foundation): resolve/create today's
            // production lot for this bulk so each size packed can be linked
            // back to it — same lot the "Print Barcode" step uses, so a
            // sticker printed either before or after packing points at the
            // same lot record.
            const productionLot = await getOrCreateProductionLot(bulk, machines, greenbeans, recipes, roastBatches);

            for (const add of additions) {
                const existing = (packedList || []).find(p =>
                    !p.roast_batch_id &&
                    p.custom_coffee_name === bulk.coffee_name &&
                    parseInt(p.bag_size_g) === parseInt(add.gram) &&
                    parseInt(p.machine_id) === parseInt(bulk.machine_id)
                );
                let packedCoffeeId = null;
                if (existing) {
                    existing.quantity = parseInt(existing.quantity) + add.qty;
                    await saveData('packed_coffee', existing);
                    packedCoffeeId = existing.id;
                } else {
                    const { data: savedPacked } = await saveData('packed_coffee', {
                        roast_batch_id: null,
                        machine_id: bulk.machine_id,
                        custom_coffee_name: bulk.coffee_name,
                        bag_size_g: add.gram,
                        quantity: add.qty,
                        selling_price: 12.00
                    });
                    packedCoffeeId = savedPacked ? savedPacked.id : null;
                }
                if (packedCoffeeId) {
                    await createPackedCoffeeLot(packedCoffeeId, add.qty, productionLot ? productionLot.id : null);
                }
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
                    status: 'Completed'
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

// V2 1G-1 (packed_coffee_lots foundation): one row per pack action —
// packed_coffee itself stays a merged running total (unchanged for now,
// still what every existing view/deduction reads), this is purely additive
// so it can't regress anything already working. lot_code just needs to be
// globally unique; it isn't user-facing (only production_lots.lot_code is
// printed on stickers), so a timestamp suffix is enough. productionLotId is
// null for custom/manual packing entries that have no source bulk lot.
async function createPackedCoffeeLot(packedCoffeeId, qty, productionLotId, roastBatchId = null) {
    const { error } = await saveData('packed_coffee_lots', {
        packed_coffee_id: packedCoffeeId,
        roast_batch_id: roastBatchId,
        lot_code: `PKL-${packedCoffeeId}-${Date.now()}`,
        quantity_pcs: qty,
        remaining_pcs: qty,
        packed_date: new Date().toISOString().split('T')[0],
        production_lot_id: productionLotId
    });
    if (error) console.error('Failed to create packed_coffee_lots row:', error);
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
    
    const records = bulkList.filter(b => b.coffee_name === coffeeName);
    
    let rowsHtml = '';
    records.forEach(rec => {
        const m = machines.find(m => m.id === rec.machine_id);
        const machineName = m ? m.name : 'Unknown';
        
        rowsHtml += `
            <div class="form-group" style="display:flex; justify-content:space-between; align-items:center; gap: 10px;">
                <label class="form-label flex-1-mb-0" >${machineName}</label>
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
// proof that packed_coffee_lots (populated by createPackedCoffeeLot on
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
                    <td><code>${r.lotCode}</code>${isNewGroup ? ' <span style="font-size:0.68rem; font-weight:700; color:var(--primary); background:rgba(45,106,79,0.12); padding:1px 6px; border-radius:9999px; margin-left:6px;">PICK FIRST</span>' : ''}</td>
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

        const { data: packed } = await fetchData('packed_coffee');

        for (const item of packsToSave) {
            // Find existing row matching the exact custom coffee name, machine, and size
            const existing = (packed || []).find(p =>
                p.roast_batch_id === null &&
                p.machine_id === machineId &&
                p.bag_size_g === item.gram &&
                (p.custom_coffee_name || '').toLowerCase() === coffeeName.toLowerCase()
            );

            let packedCoffeeId = null;
            if (existing) {
                existing.quantity = (parseInt(existing.quantity) || 0) + item.qty;
                await saveData('packed_coffee', existing);
                packedCoffeeId = existing.id;
            } else {
                const newPacked = {
                    roast_batch_id: null,
                    machine_id: machineId,
                    custom_coffee_name: coffeeName,
                    bag_size_g: item.gram,
                    quantity: item.qty
                };
                const { data: savedPacked } = await saveData('packed_coffee', newPacked);
                packedCoffeeId = savedPacked ? savedPacked.id : null;
            }
            // V2 1G-1: no source bulk/production lot for a manual entry — link left null.
            if (packedCoffeeId) {
                await createPackedCoffeeLot(packedCoffeeId, item.qty, null);
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
        { data: machines }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines')
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
                if (type === 'Single') {
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
        { data: customers }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('customers')
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
        if (type === 'Single') {
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
