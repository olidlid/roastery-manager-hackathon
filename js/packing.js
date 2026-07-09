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

    // Autofill date field
    const packingDateEl = document.getElementById('packing-date');
    if (packingDateEl && !packingDateEl.value) {
        packingDateEl.value = new Date().toISOString().split('T')[0];
    }

    const [
        { data: bulkList },
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: packagingSizes }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('packaging_sizes')
    ]);
    
    const rowsContainer = document.getElementById('packing-sheet-rows');
    if (!rowsContainer) return;
    
    // Clear and rebuild rows
    rowsContainer.innerHTML = '';
    
    addPackingRow(bulkList, greenbeans, recipes, machines, packagingSizes);
    
    // Wire up Add Row button
    const btnAdd = document.getElementById('btn-add-packing-sheet-row');
    if (btnAdd) {
        btnAdd.onclick = (e) => {
            e.preventDefault();
            const currentRows = document.querySelectorAll('.packing-sheet-row').length;
            if (currentRows >= 4) {
                alert(window.t ? window.t("msg_max_four_coffee") : "Maximum 4 coffee boxes allowed at a time.");
                return;
            }
            addPackingRow(bulkList, greenbeans, recipes, machines, packagingSizes);
        };
    }
    
    // Wire up Form Submission
    const form = document.getElementById('packing-sheet-form');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            await submitPackingSheet();
        };
    }
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
        { data: packedGoods },
        { data: roastBatches },
        { data: machines },
        { data: customers }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('machines'),
        fetchData('customers')
    ]);
    
    const tbody = document.getElementById('packing-requests-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    // Filter only orders in "Preparing" status
    const preparingOrders = (orders || []).filter(o => o.status === 'Preparing');
    
    if (preparingOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center-muted">${window.t ? window.t("msg_no_preparing") : "No preparing orders found."}</td></tr>`;
        return;
    }
    
    // Build a stock lookup map: "Type-CoffeeId-SizeG" -> total stock
    const batchMap = new Map();
    (roastBatches || []).forEach(b => batchMap.set(b.id, b));
    
    const stockMap = new Map();
    (packedGoods || []).forEach(p => {
        if (p.roast_batch_id) {
            const batch = batchMap.get(p.roast_batch_id);
            if (batch) {
                const cId = batch.coffee_type === 'Single' ? batch.single_coffee_id : batch.blend_recipe_id;
                const key = `${batch.coffee_type}-${cId}-${p.bag_size_g}`;
                stockMap.set(key, (stockMap.get(key) || 0) + (parseInt(p.quantity) || 0));
            }
        }
        if (!p.roast_batch_id && p.custom_coffee_name) {
            const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
            const matchGb = (greenbeans || []).find(g => g.name === cleanName);
            if (matchGb) {
                const key = `Single-${matchGb.id}-${p.bag_size_g}`;
                stockMap.set(key, (stockMap.get(key) || 0) + (parseInt(p.quantity) || 0));
            } else {
                const matchRec = (recipes || []).find(r => r.name === cleanName);
                if (matchRec) {
                    const key = `Blend-${matchRec.id}-${p.bag_size_g}`;
                    stockMap.set(key, (stockMap.get(key) || 0) + (parseInt(p.quantity) || 0));
                }
            }
        }
    });
    
    // Sort by order_date descending
    preparingOrders.sort((a, b) => new Date(b.order_date) - new Date(a.order_date) || b.id - a.id);
    const limitedPreparingOrders = preparingOrders.slice(0, 50);
    
    let tbodyHtml = '';
    for (const order of limitedPreparingOrders) {
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);
        
        // Check if ALL items in this order are fully prepared
        const allItemsReady = items.length > 0 && items.every(i => {
            const req = parseInt(i.quantity_requested) || 0;
            const prep = parseInt(i.quantity_prepared) || 0;
            return prep >= req;
        });
        
        let itemsHtml = `<div style="display: flex; flex-direction: column; gap: 8px;">`;
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
            
            // Machine info
            const itemMachine = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
            const machineTag = itemMachine ? `<span style="font-size:0.72rem; color:#0891b2; font-weight:600; background:rgba(6,182,212,0.1); padding:1px 6px; border-radius:4px; margin-left:6px;">${itemMachine.name}</span>` : '';
            
            const totalRequested = parseInt(item.quantity_requested) || 0;
            const alreadyPrepared = parseInt(item.quantity_prepared) || 0;
            const pendingPack = Math.max(0, totalRequested - alreadyPrepared);
            const isCompleted = alreadyPrepared >= totalRequested;
            
            // Get current packed stock for this coffee+size
            const stockKey = `${type}-${coffeeId}-${item.bag_size_g}`;
            const currentStock = stockMap.get(stockKey) || 0;
            
            // Max the user can input = min(pendingPack, currentStock)
            const maxReady = Math.min(pendingPack, currentStock);
            
            // If ALL items ready, hide individual Ready buttons — Dispatch button shown at order level
            let packHtml = '';
            if (allItemsReady) {
                packHtml = `
                    <span style="color: var(--success); font-weight: bold; font-size: 0.8rem; display: flex; align-items: center; gap: 4px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        Completed
                    </span>
                `;
            } else if (isCompleted) {
                packHtml = `
                    <span style="color: var(--success); font-weight: bold; font-size: 0.8rem; display: flex; align-items: center; gap: 4px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        Completed
                    </span>
                `;
            } else {
                packHtml = `
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <input type="number" class="form-control inp-prepared" min="0" max="${maxReady}" data-max="${maxReady}" value="0" style="width: 80px; padding: 4px 8px;" placeholder="0">
                        <button class="btn btn-primary btn-sm btn-mark-ready" data-id="${item.id}" data-order="${order.id}" ${maxReady === 0 ? 'disabled style="opacity:0.5; pointer-events:none;"' : ''}>Ready</button>
                    </div>
                `;
            }
            
            // Build info line
            let infoLine = `Requested: <strong>${totalRequested}</strong> | From Stock: <strong>${currentStock}</strong>`;
            if (alreadyPrepared > 0 && !isCompleted) {
                infoLine += ` | Prepared: <strong style="color: var(--primary);">${alreadyPrepared}</strong> | Pending Pack: <strong style="color: var(--danger);">${pendingPack}</strong>`;
            } else if (!isCompleted) {
                infoLine += ` | Pending Pack: <strong style="color: var(--danger);">${pendingPack}</strong>`;
            } else {
                infoLine += ` | Prepared: <strong style="color: var(--success);">${alreadyPrepared}</strong>`;
            }
            
            itemsHtml += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: ${allItemsReady ? 'rgba(16,185,129,0.06)' : 'rgba(0,0,0,0.02)'}; padding: 8px; border-radius: 4px; border: 1px solid ${allItemsReady ? 'rgba(16,185,129,0.25)' : 'var(--border-color)'};">
                    <div style="font-size: 0.85rem;">
                        <strong>${coffeeName}</strong> - ${item.bag_size_g}g${machineTag}<br/>
                        <span style="color: var(--text-secondary); font-size: 0.75rem;">
                            ${infoLine}
                        </span>
                    </div>
                    <div>
                        ${packHtml}
                    </div>
                </div>
            `;
        }
        itemsHtml += `</div>`;
        
        // Dispatch button (shown when ALL items are ready)
        const dispatchBtnHtml = allItemsReady ? `
            <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
                <button class="btn btn-success btn-sm btn-dispatch-order" data-order="${order.id}" style="padding: 6px 20px; font-weight: 700; font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                    Dispatch
                </button>
            </div>
        ` : '';
        
        tbodyHtml += `
        <tr>
            <td class="va-top-pt-3">
                ${order.order_date}<br/>
                <code>${order.order_number || '#ORD-'+order.id}</code>
            </td>
            <td class="va-top-pt-3">
                <strong>${order.sales_name}</strong>
                ${(() => { const cust = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null; return cust ? `<br/><span class="text-secondary-xs">👤 ${cust.name}</span>` : ''; })()}
            </td>
            <td class="va-top-pt-3">${itemsHtml}${dispatchBtnHtml}</td>
            <td class="va-top-pt-3">
                <button class="btn btn-secondary btn-sm btn-print-order" data-id="${order.id}" style="display:inline-flex; align-items:center; gap:4px; white-space:nowrap;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    Print Order
                </button>
            </td>
        </tr>
        `;
    }
    tbody.innerHTML = tbodyHtml;
    
    // Clamp input value in real-time
    tbody.addEventListener('input', function(e) {
        const inp = e.target.closest('.inp-prepared');
        if (inp) {
            const max = parseInt(inp.getAttribute('data-max')) || 0;
            let val = parseInt(inp.value) || 0;
            if (val < 0) { inp.value = 0; }
            if (val > max) { inp.value = max; }
        }
    });
    
    // EVENT DELEGATION
    tbody.onclick = async function(e) {
        // Handle Ready button
        const btnReady = e.target.closest('.btn-mark-ready');
        if (btnReady) {
            const itemId = parseInt(btnReady.getAttribute('data-id'));
            const orderId = parseInt(btnReady.getAttribute('data-order'));
            const inp = btnReady.closest('div').querySelector('.inp-prepared');
            const max = parseInt(inp.getAttribute('data-max')) || 0;
            let qtyToReady = parseInt(inp.value) || 0;
            
            if (qtyToReady <= 0) {
                await showWarningModal('Please enter a quantity greater than 0.', false);
                return;
            }
            
            // Enforce max limit
            if (qtyToReady > max) {
                qtyToReady = max;
                inp.value = max;
            }
            
            await markOrderItemReady(orderId, itemId, qtyToReady);
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

async function markOrderItemReady(orderId, itemId, qtyToReady) {
    const [
        { data: orderItems },
        { data: packedGoods },
        { data: greenbeans },
        { data: recipes },
        { data: roastBatches }
    ] = await Promise.all([
        fetchData('request_order_items'),
        fetchData('packed_coffee'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('roast_batches')
    ]);
    
    const item = orderItems.find(i => i.id === itemId);
    if (!item) return;
    
    const totalRequested = parseInt(item.quantity_requested) || 0;
    const alreadyPrepared = parseInt(item.quantity_prepared) || 0;
    const pendingPack = totalRequested - alreadyPrepared;
    
    // Clamp qty: cannot exceed pending
    const actualQty = Math.min(qtyToReady, pendingPack);
    if (actualQty <= 0) return;
    
    // Deduct from packed_coffee stock
    const type = item.coffee_type;
    const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
    
    const matchingPacked = (packedGoods || []).filter(p => {
        if (p.roast_batch_id) {
            const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
            if (!batch) return false;
            return batch.coffee_type === type && (type === 'Single' ? batch.single_coffee_id === coffeeId : batch.blend_recipe_id === coffeeId);
        }
        if (p.custom_coffee_name) {
            const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
            if (type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === coffeeId);
                return gb && gb.name === cleanName;
            } else {
                const rec = (recipes || []).find(r => r.id === coffeeId);
                return rec && rec.name === cleanName;
            }
        }
        return false;
    });
    const szItems = matchingPacked.filter(p => parseInt(p.bag_size_g) === parseInt(item.bag_size_g));
    
    let remainingDeduct = actualQty;
    for (const p of szItems) {
        if (remainingDeduct <= 0) break;
        let avail = parseInt(p.quantity) || 0;
        if (avail > 0) {
            let take = Math.min(avail, remainingDeduct);
            p.quantity = avail - take;
            remainingDeduct -= take;
            await saveData('packed_coffee', p);
        }
    }
    
    // Update item: increment prepared, update status
    const newPrepared = alreadyPrepared + actualQty;
    item.quantity_prepared = newPrepared;
    
    if (newPrepared >= totalRequested) {
        item.item_status = 'Ready for Handover';
    } else {
        item.item_status = 'Packing';
    }
    const { error: itemErr } = await saveData('request_order_items', item);
    if (itemErr) {
        alert("Failed to update item status: " + itemErr.message);
        return;
    }

    loadPackingRequestsSection();
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
        
        const sizeLabel = sizeG >= 1000 ? `${sizeG/1000}kg` : `${sizeG}g`;
        itemsTableRows += `
            <tr>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${idx + 1}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; font-weight:600;">${coffeeName}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${machName}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${sizeLabel}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${qty}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;"></td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:left;"><span style="display:inline-block; width:13px; height:13px; border:1.5px solid #555; border-radius:2px; vertical-align:middle; margin-right:6px;"></span> Completed</td>
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

function addPackingRow(bulkList, greenbeans, recipes, machines, packagingSizes, selectedCoffeeId = null) {
    const rowsContainer = document.getElementById('packing-sheet-rows');
    if (!rowsContainer) return;
    
    // If two entries share the exact same name (e.g. a duplicate greenbean
    // record created by mistake), the dropdown alone can't tell them apart —
    // one may have all the roast/bulk-stock history and the other none, so
    // picking the wrong one silently shows 0 stock. Append the short code to
    // disambiguate only when a name collision actually exists.
    const singleNameCounts = {};
    (greenbeans || []).forEach(gb => { singleNameCounts[gb.name] = (singleNameCounts[gb.name] || 0) + 1; });
    const blendNameCounts = {};
    (recipes || []).forEach(r => { blendNameCounts[r.name] = (blendNameCounts[r.name] || 0) + 1; });

    let singleHtml = '';
    (greenbeans || []).forEach(gb => {
        const val = `Single-${gb.id}`;
        const label = singleNameCounts[gb.name] > 1 && gb.code ? `${gb.name} (${gb.code})` : gb.name;
        singleHtml += `
            <option value="${val}" ${selectedCoffeeId && selectedCoffeeId.toString() === val ? 'selected' : ''}>
                ${label}
            </option>
        `;
    });

    let blendHtml = '';
    (recipes || []).forEach(r => {
        const val = `Blend-${r.id}`;
        const label = blendNameCounts[r.name] > 1 && r.code ? `${r.name} (${r.code})` : r.name;
        blendHtml += `
            <option value="${val}" ${selectedCoffeeId && selectedCoffeeId.toString() === val ? 'selected' : ''}>
                ${label}
            </option>
        `;
    });

    const optionsHtml = `
        <optgroup label="Single Origin">
            ${singleHtml}
        </optgroup>
        <optgroup label="Blend Recipes">
            ${blendHtml}
        </optgroup>
    `;
    
    const rowId = 'pack-row-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    
    const rowDiv = document.createElement('div');
    rowDiv.id = rowId;
    rowDiv.className = 'packing-sheet-row';
    rowDiv.style.cssText = 'background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;';
    
    rowDiv.innerHTML = `
        <div style="display: flex; gap: 10px; align-items: flex-end; margin-bottom: 8px;">
            <div class="form-group flex-1-mb-0" >
                <label class="form-label" style="font-size: 0.8rem; margin-bottom: 2px; font-weight: 600;" data-i18n="col_p_name">${window.t ? window.t("col_p_name") : "Coffee Name"}</label>
                <select class="form-control pack-coffee-select" style="width: 100%; padding: 4px 8px; height: 32px;" required>
                    ${optionsHtml}
                </select>
            </div>
            <button type="button" class="btn btn-danger btn-sm btn-remove-pack-row" style="padding: 4px 10px; height: 32px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </div>
        <div class="machine-rows-container" style="display: flex; flex-direction: column; gap: 6px;"></div>
    `;
    
    rowsContainer.appendChild(rowDiv);
    
    // Delete handler
    const btnDel = rowDiv.querySelector('.btn-remove-pack-row');
    btnDel.onclick = () => {
        if (rowsContainer.children.length > 1) {
            rowDiv.remove();
            validatePackingStock();
        } else {
            alert(window.t ? window.t("msg_min_one_coffee") : "Minimum one coffee required.");
        }
    };
    
    const select = rowDiv.querySelector('.pack-coffee-select');
    const mContainer = rowDiv.querySelector('.machine-rows-container');
    
    const activeSizes = (packagingSizes || []).filter(s => s.is_visible).sort((a,b) => a.gram - b.gram);
    
    const renderMachineRows = () => {
        mContainer.innerHTML = '';
        const coffeeKey = select.value;
        const [type, idStr] = coffeeKey.split('-');
        const id = parseInt(idStr);
        
        const matchedBulks = (bulkList || []).filter(b => b.coffee_type === type && (type === 'Single' ? b.single_coffee_id === id : b.blend_recipe_id === id));
        
        if (matchedBulks.length === 0) {
            let machineOptions = '<option value="0">Select Machine...</option>';
            (machines || []).forEach(m => {
                machineOptions += `<option value="${m.id}">${m.name}</option>`;
            });

            const subRow = document.createElement('div');
            subRow.className = 'machine-pack-subrow';
            subRow.dataset.bulkId = '0';
            subRow.dataset.machineId = '0';
            subRow.dataset.avail = '0';
            subRow.style.cssText = 'background: rgba(0,0,0,0.02); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px;';
            
            let sizeInputsHtml = '';
            activeSizes.forEach(s => {
                sizeInputsHtml += `
                    <div style="flex:1; min-width:70px;">
                        <label style="font-size:0.7rem; color:var(--text-secondary); margin-bottom:2px; display:block;">${s.label}</label>
                        <input type="number" class="form-control pack-qty-dynamic" data-gram="${s.gram}" data-name="${s.label}" min="0" value="0" style="width:100%; padding: 2px 6px; height: 28px; font-size: 0.85rem;">
                    </div>
                `;
            });
            
            subRow.innerHTML = `
                <div style="display:flex; gap: 10px; align-items:center; margin-bottom:4px;">
                    <select class="form-control pack-machine-select" style="font-size: 0.8rem; padding: 2px 6px; height: 28px; width: 180px; font-weight: 600;">
                        ${machineOptions}
                    </select>
                    <span style="color:var(--text-secondary); font-size:0.8rem;">(Stock: 0.00 kg)</span>
                </div>
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    ${sizeInputsHtml}
                </div>
                <div class="warning-bubble hidden" style="width: 100%; background: rgba(234, 88, 12, 0.15); border: 1px solid #ea580c; color: #ea580c; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; margin-top: 6px; display: flex; align-items: center; gap: 6px; font-weight: 500;"></div>
            `;
            
            subRow.querySelector('.pack-machine-select').onchange = (e) => {
                subRow.dataset.machineId = e.target.value;
            };
            
            subRow.querySelectorAll('input').forEach(inp => {
                inp.oninput = () => validatePackingStock();
            });
            mContainer.appendChild(subRow);
            validatePackingStock();
            return;
        }
        
        if (activeSizes.length === 0) {
            mContainer.innerHTML = `<div style="font-size:0.85rem; color:var(--danger);">No packaging sizes configured. Please add sizes in Settings.</div>`;
            return;
        }
        
        matchedBulks.forEach(bulkItem => {
            const m = (machines || []).find(mac => mac.id === bulkItem.machine_id);
            const machineName = m ? m.name : 'Unknown Machine';
            const stock = parseFloat(bulkItem.bulk_available) || 0;
            
            const subRow = document.createElement('div');
            subRow.className = 'machine-pack-subrow';
            subRow.dataset.bulkId = bulkItem.id;
            subRow.dataset.machineId = bulkItem.machine_id || 0;
            subRow.dataset.avail = stock;
            subRow.style.cssText = 'background: rgba(0,0,0,0.02); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px;';
            
            let sizeInputsHtml = '';
            activeSizes.forEach(s => {
                sizeInputsHtml += `
                    <div style="flex:1; min-width:70px;">
                        <label style="font-size:0.7rem; color:var(--text-secondary); margin-bottom:2px; display:block;">${s.label}</label>
                        <input type="number" class="form-control pack-qty-dynamic" data-gram="${s.gram}" data-name="${s.label}" min="0" value="0" style="width:100%; padding: 2px 6px; height: 28px; font-size: 0.85rem;">
                    </div>
                `;
            });
            
            subRow.innerHTML = `
                <div style="font-size:0.8rem; font-weight:600; margin-bottom:4px; color:var(--text-color);">${machineName} <span style="color:var(--text-secondary); font-weight:normal;">(Stock: ${stock.toFixed(2)} kg)</span></div>
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    ${sizeInputsHtml}
                </div>
                <div class="warning-bubble hidden" style="width: 100%; background: rgba(234, 88, 12, 0.15); border: 1px solid #ea580c; color: #ea580c; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; margin-top: 6px; display: flex; align-items: center; gap: 6px; font-weight: 500;"></div>
            `;
            
            subRow.querySelectorAll('input').forEach(inp => {
                inp.oninput = () => validatePackingStock();
            });
            mContainer.appendChild(subRow);
        });
        validatePackingStock();
    };
    
    select.onchange = renderMachineRows;
    renderMachineRows();
}

function validatePackingStock() {
    const subrows = document.querySelectorAll('.machine-pack-subrow');
    subrows.forEach(sub => {
        const avail = parseFloat(sub.dataset.avail) || 0;
        
        let totalKg = 0;
        sub.querySelectorAll('.pack-qty-dynamic').forEach(inp => {
            const gram = parseFloat(inp.getAttribute('data-gram')) || 0;
            const qty = parseInt(inp.value) || 0;
            totalKg += (gram * qty) / 1000;
        });
        
        const bubble = sub.querySelector('.warning-bubble');
        if (totalKg > avail) {
            bubble.classList.remove('hidden');
            let template = window.t ? window.t("msg_warn_exceed") : "Required quantity {totalNeeded} kg exceeds available stock {avail} kg.";
            if (!template) template = "Required quantity {totalNeeded} kg exceeds available stock {avail} kg.";
            template = template.replace("{totalNeeded}", totalKg.toFixed(2)).replace("{avail}", avail.toFixed(2));
            bubble.innerHTML = template;
        } else {
            bubble.classList.add('hidden');
        }
    });
}

async function submitPackingSheet() {
    const [
        { data: bulkList },
        { data: packedList },
        { data: greenbeans },
        { data: recipes }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('packed_coffee'),
        fetchData('green_coffee'),
        fetchData('blend_recipes')
    ]);
    
    const subrows = document.querySelectorAll('.machine-pack-subrow');
    if (subrows.length === 0) return;
    
    let hasExceeded = false;
    let exceededInfo = [];
    
    const additions = [];
    
    subrows.forEach(sub => {
        const bulkId = parseInt(sub.dataset.bulkId);
        const machineId = parseInt(sub.dataset.machineId);
        const avail = parseFloat(sub.dataset.avail) || 0;
        
        let totalKg = 0;
        const subAdditions = [];
        
        sub.querySelectorAll('.pack-qty-dynamic').forEach(inp => {
            const gram = parseFloat(inp.getAttribute('data-gram')) || 0;
            const qty = parseInt(inp.value) || 0;
            const kg = (gram * qty) / 1000;
            totalKg += kg;
            
            if (qty > 0) {
                subAdditions.push({ sizeG: gram, qty: qty, totalKg: kg, label: inp.getAttribute('data-name') });
            }
        });
        
        if (totalKg === 0) return;
        
        const row = sub.closest('.packing-sheet-row');
        const coffeeKey = row.querySelector('.pack-coffee-select').value;
        const [type, idStr] = coffeeKey.split('-');
        const id = parseInt(idStr);
        
        let coffeeName = '';
        if (type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === id);
            coffeeName = gb ? gb.name : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === id);
            coffeeName = r ? r.name : 'Blend Recipe';
        }
        
        if (totalKg > avail) {
            hasExceeded = true;
            exceededInfo.push(`- ${coffeeName}: ${totalKg.toFixed(2)} kg req, ${avail.toFixed(2)} kg avail.`);
        }
        
        subAdditions.forEach(sa => {
            additions.push({ bulkId, machineId, coffeeName, type, id, sizeG: sa.sizeG, qty: sa.qty, totalKg: sa.totalKg, label: sa.label });
        });
    });
    
    if (additions.length === 0) return;
    
    const invalidAdd = additions.find(a => a.machineId === 0);
    if (invalidAdd) {
        alert("Please select a Machine for " + invalidAdd.coffeeName);
        return;
    }
    
    if (hasExceeded) {
        let confirmText = window.t ? window.t("msg_confirm_exceed") : "Warning: The following quantities exceed available stock:\n{info}\n\nDo you want to proceed anyway?";
        if (!confirmText) confirmText = "Warning: The following quantities exceed available stock:\n{info}\n\nDo you want to proceed anyway?";
        confirmText = confirmText.replace("{info}", exceededInfo.join('\n'));
        const proceed = await showWarningModal(confirmText);
        if (!proceed) return;
    }
    
    try {
        const bulkUpdates = {};
        
        additions.forEach(add => {
            if (add.bulkId && add.bulkId !== 0 && !isNaN(add.bulkId)) {
                if (!bulkUpdates[add.bulkId]) bulkUpdates[add.bulkId] = 0;
                bulkUpdates[add.bulkId] += add.totalKg;
            }
        });
        
        for (const bulkId in bulkUpdates) {
            const bulkItem = (bulkList || []).find(b => b.id === parseInt(bulkId));
            if (bulkItem) {
                bulkItem.bulk_available = parseFloat(bulkItem.bulk_available) - bulkUpdates[bulkId];
                if (bulkItem.bulk_available < 0) bulkItem.bulk_available = 0;
                await saveData('bulk_roasted_coffee', bulkItem);
            }
        }
        
        for (const add of additions) {
            const existing = (packedList || []).find(p => 
                !p.roast_batch_id && 
                p.custom_coffee_name === add.coffeeName && 
                parseInt(p.bag_size_g) === parseInt(add.sizeG) &&
                parseInt(p.machine_id) === parseInt(add.machineId)
            );
            
            if (existing) {
                existing.quantity = parseInt(existing.quantity) + add.qty;
                await saveData('packed_coffee', existing);
            } else {
                const newPacked = {
                    roast_batch_id: null,
                    machine_id: add.machineId,
                    custom_coffee_name: add.coffeeName,
                    bag_size_g: add.sizeG,
                    quantity: add.qty,
                    selling_price: 12.00
                };
                await saveData('packed_coffee', newPacked);
            }
        }
        
        // Save packing records for history (match production schema)
        const packingDate = document.getElementById('packing-date')?.value || new Date().toISOString().split('T')[0];
        for (const add of additions) {
            await saveData('packing_records', {
                date: packingDate,
                pack_date: packingDate,
                source_type: add.type,
                source_id: add.id,
                coffee_name: `${add.coffeeName} (${add.type})`,
                machine_id: add.machineId,
                bag_size_g: add.sizeG,
                size_g: add.sizeG,
                quantity: add.qty,
                status: 'Completed'
            });
        }
        
        await showWarningModal(window.t ? window.t("msg_pack_saved") : "Packing saved successfully.", false);
        
        const rowsContainer = document.getElementById('packing-sheet-rows');
        if (rowsContainer) rowsContainer.innerHTML = '';
        
        await loadPackingSection();
        scheduleDashboardRefresh();
    } catch (err) {
        console.error('Packing submit error:', err);
        alert('Error during packing save: ' + err.message);
    }
}

// Package bulk coffee batch modal
async function openPackingModal(bulkId) {
    const { data: bulkList } = await fetchData('bulk_roasted_coffee');
    const record = bulkList.find(b => b.id === bulkId);
    if (!record) return;

    const html = `
        <form id="modal-packing-form">
            <div class="form-group">
                <label class="form-label">Source Roasted Coffee</label>
                <input type="text" class="form-control" value="${record.coffee_name} (Available Bulk: ${parseFloat(record.bulk_available).toFixed(2)} kg)" readonly>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Bag Size / Retail Weight</label>
                    <select id="m-pack-size" class="form-control">
                        <option value="250" selected>250 grams (g)</option>
                        <option value="500">500 grams (g)</option>
                        <option value="1000">1000 grams / 1kg (g)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Bags to Produce</label>
                    <input type="number" id="m-pack-qty" class="form-control" value="10" min="1" required>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">Calculated Bulk Weight Needed</label>
                <input type="text" id="m-pack-calc-weight" class="form-control" style="background:var(--border); font-weight:700;" readonly value="2.5 kg">
            </div>

            <div class="form-group">
                <label class="form-label">Retail Selling Price per Bag</label>
                <input type="number" step="0.01" id="m-pack-price" class="form-control" value="12.00">
            </div>

            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Run Packaging</button>
            </div>
        </form>
    `;

    openModal('Run Retail Packaging Line', html);

    const sizeSelect = document.getElementById('m-pack-size');
    const qtyInput = document.getElementById('m-pack-qty');
    const calcWeight = document.getElementById('m-pack-calc-weight');

    function updateCalc() {
        const size = parseInt(sizeSelect.value) || 250;
        const qty = parseInt(qtyInput.value) || 0;
        const kgNeeded = (size * qty) / 1000;
        calcWeight.value = `${kgNeeded.toFixed(2)} kg`;
    }
    sizeSelect.addEventListener('change', updateCalc);
    qtyInput.addEventListener('input', updateCalc);
    updateCalc();

    document.getElementById('modal-packing-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const size = parseInt(sizeSelect.value);
        const qty = parseInt(qtyInput.value);
        const weightNeeded = (size * qty) / 1000;

        // 1. Verify enough bulk stock remaining
        if (parseFloat(record.bulk_available) < weightNeeded) {
            alert(window.t("alert_insufficient_bulk").replace("{avail}", parseFloat(record.bulk_available).toFixed(2)).replace("{req}", weightNeeded));
            return;
        }

        // 2. Add to packed_coffee inventory table
        const { data: existingPacked } = await fetchData('packed_coffee');
        const duplicate = existingPacked.find(p => 
            !p.roast_batch_id && 
            p.custom_coffee_name === record.coffee_name && 
            p.bag_size_g === size
        );

        if (duplicate) {
            duplicate.quantity = parseInt(duplicate.quantity) + qty;
            await saveData('packed_coffee', duplicate);
        } else {
            const newPacked = {
                roast_batch_id: null,
                custom_coffee_name: record.coffee_name,
                bag_size_g: size,
                quantity: qty,
                selling_price: parseFloat(document.getElementById('m-pack-price').value) || 12.00
            };
            await saveData('packed_coffee', newPacked);
        }

        // 3. Deduct from bulk stock
        record.bulk_available = parseFloat(record.bulk_available) - weightNeeded;
        await saveData('bulk_roasted_coffee', record);

        modalContainer.classList.add('hidden');
        loadPackingSection();
        scheduleDashboardRefresh();
    });
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

// Manual outside packaging (outside roasted bean source)
const btnCustomPack = document.getElementById('btn-custom-pack');
if (btnCustomPack) {
    btnCustomPack.addEventListener('click', async () => {
    const html = `
        <form id="modal-custom-pack-form">
            <div class="form-group">
                <label class="form-label">Coffee Name</label>
                <input type="text" id="m-cp-name" class="form-control" placeholder="e.g. Guest Roast Coffee" required>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Bag Size / Retail Weight</label>
                    <select id="m-cp-size" class="form-control">
                        <option value="250" selected>250 g</option>
                        <option value="500">500 g</option>
                        <option value="1000">1kg</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Inventory Quantity (Bags)</label>
                    <input type="number" id="m-cp-qty" class="form-control" value="20" min="1" required>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">Retail Selling Price per Bag</label>
                <input type="number" step="0.01" id="m-cp-price" class="form-control" value="15.00">
            </div>

            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Add Custom Stock</button>
            </div>
        </form>
    `;

    openModal('Import Custom Retail Stock', html);

    document.getElementById('modal-custom-pack-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const record = {
            roast_batch_id: null, // manual
            custom_coffee_name: document.getElementById('m-cp-name').value,
            bag_size_g: parseInt(document.getElementById('m-cp-size').value),
            quantity: parseInt(document.getElementById('m-cp-qty').value),
            selling_price: parseFloat(document.getElementById('m-cp-price').value) || 15.00
        };

        await saveData('packed_coffee', record);
        modalContainer.classList.add('hidden');
        loadPackingSection();
        scheduleDashboardRefresh();
    });
    });
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
        if (item.roast_batch_id) {
            const b = batches.find(x => x.id === item.roast_batch_id);
            if (b) {
                if (b.coffee_type === 'Single') {
                    const gb = greenbeans.find(g => g.id === b.single_coffee_id);
                    if (gb) coffeeName = gb.name;
                } else {
                    const r = recipes.find(rec => rec.id === b.blend_recipe_id);
                    if (r) coffeeName = r.name;
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
        
        return { ...item, coffeeName };
    });

    // Group by coffee name and then machine
    const grouped = {};
    
    // First, ensure ALL green beans and blend recipes are present in the grouped object
    (greenbeans || []).forEach(gb => {
        if (!grouped[gb.name]) grouped[gb.name] = { coffeeName: gb.name, machines: {} };
    });
    (recipes || []).forEach(r => {
        if (!grouped[r.name]) grouped[r.name] = { coffeeName: r.name, machines: {} };
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
        
        if (!grouped[groupKey]) grouped[groupKey] = { coffeeName: item.coffeeName, machines: {} };
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

    // Update thead
    const theadRow = document.getElementById('packed-coffee-stock-table-head');
    if (theadRow) {
        let thHtml = `<th data-i18n="col_name">${window.t ? window.t('col_name') : 'Coffee Name'}</th>`;
        activeMachinesList.forEach(m => {
            thHtml += `<th class="text-center">${m.name}</th>`;
        });
        thHtml += `<th data-i18n="col_action">${window.t ? window.t('col_action') : 'Action'}</th>`;
        theadRow.innerHTML = thHtml;
    }

    if (Object.keys(grouped).length === 0) {
        tbody.innerHTML = `<tr><td colspan="${activeMachinesList.length + 2}" class="text-center-muted">${window.t ? window.t("msg_no_packed_avail") : 'No packed coffee available.'}</td></tr>`;
        return;
    }

    Object.values(grouped).sort((a,b) => a.coffeeName.localeCompare(b.coffeeName)).forEach(group => {
        const tr = document.createElement('tr');
        
        let html = `<td style="vertical-align: middle; padding: 12px 20px;"><strong>${group.coffeeName}</strong></td>`;
        
        activeMachinesList.forEach(mach => {
            const machData = group.machines[mach.name] || { sizes: {} };
            
            const sizesHtml = activeSizes.map((sz, idx) => {
                const qty = machData.sizes[sz.gram] ? machData.sizes[sz.gram].qty : 0;
                const minSizes = companySettings.min_stock_packed_sizes || {};
                const minQty = minSizes[sz.gram] || 0;
                const isLow = qty < minQty;
                const colorStyle = isLow ? 'color:var(--danger);' : 'color:var(--text-secondary);';
                
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: ${idx < activeSizes.length - 1 ? '1px dashed var(--border)' : 'none'};">
                        <span style="background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:6px; padding:2px 6px; font-size:0.75rem; font-weight:700;">${sz.gram}g</span>
                        <span style="font-size:0.8rem; font-weight:600; ${colorStyle}">${qty} ${window.t ? window.t("lbl_bags") : 'bags'}</span>
                    </div>
                `;
            }).join('');
            
            html += `<td style="vertical-align: top; padding: 8px 12px; min-width: 140px;">${sizesHtml}</td>`;
        });
        
        html += `
            <td style="vertical-align: middle; padding: 12px 20px; white-space: nowrap;">
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

    openModal('Custom Packing', html, '600px');
    
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

            if (existing) {
                existing.quantity = (parseInt(existing.quantity) || 0) + item.qty;
                await saveData('packed_coffee', existing);
            } else {
                const newPacked = {
                    roast_batch_id: null,
                    machine_id: machineId,
                    custom_coffee_name: coffeeName,
                    bag_size_g: item.gram,
                    quantity: item.qty
                };
                await saveData('packed_coffee', newPacked);
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
