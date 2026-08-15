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
