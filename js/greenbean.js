// GREENBEAN MODULE - ROASTERY MANAGER V2
// Plain script (shared global scope — NOT an ES module). Split out of app.js
// during the V1 refactor. Covers Greenbean Inventory (Tab 1) and Arrival/
// Intake (Tab 3), plus adjustGreenbeanStock() which roasting.js calls when
// a batch is logged. Load order: after db.js/auth.js, before app.js.

// ==========================================================================
// SECTION 2: GREENBEANS (TAB 1, 2, 3)
// ==========================================================================

// --- TAB 1: Greenbean Inventory ---
async function loadGreenbeanInventory() {
    const { data: inventory } = await fetchData('green_coffee');
    const tbody = document.getElementById('greenbean-table-body');
    tbody.innerHTML = '';

    if (inventory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center-muted">${window.t("msg_no_gb")}</td></tr>`;
        return;
    }

    const sortedInv = [...inventory].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    sortedInv.forEach(bean => {
        const tr = document.createElement('tr');
        const isLow = parseFloat(bean.stock_kg) < (companySettings.min_stock_greenbean_kg || 0);
        const stockStyle = isLow ? 'color: var(--danger);' : '';
        tr.innerHTML = `
            <td><code>${bean.code}</code></td>
            <td><strong>${bean.name}</strong></td>
            <td>${bean.origin || '-'}</td>
            <td>${bean.process || '-'}</td>
            <td style="${stockStyle}"><strong>${parseFloat(bean.stock_kg).toFixed(1)} ${companySettings.weight_unit}</strong></td>
            <td>${bean.supplier || '-'}</td>
            <td class="text-nowrap">
                <button class="btn btn-outline btn-sm btn-edit-greenbean" onclick="openEditGreenbeanStockModal(${bean.id})">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle-mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit
                </button>
                ${hasPermission('greenbean_delete') ? `<button class="btn btn-danger btn-sm btn-delete-greenbean ml-1" data-id="${bean.id}" data-name="${bean.name}" >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>` : ''}
                <button class="btn btn-secondary btn-sm btn-barcode-gb ml-1" data-id="${bean.id}" data-name="${bean.name}" title="Generate Barcodes" >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="va-middle"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="14" y1="8" x2="14" y2="16"/><line x1="18" y1="8" x2="18" y2="16"/></svg>
                </button>
            </td>
        `;
        // Row click opens the Stock History / Lab Readings detail modal;
        // guarded so clicks on the row's own action buttons (Edit/Delete/
        // Barcode) keep their existing behavior instead of also opening it.
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            openGreenbeanDetailModal(bean.id);
        });
        tbody.appendChild(tr);
    });

    // Wire delete buttons
    document.querySelectorAll('.btn-delete-greenbean').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = parseInt(btn.dataset.id);
            const name = btn.dataset.name;
            const confirmed = await showWarningModal(`Are you sure you want to delete "${name}" from Green Coffee Stock?\n\nThis action cannot be undone.`);
            if (!confirmed) return;
            const { error } = await deleteData('green_coffee', id);
            if (error) {
                const raw = (error.message || '').toLowerCase();
                const isFk = /foreign key|violates|constraint|referenced|still referenced/.test(raw);
                const msg = isFk
                    ? `"${name}" cannot be deleted because it is still used elsewhere — for example in roasting plans, roast batches, blend recipes, or arrival records.\n\nRemove or reassign those records first, then try again.`
                    : `Failed to delete "${name}": ${error.message}`;
                await showWarningModal(msg, false, 'Delete Failed');
                return;
            }
            await loadGreenbeanInventory();
            scheduleDashboardRefresh();
        });
    });

    // Wire barcode buttons for green coffee
    document.querySelectorAll('.btn-barcode-gb').forEach(btn => {
        btn.addEventListener('click', () => {
            showBarcodeLabels('Single', parseInt(btn.dataset.id), btn.dataset.name);
        });
    });

    applyFiltersForTable(document.querySelector('#tab-green-inventory table'));
}

async function openEditGreenbeanStockModal(id) {
    const { data: inventory } = await fetchData('green_coffee');
    const bean = inventory.find(b => b.id === id);
    if (!bean) return;

    const html = `
        <form id="modal-gb-stock-form">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Coffee Name</label>
                    <input type="text" id="m-gb-name" class="form-control" value="${bean.name || ''}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Code</label>
                    <input type="text" id="m-gb-code" class="form-control" value="${bean.code || ''}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Origin</label>
                    <input type="text" id="m-gb-origin" class="form-control" value="${bean.origin || ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">Process</label>
                    <input type="text" id="m-gb-process" class="form-control" value="${bean.process || ''}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Current Stock (${companySettings.weight_unit})</label>
                    <input type="number" id="m-gb-stock" class="form-control" step="any" value="${Number(parseFloat(bean.stock_kg || 0).toFixed(2))}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Supplier</label>
                    <input type="text" id="m-gb-supplier" class="form-control" value="${bean.supplier || ''}">
                </div>
            </div>
            <div style="background: var(--bg-app); border-radius: 8px; padding: 12px 14px; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                    <span style="font-size: 0.78rem; color: var(--text-muted);" data-i18n="lbl_last_lab_reading">Last lab reading</span>
                    <button type="button" id="btn-view-lab-history" style="font-size: 0.75rem; color: var(--info); background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 3px;">
                        <span data-i18n="btn_view_history">View history</span> <i class="icon-arrow-right"></i>
                    </button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                    <div style="background: var(--bg-input); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-size: 0.68rem; color: var(--text-muted);" data-i18n="tracking_lbl_moisture">Moisture</div>
                        <div style="font-size: 1rem; color: var(--text-primary);">${bean.moisture_content !== null && bean.moisture_content !== undefined ? bean.moisture_content + '%' : '—'}</div>
                    </div>
                    <div style="background: var(--bg-input); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-size: 0.68rem; color: var(--text-muted);" data-i18n="tracking_lbl_water_activity">Water activity</div>
                        <div style="font-size: 1rem; color: var(--text-primary);">${bean.water_activity ?? '—'}</div>
                    </div>
                    <div style="background: var(--bg-input); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-size: 0.68rem; color: var(--text-muted);" data-i18n="tracking_lbl_density">Density</div>
                        <div style="font-size: 1rem; color: var(--text-primary);">${bean.density ?? '—'}</div>
                    </div>
                </div>
            </div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Adjustment</button>
            </div>
        </form>
    `;

    openModal('Adjust Green Coffee Stock', html);
    window.translatePage();

    // Read-only lab-reading cache above is now maintained by
    // syncGreenCoffeeLabSnapshot (see Data Analyze tab) — this just jumps
    // there, filtered to this coffee, instead of editing inline.
    document.getElementById('btn-view-lab-history').addEventListener('click', () => {
        document.getElementById('btn-close-modal').click();
        const tabBtn = document.querySelector('.tab-btn[data-tab="tab-gb-analysis"]');
        if (tabBtn) tabBtn.click();
        const filterInput = document.getElementById('gb-analysis-search-input');
        if (filterInput) {
            filterInput.value = bean.name || '';
            filterInput.dispatchEvent(new Event('input'));
        }
    });

    document.getElementById('modal-gb-stock-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newStock = parseFloat(document.getElementById('m-gb-stock').value) || 0;
        const prevStock = parseFloat(bean.stock_kg || 0);
        const stockDelta = newStock - prevStock;

        // V2: stock_kg is DERIVED (trigger-summed from green_coffee_lots.remaining_kg
        // — see database/v2_lot_tracking_migration.sql), so it's intentionally NOT
        // included here. Writing it directly would get silently reverted the next
        // time any lot for this coffee changes. The correction is instead applied
        // to the lot ledger below, after this save succeeds.
        const record = {
            id: bean.id,
            name: document.getElementById('m-gb-name').value.trim(),
            code: document.getElementById('m-gb-code').value.trim(),
            origin: document.getElementById('m-gb-origin').value.trim(),
            process: document.getElementById('m-gb-process').value.trim(),
            supplier: document.getElementById('m-gb-supplier').value.trim()
            // moisture_content/water_activity/density intentionally omitted —
            // those 3 columns are now a read-only cache maintained by
            // syncGreenCoffeeLabSnapshot() (see Data Analyze tab), not
            // editable from here.
        };
        const { error } = await saveData('green_coffee', record);

        if (error) {
            alert("Failed to save: " + error.message);
        } else {
            // Apply the stock correction to the lot ledger rather than stock_kg
            // directly: an increase is recorded as a clearly-labeled adjustment
            // lot (dated today, so it doesn't masquerade as an old arrival);
            // a decrease is deducted FIFO oldest-first via the same consumption
            // helper roasting.js uses, so it comes off the stalest stock first.
            if (Math.abs(stockDelta) > 0.0001) {
                if (stockDelta > 0) {
                    await createGreenCoffeeLot({
                        coffeeId: bean.id,
                        coffeeCode: record.code,
                        arrivalDate: new Date().toISOString().split('T')[0],
                        quantityKg: stockDelta,
                        supplier: 'Manual Stock Adjustment',
                        purchasePricePerKg: null
                    });
                } else {
                    // V2 Stock History: persist which lot(s) this decrease
                    // drew from — without this, a manual correction is
                    // invisible to any later reconstruction of the ledger,
                    // unlike every other consumption path in the app.
                    const { draws } = await consumeGreenCoffeeLotsFifo(bean.id, Math.abs(stockDelta));
                    for (const d of draws) {
                        await saveData('green_coffee_lot_adjustments', {
                            green_coffee_id: bean.id,
                            green_coffee_lot_id: d.lotId,
                            kg: d.kg,
                            adjustment_date: new Date().toISOString().split('T')[0],
                            adjusted_by: (currentUser && currentUser.name) || null
                        });
                    }
                }
            }

            document.getElementById('modal-container').classList.add('hidden');
            loadGreenbeanInventory();
            initAppDashboard();
            loadRecipeProductionPotential();
        }
    });
}

async function loadIntakeHistory() {
    const { data: history } = await fetchData('green_coffee_intake');
    const tbody = document.getElementById('intake-history-table-body');
    tbody.innerHTML = '';

    if (!history || history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center-muted">${window.t("msg_no_intakes")}</td></tr>`;
        return;
    }

    // Sort by date descending
    const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);

    sorted.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${item.date}</td>
            <td><code>${item.code}</code></td>
            <td><strong>${item.name}</strong></td>
            <td>${item.origin || '-'}</td>
            <td>${item.process || '-'}</td>
            <td><strong>${parseFloat(item.quantity).toFixed(1)} ${companySettings.weight_unit}</strong></td>
            <td>${item.supplier || '-'}</td>
            <td>
                ${hasPermission('greenbean_arrival_edit') ? `<button class="btn btn-secondary btn-sm btn-edit-intake" data-id="${item.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>` : ''}
                ${hasPermission('greenbean_arrival_delete') ? `<button class="btn btn-danger btn-sm btn-delete-intake" data-id="${item.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Wire up events
    document.querySelectorAll('.btn-edit-intake').forEach(btn => {
        btn.addEventListener('click', () => openIntakeModal(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-delete-intake').forEach(btn => {
        btn.addEventListener('click', () => deleteIntake(parseInt(btn.getAttribute('data-id'))));
    });

    applyFiltersForTable(document.querySelector('#tab-add-gb-history table'));
}

async function openIntakeModal(editId = null) {
    const [
        { data: inventory },
        { data: history },
        { data: analysisRows }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('green_coffee_intake'),
        fetchData('green_coffee_analysis')
    ]);

    let intakeItem = null;
    if (editId) {
        intakeItem = history.find(item => item.id === editId);
    }

    // Editing an existing intake: lab readings are locked here (only
    // recordable once, at fresh arrival) — this looks up whatever was
    // recorded for the lot this intake created, to show read-only, rather
    // than reusing the fields as editable inputs. `arrival`-sourced first,
    // since that's the canonical reading; falls back to the latest of any
    // source in case the arrival record itself was later edited from the
    // Data Analyze tab (source stays 'arrival' on edit, so normally this
    // fallback never triggers — it's just a safety net).
    const lotAnalysisRows = (editId && intakeItem && intakeItem.green_coffee_lot_id)
        ? (analysisRows || []).filter(r => r.green_coffee_lot_id === intakeItem.green_coffee_lot_id)
        : [];
    const arrivalAnalysis = lotAnalysisRows.find(r => r.source === 'arrival')
        || [...lotAnalysisRows].sort((a, b) => (b.test_date || '').localeCompare(a.test_date || '') || b.id - a.id)[0]
        || null;

    // Generate datalist options for autocomplete (origin/process/supplier only —
    // coffee identity itself is now picked from the <select> below, not typed).
    const uniqueOrigins = [...new Set(inventory.map(g => g.origin).filter(Boolean))];
    const uniqueProcesses = [...new Set(inventory.map(g => g.process).filter(Boolean))];
    const uniqueSuppliers = [...new Set(inventory.map(g => g.supplier).filter(Boolean))];

    const originOpts = uniqueOrigins.map(origin => `<option value="${origin}"></option>`).join('');
    const processOpts = uniqueProcesses.map(proc => `<option value="${proc}"></option>`).join('');
    const supplierOpts = uniqueSuppliers.map(sup => `<option value="${sup}"></option>`).join('');

    // Which existing row (if any) this intake record is tied to. Prefer the
    // green_coffee_id FK; fall back to a name+code text match only for legacy
    // intake rows saved before this FK was populated (pre this fix).
    const linkedBean = intakeItem
        ? inventory.find(g =>
            (intakeItem.green_coffee_id && g.id === intakeItem.green_coffee_id) ||
            (!intakeItem.green_coffee_id && g.name.toLowerCase() === (intakeItem.name || '').toLowerCase() && (g.code || '').toLowerCase() === (intakeItem.code || '').toLowerCase()))
        : null;

    const coffeeOptionsHtml = [...inventory].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(g => {
        const selected = linkedBean && linkedBean.id === g.id ? 'selected' : '';
        const stockLabel = `${parseFloat(g.stock_kg || 0).toFixed(1)} ${companySettings.weight_unit}`;
        return `<option value="${g.id}" data-code="${g.code || ''}" data-origin="${g.origin || ''}" data-process="${g.process || ''}" data-supplier="${g.supplier || ''}" data-price="${g.purchase_price_per_kg ?? ''}" data-moisture="${g.moisture_content ?? ''}" data-water-activity="${g.water_activity ?? ''}" data-density="${g.density ?? ''}" ${selected}>${g.name} — ${g.code || 'no code'} — ${stockLabel} in stock</option>`;
    }).join('');

    // Editing an old intake row that predates green_coffee_id and whose
    // name+code no longer matches anything current (edited/deleted since) —
    // fall back to "new coffee" mode so the historical name/code aren't lost.
    const isOrphanedLegacyEdit = !!(intakeItem && !linkedBean);

    const defaultDate = intakeItem ? intakeItem.date : new Date().toISOString().split('T')[0];
    const defaultNewName = isOrphanedLegacyEdit ? (intakeItem.name || '') : '';
    const defaultCode = intakeItem ? (intakeItem.code || '') : '';
    const defaultOrigin = intakeItem ? (intakeItem.origin || '') : '';
    const defaultProcess = intakeItem ? (intakeItem.process || '') : '';
    const defaultQty = intakeItem ? parseFloat(intakeItem.quantity) : 100.0;
    const defaultSupplier = intakeItem ? (intakeItem.supplier || '') : '';

    const html = `
        <form id="modal-intake-form">
            <div class="form-group">
                <label class="form-label">Arrival Date</label>
                <input type="date" id="m-int-date" class="form-control" value="${defaultDate}" required>
            </div>
            <div class="form-group">
                <label class="form-label">Coffee</label>
                <select id="m-int-coffee-select" class="form-control" required>
                    <option value="" disabled ${(linkedBean || isOrphanedLegacyEdit) ? '' : 'selected'}>-- Select or Add New Coffee --</option>
                    <option value="__new__" ${isOrphanedLegacyEdit ? 'selected' : ''}>+ Add New Coffee...</option>
                    ${coffeeOptionsHtml}
                </select>
            </div>
            <div class="form-row hidden" id="int-new-name-row">
                <div class="form-group">
                    <label class="form-label">New Coffee Name</label>
                    <input type="text" id="m-int-new-name" class="form-control" value="${defaultNewName}" placeholder="e.g. Aceh Gayo Arabica">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Item Code</label>
                    <input type="text" id="m-int-code" class="form-control" value="${defaultCode}" placeholder="e.g. GB1" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Quantity (kg)</label>
                    <input type="number" step="0.1" id="m-int-qty" class="form-control" value="${defaultQty}" min="0.1" required>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Origin Country/Region</label>
                    <input type="text" id="m-int-origin" list="int-origins-list" class="form-control" value="${defaultOrigin}" placeholder="e.g. Aceh, Indonesia" required autocomplete="off">
                    <datalist id="int-origins-list">
                        ${originOpts}
                    </datalist>
                </div>
                <div class="form-group">
                    <label class="form-label">Processing Method</label>
                    <input type="text" id="m-int-process" list="int-processes-list" class="form-control" value="${defaultProcess}" placeholder="e.g. Wet Hulled" required autocomplete="off">
                    <datalist id="int-processes-list">
                        ${processOpts}
                    </datalist>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Supplier Name</label>
                    <input type="text" id="m-int-supplier" list="int-suppliers-list" class="form-control" value="${defaultSupplier}" placeholder="e.g. Gayo Estate" required autocomplete="off">
                    <datalist id="int-suppliers-list">
                        ${supplierOpts}
                    </datalist>
                </div>
                <div class="form-group">
                    <label class="form-label">Purchase Price / kg (optional)</label>
                    <input type="number" step="0.01" id="m-int-price" class="form-control" value="${linkedBean ? (linkedBean.purchase_price_per_kg || '') : ''}" placeholder="e.g. 85000">
                </div>
            </div>
            ${editId ? `
            <div class="form-group">
                <div style="display: flex; align-items: center; justify-content: between; gap: 8px; margin-bottom: 4px;">
                    <label class="form-label" style="margin-bottom: 0;" data-i18n="lbl_last_lab_reading">Last lab reading</label>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                    <div style="background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-size: 0.68rem; color: var(--text-muted);" data-i18n="tracking_lbl_moisture">Moisture</div>
                        <div style="font-size: 0.95rem;">${arrivalAnalysis && arrivalAnalysis.moisture_content !== null ? arrivalAnalysis.moisture_content + '%' : '—'}</div>
                    </div>
                    <div style="background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-size: 0.68rem; color: var(--text-muted);" data-i18n="tracking_lbl_water_activity">Water activity</div>
                        <div style="font-size: 0.95rem;">${arrivalAnalysis && arrivalAnalysis.water_activity !== null ? arrivalAnalysis.water_activity : '—'}</div>
                    </div>
                    <div style="background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-size: 0.68rem; color: var(--text-muted);" data-i18n="tracking_lbl_density">Density</div>
                        <div style="font-size: 0.95rem;">${arrivalAnalysis && arrivalAnalysis.density !== null ? arrivalAnalysis.density : '—'}</div>
                    </div>
                </div>
                <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px;" data-i18n="hint_analysis_locked">Recorded once at arrival — edit lab readings from the Data Analyze tab.</div>
            </div>
            ` : `
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Moisture Content % (optional)</label>
                    <input type="number" step="any" id="m-int-moisture" class="form-control" value="${linkedBean ? (linkedBean.moisture_content ?? '') : ''}" placeholder="e.g. 11.5">
                </div>
                <div class="form-group">
                    <label class="form-label">Water Activity aw (optional)</label>
                    <input type="number" step="any" id="m-int-water-activity" class="form-control" value="${linkedBean ? (linkedBean.water_activity ?? '') : ''}" placeholder="e.g. 0.55">
                </div>
                <div class="form-group">
                    <label class="form-label">Density g/L (optional)</label>
                    <input type="number" step="any" id="m-int-density" class="form-control" value="${linkedBean ? (linkedBean.density ?? '') : ''}" placeholder="e.g. 700">
                </div>
            </div>
            `}
            ${editId ? '' : `
            <div class="form-row">
                <div class="form-group flex-1">
                    <label class="form-label">Lot Stickers to Print</label>
                    <input type="number" step="1" min="0" id="m-int-sticker-count" class="form-control" value="0" placeholder="How many sacks?">
                </div>
                <div class="form-group flex-1">
                    <label class="form-label">Sticker Size</label>
                    <select id="m-int-sticker-size" class="form-control">
                        <option value="besar">Besar — 5×15cm (all machines on one sticker)</option>
                        <option value="kecil">Kecil — 5×2.5cm (one sticker per machine)</option>
                    </select>
                </div>
            </div>
            <div style="font-size:0.78rem; color:var(--text-muted); margin-top:-4px; margin-bottom:12px;">One barcode per machine — stick whichever machine's sticker (Besar) or scan whichever sticker (Kecil) matches where that sack actually gets roasted. Leave count at 0 to skip printing now.</div>
            `}

            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">${editId ? 'Save Changes' : 'Add Lot'}</button>
            </div>
        </form>
    `;

    openModal(editId ? 'Edit Greenbean Lot (Intake)' : 'Received Lot', html);

    const coffeeSelect = document.getElementById('m-int-coffee-select');
    const newNameRow = document.getElementById('int-new-name-row');
    const codeInput = document.getElementById('m-int-code');
    const originInput = document.getElementById('m-int-origin');
    const processInput = document.getElementById('m-int-process');
    const supplierInput = document.getElementById('m-int-supplier');
    const priceInput = document.getElementById('m-int-price');
    const moistureInput = document.getElementById('m-int-moisture');
    const waterActivityInput = document.getElementById('m-int-water-activity');
    const densityInput = document.getElementById('m-int-density');
    const stickerCountInput = document.getElementById('m-int-sticker-count');
    const stickerSizeInput = document.getElementById('m-int-sticker-size');

    // Selecting an existing coffee locks identity to its row.id (no more
    // matching by typed name+code text) and refreshes the other fields from
    // that row so the form shows what's actually being restocked; picking
    // "+ Add New Coffee..." reveals the free-text name field instead.
    function syncFieldsFromSelect() {
        if (coffeeSelect.value === '__new__') {
            newNameRow.classList.remove('hidden');
        } else {
            newNameRow.classList.add('hidden');
            const opt = coffeeSelect.selectedOptions[0];
            if (!opt || !opt.value) return;
            codeInput.value = opt.getAttribute('data-code') || '';
            originInput.value = opt.getAttribute('data-origin') || '';
            processInput.value = opt.getAttribute('data-process') || '';
            supplierInput.value = opt.getAttribute('data-supplier') || '';
            priceInput.value = opt.getAttribute('data-price') || '';
            // Only present in the DOM for a NEW intake — locked/read-only
            // when editing an existing one (see the lbl_last_lab_reading
            // block above).
            if (moistureInput) moistureInput.value = opt.getAttribute('data-moisture') || '';
            if (waterActivityInput) waterActivityInput.value = opt.getAttribute('data-water-activity') || '';
            if (densityInput) densityInput.value = opt.getAttribute('data-density') || '';
        }
    }
    coffeeSelect.addEventListener('change', syncFieldsFromSelect);
    syncFieldsFromSelect();

    document.getElementById('modal-intake-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const date = document.getElementById('m-int-date').value;
        const code = codeInput.value.trim();
        const origin = originInput.value.trim();
        const process = processInput.value.trim();
        const quantity = parseFloat(document.getElementById('m-int-qty').value);
        const supplier = supplierInput.value.trim();
        const coffeeSelectVal = coffeeSelect.value;
        const priceRaw = priceInput.value ? parseFloat(priceInput.value) : null;
        // null (not just unfilled) when editing — those 3 inputs don't exist
        // in the DOM on the edit-intake path, see lbl_last_lab_reading above.
        const moistureRaw = moistureInput && moistureInput.value ? parseFloat(moistureInput.value) : null;
        const waterActivityRaw = waterActivityInput && waterActivityInput.value ? parseFloat(waterActivityInput.value) : null;
        const densityRaw = densityInput && densityInput.value ? parseFloat(densityInput.value) : null;
        const stickerCount = stickerCountInput ? (parseInt(stickerCountInput.value) || 0) : 0;
        const stickerSize = stickerSizeInput ? stickerSizeInput.value : 'besar';

        if (!coffeeSelectVal) return; // native `required` blocks this, but guard anyway

        // If editing, restore the quantity this record previously added to
        // whichever bean it was linked to, before applying the new amount below
        // — otherwise editing a lot's quantity would double-count the delta.
        if (editId && intakeItem && linkedBean) {
            const oldBean = inventory.find(g => g.id === linkedBean.id);
            if (oldBean) {
                oldBean.stock_kg = Math.max(0, parseFloat(oldBean.stock_kg) - parseFloat(intakeItem.quantity));
                await saveData('green_coffee', oldBean);
            }
        }

        let targetCoffeeId, targetName;

        if (coffeeSelectVal === '__new__') {
            const newName = document.getElementById('m-int-new-name').value.trim();
            if (!newName) { alert('Please enter a name for the new coffee.'); return; }

            // Guard against silently creating a duplicate of an existing coffee —
            // this exact mechanism (two green_coffee rows sharing a name) is what
            // caused a past bug where one of them ended up stuck at 0 stock.
            const dup = inventory.find(g => g.name.toLowerCase() === newName.toLowerCase());
            if (dup) {
                const proceed = await showWarningModal(
                    `A coffee named "${dup.name}" already exists (code ${dup.code || '—'}, ${parseFloat(dup.stock_kg || 0).toFixed(1)} ${companySettings.weight_unit} in stock).\n\nCreating a new entry will split its stock across two separate records. Pick it from the "Coffee" dropdown above instead unless this is genuinely a different lot.\n\nCreate a new entry anyway?`,
                    true
                );
                if (!proceed) return;
            }

            const newBean = {
                code, name: newName, origin, process,
                stock_kg: quantity, purchase_price_per_kg: priceRaw || 0.0, supplier
                // moisture_content/water_activity/density intentionally
                // omitted — set below via saveAnalysisRecord once the lot
                // exists, which also syncs the read-only cache on this row.
            };
            const { data: savedBean, error } = await saveData('green_coffee', newBean);
            if (error) { alert('Failed to create coffee: ' + error.message); return; }
            targetCoffeeId = savedBean.id;
            targetName = newName;
        } else {
            const coffeeId = parseInt(coffeeSelectVal);
            const bean = inventory.find(g => g.id === coffeeId);
            if (!bean) { alert('Selected coffee not found — please refresh and try again.'); return; }
            bean.stock_kg = parseFloat(bean.stock_kg || 0) + quantity;
            if (code) bean.code = code;
            if (origin) bean.origin = origin;
            if (process) bean.process = process;
            if (supplier) bean.supplier = supplier;
            if (priceRaw !== null) bean.purchase_price_per_kg = priceRaw;
            // moisture_content/water_activity/density intentionally omitted
            // — set below via saveAnalysisRecord once the lot exists.
            await saveData('green_coffee', bean);
            targetCoffeeId = bean.id;
            targetName = bean.name;
        }

        const intakeRecord = {
            id: editId || undefined,
            green_coffee_id: targetCoffeeId,
            date,
            code,
            name: targetName,
            origin,
            process,
            quantity,
            supplier
        };
        const { data: savedIntake } = await saveData('green_coffee_intake', intakeRecord);

        // V2 1A: one intake = one green lot. green_coffee.stock_kg is now a
        // DERIVED value (trigger-summed from green_coffee_lots.remaining_kg
        // — see database/v2_lot_tracking_migration.sql), so the lot itself
        // must stay in sync with the intake or the manual stock_kg writes
        // above get silently reverted the next time any lot changes.
        if (!editId) {
            const newLot = await createGreenCoffeeLot({
                coffeeId: targetCoffeeId,
                coffeeCode: code,
                arrivalDate: date,
                quantityKg: quantity,
                supplier,
                purchasePricePerKg: priceRaw
            });
            if (newLot) {
                // Link the intake back to the lot it created so a later edit/delete
                // of this intake can find and adjust the same lot.
                await saveData('green_coffee_intake', { id: savedIntake.id, green_coffee_lot_id: newLot.id });

                // Optional at arrival — only recorded if at least one of the
                // 3 fields was actually filled in. This is the ONE time this
                // lot's lab reading can be entered from the Arrival modal;
                // saveAnalysisRecord tags it 'arrival' since it's the first
                // (only) record for a brand new lot.
                if (moistureRaw !== null || waterActivityRaw !== null || densityRaw !== null) {
                    await saveAnalysisRecord({
                        greenCoffeeId: targetCoffeeId,
                        lotId: newLot.id,
                        testDate: date,
                        moisture: moistureRaw,
                        waterActivity: waterActivityRaw,
                        density: densityRaw
                    });
                }
                if (stickerCount > 0) {
                    if (stickerSize === 'kecil') {
                        await printGreenLotStickersKecil(newLot, { code, name: targetName }, stickerCount);
                    } else {
                        await printGreenLotStickersBesar(newLot, { code, name: targetName }, stickerCount);
                    }
                }
            }
        } else if (intakeItem && intakeItem.green_coffee_lot_id) {
            // Editing a lot that may already be partially consumed (once 1B
            // ships) is still out of scope — this assumes nothing has drawn
            // from the lot yet, so quantity_kg and remaining_kg move together.
            const delta = quantity - parseFloat(intakeItem.quantity || 0);
            await adjustGreenCoffeeLotQuantity(intakeItem.green_coffee_lot_id, delta);
        }

        modalContainer.classList.add('hidden');

        loadIntakeHistory();
        loadGreenbeanInventory();
        scheduleDashboardRefresh(); // Update stats
    });
}

// V2 1A: builds a green_coffee_lots row for a fresh intake and generates its
// human-readable lot code — {coffee code}-GL-{YYMMDD}-{NN} (2-digit year, per
// V2_ROADMAP.md 1A e.g. "YAM-GL-260712-01"), where {NN} is a GLOBAL daily
// sequence across ALL green intakes that day (not per coffee), which is what
// guarantees uniqueness even though green_coffee.code isn't enforced unique.
// Falls back to the coffee's internal id (e.g. "C12") when its code is blank.
// Retries on a lot_code collision (two intakes racing for the same daily
// sequence number) since the count-then-insert isn't atomic.
async function createGreenCoffeeLot({ coffeeId, coffeeCode, arrivalDate, quantityKg, supplier, purchasePricePerKg }) {
    const sanitize = (s) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    const codeSegment = sanitize(coffeeCode) || `C${coffeeId}`;
    const [yyyy, mm, dd] = arrivalDate.split('-');
    const dateCompact = `${yyyy.slice(2)}${mm}${dd}`; // YYMMDD per V2_ROADMAP.md 1A
    const dateISO = arrivalDate.replace(/-/g, '');     // full-year key for matching existing lots' arrival_date

    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const { data: existingLots } = await fetchData('green_coffee_lots');
        const sameDayCount = (existingLots || []).filter(l => (l.arrival_date || '').replace(/-/g, '') === dateISO).length;
        const seq = String(sameDayCount + 1).padStart(2, '0');
        const lotCode = `${codeSegment}-GL-${dateCompact}-${seq}`;

        const { data: savedLot, error } = await saveData('green_coffee_lots', {
            green_coffee_id: coffeeId,
            lot_code: lotCode,
            quantity_kg: quantityKg,
            remaining_kg: quantityKg,
            supplier,
            arrival_date: arrivalDate,
            purchase_price_per_kg: purchasePricePerKg
        });
        if (!error) return savedLot;

        const isDupCode = error.code === '23505' || /duplicate key|already exists/i.test(error.message || '');
        if (isDupCode && attempt < MAX_ATTEMPTS - 1) continue; // re-fetch and retry with the next sequence number

        // Non-fatal: the intake record itself already saved and green_coffee.stock_kg
        // was already updated directly above, so the arrival is not lost — only the
        // lot-level breakdown (FIFO/traceability) is missing until this is retried.
        console.error('Failed to create green_coffee_lots row (lot tracking degraded):', error);
        return null;
    }
    return null;
}

// V2 1A: keeps a lot's quantity_kg/remaining_kg in sync when the intake that
// created it is edited (deltaKg = new intake qty - old intake qty). Both
// fields move together, floored at 0 — same semantics as before, but now
// via the adjust_green_coffee_lot() Postgres function so the read-and-write
// happens atomically in the database instead of racing against a roast
// batch (or another edit) that touches the same lot's remaining_kg between
// this function's own read and write. V2 concurrency fix — see
// database/v2_greenbean_lot_atomic_functions_migration.sql.
async function adjustGreenCoffeeLotQuantity(lotId, deltaKg) {
    const { error } = await window.supabaseClient.rpc('adjust_green_coffee_lot', {
        p_lot_id: lotId,
        p_delta_kg: deltaKg
    });
    if (error) console.error('Failed to adjust green_coffee_lots row after intake edit:', error);
}

// V2 Greenbean Data Analyze: single entry point for creating/editing a lab
// reading (moisture/water_activity/density), used by both the Arrival modal
// (one-time, at intake) and the Data Analyze tab's Add/Edit modal. On
// create, whichever reading is the FIRST ever recorded for a given lot —
// regardless of which UI it came from — is tagged 'arrival'; every reading
// after that for the same lot is 'manual'. This one rule is what makes "lab
// check skipped at arrival, first reading recorded later via the Data
// Analyze tab becomes the arrival record" work automatically, with no
// separate backfill step.
async function saveAnalysisRecord({ id = null, greenCoffeeId, lotId, testDate, moisture, waterActivity, density }) {
    const record = {
        green_coffee_id: greenCoffeeId,
        green_coffee_lot_id: lotId,
        test_date: testDate,
        moisture_content: moisture ?? null,
        water_activity: waterActivity ?? null,
        density: density ?? null
    };

    if (id) {
        record.id = id;
    } else {
        const { data: existing } = await fetchData('green_coffee_analysis');
        const hasAny = (existing || []).some(r => r.green_coffee_lot_id === lotId);
        record.source = hasAny ? 'manual' : 'arrival';
        record.recorded_by = (currentUser && currentUser.name) || null;
    }

    const { data: saved, error } = await saveData('green_coffee_analysis', record);
    if (error) {
        alert('Failed to save lab reading: ' + error.message);
        return null;
    }
    await syncGreenCoffeeLabSnapshot(greenCoffeeId);
    return saved;
}

// Recomputes green_coffee.moisture_content/water_activity/density as a
// read-only cache of whichever green_coffee_analysis row has the latest
// test_date for that coffee (across all its lots) — the only writer of
// those 3 columns since Data Analyze shipped; every modal that used to let
// them be edited directly now only displays them.
async function syncGreenCoffeeLabSnapshot(coffeeId) {
    const { data: rows } = await fetchData('green_coffee_analysis');
    const mine = (rows || []).filter(r => r.green_coffee_id === coffeeId);
    const latest = mine.sort((a, b) =>
        (b.test_date || '').localeCompare(a.test_date || '') || b.id - a.id
    )[0] || null;

    await saveData('green_coffee', {
        id: coffeeId,
        moisture_content: latest ? latest.moisture_content : null,
        water_activity: latest ? latest.water_activity : null,
        density: latest ? latest.density : null
    });
}

// --- TAB: Greenbean Data Analyze ---
async function loadGreenCoffeeAnalysisSection() {
    const tbody = document.getElementById('gb-analysis-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const [
        { data: rows },
        { data: greenbeans },
        { data: lots }
    ] = await Promise.all([
        fetchData('green_coffee_analysis'),
        fetchData('green_coffee'),
        fetchData('green_coffee_lots')
    ]);

    registerSearchInput('tab-gb-analysis', 'gb-analysis-search-input');

    if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center-muted">${window.t ? window.t('msg_no_analysis_yet') : 'No lab readings recorded yet.'}</td></tr>`;
        applyFiltersForTable(document.querySelector('#tab-gb-analysis table'));
        return;
    }

    const sorted = [...rows].sort((a, b) => (b.test_date || '').localeCompare(a.test_date || '') || b.id - a.id);

    tbody.innerHTML = sorted.map(r => {
        const bean = greenbeans.find(g => g.id === r.green_coffee_id);
        const lot = lots.find(l => l.id === r.green_coffee_lot_id);
        const sourceLabel = r.source === 'arrival'
            ? (window.t ? window.t('badge_source_arrival') : 'Arrival')
            : (window.t ? window.t('badge_source_manual') : 'Manual');
        const sourceStyle = r.source === 'arrival'
            ? 'background: rgba(82,183,136,0.15); color: var(--success);'
            : 'background: rgba(144,180,216,0.15); color: var(--info);';
        return `
            <tr>
                <td>${r.test_date || '-'}</td>
                <td><strong>${bean ? bean.name : '-'}</strong></td>
                <td><code style="font-size:0.75rem;">${lot ? lot.lot_code : '-'}</code></td>
                <td>${r.moisture_content !== null && r.moisture_content !== undefined ? r.moisture_content + '%' : '—'}</td>
                <td>${r.water_activity ?? '—'}</td>
                <td>${r.density ?? '—'}</td>
                <td><span style="font-size:0.72rem; padding:2px 9px; border-radius:9999px; font-weight:700; ${sourceStyle}">${sourceLabel}</span></td>
                <td>
                    ${hasPermission('greenbean_analysis_edit') ? `<button class="btn btn-secondary btn-sm btn-edit-analysis" data-id="${r.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>` : ''}
                </td>
            </tr>
        `;
    }).join('');

    document.querySelectorAll('.btn-edit-analysis').forEach(btn => {
        btn.addEventListener('click', () => openAnalysisRecordModal(parseInt(btn.getAttribute('data-id'))));
    });

    applyFiltersForTable(document.querySelector('#tab-gb-analysis table'));
}

// Add/Edit modal for a single lab reading. On create: Test Date (top,
// autofilled today) → Coffee → Lot (repopulated from the selected coffee's
// lots) → Moisture/Water activity/Density. On edit: Coffee/Lot are locked
// (disabled) — reassigning which lot a past reading belongs to isn't
// supported, only the date and the 3 values can change.
async function openAnalysisRecordModal(editId = null, presetCoffeeId = null) {
    const [
        { data: rows },
        { data: greenbeans },
        { data: lots }
    ] = await Promise.all([
        fetchData('green_coffee_analysis'),
        fetchData('green_coffee'),
        fetchData('green_coffee_lots')
    ]);

    const record = editId ? (rows || []).find(r => r.id === editId) : null;
    const todayStr = new Date().toISOString().split('T')[0];

    const sortedBeans = [...(greenbeans || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const coffeeOptionsHtml = sortedBeans.map(g => {
        const isSelected = record ? record.green_coffee_id === g.id : presetCoffeeId === g.id;
        return `<option value="${g.id}" ${isSelected ? 'selected' : ''}>${g.name} — ${g.code || 'no code'}</option>`;
    }).join('');

    const html = `
        <form id="modal-analysis-form">
            <div class="form-group">
                <label class="form-label" data-i18n="lbl_analysis_date">Test Date</label>
                <input type="date" id="m-an-date" class="form-control" value="${record ? record.test_date : todayStr}" required>
            </div>
            <div class="form-group">
                <label class="form-label" data-i18n="lbl_analysis_coffee">Coffee</label>
                <select id="m-an-coffee" class="form-control" required ${record ? 'disabled' : ''}>
                    <option value="" disabled ${record || presetCoffeeId ? '' : 'selected'}>-- Select coffee --</option>
                    ${coffeeOptionsHtml}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" data-i18n="lbl_analysis_lot">Lot (arrival date)</label>
                <select id="m-an-lot" class="form-control" required ${record ? 'disabled' : ''}></select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" data-i18n="tracking_lbl_moisture">Moisture %</label>
                    <input type="number" step="any" id="m-an-moisture" class="form-control" value="${record && record.moisture_content !== null ? record.moisture_content : ''}" placeholder="e.g. 11.5">
                </div>
                <div class="form-group">
                    <label class="form-label" data-i18n="tracking_lbl_water_activity">Water activity</label>
                    <input type="number" step="any" id="m-an-water-activity" class="form-control" value="${record && record.water_activity !== null ? record.water_activity : ''}" placeholder="e.g. 0.55">
                </div>
                <div class="form-group">
                    <label class="form-label" data-i18n="tracking_lbl_density">Density</label>
                    <input type="number" step="any" id="m-an-density" class="form-control" value="${record && record.density !== null ? record.density : ''}" placeholder="e.g. 700">
                </div>
            </div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                <button type="submit" class="btn btn-primary" data-i18n="btn_save">Save</button>
            </div>
        </form>
    `;

    openModal(window.t ? window.t('title_analysis_record') : 'Record Lab Reading', html);
    window.translatePage();

    const coffeeSelect = document.getElementById('m-an-coffee');
    const lotSelect = document.getElementById('m-an-lot');

    function renderLotOptions(coffeeId) {
        const allLots = (lots || [])
            .filter(l => l.green_coffee_id === coffeeId)
            .sort((a, b) => (b.arrival_date || '').localeCompare(a.arrival_date || '') || b.id - a.id);
        // Every lot still holding stock, plus at most the 2 most recent
        // depleted ones (a coffee that's been arriving for months can have
        // dozens of long-emptied lots — showing all of them just buries the
        // handful anyone would actually pick).
        const withStock = allLots.filter(l => parseFloat(l.remaining_kg || 0) > 0);
        const depleted = allLots.filter(l => parseFloat(l.remaining_kg || 0) <= 0).slice(0, 2);
        let myLots = [...withStock, ...depleted];
        // Editing: always include the record's own lot, even if it's an
        // older depleted one trimmed above — otherwise the (disabled) select
        // would show the wrong lot for this reading.
        if (record && !myLots.some(l => l.id === record.green_coffee_lot_id)) {
            const ownLot = allLots.find(l => l.id === record.green_coffee_lot_id);
            if (ownLot) myLots.push(ownLot);
        }
        myLots = myLots.sort((a, b) => (b.arrival_date || '').localeCompare(a.arrival_date || '') || b.id - a.id);
        lotSelect.innerHTML = myLots.map(l =>
            `<option value="${l.id}" ${record && record.green_coffee_lot_id === l.id ? 'selected' : ''}>${l.lot_code} · ${l.arrival_date || '-'} · ${parseFloat(l.remaining_kg || 0).toFixed(1)}kg left</option>`
        ).join('') || `<option value="" disabled selected>-- No lots yet --</option>`;
    }

    if (record) {
        renderLotOptions(record.green_coffee_id);
    } else {
        coffeeSelect.addEventListener('change', () => renderLotOptions(parseInt(coffeeSelect.value) || null));
        // Opened from a coffee's own detail modal ("Add reading" on the Lab
        // Readings tab) — jump straight to a ready-to-fill form instead of
        // making the user re-pick the coffee they just came from.
        if (presetCoffeeId) renderLotOptions(presetCoffeeId);
    }

    document.getElementById('modal-analysis-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const lotIdVal = lotSelect.value ? parseInt(lotSelect.value) : null;
        if (!lotIdVal) {
            await showWarningModal('Select a lot first — this coffee has no recorded arrival lots yet.', false);
            return;
        }
        const moistureInput = document.getElementById('m-an-moisture').value;
        const waterActivityInput = document.getElementById('m-an-water-activity').value;
        const densityInput = document.getElementById('m-an-density').value;

        const saved = await saveAnalysisRecord({
            id: editId,
            greenCoffeeId: record ? record.green_coffee_id : parseInt(coffeeSelect.value),
            lotId: record ? record.green_coffee_lot_id : lotIdVal,
            testDate: document.getElementById('m-an-date').value,
            moisture: moistureInput ? parseFloat(moistureInput) : null,
            waterActivity: waterActivityInput ? parseFloat(waterActivityInput) : null,
            density: densityInput ? parseFloat(densityInput) : null
        });
        if (!saved) return;

        document.getElementById('btn-close-modal').click();
        loadGreenCoffeeAnalysisSection();
        scheduleDashboardRefresh();
    });
}

// V2 Greenbean detail modal — Tab 1: Stock History. Assembles a
// chronological in/out ledger from every source that touches
// green_coffee_lots for this coffee: IN = every green_coffee_lots row
// itself (a real arrival AND a manual +adjustment both go through
// createGreenCoffeeLot, so this one source covers both); OUT =
// roast_batch_green_lots (roasting), green_coffee_outbound_lots
// (shipments), green_coffee_lot_adjustments (manual -adjustments). Running
// balance is computed oldest-first, then the display order is reversed to
// newest-first like every other table in this app.
async function renderStockHistoryTab(coffeeId, container) {
    container.innerHTML = `<div class="text-center-muted" style="padding:20px;">Loading...</div>`;

    const [
        { data: greenbeans },
        { data: allLots },
        { data: batchLots },
        { data: batches },
        { data: machines },
        { data: outboundLots },
        { data: outbound },
        { data: adjustments }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('green_coffee_lots'),
        fetchData('roast_batch_green_lots'),
        fetchData('roast_batches'),
        fetchData('machines'),
        fetchData('green_coffee_outbound_lots'),
        fetchData('green_coffee_outbound'),
        fetchData('green_coffee_lot_adjustments')
    ]);

    const coffee = (greenbeans || []).find(g => g.id === coffeeId);
    const myLots = (allLots || []).filter(l => l.green_coffee_id === coffeeId);
    const myLotIds = new Set(myLots.map(l => l.id));
    const lotCodeOf = (lotId) => { const l = myLots.find(x => x.id === lotId); return l ? l.lot_code : '-'; };

    const ledger = [];

    // "-OPENING-" lots are the one-time seed row V2 lot-tracking created for
    // whatever stock already existed the moment it went live (see
    // database/v2_lot_tracking_migration.sql) — not a real supplier
    // arrival, so it gets its own clearly-labeled detail instead of
    // reading like a normal delivery.
    myLots.forEach(l => {
        const isOpening = (l.lot_code || '').includes('-OPENING-');
        // Stock Opname's increase path (js/app.js applyStockGroupAdjustmentToLots)
        // creates a lot the same way any arrival/manual-adjustment does, tagged
        // only via this supplier string — no separate ref_table/ref_id here
        // since createGreenCoffeeLot has no such param, unlike the decrease
        // path below which needed one added to green_coffee_lot_adjustments.
        const isStockOpname = l.supplier === 'Stock Take Adjustment';
        ledger.push({
            date: l.arrival_date || (l.created_at || '').split('T')[0],
            lotCode: l.lot_code,
            type: 'in',
            kg: parseFloat(l.quantity_kg) || 0,
            isStockOpname,
            detail: isOpening
                ? (window.t ? window.t('lbl_opening_balance') : 'Opening balance')
                : isStockOpname
                    ? (window.t ? window.t('lbl_stock_opname_adjustment') : 'Stock opname adjustment')
                    : (l.supplier === 'Manual Stock Adjustment'
                        ? (window.t ? window.t('lbl_manual_adjustment') : 'Manual adjustment')
                        : `${window.t ? window.t('lbl_supplier_prefix') : 'Supplier'}: ${l.supplier || '-'}`),
            sortKey: l.id
        });
    });

    // Roasting draws are aggregated to one row per (lot, day) — an active
    // coffee can rack up dozens of individual batches on the same day,
    // which would bury the handful of real movements (arrivals, shipments,
    // corrections) anyone actually wants to see. Detail names the
    // machine(s) that contributed and how many batches, instead of every
    // single one.
    const roastByLotDate = new Map();
    (batchLots || []).filter(d => myLotIds.has(d.green_coffee_lot_id)).forEach(d => {
        const batch = (batches || []).find(b => b.id === d.roast_batch_id);
        const machine = batch ? (machines || []).find(m => m.id === batch.machine_id) : null;
        const date = batch ? batch.roast_date : null;
        const key = `${d.green_coffee_lot_id}|${date}`;
        if (!roastByLotDate.has(key)) {
            roastByLotDate.set(key, { lotId: d.green_coffee_lot_id, date, kg: 0, machines: new Set(), count: 0, maxId: d.id });
        }
        const g = roastByLotDate.get(key);
        g.kg += parseFloat(d.kg_consumed) || 0;
        if (machine) g.machines.add(machine.name);
        g.count += 1;
        g.maxId = Math.max(g.maxId, d.id);
    });
    roastByLotDate.forEach(g => {
        const machineLabel = g.machines.size === 0 ? '-'
            : g.machines.size === 1 ? [...g.machines][0]
            : (window.t ? window.t('lbl_multiple_machines') : 'Multiple machines');
        const batchLabel = g.count === 1
            ? (window.t ? window.t('lbl_batch_singular') : 'batch')
            : (window.t ? window.t('lbl_batches_plural') : 'batches');
        ledger.push({
            date: g.date,
            lotCode: lotCodeOf(g.lotId),
            type: 'roasted',
            kg: g.kg,
            detail: `${machineLabel} · ${window.t ? window.t('lbl_roasting') : 'roasting'} · ${g.count} ${batchLabel}`,
            sortKey: g.maxId
        });
    });

    (outboundLots || []).filter(d => myLotIds.has(d.green_coffee_lot_id)).forEach(d => {
        const ship = (outbound || []).find(o => o.id === d.green_coffee_outbound_id);
        ledger.push({
            date: ship ? ship.date : null,
            lotCode: lotCodeOf(d.green_coffee_lot_id),
            type: 'out',
            kg: parseFloat(d.kg) || 0,
            detail: `${window.t ? window.t('lbl_shipped_to') : 'Shipped to'} ${ship ? ship.destination : '-'}`,
            sortKey: d.id
        });
    });

    (adjustments || []).filter(d => myLotIds.has(d.green_coffee_lot_id)).forEach(d => {
        // ref_table/ref_id (added 2026-08-30) tags a decrease written by
        // Stock Opname's posting flow (js/app.js applyStockGroupAdjustmentToLots)
        // — a plain manual edit (js/greenbean.js) leaves both NULL.
        // ref_table 'roast_batches' = a Pending test batch deleted from its
        // Ready to Pack card as "thrown away" (js/roasting.js
        // deletePendingTestBatch) — its roast_batch_green_lots draws are gone
        // with the batch, so this row is what keeps that kg explained.
        const isStockOpname = d.ref_table === 'stock_takes';
        const isDiscardedTest = d.ref_table === 'roast_batches';
        ledger.push({
            date: d.adjustment_date,
            lotCode: lotCodeOf(d.green_coffee_lot_id),
            type: 'out',
            kg: parseFloat(d.kg) || 0,
            isStockOpname,
            detail: isStockOpname
                ? (window.t ? window.t('lbl_stock_opname_adjustment') : 'Stock opname adjustment')
                : isDiscardedTest
                    ? (window.t ? window.t('lbl_discarded_test_roast') : 'Discarded test roast')
                    : (window.t ? window.t('lbl_manual_adjustment') : 'Manual adjustment'),
            sortKey: d.id
        });
    });

    // Oldest-first to compute a running balance, then reversed for display.
    ledger.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.sortKey - b.sortKey);
    let running = 0;
    ledger.forEach(r => {
        running += r.type === 'in' ? r.kg : -r.kg;
        r.balance = running;
    });
    const displayRows = [...ledger].reverse();

    const todayStr = new Date().toISOString().split('T')[0];
    const monthStart = todayStr.slice(0, 7) + '-01';
    // "Roasted" (internal consumption) still counts toward the Out stat
    // cards alongside "Out" (outbound shipments + manual decreases) — only
    // the per-row Type badge below tells the two apart, matching the
    // 2-card (In/Out) design already agreed on.
    const sumOf = (isIn, sinceDate) => ledger
        .filter(r => (r.type === 'in') === isIn && (!sinceDate || (r.date || '') >= sinceDate))
        .reduce((s, r) => s + r.kg, 0);
    const inThisMonth = sumOf(true, monthStart);
    const outThisMonth = sumOf(false, monthStart);
    const inAllTime = sumOf(true);
    const outAllTime = sumOf(false);
    const unit = companySettings.weight_unit;

    // Type badge: 3 distinct labels/colors so a roasting draw (internal
    // consumption) reads differently at a glance from an outbound shipment
    // or manual correction, even though both subtract from the running
    // balance the same way.
    // 'roasted' uses the .badge-roasted / .text-roasted CSS classes (see
    // css/styles.css) instead of var(--warning) directly — that token is
    // never redefined for light mode and reads as pale, near-invisible
    // yellow on a white card.
    const TYPE_BADGE = {
        in: { label: window.t ? window.t('lbl_in') : 'In', style: 'background: rgba(82,183,136,0.15); color: var(--success);', cls: '' },
        roasted: { label: window.t ? window.t('lbl_roasted') : 'Roasted', style: '', cls: 'badge-roasted' },
        out: { label: window.t ? window.t('lbl_out') : 'Out', style: 'background: rgba(239,68,68,0.15); color: var(--danger);', cls: '' }
    };

    // white-space:nowrap on every column — a narrow column like Lot Code
    // ("1-GL-260817-01") or Type wrapping to 2 lines makes the whole row
    // taller and harder to scan than just letting the table scroll
    // sideways in its own wrapper (see the overflow-x:auto container below).
    const nowrap = 'white-space:nowrap;';
    const rowsHtml = displayRows.length === 0
        ? `<tr><td colspan="6" class="text-center-muted">${window.t ? window.t('msg_no_history_yet') : 'No stock movement recorded yet.'}</td></tr>`
        : displayRows.map(r => {
            const badge = TYPE_BADGE[r.type] || TYPE_BADGE.out;
            const amountCls = r.type === 'roasted' ? 'text-roasted' : '';
            const amountStyle = r.type === 'roasted' ? '' : `color: ${r.type === 'in' ? 'var(--success)' : 'var(--danger)'};`;
            return `
            <tr>
                <td style="${nowrap}">${r.date || '-'}</td>
                <td style="${nowrap}"><code style="font-size:0.75rem;">${r.lotCode}</code></td>
                <td style="${nowrap}"><span class="${badge.cls}" style="font-size:0.72rem; padding:2px 9px; border-radius:9999px; font-weight:700; ${badge.style}">${badge.label}</span></td>
                <td class="${amountCls}" style="${nowrap} ${amountStyle}">${r.type === 'in' ? '+' : '-'}${r.kg.toFixed(1)}</td>
                <td style="${nowrap}">${r.balance.toFixed(1)}</td>
                <td style="${nowrap}">${r.isStockOpname
                    ? `<span style="font-size:0.7rem; font-weight:700; padding:2px 9px; border-radius:9999px; background:rgba(144,180,216,0.18); color:var(--info); white-space:nowrap;" data-i18n="lbl_stock_opname_adjustment">${window.t ? window.t('lbl_stock_opname_adjustment') : 'Stock Opname'}</span>`
                    : r.detail}</td>
            </tr>
        `;
        }).join('');

    container.innerHTML = `
        <div style="font-size:0.72rem; color:var(--text-muted); margin-bottom:6px;">${window.t ? window.t('lbl_this_month') : 'This month'} · ${window.t ? window.t('lbl_since') : 'since'} ${monthStart}</div>
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-bottom:14px;">
            <div style="background: var(--bg-input); border-radius: 8px; padding: 10px 12px;">
                <div style="font-size:0.7rem; color:var(--text-muted);">${window.t ? window.t('lbl_current_stock') : 'Current stock'}</div>
                <div style="font-size:1.25rem; font-weight:700;">${coffee ? parseFloat(coffee.stock_kg || 0).toFixed(1) : '0.0'} ${unit}</div>
            </div>
            <div style="background: var(--bg-input); border-radius: 8px; padding: 10px 12px;">
                <div style="font-size:0.7rem; color:var(--text-muted);">${window.t ? window.t('lbl_in_this_month') : 'In this month'}</div>
                <div style="font-size:1.25rem; font-weight:700; color:var(--success);">+${inThisMonth.toFixed(1)} ${unit}</div>
                <div style="font-size:0.66rem; color:var(--text-muted); margin-top:4px; padding-top:4px; border-top:1px solid var(--border);">${window.t ? window.t('lbl_all_time') : 'All-time'}: ${inAllTime.toFixed(1)} ${unit}</div>
            </div>
            <div style="background: var(--bg-input); border-radius: 8px; padding: 10px 12px;">
                <div style="font-size:0.7rem; color:var(--text-muted);">${window.t ? window.t('lbl_out_this_month') : 'Out this month'}</div>
                <div style="font-size:1.25rem; font-weight:700; color:var(--danger);">-${outThisMonth.toFixed(1)} ${unit}</div>
                <div style="font-size:0.66rem; color:var(--text-muted); margin-top:4px; padding-top:4px; border-top:1px solid var(--border);">${window.t ? window.t('lbl_all_time') : 'All-time'}: ${outAllTime.toFixed(1)} ${unit}</div>
            </div>
        </div>
        <div style="max-height:280px; overflow-y:auto; overflow-x:auto; border:1px solid var(--border); border-radius:8px;">
            <table>
                <thead>
                    <tr>
                        <th style="${nowrap}">${window.t ? window.t('col_history_date') : 'Date'}</th>
                        <th style="${nowrap}">${window.t ? window.t('col_history_lot') : 'Lot Code'}</th>
                        <th style="${nowrap}">${window.t ? window.t('col_history_type') : 'Type'}</th>
                        <th style="${nowrap}">${window.t ? window.t('col_history_qty') : 'Qty (kg)'}</th>
                        <th style="${nowrap}">${window.t ? window.t('col_history_balance') : 'Balance'}</th>
                        <th style="${nowrap}">${window.t ? window.t('col_history_detail') : 'Detail'}</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>
    `;
}

// V2 Greenbean detail modal — Tab 2: Lab Readings. Reuses the exact same
// green_coffee_analysis data the Data Analyze tab reads, filtered to this
// one coffee (Coffee Name column dropped since it's redundant here).
async function renderLabReadingsTab(coffeeId, container) {
    container.innerHTML = `<div class="text-center-muted" style="padding:20px;">Loading...</div>`;

    const [
        { data: greenbeans },
        { data: rows },
        { data: lots }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('green_coffee_analysis'),
        fetchData('green_coffee_lots')
    ]);

    const coffee = (greenbeans || []).find(g => g.id === coffeeId);
    const myRows = (rows || [])
        .filter(r => r.green_coffee_id === coffeeId)
        .sort((a, b) => (b.test_date || '').localeCompare(a.test_date || '') || b.id - a.id);

    const rowsHtml = myRows.length === 0
        ? `<tr><td colspan="5" class="text-center-muted">${window.t ? window.t('msg_no_analysis_yet') : 'No lab readings recorded yet.'}</td></tr>`
        : myRows.map(r => {
            const lot = (lots || []).find(l => l.id === r.green_coffee_lot_id);
            const sourceLabel = r.source === 'arrival'
                ? (window.t ? window.t('badge_source_arrival') : 'Arrival')
                : (window.t ? window.t('badge_source_manual') : 'Manual');
            const sourceStyle = r.source === 'arrival'
                ? 'background: rgba(82,183,136,0.15); color: var(--success);'
                : 'background: rgba(144,180,216,0.15); color: var(--info);';
            return `
                <tr>
                    <td>${r.test_date || '-'}</td>
                    <td><code style="font-size:0.75rem;">${lot ? lot.lot_code : '-'}</code></td>
                    <td>${r.moisture_content !== null && r.moisture_content !== undefined ? r.moisture_content + '%' : '—'}</td>
                    <td>${r.water_activity ?? '—'}</td>
                    <td>${r.density ?? '—'}</td>
                    <td><span style="font-size:0.72rem; padding:2px 9px; border-radius:9999px; font-weight:700; ${sourceStyle}">${sourceLabel}</span></td>
                </tr>
            `;
        }).join('');

    container.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
            <span style="font-size:0.8rem; color:var(--text-muted);" data-i18n="lbl_last_lab_reading">Last lab reading</span>
            ${hasPermission('greenbean_analysis_add') ? `<button type="button" id="btn-add-reading-inline" class="btn btn-primary btn-sm"><i class="icon-plus va-middle-mr-1"></i><span data-i18n="btn_add_analysis">Add Reading</span></button>` : ''}
        </div>
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-bottom:14px;">
            <div style="background: var(--bg-input); border-radius: 8px; padding: 10px 12px;">
                <div style="font-size:0.7rem; color:var(--text-muted);" data-i18n="tracking_lbl_moisture">Moisture</div>
                <div style="font-size:1.1rem; font-weight:700;">${coffee && coffee.moisture_content !== null && coffee.moisture_content !== undefined ? coffee.moisture_content + '%' : '—'}</div>
            </div>
            <div style="background: var(--bg-input); border-radius: 8px; padding: 10px 12px;">
                <div style="font-size:0.7rem; color:var(--text-muted);" data-i18n="tracking_lbl_water_activity">Water activity</div>
                <div style="font-size:1.1rem; font-weight:700;">${coffee ? (coffee.water_activity ?? '—') : '—'}</div>
            </div>
            <div style="background: var(--bg-input); border-radius: 8px; padding: 10px 12px;">
                <div style="font-size:0.7rem; color:var(--text-muted);" data-i18n="tracking_lbl_density">Density</div>
                <div style="font-size:1.1rem; font-weight:700;">${coffee ? (coffee.density ?? '—') : '—'}</div>
            </div>
        </div>
        <div style="max-height:250px; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">
            <table>
                <thead>
                    <tr>
                        <th data-i18n="col_analysis_date">Test Date</th>
                        <th data-i18n="col_analysis_lot">Lot</th>
                        <th data-i18n="tracking_lbl_moisture">Moisture</th>
                        <th data-i18n="tracking_lbl_water_activity">Water Activity</th>
                        <th data-i18n="tracking_lbl_density">Density</th>
                        <th data-i18n="col_analysis_source">Source</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>
    `;
    if (typeof window.translatePage === 'function') window.translatePage();

    const addBtn = document.getElementById('btn-add-reading-inline');
    if (addBtn) {
        addBtn.addEventListener('click', () => openAnalysisRecordModal(null, coffeeId));
    }
}

// V2 Greenbean Inventory row click: 2-tab detail modal (Stock History /
// Lab Readings). Tabs are a small local click-toggle, not the app's
// page-level .tab-btn system (that's wired once at boot against
// #sec-* sections; this modal is injected dynamically into
// #modal-body-content, so those listeners never see it).
async function openGreenbeanDetailModal(coffeeId) {
    const { data: greenbeans } = await fetchData('green_coffee');
    const bean = (greenbeans || []).find(g => g.id === coffeeId);
    if (!bean) return;

    const html = `
        <div style="display:flex; gap:4px; margin:-8px 0 14px; border-bottom:1px solid var(--border);">
            <div id="gbd-tab-history" style="padding:9px 16px; font-size:0.85rem; cursor:pointer; border-bottom:2px solid var(--primary); font-weight:700;" data-i18n="tab_stock_history">Stock History</div>
            <div id="gbd-tab-lab" style="padding:9px 16px; font-size:0.85rem; cursor:pointer; color:var(--text-muted);" data-i18n="tab_lab_readings">Lab Readings</div>
        </div>
        <div id="gbd-panel-history"></div>
        <div id="gbd-panel-lab" class="hidden"></div>
    `;

    openModal(`${bean.code || ''} — ${bean.name}`, html, '700px');
    if (typeof window.translatePage === 'function') window.translatePage();

    const tabHistory = document.getElementById('gbd-tab-history');
    const tabLab = document.getElementById('gbd-tab-lab');
    const panelHistory = document.getElementById('gbd-panel-history');
    const panelLab = document.getElementById('gbd-panel-lab');

    function activate(which) {
        const isHistory = which === 'history';
        tabHistory.style.borderBottom = isHistory ? '2px solid var(--primary)' : 'none';
        tabHistory.style.fontWeight = isHistory ? '700' : '400';
        tabHistory.style.color = isHistory ? '' : 'var(--text-muted)';
        tabLab.style.borderBottom = isHistory ? 'none' : '2px solid var(--primary)';
        tabLab.style.fontWeight = isHistory ? '400' : '700';
        tabLab.style.color = isHistory ? 'var(--text-muted)' : '';
        panelHistory.classList.toggle('hidden', !isHistory);
        panelLab.classList.toggle('hidden', isHistory);
    }
    tabHistory.addEventListener('click', () => activate('history'));
    tabLab.addEventListener('click', () => { activate('lab'); renderLabReadingsTab(coffeeId, panelLab); });

    await renderStockHistoryTab(coffeeId, panelHistory);
}

// V2 barcode label fix: green bean sacks always need ONE BARCODE PER
// MACHINE per sack (whichever machine ends up roasting it, the matching
// barcode is the one to scan — payload `RMP:Lot:{green_coffee_lots.id}:
// {machineId}`, parsed by 1B's scan handler). Two physical sticker sizes:
// "Besar" (5x15cm) fits every machine's barcode on ONE tall sticker per
// sack; "Kecil" (5x2.5cm, same stock as packed-coffee labels) is too small
// for that, so it prints one small sticker PER MACHINE per sack instead —
// same fixed-size single-barcode style as packed coffee (buildFixedLabelDocument,
// js/packing.js), so the two never drift apart again.

// Besar — one 50x150mm sticker per sack, every machine's barcode stacked on it.
async function printGreenLotStickersBesar(lot, coffee, stickerCount) {
    const { data: machines } = await fetchData('machines');
    if (!machines || machines.length === 0) {
        alert('No machines configured. Please add machines in Settings first.');
        return;
    }

    let labelsHtml = '';
    for (let i = 0; i < stickerCount; i++) {
        const rowsHtml = machines.map(m => `
            <div class="green-machine-row">
                <svg class="green-lot-barcode-svg" data-value="RMP:Lot:${lot.id}:${m.id}"></svg>
                <div class="green-machine-name">${m.name}</div>
            </div>
        `).join('');
        labelsHtml += `
            <div class="green-lot-sticker">
                <div class="green-header-code">${coffee.code || coffee.name}</div>
                <div class="green-header-name">${coffee.name}</div>
                <div class="green-header-date">${lot.arrival_date}</div>
                ${rowsHtml}
            </div>
        `;
    }

    const printWin = window.open('', '_blank', 'width=900,height=700');
    if (!printWin) {
        alert('Could not open the print window — please allow pop-ups for this site and try again.');
        return;
    }
    printWin.document.write(`
        <html><head><title>Green Lot Stickers — Besar</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <style>
            @page { size: 50mm 150mm; margin: 2mm; }
            body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
            .green-lot-sticker { width: 100%; box-sizing: border-box; text-align: center; page-break-after: always; }
            .green-lot-sticker:last-child { page-break-after: auto; }
            .green-header-code { font-size: 3.4mm; font-weight: 700; }
            .green-header-name { font-size: 2.6mm; margin-top: 0.5mm; }
            .green-header-date { font-size: 2.2mm; color: #555; margin-top: 0.5mm; margin-bottom: 2mm; }
            /* Same fixed-mm-height barcode zone as the small/packed labels —
               each machine row gets consistent, reliably-scannable bars
               regardless of how many machines are configured. */
            .green-machine-row { margin-bottom: 2.5mm; }
            .green-lot-barcode-svg { max-width: 92%; height: 13mm; width: auto; display: block; margin: 0 auto; }
            .green-machine-name { font-size: 2.6mm; font-weight: 700; margin-top: 0.6mm; }
        </style></head><body>
        ${labelsHtml}
        <script>
            document.querySelectorAll('.green-lot-barcode-svg').forEach(el => {
                JsBarcode(el, el.dataset.value, { format: 'CODE128', width: 2.4, height: 60, displayValue: false, margin: 4 });
            });
            setTimeout(() => { window.print(); }, 500);
        <\/script>
        </body></html>
    `);
    printWin.document.close();
}

// Kecil — one 50x25mm sticker PER MACHINE per sack (same physical size and
// visual style as the packed-coffee label — buildFixedLabelDocument lives
// in js/packing.js, loaded after this file but only called at click-time,
// well after every script has loaded).
async function printGreenLotStickersKecil(lot, coffee, stickerCount) {
    const { data: machines } = await fetchData('machines');
    if (!machines || machines.length === 0) {
        alert('No machines configured. Please add machines in Settings first.');
        return;
    }

    let labelsHtml = '';
    for (let i = 0; i < stickerCount; i++) {
        machines.forEach(m => {
            labelsHtml += `
                <div class="barcode-label-item">
                    <svg class="lot-barcode-svg" data-value="RMP:Lot:${lot.id}:${m.id}" data-display="${coffee.code || coffee.name}"></svg>
                    <div class="lbl-coffee">${coffee.name}</div>
                    <div class="lbl-size">${m.name}</div>
                    <div class="lbl-dates">${lot.arrival_date}</div>
                </div>
            `;
        });
    }

    const printWin = window.open('', '_blank', 'width=900,height=700');
    if (!printWin) {
        alert('Could not open the print window — please allow pop-ups for this site and try again.');
        return;
    }
    printWin.document.write(buildFixedLabelDocument(labelsHtml, true));
    printWin.document.close();
}

async function deleteIntake(deleteId) {
    if (await showDeleteConfirmModal('this intake lot')) {
        const [
            { data: history },
            { data: inventory }
        ] = await Promise.all([
            fetchData('green_coffee_intake'),
            fetchData('green_coffee')
        ]);
        const item = history.find(i => i.id === deleteId);
        if (!item) return;

        // Deduct quantity from warehouse inventory. Prefer the green_coffee_id
        // FK; fall back to name+code text match only for legacy intake rows
        // saved before this FK was populated (pre this fix).
        const match = inventory.find(g =>
            (item.green_coffee_id && g.id === item.green_coffee_id) ||
            (!item.green_coffee_id && g.name.toLowerCase() === (item.name || '').toLowerCase() && (g.code || '').toLowerCase() === (item.code || '').toLowerCase()));
        if (match) {
            match.stock_kg = Math.max(0, parseFloat(match.stock_kg) - parseFloat(item.quantity));
            await saveData('green_coffee', match);
        }

        // V2 1A: delete the lot this intake created (if any) — green_coffee.stock_kg
        // is DERIVED from green_coffee_lots.remaining_kg via trigger, so leaving the
        // lot behind would silently resurrect the "deleted" stock the next time any
        // lot for this coffee changes and the trigger recomputes the sum.
        if (item.green_coffee_lot_id) {
            await deleteData('green_coffee_lots', item.green_coffee_lot_id);
        }

        // Delete from DB
        const { error } = await deleteData('green_coffee_intake', deleteId);
        if (error) {
            alert(window.t("alert_delete_failed").replace("{msg}", error.message));
        } else {
            loadIntakeHistory();
            loadGreenbeanInventory();
            scheduleDashboardRefresh();
        }
    }
}

// ==========================================================================
// GREENBEAN OUTBOUND — shipments of green beans OUT to other roasteries.
// Mirror of the intake/arrival flow but DEDUCTS stock instead of adding it.
// No price is tracked (production team only records physical in/out).
// ==========================================================================
async function loadOutboundHistory() {
    const { data: history } = await fetchData('green_coffee_outbound');
    const tbody = document.getElementById('outbound-history-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!history || history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center-muted">${window.t ? window.t("msg_no_outbounds") : "No outbound shipments yet."}</td></tr>`;
        return;
    }

    const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);

    sorted.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${item.date}</td>
            <td><code>${item.code || '-'}</code></td>
            <td><strong>${item.name}</strong></td>
            <td>${item.origin || '-'}</td>
            <td><strong>${parseFloat(item.quantity).toFixed(1)} ${companySettings.weight_unit}</strong></td>
            <td>${item.destination || '-'}</td>
            <td>
                ${hasPermission('greenbean_outbound_edit') ? `<button class="btn btn-secondary btn-sm btn-edit-outbound" data-id="${item.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>` : ''}
                ${hasPermission('greenbean_outbound_delete') ? `<button class="btn btn-danger btn-sm btn-delete-outbound" data-id="${item.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-edit-outbound').forEach(btn => {
        btn.addEventListener('click', () => openOutboundModal(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-delete-outbound').forEach(btn => {
        btn.addEventListener('click', () => deleteOutbound(parseInt(btn.getAttribute('data-id'))));
    });

    applyFiltersForTable(document.querySelector('#tab-gb-outbound table'));
}

// V2 Stock History: reverses a shipment's previously recorded consumption
// (used before re-consuming on edit, and before deleting) by adding kg back
// to the exact lots it was drawn from, then removes those
// green_coffee_outbound_lots rows. Mirrors refundGreenCoffeeLotsForBatch in
// js/roasting.js. Safe no-op if the shipment predates this tracking.
async function refundGreenCoffeeLotsForOutbound(outboundId) {
    const { data: allDraws } = await fetchData('green_coffee_outbound_lots');
    const mine = (allDraws || []).filter(d => d.green_coffee_outbound_id === outboundId);
    if (mine.length === 0) return;
    for (const d of mine) {
        // V2 concurrency fix: atomic increment via RPC — see
        // refundGreenCoffeeLotsForBatch in js/roasting.js for the same
        // pattern and the reasoning behind it.
        const { error } = await window.supabaseClient.rpc('refund_green_coffee_lot', {
            p_lot_id: d.green_coffee_lot_id,
            p_kg: parseFloat(d.kg || 0)
        });
        if (error) console.error('refund_green_coffee_lot RPC failed for lot', d.green_coffee_lot_id, error);
        await deleteData('green_coffee_outbound_lots', d.id);
    }
}

async function openOutboundModal(editId = null) {
    const [
        { data: inventory },
        { data: history }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('green_coffee_outbound')
    ]);

    let outItem = null;
    if (editId) outItem = (history || []).find(item => item.id === editId);

    // Ship only from existing stock — a <select> of current inventory (unlike
    // intake's free-text create, you can't ship a coffee you don't have).
    // On edit, the shipped qty was already deducted, so add it back into the
    // displayed available figure for its own row.
    const coffeeOpts = [...(inventory || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(g => {
        const selected = outItem && outItem.green_coffee_id === g.id ? 'selected'
            : (outItem && !outItem.green_coffee_id && outItem.name === g.name && outItem.code === g.code ? 'selected' : '');
        return `<option value="${g.id}" data-stock="${g.stock_kg}" data-code="${g.code || ''}" data-origin="${g.origin || ''}" data-process="${g.process || ''}" ${selected}>${g.name}${g.code ? ` (${g.code})` : ''} — ${parseFloat(g.stock_kg || 0).toFixed(1)} ${companySettings.weight_unit}</option>`;
    }).join('');

    const uniqueDest = [...new Set((history || []).map(h => h.destination).filter(Boolean))];
    const destOpts = uniqueDest.map(d => `<option value="${d}"></option>`).join('');

    const defaultDate = outItem ? outItem.date : new Date().toISOString().split('T')[0];
    const defaultQty = outItem ? parseFloat(outItem.quantity) : '';
    const defaultDest = outItem ? (outItem.destination || '') : '';
    const defaultNotes = outItem ? (outItem.notes || '') : '';

    const html = `
        <form id="modal-outbound-form">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" data-i18n="lbl_ship_date">Shipment Date</label>
                    <input type="date" id="m-out-date" class="form-control" value="${defaultDate}" required>
                </div>
                <div class="form-group">
                    <label class="form-label" data-i18n="col_destination">Destination Roastery</label>
                    <input type="text" id="m-out-dest" list="out-dest-list" class="form-control" value="${defaultDest}" placeholder="e.g. Sumatra Roastery Co." required autocomplete="off">
                    <datalist id="out-dest-list">${destOpts}</datalist>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label" data-i18n="lbl_select_coffee">Coffee (from stock)</label>
                <select id="m-out-coffee" class="form-control" required>
                    <option value="" disabled ${outItem ? '' : 'selected'}>-- Select Coffee --</option>
                    ${coffeeOpts}
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" data-i18n="col_intake_qty">Quantity (kg)</label>
                    <input type="number" step="0.1" id="m-out-qty" class="form-control" value="${defaultQty}" min="0.1" required>
                    <div id="m-out-stock-hint" class="text-muted-xs" style="margin-top:4px;"></div>
                </div>
                <div class="form-group">
                    <label class="form-label" data-i18n="lbl_notes">Notes</label>
                    <input type="text" id="m-out-notes" class="form-control" value="${defaultNotes}" placeholder="optional">
                </div>
            </div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">${editId ? (window.t ? window.t('btn_save_changes') : 'Save Changes') : (window.t ? window.t('btn_add_outbound') : 'Add Shipment')}</button>
            </div>
        </form>
    `;

    openModal(editId ? (window.t ? window.t('outbound_edit_title') : 'Edit Outbound Shipment') : (window.t ? window.t('outbound_add_title') : 'Ship Green Beans Out'), html);

    const coffeeSelect = document.getElementById('m-out-coffee');
    const qtyInput = document.getElementById('m-out-qty');
    const stockHint = document.getElementById('m-out-stock-hint');

    // Available = current stock, plus this shipment's own qty when editing
    // (it was already deducted from stock when originally saved).
    function currentAvailable() {
        const opt = coffeeSelect.selectedOptions[0];
        if (!opt || !opt.value) return null;
        let avail = parseFloat(opt.getAttribute('data-stock')) || 0;
        if (outItem && parseInt(opt.value) === outItem.green_coffee_id) avail += parseFloat(outItem.quantity) || 0;
        else if (outItem && !outItem.green_coffee_id && opt.textContent.startsWith(outItem.name)) avail += parseFloat(outItem.quantity) || 0;
        return avail;
    }
    function refreshHint() {
        const avail = currentAvailable();
        if (avail === null) { stockHint.textContent = ''; return; }
        const qty = parseFloat(qtyInput.value) || 0;
        const over = qty > avail;
        stockHint.textContent = `${window.t ? window.t('lbl_available') : 'Available'}: ${avail.toFixed(1)} ${companySettings.weight_unit}` + (over ? ` — ${window.t ? window.t('alert_insufficient_gb').replace('\n',' ') : 'Insufficient stock!'}` : '');
        stockHint.style.color = over ? 'var(--danger)' : 'var(--text-muted)';
    }
    coffeeSelect.addEventListener('change', refreshHint);
    qtyInput.addEventListener('input', refreshHint);
    refreshHint();

    document.getElementById('modal-outbound-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const opt = coffeeSelect.selectedOptions[0];
        if (!opt || !opt.value) return;
        const coffeeId = parseInt(opt.value);
        const bean = (inventory || []).find(g => g.id === coffeeId);
        if (!bean) return;

        const date = document.getElementById('m-out-date').value;
        const quantity = parseFloat(qtyInput.value);
        const destination = document.getElementById('m-out-dest').value.trim();
        const notes = document.getElementById('m-out-notes').value.trim();

        const avail = currentAvailable();
        if (quantity > avail) {
            const proceed = await showWarningModal(
                (window.t ? window.t('msg_confirm_ship_over') : 'Shipping more than available stock. Continue anyway?'),
                true
            );
            if (!proceed) return;
        }

        // On edit, first refund whatever lots the previous version of this
        // shipment drew from, before re-consuming for the new coffee/qty —
        // mirrors js/roasting.js's refundGreenCoffeeLotsForBatch.
        if (editId) {
            await refundGreenCoffeeLotsForOutbound(editId);
        }

        // V2 Stock History: consume via green_coffee_lots (FIFO), not a
        // direct stock_kg write — stock_kg is DERIVED (trigger-summed from
        // green_coffee_lots.remaining_kg, see v2_lot_tracking_migration.sql),
        // so writing it directly here would get silently reverted the next
        // time any lot for this coffee changes, and left Outbound rows with
        // no lot to show in Stock History.
        const { draws } = await consumeGreenCoffeeLotsFifo(coffeeId, quantity);

        const record = {
            id: editId || undefined,
            green_coffee_id: coffeeId,
            date,
            code: bean.code || null,
            name: bean.name,
            origin: bean.origin || null,
            process: bean.process || null,
            quantity,
            destination,
            notes: notes || null
        };
        const { data: savedOut, error } = await saveData('green_coffee_outbound', record);
        if (error) {
            alert((window.t ? window.t('alert_save_failed').replace('{msg}', error.message) : 'Save failed: ' + error.message));
            return;
        }

        for (const d of draws) {
            await saveData('green_coffee_outbound_lots', {
                green_coffee_outbound_id: savedOut.id,
                green_coffee_lot_id: d.lotId,
                kg: d.kg
            });
        }

        modalContainer.classList.add('hidden');
        loadOutboundHistory();
        loadGreenbeanInventory();
        scheduleDashboardRefresh();
    });
}

async function deleteOutbound(deleteId) {
    if (!(await showDeleteConfirmModal('this outbound shipment'))) return;
    const { data: history } = await fetchData('green_coffee_outbound');
    const item = (history || []).find(i => i.id === deleteId);
    if (!item) return;

    // Deleting an outbound record means the beans never left — refund
    // whatever lots it drew from (V2 Stock History; same helper the edit
    // path uses) instead of writing green_coffee.stock_kg directly.
    await refundGreenCoffeeLotsForOutbound(deleteId);

    const { error } = await deleteData('green_coffee_outbound', deleteId);
    if (error) {
        alert(window.t("alert_delete_failed").replace("{msg}", error.message));
    } else {
        loadOutboundHistory();
        loadGreenbeanInventory();
        scheduleDashboardRefresh();
    }
}

// --- modal: ADD / EDIT GREENBEAN ---
async function openGreenbeanModal(id = null) {
    const { data: inventory } = await fetchData('green_coffee');
    let bean = { code: '', name: '', origin: '', process: '', stock_kg: 0.0, purchase_price_per_kg: 0, supplier: '' };
    if (id) {
        bean = inventory.find(g => g.id === id) || bean;
    }

    // Gather unique values for datalist dropdowns
    const uniqueNames = [...new Set(inventory.map(g => g.name).filter(Boolean))];
    const uniqueOrigins = [...new Set(inventory.map(g => g.origin).filter(Boolean))];
    const uniqueProcesses = [...new Set(inventory.map(g => g.process).filter(Boolean))];

    const nameOpts = uniqueNames.map(name => `<option value="${name}"></option>`).join('');
    const originOpts = uniqueOrigins.map(origin => `<option value="${origin}"></option>`).join('');
    const processOpts = uniqueProcesses.map(proc => `<option value="${proc}"></option>`).join('');

    const html = `
        <form id="modal-greenbean-form">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Coffee Name</label>
                    <input type="text" id="m-gb-name" list="gb-names-list" class="form-control" value="${bean.name}" placeholder="e.g. Ethiopia Yirgacheffe" required autocomplete="off">
                    <datalist id="gb-names-list">
                        ${nameOpts}
                    </datalist>
                </div>
                <div class="form-group">
                    <label class="form-label">Item Code</label>
                    <input type="text" id="m-gb-code" class="form-control" value="${bean.code}" placeholder="e.g. GB4" required>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Origin Country/Region</label>
                    <input type="text" id="m-gb-origin" list="gb-origins-list" class="form-control" value="${bean.origin}" placeholder="e.g. Sidama, Ethiopia" autocomplete="off">
                    <datalist id="gb-origins-list">
                        ${originOpts}
                    </datalist>
                </div>
                <div class="form-group">
                    <label class="form-label">Processing Method</label>
                    <input type="text" id="m-gb-process" list="gb-processes-list" class="form-control" value="${bean.process}" placeholder="e.g. Washed / Natural" autocomplete="off">
                    <datalist id="gb-processes-list">
                        ${processOpts}
                    </datalist>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Quantity (kg)</label>
                    <input type="number" step="0.1" id="m-gb-stock" class="form-control" value="${Number(parseFloat(bean.stock_kg || 0).toFixed(2))}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Supplier Name</label>
                    <input type="text" id="m-gb-supplier" class="form-control" value="${bean.supplier}" placeholder="e.g. Royal Coffee Corp">
                </div>
            </div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Greenbean</button>
            </div>
        </form>
    `;

    openModal(id ? 'Edit Greenbean Item' : 'Greenbean Intake', html);

    // Auto-fill form values if name matching an existing record is selected/typed
    const nameInput = document.getElementById('m-gb-name');
    nameInput.addEventListener('input', () => {
        const val = nameInput.value.trim();
        const match = inventory.find(g => g.name.toLowerCase() === val.toLowerCase());
        if (match) {
            document.getElementById('m-gb-code').value = match.code || '';
            document.getElementById('m-gb-origin').value = match.origin || '';
            document.getElementById('m-gb-process').value = match.process || '';
            document.getElementById('m-gb-supplier').value = match.supplier || '';
        }
    });

    document.getElementById('modal-greenbean-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const record = {
            id: id || undefined,
            code: document.getElementById('m-gb-code').value,
            name: nameInput.value,
            origin: document.getElementById('m-gb-origin').value,
            process: document.getElementById('m-gb-process').value,
            stock_kg: parseFloat(document.getElementById('m-gb-stock').value),
            purchase_price_per_kg: id ? bean.purchase_price_per_kg : 0.0,
            supplier: document.getElementById('m-gb-supplier').value
        };

        const { error } = await saveData('green_coffee', record);
        if (error) {
            alert(window.t("alert_save_failed").replace("{msg}", error.message));
        } else {
            modalContainer.classList.add('hidden');
            loadGreenbeanInventory();
            scheduleDashboardRefresh(); // Update stats
        }
    });
}

async function deleteGreenbean(id) {
    if (await showDeleteConfirmModal('this green coffee item')) {
        const { error } = await deleteData('green_coffee', id);
        if (error) {
            await showWarningModal(window.t("alert_delete_failed").replace("{msg}", error.message), false);
        } else {
            loadGreenbeanInventory();
            scheduleDashboardRefresh();
        }
    }
}

async function adjustGreenbeanStock(type, id, targetRoastedKg, sign = 1) {
    const [
        { data: greenbeans },
        { data: ingredients }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('blend_ingredients')
    ]);

    const requiredTotalGb = (targetRoastedKg / 0.85) * sign;

    if (type === 'Single') {
        const gb = greenbeans.find(g => g.id === id);
        if (gb) {
            gb.stock_kg = Math.max(0, parseFloat(gb.stock_kg || 0) - requiredTotalGb);
            await saveData('green_coffee', gb);
        }
    } else {
        const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === id);
        for (const ing of recipeIngs) {
            const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
            if (gb) {
                const ratio = parseFloat(ing.percentage) / 100;
                const requiredIngGb = requiredTotalGb * ratio;
                gb.stock_kg = Math.max(0, parseFloat(gb.stock_kg || 0) - requiredIngGb);
                await saveData('green_coffee', gb);
            }
        }
    }
}

// --- TAB: Code List ---
// Flat audit list of every code+coffee-name pair from green_coffee and
// blend_recipes, sorted by code. Deliberately not deduped/grouped — if a
// code is reused by more than one coffee, every one of them shows up as its
// own row (adjacent, since the list is code-sorted), which is the point:
// surfacing accidental code collisions between green beans/recipes.
let _codeListRows = [];

async function loadCodeListSection() {
    const tbody = document.getElementById('code-list-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const [{ data: greenbeans }, { data: recipes }] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('blend_recipes')
    ]);

    _codeListRows = [
        ...(greenbeans || []).filter(g => g.code).map(g => ({ code: g.code, name: g.name || '-' })),
        ...(recipes || []).filter(r => r.code).map(r => ({ code: r.code, name: r.name || '-' }))
    ].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }));

    if (_codeListRows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="2" class="text-center-muted">${window.t ? window.t('msg_no_codes') : 'No codes found.'}</td></tr>`;
        return;
    }

    tbody.innerHTML = _codeListRows.map(r => `
        <tr>
            <td class="va-middle"><code>${r.code}</code></td>
            <td class="va-middle"><strong>${r.name}</strong></td>
        </tr>
    `).join('');
}

function printCodeList() {
    const cs = companySettings || {};
    const tCode = window.t ? (window.t('col_code') || 'Code') : 'Code';
    const tName = window.t ? (window.t('col_name') || 'Coffee Name') : 'Coffee Name';
    const tTitle = window.t ? (window.t('code_list_title') || 'Coffee Code List') : 'Coffee Code List';

    const rowsHtml = _codeListRows.map(r => `
        <tr><td>${r.code}</td><td>${r.name}</td></tr>
    `).join('') || `<tr><td colspan="2" style="text-align:center; color:#999;">No codes found.</td></tr>`;

    const printContent = `<!DOCTYPE html>
<html>
<head>
    <title>${tTitle}</title>
    <style>
        @page { size: A4; margin: 14mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 12px; }
        .page { max-width: 210mm; margin: 0 auto; padding: 6px; }
        .letterhead { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 3px solid #2d5016; margin-bottom: 14px; }
        .lh-left { display: flex; align-items: center; gap: 12px; }
        .lh-logo { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; border: 1px solid #e5e5e5; }
        .lh-name { font-size: 18px; font-weight: 800; color: #2d5016; line-height: 1.2; }
        .lh-contact { font-size: 10px; color: #777; margin-top: 2px; }
        .lh-right { text-align: right; }
        .doc-title { font-size: 17px; font-weight: 800; color: #2d5016; text-transform: uppercase; letter-spacing: 0.5px; }
        table { width: 100%; border-collapse: collapse; }
        thead th { background: #2d5016; color: #fff; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; text-align: left; border: 1px solid #2d5016; }
        tbody td { padding: 6px 10px; border: 1px solid #cfcfcf; font-size: 12px; }
        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
    </style>
</head>
<body>
    <div class="page">
        <div class="letterhead">
            <div class="lh-left">
                ${cs.show_logo_in_print && cs.logo_base64 ? '<img class="lh-logo" src="' + cs.logo_base64 + '" alt="Logo">' : ''}
                <div>
                    <div class="lh-name">${cs.company_name || 'Coffee Roastery'}</div>
                    <div class="lh-contact">${cs.address ? cs.address : ''}</div>
                </div>
            </div>
            <div class="lh-right">
                <div class="doc-title">${tTitle}</div>
            </div>
        </div>
        <table>
            <thead>
                <tr><th>${tCode}</th><th>${tName}</th></tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    </div>
    <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`;

    const w = window.open('', '_blank');
    w.document.write(printContent);
    w.document.close();
}
