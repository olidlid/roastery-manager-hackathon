// DATABASE MODULE - ROASTERY MANAGER V2
// Plain script (shared global scope with app.js and the other split files —
// NOT an ES module). Split out of app.js during the V1 refactor: everything
// here is CRUD access to Supabase (or the mock/localStorage fallback) plus
// the global saving indicator that wraps every mutation.
// Load order matters: this file must be loaded BEFORE app.js and the other
// UI modules, since they call fetchData/saveData/deleteData/upsertData
// directly as globals.

// Helper to get/set mock DB tables
function getMockTable(table) {
    return JSON.parse(localStorage.getItem(`mock_${table}`));
}
function setMockTable(table, data) {
    localStorage.setItem(`mock_${table}`, JSON.stringify(data));
}

// ============================================================
// IN-MEMORY CACHE - eliminates repeated JSON.parse on each action
// ============================================================
const _dbCache = new Map();

function getCachedTable(table) {
    if (!_dbCache.has(table)) {
        _dbCache.set(table, getMockTable(table));
    }
    return _dbCache.get(table);
}

function invalidateCache(table) {
    _dbCache.delete(table);
}

// Fetch helper that handles both Live and Mock databases.
//
// Live mode pages through .range() in chunks of PAGE_SIZE instead of a bare
// .select('*') — PostgREST silently caps an unranged select at 1000 rows
// (Supabase's default db-max-rows), so any table that grows past 1000 rows
// would have its newest rows quietly missing from every fetchData caller,
// with no error anywhere. Found 2026-08-15: roast_batches had crossed 1000
// rows and the newest logged batch (id 1094) never reached the browser —
// not a rendering bug, the row simply never arrived in the response. Paging
// here (rather than at each of the ~40 call sites) fixes it for every table
// at once, including ones that haven't hit the cap yet but will over time.
async function fetchData(table) {
    if (isMockMode) {
        return { data: getCachedTable(table), error: null };
    } else {
        try {
            const PAGE_SIZE = 1000;
            let allData = [];
            let from = 0;
            while (true) {
                const { data, error } = await window.supabaseClient.from(table).select('*').range(from, from + PAGE_SIZE - 1);
                if (error) throw error;
                allData = allData.concat(data || []);
                if (!data || data.length < PAGE_SIZE) break;
                from += PAGE_SIZE;
            }
            return { data: allData, error: null };
        } catch (e) {
            console.error(`Supabase fetch failed for ${table}, switching to mock:`, e);
            return { data: getCachedTable(table), error: e };
        }
    }
}

// Shared aggregation for anything that groups request_orders/request_order_items
// by some key (customer, sales agent, ...) and sums orders/bags/kg over an
// optional date range. Extracted from loadCustomerReport's inline computation
// (js/app.js) so Reports and the Customers-section CRM badges/leaderboard
// share one formula instead of two copies quietly drifting apart — this repo
// has a documented history of exactly that kind of drift causing bugs.
function computeOrderStatsByKey(orders, items, {
    groupByFn,                              // (order) => key | null/undefined (excluded)
    startDate = null,                       // 'YYYY-MM-DD' or null = unbounded
    endDate = null,
    statuses = ['Dispatched', 'Completed']  // mirrors loadCustomerReport's existing definition of "shipped"
} = {}) {
    const inDateRange = (o) => {
        const d = o.order_date || o.created_at?.split('T')[0];
        if (!d) return true;
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        return true;
    };

    const filteredOrders = (orders || []).filter(o => statuses.includes(o.status) && inDateRange(o));

    const stats = {};
    const orderIdToKey = {};
    filteredOrders.forEach(o => {
        const key = groupByFn(o);
        if (key == null) return;
        if (!stats[key]) stats[key] = { orderIds: new Set(), bags: 0, kg: 0, orderDates: [] };
        stats[key].orderIds.add(o.id);
        orderIdToKey[o.id] = key;
        const d = o.order_date || o.created_at?.split('T')[0];
        if (d) stats[key].orderDates.push(d);
    });

    (items || []).forEach(item => {
        const key = orderIdToKey[item.request_order_id];
        if (key == null) return;
        const qty = parseInt(item.quantity_requested) || 0;
        const sizeG = parseInt(item.bag_size_g) || 0;
        stats[key].bags += qty;
        stats[key].kg += (qty * sizeG) / 1000;
    });

    const result = {};
    Object.keys(stats).forEach(key => {
        const s = stats[key];
        const dates = s.orderDates.slice().sort();
        let avgIntervalDays = null;
        if (dates.length >= 2) {
            const gaps = [];
            for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
            avgIntervalDays = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        }
        result[key] = {
            orderCount: s.orderIds.size,
            bags: s.bags,
            kg: s.kg,
            firstOrderDate: dates[0] || null,
            lastOrderDate: dates[dates.length - 1] || null,
            avgIntervalDays,
            orderDates: dates
        };
    });
    return result;
}

function median(numbers) {
    const arr = (numbers || []).filter(n => typeof n === 'number' && !isNaN(n)).slice().sort((a, b) => a - b);
    if (arr.length === 0) return null;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

function daysBetween(dateStrA, dateStrB) {
    return Math.round((new Date(dateStrB) - new Date(dateStrA)) / (1000 * 60 * 60 * 24));
}

// Stock Opname Phase 2: turns the freeze trigger's raw Postgres exception
// (stock_take_freeze_guard, database/v2_stock_opname_freeze_migration.sql)
// into a message a person can act on, instead of leaving every write call
// site across the app to interpret a bare Postgres error object itself.
// Checked here — the one place every mutation already passes through —
// rather than at each call site. Fire-and-forget: does NOT await or change
// what saveDataImpl/deleteDataImpl return, so every existing caller's own
// error handling (alert/console.error/etc.) still runs exactly as before;
// this only adds an extra, friendlier notice on top of it.
function _handleStockFreezeError(e) {
    if (e && typeof e.message === 'string' && e.message.includes('Stock opname sedang berjalan')) {
        if (typeof showWarningModal === 'function') {
            // The trigger's own RAISE text is Indonesian (database side);
            // show the translated app message instead.
            showWarningModal(stT('stock_freeze_active', STOCK_FREEZE_FALLBACK), false, stT('stock_freeze_title', 'Stock opname in progress'), null, 'warning');
        }
    }
}

// ---------------------------------------------------------------------------
// Shared stock-write safety helpers (stock-path audit, 2026-09-22).
// Every flow that changes green/bulk/packed stock calls ensureNoStockOpname()
// BEFORE its first write: while a stock opname is 'counting'/'posting' the
// database freeze trigger rejects every stock-lot write, and flows that only
// console.error'd that rejection left half-saved records (the BRAZIL ROSA
// 1620 kg lot, the 26 Aug pack-from-bulk). Checking up front means nothing is
// written at all, and the user is told why.
// ---------------------------------------------------------------------------
const STOCK_FREEZE_FALLBACK = 'A stock count (stock opname) is in progress. Stock cannot change until it is finished or cancelled — nothing was saved.';

function stT(key, fallback) {
    if (!window.t) return fallback;
    const v = window.t(key);
    return v && v !== key ? v : fallback;
}

// { running: boolean, error } — error set when the check itself failed.
async function isStockOpnameRunning() {
    try {
        const { data, error } = await window.supabaseClient
            .from('stock_takes').select('id').in('status', ['counting', 'posting']).limit(1);
        if (error) return { running: false, error };
        return { running: !!(data && data.length), error: null };
    } catch (e) {
        return { running: false, error: e };
    }
}

// Returns true when it is safe to write stock; otherwise shows why and
// returns false. A failed check is treated as "not safe" — the same network
// problem would make the writes themselves fail half-way.
async function ensureNoStockOpname() {
    const { running, error } = await isStockOpnameRunning();
    if (error) {
        await showStockFailed(error.message || String(error));
        return false;
    }
    if (running) {
        await showWarningModal(stT('stock_freeze_active', STOCK_FREEZE_FALLBACK), false, stT('stock_freeze_title', 'Stock opname in progress'), null, 'warning');
        return false;
    }
    return true;
}

// Nothing was written (or everything written was undone) — safe to retry.
async function showStockFailed(reason) {
    await showWarningModal(
        stT('stock_op_failed_msg', 'Nothing was changed — stock is the same as before. You can try again.\n\nReason: {reason}').replace('{reason}', reason || '-'),
        false, stT('stock_op_failed_title', 'Not saved'), null, 'warning');
}

// Something was written and could not be fully undone or confirmed — the
// user must NOT simply repeat the action.
async function showStockPartial(detail) {
    await showWarningModal(
        stT('stock_op_partial_msg', 'Part of this action could not be completed. Do NOT repeat it yet — check the stock first and report this to the admin.\n\nDetail: {detail}').replace('{detail}', detail || '-'),
        false, stT('stock_op_partial_title', 'Check stock before retrying'), null, 'warning');
}

async function saveDataImpl(table, record) {
    if (isMockMode) {
        let tableData = getMockTable(table);
        if (!tableData) {
            tableData = [];
            setMockTable(table, tableData);
        }
        if (record.id) {
            // Update
            const idx = tableData.findIndex(item => item.id === record.id);
            if (idx !== -1) tableData[idx] = { ...tableData[idx], ...record };
        } else {
            // Insert
            record.id = tableData.length > 0 ? Math.max(...tableData.map(d => d.id)) + 1 : 1;
            record.created_at = record.created_at || new Date().toISOString();
            tableData.push(record);
        }
        setMockTable(table, tableData);
        invalidateCache(table); // << Clear cache so next fetchData re-reads fresh data
        return { data: record, error: null };
    } else {
        try {
            let res;
            if (record.id) {
                res = await window.supabaseClient.from(table).update(record).eq('id', record.id).select().single();
            } else {
                res = await window.supabaseClient.from(table).insert(record).select().single();
            }
            if (res.error) throw res.error;
            return { data: res.data, error: null };
        } catch (e) {
            console.error(`Supabase save failed for ${table}:`, e);
            _handleStockFreezeError(e);
            return { data: null, error: e };
        }
    }
}

async function deleteDataImpl(table, id) {
    if (isMockMode) {
        let tableData = getMockTable(table);
        tableData = tableData.filter(item => item.id !== id);
        setMockTable(table, tableData);
        invalidateCache(table); // << Clear cache on delete too
        return { error: null };
    } else {
        try {
            const { error } = await window.supabaseClient.from(table).delete().eq('id', id);
            if (error) throw error;
            return { error: null };
        } catch (e) {
            console.error(`Supabase delete failed for ${table}:`, e);
            _handleStockFreezeError(e);
            return { error: e };
        }
    }
}

// --- Global saving indicator ---------------------------------------------
// Every mutation in the app goes through saveData()/deleteData(), so wrapping
// these two functions is enough to show loading feedback everywhere without
// touching each individual save/delete call site. A counter (not a boolean)
// is required because some flows fire several saves in a row (e.g. a blend's
// ingredient rows, or splitting output across multiple roasting plans) —
// the indicator should stay up for the whole burst, not flicker between calls.
let _savingCount = 0;

function _showSavingIndicator() {
    _savingCount++;
    const el = document.getElementById('global-saving-indicator');
    if (el) el.classList.remove('hidden');
}

function _clearSavingButton(b) {
    b.classList.remove('is-saving');
    b.disabled = false;
    if (b._savingWatchdog) { clearTimeout(b._savingWatchdog); b._savingWatchdog = null; }
}

function _hideSavingIndicator() {
    _savingCount = Math.max(0, _savingCount - 1);
    if (_savingCount === 0) {
        const el = document.getElementById('global-saving-indicator');
        if (el) el.classList.add('hidden');
        // Release any submit button that was marked mid-save (see the global
        // submit listener below). Modals that closed on success already took
        // the button with them; this only matters for the failure/validation
        // path where the modal stays open.
        document.querySelectorAll('button.is-saving').forEach(_clearSavingButton);
    }
}

async function saveData(table, record) {
    _showSavingIndicator();
    try {
        return await saveDataImpl(table, record);
    } finally {
        _hideSavingIndicator();
    }
}

async function deleteData(table, id) {
    _showSavingIndicator();
    try {
        return await deleteDataImpl(table, id);
    } finally {
        _hideSavingIndicator();
    }
}

// Upsert wrapper for the handful of places that legitimately need
// insert-or-update semantics (company_settings single row, custom_roles) and
// therefore can't go through saveData() (which is update-by-id only). Routing
// them here means they still participate in the saving indicator, so their
// submit button's spinner clears when the write finishes — the bug where the
// Settings "Save" button span forever otherwise.
async function upsertData(table, record) {
    _showSavingIndicator();
    try {
        return await window.supabaseClient.from(table).upsert(record);
    } catch (e) {
        return { data: null, error: e };
    } finally {
        _hideSavingIndicator();
    }
}

// Mark the pressed submit button as "saving" the instant a form is submitted,
// so the click feels acknowledged right away instead of the UI looking frozen
// while the request round-trips. Capture phase so this runs before the
// form's own submit handler starts its async work.
document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    btn.classList.add('is-saving');
    // Safety net: if this form's handler never routes through saveData/
    // deleteData/upsertData (e.g. the login/forgot-password forms, which just
    // call supabaseClient.auth directly), _hideSavingIndicator would never
    // fire and the spinner would be stuck forever. Force-clear after a bounded
    // wait; the fast path (_hideSavingIndicator) clears it in milliseconds and
    // cancels this timer.
    if (btn._savingWatchdog) clearTimeout(btn._savingWatchdog);
    btn._savingWatchdog = setTimeout(() => _clearSavingButton(btn), 8000);
}, true);
