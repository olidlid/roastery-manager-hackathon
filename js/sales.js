// SALES MODULE - ROASTERY MANAGER V2
// Plain script (shared global scope — NOT an ES module). Split out of app.js
// during the V1 refactor. Covers Customers, and Handover/Sales
// (Dispatch Requests + Dispatch Approval). Load order: after db.js/auth.js/
// greenbean.js/roasting.js/packing.js, before app.js.

async function loadHandoverTabSpecificData(tabId) {
    switch (tabId) {
        case 'tab-dispatch-request':
            await loadSalesDispatchRequestsTable();
            break;
        case 'tab-dispatch-approval':
            await loadDispatchApprovalTable();
            break;
    }
    enforceGranularPermissions();
}

// ========== CUSTOMER MANAGEMENT ==========

let _customerFilterType = 'all';

function filterCustomers(type) {
    _customerFilterType = type;
    document.querySelectorAll('.customer-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === type);
    });
    loadCustomersSection();
}

async function loadCustomersSection(filterType) {
    if (filterType) _customerFilterType = filterType;
    const { data: customers } = await fetchData('customers');
    const tbody = document.getElementById('customers-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const searchVal = (document.getElementById('customer-search')?.value || '').toLowerCase();
    
    let filtered = (customers || []).filter(c => {
        if (_customerFilterType !== 'all' && c.type !== _customerFilterType) return false;
        if (searchVal && !c.name.toLowerCase().includes(searchVal) && !c.customer_id.toLowerCase().includes(searchVal)) return false;
        return true;
    });
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--text-muted); padding: 32px 0;">No customers found</td></tr>';
        return;
    }
    
    filtered.forEach(c => {
        const typeBadge = c.type === 'Wholesale' 
            ? '<span style="background:var(--primary-light); color:var(--primary); padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">🏭 Wholesale</span>'
            : '<span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">☕ Retail</span>';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code style="font-weight:700;">${c.customer_id}</code></td>
            <td><strong>${c.name}</strong></td>
            <td>${typeBadge}</td>
            <td>${c.contact_person || '-'}</td>
            <td>${c.phone || '-'}</td>
            <td>${c.email || '-'}</td>
            <td>${c.city || '-'}</td>
            <td><span style="display:inline-block; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom;" title="${(c.address || '').replace(/"/g, '&quot;')}">${c.address || '-'}</span></td>
            <td><span style="display:inline-block; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom;" title="${(c.notes || '').replace(/"/g, '&quot;')}">${c.notes || '-'}</span></td>
            <td>
                <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    <button class="btn btn-secondary btn-sm" onclick="viewCustomerHistory(${c.id})" title="Order History">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        History
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="openCustomerModal(${c.id})" title="Edit">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deleteCustomer(${c.id})" title="Delete">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function openCustomerModal(editId = null) {
    const { data: customers } = await fetchData('customers');
    let existing = null;
    if (editId) {
        existing = (customers || []).find(c => c.id === editId);
    }
    
    const html = `
        <form id="modal-customer-form" novalidate>
            <div class="form-row">
                <div class="form-group flex-1" >
                    <label class="form-label">Customer ID</label>
                    <input type="text" id="m-cust-id" class="form-control" readonly placeholder="Auto Generated" value="${existing ? existing.customer_id : ''}">
                </div>
                <div class="form-group flex-1" >
                    <label class="form-label">Type</label>
                    <select id="m-cust-type" class="form-control" ${editId ? 'disabled' : ''} required>
                        <option value="Wholesale" ${existing?.type === 'Wholesale' || !existing ? 'selected' : ''}>🏭 Wholesale</option>
                        <option value="Retail" ${existing?.type === 'Retail' ? 'selected' : ''}>☕ Retail</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Customer / Company Name</label>
                <input type="text" id="m-cust-name" class="form-control" required value="${existing ? existing.name : ''}" placeholder="e.g. PT Kopi Nusantara">
            </div>
            <div class="form-row">
                <div class="form-group flex-1" >
                    <label class="form-label">Contact Person</label>
                    <input type="text" id="m-cust-contact" class="form-control" value="${existing?.contact_person || ''}" placeholder="PIC name">
                </div>
                <div class="form-group flex-1" >
                    <label class="form-label">Phone</label>
                    <input type="text" id="m-cust-phone" class="form-control" value="${existing?.phone || ''}" placeholder="08xxx">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group flex-1" >
                    <label class="form-label">Email</label>
                    <input type="email" id="m-cust-email" class="form-control" value="${existing?.email || ''}" placeholder="email@example.com">
                </div>
                <div class="form-group flex-1" >
                    <label class="form-label">City</label>
                    <input type="text" id="m-cust-city" class="form-control" value="${existing?.city || ''}" placeholder="Jakarta">
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Address</label>
                <input type="text" id="m-cust-address" class="form-control" value="${existing?.address || ''}" placeholder="Full address">
            </div>
            <div class="form-group">
                <label class="form-label">Notes</label>
                <input type="text" id="m-cust-notes" class="form-control" value="${existing?.notes || ''}" placeholder="Additional notes">
            </div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">${editId ? 'Save Changes' : 'Add Customer'}</button>
            </div>
        </form>
    `;
    
    openModal(editId ? 'Edit Customer' : 'Add New Customer', html, '650px');
    
    // Auto-generate customer ID for new customers
    const typeSelect = document.getElementById('m-cust-type');
    const custIdInput = document.getElementById('m-cust-id');
    
    async function generateCustomerId() {
        const type = typeSelect.value;
        const prefix = type === 'Wholesale' ? 'WHL' : 'RTL';
        const allCust = (customers || []).filter(c => c.type === type);
        let maxNum = 0;
        allCust.forEach(c => {
            const match = c.customer_id?.match(new RegExp(`^${prefix}-(\\d+)$`));
            if (match) { const n = parseInt(match[1]); if (n > maxNum) maxNum = n; }
        });
        custIdInput.value = `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
    }
    
    if (!editId) {
        generateCustomerId();
        typeSelect.addEventListener('change', generateCustomerId);
    }
    
    // Form submit
    document.getElementById('modal-customer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('m-cust-name').value.trim();
        if (!name) { alert('Customer name is required'); return; }
        
        const record = {
            id: editId || undefined,
            customer_id: custIdInput.value,
            name,
            type: typeSelect.value,
            contact_person: document.getElementById('m-cust-contact').value.trim(),
            phone: document.getElementById('m-cust-phone').value.trim(),
            email: document.getElementById('m-cust-email').value.trim(),
            address: document.getElementById('m-cust-address').value.trim(),
            city: document.getElementById('m-cust-city').value.trim(),
            notes: document.getElementById('m-cust-notes').value.trim(),
            is_active: true
        };
        
        const { error } = await saveData('customers', record);
        if (error) {
            alert('Failed to save customer: ' + error.message);
        } else {
            document.getElementById('btn-close-modal').click();
            await loadCustomersSection();
        }
    });
}

async function deleteCustomer(id) {
    const proceed = await showWarningModal(
        'This will permanently remove the customer and all associated sales orders.',
        true,
        'Delete Customer',
        'Delete'
    );
    if (!proceed) return;

    const { error } = await deleteData('customers', id);
    if (error) {
        alert('Failed to delete: ' + error.message);
    } else {
        await loadCustomersSection();
    }
}

async function viewCustomerHistory(customerId) {
    const { data: customers } = await fetchData('customers');
    const customer = (customers || []).find(c => c.id === customerId);
    if (!customer) return;

    const [
        { data: orders },
        { data: orderItems },
        { data: dispatchLotItems },
        { data: packedLots },
        { data: greenbeans },
        { data: recipes },
        { data: codeDefinitions }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('dispatch_lot_items'),
        fetchData('packed_coffee_lots'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('code_definitions')
    ]);

    // Same coffee-name resolution convention as the dispatch checkout modal
    // (js/packing.js coffeeLabel) — request_order_items carries its own
    // coffee_type/single_coffee_id/blend_recipe_id directly, no join needed.
    // A coffee_code item (V2 trade-name product) takes priority over
    // single_coffee_id, which is left null for those items.
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

    // V2 1J: row-level filter — a sales_request_view_own-only role sees just
    // its own orders in this customer's history too (see filterOwnOrders in
    // js/auth.js; scope = every place orders appear, per the roadmap).
    const custOrders = filterOwnOrders(orders).filter(o => o.customer_id === customerId);

    let historyHtml = '';
    if (custOrders.length === 0) {
        historyHtml = '<p class="table-empty-state">No order history for this customer</p>';
    } else {
        historyHtml = `<table class="data-table" style="width:100%;">
            <thead><tr>
                <th>Order #</th><th>Date</th><th>Items</th><th>Lots Dispatched</th><th>Status</th>
            </tr></thead><tbody>`;

        custOrders.sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''));

        custOrders.forEach(o => {
            const items = (orderItems || []).filter(i => i.request_order_id === o.id);
            const itemsSummary = items.map(i => {
                const label = coffeeLabel(i);
                return `${label} — ${i.bag_size_g || '-'}g x${i.quantity_requested || 0}`;
            }).join('<br>') || '-';

            const itemIds = items.map(i => i.id);
            const lotRows = (dispatchLotItems || []).filter(d => itemIds.includes(d.request_order_item_id));
            const lotsSummary = lotRows.length
                ? lotRows.map(d => {
                    const lot = (packedLots || []).find(l => l.id === d.packed_coffee_lot_id);
                    return `<code>${lot ? lot.lot_code : '—'}</code> ×${d.qty}`;
                  }).join('<br>')
                : '<span style="color:var(--text-muted);">—</span>';

            const statusColor = o.status === 'Dispatched' ? 'var(--success)' : o.status === 'Approved' ? 'var(--primary)' : 'var(--warning)';

            historyHtml += `<tr>
                <td><code>${o.order_number || '#ORD-'+o.id}</code></td>
                <td>${o.order_date || '-'}</td>
                <td style="font-size:0.8rem;">${itemsSummary}</td>
                <td style="font-size:0.8rem;">${lotsSummary}</td>
                <td><span style="color:${statusColor}; font-weight:600;">${o.status || 'Pending'}</span></td>
            </tr>`;
        });
        historyHtml += '</tbody></table>';
    }

    const html = `
        <div style="margin-bottom: 16px; padding: 16px; background: var(--card-bg); border-radius: 8px; border: 1px solid var(--border-color);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size: 1.2rem; font-weight: 700;">${customer.name}</div>
                    <div style="color:var(--text-muted); font-size:0.85rem;">${customer.customer_id} • ${customer.type}</div>
                </div>
                <div style="text-align:right; color:var(--text-muted); font-size:0.85rem;">
                    <div>${customer.contact_person || ''}</div>
                    <div>${customer.phone || ''}</div>
                    <div>${customer.city || ''}</div>
                </div>
            </div>
        </div>
        <h4 style="margin-bottom: 12px;">Order History (${custOrders.length} orders)</h4>
        ${historyHtml}
    `;

    openModal(`Customer: ${customer.name}`, html, '900px');
}

// V2 1G — reverse lookup: "which customers received lot X". Searches
// packed_coffee_lots by lot_code, then dispatch_lot_items for who it went to.
async function openLotCodeLookupModal() {
    const html = `
        <div class="form-group">
            <label class="form-label">Lot Code</label>
            <input type="text" id="lot-lookup-input" class="form-control" placeholder="e.g. SKR-M4072426-3" oninput="searchLotCodeLookup(this.value)" autocomplete="off">
        </div>
        <div id="lot-lookup-results" style="margin-top:16px;"></div>
    `;
    openModal('Find Customers by Lot Code', html, '700px');
    setTimeout(() => document.getElementById('lot-lookup-input')?.focus(), 50);
}

async function searchLotCodeLookup(query) {
    const resultsEl = document.getElementById('lot-lookup-results');
    if (!resultsEl) return;
    const q = (query || '').trim().toLowerCase();
    if (!q) { resultsEl.innerHTML = ''; return; }

    const [
        { data: packedLots },
        { data: dispatchLotItems },
        { data: orderItems },
        { data: orders },
        { data: customers }
    ] = await Promise.all([
        fetchData('packed_coffee_lots'),
        fetchData('dispatch_lot_items'),
        fetchData('request_order_items'),
        fetchData('request_orders'),
        fetchData('customers')
    ]);

    const matchingLots = (packedLots || []).filter(l => (l.lot_code || '').toLowerCase().includes(q));
    if (matchingLots.length === 0) {
        resultsEl.innerHTML = '<p class="table-empty-state">No matching lot codes</p>';
        return;
    }

    const lotIds = matchingLots.map(l => l.id);
    const matches = (dispatchLotItems || []).filter(d => lotIds.includes(d.packed_coffee_lot_id));

    if (matches.length === 0) {
        resultsEl.innerHTML = '<p class="table-empty-state">Matching lot(s) found, but not dispatched to any customer yet</p>';
        return;
    }

    const rows = matches.map(d => {
        const lot = matchingLots.find(l => l.id === d.packed_coffee_lot_id);
        const item = (orderItems || []).find(i => i.id === d.request_order_item_id);
        const order = item ? (orders || []).find(o => o.id === item.request_order_id) : null;
        const customer = (customers || []).find(c => c.id === d.customer_id) || (order ? (customers || []).find(c => c.id === order.customer_id) : null);
        return {
            lotCode: lot ? lot.lot_code : '—',
            customerName: customer ? customer.name : (order ? (order.customer_name || '-') : '-'),
            orderNumber: order ? (order.order_number || '#ORD-' + order.id) : '-',
            date: order ? order.order_date : null,
            qty: d.qty
        };
    });

    rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    resultsEl.innerHTML = `<table class="data-table" style="width:100%;">
        <thead><tr><th>Lot Code</th><th>Customer</th><th>Order #</th><th>Date</th><th>Qty</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
            <td><code>${r.lotCode}</code></td>
            <td>${r.customerName}</td>
            <td><code>${r.orderNumber}</code></td>
            <td>${r.date || '-'}</td>
            <td>${r.qty}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

// ==========================================================================
// SECTION 5: HANDOVER (SERAH TERIMA SALES)
// ==========================================================================
let activeSelectedOrderId = null;

async function loadHandoverSection() {
    await loadSalesDispatchRequestsTable();
    await loadDispatchApprovalTable();
}

// loadSalesDispatchRequestsTable does a Promise.all of 8 fetchData calls, so
// re-running it on every keystroke (like customer-search does, with its
// single-table fetch) would be a network round-trip per key. Debounce so it
// only fires once typing pauses.
let _requestSearchDebounce = null;
function handleRequestSearchInput() {
    if (_requestSearchDebounce) clearTimeout(_requestSearchDebounce);
    _requestSearchDebounce = setTimeout(() => {
        requestCurrentPage = 1;
        loadSalesDispatchRequestsTable();
    }, 300);
}

async function loadSalesDispatchRequestsTable() {
    const [
        { data: orders },
        { data: orderItems },
        { data: packedGoods },
        { data: roastBatches },
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: customers },
        { data: codeDefinitions }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('customers'),
        fetchData('code_definitions')
    ]);
    const tbody = document.getElementById('request-orders-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // V2 1J: row-level filter — a sales_request_view_own-only role sees just
    // its own orders (see filterOwnOrders in js/auth.js).
    const visibleOrders = filterOwnOrders(orders);

    if (!visibleOrders || visibleOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center-muted">${window.t ? window.t("msg_no_orders") : "No orders found."}</td></tr>`;
        return;
    }

    let sortedOrders = [...visibleOrders]
        .sort((a, b) => new Date(b.order_date) - new Date(a.order_date) || b.id - a.id);

    // Search across order number, sales agent, customer, and item coffee names
    const searchVal = (document.getElementById('request-search')?.value || '').trim().toLowerCase();
    if (searchVal) {
        sortedOrders = sortedOrders.filter(order => {
            const orderNumber = (order.order_number || `#ORD-${order.id}`).toLowerCase();
            if (orderNumber.includes(searchVal)) return true;
            if ((order.sales_name || '').toLowerCase().includes(searchVal)) return true;
            const cust = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null;
            if (cust && (cust.name || '').toLowerCase().includes(searchVal)) return true;
            const items = (orderItems || []).filter(i => i.request_order_id === order.id);
            return items.some(item => {
                const coffeeName = item.coffee_code
                    ? (codeDefinitions || []).find(d => d.code === item.coffee_code)?.name
                    : item.coffee_type === 'Single'
                        ? (greenbeans || []).find(g => g.id === item.single_coffee_id)?.name
                        : (recipes || []).find(r => r.id === item.blend_recipe_id)?.name;
                return (coffeeName || '').toLowerCase().includes(searchVal);
            });
        });
        if (sortedOrders.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center-muted">${window.t ? window.t("msg_no_orders_match_search") || "No orders match your search." : "No orders match your search."}</td></tr>`;
            return;
        }
    }

    const batchMap = new Map();
    (roastBatches || []).forEach(b => batchMap.set(b.id, b));

    // Keyed by coffee+size+machine — packed stock from different machines is
    // not interchangeable (confirmed 2026-07-15), matching openOrderDetailPopup.
    const stockMap = new Map();
    (packedGoods || []).forEach(p => {
        if (p.roast_batch_id) {
            const batch = batchMap.get(p.roast_batch_id);
            if (batch && batch.machine_id) {
                const cId = batch.coffee_type === 'Single' ? batch.single_coffee_id : batch.blend_recipe_id;
                const key = `${batch.coffee_type}-${cId}-${p.bag_size_g}-${batch.machine_id}`;
                stockMap.set(key, (stockMap.get(key) || 0) + (parseInt(p.quantity) || 0));
            }
        }
        // Also match packed_coffee saved via daily packing (custom_coffee_name, no roast_batch_id)
        if (!p.roast_batch_id && p.custom_coffee_name && p.machine_id) {
            let resolvedKey = null;
            const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
            const matchGb = (greenbeans || []).find(g => g.name === cleanName);
            if (matchGb) {
                resolvedKey = `Single-${matchGb.id}-${p.bag_size_g}-${p.machine_id}`;
            } else {
                const matchRec = (recipes || []).find(r => r.name === cleanName);
                if (matchRec) resolvedKey = `Blend-${matchRec.id}-${p.bag_size_g}-${p.machine_id}`;
            }
            if (resolvedKey) {
                stockMap.set(resolvedKey, (stockMap.get(resolvedKey) || 0) + (parseInt(p.quantity) || 0));
            }
        }
    });

    // Registers this table so applyFiltersForTable (js/app.js) filters the
    // FULL sortedOrders list first, then paginates the filtered result —
    // fixes the column filter dropdown only ever listing values from
    // whichever page happened to be open (found 2026-07-29). Every row
    // below is now rendered unconditionally; renderPaginationControls
    // (called from applyFiltersForTable at the end of this function)
    // decides which page of the (possibly filtered) rows to reveal.
    registerPaginatedFilterTable('tab-dispatch-request', {
        getPage: () => requestCurrentPage,
        setPage: (p) => { requestCurrentPage = p; },
        getPageSize: () => requestPageSize,
        paginationContainerId: 'request-pagination-pages',
        infoElId: 'request-page-info'
    });

    // Highlight active page size
    const sizeOpts = document.querySelectorAll('#request-page-size-selector .page-size-opt');
    sizeOpts.forEach(opt => {
        const size = parseInt(opt.getAttribute('data-size'));
        if (size === requestPageSize) {
            opt.classList.add('active');
            opt.style.textDecoration = 'underline';
            opt.style.fontWeight = '700';
            opt.style.color = 'var(--text-primary)';
        } else {
            opt.classList.remove('active');
            opt.style.textDecoration = 'none';
            opt.style.fontWeight = '500';
            opt.style.color = 'var(--text-secondary)';
        }
    });

    let tbodyHtml = '';
    for (const order of sortedOrders) {
        let needsRoast = false;
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);
        
        if (order.status === 'Pending Approval') {
            for (const item of items) {
                const type = item.coffee_type;
                const size = parseInt(item.bag_size_g);
                let packedStock = 0;

                if (item.coffee_code) {
                    // Trade-name item: sum packed stock across every origin
                    // (Single) or recipe (Blend) sharing the code, on any
                    // machine (fulfillment isn't tied to one origin/recipe/
                    // machine for these — see js/packing.js
                    // openDispatchCheckoutModal).
                    const groupIds = type === 'Single'
                        ? (greenbeans || []).filter(g => g.code === item.coffee_code).map(g => g.id)
                        : (recipes || []).filter(r => r.code === item.coffee_code).map(r => r.id);
                    (machines || []).forEach(m => {
                        groupIds.forEach(gid => {
                            packedStock += stockMap.get(`${type}-${gid}-${size}-${m.id}`) || 0;
                        });
                    });
                } else {
                    const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
                    const key = `${type}-${coffeeId}-${size}-${item.machine_id}`;
                    packedStock = item.machine_id ? (stockMap.get(key) || 0) : 0;
                }

                if (item.quantity_requested > packedStock) {
                    needsRoast = true;
                    break;
                }
            }
        }
        
        const isPending = order.status === 'Pending Approval';
        let actionColumnContent = '';
        if (isPending) {
            actionColumnContent = `
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <button class="btn btn-primary btn-sm btn-edit-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle-mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>
                    <button class="btn btn-danger btn-sm btn-delete-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle-mr-1"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Delete</button>
                </div>
            `;
        } else if (order.status === 'Cancelled') {
            actionColumnContent = `
                <span style="color: #b91c1c; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                    Cancelled
                </span>
            `;
        } else if (order.status === 'Dispatched') {
            actionColumnContent = `
                <span style="color: #0891b2; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.3); border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                    Dispatched
                </span>
            `;
        } else {
            const allItemsReady = items.every(item => item.item_status === 'Ready for Handover');
            if (allItemsReady) {
                const labelReadyToDispatch = window.t ? window.t("status_ready_to_dispatch") || "Ready to Dispatch" : "Ready to Dispatch";
                actionColumnContent = `
                    <span style="color: #15803d; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #dcfce7; border: 1px solid #bbf7d0; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                        <i class="lucide-check-circle" style="width:14px; height:14px;"></i> ${labelReadyToDispatch}
                    </span>
                `;
            } else {
                const labelOnProgress = window.t ? window.t("status_on_progress") || "On Progress" : "On Progress";
                actionColumnContent = `
                    <span style="color: #1d4ed8; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                        <span style="display:inline-block; width:6px; height:6px; background:#1d4ed8; border-radius:50%;"></span> ${labelOnProgress}
                    </span>
                `;
            }
        }

        let itemsHtml = `<div style="display: flex; flex-direction: column; gap: 8px;">`;
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
            
            const statusBadge = getItemStatusBadge(item.item_status);
            
            const itemMach = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
            const machTag = itemMach ? `<span style="font-size:0.72rem; color:#0891b2; font-weight:600; background:rgba(6,182,212,0.1); padding:1px 6px; border-radius:4px; margin-left:6px;">${itemMach.name}</span>` : '';
            
            itemsHtml += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.02); padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                    <div style="font-size: 0.85rem;">
                        <strong>${coffeeName}</strong> - ${item.bag_size_g}g${machTag}<br/>
                        <span style="color: var(--text-secondary); font-size: 0.75rem;">
                            Requested: ${item.quantity_requested} bags
                        </span>
                    </div>
                    <div>
                        ${statusBadge}
                    </div>
                </div>
            `;
        }
        itemsHtml += `</div>`;

        tbodyHtml += `
        <tr>
            <td>
                <code>${order.order_number || '#ORD-'+order.id}</code><br/>
                <span class="text-secondary-xs">${order.order_date}</span>
                ${needsRoast ? `<div style="margin-top: 4px;"><span style="font-size:0.65rem; color: var(--danger); font-weight: bold;">⚠️ ${window.t ? window.t('badge_auto_roast') : 'Auto-Roast Required'}</span></div>` : ''}
            </td>
            <td>
                <strong>${order.sales_name}</strong>
                ${(() => { const cust = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null; return cust ? `<br/><span class="text-secondary-xs">👤 ${cust.name} <code style="font-size:0.65rem;">${cust.customer_id}</code></span>` : ''; })()}
            </td>
            <td>${itemsHtml}</td>
            <td>
                ${actionColumnContent}
            </td>
        </tr>
        `;
    }
    tbody.innerHTML = tbodyHtml;

    tbody.onclick = function(e) {
        const btnEdit = e.target.closest('.btn-edit-order');
        if (btnEdit) {
            openSalesRequestModal(parseInt(btnEdit.getAttribute('data-id')));
            return;
        }
        const btnDelete = e.target.closest('.btn-delete-order');
        if (btnDelete) {
            deleteSalesOrder(parseInt(btnDelete.getAttribute('data-id')));
            return;
        }
    };

    applyFiltersForTable(document.querySelector('#tab-dispatch-request table'));
    if (typeof window.translatePage === 'function') window.translatePage();
}

async function loadDispatchApprovalTable() {
    const [
        { data: orders },
        { data: orderItems },
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: customers },
        { data: packed },
        { data: roastBatches },
        { data: codeDefinitions }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('customers'),
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('code_definitions')
    ]);
    const tbody = document.getElementById('approval-orders-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!orders || orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center-muted">${window.t ? window.t("msg_no_orders") : "No orders found."}</td></tr>`;
        return;
    }

    const sortedOrders = [...orders]
        .sort((a, b) => new Date(b.order_date) - new Date(a.order_date) || b.id - a.id);

    // Registers this table so applyFiltersForTable (js/app.js) filters the
    // FULL sortedOrders list first, then paginates the filtered result —
    // fixes the column filter dropdown only ever listing values from
    // whichever page happened to be open (found 2026-07-29). Every row
    // below is now rendered unconditionally; renderPaginationControls
    // (called from applyFiltersForTable at the end of this function)
    // decides which page of the (possibly filtered) rows to reveal.
    registerPaginatedFilterTable('tab-dispatch-approval', {
        getPage: () => approvalCurrentPage,
        setPage: (p) => { approvalCurrentPage = p; },
        getPageSize: () => approvalPageSize,
        paginationContainerId: 'approval-pagination-pages',
        infoElId: 'approval-page-info'
    });

    // Highlight active page size
    const sizeOpts = document.querySelectorAll('#approval-page-size-selector .page-size-opt');
    sizeOpts.forEach(opt => {
        const size = parseInt(opt.getAttribute('data-size'));
        if (size === approvalPageSize) {
            opt.classList.add('active');
            opt.style.textDecoration = 'underline';
            opt.style.fontWeight = '700';
            opt.style.color = 'var(--text-primary)';
        } else {
            opt.classList.remove('active');
            opt.style.textDecoration = 'none';
            opt.style.fontWeight = '500';
            opt.style.color = 'var(--text-secondary)';
        }
    });

    let tbodyHtml = '';
    for (const order of sortedOrders) {
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);

        // Build card-style items like Sales Dispatch Request
        let itemsHtml = `<div style="display: flex; flex-direction: column; gap: 8px;">`;
        for (const item of items) {
            let coffeeName = '';
            if (item.coffee_code) {
                const def = (codeDefinitions || []).find(d => d.code === item.coffee_code);
                coffeeName = def ? `${def.name} (${item.coffee_type})` : `Code ${item.coffee_code}`;
            } else if (item.coffee_type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === item.single_coffee_id);
                coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
            } else {
                const r = (recipes || []).find(rec => rec.id === item.blend_recipe_id);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
            }
            
            const itemMach = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
            const machTag = itemMach ? `<span style="font-size:0.72rem; color:#0891b2; font-weight:600; background:rgba(6,182,212,0.1); padding:1px 6px; border-radius:4px; margin-left:6px;">${itemMach.name}</span>` : '';
            
            const statusBadge = getItemStatusBadge(item.item_status);
            
            itemsHtml += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.02); padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                    <div style="font-size: 0.85rem;">
                        <strong>${coffeeName}</strong> - ${item.bag_size_g}g${machTag}<br/>
                        <span style="color: var(--text-secondary); font-size: 0.75rem;">
                            Requested: ${item.quantity_requested} bags
                        </span>
                    </div>
                    <div>
                        ${statusBadge}
                    </div>
                </div>
            `;
        }
        itemsHtml += `</div>`;

        // Action column - same style as Sales Dispatch Request
        const isPending = order.status === 'Pending Approval';
        let actionColumnContent = '';
        if (isPending) {
            actionColumnContent = `
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <button class="btn btn-success btn-sm btn-approve-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-xs"><polyline points="20 6 9 17 4 12"/></svg> Approve</button>
                    <button class="btn btn-primary btn-sm btn-edit-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle-mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>
                </div>
            `;
        } else if (order.status === 'Cancelled') {
            actionColumnContent = `<span style="color: #b91c1c; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">Cancelled</span>`;
        } else if (order.status === 'Dispatched') {
            actionColumnContent = `
                <span style="color: #0891b2; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.3); border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                    Dispatched
                </span>
            `;
        } else if (order.status === 'Preparing') {
            const canEdit = true;
            actionColumnContent = `
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <span style="color: #8b5cf6; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: rgba(139,92,246,0.1); border: 1px solid rgba(139,92,246,0.3); border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                        <span style="display:inline-block; width:6px; height:6px; background:#8b5cf6; border-radius:50%;"></span> Preparing
                    </span>
                    ${canEdit ? `<button class="btn btn-primary btn-sm btn-edit-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle-mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>` : ''}
                </div>
            `;
        } else {
            const allReady = items.every(item => item.item_status === 'Ready for Handover');
            if (allReady) {
                actionColumnContent = `<span style="color: #15803d; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #dcfce7; border: 1px solid #bbf7d0; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;"><i class="lucide-check-circle" style="width:14px; height:14px;"></i> Completed</span>`;
            } else {
                actionColumnContent = `<span style="color: #1d4ed8; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;"><span style="display:inline-block; width:6px; height:6px; background:#1d4ed8; border-radius:50%;"></span> On Progress</span>`;
            }
        }

        tbodyHtml += `
        <tr data-order-id="${order.id}" style="cursor: pointer;" class="table-row-hover">
            <td>
                <code>${order.order_number || '#ORD-'+order.id}</code><br/>
                <span class="text-secondary-xs">${order.order_date}</span>
            </td>
            <td>
                <strong>${order.sales_name}</strong>
                ${(() => { const cust = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null; return cust ? `<br/><span class="text-secondary-xs">👤 ${cust.name} <code style="font-size:0.65rem;">${cust.customer_id}</code></span>` : ''; })()}
            </td>
            <td>${itemsHtml}</td>
            <td>
                ${actionColumnContent}
            </td>
        </tr>
        `;
    }
    tbody.innerHTML = tbodyHtml;

    tbody.onclick = function(e) {
        const btnApprove = e.target.closest('.btn-approve-order');
        if (btnApprove) {
            approveSalesOrder(parseInt(btnApprove.getAttribute('data-id')));
            return;
        }
        const btnEdit = e.target.closest('.btn-edit-order');
        if (btnEdit) {
            openSalesRequestModal(parseInt(btnEdit.getAttribute('data-id')));
            return;
        }
        // Row click → detail popup
        const tr = e.target.closest('tr[data-order-id]');
        if (tr) {
            const orderId = parseInt(tr.getAttribute('data-order-id'));
            openOrderDetailPopup(orderId, orders, orderItems, greenbeans, recipes, machines, packed, roastBatches, codeDefinitions);
        }
    };

    applyFiltersForTable(document.querySelector('#tab-dispatch-approval table'));
    if (typeof window.translatePage === 'function') window.translatePage();
}

function openOrderDetailPopup(orderId, orders, orderItems, greenbeans, recipes, machines, packed, roastBatches, codeDefinitions) {
    const order = (orders || []).find(o => o.id === orderId);
    if (!order) return;

    const items = (orderItems || []).filter(i => i.request_order_id === orderId);

    // For orders not yet approved, quantity_allocated/quantity_pending haven't
    // been decided yet (approveSalesOrder() is what sets them) — they'd just
    // read as 0. So for a still-pending order, compute a live snapshot of
    // packed stock per coffee/size/machine instead.
    //
    // Partitioned by machine (confirmed correct 2026-07-15 — packed stock
    // from different machines is NOT interchangeable; a bag roasted on
    // machine A is not the same fulfillable unit as one from machine B even
    // for "the same" coffee+size). This was briefly (and incorrectly) changed
    // to pool across machines to match 4 other lookups in the app — those 4
    // are the ones that need fixing to match THIS behavior, not the other
    // way around. See V2_ROADMAP.md / project memory for the correction.
    const isPending = order.status === 'Pending Approval';
    const perMachinePackedStock = {};
    if (isPending) {
        (packed || []).forEach(p => {
            let coffeeType = null, cId = null, machineId = null;
            if (p.roast_batch_id) {
                const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
                if (batch) {
                    coffeeType = batch.coffee_type;
                    cId = coffeeType === 'Single' ? batch.single_coffee_id : batch.blend_recipe_id;
                    machineId = batch.machine_id || null;
                }
            }
            // Fallback for packed_coffee rows with no roast_batch_id link —
            // match by custom_coffee_name instead.
            if (!coffeeType && p.custom_coffee_name) {
                const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
                const matchGb = (greenbeans || []).find(g => g.name === cleanName);
                if (matchGb) {
                    coffeeType = 'Single';
                    cId = matchGb.id;
                } else {
                    const matchRec = (recipes || []).find(r => r.name === cleanName);
                    if (matchRec) {
                        coffeeType = 'Blend';
                        cId = matchRec.id;
                    }
                }
                machineId = p.machine_id || null;
            }
            if (coffeeType && cId && machineId) {
                const qty = parseInt(p.quantity) || 0;
                const key = `${coffeeType}-${cId}-${p.bag_size_g}-${machineId}`;
                perMachinePackedStock[key] = (perMachinePackedStock[key] || 0) + qty;
            }
        });
    }

    const badgeColor = order.status === 'Dispatched' ? 'rgba(6,182,212,0.15)' :
                       order.status === 'Completed' ? 'rgba(16,185,129,0.15)' :
                       order.status === 'Preparing' ? 'rgba(139,92,246,0.15)' :
                       order.status === 'Approved' ? 'rgba(59,130,246,0.15)' :
                       order.status === 'Cancelled' ? 'rgba(239,68,68,0.15)' :
                       'rgba(245,158,11,0.15)';
    const textCol = order.status === 'Dispatched' ? '#0891b2' :
                    order.status === 'Completed' ? 'var(--success)' :
                    order.status === 'Preparing' ? '#8b5cf6' :
                    order.status === 'Approved' ? 'var(--info)' :
                    order.status === 'Cancelled' ? 'var(--danger)' :
                    'var(--warning)';

    // Build items table
    let itemsHtml = '';
    let totalBags = 0;
    let totalAllocated = 0;
    let totalPending = 0;
    items.forEach((item, idx) => {
        let coffeeName = '';
        if (item.coffee_code) {
            const def = (codeDefinitions || []).find(d => d.code === item.coffee_code);
            coffeeName = def ? def.name : `Code ${item.coffee_code}`;
        } else if (item.coffee_type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === item.single_coffee_id);
            coffeeName = gb ? gb.name : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === item.blend_recipe_id);
            coffeeName = r ? r.name : 'Blend Recipe';
        }
        const mach = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
        const machName = mach ? mach.name : '-';
        const sizeLabel = item.bag_size_g >= 1000 ? `${item.bag_size_g / 1000} kg` : `${item.bag_size_g}g`;
        totalBags += item.quantity_requested || 0;

        let availableStock, toPlan;
        if (isPending && item.coffee_code) {
            // Trade-name item: sum packed stock across every origin (Single)
            // or recipe (Blend) sharing the code, on any machine (see
            // loadSalesDispatchRequestsTable's needsRoast check above for the
            // same aggregation).
            const groupIds = item.coffee_type === 'Single'
                ? (greenbeans || []).filter(g => g.code === item.coffee_code).map(g => g.id)
                : (recipes || []).filter(r => r.code === item.coffee_code).map(r => r.id);
            availableStock = 0;
            (machines || []).forEach(m => {
                groupIds.forEach(gid => {
                    availableStock += perMachinePackedStock[`${item.coffee_type}-${gid}-${item.bag_size_g}-${m.id}`] || 0;
                });
            });
            toPlan = Math.max(0, (item.quantity_requested || 0) - availableStock);
        } else if (isPending && item.machine_id) {
            const cId = item.coffee_type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
            const key = `${item.coffee_type}-${cId}-${item.bag_size_g}-${item.machine_id}`;
            availableStock = perMachinePackedStock[key] || 0;
            toPlan = Math.max(0, (item.quantity_requested || 0) - availableStock);
        } else {
            availableStock = item.quantity_allocated || 0;
            toPlan = item.quantity_pending || 0;
        }
        totalAllocated += availableStock;
        totalPending += toPlan;

        itemsHtml += `
            <tr>
                <td class="text-center">${idx + 1}</td>
                <td><strong>${coffeeName}</strong></td>
                <td class="text-center">${item.coffee_type || '-'}</td>
                <td class="text-center">${machName}</td>
                <td class="text-center">${sizeLabel}</td>
                <td class="text-center"><strong>${item.quantity_requested || 0}</strong></td>
                <td class="text-center">${availableStock}</td>
                <td class="text-center">${toPlan}</td>
            </tr>
        `;
    });

    // Build popup
    let existingPopup = document.getElementById('order-detail-overlay');
    if (!existingPopup) {
        existingPopup = document.createElement('div');
        existingPopup.id = 'order-detail-overlay';
        existingPopup.className = 'overlay';
        existingPopup.style.zIndex = '1100';
        document.body.appendChild(existingPopup);
    }

    existingPopup.innerHTML = `
        <div class="overlay-card" style="max-width: 850px; width: 95%; padding: 28px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; font-weight: 800; color: var(--text-primary);">Order Detail</h3>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-close-order-detail">&times;</button>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin-bottom: 20px; font-size: 0.85rem;">
                <div>
                    <span class="text-muted-xs">Order Number</span>
                    <div style="font-weight: 700;">${order.order_number || '#ORD-' + order.id}</div>
                </div>
                <div>
                    <span class="text-muted-xs">Sales Agent</span>
                    <div style="font-weight: 700;">${order.sales_name}</div>
                </div>
                <div>
                    <span class="text-muted-xs">Order Date</span>
                    <div style="font-weight: 700;">${order.order_date}</div>
                </div>
                <div>
                    <span class="text-muted-xs">Status</span>
                    <div><span style="font-size:0.75rem; padding: 2px 8px; border-radius: 9999px; font-weight:700; background: ${badgeColor}; color: ${textCol};">${order.status}</span></div>
                </div>
                ${order.notes ? `<div style="grid-column: 1 / -1;"><span class="text-muted-xs">Notes</span><div style="font-weight: 600;">${order.notes}</div></div>` : ''}
            </div>

            <h4 style="font-size: 0.85rem; font-weight: 700; margin-bottom: 8px; color: var(--text-primary);">Order Items (${items.length})</h4>
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th style="text-align: center; width: 40px;">#</th>
                            <th>Coffee Name</th>
                            <th class="text-center">Type</th>
                            <th class="text-center">Machine</th>
                            <th class="text-center">Size</th>
                            <th class="text-center">Qty (bags)</th>
                            <th class="text-center">Available Stock</th>
                            <th class="text-center">To Production Plan</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                        <tr style="font-weight: 700; border-top: 2px solid var(--border); background: rgba(255,255,255,0.03);">
                            <td colspan="5" style="text-align: right;">Total Bags</td>
                            <td style="text-align: center; color: var(--primary);"><strong>${totalBags}</strong></td>
                            <td style="text-align: center; color: var(--primary);"><strong>${totalAllocated}</strong></td>
                            <td style="text-align: center; color: var(--primary);"><strong>${totalPending}</strong></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    existingPopup.classList.remove('hidden');
    document.getElementById('btn-close-order-detail').onclick = () => existingPopup.classList.add('hidden');
}

// Approve sales request order and allocate packed stock
async function approveSalesOrder(orderId) {
    const [
        { data: orders },
        { data: orderItems },
        { data: packedGoods },
        { data: greenbeans },
        { data: recipes },
        { data: roastBatches },
        { data: machines },
        { data: codeDefinitions },
        { data: greenCoffeeLots },
        { data: packedCoffeeLots },
        { data: ingredients },
        { data: bulkList },
        { data: bulkReservations }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('packed_coffee'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('roast_batches'),
        fetchData('machines'),
        fetchData('code_definitions'),
        fetchData('green_coffee_lots'),
        fetchData('packed_coffee_lots'),
        fetchData('blend_ingredients'),
        fetchData('bulk_roasted_coffee'),
        fetchData('bulk_reservations')
    ]);

    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const items = orderItems.filter(i => i.request_order_id === orderId);

    // Build machine options HTML
    const machineOptionsHtml = (machines || []).map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    // Resolves a packed_coffee row back to its underlying green_coffee/recipe
    // name — used only for the trade-name origin-breakdown display (see
    // originBreakdownHtml below), not for matching (findMatchingPacked
    // already knows a row belongs to the code group by the time this runs).
    function resolvePackedIdentityForApproval(p) {
        if (p.roast_batch_id) {
            const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
            if (!batch) return null;
            if (batch.coffee_type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === batch.single_coffee_id);
                return gb ? { type: 'Single', name: gb.name } : null;
            }
            if (batch.coffee_type === 'Blend') {
                const r = (recipes || []).find(rec => rec.id === batch.blend_recipe_id);
                return r ? { type: 'Blend', name: r.name } : null;
            }
            return null;
        }
        if (p.custom_coffee_name) {
            const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
            const gb = (greenbeans || []).find(g => g.name === cleanName);
            if (gb) return { type: 'Single', name: gb.name };
            const r = (recipes || []).find(rec => rec.name === cleanName);
            return r ? { type: 'Blend', name: r.name } : null;
        }
        return null;
    }

    // Trade-name (coffee_code) items: which origin ends up filling the order
    // is decided at packing/dispatch (js/packing.js openDispatchCheckoutModal),
    // not here — so packed-stock matching considers every origin sharing the
    // code, on any machine, instead of one exact single_coffee_id+machine.
    // Shared by both the preview render below and the submit handler's
    // deduction further down, so the matching rule can't drift between them.
    function findMatchingPacked(item) {
        const type = item.coffee_type;
        const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
        if (item.coffee_code) {
            const groupIds = type === 'Single'
                ? (greenbeans || []).filter(g => g.code === item.coffee_code).map(g => g.id)
                : (recipes || []).filter(r => r.code === item.coffee_code).map(r => r.id);
            return (packedGoods || []).filter(p => {
                if (p.roast_batch_id) {
                    const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
                    return batch && batch.coffee_type === type &&
                        groupIds.includes(type === 'Single' ? batch.single_coffee_id : batch.blend_recipe_id);
                }
                if (p.custom_coffee_name) {
                    const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
                    if (type === 'Single') {
                        const gb = (greenbeans || []).find(g => groupIds.includes(g.id) && g.name === cleanName);
                        return !!gb;
                    }
                    const rec = (recipes || []).find(r => groupIds.includes(r.id) && r.name === cleanName);
                    return !!rec;
                }
                return false;
            });
        }
        // Machine-partitioned (confirmed 2026-07-15): packed stock from a
        // different machine is not a valid fulfillment source for this item.
        return (packedGoods || []).filter(p => {
            if (p.roast_batch_id) {
                const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
                return batch && batch.coffee_type === type && (batch.single_coffee_id === coffeeId || batch.blend_recipe_id === coffeeId) && batch.machine_id === item.machine_id;
            }
            // Also match by custom_coffee_name
            if (p.custom_coffee_name) {
                const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
                if (type === 'Single') {
                    const gb = (greenbeans || []).find(g => g.id === coffeeId);
                    return gb && gb.name === cleanName && p.machine_id === item.machine_id;
                } else {
                    const rec = (recipes || []).find(r => r.id === coffeeId);
                    return rec && rec.name === cleanName && p.machine_id === item.machine_id;
                }
            }
            return false;
        });
    }

    // Among every green_coffee sharing a code, pick the one with the oldest
    // remaining lot (FIFO) as the concrete origin a top-up Roasting Plan
    // targets — same arrival_date ordering consumeGreenCoffeeLotsFifo uses
    // (js/roasting.js). The plan is a completely normal single-origin plan
    // from this point on; whoever reviews it can still change the coffee.
    function pickFifoOriginForCode(code) {
        const groupIds = (greenbeans || []).filter(g => g.code === code).map(g => g.id);
        let best = null, bestDate = null;
        (greenCoffeeLots || []).forEach(l => {
            if (!groupIds.includes(l.green_coffee_id)) return;
            if ((parseFloat(l.remaining_kg) || 0) <= 0) return;
            if (!bestDate || (l.arrival_date && l.arrival_date < bestDate)) {
                bestDate = l.arrival_date;
                best = l.green_coffee_id;
            }
        });
        return best || groupIds[0] || null;
    }

    // Blend sibling of pickFifoOriginForCode: a recipe has no single
    // arrival_date of its own (it's several green beans combined), so
    // "oldest" here means whichever matching recipe's oldest ingredient lot
    // is most urgent to use — same FIFO-urgency intent, adapted for a
    // multi-ingredient product. Also just a starting point for a normal,
    // human-reviewable plan (see comment above).
    function pickFifoRecipeForCode(code) {
        const matchingRecipes = (recipes || []).filter(r => r.code === code);
        let best = null, bestDate = null;
        matchingRecipes.forEach(r => {
            const gbIds = (ingredients || [])
                .filter(i => parseInt(i.blend_recipe_id) === r.id)
                .map(i => parseInt(i.green_coffee_id));
            (greenCoffeeLots || []).forEach(l => {
                if (!gbIds.includes(l.green_coffee_id)) return;
                if ((parseFloat(l.remaining_kg) || 0) <= 0) return;
                if (!bestDate || (l.arrival_date && l.arrival_date < bestDate)) {
                    bestDate = l.arrival_date;
                    best = r.id;
                }
            });
        });
        return best || (matchingRecipes[0] ? matchingRecipes[0].id : null);
    }

    // How much a recipe could actually produce right now — the tightest
    // ingredient (ratio-adjusted), same "weakest link" math as
    // maxGbKgForRecipe in openSalesRequestModal — used only to label the
    // leader's origin/recipe choices above with a decision-relevant number,
    // not for any capacity check.
    function recipeAvailKg(recipeId) {
        const ings = (ingredients || []).filter(i => parseInt(i.blend_recipe_id) === recipeId);
        let minLimit = Infinity;
        ings.forEach(ing => {
            const g = (greenbeans || []).find(x => x.id === parseInt(ing.green_coffee_id));
            const avail = g ? (parseFloat(g.stock_kg) || 0) : 0;
            const ratio = parseFloat(ing.percentage) / 100;
            if (ratio > 0) minLimit = Math.min(minLimit, avail / ratio);
        });
        return minLimit === Infinity ? 0 : minLimit;
    }

    // ── Auto-proposal: packed → bulk → roasting waterfall ───────────────────
    // V2 3-tier fulfillment (explicit user request): the approver previously
    // had to work out "how much from packed, how much to production" by hand
    // for every line, with no visibility into the already-roasted bulk pool
    // (519kg+ sitting unused in production before this) — see the sales
    // order form's identical 3-tier work for the fuller rationale. This
    // computes the same packed → bulk → roasting waterfall the leader sees
    // as a ready-to-approve default, still fully overridable per item.

    // Every bulk_roasted_coffee row an item could draw from. Trade-name
    // items pool across every machine sharing the code — same rule
    // findMatchingPacked above already applies to packed stock for trade-
    // name items ("which origin/machine ends up filling the order is
    // decided at packing/dispatch, not here"); non-trade-name items stay
    // machine-partitioned. Post-blend/custom-blend bulk is excluded — a
    // different, ad-hoc product identity, same filter openCustomBlendModal's
    // bulkOptions and the sales order form's perMachineBulkKg both use.
    function findMatchingBulk(item) {
        const type = item.coffee_type;
        const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
        if (item.coffee_code) {
            const groupIds = type === 'Single'
                ? (greenbeans || []).filter(g => g.code === item.coffee_code).map(g => g.id)
                : (recipes || []).filter(r => r.code === item.coffee_code).map(r => r.id);
            return (bulkList || []).filter(b =>
                !b.is_post_blend && b.coffee_type === type &&
                groupIds.includes(type === 'Single' ? b.single_coffee_id : b.blend_recipe_id)
            );
        }
        return (bulkList || []).filter(b =>
            !b.is_post_blend && b.coffee_type === type &&
            (b.single_coffee_id === coffeeId || b.blend_recipe_id === coffeeId) &&
            b.machine_id === item.machine_id
        );
    }

    // FIFO-draws whole BAGS (not fractional kg — a partial bag can't be
    // packed) of `neededBags` across `matchingBulk`, oldest production_date
    // first, skipping kg already spoken for elsewhere. `claimedSoFarByBulkId`
    // is mutated in place so later calls in the same pass see earlier ones'
    // claims — same running-allocation pattern getBulkAllocations() uses in
    // the sales order form.
    function drawBulkFifoBags(matchingBulk, neededBags, sizeG, reservedElsewhereByBulkId, claimedSoFarByBulkId) {
        const sorted = [...matchingBulk].sort((a, b) => (a.production_date || '').localeCompare(b.production_date || '') || a.id - b.id);
        const draws = [];
        let remainingBags = neededBags;
        for (const b of sorted) {
            if (remainingBags <= 0) break;
            const total = parseFloat(b.bulk_available) || 0;
            const reserved = (reservedElsewhereByBulkId[b.id] || 0) + (claimedSoFarByBulkId[b.id] || 0);
            const freeKg = Math.max(0, total - reserved);
            const freeBags = Math.floor((freeKg * 1000) / sizeG);
            if (freeBags <= 0) continue;
            const takeBags = Math.min(freeBags, remainingBags);
            const takeKg = (takeBags * sizeG) / 1000;
            draws.push({ bulkId: b.id, kg: takeKg, bags: takeBags });
            claimedSoFarByBulkId[b.id] = (claimedSoFarByBulkId[b.id] || 0) + takeKg;
            remainingBags -= takeBags;
        }
        return { draws, coveredBags: neededBags - remainingBags };
    }

    // Kg already promised to OTHER orders (bulk_reservations, created by a
    // previous run of this same function) — this order's own reservations
    // (only possible on a retry after a partial failure; approveSalesOrder
    // otherwise only ever runs once per order) are excluded so it can't
    // self-block.
    const reservedElsewhereByBulkId = {};
    (bulkReservations || []).forEach(res => {
        const resItem = (orderItems || []).find(i => i.id === res.request_order_item_id);
        if (resItem && resItem.request_order_id === orderId) return;
        reservedElsewhereByBulkId[res.bulk_roasted_coffee_id] = (reservedElsewhereByBulkId[res.bulk_roasted_coffee_id] || 0) + (parseFloat(res.kg) || 0);
    });

    // One pass over this order's items, in the same order they'll render/
    // submit in, so a bulk row two lines both want gets FIFO-split between
    // them instead of both proposing the full amount.
    const claimedSoFarByBulkId = {};
    const proposals = {}; // item.id -> { packed, bulk, roast, bulkKg }
    for (const item of items) {
        const size = parseInt(item.bag_size_g);
        const requested = parseInt(item.quantity_requested) || 0;
        const matchingPackedForItem = findMatchingPacked(item);
        const szItemsForItem = (item.coffee_code || item.machine_id) ? matchingPackedForItem.filter(p => parseInt(p.bag_size_g) === size) : [];
        const packedStockForItem = szItemsForItem.reduce((acc, p) => acc + (parseInt(p.quantity) || 0), 0);

        const tierPacked = Math.min(requested, packedStockForItem);
        const remainingAfterPacked = Math.max(0, requested - tierPacked);
        const matchingBulk = findMatchingBulk(item);
        const { draws, coveredBags } = drawBulkFifoBags(matchingBulk, remainingAfterPacked, size, reservedElsewhereByBulkId, claimedSoFarByBulkId);
        const tierRoast = Math.max(0, remainingAfterPacked - coveredBags);

        proposals[item.id] = { packed: tierPacked, bulk: coveredBags, roast: tierRoast, bulkKg: draws.reduce((s, d) => s + d.kg, 0) };
    }

    let htmlContent = `
        <form id="modal-approve-form">
            <p style="margin-bottom: 15px; font-size: 0.9rem; color: var(--text-secondary);" data-i18n="msg_approve_desc">Review the order quantities. You can adjust the fulfilled amount or send the remainder to the production queue.</p>
            <div style="max-height: 50vh; overflow-y: auto; padding-right: 10px;">
    `;

    for (const item of items) {
        const type = item.coffee_type;
        const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
        const size = parseInt(item.bag_size_g);

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

        const matchingPacked = findMatchingPacked(item);
        const szItems = (item.coffee_code || item.machine_id) ? matchingPacked.filter(p => parseInt(p.bag_size_g) === size) : [];
        const packedStock = szItems.reduce((acc, p) => acc + (parseInt(p.quantity) || 0), 0);

        // Trade-name item: "Packed Stock" is a total across every origin
        // sharing the code — show which origin contributed how much, so the
        // approver isn't looking at an opaque combined number.
        let originBreakdownHtml = '';
        if (item.coffee_code) {
            const kgByOrigin = new Map();
            szItems.forEach(p => {
                const idn = resolvePackedIdentityForApproval(p);
                const label = idn ? (idn.name || 'Unknown') : 'Unknown';
                kgByOrigin.set(label, (kgByOrigin.get(label) || 0) + (parseInt(p.quantity) || 0));
            });
            const rows = Array.from(kgByOrigin.entries())
                .map(([name, qty]) => `<div style="display:flex; justify-content:space-between; padding:2px 0;"><span style="font-family:monospace;">${name}</span><span>${qty}</span></div>`)
                .join('');
            originBreakdownHtml = `
                <button type="button" class="breakdown-toggle" style="display:inline-flex; align-items:center; gap:4px; font-size:0.72rem; color:var(--text-muted); background:none; border:none; cursor:pointer; padding:2px 0; margin-top:6px; text-decoration:underline dotted;">ⓘ combined across ${kgByOrigin.size} origin${kgByOrigin.size === 1 ? '' : 's'}</button>
                <div class="breakdown-panel" style="display:none; margin-top:6px; padding:8px 10px; background:rgba(255,255,255,0.06); border-radius:6px; font-size:0.76rem; color:var(--text-secondary); grid-template-columns:1fr 1fr; column-gap:16px;">${rows || '<span style="color:var(--text-muted);">No packed stock yet.</span>'}</div>
            `;
        }

        // Auto-proposed packed/bulk/roasting split, computed above — shown
        // as a plain-language default the approver reviews and confirms,
        // not a pre-filled number they could rubber-stamp without reading
        // (that exact failure mode — an approver clicking Confirm without
        // touching a pre-filled "everything fulfilled" value — is what
        // caused a live incident 2026-07-27: a fresh order showed 20/20
        // "Ready for Handover" solely because old packed stock under the
        // same trade code happened to cover it, with nobody on the packing
        // team having done anything). The sentence itself is the thing
        // being confirmed here instead.
        const p = proposals[item.id];

        // Resolve machine name from item
        const itemMachine = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
        const machineLabel = itemMachine ? `<span style="font-size: 0.8rem; color: var(--primary); font-weight: 600;"> • ${itemMachine.name}</span>` : '';
        
        // Build machine options with pre-selection
        let itemMachineOptionsHtml = `<option value="">-- Select Machine --</option>`;
        (machines || []).forEach(m => {
            const selected = item.machine_id === m.id ? 'selected' : '';
            itemMachineOptionsHtml += `<option value="${m.id}" ${selected}>${m.name}</option>`;
        });
        
        // Trade-name item going to production: which SPECIFIC origin/recipe
        // sharing the code actually gets roasted was previously decided
        // silently by pickFifoOriginForCode/pickFifoRecipeForCode below, with
        // no leader input — this exposes that same FIFO pick as an editable
        // table of radio rows (pre-selected to the FIFO choice, but
        // overridable), one row per origin/recipe sharing the code, so the
        // leader can steer it — e.g. toward whichever has the most kg on
        // hand — with a Blend recipe's ingredient composition spelled out
        // right there instead of having to recognize it from the name alone.
        // Non-trade-name items have no ambiguity (single_coffee_id/
        // blend_recipe_id already fixed at order time) and get no row at all.
        let originRecipeRowHtml = '';
        if (item.coffee_code) {
            const radioName = `origin-recipe-${item.id}`;
            if (type === 'Single') {
                const codeOrigins = (greenbeans || []).filter(g => g.code === item.coffee_code);
                const defaultId = pickFifoOriginForCode(item.coffee_code);
                const rowsHtml = codeOrigins.map(g => {
                    const kg = parseFloat(g.stock_kg) || 0;
                    const checked = g.id === defaultId ? 'checked' : '';
                    return `
                        <tr class="origin-recipe-row" style="cursor:pointer; border-bottom: 1px solid var(--border-color);">
                            <td style="text-align:center; padding:6px; width:28px;"><input type="radio" name="${radioName}" class="sel-origin-recipe-radio" value="${g.id}" ${checked}></td>
                            <td style="padding:6px; font-weight:600;">${g.name}</td>
                            <td style="text-align:right; padding:6px 10px; font-family:monospace; white-space:nowrap;">${kg.toFixed(1)} kg</td>
                        </tr>
                    `;
                }).join('');
                originRecipeRowHtml = `
                    <div class="origin-select-row" style="margin-top: 12px; ${p.roast > 0 ? '' : 'display: none;'}">
                        <label class="form-label" style="font-size: 0.75rem;" data-i18n="lbl_which_origin_roast">Which origin to roast</label>
                        <div style="border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden; margin-top: 4px;">
                            <table style="width:100%; border-collapse: collapse; font-size: 0.78rem;"><tbody>${rowsHtml}</tbody></table>
                        </div>
                    </div>
                `;
            } else {
                const codeRecipes = (recipes || []).filter(r => r.code === item.coffee_code);
                const defaultId = pickFifoRecipeForCode(item.coffee_code);
                const rowsHtml = codeRecipes.map(r => {
                    const kg = recipeAvailKg(r.id);
                    const checked = r.id === defaultId ? 'checked' : '';
                    const composition = (ingredients || [])
                        .filter(i => parseInt(i.blend_recipe_id) === r.id)
                        .map(i => {
                            const g = (greenbeans || []).find(x => x.id === parseInt(i.green_coffee_id));
                            return g ? `${g.name} ${i.percentage}%` : null;
                        })
                        .filter(Boolean)
                        .join(' &middot; ');
                    return `
                        <tr class="origin-recipe-row" style="cursor:pointer; border-bottom: 1px solid var(--border-color);">
                            <td style="text-align:center; padding:6px; width:28px;"><input type="radio" name="${radioName}" class="sel-origin-recipe-radio" value="${r.id}" ${checked}></td>
                            <td style="padding:6px; font-weight:600;">${r.name}</td>
                            <td style="padding:6px; color:var(--text-muted); font-size:0.72rem;">${composition}</td>
                            <td style="text-align:right; padding:6px 10px; font-family:monospace; white-space:nowrap;">${kg.toFixed(1)} kg</td>
                        </tr>
                    `;
                }).join('');
                originRecipeRowHtml = `
                    <div class="origin-select-row" style="margin-top: 12px; ${p.roast > 0 ? '' : 'display: none;'}">
                        <label class="form-label" style="font-size: 0.75rem;" data-i18n="lbl_which_recipe_roast">Which recipe to roast</label>
                        <div style="border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden; margin-top: 4px;">
                            <table style="width:100%; border-collapse: collapse; font-size: 0.78rem;"><tbody>${rowsHtml}</tbody></table>
                        </div>
                    </div>
                `;
            }
        }

        // Plain-language default the approver reviews (not a pre-filled
        // form) — same tier vocabulary/colors as the sales order form's
        // 3-tier display (lbl_tier_ready/bulk/roast), so the two screens
        // read as one consistent system.
        const readyLbl = window.t ? window.t('lbl_tier_ready') : 'ready';
        const bulkTierLbl = window.t ? window.t('lbl_tier_bulk') : 'from bulk';
        const roastTierLbl = window.t ? window.t('lbl_tier_roast') : 'needs roasting';
        const summaryParts = [];
        if (p.packed > 0) summaryParts.push(`<span style="color:#5DCAA5; font-weight:700;">${p.packed}</span> ${readyLbl}`);
        if (p.bulk > 0) summaryParts.push(`<span style="color:#EF9F27; font-weight:700;">${p.bulk}</span> ${bulkTierLbl} <span style="color:var(--text-muted);">(${p.bulkKg.toFixed(1)}kg)</span>`);
        if (p.roast > 0) summaryParts.push(`<span style="color:#f0a3a3; font-weight:700;">${p.roast}</span> ${roastTierLbl}`);
        const summaryLine = summaryParts.length ? summaryParts.join(' &middot; ') : `<span style="color:var(--text-muted);">${window.t ? window.t('lbl_nothing_requested') : 'Nothing requested'}</span>`;
        const changeLbl = window.t ? window.t('btn_change_fulfillment') : 'Change fulfillment';

        htmlContent += `
            <div class="approval-item-row" data-id="${item.id}" data-proposed-packed="${p.packed}" data-proposed-bulk="${p.bulk}" data-proposed-roast="${p.roast}" style="background: rgba(0,0,0,0.02); border: 1px solid var(--border-color); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <div style="font-weight: bold; margin-bottom: 8px; color: var(--text-primary);">${coffeeName} - ${size}g${machineLabel}</div>
                <div style="display: flex; gap: 20px; font-size: 0.85rem; align-items: center;">
                    <div class="flex-1">
                        <span style="color: var(--text-secondary);" data-i18n="lbl_requested">Requested:</span> <strong>${item.quantity_requested}</strong>
                    </div>
                    <div class="flex-1">
                        <span style="color: var(--text-secondary);" data-i18n="lbl_packed_stock">Packed Stock:</span> <strong style="${packedStock < item.quantity_requested ? 'color: var(--danger);' : ''}">${packedStock}</strong>
                    </div>
                </div>
                ${originBreakdownHtml}

                <div class="fulfillment-summary" style="margin-top: 12px; font-size: 0.85rem; line-height: 1.7;">${summaryLine}</div>
                <button type="button" class="btn btn-secondary btn-sm btn-toggle-fulfillment" style="margin-top: 8px; font-size: 0.72rem; padding: 4px 10px;">${changeLbl}</button>

                <div class="fulfillment-edit-panel hidden" style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-color);">
                    <div style="display: flex; gap: 12px; align-items: flex-end;">
                        <div class="flex-1">
                            <label class="form-label" style="font-size: 0.75rem;" data-i18n="lbl_fulfill_packed">Fulfill from Packed</label>
                            <input type="number" class="form-control inp-fulfill" min="0" max="${packedStock}" value="${p.packed}" required>
                        </div>
                        <div class="flex-1">
                            <label class="form-label" style="font-size: 0.75rem;" data-i18n="lbl_fulfill_bulk">Fulfill from Bulk</label>
                            <input type="number" class="form-control inp-bulk" min="0" value="${p.bulk}" required>
                        </div>
                        <div class="flex-1">
                            <label class="form-label" style="font-size: 0.75rem;" data-i18n="lbl_send_prod">Send to Production</label>
                            <input type="number" class="form-control inp-prod" min="0" value="${p.roast}" required>
                        </div>
                    </div>
                </div>

                <div class="machine-select-row" style="margin-top: 12px; ${p.roast > 0 ? '' : 'display: none;'}">
                    <label class="form-label" style="font-size: 0.75rem;">Machine for Production</label>
                    <select class="form-control sel-machine" style="padding: 6px 10px;">
                        ${itemMachineOptionsHtml}
                    </select>
                </div>
                ${originRecipeRowHtml}
            </div>
        `;
    }
    
    htmlContent += `
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--border-color);">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                <button type="submit" class="btn btn-primary" data-i18n="btn_confirm_approve">Confirm Approval</button>
            </div>
        </form>
    `;
    
    openModal(window.t ? window.t('modal_approve_order') : 'Approve Order', htmlContent);

    // Swaps the read-only proposal sentence for the 3-input manual edit
    // panel (and back). Re-syncs the machine/origin rows' visibility to
    // whatever the panel's current "Send to Production" value is every time
    // it's revealed, since the summary view doesn't keep them in sync while
    // hidden.
    document.querySelectorAll('.approval-item-row .btn-toggle-fulfillment').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest('.approval-item-row');
            const summary = row.querySelector('.fulfillment-summary');
            const panel = row.querySelector('.fulfillment-edit-panel');
            const enteringEdit = panel.classList.contains('hidden');
            panel.classList.toggle('hidden', !enteringEdit);
            summary.classList.toggle('hidden', enteringEdit);
            btn.textContent = enteringEdit
                ? (window.t ? window.t('btn_use_suggestion') : 'Use suggestion')
                : (window.t ? window.t('btn_change_fulfillment') : 'Change fulfillment');

            const machineRow = row.querySelector('.machine-select-row');
            const originRow = row.querySelector('.origin-select-row');
            const prodVal = parseInt(row.querySelector('.inp-prod').value) || 0;
            machineRow.style.display = prodVal > 0 ? '' : 'none';
            if (originRow) originRow.style.display = prodVal > 0 ? '' : 'none';
        });
    });

    // Toggle machine dropdown (and origin/recipe dropdown, for trade-name
    // items) visibility when inp-prod changes
    document.querySelectorAll('.approval-item-row .inp-prod').forEach(inp => {
        inp.addEventListener('input', function() {
            const row = this.closest('.approval-item-row');
            const machineRow = row.querySelector('.machine-select-row');
            const originRow = row.querySelector('.origin-select-row');
            const val = parseInt(this.value) || 0;
            machineRow.style.display = val > 0 ? '' : 'none';
            if (originRow) originRow.style.display = val > 0 ? '' : 'none';
        });
    });

    // Clicking anywhere in an origin/recipe table row selects its radio
    // (not just the radio itself) and highlights the selected row so the
    // pick is obvious at a glance.
    document.querySelectorAll('.approval-item-row .origin-select-row').forEach(container => {
        const rows = container.querySelectorAll('.origin-recipe-row');
        function refreshHighlight() {
            rows.forEach(row => {
                const radio = row.querySelector('.sel-origin-recipe-radio');
                row.style.background = radio && radio.checked ? 'var(--primary-glow)' : '';
            });
        }
        rows.forEach(row => {
            row.addEventListener('click', () => {
                const radio = row.querySelector('.sel-origin-recipe-radio');
                if (radio) radio.checked = true;
                refreshHighlight();
            });
        });
        refreshHighlight();
    });

    // Toggle the per-origin breakdown for trade-name items
    document.querySelectorAll('.approval-item-row .breakdown-toggle').forEach(btn => {
        btn.addEventListener('click', function() {
            const panel = this.nextElementSibling;
            const isOpen = panel.style.display === 'grid';
            panel.style.display = isOpen ? 'none' : 'grid';
        });
    });
    
    document.getElementById('modal-approve-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const rows = document.querySelectorAll('.approval-item-row');

        // Fresh claim ledger for THIS submit — deliberately not reusing
        // claimedSoFarByBulkId from the render-time proposal above, since
        // the leader may have edited numbers after the proposal was first
        // shown (see .inp-bulk below); recomputing here is what makes the
        // final reservation correct regardless of whether any row was
        // touched.
        const claimedAtSubmitByBulkId = {};

        for (const r of rows) {
            const itemId = parseInt(r.getAttribute('data-id'));
            const fQty = parseInt(r.querySelector('.inp-fulfill').value) || 0;
            const bQtyRequested = parseInt(r.querySelector('.inp-bulk').value) || 0;
            const pQty = parseInt(r.querySelector('.inp-prod').value) || 0;
            const selMachine = r.querySelector('.sel-machine');
            const machineId = selMachine ? (parseInt(selMachine.value) || null) : null;

            const item = orderItems.find(i => i.id === itemId);
            if (!item) continue;

            // Re-run the packed→bulk waterfall's bulk step against whatever
            // the FINAL bulk-bag count is (the proposal's own number if the
            // leader never opened "Change fulfillment", or their manual
            // override) — same drawBulkFifoBags helper the proposal used,
            // so an untouched item reserves EXACTLY what was shown.
            const matchingBulk = findMatchingBulk(item);
            const size = parseInt(item.bag_size_g);
            const { draws: bulkDraws, coveredBags: bQty } = drawBulkFifoBags(matchingBulk, bQtyRequested, size, reservedElsewhereByBulkId, claimedAtSubmitByBulkId);

            item.quantity_allocated = fQty;
            // Everything not covered by packed stock — whether it's sitting
            // as bulk waiting to be packed, or still needs roasting first —
            // is "pending" in the same sense this field already carried
            // before bulk existed (how much this item still needs before
            // it's fully packed).
            item.quantity_pending = bQty + pQty;
            // Credit the stock-fulfilled portion as already "prepared" — it's
            // deducted from packed_coffee below, so js/packing.js's Pending
            // Pack / Ready button must not ask for (and re-deduct) it again.
            // Without this, quantity_prepared stayed 0 here and
            // markOrderItemReady later treated the FULL quantity_requested as
            // still needing packing, double-deducting stock for the fQty
            // that was already fulfilled at approval (confirmed 2026-07-16 by
            // reproducing it live: a fully stock-fulfilled item still showed
            // "Pending Pack" for its whole quantity, and clicking Ready
            // deducted packed_coffee a second time for the same units).
            item.quantity_prepared = fQty;
            item.item_status = fQty >= (parseInt(item.quantity_requested) || 0)
                ? 'Ready for Handover'
                : (pQty > 0 ? 'Planned' : 'Packing');

            await saveData('request_order_items', item);
            
            // Deduct packed stock. Non-trade-name items are machine-
            // partitioned (confirmed 2026-07-15): findMatchingPacked already
            // restricts them to the SAME machine the item requested, so
            // szItems is always exactly one row and this is just that row's
            // own lots in date order (unchanged behavior). Trade-name
            // (coffee_code) items intentionally pool across every machine
            // sharing the code (see findMatchingPacked/findMatchingBulk
            // above) — "which origin/machine ends up filling the order" is
            // deferred to packing/dispatch, not decided here.
            //
            // What WAS missing for the pooled case: draws happened row-by-row
            // (fully drain one packed_coffee row before touching the next) in
            // whatever order fetch returned them — not FIFO. Found 2026-08-22
            // via a live repro: a GIESEN-tagged order line drew from
            // STRONGHOLD stock instead while GIESEN's own stock sat
            // untouched. Sorting the ROWS by oldest date isn't enough either
            // — two rows can tie on their oldest lot's date while one of them
            // only has a handful of pcs left at that date, so draining it
            // first still skips over an equally-old lot sitting in the other
            // row. The only correct fix is to flatten every pooled row's live
            // lots into ONE list and sort THAT by date, so the draw crosses
            // rows/machines exactly when the calendar says it should.
            if (fQty > 0) {
                const matchingPacked = findMatchingPacked(item);
                const szItems = (item.coffee_code || item.machine_id) ? matchingPacked.filter(p => parseInt(p.bag_size_g) === parseInt(item.bag_size_g)) : [];
                const szItemById = new Map(szItems.map(p => [p.id, p]));

                const drawLots = szItems
                    .flatMap(p => (packedCoffeeLots || []).filter(l => l.packed_coffee_id === p.id && (parseInt(l.remaining_pcs) || 0) > 0))
                    .sort((a, b) => (a.packed_date || '').localeCompare(b.packed_date || '') || a.id - b.id);

                let remainingDeduct = fQty;
                for (const lot of drawLots) {
                    if (remainingDeduct <= 0) break;
                    const lotAvail = parseInt(lot.remaining_pcs) || 0;
                    if (lotAvail <= 0) continue;
                    // Atomic RPC (STOCK_LEDGER_PLAN.md Phase 1) — packed_coffee_lots
                    // is the FIFO source of truth the dispatch checkout modal reads;
                    // without this, fulfilling an order from existing stock at
                    // approval time would leave every lot's remaining_pcs stale/
                    // overstated so checkout could still offer units already
                    // consumed here (found 2026-07-27). Previously a plain
                    // read-modify-write, which is exactly what let two concurrent
                    // approvals (or an approval racing a checkout) silently
                    // under-deduct a shared lot (found 2026-08-22).
                    const { data: taken, error: consumeErr } = await window.supabaseClient.rpc('consume_packed_lot', {
                        p_lot_id: lot.id, p_pcs: remainingDeduct,
                        p_operation: 'approval_fulfil', p_ref_table: 'request_order_items', p_ref_id: item.id,
                        p_user: (currentUser && currentUser.name) || null
                    });
                    if (consumeErr) { console.error('consume_packed_lot RPC failed:', consumeErr); continue; }
                    const take = parseInt(taken) || 0;
                    if (take <= 0) continue;
                    lot.remaining_pcs = lotAvail - take;
                    remainingDeduct -= take;

                    // In-memory only — packed_coffee.quantity is trigger-
                    // derived from the RPC write above
                    // (sync_packed_coffee_quantity). Tracked here purely so a
                    // later item in the SAME approval batch sees this row's
                    // reduced total (packedGoods/matchingPacked is fetched
                    // once for the whole function, not re-queried per item).
                    const parentRow = szItemById.get(lot.packed_coffee_id);
                    if (parentRow) parentRow.quantity = Math.max(0, (parseInt(parentRow.quantity) || 0) - take);
                }
            }

            // Reserve the bulk portion — purely a bookkeeping claim (see
            // bulk_reservations table comment): does NOT touch
            // bulk_available, so it doesn't double-count against the
            // physical stock deduction above. Physical bulk only actually
            // moves once someone really packs it (js/packing.js
            // openPackBulkModal), which is also where the matching
            // reservation should be released.
            for (const d of bulkDraws) {
                await saveData('bulk_reservations', {
                    bulk_roasted_coffee_id: d.bulkId,
                    request_order_item_id: item.id,
                    kg: d.kg
                });
            }

            // Create Roast Plan (Pending - not auto-executed)
            if (pQty > 0) {
                const weightKg = (pQty * parseInt(item.bag_size_g)) / 1000;
                // Add a buffer for yield (roughly / 0.85)
                const targetRoast = weightKg / 0.85;

                // Trade-name item: roasting always targets one concrete
                // origin/recipe. Prefers the leader's explicit pick from the
                // .sel-origin-recipe-radio table (rendered above, defaulted
                // to the FIFO choice but overridable); falls back to the
                // FIFO pick itself only if that control isn't present for
                // some reason (e.g. the code had zero matching origins/
                // recipes at render time) — same safety net the old
                // always-FIFO behavior provided. item.single_coffee_id/
                // blend_recipe_id are both null for a trade-name item, so
                // exactly one of these two resolves to a real id and the
                // other must stay null — never both.
                let planSingleCoffeeId = item.single_coffee_id;
                let planBlendRecipeId = item.blend_recipe_id;
                if (item.coffee_code) {
                    const selOriginRecipe = r.querySelector('.sel-origin-recipe-radio:checked');
                    const chosenId = selOriginRecipe ? (parseInt(selOriginRecipe.value) || null) : null;
                    if (item.coffee_type === 'Blend') {
                        planBlendRecipeId = chosenId || pickFifoRecipeForCode(item.coffee_code);
                    } else {
                        planSingleCoffeeId = chosenId || pickFifoOriginForCode(item.coffee_code);
                    }
                }

                const planRecord = {
                    day: new Date().toLocaleDateString('en-US', {weekday:'long'}),
                    plan_date: new Date().toISOString().split('T')[0],
                    coffee_type: item.coffee_type,
                    single_coffee_id: planSingleCoffeeId,
                    blend_recipe_id: planBlendRecipeId,
                    machine_id: machineId || item.machine_id || null,
                    target_roasted_kg: parseFloat(targetRoast.toFixed(2)),
                    fulfilled_roasted_kg: 0.0,
                    status: 'Pending',
                    order_ref: order.order_number || `#ORD-${order.id}`,
                    request_order_item_id: item.id
                };
                await saveData('roasting_plans', planRecord);
            }
        }
        
        order.status = 'Preparing';
        await saveData('request_orders', order);
        
        modalContainer.classList.add('hidden');
        
        loadHandoverSection();
        scheduleDashboardRefresh();
    });
}

// ============================================================
// SYNC PLAN STATUS → ORDER ITEM STATUS
// ============================================================
async function syncPlanStatusToOrderItem(plan) {
    if (!plan.request_order_item_id) return; // Only for request-linked plans
    
    const { data: orderItems } = await fetchData('request_order_items');
    const item = (orderItems || []).find(i => i.id === plan.request_order_item_id);
    if (!item) return;
    
    const statusMap = {
        'Pending': 'Planned',
        'On Process': 'Roasting',
        'Completed': 'Packing'
    };
    
    const newStatus = statusMap[plan.status];
    if (newStatus && item.item_status !== newStatus && item.item_status !== 'Ready for Handover') {
        item.item_status = newStatus;
        await saveData('request_order_items', item);
    }
}

function getItemStatusBadge(itemStatus) {
    const s = itemStatus || 'Pending';
    if (s === 'Ready for Handover' || s === 'Ready') {
        return `<span style="color: var(--success); font-weight: bold; font-size: 0.8rem; display:inline-flex; align-items:center; gap:4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Ready
        </span>`;
    }
    if (s === 'Planned') {
        return `<span style="color: #8b5cf6; font-weight: bold; font-size: 0.8rem; display:inline-flex; align-items:center; gap:4px;">
            <span style="display:inline-block; width:6px; height:6px; background:#8b5cf6; border-radius:50%;"></span> Planned
        </span>`;
    }
    if (s === 'Roasting') {
        return `<span style="color: #f59e0b; font-weight: bold; font-size: 0.8rem; display:inline-flex; align-items:center; gap:4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/></svg> Roasting
        </span>`;
    }
    if (s === 'Packing') {
        return `<span style="color: #3b82f6; font-weight: bold; font-size: 0.8rem; display:inline-flex; align-items:center; gap:4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> Packing
        </span>`;
    }
    // Default for Pending Approval etc
    return `<span style="color: var(--text-muted); font-weight: bold; font-size: 0.8rem; display:inline-flex; align-items:center; gap:4px;">
        <span style="display:inline-block; width:6px; height:6px; background:var(--text-muted); border-radius:50%;"></span> ${s}
    </span>`;
}

// Add// Add sales request modal
document.getElementById('btn-create-request').addEventListener('click', async () => {
    await openSalesRequestModal();
});

async function openSalesRequestModal(orderId = null) {
    const [
        { data: greenbeans },
        { data: recipes },
        { data: ingredients },
        { data: agents },
        { data: requestOrders },
        { data: requestOrderItems },
        { data: packed },
        { data: roastBatches },
        { data: machines },
        { data: packagingSizes },
        { data: codeDefinitions },
        { data: bulkList },
        { data: bulkReservations }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('blend_ingredients'),
        fetchData('sales_agents'),
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('machines'),
        fetchData('packaging_sizes'),
        fetchData('code_definitions'),
        fetchData('bulk_roasted_coffee'),
        fetchData('bulk_reservations')
    ]);

    // Trade-name grouping (V2): Sales only orders by code_definitions.name —
    // one green_coffee.code can be shared by multiple origins (e.g. code 2 =
    // both Cauca and Chambaku under trade name "Fantastica"), and which
    // origin actually fulfills the order is decided later at packing/dispatch
    // (see openDispatchCheckoutModal in js/packing.js). Coffees whose code
    // has no matching code_definitions row simply aren't sales-orderable yet.
    const codeGroups = {}; // code -> { name, ids: [...] }
    (greenbeans || []).forEach(g => {
        if (!g.code) return;
        const def = (codeDefinitions || []).find(d => d.code === g.code);
        if (!def) return;
        if (!codeGroups[g.code]) codeGroups[g.code] = { name: def.name, ids: [] };
        codeGroups[g.code].ids.push(g.id);
    });

    // Same trade-name grouping, for Blend recipes — a recipe's own code is
    // resolved exactly the same way a coffee_definitions row already grouped
    // the Single side (see renderCodeDefinitionsRows in js/roasting.js, which
    // already shows both under one code). Which RECIPE actually fulfills the
    // order is decided at packing/dispatch, same deferral as Single origins.
    const blendCodeGroups = {}; // code -> { name, ids: [recipeId...] }
    (recipes || []).forEach(r => {
        if (!r.code) return;
        const def = (codeDefinitions || []).find(d => d.code === r.code);
        if (!def) return;
        if (!blendCodeGroups[r.code]) blendCodeGroups[r.code] = { name: def.name, ids: [] };
        blendCodeGroups[r.code].ids.push(r.id);
    });

    let existingOrder = null;
    let existingItems = [];
    if (orderId !== null) {
        existingOrder = (requestOrders || []).find(o => o.id === orderId);
        existingItems = (requestOrderItems || []).filter(i => i.request_order_id === orderId);
    }

    // ── Layer 1: Build packed stock snapshot (per-machine + aggregate) ────────
    const originalPackedStocks = {};      // aggregate: {type}-{coffeeId}-{size}
    const perMachinePackedStocks = {};    // per-machine: {type}-{coffeeId}-{size}-{machineId}
    
    (packed || []).forEach(p => {
        let coffeeType = null, cId = null, machineId = null;
        
        if (p.roast_batch_id) {
            const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
            if (batch) {
                coffeeType = batch.coffee_type;
                cId = coffeeType === 'Single' ? batch.single_coffee_id : batch.blend_recipe_id;
                machineId = batch.machine_id || null;
            }
        }
        if (!coffeeType && p.custom_coffee_name) {
            const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
            const matchGb = (greenbeans || []).find(g => g.name === cleanName);
            if (matchGb) {
                coffeeType = 'Single';
                cId = matchGb.id;
            } else {
                const matchRec = (recipes || []).find(r => r.name === cleanName);
                if (matchRec) {
                    coffeeType = 'Blend';
                    cId = matchRec.id;
                }
            }
            machineId = p.machine_id || null;
        }
        
        if (coffeeType && cId) {
            const qty = parseInt(p.quantity) || 0;
            // Aggregate key (all machines)
            const aggKey = `${coffeeType}-${cId}-${p.bag_size_g}`;
            originalPackedStocks[aggKey] = (originalPackedStocks[aggKey] || 0) + qty;
            // Per-machine key
            if (machineId) {
                const mKey = `${coffeeType}-${cId}-${p.bag_size_g}-${machineId}`;
                perMachinePackedStocks[mKey] = (perMachinePackedStocks[mKey] || 0) + qty;
            }
        }
    });

    // Subtract committed (Pending / Preparing) orders from packed stock —
    // tracked both in aggregate and per-machine (machine-partitioned, same
    // rule as everywhere else: another order's claim on machine A's stock
    // must not reduce what THIS order's machine-B row shows as available).
    const activeOrders = (requestOrders || []).filter(o => ['Pending Approval', 'Preparing'].includes(o.status));
    const activeOrderIds = activeOrders.map(o => o.id);
    const committedPackedMap = {};
    const committedPackedMapByMachine = {};
    (requestOrderItems || []).forEach(item => {
        if (activeOrderIds.includes(item.request_order_id)) {
            if (orderId !== null && item.request_order_id === orderId) return;
            const cId = item.coffee_type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
            // A fully-handed-over item commits nothing further, regardless of
            // its (possibly legitimately 0) quantity_pending. Otherwise use
            // quantity_pending if it's been set at all — including a real 0,
            // which `|| quantity_requested` used to wrongly treat as "not set"
            // (0 is falsy in JS) and fall back to the full original request,
            // over-committing stock for orders that don't need any more of it
            // (found live 2026-07-16: a "Ready for Handover" item with
            // quantity_pending=0 was still reserving quantity_requested).
            const qty = item.item_status === 'Ready for Handover'
                ? 0
                : (item.quantity_pending != null ? (parseInt(item.quantity_pending) || 0) : (parseInt(item.quantity_requested) || 0));
            const key = `${item.coffee_type}-${cId}-${item.bag_size_g}`;
            committedPackedMap[key] = (committedPackedMap[key] || 0) + qty;
            if (item.machine_id) {
                const mKey = `${key}-${item.machine_id}`;
                committedPackedMapByMachine[mKey] = (committedPackedMapByMachine[mKey] || 0) + qty;
            }
        }
    });

    Object.keys(originalPackedStocks).forEach(k => {
        originalPackedStocks[k] = Math.max(0, originalPackedStocks[k] - (committedPackedMap[k] || 0));
    });
    Object.keys(perMachinePackedStocks).forEach(k => {
        perMachinePackedStocks[k] = Math.max(0, perMachinePackedStocks[k] - (committedPackedMapByMachine[k] || 0));
    });

    // ── Build bulk (already-roasted, not-yet-packed) stock snapshot, per
    // coffee+machine in KG — not size-partitioned like packed stock,
    // since bulk hasn't been portioned into bag sizes yet (see V2 "3-tier
    // stock" work: sales previously only saw packed stock + raw green bean
    // potential, with the entire already-roasted bulk pool invisible —
    // orders that could be fulfilled same-day by packing existing bulk were
    // silently sent through the full roasting queue instead). Post-blend/
    // custom-blend bulk is a different, ad-hoc product identity (no
    // single_coffee_id/blend_recipe_id in the ad-hoc case) and is excluded,
    // same filter openCustomBlendModal's bulkOptions already uses.
    const perMachineBulkKg = {}; // {type}-{coffeeId}-{machineId} -> kg
    (bulkList || []).forEach(b => {
        if (b.is_post_blend) return;
        const avail = parseFloat(b.bulk_available) || 0;
        if (avail <= 0.005) return;
        const cId = b.coffee_type === 'Single' ? b.single_coffee_id : b.blend_recipe_id;
        if (!cId || !b.machine_id) return;
        const key = `${b.coffee_type}-${cId}-${b.machine_id}`;
        perMachineBulkKg[key] = (perMachineBulkKg[key] || 0) + avail;
    });

    // Subtract kg already reserved for OTHER orders (bulk_reservations,
    // created at approval time — see approveSalesOrder) so a second order
    // can't be shown/offered the same bulk a first order already claimed.
    // This order's own reservations (when editing an already-approved
    // order) are excluded, same "don't self-block" rule committedPackedMap
    // above already applies via the `orderId` check.
    const bulkById = {};
    (bulkList || []).forEach(b => { bulkById[b.id] = b; });
    (bulkReservations || []).forEach(res => {
        const resItem = (requestOrderItems || []).find(i => i.id === res.request_order_item_id);
        if (orderId !== null && resItem && resItem.request_order_id === orderId) return;
        const b = bulkById[res.bulk_roasted_coffee_id];
        if (!b) return;
        const cId = b.coffee_type === 'Single' ? b.single_coffee_id : b.blend_recipe_id;
        if (!cId || !b.machine_id) return;
        const key = `${b.coffee_type}-${cId}-${b.machine_id}`;
        if (perMachineBulkKg[key] !== undefined) {
            perMachineBulkKg[key] = Math.max(0, perMachineBulkKg[key] - (parseFloat(res.kg) || 0));
        }
    });

    // ── Layer 3: Calculate Greenbean Allocations from OTHER rows ────────────
    function getGreenbeanAllocations(excludeRow = null) {
        const gbAlloc = {};
        const rows = document.getElementById('sales-items-list').querySelectorAll('.sales-item-row');
        rows.forEach(row => {
            if (row === excludeRow) return;
            const sel = row.querySelector('.item-select');
            const qtyEl = row.querySelector('.item-qty');
            const sizeEl = row.querySelector('.item-size');
            if (!sel || !sel.value) return;
            const qty = parseInt(qtyEl.value) || 0;
            if (qty <= 0) return;
            
            const sizeG = parseInt(sizeEl.value) || 250;
            const requiredKg = (qty * sizeG) / 1000 / 0.85;

            const [type, idStr] = sel.value.split('-');
            const coffeeId = idStr.startsWith('CODE:') ? idStr : parseInt(idStr);

            if (type === 'Single') {
                gbAlloc[coffeeId] = (gbAlloc[coffeeId] || 0) + requiredKg;
            } else if (String(coffeeId).startsWith('CODE:')) {
                // Blend trade-name: no single recipe is committed to yet
                // (that's decided at packing/dispatch), so every recipe
                // sharing the code gets its own ratio-based allocation
                // reserved — matches the same "any of them could be the one
                // chosen" symmetry getPotentialBags' MAX-across-recipes
                // capacity check below relies on.
                const code = String(coffeeId).slice(5);
                (recipes || []).filter(rec => rec.code === code).forEach(r => allocateForRecipe(r, requiredKg, gbAlloc));
            } else {
                const r = (recipes || []).find(rec => rec.id === coffeeId);
                if (r) allocateForRecipe(r, requiredKg, gbAlloc);
            }
        });
        return gbAlloc;
    }

    function allocateForRecipe(r, requiredKg, gbAlloc) {
        const ings = (ingredients || []).filter(i => parseInt(i.blend_recipe_id) === r.id);
        ings.forEach(ing => {
            const gbId = parseInt(ing.green_coffee_id);
            const ratio = parseFloat(ing.percentage) / 100;
            gbAlloc[gbId] = (gbAlloc[gbId] || 0) + (requiredKg * ratio);
        });
    }

    function getPotentialBags(type, coffeeId, sizeG, gbAllocFromOtherRows = {}) {
        let maxGbKg = 0;
        if (type === 'Single') {
            // A code-group id ("CODE:2") aggregates raw stock across every
            // origin sharing that code instead of one specific green_coffee.
            const matches = String(coffeeId).startsWith('CODE:')
                ? (greenbeans || []).filter(g => g.code === String(coffeeId).slice(5))
                : (greenbeans || []).filter(g => g.id === coffeeId);
            const avail = matches.reduce((s, g) => s + (parseFloat(g.stock_kg) || 0), 0);
            const claimed = gbAllocFromOtherRows[coffeeId] || 0;
            maxGbKg = Math.max(0, avail - claimed);
        } else if (String(coffeeId).startsWith('CODE:')) {
            // Blend trade-name: unlike Single (where origins under one code
            // are fungible raw material and their kg simply SUMS), a bag is
            // made from ONE recipe's fixed ratio — you can't combine two
            // different formulas into one batch. Capacity is therefore the
            // MAX across recipes sharing the code (whichever one is
            // eventually chosen only needs itself to have enough stock), not
            // their sum.
            const code = String(coffeeId).slice(5);
            const matchingRecipes = (recipes || []).filter(rec => rec.code === code);
            maxGbKg = matchingRecipes.reduce((best, r) => Math.max(best, maxGbKgForRecipe(r, gbAllocFromOtherRows)), 0);
        } else {
            const r = (recipes || []).find(rec => rec.id === coffeeId);
            if (r) maxGbKg = maxGbKgForRecipe(r, gbAllocFromOtherRows);
        }
        return Math.floor((maxGbKg * 0.85 * 1000) / sizeG);
    }

    function maxGbKgForRecipe(r, gbAllocFromOtherRows) {
        const ings = (ingredients || []).filter(i => parseInt(i.blend_recipe_id) === r.id);
        let minLimit = Infinity;
        ings.forEach(ing => {
            const gbId = parseInt(ing.green_coffee_id);
            const g = (greenbeans || []).find(x => x.id === gbId);
            const totalAvail = g ? parseFloat(g.stock_kg) : 0;
            const claimed = gbAllocFromOtherRows[gbId] || 0;
            const avail = Math.max(0, totalAvail - claimed);

            const ratio = parseFloat(ing.percentage) / 100;
            if (ratio > 0) minLimit = Math.min(minLimit, avail / ratio);
        });
        return minLimit === Infinity ? 0 : minLimit;
    }

    // ── Generate dropdowns ───────────────────────────────────────────────────
    const singleLbl = window.t ? window.t('opt_req_single') : 'Single Origin';
    const blendLbl = window.t ? window.t('opt_req_blend') : 'Blend';
    let coffeeOptionsHtml = `<option value="" disabled selected>-- Select Item --</option>`;
    coffeeOptionsHtml += `<optgroup label="${singleLbl}">`;
    coffeeOptionsHtml += Object.entries(codeGroups)
        .sort((a, b) => a[1].name.localeCompare(b[1].name))
        .map(([code, grp]) => `<option value="Single-CODE:${code}">${grp.name}</option>`)
        .join('');
    coffeeOptionsHtml += `</optgroup>`;
    // Grouped by trade name exactly like Single above (blendCodeGroups) —
    // a recipe with no matching code_definitions row isn't sales-orderable,
    // same rule as an uncoded green_coffee origin.
    coffeeOptionsHtml += `<optgroup label="${blendLbl}">`;
    coffeeOptionsHtml += Object.entries(blendCodeGroups)
        .sort((a, b) => a[1].name.localeCompare(b[1].name))
        .map(([code, grp]) => `<option value="Blend-CODE:${code}">${grp.name}</option>`)
        .join('');
    coffeeOptionsHtml += `</optgroup>`;

    // Machine options
    let machineOptionsHtml = `<option value="" disabled selected>-- Machine --</option>`;
    machineOptionsHtml += (machines || []).map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    // Bag size options — read from the configurable Packaging Sizes table
    // (Settings > Production) instead of a hardcoded 250/500/1000g list, so
    // this reflects whatever sizes the admin actually set up (e.g. 250g/1kg/5kg).
    const visibleSizes = (packagingSizes || [])
        .filter(s => s.is_visible)
        .sort((a, b) => (parseFloat(a.gram) || 0) - (parseFloat(b.gram) || 0));
    const sizeOptionsHtml = visibleSizes.map(s => `<option value="${s.gram}">${s.label}</option>`).join('');

    // Customer options
    const { data: customersList } = await fetchData('customers');
    let customerOptionsHtml = '';
    const whlCustomers = (customersList || []).filter(c => c.type === 'Wholesale' && c.is_active !== false);
    const rtlCustomers = (customersList || []).filter(c => c.type === 'Retail' && c.is_active !== false);
    if (whlCustomers.length) {
        customerOptionsHtml += '<optgroup label="🏭 Wholesale">';
        customerOptionsHtml += whlCustomers.map(c => `<option value="${c.id}" ${existingOrder?.customer_id === c.id ? 'selected' : ''}>${c.customer_id} - ${c.name}</option>`).join('');
        customerOptionsHtml += '</optgroup>';
    }
    if (rtlCustomers.length) {
        customerOptionsHtml += '<optgroup label="☕ Retail">';
        customerOptionsHtml += rtlCustomers.map(c => `<option value="${c.id}" ${existingOrder?.customer_id === c.id ? 'selected' : ''}>${c.customer_id} - ${c.name}</option>`).join('');
        customerOptionsHtml += '</optgroup>';
    }

    const html = `
        <form id="modal-request-form" novalidate>
            <div class="form-group">
                <label class="form-label" data-i18n="lbl_req_order_no">Order Number</label>
                <input type="text" id="m-req-orderno" class="form-control" readonly placeholder="Auto Generated" data-i18n-placeholder="ph_req_auto_gen" value="${existingOrder ? existingOrder.order_number : ''}">
            </div>
            <!-- Sales agent is the logged-in user, filled automatically. Kept as a
                 hidden field so order-number generation and submit still read it. -->
            <input type="hidden" id="m-req-sales" value="${existingOrder ? existingOrder.sales_name : (currentUser ? currentUser.name : '')}">
            <div class="form-group mt-25" >
                <label class="form-label">Customer</label>
                <select id="m-req-customer" class="form-control" required>
                    <option value="" disabled selected>-- Select Customer --</option>
                    ${customerOptionsHtml}
                </select>
            </div>
            
            <div class="form-group mt-3" >
                <label class="form-label" data-i18n="lbl_req_items_list">Order Items</label>
                <div id="sales-items-list" style="max-height: 45vh; overflow-y: auto; padding-right: 12px; margin-right: -4px;">
                    <!-- Dynamic Rows -->
                </div>
                <button type="button" id="btn-add-sales-item" class="btn btn-secondary btn-sm" style="margin-top: 10px; width: 100%;">
                    + <span data-i18n="btn_add_another_item">Add Another Item</span>
                </button>
            </div>

            <div class="form-group">
                <label class="form-label" data-i18n="lbl_req_notes">Order Notes / Customer Info</label>
                <input type="text" id="m-req-notes" class="form-control" placeholder="e.g. Customer Coffee Shop Gayo" data-i18n-placeholder="ph_req_notes" value="${existingOrder ? (existingOrder.notes || '') : ''}">
            </div>

            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">${orderId !== null ? 'Save Edit' : 'Submit Request'}</button>
            </div>
        </form>
    `;

    const titleStr = orderId !== null ? 'Edit Sales Request' : 'Submit Sales Request Order';
    openModal(titleStr, html, '800px');

    const itemsList = document.getElementById('sales-items-list');
    const agentInput = document.getElementById('m-req-sales');
    const orderNoInput = document.getElementById('m-req-orderno');

    // ── Order Number Generation ──────────────────────────────────────────────
    // The sales agent is now the logged-in user (hidden, prefilled) rather than a
    // typed field, so generate the order number once on open instead of on input.
    if (!existingOrder) {
        const name = agentInput.value.trim();
        if (name) {
            let agentCode = 'AG';
            const existing = (agents || []).find(a => a.name.toLowerCase() === name.toLowerCase());
            if (existing && existing.code) {
                agentCode = existing.code;
            } else {
                const parts = name.split(' ');
                agentCode = parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.substring(0, 2).toUpperCase();
            }
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, '0');
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yy = String(now.getFullYear()).slice(-2);
            const datePart = `${dd}${mm}${yy}`;
            let maxSeq = 0;
            (requestOrders || []).forEach(o => {
                if (o.order_number) {
                    const match = o.order_number.match(/^[A-Z0-9]+(\d{6})(\d{3})$/);
                    if (match && match[1] === datePart) { const s = parseInt(match[2]); if (s > maxSeq) maxSeq = s; }
                }
            });
            orderNoInput.value = `${agentCode}${datePart}${String(maxSeq + 1).padStart(3, '0')}`;
        }
    }

    // ── Reactive Stock Allocation (Layer 2 & 3) ─────────────────────────────
    function getAllocations() {
        // Keyed by coffee+size+machine — packed stock from different
        // machines is not interchangeable (same rule as the 5 lookups fixed
        // 2026-07-15 in approveSalesOrder/loadPackingRequestsSection/etc.),
        // so two rows in the same not-yet-submitted order for the same
        // coffee+size but different machines must NOT share one reservation
        // pool. Rows with no machine picked yet fall under a shared 'none'
        // bucket, which simply won't match any real per-machine stock key.
        const alloc = {};
        itemsList.querySelectorAll('.sales-item-row').forEach(row => {
            const sel = row.querySelector('.item-select');
            const sizeEl = row.querySelector('.item-size');
            const qtyEl = row.querySelector('.item-qty');
            const machineEl = row.querySelector('.item-machine');
            if (!sel.value) return;
            const qty = parseInt(qtyEl.value) || 0;
            if (qty <= 0) return;
            const machineId = machineEl && machineEl.value ? machineEl.value : 'none';
            const key = `${sel.value}-${sizeEl.value}-${machineId}`;
            alloc[key] = (alloc[key] || 0) + qty;
        });
        return alloc;
    }

    // Same idea as getAllocations() above, but keyed by coffee+machine ONLY
    // (in kg) — bulk hasn't been portioned into bag sizes yet, so two rows
    // for the same coffee+machine at different sizes still compete for the
    // same kg pool, unlike packed stock which is already split by size.
    function getBulkAllocations() {
        const alloc = {};
        itemsList.querySelectorAll('.sales-item-row').forEach(row => {
            const sel = row.querySelector('.item-select');
            const sizeEl = row.querySelector('.item-size');
            const qtyEl = row.querySelector('.item-qty');
            const machineEl = row.querySelector('.item-machine');
            if (!sel.value) return;
            const qty = parseInt(qtyEl.value) || 0;
            if (qty <= 0) return;
            const machineId = machineEl && machineEl.value ? machineEl.value : 'none';
            const sizeG = parseInt(sizeEl.value) || 250;
            const kg = (qty * sizeG) / 1000;
            const key = `${sel.value}-${machineId}`;
            alloc[key] = (alloc[key] || 0) + kg;
        });
        return alloc;
    }

    let checkStockTimer = null;

    function updateAllRowsStockDisplays() {
        // Show loading state for all active info boxes
        itemsList.querySelectorAll('.sales-item-row').forEach(row => {
            const sel = row.querySelector('.item-select');
            const infoBox = row.querySelector('.item-info-box');
            if (sel.value) {
                infoBox.style.display = 'block';
                const checkingText = window.t ? window.t('lbl_stock_checking') : 'Stock Checking...';
                infoBox.innerHTML = `<span style="display:inline-block; animation: spin 1s linear infinite; margin-right: 5px;">⏳</span> ${checkingText}`;
            } else {
                infoBox.style.display = 'none';
            }
        });

        if (checkStockTimer) clearTimeout(checkStockTimer);
        
        checkStockTimer = setTimeout(() => {
            const totalAlloc = getAllocations();
            const totalBulkAlloc = getBulkAllocations();

            itemsList.querySelectorAll('.sales-item-row').forEach(currentRow => {
                const sel = currentRow.querySelector('.item-select');
                const machineEl = currentRow.querySelector('.item-machine');
                const sizeEl = currentRow.querySelector('.item-size');
                const qtyEl = currentRow.querySelector('.item-qty');
                const infoBox = currentRow.querySelector('.item-info-box');
                const warnDiv = currentRow.querySelector('.item-qty-warn');

                if (!sel.value) { infoBox.style.display = 'none'; return; }

                const [type, idStr] = sel.value.split('-');
                const isGroup = idStr.startsWith('CODE:');
                const coffeeId = isGroup ? idStr : parseInt(idStr);
                // Trade-name product (V2): no single origin/recipe to break
                // stock down by, but still per-machine — each machine's
                // number is the SUM of every origin (Single) or recipe
                // (Blend) sharing the code that landed on that machine,
                // instead of one coffee id's own stock. Packed stock from
                // different recipes sharing a trade name is directly poolable
                // (they're already-finished bags, unlike raw ingredient
                // stock — see getPotentialBags for why THAT side uses MAX
                // instead of SUM for Blend).
                const groupIds = isGroup
                    ? (type === 'Single'
                        ? (greenbeans || []).filter(g => g.code === idStr.slice(5)).map(g => g.id)
                        : (recipes || []).filter(r => r.code === idStr.slice(5)).map(r => r.id))
                    : [];
                const sizeG = parseInt(sizeEl.value);
                const currentQty = parseInt(qtyEl.value) || 0;
                const selectedMachineId = machineEl.value ? parseInt(machineEl.value) : null;

                // 1. Build per-machine stock cards for ALL machines
                let machineCardsHtml = '<div style="display: flex; gap: 6px; flex-wrap: wrap;">';
                (machines || []).forEach(m => {
                    const isActiveMachine = selectedMachineId === m.id;
                    const borderColor = isActiveMachine ? 'var(--primary)' : 'rgba(255,255,255,0.1)';
                    const bgColor = isActiveMachine ? 'rgba(45,106,79,0.12)' : 'transparent';
                    const nameColor = isActiveMachine ? 'var(--primary)' : 'var(--text-secondary)';

                    let sizesHtml = '';
                    visibleSizes.forEach(s => {
                        const sz = parseFloat(s.gram);
                        const rawMachStock = isGroup
                            ? groupIds.reduce((sum, gid) => sum + (perMachinePackedStocks[`${type}-${gid}-${sz}-${m.id}`] || 0), 0)
                            : (perMachinePackedStocks[`${type}-${coffeeId}-${sz}-${m.id}`] || 0);
                        // Subtract what OTHER rows in this same unsubmitted order
                        // already reserved for this exact coffee+size+machine, so
                        // two lines can't both show the full stock and jointly
                        // overcommit it (reported live 2026-07-16: two rows for the
                        // same coffee+size+machine both showed the full 3 in stock
                        // even after the first row already claimed 2 of it).
                        const allocKey = `${sel.value}-${sz}-${m.id}`;
                        const totalAllocForKey = totalAlloc[allocKey] || 0;
                        const allocByThisRowForKey = (isActiveMachine && sz === sizeG) ? currentQty : 0;
                        const otherAllocForKey = Math.max(0, totalAllocForKey - allocByThisRowForKey);
                        const machStock = Math.max(0, rawMachStock - otherAllocForKey);
                        const isSelected = (sz === sizeG);
                        const highlight = isSelected ? 'font-weight:700; color: var(--text-primary);' : 'color: var(--text-muted);';
                        sizesHtml += `<span style="${highlight} font-size: 0.75rem; margin-right: 8px;">${s.label}: <strong>${machStock}</strong></span>`;
                    });

                    machineCardsHtml += `
                        <div style="border: 1px solid ${borderColor}; border-radius: 4px; padding: 4px 8px; background: ${bgColor}; min-width: 80px; flex: 1;">
                            <div style="font-size: 0.72rem; font-weight: 700; color: ${nameColor}; margin-bottom: 1px; white-space: nowrap; line-height: 1.2;">${isActiveMachine ? '▸ ' : ''}${m.name}</div>
                            <div style="display: flex; gap: 2px; flex-wrap: wrap; line-height: 1.2;">${sizesHtml}</div>
                        </div>
                    `;
                });
                machineCardsHtml += '</div>';

                // Calculate aggregate for validation (subtract other rows'
                // allocations) — machine-partitioned, same reasoning as the
                // display cards above: a row with no machine selected yet has
                // no real per-machine stock to draw from, so it's 0 until a
                // machine is picked.
                let currentSizeAvailPacked = 0;
                {
                    const stockKey = `${sel.value}-${sizeG}-${selectedMachineId || 'none'}`;
                    const totalAllocForThisSize = totalAlloc[stockKey] || 0;
                    const allocByThisRow = currentQty;
                    const otherAlloc = Math.max(0, totalAllocForThisSize - allocByThisRow);
                    const totalPacked = selectedMachineId
                        ? (isGroup
                            ? groupIds.reduce((sum, gid) => sum + (perMachinePackedStocks[`${type}-${gid}-${sizeG}-${selectedMachineId}`] || 0), 0)
                            : (perMachinePackedStocks[`${type}-${coffeeId}-${sizeG}-${selectedMachineId}`] || 0))
                        : 0;
                    currentSizeAvailPacked = Math.max(0, totalPacked - otherAlloc);
                }

                // 2. Bulk (already-roasted, tinggal packing) — pooled by kg
                // per coffee+machine (not size-partitioned, since bulk isn't
                // portioned into bag sizes until it's actually packed).
                let currentBulkBags = 0;
                let availBulkKg = 0;
                {
                    const bulkKey = `${sel.value}-${selectedMachineId || 'none'}`;
                    const totalBulkAllocForKey = totalBulkAlloc[bulkKey] || 0;
                    const thisRowBulkKg = (currentQty * sizeG) / 1000;
                    const otherBulkAlloc = Math.max(0, totalBulkAllocForKey - thisRowBulkKg);
                    const totalBulkKg = selectedMachineId
                        ? (isGroup
                            ? groupIds.reduce((sum, gid) => sum + (perMachineBulkKg[`${type}-${gid}-${selectedMachineId}`] || 0), 0)
                            : (perMachineBulkKg[`${type}-${coffeeId}-${selectedMachineId}`] || 0))
                        : 0;
                    availBulkKg = Math.max(0, totalBulkKg - otherBulkAlloc);
                    currentBulkBags = Math.floor((availBulkKg * 1000) / sizeG);
                }

                // 3. Potential production in KG (raw green bean, needs roasting)
                const gbAllocFromOtherRows = getGreenbeanAllocations(currentRow);
                const potentialBags = getPotentialBags(type, coffeeId, sizeG, gbAllocFromOtherRows);

                // Three-tier coverage of THIS row's own requested qty, in the
                // same waterfall order the leader sees again at approval:
                // packed first, then bulk, then roasting. Lets sales see
                // whether an order will need production before it's even
                // submitted, instead of only finding out at approval.
                const tierPacked = Math.min(currentQty, currentSizeAvailPacked);
                const tierBulk = Math.min(Math.max(currentQty - currentSizeAvailPacked, 0), currentBulkBags);
                const tierRoast = Math.min(Math.max(currentQty - currentSizeAvailPacked - currentBulkBags, 0), potentialBags);
                const tierShort = Math.max(currentQty - currentSizeAvailPacked - currentBulkBags - potentialBags, 0);
                const barTotal = Math.max(currentQty, 1);

                let barHtml = '<div style="display:flex; height:7px; border-radius:4px; overflow:hidden; margin-top:6px; background:rgba(255,255,255,0.08);">';
                if (tierPacked > 0) barHtml += `<div style="background:#1D9E75; width:${(tierPacked / barTotal * 100).toFixed(1)}%;"></div>`;
                if (tierBulk > 0) barHtml += `<div style="background:#EF9F27; width:${(tierBulk / barTotal * 100).toFixed(1)}%;"></div>`;
                if (tierRoast > 0) barHtml += `<div style="background:#8a8a8a; width:${(tierRoast / barTotal * 100).toFixed(1)}%;"></div>`;
                if (tierShort > 0) barHtml += `<div style="background:#E24B4A; width:${(tierShort / barTotal * 100).toFixed(1)}%;"></div>`;
                barHtml += '</div>';

                const readyLbl = window.t ? window.t('lbl_tier_ready') : 'ready';
                const bulkLbl = window.t ? window.t('lbl_tier_bulk') : 'from bulk';
                const roastLbl = window.t ? window.t('lbl_tier_roast') : 'needs roasting';
                const shortLbl = window.t ? window.t('lbl_tier_short') : 'short by';

                const parts = [];
                if (tierPacked > 0) parts.push(`<span style="color:#5DCAA5; font-weight:700;">${tierPacked}</span> ${readyLbl}`);
                if (tierBulk > 0) parts.push(`<span style="color:#EF9F27; font-weight:700;">${tierBulk}</span> ${bulkLbl} <span style="color:var(--text-muted);">(${availBulkKg.toFixed(1)}kg)</span>`);
                if (tierRoast > 0) parts.push(`<span style="color:#b0b0b0; font-weight:700;">${tierRoast}</span> ${roastLbl}`);
                let tierLine = parts.length ? parts.join(' &middot; ') : '';
                if (tierShort > 0) {
                    tierLine += `${tierLine ? ' &middot; ' : ''}<span style="color:#E24B4A; font-weight:700;">${tierShort} ${shortLbl}</span>`;
                }

                infoBox.innerHTML = `
                    ${machineCardsHtml}
                    <div style="margin-top: 4px; padding-top: 3px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 0.75rem; line-height: 1.2;">${tierLine}</div>
                    ${barHtml}
                `;

                // Store for submit validation
                currentRow.dataset.packedStock = currentSizeAvailPacked;
                currentRow.dataset.bulkBags = currentBulkBags;
                currentRow.dataset.potentialBags = potentialBags;

            });
        }, 500); // 500ms animation
    }

    function addSalesItemRow(initialItemData = null) {
        const row = document.createElement('div');
        row.className = 'sales-item-row';
        row.style = 'display: flex; flex-direction: column; margin-bottom: 20px; position: relative;';

        row.innerHTML = `
            <div style="display: flex; gap: 10px; align-items: flex-end; width: 100%;">
                <div style="flex: 2 1 160px; min-width: 0;">
                    <label class="form-label label-xs-nowrap"  data-i18n="lbl_req_coffee_sel">Coffee</label>
                    <select class="form-control item-select" required>
                        ${coffeeOptionsHtml}
                    </select>
                </div>
                <div style="flex: 1.5 1 130px; min-width: 0;">
                    <label class="form-label label-xs-nowrap" >Machine</label>
                    <select class="form-control item-machine" required>
                        ${machineOptionsHtml}
                    </select>
                </div>
                <div style="flex: 0 0 75px;">
                    <label class="form-label label-xs-nowrap"  data-i18n="lbl_req_size">Size</label>
                    <select class="form-control item-size" required>
                        ${sizeOptionsHtml}
                    </select>
                </div>
                <div style="flex: 0 0 65px;">
                    <label class="form-label label-xs-nowrap"  data-i18n="lbl_req_qty">Qty</label>
                    <input type="number" class="form-control item-qty" min="1" value="1" required>
                </div>
                <button type="button" class="btn btn-danger btn-remove-row" style="padding: 0; width: 34px; height: 34px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">&times;</button>
            </div>
            <div class="item-info-box" style="width: 100%; margin-top: 5px; font-size: 0.75rem; color: var(--text-secondary); background: rgba(0,0,0,0.2); padding: 5px 8px; border-radius: 5px; display: none; line-height: 1.2;"></div>
        `;

        itemsList.appendChild(row);

        const sel = row.querySelector('.item-select');
        const machineEl = row.querySelector('.item-machine');
        const sizeEl = row.querySelector('.item-size');
        const qtyEl = row.querySelector('.item-qty');

        if (initialItemData) {
            const coffeeVal = initialItemData.coffee_code
                ? `${initialItemData.coffee_type}-CODE:${initialItemData.coffee_code}`
                : `${initialItemData.coffee_type}-${initialItemData.single_coffee_id || initialItemData.blend_recipe_id}`;
            sel.value = coffeeVal;
            if (initialItemData.machine_id) machineEl.value = initialItemData.machine_id;
            sizeEl.value = initialItemData.bag_size_g;
            qtyEl.value = initialItemData.quantity_requested;
            
            // Store original item id for plan sync
            row.dataset.originalItemId = initialItemData.id;
        }

        // If editing approved/preparing order: lock all fields except qty
        const isApprovedEdit = existingOrder && (existingOrder.status === 'Preparing' || existingOrder.status === 'Approved');
        if (isApprovedEdit && initialItemData) {
            sel.disabled = true;
            sel.style.opacity = '0.6';
            machineEl.disabled = true;
            machineEl.style.opacity = '0.6';
            sizeEl.disabled = true;
            sizeEl.style.opacity = '0.6';
            row.querySelector('.btn-remove-row').style.display = 'none';
        }

        // Remove handler
        row.querySelector('.btn-remove-row').addEventListener('click', () => {
            if (itemsList.querySelectorAll('.sales-item-row').length > 1) {
                row.remove();
                updateAllRowsStockDisplays();
            } else {
                alert(window.t('alert_min_one_item') || 'At least one item is required.');
            }
        });

        // Reactive listeners
        sel.addEventListener('change', updateAllRowsStockDisplays);
        machineEl.addEventListener('change', updateAllRowsStockDisplays);
        sizeEl.addEventListener('change', updateAllRowsStockDisplays);
        qtyEl.addEventListener('input', updateAllRowsStockDisplays);

        if (typeof window.translatePage === 'function') window.translatePage();
    }

    // Populate rows
    if (existingItems && existingItems.length > 0) {
        existingItems.forEach(item => addSalesItemRow(item));
        updateAllRowsStockDisplays();
    } else {
        addSalesItemRow();
    }

    // Hide "Add Another Item" button and lock header fields for approved/preparing orders
    const isApprovedEdit = existingOrder && (existingOrder.status === 'Preparing' || existingOrder.status === 'Approved');
    if (isApprovedEdit) {
        const addBtn = document.getElementById('btn-add-sales-item');
        if (addBtn) addBtn.style.display = 'none';
        
        // Lock header fields - leader can only edit qty
        if (agentInput) { agentInput.disabled = true; agentInput.style.opacity = '0.6'; }
        if (orderNoInput) { orderNoInput.disabled = true; orderNoInput.style.opacity = '0.6'; }
        const notesInput = document.getElementById('m-req-notes');
        if (notesInput) { notesInput.disabled = true; notesInput.style.opacity = '0.6'; }
    }

    document.getElementById('btn-add-sales-item').addEventListener('click', () => {
        addSalesItemRow();
    });

    document.getElementById('modal-request-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Validation for empty required fields
        let isValid = true;
        const form = e.target;
        form.querySelectorAll('.custom-empty-warn').forEach(w => w.remove());
        
        form.querySelectorAll('[required]').forEach(el => {
            if (!el.value || el.value.trim() === '') {
                isValid = false;
                el.parentElement.style.position = 'relative';
                const warnBubble = document.createElement('div');
                warnBubble.className = 'custom-empty-warn';
                warnBubble.style = 'position: absolute; bottom: -28px; left: 0; background: var(--danger); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; z-index: 10; white-space: nowrap; box-shadow: 0 2px 5px rgba(0,0,0,0.25);';
                warnBubble.innerHTML = `⚠️ ${window.t ? window.t('alert_field_required') : 'Field is required'}<div style="position: absolute; top: -4px; left: 10px; width: 8px; height: 8px; background: var(--danger); transform: rotate(45deg);"></div>`;
                el.parentElement.appendChild(warnBubble);
                const removeHandler = () => { if(warnBubble.parentNode) warnBubble.remove(); };
                el.addEventListener('input', removeHandler, {once:true});
                el.addEventListener('change', removeHandler, {once:true});
            }
        });
        if (!isValid) return;
        
        const rows = document.querySelectorAll('.sales-item-row');
        let needsRoastingQueue = false;
        let blocked = false;
        
        for (const r of rows) {
            const packed = parseInt(r.dataset.packedStock) || 0;
            const bulk = parseInt(r.dataset.bulkBags) || 0;
            const potential = parseInt(r.dataset.potentialBags) || 0;
            const qty = parseInt(r.querySelector('.item-qty').value);

            // Bulk (already-roasted, tinggal packing) counts as "already
            // available" alongside packed — only the shortfall past packed
            // AND bulk actually needs a roasting queue entry.
            if (qty > packed + bulk) {
                if (qty <= (packed + bulk + potential)) {
                    needsRoastingQueue = true;
                } else {
                    blocked = true;
                }
            }
        }
        
        if (blocked) {
            const forceProceed = await showWarningModal(
                window.t ? window.t('alert_stock_absolutely_insufficient') : "Total available stock and potential production are insufficient for one or more items. Do you still want to continue?",
                true, 'Warning', 'Continue Anyway'
            );
            if (!forceProceed) return;
        }
        
        if (needsRoastingQueue) {
            const proceed = await showWarningModal(window.t ? window.t('prompt_roasting_queue') : "Packed stock is insufficient for some items. Do you want the remainder to enter the production queue?");
            if (!proceed) return;
        }

        const salesName = agentInput.value.trim();
        let agentCode = 'AG';
        const existingAgent = (agents || []).find(a => a.name.toLowerCase() === salesName.toLowerCase());
        if (!existingAgent) {
            const parts = salesName.split(' ');
            agentCode = parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : salesName.substring(0, 2).toUpperCase();
            await saveData('sales_agents', { name: salesName, code: agentCode });
        }
        
        // 1. Save Request Order header
        const orderRecord = {
            id: orderId || undefined,
            order_number: orderNoInput.value,
            order_date: existingOrder ? existingOrder.order_date : new Date().toISOString().split('T')[0],
            sales_name: salesName,
            status: existingOrder ? existingOrder.status : 'Pending Approval',
            notes: document.getElementById('m-req-notes').value,
            customer_id: parseInt(document.getElementById('m-req-customer')?.value) || null
        };

        const { data: savedOrder, error } = await saveData('request_orders', orderRecord);
        if (error) {
            alert((window.t ? window.t('alert_order_failed') : "Ordering failed: {msg}").replace("{msg}", error.message));
            return;
        }

        // If editing approved/preparing order: update qty in-place and sync plans
        const isApprovedEdit = existingOrder && (existingOrder.status === 'Preparing' || existingOrder.status === 'Approved');
        
        if (orderId !== null && isApprovedEdit) {
            // Update qty on existing items and sync linked plans
            const { data: allPlans } = await fetchData('roasting_plans');
            
            for (const r of rows) {
                const originalItemId = parseInt(r.dataset.originalItemId);
                const newQty = parseInt(r.querySelector('.item-qty').value);
                
                // Find the existing item
                const oldItem = (requestOrderItems || []).find(i => i.id === originalItemId);
                if (!oldItem) continue;
                
                const oldQty = oldItem.quantity_requested;
                oldItem.quantity_requested = newQty;
                
                // Recalculate pending qty (new total minus already allocated)
                const allocated = oldItem.quantity_allocated || 0;
                oldItem.quantity_pending = Math.max(0, newQty - allocated);
                
                await saveData('request_order_items', oldItem);
                
                // Update linked plan target if exists
                const linkedPlan = (allPlans || []).find(p => p.request_order_item_id === originalItemId);
                if (linkedPlan) {
                    const pendingQty = oldItem.quantity_pending;
                    const weightKg = (pendingQty * parseInt(oldItem.bag_size_g)) / 1000;
                    const targetRoast = weightKg / 0.85;
                    linkedPlan.target_roasted_kg = parseFloat(targetRoast.toFixed(2));
                    
                    // Check if plan is now completed
                    const fulfilled = parseFloat(linkedPlan.fulfilled_roasted_kg || 0);
                    if (fulfilled >= linkedPlan.target_roasted_kg && linkedPlan.target_roasted_kg > 0) {
                        linkedPlan.status = 'Completed';
                    }
                    
                    await saveData('roasting_plans', linkedPlan);
                    await syncPlanStatusToOrderItem(linkedPlan);
                }
            }
        } else if (orderId !== null) {
            // Non-approved edit: delete old items and recreate
            const oldItems = (requestOrderItems || []).filter(i => i.request_order_id === orderId);
            for (const item of oldItems) {
                await deleteData('request_order_items', item.id);
            }
            
            // Save new items
            for (const r of rows) {
                const val = r.querySelector('.item-select').value;
                const [type, idStr] = val.split('-');
                const isGroup = idStr.startsWith('CODE:');
                const qty = parseInt(r.querySelector('.item-qty').value);
                const machId = r.querySelector('.item-machine').value ? parseInt(r.querySelector('.item-machine').value) : null;

                const itemRecord = {
                    request_order_id: savedOrder.id,
                    coffee_type: type,
                    single_coffee_id: (type === 'Single' && !isGroup) ? parseInt(idStr) : null,
                    blend_recipe_id: (type === 'Blend' && !isGroup) ? parseInt(idStr) : null,
                    coffee_code: isGroup ? idStr.slice(5) : null,
                    machine_id: machId,
                    bag_size_g: parseInt(r.querySelector('.item-size').value),
                    quantity_requested: qty,
                    quantity_allocated: 0,
                    quantity_pending: qty,
                    item_status: existingOrder ? existingOrder.status : 'Pending Approval'
                };
                const { error: itemErr } = await saveData('request_order_items', itemRecord);
                if (itemErr) {
                    alert("Failed to save order item: " + itemErr.message);
                    return;
                }
            }
        } else {
            // New order: save items
            for (const r of rows) {
                const val = r.querySelector('.item-select').value;
                const [type, idStr] = val.split('-');
                const isGroup = idStr.startsWith('CODE:');
                const qty = parseInt(r.querySelector('.item-qty').value);
                const machId = r.querySelector('.item-machine').value ? parseInt(r.querySelector('.item-machine').value) : null;

                const itemRecord = {
                    request_order_id: savedOrder.id,
                    coffee_type: type,
                    single_coffee_id: (type === 'Single' && !isGroup) ? parseInt(idStr) : null,
                    blend_recipe_id: (type === 'Blend' && !isGroup) ? parseInt(idStr) : null,
                    coffee_code: isGroup ? idStr.slice(5) : null,
                    machine_id: machId,
                    bag_size_g: parseInt(r.querySelector('.item-size').value),
                    quantity_requested: qty,
                    quantity_allocated: 0,
                    quantity_pending: qty,
                    item_status: 'Pending Approval'
                };
                const { error: itemErr } = await saveData('request_order_items', itemRecord);
                if (itemErr) {
                    alert("Failed to save order item: " + itemErr.message);
                    return;
                }
            }
        }

        modalContainer.classList.add('hidden');
        loadHandoverSection();
        scheduleDashboardRefresh();
    });
}

async function deleteSalesOrder(orderId) {
    if (await showDeleteConfirmModal('this sales order')) {
        const { data: items } = await fetchData('request_order_items');
        const orderItems = (items || []).filter(i => i.request_order_id === orderId);
        for (const item of orderItems) {
            await deleteData('request_order_items', item.id);
        }
        const { error } = await deleteData('request_orders', orderId);
        if (error) {
            await showWarningModal(error.message, false);
        } else {
            loadHandoverSection();
            scheduleDashboardRefresh();
        }
    }
}

function initHandoverPagination() {
    const reqSelector = document.getElementById('request-page-size-selector');
    if (reqSelector) {
        reqSelector.addEventListener('click', (e) => {
            const opt = e.target.closest('.page-size-opt');
            if (opt) {
                requestPageSize = parseInt(opt.getAttribute('data-size'));
                requestCurrentPage = 1;
                loadSalesDispatchRequestsTable();
            }
        });
    }

    const appSelector = document.getElementById('approval-page-size-selector');
    if (appSelector) {
        appSelector.addEventListener('click', (e) => {
            const opt = e.target.closest('.page-size-opt');
            if (opt) {
                approvalPageSize = parseInt(opt.getAttribute('data-size'));
                approvalCurrentPage = 1;
                loadDispatchApprovalTable();
            }
        });
    }
}
