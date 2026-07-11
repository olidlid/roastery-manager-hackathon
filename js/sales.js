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
                        <option value="Wholesale" ${existing?.type === 'Wholesale' ? 'selected' : ''}>🏭 Wholesale</option>
                        <option value="Retail" ${existing?.type === 'Retail' || !existing ? 'selected' : ''}>☕ Retail</option>
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
        { data: orderItems }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items')
    ]);
    
    const custOrders = (orders || []).filter(o => o.customer_id === customerId);
    
    let historyHtml = '';
    if (custOrders.length === 0) {
        historyHtml = '<p class="table-empty-state">No order history for this customer</p>';
    } else {
        historyHtml = `<table class="data-table" style="width:100%;">
            <thead><tr>
                <th>Order #</th><th>Date</th><th>Items</th><th>Status</th>
            </tr></thead><tbody>`;
        
        custOrders.sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''));
        
        custOrders.forEach(o => {
            const items = (orderItems || []).filter(i => i.request_order_id === o.id);
            const itemsSummary = items.map(i => `${i.coffee_name || 'Item'} (${i.grind || '-'}, ${i.size_g || '-'}g x${i.quantity || 0})`).join('<br>');
            const statusColor = o.status === 'Dispatched' ? 'var(--success)' : o.status === 'Approved' ? 'var(--primary)' : 'var(--warning)';
            
            historyHtml += `<tr>
                <td><code>${o.order_number || '#ORD-'+o.id}</code></td>
                <td>${o.order_date || '-'}</td>
                <td style="font-size:0.8rem;">${itemsSummary || '-'}</td>
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
    
    openModal(`Customer: ${customer.name}`, html, '800px');
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
        { data: customers }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('customers')
    ]);
    const tbody = document.getElementById('request-orders-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!orders || orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center-muted">${window.t ? window.t("msg_no_orders") : "No orders found."}</td></tr>`;
        return;
    }

    let sortedOrders = [...orders]
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
                const coffeeName = item.coffee_type === 'Single'
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
        // Also match packed_coffee saved via daily packing (custom_coffee_name, no roast_batch_id)
        if (!p.roast_batch_id && p.custom_coffee_name) {
            let resolvedKey = null;
            const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
            const matchGb = (greenbeans || []).find(g => g.name === cleanName);
            if (matchGb) {
                resolvedKey = `Single-${matchGb.id}-${p.bag_size_g}`;
            } else {
                const matchRec = (recipes || []).find(r => r.name === cleanName);
                if (matchRec) resolvedKey = `Blend-${matchRec.id}-${p.bag_size_g}`;
            }
            if (resolvedKey) {
                stockMap.set(resolvedKey, (stockMap.get(resolvedKey) || 0) + (parseInt(p.quantity) || 0));
            }
        }
    });

    const totalItems = sortedOrders.length;
    const totalPages = Math.ceil(totalItems / requestPageSize) || 1;
    if (requestCurrentPage > totalPages) {
        requestCurrentPage = totalPages;
    }

    const startIndex = (requestCurrentPage - 1) * requestPageSize;
    const endIndex = Math.min(startIndex + requestPageSize, totalItems);
    const paginatedOrders = sortedOrders.slice(startIndex, endIndex);

    // Update stats text
    const pageInfo = document.getElementById('request-page-info');
    if (pageInfo) {
        const startVal = totalItems === 0 ? 0 : startIndex + 1;
        const template = window.t ? window.t('pagination_info') : 'Show {start} - {end} of {total}';
        pageInfo.textContent = template.replace('{start}', startVal).replace('{end}', endIndex).replace('{total}', totalItems);
    }

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

    // Render pagination page buttons
    const paginationContainer = document.getElementById('request-pagination-pages');
    if (paginationContainer) {
        paginationContainer.innerHTML = '';
        if (totalPages > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.className = `pagination-btn ${requestCurrentPage === 1 ? 'disabled' : ''}`;
            prevBtn.innerHTML = `&lt;`;
            prevBtn.addEventListener('click', () => {
                if (requestCurrentPage > 1) {
                    requestCurrentPage--;
                    loadSalesDispatchRequestsTable();
                }
            });
            paginationContainer.appendChild(prevBtn);

            for (let i = 1; i <= totalPages; i++) {
                const pageBtn = document.createElement('button');
                pageBtn.className = `pagination-btn ${requestCurrentPage === i ? 'active' : ''}`;
                pageBtn.textContent = i;
                pageBtn.addEventListener('click', () => {
                    requestCurrentPage = i;
                    loadSalesDispatchRequestsTable();
                });
                paginationContainer.appendChild(pageBtn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.className = `pagination-btn ${requestCurrentPage === totalPages ? 'disabled' : ''}`;
            nextBtn.innerHTML = `&gt;`;
            nextBtn.addEventListener('click', () => {
                if (requestCurrentPage < totalPages) {
                    requestCurrentPage++;
                    loadSalesDispatchRequestsTable();
                }
            });
            paginationContainer.appendChild(nextBtn);
        }
    }

    let tbodyHtml = '';
    for (const order of paginatedOrders) {
        let needsRoast = false;
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);
        
        if (order.status === 'Pending Approval') {
            for (const item of items) {
                const type = item.coffee_type;
                const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
                const size = parseInt(item.bag_size_g);
                
                const key = `${type}-${coffeeId}-${size}`;
                const packedStock = stockMap.get(key) || 0;
                
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
            if (type === 'Single') {
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
        { data: roastBatches }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('customers'),
        fetchData('packed_coffee'),
        fetchData('roast_batches')
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

    const totalItems = sortedOrders.length;
    const totalPages = Math.ceil(totalItems / approvalPageSize) || 1;
    if (approvalCurrentPage > totalPages) {
        approvalCurrentPage = totalPages;
    }

    const startIndex = (approvalCurrentPage - 1) * approvalPageSize;
    const endIndex = Math.min(startIndex + approvalPageSize, totalItems);
    const paginatedOrders = sortedOrders.slice(startIndex, endIndex);

    // Update stats text
    const pageInfo = document.getElementById('approval-page-info');
    if (pageInfo) {
        const startVal = totalItems === 0 ? 0 : startIndex + 1;
        const template = window.t ? window.t('pagination_info') : 'Show {start} - {end} of {total}';
        pageInfo.textContent = template.replace('{start}', startVal).replace('{end}', endIndex).replace('{total}', totalItems);
    }

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

    // Render pagination page buttons
    const paginationContainer = document.getElementById('approval-pagination-pages');
    if (paginationContainer) {
        paginationContainer.innerHTML = '';
        if (totalPages > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.className = `pagination-btn ${approvalCurrentPage === 1 ? 'disabled' : ''}`;
            prevBtn.innerHTML = `&lt;`;
            prevBtn.addEventListener('click', () => {
                if (approvalCurrentPage > 1) {
                    approvalCurrentPage--;
                    loadDispatchApprovalTable();
                }
            });
            paginationContainer.appendChild(prevBtn);

            for (let i = 1; i <= totalPages; i++) {
                const pageBtn = document.createElement('button');
                pageBtn.className = `pagination-btn ${approvalCurrentPage === i ? 'active' : ''}`;
                pageBtn.textContent = i;
                pageBtn.addEventListener('click', () => {
                    approvalCurrentPage = i;
                    loadDispatchApprovalTable();
                });
                paginationContainer.appendChild(pageBtn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.className = `pagination-btn ${approvalCurrentPage === totalPages ? 'disabled' : ''}`;
            nextBtn.innerHTML = `&gt;`;
            nextBtn.addEventListener('click', () => {
                if (approvalCurrentPage < totalPages) {
                    approvalCurrentPage++;
                    loadDispatchApprovalTable();
                }
            });
            paginationContainer.appendChild(nextBtn);
        }
    }

    let tbodyHtml = '';
    for (const order of paginatedOrders) {
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);

        // Build card-style items like Sales Dispatch Request
        let itemsHtml = `<div style="display: flex; flex-direction: column; gap: 8px;">`;
        for (const item of items) {
            let coffeeName = '';
            if (item.coffee_type === 'Single') {
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
            openOrderDetailPopup(orderId, orders, orderItems, greenbeans, recipes, machines, packed, roastBatches);
        }
    };

    applyFiltersForTable(document.querySelector('#tab-dispatch-approval table'));
    if (typeof window.translatePage === 'function') window.translatePage();
}

function openOrderDetailPopup(orderId, orders, orderItems, greenbeans, recipes, machines, packed, roastBatches) {
    const order = (orders || []).find(o => o.id === orderId);
    if (!order) return;

    const items = (orderItems || []).filter(i => i.request_order_id === orderId);

    // For orders not yet approved, quantity_allocated/quantity_pending haven't
    // been decided yet (approveSalesOrder() is what sets them) — they'd just
    // read as 0. So for a still-pending order, compute a live snapshot of
    // packed stock per coffee/size/machine instead, matching the same lookup
    // openSalesRequestModal uses for its stock-check box.
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
            // match by custom_coffee_name instead, same as openSalesRequestModal.
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
        if (item.coffee_type === 'Single') {
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
        if (isPending && item.machine_id) {
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
        { data: machines }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('packed_coffee'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('roast_batches'),
        fetchData('machines')
    ]);
    
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const items = orderItems.filter(i => i.request_order_id === orderId);
    
    // Build machine options HTML
    const machineOptionsHtml = (machines || []).map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    
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
        if (type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === coffeeId);
            coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === coffeeId);
            coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
        }
        
        const matchingPacked = (packedGoods || []).filter(p => {
            if (p.roast_batch_id) {
                const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
                return batch && batch.coffee_type === type && (batch.single_coffee_id === coffeeId || batch.blend_recipe_id === coffeeId);
            }
            // Also match by custom_coffee_name
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
        const szItems = matchingPacked.filter(p => parseInt(p.bag_size_g) === size);
        const packedStock = szItems.reduce((acc, p) => acc + (parseInt(p.quantity) || 0), 0);
        
        let fulfillQty = Math.min(packedStock, item.quantity_requested);
        let prodQty = item.quantity_requested > packedStock ? (item.quantity_requested - packedStock) : 0;
        
        // Resolve machine name from item
        const itemMachine = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
        const machineLabel = itemMachine ? `<span style="font-size: 0.8rem; color: var(--primary); font-weight: 600;"> • ${itemMachine.name}</span>` : '';
        
        // Build machine options with pre-selection
        let itemMachineOptionsHtml = `<option value="">-- Select Machine --</option>`;
        (machines || []).forEach(m => {
            const selected = item.machine_id === m.id ? 'selected' : '';
            itemMachineOptionsHtml += `<option value="${m.id}" ${selected}>${m.name}</option>`;
        });
        
        htmlContent += `
            <div class="approval-item-row" data-id="${item.id}" style="background: rgba(0,0,0,0.02); border: 1px solid var(--border-color); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <div style="font-weight: bold; margin-bottom: 8px; color: var(--text-primary);">${coffeeName} - ${size}g${machineLabel}</div>
                <div style="display: flex; gap: 20px; font-size: 0.85rem; align-items: center;">
                    <div class="flex-1">
                        <span style="color: var(--text-secondary);" data-i18n="lbl_requested">Requested:</span> <strong>${item.quantity_requested}</strong>
                    </div>
                    <div class="flex-1">
                        <span style="color: var(--text-secondary);" data-i18n="lbl_packed_stock">Packed Stock:</span> <strong style="${packedStock < item.quantity_requested ? 'color: var(--danger);' : ''}">${packedStock}</strong>
                    </div>
                </div>
                <div style="display: flex; gap: 15px; margin-top: 15px; align-items: flex-end;">
                    <div class="flex-1">
                        <label class="form-label" style="font-size: 0.75rem;" data-i18n="lbl_fulfill_packed">Fulfill from Packed</label>
                        <input type="number" class="form-control inp-fulfill" min="0" max="${packedStock}" value="${fulfillQty}" required>
                    </div>
                    <div class="flex-1">
                        <label class="form-label" style="font-size: 0.75rem;" data-i18n="lbl_send_prod">Send to Production</label>
                        <input type="number" class="form-control inp-prod" min="0" value="${prodQty}" required>
                    </div>
                </div>
                <div class="machine-select-row" style="margin-top: 12px; ${prodQty > 0 ? '' : 'display: none;'}">
                    <label class="form-label" style="font-size: 0.75rem;">Machine for Production</label>
                    <select class="form-control sel-machine" style="padding: 6px 10px;">
                        ${itemMachineOptionsHtml}
                    </select>
                </div>
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
    
    // Toggle machine dropdown visibility when inp-prod changes
    document.querySelectorAll('.approval-item-row .inp-prod').forEach(inp => {
        inp.addEventListener('input', function() {
            const row = this.closest('.approval-item-row');
            const machineRow = row.querySelector('.machine-select-row');
            const val = parseInt(this.value) || 0;
            machineRow.style.display = val > 0 ? '' : 'none';
        });
    });
    
    document.getElementById('modal-approve-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const rows = document.querySelectorAll('.approval-item-row');
        
        for (const r of rows) {
            const itemId = parseInt(r.getAttribute('data-id'));
            const fQty = parseInt(r.querySelector('.inp-fulfill').value);
            const pQty = parseInt(r.querySelector('.inp-prod').value);
            const selMachine = r.querySelector('.sel-machine');
            const machineId = selMachine ? (parseInt(selMachine.value) || null) : null;
            
            const item = orderItems.find(i => i.id === itemId);
            if (!item) continue;
            
            item.quantity_allocated = fQty;
            item.quantity_pending = pQty;
            item.item_status = pQty > 0 ? 'Planned' : 'Packing';
            
            await saveData('request_order_items', item);
            
            // Deduct packed stock
            if (fQty > 0) {
                const type = item.coffee_type;
                const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
                const matchingPacked = (packedGoods || []).filter(p => {
                    if (p.roast_batch_id) {
                        const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
                        return batch && batch.coffee_type === type && (batch.single_coffee_id === coffeeId || batch.blend_recipe_id === coffeeId);
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
                
                let remainingDeduct = fQty;
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
            }
            
            // Create Roast Plan (Pending - not auto-executed)
            if (pQty > 0) {
                const weightKg = (pQty * parseInt(item.bag_size_g)) / 1000;
                // Add a buffer for yield (roughly / 0.85)
                const targetRoast = weightKg / 0.85;
                
                const planRecord = {
                    day: new Date().toLocaleDateString('en-US', {weekday:'long'}),
                    plan_date: new Date().toISOString().split('T')[0],
                    coffee_type: item.coffee_type,
                    single_coffee_id: item.single_coffee_id,
                    blend_recipe_id: item.blend_recipe_id,
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
        { data: packagingSizes }
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
        fetchData('packaging_sizes')
    ]);

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

    // Subtract committed (Pending / Preparing) orders from packed stock
    const activeOrders = (requestOrders || []).filter(o => ['Pending Approval', 'Preparing'].includes(o.status));
    const activeOrderIds = activeOrders.map(o => o.id);
    const committedPackedMap = {};
    (requestOrderItems || []).forEach(item => {
        if (activeOrderIds.includes(item.request_order_id)) {
            if (orderId !== null && item.request_order_id === orderId) return;
            const cId = item.coffee_type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
            const key = `${item.coffee_type}-${cId}-${item.bag_size_g}`;
            const qty = parseInt(item.quantity_pending) || parseInt(item.quantity_requested) || 0;
            committedPackedMap[key] = (committedPackedMap[key] || 0) + qty;
        }
    });

    Object.keys(originalPackedStocks).forEach(k => {
        originalPackedStocks[k] = Math.max(0, originalPackedStocks[k] - (committedPackedMap[k] || 0));
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
            const coffeeId = parseInt(idStr);

            if (type === 'Single') {
                gbAlloc[coffeeId] = (gbAlloc[coffeeId] || 0) + requiredKg;
            } else {
                const r = (recipes || []).find(rec => rec.id === coffeeId);
                if (r) {
                    const ings = (ingredients || []).filter(i => parseInt(i.blend_recipe_id) === r.id);
                    ings.forEach(ing => {
                        const gbId = parseInt(ing.green_coffee_id);
                        const ratio = parseFloat(ing.percentage) / 100;
                        gbAlloc[gbId] = (gbAlloc[gbId] || 0) + (requiredKg * ratio);
                    });
                }
            }
        });
        return gbAlloc;
    }

    function getPotentialBags(type, coffeeId, sizeG, gbAllocFromOtherRows = {}) {
        let maxGbKg = 0;
        if (type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === coffeeId);
            const avail = gb ? parseFloat(gb.stock_kg) : 0;
            const claimed = gbAllocFromOtherRows[coffeeId] || 0;
            maxGbKg = Math.max(0, avail - claimed);
        } else {
            const r = (recipes || []).find(rec => rec.id === coffeeId);
            if (r) {
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
                maxGbKg = minLimit === Infinity ? 0 : minLimit;
            }
        }
        return Math.floor((maxGbKg * 0.85 * 1000) / sizeG);
    }

    // ── Generate dropdowns ───────────────────────────────────────────────────
    const singleLbl = window.t ? window.t('opt_req_single') : 'Single Origin';
    const blendLbl = window.t ? window.t('opt_req_blend') : 'Blend';
    let coffeeOptionsHtml = `<option value="" disabled selected>-- Select Item --</option>`;
    coffeeOptionsHtml += `<optgroup label="${singleLbl}">`;
    coffeeOptionsHtml += [...(greenbeans || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(g => `<option value="Single-${g.id}">${g.name}</option>`).join('');
    coffeeOptionsHtml += `</optgroup>`;
    coffeeOptionsHtml += `<optgroup label="${blendLbl}">`;
    coffeeOptionsHtml += [...(recipes || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(r => `<option value="Blend-${r.id}">${r.name}</option>`).join('');
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
        const alloc = {};
        itemsList.querySelectorAll('.sales-item-row').forEach(row => {
            const sel = row.querySelector('.item-select');
            const sizeEl = row.querySelector('.item-size');
            const qtyEl = row.querySelector('.item-qty');
            if (!sel.value) return;
            const qty = parseInt(qtyEl.value) || 0;
            if (qty <= 0) return;
            const key = `${sel.value}-${sizeEl.value}`;
            alloc[key] = (alloc[key] || 0) + qty;
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
            
            itemsList.querySelectorAll('.sales-item-row').forEach(currentRow => {
                const sel = currentRow.querySelector('.item-select');
                const machineEl = currentRow.querySelector('.item-machine');
                const sizeEl = currentRow.querySelector('.item-size');
                const qtyEl = currentRow.querySelector('.item-qty');
                const infoBox = currentRow.querySelector('.item-info-box');
                const warnDiv = currentRow.querySelector('.item-qty-warn');

                if (!sel.value) { infoBox.style.display = 'none'; return; }

                const [type, idStr] = sel.value.split('-');
                const coffeeId = parseInt(idStr);
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
                        const mKey = `${type}-${coffeeId}-${sz}-${m.id}`;
                        const machStock = perMachinePackedStocks[mKey] || 0;
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
                
                // Calculate aggregate for validation (subtract other rows' allocations)
                let currentSizeAvailPacked = 0;
                {
                    const stockKey = `${sel.value}-${sizeG}`;
                    const totalAllocForThisSize = totalAlloc[stockKey] || 0;
                    const allocByThisRow = currentQty;
                    const otherAlloc = Math.max(0, totalAllocForThisSize - allocByThisRow);
                    const packKey = `${type}-${coffeeId}-${sizeG}`;
                    const totalPacked = originalPackedStocks[packKey] || 0;
                    currentSizeAvailPacked = Math.max(0, totalPacked - otherAlloc);
                }

                // 2. Potential production in KG
                const gbAllocFromOtherRows = getGreenbeanAllocations(currentRow);
                const potentialBags = getPotentialBags(type, coffeeId, sizeG, gbAllocFromOtherRows);
                const potentialKg = ((potentialBags * sizeG) / 1000).toFixed(2);

                // Build UI
                const potLbl = window.t ? window.t('lbl_potential_prod') : 'Potential Prod';

                infoBox.innerHTML = `
                    ${machineCardsHtml}
                    <div style="margin-top: 4px; padding-top: 3px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 0.75rem; line-height: 1.2;"><strong style="color: var(--primary);">${potLbl}:</strong> ~${potentialKg} kg</div>
                `;

                // Store for submit validation
                currentRow.dataset.packedStock = currentSizeAvailPacked;
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
            const coffeeVal = `${initialItemData.coffee_type}-${initialItemData.single_coffee_id || initialItemData.blend_recipe_id}`;
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
            const potential = parseInt(r.dataset.potentialBags) || 0;
            const qty = parseInt(r.querySelector('.item-qty').value);
            
            if (qty > packed) {
                if (qty <= (packed + potential)) {
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
                const qty = parseInt(r.querySelector('.item-qty').value);
                const machId = r.querySelector('.item-machine').value ? parseInt(r.querySelector('.item-machine').value) : null;
                
                const itemRecord = {
                    request_order_id: savedOrder.id,
                    coffee_type: type,
                    single_coffee_id: type === 'Single' ? parseInt(idStr) : null,
                    blend_recipe_id: type === 'Blend' ? parseInt(idStr) : null,
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
                const qty = parseInt(r.querySelector('.item-qty').value);
                const machId = r.querySelector('.item-machine').value ? parseInt(r.querySelector('.item-machine').value) : null;
                
                const itemRecord = {
                    request_order_id: savedOrder.id,
                    coffee_type: type,
                    single_coffee_id: type === 'Single' ? parseInt(idStr) : null,
                    blend_recipe_id: type === 'Blend' ? parseInt(idStr) : null,
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
