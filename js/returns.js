// ============================================================================
// Item Return — Packing → Returns (2026-10-04, mockup approved v10)
// ----------------------------------------------------------------------------
// Returned coffee is recorded first without touching stock ("floating"),
// then each item goes to packed inventory, a bulk card (tag RETURN) or waste
// — straight from the Record Return modal ("Send to") or later via Action.
//
// Tables (database/stock_returns_migration.sql):
//   stock_returns         header: number, date, customer / free-text origin
//   stock_return_items    what came back: identity, machine, roast date,
//                         sealed bags + opened kg
//   stock_return_actions  every movement of an item (never edited/deleted
//                         except to roll back the same failed operation)
//   stock_return_edits    silent log of Edit Return saves (investigation only)
// Remaining of an item = sealed_pcs / opened_kg minus its actions.
//
// Identity (coffee_kind): 'single' green coffee · 'recipe' blend recipe ·
// 'custom' custom blend (from its sticker) · 'unknown' — no sticker and the
// roast log had 0 or several coffees for code + machine + roast date.
// Sales reads every kind through coffee_code + coffee_type.
//
// Stock only moves through the existing paths: refund_packed_lot into an
// existing lot (returned bags were already counted as packed, so
// quantity_pcs is NOT raised), getOrCreatePackedCoffeeLot for a new lot,
// bulk_roasted_coffee inserts (mv_operation 'return'), waste_inventory rows.
// Labels print through the bulk card's own printer (printLotLabelSets).
// ============================================================================

function rtT(key, fallback) { return stT(key, fallback); }
const rtEsc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rtToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const rtSize = g => (parseInt(g) || 0) >= 1000 ? `${(parseInt(g) || 0) / 1000}kg` : `${g}g`;
const rtUser = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || null;
let returnsFilter = 'open';

// ---------- shared helpers ----------
function rtRemaining(item, actions) {
    const acts = (actions || []).filter(a => a.return_item_id === item.id);
    const sealed = (parseInt(item.sealed_pcs) || 0) - acts.filter(a => a.part === 'sealed').reduce((s, a) => s + (parseInt(a.qty_pcs) || 0), 0);
    const opened = +((parseFloat(item.opened_kg) || 0) - acts.filter(a => a.part === 'opened').reduce((s, a) => s + (parseFloat(a.kg) || 0), 0)).toFixed(3);
    return { sealed: Math.max(0, sealed), opened: Math.max(0, opened) };
}
function rtItemStatus(item, actions) {
    const r = rtRemaining(item, actions);
    if (r.sealed <= 0 && r.opened <= 0.0005) return 'done';
    return (actions || []).some(a => a.return_item_id === item.id) ? 'partial' : 'need';
}
function rtQtyText(sealed, opened, size) {
    const parts = [];
    if (sealed > 0) parts.push(`${sealed} × ${rtSize(size)}`);
    if (opened > 0.0005) parts.push(`${(+opened).toFixed(2)} kg ${rtT('ret_opened_short', 'opened')}`);
    return parts.join(' + ') || '—';
}
function rtItemKg(item) { return (parseInt(item.sealed_pcs) || 0) * (parseInt(item.bag_size_g) || 0) / 1000 + (parseFloat(item.opened_kg) || 0); }
function rtCoffeeLabel(item) {
    if (item.coffee_kind === 'unknown') return `${item.coffee_name} — ${item.coffee_type === 'Blend' ? rtT('ret_recipe_unknown', 'recipe Unknown') : rtT('ret_origin_unknown', 'origin Unknown')}`;
    return item.coffee_kind === 'custom' ? `${item.coffee_name} (${rtT('ret_custom_blend', 'custom blend')})` : item.coffee_name;
}
function rtViaLabel(item) {
    if (item.resolved_via === 'sticker') return rtT('ret_via_sticker', 'from sticker');
    if (item.resolved_via === 'roast_log') return rtT('ret_via_roast_log', 'found in roast log');
    if (item.resolved_via === 'manual') return rtT('ret_via_manual', 'picked by hand');
    const n = Array.isArray(item.candidates) ? item.candidates.length : 0;
    return rtT('ret_via_unknown', 'Unknown · {n} candidates').replace('{n}', n);
}
// Name used on bulk cards / packed rows — the same "(Single)/(Blend)" suffix
// the roast-log and pack paths use, so name-matching resolvers find it.
function rtStockName(item) {
    if (item.coffee_kind === 'single') return `${item.coffee_name} (Single)`;
    if (item.coffee_kind === 'recipe') return `${item.coffee_name} (Blend)`;
    return item.coffee_name;
}
// Custom blends and unknown coffees carry their sales code on stock rows.
function rtCodeInfo(item) {
    return (item.coffee_kind === 'custom' || item.coffee_kind === 'unknown')
        ? { coffee_code: item.coffee_code, coffee_code_type: item.coffee_type } : null;
}
const rtSb = () => window.supabaseClient;
async function rtQ(promise) { const { data, error } = await promise; if (error) throw error; return data; }

// Ready to Pack: one line per return card — "From return RET-… · origin".
async function returnProvenanceForBulk(bulkIds) {
    const out = new Map();
    if (!bulkIds || !bulkIds.length) return out;
    try {
        const acts = await rtQ(rtSb().from('stock_return_actions').select('return_item_id, target_bulk_id, part, qty_pcs, kg').in('target_bulk_id', bulkIds));
        if (!acts.length) return out;
        const items = await rtQ(rtSb().from('stock_return_items').select('id, return_id, bag_size_g').in('id', [...new Set(acts.map(a => a.return_item_id))]));
        const rets = await rtQ(rtSb().from('stock_returns').select('id, return_number, customer_id, origin_text').in('id', [...new Set(items.map(i => i.return_id))]));
        const custIds = [...new Set(rets.map(r => r.customer_id).filter(Boolean))];
        const custs = custIds.length ? await rtQ(rtSb().from('customers').select('id, name').in('id', custIds)) : [];
        bulkIds.forEach(id => {
            const mine = acts.filter(a => a.target_bulk_id === id);
            if (!mine.length) return;
            const parts = [];
            const nums = new Set();
            mine.forEach(a => {
                const it = items.find(i => i.id === a.return_item_id); if (!it) return;
                const r = rets.find(x => x.id === it.return_id); if (!r) return;
                const origin = r.customer_id ? ((custs.find(c => c.id === r.customer_id) || {}).name || '-') : (r.origin_text || '-');
                nums.add(`${r.return_number} · ${origin}`);
                parts.push(a.part === 'sealed' ? `${a.qty_pcs} × ${rtSize(it.bag_size_g)} ${rtT('ret_opened_into_bulk', 'opened')}` : `${(+a.kg).toFixed(2)} kg ${rtT('ret_opened_short', 'opened')}`);
            });
            out.set(id, rtEsc(`${rtT('ret_from_return', 'From return')} ${[...nums].join(', ')} · ${parts.join(' + ')}`));
        });
    } catch (e) { console.warn('return provenance unavailable:', e.message || e); }
    return out;
}

// ============================================================================
// Returns tab
// ============================================================================
// Disable the clicked button and show "Loading…" until its modal is open.
async function rtWithBusy(btn, fn) {
    if (!btn || btn.disabled) return;
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = rtT('hist_loading', 'Loading…');
    try { await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
}

async function loadReturnsSection() {
    const btn = document.getElementById('btn-record-return');
    if (btn) {
        btn.style.display = hasPermission('returns_manage') ? '' : 'none';
        btn.onclick = () => rtWithBusy(btn, openRecordReturnModal);
        if (hasPermission('returns_manage')) rtLoadRefs(true).catch(() => {});
    }
    const chips = document.getElementById('returns-filters');
    if (chips) chips.onclick = (e) => {
        const b = e.target.closest('[data-f]'); if (!b) return;
        returnsFilter = b.dataset.f;
        loadReturnsSection();
    };
    const tbody = document.getElementById('returns-tbody');
    if (!tbody) return;
    let rets, items, actions, customers, machines;
    try {
        [rets, items, actions, customers, machines] = await Promise.all([
            rtQ(rtSb().from('stock_returns').select('*').order('return_date', { ascending: false }).order('id', { ascending: false }).limit(300)),
            rtQ(rtSb().from('stock_return_items').select('*')),
            rtQ(rtSb().from('stock_return_actions').select('*').order('id')),
            rtQ(rtSb().from('customers').select('id, name')),
            rtQ(rtSb().from('machines').select('id, name'))
        ]);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center-muted">${rtEsc(rtT('ret_load_failed', 'Could not load returns: {msg}').replace('{msg}', e.message || e))}</td></tr>`;
        return;
    }
    const mName = id => ((machines || []).find(m => m.id === id) || {}).name || '-';
    const canAct = hasPermission('returns_manage');
    const statusLabel = { need: rtT('ret_status_need', 'Need action'), partial: rtT('ret_status_partial', 'Partial'), done: rtT('ret_status_done', 'Done') };
    const actLabel = { inventory: rtT('ret_act_inventory', 'Inventory'), bulk: rtT('ret_act_bulk', 'Bulk'), waste: rtT('ret_act_waste', 'Waste') };
    if (chips) chips.querySelectorAll('[data-f]').forEach(b => b.classList.toggle('active', b.dataset.f === returnsFilter));

    const rows = [];
    for (const r of rets) {
        const its = items.filter(i => i.return_id === r.id).sort((a, b) => a.line_no - b.line_no);
        if (!its.length) continue;
        const sts = its.map(i => rtItemStatus(i, actions));
        const retSt = sts.every(s => s === 'done') ? 'done' : sts.every(s => s === 'need') ? 'need' : 'partial';
        if (returnsFilter === 'open' && retSt === 'done') continue;
        if (returnsFilter === 'done' && retSt !== 'done') continue;
        const origin = r.customer_id ? ((customers.find(c => c.id === r.customer_id) || {}).name || '-') : (r.origin_text || '-');
        const noActions = its.every(i => !actions.some(a => a.return_item_id === i.id));
        its.forEach((it, idx) => {
            const st = sts[idx];
            const rem = rtRemaining(it, actions);
            const hist = actions.filter(a => a.return_item_id === it.id);
            rows.push(`<tr class="${idx === 0 ? 'ret-grp-first' : ''}">
                ${idx === 0 ? `<td rowspan="${its.length}"><code>${rtEsc(r.return_number)}</code><small class="ret-sub">${rtEsc(r.return_date)} · ${its.length} ${rtT('ret_items', 'item(s)')}</small><span class="ret-pill ret-pill-${retSt}">${statusLabel[retSt]}</span></td>
                <td rowspan="${its.length}">${rtEsc(origin)}${r.reason ? `<small class="ret-sub">${rtEsc(r.reason)}</small>` : ''}${r.notes ? `<small class="ret-sub">${rtEsc(r.notes)}</small>` : ''}</td>` : ''}
                <td><b>${rtEsc(rtCoffeeLabel(it))}</b><small class="ret-sub">${it.coffee_type} · code ${rtEsc(it.coffee_code)} · ${rtEsc(mName(it.machine_id))} · roast ${rtEsc(it.roast_date)} · ${rtEsc(rtViaLabel(it))}</small></td>
                <td>${rtEsc(rtQtyText(it.sealed_pcs, parseFloat(it.opened_kg), it.bag_size_g))}<small class="ret-sub">${rtItemKg(it).toFixed(2)} kg</small></td>
                <td>${rtEsc(rtQtyText(rem.sealed, rem.opened, it.bag_size_g))}</td>
                <td><span class="ret-pill ret-pill-${st}">${statusLabel[st]}</span></td>
                <td>${hist.length ? `<ul class="ret-hist">${hist.map(a => `<li><span class="ret-pill ret-pill-${a.action}">${actLabel[a.action] || a.action}</span> ${rtEsc(a.part === 'sealed' ? `${a.qty_pcs} × ${rtSize(it.bag_size_g)}` : `${(+a.kg).toFixed(2)} kg`)}${a.reason ? ' · ' + rtEsc(a.reason) : ''}${a.roast_date_used && a.roast_date_used !== it.roast_date ? ' · roast ' + rtEsc(a.roast_date_used) : ''}</li>`).join('')}</ul>` : '<span class="text-muted-color">—</span>'}</td>
                <td style="white-space:nowrap;">${canAct && st !== 'done' ? `<button type="button" class="btn btn-primary btn-sm" data-ret-act="${it.id}">${rtT('ret_btn_action', 'Action')}</button>` : ''}
                    ${canAct && idx === 0 ? `<button type="button" class="btn btn-secondary btn-sm" data-ret-edit="${r.id}">${rtT('ret_btn_edit', 'Edit')}</button>` : ''}
                    ${canAct && idx === 0 && noActions ? `<button type="button" class="btn btn-secondary btn-sm" data-ret-del="${r.id}">${rtT('btn_delete', 'Delete')}</button>` : ''}</td>
            </tr>`);
        });
    }
    tbody.innerHTML = rows.join('') || `<tr><td colspan="8" class="text-center-muted">${rtEsc(rtT('ret_empty', 'No returns here.'))}</td></tr>`;
    tbody.onclick = async (e) => {
        const a = e.target.closest('[data-ret-act]');
        if (a) return rtWithBusy(a, () => openReturnActionModal(parseInt(a.dataset.retAct)));
        const ed = e.target.closest('[data-ret-edit]');
        if (ed) return rtWithBusy(ed, () => openEditReturnModal(parseInt(ed.dataset.retEdit)));
        const d = e.target.closest('[data-ret-del]');
        if (d) return deleteReturn(parseInt(d.dataset.retDel));
    };
}

async function deleteReturn(returnId) {
    if (!hasPermission('returns_manage')) return;
    const acts = await rtQ(rtSb().from('stock_return_items').select('id, stock_return_actions(id)').eq('return_id', returnId)).catch(() => null);
    if (!acts || acts.some(i => (i.stock_return_actions || []).length)) {
        await showWarningModal(rtT('ret_delete_has_actions', 'This return already has actions, so it can no longer be deleted.'), false, null, null, 'warning');
        return;
    }
    if (!await showWarningModal(rtT('ret_delete_confirm', 'Delete this return? It has not moved any stock yet.'), true)) return;
    const { error } = await rtSb().from('stock_returns').delete().eq('id', returnId);
    if (error) { await showStockFailed(error.message); return; }
    loadReturnsSection();
}

// ============================================================================
// Lookups: sticker, roast log, production lot, inventory destination
// ============================================================================
// Reference lists (customers, codes, coffees, machines, sizes) change rarely,
// and every Supabase round trip costs 1–3 s here — so keep them a few minutes.
// Opening the Returns tab refreshes them in the background (rtLoadRefs(true)).
let rtRefsCache = null;
const RT_REFS_TTL_MS = 5 * 60 * 1000;
function rtLoadRefs(fresh) {
    if (!fresh && rtRefsCache && Date.now() - rtRefsCache.at < RT_REFS_TTL_MS) return rtRefsCache.promise;
    const promise = rtFetchRefs();
    rtRefsCache = { at: Date.now(), promise };
    promise.catch(() => { if (rtRefsCache && rtRefsCache.promise === promise) rtRefsCache = null; });
    return promise;
}

async function rtFetchRefs() {
    const [customers, codeDefinitions, greens, recipes, machines, sizes] = await Promise.all([
        rtQ(rtSb().from('customers').select('id, name').order('name')),
        rtQ(rtSb().from('code_definitions').select('*')),
        rtQ(rtSb().from('green_coffee').select('id, name, code')),
        rtQ(rtSb().from('blend_recipes').select('id, name, code')),
        rtQ(rtSb().from('machines').select('id, name, code')),
        rtQ(rtSb().from('packaging_sizes').select('*'))
    ]);
    return { customers, codeDefinitions, greens, recipes, machines, sizes: sizes.filter(s => s.is_visible !== false).sort((a, b) => a.gram - b.gram) };
}

// Strip code (or long lot code) → everything the item needs.
async function rtResolveSticker(raw, refs) {
    const v = String(raw || '').trim();
    if (!/^[A-Za-z0-9-]{3,40}$/.test(v)) return { error: rtT('ret_strip_invalid', 'That doesn\'t look like a strip code.') };
    // One round trip: the lot with its packed coffee, production lot and bulk card embedded.
    const lots = await rtQ(rtSb().from('packed_coffee_lots')
        .select('*, packed_coffee(*), production_lots(*, bulk_roasted_coffee(id, is_post_blend, custom_coffee_code, custom_coffee_type, coffee_name))')
        .or(`strip_code.eq.${v},lot_code.eq.${v}`).order('id', { ascending: false }).limit(5));
    const row = lots.find(l => l.strip_code === v) || lots[0];
    if (!row) return { error: rtT('ret_strip_not_found', 'No lot with that strip code. Check the number, or click the Coffee box to enter it by hand.') };
    const { packed_coffee: packed, production_lots: plRow, ...lot } = row;
    const { bulk_roasted_coffee: bulk = null, ...plRest } = plRow || {};
    const pl = plRow ? plRest : null;
    const strip = s => String(s || '').replace(/ \((Single|Blend)\)$/, '');
    let kind = null, singleId = null, blendId = null, name = null, code = null, type = null;
    if (pl && pl.single_coffee_id) { const g = refs.greens.find(x => x.id === pl.single_coffee_id); if (g) { kind = 'single'; singleId = g.id; name = g.name; code = g.code; type = 'Single'; } }
    else if (pl && pl.blend_recipe_id) { const r = refs.recipes.find(x => x.id === pl.blend_recipe_id); if (r) { kind = 'recipe'; blendId = r.id; name = r.name; code = r.code; type = 'Blend'; } }
    if (!kind && packed) {
        const n = strip(packed.custom_coffee_name);
        const g = refs.greens.find(x => x.name === n), r = refs.recipes.find(x => x.name === n);
        if (g) { kind = 'single'; singleId = g.id; name = g.name; code = g.code; type = 'Single'; }
        else if (r) { kind = 'recipe'; blendId = r.id; name = r.name; code = r.code; type = 'Blend'; }
        else {
            const c = packed.coffee_code || (bulk && bulk.custom_coffee_code);
            const t = packed.coffee_code_type || (bulk && bulk.custom_coffee_type);
            if (c && t) { kind = 'custom'; name = n; code = c; type = t; }
        }
    }
    if (!kind || !code) return { error: rtT('ret_strip_no_code', 'This lot\'s coffee has no registered sales code, so it can\'t be returned by sticker. Enter it by hand.') };
    return {
        lot, kind, singleId, blendId, name, code, type,
        machineId: (packed && packed.machine_id) || (pl && pl.machine_id) || null,
        roastDate: (pl && pl.production_date) || lot.packed_date,
        size: packed ? parseInt(packed.bag_size_g) : null
    };
}

// What was roasted under a code on one machine on one day: roast batches of
// the code's green coffees (Single) or recipes (Blend), plus custom blends
// made that day under the code. One result → that coffee; else Unknown.
async function rtRoastLog(code, type, machineId, date, refs) {
    const ids = (type === 'Single' ? refs.greens : refs.recipes).filter(x => x.code === code).map(x => x.id);
    const out = [];
    const [batches, customs] = await Promise.all([
        ids.length ? rtQ(rtSb().from('roast_batches').select('id, single_coffee_id, blend_recipe_id, coffee_type, qc_status').eq('machine_id', machineId).eq('roast_date', date)) : Promise.resolve([]),
        rtQ(rtSb().from('bulk_roasted_coffee').select('id, coffee_name').eq('is_post_blend', true).is('source_plan_id', null)
            .eq('custom_coffee_code', code).eq('custom_coffee_type', type).eq('machine_id', machineId).eq('production_date', date))
    ]);
    if (ids.length) {
        const count = new Map();
        batches.filter(b => b.qc_status !== 'Failed' && b.coffee_type === type && ids.includes(type === 'Single' ? b.single_coffee_id : b.blend_recipe_id))
            .forEach(b => { const id = type === 'Single' ? b.single_coffee_id : b.blend_recipe_id; count.set(id, (count.get(id) || 0) + 1); });
        count.forEach((n, id) => {
            const x = (type === 'Single' ? refs.greens : refs.recipes).find(y => y.id === id);
            out.push({ kind: type === 'Single' ? 'single' : 'recipe', id, name: x ? x.name : `#${id}`, batches: n });
        });
    }
    customs.forEach(c => out.push({ kind: 'custom', id: null, name: c.coffee_name, batches: 1 }));
    return out;
}

// Existing production lot for this coffee + machine + roast date (the
// "merge" target), or null. Unknown coffees never merge.
async function rtFindProductionLot(item, date) {
    if (item.coffee_kind === 'unknown') return null;
    let q = rtSb().from('production_lots').select('*').eq('machine_id', item.machine_id).eq('production_date', date);
    if (item.coffee_kind === 'single') q = q.eq('single_coffee_id', item.single_coffee_id);
    else if (item.coffee_kind === 'recipe') q = q.eq('blend_recipe_id', item.blend_recipe_id);
    else q = q.eq('coffee_name', item.coffee_name);
    const lots = await rtQ(q.order('id'));
    return lots[0] || null;
}

// A production lot for returned bags that have no lot to join (new lot):
// same lot-code rules as Print Barcode, and same-day roast batches linked
// (syncProductionLotBatches) so Tracking reaches the green bean.
async function rtCreateProductionLot(item, date, refs) {
    const pseudo = {
        id: null, is_return: true,
        coffee_type: item.coffee_kind === 'single' ? 'Single' : item.coffee_kind === 'recipe' ? 'Blend' : (item.coffee_kind === 'custom' ? 'PostBlendCustom' : item.coffee_type),
        single_coffee_id: item.single_coffee_id || null, blend_recipe_id: item.blend_recipe_id || null,
        machine_id: item.machine_id, coffee_name: rtStockName(item), production_date: date,
        custom_coffee_code: (item.coffee_kind === 'custom' || item.coffee_kind === 'unknown') ? item.coffee_code : null
    };
    const all = await rtQ(rtSb().from('production_lots').select('id, coffee_type, single_coffee_id, blend_recipe_id, machine_id, coffee_name'));
    const same = all.filter(l => l.machine_id === item.machine_id && (
        item.coffee_kind === 'single' ? l.single_coffee_id === item.single_coffee_id
            : item.coffee_kind === 'recipe' ? l.blend_recipe_id === item.blend_recipe_id
                : (l.coffee_name || '') === pseudo.coffee_name));
    let lotNumber = same.length + 1;
    for (let tries = 0; tries < 6; tries++, lotNumber++) {
        const row = {
            lot_code: buildLotCode(pseudo, refs.machines, refs.greens, refs.recipes, date, lotNumber),
            bulk_roasted_coffee_id: null,
            coffee_type: pseudo.coffee_type, single_coffee_id: pseudo.single_coffee_id, blend_recipe_id: pseudo.blend_recipe_id,
            machine_id: item.machine_id, coffee_name: pseudo.coffee_name, production_date: date, latest_roast_batch_id: null
        };
        const { data, error } = await rtSb().from('production_lots').insert(row).select().single();
        if (!error) {
            if (item.coffee_kind === 'single' || item.coffee_kind === 'recipe') {
                const batches = await rtQ(rtSb().from('roast_batches').select('*').eq('machine_id', item.machine_id).eq('roast_date', date));
                await syncProductionLotBatches(data, pseudo, batches);
            }
            return data;
        }
        if (error.code !== '23505') throw error;
    }
    throw new Error('Could not create a unique lot code');
}

// Where sealed bags of an item go into inventory (no writes).
//   scanned  back into the sticker's lot (same roast date)
//   merge    the existing packed lot of the same coffee + size + machine + roast date
//   new      a new packed lot (needs labels)
async function rtInventoryTarget(item, date) {
    if (item.source_packed_lot_id && date === item.roast_date) {
        const lot = (await rtQ(rtSb().from('packed_coffee_lots').select('*').eq('id', item.source_packed_lot_id)))[0];
        if (lot) return { kind: 'scanned', lot };
    }
    const pl = await rtFindProductionLot(item, date);
    if (pl) {
        const lots = await rtQ(rtSb().from('packed_coffee_lots').select('*, packed_coffee!inner(id, bag_size_g, machine_id)').eq('production_lot_id', pl.id));
        const lot = lots.find(l => parseInt(l.packed_coffee.bag_size_g) === parseInt(item.bag_size_g) && l.packed_coffee.machine_id === item.machine_id);
        if (lot) return { kind: 'merge', lot, productionLot: pl };
        return { kind: 'new', productionLot: pl };
    }
    return { kind: 'new', productionLot: null };
}

// ============================================================================
// Stock operations (each returns an undo list; callers roll back on failure)
// ============================================================================
async function rtActionRow(row, undo) {
    const { data, error } = await rtSb().from('stock_return_actions').insert(Object.assign({ performed_by: rtUser() }, row)).select().single();
    if (error) throw error;
    undo.push(async () => { await rtSb().from('stock_return_actions').delete().eq('id', data.id); });
    return data;
}

async function rtSendInventory(item, ret, pcs, date, labelMode, refs, undo) {
    const reason = `Return ${ret.return_number}`;
    const t = await rtInventoryTarget(item, date);
    let lot;
    if (t.lot) {
        const { data, error } = await rtSb().rpc('refund_packed_lot', { p_lot_id: t.lot.id, p_pcs: pcs, p_operation: 'return', p_ref_table: 'stock_return_items', p_ref_id: item.id, p_reason: reason, p_user: rtUser() });
        if (error || data === null) throw (error || new Error('lot not found'));
        undo.push(async () => { await rtSb().rpc('consume_packed_lot', { p_lot_id: t.lot.id, p_pcs: pcs, p_operation: 'undo', p_ref_table: 'stock_return_items', p_ref_id: item.id, p_reason: reason + ' — rolled back', p_user: rtUser() }); });
        lot = t.lot;
    } else {
        let pl = t.productionLot;
        if (!pl) {
            pl = await rtCreateProductionLot(item, date, refs);
            undo.push(async () => { await rtSb().from('production_lots').delete().eq('id', pl.id); });
        }
        const packedRow = await getOrCreatePackedCoffeeRow(rtStockName(item), parseInt(item.bag_size_g), item.machine_id, rtCodeInfo(item));
        if (!packedRow) throw new Error('packed product row could not be created');
        lot = await getOrCreatePackedCoffeeLot(packedRow.id, pcs, pl.id, 'return', 'stock_return_items', item.id);
        if (!lot) throw new Error('packed lot could not be created');
        undo.push(async () => { await rtSb().rpc('consume_packed_lot', { p_lot_id: lot.id, p_pcs: pcs, p_operation: 'undo', p_ref_table: 'stock_return_items', p_ref_id: item.id, p_reason: reason + ' — rolled back', p_user: rtUser() }); });
    }
    await rtActionRow({ return_item_id: item.id, part: 'sealed', action: 'inventory', qty_pcs: pcs, kg: pcs * parseInt(item.bag_size_g) / 1000, target_packed_lot_id: lot.id, roast_date_used: date, label_mode: labelMode }, undo);
    const fresh = (await rtQ(rtSb().from('packed_coffee_lots').select('*').eq('id', lot.id)))[0] || lot;
    const labels = (labelMode === 'new' || t.kind !== 'scanned') ? pcs : 0;
    return { lot: fresh, kind: t.kind, labels };
}

// parts: [{ item, part: 'sealed'|'opened', qty, kg }] — all the same coffee + machine.
async function rtSendBulk(ret, parts, date, refs, undo) {
    const head = parts[0].item;
    const kg = +parts.reduce((s, p) => s + p.kg, 0).toFixed(3);
    const codeInfo = rtCodeInfo(head);
    const row = {
        coffee_name: rtStockName(head),
        coffee_type: head.coffee_kind === 'single' ? 'Single' : head.coffee_kind === 'recipe' ? 'Blend' : head.coffee_type,
        single_coffee_id: head.single_coffee_id || null, blend_recipe_id: head.blend_recipe_id || null,
        machine_id: head.machine_id, production_date: date, bulk_available: kg, is_return: true,
        custom_coffee_code: codeInfo ? codeInfo.coffee_code : null, custom_coffee_type: codeInfo ? codeInfo.coffee_code_type : null,
        mv_operation: 'return', mv_ref_table: 'stock_returns', mv_ref_id: ret.id, mv_reason: `Return ${ret.return_number}`, mv_user: rtUser()
    };
    const { data: bulk, error } = await rtSb().from('bulk_roasted_coffee').insert(row).select().single();
    if (error) throw error;
    undo.push(async () => {
        await rtSb().rpc('consume_bulk_lot', { p_bulk_id: bulk.id, p_kg: kg, p_operation: 'undo', p_reason: `Return ${ret.return_number} — rolled back`, p_user: rtUser() });
        await rtSb().from('bulk_roasted_coffee').delete().eq('id', bulk.id);
    });
    for (const p of parts) {
        await rtActionRow({ return_item_id: p.item.id, part: p.part, action: 'bulk', qty_pcs: p.part === 'sealed' ? p.qty : 0, kg: p.kg, target_bulk_id: bulk.id, roast_date_used: date }, undo);
    }
    return bulk;
}

async function rtSendWaste(ret, origin, item, part, qty, kg, reason, undo) {
    const { data: w, error } = await rtSb().from('waste_inventory').insert({
        source_type: 'Return', source_name: `${ret.return_number} · ${rtCoffeeLabel(item)} · ${origin}`,
        waste_kg: kg, reason, recorded_by: rtUser(), discard_date: rtToday(), return_item_id: item.id
    }).select().single();
    if (error) throw error;
    undo.push(async () => { await rtSb().from('waste_inventory').delete().eq('id', w.id); });
    await rtActionRow({ return_item_id: item.id, part, action: 'waste', qty_pcs: part === 'sealed' ? qty : 0, kg, target_waste_id: w.id, reason }, undo);
    return w;
}

async function rtRollback(undo) {
    const left = [];
    for (const fn of undo.reverse()) {
        try { await fn(); } catch (e) { left.push(e.message || String(e)); }
    }
    return left;
}

// ============================================================================
// Record Return — 2 pages (Stock Release pattern) + Send to + re-confirm
// ============================================================================
async function openRecordReturnModal() {
    if (!hasPermission('returns_manage')) return;
    let refs;
    try { refs = await rtLoadRefs(); } catch (e) { await showStockFailed(e.message || String(e)); return; }
    const codeOpts = salesCodeOptions(refs.codeDefinitions, refs.greens, refs.recipes);
    const today = rtToday();
    const html = `
        <div id="rr-page-1" class="sr-grid">
            <div>
                <div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.6fr); gap:10px;">
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label">${rtT('ret_lbl_date', 'Return Date')} <span class="ret-req">*</span></label>
                        <input type="date" id="rr-date" class="form-control" value="${today}" max="${today}">
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label">${rtT('ret_lbl_origin', 'Origin')} <span class="ret-req">*</span></label>
                        <div style="display:flex; gap:6px;">
                            <div class="ret-seg" id="rr-origin-seg"><button type="button" class="active" data-o="cust">${rtT('ret_origin_customer', 'Customer')}</button><button type="button" data-o="other">${rtT('ret_origin_other', 'Other')}</button></div>
                            <input type="text" id="rr-cust" class="form-control" list="rr-cust-list" autocomplete="off" placeholder="${rtEsc(rtT('ret_ph_customer', 'Customer name'))}">
                            <input type="text" id="rr-other" class="form-control hidden" placeholder="${rtEsc(rtT('ret_ph_other', 'e.g. Pulled from shelf'))}">
                        </div>
                        <datalist id="rr-cust-list">${refs.customers.map(c => `<option value="${rtEsc(c.name)}"></option>`).join('')}</datalist>
                        <div class="ret-hint" id="rr-origin-hint"></div>
                    </div>
                </div>

                <div class="ret-item-head"><span>${rtT('ret_add_item', 'Add an item')}</span><span class="ret-hint" id="rr-edit-note"></span></div>

                <div class="ret-scanbox ret-mode" id="rr-scan-box">
                    <label class="form-label" style="display:flex; gap:6px; align-items:center; margin-bottom:6px;"><i class="icon-scan-line"></i>${rtT('ret_lbl_strip', 'Strip code — scan or type, then Enter')}</label>
                    <input type="text" id="rr-strip" class="form-control" autocomplete="off" placeholder="20037" style="font-family:monospace; font-size:1.05rem; letter-spacing:1px;">
                    <div class="ret-hint" id="rr-strip-hint">${rtT('ret_strip_hint', 'Everything below fills in from the sticker.')}</div>
                </div>

                <div class="ret-coffee ret-mode ret-off" id="rr-coffee">
                    <div class="ret-coffee-head"><span>${rtT('ret_lbl_coffee', 'Coffee')}</span><span class="ret-hint" id="rr-coffee-hint">${rtT('ret_coffee_hint', 'No sticker? Click any field here to enter it by hand.')}</span></div>
                    <div style="display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:8px;">
                        <div class="form-group" style="margin-bottom:0;"><label class="form-label">${rtT('ret_lbl_code', 'Coffee Code')}</label>
                            <input type="text" id="rr-code" class="form-control" list="rr-code-list" autocomplete="off" placeholder="${rtEsc(rtT('ret_ph_code', 'Code'))}">
                            <datalist id="rr-code-list">${codeOpts.map(o => `<option value="${rtEsc(salesCodeLabel(o))}"></option>`).join('')}</datalist></div>
                        <div class="form-group" style="margin-bottom:0;"><label class="form-label">${rtT('ret_lbl_machine', 'Machine')}</label>
                            <select id="rr-machine" class="form-control"><option value="">${rtT('ret_select', 'Select…')}</option>${refs.machines.map(m => `<option value="${m.id}">${rtEsc(m.name)}</option>`).join('')}</select></div>
                        <div class="form-group" style="margin-bottom:0;"><label class="form-label">${rtT('ret_lbl_roast', 'Roast Date')}</label>
                            <input type="date" id="rr-roast" class="form-control" max="${today}"></div>
                        <div class="form-group" style="margin-bottom:0;"><label class="form-label">${rtT('ret_lbl_package', 'Package')}</label>
                            <select id="rr-size" class="form-control"><option value="">${rtT('ret_select', 'Select…')}</option>${refs.sizes.map(s => `<option value="${s.gram}">${rtEsc(s.label || rtSize(s.gram))}</option>`).join('')}</select></div>
                    </div>
                    <div id="rr-resolved" class="ret-resolved"></div>
                </div>

                <div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto; gap:10px; align-items:end;">
                    <div class="form-group" style="margin-bottom:0;"><label class="form-label">${rtT('ret_lbl_sealed', 'Sealed packs')}</label><input type="number" id="rr-packs" class="form-control" min="0" step="1" placeholder="0"></div>
                    <div class="form-group" style="margin-bottom:0;"><label class="form-label">${rtT('ret_lbl_opened', 'Opened coffee (kg)')}</label><input type="number" id="rr-opened" class="form-control" min="0" step="0.01" placeholder="0.00"></div>
                    <button type="button" id="rr-add" class="btn btn-secondary" disabled>+ ${rtT('ret_btn_add', 'Add to list')}</button>
                </div>
                <div class="ret-why" id="rr-item-why"></div>
            </div>

            <div class="sr-panel">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                    <span style="font-size:0.85rem; font-weight:700;">${rtT('ret_items_returned', 'Items returned')}</span>
                    <span id="rr-count" class="ret-count">0</span>
                </div>
                <div id="rr-cart" class="sr-cart-scroll"></div>
                <div class="form-group" style="margin:12px 0 0;"><label class="form-label">${rtT('ret_lbl_reason', 'Reason')}</label>
                    <select id="rr-reason" class="form-control"><option value="">—</option><option>Customer return</option><option>Damaged packaging</option><option>Near expiry</option><option>Other</option></select></div>
                <div class="form-group" style="margin:10px 0 0;"><label class="form-label">${rtT('ret_lbl_notes', 'Notes')}</label><input type="text" id="rr-notes" class="form-control" placeholder="${rtEsc(rtT('ret_ph_optional', 'optional'))}"></div>
                <div style="display:flex; align-items:baseline; justify-content:space-between; border-top:1px solid var(--border); padding-top:10px; margin-top:12px;">
                    <span style="font-size:0.8rem; color:var(--text-secondary);">${rtT('ret_total', 'Total returned')}</span>
                    <span id="rr-total" style="font-size:1.5rem; font-weight:700; color:var(--primary);">0.00 kg</span>
                </div>
                <div class="ret-why" id="rr-why"></div>
                <div style="display:flex; gap:8px; margin-top:10px;">
                    <button type="button" class="btn btn-secondary" style="flex:1;" onclick="document.getElementById('btn-close-modal').click()">${rtT('btn_cancel', 'Cancel')}</button>
                    <button type="button" id="rr-proceed" class="btn btn-primary" style="flex:1.5;" disabled>${rtT('ret_btn_proceed', 'Proceed')}</button>
                </div>
            </div>
        </div>
        <div id="rr-page-2" class="hidden"></div>`;
    openModal(rtT('ret_title_record', 'Record Return'), html, '1100px');

    const $ = id => document.getElementById(id);
    let origin = 'cust', mode = 'scan', sticker = null, resolved = null, cart = [], editIdx = null, logSeq = 0;
    const codeState = () => resolveSalesCodeInput($('rr-code').value, codeOpts, refs.codeDefinitions);

    function setMode(m) {
        mode = m;
        $('rr-scan-box').classList.toggle('ret-off', m !== 'scan');
        $('rr-coffee').classList.toggle('ret-off', m !== 'manual' && !sticker);
        $('rr-coffee').classList.toggle('ret-filled', !!sticker);
        ['rr-code', 'rr-roast'].forEach(i => $(i).readOnly = !!sticker);
        ['rr-machine', 'rr-size'].forEach(i => $(i).disabled = !!sticker);
        $('rr-coffee-hint').textContent = sticker ? rtT('ret_coffee_from_sticker', 'Filled from the sticker.')
            : m === 'manual' ? rtT('ret_coffee_manual', 'Entering by hand — click the strip code box to scan instead.')
                : rtT('ret_coffee_hint', 'No sticker? Click any field here to enter it by hand.');
    }
    function clearItem(keepQty) {
        sticker = null; resolved = null;
        ['rr-strip', 'rr-code', 'rr-roast'].forEach(i => $(i).value = '');
        $('rr-machine').value = ''; $('rr-size').value = '';
        if (!keepQty) { $('rr-packs').value = ''; $('rr-opened').value = ''; }
        $('rr-strip-hint').className = 'ret-hint';
        $('rr-strip-hint').textContent = rtT('ret_strip_hint', 'Everything below fills in from the sticker.');
        renderResolved();
    }
    function renderResolved() {
        const box = $('rr-resolved');
        if (sticker) {
            box.innerHTML = `<div class="ret-found">✓ ${rtEsc(sticker.name)}${sticker.kind === 'custom' ? ` (${rtT('ret_custom_blend', 'custom blend')})` : ''} · ${sticker.type} · lot <code>${rtEsc(sticker.lot.lot_code)}</code> <button type="button" class="ret-link" id="rr-clear">${rtT('ret_clear', 'Clear')}</button></div>`;
            $('rr-clear').onclick = () => { clearItem(false); setMode('scan'); $('rr-strip').focus(); validateItem(); };
            return;
        }
        const st = codeState();
        if (st.state === 'missing' || st.state === 'no_members') { box.innerHTML = `<div class="ret-hint ret-err">${rtEsc(rtT('ret_code_bad', 'Code {code} can\'t be used — it must be registered in Code Definitions with a coffee under it.').replace('{code}', st.code))}</div>`; return; }
        if (st.state === 'ambiguous') { box.innerHTML = `<div class="ret-hint ret-err">${rtEsc(rtT('ret_code_ambiguous', 'Code {code} is both Single and Blend — pick it from the list.').replace('{code}', st.code))}</div>`; return; }
        if (!resolved) { box.innerHTML = `<div class="ret-hint">${rtT('ret_resolve_hint', 'Coffee: fills in once code, machine and roast date are set.')}</div>`; return; }
        if (resolved.loading) { box.innerHTML = `<div class="ret-hint">${rtT('ret_resolving', 'Looking it up in the roast log…')}</div>`; return; }
        const kindWord = st.type === 'Blend' ? rtT('ret_word_recipe', 'Recipe') : rtT('ret_word_origin', 'Origin');
        if (resolved.hit) {
            box.innerHTML = `<div class="ret-found">✓ ${kindWord}: <b>${rtEsc(resolved.hit.name)}</b>${resolved.hit.kind === 'custom' ? ` (${rtT('ret_custom_blend', 'custom blend')})` : ''} — ${rtEsc(rtT('ret_found_log', 'found in the roast log ({n} batches that day)').replace('{n}', resolved.hit.batches))}</div>`;
        } else if (resolved.list.length) {
            box.innerHTML = `<div class="ret-unknown"><b>${kindWord}: Unknown</b> — ${rtEsc(rtT('ret_unknown_many', 'roasted under this code that day: {list}. Saved as Unknown; Tracking lists them.').replace('{list}', resolved.list.map(c => c.name).join(', ')))}</div>`;
        } else {
            box.innerHTML = `<div class="ret-unknown"><b>${kindWord}: Unknown</b> — ${rtEsc(rtT('ret_unknown_none', 'nothing roasted under this code on this machine that day. Check the date, or save as Unknown.'))}</div>`;
        }
    }
    async function resolveFromLog() {
        if (sticker) return;
        const st = codeState(), machineId = parseInt($('rr-machine').value), date = $('rr-roast').value;
        if (st.state !== 'ok' || !machineId || !date) { resolved = null; renderResolved(); validateItem(); return; }
        const seq = ++logSeq;
        resolved = { loading: true }; renderResolved(); validateItem();
        try {
            const list = await rtRoastLog(st.code, st.type, machineId, date, refs);
            if (seq !== logSeq) return;
            resolved = { list, hit: list.length === 1 ? list[0] : null };
        } catch (e) {
            if (seq !== logSeq) return;
            resolved = { list: [], hit: null };
            console.warn('roast log lookup failed', e);
        }
        renderResolved(); validateItem();
    }
    async function scan() {
        const v = $('rr-strip').value.trim(); if (!v) return;
        $('rr-strip-hint').className = 'ret-hint'; $('rr-strip-hint').textContent = rtT('ret_strip_looking', 'Looking up…');
        let res;
        try { res = await rtResolveSticker(v, refs); } catch (e) { res = { error: e.message || String(e) }; }
        if (res.error) { sticker = null; $('rr-strip-hint').className = 'ret-hint ret-err'; $('rr-strip-hint').textContent = res.error; renderResolved(); validateItem(); return; }
        sticker = res;
        const opt = codeOpts.find(o => o.code === res.code && o.type === res.type);
        $('rr-code').value = opt ? salesCodeLabel(opt) : `${res.code} (${res.type})`;
        $('rr-machine').value = res.machineId || ''; $('rr-roast').value = res.roastDate || ''; $('rr-size').value = res.size || '';
        $('rr-strip-hint').className = 'ret-hint ret-ok'; $('rr-strip-hint').textContent = rtT('ret_strip_found', 'Lot found — enter the quantity, then Add to list.');
        setMode('scan'); renderResolved(); validateItem();
        $('rr-packs').focus();
    }
    const toManual = () => { if (mode !== 'manual' && !sticker) { $('rr-strip').value = ''; setMode('manual'); validateItem(); } };
    $('rr-coffee').addEventListener('focusin', toManual);
    $('rr-coffee').addEventListener('mousedown', toManual);
    $('rr-scan-box').addEventListener('focusin', () => { if (mode !== 'scan') { clearItem(true); setMode('scan'); validateItem(); } });
    $('rr-strip').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); scan(); } });
    $('rr-strip').addEventListener('change', scan);
    ['rr-code', 'rr-machine', 'rr-roast'].forEach(i => { $(i).addEventListener('change', resolveFromLog); $(i).addEventListener('input', () => { if (i !== 'rr-code' || codeState().state === 'ok') resolveFromLog(); else { resolved = null; renderResolved(); validateItem(); } }); });
    ['rr-size', 'rr-packs', 'rr-opened'].forEach(i => { $(i).addEventListener('input', validateItem); $(i).addEventListener('change', validateItem); });
    ['rr-packs', 'rr-opened'].forEach(i => $(i).addEventListener('keydown', e => { if (e.key === 'Enter' && !$('rr-add').disabled) { e.preventDefault(); $('rr-add').click(); } }));
    $('rr-origin-seg').addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        origin = b.dataset.o;
        $('rr-origin-seg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        $('rr-cust').classList.toggle('hidden', origin !== 'cust'); $('rr-other').classList.toggle('hidden', origin !== 'other');
        validateHeader();
    });
    ['rr-date', 'rr-cust', 'rr-other'].forEach(i => { $(i).addEventListener('input', validateHeader); $(i).addEventListener('change', () => { validateHeader(); validateItem(); }); });

    function draftItem() {
        const st = codeState();
        const base = {
            coffee_code: st.code, coffee_type: st.type, machine_id: parseInt($('rr-machine').value), roast_date: $('rr-roast').value,
            bag_size_g: parseInt($('rr-size').value), sealed_pcs: parseInt($('rr-packs').value) || 0, opened_kg: +(parseFloat($('rr-opened').value) || 0).toFixed(3),
            single_coffee_id: null, blend_recipe_id: null, source_packed_lot_id: null, candidates: null, _strip: null
        };
        if (sticker) return Object.assign(base, { coffee_kind: sticker.kind, coffee_name: sticker.name, single_coffee_id: sticker.singleId, blend_recipe_id: sticker.blendId, resolved_via: 'sticker', source_packed_lot_id: sticker.lot.id, _strip: sticker.lot.strip_code || sticker.lot.lot_code, _lotCode: sticker.lot.lot_code });
        if (resolved && resolved.hit) {
            const h = resolved.hit;
            return Object.assign(base, { coffee_kind: h.kind, coffee_name: h.name, single_coffee_id: h.kind === 'single' ? h.id : null, blend_recipe_id: h.kind === 'recipe' ? h.id : null, resolved_via: 'roast_log' });
        }
        const def = refs.codeDefinitions.find(d => d.code === st.code);
        return Object.assign(base, { coffee_kind: 'unknown', coffee_name: def ? def.name : `Code ${st.code}`, resolved_via: 'unknown', candidates: (resolved && resolved.list || []).map(c => ({ name: c.name, batches: c.batches })) });
    }
    function validateItem() {
        const packs = parseFloat($('rr-packs').value) || 0, opened = parseFloat($('rr-opened').value) || 0;
        const st = codeState(), roast = $('rr-roast').value;
        let why = '';
        if (!sticker && mode !== 'manual') why = rtT('ret_why_scan', 'Scan a strip code, or click the Coffee box to enter one by hand.');
        else if (st.state !== 'ok') why = rtT('ret_why_code', 'Enter a registered coffee code.');
        else if (!$('rr-machine').value) why = rtT('ret_why_machine', 'Pick the machine.');
        else if (!roast || roast > $('rr-date').value) why = rtT('ret_why_roast', 'Check the roast date (on or before the return date).');
        else if (!$('rr-size').value) why = rtT('ret_why_size', 'Pick the package.');
        else if (resolved && resolved.loading) why = rtT('ret_resolving', 'Looking it up in the roast log…');
        else if (!(packs > 0 || opened > 0)) why = rtT('ret_why_qty', 'Enter sealed packs and/or opened coffee.');
        else if (!Number.isInteger(packs) || packs < 0 || opened < 0) why = rtT('ret_why_qty_bad', 'Check the quantities.');
        $('rr-item-why').textContent = why;
        $('rr-add').disabled = !!why;
        $('rr-add').textContent = editIdx !== null ? `✓ ${rtT('ret_btn_update', 'Update item')}` : `+ ${rtT('ret_btn_add', 'Add to list')}`;
    }
    const sameItem = (a, b) => a.coffee_kind === b.coffee_kind && a.coffee_code === b.coffee_code && a.coffee_type === b.coffee_type && a.coffee_name === b.coffee_name
        && a.bag_size_g === b.bag_size_g && a.machine_id === b.machine_id && a.roast_date === b.roast_date && (a.source_packed_lot_id || 0) === (b.source_packed_lot_id || 0);
    $('rr-add').addEventListener('click', () => {
        const d = draftItem();
        if (editIdx !== null) { cart[editIdx] = d; editIdx = null; $('rr-edit-note').textContent = ''; }
        else {
            const same = cart.find(x => sameItem(x, d));
            if (same) { same.sealed_pcs += d.sealed_pcs; same.opened_kg = +(same.opened_kg + d.opened_kg).toFixed(3); } else cart.push(d);
        }
        clearItem(false); setMode('scan'); renderCart(); validateItem(); validateHeader();
        $('rr-strip').focus();
    });
    const mName = id => (refs.machines.find(m => m.id === id) || {}).name || '-';
    function renderCart() {
        $('rr-count').textContent = cart.length;
        $('rr-cart').innerHTML = cart.length ? cart.map((l, i) => `<div class="ret-line${editIdx === i ? ' ret-editing' : ''}" data-i="${i}" tabindex="0">
                <div><b>${rtEsc(rtCoffeeLabel(l))}</b><small class="ret-sub">${rtSize(l.bag_size_g)} · ${rtEsc(mName(l.machine_id))} · roast ${rtEsc(l.roast_date)} · ${rtEsc(rtViaLabel(l))}</small></div>
                <div style="text-align:right; white-space:nowrap;">${rtEsc(rtQtyText(l.sealed_pcs, l.opened_kg, l.bag_size_g))}<small class="ret-sub">${rtItemKg(l).toFixed(2)} kg</small></div>
                <button type="button" class="ret-x" data-del="${i}" aria-label="${rtEsc(rtT('ret_remove', 'Remove'))}">×</button>
            </div>`).join('') : `<div class="text-center-muted" style="padding:16px 4px; font-size:0.8rem;">${rtT('ret_cart_empty', 'No items yet — scan a strip code or enter one by hand.')}</div>`;
        $('rr-total').textContent = cart.reduce((s, l) => s + rtItemKg(l), 0).toFixed(2) + ' kg';
    }
    $('rr-cart').addEventListener('click', e => {
        const del = e.target.closest('[data-del]');
        if (del) { cart.splice(parseInt(del.dataset.del), 1); editIdx = null; $('rr-edit-note').textContent = ''; renderCart(); validateItem(); validateHeader(); return; }
        const line = e.target.closest('.ret-line'); if (!line) return;
        const l = cart[parseInt(line.dataset.i)]; editIdx = parseInt(line.dataset.i);
        clearItem(false);
        const opt = codeOpts.find(o => o.code === l.coffee_code && o.type === l.coffee_type);
        $('rr-code').value = opt ? salesCodeLabel(opt) : l.coffee_code;
        $('rr-machine').value = l.machine_id; $('rr-roast').value = l.roast_date; $('rr-size').value = l.bag_size_g;
        if (l.resolved_via === 'sticker') {
            sticker = { kind: l.coffee_kind, name: l.coffee_name, singleId: l.single_coffee_id, blendId: l.blend_recipe_id, type: l.coffee_type, code: l.coffee_code, lot: { id: l.source_packed_lot_id, lot_code: l._lotCode, strip_code: l._strip }, machineId: l.machine_id, roastDate: l.roast_date, size: l.bag_size_g };
            $('rr-strip').value = l._strip || '';
            setMode('scan'); renderResolved();
        } else { setMode('manual'); resolveFromLog(); }
        $('rr-packs').value = l.sealed_pcs || ''; $('rr-opened').value = l.opened_kg || '';
        $('rr-edit-note').textContent = rtT('ret_editing', 'Editing item {n}').replace('{n}', editIdx + 1);
        renderCart(); validateItem(); validateHeader();
    });
    function originValue() {
        if (origin === 'cust') { const c = refs.customers.find(x => x.name === $('rr-cust').value.trim()); return c ? { customer_id: c.id, label: c.name } : null; }
        const t = $('rr-other').value.trim(); return t ? { origin_text: t, label: t } : null;
    }
    function validateHeader() {
        const date = $('rr-date').value, o = originValue();
        $('rr-origin-hint').className = 'ret-hint' + (origin === 'cust' && $('rr-cust').value && !o ? ' ret-err' : '');
        $('rr-origin-hint').textContent = origin === 'cust'
            ? ($('rr-cust').value && !o ? rtT('ret_origin_pick', 'Pick a customer from the list.') : rtT('ret_origin_crm', 'Counts in that customer\'s CRM.'))
            : rtT('ret_origin_free', 'Free text — not linked to a customer, so not in CRM.');
        let why = '';
        if (!date || date > rtToday()) why = rtT('ret_why_date', 'Check the return date.');
        else if (!o) why = rtT('ret_why_origin', 'Fill in the origin.');
        else if (!cart.length) why = rtT('ret_why_items', 'Add at least one item.');
        else if (editIdx !== null) why = rtT('ret_why_editing', 'Finish editing the item first.');
        else if (cart.some(l => l.roast_date > date)) why = rtT('ret_why_roast_after', 'An item\'s roast date is after the return date.');
        $('rr-why').textContent = why;
        $('rr-proceed').disabled = !!why;
    }
    renderCart(); setMode('scan'); clearItem(false); validateItem(); validateHeader();
    setTimeout(() => $('rr-strip').focus(), 50);

    // ---------------- page 2: confirm + Send to ----------------
    let sendTo = null, labelMode = 'old', bulkDates = {}, newDates = {}, invPreview = [], previewSeq = 0;
    const groupKeyOf = l => `${l.coffee_kind}|${l.single_coffee_id || ''}|${l.blend_recipe_id || ''}|${l.coffee_name}|${l.coffee_code}|${l.coffee_type}|${l.machine_id}`;
    function bulkGroups() {
        const g = new Map();
        cart.forEach((l, i) => {
            const k = groupKeyOf(l);
            if (!g.has(k)) g.set(k, { key: k, head: l, idx: [], kg: 0, oldest: l.roast_date });
            const x = g.get(k); x.idx.push(i); x.kg += rtItemKg(l); if (l.roast_date < x.oldest) x.oldest = l.roast_date;
        });
        return [...g.values()];
    }
    const machineCode = id => { const m = refs.machines.find(x => x.id === id); return m ? (m.code || m.name) : 'M'; };
    const ddmmyy = iso => { const [y, m, d] = iso.split('-'); return d + m + y.slice(2); };
    async function computeInvPreview() {
        const seq = ++previewSeq;
        const out = [];
        for (let i = 0; i < cart.length; i++) {
            const l = cart[i];
            if (!(l.sealed_pcs > 0)) continue;
            const date = labelMode === 'new' ? (newDates[i] || l.roast_date) : l.roast_date;
            let t;
            try { t = await rtInventoryTarget(l, date); } catch (e) { t = { kind: 'new' }; }
            out.push({ i, l, date, t, labels: (labelMode === 'new' || t.kind !== 'scanned') ? l.sealed_pcs : 0 });
        }
        if (seq === previewSeq) { invPreview = out; renderSend(); }
    }
    function goPage2() {
        const o = originValue();
        $('rr-page-1').classList.add('hidden');
        const p2 = $('rr-page-2'); p2.classList.remove('hidden');
        p2.innerHTML = `
            <div class="ret-note"><b>${rtT('ret_confirm_title', 'Confirm the return')}</b><span>${rtT('ret_confirm_hint', 'Check the items, then choose where they go.')}</span></div>
            <div class="ret-meta">
                <div><span>${rtT('ret_lbl_date', 'Return Date')}</span><b>${rtEsc($('rr-date').value)}</b></div>
                <div><span>${rtT('ret_lbl_origin', 'Origin')}</span><b>${rtEsc(o.label)}</b></div>
                <div><span>${rtT('ret_lbl_reason', 'Reason')}</span><b>${rtEsc($('rr-reason').value || '—')}</b></div>
                <div><span>${rtT('ret_lbl_notes', 'Notes')}</span><b>${rtEsc($('rr-notes').value || '—')}</b></div>
            </div>
            <div class="table-container"><table class="ret-table"><thead><tr><th>#</th><th>${rtT('ret_col_coffee', 'Coffee')}</th><th>${rtT('ret_col_source', 'Source')}</th><th>${rtT('ret_col_machine_roast', 'Machine · Roast')}</th><th>${rtT('ret_col_returned', 'Returned')}</th><th style="text-align:right;">kg</th></tr></thead><tbody>
                ${cart.map((l, i) => `<tr><td>${i + 1}</td><td><b>${rtEsc(rtCoffeeLabel(l))}</b><small class="ret-sub">${l.coffee_type} · code ${rtEsc(l.coffee_code)}</small></td><td>${rtEsc(rtViaLabel(l))}${l._lotCode ? `<small class="ret-sub"><code>${rtEsc(l._lotCode)}</code></small>` : ''}</td><td>${rtEsc(mName(l.machine_id))}<small class="ret-sub">roast ${rtEsc(l.roast_date)}</small></td><td>${rtEsc(rtQtyText(l.sealed_pcs, l.opened_kg, l.bag_size_g))}</td><td style="text-align:right; font-family:monospace;">${rtItemKg(l).toFixed(2)}</td></tr>`).join('')}
            </tbody></table></div>
            <div class="ret-total-row"><span>${rtT('ret_total', 'Total returned')}</span><b>${cart.reduce((s, l) => s + rtItemKg(l), 0).toFixed(2)} kg</b></div>
            <div class="ret-sendto">
                <div class="ret-sendto-head">${rtT('ret_send_to', 'Send to')}</div>
                <div class="ret-opts" id="rr-opts">
                    <button type="button" class="ret-opt" data-s="bulk"><b>${rtT('ret_send_bulk', 'Send all to bulk')}</b><span>${rtT('ret_send_bulk_hint', 'One bulk card per coffee and machine — never blended')}</span></button>
                    <button type="button" class="ret-opt" data-s="inv"><b>${rtT('ret_send_inv', 'Send to inventory')}</b><span>${rtT('ret_send_inv_hint', 'Sealed bags back on the shelf')}</span></button>
                    <button type="button" class="ret-opt" data-s="later"><b>${rtT('ret_send_later', 'Save, send later')}</b><span>${rtT('ret_send_later_hint', 'Keep as floating stock — decide per item with Action')}</span></button>
                </div>
                <div id="rr-send-detail"></div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; border-top:1px solid var(--border); padding-top:12px; margin-top:12px; flex-wrap:wrap;">
                <button type="button" id="rr-back" class="btn btn-secondary">← ${rtT('ret_btn_back', 'Back')}</button>
                <span class="ret-why" id="rr-send-why" style="flex:1; text-align:right;"></span>
                <button type="button" id="rr-confirm" class="btn btn-primary" disabled>${rtT('ret_btn_choose', 'Choose where to send')}</button>
            </div>`;
        sendTo = null; labelMode = 'old'; bulkDates = {}; newDates = {}; invPreview = [];
        $('rr-back').onclick = () => { p2.classList.add('hidden'); $('rr-page-1').classList.remove('hidden'); };
        $('rr-opts').onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; sendTo = b.dataset.s; if (sendTo === 'inv') { invPreview = []; computeInvPreview(); } renderSend(); };
        $('rr-confirm').onclick = () => openFinalConfirm();
        renderSend();
    }
    $('rr-proceed').addEventListener('click', goPage2);

    function renderSend() {
        const det = $('rr-send-detail'); if (!det) return;
        $('rr-opts').querySelectorAll('[data-s]').forEach(b => b.classList.toggle('active', b.dataset.s === sendTo));
        let why = '', btn = rtT('ret_btn_choose', 'Choose where to send');
        const today = rtToday();
        if (!sendTo) { why = rtT('ret_why_send', 'Choose where to send the items.'); det.innerHTML = ''; }
        else if (sendTo === 'bulk') {
            btn = rtT('ret_btn_confirm_bulk', 'Confirm & send to bulk');
            const groups = bulkGroups();
            det.innerHTML = `<p class="ret-hint">${rtT('ret_bulk_note', 'Items of the same coffee on the same machine become one bulk card (sealed and opened together). Different coffees are never mixed.')}</p>
                <div class="table-container"><table class="ret-table"><thead><tr><th>${rtT('ret_col_card', 'Bulk card')}</th><th>${rtT('ret_lbl_machine', 'Machine')}</th><th>${rtT('ret_col_from', 'From items')}</th><th style="text-align:right;">kg</th><th>${rtT('ret_col_card_roast', 'Roast date on the card')}</th><th>${rtT('ret_col_lot', 'Lot code')}</th></tr></thead><tbody>
                ${groups.map(g => { const d = bulkDates[g.key] || g.oldest; return `<tr>
                    <td><b>${rtEsc(rtCoffeeLabel(g.head))}</b><small class="ret-sub">${g.head.coffee_type} · code ${rtEsc(g.head.coffee_code)} · RETURN</small></td>
                    <td>${rtEsc(mName(g.head.machine_id))}</td><td>#${g.idx.map(i => i + 1).join(', #')}</td><td style="text-align:right; font-family:monospace;">${g.kg.toFixed(2)}</td>
                    <td><input type="date" class="form-control rr-bdate" data-k="${rtEsc(g.key)}" value="${d}" max="${today}" style="max-width:170px;"><small class="ret-sub">${d !== g.oldest ? rtEsc(rtT('ret_changed_from', 'changed from {d}').replace('{d}', g.oldest)) : rtT('ret_oldest_date', 'oldest roast date of its items')}</small></td>
                    <td><code>${rtEsc(g.head.coffee_code)}-${rtEsc(machineCode(g.head.machine_id))}${ddmmyy(d)}-…</code></td></tr>`; }).join('')}
                </tbody></table></div>`;
            det.querySelectorAll('.rr-bdate').forEach(inp => inp.onchange = () => { bulkDates[inp.dataset.k] = inp.value; renderSend(); });
            if (groups.some(g => (bulkDates[g.key] || g.oldest) > today || !(bulkDates[g.key] || g.oldest))) why = rtT('ret_why_future', 'A roast date can\'t be empty or in the future.');
        } else if (sendTo === 'inv') {
            btn = rtT('ret_btn_confirm_inv', 'Confirm & send to inventory');
            const sealed = cart.filter(l => l.sealed_pcs > 0);
            const openedKg = cart.reduce((s, l) => s + l.opened_kg, 0);
            const ready = invPreview.length === sealed.length;
            const labelsTotal = invPreview.reduce((s, x) => s + x.labels, 0);
            det.innerHTML = `<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                    <span class="ret-hint" style="font-weight:600;">${rtT('ret_labels', 'Labels:')}</span>
                    <div class="ret-seg" id="rr-label-seg"><button type="button" data-m="old" class="${labelMode === 'old' ? 'active' : ''}">${rtT('ret_label_old', 'Use old labels')}</button><button type="button" data-m="new" class="${labelMode === 'new' ? 'active' : ''}">${rtT('ret_label_new', 'Print new labels')}</button></div>
                    <span class="ret-hint" style="flex:1; min-width:220px;">${labelMode === 'old' ? rtT('ret_label_old_hint', 'Bags with a strip code go back to that lot (its FIFO place). Bags without one get a new strip code.') : rtT('ret_label_new_hint', 'Every bag gets a new label. Change the roast date if needed — the original stays in the history.')}</span>
                </div>
                ${!ready ? `<div class="ret-hint">${rtT('ret_checking_lots', 'Checking lots…')}</div>` : `<div class="table-container"><table class="ret-table"><thead><tr><th>#</th><th>${rtT('ret_col_coffee', 'Coffee')}</th><th style="text-align:right;">${rtT('ret_col_packs', 'Packs')}</th><th>${rtT('ret_lbl_roast', 'Roast Date')}</th><th>${rtT('ret_col_goes_to', 'Goes to')}</th><th style="text-align:right;">${rtT('ret_col_labels', 'Labels')}</th></tr></thead><tbody>
                ${invPreview.map(x => `<tr><td>${x.i + 1}</td><td><b>${rtEsc(rtCoffeeLabel(x.l))}</b><small class="ret-sub">${rtSize(x.l.bag_size_g)} · ${rtEsc(mName(x.l.machine_id))}</small></td><td style="text-align:right;">${x.l.sealed_pcs}</td>
                    <td>${labelMode === 'new' ? `<input type="date" class="form-control rr-ndate" data-i="${x.i}" value="${x.date}" max="${today}" style="max-width:170px;"><small class="ret-sub">${x.date !== x.l.roast_date ? rtEsc(rtT('ret_was_date', 'was {d} — kept in history').replace('{d}', x.l.roast_date)) : rtT('ret_original', 'original')}</small>` : `${rtEsc(x.date)}<small class="ret-sub">${rtT('ret_original', 'original')}</small>`}</td>
                    <td>${x.t.kind === 'scanned' ? `${rtT('ret_goes_back', 'Back to lot')} <code>${rtEsc(x.t.lot.lot_code)}</code><small class="ret-sub">strip ${rtEsc(x.t.lot.strip_code || '-')} · ${labelMode === 'new' ? rtT('ret_reprint_same', 'reprinted with the same strip') : rtT('ret_old_valid', 'old label still valid')}</small>`
                        : x.t.kind === 'merge' ? `${rtT('ret_goes_lot', 'Lot')} <code>${rtEsc(x.t.lot.lot_code)}</code><small class="ret-sub">strip ${rtEsc(x.t.lot.strip_code || '-')} · ${rtT('ret_same_lot', 'same coffee, machine, roast date')}</small>`
                        : `${rtT('ret_goes_new', 'New lot')}<small class="ret-sub">${rtT('ret_new_strip', 'new strip code')}${x.l.coffee_kind === 'unknown' ? ' · ' + rtT('ret_by_code', 'coffee Unknown, recorded by code') : ''}</small>`}</td>
                    <td style="text-align:right;">${x.labels || '—'}</td></tr>`).join('') || `<tr><td colspan="6" class="ret-hint">${rtT('ret_no_sealed', 'No sealed packs to send.')}</td></tr>`}
                </tbody></table></div>`}
                ${openedKg > 0 ? `<div class="ret-unknown" style="margin-top:10px;"><b>${openedKg.toFixed(2)} kg ${rtT('ret_opened_short', 'opened')}</b> — ${rtT('ret_opened_floats', 'can\'t go back on the shelf as bags. It stays as floating stock (Need action); send it to Bulk or Waste later with Action.')}</div>` : ''}
                ${ready ? `<p class="ret-hint" style="margin-top:8px;">${rtEsc(rtT('ret_labels_total', 'Labels to print after sending: {n}').replace('{n}', labelsTotal))}</p>` : ''}`;
            $('rr-label-seg').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b && b.dataset.m !== labelMode) { labelMode = b.dataset.m; invPreview = []; computeInvPreview(); renderSend(); } };
            det.querySelectorAll('.rr-ndate').forEach(inp => inp.onchange = () => { newDates[parseInt(inp.dataset.i)] = inp.value; invPreview = []; computeInvPreview(); renderSend(); });
            if (!sealed.length) why = rtT('ret_why_no_sealed', 'No sealed packs — use Send all to bulk or Save, send later.');
            else if (!ready) why = rtT('ret_checking_lots', 'Checking lots…');
            else if (Object.values(newDates).some(d => !d || d > today)) why = rtT('ret_why_future', 'A roast date can\'t be empty or in the future.');
        } else {
            btn = rtT('ret_send_later', 'Save, send later');
            det.innerHTML = `<p class="ret-hint">${rtT('ret_later_note', 'Saved as floating stock with status Need action. Nothing moves until you choose an Action on each item in the Returns tab.')}</p>`;
        }
        $('rr-send-why').textContent = why;
        $('rr-confirm').disabled = !!why;
        $('rr-confirm').textContent = btn;
    }

    // ---------------- re-confirmation, then save + send ----------------
    function openFinalConfirm() {
        const o = originValue();
        const kg = cart.reduce((s, l) => s + rtItemKg(l), 0).toFixed(2);
        const lines = [];
        if (sendTo === 'bulk') bulkGroups().forEach(g => { const d = bulkDates[g.key] || g.oldest; lines.push(`<span class="ret-pill ret-pill-bulk">${rtT('ret_act_bulk', 'Bulk')}</span> ${rtEsc(rtCoffeeLabel(g.head))} · ${rtEsc(mName(g.head.machine_id))} · ${g.kg.toFixed(2)} kg · roast ${d}${d !== g.oldest ? ` (${rtT('ret_changed', 'changed')})` : ''}`); });
        if (sendTo === 'inv') {
            invPreview.forEach(x => lines.push(`<span class="ret-pill ret-pill-inventory">${rtT('ret_act_inventory', 'Inventory')}</span> ${rtEsc(rtCoffeeLabel(x.l))} · ${x.l.sealed_pcs} × ${rtSize(x.l.bag_size_g)} → ${x.t.kind === 'new' ? rtT('ret_goes_new', 'New lot') : `strip <b>${rtEsc(x.t.lot.strip_code || x.t.lot.lot_code)}</b>`}${x.labels ? ` · ${rtEsc(rtT('ret_n_labels', '{n} new labels').replace('{n}', x.labels))}` : ` · ${rtT('ret_old_label', 'old label')}`}${x.date !== x.l.roast_date ? ` · roast ${x.date} (${rtT('ret_was', 'was')} ${x.l.roast_date})` : ''}`));
            const op = cart.reduce((s, l) => s + l.opened_kg, 0);
            if (op > 0) lines.push(`<span class="ret-pill ret-pill-need">${rtT('ret_floating', 'Floating')}</span> ${op.toFixed(2)} kg ${rtT('ret_opened_waiting', 'opened coffee — waiting for an Action')}`);
        }
        const labels = sendTo === 'inv' ? invPreview.reduce((s, x) => s + x.labels, 0) : 0;
        const ov = document.createElement('div');
        ov.className = 'overlay'; ov.style.zIndex = '2000';
        ov.innerHTML = `<div class="overlay-card" role="dialog" aria-modal="true" style="max-width:560px; gap:10px; text-align:center;">
            <div class="ret-q">?</div>
            <h3 style="margin:0;">${sendTo === 'later' ? rtT('ret_q_later', 'Save this return?') : sendTo === 'bulk' ? rtT('ret_q_bulk', 'Send to bulk?') : rtT('ret_q_inv', 'Send to inventory?')}</h3>
            <div class="ret-hint">${cart.length} ${rtT('ret_items', 'item(s)')} · ${kg} kg · ${rtEsc(o.label)}</div>
            ${lines.length ? `<ul class="ret-result">${lines.map(x => `<li>${x}</li>`).join('')}</ul>` : `<p style="margin:0; color:var(--text-secondary);">${rtT('ret_later_note_short', 'Saved as floating stock — nothing moves until you use Action on each item.')}</p>`}
            ${labels ? `<div class="ret-hint">${rtEsc(rtT('ret_labels_after', '{n} new labels will be ready to print after saving.').replace('{n}', labels))}</div>` : ''}
            <div class="ret-hint">${rtT('ret_nothing_saved', 'Nothing is saved until you press Proceed.')}</div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:6px;">
                <button type="button" class="btn btn-secondary" data-f="cancel">${rtT('btn_cancel', 'Cancel')}</button>
                <button type="button" class="btn btn-primary" data-f="go">${rtT('ret_btn_proceed', 'Proceed')}</button>
            </div></div>`;
        document.body.appendChild(ov);
        ov.querySelector('[data-f="go"]').focus();
        ov.querySelector('[data-f="cancel"]').onclick = () => ov.remove();
        ov.querySelector('[data-f="go"]').onclick = async () => { ov.remove(); await saveAndSend(); };
    }

    let saving = false;
    async function saveAndSend() {
        if (saving) return;
        if (sendTo !== 'later' && !(await ensureNoStockOpname())) return;
        saving = true;
        const o = originValue();
        const lock = lockProcessingScreen(sendTo === 'later' ? rtT('ret_saving', 'Saving return…') : sendTo === 'bulk' ? rtT('ret_sending_bulk', 'Creating bulk cards…') : rtT('ret_sending_inv', 'Adding to inventory…'));
        const undo = [];
        let ret = null, items = [], printSets = [], results = [], failure = null, partial = null;
        try {
            ret = await rtCreateReturn({ return_date: $('rr-date').value, customer_id: o.customer_id || null, origin_text: o.origin_text || null, reason: $('rr-reason').value || null, notes: $('rr-notes').value.trim() || null });
            undo.push(async () => { await rtSb().from('stock_returns').delete().eq('id', ret.id); });
            const rows = cart.map((l, i) => ({
                return_id: ret.id, line_no: i + 1, coffee_kind: l.coffee_kind, coffee_code: l.coffee_code, coffee_type: l.coffee_type,
                single_coffee_id: l.single_coffee_id, blend_recipe_id: l.blend_recipe_id, coffee_name: l.coffee_name, resolved_via: l.resolved_via,
                candidates: l.candidates, source_packed_lot_id: l.source_packed_lot_id, machine_id: l.machine_id, roast_date: l.roast_date,
                bag_size_g: l.bag_size_g, sealed_pcs: l.sealed_pcs, opened_kg: l.opened_kg
            }));
            items = await rtQ(rtSb().from('stock_return_items').insert(rows).select());
            items.sort((a, b) => a.line_no - b.line_no);
            if (items.length !== cart.length) throw new Error('not every item was saved');
            const originLabel = o.label;
            if (sendTo === 'bulk') {
                for (const g of bulkGroups()) {
                    const d = bulkDates[g.key] || g.oldest;
                    const parts = [];
                    g.idx.forEach(i => {
                        const it = items[i];
                        if (it.sealed_pcs > 0) parts.push({ item: it, part: 'sealed', qty: it.sealed_pcs, kg: it.sealed_pcs * it.bag_size_g / 1000 });
                        if (parseFloat(it.opened_kg) > 0) parts.push({ item: it, part: 'opened', qty: 0, kg: parseFloat(it.opened_kg) });
                    });
                    const bulk = await rtSendBulk(ret, parts, d, refs, undo);
                    results.push(`<span class="ret-pill ret-pill-bulk">${rtT('ret_act_bulk', 'Bulk')}</span> ${rtEsc(rtCoffeeLabel(g.head))} · ${rtEsc(mName(g.head.machine_id))} · ${(+bulk.bulk_available).toFixed(2)} kg · roast ${d}`);
                }
            } else if (sendTo === 'inv') {
                for (const x of invPreview) {
                    const it = items[x.i];
                    const r = await rtSendInventory(it, ret, it.sealed_pcs, x.date, labelMode, refs, undo);
                    if (r.labels) printSets.push({ lot: r.lot, item: it, date: x.date, qty: r.labels });
                    results.push(`<span class="ret-pill ret-pill-inventory">${rtT('ret_act_inventory', 'Inventory')}</span> ${rtEsc(rtCoffeeLabel(it))} · ${it.sealed_pcs} × ${rtSize(it.bag_size_g)} → strip <b>${rtEsc(r.lot.strip_code || r.lot.lot_code)}</b>${r.labels ? ` · ${rtEsc(rtT('ret_n_labels', '{n} new labels').replace('{n}', r.labels))}` : ` · ${rtT('ret_old_label', 'old label')}`}${x.date !== it.roast_date ? ` · roast ${x.date} (${rtT('ret_was', 'was')} ${it.roast_date})` : ''}`);
                }
                const op = items.reduce((s, it) => s + (parseFloat(it.opened_kg) || 0), 0);
                if (op > 0) results.push(`<span class="ret-pill ret-pill-need">${rtT('ret_floating', 'Floating')}</span> ${op.toFixed(2)} kg ${rtT('ret_opened_waiting', 'opened coffee — waiting for an Action')}`);
            }
            // Read back: every action row this save wrote must exist.
            if (sendTo !== 'later') {
                const acts = await rtQ(rtSb().from('stock_return_actions').select('id').in('return_item_id', items.map(i => i.id)));
                const expected = sendTo === 'bulk' ? items.reduce((s, it) => s + (it.sealed_pcs > 0 ? 1 : 0) + (parseFloat(it.opened_kg) > 0 ? 1 : 0), 0) : invPreview.length;
                if (acts.length !== expected) throw new Error('saved actions could not be verified');
            }
        } catch (e) {
            console.error('Record return failed:', e);
            const left = await rtRollback(undo);
            if (left.length) partial = [e.message || String(e), ...left].join('\n'); else failure = e.message || String(e);
        } finally {
            lock.release();
            saving = false;
        }
        if (failure) { await showStockFailed(failure); return; }
        if (partial) { await showStockPartial(partial); return; }
        const closeBtn = document.getElementById('btn-close-modal'); if (closeBtn) closeBtn.click();
        returnsFilter = 'all';
        loadReturnsSection();
        if (typeof scheduleDashboardRefresh === 'function') scheduleDashboardRefresh();
        await rtShowDone({
            title: sendTo === 'later' ? rtT('ret_done_later', 'Return saved') : sendTo === 'bulk' ? rtT('ret_done_bulk', 'Sent to bulk') : rtT('ret_done_inv', 'Sent to inventory'),
            sub: `${ret.return_number} · ${items.length} ${rtT('ret_items', 'item(s)')} · ${items.reduce((s, it) => s + rtItemKg(it), 0).toFixed(2)} kg`,
            results, printSets, refs
        });
    }
}

async function rtCreateReturn(header) {
    const date = header.return_date;
    const prefix = `RET-${date.replace(/-/g, '')}-`;
    for (let tries = 0; tries < 6; tries++) {
        const existing = await rtQ(rtSb().from('stock_returns').select('return_number').like('return_number', prefix + '%'));
        const n = Math.max(0, ...existing.map(r => parseInt(r.return_number.slice(prefix.length)) || 0)) + 1 + tries;
        const { data, error } = await rtSb().from('stock_returns').insert(Object.assign({ return_number: prefix + n, created_by: rtUser() }, header)).select().single();
        if (!error) return data;
        if (error.code !== '23505') throw error;
    }
    throw new Error('Could not get a free return number');
}

// Success dialog (+ Print labels through the bulk card's printer).
function rtShowDone({ title, sub, results, printSets, refs }) {
    return new Promise(resolve => {
        const labels = (printSets || []).reduce((s, p) => s + p.qty, 0);
        const ov = document.createElement('div');
        ov.className = 'overlay'; ov.style.zIndex = '2000';
        ov.innerHTML = `<div class="overlay-card" role="dialog" aria-modal="true" style="max-width:560px; gap:10px; text-align:center;">
            <div class="ret-tick">✓</div>
            <h3 style="margin:0;">${rtEsc(title)}</h3>
            <div class="ret-hint">${rtEsc(sub)}</div>
            ${results && results.length ? `<ul class="ret-result">${results.map(x => `<li>${x}</li>`).join('')}</ul>` : `<p style="margin:0; color:var(--text-secondary);">${rtT('ret_later_done', 'Floating stock — nothing moved yet. Use Action on each item.')}</p>`}
            <div class="ret-hint">${rtT('ret_verified', 'Checked against the database after saving.')}</div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:6px;">
                ${labels ? `<button type="button" class="btn btn-secondary" data-f="print">${rtEsc(rtT('ret_btn_print', 'Print {n} labels').replace('{n}', labels))}</button>` : ''}
                <button type="button" class="btn btn-primary" data-f="done">${rtT('ret_btn_done', 'Done')}</button>
            </div></div>`;
        document.body.appendChild(ov);
        ov.querySelector('[data-f="done"]').onclick = () => { ov.remove(); resolve(); };
        const p = ov.querySelector('[data-f="print"]');
        if (p) p.onclick = () => rtOpenPrint(printSets, refs);
    });
}

// Print step — same sticker, layout and carton option as the bulk card's
// Print Barcode (openPrintBarcodeModal); every lot goes out in one job.
async function rtOpenPrint(printSets, refs) {
    const sizes = refs.sizes;
    const ov = document.createElement('div');
    ov.className = 'overlay'; ov.style.zIndex = '2100';
    const mName = id => (refs.machines.find(m => m.id === id) || {}).name || '-';
    ov.innerHTML = `<div class="overlay-card" role="dialog" aria-modal="true" style="max-width:620px; gap:12px;">
        <h3 style="margin:0;">${rtT('ret_print_title', 'Print Barcode')}</h3>
        <div class="ret-hint">${rtT('ret_print_hint', 'Same label as the bulk card\'s Barcode button (Settings → Label Layout). Quantities come from the return; add carton labels if needed.')}</div>
        ${printSets.map((p, i) => { const sz = sizes.find(s => parseInt(s.gram) === parseInt(p.item.bag_size_g)) || {}; return `<div class="ret-print-lot">
            <div><b>${rtEsc(rtCoffeeLabel(p.item))}</b><small class="ret-sub">${rtEsc(mName(p.item.machine_id))} · lot <code>${rtEsc(p.lot.lot_code)}</code> · strip <b>${rtEsc(p.lot.strip_code || '-')}</b> · roast ${rtEsc(p.date)}</small></div>
            <div style="display:flex; gap:8px;">
                <label class="form-label" style="margin:0;">${rtEsc(sz.label || rtSize(p.item.bag_size_g))}<input type="number" min="0" class="form-control rt-pq" data-i="${i}" value="${p.qty}" style="width:90px;"></label>
                ${sz.carton_multiplier ? `<label class="form-label" style="margin:0;">${rtEsc((sz.label || rtSize(p.item.bag_size_g)) + ' carton (×' + sz.carton_multiplier + ')')}<input type="number" min="0" class="form-control rt-pc" data-i="${i}" value="0" style="width:90px;"></label>` : ''}
            </div></div>`; }).join('')}
        <div style="display:flex; justify-content:flex-end; gap:10px;">
            <button type="button" class="btn btn-secondary" data-f="close">${rtT('btn_cancel', 'Cancel')}</button>
            <button type="button" class="btn btn-primary" data-f="print">${rtT('ret_print_go', 'Print')}</button>
        </div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('[data-f="close"]').onclick = () => ov.remove();
    ov.querySelector('[data-f="print"]').onclick = () => {
        const sets = printSets.map((p, i) => {
            const sz = sizes.find(s => parseInt(s.gram) === parseInt(p.item.bag_size_g)) || {};
            const label = sz.label || rtSize(p.item.bag_size_g);
            const q = parseInt((ov.querySelector(`.rt-pq[data-i="${i}"]`) || {}).value) || 0;
            const c = parseInt((ov.querySelector(`.rt-pc[data-i="${i}"]`) || {}).value) || 0;
            const requested = [];
            if (q > 0) requested.push({ label, gram: p.item.bag_size_g, multiplier: null, qty: q, packedCoffeeLotId: p.lot.id, lotCode: p.lot.lot_code, stripCode: p.lot.strip_code });
            if (c > 0) requested.push({ label: `${label} Carton`, gram: p.item.bag_size_g, multiplier: sz.carton_multiplier, qty: c, packedCoffeeLotId: p.lot.id, lotCode: p.lot.lot_code, stripCode: p.lot.strip_code });
            // Label shows the plain coffee / trade name (never "— origin Unknown").
            return { lot: { coffee_name: p.item.coffee_name, production_date: p.date, machine_id: p.item.machine_id }, requested };
        }).filter(x => x.requested.length);
        if (!sets.length) return;
        printLotLabelSets(sets, refs.machines);
        ov.remove();
    };
}

// ============================================================================
// Edit Return (2026-10-05, mockup v3) — fix a return after the fact.
// ----------------------------------------------------------------------------
// The header (date, origin, reason, notes) is always editable. Per item, what
// was already processed (its stock_return_actions) is locked; what is still
// remaining can be edited, removed or re-identified:
//   no actions yet      → edited in place, or removed
//   partly processed    → details changed (code, machine, roast date, package):
//                           · item was Unknown and the edit identifies it,
//                             same package → applied to the WHOLE item, the
//                             processed part included (record + Tracking
//                             only — the bags already moved stay put)
//                           · otherwise → the remaining becomes a new item;
//                             the original keeps exactly what was processed
//                         → only quantities changed: total = processed + new
//                         → "Remove remaining": total = processed (Done)
//   fully processed     → only an Unknown coffee can be picked
// An Unknown coffee can be picked by hand on any item (resolved_via 'manual').
// Nothing here moves stock. Every change is logged silently to
// stock_return_edits (who, when, old → new) — never shown in the app.
// ============================================================================
async function openEditReturnModal(returnId) {
    if (!hasPermission('returns_manage')) return;
    let refs, ret, items, actions;
    try {
        let rows;
        [refs, rows] = await Promise.all([
            rtLoadRefs(),
            rtQ(rtSb().from('stock_returns').select('*, stock_return_items(*, stock_return_actions(*))').eq('id', returnId))
        ]);
        if (!rows[0]) throw new Error(rtT('ret_err_changed', 'This item changed meanwhile — reopen it and try again.'));
        const { stock_return_items: its, ...head } = rows[0];
        ret = head;
        items = (its || []).sort((a, b) => a.line_no - b.line_no || a.id - b.id);
        actions = items.flatMap(i => i.stock_return_actions || []);
        items = items.map(({ stock_return_actions, ...i }) => i);
    } catch (e) { await showStockFailed(e.message || String(e)); return; }

    const codeOpts = salesCodeOptions(refs.codeDefinitions, refs.greens, refs.recipes);
    const today = rtToday();
    const mName = id => (refs.machines.find(m => m.id === id) || {}).name || '-';
    const codeLabel = (code, type) => { const o = codeOpts.find(x => x.code === code && x.type === type); return o ? salesCodeLabel(o) : (code || ''); };
    const statusLabel = { need: rtT('ret_status_need', 'Need action'), partial: rtT('ret_status_partial', 'Partial'), done: rtT('ret_status_done', 'Done') };
    const actLabel = { inventory: rtT('ret_act_inventory', 'Inventory'), bulk: rtT('ret_act_bulk', 'Bulk'), waste: rtT('ret_act_waste', 'Waste') };
    const reasons = ['Customer return', 'Damaged packaging', 'Near expiry', 'Other'];
    if (ret.reason && !reasons.includes(ret.reason)) reasons.push(ret.reason);
    const custName = ret.customer_id ? ((refs.customers.find(c => c.id === ret.customer_id) || {}).name || '') : '';

    // One card per existing item, plus cards for items added here.
    const cards = items.map((it, i) => {
        const rem = rtRemaining(it, actions);
        return {
            key: 'e' + it.id, no: i + 1, it, isNew: false, removed: false, resolved: null, seq: 0,
            acts: actions.filter(a => a.return_item_id === it.id), rem, status: rtItemStatus(it, actions),
            processed: { sealed: (parseInt(it.sealed_pcs) || 0) - rem.sealed, opened: +((parseFloat(it.opened_kg) || 0) - rem.opened).toFixed(3) }
        };
    });
    let addSeq = 0;
    const maxLine = Math.max(0, ...items.map(i => i.line_no || 0));

    const sizeOpts = sel => {
        const list = refs.sizes.map(s => parseInt(s.gram));
        const extra = sel && !list.includes(sel) ? [sel] : [];
        return `<option value="">${rtT('ret_select', 'Select…')}</option>` + [...refs.sizes.map(s => ({ g: parseInt(s.gram), l: s.label || rtSize(s.gram) })), ...extra.map(g => ({ g, l: rtSize(g) }))]
            .map(s => `<option value="${s.g}"${s.g === sel ? ' selected' : ''}>${rtEsc(s.l)}</option>`).join('');
    };
    const machineOpts = sel => `<option value="">${rtT('ret_select', 'Select…')}</option>` + refs.machines.map(m => `<option value="${m.id}"${m.id === sel ? ' selected' : ''}>${rtEsc(m.name)}</option>`).join('');
    function fieldsHtml(v, qtyNames) {
        return `<div class="ret-ed-grid">
            <div class="form-group"><label class="form-label">${rtT('ret_lbl_code', 'Coffee Code')}</label><input type="text" class="form-control" data-f="code" list="re-code-list" autocomplete="off" value="${rtEsc(v.code)}"></div>
            <div class="form-group"><label class="form-label">${rtT('ret_lbl_machine', 'Machine')}</label><select class="form-control" data-f="machine">${machineOpts(v.machine)}</select></div>
            <div class="form-group"><label class="form-label">${rtT('ret_lbl_roast', 'Roast Date')}</label><input type="date" class="form-control" data-f="roast" max="${today}" value="${rtEsc(v.roast)}"></div>
            <div class="form-group"><label class="form-label">${rtT('ret_lbl_package', 'Package')}</label><select class="form-control" data-f="size">${sizeOpts(v.size)}</select></div>
            <div class="form-group"><label class="form-label">${qtyNames[0]}</label><input type="number" class="form-control" data-f="sealed" min="0" step="1" value="${v.sealed}"></div>
            <div class="form-group"><label class="form-label">${qtyNames[1]}</label><input type="number" class="form-control" data-f="opened" min="0" step="0.01" value="${v.opened}"></div>
        </div><div data-f="note"></div>`;
    }
    function existingCardHtml(c) {
        const it = c.it;
        const rmLabel = c.status === 'need' ? rtT('ret_remove', 'Remove') : c.status === 'partial' ? rtT('ret_ed_remove_remaining', 'Remove remaining') : '';
        const pick = it.coffee_kind === 'unknown' ? `<div class="form-group" style="margin-bottom:10px;"><label class="form-label">${rtT('ret_lbl_coffee', 'Coffee')} <span class="ret-hint">— ${rtT('ret_ed_pick_hint', 'was Unknown. Pick it if you know it; this only fixes the record and Tracking, no stock moves.')}</span></label><select class="form-control" data-f="pick"></select></div>` : '';
        const lock = c.acts.length ? `<div class="ret-ed-lock">🔒 <b>${rtT('ret_ed_locked', 'Processed — locked')}</b> ${c.acts.map(a => `${rtEsc(a.part === 'sealed' ? `${a.qty_pcs} × ${rtSize(it.bag_size_g)}` : `${(+a.kg).toFixed(2)} kg ${rtT('ret_opened_short', 'opened')}`)} → <span class="ret-pill ret-pill-${a.action}">${actLabel[a.action] || a.action}</span>`).join(' · ')}</div>` : '';
        const body = c.status === 'done'
            ? `<div class="ret-hint">${rtT('ret_ed_nothing_left', 'Nothing remaining — only the coffee can be corrected.')}</div>`
            : `<div class="ret-ed-edit"><div class="ret-ed-title"><span>${c.acts.length ? rtT('ret_ed_remaining', 'Remaining — editable') : rtT('ret_ed_unprocessed', 'Not processed — fully editable')}</span>${c.acts.length ? `<span class="ret-hint">${rtEsc(rtT('ret_ed_left', '{q} left').replace('{q}', rtQtyText(c.rem.sealed, c.rem.opened, it.bag_size_g)))}</span>` : ''}</div>
                ${fieldsHtml({ code: codeLabel(it.coffee_code, it.coffee_type), machine: it.machine_id, roast: it.roast_date, size: parseInt(it.bag_size_g), sealed: c.rem.sealed, opened: c.rem.opened },
                    c.acts.length ? [rtT('ret_ed_sealed_left', 'Sealed left'), rtT('ret_ed_opened_left', 'Opened left (kg)')] : [rtT('ret_lbl_sealed', 'Sealed packs'), rtT('ret_lbl_opened', 'Opened coffee (kg)')])}</div>`;
        return `<div class="ret-ed-card" data-card="${c.key}">
            <div class="ret-ed-top"><b>${c.no} · ${rtEsc(rtCoffeeLabel(it))}</b><span class="ret-ed-actions"><span class="ret-pill ret-pill-${c.status}">${statusLabel[c.status]}</span>${rmLabel ? `<button type="button" class="btn btn-secondary btn-sm" data-rm="${c.key}">${rmLabel}</button>` : ''}</span></div>
            <div class="ret-ed-removed-note ret-hint hidden" data-f="removednote"></div>
            <div data-f="content">${pick}${lock}${body}</div>
        </div>`;
    }
    function newCardHtml(c) {
        return `<div class="ret-ed-card ret-ed-new" data-card="${c.key}">
            <div class="ret-ed-top"><b>${rtT('ret_ed_new_item', 'New item')}</b><button type="button" class="ret-x" data-rm="${c.key}" aria-label="${rtEsc(rtT('ret_remove', 'Remove'))}">×</button></div>
            <div class="ret-scanbox"><label class="form-label" style="margin-bottom:6px;">${rtT('ret_lbl_strip', 'Strip code — scan or type, then Enter')}</label>
                <input type="text" class="form-control" data-f="strip" autocomplete="off" placeholder="20037" style="font-family:monospace;">
                <div class="ret-hint" data-f="striphint">${rtT('ret_ed_strip_hint', 'Scan a sticker, or fill in the fields below by hand.')}</div></div>
            ${fieldsHtml({ code: '', machine: null, roast: '', size: null, sealed: '', opened: '' }, [rtT('ret_lbl_sealed', 'Sealed packs'), rtT('ret_lbl_opened', 'Opened coffee (kg)')])}
        </div>`;
    }

    const html = `
        <div class="ret-ed-head">
            <div class="form-group"><label class="form-label">${rtT('ret_lbl_date', 'Return Date')}</label><input type="date" id="re-date" class="form-control" max="${today}" value="${rtEsc(ret.return_date)}"></div>
            <div class="form-group"><label class="form-label">${rtT('ret_lbl_origin', 'Origin')}</label>
                <div style="display:flex; gap:6px;">
                    <div class="ret-seg" id="re-origin-seg"><button type="button" data-o="cust" class="${ret.customer_id ? 'active' : ''}">${rtT('ret_origin_customer', 'Customer')}</button><button type="button" data-o="other" class="${ret.customer_id ? '' : 'active'}">${rtT('ret_origin_other', 'Other')}</button></div>
                    <input type="text" id="re-cust" class="form-control${ret.customer_id ? '' : ' hidden'}" list="re-cust-list" autocomplete="off" value="${rtEsc(custName)}" placeholder="${rtEsc(rtT('ret_ph_customer', 'Customer name'))}">
                    <input type="text" id="re-other" class="form-control${ret.customer_id ? ' hidden' : ''}" value="${rtEsc(ret.origin_text || '')}" placeholder="${rtEsc(rtT('ret_ph_other', 'e.g. Pulled from shelf'))}">
                </div>
                <datalist id="re-cust-list">${refs.customers.map(c => `<option value="${rtEsc(c.name)}"></option>`).join('')}</datalist></div>
            <div class="form-group"><label class="form-label">${rtT('ret_lbl_reason', 'Reason')}</label><select id="re-reason" class="form-control"><option value="">—</option>${reasons.map(r => `<option${r === ret.reason ? ' selected' : ''}>${rtEsc(r)}</option>`).join('')}</select></div>
            <div class="form-group"><label class="form-label">${rtT('ret_lbl_notes', 'Notes')}</label><input type="text" id="re-notes" class="form-control" value="${rtEsc(ret.notes || '')}" placeholder="${rtEsc(rtT('ret_ph_optional', 'optional'))}"></div>
        </div>
        <datalist id="re-code-list">${codeOpts.map(o => `<option value="${rtEsc(salesCodeLabel(o))}"></option>`).join('')}</datalist>
        <div class="ret-item-head"><span>${rtT('ret_ed_items', 'Items')}</span></div>
        <div id="re-cards">${cards.map(existingCardHtml).join('')}</div>
        <button type="button" id="re-add" class="btn btn-secondary" style="width:100%; border-style:dashed;">+ ${rtT('ret_ed_add_item', 'Add item')}</button>
        <div class="ret-ed-foot">
            <div><span id="re-count" class="ret-hint"></span><div class="ret-why" id="re-why"></div></div>
            <div style="display:flex; gap:8px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">${rtT('btn_cancel', 'Cancel')}</button>
                <button type="button" id="re-save" class="btn btn-primary" disabled>${rtT('ret_ed_save', 'Save changes')}</button>
            </div>
        </div>`;
    openModal(rtT('ret_title_edit', 'Edit Return · {n}').replace('{n}', ret.return_number), html, '1100px');

    const $ = id => document.getElementById(id);
    const cardEl = c => document.querySelector(`[data-card="${c.key}"]`);
    const fEl = (c, n) => { const el = cardEl(c); return el ? el.querySelector(`[data-f="${n}"]`) : null; };
    const fVal = (c, n) => { const el = fEl(c, n); return el ? el.value : ''; };
    const allCards = () => cards.filter(c => c.isNew ? !c.gone : true);
    let origin = ret.customer_id ? 'cust' : 'other';

    // ---------- reading a card ----------
    function valsOf(c) {
        if (!c.isNew && c.status === 'done') {
            const it = c.it;
            return { st: { state: 'ok', code: it.coffee_code, type: it.coffee_type }, code: it.coffee_code, type: it.coffee_type, machine: it.machine_id, roast: it.roast_date, size: parseInt(it.bag_size_g), sealed: 0, opened: 0, pick: fVal(c, 'pick') };
        }
        const st = resolveSalesCodeInput(fVal(c, 'code'), codeOpts, refs.codeDefinitions);
        const num = (n, int) => { const raw = fVal(c, n); if (raw === '') return 0; const x = Number(raw); return int ? x : +x.toFixed(3); };
        return { st, code: st.code, type: st.type, machine: parseInt(fVal(c, 'machine')) || null, roast: fVal(c, 'roast'), size: parseInt(fVal(c, 'size')) || null,
            sealed: num('sealed', true), opened: num('opened', false), pick: fVal(c, 'pick') };
    }
    const sameDetails = (v, it) => v.code === it.coffee_code && v.type === it.coffee_type && v.machine === it.machine_id && v.roast === it.roast_date;
    const identityKeys = ['coffee_kind', 'coffee_name', 'single_coffee_id', 'blend_recipe_id', 'resolved_via', 'candidates', 'source_packed_lot_id'];
    function identityOf(c, v) {
        if (v.pick) {
            const [k, id] = v.pick.split(':');
            const x = (k === 'single' ? refs.greens : refs.recipes).find(y => y.id === parseInt(id));
            if (x) return { coffee_kind: k, coffee_name: x.name, single_coffee_id: k === 'single' ? x.id : null, blend_recipe_id: k === 'recipe' ? x.id : null, resolved_via: 'manual', candidates: null, source_packed_lot_id: c.isNew ? null : (c.it.source_packed_lot_id || null) };
        }
        if (c.isNew && c.sticker) {
            const s = c.sticker;
            return { coffee_kind: s.kind, coffee_name: s.name, single_coffee_id: s.singleId || null, blend_recipe_id: s.blendId || null, resolved_via: 'sticker', candidates: null, source_packed_lot_id: s.lot.id };
        }
        if (!c.isNew && sameDetails(v, c.it)) { const o = {}; identityKeys.forEach(k => o[k] = c.it[k] == null ? null : c.it[k]); return o; }
        if (c.resolved && c.resolved.hit) {
            const h = c.resolved.hit;
            return { coffee_kind: h.kind, coffee_name: h.name, single_coffee_id: h.kind === 'single' ? h.id : null, blend_recipe_id: h.kind === 'recipe' ? h.id : null, resolved_via: 'roast_log', candidates: null, source_packed_lot_id: null };
        }
        const def = refs.codeDefinitions.find(d => d.code === v.code);
        return { coffee_kind: 'unknown', coffee_name: def ? def.name : `Code ${v.code}`, single_coffee_id: null, blend_recipe_id: null, resolved_via: 'unknown', candidates: ((c.resolved && c.resolved.list) || []).map(x => ({ name: x.name, batches: x.batches })), source_packed_lot_id: null };
    }

    // ---------- the plan: what Save will write ----------
    // Each op: { change, itemId?, patch?, old?, row?, line }.
    function itemPatch(it, next) {
        const patch = {}, old = {};
        Object.keys(next).forEach(k => {
            const a = it[k] == null ? null : it[k], b = next[k] == null ? null : next[k];
            const same = typeof b === 'number' ? Math.abs((+a || 0) - b) < 0.0005 && a !== null : JSON.stringify(a) === JSON.stringify(b);
            if (!same) { patch[k] = b; old[k] = a; }
        });
        return { patch, old };
    }
    function describe(old, patch) {
        const fmt = (k, x) => x == null || x === '' ? '—' : k === 'machine_id' ? mName(x) : k === 'bag_size_g' ? rtSize(x) : (k === 'candidates' ? null : String(x));
        return Object.keys(patch).filter(k => !['candidates', 'resolved_via', 'single_coffee_id', 'blend_recipe_id', 'source_packed_lot_id', 'coffee_kind'].includes(k))
            .map(k => `${rtEsc(rtT('ret_ed_f_' + k, k))}: <b>${rtEsc(fmt(k, old[k]))} → ${rtEsc(fmt(k, patch[k]))}</b>`).join(', ');
    }
    function plan() {
        const ops = [], whys = [];
        const date = $('re-date').value;
        if (!date || date > today) whys.push(rtT('ret_why_date', 'Check the return date.'));
        let o = null;
        if (origin === 'cust') { const cu = refs.customers.find(x => x.name === $('re-cust').value.trim()); if (cu) o = { customer_id: cu.id, origin_text: null }; }
        else if ($('re-other').value.trim()) o = { customer_id: null, origin_text: $('re-other').value.trim() };
        if (!o) whys.push(rtT('ret_why_origin', 'Fill in the origin.'));
        else {
            const { patch, old } = itemPatch(ret, { return_date: date, customer_id: o.customer_id, origin_text: o.origin_text, reason: $('re-reason').value || null, notes: $('re-notes').value.trim() || null });
            if (Object.keys(patch).length) {
                const showOld = Object.assign({}, old), showNew = Object.assign({}, patch);
                if ('customer_id' in patch || 'origin_text' in patch) {
                    const lbl = (cid, txt) => cid ? ((refs.customers.find(x => x.id === cid) || {}).name || '-') : (txt || '—');
                    showOld.origin = lbl(ret.customer_id, ret.origin_text); showNew.origin = lbl(o.customer_id, o.origin_text);
                    delete showOld.customer_id; delete showOld.origin_text; delete showNew.customer_id; delete showNew.origin_text;
                }
                ops.push({ change: 'header', patch, old, line: `${rtT('ret_ed_header', 'Return')}: ${describe(showOld, showNew)}` });
            }
        }
        let nextLine = maxLine;
        for (const c of allCards()) {
            const label = c.isNew ? rtT('ret_ed_new_item', 'New item') : rtT('ret_ed_item_n', 'Item {n}').replace('{n}', c.no);
            if (c.removed) {
                if (c.status === 'need') ops.push({ change: 'item_remove', itemId: c.it.id, old: c.it, line: `${label}: <b>${rtT('ret_ed_removed', 'removed')}</b>` });
                else if (c.status === 'partial') {
                    const { patch, old } = itemPatch(c.it, { sealed_pcs: c.processed.sealed, opened_kg: c.processed.opened });
                    ops.push({ change: 'remaining_remove', itemId: c.it.id, patch, old, line: `${label}: ${rtEsc(rtT('ret_ed_line_rm_remaining', 'remaining {q} removed — the item becomes Done').replace('{q}', rtQtyText(c.rem.sealed, c.rem.opened, c.it.bag_size_g)))}` });
                }
                continue;
            }
            const v = valsOf(c);
            const editable = c.isNew || c.status !== 'done';
            if (editable) {
                const pre = `${label}: `;
                if (v.st.state !== 'ok') { whys.push(pre + rtT('ret_why_code', 'Enter a registered coffee code.')); continue; }
                if (!v.machine) { whys.push(pre + rtT('ret_why_machine', 'Pick the machine.')); continue; }
                if (!v.roast || v.roast > today || (date && v.roast > date)) { whys.push(pre + rtT('ret_why_roast', 'Check the roast date (on or before the return date).')); continue; }
                if (!v.size) { whys.push(pre + rtT('ret_why_size', 'Pick the package.')); continue; }
                if (c.resolved && c.resolved.loading) { whys.push(pre + rtT('ret_resolving', 'Looking it up in the roast log…')); continue; }
                if (!Number.isInteger(v.sealed) || v.sealed < 0 || !(v.opened >= 0)) { whys.push(pre + rtT('ret_why_qty_bad', 'Check the quantities.')); continue; }
                if ((c.isNew || c.status === 'need') && !(v.sealed > 0 || v.opened > 0)) { whys.push(pre + rtT('ret_ed_why_zero', 'Enter sealed packs and/or opened coffee — or remove the item.')); continue; }
            } else if (date && c.it.roast_date > date) { whys.push(rtT('ret_why_roast_after', 'An item\'s roast date is after the return date.')); }
            const id = identityOf(c, v);
            const details = { coffee_code: v.code, coffee_type: v.type, machine_id: v.machine, roast_date: v.roast, bag_size_g: v.size };
            if (c.isNew) {
                const row = Object.assign({ return_id: ret.id, line_no: ++nextLine }, details, id, { sealed_pcs: v.sealed, opened_kg: v.opened });
                ops.push({ change: 'item_add', row, line: `${label}: <b>${rtEsc(rtCoffeeLabel(row))}</b> · ${rtEsc(rtQtyText(v.sealed, v.opened, v.size))}` });
                continue;
            }
            const it = c.it;
            if (c.status === 'done') {
                if (!v.pick) continue;
                const { patch, old } = itemPatch(it, id);
                if (Object.keys(patch).length) ops.push({ change: 'item_identify', itemId: it.id, patch, old, line: `${label}: ${rtT('ret_lbl_coffee', 'Coffee')} <b>${rtEsc(rtCoffeeLabel(it))} → ${rtEsc(rtCoffeeLabel(Object.assign({}, it, id)))}</b>` });
                continue;
            }
            if (c.status === 'need') {
                const { patch, old } = itemPatch(it, Object.assign({}, details, id, { sealed_pcs: v.sealed, opened_kg: v.opened }));
                if (Object.keys(patch).length) ops.push({ change: 'item_update', itemId: it.id, patch, old, line: `${label}: ${describe(Object.assign({}, old, { coffee_name: rtCoffeeLabel(it) }), Object.assign({}, patch, 'coffee_name' in patch || 'coffee_kind' in patch ? { coffee_name: rtCoffeeLabel(Object.assign({}, it, id)) } : {}))}` });
                continue;
            }
            // partly processed
            const totals = { sealed_pcs: c.processed.sealed + v.sealed, opened_kg: +(c.processed.opened + v.opened).toFixed(3) };
            const detailsChanged = !sameDetails(v, it) || v.size !== parseInt(it.bag_size_g);
            const nothingLeft = !(v.sealed > 0 || v.opened > 0);
            if (detailsChanged && !nothingLeft) {
                const identified = it.coffee_kind === 'unknown' && id.coffee_kind !== 'unknown' && v.size === parseInt(it.bag_size_g);
                if (identified) {
                    const { patch, old } = itemPatch(it, Object.assign({}, details, id, totals));
                    ops.push({ change: 'item_identify', itemId: it.id, patch, old, line: `${label}: ${describe(Object.assign({}, old, { coffee_name: rtCoffeeLabel(it) }), Object.assign({}, patch, { coffee_name: rtCoffeeLabel(Object.assign({}, it, id)) }))} — ${rtEsc(rtT('ret_ed_line_whole', 'applied to the whole item, incl. the part already processed (record and Tracking only)'))}` });
                } else {
                    const { patch, old } = itemPatch(it, { sealed_pcs: c.processed.sealed, opened_kg: c.processed.opened });
                    const row = Object.assign({ return_id: ret.id, line_no: ++nextLine }, details, id, { sealed_pcs: v.sealed, opened_kg: v.opened });
                    ops.push({ change: 'item_split', itemId: it.id, patch, old, row, line: `${label}: ${rtEsc(rtT('ret_ed_line_split', 'remaining {q} becomes a new item ({d}); the processed part keeps its details').replace('{q}', rtQtyText(v.sealed, v.opened, v.size)).replace('{d}', `${rtCoffeeLabel(row)} · ${mName(v.machine)} · ${v.roast} · ${rtSize(v.size)}`))}` });
                }
                continue;
            }
            const next = Object.assign({}, totals);
            if (v.pick) Object.assign(next, id);
            const { patch, old } = itemPatch(it, next);
            if (!Object.keys(patch).length) continue;
            const lines = [];
            if ('sealed_pcs' in patch || 'opened_kg' in patch) lines.push(rtEsc(rtT('ret_ed_line_remaining', 'remaining {a} → {b}').replace('{a}', rtQtyText(c.rem.sealed, c.rem.opened, it.bag_size_g)).replace('{b}', rtQtyText(v.sealed, v.opened, it.bag_size_g))));
            if (v.pick && ('coffee_name' in patch || 'coffee_kind' in patch)) lines.push(`${rtT('ret_lbl_coffee', 'Coffee')} <b>${rtEsc(rtCoffeeLabel(it))} → ${rtEsc(rtCoffeeLabel(Object.assign({}, it, id)))}</b>`);
            ops.push({ change: v.pick ? 'item_identify' : 'item_update', itemId: it.id, patch, old, line: `${label}: ${lines.join(', ')}` });
        }
        return { ops, why: whys[0] || '' };
    }

    // ---------- per-card UI ----------
    function renderPick(c) {
        const sel = fEl(c, 'pick'); if (!sel) return;
        const v = valsOf(c);
        const cur = sel.value;
        const list = v.st.state === 'ok' ? (v.type === 'Single' ? refs.greens.filter(g => g.code === v.code).map(g => ({ v: 'single:' + g.id, l: g.name }))
            : refs.recipes.filter(r => r.code === v.code).map(r => ({ v: 'recipe:' + r.id, l: r.name }))) : [];
        sel.innerHTML = `<option value="">${rtT('ret_ed_keep_unknown', '— keep Unknown —')}</option>` + list.map(o => `<option value="${o.v}"${o.v === cur ? ' selected' : ''}>${rtEsc(o.l)} (code ${rtEsc(v.code)})</option>`).join('');
    }
    function renderNote(c) {
        const box = fEl(c, 'note'); if (!box) return;
        if (c.removed) { box.innerHTML = ''; return; }
        const v = valsOf(c);
        if (v.st.state === 'missing' || v.st.state === 'no_members') { box.innerHTML = `<div class="ret-hint ret-err">${rtEsc(rtT('ret_code_bad', 'Code {code} can\'t be used — it must be registered in Code Definitions with a coffee under it.').replace('{code}', v.st.code))}</div>`; return; }
        if (v.st.state === 'ambiguous') { box.innerHTML = `<div class="ret-hint ret-err">${rtEsc(rtT('ret_code_ambiguous', 'Code {code} is both Single and Blend — pick it from the list.').replace('{code}', v.st.code))}</div>`; return; }
        const parts = [];
        if (c.isNew && c.sticker) parts.push(`<div class="ret-found">✓ ${rtEsc(c.sticker.name)} · ${c.sticker.type} · lot <code>${rtEsc(c.sticker.lot.lot_code)}</code></div>`);
        else if (c.resolved && c.resolved.loading) parts.push(`<div class="ret-hint">${rtT('ret_resolving', 'Looking it up in the roast log…')}</div>`);
        else if (c.resolved && !v.pick) {
            const kindWord = v.type === 'Blend' ? rtT('ret_word_recipe', 'Recipe') : rtT('ret_word_origin', 'Origin');
            if (c.resolved.hit) parts.push(`<div class="ret-found">✓ ${kindWord}: <b>${rtEsc(c.resolved.hit.name)}</b> — ${rtEsc(rtT('ret_found_log', 'found in the roast log ({n} batches that day)').replace('{n}', c.resolved.hit.batches))}</div>`);
            else parts.push(`<div class="ret-unknown"><b>${kindWord}: Unknown</b> — ${rtEsc(c.resolved.list.length ? rtT('ret_unknown_many', 'roasted under this code that day: {list}. Saved as Unknown; Tracking lists them.').replace('{list}', c.resolved.list.map(x => x.name).join(', ')) : rtT('ret_unknown_none', 'nothing roasted under this code on this machine that day. Check the date, or save as Unknown.'))}</div>`);
        }
        if (!c.isNew && c.status === 'partial' && v.st.state === 'ok' && (v.sealed > 0 || v.opened > 0) && (!sameDetails(v, c.it) || v.size !== parseInt(c.it.bag_size_g)) && !(c.resolved && c.resolved.loading)) {
            const id = identityOf(c, v);
            const whole = c.it.coffee_kind === 'unknown' && id.coffee_kind !== 'unknown' && v.size === parseInt(c.it.bag_size_g);
            parts.push(`<div class="ret-ed-note ${whole ? 'ret-ed-note-ok' : 'ret-ed-note-split'}">${rtEsc(whole
                ? rtT('ret_ed_note_whole', 'This item was Unknown, so the new details also go on the part already processed — in the return record and Tracking only. No stock moves, no split.')
                : rtT('ret_ed_note_split', 'The remaining becomes its own item with these details. The part already processed keeps the details it was moved with.'))}</div>`);
        }
        box.innerHTML = parts.join('');
    }
    function markChanged(c) {
        const pick = fEl(c, 'pick'); if (pick) pick.classList.toggle('ret-changed', !!pick.value);
        if (c.isNew || c.status === 'done') return;
        const it = c.it;
        const orig = { code: codeLabel(it.coffee_code, it.coffee_type), machine: String(it.machine_id || ''), roast: it.roast_date || '', size: String(parseInt(it.bag_size_g) || ''), sealed: String(c.rem.sealed), opened: String(c.rem.opened) };
        Object.keys(orig).forEach(k => {
            const el = fEl(c, k); if (!el) return;
            let now = el.value;
            if (k === 'code') { const st = resolveSalesCodeInput(now, codeOpts, refs.codeDefinitions); now = st.state === 'ok' ? codeLabel(st.code, st.type) : now; }
            if (k === 'sealed' || k === 'opened') now = now === '' ? '0' : String(Number(now));
            el.classList.toggle('ret-changed', now !== orig[k]);
        });
    }
    async function resolveCard(c) {
        const v = valsOf(c);
        const seq = ++c.seq;
        if (c.isNew && c.sticker) { c.resolved = null; refreshCard(c); return; }
        if (v.st.state !== 'ok' || !v.machine || !v.roast || (!c.isNew && sameDetails(v, c.it))) { c.resolved = null; refreshCard(c); return; }
        c.resolved = { loading: true }; refreshCard(c);
        let res;
        try { const list = await rtRoastLog(v.code, v.type, v.machine, v.roast, refs); res = { list, hit: list.length === 1 ? list[0] : null }; }
        catch (e) { console.warn('roast log lookup failed', e); res = { list: [], hit: null }; }
        if (seq !== c.seq) return;
        c.resolved = res; refreshCard(c);
    }
    function refreshCard(c) {
        const el = cardEl(c); if (!el) return;
        el.classList.toggle('ret-ed-is-removed', !!c.removed);
        const rn = fEl(c, 'removednote'), content = fEl(c, 'content');
        if (rn) {
            rn.classList.toggle('hidden', !c.removed);
            rn.textContent = c.removed ? (c.status === 'partial'
                ? rtT('ret_ed_removed_remaining', 'The remaining {q} will be removed; the processed part stays. Click Undo to keep it.').replace('{q}', rtQtyText(c.rem.sealed, c.rem.opened, c.it.bag_size_g))
                : rtT('ret_ed_removed_item', 'This item will be removed. Click Undo to keep it.')) : '';
        }
        if (content) content.classList.toggle('hidden', !!c.removed);
        const rmBtn = el.querySelector(`[data-rm="${c.key}"]`);
        if (rmBtn && !c.isNew) rmBtn.textContent = c.removed ? rtT('ret_ed_undo', 'Undo') : (c.status === 'partial' ? rtT('ret_ed_remove_remaining', 'Remove remaining') : rtT('ret_remove', 'Remove'));
        renderPick(c); markChanged(c); renderNote(c); refreshFoot();
    }
    function refreshFoot() {
        const { ops, why } = plan();
        $('re-count').textContent = ops.length ? rtT('ret_ed_n_changes', '{n} change(s)').replace('{n}', ops.length) : rtT('ret_ed_no_changes', 'No changes yet');
        $('re-why').textContent = why;
        $('re-save').disabled = !!why || !ops.length;
    }
    async function scanCard(c) {
        const v = fVal(c, 'strip').trim(); if (!v) return;
        const hint = fEl(c, 'striphint');
        hint.className = 'ret-hint'; hint.textContent = rtT('ret_strip_looking', 'Looking up…');
        let res;
        try { res = await rtResolveSticker(v, refs); } catch (e) { res = { error: e.message || String(e) }; }
        if (res.error) { c.sticker = null; hint.className = 'ret-hint ret-err'; hint.textContent = res.error; refreshCard(c); return; }
        c.sticker = res;
        fEl(c, 'code').value = codeLabel(res.code, res.type);
        fEl(c, 'machine').value = res.machineId || ''; fEl(c, 'roast').value = res.roastDate || ''; fEl(c, 'size').value = res.size || '';
        hint.className = 'ret-hint ret-ok'; hint.textContent = rtT('ret_strip_found', 'Lot found — enter the quantity, then Add to list.');
        c.resolved = null; refreshCard(c);
        fEl(c, 'sealed').focus();
    }

    // ---------- events ----------
    const box = $('re-cards');
    const cardOf = el => { const k = el.closest('[data-card]'); return k ? cards.find(c => c.key === k.dataset.card) : null; };
    box.addEventListener('input', e => {
        const c = cardOf(e.target); if (!c) return;
        const f = e.target.dataset.f;
        if (f === 'strip') return;
        if (c.isNew && c.sticker && ['code', 'machine', 'roast', 'size'].includes(f)) { c.sticker = null; const h = fEl(c, 'striphint'); h.className = 'ret-hint'; h.textContent = rtT('ret_ed_strip_hint', 'Scan a sticker, or fill in the fields below by hand.'); }
        if (['code', 'machine', 'roast'].includes(f)) resolveCard(c); else refreshCard(c);
    });
    box.addEventListener('change', e => {
        const c = cardOf(e.target); if (!c) return;
        if (e.target.dataset.f === 'strip') { scanCard(c); return; }
        if (['machine', 'size', 'pick'].includes(e.target.dataset.f)) refreshCard(c);
    });
    box.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.target.dataset.f !== 'strip') return;
        e.preventDefault(); const c = cardOf(e.target); if (c) scanCard(c);
    });
    box.addEventListener('click', e => {
        const b = e.target.closest('[data-rm]'); if (!b) return;
        const c = cards.find(x => x.key === b.dataset.rm); if (!c) return;
        if (c.isNew) { c.gone = true; cardEl(c).remove(); refreshFoot(); return; }
        c.removed = !c.removed; refreshCard(c);
    });
    $('re-add').addEventListener('click', () => {
        const c = { key: 'n' + (++addSeq), isNew: true, sticker: null, resolved: null, seq: 0, status: 'need' };
        cards.push(c);
        box.insertAdjacentHTML('beforeend', newCardHtml(c));
        refreshCard(c);
        fEl(c, 'strip').focus();
    });
    $('re-origin-seg').addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        origin = b.dataset.o;
        $('re-origin-seg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        $('re-cust').classList.toggle('hidden', origin !== 'cust'); $('re-other').classList.toggle('hidden', origin !== 'other');
        refreshFoot();
    });
    ['re-date', 're-cust', 're-other', 're-reason', 're-notes'].forEach(i => { $(i).addEventListener('input', refreshFoot); $(i).addEventListener('change', refreshFoot); });
    cards.forEach(refreshCard);
    $('re-save').addEventListener('click', () => {
        const { ops, why } = plan();
        if (why || !ops.length) return;
        const ov = document.createElement('div');
        ov.className = 'overlay'; ov.style.zIndex = '2000';
        ov.innerHTML = `<div class="overlay-card" role="dialog" aria-modal="true" style="max-width:600px; gap:10px; text-align:center;">
            <div class="ret-q">?</div>
            <h3 style="margin:0;">${rtT('ret_ed_q', 'Save these changes?')}</h3>
            <ul class="ret-result" style="text-align:left;">${ops.map(o => `<li>${o.line}</li>`).join('')}</ul>
            <div class="ret-hint">${rtT('ret_ed_no_stock', 'No stock moves. Bags already processed stay where they are.')}</div>
            <div class="ret-hint">${rtT('ret_nothing_saved', 'Nothing is saved until you press Proceed.')}</div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:6px;">
                <button type="button" class="btn btn-secondary" data-f="cancel">${rtT('btn_cancel', 'Cancel')}</button>
                <button type="button" class="btn btn-primary" data-f="go">${rtT('ret_btn_proceed', 'Proceed')}</button>
            </div></div>`;
        document.body.appendChild(ov);
        ov.querySelector('[data-f="go"]').focus();
        ov.querySelector('[data-f="cancel"]').onclick = () => ov.remove();
        ov.querySelector('[data-f="go"]').onclick = async () => { ov.remove(); await saveEdits(ops); };
    });

    // ---------- save: all-or-nothing, verified, logged ----------
    let saving = false;
    async function saveEdits(ops) {
        if (saving) return;
        saving = true;
        const lock = lockProcessingScreen(rtT('ret_ed_saving', 'Saving changes…'));
        const undo = [];
        let failure = null, partial = null;
        const sb = rtSb(), who = rtUser();
        try {
            // Nothing may have moved since the modal opened.
            const fresh = await rtQ(sb.from('stock_return_items').select('id, sealed_pcs, opened_kg, stock_return_actions(id)').eq('return_id', ret.id));
            for (const it of items) {
                const f = fresh.find(x => x.id === it.id);
                const n = actions.filter(a => a.return_item_id === it.id).length;
                if (!f || (f.stock_return_actions || []).length !== n || f.sealed_pcs !== it.sealed_pcs || Math.abs(+f.opened_kg - +it.opened_kg) > 0.0005)
                    throw new Error(rtT('ret_err_changed', 'This item changed meanwhile — reopen it and try again.'));
            }
            const logs = [];
            const added = [];
            for (const op of ops) {
                if (op.change === 'header') {
                    const { error } = await sb.from('stock_returns').update(op.patch).eq('id', ret.id);
                    if (error) throw error;
                    undo.push(async () => { await sb.from('stock_returns').update(op.old).eq('id', ret.id); });
                    logs.push({ return_item_id: null, change: 'header', details: Object.fromEntries(Object.keys(op.patch).map(k => [k, [op.old[k], op.patch[k]]])) });
                    continue;
                }
                if (op.change === 'item_remove') {
                    const { error } = await sb.from('stock_return_items').delete().eq('id', op.itemId);
                    if (error) throw error;
                    undo.push(async () => { await sb.from('stock_return_items').insert(op.old); });
                    logs.push({ return_item_id: op.itemId, change: 'item_remove', details: { row: op.old } });
                    continue;
                }
                if (op.patch && Object.keys(op.patch).length) {
                    const { error } = await sb.from('stock_return_items').update(op.patch).eq('id', op.itemId);
                    if (error) throw error;
                    undo.push(async () => { await sb.from('stock_return_items').update(op.old).eq('id', op.itemId); });
                    logs.push({ return_item_id: op.itemId, change: op.change, details: Object.fromEntries(Object.keys(op.patch).map(k => [k, [op.old[k], op.patch[k]]])) });
                }
                if (op.row) {
                    const { data, error } = await sb.from('stock_return_items').insert(op.row).select().single();
                    if (error) throw error;
                    undo.push(async () => { await sb.from('stock_return_items').delete().eq('id', data.id); });
                    added.push({ op, id: data.id });
                    logs.push({ return_item_id: data.id, change: op.change === 'item_split' ? 'item_split' : 'item_add', details: { row: op.row, split_from: op.change === 'item_split' ? op.itemId : null } });
                }
            }
            const logRows = logs.map(l => Object.assign({ return_id: ret.id, return_number: ret.return_number, edited_by: who }, l));
            const { data: logged, error: logErr } = await sb.from('stock_return_edits').insert(logRows).select('id');
            if (logErr) throw logErr;
            undo.push(async () => { await sb.from('stock_return_edits').delete().in('id', logged.map(x => x.id)); });

            // Read back every write.
            const [hd, now] = await Promise.all([
                rtQ(sb.from('stock_returns').select('*').eq('id', ret.id)),
                rtQ(sb.from('stock_return_items').select('*').eq('return_id', ret.id))
            ]);
            const eq = (a, b) => (typeof b === 'number' ? Math.abs((+a || 0) - b) < 0.0005 && a !== null : JSON.stringify(a == null ? null : a) === JSON.stringify(b));
            const bad = ops.some(op => {
                if (op.change === 'header') return !hd[0] || Object.keys(op.patch).some(k => !eq(hd[0][k], op.patch[k]));
                if (op.change === 'item_remove') return now.some(i => i.id === op.itemId);
                if (op.patch && Object.keys(op.patch).length) { const r = now.find(i => i.id === op.itemId); if (!r || Object.keys(op.patch).some(k => !eq(r[k], op.patch[k]))) return true; }
                if (op.row) { const a = added.find(x => x.op === op); if (!a || !now.some(i => i.id === a.id)) return true; }
                return false;
            });
            if (bad || logged.length !== logRows.length) throw new Error(rtT('ret_ed_verify_failed', 'The changes could not be verified after saving.'));
        } catch (e) {
            console.error('Edit return failed:', e);
            const left = await rtRollback(undo);
            if (left.length) partial = [e.message || String(e), ...left].join('\n'); else failure = e.message || String(e);
        } finally {
            lock.release();
            saving = false;
        }
        if (failure) { await showStockFailed(failure); return; }
        if (partial) { await showStockPartial(partial); return; }
        const closeBtn = document.getElementById('btn-close-modal'); if (closeBtn) closeBtn.click();
        loadReturnsSection();
        await rtShowDone({ title: rtT('ret_ed_done', 'Return updated'), sub: `${ret.return_number} · ${rtT('ret_ed_n_changes', '{n} change(s)').replace('{n}', ops.length)}`, results: ops.map(o => o.line), printSets: [], refs });
    }
}

// ============================================================================
// Action on one item (floating stock → inventory / bulk / waste)
// ============================================================================
async function openReturnActionModal(itemId) {
    if (!hasPermission('returns_manage')) return;
    let refs, item, ret, actions, origin;
    try {
        let rows;
        [refs, rows, actions] = await Promise.all([
            rtLoadRefs(),
            rtQ(rtSb().from('stock_return_items').select('*, stock_returns(*)').eq('id', itemId)),
            rtQ(rtSb().from('stock_return_actions').select('*').eq('return_item_id', itemId))
        ]);
        if (!rows[0] || !rows[0].stock_returns) throw new Error(rtT('ret_err_changed', 'This item changed meanwhile — reopen it and try again.'));
        ({ stock_returns: ret, ...item } = rows[0]);
        origin = ret.customer_id ? ((refs.customers.find(c => c.id === ret.customer_id) || {}).name || '-') : (ret.origin_text || '-');
    } catch (e) { await showStockFailed(e.message || String(e)); return; }
    const rem = rtRemaining(item, actions);
    const mName = id => (refs.machines.find(m => m.id === id) || {}).name || '-';
    const today = rtToday();
    const html = `
        <div class="ret-meta">
            <div><span>${rtT('ret_col_return', 'Return')}</span><b><code>${rtEsc(ret.return_number)}</code></b></div>
            <div><span>${rtT('ret_lbl_origin', 'Origin')}</span><b>${rtEsc(origin)}</b></div>
            <div><span>${rtT('ret_col_coffee', 'Coffee')}</span><b>${rtEsc(rtCoffeeLabel(item))}</b></div>
            <div><span>${rtT('ret_lbl_package', 'Package')}</span><b>${rtSize(item.bag_size_g)} · ${rtEsc(mName(item.machine_id))}</b></div>
            <div><span>${rtT('ret_lbl_roast', 'Roast Date')}</span><b>${rtEsc(item.roast_date)}</b></div>
            <div><span>${rtT('ret_col_remaining', 'Remaining')}</span><b>${rtEsc(rtQtyText(rem.sealed, rem.opened, item.bag_size_g))}</b></div>
        </div>
        <div style="display:flex; gap:10px; align-items:center; margin:12px 0;" id="ra-part-row">
            <span class="ret-hint" style="font-weight:600;">${rtT('ret_process', 'Process:')}</span>
            <div class="ret-seg" id="ra-part"><button type="button" data-p="sealed" ${rem.sealed > 0 ? '' : 'disabled'}>${rtT('ret_lbl_sealed', 'Sealed packs')}</button><button type="button" data-p="opened" ${rem.opened > 0 ? '' : 'disabled'}>${rtT('ret_lbl_opened', 'Opened coffee (kg)')}</button></div>
        </div>
        <div class="ret-opts" id="ra-acts">
            <button type="button" class="ret-opt" data-a="inventory"><b>${rtT('ret_act_add_inv', 'Add to Inventory')}</b><span>${rtT('ret_act_add_inv_hint', 'Sealed bags go back on sale')}</span></button>
            <button type="button" class="ret-opt" data-a="bulk"><b>${rtT('ret_act_add_bulk', 'Add to Bulk')}</b><span>${rtT('ret_act_add_bulk_hint', 'Open bags → new bulk card')}</span></button>
            <button type="button" class="ret-opt" data-a="waste"><b>${rtT('ret_act_waste_title', 'Discard to Waste')}</b><span>${rtT('ret_act_waste_hint', 'Not usable — write off')}</span></button>
        </div>
        <div id="ra-form" class="hidden" style="display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px; margin-top:12px;">
            <div class="form-group" style="margin-bottom:0;"><label class="form-label" id="ra-qty-label"></label><input type="number" id="ra-qty" class="form-control" min="0"><div class="ret-hint" id="ra-qty-hint"></div></div>
            <div class="form-group hidden" id="ra-reason-wrap" style="margin-bottom:0;"><label class="form-label">${rtT('ret_waste_reason', 'Waste Reason')} <span class="ret-req">*</span></label><input type="text" id="ra-reason" class="form-control" placeholder="${rtEsc(rtT('ret_ph_waste', 'e.g. Stale, bag contaminated'))}"></div>
            <div class="form-group hidden" id="ra-date-wrap" style="margin-bottom:0;"><label class="form-label" id="ra-date-label"></label>
                <select id="ra-date-mode" class="form-control"><option value="orig">${rtEsc(rtT('ret_orig_date', 'Original roast date — {d}').replace('{d}', item.roast_date))}</option><option value="custom">${rtT('ret_change_date', 'Change date…')}</option></select>
                <input type="date" id="ra-date" class="form-control hidden" max="${today}" style="margin-top:6px;"><div class="ret-hint" id="ra-date-hint"></div></div>
            <div class="form-group hidden" id="ra-label-wrap" style="margin-bottom:0;"><label class="form-label">${rtT('ret_labels', 'Labels:')}</label>
                <div class="ret-seg" id="ra-label"><button type="button" data-m="old" class="active">${rtT('ret_label_old', 'Use old labels')}</button><button type="button" data-m="new">${rtT('ret_label_new', 'Print new labels')}</button></div></div>
            <div id="ra-dest" class="ret-dest" style="grid-column:1/-1;"></div>
        </div>
        <div style="display:flex; justify-content:flex-end; align-items:center; gap:12px; border-top:1px solid var(--border); padding-top:12px; margin-top:12px;">
            <span class="ret-why" id="ra-why" style="flex:1; text-align:right;"></span>
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">${rtT('btn_cancel', 'Cancel')}</button>
            <button type="button" id="ra-go" class="btn btn-primary" disabled>${rtT('ret_btn_continue', 'Continue')}</button>
        </div>`;
    openModal(rtT('ret_title_action', 'Return Action'), html, '760px');
    const $ = id => document.getElementById(id);
    let part = rem.sealed > 0 ? 'sealed' : 'opened', act = null, labelMode = 'old', destSeq = 0, dest = null;
    $('ra-part-row').classList.toggle('hidden', !(rem.sealed > 0 && rem.opened > 0));
    function setPart(p) {
        part = p; act = null; dest = null;
        $('ra-part').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.p === p));
        $('ra-acts').querySelectorAll('[data-a]').forEach(b => { b.classList.remove('active'); b.disabled = (p === 'opened' && b.dataset.a === 'inventory'); });
        $('ra-form').classList.add('hidden');
        $('ra-qty-label').textContent = p === 'opened' ? rtT('ret_lbl_opened', 'Opened coffee (kg)') : rtT('ret_lbl_sealed', 'Sealed packs');
        $('ra-qty').step = p === 'opened' ? '0.01' : '1';
        $('ra-qty').value = p === 'opened' ? rem.opened : rem.sealed;
        validate();
    }
    const chosenDate = () => $('ra-date-mode').value === 'custom' ? $('ra-date').value : item.roast_date;
    async function refreshDest() {
        const box = $('ra-dest');
        const q = parseFloat($('ra-qty').value) || 0;
        const kg = part === 'opened' ? q : q * item.bag_size_g / 1000;
        if (act === 'inventory') {
            const seq = ++destSeq; dest = null; box.innerHTML = `<span class="ret-hint">${rtT('ret_checking_lots', 'Checking lots…')}</span>`; validate();
            let t; try { t = await rtInventoryTarget(item, chosenDate()); } catch (e) { t = { kind: 'new' }; }
            if (seq !== destSeq) return;
            dest = t;
            box.innerHTML = t.kind === 'scanned' ? `<b>${rtT('ret_goes_back', 'Back to lot')} <code>${rtEsc(t.lot.lot_code)}</code> (strip ${rtEsc(t.lot.strip_code || '-')})</b><span>${labelMode === 'new' ? rtT('ret_reprint_same', 'reprinted with the same strip') : rtT('ret_old_valid', 'old label still valid')}</span>`
                : t.kind === 'merge' ? `<b>${rtT('ret_goes_lot', 'Lot')} <code>${rtEsc(t.lot.lot_code)}</code> (strip ${rtEsc(t.lot.strip_code || '-')})</b><span>${rtT('ret_same_lot', 'same coffee, machine, roast date')} · ${rtEsc(rtT('ret_print_n', 'print {n} labels').replace('{n}', q))}</span>`
                : `<b>${rtT('ret_goes_new', 'New lot')}</b><span>${rtT('ret_new_strip', 'new strip code')} · ${rtEsc(rtT('ret_print_n', 'print {n} labels').replace('{n}', q))}</span>`;
        } else if (act === 'bulk') {
            box.innerHTML = `<b>${rtT('ret_new_bulk', 'New bulk card')} · ${rtEsc(rtCoffeeLabel(item))} · ${kg.toFixed(2)} kg</b><span>${rtEsc(mName(item.machine_id))} · roast ${rtEsc(chosenDate() || '-')} · RETURN</span>`;
        } else if (act === 'waste') {
            box.innerHTML = `<b>${rtT('ret_act_waste', 'Waste')} · ${kg.toFixed(2)} kg</b><span>${rtEsc(rtT('ret_waste_source', 'Recorded in the Waste tab with source "Return · {n}".').replace('{n}', ret.return_number))}</span>`;
        } else box.innerHTML = '';
        validate();
    }
    function validate() {
        const max = part === 'opened' ? rem.opened : rem.sealed;
        const q = parseFloat($('ra-qty').value) || 0;
        const ok = q > 0 && q <= max + 1e-9 && (part === 'opened' || Number.isInteger(q));
        $('ra-qty-hint').textContent = q > max + 1e-9 ? rtT('ret_only_left', 'Only {n} remaining.').replace('{n}', part === 'opened' ? `${max.toFixed(2)} kg` : max) : `${(part === 'opened' ? q : q * item.bag_size_g / 1000).toFixed(2)} kg`;
        const d = chosenDate();
        let why = '';
        if (!act) why = rtT('ret_why_action', 'Choose an action.');
        else if (!ok) why = rtT('ret_why_qty_bad', 'Check the quantities.');
        else if (act === 'waste' && !$('ra-reason').value.trim()) why = rtT('ret_why_waste_reason', 'Enter the waste reason.');
        else if ((act === 'bulk' || (act === 'inventory' && labelMode === 'new')) && (!d || d > today)) why = rtT('ret_why_future', 'A roast date can\'t be empty or in the future.');
        else if (act === 'inventory' && !dest) why = rtT('ret_checking_lots', 'Checking lots…');
        $('ra-why').textContent = why;
        $('ra-go').disabled = !!why;
        $('ra-go').className = act === 'waste' ? 'btn btn-danger' : 'btn btn-primary';
        $('ra-go').textContent = act === 'waste' ? rtT('ret_btn_discard', 'Discard') : rtT('ret_btn_continue', 'Continue');
    }
    $('ra-part').onclick = (e) => { const b = e.target.closest('button'); if (b && !b.disabled) setPart(b.dataset.p); };
    $('ra-acts').onclick = (e) => {
        const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
        act = b.dataset.a; dest = null;
        $('ra-acts').querySelectorAll('[data-a]').forEach(x => x.classList.toggle('active', x === b));
        $('ra-form').classList.remove('hidden');
        $('ra-reason-wrap').classList.toggle('hidden', act !== 'waste');
        $('ra-label-wrap').classList.toggle('hidden', act !== 'inventory');
        $('ra-date-wrap').classList.toggle('hidden', !(act === 'bulk' || (act === 'inventory' && labelMode === 'new')));
        $('ra-date-label').textContent = act === 'bulk' ? rtT('ret_card_roast', 'Bulk Card Roast Date') : rtT('ret_label_roast', 'Roast date on the new labels');
        refreshDest();
    };
    $('ra-label').onclick = (e) => {
        const b = e.target.closest('[data-m]'); if (!b) return;
        labelMode = b.dataset.m;
        $('ra-label').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        $('ra-date-wrap').classList.toggle('hidden', labelMode !== 'new');
        if (labelMode === 'old') { $('ra-date-mode').value = 'orig'; $('ra-date').classList.add('hidden'); }
        refreshDest();
    };
    $('ra-date-mode').onchange = () => { $('ra-date').classList.toggle('hidden', $('ra-date-mode').value !== 'custom'); refreshDest(); };
    $('ra-date').onchange = refreshDest;
    $('ra-qty').oninput = refreshDest;
    $('ra-reason').oninput = validate;
    setPart(part);

    let busy = false;
    $('ra-go').onclick = async () => {
        if (busy) return;
        if (!(await ensureNoStockOpname())) return;
        busy = true;
        const q = parseFloat($('ra-qty').value);
        const kg = +(part === 'opened' ? q : q * item.bag_size_g / 1000).toFixed(3);
        const lock = lockProcessingScreen(act === 'inventory' ? rtT('ret_sending_inv', 'Adding to inventory…') : act === 'bulk' ? rtT('ret_sending_bulk', 'Creating bulk cards…') : rtT('ret_sending_waste', 'Moving to waste…'));
        const undo = [];
        let failure = null, partial = null, result = '', printSets = [];
        try {
            // fresh remaining — another user may have acted on this item meanwhile
            const freshActs = await rtQ(rtSb().from('stock_return_actions').select('*').eq('return_item_id', item.id));
            const r2 = rtRemaining(item, freshActs);
            if ((part === 'sealed' ? r2.sealed : r2.opened) + 1e-9 < q) throw new Error(rtT('ret_err_changed', 'This item changed meanwhile — reopen it and try again.'));
            if (act === 'inventory') {
                const d = labelMode === 'new' ? chosenDate() : item.roast_date;
                const r = await rtSendInventory(item, ret, q, d, labelMode, refs, undo);
                if (r.labels) printSets.push({ lot: r.lot, item, date: d, qty: r.labels });
                result = `${q} × ${rtSize(item.bag_size_g)} → strip ${r.lot.strip_code || r.lot.lot_code}`;
            } else if (act === 'bulk') {
                const b = await rtSendBulk(ret, [{ item, part, qty: part === 'sealed' ? q : 0, kg }], chosenDate(), refs, undo);
                result = `${kg.toFixed(2)} kg → ${rtT('ret_new_bulk', 'New bulk card')} (${b.coffee_name})`;
            } else {
                await rtSendWaste(ret, origin, item, part, q, kg, $('ra-reason').value.trim(), undo);
                result = `${kg.toFixed(2)} kg → ${rtT('ret_act_waste', 'Waste')}`;
            }
            const check = await rtQ(rtSb().from('stock_return_actions').select('id').eq('return_item_id', item.id));
            if (check.length !== freshActs.length + 1) throw new Error('saved action could not be verified');
        } catch (e) {
            console.error('Return action failed:', e);
            const left = await rtRollback(undo);
            if (left.length) partial = [e.message || String(e), ...left].join('\n'); else failure = e.message || String(e);
        } finally { lock.release(); busy = false; }
        if (failure) { await showStockFailed(failure); return; }
        if (partial) { await showStockPartial(partial); return; }
        const closeBtn = document.getElementById('btn-close-modal'); if (closeBtn) closeBtn.click();
        loadReturnsSection();
        if (typeof scheduleDashboardRefresh === 'function') scheduleDashboardRefresh();
        await rtShowDone({ title: act === 'inventory' ? rtT('ret_done_inv', 'Sent to inventory') : act === 'bulk' ? rtT('ret_done_bulk', 'Sent to bulk') : rtT('ret_done_waste', 'Moved to waste'), sub: `${ret.return_number} · ${rtCoffeeLabel(item)}`, results: [rtEsc(result)], printSets, refs });
    };
}

// ============================================================================
// Tracking (js/tracking.js performTrackingSearch calls this)
// ============================================================================
async function renderReturnTracking({ lot, bulk, packedLots }) {
    const box = document.getElementById('tracking-result-returns');
    if (!box) return;
    box.innerHTML = ''; box.classList.add('hidden');
    try {
        const lotIds = (packedLots || []).map(l => l.id);
        const queries = [];
        if (bulk && bulk.is_return) queries.push(rtQ(rtSb().from('stock_return_actions').select('*').eq('target_bulk_id', bulk.id)));
        if (lotIds.length) queries.push(rtQ(rtSb().from('stock_return_actions').select('*').in('target_packed_lot_id', lotIds)));
        if (!queries.length) return;
        const acts = (await Promise.all(queries)).flat();
        if (!acts.length) return;
        const items = await rtQ(rtSb().from('stock_return_items').select('*').in('id', [...new Set(acts.map(a => a.return_item_id))]));
        const rets = await rtQ(rtSb().from('stock_returns').select('*').in('id', [...new Set(items.map(i => i.return_id))]));
        const custIds = [...new Set(rets.map(r => r.customer_id).filter(Boolean))];
        const custs = custIds.length ? await rtQ(rtSb().from('customers').select('id, name').in('id', custIds)) : [];
        const rows = acts.map(a => {
            const it = items.find(i => i.id === a.return_item_id) || {};
            const r = rets.find(x => x.id === it.return_id) || {};
            const origin = r.customer_id ? ((custs.find(c => c.id === r.customer_id) || {}).name || '-') : (r.origin_text || '-');
            const qty = a.part === 'sealed' ? `${a.qty_pcs} × ${rtSize(it.bag_size_g)}` : `${(+a.kg).toFixed(2)} kg ${rtT('ret_opened_short', 'opened')}`;
            const where = a.action === 'bulk' ? rtT('ret_trk_into_card', 'opened into this bulk card') : rtT('ret_trk_into_lot', 'put back into this lot');
            const changed = a.roast_date_used && a.roast_date_used !== it.roast_date
                ? `<br>${rtEsc(rtT('ret_trk_date_changed', 'Roast date changed from {a} to {b}').replace('{a}', it.roast_date).replace('{b}', a.roast_date_used))}` : '';
            const cands = it.coffee_kind === 'unknown' && Array.isArray(it.candidates) && it.candidates.length
                ? `<br>${rtEsc(rtT('ret_trk_candidates', 'Roasted under code {code} that day: {list}').replace('{code}', it.coffee_code).replace('{list}', it.candidates.map(c => `${c.name} (${c.batches})`).join(', ')))}` : '';
            return `<li style="margin-bottom:10px; padding-left:12px; border-left:2px solid var(--border-color);">
                <div style="font-weight:600;"><code>${rtEsc(r.return_number || '-')}</code> · ${rtEsc(origin)} <span style="font-weight:400; color:var(--text-muted);">— ${rtEsc(qty)}, ${rtEsc(where)}</span></div>
                <div style="font-size:0.8rem; color:var(--text-muted); line-height:1.5;">${rtEsc(rtCoffeeLabel(it))} · ${rtEsc(rtT('ret_trk_returned_on', 'returned {d}').replace('{d}', r.return_date || '-'))} · ${rtEsc(rtT('ret_trk_roast', 'original roast {d}').replace('{d}', it.roast_date || '-'))}${r.reason ? ' · ' + rtEsc(r.reason) : ''}${changed}${cands}</div>
            </li>`;
        }).join('');
        box.innerHTML = `<div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border-color);">
            <div style="font-weight:700; margin-bottom:8px;">${rtT('ret_trk_title', 'Returns')}</div>
            <ul style="list-style:none; margin:0; padding:0;">${rows}</ul></div>`;
        box.classList.remove('hidden');
    } catch (e) { console.warn('return tracking unavailable:', e.message || e); }
}
