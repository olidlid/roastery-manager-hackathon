// OTHER ITEMS MODULE - ROASTERY MANAGER V2 (OTHER_ITEMS_PLAN.md)
// ==========================================================================
// Stock for goods bought from outside and resold as-is (paper filters, cups,
// merchandise) — never touched by roasting/packing, so no lot/FIFO/expiry:
// one item carries one running stock_qty (other_items.stock_qty), and every
// change to it is written to other_item_movements by a DB trigger.
//
// Fase 1 (this file, first cut): section shell, Item List tab, Add/Edit
// form, Delete. Stock In / History / Stock Release (Fase 2-3) come later —
// their functions aren't stubbed here on purpose (no half-built code paths).
//
// HARD RULE (OTHER_ITEMS_PLAN.md §4.4): stock_qty must NEVER be sent through
// saveData('other_items', ...) directly. All stock changes go through the
// other_item_stock_in / other_item_consume / other_item_set_qty RPCs, so the
// ledger trigger always has a true picture of what changed and why.
//
// Mockup (spec, not a suggestion): https://claude.ai/artifact/HEnfx3fXTVxEmVi7H25MKV

const OTHER_ITEM_UNITS = ['pcs', 'box', 'roll', 'pack'];

// Shared translation-with-fallback helper for this file, same shape as
// purchasing.js's prT() — window.t() falls back to returning the bare key
// string for anything missing from js/translations.js, which would show
// literal key names like "btn_oi_save_item" in the UI.
function oiT(key, fallback) {
    if (!window.t) return fallback;
    const val = window.t(key);
    return (val === key) ? fallback : val;
}

// "20 Sep 2026" — no shared date formatter exists elsewhere in this app
// (every module formats dates inline its own way), so this stays local too.
function oiFormatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function oiLowBadgeHtml() {
    return `<span class="badge" style="background:rgba(239,68,68,0.16); color:var(--danger);">${oiT('pill_oi_low', 'Low')}</span>`;
}

// ============================================================
// SECTION / TAB LOADING
// ============================================================
async function loadOtherItemsSection() {
    const activeTabBtn = document.querySelector('#sec-other-items .tab-btn.active');
    await loadOtherItemsTabSpecificData(activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'tab-oi-list');
}

async function loadOtherItemsTabSpecificData(tabId) {
    if (tabId === 'tab-oi-release') {
        // Static placeholder card for now (OTHER_ITEMS_PLAN.md Fase 3)  —
        // nothing to load yet.
        return;
    }
    await loadOtherItemsList();
}

// Page-level tab-btn wiring, same pattern as sec-purchasing's in js/app.js
// (data-tab + .tab-content), wired once at boot and scoped to this section
// only — never reuse Packing's .packing-tab-content class name for a
// second section's own tab switcher, since Packing's click handler hides
// EVERY .packing-tab-content in the whole document, not just its own.
const otherItemsTabBtns = document.querySelectorAll('#sec-other-items .tab-btn');
const otherItemsTabContents = document.querySelectorAll('#sec-other-items .tab-content');

otherItemsTabBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const targetTab = btn.getAttribute('data-tab');

        otherItemsTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        otherItemsTabContents.forEach(content => {
            content.classList.toggle('hidden', content.id !== targetTab);
        });

        saveLastTab('sec-other-items', targetTab);
        await loadOtherItemsTabSpecificData(targetTab);
    });
});

const btnOiAddItem = document.getElementById('btn-oi-add-item');
if (btnOiAddItem) {
    btnOiAddItem.addEventListener('click', () => openOtherItemFormModal());
}

// ============================================================
// TAB: ITEM LIST
// ============================================================
function renderOtherItemRow(item) {
    const isLow = (item.stock_qty || 0) < (item.min_stock || 0);
    return `
        <tr>
            <td><strong>${item.name}</strong></td>
            <td>${item.unit || 'pcs'}</td>
            <td>${item.stock_qty || 0}${isLow ? ` ${oiLowBadgeHtml()}` : ''}</td>
            <td class="text-secondary-xs">${item.min_stock || 0}</td>
            <td class="text-secondary-xs">${oiFormatDate(item.updated_at || item.created_at)}</td>
            <td class="text-nowrap">
                ${hasPermission('other_items_edit') ? `<button class="btn btn-outline btn-sm" onclick="openOtherItemFormModal(${item.id})">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle-mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>` : ''}
                ${hasPermission('other_items_delete') ? `<button class="btn btn-danger btn-sm ml-1" onclick="deleteOtherItem(${item.id})">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>` : ''}
            </td>
        </tr>
    `;
}

async function loadOtherItemsList() {
    const tbody = document.getElementById('oi-items-table-body');
    if (!tbody) return;

    const { data: items } = await fetchData('other_items');
    const sorted = [...(items || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const statItems = document.getElementById('stat-oi-items');
    const statLow = document.getElementById('stat-oi-low');
    const statOut = document.getElementById('stat-oi-out');
    if (statItems) statItems.textContent = sorted.length;
    if (statLow) statLow.textContent = sorted.filter(i => (i.stock_qty || 0) < (i.min_stock || 0)).length;
    if (statOut) statOut.textContent = sorted.filter(i => (i.stock_qty || 0) === 0).length;

    const addBtn = document.getElementById('btn-oi-add-item');
    if (addBtn) addBtn.style.display = hasPermission('other_items_add') ? '' : 'none';

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-secondary-xs" style="text-align:center; padding: 24px;">${oiT('oi_no_items', 'No other items yet.')}</td></tr>`;
    } else {
        tbody.innerHTML = sorted.map(renderOtherItemRow).join('');
    }

    // Manual step, not automatic — every other filterable table in this app
    // calls this after (re)rendering its rows (see js/greenbean.js,
    // js/roasting.js, js/sales.js for the same call).
    applyFiltersForTable(document.querySelector('#tab-oi-list table'));
}

// ============================================================
// ADD / EDIT ITEM (one form, mockup screen 2)
// ============================================================
async function openOtherItemFormModal(itemId = null) {
    let item = { name: '', unit: 'pcs', min_stock: 0, stock_qty: 0 };
    if (itemId) {
        const { data: items } = await fetchData('other_items');
        item = (items || []).find(i => i.id === itemId) || item;
    }

    const unitOptions = OTHER_ITEM_UNITS.map(u =>
        `<option value="${u}" ${item.unit === u ? 'selected' : ''}>${u}</option>`
    ).join('');

    const html = `
        <form id="modal-oi-form">
            <div class="form-group">
                <label class="form-label" data-i18n="lbl_oi_name">Item Name</label>
                <input type="text" id="m-oi-name" class="form-control" value="${item.name}" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" data-i18n="lbl_oi_unit">Unit</label>
                    <select id="m-oi-unit" class="form-control">${unitOptions}</select>
                </div>
                <div class="form-group">
                    <label class="form-label" data-i18n="lbl_oi_min_stock">Min Stock</label>
                    <input type="number" id="m-oi-min" class="form-control" min="0" step="1" value="${item.min_stock || 0}">
                    <small class="text-secondary-xs" data-i18n="hint_oi_min_stock">Below this the row shows Low.</small>
                </div>
            </div>
            <hr style="border-color: var(--border); margin: 16px 0;">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" data-i18n="lbl_oi_current_stock">Current Stock</label>
                    <input type="number" id="m-oi-stock" class="form-control" min="0" step="1" value="${item.stock_qty || 0}">
                    <small class="text-secondary-xs" data-i18n="hint_oi_current_stock">Changing this records a stock correction in the item history.</small>
                </div>
                <div class="form-group">
                    <label class="form-label" data-i18n="lbl_oi_reason">Reason for correction</label>
                    <input type="text" id="m-oi-reason" class="form-control" data-i18n-placeholder="ph_oi_reason" placeholder="Required only if stock is changed">
                </div>
            </div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                <button type="submit" class="btn btn-primary" data-i18n="btn_oi_save_item">Save Item</button>
            </div>
        </form>
    `;

    openModal(itemId ? oiT('modal_oi_edit', 'Edit Item') : oiT('modal_oi_add', 'Add Item'), html);
    window.translatePage();

    const nameInput = document.getElementById('m-oi-name');

    // Same non-blocking field-warning bubble as Purchase Request's own copy
    // in js/purchasing.js — kept as its own local closure, not shared, same
    // reasoning noted there (each modal-wiring function scopes its own).
    function showFieldWarn(el) {
        if (!el) return;
        el.parentElement.style.position = 'relative';
        const existingWarn = el.parentElement.querySelector('.custom-empty-warn');
        if (existingWarn) existingWarn.remove();
        const warnBubble = document.createElement('div');
        warnBubble.className = 'custom-empty-warn';
        warnBubble.style = 'position: absolute; bottom: -28px; left: 0; background: var(--danger); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; z-index: 10; white-space: nowrap; box-shadow: 0 2px 5px rgba(0,0,0,0.25);';
        warnBubble.innerHTML = `${oiT('alert_field_required', '⚠️ Field is required!')}<div style="position: absolute; top: -4px; left: 10px; width: 8px; height: 8px; background: var(--danger); transform: rotate(45deg);"></div>`;
        el.parentElement.appendChild(warnBubble);
        const removeHandler = () => { if (warnBubble.parentNode) warnBubble.remove(); };
        el.addEventListener('input', removeHandler, { once: true });
        el.addEventListener('change', removeHandler, { once: true });
    }

    document.getElementById('modal-oi-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = nameInput.value.trim();
        if (!name) {
            showFieldWarn(nameInput);
            nameInput.focus();
            return;
        }

        const unit = document.getElementById('m-oi-unit').value;
        const minStock = parseInt(document.getElementById('m-oi-min').value, 10) || 0;
        const newStock = Math.max(0, parseInt(document.getElementById('m-oi-stock').value, 10) || 0);
        const reasonEl = document.getElementById('m-oi-reason');
        const reason = reasonEl.value.trim();

        // A brand new item's starting count isn't a "correction" — nothing
        // to correct FROM — so no reason is required on Add, only on Edit
        // when the number actually differs from what's on record.
        const stockChanged = itemId !== null && newStock !== (item.stock_qty || 0);
        if (stockChanged && !reason) {
            showFieldWarn(reasonEl);
            reasonEl.focus();
            return;
        }

        // updated_at sent explicitly: a plain saveData() edit that only
        // touches name/unit/min_stock would otherwise leave this column
        // stale, since only the stock RPCs below set it themselves.
        const record = { name, unit, min_stock: minStock, updated_at: new Date().toISOString() };
        if (itemId) record.id = itemId;

        const { data: saved, error } = await saveData('other_items', record);
        if (error) {
            const isDup = error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '');
            const msg = isDup
                ? oiT('alert_oi_name_duplicate', 'An item named "{name}" already exists.').replace('{name}', name)
                : oiT('alert_oi_save_failed', 'Failed to save item: {msg}').replace('{msg}', error.message);
            await showWarningModal(msg, false);
            return;
        }

        // Stock is NEVER part of the record above (§4.4) — it only ever
        // moves through this RPC, so the ledger trigger sees every change.
        if (!itemId) {
            if (newStock > 0) {
                await window.supabaseClient.rpc('other_item_set_qty', {
                    p_item_id: saved.id, p_qty: newStock,
                    p_operation: 'item_created', p_ref_table: null, p_ref_id: null,
                    p_date: null, p_reason: null, p_user: (currentUser && currentUser.name) || null
                });
            }
        } else if (stockChanged) {
            const { error: rpcErr } = await window.supabaseClient.rpc('other_item_set_qty', {
                p_item_id: itemId, p_qty: newStock,
                p_operation: 'adjustment', p_ref_table: null, p_ref_id: null,
                p_date: null, p_reason: reason, p_user: (currentUser && currentUser.name) || null
            });
            if (rpcErr) {
                await showWarningModal(oiT('alert_oi_save_failed', 'Failed to save item: {msg}').replace('{msg}', rpcErr.message), false);
                return;
            }
        }

        modalContainer.classList.add('hidden');
        loadOtherItemsList();
    });
}

// ============================================================
// DELETE
// ============================================================
// No guard yet against deleting an item that still has open order lines —
// request_order_other_items doesn't get written to until Fase 4/5, so
// there's nothing to orphan before then. See OTHER_ITEMS_PLAN.md §10b
// finding #4 for what Fase 4/5 must add here.
async function deleteOtherItem(id) {
    const { data: items } = await fetchData('other_items');
    const item = (items || []).find(i => i.id === id);
    if (!item) return;

    const label = `"${item.name}" (current stock: ${item.stock_qty || 0} ${item.unit || 'pcs'})`;
    if (await showDeleteConfirmModal(label)) {
        const { error } = await deleteData('other_items', id);
        if (error) {
            await showWarningModal(oiT('alert_oi_delete_failed', 'Failed to delete item: {msg}').replace('{msg}', error.message), false);
        } else {
            loadOtherItemsList();
        }
    }
}
