// ============================================================
// PURCHASE REQUEST (PURCHASE_REQUEST_PLAN.md)
// ============================================================
// Not connected to stock in any way — no packed_coffee/bulk_roasted_coffee/
// green_coffee reads or writes here, no RPC ledger. Purely a request/approve
// permission flow between purchase_requests + purchase_request_items.
// Mockup (spec, not a suggestion): https://claude.ai/code/artifact/022d7708-4b3a-4109-8320-2409cd05d621

const PURCHASE_CATEGORIES = ['Raw Materials', 'Equipment', 'Housekeeping Supplies', 'Other'];

const PURCHASE_CATEGORY_META = {
    'Raw Materials': { icon: '🌱', cls: 'badge-pr-raw', key: 'pr_cat_raw' },
    'Equipment': { icon: '🛠️', cls: 'badge-pr-equip', key: 'pr_cat_equip' },
    'Housekeeping Supplies': { icon: '🧹', cls: 'badge-pr-house', key: 'pr_cat_house' },
    'Other': { icon: '📦', cls: 'badge-pr-other', key: 'pr_cat_other' }
};

// Shared translation helper for this file — unlike window.t() itself,
// this actually uses `fallback` when the key doesn't exist in EITHER
// language dict. window.t() falls back to returning the bare key string
// (see js/i18n.js), which would otherwise show literal untranslated key
// names like "btn_edit" in the UI for any key not yet added to
// js/translations.js.
function prT(key, fallback) {
    if (!window.t) return fallback;
    const val = window.t(key);
    return (val === key) ? fallback : val;
}

function purchaseCategoryLabel(category) {
    const meta = PURCHASE_CATEGORY_META[category] || PURCHASE_CATEGORY_META['Other'];
    return prT(meta.key, category);
}

function purchaseCategoryBadgeHtml(category) {
    const meta = PURCHASE_CATEGORY_META[category] || PURCHASE_CATEGORY_META['Other'];
    return `<span class="badge ${meta.cls}">${meta.icon} ${purchaseCategoryLabel(category)}</span>`;
}

// §7.4 of the plan: company_settings.currency (now SAR, commit 0c064a6) had
// never been used to render a number anywhere in the app before this
// feature — this is the first reader. Read it fresh every call rather than
// caching, since Settings can change it while this section is open.
function formatPurchaseMoney(amount) {
    const currency = (typeof companySettings !== 'undefined' && companySettings && companySettings.currency) || 'SAR';
    const n = Number(amount) || 0;
    return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// §3.4: NULL/blank estimated_price means "requester doesn't know the price
// yet", never 0 — every caller that sums these MUST use this helper instead
// of rolling its own reduce(), so an unpriced item can never silently
// contribute 0 to a total that then gets shown as if it were complete.
function computePurchaseTotals(items) {
    const list = items || [];
    let total = 0;
    let pricedCount = 0;
    list.forEach(i => {
        if (i.estimated_price !== null && i.estimated_price !== undefined && i.estimated_price !== '') {
            total += (Number(i.estimated_price) || 0) * (Number(i.qty) || 1);
            pricedCount++;
        }
    });
    return { total, pricedCount, totalCount: list.length, unpricedCount: list.length - pricedCount };
}

// PR-YYMMDD-NNN, sequence resets daily and is scoped across ALL requests
// (not per-user) — simpler than Sales Order's agent-code scheme since there's
// no "agent" concept here, just one shared daily counter.
function generatePurchaseRequestNumber(existingRequests) {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePart = `${yy}${mm}${dd}`;
    let maxSeq = 0;
    (existingRequests || []).forEach(r => {
        if (r.request_number) {
            const m = r.request_number.match(/^PR-(\d{6})-(\d{3})$/);
            if (m && m[1] === datePart) {
                const s = parseInt(m[2], 10);
                if (s > maxSeq) maxSeq = s;
            }
        }
    });
    return `PR-${datePart}-${String(maxSeq + 1).padStart(3, '0')}`;
}

// Status badge + the small sub-line under it (mockup layers 1/4: "awaiting
// decision" for Requested, "by {name} · {date}" once decided). Shared by
// both the global list and the approval table so the two never drift.
function purchaseStatusBadgeHtml(r) {
    let badgeStyle, label;
    switch (r.status) {
        case 'Approved':
            badgeStyle = 'background:rgba(82,183,136,0.16); color:var(--success);';
            label = prT('pr_status_approved', 'Approved');
            break;
        case 'Rejected':
            badgeStyle = 'background:rgba(239,68,68,0.16); color:var(--danger);';
            label = prT('pr_status_rejected', 'Rejected');
            break;
        case 'Cancelled':
            badgeStyle = 'background:rgba(143,141,135,0.18); color:var(--text-muted);';
            label = prT('pr_status_cancelled', 'Cancelled');
            break;
        default:
            badgeStyle = 'background:rgba(255,209,102,0.18); color:var(--warning);';
            label = prT('pr_status_requested', 'Requested');
    }
    const badge = `<span class="badge" style="${badgeStyle}">${label}</span>`;

    let subLine = '';
    if (r.status === 'Requested') {
        subLine = prT('pr_awaiting_decision', 'awaiting decision');
    } else if (r.decided_by_name && r.decided_at) {
        const dateOnly = String(r.decided_at).split('T')[0];
        subLine = prT('pr_decided_by', 'by {name} · {date}').replace('{name}', r.decided_by_name).replace('{date}', dateOnly);
    }

    return `${badge}${subLine ? `<div class="text-secondary-xs" style="margin-top:2px;">${subLine}</div>` : ''}`;
}

// ============================================================
// SECTION / TAB LOADING
// ============================================================

async function loadPurchasingSection() {
    const activeTabBtn = document.querySelector('#sec-purchasing .tab-btn.active');
    await loadPurchasingTabSpecificData(activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'tab-purchase-request');
}

async function loadPurchasingTabSpecificData(tabId) {
    if (tabId === 'tab-purchase-approval') {
        await loadPurchaseApprovalTable();
    } else {
        await loadPurchaseRequestsList();
    }
}

// ============================================================
// TAB 1: PURCHASE REQUEST (global list — §3.5)
// ============================================================
// PURCHASE_REQUEST_PLAN.md §5.2: a 7th permission key,
// purchase_request_view_own, already exists in every role's data (seeded
// false everywhere) but is DELIBERATELY not read anywhere in this file, not
// in PERMISSION_GROUPS, and not filtered on here — the list stays GLOBAL
// (every user sees every request) until that key is actually wired up. To
// activate it later: add { key: 'purchase_request_view_own', ... } to the
// Purchase Request group in PERMISSION_GROUPS (js/settings.js), then filter
// `requests` below to `r.requested_by_id === currentUser.id` whenever
// hasPermission('purchase_request_view_own') is true and the full
// purchase_request_view is false — mirroring filterOwnOrders' shape in
// js/auth.js, but keyed on requested_by_id (UUID), not on a name match.

let _purchaseFilterCategory = 'all';

function filterPurchaseRequests(category) {
    _purchaseFilterCategory = category;
    document.querySelectorAll('.pr-filter-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-filter') === category);
    });
    loadPurchaseRequestsList();
}

async function loadPurchaseRequestsList() {
    const tbody = document.getElementById('purchase-requests-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const [{ data: requests }, { data: items }] = await Promise.all([
        fetchData('purchase_requests'),
        fetchData('purchase_request_items')
    ]);

    let filtered = requests || [];
    if (_purchaseFilterCategory !== 'all') {
        filtered = filtered.filter(r => r.category === _purchaseFilterCategory);
    }
    filtered = [...filtered].sort((a, b) => {
        const da = new Date(a.request_date || a.created_at || 0).getTime();
        const db = new Date(b.request_date || b.created_at || 0).getTime();
        return db - da || (b.id - a.id);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center-muted">${prT('pr_no_requests', 'No purchase requests yet.')}</td></tr>`;
        return;
    }


    filtered.forEach(r => {
        const myItems = (items || []).filter(i => i.purchase_request_id === r.id);
        const { total, unpricedCount } = computePurchaseTotals(myItems);
        const isMine = !!(currentUser && r.requested_by_id === currentUser.id);
        const isEditableState = r.status === 'Requested';
        const canEdit = isMine && isEditableState && hasPermission('purchase_request_edit');
        const canCancel = isMine && isEditableState && hasPermission('purchase_request_delete');

        const tr = document.createElement('tr');
        tr.className = 'table-row-hover' + (isMine ? ' pr-row-mine' : '');
        tr.style.cursor = 'pointer';
        tr.innerHTML = `
            <td>
                <strong>${r.request_number || ''}</strong>
                <div class="text-secondary-xs">${r.request_date || ''}${r.needed_by ? ' · ' + prT('col_pr_needed_by', 'Needed By') + ' ' + r.needed_by : ''}</div>
            </td>
            <td>
                ${r.requested_by_name || ''}
                ${isMine ? `<div style="font-size:0.66rem; color:var(--primary-hover); font-weight:700;">${prT('pr_you_tag', 'YOU')}</div>` : ''}
            </td>
            <td>${purchaseCategoryBadgeHtml(r.category)}</td>
            <td>${myItems.length}</td>
            <td class="num" style="text-align:right; font-variant-numeric:tabular-nums;">
                <span style="font-weight:600;">${formatPurchaseMoney(total)}</span>
                ${unpricedCount > 0 ? `<div style="font-size:0.68rem; color:var(--warning);">${prT('pr_items_partial_price', '{count} item(s) without a price').replace('{count}', unpricedCount)}</div>` : ''}
            </td>
            <td>${purchaseStatusBadgeHtml(r)}</td>
            <td>
                <div style="display:flex; gap:6px; justify-content:flex-end;">
                    ${canEdit ? `<button type="button" class="btn btn-secondary btn-sm pr-btn-edit" data-id="${r.id}">${prT('btn_edit', 'Edit')}</button>` : ''}
                    ${canCancel ? `<button type="button" class="btn btn-secondary btn-sm pr-btn-cancel" data-id="${r.id}">${prT('btn_cancel', 'Cancel')}</button>` : ''}
                </div>
            </td>
        `;
        tr.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            openPurchaseRequestDetailPopup(r.id);
        });
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.pr-btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPurchaseRequestFormModal(parseInt(btn.getAttribute('data-id')));
        });
    });
    tbody.querySelectorAll('.pr-btn-cancel').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            cancelPurchaseRequest(parseInt(btn.getAttribute('data-id')));
        });
    });
}

async function cancelPurchaseRequest(id) {
    const { data: requests } = await fetchData('purchase_requests');
    const r = (requests || []).find(x => x.id === id);
    if (!r) return;
    if (!(currentUser && r.requested_by_id === currentUser.id && r.status === 'Requested' && hasPermission('purchase_request_delete'))) {
        await showWarningModal(prT('alert_pr_cancel_denied', "You can only cancel your own request while it's still Requested."), false);
        return;
    }
    const proceed = await showWarningModal(prT('confirm_pr_cancel', 'Cancel this purchase request?'), true);
    if (!proceed) return;
    const { error } = await saveData('purchase_requests', { id, status: 'Cancelled' });
    if (error) {
        alert(prT('alert_pr_save_failed', 'Failed to save purchase request: {msg}').replace('{msg}', error.message));
        return;
    }
    await loadPurchasingSection();
    if (typeof updateNavNotificationBadges === 'function') updateNavNotificationBadges();
}

// ============================================================
// TAB 2: APPROVAL — only 'Requested' rows (mockup layer 4)
// ============================================================

async function loadPurchaseApprovalTable() {
    const tbody = document.getElementById('purchase-approval-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const { data: requests } = await fetchData('purchase_requests');
    const pending = (requests || [])
        .filter(r => r.status === 'Requested')
        .sort((a, b) => new Date(a.request_date || a.created_at) - new Date(b.request_date || b.created_at));

    if (pending.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center-muted">${prT('pr_no_pending_approval', 'Nothing pending approval.')}</td></tr>`;
        return;
    }

    const { data: items } = await fetchData('purchase_request_items');

    pending.forEach(r => {
        const myItems = (items || []).filter(i => i.purchase_request_id === r.id);
        const { total, unpricedCount } = computePurchaseTotals(myItems);

        const tr = document.createElement('tr');
        tr.className = 'table-row-hover';
        tr.style.cursor = 'pointer';
        tr.innerHTML = `
            <td>
                <strong>${r.request_number || ''}</strong>
                <div class="text-secondary-xs">${r.request_date || ''} · ${myItems.length} ${prT('col_pr_items', 'Items')}</div>
            </td>
            <td>${r.requested_by_name || ''}</td>
            <td>${purchaseCategoryBadgeHtml(r.category)}</td>
            <td class="num" style="text-align:right; font-variant-numeric:tabular-nums;">
                <span style="font-weight:600;">${formatPurchaseMoney(total)}</span>
                ${unpricedCount > 0 ? `<div style="font-size:0.68rem; color:var(--warning);">${prT('pr_items_partial_price', '{count} item(s) without a price').replace('{count}', unpricedCount)}</div>` : ''}
            </td>
            <td>${r.needed_by || '—'}</td>
        `;
        tr.addEventListener('click', () => openPurchaseRequestDetailPopup(r.id));
        tbody.appendChild(tr);
    });
}

// ============================================================
// FASE 2: CREATE / EDIT FORM (mockup layer 3 — .sr-grid two-column,
// same classes Stock Release uses in css/styles.css / js/packing.js)
// ============================================================

let _prCart = new Map();
let _prCartNextId = 1;

async function openPurchaseRequestFormModal(editId = null) {

    if (!editId && !hasPermission('purchase_request_create')) {
        await showWarningModal(prT('alert_pr_edit_denied', "You don't have permission to create a purchase request."), false);
        return;
    }

    const [{ data: requests }, { data: items }] = await Promise.all([
        fetchData('purchase_requests'),
        fetchData('purchase_request_items')
    ]);

    let existing = null;
    let existingItems = [];
    if (editId) {
        existing = (requests || []).find(r => r.id === editId);
        if (!existing) return;
        // Direct-access guard — this can be invoked with any id regardless of
        // whether the calling row's Edit button was even rendered (defense
        // in depth, same reasoning as canAccessCustomer's own comment).
        const canEdit = currentUser && existing.requested_by_id === currentUser.id && existing.status === 'Requested' && hasPermission('purchase_request_edit');
        if (!canEdit) {
            await showWarningModal(prT('alert_pr_edit_denied', "You can only edit your own request while it's still Requested."), false);
            return;
        }
        existingItems = (items || []).filter(i => i.purchase_request_id === editId);
    }

    _prCart = new Map();
    _prCartNextId = 1;
    existingItems.forEach(i => {
        _prCart.set(_prCartNextId++, {
            itemName: i.item_name, qty: i.qty, unit: i.unit,
            price: (i.estimated_price === null || i.estimated_price === undefined) ? '' : i.estimated_price,
            note: i.item_note || ''
        });
    });

    const requestNumber = existing ? existing.request_number : generatePurchaseRequestNumber(requests);
    const categoryOptions = PURCHASE_CATEGORIES.map(c =>
        `<option value="${c}" ${existing && existing.category === c ? 'selected' : ''}>${purchaseCategoryLabel(c)}</option>`
    ).join('');

    const html = `
        <form id="modal-pr-form" novalidate>
            <div class="sr-grid">
                <div>
                    <div style="display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; margin-bottom:12px;">
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label" data-i18n="lbl_pr_number">Request No.</label>
                            <input type="text" id="pr-number" class="form-control" value="${requestNumber}" readonly>
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label" data-i18n="lbl_pr_category">Category</label>
                            <select id="pr-category" class="form-control" required>${categoryOptions}</select>
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label" data-i18n="lbl_pr_needed_by">Needed By (optional)</label>
                            <input type="date" id="pr-needed-by" class="form-control" value="${existing && existing.needed_by ? existing.needed_by : ''}">
                        </div>
                    </div>

                    <div class="form-group" style="margin-bottom:12px;">
                        <label class="form-label" data-i18n="lbl_pr_purpose">Purpose</label>
                        <textarea id="pr-purpose" class="form-control" rows="2" required>${existing ? (existing.purpose || '') : ''}</textarea>
                    </div>

                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                        <div style="flex:1; height:1px; background:var(--border);"></div>
                        <span style="font-size:0.72rem; color:var(--text-muted);">+ item</span>
                        <div style="flex:1; height:1px; background:var(--border);"></div>
                    </div>

                    <div class="form-group" style="margin-bottom:10px;">
                        <label class="form-label" data-i18n="lbl_pr_item_name">Item Name</label>
                        <input type="text" id="pr-item-name" class="form-control">
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; margin-bottom:10px;">
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label" data-i18n="lbl_pr_item_qty">Qty</label>
                            <input type="number" id="pr-item-qty" class="form-control" value="1" min="1">
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label" data-i18n="lbl_pr_item_unit">Unit</label>
                            <input type="text" id="pr-item-unit" class="form-control" placeholder="pcs">
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label" data-i18n="lbl_pr_item_price">Est. Price (optional)</label>
                            <input type="number" id="pr-item-price" class="form-control" step="0.01" min="0">
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom:10px;">
                        <label class="form-label" data-i18n="lbl_pr_item_note">Item Note (optional)</label>
                        <input type="text" id="pr-item-note" class="form-control">
                    </div>
                    <button type="button" id="pr-btn-add-item" class="btn btn-secondary" style="width:100%;" data-i18n="btn_pr_add_item">+ Add to list</button>
                    <p style="font-size:0.72rem; color:var(--text-muted); margin-top:6px;" data-i18n="hint_pr_add_item">Add as many items as needed, as long as they're all the same category.</p>
                </div>

                <div class="sr-panel">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                        <span style="font-size:0.85rem; font-weight:700;" data-i18n="pr_panel_items_title">Items requested</span>
                        <span id="pr-cart-count" style="font-size:0.7rem; color:var(--primary); background:var(--primary-glow); border-radius:20px; padding:2px 9px;"></span>
                    </div>
                    <div id="pr-cart" class="sr-cart-scroll"></div>

                    <div class="form-group" style="margin:12px 0 0;">
                        <label class="form-label" data-i18n="lbl_pr_notes">Notes (optional)</label>
                        <input type="text" id="pr-notes" class="form-control" data-i18n-placeholder="ph_pr_notes" placeholder="additional note for the manager" value="${existing ? (existing.notes || '') : ''}">
                    </div>

                    <div style="display:flex; align-items:baseline; justify-content:space-between; border-top:1px solid var(--border); padding-top:10px; margin-top:12px;">
                        <div>
                            <div style="font-size:0.8rem; color:var(--text-secondary);" data-i18n="pr_est_total_label">Estimated total</div>
                            <div id="pr-total-note" style="font-size:0.7rem; color:var(--warning);"></div>
                        </div>
                        <span id="pr-total" style="font-size:1.5rem; font-weight:700; color:var(--primary);">${formatPurchaseMoney(0)}</span>
                    </div>

                    <div style="display:flex; gap:8px; margin-top:14px;">
                        <button type="button" class="btn btn-secondary" style="flex:1;" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                        <button type="submit" class="btn btn-primary" style="flex:1.5;" data-i18n="btn_pr_submit">Submit Request</button>
                    </div>
                </div>
            </div>
        </form>
    `;

    openModal(existing ? prT('modal_pr_edit', 'Edit Purchase Request') : prT('modal_pr_new', 'New Purchase Request'), html, '1000px');
    wirePurchaseRequestForm({ existing, requestNumber, requests });
}

function renderPurchaseCart() {
    const cartEl = document.getElementById('pr-cart');
    const countEl = document.getElementById('pr-cart-count');
    const totalEl = document.getElementById('pr-total');
    const totalNoteEl = document.getElementById('pr-total-note');
    if (!cartEl) return;

    const entries = Array.from(_prCart.entries());
    if (countEl) countEl.textContent = `${entries.length} ${prT('col_pr_items', 'items')}`;

    cartEl.innerHTML = entries.map(([id, item]) => {
        const hasPrice = item.price !== '' && item.price !== null && item.price !== undefined;
        const subParts = [];
        if (item.qty) subParts.push(`${item.qty}${item.unit ? ' ' + item.unit : ''}`);
        if (item.note) subParts.push(item.note);
        return `
            <div class="cart-card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 11px; margin-bottom: 8px; display: flex; align-items: center; gap: 10px;">
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; font-size:0.84rem;">${item.itemName}</div>
                    <div class="text-secondary-xs" style="margin-top:2px;">${subParts.join(' · ')}</div>
                </div>
                <div style="font-size:0.82rem; font-weight:600; white-space:nowrap; ${hasPrice ? '' : 'color:var(--warning); font-weight:500; font-size:0.72rem;'}">
                    ${hasPrice ? formatPurchaseMoney(Number(item.price) * (Number(item.qty) || 1)) : prT('lbl_pr_item_price_missing', 'no price')}
                </div>
                <button type="button" class="pr-cart-remove" data-cart-id="${id}" style="background:none; border:0; color:var(--text-muted); cursor:pointer; font-size:1rem; padding:2px 4px; line-height:1;">&times;</button>
            </div>
        `;
    }).join('');

    cartEl.querySelectorAll('.pr-cart-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            _prCart.delete(parseInt(btn.getAttribute('data-cart-id')));
            renderPurchaseCart();
        });
    });

    const itemsForTotal = entries.map(([, item]) => ({ estimated_price: item.price === '' ? null : item.price, qty: item.qty }));
    const { total, unpricedCount } = computePurchaseTotals(itemsForTotal);
    if (totalEl) totalEl.textContent = formatPurchaseMoney(total);
    if (totalNoteEl) {
        totalNoteEl.textContent = unpricedCount > 0
            ? prT('pr_items_partial_price', '{count} item(s) without a price').replace('{count}', unpricedCount)
            : '';
    }
}

function wirePurchaseRequestForm({ existing, requestNumber, requests }) {
    renderPurchaseCart();

    // Same non-blocking field-warning bubble as Sales Order's own copy in
    // js/sales.js (openSalesRequestModal) — found via user feedback
    // 2026-08-31 that the browser's native alert() for a missing field was
    // jarring and didn't point at the field. Kept as its own local closure
    // here rather than shared, matching how sales.js's own copy is scoped
    // to its own modal-wiring function, not exported globally.
    function showFieldWarn(el) {
        if (!el) return;
        el.parentElement.style.position = 'relative';
        const existingWarn = el.parentElement.querySelector('.custom-empty-warn');
        if (existingWarn) existingWarn.remove();
        const warnBubble = document.createElement('div');
        warnBubble.className = 'custom-empty-warn';
        warnBubble.style = 'position: absolute; bottom: -28px; left: 0; background: var(--danger); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; z-index: 10; white-space: nowrap; box-shadow: 0 2px 5px rgba(0,0,0,0.25);';
        warnBubble.innerHTML = `⚠️ ${prT('alert_field_required', 'Field is required')}<div style="position: absolute; top: -4px; left: 10px; width: 8px; height: 8px; background: var(--danger); transform: rotate(45deg);"></div>`;
        el.parentElement.appendChild(warnBubble);
        const removeHandler = () => { if (warnBubble.parentNode) warnBubble.remove(); };
        el.addEventListener('input', removeHandler, { once: true });
        el.addEventListener('change', removeHandler, { once: true });
    }

    document.getElementById('pr-btn-add-item').addEventListener('click', () => {
        const nameEl = document.getElementById('pr-item-name');
        const name = nameEl.value.trim();
        if (!name) {
            showFieldWarn(nameEl);
            nameEl.focus();
            return;
        }
        const qty = parseFloat(document.getElementById('pr-item-qty').value) || 1;
        const unit = document.getElementById('pr-item-unit').value.trim();
        const priceRaw = document.getElementById('pr-item-price').value;
        const price = priceRaw === '' ? '' : parseFloat(priceRaw);
        const note = document.getElementById('pr-item-note').value.trim();

        _prCart.set(_prCartNextId++, { itemName: name, qty, unit, price, note });
        renderPurchaseCart();

        // Clear the add-item fields for the next entry.
        nameEl.value = '';
        document.getElementById('pr-item-qty').value = '1';
        document.getElementById('pr-item-unit').value = '';
        document.getElementById('pr-item-price').value = '';
        document.getElementById('pr-item-note').value = '';
        nameEl.focus();
    });

    document.getElementById('modal-pr-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const categoryEl = document.getElementById('pr-category');
        const purposeEl = document.getElementById('pr-purpose');
        const category = categoryEl.value;
        const purpose = purposeEl.value.trim();
        const neededBy = document.getElementById('pr-needed-by').value || null;
        const notes = document.getElementById('pr-notes').value.trim();

        if (!category) { showFieldWarn(categoryEl); categoryEl.focus(); return; }
        if (!purpose) { showFieldWarn(purposeEl); purposeEl.focus(); return; }
        // Doesn't point at a single field — showWarningModal, not showFieldWarn.
        if (_prCart.size === 0) {
            await showWarningModal(prT('alert_pr_no_items', 'Add at least one item first.'), false);
            return;
        }

        const headerRecord = {
            id: existing ? existing.id : undefined,
            request_number: requestNumber,
            category,
            status: existing ? existing.status : 'Requested',
            purpose,
            notes: notes || null,
            needed_by: neededBy,
            requested_by_id: existing ? existing.requested_by_id : currentUser.id,
            requested_by_name: existing ? existing.requested_by_name : currentUser.name,
            request_date: existing ? existing.request_date : new Date().toISOString().split('T')[0]
        };

        const { data: savedRequest, error } = await saveData('purchase_requests', headerRecord);
        if (error) {
            alert(prT('alert_pr_save_failed', 'Failed to save purchase request: {msg}').replace('{msg}', error.message));
            return;
        }

        // Editing: delete old items and recreate — same pattern as Sales
        // Order's own non-approved-edit path (js/sales.js) rather than
        // diffing, since Purchase Request items have no external references
        // (no allocations, no linked plans) that a diff would need to preserve.
        if (existing) {
            const { data: allItems } = await fetchData('purchase_request_items');
            const oldItems = (allItems || []).filter(i => i.purchase_request_id === existing.id);
            for (const item of oldItems) {
                await deleteData('purchase_request_items', item.id);
            }
        }

        for (const [, item] of _prCart) {
            const itemRecord = {
                purchase_request_id: savedRequest.id,
                item_name: item.itemName,
                qty: item.qty || null,
                unit: item.unit || null,
                estimated_price: (item.price === '' || item.price === null || item.price === undefined) ? null : Number(item.price),
                item_note: item.note || null
            };
            const { error: itemErr } = await saveData('purchase_request_items', itemRecord);
            if (itemErr) {
                alert(prT('alert_pr_save_failed', 'Failed to save purchase request: {msg}').replace('{msg}', itemErr.message));
                return;
            }
        }

        document.getElementById('btn-close-modal').click();
        await loadPurchasingSection();
        if (typeof updateNavNotificationBadges === 'function') updateNavNotificationBadges();
    });
}

document.getElementById('btn-create-purchase-request').addEventListener('click', () => {
    openPurchaseRequestFormModal();
});

// ============================================================
// FASE 5: DETAIL POPUP + DECIDE (mockup layers 5/6/7)
// ============================================================
// Own stacked overlay (not openModal's singleton #modal-container) because
// Reject opens a SECOND dialog on top of this one — same reasoning as
// openAddCustomerShortcutModal's own overlay in js/sales.js.

function closePurchaseDetailPopup() {
    const el = document.getElementById('pr-detail-modal-container');
    if (el) el.classList.add('hidden');
}

async function openPurchaseRequestDetailPopup(id) {
    const [{ data: requests }, { data: items }] = await Promise.all([
        fetchData('purchase_requests'),
        fetchData('purchase_request_items')
    ]);
    const r = (requests || []).find(x => x.id === id);
    if (!r) return;
    const myItems = (items || []).filter(i => i.purchase_request_id === id);
    const { total, unpricedCount } = computePurchaseTotals(myItems);

    let container = document.getElementById('pr-detail-modal-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'pr-detail-modal-container';
        container.className = 'overlay';
        container.style.zIndex = '2000';
        document.body.appendChild(container);
    }

    // Banner: red with the reason if Rejected AND a reason was actually
    // given (§3.7 — the reason is optional, so a Rejected row with no
    // decision_note shows only the "Rejected by ... " line, no red box).
    let banner = '';
    if (r.status === 'Rejected') {
        const dateOnly = r.decided_at ? String(r.decided_at).split('T')[0] : '';
        const line = prT('lbl_pr_decided_rejected', 'Rejected by {name} · {date}').replace('{name}', r.decided_by_name || '').replace('{date}', dateOnly);
        banner = r.decision_note
            ? `<div style="background:rgba(239,68,68,0.10); border:1px solid rgba(239,68,68,0.35); border-left-width:3px; border-radius:8px; padding:12px 14px; margin-bottom:16px;">
                 <div style="font-size:0.68rem; color:var(--danger); text-transform:uppercase; letter-spacing:0.05em;">${line}</div>
                 <p style="font-size:0.85rem; margin-top:4px;">${r.decision_note}</p>
               </div>`
            : `<div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:16px;">${line}</div>`;
    } else if (r.status === 'Approved' && r.decided_by_name) {
        const dateOnly = r.decided_at ? String(r.decided_at).split('T')[0] : '';
        const line = prT('lbl_pr_decided_approved', 'Approved by {name} · {date}').replace('{name}', r.decided_by_name).replace('{date}', dateOnly);
        banner = `<div style="background:rgba(82,183,136,0.10); border:1px solid rgba(82,183,136,0.35); border-left-width:3px; border-radius:8px; padding:11px 14px; margin-bottom:16px;">
                     <div style="font-size:0.68rem; color:var(--success); text-transform:uppercase; letter-spacing:0.05em;">${line}</div>
                   </div>`;
    }

    const itemRows = myItems.map(i => {
        const hasPrice = i.estimated_price !== null && i.estimated_price !== undefined;
        return `
            <tr>
                <td>${i.item_name}${i.item_note ? `<div class="text-secondary-xs">${i.item_note}</div>` : ''}</td>
                <td>${i.qty || ''}${i.unit ? ' ' + i.unit : ''}</td>
                <td style="text-align:right; font-variant-numeric:tabular-nums;">${hasPrice ? formatPurchaseMoney(i.estimated_price) : `<span style="color:var(--warning); font-size:0.74rem;">${prT('lbl_pr_item_price_missing', 'no price')}</span>`}</td>
            </tr>
        `;
    }).join('');

    // Footer: manager (purchase_approval_decide) sees Reject/Approve on a
    // still-Requested row; everyone else just gets Close. §7.3 — this is a
    // real permission check inside the function, not just hiding a button:
    // decidePurchaseRequest() re-checks the same permission before writing.
    const canDecide = r.status === 'Requested' && hasPermission('purchase_approval_decide');
    const footer = canDecide
        ? `<button type="button" class="btn btn-secondary" id="pr-detail-close">${prT('btn_pr_close', 'Close')}</button>
           <button type="button" class="btn btn-danger" id="pr-detail-reject">${prT('btn_pr_reject', 'Reject')}</button>
           <button type="button" class="btn btn-primary" id="pr-detail-approve">${prT('btn_pr_approve', 'Approve')}</button>`
        : `<button type="button" class="btn btn-secondary" id="pr-detail-close">${prT('btn_pr_close', 'Close')}</button>`;

    container.innerHTML = `
        <div class="overlay-card" style="max-width: 640px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:4px;">
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <h3 style="font-size:1.1rem; font-weight:700;">${r.request_number || ''}</h3>
                    ${purchaseStatusBadgeHtml(r).split('<div')[0]}
                </div>
                <button type="button" id="pr-detail-x" style="background:transparent; border:0; cursor:pointer; color:var(--text-muted); font-size:1.5rem; line-height:1;">&times;</button>
            </div>

            ${banner}

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px,1fr)); gap:14px; margin-bottom:16px;">
                <div>
                    <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">${prT('col_pr_category', 'Category')}</div>
                    <div style="margin-top:2px;">${purchaseCategoryBadgeHtml(r.category)}</div>
                </div>
                <div>
                    <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">${prT('col_pr_requested_by', 'Requested By')}</div>
                    <div style="font-size:0.85rem; font-weight:600; margin-top:2px;">${r.requested_by_name || ''}</div>
                </div>
                <div>
                    <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">${prT('col_pr_request', 'Request Date')}</div>
                    <div style="font-size:0.85rem; font-weight:600; margin-top:2px;">${r.request_date || ''}</div>
                </div>
                <div>
                    <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">${prT('col_pr_needed_by', 'Needed By')}</div>
                    <div style="font-size:0.85rem; font-weight:600; margin-top:2px;">${r.needed_by || '—'}</div>
                </div>
            </div>

            <div>
                <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">${prT('lbl_pr_purpose', 'Purpose')}</div>
                <p style="font-size:0.86rem; margin-top:4px;">${r.purpose || ''}</p>
            </div>
            ${r.notes ? `<div style="margin-top:10px;"><div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">${prT('lbl_pr_notes', 'Notes')}</div><p style="font-size:0.86rem; margin-top:4px;">${r.notes}</p></div>` : ''}

            <div style="font-size:0.72rem; font-weight:700; letter-spacing:0.07em; text-transform:uppercase; color:var(--text-muted); margin:18px 0 10px; padding-top:14px; border-top:1px solid var(--border);">${prT('col_pr_items', 'Items')}</div>
            <div class="card" style="overflow:hidden;">
                <div class="table-container">
                    <table>
                        <thead><tr><th>${prT('lbl_pr_item_name', 'Item')}</th><th>${prT('lbl_pr_item_qty', 'Qty')}</th><th style="text-align:right;">${prT('col_pr_item_price', 'Est. Price')}</th></tr></thead>
                        <tbody>${itemRows}</tbody>
                    </table>
                </div>
            </div>

            <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; border-top:1px solid var(--border); padding-top:10px; margin-top:12px;">
                <div>
                    <div style="font-size:0.8rem; color:var(--text-secondary);">${prT('pr_est_total_label', 'Estimated total')}</div>
                    ${unpricedCount > 0 ? `<div style="font-size:0.7rem; color:var(--warning);">${prT('pr_items_partial_price', '{count} item(s) without a price').replace('{count}', unpricedCount)}</div>` : ''}
                </div>
                <span style="font-size:1.2rem; font-weight:700; color:var(--primary);">${formatPurchaseMoney(total)}</span>
            </div>

            <div class="modal-footer-actions">${footer}</div>
        </div>
    `;
    container.classList.remove('hidden');

    const close = () => container.classList.add('hidden');
    document.getElementById('pr-detail-x').addEventListener('click', close);
    const closeBtn = document.getElementById('pr-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', close);

    const approveBtn = document.getElementById('pr-detail-approve');
    if (approveBtn) approveBtn.addEventListener('click', () => decidePurchaseRequest(r.id, 'Approved', null));
    const rejectBtn = document.getElementById('pr-detail-reject');
    if (rejectBtn) rejectBtn.addEventListener('click', () => openPurchaseRejectDialog(r));

    if (typeof window.translatePage === 'function') window.translatePage();
}

// Opens ON TOP of the detail popup (z-index 2100 > 2000) — same nested-
// overlay technique the app already uses elsewhere for a shortcut form
// stacked over its parent modal.
function openPurchaseRejectDialog(r) {

    let container = document.getElementById('pr-reject-modal-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'pr-reject-modal-container';
        container.className = 'overlay';
        container.style.zIndex = '2100';
        document.body.appendChild(container);
    }

    container.innerHTML = `
        <div class="overlay-card" style="max-width: 480px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
                <h3 style="font-size:1rem; font-weight:700;">${prT('modal_pr_reject', 'Reject {number}').replace('{number}', r.request_number || '')}</h3>
                <button type="button" id="pr-reject-x" style="background:transparent; border:0; cursor:pointer; color:var(--text-muted); font-size:1.5rem; line-height:1;">&times;</button>
            </div>
            <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">${prT('lbl_pr_reject_reason', 'Rejection reason (optional)')}</label>
                <textarea id="pr-reject-reason" class="form-control" rows="3"></textarea>
                <p style="font-size:0.72rem; color:var(--text-muted); margin-top:5px;">${prT('hint_pr_reject_reason', "If filled in, the requester will see it on their request's details. If left blank, they'll only see the red status.")}</p>
            </div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" id="pr-reject-cancel">${prT('btn_cancel', 'Cancel')}</button>
                <button type="button" class="btn btn-danger" id="pr-reject-confirm">${prT('btn_pr_reject_confirm', 'Reject Request')}</button>
            </div>
        </div>
    `;
    container.classList.remove('hidden');

    const close = () => container.classList.add('hidden');
    document.getElementById('pr-reject-x').addEventListener('click', close);
    document.getElementById('pr-reject-cancel').addEventListener('click', close);
    // §3.7: reason is OPTIONAL — this button is never disabled, unlike a
    // required-field submit elsewhere in the app.
    document.getElementById('pr-reject-confirm').addEventListener('click', async () => {
        const reason = document.getElementById('pr-reject-reason').value.trim();
        close();
        await decidePurchaseRequest(r.id, 'Rejected', reason || null);
    });
}

async function decidePurchaseRequest(id, status, note) {
    // §7.3: hasPermission() returns true if the role can't be found at all
    // (js/auth.js) — hiding the Approve/Reject buttons is not enough on its
    // own, so the write path checks again right here.
    if (!hasPermission('purchase_approval_decide')) {
        await showWarningModal(prT('alert_pr_decide_denied', "You don't have permission to approve or reject purchase requests."), false);
        return;
    }
    const record = {
        id,
        status,
        decided_by_id: currentUser.id,
        decided_by_name: currentUser.name,
        decided_at: new Date().toISOString(),
        decision_note: note
    };
    const { error } = await saveData('purchase_requests', record);
    if (error) {
        alert(prT('alert_pr_decide_failed', 'Failed to save the decision: {msg}').replace('{msg}', error.message));
        return;
    }
    closePurchaseDetailPopup();
    await loadPurchasingSection();
    if (typeof updateNavNotificationBadges === 'function') updateNavNotificationBadges();
}
