/* ============================================================================
   CRM Management page — CRM_PAGE_PLAN.md
   ----------------------------------------------------------------------------
   Halaman KEDUA untuk customer, terpisah dari #sec-customers:
     - #sec-customers      -> halaman sales (termasuk sub-tab CRM Insights)
     - #sec-crm (file ini) -> halaman management, satu izin: crm_manage

   Semua nama di file ini diawali crmpg* / _crmpg* dengan sengaja: js/sales.js
   sudah memakai _crmRows, _crmActiveSeg, renderCrmTable, openCrmCustomerModal
   di scope global yang SAMA (tidak ada module system di app ini), jadi nama
   pendek seperti _crmRows di sini akan langsung mematikan seluruh aplikasi
   dengan "Identifier has already been declared".
============================================================================ */

// --- Status order: dua aturan berbeda, disengaja (CRM_PAGE_PLAN.md §6.1) ---
// Volume = yang benar-benar keluar gudang.
const CRMPG_VOLUME_STATUSES = ['Dispatched', 'Completed'];
// Ritme = TINDAKAN memesan, bukan pengirimannya. 'Unable to Fulfill' dibuang
// karena itu kegagalan produksi (stok kurang), bukan perilaku pelanggan.
const CRMPG_RHYTHM_EXCLUDED = ['Cancelled', 'Unable to Fulfill'];

const CRMPG_DAY_MS = 86400000;
const CRMPG_MIN_ORDERS_FOR_DATE = 3;   // di bawah ini: tidak ada tanggal sama sekali
const CRMPG_MIX_FROM_ORDERS = 6;       // dari sini campuran berbobot menyala
const CRMPG_RECENT_GAPS = 6;
const CRMPG_CLAMP_LOW = 0.5;
const CRMPG_CLAMP_HIGH = 2.5;
const CRMPG_DORMANT_DAYS = 90;
const CRMPG_UNASSIGNED = '__unassigned__';

// --- module state ---
let _crmpgData = null;        // {customers, orders, items, profiles}
let _crmpgRows = [];          // satu baris per customer
let _crmpgSalesRows = [];     // satu baris per sales
let _crmpgFilter = { sales: 'all', category: 'all', status: 'all', kpi: null, search: '' };
let _crmpgAccuracy = null;    // {mae, samples}
let _crmpgSavingOwner = false;

/* ---------------------------------------------------------------------------
   Helper kecil
--------------------------------------------------------------------------- */
function crmT(key, fallback) {
    if (typeof window.t === 'function') {
        const s = window.t(key);
        if (s && s !== key) return s;
    }
    return fallback;
}

function crmpgCloseModal() {
    const c = document.getElementById('modal-container');
    if (c) c.classList.add('hidden');
}

function crmpgEsc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function crmpgNum(n, digits = 0) {
    const v = Number(n) || 0;
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function crmpgOrderDate(o) {
    return o.order_date || (o.created_at ? o.created_at.split('T')[0] : null);
}

// Ditulis manual, bukan toLocaleDateString: 'en-GB' memberi "Sept" (empat
// huruf, merusak lebar kolom) dan 'en-US' membalik urutannya jadi "Sep 20".
const CRMPG_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function crmpgShortDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return '—';
    return `${d.getDate()} ${CRMPG_MONTHS[d.getMonth()]}`;
}

function crmpgAddDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + Math.round(days));
    return d.toISOString().split('T')[0];
}

function crmpgMonthKey(dateStr) { return dateStr ? dateStr.slice(0, 7) : null; }

function crmpgMean(arr) {
    if (!arr || !arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/* ---------------------------------------------------------------------------
   1. Pengambilan data

   Catatan izin: customer tetap disaring lewat filterCustomersByAccess() —
   pagar kategori dari CUSTOMER_CATEGORY_ROLE_PLAN.md tetap berlaku di sini.
   Tapi order TIDAK dilewatkan filterOwnOrders(): halaman ini gunanya justru
   membandingkan performa antar sales, jadi membatasinya ke "order sendiri"
   akan membuat seluruh halaman berbohong. Itulah sebabnya crm_manage adalah
   izin management tersendiri dan bukan turunan dari izin sales mana pun.
--------------------------------------------------------------------------- */
async function crmpgLoadData(forceRefresh) {
    if (_crmpgData && !forceRefresh) return _crmpgData;

    const [cRes, oRes, iRes, pRes, gRes, rRes, dRes] = await Promise.all([
        fetchData('customers'),
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('profiles'),
        // Nama kopi TIDAK tersimpan di baris item (coffee_name itu kolom
        // legacy dan kosong) — harus di-resolve lewat tiga tabel ini, persis
        // konvensi coffeeLabel() di js/sales.js dan js/packing.js.
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('code_definitions')
    ]);

    const customers = filterCustomersByAccess(cRes.data || []);
    const visibleIds = new Set(customers.map(c => c.id));

    _crmpgData = {
        customers,
        orders: (oRes.data || []).filter(o => o.customer_id && visibleIds.has(o.customer_id)),
        items: iRes.data || [],
        profiles: pRes.data || [],
        greenbeans: gRes.data || [],
        recipes: rRes.data || [],
        codeDefinitions: dRes.data || []
    };
    return _crmpgData;
}

/* ---------------------------------------------------------------------------
   2. Perkiraan order berikutnya — CRM_PAGE_PLAN.md §6.2

   Diuji terhadap riwayat asli lewat docs/reorder_backtest.js:
     campuran berbobot 5,28 hari · rhythm saja 5,33 · 70/30 tetap 6,31 ·
     konsumsi saja 16,49.
   Karena itu bobotnya DIHITUNG PER CUSTOMER dari kesalahannya sendiri, bukan
   angka tetap — campuran dengan bobot tetap terbukti lebih buruk daripada
   tidak mencampur sama sekali.
--------------------------------------------------------------------------- */
function crmpgGaps(orders) {
    const g = [];
    for (let i = 1; i < orders.length; i++) {
        g.push((new Date(orders[i].date) - new Date(orders[i - 1].date)) / CRMPG_DAY_MS);
    }
    return g;
}

function crmpgRhythmGap(past) {
    const gaps = crmpgGaps(past);
    if (!gaps.length) return null;
    return median(gaps.slice(-CRMPG_RECENT_GAPS));
}

function crmpgConsumptionGap(past) {
    if (past.length < 2) return null;
    const span = (new Date(past[past.length - 1].date) - new Date(past[0].date)) / CRMPG_DAY_MS;
    const kgBefore = past.slice(0, -1).reduce((s, o) => s + o.kg, 0);
    const lastKg = past[past.length - 1].kg;
    if (!(span > 0) || !(kgBefore > 0) || !(lastKg > 0)) return null;
    return lastKg / (kgBefore / span);          // kg order terakhir ÷ kg per hari
}

// Putar ulang riwayat customer ini ke depan; kembalikan rata-rata kesalahan
// tiap metode DAN gap yang akan diprediksi untuk order berikutnya.
function crmpgReplay(orders) {
    const errR = [], errC = [], errW = [];
    let lastWeighted = null;

    for (let i = CRMPG_MIN_ORDERS_FOR_DATE - 1; i <= orders.length; i++) {
        const past = orders.slice(0, i);
        if (past.length < 2) continue;

        const r = crmpgRhythmGap(past);
        const c = crmpgConsumptionGap(past);
        if (r == null) continue;

        let w = r;
        if (c != null && past.length >= CRMPG_MIX_FROM_ORDERS) {
            const mR = crmpgMean(errR), mC = crmpgMean(errC);
            if (mR != null && mC != null) {
                const wR = 1 / (mR + 1), wC = 1 / (mC + 1);
                w = (r * wR + c * wC) / (wR + wC);
            }
            w = Math.min(Math.max(w, r * CRMPG_CLAMP_LOW), r * CRMPG_CLAMP_HIGH);
        }

        if (i === orders.length) {          // prediksi untuk order YANG BELUM terjadi
            lastWeighted = { rhythm: r, consumption: c, mixed: w };
            break;
        }

        const actual = (new Date(orders[i].date) - new Date(past[past.length - 1].date)) / CRMPG_DAY_MS;
        errR.push(Math.abs(r - actual));
        if (c != null) errC.push(Math.abs(c - actual));
        errW.push(Math.abs(w - actual));
    }

    return {
        next: lastWeighted,
        maeRhythm: crmpgMean(errR),
        maeMixed: crmpgMean(errW),
        samples: errW.length
    };
}

function crmpgPredict(orders) {
    if (!orders || orders.length < CRMPG_MIN_ORDERS_FOR_DATE) {
        return { ok: false, reason: orders && orders.length ? 'few' : 'none', orderCount: orders ? orders.length : 0 };
    }

    const last = orders[orders.length - 1];
    const rhythm = crmpgRhythmGap(orders);
    const daysSince = daysBetween(last.date, todayDateStr());

    // Customer yang sudah menghilang tidak diberi tanggal: "seharusnya order
    // 8 Juli" itu sampah, bukan informasi.
    if (rhythm && daysSince > 2 * rhythm) {
        return { ok: false, reason: 'dormant', quietDays: daysSince, rhythm, orderCount: orders.length };
    }

    const replay = crmpgReplay(orders);
    if (!replay.next) return { ok: false, reason: 'few', orderCount: orders.length };

    const useMix = orders.length >= CRMPG_MIX_FROM_ORDERS && replay.next.consumption != null;
    let gap = useMix ? replay.next.mixed : replay.next.rhythm;
    gap = Math.min(Math.max(gap, rhythm * CRMPG_CLAMP_LOW), rhythm * CRMPG_CLAMP_HIGH);

    const mae = (useMix ? replay.maeMixed : replay.maeRhythm);
    // 3–5 order: rentang sengaja lebar — satu-dua gap belum pola.
    const fallbackRange = orders.length < CRMPG_MIX_FROM_ORDERS ? rhythm * 0.5 : rhythm * 0.3;
    const plusMinus = Math.max(1, Math.round(mae == null ? fallbackRange : mae));

    const nextDate = crmpgAddDays(last.date, gap);
    const daysUntil = daysBetween(todayDateStr(), nextDate);

    const recent = orders.slice(-3);
    const kgs = recent.map(o => o.kg).filter(k => k > 0);

    return {
        ok: true,
        nextDate,
        daysUntil,                                  // negatif = lewat jatuh tempo
        plusMinus,
        rhythm,
        method: useMix ? 'mixed' : 'rhythm',
        expectedKg: kgs.length ? median(kgs) : null,
        kgLow: kgs.length ? Math.min(...kgs) : null,
        kgHigh: kgs.length ? Math.max(...kgs) : null,
        confidence: plusMinus <= rhythm * 0.25 ? 'good' : (plusMinus <= rhythm * 0.5 ? 'fair' : 'low'),
        mae, samples: replay.samples,
        orderCount: orders.length
    };
}

/* ---------------------------------------------------------------------------
   3. Hitung satu baris per customer
--------------------------------------------------------------------------- */
// Sama persis dengan coffeeLabel() di js/sales.js: item coffee_code (produk
// nama dagang V2) menang atas single_coffee_id, yang memang NULL untuk item
// jenis itu.
function crmpgCoffeeLabel(item, data) {
    if (item.coffee_code) {
        const def = (data.codeDefinitions || []).find(d => d.code === item.coffee_code);
        return def ? def.name : `Code ${item.coffee_code}`;
    }
    if (item.coffee_type === 'Single') {
        const gb = (data.greenbeans || []).find(g => g.id === item.single_coffee_id);
        return gb ? gb.name : crmT('crm_single_origin', 'Single Origin');
    }
    const r = (data.recipes || []).find(rec => rec.id === item.blend_recipe_id);
    return r ? r.name : crmT('crm_blend_recipe', 'Blend Recipe');
}

function crmpgKgByOrder(items) {
    const map = {};
    (items || []).forEach(i => {
        const qty = parseInt(i.quantity_requested) || 0;
        const g = parseInt(i.bag_size_g) || 0;
        map[i.request_order_id] = (map[i.request_order_id] || 0) + (qty * g) / 1000;
    });
    return map;
}

function crmpgBuildRows(data) {
    const kgByOrder = crmpgKgByOrder(data.items);
    const itemsByOrder = {};
    (data.items || []).forEach(i => {
        (itemsByOrder[i.request_order_id] = itemsByOrder[i.request_order_id] || []).push(i);
    });

    const perCustomer = {};
    data.customers.forEach(c => {
        perCustomer[c.id] = { rhythm: [], shipped: [], cancelled: 0, coffee: {} };
    });

    (data.orders || []).forEach(o => {
        const bucket = perCustomer[o.customer_id];
        if (!bucket) return;
        const date = crmpgOrderDate(o);
        if (!date) return;
        const kg = kgByOrder[o.id] || 0;
        const status = o.status || '';

        if (status === 'Cancelled') bucket.cancelled++;
        if (!CRMPG_RHYTHM_EXCLUDED.includes(status)) {
            bucket.rhythm.push({ date, kg, id: o.id, sales: o.sales_name || null });
        }
        if (CRMPG_VOLUME_STATUSES.includes(status)) {
            bucket.shipped.push({ date, kg, id: o.id, sales: o.sales_name || null });
            (itemsByOrder[o.id] || []).forEach(it => {
                const name = crmpgCoffeeLabel(it, data);
                const qty = parseInt(it.quantity_requested) || 0;
                const g = parseInt(it.bag_size_g) || 0;
                bucket.coffee[name] = (bucket.coffee[name] || 0) + (qty * g) / 1000;
            });
        }
    });

    const today = todayDateStr();
    const cut90 = crmpgAddDays(today, -90);
    const cut180 = crmpgAddDays(today, -180);
    const months = [];
    for (let i = 3; i >= 0; i--) {
        const d = new Date(today + 'T00:00:00');
        d.setMonth(d.getMonth() - i);
        months.push(d.toISOString().slice(0, 7));
    }

    const rows = data.customers.map(c => {
        const b = perCustomer[c.id];
        b.rhythm.sort((x, y) => x.date.localeCompare(y.date));
        b.shipped.sort((x, y) => x.date.localeCompare(y.date));

        const lastOrder = b.rhythm.length ? b.rhythm[b.rhythm.length - 1].date : null;
        const daysSince = lastOrder ? daysBetween(lastOrder, today) : null;
        const predict = crmpgPredict(b.rhythm);

        const kg90 = b.shipped.filter(o => o.date >= cut90).reduce((s, o) => s + o.kg, 0);
        const kgPrev90 = b.shipped.filter(o => o.date >= cut180 && o.date < cut90).reduce((s, o) => s + o.kg, 0);
        const kgAll = b.shipped.reduce((s, o) => s + o.kg, 0);

        const monthly = months.map(m => b.shipped.filter(o => crmpgMonthKey(o.date) === m).reduce((s, o) => s + o.kg, 0));

        // Status — definisi ditulis di sini supaya tidak ditebak ulang di UI.
        let status;
        if (!b.rhythm.length) status = 'never';
        else if (daysSince > CRMPG_DORMANT_DAYS || (predict.reason === 'dormant')) status = 'dormant';
        else if (predict.rhythm && daysSince > predict.rhythm * 1.25) status = 'slipping';
        // Satu order saja bukan "Steady": belum ada pola untuk dibilang teratur.
        // Tanpa baris ini, customer yang memesan sekali lalu diam 2 bulan akan
        // tampil sehijau pelanggan mingguan — persis kebohongan yang paling
        // mahal di halaman ini, karena 16 dari 30 customer sales terbesar
        // memang baru memesan satu kali.
        else if (b.rhythm.length === 1) status = 'once';
        else if (b.rhythm.length >= 5) status = 'loyal';
        else status = 'steady';

        const gaps = [];
        if (!c.phone) gaps.push(crmT('crm_gap_phone', 'phone'));
        if (!c.city) gaps.push(crmT('crm_gap_city', 'city'));
        if (!c.owner_sales_name) gaps.push(crmT('crm_gap_sales', 'sales'));

        const tags = [];
        if (b.rhythm.length) tags.push('ordered');
        if (lastOrder && lastOrder >= cut90) tags.push('active');
        if (status === 'slipping') tags.push('slipping');
        if (status === 'dormant') tags.push('dormant');
        if (gaps.length) tags.push('gaps');

        return {
            id: c.id, name: c.name, city: c.city || '', phone: c.phone || '',
            category: c.type || '', isActive: c.is_active !== false,
            ownerId: c.owner_sales_id || null,
            ownerName: c.owner_sales_name || null,
            ownerSince: c.owner_since || null,
            createdByName: c.created_by_name || null,
            createdAt: c.created_at || null,
            orderCount: b.rhythm.length, shippedCount: b.shipped.length, cancelled: b.cancelled,
            firstOrder: b.rhythm.length ? b.rhythm[0].date : null,
            lastOrder, daysSince, predict, status,
            kg90, kgPrev90, kgAll, monthly, months,
            coffee: b.coffee, orders: b.rhythm, shipped: b.shipped,
            gaps, tags
        };
    });

    // Tag "kg": 10 customer teratas berdasarkan kg 90 hari.
    rows.slice().sort((a, b) => b.kg90 - a.kg90).slice(0, 10)
        .filter(r => r.kg90 > 0).forEach(r => r.tags.push('kg'));

    // Akurasi gabungan yang dicetak di bawah tabel — tanpa ini, metode yang
    // membusuk baru ketahuan dari komplain, bukan dari layar.
    const maes = rows.map(r => r.predict && r.predict.ok ? r.predict.mae : null)
                     .filter(v => v != null && isFinite(v));
    const samples = rows.reduce((s, r) => s + ((r.predict && r.predict.samples) || 0), 0);
    _crmpgAccuracy = maes.length ? { mae: crmpgMean(maes), samples } : null;

    return rows;
}

/* ---------------------------------------------------------------------------
   4. Baris per sales — CRM_PAGE_PLAN.md §6.3
--------------------------------------------------------------------------- */
function crmpgBuildSalesRows(rows, data) {
    const today = todayDateStr();
    const cut90 = crmpgAddDays(today, -90);
    const cut180 = crmpgAddDays(today, -180);

    const byOwner = {};
    const keyOf = r => r.ownerId || (r.ownerName ? 'name:' + r.ownerName : CRMPG_UNASSIGNED);

    rows.forEach(r => {
        const key = keyOf(r);
        if (!byOwner[key]) {
            byOwner[key] = {
                key,
                id: r.ownerId || null,
                name: r.ownerName || crmT('crm_unassigned', 'Unassigned'),
                customers: [], kg90: 0, kgPrev90: 0, kgAll: 0,
                orders90: 0, ordersAll: 0, cancelled: 0
            };
        }
        const s = byOwner[key];
        s.customers.push(r);
        s.kg90 += r.kg90; s.kgPrev90 += r.kgPrev90; s.kgAll += r.kgAll;
        s.ordersAll += r.shippedCount;
        s.orders90 += r.shipped.filter(o => o.date >= cut90).length;
        s.cancelled += r.cancelled;
    });

    // Profil yang tidak memegang customer sama sekali tetap ditampilkan, tapi
    // tidak diberi peringkat (§6.3.4) — ujinya "tidak memegang customer",
    // bukan jabatannya. Di produksi ini mengenai akun admin yang memesan atas
    // nama tim (khaleed, Ahmad).
    const salesNamesOnOrders = new Set((data.orders || []).map(o => o.sales_name).filter(Boolean));
    (data.profiles || []).forEach(p => {
        if (!salesNamesOnOrders.has(p.name)) return;
        const hasBucket = Object.values(byOwner).some(s => s.id === p.id || s.name === p.name);
        if (hasBucket) return;
        byOwner['profile:' + p.id] = {
            key: 'profile:' + p.id, id: p.id, name: p.name, customers: [],
            kg90: 0, kgPrev90: 0, kgAll: 0, orders90: 0, ordersAll: 0,
            cancelled: (data.orders || []).filter(o => o.sales_name === p.name && o.status === 'Cancelled').length,
            noCustomers: true
        };
    });

    const list = Object.values(byOwner).map(s => {
        const active = s.customers.filter(c => c.lastOrder && c.lastOrder >= cut90).length;
        const repeat = s.customers.filter(c => c.orderCount > 1).length;
        const withOrders = s.customers.filter(c => c.orderCount > 0).length;
        const quiet = s.customers.filter(c => c.status === 'dormant' || c.status === 'slipping').length;
        const onceOnly = s.customers.filter(c => c.orderCount === 1).length;
        return {
            ...s,
            unassigned: s.key === CRMPG_UNASSIGNED,
            rankable: !s.noCustomers && s.customers.length > 0,
            activeCustomers: active,
            repeatRate: withOrders ? Math.round((repeat / withOrders) * 100) : null,
            goneQuiet: quiet, onceOnly,
            kgPerCustomer: s.customers.length ? s.kgAll / s.customers.length : 0,
            kgDelta: s.kg90 - s.kgPrev90
        };
    });

    list.sort((a, b) => {
        if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
        if (a.rankable !== b.rankable) return a.rankable ? -1 : 1;
        return b.kgAll - a.kgAll;
    });
    return list;
}

/* ---------------------------------------------------------------------------
   5. Entry point section + tab
--------------------------------------------------------------------------- */
async function loadCrmSection(forceRefresh) {
    const activeBtn = document.querySelector('#sec-crm .tab-btn.active');
    const tabId = activeBtn ? activeBtn.getAttribute('data-tab') : 'tab-crm-customers';
    await loadCrmTabSpecificData(tabId, forceRefresh);
}

async function loadCrmTabSpecificData(tabId, forceRefresh) {
    const data = await crmpgLoadData(forceRefresh);
    _crmpgRows = crmpgBuildRows(data);
    _crmpgSalesRows = crmpgBuildSalesRows(_crmpgRows, data);

    if (tabId === 'tab-crm-sales') {
        crmpgRenderSalesTab();
    } else {
        crmpgRenderTiles();
        crmpgRenderKpis();
        crmpgRenderTable();
    }
}

/* ---------------------------------------------------------------------------
   6. Tab Customers — tile, kartu KPI, tabel
--------------------------------------------------------------------------- */
function crmpgRenderTiles() {
    const salesBox = document.getElementById('crm-sales-tiles');
    const catBox = document.getElementById('crm-category-tiles');
    if (!salesBox || !catBox) return;

    const counts = {};
    _crmpgRows.forEach(r => {
        const key = r.ownerId || (r.ownerName ? 'name:' + r.ownerName : CRMPG_UNASSIGNED);
        counts[key] = counts[key] || { name: r.ownerName || crmT('crm_unassigned', 'Unassigned'), n: 0 };
        counts[key].n++;
    });

    let html = crmpgTileHtml('all', crmT('crm_all_customers', 'All customers'), _crmpgRows.length, _crmpgFilter.sales === 'all', 'sales');
    Object.keys(counts)
        .sort((a, b) => (a === CRMPG_UNASSIGNED ? 1 : b === CRMPG_UNASSIGNED ? -1 : counts[b].n - counts[a].n))
        .forEach(key => {
            html += crmpgTileHtml(key, counts[key].name, counts[key].n, _crmpgFilter.sales === key, 'sales');
        });
    salesBox.innerHTML = html;

    const types = allowedCustomerTypes();
    let catHtml = crmpgTileHtml('all', crmT('crm_all', 'All'), _crmpgRows.length, _crmpgFilter.category === 'all', 'category');
    types.forEach(t => {
        const n = _crmpgRows.filter(r => r.category === t).length;
        catHtml += crmpgTileHtml(t, t, n, _crmpgFilter.category === t, 'category');
    });
    catBox.innerHTML = catHtml;
}

function crmpgTileHtml(value, label, count, active, kind) {
    return `<button class="btn btn-secondary btn-sm crm-tile${active ? ' active' : ''}"
        onclick="crmpgSetFilter('${kind}', '${crmpgEsc(value).replace(/'/g, "\\'")}')">
        ${crmpgEsc(label)} <span class="crm-tile-count">${count}</span></button>`;
}

function crmpgRenderKpis() {
    const box = document.getElementById('crm-kpi-cards');
    if (!box) return;

    const rows = _crmpgRows;
    const today = todayDateStr();
    const cut90 = crmpgAddDays(today, -90);

    const cut180 = crmpgAddDays(today, -180);
    const ordered = rows.filter(r => r.tags.includes('ordered')).length;
    const never = rows.length - ordered;
    // "Aktif" = PUNYA order di jendela itu. Sempat salah dihitung dari
    // lastOrder saja, yang membuat customer aktif di dua periode hanya
    // terhitung di periode sekarang — selisihnya lalu selalu tampak melonjak.
    const active = rows.filter(r => r.orders.some(o => o.date >= cut90)).length;
    const activePrev = rows.filter(r => r.orders.some(o => o.date >= cut180 && o.date < cut90)).length;
    const slipping = rows.filter(r => r.status === 'slipping').length;
    const dormant = rows.filter(r => r.status === 'dormant').length;
    const kg90 = rows.reduce((s, r) => s + r.kg90, 0);
    const kgPrev = rows.reduce((s, r) => s + r.kgPrev90, 0);
    const gaps = rows.filter(r => r.gaps.length).length;

    const card = (tag, value, label, sub) => `
        <div class="crm-kpi${_crmpgFilter.kpi === tag ? ' active' : ''}" onclick="crmpgSetFilter('kpi', '${tag}')">
            <div class="crm-kpi-value">${value}</div>
            <div class="crm-kpi-label">${crmpgEsc(label)}</div>
            <div class="crm-kpi-sub">${crmpgEsc(sub)}</div>
        </div>`;

    const delta = kg90 - kgPrev;
    // Tanpa periode pembanding, "+5.535 kg vs previous" membaca seolah ada
    // lonjakan. Yang benar: belum ada apa pun untuk dibandingkan.
    const kgSub = kgPrev > 0
        ? `${delta >= 0 ? '+' : ''}${crmpgNum(delta)} ${crmT('crm_kpi_kg_sub', 'kg vs previous')}`
        : crmT('crm_first_period', 'first full period');
    const activeSub = activePrev > 0
        ? `${active - activePrev >= 0 ? '+' : ''}${active - activePrev} ${crmT('crm_kpi_vs_prev', 'vs previous 90 d')}`
        : crmT('crm_first_period', 'first full period');
    box.innerHTML =
        card('ordered', ordered, crmT('crm_kpi_ordered', 'Ordered at least once'),
             `${never} ${crmT('crm_kpi_never', 'never ordered')}`) +
        card('active', active, crmT('crm_kpi_active', 'Active · 90 days'), activeSub) +
        card('slipping', slipping, crmT('crm_kpi_slipping', 'Slipping'),
             crmT('crm_kpi_slipping_sub', 'past their usual gap')) +
        card('dormant', dormant, crmT('crm_kpi_dormant', 'Dormant · 90 d+'),
             crmT('crm_kpi_dormant_sub', 'no order in 90 days')) +
        card('kg', crmpgNum(kg90), crmT('crm_kpi_kg', 'kg dispatched · 90 d'), kgSub) +
        card('gaps', gaps, crmT('crm_kpi_gaps', 'Data gaps'),
             crmT('crm_kpi_gaps_sub', 'missing phone / city / sales'));
}

function crmpgSetFilter(kind, value) {
    if (kind === 'kpi') {
        _crmpgFilter.kpi = (_crmpgFilter.kpi === value) ? null : value;
    } else {
        _crmpgFilter[kind] = value;
    }
    crmpgRenderTiles();
    crmpgRenderKpis();
    crmpgRenderTable();
    const card = document.getElementById('crm-table-card');
    if (card && kind === 'kpi') card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function crmpgResetFilters() {
    _crmpgFilter = { sales: 'all', category: 'all', status: 'all', kpi: null, search: '' };
    const search = document.getElementById('crm-search');
    if (search) search.value = '';
    crmpgRenderTiles();
    crmpgRenderKpis();
    crmpgRenderTable();
}

function crmpgSearch(value) {
    _crmpgFilter.search = (value || '').toLowerCase();
    crmpgRenderTable();
}

function crmpgVisibleRows() {
    return _crmpgRows.filter(r => {
        if (_crmpgFilter.sales !== 'all') {
            const key = r.ownerId || (r.ownerName ? 'name:' + r.ownerName : CRMPG_UNASSIGNED);
            if (key !== _crmpgFilter.sales) return false;
        }
        if (_crmpgFilter.category !== 'all' && r.category !== _crmpgFilter.category) return false;
        if (_crmpgFilter.status !== 'all' && r.status !== _crmpgFilter.status) return false;
        if (_crmpgFilter.kpi && !r.tags.includes(_crmpgFilter.kpi)) return false;
        if (_crmpgFilter.search) {
            const hay = `${r.name} ${r.city} ${r.ownerName || ''}`.toLowerCase();
            if (!hay.includes(_crmpgFilter.search)) return false;
        }
        return true;
    });
}

const CRMPG_STATUS_META = {
    steady:  { key: 'crm_status_steady',  fallback: 'Steady',        cls: 'crm-chip-green' },
    loyal:   { key: 'crm_status_loyal',   fallback: 'Loyal',         cls: 'crm-chip-green' },
    slipping:{ key: 'crm_status_slipping',fallback: 'Slipping',      cls: 'crm-chip-amber' },
    dormant: { key: 'crm_status_dormant', fallback: 'Dormant',       cls: 'crm-chip-red' },
    once:    { key: 'crm_status_once',    fallback: 'Ordered once',  cls: 'crm-chip-grey' },
    never:   { key: 'crm_status_never',   fallback: 'Never ordered', cls: 'crm-chip-grey' }
};

function crmpgStatusChip(status) {
    const m = CRMPG_STATUS_META[status] || CRMPG_STATUS_META.never;
    return `<span class="crm-chip ${m.cls}">${crmpgEsc(crmT(m.key, m.fallback))}</span>`;
}

function crmpgNextOrderCell(r) {
    const p = r.predict;
    if (!p.ok) {
        if (p.reason === 'dormant') {
            return `<span class="crm-muted">${crmpgEsc(crmT('crm_no_estimate', 'no estimate'))}</span>
                <div class="crm-sub">${crmpgEsc(crmT('crm_quiet_days', 'quiet {n} days').replace('{n}', p.quietDays))}</div>`;
        }
        if (p.reason === 'none') {
            return `<span class="crm-muted">—</span>
                <div class="crm-sub">${crmpgEsc(crmT('crm_no_history', 'no history yet'))}</div>`;
        }
        return `<span class="crm-muted">${crmpgEsc(crmT('crm_no_estimate', 'no estimate'))}</span>
            <div class="crm-sub">${crmpgEsc(crmT('crm_need_three', 'needs 3 orders'))}</div>`;
    }

    const due = p.daysUntil < 0
        ? crmT('crm_overdue_days', '{n} days overdue').replace('{n}', Math.abs(p.daysUntil))
        : (p.daysUntil === 0
            ? crmT('crm_due_today', 'due today')
            : crmT('crm_in_days', 'in {n} days').replace('{n}', p.daysUntil));
    const kgText = p.expectedKg
        ? ` · ~${crmpgNum(p.expectedKg)} ${crmT('crm_kg', 'kg')}`
        : '';
    const cls = p.daysUntil < 0 ? 'crm-late' : (p.daysUntil <= 3 ? 'crm-soon' : '');

    return `<b class="${cls}">${crmpgShortDate(p.nextDate)}</b>
        <span class="crm-muted crm-sub-inline">± ${p.plusMinus} d</span>
        <div class="crm-sub">${crmpgEsc(due)}${crmpgEsc(kgText)}</div>`;
}

function crmpgSparkline(r) {
    const max = Math.max(...r.monthly, 1);
    return '<span class="crm-spark">' + r.monthly.map((v, i) =>
        `<i class="${i === r.monthly.length - 1 ? 'hi' : ''}" style="height:${Math.max(4, Math.round((v / max) * 100))}%"
            title="${r.months[i]}: ${crmpgNum(v)} kg"></i>`).join('') + '</span>';
}

function crmpgRenderTable() {
    const tbody = document.getElementById('crm-table-body');
    if (!tbody) return;
    const rows = crmpgVisibleRows();

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-secondary)">
            ${crmpgEsc(crmT('crm_no_rows', 'No customer matches these filters.'))}</td></tr>`;
    } else {
        tbody.innerHTML = rows.sort((a, b) => b.kg90 - a.kg90 || a.name.localeCompare(b.name)).map(r => `
            <tr class="crm-row" onclick="crmpgOpenCustomer(${r.id})">
                <td>
                    <strong>${crmpgEsc(r.name)}</strong>
                    <div class="crm-sub">${crmpgEsc(r.city || '—')}</div>
                </td>
                <td>${crmpgEsc(r.category)}</td>
                <td onclick="event.stopPropagation()">
                    ${r.ownerName
                        ? crmpgEsc(r.ownerName)
                        : `<span class="crm-muted">${crmpgEsc(crmT('crm_unassigned', 'Unassigned'))}</span>`}
                    <button class="btn btn-secondary btn-xs crm-owner-btn" title="${crmpgEsc(crmT('crm_change_sales', 'Change sales'))}"
                        onclick="crmpgOpenOwnerModal(${r.id})"><i class="icon-pencil"></i></button>
                </td>
                <td>${crmpgStatusChip(r.status)}</td>
                <td>${r.predict.rhythm
                        ? crmpgEsc(crmT('crm_every_days', 'every ~{n} d').replace('{n}', Math.round(r.predict.rhythm)))
                        : '<span class="crm-muted">—</span>'}</td>
                <td>${crmpgShortDate(r.lastOrder)}</td>
                <td>${crmpgNextOrderCell(r)}</td>
                <td class="crm-right">${r.kg90 ? '<b>' + crmpgNum(r.kg90) + '</b>' : '<span class="crm-muted">0</span>'}</td>
                <td class="crm-center">${r.shipped.length ? crmpgSparkline(r) : '<span class="crm-muted">—</span>'}</td>
                <td class="crm-center">
                    <span class="crm-dot ${r.gaps.length ? 'crm-dot-warn' : 'crm-dot-ok'}"
                        title="${r.gaps.length ? crmpgEsc(crmT('crm_missing', 'missing') + ': ' + r.gaps.join(', ')) : crmpgEsc(crmT('crm_complete', 'complete'))}"></span>
                </td>
            </tr>`).join('');
    }

    const count = document.getElementById('crm-row-count');
    if (count) {
        count.textContent = crmT('crm_showing', '{n} of {total} customers')
            .replace('{n}', rows.length).replace('{total}', _crmpgRows.length);
    }

    const acc = document.getElementById('crm-accuracy');
    if (acc) {
        acc.textContent = _crmpgAccuracy
            ? crmT('crm_accuracy', 'Next-order estimates have been off by ± {d} days on average ({n} past orders checked).')
                .replace('{d}', _crmpgAccuracy.mae.toFixed(1)).replace('{n}', _crmpgAccuracy.samples)
            : crmT('crm_accuracy_none', 'Not enough order history yet to measure how accurate the estimates are.');
    }

    crmpgRenderStatusFilter();
}

function crmpgRenderStatusFilter() {
    const sel = document.getElementById('crm-status-filter');
    if (!sel || sel.dataset.built === '1') return;
    sel.innerHTML = `<option value="all">${crmpgEsc(crmT('crm_all', 'All'))}</option>` +
        Object.keys(CRMPG_STATUS_META).map(k =>
            `<option value="${k}">${crmpgEsc(crmT(CRMPG_STATUS_META[k].key, CRMPG_STATUS_META[k].fallback))}</option>`).join('');
    sel.dataset.built = '1';
    sel.value = _crmpgFilter.status;
}

/* ---------------------------------------------------------------------------
   7. Ganti kepemilikan — CRM_PAGE_PLAN.md §8
   Dua tulisan (customers + customer_owner_history) harus jadi satu kejadian.
   Kalau history gagal, update customers dikembalikan: kepemilikan tanpa jejak
   lebih buruk daripada perubahan yang gagal, karena sejarahnya tidak bisa
   dipulihkan belakangan.
--------------------------------------------------------------------------- */
function crmpgSalesOptions(selectedId) {
    const profiles = (_crmpgData && _crmpgData.profiles) || [];
    return `<option value="">${crmpgEsc(crmT('crm_unassigned', 'Unassigned'))}</option>` +
        profiles.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(p =>
            `<option value="${p.id}"${p.id === selectedId ? ' selected' : ''}>${crmpgEsc(p.name || p.email || p.id)}</option>`
        ).join('');
}

function crmpgOpenOwnerModal(customerId) {
    const row = _crmpgRows.find(r => r.id === customerId);
    if (!row) return;
    openModal(crmT('crm_change_sales', 'Change sales'), `
        <div class="form-group">
            <label>${crmpgEsc(crmT('crm_customer', 'Customer'))}</label>
            <div style="font-weight:600">${crmpgEsc(row.name)}</div>
        </div>
        <div class="form-group">
            <label>${crmpgEsc(crmT('crm_current_sales', 'Current sales'))}</label>
            <div>${row.ownerName ? crmpgEsc(row.ownerName) : crmpgEsc(crmT('crm_unassigned', 'Unassigned'))}</div>
        </div>
        <div class="form-group">
            <label for="crm-owner-select">${crmpgEsc(crmT('crm_new_sales', 'New sales'))}</label>
            <select id="crm-owner-select" class="form-control">${crmpgSalesOptions(row.ownerId)}</select>
        </div>
        <div class="form-group">
            <label for="crm-owner-note">${crmpgEsc(crmT('crm_reason_optional', 'Reason (optional)'))}</label>
            <input id="crm-owner-note" class="form-control" type="text">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
            <button class="btn btn-secondary" onclick="crmpgCloseModal()">${crmpgEsc(crmT('btn_cancel', 'Cancel'))}</button>
            <button class="btn btn-primary" onclick="crmpgSaveOwner(${row.id})">${crmpgEsc(crmT('btn_save', 'Save'))}</button>
        </div>`);
}

async function crmpgSaveOwner(customerId) {
    if (_crmpgSavingOwner) return;
    const row = _crmpgRows.find(r => r.id === customerId);
    const select = document.getElementById('crm-owner-select');
    const noteInput = document.getElementById('crm-owner-note');
    if (!row || !select) return;

    const newId = select.value || null;
    const profile = (_crmpgData.profiles || []).find(p => p.id === newId);
    const newName = profile ? (profile.name || profile.email) : null;
    if ((row.ownerId || null) === newId) { crmpgCloseModal(); return; }

    _crmpgSavingOwner = true;
    const unlock = typeof lockProcessingScreen === 'function'
        ? lockProcessingScreen(crmT('crm_saving_owner', 'Updating sales ownership…'))
        : null;

    try {
        const before = { id: row.ownerId, name: row.ownerName, since: row.ownerSince };
        const nowIso = new Date().toISOString();

        const { error: upErr } = await saveData('customers', {
            id: customerId,
            owner_sales_id: newId,
            owner_sales_name: newName,
            owner_since: newId ? nowIso : null
        });
        if (upErr) throw new Error(upErr.message || 'update failed');

        const { error: histErr } = await saveData('customer_owner_history', {
            customer_id: customerId,
            from_sales_id: before.id, from_sales_name: before.name,
            to_sales_id: newId, to_sales_name: newName,
            changed_by_id: currentUser ? currentUser.id : null,
            changed_by_name: currentUser ? (currentUser.name || currentUser.email) : null,
            changed_at: nowIso,
            note: noteInput && noteInput.value ? noteInput.value.trim() : null
        });

        if (histErr) {
            // Kembalikan, jangan tinggalkan kepemilikan tanpa jejak.
            await saveData('customers', {
                id: customerId,
                owner_sales_id: before.id,
                owner_sales_name: before.name,
                owner_since: before.since
            });
            throw new Error(histErr.message || 'history failed');
        }

        // Verifikasi: baca ulang, jangan percaya bahwa tulisan tadi mendarat.
        const { data: check } = await fetchData('customers');
        const fresh = (check || []).find(c => c.id === customerId);
        if (!fresh || (fresh.owner_sales_id || null) !== newId) {
            throw new Error('verification failed');
        }

        crmpgCloseModal();
        await loadCrmTabSpecificData('tab-crm-customers', true);
    } catch (e) {
        if (typeof showWarningModal === 'function') {
            showWarningModal(crmT('crm_owner_failed', 'Sales ownership was not changed. Nothing was saved, you can try again.')
                + '\n\n' + (e.message || e), false);
        }
    } finally {
        if (unlock) unlock.release();
        _crmpgSavingOwner = false;
    }
}

/* ---------------------------------------------------------------------------
   8. Modal customer
--------------------------------------------------------------------------- */
function crmpgBarsHtml(labels, values) {
    const max = Math.max(...values, 1);
    return `<div class="crm-bars">` + values.map((v, i) => `
        <div class="crm-bar-col">
            <div class="crm-bar-val">${crmpgNum(v)}</div>
            <div class="crm-bar" style="height:${Math.max(3, Math.round((v / max) * 100))}%"></div>
            <div class="crm-bar-label">${crmpgEsc(labels[i])}</div>
        </div>`).join('') + `</div>`;
}

function crmpgMonthLabels(months) {
    return months.map(m => CRMPG_MONTHS[parseInt(m.slice(5, 7), 10) - 1] || m);
}

function crmpgCoffeeListHtml(coffee, limit = 5) {
    const entries = Object.entries(coffee).sort((a, b) => b[1] - a[1]).slice(0, limit);
    if (!entries.length) return `<div class="crm-muted">${crmpgEsc(crmT('crm_no_history', 'no history yet'))}</div>`;
    const total = entries.reduce((s, e) => s + e[1], 0) || 1;
    return entries.map(([name, kg]) => `
        <div class="crm-legend-row">
            <span>${crmpgEsc(name)}</span>
            <span class="crm-legend-bar"><i style="width:${Math.round((kg / total) * 100)}%"></i></span>
            <b>${crmpgNum(kg)} kg</b>
        </div>`).join('');
}

function crmpgOpenCustomer(customerId) {
    const r = _crmpgRows.find(x => x.id === customerId);
    if (!r) return;

    const p = r.predict;
    const forecast = p.ok ? `
        <div class="crm-forecast">
            <div>
                <div class="crm-label">${crmpgEsc(crmT('crm_next_order', 'Next order — estimate'))}</div>
                <div class="crm-big">${crmpgShortDate(p.nextDate)}</div>
                <div class="crm-muted">± ${p.plusMinus} ${crmpgEsc(crmT('crm_days', 'days'))} ·
                    ${crmpgEsc(crmT('crm_confidence_' + p.confidence, p.confidence + ' confidence'))}</div>
            </div>
            <div class="crm-right-block">
                <div class="crm-label">${crmpgEsc(crmT('crm_expected_size', 'Expected size'))}</div>
                <div class="crm-big">${p.expectedKg ? '≈ ' + crmpgNum(p.expectedKg) + ' kg' : '—'}</div>
                <div class="crm-muted">${p.kgLow != null ? crmpgNum(p.kgLow) + '–' + crmpgNum(p.kgHigh) + ' kg' : ''}</div>
            </div>
        </div>
        <div class="crm-muted crm-sub">${crmpgEsc(
            crmT('crm_method_note', 'Based on {n} past orders, method: {m}.')
                .replace('{n}', p.orderCount)
                .replace('{m}', p.method === 'mixed'
                    ? crmT('crm_method_mixed', 'order rhythm + consumption rate, weighted by this customer\'s own past accuracy')
                    : crmT('crm_method_rhythm', 'order rhythm only — under 6 orders the mix stays off')))}</div>`
        : `<div class="crm-muted">${crmpgEsc(
            p.reason === 'dormant'
                ? crmT('crm_dormant_note', 'No estimate: this customer has been quiet for {n} days, well past their usual rhythm.').replace('{n}', p.quietDays)
                : crmT('crm_few_note', 'No estimate yet: a reliable date needs at least 3 orders.'))}</div>`;

    const rhythmStrip = r.orders.length > 1 ? `
        <div class="crm-cadence">${r.orders.slice(-6).map((o, i, arr) => {
            const gap = i > 0 ? Math.round((new Date(o.date) - new Date(arr[i - 1].date)) / CRMPG_DAY_MS) : null;
            return (gap != null ? `<span class="crm-gap">${gap} d</span>` : '') +
                `<span class="crm-dot-order" title="${o.date} · ${crmpgNum(o.kg)} kg"></span>`;
        }).join('')}</div>` : '';

    openModal(r.name, `
        <div class="crm-modal">
            <div class="crm-modal-head">
                <div>
                    <div class="crm-muted">${crmpgEsc(r.category)} · ${crmpgEsc(r.city || '—')}
                        · ${crmpgEsc(crmT('crm_sales', 'Sales'))}: ${crmpgEsc(r.ownerName || crmT('crm_unassigned', 'Unassigned'))}</div>
                </div>
                ${crmpgStatusChip(r.status)}
            </div>

            <div class="crm-tabs">
                <button class="btn btn-secondary btn-sm crm-mtab active" onclick="crmpgModalTab(this,'crm-cust-perf')">${crmpgEsc(crmT('crm_tab_performance', 'Performance'))}</button>
                <button class="btn btn-secondary btn-sm crm-mtab" onclick="crmpgModalTab(this,'crm-cust-journey')">${crmpgEsc(crmT('crm_tab_journey', 'Journey'))}</button>
            </div>

            <div id="crm-cust-perf" class="crm-mpane">
                <div class="crm-stats">
                    <div class="crm-stat"><b>${crmpgNum(r.kgAll)}</b><span>${crmpgEsc(crmT('crm_kg_lifetime', 'kg lifetime'))}</span></div>
                    <div class="crm-stat"><b>${r.orderCount}</b><span>${crmpgEsc(crmT('crm_orders', 'orders'))}</span></div>
                    <div class="crm-stat"><b>${r.shippedCount ? crmpgNum(r.kgAll / r.shippedCount) : '—'}</b><span>${crmpgEsc(crmT('crm_kg_per_order', 'kg per order'))}</span></div>
                    <div class="crm-stat"><b>${r.predict.rhythm ? Math.round(r.predict.rhythm) + ' d' : '—'}</b><span>${crmpgEsc(crmT('crm_rhythm', 'rhythm'))}</span></div>
                    <div class="crm-stat"><b>${crmpgShortDate(r.firstOrder)}</b><span>${crmpgEsc(crmT('crm_first_order', 'first order'))}</span></div>
                    <div class="crm-stat"><b>${crmpgShortDate(r.lastOrder)}</b><span>${crmpgEsc(crmT('crm_last_order', 'last order'))}</span></div>
                </div>

                <div class="crm-two">
                    <div class="crm-card">
                        <div class="crm-label">${crmpgEsc(crmT('crm_kg_per_month', 'kg per month'))}</div>
                        ${crmpgBarsHtml(crmpgMonthLabels(r.months), r.monthly)}
                    </div>
                    <div class="crm-card">${forecast}</div>
                </div>

                <div class="crm-two">
                    <div class="crm-card">
                        <div class="crm-label">${crmpgEsc(crmT('crm_what_they_buy', 'What they buy · by kg'))}</div>
                        ${crmpgCoffeeListHtml(r.coffee)}
                    </div>
                    <div class="crm-card">
                        <div class="crm-label">${crmpgEsc(crmT('crm_order_rhythm', 'Order rhythm — gaps between orders'))}</div>
                        ${rhythmStrip || `<div class="crm-muted">${crmpgEsc(crmT('crm_no_history', 'no history yet'))}</div>`}
                    </div>
                </div>
            </div>

            <div id="crm-cust-journey" class="crm-mpane hidden">
                ${crmpgJourneyHtml(r)}
            </div>
        </div>`);
}

function crmpgModalTab(btn, paneId) {
    const wrap = btn.closest('.crm-modal');
    if (!wrap) return;
    wrap.querySelectorAll('.crm-mtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    wrap.querySelectorAll('.crm-mpane').forEach(p => p.classList.toggle('hidden', p.id !== paneId));
}

/* ---------------------------------------------------------------------------
   9. Journey customer — milestone DIHITUNG, bukan diketik
--------------------------------------------------------------------------- */
function crmpgJourneyHtml(r) {
    if (!r.orders.length) {
        return `<div class="crm-muted">${crmpgEsc(crmT('crm_journey_empty', 'Nothing to tell yet — this customer has never ordered.'))}</div>`;
    }

    const events = [];
    const first = r.orders[0];
    events.push({ date: first.date, title: crmT('crm_ev_first', 'First order'),
        detail: `${crmpgNum(first.kg)} kg` });

    if (r.orders.length > 1) {
        events.push({ date: r.orders[1].date, title: crmT('crm_ev_repeat', 'Came back for a second order'),
            detail: crmT('crm_ev_repeat_sub', '{n} days after the first').replace('{n}', daysBetween(first.date, r.orders[1].date)) });
    }

    let best = r.orders[0];
    r.orders.forEach(o => { if (o.kg > best.kg) best = o; });
    if (best.kg > 0 && best !== first) {
        events.push({ date: best.date, title: crmT('crm_ev_biggest', 'Biggest order so far'), detail: `${crmpgNum(best.kg)} kg` });
    }

    // Kembali setelah lama menghilang.
    for (let i = 1; i < r.orders.length; i++) {
        const gap = daysBetween(r.orders[i - 1].date, r.orders[i].date);
        if (r.predict.rhythm && gap > r.predict.rhythm * 2.5) {
            events.push({ date: r.orders[i].date, title: crmT('crm_ev_comeback', 'Came back after a long silence'),
                detail: crmT('crm_ev_comeback_sub', '{n} days without an order').replace('{n}', gap) });
        }
    }

    // Ulang tahun jadi pelanggan.
    const years = Math.floor(daysBetween(first.date, todayDateStr()) / 365);
    if (years >= 1) {
        events.push({ date: crmpgAddDays(first.date, years * 365),
            title: crmT('crm_ev_anniversary', '{n} year as a customer').replace('{n}', years), detail: '' });
    }

    events.sort((a, b) => a.date.localeCompare(b.date));

    return `
        <div class="crm-card crm-recap">
            <div class="crm-label">${crmpgEsc(crmT('crm_recap', 'Recap'))}</div>
            <div class="crm-recap-line">${crmpgEsc(
                crmT('crm_recap_text', 'Customer since {since}. {orders} orders, {kg} kg, most of it {coffee}.')
                    .replace('{since}', crmpgShortDate(r.firstOrder))
                    .replace('{orders}', r.orderCount)
                    .replace('{kg}', crmpgNum(r.kgAll))
                    .replace('{coffee}', (Object.entries(r.coffee).sort((a, b) => b[1] - a[1])[0] || ['—'])[0]))}</div>
        </div>
        <div class="crm-timeline">
            ${events.map(e => `
                <div class="crm-tl-item">
                    <div class="crm-tl-date">${crmpgShortDate(e.date)}</div>
                    <div>
                        <div class="crm-tl-title">${crmpgEsc(e.title)}</div>
                        ${e.detail ? `<div class="crm-sub">${crmpgEsc(e.detail)}</div>` : ''}
                    </div>
                </div>`).join('')}
        </div>`;
}

/* ---------------------------------------------------------------------------
   10. Tab Sales Performance
--------------------------------------------------------------------------- */
function crmpgRenderSalesTab() {
    const box = document.getElementById('crm-sales-cards');
    const tbody = document.getElementById('crm-sales-table-body');
    if (!box || !tbody) return;

    const ranked = _crmpgSalesRows.filter(s => s.rankable && !s.unassigned);

    box.innerHTML = ranked.slice(0, 2).map(s => `
        <div class="crm-card">
            <div class="crm-modal-head">
                <div><b style="font-size:16px">${crmpgEsc(s.name)}</b>
                    <div class="crm-muted">${s.customers.length} ${crmpgEsc(crmT('crm_customers', 'customers'))}</div></div>
            </div>
            <div class="crm-stats">
                <div class="crm-stat"><b>${crmpgNum(s.kgAll)}</b><span>${crmpgEsc(crmT('crm_kg_dispatched', 'kg dispatched'))}</span></div>
                <div class="crm-stat"><b>${s.ordersAll}</b><span>${crmpgEsc(crmT('crm_orders', 'orders'))}</span></div>
                <div class="crm-stat"><b>${s.activeCustomers}/${s.customers.length}</b><span>${crmpgEsc(crmT('crm_active_customers', 'active customers'))}</span></div>
                <div class="crm-stat"><b>${s.repeatRate == null ? '—' : s.repeatRate + '%'}</b><span>${crmpgEsc(crmT('crm_ordered_again', 'ordered again'))}</span></div>
                <div class="crm-stat"><b>${s.goneQuiet}</b><span>${crmpgEsc(crmT('crm_needs_attention', 'needs attention'))}</span></div>
                <div class="crm-stat"><b>${crmpgNum(s.kgPerCustomer)}</b><span>${crmpgEsc(crmT('crm_kg_per_customer', 'kg per customer'))}</span></div>
            </div>
        </div>`).join('') || `<div class="crm-muted">${crmpgEsc(crmT('crm_no_sales', 'No sales holds any customer yet.'))}</div>`;

    tbody.innerHTML = _crmpgSalesRows.map(s => `
        <tr class="${s.rankable ? 'crm-row' : 'crm-row crm-row-muted'}"
            ${s.rankable ? `onclick="crmpgOpenSales('${crmpgEsc(s.key).replace(/'/g, "\\'")}')"` : ''}>
            <td><strong>${crmpgEsc(s.name)}</strong>${s.noCustomers
                ? ` <span class="crm-chip crm-chip-grey">${crmpgEsc(crmT('crm_no_customers', 'holds no customers'))}</span>` : ''}</td>
            <td class="crm-right"><b>${crmpgNum(s.kgAll)}</b></td>
            <td class="crm-right">${s.ordersAll}</td>
            <td class="crm-right">${s.customers.length || '—'}</td>
            <td class="crm-right">${s.customers.length ? s.activeCustomers : '—'}</td>
            <td class="crm-right">${s.repeatRate == null ? '—' : s.repeatRate + '%'}</td>
            <td class="crm-right">${s.customers.length ? s.goneQuiet : '—'}</td>
            <td class="crm-right">${s.customers.length ? crmpgNum(s.kgPerCustomer) : '—'}</td>
            <td class="crm-right">${s.cancelled || 0}</td>
            <td class="crm-muted">${s.kgPrev90 > 0
                ? (s.kgDelta >= 0 ? '+' : '') + crmpgNum(s.kgDelta) + ' kg'
                : crmpgEsc(crmT('crm_first_period', 'first full period'))}</td>
        </tr>`).join('');
}

function crmpgOpenSales(key) {
    const s = _crmpgSalesRows.find(x => x.key === key);
    if (!s) return;

    const months = _crmpgRows.length ? _crmpgRows[0].months : [];
    const monthly = months.map(m => s.customers.reduce((sum, c) =>
        sum + c.shipped.filter(o => crmpgMonthKey(o.date) === m).reduce((x, o) => x + o.kg, 0), 0));

    const coffee = {};
    s.customers.forEach(c => Object.entries(c.coffee).forEach(([k, v]) => { coffee[k] = (coffee[k] || 0) + v; }));

    const attention = s.customers
        .filter(c => c.status === 'dormant' || c.status === 'slipping' ||
            (c.predict.ok && c.predict.daysUntil <= 3))
        .sort((a, b) => b.kgAll - a.kgAll).slice(0, 5);

    openModal(s.name, `
        <div class="crm-modal">
            <div class="crm-modal-head">
                <div class="crm-muted">${s.customers.length} ${crmpgEsc(crmT('crm_customers', 'customers'))} ·
                    ${crmpgNum(s.kgAll)} kg · ${s.ordersAll} ${crmpgEsc(crmT('crm_orders', 'orders'))}</div>
            </div>

            <div class="crm-tabs">
                <button class="btn btn-secondary btn-sm crm-mtab active" onclick="crmpgModalTab(this,'crm-sales-perf')">${crmpgEsc(crmT('crm_tab_performance', 'Performance'))}</button>
                <button class="btn btn-secondary btn-sm crm-mtab" onclick="crmpgModalTab(this,'crm-sales-customers')">${crmpgEsc(crmT('crm_tab_customers', 'Customers'))} · ${s.customers.length}</button>
                <button class="btn btn-secondary btn-sm crm-mtab" onclick="crmpgModalTab(this,'crm-sales-journey')">${crmpgEsc(crmT('crm_tab_journey', 'Journey'))}</button>
            </div>

            <div id="crm-sales-perf" class="crm-mpane">
                <div class="crm-stats">
                    <div class="crm-stat"><b>${crmpgNum(s.kgAll)}</b><span>${crmpgEsc(crmT('crm_kg_dispatched', 'kg dispatched'))}</span></div>
                    <div class="crm-stat"><b>${s.ordersAll}</b><span>${crmpgEsc(crmT('crm_orders', 'orders'))}</span></div>
                    <div class="crm-stat"><b>${s.customers.length}</b><span>${crmpgEsc(crmT('crm_customers', 'customers'))}</span></div>
                    <div class="crm-stat"><b>${s.repeatRate == null ? '—' : s.repeatRate + '%'}</b><span>${crmpgEsc(crmT('crm_ordered_again', 'ordered again'))}</span></div>
                    <div class="crm-stat"><b>${s.goneQuiet}</b><span>${crmpgEsc(crmT('crm_needs_attention', 'needs attention'))}</span></div>
                    <div class="crm-stat"><b>${s.onceOnly}</b><span>${crmpgEsc(crmT('crm_once_only', 'ordered once only'))}</span></div>
                </div>
                <div class="crm-two">
                    <div class="crm-card">
                        <div class="crm-label">${crmpgEsc(crmT('crm_kg_per_month', 'kg per month'))}</div>
                        ${crmpgBarsHtml(crmpgMonthLabels(months), monthly)}
                    </div>
                    <div class="crm-card">
                        <div class="crm-label">${crmpgEsc(crmT('crm_volume_from', 'Where the volume comes from'))}</div>
                        ${crmpgCoffeeListHtml(coffee)}
                    </div>
                </div>
                <div class="crm-card">
                    <div class="crm-label">${crmpgEsc(crmT('crm_needs_this_week', 'Needs attention this week'))}</div>
                    ${attention.length ? attention.map(c => `
                        <div class="crm-legend-row">
                            <span><b>${crmpgEsc(c.name)}</b> — ${crmpgStatusChip(c.status)}</span>
                            <span class="crm-muted">${c.daysSince != null
                                ? crmpgEsc(crmT('crm_quiet_days', 'quiet {n} days').replace('{n}', c.daysSince)) : ''}</span>
                            <b>${crmpgNum(c.kgAll)} kg</b>
                        </div>`).join('')
                        : `<div class="crm-muted">${crmpgEsc(crmT('crm_all_on_track', 'Nobody is overdue right now.'))}</div>`}
                </div>
            </div>

            <div id="crm-sales-customers" class="crm-mpane hidden">
                <div class="table-container">
                    <table>
                        <thead><tr>
                            <th>${crmpgEsc(crmT('crm_customer', 'Customer'))}</th>
                            <th>${crmpgEsc(crmT('crm_col_category', 'Category'))}</th>
                            <th class="crm-right">${crmpgEsc(crmT('crm_orders', 'orders'))}</th>
                            <th class="crm-right">kg</th>
                            <th>${crmpgEsc(crmT('crm_rhythm', 'rhythm'))}</th>
                            <th>${crmpgEsc(crmT('crm_last_order', 'last order'))}</th>
                            <th>${crmpgEsc(crmT('crm_next_order_short', 'Next order'))}</th>
                            <th>${crmpgEsc(crmT('crm_col_status', 'Status'))}</th>
                        </tr></thead>
                        <tbody>
                            ${s.customers.slice().sort((a, b) => b.kgAll - a.kgAll).map(c => `
                                <tr class="crm-row" onclick="crmpgOpenCustomer(${c.id})">
                                    <td><strong>${crmpgEsc(c.name)}</strong><div class="crm-sub">${crmpgEsc(c.city || '—')}</div></td>
                                    <td>${crmpgEsc(c.category)}</td>
                                    <td class="crm-right">${c.orderCount}</td>
                                    <td class="crm-right"><b>${crmpgNum(c.kgAll)}</b></td>
                                    <td>${c.predict.rhythm ? crmpgEsc(crmT('crm_every_days', 'every ~{n} d').replace('{n}', Math.round(c.predict.rhythm))) : '—'}</td>
                                    <td>${crmpgShortDate(c.lastOrder)}</td>
                                    <td>${crmpgNextOrderCell(c)}</td>
                                    <td>${crmpgStatusChip(c.status)}</td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="crm-sales-journey" class="crm-mpane hidden">
                <div class="crm-empty-pane">
                    <div class="crm-empty-title">${crmpgEsc(crmT('crm_tab_journey', 'Journey'))}</div>
                    <div class="crm-muted">${crmpgEsc(crmT('crm_sales_journey_empty',
                        'Left empty on purpose — this one gets designed later. The data it will need is already being recorded, so nothing is lost in the meantime.'))}</div>
                </div>
            </div>
        </div>`);
}

// Dipanggil dari app.js saat section dibuka lewat menu.
window.loadCrmSection = loadCrmSection;
window.loadCrmTabSpecificData = loadCrmTabSpecificData;
