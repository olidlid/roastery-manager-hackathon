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

// CUSTOMER_CATEGORY_ROLE_PLAN.md: single source of truth for the 3 customer
// categories — icon, badge colors, and customer_id prefix all keyed off
// CUSTOMER_TYPES, so every place that used to hardcode "Wholesale or
// Retail" (badge, dropdown optgroups, form select, ID prefix) reads from
// here instead. Adding a 4th category later means editing this one block,
// not hunting down every ternary across the file.
const CUSTOMER_TYPES = ['Wholesale', 'Retail', 'Supermarket'];
const CUSTOMER_TYPE_META = {
    Wholesale: { icon: '🏭', bg: 'var(--primary-light)', color: 'var(--primary)', prefix: 'WHL' },
    Retail: { icon: '☕', bg: '#fef3c7', color: '#92400e', prefix: 'RTL' },
    // Blue is unused by the other two (green-ish primary / amber) — kept
    // distinct on purpose, same reasoning this app already applies to its
    // coffee/bulk-card badge colors elsewhere.
    Supermarket: { icon: '🏬', bg: '#dbeafe', color: '#1e40af', prefix: 'SPM' }
};
const CUSTOMER_TYPE_BADGES = Object.fromEntries(CUSTOMER_TYPES.map(t => {
    const m = CUSTOMER_TYPE_META[t];
    return [t, `<span style="background:${m.bg}; color:${m.color}; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">${m.icon} ${t}</span>`];
}));

// Lightweight CRM layer: predicted-reorder badge + RFM-style segment tag,
// both computed client-side from request_orders/request_order_items via
// computeOrderStatsByKey (js/db.js) — no new tables/columns. "Value" is
// measured by volume (kg) + frequency (order count); there is no reliable
// price data in this schema to estimate Rupiah from.
const REORDER_BADGE_META = {
    overdue: { icon: '⏰', bg: '#fee2e2', color: '#991b1b', key: 'crm_badge_overdue', fallback: 'Overdue' },
    due_soon: { icon: '🔔', bg: '#fef9c3', color: '#854d0e', key: 'crm_badge_due_soon', fallback: 'Due Soon' }
};

// Icons kept only for VIP/At Risk/Dormant (the 3 segments worth visually
// flagging at a glance) — New/Regular/No Orders Yet are plain text, per
// CRM_INSIGHTS_PLAN.md mockup review.
const SEGMENT_BADGE_META = {
    new: { icon: '', bg: '#dcfce7', color: '#166534', key: 'crm_segment_new', fallback: 'New' },
    vip: { icon: '⭐', bg: '#fef3c7', color: '#92400e', key: 'crm_segment_vip', fallback: 'VIP' },
    regular: { icon: '', bg: 'var(--bg-hover)', color: 'var(--text-secondary)', key: 'crm_segment_regular', fallback: 'Regular' },
    at_risk: { icon: '⚠️', bg: '#ffedd5', color: '#9a3412', key: 'crm_segment_at_risk', fallback: 'At Risk' },
    dormant: { icon: '💤', bg: '#e5e7eb', color: '#374151', key: 'crm_segment_dormant', fallback: 'Dormant' },
    none: { icon: '', bg: '#e0e7ff', color: '#3730a3', key: 'crm_segment_none', fallback: 'No Orders Yet' }
};

function renderCrmBadge(meta) {
    if (!meta) return '';
    const label = window.t ? window.t(meta.key) : meta.fallback;
    return `<span style="background:${meta.bg}; color:${meta.color}; padding:1px 7px; border-radius:10px; font-size:0.68rem; font-weight:600; white-space:nowrap;">${meta.icon ? meta.icon + ' ' : ''}${label}</span>`;
}

// Overdue/Due Soon only makes sense once a customer has at least 2 historical
// orders to derive a cadence from — otherwise there's nothing to compare
// against, so this deliberately returns null (no badge) rather than guessing.
function getReorderBadge(stat) {
    if (!stat || stat.orderCount < 2 || !stat.avgIntervalDays) return null;
    const daysSince = daysBetween(stat.lastOrderDate, todayDateStr());
    const ratio = daysSince / stat.avgIntervalDays;
    if (ratio > 1.2) return REORDER_BADGE_META.overdue;
    if (ratio >= 0.8) return REORDER_BADGE_META.due_soon;
    return null;
}

function todayDateStr() {
    return new Date().toISOString().split('T')[0];
}

// Peer medians per customer type, used to make VIP/At-Risk relative to peers
// of the SAME type rather than a global threshold (Retail and Wholesale order
// at very different scales). Guards against a lone active customer trivially
// becoming "VIP": a type needs at least `minPeers` active customers in the
// window before VIP is computed for anyone in it.
function computePeerMedians(customers, statsByCustomerId, minPeers = 3) {
    const byType = {};
    (customers || []).forEach(c => {
        const stat = statsByCustomerId[c.id];
        if (!stat) return; // not active in this window
        if (!byType[c.type]) byType[c.type] = [];
        byType[c.type].push(stat);
    });
    const medians = {};
    Object.keys(byType).forEach(type => {
        const stats = byType[type];
        if (stats.length < minPeers) return; // leave undefined => VIP skipped for this type
        medians[type] = {
            medianFreq: median(stats.map(s => s.orderCount)),
            medianVol: median(stats.map(s => s.kg))
        };
    });
    return medians;
}

function getCustomerSegment(customer, allTimeStat, trailing90Stat, peerMediansTrailing90, peerMediansAllTime) {
    if (!allTimeStat) return SEGMENT_BADGE_META.none;

    const daysSinceLast = daysBetween(allTimeStat.lastOrderDate, todayDateStr());

    if (allTimeStat.orderCount === 1 && daysSinceLast <= 30) return SEGMENT_BADGE_META.new;

    const isDormant = daysSinceLast > 180 || (allTimeStat.avgIntervalDays && daysSinceLast > 2 * allTimeStat.avgIntervalDays);
    if (isDormant) return SEGMENT_BADGE_META.dormant;

    const trailingMedians = peerMediansTrailing90[customer.type];
    if (trailingMedians && trailing90Stat &&
        trailing90Stat.orderCount >= trailingMedians.medianFreq &&
        trailing90Stat.kg >= trailingMedians.medianVol) {
        return SEGMENT_BADGE_META.vip;
    }

    const allTimeMedians = peerMediansAllTime[customer.type];
    if (allTimeMedians && allTimeStat.orderCount > allTimeMedians.medianFreq &&
        getReorderBadge(allTimeStat) === REORDER_BADGE_META.overdue) {
        return SEGMENT_BADGE_META.at_risk;
    }

    return SEGMENT_BADGE_META.regular;
}

// Raw order/item data shared by the reorder badge, RFM segment tag, and the
// customer leaderboard (getCustomerOrdersRaw below) — cached at module scope
// so re-renders triggered by the search box's oninput (every keystroke)
// don't each re-fetch request_orders/request_order_items over the network
// (fetchData is uncached in live Supabase mode). Only the Customers section's
// navigation entry point forces a refresh; filtering/searching reuse it.
let _customerOrdersRawCache = null;

async function getCustomerOrdersRaw(forceRefresh) {
    if (_customerOrdersRawCache && !forceRefresh) return _customerOrdersRawCache;
    const [{ data: orders }, { data: items }] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items')
    ]);
    _customerOrdersRawCache = {
        orders: filterOrdersByCustomerCategory(filterOwnOrders(orders)),
        items: items || []
    };
    return _customerOrdersRawCache;
}

let _customerFilterType = 'all';

function filterCustomers(type) {
    _customerFilterType = type;
    document.querySelectorAll('.customer-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === type);
    });
    loadCustomersSection();
}

async function loadCustomersSection(filterType, opts = {}) {
    if (filterType) _customerFilterType = filterType;
    const { data: customers } = await fetchData('customers');
    const tbody = document.getElementById('customers-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // CUSTOMER_CATEGORY_ROLE_PLAN.md Fase 3 (Grup A): applied at the SOURCE,
    // before the existing type/search filters run — a role restricted to,
    // say, Retail must never see Wholesale/Supermarket rows leak through
    // regardless of which filter button is active or what's typed in search.
    const accessible = filterCustomersByAccess(customers);

    // opts.refreshStats is only passed true by the sec-customers navigation
    // entry point in app.js — search/filter re-renders reuse the cached
    // order/item fetch. Reorder-badge/RFM-segment computation used to live
    // here for inline row badges (see CRM_INSIGHTS_PLAN.md — rejected after a
    // live demo, moved to the dedicated CRM Insights tab's own loader).
    const ordersRaw = await getCustomerOrdersRaw(opts.refreshStats);

    // Customer leaderboard (Customers-section, segmented by the same
    // .customer-filter-btn type filter) reuses this same cached fetch.
    await loadCustomerLeaderboard(ordersRaw, accessible);

    // A filter button for a category this role can't access is hidden
    // entirely (not just ineffective) — re-run on every load since
    // permissions can change between page loads (role edited elsewhere).
    // If the button for the CURRENTLY selected filter just got hidden (role
    // changed under the user, or this is a fresh load past a stale
    // selection), fall back to 'all' rather than showing an empty table
    // with no visible way to explain why.
    const allowedSet = new Set(allowedCustomerTypes());
    let filterStillValid = _customerFilterType === 'all';
    document.querySelectorAll('.customer-filter-btn').forEach(btn => {
        const f = btn.getAttribute('data-filter');
        const visible = f === 'all' || allowedSet.has(f);
        btn.classList.toggle('hidden', !visible);
        if (f === _customerFilterType && visible) filterStillValid = true;
    });
    if (!filterStillValid) _customerFilterType = 'all';

    const searchVal = (document.getElementById('customer-search')?.value || '').toLowerCase();

    let filtered = accessible.filter(c => {
        if (_customerFilterType !== 'all' && c.type !== _customerFilterType) return false;
        if (searchVal && !c.name.toLowerCase().includes(searchVal) && !c.customer_id.toLowerCase().includes(searchVal)) return false;
        return true;
    });
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--text-muted); padding: 32px 0;">No customers found</td></tr>';
        return;
    }
    
    filtered.forEach(c => {
        // CUSTOMER_CATEGORY_ROLE_PLAN.md: Supermarket added as a third
        // badge color (blue) distinct from Wholesale's green and Retail's
        // amber, using the same lookup CUSTOMER_TYPE_BADGES that the order
        // tables' order_type badges also read, so the two never drift.
        const typeBadge = CUSTOMER_TYPE_BADGES[c.type] || CUSTOMER_TYPE_BADGES['Retail'];

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

// Customer Leaderboard (Customers section — segmented by the same
// .customer-filter-btn type filter above it, not a separate control) —
// ordersRaw/accessibleCustomers are passed by loadCustomersSection to reuse
// its already-fetched data; the period <select>'s own onchange calls this
// with no args, so it fetches (cache-backed) for itself.
function resolvePeriodBounds(preset) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    if (preset === 'all_time') return { startDate: null, endDate: null };
    if (preset === 'last_month') {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        return { startDate: start.toISOString().split('T')[0], endDate: end.toISOString().split('T')[0] };
    }
    if (preset === 'last_3_months') {
        const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
        return { startDate: start.toISOString().split('T')[0], endDate: todayStr };
    }
    const start = new Date(today.getFullYear(), today.getMonth(), 1); // this_month (default)
    return { startDate: start.toISOString().split('T')[0], endDate: todayStr };
}

async function loadCustomerLeaderboard(ordersRaw, accessibleCustomers) {
    const tbody = document.getElementById('customer-leaderboard-table-body');
    if (!tbody) return;

    if (!ordersRaw) ordersRaw = await getCustomerOrdersRaw();
    if (!accessibleCustomers) {
        const { data: customers } = await fetchData('customers');
        accessibleCustomers = filterCustomersByAccess(customers);
    }

    const preset = document.getElementById('cust-leaderboard-period')?.value || 'this_month';
    const { startDate, endDate } = resolvePeriodBounds(preset);

    const stats = computeOrderStatsByKey(ordersRaw.orders, ordersRaw.items, {
        groupByFn: o => o.customer_id || null,
        startDate, endDate
    });

    let rows = Object.keys(stats).map(customerId => {
        const customer = accessibleCustomers.find(c => c.id === parseInt(customerId));
        if (!customer) return null;
        const s = stats[customerId];
        return { name: customer.name, code: customer.customer_id, type: customer.type, orders: s.orderCount, bags: s.bags, kg: s.kg };
    }).filter(Boolean);

    if (_customerFilterType !== 'all') rows = rows.filter(r => r.type === _customerFilterType);
    rows.sort((a, b) => b.kg - a.kg);

    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:24px 0;">${window.t ? window.t('msg_no_orders') : 'No orders found.'}</td></tr>`;
        return;
    }
    rows.forEach((r, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center; font-weight:700;">${idx + 1}</td>
            <td><strong>${r.name}</strong></td>
            <td><code>${r.code}</code></td>
            <td class="text-center">${r.orders}</td>
            <td class="text-center">${r.bags}</td>
            <td style="text-align:center; font-weight:700;">${r.kg.toFixed(1)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ========== CRM INSIGHTS TAB (see CRM_INSIGHTS_PLAN.md) ==========
// Segment/type summary tiles double as an AND filter over one status table;
// row click opens a customer-detail modal (contact info, lifetime/MTD
// totals, purchase history). Permission-scoped exactly like the Directory
// tab: every row here already passed filterCustomersByAccess(), and a type
// tile for a category the current role can't access is never rendered
// (mirrors allowedCustomerTypes() hiding .customer-filter-btn above).

let _crmActiveSeg = 'all';
let _crmActiveType = 'all';
let _crmRows = []; // populated by loadCrmInsightsTab; read by renderCrmTable/openCrmCustomerModal

const CRM_SEGMENT_ORDER = ['all', 'vip', 'regular', 'at_risk', 'dormant', 'new', 'none'];

const CRM_SEGMENT_TIPS = {
    all: { key: 'crm_tip_all', fallback: 'All customers, no segment filter applied.' },
    vip: { key: 'crm_tip_vip', fallback: 'In the last 90 days, both order frequency and volume (kg) are above the median of active peers in the same customer type.' },
    regular: { key: 'crm_tip_regular', fallback: "Still ordering, but doesn't match any other segment's criteria." },
    at_risk: { key: 'crm_tip_at_risk', fallback: 'Historically ordered more often than peers, but is now overdue for a reorder.' },
    dormant: { key: 'crm_tip_dormant', fallback: "No order in over 180 days, or well past this customer's usual reorder interval." },
    new: { key: 'crm_tip_new', fallback: 'Placed exactly one order, within the last 30 days.' },
    none: { key: 'crm_tip_none', fallback: 'Registered as a customer but has never placed an order.' }
};

function crmTileHtml(key, count, label, bg, color, tip, isActive) {
    const tipHtml = tip ? `<div class="crm-tile-tip" style="position:absolute; bottom:calc(100% + 8px); left:50%; transform:translateX(-50%); width:180px; background:var(--bg-card); border:1px solid var(--border); border-radius:8px; padding:8px 10px; font-size:0.68rem; line-height:1.4; color:var(--text-secondary); opacity:0; visibility:hidden; transition:opacity .15s; z-index:30; pointer-events:none; box-shadow:0 4px 12px rgba(0,0,0,0.25);">${tip}</div>` : '';
    const hoverAttrs = tip ? `onmouseenter="this.querySelector('.crm-tile-tip').style.opacity='1'; this.querySelector('.crm-tile-tip').style.visibility='visible';" onmouseleave="this.querySelector('.crm-tile-tip').style.opacity='0'; this.querySelector('.crm-tile-tip').style.visibility='hidden';"` : '';
    return `<div data-key="${key}" class="crm-filter-tile" style="position:relative; cursor:pointer; background:${bg}; border:1px solid var(--border); border-radius:10px; padding:10px 12px; ${isActive ? `outline:2px solid ${color}; outline-offset:-1px;` : ''}" ${hoverAttrs}>
        <div style="font-size:1.1rem; font-weight:700; color:${color};">${count}</div>
        <div style="font-size:0.68rem; color:${color}; opacity:0.9; margin-top:2px;">${label}</div>
        ${tipHtml}
    </div>`;
}

// SEGMENT_BADGE_META.regular and CUSTOMER_TYPE_META.Wholesale both point at
// var(--primary-light)/var(--bg-hover), neither of which is ever defined in
// css/styles.css — a small pill badge still reads fine on an undefined bg
// (the border/padding alone shows a shape), but a big filled tile with no
// bg at all just blends into the page. These two tile-only overrides give
// them the same solid-pastel treatment as every other tile, without
// touching the shared meta objects the Directory's small badges still use.
const CRM_TILE_COLOR_OVERRIDES = {
    regular: { bg: '#e0f2fe', color: '#075985' },
    Wholesale: { bg: '#d1fae5', color: '#065f46' }
};

function renderCrmTiles(segCounts, typeCounts) {
    const segWrap = document.getElementById('cust-crm-seg-tiles');
    if (segWrap) {
        segWrap.innerHTML = CRM_SEGMENT_ORDER.map(key => {
            const count = segCounts[key] || 0;
            const tipMeta = CRM_SEGMENT_TIPS[key];
            const tip = window.t ? window.t(tipMeta.key) : tipMeta.fallback;
            if (key === 'all') {
                return crmTileHtml('all', count, window.t ? window.t('crm_tile_all') : 'All', 'var(--bg-card)', 'var(--text-primary)', tip, _crmActiveSeg === 'all');
            }
            const meta = SEGMENT_BADGE_META[key];
            const override = CRM_TILE_COLOR_OVERRIDES[key];
            const label = window.t ? window.t(meta.key) : meta.fallback;
            return crmTileHtml(key, count, (meta.icon ? meta.icon + ' ' : '') + label, override ? override.bg : meta.bg, override ? override.color : meta.color, tip, _crmActiveSeg === key);
        }).join('');
        segWrap.querySelectorAll('.crm-filter-tile').forEach(el => {
            el.addEventListener('click', () => { _crmActiveSeg = el.dataset.key; renderCrmTiles(segCounts, typeCounts); renderCrmTable(); });
        });
    }

    const typeWrap = document.getElementById('cust-crm-type-tiles');
    if (typeWrap) {
        const allowedSet = new Set(allowedCustomerTypes());
        const typeKeys = ['all', ...CUSTOMER_TYPES.filter(t => allowedSet.has(t))];
        typeWrap.innerHTML = typeKeys.map(key => {
            const count = typeCounts[key] || 0;
            if (key === 'all') {
                return crmTileHtml('all', count, window.t ? window.t('crm_tile_all') : 'All', 'var(--bg-card)', 'var(--text-primary)', null, _crmActiveType === 'all');
            }
            const meta = CUSTOMER_TYPE_META[key];
            const override = CRM_TILE_COLOR_OVERRIDES[key];
            return crmTileHtml(key, count, key, override ? override.bg : meta.bg, override ? override.color : meta.color, null, _crmActiveType === key);
        }).join('');
        typeWrap.querySelectorAll('.crm-filter-tile').forEach(el => {
            el.addEventListener('click', () => { _crmActiveType = el.dataset.key; renderCrmTiles(segCounts, typeCounts); renderCrmTable(); });
        });
    }
}

function renderCrmTable() {
    const tbody = document.getElementById('cust-crm-table-body');
    if (!tbody) return;
    const visible = _crmRows.filter(r =>
        (_crmActiveSeg === 'all' || r.segKey === _crmActiveSeg) &&
        (_crmActiveType === 'all' || r.customer.type === _crmActiveType)
    );

    tbody.innerHTML = visible.map(r => `
        <tr data-idx="${_crmRows.indexOf(r)}" style="cursor:pointer;">
            <td><strong>${r.customer.name}</strong></td>
            <td>${r.customer.type}</td>
            <td>${renderCrmBadge(r.segmentMeta)}</td>
            <td>${r.reorderBadge ? renderCrmBadge(r.reorderBadge) : '<span style="color:var(--text-muted);">-</span>'}</td>
            <td>${r.allTimeStat ? r.allTimeStat.lastOrderDate : '-'}</td>
            <td style="text-align:right; font-weight:700;">${(r.trailing90Stat ? r.trailing90Stat.kg : 0).toFixed(1)}</td>
        </tr>
    `).join('') || `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:24px 0;">${window.t ? window.t('msg_no_customers_match_filter') : 'No customers match this filter.'}</td></tr>`;

    tbody.querySelectorAll('tr[data-idx]').forEach(tr => {
        tr.addEventListener('click', () => openCrmCustomerModal(_crmRows[parseInt(tr.dataset.idx)]));
    });

    const caption = document.getElementById('cust-crm-table-caption');
    if (caption) {
        const template = window.t ? window.t('crm_table_caption') : '{visible} of {total} customers';
        caption.textContent = template.replace('{visible}', visible.length).replace('{total}', _crmRows.length);
    }
}

async function loadCrmInsightsTab(forceRefresh) {
    const { data: customers } = await fetchData('customers');
    const accessible = filterCustomersByAccess(customers);
    const ordersRaw = await getCustomerOrdersRaw(forceRefresh);

    const allTimeStats = computeOrderStatsByKey(ordersRaw.orders, ordersRaw.items, { groupByFn: o => o.customer_id || null });
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const trailing90Stats = computeOrderStatsByKey(ordersRaw.orders, ordersRaw.items, {
        groupByFn: o => o.customer_id || null,
        startDate: ninetyDaysAgo.toISOString().split('T')[0],
        endDate: todayDateStr()
    });
    const peerMediansTrailing90 = computePeerMedians(accessible, trailing90Stats);
    const peerMediansAllTime = computePeerMedians(accessible, allTimeStats);

    _crmRows = accessible.map(c => {
        const allTimeStat = allTimeStats[c.id];
        const trailing90Stat = trailing90Stats[c.id];
        const reorderBadge = getReorderBadge(allTimeStat);
        const segmentMeta = getCustomerSegment(c, allTimeStat, trailing90Stat, peerMediansTrailing90, peerMediansAllTime);
        const segKey = Object.keys(SEGMENT_BADGE_META).find(k => SEGMENT_BADGE_META[k] === segmentMeta) || 'none';
        return { customer: c, allTimeStat, trailing90Stat, reorderBadge, segmentMeta, segKey };
    });

    const segCounts = { all: _crmRows.length };
    const typeCounts = { all: _crmRows.length };
    _crmRows.forEach(r => {
        segCounts[r.segKey] = (segCounts[r.segKey] || 0) + 1;
        typeCounts[r.customer.type] = (typeCounts[r.customer.type] || 0) + 1;
    });

    renderCrmTiles(segCounts, typeCounts);
    renderCrmTable();
}

// Same coffee-name resolution convention as viewCustomerHistory's
// coffeeLabel (js/sales.js) and loadCustomerReport's Coffee Preference
// section (js/app.js) — kept consistent across all three so a given order
// item always displays the same name no matter which screen shows it.
// Only counts Dispatched/Completed orders, same "actually shipped" rule
// computeOrderStatsByKey uses everywhere else in this CRM layer.
async function getCustomerPurchaseHistory(customerId, ordersRaw) {
    if (!ordersRaw) ordersRaw = await getCustomerOrdersRaw();
    const [
        { data: greenbeans },
        { data: recipes },
        { data: codeDefinitions }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('code_definitions')
    ]);

    function resolveCoffeeName(item) {
        if (item.coffee_code) {
            const def = (codeDefinitions || []).find(d => d.code === item.coffee_code);
            return def ? def.name : `Code ${item.coffee_code}`;
        }
        if (item.coffee_type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === item.single_coffee_id);
            return gb ? gb.name : 'Single Origin';
        }
        const r = (recipes || []).find(rec => rec.id === item.blend_recipe_id);
        return r ? r.name : 'Blend Recipe';
    }

    const custOrders = ordersRaw.orders.filter(o => o.customer_id === customerId && (o.status === 'Dispatched' || o.status === 'Completed'));
    const orderIds = new Set(custOrders.map(o => o.id));
    const orderById = {};
    custOrders.forEach(o => { orderById[o.id] = o; });

    const rows = ordersRaw.items
        .filter(item => orderIds.has(item.request_order_id))
        .map(item => {
            const order = orderById[item.request_order_id];
            const qty = parseInt(item.quantity_requested) || 0;
            const sizeG = parseInt(item.bag_size_g) || 0;
            return {
                date: order.order_date || '-',
                coffeeName: resolveCoffeeName(item),
                bags: qty,
                kg: (qty * sizeG) / 1000,
                status: order.status
            };
        });

    rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return rows;
}

// Opens the app's standard modal (openModal, js/app.js) with a CRM-focused
// customer summary — NOT a bespoke overlay — so it matches every other
// modal in the app (viewCustomerHistory, openCustomerModal, etc.).
async function openCrmCustomerModal(row) {
    const { customer, allTimeStat, segmentMeta, reorderBadge } = row;

    const ordersRaw = await getCustomerOrdersRaw();
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    const mtdStats = computeOrderStatsByKey(ordersRaw.orders, ordersRaw.items, {
        groupByFn: o => o.customer_id || null,
        startDate: firstOfMonth.toISOString().split('T')[0],
        endDate: todayDateStr()
    });
    const mtdStat = mtdStats[customer.id];

    const badgesHtml = `${renderCrmBadge(segmentMeta)}${reorderBadge ? renderCrmBadge(reorderBadge) : ''}`;

    const lifetimeKg = allTimeStat ? allTimeStat.kg.toFixed(1) : '0.0';
    const lifetimeOrders = allTimeStat ? allTimeStat.orderCount : 0;
    const firstOrderText = allTimeStat && allTimeStat.firstOrderDate
        ? (window.t ? window.t('crm_first_order_since').replace('{date}', allTimeStat.firstOrderDate) : `Customer since ${allTimeStat.firstOrderDate}`)
        : '-';

    const mtdKg = mtdStat ? mtdStat.kg.toFixed(1) : '0.0';
    const mtdOrders = mtdStat ? mtdStat.orderCount : 0;
    const cadenceText = allTimeStat && allTimeStat.avgIntervalDays
        ? (window.t ? window.t('crm_cadence_text').replace('{days}', Math.round(allTimeStat.avgIntervalDays)) : `Reorders about every ${Math.round(allTimeStat.avgIntervalDays)} days`)
        : (window.t ? window.t('crm_cadence_unknown') : 'Not enough order history yet');

    const html = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
            <div style="font-size:0.85rem; color:var(--text-muted);">${customer.customer_id} • ${customer.type}</div>
            <div style="display:flex; gap:4px; flex-wrap:wrap;">${badgesHtml}</div>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:16px; margin-bottom:14px; font-size:0.85rem; color:var(--text-secondary);">
            <span>${customer.phone || '-'}</span>
            <span>${customer.address || '-'}</span>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:18px;">
            <div style="background:var(--bg-hover); border-radius:10px; padding:12px 14px;">
                <div style="font-size:0.68rem; color:var(--text-muted); margin-bottom:6px; letter-spacing:0.03em;" data-i18n="lbl_lifetime">LIFETIME</div>
                <div style="font-size:1.1rem; font-weight:700;">${lifetimeKg} kg</div>
                <div style="font-size:0.78rem; color:var(--text-secondary);">${lifetimeOrders}</div>
                <div style="font-size:0.72rem; color:var(--text-muted); margin-top:6px;">${firstOrderText}</div>
            </div>
            <div style="background:var(--bg-hover); border-radius:10px; padding:12px 14px;">
                <div style="font-size:0.68rem; color:var(--text-muted); margin-bottom:6px; letter-spacing:0.03em;" data-i18n="lbl_month_to_date">MONTH-TO-DATE</div>
                <div style="font-size:1.1rem; font-weight:700;">${mtdKg} kg</div>
                <div style="font-size:0.78rem; color:var(--text-secondary);">${mtdOrders}</div>
                <div style="font-size:0.72rem; color:var(--text-muted); margin-top:6px;">${cadenceText}</div>
            </div>
        </div>
        <div style="font-size:0.85rem; font-weight:700; margin-bottom:8px;" data-i18n="lbl_purchase_history">Purchase history</div>
        <div id="crm-modal-history"><p class="table-empty-state">...</p></div>
    `;

    openModal(customer.name, html, '520px');

    const history = await getCustomerPurchaseHistory(customer.id, ordersRaw);
    const historyEl = document.getElementById('crm-modal-history');
    if (!historyEl) return; // modal was closed before history resolved
    if (history.length === 0) {
        historyEl.innerHTML = `<p class="table-empty-state">${window.t ? window.t('msg_no_purchase_history') : 'No purchase history yet.'}</p>`;
    } else {
        historyEl.innerHTML = `<div class="table-container"><table style="width:100%;">
            <thead><tr>
                <th data-i18n="col_crm_date">Date</th>
                <th data-i18n="col_crm_coffee">Coffee</th>
                <th style="text-align:right;" data-i18n="col_total_bags">Total Bags</th>
                <th style="text-align:right;" data-i18n="col_total_kg">Total (kg)</th>
                <th data-i18n="col_crm_status">Status</th>
            </tr></thead>
            <tbody>${history.map(h => `
                <tr>
                    <td>${h.date}</td>
                    <td>${h.coffeeName}</td>
                    <td style="text-align:right;">${h.bags}</td>
                    <td style="text-align:right; font-weight:600;">${h.kg.toFixed(1)}</td>
                    <td>${h.status}</td>
                </tr>
            `).join('')}</tbody>
        </table></div>`;
    }
    if (typeof window.translatePage === 'function') window.translatePage();
}

// Field markup shared by the full Customer Directory Add/Edit modal and the
// inline "+ Add Customer" shortcut opened from other forms (e.g. Submit
// Sales Request Order) — kept in one place so the two never drift apart.
// Customer typeahead for Submit Sales Request Order (CUSTOMER_TYPEAHEAD_PLAN.md).
// A plain <input list> + <datalist>, the same convention as the Found Item
// modal (openFoundItemModal in js/app.js): every option's value is
// "CODE — NAME", so the browser's own substring filtering matches a typed
// name and a typed customer number alike. Shared by the initial render and
// the refresh after the "+ Add Customer" shortcut creates one.
//
// The datalist only SUGGESTS — an <input> accepts any text (§7.2).
// resolveCustomerInput below is what enforces that an order's customer
// must already be registered.
function customerDisplayText(c) {
    return `${c.customer_id} — ${c.name}`;
}

// Customer names are user-entered, so they're escaped before landing in a
// value="..." attribute (§7.4).
function escapeCustomerAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildCustomerDatalistHtml(customersList) {
    return (customersList || [])
        .slice()
        .sort((a, b) => String(a.customer_id).localeCompare(String(b.customer_id), undefined, { numeric: true }))
        .map(c => `<option value="${escapeCustomerAttr(customerDisplayText(c))}"></option>`)
        .join('');
}

// Typed text → customer row, or null (§4). Exact option text first (the
// normal case: picked from the list), then the part before the separator as
// a customer number, so typing "WHL-002" and stopping without picking still
// resolves. Never by name alone — names aren't unique and can change.
//
// Only ever searches the list it's handed, which the caller builds from
// filterCustomersByAccess — so a category a role can't see can't be reached
// by typing its code either (§7.3).
function resolveCustomerInput(text, customersList) {
    const typed = (text || '').trim();
    if (!typed) return null;
    const list = customersList || [];
    const exact = list.find(c => customerDisplayText(c) === typed);
    if (exact) return exact;
    const code = typed.split(/\s+[—-]\s+/)[0].trim().toLowerCase();
    return list.find(c => String(c.customer_id).toLowerCase() === code) || null;
}

// `typeOptions` (CUSTOMER_CATEGORY_ROLE_PLAN.md Fase 3, Grup A) restricts
// which categories render as choices to whatever the current role has
// access to — a role can't file a customer under a category it isn't
// allowed to see, whether creating or re-categorising.
//
// The select used to be `disabled` on edit, which meant a customer's
// category was permanent: a Retail customer that grew into Wholesale could
// never be moved, and a wrong pick at creation could never be corrected
// (found 2026-09-07 while auditing this feature). It's editable now. Two
// things deliberately do NOT follow the change: the customer_id keeps its
// original prefix (WHL-002 stays WHL-002 — the code appears on printed
// waybills and in order history, so rewriting it would orphan paper
// records), and past orders keep their own order_type snapshot (§3.2).
// Only the customer's CURRENT category moves.
function buildCustomerFormFieldsHtml(existing, editId, typeOptions) {
    const typesToShow = typeOptions || CUSTOMER_TYPES;
    return `
        <div class="form-row">
            <div class="form-group flex-1" >
                <label class="form-label">Customer ID</label>
                <input type="text" id="m-cust-id" class="form-control" readonly placeholder="Auto Generated" value="${existing ? existing.customer_id : ''}">
            </div>
            <div class="form-group flex-1" >
                <label class="form-label">Type</label>
                <select id="m-cust-type" class="form-control" required>
                    ${typesToShow.map(type => {
                        // Wholesale defaults for a brand-new customer (user request,
                        // commit 14c361c) — same "no existing row yet" condition the
                        // old two-option version used, just generalized to 3 types.
                        const selected = existing ? existing.type === type : type === 'Wholesale';
                        return `<option value="${type}" ${selected ? 'selected' : ''}>${CUSTOMER_TYPE_META[type].icon} ${type}</option>`;
                    }).join('')}
                </select>
                ${editId ? `<div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">${window.t ? window.t('hint_cust_type_change') : 'Customer ID stays the same, and past orders keep the type they were placed under.'}</div>` : ''}
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
    `;
}

// Wires Customer ID auto-generation + submit/save for whichever host element
// rendered buildCustomerFormFieldsHtml — `closeFn` abstracts away whether
// that's the singleton #modal-container (openCustomerModal) or the stacked
// quick-add overlay (openAddCustomerShortcutModal), so this logic doesn't
// need to know or care which one it's running inside. `onSaved(newRecord)`
// lets a caller (e.g. the Request Order form) react to the customer that
// was just created.
function wireCustomerForm({ existing, editId, customers, closeFn, onSaved }) {
    const typeSelect = document.getElementById('m-cust-type');
    const custIdInput = document.getElementById('m-cust-id');

    async function generateCustomerId() {
        const type = typeSelect.value;
        const prefix = (CUSTOMER_TYPE_META[type] || CUSTOMER_TYPE_META.Retail).prefix;
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

        const { data, error } = await saveData('customers', record);
        if (error) {
            alert('Failed to save customer: ' + error.message);
        } else {
            closeFn();
            await loadCustomersSection();
            if (onSaved) onSaved(data);
        }
    });
}

async function openCustomerModal(editId = null) {
    const { data: customers } = await fetchData('customers');
    let existing = null;
    if (editId) {
        existing = (customers || []).find(c => c.id === editId);
        // CUSTOMER_CATEGORY_ROLE_PLAN.md Fase 3 (Grup A): a direct-access
        // path — this can be called with any id regardless of what the
        // Customer Directory table happened to render, so the list filter
        // in loadCustomersSection alone is not enough here.
        if (existing && !canAccessCustomer(existing)) {
            await showWarningModal(window.t ? window.t('alert_customer_category_denied') : "You don't have access to this customer's category.", false);
            return;
        }
    }

    // Only offer categories this role can actually access — for BOTH paths.
    // Creating: can't file a new customer somewhere it then can't see it.
    // Editing: now that the Type select is editable, this is what stops a
    // Retail-only role from pushing a customer into Wholesale (which would
    // also make it vanish from that role's own directory). The canAccessCustomer
    // guard above guarantees the customer's current type is inside this list,
    // so the existing value always has an <option> to render on.
    const allowed = allowedCustomerTypes();
    if (allowed.length === 0) {
        await showWarningModal(window.t ? window.t('alert_customer_category_add_denied') : "You don't have access to add a customer in any category.", false);
        return;
    }
    const typeOptions = allowed;

    const html = `
        <form id="modal-customer-form" novalidate>
            ${buildCustomerFormFieldsHtml(existing, editId, typeOptions)}
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">${editId ? 'Save Changes' : 'Add Customer'}</button>
            </div>
        </form>
    `;

    openModal(editId ? 'Edit Customer' : 'Add New Customer', html, '650px');

    wireCustomerForm({
        existing, editId, customers,
        closeFn: () => document.getElementById('btn-close-modal').click()
    });
}

// Inline shortcut for forms that need to create a customer without losing
// their own in-progress state — e.g. Submit Sales Request Order. Opening the
// full openCustomerModal here would go through the SINGLE shared
// #modal-container (see openModal in js/app.js), overwriting whatever form
// is currently open behind it. This renders into its own stacked overlay
// instead (z-index above .overlay's default 1000, same pattern
// showWarningModal uses), so the caller's modal survives underneath and
// `onSaved` can prefill the new customer once it's created.
async function openAddCustomerShortcutModal(onSaved) {
    // CUSTOMER_CATEGORY_ROLE_PLAN.md Fase 3 (Grup A): same "add" restriction
    // as openCustomerModal — this shortcut always creates a NEW customer, so
    // it needs the same allowed-categories check every time, not just once.
    const allowedTypes = allowedCustomerTypes();
    if (allowedTypes.length === 0) {
        await showWarningModal(window.t ? window.t('alert_customer_category_add_denied') : "You don't have access to add a customer in any category.", false);
        return;
    }

    const { data: customers } = await fetchData('customers');

    let container = document.getElementById('quick-add-customer-modal-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'quick-add-customer-modal-container';
        container.className = 'overlay';
        container.style.zIndex = '2000';
        document.body.appendChild(container);
    }

    container.innerHTML = `
        <div class="overlay-card" style="max-width: 650px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 16px;">
                <h3 style="font-size: 1.15rem; font-weight: 700;">Add New Customer</h3>
                <button type="button" id="btn-close-quick-add-customer" style="background: transparent; border: 0; cursor: pointer; color: var(--text-muted); font-size: 1.5rem; line-height: 1;">&times;</button>
            </div>
            <form id="modal-customer-form" novalidate>
                ${buildCustomerFormFieldsHtml(null, null, allowedTypes)}
                <div class="modal-footer-actions">
                    <button type="button" class="btn btn-secondary" id="btn-cancel-quick-add-customer">Cancel</button>
                    <button type="submit" class="btn btn-primary">Add Customer</button>
                </div>
            </form>
        </div>
    `;
    container.classList.remove('hidden');

    const close = () => container.classList.add('hidden');
    document.getElementById('btn-close-quick-add-customer').addEventListener('click', close);
    document.getElementById('btn-cancel-quick-add-customer').addEventListener('click', close);

    wireCustomerForm({
        existing: null, editId: null, customers,
        closeFn: close,
        onSaved
    });
}

async function deleteCustomer(id) {
    // CUSTOMER_CATEGORY_ROLE_PLAN.md Fase 3 (Grup A): a direct-access path
    // just like openCustomerModal/viewCustomerHistory — must refuse a
    // customer outside the role's allowed categories, not just omit it from
    // the Customer Directory table.
    const { data: customersForGuard } = await fetchData('customers');
    const customerToDelete = (customersForGuard || []).find(c => c.id === id);
    if (!customerToDelete) return;
    if (!canAccessCustomer(customerToDelete)) {
        await showWarningModal(window.t ? window.t('alert_customer_category_denied') : "You don't have access to this customer's category.", false);
        return;
    }

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
    if (!canAccessCustomer(customer)) {
        await showWarningModal(window.t ? window.t('alert_customer_category_denied') : "You don't have access to this customer's category.", false);
        return;
    }

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
    let matches = (dispatchLotItems || []).filter(d => lotIds.includes(d.packed_coffee_lot_id));

    // CUSTOMER_CATEGORY_ROLE_PLAN.md Fase 5 (Grup C) — a dispatch row whose
    // order falls outside the role's allowed customer categories is dropped
    // here too, same as the order lists, so a restricted category can't be
    // read back out through the lot lookup instead. A row with no resolvable
    // order (or a null order_type) is kept, matching the fail-open rule used
    // everywhere else for orders order_type can't classify.
    const visibleOrderIds = new Set(filterOrdersByCustomerCategory(orders).map(o => o.id));
    matches = matches.filter(d => {
        const item = (orderItems || []).find(i => i.id === d.request_order_item_id);
        const order = item ? (orders || []).find(o => o.id === item.request_order_id) : null;
        return !order || visibleOrderIds.has(order.id);
    });

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
    // its own orders (see filterOwnOrders in js/auth.js). Layered (not
    // replaced) with CUSTOMER_CATEGORY_ROLE_PLAN.md Fase 5 (Grup C): a role
    // also loses orders whose order_type falls outside its allowed customer
    // categories — both filters apply on top of each other on this list.
    const visibleOrders = filterOrdersByCustomerCategory(filterOwnOrders(orders));

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

        // APPROVAL_REVISION_PLAN.md Fase 3 — same chip as
        // loadDispatchApprovalTable, so a shortfall reads the same way in
        // both places it's ever shown (§1's reason for combining Fases 1-6
        // into one piece of work in the first place).
        const shortItemsReq = items.filter(i => (parseInt(i.quantity_unfulfilled) || 0) > 0);
        let shortfallChipHtmlReq = '';
        if (shortItemsReq.length === 1) {
            const it = shortItemsReq[0];
            const requestedQ = parseInt(it.quantity_requested) || 0;
            const unfulfilledQ = parseInt(it.quantity_unfulfilled) || 0;
            const processedQ = requestedQ - unfulfilledQ;
            const line = (window.t ? window.t('chip_shortfall_single') : '{processed} of {requested} processed')
                .replace('{processed}', processedQ).replace('{requested}', requestedQ);
            shortfallChipHtmlReq = `<div style="margin-top:4px; display:inline-block; font-size:0.68rem; font-weight:700; background:rgba(255,209,102,0.16); color:var(--warning); border:1px solid rgba(255,209,102,0.40); padding:2px 8px; border-radius:999px;">${line}</div>`;
        } else if (shortItemsReq.length > 1) {
            const line = (window.t ? window.t('chip_shortfall_multi') : '{count} items short').replace('{count}', shortItemsReq.length);
            shortfallChipHtmlReq = `<div style="margin-top:4px; display:inline-block; font-size:0.68rem; font-weight:700; background:rgba(255,209,102,0.16); color:var(--warning); border:1px solid rgba(255,209,102,0.40); padding:2px 8px; border-radius:999px;">${line}</div>`;
        }

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
        } else if (order.status === 'Unable to Fulfill') {
            // APPROVAL_REVISION_PLAN.md Fase 4/6 — this order was stopped
            // either at approval or from packing; both land here the same
            // way. No action buttons — Reopen (§3.7) is reached from the
            // Dispatch Approval popup, not this table.
            const dateOnlyReq = order.decided_at ? String(order.decided_at).split('T')[0] : '';
            const decidedLineReq = (window.t ? window.t('lbl_order_decided_unable_by') : 'by {name} · {date}')
                .replace('{name}', order.decided_by_name || '').replace('{date}', dateOnlyReq);
            actionColumnContent = `
                <div>
                    <span style="color: var(--danger); font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: rgba(239,68,68,0.10); border: 1px solid rgba(239,68,68,0.30); border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                        <span style="display:inline-block; width:6px; height:6px; background:var(--danger); border-radius:50%;"></span> ${window.t ? window.t('status_unable_to_fulfill') : 'Unable to Fulfill'}
                    </span>
                    <div style="margin-top:4px; font-size:0.7rem; color:var(--text-muted);">${decidedLineReq}</div>
                </div>
            `;
        } else if (order.status === 'Dispatched') {
            actionColumnContent = `
                <span style="color: #0891b2; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.3); border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                    Dispatched
                </span>
                ${shortfallChipHtmlReq}
            `;
        } else {
            const allItemsReady = items.every(item => item.item_status === 'Ready for Handover');
            if (allItemsReady) {
                const labelReadyToDispatch = window.t ? window.t("status_ready_to_dispatch") || "Ready to Dispatch" : "Ready to Dispatch";
                actionColumnContent = `
                    <span style="color: #15803d; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #dcfce7; border: 1px solid #bbf7d0; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                        <i class="lucide-check-circle" style="width:14px; height:14px;"></i> ${labelReadyToDispatch}
                    </span>
                    ${shortfallChipHtmlReq}
                `;
            } else {
                const labelOnProgress = window.t ? window.t("status_on_progress") || "On Progress" : "On Progress";
                actionColumnContent = `
                    <span style="color: #1d4ed8; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                        <span style="display:inline-block; width:6px; height:6px; background:#1d4ed8; border-radius:50%;"></span> ${labelOnProgress}
                    </span>
                    ${shortfallChipHtmlReq}
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
            
            // An Unable to Fulfill order resets item_status to the neutral
            // 'Pending Approval', which reads as a contradiction beside the
            // order's own badge — so the item pill is hidden for that status.
            const statusBadge = order.status === 'Unable to Fulfill' ? '' : getItemStatusBadge(item.item_status);
            
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
                ${order.order_type ? `<br/>${CUSTOMER_TYPE_BADGES[order.order_type] || ''}` : ''}
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

// APPROVAL_REVISION_PLAN.md §3.8 — same bubble style as showFieldWarn (this
// file, inside openSalesRequestModal) and the .custom-empty-warn class it
// uses, but anchored to a disabled BUTTON instead of a field: this button
// never fires an 'input'/'change' event to clean itself up on, so it's
// removed on a timer instead, and on the next click anywhere in the
// document (whichever comes first).
function showEditLockedBubble(btnEl, message) {
    if (!btnEl || !message) return;
    const parent = btnEl.parentElement;
    parent.style.position = 'relative';
    const existing = parent.querySelector('.custom-empty-warn');
    if (existing) existing.remove();
    const bubble = document.createElement('div');
    bubble.className = 'custom-empty-warn';
    bubble.style = 'position: absolute; top: calc(100% + 6px); left: 0; background: var(--danger); color: #fff; padding: 5px 9px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; z-index: 20; max-width: 220px; line-height: 1.35; box-shadow: 0 2px 5px rgba(0,0,0,0.25);';
    bubble.textContent = message;
    parent.appendChild(bubble);
    const remove = () => { if (bubble.parentNode) bubble.remove(); };
    setTimeout(remove, 4000);
    // Deferred with its own setTimeout(…, 0): this function runs from
    // inside the SAME click event that's still bubbling up to document, so
    // attaching the "click elsewhere closes it" listener synchronously
    // would catch that very click on its way past and remove the bubble
    // before it's ever seen.
    setTimeout(() => {
        document.addEventListener('click', function onceMore(ev) {
            if (!bubble.contains(ev.target)) { remove(); document.removeEventListener('click', onceMore); }
        });
    }, 0);
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
        { data: codeDefinitions },
        { data: dispatchLotItems },
        { data: roastingPlans }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('customers'),
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('code_definitions'),
        fetchData('dispatch_lot_items'),
        fetchData('roasting_plans')
    ]);
    const tbody = document.getElementById('approval-orders-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // CUSTOMER_CATEGORY_ROLE_PLAN.md Fase 5 (Grup C) — no filterOwnOrders
    // here (this table has never been "own orders only"; leaders/admins
    // approve everyone's orders), but category access still applies.
    const visibleOrders = filterOrdersByCustomerCategory(orders);

    if (!visibleOrders || visibleOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center-muted">${window.t ? window.t("msg_no_orders") : "No orders found."}</td></tr>`;
        return;
    }

    const sortedOrders = [...visibleOrders]
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
            
            // An Unable to Fulfill order resets item_status to the neutral
            // 'Pending Approval', which reads as a contradiction beside the
            // order's own badge — so the item pill is hidden for that status.
            const statusBadge = order.status === 'Unable to Fulfill' ? '' : getItemStatusBadge(item.item_status);
            
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

        // APPROVAL_REVISION_PLAN.md Fase 3 — shortfall chip, computed once
        // per order and reused by whichever status branch below applies.
        // Deliberately NOT shown on the Unable to Fulfill branch (§3.6): a
        // fully-unfulfilled order already says so via its own badge, and
        // repeating it as "N item(s) short" underneath would be redundant.
        const shortItems = items.filter(i => (parseInt(i.quantity_unfulfilled) || 0) > 0);
        let shortfallChipHtml = '';
        if (shortItems.length === 1) {
            const it = shortItems[0];
            const requestedQ = parseInt(it.quantity_requested) || 0;
            const unfulfilledQ = parseInt(it.quantity_unfulfilled) || 0;
            const processedQ = requestedQ - unfulfilledQ;
            const line = (window.t ? window.t('chip_shortfall_single') : '{processed} of {requested} processed')
                .replace('{processed}', processedQ).replace('{requested}', requestedQ);
            shortfallChipHtml = `<div style="margin-top:4px; display:inline-block; font-size:0.68rem; font-weight:700; background:rgba(255,209,102,0.16); color:var(--warning); border:1px solid rgba(255,209,102,0.40); padding:2px 8px; border-radius:999px;">${line}</div>`;
        } else if (shortItems.length > 1) {
            const line = (window.t ? window.t('chip_shortfall_multi') : '{count} items short').replace('{count}', shortItems.length);
            shortfallChipHtml = `<div style="margin-top:4px; display:inline-block; font-size:0.68rem; font-weight:700; background:rgba(255,209,102,0.16); color:var(--warning); border:1px solid rgba(255,209,102,0.40); padding:2px 8px; border-radius:999px;">${line}</div>`;
        }

        // APPROVAL_REVISION_PLAN.md §5.2 — Edit is locked (meredup + inert,
        // §3.8) once EITHER team has started real work on this order:
        // stock has actually left the warehouse for it (dispatch_lot_items),
        // or a roasting batch has been logged against one of its plans.
        // Deliberately does NOT look at packed_stock_movements from the
        // approval-time deduction — that's the leader's own bookkeeping,
        // not a team having started, and counting it would lock Edit on
        // every approved order before anyone had touched it (§5.2, and see
        // the contrast with canReopenOrder's §5.1 checks which DO count
        // that deduction — the two are intentionally different).
        const orderItemIdSet = new Set(items.map(i => i.id));
        const stockAlreadyPicked = (dispatchLotItems || []).some(d => orderItemIdSet.has(d.request_order_item_id));
        const orderPlanIds = (roastingPlans || [])
            .filter(p => order.order_number && p.order_ref === order.order_number)
            .map(p => p.id);
        const hasLoggedBatch = orderPlanIds.length > 0 && (roastBatches || []).some(b => orderPlanIds.includes(b.roast_plan_id));
        const editLocked = stockAlreadyPicked || hasLoggedBatch;
        const editLockedMsgKey = 'hint_edit_locked';
        const editLockedMsgFallback = 'This order can no longer be edited — packing or roasting has already started.';

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
        } else if (order.status === 'Unable to Fulfill') {
            // APPROVAL_REVISION_PLAN.md Fase 4 — badge + "by NAME · date"
            // line. No action buttons here; Reopen (§3.7) lives in the
            // detail popup only (opened by clicking the row), matching
            // where Unable to Fulfill itself is triggered from (inside the
            // Approve modal, not this row).
            const dateOnly = order.decided_at ? String(order.decided_at).split('T')[0] : '';
            const decidedLine = (window.t ? window.t('lbl_order_decided_unable_by') : 'by {name} · {date}')
                .replace('{name}', order.decided_by_name || '').replace('{date}', dateOnly);
            actionColumnContent = `
                <div>
                    <span style="color: var(--danger); font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: rgba(239,68,68,0.10); border: 1px solid rgba(239,68,68,0.30); border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                        <span style="display:inline-block; width:6px; height:6px; background:var(--danger); border-radius:50%;"></span> ${window.t ? window.t('status_unable_to_fulfill') : 'Unable to Fulfill'}
                    </span>
                    <div style="margin-top:4px; font-size:0.7rem; color:var(--text-muted);">${decidedLine}</div>
                </div>
            `;
        } else if (order.status === 'Dispatched') {
            actionColumnContent = `
                <span style="color: #0891b2; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.3); border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                    Dispatched
                </span>
                ${shortfallChipHtml}
            `;
        } else if (order.status === 'Preparing') {
            actionColumnContent = `
                <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start;">
                    <span style="color: #8b5cf6; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: rgba(139,92,246,0.1); border: 1px solid rgba(139,92,246,0.3); border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                        <span style="display:inline-block; width:6px; height:6px; background:#8b5cf6; border-radius:50%;"></span> Preparing
                    </span>
                    ${shortfallChipHtml}
                    ${editLocked
                        ? `<button type="button" class="btn btn-primary btn-sm btn-edit-order-locked" data-msg-key="${editLockedMsgKey}" data-msg-fallback="${editLockedMsgFallback}" style="opacity:0.45; cursor:not-allowed;"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle-mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>`
                        : `<button class="btn btn-primary btn-sm btn-edit-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle-mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>`}
                </div>
            `;
        } else {
            const allReady = items.every(item => item.item_status === 'Ready for Handover');
            if (allReady) {
                actionColumnContent = `<span style="color: #15803d; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #dcfce7; border: 1px solid #bbf7d0; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;"><i class="lucide-check-circle" style="width:14px; height:14px;"></i> Completed</span>${shortfallChipHtml}`;
            } else {
                actionColumnContent = `<span style="color: #1d4ed8; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;"><span style="display:inline-block; width:6px; height:6px; background:#1d4ed8; border-radius:50%;"></span> On Progress</span>${shortfallChipHtml}`;
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
        // APPROVAL_REVISION_PLAN.md §3.8 / §5.2 — checked BEFORE
        // .btn-edit-order below and BEFORE the row-click popup fallback:
        // the button stays visible but does nothing except explain why
        // (§7.1 — this is the click handler, not just a CSS [disabled], so
        // there's an actual guard here rather than relying on opacity/
        // cursor styling alone).
        const btnEditLocked = e.target.closest('.btn-edit-order-locked');
        if (btnEditLocked) {
            const msg = (window.t ? window.t(btnEditLocked.getAttribute('data-msg-key')) : null) || btnEditLocked.getAttribute('data-msg-fallback');
            showEditLockedBubble(btnEditLocked, msg);
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
            openOrderDetailPopup(orderId, visibleOrders, orderItems, greenbeans, recipes, machines, packed, roastBatches, codeDefinitions);
        }
    };

    applyFiltersForTable(document.querySelector('#tab-dispatch-approval table'));
    if (typeof window.translatePage === 'function') window.translatePage();
}

async function openOrderDetailPopup(orderId, orders, orderItems, greenbeans, recipes, machines, packed, roastBatches, codeDefinitions) {
    const order = (orders || []).find(o => o.id === orderId);
    if (!order) return;

    // APPROVAL_REVISION_PLAN.md §5.1 — decided up front (this function is
    // now async) so the Reopen button either renders correctly the first
    // time or not at all, rather than flashing in then disappearing.
    const canReopenThisOrder = order.status === 'Unable to Fulfill' ? await canReopenOrder(orderId) : false;

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
                       order.status === 'Unable to Fulfill' ? 'rgba(239,68,68,0.15)' :
                       'rgba(245,158,11,0.15)';
    const textCol = order.status === 'Dispatched' ? '#0891b2' :
                    order.status === 'Completed' ? 'var(--success)' :
                    order.status === 'Preparing' ? '#8b5cf6' :
                    order.status === 'Approved' ? 'var(--info)' :
                    order.status === 'Cancelled' ? 'var(--danger)' :
                    order.status === 'Unable to Fulfill' ? 'var(--danger)' :
                    'var(--warning)';

    // APPROVAL_REVISION_PLAN.md Fase 3 (§3.5) — one banner, two colors:
    // red for Unable to Fulfill, amber for an approved-with-shortfall order
    // that has a note. Mirrors the pattern in js/purchasing.js
    // (openPurchaseRequestDetailPopup's banner), including the same "reason
    // is optional, so show the line WITHOUT a colored box when it's empty"
    // rule (§3.7 / §7's Fase 4 verification step).
    let decisionBannerHtml = '';
    const decidedDateOnly = order.decided_at ? String(order.decided_at).split('T')[0] : '';
    if (order.status === 'Unable to Fulfill') {
        const line = (window.t ? window.t('lbl_order_decided_unable_by') : 'Unable to Fulfill by {name} · {date}')
            .replace('{name}', order.decided_by_name || '').replace('{date}', decidedDateOnly);
        decisionBannerHtml = order.decision_note
            ? `<div style="background:rgba(239,68,68,0.10); border:1px solid rgba(239,68,68,0.35); border-left-width:3px; border-radius:8px; padding:12px 14px; margin-bottom:18px;">
                 <div style="font-size:0.68rem; color:var(--danger); text-transform:uppercase; letter-spacing:0.05em;">${line}</div>
                 <p style="font-size:0.85rem; margin-top:4px;">${order.decision_note}</p>
               </div>`
            : `<div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:18px;">${line}</div>`;
    } else if (order.decision_note && order.decided_by_name) {
        const line = (window.t ? window.t('lbl_order_partial_by') : 'Partially fulfilled by {name} · {date}')
            .replace('{name}', order.decided_by_name).replace('{date}', decidedDateOnly);
        decisionBannerHtml = `<div style="background:rgba(255,209,102,0.12); border:1px solid rgba(255,209,102,0.40); border-left-width:3px; border-radius:8px; padding:12px 14px; margin-bottom:18px;">
                 <div style="font-size:0.68rem; color:var(--warning); text-transform:uppercase; letter-spacing:0.05em;">${line}</div>
                 <p style="font-size:0.85rem; margin-top:4px;">${order.decision_note}</p>
               </div>`;
    }

    // Build items table
    let itemsHtml = '';
    let totalBags = 0;
    let totalAllocated = 0;
    let totalPending = 0;
    let totalUnfulfilled = 0;
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

        // APPROVAL_REVISION_PLAN.md Fase 3 — "Tidak diproses" column. Only
        // meaningful once a decision has actually been made (quantity_
        // unfulfilled stays 0 by default for a still-pending order, which
        // renders correctly here as "—" without needing an isPending check).
        const unfulfilledQty = parseInt(item.quantity_unfulfilled) || 0;
        totalUnfulfilled += unfulfilledQty;
        const unfulfilledCell = unfulfilledQty > 0
            ? `<strong style="color: var(--warning);">${unfulfilledQty}</strong>`
            : '<span style="color: var(--text-muted);">—</span>';

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
                <td class="text-center">${unfulfilledCell}</td>
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

            ${decisionBannerHtml}

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
                            <th class="text-center">Not Fulfilled</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                        <tr style="font-weight: 700; border-top: 2px solid var(--border); background: rgba(255,255,255,0.03);">
                            <td colspan="5" style="text-align: right;">Total Bags</td>
                            <td style="text-align: center; color: var(--primary);"><strong>${totalBags}</strong></td>
                            <td style="text-align: center; color: var(--primary);"><strong>${totalAllocated}</strong></td>
                            <td style="text-align: center; color: var(--primary);"><strong>${totalPending}</strong></td>
                            <td style="text-align: center; color: ${totalUnfulfilled > 0 ? 'var(--warning)' : 'var(--primary)'};"><strong>${totalUnfulfilled}</strong></td>
                        </tr>
                    </tbody>
                </table>
            </div>

            ${canReopenThisOrder ? `
            <div style="display: flex; justify-content: flex-end; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border);">
                <button type="button" class="btn btn-primary" id="btn-reopen-order" data-i18n="btn_reopen_order">${window.t ? window.t('btn_reopen_order') : 'Reopen'}</button>
            </div>
            ` : ''}
        </div>
    `;

    existingPopup.classList.remove('hidden');
    document.getElementById('btn-close-order-detail').onclick = () => existingPopup.classList.add('hidden');
    const btnReopen = document.getElementById('btn-reopen-order');
    if (btnReopen) {
        btnReopen.addEventListener('click', async () => {
            if (!await showWarningModal(window.t ? window.t('confirm_reopen') : 'Reopen this order? It will go back to Pending Approval.', true)) return;
            await reopenOrder(orderId);
        });
    }
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
    // bulkOptions uses. (The sales order form itself no longer computes any
    // bulk numbers at all as of SALES_ORDER_REDESIGN_PLAN.md Fase 3 — bulk
    // is this function's call alone.)
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
    // claims — same running-allocation pattern getAllocations() uses for
    // packed stock in the sales order form.
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

    // Packed stock already promised to OTHER approved orders but not yet
    // picked by packing. Since 2026-09-16 approval no longer deducts packed
    // stock — "Fulfill from Packed" means packing will prepare it (user
    // decision) — so an approved order's promise stays sitting in
    // packed_coffee.quantity until packing checks it out. Without subtracting
    // it here, the next approval would see those same bags as free and
    // promise them twice.
    //
    // Claim on CURRENT stock per line = max(0, quantity_allocated −
    // quantity_prepared):
    //   - new-style approval: allocated N, prepared 0 → N still promised;
    //   - after packing picks some: shrinks by what was picked (those bags
    //     already left stock, so they mustn't be subtracted twice);
    //   - orders approved BEFORE this change had allocated deducted on the
    //     spot, so prepared ≥ allocated → 0, never double-subtracted.
    // Keyed the same way findMatchingPacked pools stock: trade-name lines by
    // type+code+size across machines, other lines by coffee+size+machine.
    const packedClaimKey = (it) => it.coffee_code
        ? `C|${it.coffee_type}|${it.coffee_code}|${parseInt(it.bag_size_g)}`
        : `I|${it.coffee_type}|${it.coffee_type === 'Single' ? it.single_coffee_id : it.blend_recipe_id}|${parseInt(it.bag_size_g)}|${it.machine_id}`;
    const approvedOrderIds = new Set((orders || []).filter(o => o.status === 'Preparing' && o.id !== orderId).map(o => o.id));
    const packedClaimedElsewhere = {};
    (orderItems || []).forEach(it => {
        if (!approvedOrderIds.has(it.request_order_id)) return;
        const claim = Math.max(0, (parseInt(it.quantity_allocated) || 0) - (parseInt(it.quantity_prepared) || 0));
        if (claim <= 0) return;
        const k = packedClaimKey(it);
        packedClaimedElsewhere[k] = (packedClaimedElsewhere[k] || 0) + claim;
    });
    const netPackedStock = (item, szItems) => Math.max(0,
        szItems.reduce((acc, p) => acc + (parseInt(p.quantity) || 0), 0) - (packedClaimedElsewhere[packedClaimKey(item)] || 0));

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
        const packedStockForItem = netPackedStock(item, szItemsForItem);

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
        const packedStock = netPackedStock(item, szItems);

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
            <div class="approval-item-row" data-id="${item.id}" data-requested="${parseInt(item.quantity_requested) || 0}" data-proposed-packed="${p.packed}" data-proposed-bulk="${p.bulk}" data-proposed-roast="${p.roast}" style="background: rgba(0,0,0,0.02); border: 1px solid var(--border-color); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <div style="font-weight: bold; margin-bottom: 8px; color: var(--text-primary);">${coffeeName} - ${size}g${machineLabel}</div>
                <div style="display: flex; gap: 20px; font-size: 0.85rem; align-items: center;">
                    <div class="flex-1">
                        <span style="color: var(--text-secondary);" data-i18n="lbl_requested">Requested:</span> <strong>${item.quantity_requested}</strong>
                    </div>
                    <div class="flex-1">
                        <span style="color: var(--text-secondary);" data-i18n="lbl_packed_stock">Packed Stock:</span> <strong style="${packedStock < item.quantity_requested ? 'color: var(--danger);' : ''}">${packedStock}</strong>
                        ${(packedClaimedElsewhere[packedClaimKey(item)] || 0) > 0 ? `<div style="font-size:0.72rem; color:var(--text-muted);">${packedClaimedElsewhere[packedClaimKey(item)]} more already promised to other approved orders</div>` : ''}
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

                <!-- APPROVAL_REVISION_PLAN.md Fase 1: shortfall warning. Hidden by
                     default (recomputed and shown/hidden on every 'input' event on
                     the three fields above — §3.4, must react to typing, not only
                     on submit) — see the .inp-fulfill/.inp-bulk/.inp-prod listener
                     wired further down, which is the single place that fills in
                     the numbers and toggles [hidden]. -->
                <div class="shortfall-warning hidden" style="margin-top: 12px; background: rgba(255,209,102,0.12); border: 1px solid rgba(255,209,102,0.40); border-left-width: 3px; border-radius: 8px; padding: 10px 12px; font-size: 0.8rem; color: var(--warning);">
                    <span class="shortfall-warning-qty" style="font-weight: 700;"></span>
                    <span style="display: block; margin-top: 3px; color: var(--text-secondary); font-weight: 400;" data-i18n="hint_shortfall_hangus">This remainder will not carry over — the sales team will need to submit a new request if it's still needed.</span>
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

            <!-- APPROVAL_REVISION_PLAN.md §3.5 — one Reason box for the whole
                 order, OPTIONAL, shared by both write paths from this modal:
                 approving with a shortfall (Fase 2) and Unable to Fulfill
                 (Fase 4). Both write it to the same decision_note column. -->
            <div class="form-group" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-color);">
                <label class="form-label" data-i18n="lbl_decision_reason">Reason (optional)</label>
                <textarea id="approve-decision-reason" class="form-control" rows="2" data-i18n-placeholder="hint_decision_reason_ph" placeholder="Why is this order short, or being marked unable to fulfill?"></textarea>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--border-color);">
                <button type="button" id="btn-unable-to-fulfill" class="btn" style="background: transparent; border: 1px solid rgba(239,68,68,0.45); color: var(--danger);" data-order-id="${orderId}" data-i18n="btn_unable_to_fulfill">Unable to Fulfill</button>
                <div style="display: flex; gap: 12px;">
                    <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary" data-i18n="btn_confirm_approve">Confirm Approval</button>
                </div>
            </div>
        </form>
    `;

    openModal(window.t ? window.t('modal_approve_order') : 'Approve Order', htmlContent);

    // APPROVAL_REVISION_PLAN.md Fase 1 (§3.4): recompute + show/hide the
    // shortfall box on every keystroke in any of the 3 fulfillment inputs —
    // must react while typing, not just at submit time. Wired once per row
    // here rather than inside the existing .inp-prod listener below, since
    // that one only concerns machine/origin-row visibility and firing this
    // off it too would couple two unrelated behaviors together.
    function refreshShortfallWarning(row) {
        const requested = parseInt(row.getAttribute('data-requested')) || 0;
        const fVal = parseInt(row.querySelector('.inp-fulfill').value) || 0;
        const bVal = parseInt(row.querySelector('.inp-bulk').value) || 0;
        const pVal = parseInt(row.querySelector('.inp-prod').value) || 0;
        const shortfall = Math.max(0, requested - (fVal + bVal + pVal));
        const box = row.querySelector('.shortfall-warning');
        if (!box) return;
        if (shortfall > 0) {
            const processed = requested - shortfall;
            const qtyLbl = (window.t ? window.t('hint_shortfall_qty') : '{shortfall} of {requested} will not be processed')
                .replace('{shortfall}', shortfall).replace('{processed}', processed).replace('{requested}', requested);
            box.querySelector('.shortfall-warning-qty').textContent = qtyLbl;
            box.classList.remove('hidden');
        } else {
            box.classList.add('hidden');
        }
    }
    document.querySelectorAll('.approval-item-row').forEach(row => {
        refreshShortfallWarning(row); // initial state matches the pre-filled proposal
        ['inp-fulfill', 'inp-bulk', 'inp-prod'].forEach(cls => {
            const inp = row.querySelector('.' + cls);
            if (inp) inp.addEventListener('input', () => refreshShortfallWarning(row));
        });
    });

    // APPROVAL_REVISION_PLAN.md Fase 4 — Unable to Fulfill from the approval
    // modal (§3.2: this button, not a table-row action). Reads the same
    // optional Reason box as a shortfall approval (§3.5).
    const btnUnableToFulfill = document.getElementById('btn-unable-to-fulfill');
    if (btnUnableToFulfill) {
        btnUnableToFulfill.addEventListener('click', async () => {
            if (!await showWarningModal(window.t ? window.t('confirm_unable_to_fulfill') : 'Mark this order Unable to Fulfill? The whole order will stop being processed.', true)) return;
            const reasonEl = document.getElementById('approve-decision-reason');
            const reason = reasonEl ? reasonEl.value.trim() : '';
            await markOrderUnableToFulfill(orderId, reason || null);
        });
    }

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
            // "Fulfill from Packed" is a DECISION, not a pick (user decision
            // 2026-09-16): packing prepares those bags from packed stock and
            // chooses the lots itself in the checkout modal. So approval
            // neither credits quantity_prepared nor deducts any lot — the one
            // deduction happens at packing checkout, against the lots packing
            // actually picks.
            //
            // Until this change approval both deducted fQty (FIFO,
            // consume_packed_lot 'approval_fulfil') and credited it as
            // prepared, so a fully stock-covered order jumped straight to
            // 'Ready for Handover' and showed Dispatch with no packing step at
            // all (68 of 94 recent lines). The old 2026-07-16 double-deduction
            // worry doesn't apply: that came from crediting prepared = 0 while
            // STILL deducting here; now neither happens, and the checkout
            // modal's target (requested − unfulfilled − prepared) makes
            // packing draw each bag exactly once.
            //
            // The promise itself is still protected: other approvals subtract
            // this line's max(0, allocated − prepared) from Packed Stock
            // (packedClaimedElsewhere above), and Sales Request subtracts its
            // outstanding claim (netCodeGroupStock), until packing picks it.
            item.item_status = pQty > 0 ? 'Planned' : 'Packing';

            // APPROVAL_REVISION_PLAN.md Fase 2 / §4 — SAVED, not derived from
            // (requested - allocated - pending) at read time: those two keep
            // changing as packing progresses, so a live subtraction stops
            // meaning "deliberately not processed" within hours of approval.
            // This is the one moment that quantity is actually decided, so
            // it's the one moment it gets written down.
            item.quantity_unfulfilled = Math.max(0, (parseInt(item.quantity_requested) || 0) - (fQty + bQty + pQty));

            await saveData('request_order_items', item);

            // No packed-stock deduction at approval (see the item_status comment
            // above). Packing checkout is the only place packed lots are drawn
            // for an order. The FIFO-flattening rule that used to live here
            // (one date-sorted list across every pooled row, found 2026-08-22)
            // is what the checkout modal's Autofill follows via
            // fifoLotForItemMachine.

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
                // roasting_plans.target_roasted_kg is the ROASTED output the
                // plan must produce — not the green bean it starts from. An
                // order is already expressed in roasted weight (bags of
                // roasted coffee), so it converts straight across: bags ×
                // bag size. The ~15% roasting loss is applied where the
                // green bean is actually worked out (the batch form prefills
                // green = target / 0.85, and the plan's green claim uses the
                // same), so dividing here too counted the loss twice and
                // made every order-derived plan ~17.6% too big (found
                // 2026-09-23: a 36 kg order asked for 42.35 kg roasted and
                // prefilled 49.8 kg of green instead of ~42.4 kg).
                const targetRoast = (pQty * parseInt(item.bag_size_g)) / 1000;

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
        
        // APPROVAL_REVISION_PLAN.md §3.5 / Fase 2 — same optional Reason box
        // Unable to Fulfill reads (§3.5: one column, both write paths).
        // decided_by_* is stamped here too, even for a fully-fulfilled
        // approval with no shortfall, so "who approved this" is on the
        // record the same way Purchase Request already records it —
        // harmless to fill in when there's nothing to explain.
        const reasonElOnSubmit = document.getElementById('approve-decision-reason');
        const reasonOnSubmit = reasonElOnSubmit ? reasonElOnSubmit.value.trim() : '';

        order.status = 'Preparing';
        order.decided_by_id = currentUser ? currentUser.id : null;
        order.decided_by_name = currentUser ? currentUser.name : null;
        order.decided_at = new Date().toISOString();
        order.decision_note = reasonOnSubmit || null;
        await saveData('request_orders', order);

        modalContainer.classList.add('hidden');

        loadHandoverSection();
        scheduleDashboardRefresh();
    });
}

// ============================================================
// APPROVAL_REVISION_PLAN.md Fase 4 — UNABLE TO FULFILL (from approval)
// ============================================================
// Called from the "Unable to Fulfill" button inside the Approve modal
// (§3.2) — reached BEFORE anything is processed: no packed stock cut, no
// bulk reservation, no roasting plan. That's what makes this safe to do
// with a plain write and no unwind logic, unlike the packing-side version
// of the same status in js/packing.js (which DOES have to unwind work
// already done — see stopOrderFromPacking there).
async function markOrderUnableToFulfill(orderId, reason) {
    // §7.3 — re-checked here, not just by hiding the button, same pattern
    // as decidePurchaseRequest in js/purchasing.js.
    if (!hasPermission('dispatch_approval_approve')) {
        await showWarningModal(window.t ? window.t('alert_unable_to_fulfill_denied') : "You don't have permission to decide this order.", false);
        return;
    }

    const [{ data: orders }, { data: items }] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items')
    ]);
    const order = (orders || []).find(o => o.id === orderId);
    if (!order) return;
    const orderItemsForThis = (items || []).filter(i => i.request_order_id === orderId);

    order.status = 'Unable to Fulfill';
    order.decided_by_id = currentUser ? currentUser.id : null;
    order.decided_by_name = currentUser ? currentUser.name : null;
    order.decided_at = new Date().toISOString();
    order.decision_note = reason || null;
    const { error } = await saveData('request_orders', order);
    if (error) {
        alert((window.t ? window.t('alert_order_failed') : "Ordering failed: {msg}").replace("{msg}", error.message));
        return;
    }

    // §3.6 — the whole order is unfulfilled, so every item is, by
    // definition, short its ENTIRE requested quantity. quantity_pending IS
    // already set at submit time (js/sales.js's order-creation code sets it
    // for every new item), so it must be zeroed here along with
    // quantity_allocated / quantity_prepared — nothing was actually
    // processed for a still-Pending order, so none of the three describe
    // real work. Same reset stopOrderFromPacking in js/packing.js already
    // does for the packing-side version of this status.
    for (const item of orderItemsForThis) {
        item.quantity_unfulfilled = parseInt(item.quantity_requested) || 0;
        item.quantity_allocated = 0;
        item.quantity_pending = 0;
        item.quantity_prepared = 0;
        item.item_status = 'Pending Approval';
        await saveData('request_order_items', item);
    }

    const modalCloseBtn = document.getElementById('btn-close-modal');
    if (modalCloseBtn) modalCloseBtn.click();

    loadHandoverSection();
    scheduleDashboardRefresh();
}

// ============================================================
// APPROVAL_REVISION_PLAN.md §3.7 / §5.1 — REOPEN
// ============================================================
// Reverses an Unable to Fulfill order back to Pending Approval, but ONLY if
// nothing downstream has happened since — see the three checks below.
// Called from openOrderDetailPopup's footer. The button there is already
// only rendered when all three come back empty (so a leader normally never
// even sees a Reopen that would fail) — this function re-runs the exact
// same three checks anyway per §7.1, because the write path must never
// trust that the button's render-time state is still true by the time it's
// clicked.
async function canReopenOrder(orderId) {
    const { data: items } = await fetchData('request_order_items');
    const orderItemIds = (items || []).filter(i => i.request_order_id === orderId).map(i => i.id);
    if (orderItemIds.length === 0) return true; // nothing to have touched

    const { data: orders } = await fetchData('request_orders');
    const order = (orders || []).find(o => o.id === orderId);
    const orderNumber = order ? order.order_number : null;

    // Direct filtered queries, not fetchData — these ledger/reservation
    // tables can be large and are only ever needed here as an existence
    // check for one order's items. Same query shape js/packing.js already
    // uses to read packed_stock_movements for undo classification.
    const [movementsRes, reservationsRes, plansRes] = await Promise.all([
        window.supabaseClient.from('packed_stock_movements').select('delta_pcs, packed_coffee_lot_id')
            .eq('ref_table', 'request_order_items').in('ref_id', orderItemIds),
        window.supabaseClient.from('bulk_reservations').select('id')
            .in('request_order_item_id', orderItemIds).limit(1),
        orderNumber
            ? window.supabaseClient.from('roasting_plans').select('id').eq('order_ref', orderNumber).limit(1)
            : Promise.resolve({ data: [] })
    ]);

    // Net per lot, not "did a row ever exist" — a lot that was consumed then
    // fully refunded (net 0) must NOT block Reopen. Only an outstanding (net
    // negative) balance means stock is still actually cut. Mirrors the
    // outstanding = -net convention committedQtyBreakdown uses in
    // js/packing.js.
    const netByLot = new Map();
    for (const m of (movementsRes.data || [])) {
        if (!m.packed_coffee_lot_id) continue;
        netByLot.set(m.packed_coffee_lot_id, (netByLot.get(m.packed_coffee_lot_id) || 0) + (parseInt(m.delta_pcs) || 0));
    }
    const hasOutstandingMovement = [...netByLot.values()].some(net => net < 0);

    const hasReservations = (reservationsRes.data || []).length > 0;
    const hasPlans = (plansRes.data || []).length > 0;
    return !hasOutstandingMovement && !hasReservations && !hasPlans;
}

async function reopenOrder(orderId) {
    if (!hasPermission('dispatch_approval_approve')) {
        await showWarningModal(window.t ? window.t('alert_unable_to_fulfill_denied') : "You don't have permission to decide this order.", false);
        return;
    }

    const canReopen = await canReopenOrder(orderId);
    if (!canReopen) {
        await showWarningModal(window.t ? window.t('alert_reopen_denied') : "This order can no longer be reopened — packing or roasting has already started on it.", false);
        return;
    }

    const { data: orders } = await fetchData('request_orders');
    const order = (orders || []).find(o => o.id === orderId);
    if (!order || order.status !== 'Unable to Fulfill') return;

    order.status = 'Pending Approval';
    order.decided_by_id = null;
    order.decided_by_name = null;
    order.decided_at = null;
    order.decision_note = null;
    const { error } = await saveData('request_orders', order);
    if (error) {
        alert((window.t ? window.t('alert_order_failed') : "Ordering failed: {msg}").replace("{msg}", error.message));
        return;
    }

    const { data: items } = await fetchData('request_order_items');
    const orderItemsForThis = (items || []).filter(i => i.request_order_id === orderId);
    // Restore each item to exactly its submit-time state. quantity_pending
    // must go back to quantity_requested, not stay at the 0 that
    // markOrderUnableToFulfill set: openSalesRequestModal subtracts every
    // Pending/Preparing order's quantity_pending from available packed stock,
    // so a reopened order left at 0 would silently stop claiming its stock.
    for (const item of orderItemsForThis) {
        item.quantity_unfulfilled = 0;
        item.quantity_allocated = 0;
        item.quantity_pending = parseInt(item.quantity_requested) || 0;
        item.quantity_prepared = 0;
        item.item_status = 'Pending Approval';
        await saveData('request_order_items', item);
    }

    const popup = document.getElementById('order-detail-overlay');
    if (popup) popup.classList.add('hidden');

    loadHandoverSection();
    scheduleDashboardRefresh();
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
    // What's New trigger point (moved here from sec-handover navigation per
    // user request 2026-08-31) — fire-and-forget, same idiom as
    // checkStockFreezeBanner, must not block the order modal if it fails.
    // Its own re-show policy (daily cap + 1-week expiry) lives in js/app.js.
    if (window.checkWhatsNewPopup) checkWhatsNewPopup();
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
        { data: codeDefinitions }
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
        fetchData('code_definitions')
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
    // Trade-name claims, keyed by CODE instead of origin id:
    // {type}-{code}-{size}-{machineId}. Every order line created by the
    // current Sales Request modal is a trade-name line — coffee_code set,
    // single_coffee_id / blend_recipe_id both null (verified on production
    // 2026-09-16: all 121 lines since 2026-08-01). The id-keyed maps above
    // could never match those, so until this map existed NO active order
    // was ever subtracted from the stock sales sees here — two agents could
    // promise the same bags and it only surfaced at approval. A trade-name
    // claim can be filled from any origin sharing the code, so it's
    // subtracted from the code GROUP's total (netCodeGroupStock below), not
    // from any one origin.
    const committedCodeByMachine = {};
    (requestOrderItems || []).forEach(item => {
        if (activeOrderIds.includes(item.request_order_id)) {
            if (orderId !== null && item.request_order_id === orderId) return;
            const cId = item.coffee_type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
            // A fully-handed-over item commits nothing further. Otherwise the
            // outstanding claim is recomputed fresh from requested/prepared/
            // unfulfilled — NOT read from quantity_pending, which is only
            // ever set at submit and approval time and is never decremented
            // by a later packing checkout (CHECKOUT_AUTOFILL_PLAN.md §7).
            // Before this fix, a line sitting mid-checkout — some pcs already
            // physically drawn from the lot, item_status still 'Packing' —
            // was double-counted: the stock was genuinely already reduced,
            // AND quantity_pending still reserved the old, larger amount on
            // top of that. Harmless while that mid-checkout window was brief;
            // the Autofill/two-panel checkout feature can now leave a line in
            // that state for days, which is what surfaced this.
            //
            // This still carries forward the 2026-07-16 fix it replaces: a
            // 'Ready for Handover' item reserves nothing further regardless
            // of its own numbers, and a real 0 pcs still owed is never
            // mistaken for "not computed yet" the way `|| quantity_requested`
            // used to.
            const qty = item.item_status === 'Ready for Handover'
                ? 0
                : Math.max(0, (parseInt(item.quantity_requested) || 0) - (parseInt(item.quantity_prepared) || 0) - (parseInt(item.quantity_unfulfilled) || 0));
            if (item.coffee_code) {
                // Machine-partitioned like every other claim here. A line
                // with no machine can't be pinned to one machine's stock, so
                // it isn't subtracted anywhere — same rule the id branch
                // below has always applied.
                if (item.machine_id) {
                    const cKey = `${item.coffee_type}-${item.coffee_code}-${parseFloat(item.bag_size_g)}-${item.machine_id}`;
                    committedCodeByMachine[cKey] = (committedCodeByMachine[cKey] || 0) + qty;
                }
                return;
            }
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

    // Packed stock sales can still promise for a trade-name code on one
    // machine+size: the sum over every origin sharing the code, minus what
    // active orders for that same code+machine+size still claim. The ONE
    // place trade-name availability is computed — the Stock Check table,
    // the Available stock table, and the packed-vs-production split all call
    // this, so they can't disagree about a number.
    const netCodeGroupStock = (type, code, ids, sizeG, machineId) => {
        const size = parseFloat(sizeG);
        const raw = (ids || []).reduce((sum, gid) => sum + (perMachinePackedStocks[`${type}-${gid}-${size}-${machineId}`] || 0), 0);
        const claimed = code ? (committedCodeByMachine[`${type}-${code}-${size}-${machineId}`] || 0) : 0;
        return Math.max(0, raw - claimed);
    };

    // Bulk (already-roasted, not-yet-packed) stock is intentionally NOT
    // shown or computed anywhere in this modal (SALES_ORDER_REDESIGN_PLAN.md
    // Fase 3, §3.3) — bulk allocation is the leader's call alone, decided at
    // approval time (approveSalesOrder's "Fulfill from Bulk" / bulk_reservations),
    // where the leader can see actual physical stock that may differ from
    // what the system shows. What sales sees here is only ever the two-way
    // split "from packed stock" vs "to production" — the "to production"
    // number is therefore a MAXIMUM: the leader may still cover part of it
    // from bulk, which is a disclosed, deliberate discrepancy, not a bug.

    function allocateForRecipe(r, requiredKg, gbAlloc) {
        const ings = (ingredients || []).filter(i => parseInt(i.blend_recipe_id) === r.id);
        ings.forEach(ing => {
            const gbId = parseInt(ing.green_coffee_id);
            const ratio = parseFloat(ing.percentage) / 100;
            gbAlloc[gbId] = (gbAlloc[gbId] || 0) + (requiredKg * ratio);
        });
    }

    // Fase 5 (§4): which single recipe stands in for a blend trade-name code
    // when computing potential production — used by BOTH getPotentialBags
    // below (the fulfillment bar in this modal) and the Potential Production
    // modal (openPotentialProductionModal), so the two can never disagree.
    // Sorted by created_at desc, id desc as the tiebreak (both columns exist
    // — supabase_schema.sql:172-182). Deliberately NOT the recipe with the
    // most raw material (the old behavior, Math.max across every recipe
    // sharing the code) — whichever recipe is actually newest is assumed to
    // be the one production uses, even if that means a lower number here
    // than what's physically still makeable via an older recipe.
    function getLatestRecipeForCode(code) {
        const matching = (recipes || []).filter(rec => rec.code === code);
        if (matching.length === 0) return null;
        return matching.slice().sort((a, b) => {
            const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
            const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
            if (tb !== ta) return tb - ta;
            return (b.id || 0) - (a.id || 0);
        })[0];
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
            // Blend trade-name: capacity comes from whichever recipe sharing
            // this code is newest (getLatestRecipeForCode), not the MAX
            // across all of them — see the comment on that function.
            const code = String(coffeeId).slice(5);
            const latestRecipe = getLatestRecipeForCode(code);
            maxGbKg = latestRecipe ? maxGbKgForRecipe(latestRecipe, gbAllocFromOtherRows) : 0;
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

    // ── Fase 5 (§5.6): Potential Production modal ────────────────────────────
    // A stacked overlay (same pattern as openAddCustomerShortcutModal — its
    // own container/z-index, NOT openModal's shared #modal-container, which
    // would blow away whatever the operator has already filled in on the
    // sales order form behind it). Nested inside openSalesRequestModal on
    // purpose: it reuses codeGroups/blendCodeGroups/recipes/greenbeans/
    // ingredients/machines/perMachinePackedStocks/visibleSizes and the
    // getPotentialBags/getLatestRecipeForCode/maxGbKgForRecipe functions
    // directly from this closure — the only way to GUARANTEE this modal's
    // numbers always match the fulfillment bar on the assembler screen
    // (§4's explicit requirement) is for both to run off one shared snapshot
    // and one shared calculation, not two independently-fetched copies.
    function openPotentialProductionModal() {
        let container = document.getElementById('potential-production-modal-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'potential-production-modal-container';
            container.className = 'overlay';
            container.style.zIndex = '2000';
            document.body.appendChild(container);
        }

        // Unify Single + Blend trade-name codes into one row list. Global
        // numbers only (§5.6: "stok packed global") — deliberately NOT net
        // of this order's in-progress cart, unlike the Available Stock card
        // on the assembler screen, since this modal is a browse-everything
        // view, not tied to one coffee/machine/size selection.
        const rows = [];
        Object.entries(codeGroups).forEach(([code, grp]) => {
            const gbKg = grp.ids.reduce((s, gid) => {
                const g = (greenbeans || []).find(x => x.id === gid);
                return s + (g ? parseFloat(g.stock_kg) || 0 : 0);
            }, 0);
            rows.push({ type: 'Single', code, name: grp.name, ids: grp.ids, gbKg, recipeNote: null });
        });
        Object.entries(blendCodeGroups).forEach(([code, grp]) => {
            const latestRecipe = getLatestRecipeForCode(code);
            const gbKg = latestRecipe ? maxGbKgForRecipe(latestRecipe, {}) : 0;
            const recipeNote = latestRecipe
                ? `${latestRecipe.name}${latestRecipe.created_at ? ' · ' + latestRecipe.created_at.slice(0, 10) : ''}`
                : null;
            rows.push({ type: 'Blend', code, name: grp.name, ids: grp.ids, gbKg, recipeNote });
        });
        rows.sort((a, b) => a.name.localeCompare(b.name));

        const machineList = machines || [];

        const machineHeaderRow = machineList.map(m =>
            `<th colspan="${visibleSizes.length}" style="text-align:center; padding:5px 6px; font-size:0.72rem; color:var(--text-secondary); font-weight:700; border-left:1px solid var(--border); white-space:nowrap;">${m.name}</th>`
        ).join('');
        const sizeHeaderRow = machineList.map(m =>
            visibleSizes.map((s, i) => `<th style="text-align:center; padding:4px 6px; font-size:0.68rem; color:var(--text-muted); font-weight:600; ${i === 0 ? 'border-left:1px solid var(--border);' : ''}">${s.label}</th>`).join('')
        ).join('');

        // Total column group — packed stock summed across every machine,
        // per size. Sits right after the per-machine columns and before the
        // Potential Production group, so "how much do I have altogether"
        // doesn't require the reader to add the machine columns up by hand.
        const totalColLbl = window.t ? window.t('lbl_so_pp_total') : 'Total';
        const totalHeaderCell = `<th colspan="${visibleSizes.length}" style="text-align:center; padding:5px 6px; font-size:0.72rem; color:var(--text-secondary); font-weight:700; border-left:1px solid var(--border); white-space:nowrap;">${totalColLbl}</th>`;
        const totalSizeHeaderRow = visibleSizes.map((s, i) =>
            `<th style="text-align:center; padding:4px 6px; font-size:0.68rem; color:var(--text-muted); font-weight:600; ${i === 0 ? 'border-left:1px solid var(--border);' : ''}">${s.label}</th>`
        ).join('');

        const blendBadgeLbl = window.t ? window.t('lbl_so_pp_blend_badge') : 'blend';
        const bodyRows = rows.map((row, rowIdx) => {
            // Zebra striping — a hue-neutral wash so it reads in both themes
            // without a dedicated token (user request 2026-08-31).
            const rowBg = rowIdx % 2 === 1 ? 'background: rgba(127,127,127,0.06);' : '';
            const badge = row.type === 'Blend'
                ? `<span class="badge badge-blend" style="font-size:0.62rem; padding:1px 6px; margin-left:6px;">${blendBadgeLbl}</span>`
                : '';
            // The underlying recipe name/date (row.recipeNote, still used to
            // pick maxGbKgForRecipe above) is deliberately NOT shown here per
            // user request 2026-08-31 — sales only needs the trade name and
            // code, not which internal recipe backs a blend right now.
            const sizeCells = machineList.map(m =>
                visibleSizes.map((s, i) => {
                    const sz = parseFloat(s.gram);
                    const stock = netCodeGroupStock(row.type, row.code, row.ids, sz, m.id);
                    return `<td style="text-align:center; padding:4px 6px; font-size:0.78rem; ${i === 0 ? 'border-left:1px solid var(--border);' : ''}">${stock}</td>`;
                }).join('')
            ).join('');
            // Same per-size stock lookup as sizeCells above, just summed
            // across every machine instead of scoped to one.
            const totalCells = visibleSizes.map((s, i) => {
                const sz = parseFloat(s.gram);
                const total = machineList.reduce((sum, m) => sum + netCodeGroupStock(row.type, row.code, row.ids, sz, m.id), 0);
                return `<td style="text-align:center; padding:4px 6px; font-size:0.78rem; font-weight:700; ${i === 0 ? 'border-left:1px solid var(--border);' : ''}">${total}</td>`;
            }).join('');
            const yieldKg = row.gbKg * 0.85;
            return `
                <tr style="${rowBg}">
                    <td style="text-align:center; padding:5px 8px; font-family:monospace; color:var(--primary); font-weight:700; font-size:0.78rem; white-space:nowrap;">${row.code}</td>
                    <td style="padding:5px 8px; white-space:nowrap;">
                        <span style="font-size:0.82rem; font-weight:700;">${row.name}</span>${badge}
                    </td>
                    ${sizeCells}
                    ${totalCells}
                    <td style="text-align:center; padding:5px 8px; font-size:0.78rem; border-left:1px solid var(--border);">${row.gbKg.toFixed(1)}</td>
                    <td style="text-align:center; padding:5px 8px; font-size:0.78rem; font-weight:700; color:var(--primary);">${yieldKg.toFixed(1)}</td>
                </tr>
            `;
        }).join('');

        const titleLbl = window.t ? window.t('lbl_potential_production') : 'Potential Production';
        const codeColLbl = window.t ? window.t('lbl_so_pp_code') : 'Code';
        const coffeeColLbl = window.t ? window.t('lbl_so_pp_coffee') : 'Coffee';
        const greenbeanKgLbl = window.t ? window.t('lbl_so_pp_greenbean_kg') : 'Green bean (kg)';
        const yieldKgLbl = window.t ? window.t('lbl_so_pp_yield_kg') : 'Yield (kg)';
        const footerNoteLbl = window.t ? window.t('hint_so_pp_footer') : 'Machine columns show packed stock ready to ship. Potential is green bean stock × 85% yield.';

        container.innerHTML = `
            <div class="overlay-card" style="max-width: 1100px; width: 95vw;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 16px;">
                    <h3 style="font-size: 1.15rem; font-weight: 700;">${titleLbl}</h3>
                    <button type="button" id="btn-close-potential-production" style="background: transparent; border: 0; cursor: pointer; color: var(--text-muted); font-size: 1.5rem; line-height: 1;">&times;</button>
                </div>
                <div style="overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse;">
                        <thead>
                            <tr>
                                <th rowspan="2" style="text-align:center; padding:5px 8px; font-size:0.72rem; color:var(--text-muted); font-weight:600; vertical-align:bottom;">${codeColLbl}</th>
                                <th rowspan="2" style="text-align:left; padding:5px 8px; font-size:0.72rem; color:var(--text-muted); font-weight:600; vertical-align:bottom;">${coffeeColLbl}</th>
                                ${machineHeaderRow}
                                ${totalHeaderCell}
                                <th colspan="2" style="text-align:center; padding:5px 6px; font-size:0.72rem; color:var(--text-secondary); font-weight:700; border-left:1px solid var(--border);">${titleLbl}</th>
                            </tr>
                            <tr>
                                ${sizeHeaderRow}
                                ${totalSizeHeaderRow}
                                <th style="text-align:center; padding:4px 8px; font-size:0.68rem; color:var(--text-muted); font-weight:600; border-left:1px solid var(--border);">${greenbeanKgLbl}</th>
                                <th style="text-align:center; padding:4px 8px; font-size:0.68rem; color:var(--text-muted); font-weight:600;">${yieldKgLbl}</th>
                            </tr>
                        </thead>
                        <tbody>${bodyRows}</tbody>
                    </table>
                </div>
                <div style="font-size:0.7rem; color:var(--text-muted); margin-top:12px; line-height:1.5;">
                    ${footerNoteLbl}
                </div>
            </div>
        `;
        container.classList.remove('hidden');

        const close = () => container.classList.add('hidden');
        document.getElementById('btn-close-potential-production').addEventListener('click', close);
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

    // Selectable customers — restricted to the current role's allowed
    // categories and to active customers. When editing an existing order, the
    // order's own customer is always kept in the list even if it's outside
    // the allowed categories or has since been deactivated, so re-saving an
    // edit can never fail validation or silently swap the order's customer_id
    // (§5.2). This one list feeds BOTH the datalist suggestions and
    // resolveCustomerInput, so what's offered and what's accepted can't drift.
    const { data: customersList } = await fetchData('customers');
    const computeSelectableCustomers = (allCustomers) => {
        let list = filterCustomersByAccess(allCustomers).filter(c => c.is_active !== false);
        if (existingOrder && existingOrder.customer_id != null && !list.some(c => c.id === existingOrder.customer_id)) {
            const existingCust = (allCustomers || []).find(c => c.id === existingOrder.customer_id);
            if (existingCust) list = [...list, existingCust];
        }
        return list;
    };
    let selectableCustomers = computeSelectableCustomers(customersList);
    const existingOrderCustomer = existingOrder && existingOrder.customer_id != null
        ? selectableCustomers.find(c => c.id === existingOrder.customer_id)
        : null;

    // SALES_ORDER_REDESIGN_PLAN.md Fase 0/1: two-column layout (.so-grid,
    // added css/styles.css alongside Stock Release's .sr-grid) — left column
    // assembles ONE item at a time into the cart on the right, instead of a
    // vertical stack of repeated item rows. '95vw' (not a fixed px width)
    // is intentional per the plan: "hampir memenuhi layar" on any monitor
    // size, capped by .overlay-card's own max-height/overflow already in
    // place for tall modals.
    const html = `
        <form id="modal-request-form" novalidate>
            <div id="so-step-form" class="so-grid">
                <div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label" data-i18n="lbl_req_order_no">Order Number</label>
                            <input type="text" id="m-req-orderno" class="form-control" readonly placeholder="Auto Generated" data-i18n-placeholder="ph_req_auto_gen" value="${existingOrder ? existingOrder.order_number : ''}">
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label" data-i18n="lbl_req_agent">Sales Agent Name</label>
                            <div style="display: flex; gap: 6px; align-items: stretch;">
                                <input type="text" id="m-req-sales" class="form-control" readonly style="flex:1; min-width:0;" value="${existingOrder ? existingOrder.sales_name : (currentUser ? currentUser.name : '')}">
                                <button type="button" id="btn-potential-production" class="btn btn-potential" style="flex: 0 0 auto; white-space: nowrap; padding: 0 10px;" title="Potential Production" data-i18n="btn_so_potential">Stock Check</button>
                            </div>
                        </div>
                    </div>

                    <div class="form-group mt-3">
                        <label class="form-label" data-i18n="lbl_req_customer">Customer</label>
                        <div style="display: flex; gap: 8px; align-items: stretch;">
                            <input type="text" id="m-req-customer" class="form-control" list="m-req-customer-list" required autocomplete="off" style="flex: 1; min-width: 0;" placeholder="Type a customer name or number" data-i18n-placeholder="ph_req_customer_search" value="${existingOrderCustomer ? escapeCustomerAttr(customerDisplayText(existingOrderCustomer)) : ''}">
                            <datalist id="m-req-customer-list">${buildCustomerDatalistHtml(selectableCustomers)}</datalist>
                            <button type="button" id="btn-req-add-customer" class="btn btn-add-customer" style="flex: 0 0 auto; white-space: nowrap;" title="Add new customer" data-i18n="btn_req_add_customer">Add New</button>
                        </div>
                    </div>

                    <div id="so-assembler-block">
                        <div style="display:flex; align-items:center; gap:10px; margin: 18px 0 12px;">
                            <div class="so-heading-line" style="flex:1; height:1px; background:var(--border);"></div>
                            <span id="so-left-heading" style="font-size:0.72rem; color:var(--text-muted); display:flex; align-items:center; gap:5px;" data-i18n="lbl_so_add_item_heading">Add item</span>
                            <div class="so-heading-line" style="flex:1; height:1px; background:var(--border);"></div>
                        </div>

                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                            <div class="form-group" style="margin-bottom:0;">
                                <label class="form-label label-xs-nowrap" data-i18n="lbl_req_coffee_sel">Coffee Selection</label>
                                <select id="so-item-coffee" class="form-control">
                                    ${coffeeOptionsHtml}
                                </select>
                            </div>
                            <div class="form-group" style="margin-bottom:0;">
                                <label class="form-label label-xs-nowrap" data-i18n="lbl_req_machine">Machine</label>
                                <select id="so-item-machine" class="form-control">
                                    ${machineOptionsHtml}
                                </select>
                            </div>
                        </div>
                        <div style="display:grid; grid-template-columns: 1fr 110px; gap: 10px; margin-top:10px;">
                            <div class="form-group" style="margin-bottom:0;">
                                <label class="form-label label-xs-nowrap" data-i18n="lbl_req_size">Bag Weight Size</label>
                                <select id="so-item-size" class="form-control">
                                    ${sizeOptionsHtml}
                                </select>
                            </div>
                            <div class="form-group" style="margin-bottom:0;">
                                <label class="form-label label-xs-nowrap" data-i18n="lbl_req_qty">Order Quantity (Bags)</label>
                                <input type="number" id="so-item-qty" class="form-control" min="1" value="1">
                            </div>
                        </div>

                        <div id="so-item-info-box" style="width: 100%; margin-top: 10px; font-size: 0.75rem; color: var(--text-secondary); background: rgba(0,0,0,0.2); padding: 8px 10px; border-radius: 6px; display: none; line-height: 1.2;"></div>

                        <div style="display:flex; gap:8px; margin-top: 12px;">
                            <button type="button" id="btn-so-add-item" class="btn btn-secondary" style="flex:1;" data-i18n="btn_so_add_to_list">
                                + Add to list
                            </button>
                            <button type="button" id="btn-so-cancel-edit" class="btn btn-secondary" style="flex: 0 0 auto; display:none;" data-i18n="btn_cancel">
                                Cancel
                            </button>
                        </div>
                    </div>

                    <div id="so-locked-notice" class="hidden" style="margin-top: 18px; padding: 14px 16px; border-radius: 10px; background: rgba(29,78,216,0.08); border: 1px solid rgba(29,78,216,0.3); display:flex; gap:10px; align-items:flex-start;">
                        <div>
                            <div style="font-weight:700; font-size:0.85rem; color:#1d4ed8;" data-i18n="lbl_so_locked_title">Order locked</div>
                            <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:2px;" data-i18n="lbl_so_locked_desc">This order is already Preparing/Approved — items can't be added or removed. Adjust quantities directly in the cart on the right.</div>
                        </div>
                    </div>
                </div>

                <div class="so-panel">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                        <span style="font-size:0.85rem; font-weight:700;" data-i18n="lbl_req_items_list">Order Items</span>
                        <span id="sales-cart-count" style="font-size:0.7rem; color:var(--primary); background:var(--primary-glow); border-radius:20px; padding:2px 9px;"></span>
                    </div>
                    <div id="so-cart-edit-hint"></div>
                    <div id="sales-cart-list" class="so-cart-scroll"></div>

                    <div class="form-group" style="margin:12px 0 0;">
                        <label class="form-label" data-i18n="lbl_req_notes">Order Notes / Customer Info</label>
                        <input type="text" id="m-req-notes" class="form-control" placeholder="e.g. Customer Coffee Shop Gayo" data-i18n-placeholder="ph_req_notes" value="${existingOrder ? (existingOrder.notes || '') : ''}">
                    </div>

                    <div style="display:flex; align-items:baseline; justify-content:space-between; border-top:1px solid var(--border); padding-top:10px; margin-top:12px;">
                        <span style="font-size:0.8rem; color:var(--text-secondary);" data-i18n="lbl_so_cart_total">Total</span>
                        <span id="so-cart-total" style="font-size:1.5rem; font-weight:700; color:var(--primary);">0</span>
                    </div>

                    <div style="display:flex; gap:8px; margin-top:14px;">
                        <button type="button" class="btn btn-secondary" style="flex:1;" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                        <button type="submit" class="btn btn-primary" style="flex:1.5;" data-i18n="${orderId !== null ? 'btn_so_review_changes' : 'btn_so_review_order'}">${orderId !== null ? 'Review Changes' : 'Review Order'}</button>
                    </div>
                </div>
            </div>

            <div id="so-step-confirm" class="hidden" style="max-width:640px; margin:0 auto;"></div>
        </form>
    `;

    const titleStr = orderId !== null
        ? (window.t ? window.t('modal_edit_sales_req') : 'Edit Sales Request')
        : (window.t ? window.t('modal_submit_req') : 'Submit Sales Request Order');
    openModal(titleStr, html, '95vw');

    const agentInput = document.getElementById('m-req-sales');
    const orderNoInput = document.getElementById('m-req-orderno');
    const customerInput = document.getElementById('m-req-customer');

    // "+ Add Customer" shortcut — opens in its own stacked overlay (see
    // openAddCustomerShortcutModal) so this Request Order form and whatever
    // the user already filled in stay open underneath. Once saved, the new
    // customer is added to the suggestions AND to selectableCustomers (so it
    // passes resolveCustomerInput at submit, §5.3), and filled in.
    document.getElementById('btn-req-add-customer').addEventListener('click', () => {
        openAddCustomerShortcutModal((newCustomer) => {
            if (!newCustomer) return;
            fetchData('customers').then(({ data: freshCustomers }) => {
                // newCustomer was just created via openAddCustomerShortcutModal, which
                // already restricts the type choice to allowedCustomerTypes() — so it's
                // always inside the filtered set below.
                selectableCustomers = computeSelectableCustomers(freshCustomers);
                const listEl = document.getElementById('m-req-customer-list');
                if (listEl) listEl.innerHTML = buildCustomerDatalistHtml(selectableCustomers);
                const created = selectableCustomers.find(c => c.id === newCustomer.id);
                if (created) {
                    customerInput.value = customerDisplayText(created);
                    // Clears any "not in list" bubble left from an earlier attempt.
                    customerInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
        });
    });

    document.getElementById('btn-potential-production').addEventListener('click', () => {
        openPotentialProductionModal();
    });

    // ── Order Number Generation ──────────────────────────────────────────────
    // The sales agent is now the logged-in user (readonly, prefilled) rather
    // than a typed field, so generate the order number once on open instead
    // of on input.
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
            // Read the trailing DDMMYY + 3-digit sequence, whatever the prefix is.
            //
            // This used to be anchored as /^[A-Z0-9]+(\d{6})(\d{3})$/ — ASCII
            // letters only. An agent code in Arabic (مح, ما, …) never matched,
            // so those numbers were invisible to this scan and the sequence
            // restarted from whatever the Latin-prefixed orders had reached.
            // That produced two real orders both numbered ما080926007 on
            // 2026-09-08 (ids 80 and 81, ten minutes apart), which in turn
            // made roasting_plans.order_ref ambiguous between them.
            //
            // Anchoring on the END instead of the start sidesteps the prefix
            // charset entirely, and stays correct even when the agent code
            // itself contains digits (e.g. "S1" from "Sale 101").
            let maxSeq = 0;
            (requestOrders || []).forEach(o => {
                if (o.order_number) {
                    const match = String(o.order_number).match(/(\d{6})(\d{3})$/);
                    if (match && match[1] === datePart) { const s = parseInt(match[2]); if (s > maxSeq) maxSeq = s; }
                }
            });
            orderNoInput.value = `${agentCode}${datePart}${String(maxSeq + 1).padStart(3, '0')}`;
        }
    }

    // ── Cart model (SALES_ORDER_REDESIGN_PLAN.md Fase 1) ─────────────────────
    // Replaces the old one-<div>-per-item DOM row list (addSalesItemRow).
    // Each entry stores its own coffee/machine/size/qty plus the stock
    // numbers computed for it (packedStock/potentialBags) —
    // computed synchronously, not read off a DOM dataset a 500ms-debounced
    // pass wrote. That debounce was a real latent bug: submitting within
    // 500ms of typing a qty read an unset dataset value as 0 and could wrongly
    // treat a fully-stocked order as short (§3.1). The debounce is kept only
    // for the LEFT FORM's own live preview redraw further down — Add to list
    // and Submit both always read/compute synchronously, never off a timer.
    const isApprovedEdit = existingOrder && (existingOrder.status === 'Preparing' || existingOrder.status === 'Approved');
    let cartIdSeq = 1;
    const cart = new Map();
    // Fase 2 — non-null while the left form is editing an existing (unlocked)
    // cart entry instead of assembling a new one. Save then overwrites that
    // entry in place (Map.set on an existing key keeps its original
    // position, so the cart's on-screen order never reshuffles from an edit).
    let editingCartId = null;

    const selCoffee = document.getElementById('so-item-coffee');
    const selMachine = document.getElementById('so-item-machine');
    const selSize = document.getElementById('so-item-size');
    const inpQty = document.getElementById('so-item-qty');
    const infoBox = document.getElementById('so-item-info-box');
    const btnAddItem = document.getElementById('btn-so-add-item');
    const btnCancelEdit = document.getElementById('btn-so-cancel-edit');
    const cartListEl = document.getElementById('sales-cart-list');
    const cartCountEl = document.getElementById('sales-cart-count');
    const cartTotalEl = document.getElementById('so-cart-total');
    const cartEditHintEl = document.getElementById('so-cart-edit-hint');

    // "Click a card to edit it" bubble — shown for 15s after every successful
    // Add to list (cart cards no longer carry their own Edit button, see
    // renderCart; user feedback 2026-08-31), dismissible early via its own ×.
    let cartEditHintTimer = null;
    function showCartEditHint() {
        if (!cartEditHintEl) return;
        if (cartEditHintTimer) clearTimeout(cartEditHintTimer);
        const msg = window.t ? window.t('hint_so_cart_click_edit') : 'Click a card to edit it';
        cartEditHintEl.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; background:var(--primary-glow); border:1px solid var(--primary); border-radius:8px; padding:7px 10px; margin-bottom:8px; font-size:0.75rem; color:var(--text-secondary);">
                <span>💡 ${msg}</span>
                <button type="button" id="so-cart-edit-hint-close" style="background:transparent; border:0; cursor:pointer; color:var(--text-muted); font-size:1rem; line-height:1; padding:0; flex:0 0 auto;">&times;</button>
            </div>
        `;
        const closeBtn = document.getElementById('so-cart-edit-hint-close');
        if (closeBtn) closeBtn.addEventListener('click', hideCartEditHint);
        cartEditHintTimer = setTimeout(hideCartEditHint, 15000);
    }
    function hideCartEditHint() {
        if (cartEditHintTimer) { clearTimeout(cartEditHintTimer); cartEditHintTimer = null; }
        if (cartEditHintEl) cartEditHintEl.innerHTML = '';
    }
    const leftHeadingEl = document.getElementById('so-left-heading');
    const assemblerBlockEl = document.getElementById('so-assembler-block');
    const stepForm = document.getElementById('so-step-form');
    const stepConfirm = document.getElementById('so-step-confirm');

    // ── Reactive Stock Allocation (Layer 2 & 3), now reading the cart ───────
    function getAllocations() {
        // Keyed by coffee+size+machine — packed stock from different
        // machines is not interchangeable (same rule as the 5 lookups fixed
        // 2026-07-15 in approveSalesOrder/loadPackingRequestsSection/etc.),
        // so two cart entries for the same coffee+size but different
        // machines must NOT share one reservation pool. An entry with no
        // machine picked falls under a shared 'none' bucket, which simply
        // won't match any real per-machine stock key.
        const alloc = {};
        cart.forEach((entry) => {
            if (!entry.coffeeVal || entry.qty <= 0) return;
            const machineKey = entry.machineId || 'none';
            const key = `${entry.coffeeVal}-${entry.sizeG}-${machineKey}`;
            alloc[key] = (alloc[key] || 0) + entry.qty;
        });
        return alloc;
    }

    // Greenbean claims from every OTHER cart entry — excludeCartId lets a
    // committed entry exclude its own claim when recomputing itself, same
    // as the old excludeRow param; the in-progress left-form preview passes
    // null (nothing to exclude, it isn't in the cart yet).
    function getGreenbeanAllocations(excludeCartId = null) {
        const gbAlloc = {};
        cart.forEach((entry, cartId) => {
            if (cartId === excludeCartId) return;
            if (!entry.coffeeVal || entry.qty <= 0) return;
            const requiredKg = (entry.qty * entry.sizeG) / 1000 / 0.85;
            const [type, idStr] = entry.coffeeVal.split('-');
            const coffeeId = idStr.startsWith('CODE:') ? idStr : parseInt(idStr);
            if (type === 'Single') {
                gbAlloc[coffeeId] = (gbAlloc[coffeeId] || 0) + requiredKg;
            } else if (String(coffeeId).startsWith('CODE:')) {
                const code = String(coffeeId).slice(5);
                (recipes || []).filter(rec => rec.code === code).forEach(r => allocateForRecipe(r, requiredKg, gbAlloc));
            } else {
                const r = (recipes || []).find(rec => rec.id === coffeeId);
                if (r) allocateForRecipe(r, requiredKg, gbAlloc);
            }
        });
        return gbAlloc;
    }

    // Packed -> raw-green-bean (production) waterfall, parameterized so it
    // runs against either a committed cart entry (during a full recompute)
    // or the in-progress left-form selection (for the live preview, before
    // it's added). Returns both the info-box HTML and the raw numbers
    // stored on cart entries. Bulk is deliberately absent (Fase 3, §3.3) —
    // see the note above the fetch this function's inputs come from.
    function computeSelectionTiers(coffeeVal, machineId, sizeG, qty, totalAlloc, gbAllocFromOtherRows) {
        if (!coffeeVal || !sizeG) return null;
        const [type, idStr] = coffeeVal.split('-');
        const isGroup = idStr.startsWith('CODE:');
        const coffeeId = isGroup ? idStr : parseInt(idStr);
        // Trade-name product (V2): no single origin/recipe to break stock
        // down by, but still per-machine — each machine's number is the SUM
        // of every origin (Single) or recipe (Blend) sharing the code that
        // landed on that machine, instead of one coffee id's own stock.
        const groupIds = isGroup
            ? (type === 'Single'
                ? (greenbeans || []).filter(g => g.code === idStr.slice(5)).map(g => g.id)
                : (recipes || []).filter(r => r.code === idStr.slice(5)).map(r => r.id))
            : [];
        const selectedMachineId = machineId || null;
        const currentQty = qty || 0;

        // 1. "Available stock" table (§5.3) — one row per machine, one
        // column per active bag size, closed with a Total row. Numbers are
        // already net of what OTHER cart entries claim for that exact
        // coffee+size+machine, so two entries can't both show the full
        // stock and jointly overcommit it (reported live 2026-07-16: two
        // rows for the same coffee+size+machine both showed the full 3 in
        // stock even after the first already claimed 2 of it).
        const coffeeName = coffeeLabelFor(coffeeVal);
        const totalsBySize = {};
        let tableRowsHtml = '';
        (machines || []).forEach(m => {
            const isActiveMachine = selectedMachineId === m.id;
            tableRowsHtml += `<tr style="${isActiveMachine ? 'background: var(--primary-glow);' : ''}">`;
            tableRowsHtml += `<td style="padding:3px 6px; white-space:nowrap; font-size:0.72rem; ${isActiveMachine ? 'color:var(--primary); font-weight:700;' : 'color:var(--text-secondary);'}">${isActiveMachine ? '▸ ' : ''}${m.name}</td>`;
            visibleSizes.forEach(s => {
                const sz = parseFloat(s.gram);
                const rawMachStock = isGroup
                    ? netCodeGroupStock(type, idStr.slice(5), groupIds, sz, m.id)
                    : (perMachinePackedStocks[`${type}-${coffeeId}-${sz}-${m.id}`] || 0);
                const allocKey = `${coffeeVal}-${sz}-${m.id}`;
                const totalAllocForKey = totalAlloc[allocKey] || 0;
                const allocByThisForKey = (isActiveMachine && sz === sizeG) ? currentQty : 0;
                const otherAllocForKey = Math.max(0, totalAllocForKey - allocByThisForKey);
                const machStock = Math.max(0, rawMachStock - otherAllocForKey);
                totalsBySize[sz] = (totalsBySize[sz] || 0) + machStock;
                const isSelectedCell = isActiveMachine && sz === sizeG;
                const cellStyle = isSelectedCell ? 'color:var(--primary); font-weight:700;' : 'color:var(--text-primary);';
                tableRowsHtml += `<td style="text-align:right; padding:3px 6px; font-size:0.72rem; ${cellStyle}">${machStock}</td>`;
            });
            tableRowsHtml += `</tr>`;
        });
        const totalLbl = window.t ? window.t('lbl_so_cart_total') : 'Total';
        let totalRowHtml = `<tr style="border-top:1px solid var(--border);"><td style="padding:3px 6px; font-size:0.72rem; font-weight:700;">${totalLbl}</td>`;
        visibleSizes.forEach(s => {
            const sz = parseFloat(s.gram);
            totalRowHtml += `<td style="text-align:right; padding:3px 6px; font-size:0.72rem; font-weight:700;">${totalsBySize[sz] || 0}</td>`;
        });
        totalRowHtml += `</tr>`;
        const availableStockLbl = window.t ? window.t('lbl_so_available_stock') : 'Available stock';
        const machineLbl = window.t ? window.t('lbl_req_machine') : 'Machine';
        const tableHtml = `
            <div style="font-size:0.72rem; font-weight:700; color:var(--text-secondary); margin-bottom:4px;">${availableStockLbl} &mdash; ${coffeeName}</div>
            <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr>
                            <th style="text-align:left; padding:3px 6px; font-size:0.68rem; color:var(--text-muted); font-weight:600; white-space:nowrap;">${machineLbl}</th>
                            ${visibleSizes.map(s => `<th style="text-align:right; padding:3px 6px; font-size:0.68rem; color:var(--text-muted); font-weight:600;">${s.label}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>${tableRowsHtml}${totalRowHtml}</tbody>
                </table>
            </div>
        `;

        // Aggregate for the selected machine+size specifically (subtract
        // other entries' allocations) — machine-partitioned: no machine
        // picked yet means no real per-machine stock to draw from, so it's
        // 0 until one is picked.
        let currentSizeAvailPacked = 0;
        {
            const stockKey = `${coffeeVal}-${sizeG}-${selectedMachineId || 'none'}`;
            const totalAllocForThisSize = totalAlloc[stockKey] || 0;
            const allocByThis = currentQty;
            const otherAlloc = Math.max(0, totalAllocForThisSize - allocByThis);
            const totalPacked = selectedMachineId
                ? (isGroup
                    ? netCodeGroupStock(type, idStr.slice(5), groupIds, sizeG, selectedMachineId)
                    : (perMachinePackedStocks[`${type}-${coffeeId}-${sizeG}-${selectedMachineId}`] || 0))
                : 0;
            currentSizeAvailPacked = Math.max(0, totalPacked - otherAlloc);
        }

        // 2. Potential production in bags (raw green bean, needs roasting)
        const potentialBags = getPotentialBags(type, coffeeId, sizeG, gbAllocFromOtherRows);

        // Two-tier coverage of THIS selection's own qty: packed first, then
        // production. What leaves this modal as "to production" is a
        // MAXIMUM — the leader may still cover part of it from bulk at
        // approval, which this modal never sees (see note above the fetch).
        const tierPacked = Math.min(currentQty, currentSizeAvailPacked);
        const tierRoast = Math.min(Math.max(currentQty - currentSizeAvailPacked, 0), potentialBags);
        const tierShort = Math.max(currentQty - currentSizeAvailPacked - potentialBags, 0);
        const barTotal = Math.max(currentQty, 1);

        let barHtml = '<div style="display:flex; height:7px; border-radius:4px; overflow:hidden; margin-top:6px; background:rgba(255,255,255,0.08);">';
        if (tierPacked > 0) barHtml += `<div style="background:#1D9E75; width:${(tierPacked / barTotal * 100).toFixed(1)}%;"></div>`;
        if (tierRoast > 0) barHtml += `<div style="background:#EF9F27; width:${(tierRoast / barTotal * 100).toFixed(1)}%;"></div>`;
        if (tierShort > 0) barHtml += `<div style="background:#E24B4A; width:${(tierShort / barTotal * 100).toFixed(1)}%;"></div>`;
        barHtml += '</div>';

        const readyLbl = window.t ? window.t('lbl_tier_ready') : 'ready';
        const roastLbl = window.t ? window.t('lbl_tier_roast') : 'needs roasting';
        const shortLbl = window.t ? window.t('lbl_tier_short') : 'short by';

        const parts = [];
        if (tierPacked > 0) parts.push(`<span style="color:#5DCAA5; font-weight:700;">${tierPacked}</span> ${readyLbl}`);
        if (tierRoast > 0) parts.push(`<span style="color:#EF9F27; font-weight:700;">${tierRoast}</span> ${roastLbl}`);
        let tierLine = parts.length ? parts.join(' &middot; ') : '';
        if (tierShort > 0) {
            tierLine += `${tierLine ? ' &middot; ' : ''}<span style="color:#E24B4A; font-weight:700;">${tierShort} ${shortLbl}</span>`;
        }

        // The fulfillment tier line + bar assume a specific machine's packed
        // stock (currentSizeAvailPacked is forced to 0 above when none is
        // picked yet) — showing "needs roasting" before a machine is chosen
        // would be reading a number that isn't real yet. Show a plain hint
        // instead until Machine has a value (found via user feedback
        // 2026-08-31: the bar was rendering with no machine selected).
        let tierSectionHtml;
        if (selectedMachineId) {
            tierSectionHtml = `
                <div style="margin-top: 4px; padding-top: 3px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 0.75rem; line-height: 1.2;">${tierLine}</div>
                ${barHtml}
            `;
        } else {
            const selectMachineHintLbl = window.t ? window.t('hint_so_select_machine_first') : 'Select a machine to see the fulfillment breakdown.';
            tierSectionHtml = `<div style="margin-top: 4px; padding-top: 3px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 0.72rem; color: var(--text-muted); font-style: italic;">${selectMachineHintLbl}</div>`;
        }

        const html = `
            ${tableHtml}
            ${tierSectionHtml}
        `;

        return { html, packedStock: currentSizeAvailPacked, potentialBags, tierShort };
    }

    // Recomputes packedStock/potentialBags for EVERY cart entry — called
    // after any add/remove/qty-edit, mirroring the old debounced all-rows
    // recompute so an earlier entry's numbers never go stale once a later
    // entry claims some of the same stock. This is what makes the stored
    // numbers safe to read synchronously at submit time.
    function recomputeCartStock() {
        const totalAlloc = getAllocations();
        cart.forEach((entry, cartId) => {
            const gbAlloc = getGreenbeanAllocations(cartId);
            const result = computeSelectionTiers(entry.coffeeVal, entry.machineId, entry.sizeG, entry.qty, totalAlloc, gbAlloc);
            if (result) {
                entry.packedStock = result.packedStock;
                entry.potentialBags = result.potentialBags;
            }
        });
    }

    let previewTimer = null;
    function schedulePreview() {
        if (!selCoffee.value) {
            infoBox.style.display = 'none';
            if (previewTimer) clearTimeout(previewTimer);
            return;
        }
        infoBox.style.display = 'block';
        const checkingText = window.t ? window.t('lbl_stock_checking') : 'Stock Checking...';
        infoBox.innerHTML = `<span style="display:inline-block; animation: spin 1s linear infinite; margin-right: 5px;">⏳</span> ${checkingText}`;
        if (previewTimer) clearTimeout(previewTimer);
        previewTimer = setTimeout(renderPreviewNow, 500);
    }

    // Small red bubble under the Qty field warning that even production
    // (not just packed stock) can't cover the typed quantity — i.e. current
    // green bean stock is likely insufficient. Separate from the tier
    // line/bar inside the info box below: that one can be scrolled past,
    // this sits right where the operator is typing (user feedback
    // 2026-08-31).
    function showQtyShortBubble() {
        let bubble = document.getElementById('so-qty-short-warn');
        if (!bubble) {
            inpQty.parentElement.style.position = 'relative';
            bubble = document.createElement('div');
            bubble.id = 'so-qty-short-warn';
            bubble.style = 'position:absolute; bottom:-38px; right:0; width:220px; background:var(--danger); color:#fff; padding:5px 8px; border-radius:4px; font-size:0.68rem; font-weight:600; line-height:1.35; z-index:10; box-shadow:0 2px 5px rgba(0,0,0,0.25);';
            inpQty.parentElement.appendChild(bubble);
        }
        const msg = window.t ? window.t('hint_so_qty_exceeds_potential') : 'This quantity may exceed what current green bean stock can produce.';
        bubble.innerHTML = `⚠️ ${msg}`;
    }
    function hideQtyShortBubble() {
        const bubble = document.getElementById('so-qty-short-warn');
        if (bubble) bubble.remove();
    }

    // Purely visual — the debounce only controls how often this redraws
    // while the operator is still typing. Add to list (below) always
    // computes synchronously, so what gets stored on a cart entry can never
    // race this timer.
    function renderPreviewNow() {
        const coffeeVal = selCoffee.value;
        if (!coffeeVal) { infoBox.style.display = 'none'; hideQtyShortBubble(); return; }
        const machineId = selMachine.value ? parseInt(selMachine.value) : null;
        const sizeG = parseInt(selSize.value) || 0;
        const qty = parseInt(inpQty.value) || 0;
        const totalAlloc = getAllocations();
        const gbAlloc = getGreenbeanAllocations(null);
        const result = computeSelectionTiers(coffeeVal, machineId, sizeG, qty, totalAlloc, gbAlloc);
        if (result) {
            infoBox.style.display = 'block';
            infoBox.innerHTML = result.html;
            // Same "no machine yet" gate as the tier bar itself — packedStock
            // is forced to 0 without one, so tierShort isn't a real number.
            if (machineId && result.tierShort > 0) showQtyShortBubble();
            else hideQtyShortBubble();
        }
    }

    selCoffee.addEventListener('change', schedulePreview);
    selMachine.addEventListener('change', schedulePreview);
    selSize.addEventListener('change', schedulePreview);
    inpQty.addEventListener('input', schedulePreview);

    function coffeeLabelFor(coffeeVal) {
        const [type, idStr] = coffeeVal.split('-');
        if (idStr.startsWith('CODE:')) {
            const code = idStr.slice(5);
            const grp = type === 'Single' ? codeGroups[code] : blendCodeGroups[code];
            return grp ? grp.name : `Code ${code}`;
        }
        const id = parseInt(idStr);
        if (type === 'Single') {
            const g = (greenbeans || []).find(x => x.id === id);
            return g ? g.name : 'Single Origin';
        }
        const r = (recipes || []).find(x => x.id === id);
        return r ? r.name : 'Blend Recipe';
    }

    function machineLabelFor(machineId) {
        if (!machineId) return '-';
        const m = (machines || []).find(x => x.id === machineId);
        return m ? m.name : '-';
    }

    function renderCart() {
        cartCountEl.textContent = cart.size;

        if (cart.size === 0) {
            const emptyLbl = window.t ? window.t('lbl_so_cart_empty') : 'No items yet — assemble one on the left and click Add to list.';
            cartListEl.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">${emptyLbl}</div>`;
            cartTotalEl.textContent = '0';
            return;
        }

        const editingLbl = window.t ? window.t('lbl_so_cart_editing') : 'Editing…';

        let html = '';
        let totalQty = 0;
        cart.forEach((entry) => {
            totalQty += entry.qty;
            const name = coffeeLabelFor(entry.coffeeVal);
            const machineName = machineLabelFor(entry.machineId);
            const shortfall = Math.max(0, entry.qty - entry.packedStock);
            const isShort = shortfall > 0;
            const isEditing = entry.cartId === editingCartId;
            const borderStyle = isEditing ? 'border:1px solid var(--primary); box-shadow: 0 0 0 1px var(--primary);' : 'border:1px solid var(--border);';
            const bgStyle = isEditing ? 'background: var(--primary-glow);' : (isShort ? 'background: rgba(239,158,39,0.08);' : '');
            // Whole card is the edit trigger now (see click delegation below)
            // — the old per-card "Edit" button was easy to miss (user
            // feedback 2026-08-31); replaced with the so-cart-edit-hint
            // bubble shown once after Add to list instead. Locked entries
            // (Preparing/Approved edit) keep their own direct qty-input and
            // are never clickable into edit mode.
            html += `
                <div class="${entry.locked ? '' : 'so-cart-card'}" data-cart-id="${entry.cartId}" style="${borderStyle} border-radius:8px; padding:8px 10px; margin-bottom:8px; ${bgStyle} ${entry.locked ? '' : 'cursor:pointer;'}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <div style="font-size:0.85rem; font-weight:700; line-height:1.3;">${name}</div>
                        <div style="display:flex; align-items:center; gap:6px; flex:0 0 auto;">
                            ${(!entry.locked && isEditing) ? `<span style="color:var(--primary); font-size:0.7rem; font-weight:700;">${editingLbl}</span>` : ''}
                            ${entry.locked ? '' : `<button type="button" class="btn-cart-remove" data-cart-id="${entry.cartId}" style="background:transparent; border:0; cursor:pointer; color:var(--text-muted); font-size:1.1rem; line-height:1; padding:0;">&times;</button>`}
                        </div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
                        <span style="font-size:0.72rem; color:var(--text-muted);">${machineName} &middot; ${entry.sizeG}g</span>
                        ${entry.locked
                            ? `<input type="number" class="form-control cart-qty-input" data-cart-id="${entry.cartId}" value="${entry.qty}" min="0" style="width:70px; height:28px; text-align:center;">`
                            : `<span style="font-size:0.85rem; font-weight:700;">${entry.qty}</span>`}
                    </div>
                    ${isShort ? `<div style="font-size:0.68rem; color:#EF9F27; margin-top:4px;">${shortfall} ${window.t ? window.t('lbl_tier_roast') : 'needs roasting'}</div>` : ''}
                </div>
            `;
        });
        cartListEl.innerHTML = html;
        cartTotalEl.textContent = totalQty;

        cartListEl.querySelectorAll('.btn-cart-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // don't also trigger the card's click-to-edit
                const cartId = parseInt(btn.getAttribute('data-cart-id'));
                // Removing the entry currently being edited would leave Save
                // pointing at a deleted key — back out of edit mode first so
                // the left form doesn't silently resurrect it.
                if (cartId === editingCartId) exitEditMode();
                cart.delete(cartId);
                recomputeCartStock();
                renderCart();
            });
        });
        cartListEl.querySelectorAll('.so-cart-card').forEach(card => {
            card.addEventListener('click', () => {
                const cartId = parseInt(card.getAttribute('data-cart-id'));
                hideCartEditHint(); // the operator just discovered it
                enterEditMode(cartId);
            });
        });
        cartListEl.querySelectorAll('.cart-qty-input').forEach(inp => {
            inp.addEventListener('input', () => {
                const cartId = parseInt(inp.getAttribute('data-cart-id'));
                const entry = cart.get(cartId);
                if (!entry) return;
                entry.qty = parseInt(inp.value) || 0;
                recomputeCartStock();
                // Don't re-render the whole cart on every keystroke (would
                // steal focus from the input mid-type) — just refresh the total.
                let sum = 0;
                cart.forEach(e => sum += e.qty);
                cartTotalEl.textContent = sum;
            });
        });
    }

    // ── Edit-from-cart (SALES_ORDER_REDESIGN_PLAN.md Fase 2) ─────────────────
    // Only reachable for unlocked entries (see renderCart — the Edit button
    // is omitted entirely for locked ones, which already have their own
    // direct qty-input editing from Fase 1).
    function enterEditMode(cartId) {
        const entry = cart.get(cartId);
        if (!entry) return;
        editingCartId = cartId;

        selCoffee.value = entry.coffeeVal;
        selMachine.value = entry.machineId || '';
        selSize.value = entry.sizeG;
        inpQty.value = entry.qty;

        if (leftHeadingEl) leftHeadingEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>` + (window.t ? window.t('lbl_so_edit_item_heading') : 'Edit item');
        btnAddItem.textContent = window.t ? window.t('btn_so_save_changes') : 'Save changes';
        btnAddItem.classList.remove('btn-secondary');
        btnAddItem.classList.add('btn-primary');
        btnCancelEdit.style.display = '';
        // The heading text alone was too easy to miss (found via user
        // feedback 2026-08-31) — frame the whole assembler panel in the same
        // primary color used for the "being edited" cart card on the right,
        // so entering edit mode is unmistakable at a glance, not just a
        // small label swap.
        if (assemblerBlockEl) assemblerBlockEl.classList.add('so-editing-mode');

        renderPreviewNow();
        renderCart(); // re-render so the card being edited gets marked
    }

    function exitEditMode() {
        editingCartId = null;
        selCoffee.value = '';
        selMachine.value = '';
        selSize.selectedIndex = 0;
        inpQty.value = 1;
        infoBox.style.display = 'none';
        hideQtyShortBubble();

        if (leftHeadingEl) leftHeadingEl.textContent = window.t ? window.t('lbl_so_add_item_heading') : 'Add item';
        btnAddItem.textContent = window.t ? window.t('btn_so_add_to_list') : '+ Add to list';
        btnAddItem.classList.remove('btn-primary');
        btnAddItem.classList.add('btn-secondary');
        btnCancelEdit.style.display = 'none';
        if (assemblerBlockEl) assemblerBlockEl.classList.remove('so-editing-mode');
    }

    if (btnCancelEdit) {
        btnCancelEdit.addEventListener('click', () => {
            exitEditMode();
            renderCart(); // drop the "being edited" highlight
        });
    }

    // Shared with the Customer/Order Number required-field check further
    // down (form submit handler) — a small red bubble anchored under the
    // field, instead of a blocking native alert() (found via user feedback
    // 2026-08-31: the browser's own "Field is required!" dialog for a
    // missing Machine selection was jarring and didn't point at the field).
    // `message` is optional — omitted, it's the usual "Field is required!".
    // A custom message can be a full sentence, so it wraps and anchors from
    // the top instead: the fixed bottom offset would make a two-line bubble
    // grow upward over the field it's pointing at.
    function showFieldWarn(el, message) {
        if (!el) return;
        el.parentElement.style.position = 'relative';
        const existing = el.parentElement.querySelector('.custom-empty-warn');
        if (existing) existing.remove();
        const warnBubble = document.createElement('div');
        warnBubble.className = 'custom-empty-warn';
        warnBubble.style = message
            ? 'position: absolute; top: calc(100% + 6px); left: 0; background: var(--danger); color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; z-index: 10; white-space: normal; width: max-content; max-width: min(360px, 100%); line-height: 1.35; box-shadow: 0 2px 5px rgba(0,0,0,0.25);'
            : 'position: absolute; bottom: -28px; left: 0; background: var(--danger); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; z-index: 10; white-space: nowrap; box-shadow: 0 2px 5px rgba(0,0,0,0.25);';
        // No literal warning emoji here: alert_field_required already starts
        // with one in both en and ar, so prepending a second rendered
        // "⚠️ ⚠️ Field is required!" (found live 2026-09-06). js/roasting.js
        // never had this bug — matched to it. The fallback carries the emoji
        // so the no-i18n path still shows exactly one.
        const text = message || (window.t ? window.t('alert_field_required') : '⚠️ Field is required!');
        warnBubble.innerHTML = `${text}<div style="position: absolute; top: -4px; left: 10px; width: 8px; height: 8px; background: var(--danger); transform: rotate(45deg);"></div>`;
        el.parentElement.appendChild(warnBubble);
        const removeHandler = () => { if (warnBubble.parentNode) warnBubble.remove(); };
        el.addEventListener('input', removeHandler, { once: true });
        el.addEventListener('change', removeHandler, { once: true });
    }

    btnAddItem.addEventListener('click', () => {
        const coffeeVal = selCoffee.value;
        const machineId = selMachine.value ? parseInt(selMachine.value) : null;
        const sizeG = parseInt(selSize.value) || 0;
        const qty = parseInt(inpQty.value) || 0;

        if (!coffeeVal || !machineId || !sizeG || qty <= 0) {
            if (!coffeeVal) showFieldWarn(selCoffee);
            if (!machineId) showFieldWarn(selMachine);
            if (!sizeG) showFieldWarn(selSize);
            if (qty <= 0) showFieldWarn(inpQty);
            return;
        }

        // Fase 2: editing an existing cart entry — overwrite it in place
        // (Map.set on an existing key doesn't move its position, so the
        // card stays where it was) instead of adding a new one, and never
        // merge into some other entry even if the edited values now match
        // it — that would silently drop a card the operator can still see
        // and didn't ask to remove.
        if (editingCartId !== null) {
            const entry = cart.get(editingCartId);
            if (entry) {
                entry.coffeeVal = coffeeVal;
                entry.machineId = machineId;
                entry.sizeG = sizeG;
                entry.qty = qty;
            }
            exitEditMode();
            recomputeCartStock();
            renderCart();
            return;
        }

        // Merge with an existing entry sharing the same coffee+machine+size
        // — UNLESS this order is locked (Preparing/Approved edit), where
        // merging would silently fold two distinct request_order_items into
        // one cart entry and break the originalItemId -> roasting_plans
        // mapping (§3.4). Locked orders never reach this handler anyway
        // (Add to list is hidden for them, see below), but the guard is kept
        // here too so the merge behavior can never depend on UI visibility.
        let target = null;
        if (!isApprovedEdit) {
            cart.forEach((entry) => {
                if (entry.coffeeVal === coffeeVal && (entry.machineId || null) === machineId && entry.sizeG === sizeG) {
                    target = entry;
                }
            });
        }

        if (target) {
            target.qty += qty;
        } else {
            const cartId = cartIdSeq++;
            cart.set(cartId, { cartId, coffeeVal, machineId, sizeG, qty, packedStock: 0, potentialBags: 0, originalItemId: null, locked: false });
        }

        selCoffee.value = '';
        selMachine.value = '';
        selSize.selectedIndex = 0;
        inpQty.value = 1;
        infoBox.style.display = 'none';
        hideQtyShortBubble();

        recomputeCartStock();
        renderCart();
        showCartEditHint();
    });

    // Populate cart from existing items (edit mode). A Pending-Approval edit
    // leaves entries fully editable/removable (isApprovedEdit is false, so
    // locked stays false); a Preparing/Approved edit marks them locked —
    // only their qty can change, matching the old per-row disabled-fields
    // behavior. Full redesign of the locked layout (hiding the picker
    // column outright) is SALES_ORDER_REDESIGN_PLAN.md Fase 6.
    if (existingItems && existingItems.length > 0) {
        existingItems.forEach(item => {
            const coffeeVal = item.coffee_code
                ? `${item.coffee_type}-CODE:${item.coffee_code}`
                : `${item.coffee_type}-${item.single_coffee_id || item.blend_recipe_id}`;
            const cartId = cartIdSeq++;
            cart.set(cartId, {
                cartId,
                coffeeVal,
                machineId: item.machine_id || null,
                sizeG: parseInt(item.bag_size_g),
                qty: parseInt(item.quantity_requested) || 0,
                packedStock: 0, potentialBags: 0,
                originalItemId: item.id,
                locked: isApprovedEdit
            });
        });
        recomputeCartStock();
    }
    renderCart();

    // Fase 6: for a Preparing/Approved order, the whole item-assembler block
    // (coffee/machine/size/qty picker, Available Stock card, Add to
    // list/Cancel) is hidden outright — there is nothing it could do here,
    // since items can only be edited (qty) or left alone, never added, and
    // the cart already disables its own remove buttons for locked entries
    // (see renderCart). This replaces the old field-by-field disabled+dimmed
    // treatment the assembler fields never actually had before this phase.
    // Order Number/Sales/Notes stay visible (still disabled/dimmed) — they're
    // header context, not part of the item assembler.
    if (isApprovedEdit) {
        const assemblerBlock = document.getElementById('so-assembler-block');
        if (assemblerBlock) assemblerBlock.classList.add('hidden');
        const lockedNotice = document.getElementById('so-locked-notice');
        if (lockedNotice) lockedNotice.classList.remove('hidden');
        if (agentInput) { agentInput.disabled = true; agentInput.style.opacity = '0.6'; }
        if (orderNoInput) { orderNoInput.disabled = true; orderNoInput.style.opacity = '0.6'; }
        const notesInput = document.getElementById('m-req-notes');
        if (notesInput) { notesInput.disabled = true; notesInput.style.opacity = '0.6'; }
    }

    document.getElementById('modal-request-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        // Validation for empty required fields OUTSIDE the cart (Customer,
        // Order Number) — item-level validation now happens at Add to list
        // time, and cart emptiness is checked separately below.
        let isValid = true;
        const form = e.target;
        form.querySelectorAll('.custom-empty-warn').forEach(w => w.remove());

        form.querySelectorAll('[required]').forEach(el => {
            if (!el.value || el.value.trim() === '') {
                isValid = false;
                showFieldWarn(el);
            }
        });
        if (!isValid) return;

        // CUSTOMER_TYPEAHEAD_PLAN.md §4 — the customer field is free text, so
        // non-empty isn't enough: it must resolve to a registered customer
        // this role can see. On success the text is normalised to the
        // canonical "CODE — NAME", so a bare "WHL-002" visibly becomes the
        // customer it matched before the review step shows it.
        const resolvedCustomer = resolveCustomerInput(customerInput.value, selectableCustomers);
        if (!resolvedCustomer) {
            showFieldWarn(customerInput, window.t
                ? window.t('alert_customer_not_in_list')
                : '⚠️ Please pick a customer from the list — orders can only go to a registered customer. New customer? Use Add New first.');
            return;
        }
        customerInput.value = customerDisplayText(resolvedCustomer);

        if (cart.size === 0) {
            alert(window.t ? (window.t('alert_min_one_item') || 'At least one item is required.') : 'At least one item is required.');
            return;
        }

        // Recompute one last time against the final cart state — cheap, and
        // guarantees the validation below never reads numbers that predate
        // a qty edit made after the last add/remove.
        recomputeCartStock();

        // Fase 3 (§3.3): bulk is out of this check entirely — it's the
        // leader's call alone, decided at approval. Sales only ever asks
        // "can this possibly be fulfilled from packed stock plus what
        // production could still make" (qty > packed + potential). The old
        // separate "packed short but production covers it, send to
        // production queue?" prompt (prompt_roasting_queue) is removed —
        // that question was asked of the wrong person (sales doesn't decide
        // this) and the Available Stock card + fulfillment bar shown while
        // assembling the item already surfaces the same information more
        // clearly than a confirm dialog would.
        let blocked = false;
        cart.forEach((entry) => {
            const packed = entry.packedStock || 0;
            const potential = entry.potentialBags || 0;
            const qty = entry.qty;
            if (qty > packed + potential) blocked = true;
        });

        if (blocked) {
            const forceProceed = await showWarningModal(
                window.t ? window.t('alert_stock_absolutely_insufficient') : "Total available stock and potential production are insufficient for one or more items. Do you still want to continue?",
                true, 'Warning', 'Continue Anyway'
            );
            if (!forceProceed) return;
        }

        // Fase 4: this button no longer writes anything itself — it swaps
        // the assembler out for a read-only review of exactly what is about
        // to be sent for approval. Both steps live inside the same <form>,
        // so the cart Map and every listener on it survive going Back.
        showConfirmStep();
    });

    // §5.5 — mirrors Stock Release's own two-step pattern (js/packing.js
    // showConfirmStep/submitStockRelease) so this modal and that one read as
    // one family: swap the assembler for a review screen, disable the
    // confirm button while the actual write is in flight so a double-click
    // can't submit the order twice, and let Back restore the assembler
    // without touching the cart. Deliberately never mentions bulk or "the
    // leader's decision" (§5.5) — sales only ever sees packed vs production,
    // same as the assembler screen behind it.
    function showConfirmStep() {
        const t = (key, fallback) => window.t ? window.t(key) : fallback;
        const reviewCustomer = resolveCustomerInput(customerInput.value, selectableCustomers);
        const customerText = reviewCustomer ? escapeCustomerAttr(customerDisplayText(reviewCustomer)) : '';
        const dash = '<span style="color:var(--text-muted);">—</span>';
        const metaRow = (label, value) => `
            <div>
                <div style="font-size:0.7rem; color:var(--text-muted);">${label}</div>
                <div style="font-size:0.88rem; overflow-wrap:anywhere;">${value || dash}</div>
            </div>`;

        const fromStockLbl = t('lbl_so_from_stock', 'from stock');
        const toProductionLbl = t('lbl_so_to_production', 'to production');

        const cartEntries = Array.from(cart.values());
        let packedTotal = 0;
        let productionTotal = 0;
        const productionKgByMachine = {}; // machineId -> kg

        const itemRowsHtml = cartEntries.map((entry, idx) => {
            const name = coffeeLabelFor(entry.coffeeVal);
            const machineName = machineLabelFor(entry.machineId);
            const packedPortion = Math.min(entry.qty, entry.packedStock || 0);
            const productionPortion = Math.max(0, entry.qty - packedPortion);
            packedTotal += packedPortion;
            productionTotal += productionPortion;
            if (productionPortion > 0 && entry.machineId) {
                const kg = (productionPortion * entry.sizeG) / 1000;
                productionKgByMachine[entry.machineId] = (productionKgByMachine[entry.machineId] || 0) + kg;
            }
            const sourceLine = productionPortion > 0
                ? (packedPortion > 0
                    ? `<span style="color:#5DCAA5; font-weight:700;">${packedPortion}</span> ${fromStockLbl} &middot; <span style="color:#EF9F27; font-weight:700;">${productionPortion}</span> ${toProductionLbl}`
                    : `<span style="color:#EF9F27; font-weight:700;">${productionPortion}</span> ${toProductionLbl}`)
                : `<span style="color:#5DCAA5; font-weight:700;">${fromStockLbl}</span>`;
            return `
                <div style="display:flex; align-items:center; gap:12px; padding:10px 12px; ${idx > 0 ? 'border-top:1px solid var(--border);' : ''}">
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:0.85rem; font-weight:700; overflow-wrap:anywhere;">${name}</div>
                        <div style="font-size:0.72rem; color:var(--text-muted); margin-top:1px;">${machineName} &middot; ${entry.sizeG}g</div>
                        <div style="font-size:0.72rem; margin-top:3px;">${sourceLine}</div>
                    </div>
                    <span style="font-weight:700; font-size:0.95rem; white-space:nowrap;">${entry.qty}</span>
                </div>
            `;
        }).join('');

        const machineFallback = t('lbl_req_machine', 'Machine');
        const productionRowsHtml = Object.entries(productionKgByMachine).map(([mid, kg]) => {
            const m = (machines || []).find(x => x.id === parseInt(mid));
            return `<div style="display:flex; justify-content:space-between; font-size:0.82rem; padding:3px 0;"><span>${m ? m.name : machineFallback}</span><span style="font-weight:700;">&asymp; ${kg.toFixed(1)}kg</span></div>`;
        }).join('');
        const sentToProductionLbl = t('lbl_so_sent_to_production', 'Sent to production');
        const productionBlockHtml = productionTotal > 0 ? `
            <div style="background: rgba(239,158,39,0.08); border:1px solid rgba(239,158,39,0.3); border-radius:10px; padding:10px 14px; margin-bottom:14px;">
                <div style="font-size:0.8rem; font-weight:700; color:#EF9F27; margin-bottom:6px;">${sentToProductionLbl}</div>
                ${productionRowsHtml}
            </div>
        ` : '';

        const totalQty = packedTotal + productionTotal;

        stepConfirm.innerHTML = `
            <div style="display:flex; align-items:flex-start; gap:10px; background:var(--primary-glow); border:1px solid var(--border-focus); border-radius:10px; padding:12px 14px; margin-bottom:16px;">
                <div>
                    <div style="font-weight:700; font-size:0.92rem;">${t('title_so_confirm', 'Confirm Sales Request')}</div>
                    <div style="font-size:0.78rem; color:var(--text-secondary);">${t('hint_so_confirm', 'Review the details below. The order will be sent for leader approval.')}</div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px,1fr)); gap:12px; padding-bottom:14px; border-bottom:1px solid var(--border); margin-bottom:14px;">
                ${metaRow(t('lbl_req_order_no', 'Order Number'), orderNoInput.value)}
                ${metaRow(t('lbl_so_meta_date', 'Date'), existingOrder ? existingOrder.order_date : new Date().toISOString().split('T')[0])}
                ${metaRow(t('lbl_so_meta_sales', 'Sales'), agentInput.value)}
                ${metaRow(t('lbl_req_customer', 'Customer'), customerText)}
            </div>

            <div style="border:1px solid var(--border); border-radius:10px; overflow:hidden; margin-bottom:14px;">
                ${itemRowsHtml}
            </div>

            ${productionBlockHtml}

            <div style="display:flex; flex-direction:column; gap:4px; border-top:1px solid var(--border); padding-top:10px; margin-bottom:6px;">
                <div style="display:flex; justify-content:space-between; font-size:0.82rem;"><span style="color:var(--text-secondary);">${t('lbl_so_taken_from_stock', 'Taken from packed stock')}</span><span style="font-weight:700;">${packedTotal}</span></div>
                <div style="display:flex; justify-content:space-between; font-size:0.82rem;"><span style="color:var(--text-secondary);">${sentToProductionLbl}</span><span style="font-weight:700;">${productionTotal}</span></div>
                <div style="display:flex; align-items:baseline; justify-content:space-between; margin-top:6px;">
                    <span style="font-size:0.8rem; color:var(--text-secondary);">${t('lbl_so_total_order', 'Total order')}</span>
                    <span style="font-size:1.5rem; font-weight:700; color:var(--primary);">${totalQty}</span>
                </div>
            </div>

            <div style="display:flex; gap:8px; margin-top:16px;">
                <button type="button" id="so-btn-back" class="btn btn-secondary" style="flex:1;">${t('btn_so_back', 'Back')}</button>
                <button type="button" id="so-btn-confirm-submit" class="btn btn-primary" style="flex:1.5;">${orderId !== null ? t('btn_so_save_edit', 'Save Edit') : t('btn_submit_req', 'Submit Request')}</button>
            </div>
        `;

        stepForm.classList.add('hidden');
        stepConfirm.classList.remove('hidden');

        document.getElementById('so-btn-back').addEventListener('click', () => {
            stepConfirm.classList.add('hidden');
            stepForm.classList.remove('hidden');
        });
        document.getElementById('so-btn-confirm-submit').addEventListener('click', async (ev) => {
            // Guards a double-click from writing the order twice — the whole
            // submit path is async and the button stays clickable until the
            // modal closes.
            ev.target.disabled = true;
            await doSubmitOrder();
            ev.target.disabled = false;
        });
    }

    // The actual write path — unchanged field-for-field from before Fase 4,
    // just extracted out of the submit handler so the confirm-step button
    // can call it directly instead of it running inline on form submit.
    async function doSubmitOrder() {
        const salesName = agentInput.value.trim();
        let agentCode = 'AG';
        const existingAgent = (agents || []).find(a => a.name.toLowerCase() === salesName.toLowerCase());
        if (!existingAgent) {
            const parts = salesName.split(' ');
            agentCode = parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : salesName.substring(0, 2).toUpperCase();
            await saveData('sales_agents', { name: salesName, code: agentCode });
        }

        // CUSTOMER_CATEGORY_ROLE_PLAN.md Fase 4: order_type is a SNAPSHOT of the
        // customer's type, but what it's a snapshot OF depends on which customer
        // the order is actually attached to right now. §3.2's decision protects
        // history from a customer that later CHANGES CATEGORY — it says nothing
        // about an order being reassigned to a DIFFERENT customer during an edit.
        // So: if this edit keeps the same customer_id as before, order_type stays
        // frozen at whatever it already was (even if that customer's type has
        // since changed — that's the whole point). If the customer_id is being
        // changed on this save, order_type is re-snapshotted from the newly
        // selected customer's current type, exactly like a brand-new order would.
        const resolvedForSave = resolveCustomerInput(customerInput.value, selectableCustomers);
        const selectedCustomerId = resolvedForSave ? resolvedForSave.id : null;
        const selectedCustomerForType = selectedCustomerId ? (customersList || []).find(c => c.id === selectedCustomerId) : null;
        const customerUnchanged = existingOrder && existingOrder.customer_id === selectedCustomerId;

        // 1. Save Request Order header
        const orderRecord = {
            id: orderId || undefined,
            order_number: orderNoInput.value,
            order_date: existingOrder ? existingOrder.order_date : new Date().toISOString().split('T')[0],
            sales_name: salesName,
            status: existingOrder ? existingOrder.status : 'Pending Approval',
            notes: document.getElementById('m-req-notes').value,
            customer_id: selectedCustomerId,
            order_type: customerUnchanged ? existingOrder.order_type : (selectedCustomerForType ? selectedCustomerForType.type : null)
        };

        const { data: savedOrder, error } = await saveData('request_orders', orderRecord);
        if (error) {
            // request_orders.order_number carries a UNIQUE index (added
            // 2026-09-12). It can still be hit by two people submitting at the
            // same moment: each generates the number from the order list their
            // own modal loaded, so both can land on the same sequence before
            // either row exists. The raw Postgres text would leave the operator
            // stuck, so say the one thing that actually resolves it.
            const isDuplicateNumber = error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '');
            if (isDuplicateNumber) {
                await showWarningModal(
                    window.t ? window.t('alert_order_number_taken')
                             : 'That order number was just used by someone else. Close this form and open it again to get a fresh number — nothing has been saved.',
                    false);
                return;
            }
            alert((window.t ? window.t('alert_order_failed') : "Ordering failed: {msg}").replace("{msg}", error.message));
            return;
        }

        const cartEntries = Array.from(cart.values());

        // If editing approved/preparing order: update qty in-place and sync plans
        if (orderId !== null && isApprovedEdit) {
            const { data: allPlans } = await fetchData('roasting_plans');

            for (const entry of cartEntries) {
                const originalItemId = entry.originalItemId;
                const newQty = entry.qty;

                const oldItem = (requestOrderItems || []).find(i => i.id === originalItemId);
                if (!oldItem) continue;

                oldItem.quantity_requested = newQty;

                // Recalculate pending qty (new total minus already allocated)
                const allocated = oldItem.quantity_allocated || 0;
                oldItem.quantity_pending = Math.max(0, newQty - allocated);

                await saveData('request_order_items', oldItem);

                // Update linked plan target if exists
                const linkedPlan = (allPlans || []).find(p => p.request_order_item_id === originalItemId);
                if (linkedPlan) {
                    // Same rule as approval above: the target is the roasted
                    // output the order needs, so bags × bag size, with no
                    // yield division (see the comment there).
                    const pendingQty = oldItem.quantity_pending;
                    const targetRoast = (pendingQty * parseInt(oldItem.bag_size_g)) / 1000;
                    linkedPlan.target_roasted_kg = parseFloat(targetRoast.toFixed(2));

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

            for (const entry of cartEntries) {
                const [type, idStr] = entry.coffeeVal.split('-');
                const isGroup = idStr.startsWith('CODE:');

                const itemRecord = {
                    request_order_id: savedOrder.id,
                    coffee_type: type,
                    single_coffee_id: (type === 'Single' && !isGroup) ? parseInt(idStr) : null,
                    blend_recipe_id: (type === 'Blend' && !isGroup) ? parseInt(idStr) : null,
                    coffee_code: isGroup ? idStr.slice(5) : null,
                    machine_id: entry.machineId,
                    bag_size_g: entry.sizeG,
                    quantity_requested: entry.qty,
                    quantity_allocated: 0,
                    quantity_pending: entry.qty,
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
            for (const entry of cartEntries) {
                const [type, idStr] = entry.coffeeVal.split('-');
                const isGroup = idStr.startsWith('CODE:');

                const itemRecord = {
                    request_order_id: savedOrder.id,
                    coffee_type: type,
                    single_coffee_id: (type === 'Single' && !isGroup) ? parseInt(idStr) : null,
                    blend_recipe_id: (type === 'Blend' && !isGroup) ? parseInt(idStr) : null,
                    coffee_code: isGroup ? idStr.slice(5) : null,
                    machine_id: entry.machineId,
                    bag_size_g: entry.sizeG,
                    quantity_requested: entry.qty,
                    quantity_allocated: 0,
                    quantity_pending: entry.qty,
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
    }
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
