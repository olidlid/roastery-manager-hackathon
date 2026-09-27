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
    // Dropdown status tidak ikut tergambar ulang (dibangun sekali), jadi
    // nilainya harus dikembalikan sendiri — kalau tidak, layar berkata
    // "Dormant" padahal tabelnya sudah menampilkan semua.
    const statusSel = document.getElementById('crm-status-filter');
    if (statusSel) statusSel.value = 'all';
    crmpgRenderTiles();
    crmpgRenderKpis();
    crmpgRenderTable();
}

function crmpgSearch(value) {
    _crmpgFilter.search = (value || '').toLowerCase();
    crmpgRenderTable();
}

// Satu-satunya definisi "ada filter aktif" — dipakai tombol reset maupun
// baris hitungan, supaya keduanya tidak pernah berbeda pendapat.
function crmpgHasActiveFilter() {
    return _crmpgFilter.sales !== 'all'
        || _crmpgFilter.category !== 'all'
        || _crmpgFilter.status !== 'all'
        || !!_crmpgFilter.kpi
        || !!_crmpgFilter.search;
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

// Satu tempat untuk kalimat waktu, supaya tabel dan modal tidak pernah
// berbeda kata — dan supaya "1 days overdue" tidak pernah terbaca lagi.
function crmpgDueText(daysUntil) {
    if (daysUntil < 0) {
        const n = Math.abs(daysUntil);
        return n === 1 ? crmT('crm_overdue_day', '1 day overdue')
                       : crmT('crm_overdue_days', '{n} days overdue').replace('{n}', n);
    }
    if (daysUntil === 0) return crmT('crm_due_today', 'due today');
    return daysUntil === 1 ? crmT('crm_in_day', 'tomorrow')
                           : crmT('crm_in_days', 'in {n} days').replace('{n}', daysUntil);
}

function crmpgQuietText(days) {
    return days === 1 ? crmT('crm_quiet_day', 'quiet 1 day')
                      : crmT('crm_quiet_days', 'quiet {n} days').replace('{n}', days);
}

function crmpgNextOrderCell(r) {
    const p = r.predict;
    if (!p.ok) {
        if (p.reason === 'dormant') {
            return `<span class="crm-muted">${crmpgEsc(crmT('crm_no_estimate', 'no estimate'))}</span>
                <div class="crm-sub">${crmpgEsc(crmpgQuietText(p.quietDays))}</div>`;
        }
        if (p.reason === 'none') {
            return `<span class="crm-muted">—</span>
                <div class="crm-sub">${crmpgEsc(crmT('crm_no_history', 'no history yet'))}</div>`;
        }
        return `<span class="crm-muted">${crmpgEsc(crmT('crm_no_estimate', 'no estimate'))}</span>
            <div class="crm-sub">${crmpgEsc(crmT('crm_need_three', 'needs 3 orders'))}</div>`;
    }

    const due = crmpgDueText(p.daysUntil);
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

    const resetBtn = document.getElementById('crm-reset-filters');
    if (resetBtn) resetBtn.classList.toggle('hidden', !crmpgHasActiveFilter());

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
        </div>
        <div class="crm-bar-label">${crmpgEsc(labels[i])}</div>`).join('') + `</div>`;
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

// Filter periode hanya menyaring KOLOM KIRI (kg dari waktu ke waktu + apa yang
// mereka beli). Kolom kanan sengaja tidak ikut: ritme dan perkiraan selalu
// menjawab "apa yang terjadi berikutnya", dan menyaringnya dengan "year to
// date" akan menghasilkan ramalan dari order basi — angka yang terlihat presisi
// tapi salah.
let _crmpgModalPeriod = 'all';

// Jejak "datang dari mana". Modal customer yang dibuka DARI modal sales harus
// bisa kembali ke daftar itu — menutup dengan silang membuang dua langkah
// navigasi sekaligus dan memaksa leader mengulang dari tabel sales.
// Disimpan sebagai key, bukan disisipkan ke onclick, supaya nama sales yang
// mengandung kutip tidak pernah bisa merusak HTML-nya.
let _crmpgSalesModalKey = null;
let _crmpgCustomerBackKey = null;

const CRMPG_PERIOD_META = [
    { id: 'all',     key: 'crm_period_all',     fallback: 'All time' },
    { id: 'ytd',     key: 'crm_period_ytd',     fallback: 'Year to date' },
    { id: 'monthly', key: 'crm_period_monthly', fallback: 'Monthly' },
    { id: 'mtd',     key: 'crm_period_mtd',     fallback: 'Month to date' }
];

function crmpgMonthKeysBetween(fromKey, toKey) {
    const out = [];
    let [y, m] = fromKey.split('-').map(Number);
    const [ty, tm] = toKey.split('-').map(Number);
    // Jaga-jaga terhadap data bertanggal aneh: setahun penuh grafik sudah
    // banyak, 240 batang berarti ada yang salah di datanya.
    while ((y < ty || (y === ty && m <= tm)) && out.length < 240) {
        out.push(y + '-' + String(m).padStart(2, '0'));
        m++; if (m > 12) { m = 1; y++; }
    }
    return out;
}

function crmpgMixOfOrders(orders) {
    const data = _crmpgData || { items: [] };
    const ids = new Set(orders.map(o => o.id));
    const mix = {};
    (data.items || []).forEach(i => {
        if (!ids.has(i.request_order_id)) return;
        const kg = (parseInt(i.quantity_requested) || 0) * (parseInt(i.bag_size_g) || 0) / 1000;
        if (!kg) return;
        const name = crmpgCoffeeLabel(i, data);
        mix[name] = (mix[name] || 0) + kg;
    });
    return mix;
}

// Semua yang berubah mengikuti filter periode, dihitung di satu tempat.
function crmpgPeriodData(r, period) {
    const today = todayDateStr();
    const thisMonth = today.slice(0, 7);
    let orders, buckets, label, range;

    if (period === 'mtd') {
        // "Setiap hari yang ada ordernya" — hari kosong tidak diberi batang,
        // jadi tiga order menghasilkan tiga batang, bukan tiga puluh.
        orders = r.shipped.filter(o => o.date.slice(0, 7) === thisMonth);
        buckets = orders.map(o => ({ label: crmpgShortDate(o.date), kg: o.kg }));
        label = crmT('crm_kg_per_day', 'kg per day · days with an order');
        range = crmpgShortDate(thisMonth + '-01') + ' – ' + crmpgShortDate(today);
    } else {
        let firstKey;
        if (period === 'ytd') {
            firstKey = today.slice(0, 4) + '-01';
            range = crmpgShortDate(firstKey + '-01') + ' – ' + crmpgShortDate(today);
        } else if (period === 'monthly') {
            const d = new Date(today + 'T00:00:00');
            d.setMonth(d.getMonth() - 11);
            firstKey = d.toISOString().slice(0, 7);
            range = crmT('crm_last_12_months', 'last 12 months');
        } else {
            firstKey = (r.shipped[0] ? r.shipped[0].date : today).slice(0, 7);
            range = r.shipped.length
                ? crmT('crm_since', 'since {d}').replace('{d}', crmpgShortDate(r.shipped[0].date))
                : '';
        }
        const keys = crmpgMonthKeysBetween(firstKey, thisMonth);
        const keySet = new Set(keys);
        orders = r.shipped.filter(o => keySet.has(o.date.slice(0, 7)));
        // Bulan kosong tetap diberi batang: kalau dihapus, masa sepi terbaca
        // seolah tidak pernah ada.
        buckets = keys.map(k => ({
            label: CRMPG_MONTHS[parseInt(k.slice(5, 7), 10) - 1] +
                   (k.slice(0, 4) !== today.slice(0, 4) ? " '" + k.slice(2, 4) : ''),
            kg: r.shipped.filter(o => o.date.slice(0, 7) === k).reduce((s, o) => s + o.kg, 0)
        }));
        label = crmT('crm_kg_per_month', 'kg per month');
    }

    return {
        buckets, label, range,
        mix: crmpgMixOfOrders(orders),
        count: orders.length,
        total: orders.reduce((s, o) => s + o.kg, 0)
    };
}

function crmpgBarsFromBuckets(buckets) {
    if (!buckets.length) {
        return `<div class="crm-muted" style="text-align:center;padding:24px 0">
            ${crmpgEsc(crmT('crm_no_order_period', 'No order in this period.'))}</div>`;
    }
    const max = Math.max(...buckets.map(b => b.kg), 1);
    return `<div class="crm-bars">` + buckets.map(b => `
        <div class="crm-bar-col" title="${crmpgEsc(b.label)}: ${crmpgNum(b.kg)} kg">
            <div class="crm-bar-val">${crmpgNum(b.kg)}</div>
            <div class="crm-bar" style="height:${Math.max(2, Math.round((b.kg / max) * 100))}%"></div>
        </div>
        <div class="crm-bar-label" title="${crmpgEsc(b.label)}: ${crmpgNum(b.kg)} kg">${crmpgEsc(b.label)}</div>`).join('') + `</div>`;
}

function crmpgLeftColumnHtml(r, period) {
    const d = crmpgPeriodData(r, period);
    return `
        <div class="crm-periods">
            ${CRMPG_PERIOD_META.map(p => `
                <button class="btn btn-secondary btn-sm crm-period${p.id === period ? ' active' : ''}"
                        onclick="crmpgSetPeriod(${r.id}, '${p.id}')">${crmpgEsc(crmT(p.key, p.fallback))}</button>`).join('')}
            <span class="crm-range crm-muted">${crmpgEsc(d.range)}</span>
        </div>

        <div class="crm-card crm-hug">
            <div class="crm-label">${crmpgEsc(d.label)}</div>
            ${crmpgBarsFromBuckets(d.buckets)}
        </div>

        <div class="crm-card crm-fill">
            <div class="crm-label">${crmpgEsc(crmT('crm_what_they_buy', 'What they buy · by kg'))}</div>
            ${crmpgCoffeeListHtml(d.mix)}
            <div class="crm-period-total crm-muted">${crmpgEsc(crmpgPeriodSummary(d))}</div>
        </div>`;
}

function crmpgPeriodSummary(d) {
    if (!d.count) return crmT('crm_no_order_period', 'No order in this period.');
    const key = d.count === 1 ? 'crm_period_summary_one' : 'crm_period_summary';
    const fallback = d.count === 1
        ? '1 order · {kg} kg in this period'
        : '{n} orders · {kg} kg in this period';
    return crmT(key, fallback).replace('{n}', d.count).replace('{kg}', crmpgNum(d.total));
}

function crmpgSetPeriod(customerId, period) {
    const r = _crmpgRows.find(x => x.id === customerId);
    const box = document.getElementById('crm-cust-left');
    if (!r || !box) return;
    _crmpgModalPeriod = period;
    box.innerHTML = crmpgLeftColumnHtml(r, period);
}

// Ritme: tiap titik membawa kg ordernya. Titik terakhir adalah order yang
// DIPERKIRAKAN — digambar berongga supaya tidak pernah terbaca sebagai order
// yang sudah terjadi.
function crmpgRhythmHtml(r) {
    if (!r.orders.length) {
        return `<div class="crm-muted">${crmpgEsc(crmT('crm_no_history', 'no history yet'))}</div>`;
    }
    const recent = r.orders.slice(-6);
    let html = recent.map((o, i) => {
        const gap = i > 0
            ? Math.round((new Date(o.date) - new Date(recent[i - 1].date)) / CRMPG_DAY_MS)
            : null;
        return (gap != null ? `<span class="crm-gap">${gap} d</span>` : '') + `
            <span class="crm-point">
                <span class="crm-point-kg">${crmpgNum(o.kg)}</span>
                <span class="crm-dot-order"></span>
                <span class="crm-point-date">${crmpgShortDate(o.date)}</span>
            </span>`;
    }).join('');

    const p = r.predict;
    if (p.ok) {
        const gap = daysBetween(r.lastOrder, p.nextDate);
        html += `<span class="crm-gap crm-gap-next">${gap} d</span>
            <span class="crm-point crm-point-next">
                <span class="crm-point-kg">${p.expectedKg ? '~' + crmpgNum(p.expectedKg) : '?'}</span>
                <span class="crm-dot-order"></span>
                <span class="crm-point-date">${crmpgShortDate(p.nextDate)}</span>
            </span>`;
    }
    return `<div class="crm-cadence">${html}</div>`;
}

// Perkiraan order berikutnya. Kartu ini sekarang setinggi sisa kolom, jadi
// muat memuat rincian kopinya — bukan lagi tanggal dan berat di ruang kosong.
function crmpgForecastHtml(r) {
    const p = r.predict;
    if (!p.ok) {
        return `<div class="crm-label">${crmpgEsc(crmT('crm_next_order', 'Next order — estimate'))}</div>
            <div class="crm-muted">${crmpgEsc(
                p.reason === 'dormant'
                    ? crmT('crm_dormant_note', 'No estimate: this customer has been quiet for {n} days, well past their usual rhythm.').replace('{n}', p.quietDays)
                    : crmT('crm_few_note', 'No estimate yet: a reliable date needs at least 3 orders.'))}</div>`;
    }

    const last3 = r.shipped.slice(-3);
    const mix = crmpgMixOfOrders(last3);
    const mixTotal = Object.values(mix).reduce((s, v) => s + v, 0);
    const expected = p.expectedKg || 0;

    let table = '';
    if (mixTotal > 0 && expected > 0) {
        const rows = Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([name, kg]) => {
            const share = kg / mixTotal;
            return `<tr>
                <td>${crmpgEsc(name)}</td>
                <td class="crm-right"><b>${crmpgNum(expected * share)}</b></td>
                <td class="crm-right crm-muted">${Math.round(share * 100)}%</td>
            </tr>`;
        }).join('');
        table = `
            <div class="crm-label">${crmpgEsc(crmT('crm_likely_order', 'What they will most likely order'))}</div>
            <table class="crm-forecast-table">
                <thead><tr>
                    <th>${crmpgEsc(crmT('crm_coffee', 'Coffee'))}</th>
                    <th class="crm-right">kg</th>
                    <th class="crm-right">${crmpgEsc(crmT('crm_share', 'Share'))}</th>
                </tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr>
                    <td><b>${crmpgEsc(crmT('crm_total', 'Total'))}</b></td>
                    <td class="crm-right"><b>${crmpgNum(expected)}</b></td><td></td>
                </tr></tfoot>
            </table>`;
    }

    return `
        <div class="crm-forecast">
            <div>
                <div class="crm-label">${crmpgEsc(crmT('crm_next_order', 'Next order — estimate'))}</div>
                <div class="crm-big">${crmpgShortDate(p.nextDate)}</div>
                <div class="crm-muted">± ${p.plusMinus} ${crmpgEsc(crmT('crm_days', 'days'))} ·
                    ${crmpgEsc(crmT('crm_confidence_' + p.confidence, p.confidence + ' confidence'))}</div>
            </div>
            <div class="crm-right-block">
                <div class="crm-label">${crmpgEsc(crmT('crm_expected_size', 'Expected size'))}</div>
                <div class="crm-big">${expected ? '≈ ' + crmpgNum(expected) + ' kg' : '—'}</div>
                <div class="crm-muted">${p.kgLow != null ? crmpgNum(p.kgLow) + '–' + crmpgNum(p.kgHigh) + ' kg' : ''}</div>
            </div>
        </div>
        ${table ? '<div class="crm-rule"></div>' + table : ''}
        <div class="crm-forecast-note crm-muted">${crmpgEsc(
            crmT('crm_method_note', 'Based on {n} past orders, method: {m}.')
                .replace('{n}', p.orderCount)
                .replace('{m}', p.method === 'mixed'
                    ? crmT('crm_method_mixed', 'order rhythm + consumption rate, weighted by this customer\'s own past accuracy')
                    : crmT('crm_method_rhythm', 'order rhythm only — under 6 orders the mix stays off')))}
            ${mixTotal > 0 ? crmpgEsc(crmT('crm_mix_source', 'Size and coffee split taken from the last {n} orders ({kg} kg).')
                .replace('{n}', last3.length).replace('{kg}', crmpgNum(mixTotal))) : ''}</div>`;
}

function crmpgBackBarHtml() {
    if (!_crmpgCustomerBackKey) return '';
    const s = _crmpgSalesRows.find(x => x.key === _crmpgCustomerBackKey);
    if (!s) return '';
    return `<div class="crm-back">
        <button class="btn btn-secondary btn-sm" onclick="crmpgBackToSales()">
            &larr; ${crmpgEsc(crmT('crm_back_to', 'Back to {name}').replace('{name}', s.name))}
        </button>
    </div>`;
}

function crmpgBackToSales() {
    const key = _crmpgCustomerBackKey;
    if (!key) return;
    crmpgOpenSales(key, 'crm-sales-customers');
}

function crmpgOpenCustomer(customerId, fromSalesModal) {
    const r = _crmpgRows.find(x => x.id === customerId);
    if (!r) return;
    _crmpgModalPeriod = 'all';
    _crmpgCustomerBackKey = fromSalesModal ? _crmpgSalesModalKey : null;

    openModal(r.name, `
        <div class="crm-modal">
            ${crmpgBackBarHtml()}
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

                <div class="crm-cols">
                    <!-- Kiri: ikut filter periode -->
                    <div class="crm-stack" id="crm-cust-left">
                        ${crmpgLeftColumnHtml(r, _crmpgModalPeriod)}
                    </div>

                    <!-- Kanan: ritme sekecil isinya, perkiraan mengisi sisanya -->
                    <div class="crm-stack">
                        <div class="crm-card crm-hug">
                            <div class="crm-label">${crmpgEsc(crmT('crm_order_rhythm_kg', 'Order rhythm — kg per order'))}</div>
                            ${crmpgRhythmHtml(r)}
                        </div>
                        <div class="crm-card crm-fill">
                            ${crmpgForecastHtml(r)}
                        </div>
                    </div>
                </div>
            </div>

            <div id="crm-cust-journey" class="crm-mpane hidden">
                ${crmpgJourneyHtml(r)}
            </div>
        </div>`, '1080px');
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
    const tbody = document.getElementById('crm-sales-table-body');
    if (!tbody) return;

    if (!_crmpgSalesRows.length) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-secondary)">
            ${crmpgEsc(crmT('crm_no_sales', 'No sales holds any customer yet.'))}</td></tr>`;
        return;
    }

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

// Kenapa customer ini masuk daftar perhatian. Sempat selalu berbunyi
// "quiet N days", sehingga customer yang justru akan order lusa terbaca
// seolah menghilang — kebalikan dari keadaan sebenarnya.
function crmpgAttentionReason(c) {
    if (c.status === 'dormant' || c.status === 'slipping') {
        return c.daysSince != null ? crmpgQuietText(c.daysSince) : '';
    }
    return (c.predict && c.predict.ok) ? crmpgDueText(c.predict.daysUntil) : '';
}

function crmpgOpenSales(key, activePaneId) {
    const s = _crmpgSalesRows.find(x => x.key === key);
    if (!s) return;
    _crmpgSalesModalKey = key;
    _crmpgCustomerBackKey = null;

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
                            <span class="crm-muted">${crmpgEsc(crmpgAttentionReason(c))}</span>
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
                                <tr class="crm-row" onclick="crmpgOpenCustomer(${c.id}, true)">
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
        </div>`, '1080px');

    // Dibuka lewat tombol Back: kembalikan ke tab yang tadi ditinggalkan,
    // bukan ke Performance — kalau tidak, leader harus mengklik ulang tab
    // Customers setiap kali menutup satu customer.
    if (activePaneId) {
        const btns = document.querySelectorAll('#modal-container .crm-mtab');
        const target = [...btns].find(b => (b.getAttribute('onclick') || '').includes(activePaneId));
        if (target) target.click();
    }
}

// Dipanggil dari app.js saat section dibuka lewat menu.
window.loadCrmSection = loadCrmSection;
window.loadCrmTabSpecificData = loadCrmTabSpecificData;
