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
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Adjustment</button>
            </div>
        </form>
    `;

    openModal('Adjust Green Coffee Stock', html);
    window.translatePage();

    document.getElementById('modal-gb-stock-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newStock = parseFloat(document.getElementById('m-gb-stock').value) || 0;

        const record = {
            ...bean,
            name: document.getElementById('m-gb-name').value.trim(),
            code: document.getElementById('m-gb-code').value.trim(),
            origin: document.getElementById('m-gb-origin').value.trim(),
            process: document.getElementById('m-gb-process').value.trim(),
            stock_kg: newStock,
            supplier: document.getElementById('m-gb-supplier').value.trim()
        };
        const { error } = await saveData('green_coffee', record);

        if (error) {
            alert("Failed to save: " + error.message);
        } else {
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
        { data: history }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('green_coffee_intake')
    ]);

    let intakeItem = null;
    if (editId) {
        intakeItem = history.find(item => item.id === editId);
    }

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
        return `<option value="${g.id}" data-code="${g.code || ''}" data-origin="${g.origin || ''}" data-process="${g.process || ''}" data-supplier="${g.supplier || ''}" ${selected}>${g.name} — ${g.code || 'no code'} — ${stockLabel} in stock</option>`;
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
            ${editId ? '' : `
            <div class="form-group">
                <label class="form-label">Lot Stickers to Print</label>
                <input type="number" step="1" min="0" id="m-int-sticker-count" class="form-control" value="0" placeholder="How many sacks?">
                <div style="font-size:0.78rem; color:var(--text-muted); margin-top:4px;">One barcode per machine is printed on each sticker — stick one on every sack. Leave 0 to skip printing now.</div>
            </div>
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
    const stickerCountInput = document.getElementById('m-int-sticker-count');

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
        const stickerCount = stickerCountInput ? (parseInt(stickerCountInput.value) || 0) : 0;

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
                if (stickerCount > 0) {
                    await printGreenLotStickers(newLot, { code, name: targetName }, stickerCount);
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
// fields move together because nothing can have drawn from the lot yet (1B
// consumption isn't wired up); clamped at 0 as a safety floor.
async function adjustGreenCoffeeLotQuantity(lotId, deltaKg) {
    const { data: lots } = await fetchData('green_coffee_lots');
    const lot = (lots || []).find(l => l.id === lotId);
    if (!lot) return;
    const newQuantity = Math.max(0, parseFloat(lot.quantity_kg || 0) + deltaKg);
    const newRemaining = Math.max(0, parseFloat(lot.remaining_kg || 0) + deltaKg);
    const { error } = await saveData('green_coffee_lots', { id: lotId, quantity_kg: newQuantity, remaining_kg: newRemaining });
    if (error) console.error('Failed to adjust green_coffee_lots row after intake edit:', error);
}

// V2 1A: prints `stickerCount` copies of the lot's sticker — one per sack —
// each carrying the human-readable info (coffee code, arrival date, coffee
// name) plus ONE BARCODE PER MACHINE, so whichever machine ends up roasting
// that sack, the matching barcode on the sticker is the one to scan. Barcode
// payload format `RMP:Lot:{green_coffee_lots.id}:{machineId}` is parsed by
// the scan handler built in 1B.
async function printGreenLotStickers(lot, coffee, stickerCount) {
    const { data: machines } = await fetchData('machines');
    if (!machines || machines.length === 0) {
        alert('No machines configured. Please add machines in Settings first.');
        return;
    }

    let labelsHtml = '';
    for (let i = 0; i < stickerCount; i++) {
        let barcodesHtml = '';
        machines.forEach(m => {
            barcodesHtml += `
                <div style="display:inline-block; text-align:center; margin: 2px 6px;">
                    <svg class="green-lot-barcode-svg" data-value="RMP:Lot:${lot.id}:${m.id}"></svg>
                    <div style="font-size:9px;">${m.name}</div>
                </div>
            `;
        });
        labelsHtml += `
            <div class="green-lot-sticker" style="display:inline-block; text-align:center; padding:10px; margin:6px; border:1px dashed #999; page-break-inside: avoid;">
                <div style="font-weight:700; font-size:13px;">${coffee.code || coffee.name}</div>
                <div style="font-size:12px;">${coffee.name}</div>
                <div style="font-size:11px; color:#555;">${lot.arrival_date}</div>
                <div style="margin-top:6px;">${barcodesHtml}</div>
            </div>
        `;
    }

    const printWin = window.open('', '_blank', 'width=900,height=700');
    if (!printWin) {
        alert('Could not open the print window — please allow pop-ups for this site and try again.');
        return;
    }
    printWin.document.write(`
        <html><head><title>Green Lot Stickers</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 10px; }
            @media print { body { margin: 0; } }
        </style></head><body>
        ${labelsHtml}
        <script>
            document.querySelectorAll('.green-lot-barcode-svg').forEach(el => {
                JsBarcode(el, el.dataset.value, { format: 'CODE128', width: 1.3, height: 35, displayValue: false, margin: 2 });
            });
            setTimeout(() => { window.print(); }, 500);
        <\/script>
        </body></html>
    `);
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

        // On edit, first restore the previously-shipped qty to its old bean so
        // the net stock change reflects only the new values.
        if (editId && outItem) {
            const oldBean = (inventory || []).find(g =>
                (outItem.green_coffee_id && g.id === outItem.green_coffee_id) ||
                (!outItem.green_coffee_id && g.name === outItem.name && g.code === outItem.code)
            );
            if (oldBean) {
                oldBean.stock_kg = parseFloat(oldBean.stock_kg || 0) + parseFloat(outItem.quantity || 0);
                await saveData('green_coffee', oldBean);
            }
        }

        // Deduct from the (possibly restored) chosen bean.
        const freshBean = (inventory || []).find(g => g.id === coffeeId) || bean;
        freshBean.stock_kg = Math.max(0, parseFloat(freshBean.stock_kg || 0) - quantity);
        await saveData('green_coffee', freshBean);

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
        const { error } = await saveData('green_coffee_outbound', record);
        if (error) {
            alert((window.t ? window.t('alert_save_failed').replace('{msg}', error.message) : 'Save failed: ' + error.message));
            return;
        }

        modalContainer.classList.add('hidden');
        loadOutboundHistory();
        loadGreenbeanInventory();
        scheduleDashboardRefresh();
    });
}

async function deleteOutbound(deleteId) {
    if (!(await showDeleteConfirmModal('this outbound shipment'))) return;
    const [
        { data: history },
        { data: inventory }
    ] = await Promise.all([
        fetchData('green_coffee_outbound'),
        fetchData('green_coffee')
    ]);
    const item = (history || []).find(i => i.id === deleteId);
    if (!item) return;

    // Deleting an outbound record means the beans never left — add the qty
    // back to the matching inventory row.
    const match = (inventory || []).find(g =>
        (item.green_coffee_id && g.id === item.green_coffee_id) ||
        (!item.green_coffee_id && g.name === item.name && g.code === item.code)
    );
    if (match) {
        match.stock_kg = parseFloat(match.stock_kg || 0) + parseFloat(item.quantity || 0);
        await saveData('green_coffee', match);
    }

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
