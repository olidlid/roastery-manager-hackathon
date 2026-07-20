// MAIN APPLICATION CODE - ROASTERY MANAGER V2 (GLOBAL SCRIPT VERSION)

// --- COOKIE HELPERS ---
function setCookie(name, value, days = 30) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "; expires=" + date.toUTCString();
    document.cookie = name + "=" + (value || "")  + expires + "; path=/; SameSite=Lax";
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i=0;i < ca.length;i++) {
        let c = ca[i];
        while (c.charAt(0)==' ') c = c.substring(1,c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length,c.length);
    }
    return null;
}

// --- INSTANT BRAND PRIME (avoid flash of "Roastery Pro" placeholder) ---
// loadCompanySettings() only runs after the profile fetch resolves, so on a
// hard reload the hardcoded placeholder in index.html is visible for one or
// two network round-trips. Prime the sidebar synchronously from whatever we
// cached last time (same pattern already used for custom_roles), then let
// the real Supabase fetch silently correct/refresh it in the background.
(function primeBrandFromCache() {
    try {
        const cached = JSON.parse(localStorage.getItem('cached_company_brand') || 'null');
        if (!cached) return;
        const nameEl = document.getElementById('sidebar-company-name');
        const sloganEl = document.getElementById('sidebar-slogan');
        if (nameEl && cached.company_name) nameEl.textContent = cached.company_name;
        if (sloganEl) {
            sloganEl.textContent = cached.slogan || '';
            sloganEl.classList.toggle('hidden', !cached.slogan);
        }
        // Logo is intentionally NOT primed from cache (user preference): a
        // blank logo box every reload beats a stale one flashing to the
        // current logo right after it's been changed. applyCompanySettings()
        // still fills it in once the real fetch resolves.
    } catch (e) { /* corrupt cache — ignore, real fetch will populate it */ }
})();

// Same rationale, for the logged-in user's name/role/avatar initial in the
// sidebar footer — index.html used to hardcode "Developer Mode" there,
// which flashed for every real user until loadUserProfile()'s fetch
// resolved. Primed here, refreshed by loadUserProfile(), cleared on logout.
(function primeUserFromCache() {
    try {
        const cached = JSON.parse(localStorage.getItem('cached_user_identity') || 'null');
        if (!cached) return;
        const nameEl = document.getElementById('user-name-lbl');
        const roleEl = document.getElementById('user-role-lbl');
        const avatarEl = document.getElementById('user-avatar-lbl');
        if (nameEl && cached.name) nameEl.textContent = cached.name;
        if (roleEl && cached.role) roleEl.textContent = cached.role;
        if (avatarEl && cached.name) avatarEl.textContent = cached.name.charAt(0).toUpperCase();
    } catch (e) { /* corrupt cache — ignore, real fetch will populate it */ }
})();

// --- STATE MANAGEMENT ---
let isMockMode = false;
let currentUser = null;
let batchCurrentPage = 1;
let batchPageSize = 50;
let batchVisibleColumns = [true, true, true, true, true, true, true, true];
let requestCurrentPage = 1;
let requestPageSize = 25;
let approvalCurrentPage = 1;
let approvalPageSize = 25;
let companySettings = {
    company_name: 'Roastery Premium Corp',
    address: '123 Roaster Way, Coffee District',
    phone: '+1 555-ROAST-IT',
    email: 'hello@roasterycorp.com',
    logo_base64: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?q=80&w=100&auto=format&fit=crop',
    handover_title: 'GOODS HANDOVER SLIP',
    show_logo_in_print: true,
    print_footer_text: 'All goods transferred are the responsibility of the sales team.',
    currency: 'USD',
    weight_unit: 'kg',
    min_stock_greenbean_kg: 0,
    min_production_potential_kg: 0,
    min_stock_packed_sizes: {},
    developer_key: 'dev2026',
    // Which text fields print alongside each sticker's (always-on) barcode —
    // see printStickerLabel (roasting.js) / printLotBarcodeLabels (packing.js).
    label_layout: {
        roasting: { coffee_name: true, machine: true, coffee_code: true },
        packed: { code: true, coffee_name: true, dates: true, machine: true },
    },
    // Some thermal printer drivers force their own fixed (portrait) media
    // orientation regardless of the page's own declared size, so the correct
    // landscape 50x25mm label preview still comes out rotated on paper. This
    // is a per-printer quirk, not a bug in every setup, so it's an opt-in
    // toggle rather than always-on — see buildFixedLabelDocument (packing.js)
    // and printStickerLabel (roasting.js) for where it's applied.
    label_rotate_90: false,
};

// Seed initial offline mock databases (used if not connected to Supabase)
const MOCK_DB = {
    green_coffee: [
        { id: 1, code: 'GB1', name: 'Aceh Gayo Arabica', origin: 'Aceh, Indonesia', process: 'Wet Hulled', stock_kg: 0.0, purchase_date: '2026-05-15', purchase_price_per_kg: 8.50, supplier: 'Gayo Estate' },
        { id: 2, code: 'GB2', name: 'Sidikalang Robusta', origin: 'Dairi, Indonesia', process: 'Full Wash', stock_kg: 0.0, purchase_date: '2026-05-20', purchase_price_per_kg: 5.00, supplier: 'Sidikalang Coop' },
        { id: 3, code: 'GB3', name: 'Toraja Arabica', origin: 'Sulawesi, Indonesia', process: 'Natural', stock_kg: 0.0, purchase_date: '2026-06-01', purchase_price_per_kg: 10.00, supplier: 'Toraja Highlands' }
    ],
    green_coffee_intake: [],
    blend_recipes: [
        { id: 1, code: 'R1', name: 'Espresso House Blend', machine_id: 1, batch_size_g: 5000, description: 'Balanced blend for espresso drinks.' }
    ],
    blend_ingredients: [
        { id: 1, blend_recipe_id: 1, green_coffee_id: 1, percentage: 60.0, quantity_g: 3000.0 },
        { id: 2, blend_recipe_id: 1, green_coffee_id: 2, percentage: 40.0, quantity_g: 2000.0 }
    ],
    machines: [
        { id: 1, code: 'M1', name: 'Probat 5kg (Machine #1)', capacity_g: 5000, ideal_batch_size_g: 5000 },
        { id: 2, code: 'M2', name: 'Giesen W6 6kg (Machine #2)', capacity_g: 6000, ideal_batch_size_g: 6000 },
        { id: 3, code: 'M3', name: 'Bullet R1 1kg (Sample Machine)', capacity_g: 1000, ideal_batch_size_g: 1000 }
    ],
    roasting_plans: [],
    roast_batches: [],
    bulk_roasted_coffee: [],
    waste_inventory: [],
    packed_coffee: [],
    request_orders: [],
    request_order_items: [],
    handover_logs: [],
    customers: [],
    profiles: [
        { id: 'dev-id', username: 'developer', role: 'Developer', name: 'Lead Developer' },
        { id: 'roaster-id', username: 'roaster', role: 'Roaster', name: 'Gavin Roaster' }
    ],
    sales_agents: [
        { id: 1, name: 'John Sales', code: 'JS' }
    ],
    packaging_sizes: [
        { id: 1, label: '250g', gram: 250, is_visible: true },
        { id: 2, label: '500g', gram: 500, is_visible: true },
        { id: 3, label: '1000g', gram: 1000, is_visible: true }
    ],
    custom_roles: [
        {
            id: 1, name: 'Developer', color: '#6b21a8', is_system: true,
            permissions: {
                dashboard: true,
                greenbean_view: true, greenbean_delete: true,
                greenbean_arrival_view: true, greenbean_arrival_add: true, greenbean_arrival_edit: true, greenbean_arrival_delete: true,
                greenbean_outbound_view: true, greenbean_outbound_add: true, greenbean_outbound_edit: true, greenbean_outbound_delete: true,
                roasting_view: true, roasting_plan_add: true, roasting_plan_edit: true, roasting_plan_delete: true,
                roasting_batch_view: true, roasting_batch_add: true, roasting_batch_edit: true, roasting_batch_delete: true, roasting_batch_approve: true,
                blend_view: true, blend_add: true, blend_edit: true, blend_delete: true,
                production_potential_view: true,
                packing_view: true, packing_daily: true, packing_print_barcode: true, packing_manual_add: true, packing_order_view: true, packing_records_view: true, packing_unpack: true, packing_completed_view: true, packing_dispatch_checkout: true,
                sales_request_view: true, sales_request_view_own: false, sales_request_create: true, sales_request_edit: true, sales_request_delete: true, sales_request_print: true,
                dispatch_approval_view: true, dispatch_approval_approve: true, dispatch_approval_dispatch: true, dispatch_approval_print: true,
                customer_view: true, customer_add: true, customer_edit: true, customer_delete: true,
                reports_view: true, reports_stockopname_view: true,
                tracking_view: true,
                settings_general: true, settings_production: true, settings_system: true,
                user_management: true, user_delete: true
            }
        },
        {
            id: 2, name: 'Admin', color: '#dc2626', is_system: true,
            permissions: {
                dashboard: true,
                greenbean_view: true, greenbean_delete: true,
                greenbean_arrival_view: true, greenbean_arrival_add: true, greenbean_arrival_edit: true, greenbean_arrival_delete: true,
                greenbean_outbound_view: true, greenbean_outbound_add: true, greenbean_outbound_edit: true, greenbean_outbound_delete: true,
                roasting_view: true, roasting_plan_add: true, roasting_plan_edit: true, roasting_plan_delete: true,
                roasting_batch_view: true, roasting_batch_add: true, roasting_batch_edit: true, roasting_batch_delete: true, roasting_batch_approve: true,
                blend_view: true, blend_add: true, blend_edit: true, blend_delete: true,
                production_potential_view: true,
                packing_view: true, packing_daily: true, packing_print_barcode: true, packing_manual_add: true, packing_order_view: true, packing_records_view: true, packing_unpack: true, packing_completed_view: true, packing_dispatch_checkout: true,
                sales_request_view: true, sales_request_view_own: false, sales_request_create: true, sales_request_edit: true, sales_request_delete: true, sales_request_print: true,
                dispatch_approval_view: true, dispatch_approval_approve: true, dispatch_approval_dispatch: true, dispatch_approval_print: true,
                customer_view: true, customer_add: true, customer_edit: true, customer_delete: true,
                reports_view: true, reports_stockopname_view: true,
                tracking_view: true,
                settings_general: true, settings_production: true, settings_system: true,
                user_management: true, user_delete: true
            }
        },
        {
            id: 3, name: 'Production Leader', color: '#2d5016', is_system: false,
            permissions: {
                dashboard: true,
                greenbean_view: true, greenbean_delete: true,
                greenbean_arrival_view: true, greenbean_arrival_add: true, greenbean_arrival_edit: true, greenbean_arrival_delete: true,
                greenbean_outbound_view: true, greenbean_outbound_add: true, greenbean_outbound_edit: true, greenbean_outbound_delete: true,
                roasting_view: true, roasting_plan_add: true, roasting_plan_edit: true, roasting_plan_delete: true,
                roasting_batch_view: true, roasting_batch_add: true, roasting_batch_edit: true, roasting_batch_delete: true, roasting_batch_approve: true,
                blend_view: true, blend_add: true, blend_edit: true, blend_delete: true,
                production_potential_view: true,
                packing_view: true, packing_daily: true, packing_print_barcode: true, packing_manual_add: true, packing_order_view: true, packing_records_view: true, packing_unpack: true, packing_completed_view: true, packing_dispatch_checkout: true,
                sales_request_view: true, sales_request_view_own: false, sales_request_create: false, sales_request_edit: false, sales_request_delete: false, sales_request_print: true,
                dispatch_approval_view: true, dispatch_approval_approve: true, dispatch_approval_dispatch: true, dispatch_approval_print: true,
                customer_view: true, customer_add: false, customer_edit: false, customer_delete: false,
                reports_view: true, reports_stockopname_view: true,
                tracking_view: true,
                settings_general: false, settings_production: true, settings_system: false,
                user_management: false, user_delete: false
            }
        },
        {
            id: 4, name: 'Roaster', color: '#b45309', is_system: false,
            permissions: {
                dashboard: true,
                greenbean_view: true, greenbean_delete: false,
                greenbean_arrival_view: false, greenbean_arrival_add: false, greenbean_arrival_edit: false, greenbean_arrival_delete: false,
                greenbean_outbound_view: false, greenbean_outbound_add: false, greenbean_outbound_edit: false, greenbean_outbound_delete: false,
                roasting_view: true, roasting_plan_add: false, roasting_plan_edit: false, roasting_plan_delete: false,
                roasting_batch_view: true, roasting_batch_add: true, roasting_batch_edit: false, roasting_batch_delete: false, roasting_batch_approve: false,
                blend_view: true, blend_add: false, blend_edit: false, blend_delete: false,
                production_potential_view: true,
                packing_view: false, packing_daily: false, packing_print_barcode: false, packing_manual_add: false, packing_order_view: false, packing_records_view: false, packing_unpack: false, packing_completed_view: false, packing_dispatch_checkout: false,
                sales_request_view: false, sales_request_view_own: false, sales_request_create: false, sales_request_edit: false, sales_request_delete: false, sales_request_print: false,
                dispatch_approval_view: false, dispatch_approval_approve: false, dispatch_approval_dispatch: false, dispatch_approval_print: false,
                customer_view: false, customer_add: false, customer_edit: false, customer_delete: false,
                reports_view: false, reports_stockopname_view: false,
                tracking_view: false,
                settings_general: false, settings_production: false, settings_system: false,
                user_management: false, user_delete: false
            }
        },
        {
            id: 5, name: 'Packing Team', color: '#0369a1', is_system: false,
            permissions: {
                dashboard: true,
                greenbean_view: false, greenbean_delete: false,
                greenbean_arrival_view: false, greenbean_arrival_add: false, greenbean_arrival_edit: false, greenbean_arrival_delete: false,
                greenbean_outbound_view: false, greenbean_outbound_add: false, greenbean_outbound_edit: false, greenbean_outbound_delete: false,
                roasting_view: false, roasting_plan_add: false, roasting_plan_edit: false, roasting_plan_delete: false,
                roasting_batch_view: false, roasting_batch_add: false, roasting_batch_edit: false, roasting_batch_delete: false, roasting_batch_approve: false,
                blend_view: false, blend_add: false, blend_edit: false, blend_delete: false,
                production_potential_view: false,
                packing_view: true, packing_daily: true, packing_print_barcode: true, packing_manual_add: true, packing_order_view: true, packing_records_view: true, packing_unpack: true, packing_completed_view: true, packing_dispatch_checkout: true,
                sales_request_view: true, sales_request_view_own: false, sales_request_create: false, sales_request_edit: false, sales_request_delete: false, sales_request_print: false,
                dispatch_approval_view: false, dispatch_approval_approve: false, dispatch_approval_dispatch: false, dispatch_approval_print: false,
                customer_view: false, customer_add: false, customer_edit: false, customer_delete: false,
                reports_view: false, reports_stockopname_view: false,
                tracking_view: true,
                settings_general: false, settings_production: false, settings_system: false,
                user_management: false, user_delete: false
            }
        },
        {
            id: 6, name: 'Sales Agent', color: '#7c3aed', is_system: false,
            permissions: {
                dashboard: true,
                greenbean_view: false, greenbean_delete: false,
                greenbean_arrival_view: false, greenbean_arrival_add: false, greenbean_arrival_edit: false, greenbean_arrival_delete: false,
                greenbean_outbound_view: false, greenbean_outbound_add: false, greenbean_outbound_edit: false, greenbean_outbound_delete: false,
                roasting_view: false, roasting_plan_add: false, roasting_plan_edit: false, roasting_plan_delete: false,
                roasting_batch_view: false, roasting_batch_add: false, roasting_batch_edit: false, roasting_batch_delete: false, roasting_batch_approve: false,
                blend_view: false, blend_add: false, blend_edit: false, blend_delete: false,
                production_potential_view: false,
                packing_view: false, packing_daily: false, packing_print_barcode: false, packing_manual_add: false, packing_order_view: false, packing_records_view: false, packing_unpack: false, packing_completed_view: false, packing_dispatch_checkout: false,
                sales_request_view: true, sales_request_view_own: false, sales_request_create: true, sales_request_edit: true, sales_request_delete: true, sales_request_print: true,
                dispatch_approval_view: false, dispatch_approval_approve: false, dispatch_approval_dispatch: false, dispatch_approval_print: false,
                customer_view: true, customer_add: true, customer_edit: true, customer_delete: false,
                reports_view: true, reports_stockopname_view: true,
                tracking_view: true,
                settings_general: false, settings_production: false, settings_system: false,
                user_management: false, user_delete: false
            }
        }
    ]
};

// Initialize localStorage databases if empty
function initMockDatabases() {
    // One-time clear of old local storage data to enforce blank slate for testing
    if (!localStorage.getItem('mock_cleared_for_testing_v2')) {
        for (const key in MOCK_DB) {
            localStorage.removeItem(`mock_${key}`);
        }
        localStorage.setItem('mock_cleared_for_testing_v2', 'true');
        console.log("Mock DB wiped clean for fresh testing.");
    }

    for (const key in MOCK_DB) {
        if (!localStorage.getItem(`mock_${key}`)) {
            localStorage.setItem(`mock_${key}`, JSON.stringify(MOCK_DB[key]));
        }
    }
    if (!localStorage.getItem('mock_company_settings')) {
        localStorage.setItem('mock_company_settings', JSON.stringify(companySettings));
    }
    if (!localStorage.getItem('mock_custom_roles')) {
        localStorage.setItem('mock_custom_roles', JSON.stringify(MOCK_DB.custom_roles));
    }
}

// Instant menu-visibility prime, same rationale as primeBrandFromCache/
// primeUserFromCache: the full sidebar menu (including sections a restricted
// role shouldn't see, e.g. Reports/Settings for a Roaster) was visible for
// one or two round-trips until loadUserProfile() resolved and called the
// real applyRoleAccess(). Placed here (not at the top of the file) because it
// needs SECTION_PERMISSIONS/hasPermission/applyMenuVisibility, which are
// declared above this point — accessing a const before its own declaration
// line executes throws, so this can't run any earlier than this.
(function primeMenuAccessFromCache() {
    try {
        const cachedUser = JSON.parse(localStorage.getItem('cached_user_identity') || 'null');
        if (!cachedUser || !cachedUser.role) return;
        currentUser = { role: cachedUser.role };
        applyMenuVisibility();
    } catch (e) { /* corrupt cache — ignore, real fetch will populate it */ }
})();

// Same reasoning as the IIFE above — this ran at top-level/parse time back
// when it lived inline in app.js's roasting section, checking the (possibly
// cache-primed) currentUser synchronously rather than waiting for
// enforceGranularPermissions(). Moved here (not roasting.js, which loads
// before app.js declares `let currentUser`) so it still runs after
// primeMenuAccessFromCache above, preserving the original timing exactly.
if (!hasPermission('roasting_plan_add')) document.getElementById('btn-add-plan').style.display = 'none';

// Same reasoning again: this "register various section's Add buttons" block
// mixes greenbean/roasting/machines concerns and two of its lines call
// hasPermission() at top level. It doesn't belong in any single UI module
// (moving it to settings.js broke on the same currentUser TDZ as above,
// since two of these buttons aren't even settings-related), so it stays
// here in app.js where currentUser is guaranteed already declared.
const btnAddGb = document.getElementById('btn-add-greenbean');
if (btnAddGb) {
    btnAddGb.addEventListener('click', () => openGreenbeanModal());
}

const btnAddLot = document.getElementById('btn-add-lot');
if (btnAddLot) {
    btnAddLot.addEventListener('click', () => openIntakeModal());
    btnAddLot.style.display = hasPermission('greenbean_arrival_add') ? '' : 'none';
}

const btnAddOutbound = document.getElementById('btn-add-outbound');
if (btnAddOutbound) {
    btnAddOutbound.addEventListener('click', () => openOutboundModal());
    btnAddOutbound.style.display = hasPermission('greenbean_outbound_add') ? '' : 'none';
}

const btnPrintCodeList = document.getElementById('btn-print-code-list');
if (btnPrintCodeList) {
    btnPrintCodeList.addEventListener('click', () => printCodeList());
}

// RBAC: hide Arrival tab if no permission
const arrivalTabBtn = document.querySelector('#sec-greenbean .tab-btn[data-tab="tab-add-gb-history"]');
if (arrivalTabBtn) arrivalTabBtn.style.display = hasPermission('greenbean_arrival_view') ? '' : 'none';

// RBAC: hide Outbound tab if no permission
const outboundTabBtn = document.querySelector('#sec-greenbean .tab-btn[data-tab="tab-gb-outbound"]');
if (outboundTabBtn) outboundTabBtn.style.display = hasPermission('greenbean_outbound_view') ? '' : 'none';

const btnAddRec = document.getElementById('btn-add-recipe');
if (btnAddRec) {
    btnAddRec.addEventListener('click', () => openRecipeModal());
}

const btnAddMach = document.getElementById('btn-add-machine');
if (btnAddMach) {
    btnAddMach.addEventListener('click', () => openMachineModal());
}

async function loadCompanySettings() {
    if (isMockMode) {
        companySettings = JSON.parse(localStorage.getItem('mock_company_settings')) || companySettings;
        applyCompanySettings();
    } else {
        try {
            const { data, error } = await window.supabaseClient.from('company_settings').select('*').eq('id', 1).single();
            if (data) {
                companySettings = data;
                applyCompanySettings();
            } else {
                onboardingOverlay.classList.remove('hidden');
            }
        } catch (e) {
            console.error("Failed to load settings:", e);
            onboardingOverlay.classList.remove('hidden');
        }
    }
}

function applyCompanySettings() {
    document.getElementById('sidebar-company-name').textContent = companySettings.company_name;
    if (companySettings.logo_base64) {
        document.getElementById('sidebar-logo-img').src = companySettings.logo_base64;
    }
    const sloganEl = document.getElementById('sidebar-slogan');
    if (sloganEl) {
        sloganEl.textContent = companySettings.slogan || '';
        sloganEl.classList.toggle('hidden', !companySettings.slogan);
    }
    // Refresh the instant-load cache (see primeBrandFromCache at the top of
    // this file) so the NEXT hard reload shows the current name/logo/slogan
    // immediately instead of the hardcoded HTML placeholder.
    try {
        localStorage.setItem('cached_company_brand', JSON.stringify({
            company_name: companySettings.company_name,
            slogan: companySettings.slogan || '',
            logo_base64: companySettings.logo_base64 || ''
        }));
    } catch (e) { /* localStorage full/unavailable — non-critical, skip caching */ }
    // Update labels and values in Forms
    document.getElementById('sett-company-name').value = companySettings.company_name;
    document.getElementById('sett-slogan').value = companySettings.slogan || '';
    document.getElementById('sett-phone').value = companySettings.phone || '';
    document.getElementById('sett-email').value = companySettings.email || '';
    document.getElementById('sett-address').value = companySettings.address || '';
    document.getElementById('sett-weight').value = companySettings.weight_unit || 'kg';
    document.getElementById('sett-currency').value = companySettings.currency || 'USD';
    
    document.getElementById('sett-print-title').value = companySettings.handover_title || 'GOODS HANDOVER SLIP';
    document.getElementById('sett-print-logo').checked = companySettings.show_logo_in_print !== false;
    document.getElementById('sett-print-footer').value = companySettings.print_footer_text || '';

    // Label layout — one checklist per sticker type (both fixed 50x25mm now,
    // see printStickerLabel/printLotBarcodeLabels). Defaults to all-true when
    // label_layout or a given key hasn't been saved yet.
    const layout = companySettings.label_layout || {};
    const roastLayout = layout.roasting || {};
    const packedLayout = layout.packed || {};
    if (document.getElementById('sett-roast-label-show-coffee-name')) {
        document.getElementById('sett-roast-label-show-coffee-name').checked = roastLayout.coffee_name !== false;
        document.getElementById('sett-roast-label-show-machine').checked = roastLayout.machine !== false;
        document.getElementById('sett-roast-label-show-coffee-code').checked = roastLayout.coffee_code !== false;
    }
    if (document.getElementById('sett-packed-label-show-code')) {
        document.getElementById('sett-packed-label-show-code').checked = packedLayout.code !== false;
        document.getElementById('sett-packed-label-show-coffee-name').checked = packedLayout.coffee_name !== false;
        document.getElementById('sett-packed-label-show-dates').checked = packedLayout.dates !== false;
        document.getElementById('sett-packed-label-show-machine').checked = packedLayout.machine !== false;
    }
    if (document.getElementById('sett-label-rotate-90')) {
        document.getElementById('sett-label-rotate-90').checked = companySettings.label_rotate_90 === true;
    }
}

async function loadMinQtySettings() {
    // 1. Populate global inputs
    document.getElementById('sett-min-greenbean').value = companySettings.min_stock_greenbean_kg || 0;
    document.getElementById('sett-min-prod-potential').value = companySettings.min_production_potential_kg || 0;
    
    // 2. Fetch and populate dynamic packing sizes
    const { data: sizes } = await fetchData('packaging_sizes');
    const container = document.getElementById('minqty-packed-sizes-container');
    container.innerHTML = '';
    
    if (!sizes || sizes.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size: 0.9rem;">No packaging sizes configured yet.</p>';
        return;
    }
    
    const activeSizes = sizes.filter(s => s.is_visible !== false).sort((a,b) => a.gram - b.gram);
    const minSizesSettings = companySettings.min_stock_packed_sizes || {};
    
    let html = `<div class="form-row" style="flex-wrap: wrap; gap: 16px;">`;
    activeSizes.forEach(s => {
        const val = minSizesSettings[s.gram] || 0;
        html += `
            <div class="form-group" style="flex: 1; min-width: 140px;">
                <label class="form-label">${s.gram} g (bags)</label>
                <input type="number" class="form-control minqty-size-input" data-size="${s.gram}" step="1" value="${val}">
            </div>
        `;
    });
    html += `</div>`;
    container.innerHTML = html;
}


// --- ROUTING & DOM NAVIGATION ---
const navItems = document.querySelectorAll('.sidebar-menu .menu-item:not(.has-dropdown)');
const pageSections = document.querySelectorAll('.page-section');
const activePageTitle = document.getElementById('active-page-title');
const activePageSubtitle = document.getElementById('active-page-subtitle');

const PAGE_METADATA = {
    'sec-dashboard': { title: 'Production Dashboard', subtitle: 'Overview of stock metrics, yield consistency trends, and daily schedules' },
    'sec-greenbean': { title: 'Greenbean Inventory', subtitle: 'Manage green coffee bean warehouse stocks and incoming arrivals' },
    'sec-bulk-roasted': { title: 'Bulk Roasted Coffee', subtitle: 'View available bulk roasted coffee ready for packaging' },
    'sec-packed-coffee': { title: 'Packed Coffee Stock', subtitle: 'View retail-packed coffee inventory grouped by coffee and size' },
    'sec-roasting': { title: 'Production', subtitle: 'Schedule roasting production runs, log batches, and manage plans' },
    'sec-packing': { title: 'Packaging & Retail Inventory', subtitle: 'Transfer bulk roasted beans to retail-size retail packaging' },
    'sec-users': { title: 'User Account Management', subtitle: 'Manage operator details, roles, and warehouse access rights' },
    'sec-settings': { title: 'System Settings', subtitle: 'Configure branding, printing layouts, and connection endpoints' },
    'sec-reports': { title: 'Reports', subtitle: '' },
    'sec-handover': { title: 'Handover', subtitle: '' },
    'sec-customers': { title: 'Customer Management', subtitle: 'Manage wholesale and retail customers' },
    'sec-tracking': { title: 'Tracking', subtitle: 'Look up a lot barcode to trace a pack back to its coffee, process, supplier and dates' }
};

// --- MOBILE NAV DRAWER (hamburger sidebar) ---
function closeMobileSidebar() {
    const sb = document.getElementById('sidebar');
    const bd = document.getElementById('sidebar-backdrop');
    if (sb) sb.classList.remove('mobile-open');
    if (bd) bd.classList.remove('visible');
}
(function initMobileNav() {
    const btn = document.getElementById('btn-mobile-menu');
    const sb = document.getElementById('sidebar');
    const bd = document.getElementById('sidebar-backdrop');
    if (btn && sb && bd) {
        btn.addEventListener('click', () => {
            sb.classList.add('mobile-open');
            bd.classList.add('visible');
        });
        bd.addEventListener('click', closeMobileSidebar);
    }
})();

const LAST_SECTION_KEY = 'last_visited_section';
const LAST_TAB_PREFIX = 'last_tab_';

function saveLastTab(sectionId, tabId) {
    try { localStorage.setItem(LAST_TAB_PREFIX + sectionId, tabId); } catch (e) {}
}

// Applies whichever tab was last open in this section (if any) BEFORE
// loadSectionData() reads `.tab-btn.active` to decide what to fetch — so a
// refresh lands back on the same tab instead of always the first one.
// Most sections use data-tab + .tab-content; Packing alone uses
// data-target + .packing-tab-content, so both are tried.
function restoreLastTab(sectionId) {
    let savedTab;
    try { savedTab = localStorage.getItem(LAST_TAB_PREFIX + sectionId); } catch (e) { return; }
    if (!savedTab) return;

    let targetBtn = document.querySelector(`#${sectionId} .tab-btn[data-tab="${savedTab}"]`);
    let contentClass = '.tab-content';
    let attr = 'data-tab';
    if (!targetBtn) {
        targetBtn = document.querySelector(`#${sectionId} .tab-btn[data-target="${savedTab}"]`);
        contentClass = '.packing-tab-content';
        attr = 'data-target';
    }
    if (!targetBtn) return; // saved tab no longer exists (e.g. renamed) — keep default

    document.querySelectorAll(`#${sectionId} .tab-btn`).forEach(b => b.classList.remove('active'));
    targetBtn.classList.add('active');
    document.querySelectorAll(`#${sectionId} ${contentClass}`).forEach(c => c.classList.toggle('hidden', c.id !== savedTab));

    // Packing's tab buttons carry their own inline active-color styling
    // (set/cleared by its click handler) instead of relying on CSS for
    // .active — restoring state here has to mirror that or the highlighted
    // tab won't visually match which panel is actually showing.
    if (attr === 'data-target') {
        document.querySelectorAll(`#${sectionId} .tab-btn`).forEach(b => {
            b.style.color = 'var(--text-secondary)';
            b.style.borderBottomColor = 'transparent';
        });
        targetBtn.style.color = 'var(--primary)';
        targetBtn.style.borderBottomColor = 'var(--primary)';
    }
}

function navigateTo(sectionId) {
    closeMobileSidebar();
    
    // Check permission for this section
    const perm = SECTION_PERMISSIONS[sectionId];
    if (perm) {
        let hasAccess = Array.isArray(perm) ? perm.some(p => hasPermission(p)) : hasPermission(perm);
        if (!hasAccess) {
            const firstAllowed = getFirstAllowedSection();
            if (firstAllowed && firstAllowed !== sectionId) {
                navigateTo(firstAllowed);
            }
            return;
        }
    }

    pageSections.forEach(sec => sec.classList.add('hidden'));
    const activeSec = document.getElementById(sectionId);
    if (activeSec) activeSec.classList.remove('hidden');

    navItems.forEach(item => {
        if (item.getAttribute('data-target') === sectionId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Handle submenu active state
    const inventorySections = ['sec-greenbean', 'sec-bulk-roasted', 'sec-packed-coffee'];
    const menuInventoryEl = document.getElementById('menu-inventory');
    if (menuInventoryEl) {
        if (inventorySections.includes(sectionId)) {
            menuInventoryEl.classList.add('active');
        } else {
            menuInventoryEl.classList.remove('active');
        }
    }
    const subMenuItemsEl = document.querySelectorAll('.menu-subitem');
    subMenuItemsEl.forEach(s => {
        s.classList.toggle('active', s.getAttribute('data-target') === sectionId);
    });

    // Use PAGE_METADATA for title/subtitle if available, otherwise fall back to i18n
    const meta = PAGE_METADATA[sectionId];
    if (meta) {
        activePageTitle.removeAttribute('data-i18n');
        activePageSubtitle.removeAttribute('data-i18n');
        activePageTitle.textContent = meta.title;
        activePageSubtitle.textContent = meta.subtitle;
        activePageSubtitle.style.display = meta.subtitle ? '' : 'none';
    } else {
        const keyPart = sectionId.replace('sec-', '');
        activePageTitle.setAttribute('data-i18n', `header_title_${keyPart}`);
        activePageSubtitle.setAttribute('data-i18n', `header_subtitle_${keyPart}`);
        activePageTitle.textContent = window.t(`header_title_${keyPart}`);
        activePageSubtitle.textContent = window.t(`header_subtitle_${keyPart}`);
        activePageSubtitle.style.display = '';
    }

    const mobileTitle = document.getElementById('mobile-topbar-title');
    if (mobileTitle) mobileTitle.textContent = activePageTitle.textContent;

    try { localStorage.setItem(LAST_SECTION_KEY, sectionId); } catch (e) {}
    restoreLastTab(sectionId);
    loadSectionData(sectionId);
}

// Event Listeners for Sidebar Links
navItems.forEach(item => {
    item.addEventListener('click', () => {
        const target = item.getAttribute('data-target');
        navigateTo(target);
    });
});

// Inventory dropdown toggle
const menuInventory = document.getElementById('menu-inventory');
const submenuInventory = document.getElementById('submenu-inventory');
if (menuInventory && submenuInventory) {
    menuInventory.addEventListener('click', () => {
        menuInventory.classList.toggle('open');
        submenuInventory.classList.toggle('open');
    });
}

// Submenu item navigation
const subMenuItems = document.querySelectorAll('.menu-subitem');
subMenuItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = item.getAttribute('data-target');
        subMenuItems.forEach(s => s.classList.remove('active'));
        item.classList.add('active');
        // Mark parent dropdown as active
        if (menuInventory) menuInventory.classList.add('active');
        navigateTo(target);
    });
});

// For quick links (e.g. from Dashboard to Roasting)
document.querySelectorAll('.link-nav').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-target');
        navigateTo(target);
    });
});

// --- SUB-TABS MANAGEMENT FOR GREENBEANS ---
const greenbeanTabBtns = document.querySelectorAll('#sec-greenbean .tab-btn');
const greenbeanTabContents = document.querySelectorAll('#sec-greenbean .tab-content');

greenbeanTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        
        greenbeanTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        greenbeanTabContents.forEach(content => {
            if (content.id === targetTab) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });
        
        saveLastTab('sec-greenbean', targetTab);
        loadTabSpecificData(targetTab);
    });
});

// --- SUB-TABS MANAGEMENT FOR ROASTING / PRODUCTION ---
const roastingTabBtns = document.querySelectorAll('#sec-roasting .tab-btn');
const roastingTabContents = document.querySelectorAll('#sec-roasting .tab-content');

roastingTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        
        roastingTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        roastingTabContents.forEach(content => {
            if (content.id === targetTab) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });
        
        saveLastTab('sec-roasting', targetTab);
        loadRoastingTabSpecificData(targetTab);
    });
});

// --- SUB-TABS MANAGEMENT FOR SETTINGS ---
const settingTabBtns = document.querySelectorAll('#sec-settings .tab-btn');
const settingTabContents = document.querySelectorAll('#sec-settings .tab-content');

settingTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        
        settingTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        settingTabContents.forEach(content => {
            if (content.id === targetTab) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });
        
        saveLastTab('sec-settings', targetTab);
        loadSettingTabSpecificData(targetTab);
    });
});



// --- SUB-TABS MANAGEMENT FOR HANDOVER (ITEM REQUESTS) ---
const handoverTabBtns = document.querySelectorAll('#sec-handover .tab-btn');
const handoverTabContents = document.querySelectorAll('#sec-handover .tab-content');

handoverTabBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const targetTab = btn.getAttribute('data-tab');
        
        handoverTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        handoverTabContents.forEach(content => {
            if (content.id === targetTab) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });
        
        saveLastTab('sec-handover', targetTab);
        await loadHandoverTabSpecificData(targetTab);
    });
});

// --- SUB-TABS MANAGEMENT FOR REPORTS ---
const reportsTabBtns = document.querySelectorAll('#sec-reports .tab-btn');
const reportsTabContents = document.querySelectorAll('#sec-reports .tab-content');

reportsTabBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const targetTab = btn.getAttribute('data-tab');
        
        reportsTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        reportsTabContents.forEach(content => {
            if (content.id === targetTab) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });
        
        saveLastTab('sec-reports', targetTab);
        await loadReportsTabSpecificData(targetTab);
    });
});

// Customers tab has 4 report views crammed into one page; a dropdown swaps
// which one is visible instead of showing all of them stacked at once.
const customerReportViewSelect = document.getElementById('customer-report-view-select');
if (customerReportViewSelect) {
    customerReportViewSelect.addEventListener('change', (e) => {
        const target = e.target.value;
        document.querySelectorAll('.cust-report-view').forEach(view => {
            view.classList.toggle('hidden', view.id !== target);
        });
        // Chart.js sizes a canvas at creation time; a chart built while its
        // container was hidden (display:none) renders at 0 size until resized.
        if (target === 'cust-view-volume' && customerReportChart) customerReportChart.resize();
        if (target === 'cust-view-type' && customerTypeChart) customerTypeChart.resize();
    });
}

// --- SECTION DATA LOADERS ---
async function loadSectionData(sectionId) {
    switch (sectionId) {
        case 'sec-dashboard':
            await initAppDashboard();
            break;
        case 'sec-reports':
            await loadReportsSection();
            break;
        case 'sec-greenbean':
            // Load active tab data (defaults to Inventory)
            const activeTabBtn = document.querySelector('#sec-greenbean .tab-btn.active');
            if (activeTabBtn) {
                loadTabSpecificData(activeTabBtn.getAttribute('data-tab'));
            }
            break;
        case 'sec-roasting':
            const activeRoastTabBtn = document.querySelector('#sec-roasting .tab-btn.active');
            if (activeRoastTabBtn) {
                await loadRoastingTabSpecificData(activeRoastTabBtn.getAttribute('data-tab'));
            } else {
                await loadRoastingSection();
            }
            break;
        case 'sec-bulk-roasted':
            await loadBulkRoastedSection();
            break;
        case 'sec-packed-coffee':
            await loadPackedCoffeeSection();
            break;
        case 'sec-packing':
            // loadPackingSection() always (re)builds the Daily Packing form
            // regardless of which tab is active — it doesn't load the other
            // 3 tabs' data itself (that's normally only triggered by their
            // click handler). If a restored tab left one of them active,
            // load its data too so it's not showing empty.
            await loadPackingSection();
            const activePackingTabBtn = document.querySelector('#sec-packing .tab-btn.active');
            const activePackingTarget = activePackingTabBtn ? activePackingTabBtn.getAttribute('data-target') : null;
            if (activePackingTarget === 'tab-order-request') {
                await loadPackingRequestsSection();
            } else if (activePackingTarget === 'tab-packing-history') {
                await loadPackingHistorySection();
            } else if (activePackingTarget === 'tab-packing-records') {
                await loadPackingRecordsTable();
            }
            break;
        case 'sec-customers':
            await loadCustomersSection();
            break;
        case 'sec-tracking':
            loadTrackingSection();
            break;
        case 'sec-handover':
            const activeHandoverTabBtn = document.querySelector('#sec-handover .tab-btn.active');
            if (activeHandoverTabBtn) {
                await loadHandoverTabSpecificData(activeHandoverTabBtn.getAttribute('data-tab'));
            } else {
                await loadHandoverSection();
            }
            break;
        case 'sec-settings':
            const activeSettTabBtn = document.querySelector('#sec-settings .tab-btn.active');
            if (activeSettTabBtn) {
                loadSettingTabSpecificData(activeSettTabBtn.getAttribute('data-tab'));
            }
            break;
    }
    // After loading any section, enforce granular button/tab permissions
    enforceGranularPermissions();
}

// ============================================================
// GRANULAR PERMISSION ENFORCEMENT
// Hides/shows action buttons, tabs, and cards based on role permissions.
// Called after every section load so dynamically rendered content is covered.
// ============================================================
function enforceGranularPermissions() {
    // --- ROASTING TABS ---
    const TAB_PERMISSIONS = {
        'tab-roast-logs': 'roasting_batch_view',
        'tab-blend-recipes': 'blend_view',
        'tab-custom-blend': 'blend_view',
        'tab-recipe-potential': 'production_potential_view',
        // Greenbean tabs
        'tab-add-gb-history': 'greenbean_arrival_view',
        'tab-gb-outbound': 'greenbean_outbound_view',
        // Packing tabs (use data-target instead of data-tab)
        'tab-order-request': 'packing_order_view',
        'tab-packing-records': 'packing_records_view',
        'tab-packing-history': 'packing_completed_view',
        // Handover tabs
        'tab-dispatch-approval': 'dispatch_approval_view',
        // Settings tabs
        'tab-sett-general': 'settings_general',
        'tab-sett-production': 'settings_production',
        'tab-sett-system': 'settings_system',
        // Reports tabs
        'tab-rep-stockopname': 'reports_stockopname_view',
    };

    // Hide tab buttons based on permissions (data-tab attribute)
    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
        const tabId = btn.getAttribute('data-tab');
        if (TAB_PERMISSIONS[tabId]) {
            btn.style.display = hasPermission(TAB_PERMISSIONS[tabId]) ? '' : 'none';
        }
    });

    // Hide tab buttons based on permissions (data-target attribute, used in packing)
    document.querySelectorAll('.tab-btn[data-target]').forEach(btn => {
        const tabId = btn.getAttribute('data-target');
        if (TAB_PERMISSIONS[tabId]) {
            btn.style.display = hasPermission(TAB_PERMISSIONS[tabId]) ? '' : 'none';
        }
    });

    // --- GREENBEAN INVENTORY BUTTONS ---
    document.querySelectorAll('.btn-edit-greenbean').forEach(btn => {
        btn.style.display = hasPermission('greenbean_edit') ? '' : 'none';
    });

    // btn-add-lot's visibility is also set once at top-level parse time (see
    // the comment near primeMenuAccessFromCache), using whatever currentUser
    // was at that instant — null on a cold cache (no cached_user_identity
    // yet), which hides it permanently since nothing re-checked it after the
    // real profile loaded. Re-asserting it here means every section load
    // reconciles it against the now-confirmed real permissions.
    const btnAddLotEl = document.getElementById('btn-add-lot');
    if (btnAddLotEl) {
        btnAddLotEl.style.display = hasPermission('greenbean_arrival_add') ? '' : 'none';
    }
    const btnAddOutboundEl = document.getElementById('btn-add-outbound');
    if (btnAddOutboundEl) {
        btnAddOutboundEl.style.display = hasPermission('greenbean_outbound_add') ? '' : 'none';
    }

    // --- BULK ROASTED COFFEE BUTTONS ---
    document.querySelectorAll('.btn-edit-bulk').forEach(btn => {
        btn.style.display = hasPermission('bulk_edit') ? '' : 'none';
    });
    document.querySelectorAll('.btn-delete-bulk').forEach(btn => {
        btn.style.display = hasPermission('bulk_delete') ? '' : 'none';
    });

    // --- PACKED COFFEE BUTTONS ---
    document.querySelectorAll('.btn-edit-packed').forEach(btn => {
        btn.style.display = hasPermission('packed_edit') ? '' : 'none';
    });
    document.querySelectorAll('.btn-delete-packed').forEach(btn => {
        btn.style.display = hasPermission('packed_delete') ? '' : 'none';
    });

    // --- BATCH LOG BUTTONS ---
    document.querySelectorAll('.btn-edit-batch').forEach(btn => {
        btn.style.display = hasPermission('roasting_batch_edit') ? '' : 'none';
    });
    document.querySelectorAll('.btn-delete-batch').forEach(btn => {
        btn.style.display = hasPermission('roasting_batch_delete') ? '' : 'none';
    });
    document.querySelectorAll('.btn-approve-test-batch').forEach(btn => {
        btn.style.display = hasPermission('roasting_batch_approve') ? '' : 'none';
    });
    const btnAddBatch = document.getElementById('btn-add-batch');
    if (btnAddBatch) btnAddBatch.style.display = hasPermission('roasting_batch_add') ? '' : 'none';

    // --- BLEND RECIPE BUTTONS ---
    document.querySelectorAll('.btn-edit-recipe').forEach(btn => {
        btn.style.display = hasPermission('blend_edit') ? '' : 'none';
    });
    document.querySelectorAll('.btn-delete-recipe').forEach(btn => {
        btn.style.display = hasPermission('blend_delete') ? '' : 'none';
    });
    const btnAddRecipe = document.getElementById('btn-add-recipe');
    if (btnAddRecipe) btnAddRecipe.style.display = hasPermission('blend_add') ? '' : 'none';

    // --- PACKING BUTTONS ---
    const btnCustomPacking = document.getElementById('btn-custom-packing');
    if (btnCustomPacking) btnCustomPacking.style.display = hasPermission('packing_manual_add') ? '' : 'none';
    // V2 Custom Blend: reuses the existing blend_add permission per roadmap
    // decision (no dedicated post-blend permission key).
    const btnAddCustomBlend = document.getElementById('btn-add-custom-blend');
    if (btnAddCustomBlend) btnAddCustomBlend.style.display = hasPermission('blend_add') ? '' : 'none';
    // Ready to Pack cards: Print Barcode / Pack buttons
    document.querySelectorAll('.btn-print-lot-barcode').forEach(btn => {
        btn.style.display = hasPermission('packing_print_barcode') ? '' : 'none';
    });
    document.querySelectorAll('.btn-pack-bulk').forEach(btn => {
        btn.style.display = hasPermission('packing_daily') ? '' : 'none';
    });
    // Unpack buttons in packed coffee rows
    document.querySelectorAll('.btn-unpack, [onclick*="unpack"]').forEach(btn => {
        btn.style.display = hasPermission('packing_unpack') ? '' : 'none';
    });

    // --- SALES / DISPATCH REQUEST BUTTONS ---
    const btnCreateRequest = document.getElementById('btn-create-request');
    if (btnCreateRequest) btnCreateRequest.style.display = hasPermission('sales_request_create') ? '' : 'none';
    document.querySelectorAll('.btn-edit-order').forEach(btn => {
        btn.style.display = hasPermission('sales_request_edit') ? '' : 'none';
    });
    document.querySelectorAll('.btn-delete-order').forEach(btn => {
        btn.style.display = hasPermission('sales_request_delete') ? '' : 'none';
    });
    document.querySelectorAll('.btn-print-order').forEach(btn => {
        btn.style.display = hasPermission('sales_request_print') ? '' : 'none';
    });

    // --- DISPATCH APPROVAL BUTTONS ---
    document.querySelectorAll('.btn-approve-order').forEach(btn => {
        btn.style.display = hasPermission('dispatch_approval_approve') ? '' : 'none';
    });
    document.querySelectorAll('.btn-dispatch-order').forEach(btn => {
        btn.style.display = hasPermission('dispatch_approval_dispatch') ? '' : 'none';
    });
    document.querySelectorAll('.btn-print-waybill').forEach(btn => {
        btn.style.display = hasPermission('dispatch_approval_print') ? '' : 'none';
    });

    // --- CUSTOMER BUTTONS ---
    // "Add Customer" button in HTML (onclick="openCustomerModal()")
    const custSection = document.getElementById('sec-customers');
    if (custSection) {
        const addCustBtn = custSection.querySelector('[onclick="openCustomerModal()"]');
        if (addCustBtn) addCustBtn.style.display = hasPermission('customer_add') ? '' : 'none';
        // Edit & Delete buttons in customer table rows (use onclick attributes)
        custSection.querySelectorAll('[onclick^="openCustomerModal("]').forEach(btn => {
            // Only hide edit buttons (those with a numeric argument), not the "Add" button
            const onclick = btn.getAttribute('onclick');
            if (onclick && onclick.match(/openCustomerModal\(\d+\)/)) {
                btn.style.display = hasPermission('customer_edit') ? '' : 'none';
            }
        });
        custSection.querySelectorAll('[onclick^="deleteCustomer("]').forEach(btn => {
            btn.style.display = hasPermission('customer_delete') ? '' : 'none';
        });
    }
}


async function loadTabSpecificData(tabId) {
    switch (tabId) {
        case 'tab-green-inventory':
            await loadGreenbeanInventory();
            break;
        case 'tab-add-gb-history':
            await loadIntakeHistory();
            break;
        case 'tab-gb-outbound':
            await loadOutboundHistory();
            break;
        case 'tab-code-list':
            await loadCodeListSection();
            break;
    }
    enforceGranularPermissions();
}



async function loadSettingTabSpecificData(tabId) {
    switch (tabId) {
        case 'tab-sett-general':
            await loadCompanySettings();
            break;
        case 'tab-sett-production':
            await loadMachinesSection();
            await loadPackagingSizesTable();
            await loadCodeDefinitionsTable();
            await loadMinQtySettings();
            await loadCompanySettings();
            break;
        case 'tab-sett-system':
            await loadUsersSection();
            loadRoleManagement();
            await loadTranslationManager();
            break;
    }
    enforceGranularPermissions();
}

// ==========================================================================
// SECTION 1: DASHBOARD
// ==========================================================================
let yieldChart = null;
let _dashboardTimer = null;

// Debounced version: if called many times rapidly, only runs once after 200ms
const scheduleDashboardRefresh = () => {
    clearTimeout(_dashboardTimer);
    _dashboardTimer = setTimeout(() => initAppDashboard(), 200);
};

async function initAppDashboard() {
    // 1. Load Metric Counts
    const [
        { data: greenbeans },
        { data: batches },
        { data: packed },
        { data: orders }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('roast_batches'),
        fetchData('packed_coffee'),
        fetchData('request_orders')
    ]);
    
    // Greenbean Total Stock
    const totalGreenbean = greenbeans.reduce((acc, item) => acc + parseFloat(item.stock_kg || 0), 0);
    document.getElementById('stat-greenbean').textContent = `${totalGreenbean.toFixed(1)} ${companySettings.weight_unit}`;
    
    // Bulk Roasted Stock waiting to be packed
    const totalBulk = batches.reduce((acc, item) => acc + parseFloat(item.remaining_bulk_kg || 0), 0);
    document.getElementById('stat-bulk').textContent = `${totalBulk.toFixed(1)} ${companySettings.weight_unit}`;
    
    // Packed stock count
    const totalPacked = packed.reduce((acc, item) => acc + parseInt(item.quantity || 0), 0);
    document.getElementById('stat-packed').textContent = `${totalPacked} bags`;

    // Pending Orders from Sales
    const totalPending = orders.filter(o => o.status === 'Pending Approval').length;
    document.getElementById('stat-pending-orders').textContent = `${totalPending} order${totalPending !== 1 ? 's' : ''}`;

    // 2. Calculate Month-to-Date (MTD) metrics starting from 1st of current month
    const now = new Date();
    const firstOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const formatDate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };
    
    const mtdStartStr = formatDate(firstOfCurrentMonth);

    // MTD Green Coffee Intake
    const { data: intakes } = await fetchData('green_coffee_intake');
    const mtdIntakes = (intakes || []).filter(i => {
        const d = i.intake_date || i.created_at?.split('T')[0];
        return d && d >= mtdStartStr;
    });
    const totalMtdIntake = mtdIntakes.reduce((acc, item) => acc + parseFloat(item.quantity || 0), 0);
    document.getElementById('mtd-green-intake-val').textContent = `${totalMtdIntake.toFixed(1)} ${companySettings.weight_unit}`;

    // MTD Roasting Output
    const mtdBatches = (batches || []).filter(b => {
        const d = b.roast_date || b.created_at?.split('T')[0];
        return d && d >= mtdStartStr;
    });
    const totalMtdRoasted = mtdBatches.reduce((acc, item) => acc + parseFloat(item.output_weight_kg || 0), 0);
    document.getElementById('mtd-total-roasted-val').textContent = `${totalMtdRoasted.toFixed(1)} ${companySettings.weight_unit}`;
    document.getElementById('mtd-batches-count-val').textContent = mtdBatches.length;

    // Group MTD Roasting by Coffee Name
    const roastingGroup = {};
    const { data: recipes } = await fetchData('blend_recipes');
    
    mtdBatches.forEach(b => {
        let name = '';
        if (b.coffee_type === 'Single') {
            const gb = greenbeans.find(g => g.id === b.single_coffee_id);
            name = gb ? gb.name : 'Single Coffee';
        } else {
            const r = recipes.find(rec => rec.id === b.blend_recipe_id);
            name = r ? r.name : 'Blend Recipe';
        }
        
        if (!roastingGroup[name]) {
            roastingGroup[name] = { count: 0, green: 0, yield: 0 };
        }
        roastingGroup[name].count++;
        roastingGroup[name].green += parseFloat(b.input_weight_kg || 0);
        roastingGroup[name].yield += parseFloat(b.output_weight_kg || 0);
    });

    const mtdRoastTbody = document.getElementById('mtd-roasting-table-body');
    if (mtdRoastTbody) {
        mtdRoastTbody.innerHTML = '';
        const sortedRoastGroups = Object.entries(roastingGroup).sort((a, b) => b[1].yield - a[1].yield);
        if (sortedRoastGroups.length === 0) {
            mtdRoastTbody.innerHTML = `<tr><td colspan="4" class="text-center-muted">${window.t ? window.t("msg_no_roast_mtd") || "No roasting output this month" : "No roasting output this month"}</td></tr>`;
        } else {
            sortedRoastGroups.forEach(([name, val]) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${name}</strong></td>
                    <td>${val.count}</td>
                    <td>${val.green.toFixed(1)} ${companySettings.weight_unit}</td>
                    <td><strong>${val.yield.toFixed(1)} ${companySettings.weight_unit}</strong></td>
                `;
                mtdRoastTbody.appendChild(tr);
            });
        }
    }

    // MTD Sales Dispatched
    const { data: orderItems } = await fetchData('request_order_items');
    const mtdCompletedOrders = (orders || []).filter(o => {
        const d = o.order_date || o.created_at?.split('T')[0];
        return d && d >= mtdStartStr && o.status === 'Completed';
    });
    const completedOrderIds = mtdCompletedOrders.map(o => o.id);
    
    const dispatchGroup = {
        '250': { bags: 0, weight: 0 },
        '500': { bags: 0, weight: 0 },
        '1000': { bags: 0, weight: 0 }
    };
    let totalMtdWeightDispatched = 0;

    (orderItems || []).forEach(item => {
        if (completedOrderIds.includes(item.request_order_id)) {
            const size = item.bag_size_g ? item.bag_size_g.toString() : '250';
            const bags = parseInt(item.quantity_requested || 0);
            const weight = (bags * parseInt(size)) / 1000;
            
            if (!dispatchGroup[size]) {
                dispatchGroup[size] = { bags: 0, weight: 0 };
            }
            dispatchGroup[size].bags += bags;
            dispatchGroup[size].weight += weight;
            totalMtdWeightDispatched += weight;
        }
    });

    document.getElementById('mtd-total-dispatched-val').textContent = `${totalMtdWeightDispatched.toFixed(1)} ${companySettings.weight_unit}`;

    const mtdDispatchTbody = document.getElementById('mtd-dispatched-table-body');
    if (mtdDispatchTbody) {
        mtdDispatchTbody.innerHTML = '';
        Object.entries(dispatchGroup).forEach(([size, val]) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${size}g</strong></td>
                <td>${val.bags} ${window.t ? window.t("lbl_bags") || "bags" : "bags"}</td>
                <td><strong>${val.weight.toFixed(1)} ${companySettings.weight_unit}</strong></td>
            `;
            mtdDispatchTbody.appendChild(tr);
        });
    }

    // 3. Render Today's Roasting Plan
    const { data: plans } = await fetchData('roasting_plans');
    const plansContainer = document.getElementById('dashboard-plans-list');
    plansContainer.innerHTML = '';

    const todayStr = new Date().toISOString().split('T')[0];
    const todayPlans = plans.filter(p => p.plan_date === todayStr || p.status === 'Pending' || p.status === 'In Progress');

    if (todayPlans.length === 0) {
        plansContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 20px;">${window.t("no_plans_today")}</p>`;
    } else {
        for (const plan of todayPlans) {
            let coffeeName = '';
            if (plan.coffee_type === 'Single') {
                const gb = greenbeans.find(g => g.id === plan.single_coffee_id);
                coffeeName = gb ? `${gb.name} (Single Origin)` : 'Single Coffee';
            } else {
                const { data: recipes } = await fetchData('blend_recipes');
                const r = recipes.find(rec => rec.id === plan.blend_recipe_id);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
            }

            const fulfilledDisplay = parseFloat(parseFloat(plan.fulfilled_roasted_kg || 0).toFixed(2));
            const targetDisplay = parseFloat(parseFloat(plan.target_roasted_kg || 0).toFixed(2));
            const pct = Math.min(100, targetDisplay > 0 ? (fulfilledDisplay / targetDisplay) * 100 : 0);

            const planEl = document.createElement('div');
            planEl.style.display = 'flex';
            planEl.style.flexDirection = 'column';
            planEl.style.gap = '6px';
            planEl.innerHTML = `
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                    <strong>${coffeeName}</strong>
                    <span>${fulfilledDisplay}/${targetDisplay} kg</span>
                </div>
                <div style="width: 100%; background: var(--border); height: 8px; border-radius: 4px; overflow: hidden;">
                    <div style="width: ${pct}%; background: var(--primary); height: 100%;"></div>
                </div>
            `;
            plansContainer.appendChild(planEl);
        }
    }

    updateNavNotificationBadges();
}

// ==========================================================================
// NAV NOTIFICATION BALLOONS — sidebar menu items + tab headers get a small
// red count badge so a user with the relevant permission notices work
// waiting on them without having to open the section first:
//   - dispatch_approval_approve → sales orders sitting at 'Pending Approval'
//     (Goods Handover sidebar item + Dispatch Approval tab)
//   - roasting_batch_add → roasting plans not yet 'Completed' (covers both
//     freshly-created plans with 0 progress and partially-fulfilled ones)
//     (Production sidebar item + Plans tab)
// Called from initAppDashboard() (itself invoked via scheduleDashboardRefresh,
// which already runs on login and after essentially every relevant mutation
// across the app — approve/reject/dispatch, batch log, plan save/delete) and
// from applyRoleAccess() (auth.js) so the count appears immediately on login
// rather than waiting for the first dashboard refresh to resolve.
// ==========================================================================
async function updateNavNotificationBadges() {
    if (!currentUser) return;

    function paint(els, count) {
        const label = count > 99 ? '99+' : String(count);
        els.forEach(el => {
            if (!el) return;
            if (count > 0) {
                el.textContent = label;
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });
    }

    const approvalBadges = [document.getElementById('badge-nav-handover'), document.getElementById('badge-tab-dispatch-approval')];
    if (hasPermission('dispatch_approval_approve')) {
        const { data: orders } = await fetchData('request_orders');
        const pendingApprovalCount = (orders || []).filter(o => o.status === 'Pending Approval').length;
        paint(approvalBadges, pendingApprovalCount);
    } else {
        paint(approvalBadges, 0);
    }

    const roastingBadges = [document.getElementById('badge-nav-roasting'), document.getElementById('badge-tab-roast-plans')];
    if (hasPermission('roasting_batch_add')) {
        const { data: plans } = await fetchData('roasting_plans');
        const pendingPlanCount = (plans || []).filter(p => p.status !== 'Completed').length;
        paint(roastingBadges, pendingPlanCount);
    } else {
        paint(roastingBadges, 0);
    }
}


// ==========================================================================
// MODAL FORMS MANAGEMENT
// ==========================================================================
const modalContainer = document.getElementById('modal-container');
const modalTitle = document.getElementById('modal-title');
const modalBodyContent = document.getElementById('modal-body-content');
const btnCloseModal = document.getElementById('btn-close-modal');

btnCloseModal.addEventListener('click', () => {
    modalContainer.classList.add('hidden');
});

// Generic modal opening helper
function openModal(title, htmlContent, customWidth = null) {
    modalTitle.textContent = title;
    modalBodyContent.innerHTML = htmlContent;
    const card = modalContainer.querySelector('.overlay-card');
    if (card) {
        card.style.maxWidth = customWidth || '450px';
    }
    modalContainer.classList.remove('hidden');
    if (typeof window.translatePage === 'function') {
        window.translatePage();
    }
}

// Custom warning/alert/confirm dialog modal
function showWarningModal(message, isConfirm = true, title = 'Warning', confirmText = null) {
    return new Promise((resolve) => {
        let resolved = false;

        let warningContainer = document.getElementById('warning-modal-container');
        if (!warningContainer) {
            warningContainer = document.createElement('div');
            warningContainer.id = 'warning-modal-container';
            warningContainer.className = 'overlay';
            warningContainer.style.zIndex = '2000';
            
            warningContainer.innerHTML = `
                <div class="overlay-card" style="max-width: 420px; text-align: center; border: 1px solid var(--border); box-shadow: var(--shadow-premium); background: var(--bg-sidebar); border-radius: var(--border-radius); padding: 24px;">
                    <div style="margin-bottom: 16px;">
                        <span id="warn-dialog-icon" style="font-size: 2.5rem; display: inline-block; color: var(--danger); margin-bottom: 8px;">⚠️</span>
                        <h3 id="warn-dialog-title" style="font-size: 1.25rem; font-weight: 700; margin: 0; color: var(--text-primary);">Warning</h3>
                    </div>
                    <p id="warn-dialog-message" style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6; white-space: pre-wrap;"></p>
                    <div id="warn-dialog-buttons" style="display: flex; justify-content: center; gap: 12px;"></div>
                </div>
            `;
            document.body.appendChild(warningContainer);
        }

        // Set title
        const titleEl = document.getElementById('warn-dialog-title');
        if (titleEl) {
            titleEl.textContent = (title === 'Warning' && window.t) ? (window.t('warn_header') || 'Warning') : title;
        }

        // Set message
        document.getElementById('warn-dialog-message').textContent = message;

        // Define cleanup and finish BEFORE creating buttons
        function handleKeyDown(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                finish(true);
            } else if (e.key === 'Escape' && isConfirm) {
                e.preventDefault();
                finish(false);
            }
        }

        function finish(result) {
            if (resolved) return;
            resolved = true;
            warningContainer.classList.add('hidden');
            warningContainer.style.display = 'none';
            document.removeEventListener('keydown', handleKeyDown);
            resolve(result);
        }

        // Build buttons fresh
        const buttonsDiv = document.getElementById('warn-dialog-buttons');
        buttonsDiv.innerHTML = '';

        if (isConfirm) {
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn btn-secondary';
            cancelBtn.style.minWidth = '100px';
            cancelBtn.textContent = window.t ? window.t('btn_cancel') : 'Cancel';
            cancelBtn.addEventListener('click', function() { finish(false); });
            buttonsDiv.appendChild(cancelBtn);
        }

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'btn btn-danger';
        okBtn.style.cssText = 'min-width: 100px; background: var(--danger); color: #fff;';
        okBtn.textContent = confirmText || (window.t ? window.t('btn_confirm_ok') || 'OK' : 'OK');
        okBtn.addEventListener('click', function() { finish(true); });
        buttonsDiv.appendChild(okBtn);

        // Show
        warningContainer.classList.remove('hidden');
        warningContainer.style.display = 'flex';

        // Keyboard
        document.addEventListener('keydown', handleKeyDown);
    });
}

// Dedicated delete confirmation modal with red styling
function showDeleteConfirmModal(itemLabel = 'this item') {
    return new Promise((resolve) => {
        let container = document.getElementById('delete-confirm-modal-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'delete-confirm-modal-container';
            container.className = 'overlay';
            container.style.zIndex = '2100';
            container.innerHTML = `
                <div class="overlay-card" style="max-width: 400px; text-align: center; border: 1px solid var(--danger); box-shadow: 0 0 0 4px rgba(239,68,68,0.08), var(--shadow-premium); background: var(--bg-sidebar); border-radius: var(--border-radius); padding: 28px;">
                    <div style="margin-bottom: 20px;">
                        <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(239,68,68,0.1); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                        </div>
                        <h3 id="del-confirm-title" style="font-size: 1.2rem; font-weight: 700; margin: 0 0 8px; color: var(--text-primary);">Delete Confirmation</h3>
                        <p id="del-confirm-message" style="font-size: 0.88rem; color: var(--text-secondary); margin: 0; line-height: 1.6;"></p>
                    </div>
                    <div style="display: flex; justify-content: center; gap: 12px;">
                        <button type="button" id="btn-del-cancel" class="btn btn-secondary" style="min-width: 110px;">Cancel</button>
                        <button type="button" id="btn-del-confirm" class="btn btn-danger" style="min-width: 110px; background: var(--danger); color: #fff; font-weight: 600;">Delete</button>
                    </div>
                </div>
            `;
            document.body.appendChild(container);
        }

        const msgEl = document.getElementById('del-confirm-message');
        const cancelBtn = document.getElementById('btn-del-cancel');
        const confirmBtn = document.getElementById('btn-del-confirm');

        msgEl.textContent = `Are you sure you want to delete ${itemLabel}? This action cannot be undone.`;
        container.classList.remove('hidden');

        const cleanup = () => {
            container.classList.add('hidden');
            document.removeEventListener('keydown', handleKey);
        };
        const handleKey = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); cleanup(); resolve(true); }
            else if (e.key === 'Escape') { e.preventDefault(); cleanup(); resolve(false); }
        };
        document.addEventListener('keydown', handleKey);

        cancelBtn.onclick = () => { cleanup(); resolve(false); };
        confirmBtn.onclick = () => { cleanup(); resolve(true); };
    });
}


function exportToExcel(data, filename) {
    if (!data || data.length === 0) {
        alert(window.t ? (window.t('alert_no_data_export') || 'No data to export.') : 'No data to export.');
        return;
    }
    const headers = Object.keys(data[0]);
    
    // Build HTML table that Excel can open with proper formatting
    let html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>Roasting Batch Logs</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
    table { border-collapse: collapse; width: 100%; }
    th { 
        background-color: #2d5a3d; 
        color: #ffffff; 
        font-weight: bold; 
        padding: 8px 12px; 
        border: 1px solid #1e3d29; 
        text-align: center;
        font-family: Calibri, Arial, sans-serif;
        font-size: 11pt;
    }
    td { 
        padding: 6px 12px; 
        border: 1px solid #d0d0d0; 
        font-family: Calibri, Arial, sans-serif;
        font-size: 11pt;
        text-align: center;
    }
    tr:nth-child(even) td { background-color: #f5f5f5; }
    tr:hover td { background-color: #e8f5e9; }
</style>
</head>
<body>
<table>
    <thead>
        <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
    </thead>
    <tbody>`;

    data.forEach(row => {
        html += '<tr>';
        headers.forEach(h => {
            let val = row[h] !== undefined && row[h] !== null ? String(row[h]) : '';
            // Numeric columns — keep as number for Excel
            if (['Batch (g)', 'Yield (g)'].includes(h)) {
                html += `<td style="mso-number-format:'\\#\\,\\#\\#0';">${val}</td>`;
            } else {
                html += `<td>${val}</td>`;
            }
        });
        html += '</tr>';
    });

    html += `
    </tbody>
</table>
</body>
</html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename + '.xls';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// === Export: Green Coffee Stock ===
document.getElementById('btn-export-greenbean').addEventListener('click', async () => {
    const { data: inventory } = await fetchData('green_coffee');
    if (!inventory || inventory.length === 0) {
        await showWarningModal('No green coffee data to export.', false);
        return;
    }
    const rows = inventory.map(g => ({
        'Code': g.code || '-',
        'Coffee Name': g.name || '-',
        'Origin': g.origin || '-',
        'Process': g.process || '-',
        'Stock Weight (kg)': parseFloat(g.stock_kg || 0).toFixed(2),
        'Supplier': g.supplier || '-'
    }));
    exportToExcel(rows, `Green_Coffee_Stock_${new Date().toISOString().split('T')[0]}`);
});





// --- GOOGLE AUTHENTICATION ---
document.getElementById('btn-google-login').addEventListener('click', async () => {
    const { error } = await window.supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin
        }
    });
    if (error) alert("OAuth error: " + error.message);
});

// --- SUPABASE EMAIL LOGIN ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const { data, error } = await window.supabaseClient.auth.signInWithPassword({
        email,
        password
    });
    if (error) {
        alert(window.t("alert_signin_failed").replace("{msg}", error.message));
    } else {
        checkAuthentication();
    }
});

// --- FORGOT PASSWORD ---
const linkForgotPassword = document.getElementById('link-forgot-password');
if (linkForgotPassword) {
    linkForgotPassword.addEventListener('click', (e) => {
        e.preventDefault();
        const html = `
            <form id="forgot-password-form">
                <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;" data-i18n="msg_forgot_password_hint">Enter your account email and we'll send you a link to reset your password.</p>
                <div class="form-group">
                    <label class="form-label" for="forgot-email" data-i18n="lbl_email">Email</label>
                    <input type="email" id="forgot-email" class="form-control" placeholder="name@roastery.com" required>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:20px;">
                    <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary" data-i18n="btn_send_reset_link">Send Reset Link</button>
                </div>
            </form>
        `;
        openModal(window.t ? (window.t('title_reset_password') || 'Reset Password') : 'Reset Password', html);
        document.getElementById('forgot-password-form').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const email = document.getElementById('forgot-email').value;
            const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin
            });
            if (error) {
                alert((window.t ? (window.t('alert_reset_failed') || 'Failed to send reset email: {msg}') : 'Failed to send reset email: {msg}').replace('{msg}', error.message));
            } else {
                document.getElementById('btn-close-modal').click();
                alert(window.t ? (window.t('alert_reset_sent') || 'If an account exists for that email, a password reset link has been sent.') : 'If an account exists for that email, a password reset link has been sent.');
            }
        });
    });
}

function showSetNewPasswordModal() {
    const html = `
        <form id="set-new-password-form">
            <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;" data-i18n="msg_set_new_password_hint">Enter a new password for your account.</p>
            <div class="form-group">
                <label class="form-label" for="new-password" data-i18n="lbl_new_password">New Password</label>
                <input type="password" id="new-password" class="form-control" placeholder="Minimum 6 characters" required minlength="6">
            </div>
            <div class="form-group" style="margin-top:12px;">
                <label class="form-label" for="new-password-confirm" data-i18n="lbl_confirm_password">Confirm Password</label>
                <input type="password" id="new-password-confirm" class="form-control" required minlength="6">
            </div>
            <div style="margin-top:20px;">
                <button type="submit" class="btn btn-primary" style="width:100%;" data-i18n="btn_set_new_password">Set New Password</button>
            </div>
        </form>
    `;
    openModal(window.t ? (window.t('title_set_new_password') || 'Set New Password') : 'Set New Password', html);
    document.getElementById('set-new-password-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pass = document.getElementById('new-password').value;
        const confirmPass = document.getElementById('new-password-confirm').value;
        if (pass !== confirmPass) {
            alert(window.t ? (window.t('alert_password_mismatch') || 'Passwords do not match.') : 'Passwords do not match.');
            return;
        }
        const { error } = await window.supabaseClient.auth.updateUser({ password: pass });
        if (error) {
            alert((window.t ? (window.t('alert_password_update_failed') || 'Failed to update password: {msg}') : 'Failed to update password: {msg}').replace('{msg}', error.message));
        } else {
            document.getElementById('btn-close-modal').click();
            alert(window.t ? (window.t('alert_password_updated') || 'Password updated successfully.') : 'Password updated successfully.');
        }
    });
}

// --- LOG OUT ---
// Self-service "change my own password". Distinct from showSetNewPasswordModal
// (which runs from the emailed reset-link recovery flow, where identity is
// already proven by the link so no current password is asked). Here the user
// is already logged in, so we verify the CURRENT password first by re-running
// signInWithPassword — the same primitive the login form uses — before calling
// updateUser({ password }). Available to every logged-in user (no permission
// gate); OAuth-only accounts have no password so the verify step will fail —
// the modal hint points them at the reset-email path instead.
function showChangePasswordModal() {
    const html = `
        <form id="change-password-form">
            <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;" data-i18n="msg_change_password_hint">Enter your current password, then choose a new one. (Google sign-in accounts don't have a password — ask an admin to reset it for you instead.)</p>
            <div class="form-group">
                <label class="form-label" for="cur-password" data-i18n="lbl_current_password">Current Password</label>
                <input type="password" id="cur-password" class="form-control" required>
            </div>
            <div class="form-group" style="margin-top:12px;">
                <label class="form-label" for="chg-new-password" data-i18n="lbl_new_password">New Password</label>
                <input type="password" id="chg-new-password" class="form-control" placeholder="Minimum 6 characters" required minlength="6">
            </div>
            <div class="form-group" style="margin-top:12px;">
                <label class="form-label" for="chg-new-password-confirm" data-i18n="lbl_confirm_password">Confirm Password</label>
                <input type="password" id="chg-new-password-confirm" class="form-control" required minlength="6">
            </div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                <button type="submit" class="btn btn-primary" data-i18n="btn_change_password">Change Password</button>
            </div>
        </form>
    `;
    openModal(window.t ? (window.t('title_change_password') || 'Change Password') : 'Change Password', html);
    document.getElementById('change-password-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const current = document.getElementById('cur-password').value;
        const pass = document.getElementById('chg-new-password').value;
        const confirmPass = document.getElementById('chg-new-password-confirm').value;

        if (pass !== confirmPass) {
            alert(window.t ? (window.t('alert_password_mismatch') || 'Passwords do not match.') : 'Passwords do not match.');
            return;
        }

        const email = currentUser && currentUser.email;
        if (!email) {
            alert(window.t ? (window.t('alert_current_password_wrong') || 'Current password is incorrect.') : 'Current password is incorrect.');
            return;
        }

        // 1. Verify the current password without disturbing the active session:
        //    a throwaway client (persistSession:false) so a wrong password can't
        //    log the user out, and a correct one doesn't swap tokens underneath us.
        const verifyClient = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        const { error: signInErr } = await verifyClient.auth.signInWithPassword({ email, password: current });
        if (signInErr) {
            alert(window.t ? (window.t('alert_current_password_wrong') || 'Current password is incorrect.') : 'Current password is incorrect.');
            return;
        }

        // 2. Update on the real (logged-in) client.
        const { error } = await window.supabaseClient.auth.updateUser({ password: pass });
        if (error) {
            alert((window.t ? (window.t('alert_password_update_failed') || 'Failed to update password: {msg}') : 'Failed to update password: {msg}').replace('{msg}', error.message));
        } else {
            document.getElementById('btn-close-modal').click();
            alert(window.t ? (window.t('alert_password_updated') || 'Password updated successfully.') : 'Password updated successfully.');
        }
    });
}

document.getElementById('btn-change-password').addEventListener('click', showChangePasswordModal);

document.getElementById('btn-logout').addEventListener('click', async () => {
    // Clear the cached identity so a different account logging in on this
    // same browser doesn't briefly flash the previous user's name/role.
    localStorage.removeItem('cached_user_identity');
    if (isMockMode) {
        localStorage.removeItem('is_mock_mode');
        isMockMode = true; // resets state
        currentUser = null;
        authOverlay.classList.remove('hidden');
        document.getElementById('app-container').style.display = 'none';
    } else {
        const { error } = await window.supabaseClient.auth.signOut();
        if (error) alert(error.message);
        checkAuthentication();
    }
});

// --- DRAG & DROP FOR TAB REORDERING ---
function makeTabsDraggable() {
    const tabHeadersContainers = document.querySelectorAll('.tab-headers');
    
    tabHeadersContainers.forEach(container => {
        const btns = container.querySelectorAll('.tab-btn');
        btns.forEach(btn => {
            btn.setAttribute('draggable', 'true');
            
            btn.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', btn.getAttribute('data-tab'));
                btn.classList.add('dragging');
            });

            btn.addEventListener('dragend', () => {
                btn.classList.remove('dragging');
            });
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingBtn = container.querySelector('.dragging');
            if (!draggingBtn) return;

            // Only consider DIRECT children as reorder targets. Using a plain
            // '.tab-btn' descendant selector can match buttons nested inside a
            // wrapper (some tab headers aren't a flat row), and insertBefore()
            // then throws NotFoundError because the reference node isn't a child
            // of `container`. ':scope >' restricts to direct children.
            const siblings = [...container.querySelectorAll(':scope > .tab-btn:not(.dragging)')];
            const nextSibling = siblings.find(sibling => {
                const box = sibling.getBoundingClientRect();
                // Determine horizontal midpoint comparison for sorting order
                const offset = e.clientX - box.left - box.width / 2;
                return offset < 0;
            });

            // Guard: draggingBtn and nextSibling must both be direct children of
            // container for insertBefore to be valid (belt-and-suspenders on top
            // of the ':scope >' selector above).
            if (draggingBtn.parentNode !== container) return;
            if (nextSibling && nextSibling.parentNode === container) {
                container.insertBefore(draggingBtn, nextSibling);
            } else {
                container.appendChild(draggingBtn);
            }
        });
    });
}

// Global active filters state: key: `${tableId}_${colIndex}`, value: Set of checked values
const ACTIVE_FILTERS = {};
const filterDropdown = document.getElementById('table-filter-dropdown');
const filterOptionsContainer = document.getElementById('filter-options-container');
let currentFilterContext = null; // Stores { table, colIndex, filterKey }

// --- COLUMN-SPECIFIC MULTI-SELECT CHECKBOX FILTERS ---
function applyFiltersForTable(table) {
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    
    const ths = table.querySelectorAll('.filterable-th');
    const tabContent = table.closest('.tab-content') || table.closest('.packing-tab-content');
    if (!tabContent) return;
    const tableId = tabContent.id;
    
    rows.forEach(row => {
        // Skip warning or "no items" rows
        if (row.cells.length <= 1 && row.querySelector('td[colspan]')) return;

        let matches = true;
        ths.forEach(th => {
            const colIndex = parseInt(th.getAttribute('data-col'));
            const filterKey = `${tableId}_${colIndex}`;
            const activeSet = ACTIVE_FILTERS[filterKey];
            
            // If we have active checked values, the cell value must be inside that set!
            if (activeSet && activeSet.size > 0) {
                const cell = row.cells[colIndex];
                if (cell) {
                    const val = cell.textContent.trim();
                    if (!activeSet.has(val)) {
                        matches = false;
                    }
                }
            }
        });

        row.style.display = matches ? '' : 'none';
    });
    
    // Highlight trigger buttons if they have active filters
    ths.forEach(th => {
        const colIndex = parseInt(th.getAttribute('data-col'));
        const filterKey = `${tableId}_${colIndex}`;
        const activeSet = ACTIVE_FILTERS[filterKey];
        const btn = th.querySelector('.filter-trigger-btn');
        if (btn) {
            if (activeSet && activeSet.size > 0) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
}

function initTableFilters() {
    // 1. Listen to filter trigger buttons clicks
    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.filter-trigger-btn');
        if (trigger) {
            e.stopPropagation();
            const th = trigger.closest('.filterable-th');
            const table = th.closest('table');
            const colIndex = parseInt(th.getAttribute('data-col'));
            const tabContent = th.closest('.tab-content') || th.closest('.packing-tab-content');
            if (!tabContent) return;
            const tableId = tabContent.id;
            const filterKey = `${tableId}_${colIndex}`;
            
            openFilterDropdown(trigger, table, colIndex, filterKey);
            return;
        }

        // Close dropdown if clicked outside
        if (filterDropdown && !filterDropdown.classList.contains('hidden') && !e.target.closest('#table-filter-dropdown')) {
            filterDropdown.classList.add('hidden');
        }
    });

    // 2. Bind action buttons in filter menu dropdown
    const btnClear = document.getElementById('btn-filter-clear');
    if (btnClear) {
        btnClear.addEventListener('click', () => {
            filterOptionsContainer.querySelectorAll('.filter-checkbox').forEach(cb => cb.checked = false);
        });
    }

    const btnSelectAll = document.getElementById('btn-filter-select-all');
    if (btnSelectAll) {
        btnSelectAll.addEventListener('click', () => {
            filterOptionsContainer.querySelectorAll('.filter-checkbox').forEach(cb => cb.checked = true);
        });
    }

    const btnApply = document.getElementById('btn-filter-apply');
    if (btnApply) {
        btnApply.addEventListener('click', () => {
            if (!currentFilterContext) return;
            const { table, filterKey } = currentFilterContext;

            const checkedBoxes = filterOptionsContainer.querySelectorAll('.filter-checkbox:checked');
            const totalBoxes = filterOptionsContainer.querySelectorAll('.filter-checkbox');

            if (checkedBoxes.length === 0 || checkedBoxes.length === totalBoxes.length) {
                // No active filter (show all)
                ACTIVE_FILTERS[filterKey] = null;
            } else {
                const checkedValues = Array.from(checkedBoxes).map(cb => cb.value);
                ACTIVE_FILTERS[filterKey] = new Set(checkedValues);
            }

            applyFiltersForTable(table);
            filterDropdown.classList.add('hidden');
        });
    }
}

function openFilterDropdown(triggerBtn, table, colIndex, filterKey) {
    currentFilterContext = { table, colIndex, filterKey };

    // Get all unique values in this column currently in the DOM
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    const values = [];
    rows.forEach(row => {
        if (row.cells.length <= 1 && row.querySelector('td[colspan]')) return;
        const cell = row.cells[colIndex];
        if (cell) {
            const val = cell.textContent.trim();
            if (val) values.push(val);
        }
    });
    const uniqueValues = [...new Set(values)].sort();

    // Generate checkboxes
    const activeSet = ACTIVE_FILTERS[filterKey] || new Set();
    
    filterOptionsContainer.innerHTML = uniqueValues.map(val => {
        const isChecked = activeSet.size === 0 || activeSet.has(val);
        return `
            <label class="filter-option-item">
                <input type="checkbox" class="filter-checkbox" value="${val}" ${isChecked ? 'checked' : ''}>
                <span>${val}</span>
            </label>
        `;
    }).join('');

    if (uniqueValues.length === 0) {
        filterOptionsContainer.innerHTML = `<span style="font-size:0.8rem; color:var(--text-muted); padding:10px; display:block;">No data available</span>`;
    }

    // Position the dropdown menu underneath the clicked button
    filterDropdown.classList.remove('hidden');
    const rect = triggerBtn.getBoundingClientRect();
    
    const top = rect.bottom + window.scrollY;
    let left = rect.left + window.scrollX;
    if (left + 220 > window.innerWidth) {
        left = window.innerWidth - 230;
    }
    
    filterDropdown.style.top = `${top + 4}px`;
    filterDropdown.style.left = `${left}px`;
}



let gbReportChart = null;
let roastReportChart = null;
let packReportChart = null;
let salesReportChart = null;
let customerReportChart = null;
let customerTypeChart = null;
let fullscreenChart = null;

// ============================================================
// FULLSCREEN CHART MODAL
// ============================================================
function getChartInstanceById(canvasId) {
    const map = {
        'rep-gb-chart': gbReportChart,
        'rep-roast-chart': roastReportChart,
        'rep-pack-chart': packReportChart,
        'rep-sales-chart': salesReportChart,
        'rep-customer-chart': customerReportChart,
        'rep-customer-type-chart': customerTypeChart
    };
    return map[canvasId] || null;
}

function openFullscreenChart(chartCanvasId, title) {
    const sourceChart = getChartInstanceById(chartCanvasId);
    if (!sourceChart) return;
    
    const modal = document.getElementById('modal-fullscreen-chart');
    const titleEl = document.getElementById('fullscreen-chart-title');
    const canvas = document.getElementById('fullscreen-chart-canvas');
    
    titleEl.textContent = title || '';
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    // Extract data manually from the source chart
    const srcData = sourceChart.data;
    const labels = [...(srcData.labels || [])];
    const datasets = (srcData.datasets || []).map(ds => ({
        label: ds.label,
        data: [...(ds.data || [])],
        backgroundColor: ds.backgroundColor,
        borderColor: ds.borderColor,
        borderWidth: ds.borderWidth || 1
    }));
    
    const chartType = sourceChart.config.type || 'bar';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#333';
    
    const config = {
        type: chartType,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            layout: {
                padding: { left: 10, right: 30 }
            },
            plugins: {
                legend: {
                    position: 'left',
                    align: 'start',
                    labels: {
                        font: { size: 13 },
                        color: textColor,
                        padding: 12,
                        boxWidth: 14,
                        boxHeight: 14,
                        usePointStyle: false
                    }
                }
            },
            scales: chartType === 'pie' || chartType === 'doughnut' ? {} : {
                x: { ticks: { font: { size: 13 }, color: textColor } },
                y: { ticks: { font: { size: 13 }, color: textColor } }
            }
        }
    };
    
    setTimeout(() => {
        if (fullscreenChart) { fullscreenChart.destroy(); fullscreenChart = null; }
        fullscreenChart = new Chart(canvas, config);
    }, 50);
}

// Chart.js renders to <canvas> and does NOT understand CSS var() strings —
// passing 'var(--text-primary)' as a color silently falls back to Chart.js's
// default grey, unreadable on the dark card. Resolve the theme tokens to real
// color values at chart-build time so labels/ticks/gridlines follow the theme
// (re-resolved correctly whenever a dark/light toggle rebuilds the charts).
function chartThemeColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
        text: cs.getPropertyValue('--text-primary').trim() || '#faf9f5',
        tick: cs.getPropertyValue('--text-secondary').trim() || '#c9c6bd',
        grid: cs.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.1)'
    };
}

function closeFullscreenChart() {
    const modal = document.getElementById('modal-fullscreen-chart');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    if (fullscreenChart) { fullscreenChart.destroy(); fullscreenChart = null; }
}

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('modal-fullscreen-chart');
        if (modal && modal.style.display === 'block') {
            closeFullscreenChart();
        }
    }
});

async function loadReportsSection() {
    // Set default dates if empty (last 30 days)
    const startInput = document.getElementById('rep-filter-start');
    const endInput = document.getElementById('rep-filter-end');
    if (startInput && !startInput.value) {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        startInput.value = start.toISOString().split('T')[0];
        endInput.value = today.toISOString().split('T')[0];
    }
    
    // Register Apply Filter click listener once
    const applyBtn = document.getElementById('btn-rep-filter-apply');
    if (applyBtn && !applyBtn.dataset.listenerBound) {
        applyBtn.addEventListener('click', async () => {
            const activeTabBtn = document.querySelector('#sec-reports .tab-btn.active');
            if (activeTabBtn) {
                await loadReportsTabSpecificData(activeTabBtn.getAttribute('data-tab'));
            }
        });
        applyBtn.dataset.listenerBound = 'true';
    }

    const activeTabBtn = document.querySelector('#sec-reports .tab-btn.active');
    if (activeTabBtn) {
        await loadReportsTabSpecificData(activeTabBtn.getAttribute('data-tab'));
    }
}

async function loadReportsTabSpecificData(tabId) {
    const startInput = document.getElementById('rep-filter-start');
    const endInput = document.getElementById('rep-filter-end');
    const startVal = startInput ? startInput.value : '';
    const endVal = endInput ? endInput.value : '';

    switch (tabId) {
        case 'tab-rep-greenbean':
            await loadGreenbeanReport(startVal, endVal);
            break;
        case 'tab-rep-roasting':
            await loadRoastingReport(startVal, endVal);
            break;
        case 'tab-rep-packing':
            await loadPackingReport(startVal, endVal);
            break;
        case 'tab-rep-sales':
            await loadSalesReport(startVal, endVal);
            break;
        case 'tab-rep-customers':
            await loadCustomerReport(startVal, endVal);
            break;
        case 'tab-rep-stockopname':
            await loadStockOpnameReport(startVal, endVal);
            break;
    }
}

async function loadGreenbeanReport(startDate, endDate) {
    const [
        { data: greenbeans },
        { data: intakes },
        { data: batches },
        { data: ingredients },
        { data: recipes }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('green_coffee_intake'),
        fetchData('roast_batches'),
        fetchData('blend_ingredients'),
        fetchData('blend_recipes')
    ]);

    // Helper: build a map from green_coffee name (lowercase) -> id
    const nameToIdMap = {};
    (greenbeans || []).forEach(gb => {
        nameToIdMap[gb.name.toLowerCase()] = parseInt(gb.id);
    });
    const idToNameMap = {};
    (greenbeans || []).forEach(gb => {
        idToNameMap[parseInt(gb.id)] = gb.name;
    });

    // --- ALL-TIME arrivals from green_coffee_intake (lot history) ---
    // Intake records have 'name' field matching green_coffee.name
    const allArrivalsMap = {}; // keyed by green_coffee name (lowercase)
    (intakes || []).forEach(i => {
        const coffeeName = (i.name || '').toLowerCase();
        if (coffeeName) {
            allArrivalsMap[coffeeName] = (allArrivalsMap[coffeeName] || 0) + (parseFloat(i.quantity) || 0);
        }
    });

    // --- ALL-TIME roasted greenbean from roast_batches ---
    // Single: input_weight_kg charged to single_coffee_id
    // Blend: input_weight_kg split by blend ingredients percentage to each green_coffee_id
    const allRoastedMap = {}; // keyed by green_coffee id
    (batches || []).forEach(b => {
        const greenUsed = parseFloat(b.input_weight_kg) || 0;
        if (greenUsed <= 0) return;
        if (b.coffee_type === 'Single') {
            const gId = parseInt(b.single_coffee_id);
            if (gId) allRoastedMap[gId] = (allRoastedMap[gId] || 0) + greenUsed;
        } else {
            const rId = parseInt(b.blend_recipe_id);
            const recipeIngs = (ingredients || []).filter(ing => parseInt(ing.blend_recipe_id) === rId);
            if (recipeIngs.length > 0) {
                recipeIngs.forEach(ing => {
                    const gId = parseInt(ing.green_coffee_id);
                    const percentage = parseFloat(ing.percentage) || 0;
                    if (gId) allRoastedMap[gId] = (allRoastedMap[gId] || 0) + (greenUsed * (percentage / 100));
                });
            }
        }
    });

    // --- FILTERED arrivals/roasted for stats cards ---
    const filteredIntakes = (intakes || []).filter(i => {
        const d = i.date || i.intake_date || i.created_at?.split('T')[0];
        if (!d) return true;
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        return true;
    });
    const filteredBatches = (batches || []).filter(b => {
        const d = b.roast_date || b.created_at?.split('T')[0];
        if (!d) return true;
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        return true;
    });

    let totalArrivalsFiltered = 0;
    filteredIntakes.forEach(i => {
        totalArrivalsFiltered += (parseFloat(i.quantity) || 0);
    });

    let totalRoastedFiltered = 0;
    filteredBatches.forEach(b => {
        totalRoastedFiltered += (parseFloat(b.input_weight_kg) || 0);
    });

    // --- Build table ---
    const tbody = document.getElementById('rep-gb-table-body');
    if (tbody) tbody.innerHTML = '';

    let totalStockAll = 0;
    let totalArrivalsAll = 0;
    let totalRoastedAll = 0;
    const labels = [];
    const arrivalDataset = [];
    const stockDataset = [];
    const tableData = []; // for export

    (greenbeans || []).forEach(gb => {
        const gId = parseInt(gb.id);
        const nameLower = gb.name.toLowerCase();
        const arrivals = allArrivalsMap[nameLower] || 0;
        const roasted = allRoastedMap[gId] || 0;
        const currentStock = parseFloat(gb.stock_kg) || 0;

        totalArrivalsAll += arrivals;
        totalRoastedAll += roasted;
        totalStockAll += currentStock;

        labels.push(gb.name);
        arrivalDataset.push(arrivals);
        stockDataset.push(currentStock);

        tableData.push({ name: gb.name, arrivals, roasted, stock: currentStock });

        if (tbody) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${gb.name}</strong></td>
                <td>${arrivals.toFixed(1)} kg</td>
                <td>${roasted.toFixed(1)} kg</td>
                <td><strong>${currentStock.toFixed(1)} kg</strong></td>
            `;
            tbody.appendChild(tr);
        }
    });

    // Stats cards
    const arrivalsEl = document.getElementById('rep-gb-total-arrivals');
    const roastedEl = document.getElementById('rep-gb-total-roasted');
    const countEl = document.getElementById('rep-gb-active-count');
    const stockEl = document.getElementById('rep-gb-remain-stock');

    if (arrivalsEl) arrivalsEl.textContent = `${totalArrivalsFiltered.toFixed(1)} kg`;
    if (roastedEl) roastedEl.textContent = `${totalRoastedFiltered.toFixed(1)} kg`;
    if (countEl) countEl.textContent = (greenbeans || []).length;
    if (stockEl) stockEl.textContent = `${totalStockAll.toFixed(1)} kg`;

    // Export Excel button
    const exportBtn = document.getElementById('btn-export-gb-report');
    if (exportBtn) {
        exportBtn.addEventListener('click', (e) => { e.stopPropagation();
            const exportData = tableData.map(d => ({
                'Coffee Name': d.name,
                'Total Arrivals (kg)': d.arrivals.toFixed(1),
                'Green Beans Roasted (kg)': d.roasted.toFixed(1),
                'Remaining Stock (kg)': d.stock.toFixed(1)
            }));
            exportData.push({
                'Coffee Name': 'TOTAL',
                'Total Arrivals (kg)': totalArrivalsAll.toFixed(1),
                'Green Beans Roasted (kg)': totalRoastedAll.toFixed(1),
                'Remaining Stock (kg)': totalStockAll.toFixed(1)
            });
            exportToExcel(exportData, 'Green_Coffee_Stock');
        });
    }

    // Chart
    const ctx = document.getElementById('rep-gb-chart');
    if (ctx) {
        if (gbReportChart) gbReportChart.destroy();
        gbReportChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Total Arrivals (kg)',
                        data: arrivalDataset,
                        backgroundColor: 'rgba(59, 130, 246, 0.65)',
                        borderColor: 'rgb(59, 130, 246)',
                        borderWidth: 1
                    },
                    {
                        label: 'Current Stock (kg)',
                        data: stockDataset,
                        backgroundColor: 'rgba(16, 185, 129, 0.65)',
                        borderColor: 'rgb(16, 185, 129)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: chartThemeColors().text } }
                },
                scales: {
                    x: { ticks: { color: chartThemeColors().tick } },
                    y: { ticks: { color: chartThemeColors().tick } }
                }
            }
        });
    }
}

async function loadRoastingReport(startDate, endDate) {
    const [
        { data: batches },
        { data: greenbeans },
        { data: recipes }
    ] = await Promise.all([
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes')
    ]);

    const filtered = (batches || []).filter(b => {
        const d = b.roast_date || b.created_at?.split('T')[0];
        if (!d) return true;
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        return true;
    });

    let totalBatches = filtered.length;
    let totalGreenUsed = 0;
    let totalYieldObtained = 0;

    const prodMap = {};

    filtered.forEach(b => {
        const green = parseFloat(b.input_weight_kg) || 0;
        const yieldKg = parseFloat(b.output_weight_kg) || 0;
        totalGreenUsed += green;
        totalYieldObtained += yieldKg;

        let name = '';
        if (b.coffee_type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === b.single_coffee_id);
            name = gb ? gb.name : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === b.blend_recipe_id);
            name = r ? r.name : 'Blend';
        }

        if (!prodMap[name]) {
            prodMap[name] = { count: 0, green: 0, yieldKg: 0 };
        }
        prodMap[name].count++;
        prodMap[name].green += green;
        prodMap[name].yieldKg += yieldKg;
    });

    const tbody = document.getElementById('rep-roast-table-body');
    if (tbody) tbody.innerHTML = '';

    const labels = [];
    const greenData = [];
    const yieldData = [];

    Object.entries(prodMap).forEach(([name, val]) => {
        labels.push(name);
        greenData.push(val.green);
        yieldData.push(val.yieldKg);

        if (tbody) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${name}</strong></td>
                <td>${val.count}</td>
                <td>${val.green.toFixed(1)} kg</td>
                <td><strong>${val.yieldKg.toFixed(1)} kg</strong></td>
            `;
            tbody.appendChild(tr);
        }
    });

    // Export Excel
    const roastExportBtn = document.getElementById('btn-export-roast-report');
    if (roastExportBtn) {
        roastExportBtn.addEventListener('click', (e) => { e.stopPropagation();
            const exportData = Object.entries(prodMap).map(([name, val]) => ({
                'Coffee Name': name,
                'Total Batches': val.count,
                'Green Beans Roasted (kg)': val.green.toFixed(1),
                'Total Yield (kg)': val.yieldKg.toFixed(1)
            }));
            exportData.push({
                'Coffee Name': 'TOTAL',
                'Total Batches': totalBatches,
                'Green Beans Roasted (kg)': totalGreenUsed.toFixed(1),
                'Total Yield (kg)': totalYieldObtained.toFixed(1)
            });
            exportToExcel(exportData, 'Roasting_Production_Report');
        });
    }

    const batchesEl = document.getElementById('rep-roast-total-batches');
    const greenEl = document.getElementById('rep-roast-total-green');
    const yieldEl = document.getElementById('rep-roast-total-yield');

    if (batchesEl) batchesEl.textContent = totalBatches;
    if (greenEl) greenEl.textContent = `${totalGreenUsed.toFixed(1)} kg`;
    if (yieldEl) yieldEl.textContent = `${totalYieldObtained.toFixed(1)} kg`;

    const ctx = document.getElementById('rep-roast-chart');
    if (ctx) {
        if (roastReportChart) roastReportChart.destroy();
        roastReportChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: window.t ? window.t('card_green_roasted') : 'Green Used (kg)',
                        data: greenData,
                        backgroundColor: 'rgba(245, 158, 11, 0.65)',
                        borderColor: 'rgb(245, 158, 11)',
                        borderWidth: 1
                    },
                    {
                        label: window.t ? window.t('card_total_yield') : 'Yield Obtained (kg)',
                        data: yieldData,
                        backgroundColor: 'rgba(16, 185, 129, 0.65)',
                        borderColor: 'rgb(16, 185, 129)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: chartThemeColors().text } }
                },
                scales: {
                    x: { ticks: { color: chartThemeColors().tick } },
                    y: { ticks: { color: chartThemeColors().tick } }
                }
            }
        });
    }
}

async function loadPackingReport(startDate, endDate) {
    const [
        { data: packed },
        { data: batches },
        { data: greenbeans },
        { data: recipes },
        { data: machines }
    ] = await Promise.all([
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines')
    ]);

    const resolved = (packed || []).map(item => {
        let coffeeName = item.custom_coffee_name || 'Roasted Coffee';
        let date = null;
        if (item.roast_batch_id) {
            const b = (batches || []).find(x => x.id === item.roast_batch_id);
            if (b) {
                date = b.roast_date || b.created_at?.split('T')[0];
                if (b.coffee_type === 'Single') {
                    const gb = (greenbeans || []).find(g => g.id === b.single_coffee_id);
                    if (gb) coffeeName = gb.name;
                } else {
                    const r = (recipes || []).find(rec => rec.id === b.blend_recipe_id);
                    if (r) coffeeName = r.name;
                }
            }
        }
        return { ...item, coffeeName, date };
    });

    const filtered = resolved.filter(item => {
        if (!item.date) return true;
        if (startDate && item.date < startDate) return false;
        if (endDate && item.date > endDate) return false;
        return true;
    });

    const sizeSet = new Set();
    const machineSet = new Set();
    // grouped[coffeeName][machineName][sizeG] = { bags, weight }
    const grouped = {};
    let totalBags = 0;
    let totalWeightKg = 0;

    filtered.forEach(item => {
        const bags = parseInt(item.quantity) || 0;
        const sizeG = parseInt(item.bag_size_g) || 250;
        const kg = (bags * sizeG) / 1000;
        const mach = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
        const machName = mach ? mach.name : 'Unassigned';

        totalBags += bags;
        totalWeightKg += kg;
        sizeSet.add(sizeG);
        machineSet.add(machName);

        if (!grouped[item.coffeeName]) grouped[item.coffeeName] = {};
        if (!grouped[item.coffeeName][machName]) grouped[item.coffeeName][machName] = {};
        if (!grouped[item.coffeeName][machName][sizeG]) grouped[item.coffeeName][machName][sizeG] = { bags: 0, weight: 0 };
        grouped[item.coffeeName][machName][sizeG].bags += bags;
        grouped[item.coffeeName][machName][sizeG].weight += kg;
    });

    const activeSizes = [...sizeSet].sort((a, b) => a - b);
    const activeMachines = [...machineSet].sort();

    // Update dynamic thead
    const theadRow = document.getElementById('rep-pack-thead');
    if (theadRow) {
        let thHtml = '<th style="min-width:140px;">Coffee Name</th>';
        activeMachines.forEach(m => {
            thHtml += `<th class="text-center">${m}</th>`;
        });
        thHtml += '<th style="text-align: center; font-weight:800;">Total</th>';
        theadRow.innerHTML = thHtml;
    }

    // Build table body
    const tbody = document.getElementById('rep-pack-table-body');
    if (tbody) tbody.innerHTML = '';

    const coffeeNames = Object.keys(grouped).sort();

    if (coffeeNames.length === 0 && tbody) {
        tbody.innerHTML = `<tr><td colspan="${activeMachines.length + 2}" class="table-empty-state">No packed data in selected period</td></tr>`;
    }

    const labels = [];
    const bagData = [];

    coffeeNames.forEach(coffeeName => {
        let totalBagsForCoffee = 0;

        if (tbody) {
            const tr = document.createElement('tr');
            let html = `<td style="vertical-align: middle; padding: 12px 20px;"><strong>${coffeeName}</strong></td>`;

            activeMachines.forEach(machName => {
                const machData = grouped[coffeeName][machName] || {};

                const sizesHtml = activeSizes.map((sz, idx) => {
                    const data = machData[sz] || { bags: 0 };
                    totalBagsForCoffee += data.bags;
                    const sizeLabel = sz >= 1000 ? `${sz/1000}kg` : `${sz}g`;
                    return `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: ${idx < activeSizes.length - 1 ? '1px dashed var(--border)' : 'none'};">
                            <span style="background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:6px; padding:2px 6px; font-size:0.73rem; font-weight:700;">${sizeLabel}</span>
                            <span style="font-size:0.8rem; font-weight:600; color:${data.bags > 0 ? 'var(--text-secondary)' : 'var(--text-muted)'};">${data.bags > 0 ? data.bags + ' bags' : '-'}</span>
                        </div>
                    `;
                }).join('');

                html += `<td style="vertical-align: top; padding: 8px 12px; min-width: 130px;">${sizesHtml}</td>`;
            });

            // Total column
            const totalSizesHtml = activeSizes.map((sz, idx) => {
                let sizeTotal = 0;
                activeMachines.forEach(mn => { sizeTotal += (grouped[coffeeName][mn] || {})[sz]?.bags || 0; });
                const sizeLabel = sz >= 1000 ? `${sz/1000}kg` : `${sz}g`;
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: ${idx < activeSizes.length - 1 ? '1px dashed var(--border)' : 'none'};">
                        <span style="background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:6px; padding:2px 6px; font-size:0.73rem; font-weight:700;">${sizeLabel}</span>
                        <span style="font-size:0.8rem; font-weight:800; color:var(--text-primary);">${sizeTotal > 0 ? sizeTotal + ' bags' : '-'}</span>
                    </div>
                `;
            }).join('');
            html += `<td style="vertical-align: top; padding: 8px 12px; min-width: 130px; background:rgba(45,90,61,0.04);">${totalSizesHtml}</td>`;

            tr.innerHTML = html;
            tbody.appendChild(tr);
        }

        labels.push(coffeeName);
        bagData.push(totalBagsForCoffee);
    });

    // Export Excel
    const packExportBtn = document.getElementById('btn-export-pack-report');
    if (packExportBtn) {
        packExportBtn.addEventListener('click', (e) => { e.stopPropagation();
            const exportData = [];
            coffeeNames.forEach(coffeeName => {
                activeSizes.forEach(sz => {
                    const sizeLabel = sz >= 1000 ? `${sz/1000}kg` : `${sz}g`;
                    const row = { 'Coffee Name': coffeeName, 'Size': sizeLabel };
                    let rowTotal = 0;
                    activeMachines.forEach(machName => {
                        const qty = (grouped[coffeeName][machName] || {})[sz]?.bags || 0;
                        row[machName] = qty;
                        rowTotal += qty;
                    });
                    row['Total'] = rowTotal;
                    if (rowTotal > 0) exportData.push(row);
                });
            });
            exportToExcel(exportData, 'Packing_Report');
        });
    }

    const bagsEl = document.getElementById('rep-pack-total-bags');
    const weightEl = document.getElementById('rep-pack-total-weight');
    const varietiesEl = document.getElementById('rep-pack-varieties-count');

    if (bagsEl) bagsEl.textContent = `${totalBags} bags`;
    if (weightEl) weightEl.textContent = `${totalWeightKg.toFixed(1)} kg`;
    if (varietiesEl) varietiesEl.textContent = varieties.size;

    const ctx = document.getElementById('rep-pack-chart');
    if (ctx) {
        if (packReportChart) packReportChart.destroy();
        packReportChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [
                    {
                        data: bagData,
                        backgroundColor: [
                            'rgba(59, 130, 246, 0.7)',
                            'rgba(16, 185, 129, 0.7)',
                            'rgba(245, 158, 11, 0.7)',
                            'rgba(139, 92, 246, 0.7)',
                            'rgba(239, 68, 68, 0.7)',
                            'rgba(6, 182, 212, 0.7)'
                        ]
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: chartThemeColors().text } }
                }
            }
        });
    }
}

async function loadSalesReport(startDate, endDate) {
    const [
        { data: orders },
        { data: orderItems },
        { data: greenbeans },
        { data: recipes },
        { data: machines }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines')
    ]);

    // V2 1J: row-level filter — a sales_request_view_own-only role sees just
    // its own orders in this report (see filterOwnOrders in js/auth.js).
    const ownVisibleOrders = filterOwnOrders(orders);

    // Filter orders that are dispatched within date range
    const filteredOrders = ownVisibleOrders.filter(o => {
        if (o.status !== 'Dispatched' && o.status !== 'Completed') return false;
        const d = o.order_date || o.created_at?.split('T')[0];
        if (!d) return true;
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        return true;
    });

    const activeOrderIds = filteredOrders.map(o => o.id);

    // Collect active sizes and machines from dispatched items
    const sizeSet = new Set();
    const machineSet = new Set();
    const machineNames = {};

    // grouped[coffeeName][machineName][sizeG] = qty
    const grouped = {};

    (orderItems || []).forEach(item => {
        if (!activeOrderIds.includes(item.request_order_id)) return;

        let coffeeName = '';
        if (item.coffee_type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === item.single_coffee_id);
            coffeeName = gb ? gb.name : 'Single';
        } else {
            const r = (recipes || []).find(rec => rec.id === item.blend_recipe_id);
            coffeeName = r ? r.name : 'Blend';
        }

        const sizeG = parseInt(item.bag_size_g) || 250;
        const qty = parseInt(item.quantity_requested) || 0;
        const mach = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
        const machName = mach ? mach.name : 'Unassigned';

        sizeSet.add(sizeG);
        machineSet.add(machName);
        machineNames[machName] = machName;

        if (!grouped[coffeeName]) grouped[coffeeName] = {};
        if (!grouped[coffeeName][machName]) grouped[coffeeName][machName] = {};
        grouped[coffeeName][machName][sizeG] = (grouped[coffeeName][machName][sizeG] || 0) + qty;
    });

    const activeSizes = [...sizeSet].sort((a, b) => a - b);
    const activeMachines = [...machineSet].sort();

    // Update dynamic thead
    const theadRow = document.getElementById('rep-sales-dispatch-thead');
    if (theadRow) {
        let thHtml = '<th style="min-width:140px;">Coffee Name</th>';
        activeMachines.forEach(m => {
            thHtml += `<th class="text-center">${m}</th>`;
        });
        theadRow.innerHTML = thHtml + '<th style="text-align: center; font-weight:800;">Total</th>';
    }

    // Build table body
    const tbody = document.getElementById('rep-sales-table-body');
    if (tbody) tbody.innerHTML = '';

    const coffeeNames = Object.keys(grouped).sort();

    if (coffeeNames.length === 0 && tbody) {
        tbody.innerHTML = `<tr><td colspan="${activeMachines.length + 2}" class="table-empty-state">No dispatched orders in selected period</td></tr>`;
    }

    const labels = [];
    const bagData = [];

    coffeeNames.forEach(coffeeName => {
        let totalBagsForCoffee = 0;

        if (tbody) {
            const tr = document.createElement('tr');
            let html = `<td style="vertical-align: middle; padding: 12px 20px;"><strong>${coffeeName}</strong></td>`;

            activeMachines.forEach(machName => {
                const machData = grouped[coffeeName][machName] || {};

                const sizesHtml = activeSizes.map((sz, idx) => {
                    const qty = machData[sz] || 0;
                    totalBagsForCoffee += qty;
                    const sizeLabel = sz >= 1000 ? `${sz/1000}kg` : `${sz}g`;
                    return `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: ${idx < activeSizes.length - 1 ? '1px dashed var(--border)' : 'none'};">
                            <span style="background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:6px; padding:2px 6px; font-size:0.73rem; font-weight:700;">${sizeLabel}</span>
                            <span style="font-size:0.8rem; font-weight:600; color:${qty > 0 ? 'var(--success)' : 'var(--text-muted)'};">${qty > 0 ? qty + ' bags' : '-'}</span>
                        </div>
                    `;
                }).join('');

                html += `<td style="vertical-align: top; padding: 8px 12px; min-width: 130px;">${sizesHtml}</td>`;
            });

            // Total column
            const totalSizesHtml = activeSizes.map((sz, idx) => {
                let sizeTotal = 0;
                activeMachines.forEach(mn => { sizeTotal += (grouped[coffeeName][mn] || {})[sz] || 0; });
                const sizeLabel = sz >= 1000 ? `${sz/1000}kg` : `${sz}g`;
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: ${idx < activeSizes.length - 1 ? '1px dashed var(--border)' : 'none'};">
                        <span style="background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:6px; padding:2px 6px; font-size:0.73rem; font-weight:700;">${sizeLabel}</span>
                        <span style="font-size:0.8rem; font-weight:800; color:var(--text-primary);">${sizeTotal > 0 ? sizeTotal + ' bags' : '-'}</span>
                    </div>
                `;
            }).join('');
            html += `<td style="vertical-align: top; padding: 8px 12px; min-width: 130px; background:rgba(45,90,61,0.04);">${totalSizesHtml}</td>`;

            tr.innerHTML = html;
            tbody.appendChild(tr);
        }

        labels.push(coffeeName);
        bagData.push(totalBagsForCoffee);
    });

    // Chart
    const ctx = document.getElementById('rep-sales-chart');
    if (ctx) {
        if (salesReportChart) salesReportChart.destroy();
        salesReportChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Dispatched Bags',
                        data: bagData,
                        backgroundColor: 'rgba(139, 92, 246, 0.65)',
                        borderColor: 'rgb(139, 92, 246)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: chartThemeColors().text } }
                },
                scales: {
                    x: { ticks: { color: chartThemeColors().tick } },
                    y: { ticks: { color: chartThemeColors().tick } }
                }
            }
        });
    }

    // Export Excel
    const salesExportBtn = document.getElementById('btn-export-sales-report');
    if (salesExportBtn) {
        salesExportBtn.addEventListener('click', (e) => { e.stopPropagation();
            const exportData = [];
            coffeeNames.forEach(coffeeName => {
                activeSizes.forEach(sz => {
                    const sizeLabel = sz >= 1000 ? `${sz/1000}kg` : `${sz}g`;
                    const row = { 'Coffee Name': coffeeName, 'Size': sizeLabel };
                    let rowTotal = 0;
                    activeMachines.forEach(machName => {
                        const qty = (grouped[coffeeName][machName] || {})[sz] || 0;
                        row[machName] = qty;
                        rowTotal += qty;
                    });
                    row['Total'] = rowTotal;
                    if (rowTotal > 0) exportData.push(row);
                });
            });
            exportToExcel(exportData, 'Sales_Dispatch_Report');
        });
    }
}

async function loadCustomerReport(startDate, endDate) {
    const [
        { data: orders },
        { data: orderItems },
        { data: customers },
        { data: greenbeans },
        { data: recipes }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('customers'),
        fetchData('green_coffee'),
        fetchData('blend_recipes')
    ]);

    const inDateRange = (o) => {
        const d = o.order_date || o.created_at?.split('T')[0];
        if (!d) return true;
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        return true;
    };

    // V2 1J: row-level filter — a sales_request_view_own-only role sees just
    // its own orders in this report (see filterOwnOrders in js/auth.js).
    const ownVisibleOrders = filterOwnOrders(orders);

    // Only count orders that actually shipped — mirrors Sales Dispatch report's
    // definition of "volume" (Pending/Cancelled orders never left the warehouse).
    const filteredOrders = ownVisibleOrders.filter(o => (o.status === 'Dispatched' || o.status === 'Completed') && inDateRange(o));

    // All orders in range regardless of status — used for the status-breakdown table below.
    const allOrdersInRange = ownVisibleOrders.filter(inDateRange);

    // stats[customerId] = { orders: Set<orderId>, bags, kg }
    const stats = {};
    filteredOrders.forEach(o => {
        if (!o.customer_id) return;
        if (!stats[o.customer_id]) stats[o.customer_id] = { orderIds: new Set(), bags: 0, kg: 0 };
        stats[o.customer_id].orderIds.add(o.id);
    });

    const orderIdToCustomerId = {};
    filteredOrders.forEach(o => { if (o.customer_id) orderIdToCustomerId[o.id] = o.customer_id; });

    (orderItems || []).forEach(item => {
        const customerId = orderIdToCustomerId[item.request_order_id];
        if (!customerId) return;
        const qty = parseInt(item.quantity_requested) || 0;
        const sizeG = parseInt(item.bag_size_g) || 0;
        stats[customerId].bags += qty;
        stats[customerId].kg += (qty * sizeG) / 1000;
    });

    const rows = Object.keys(stats).map(customerId => {
        const customer = (customers || []).find(c => c.id === parseInt(customerId));
        return {
            name: customer ? customer.name : 'Unknown',
            code: customer ? customer.customer_id : '-',
            type: customer ? customer.type : '-',
            orders: stats[customerId].orderIds.size,
            bags: stats[customerId].bags,
            kg: stats[customerId].kg
        };
    }).sort((a, b) => b.kg - a.kg);

    const tbody = document.getElementById('rep-customer-table-body');
    if (tbody) {
        tbody.innerHTML = '';
        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="table-empty-state">No dispatched orders in selected period</td></tr>`;
        } else {
            rows.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${r.name}</strong></td>
                    <td><code>${r.code}</code></td>
                    <td>${r.type}</td>
                    <td class="text-center">${r.orders}</td>
                    <td class="text-center">${r.bags}</td>
                    <td style="text-align:center; font-weight:700;">${r.kg.toFixed(1)}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    // Chart: top 10 customers by kg
    const topRows = rows.slice(0, 10);
    const ctx = document.getElementById('rep-customer-chart');
    if (ctx) {
        if (customerReportChart) customerReportChart.destroy();
        customerReportChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: topRows.map(r => r.name),
                datasets: [{
                    label: 'Total Dispatched (kg)',
                    data: topRows.map(r => r.kg.toFixed(1)),
                    backgroundColor: 'rgba(45, 90, 22, 0.65)',
                    borderColor: 'rgb(45, 90, 22)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: chartThemeColors().text } }
                },
                scales: {
                    x: { ticks: { color: chartThemeColors().tick } },
                    y: { ticks: { color: chartThemeColors().tick } }
                }
            }
        });
    }

    // Export Excel
    const exportBtn = document.getElementById('btn-export-customer-report');
    if (exportBtn) {
        exportBtn.addEventListener('click', (e) => { e.stopPropagation();
            const exportData = rows.map(r => ({
                'Customer Name': r.name,
                'Code': r.code,
                'Type': r.type,
                'Total Orders': r.orders,
                'Total Bags': r.bags,
                'Total (kg)': r.kg.toFixed(1)
            }));
            exportToExcel(exportData, 'Customer_Volume_Report');
        });
    }

    // ==========================================================
    // Customer Type Breakdown (Retail vs Wholesale, by kg)
    // ==========================================================
    const typeTotals = {};
    rows.forEach(r => { typeTotals[r.type] = (typeTotals[r.type] || 0) + r.kg; });
    const typeLabels = Object.keys(typeTotals);

    const typeCtx = document.getElementById('rep-customer-type-chart');
    if (typeCtx) {
        if (customerTypeChart) customerTypeChart.destroy();
        customerTypeChart = new Chart(typeCtx, {
            type: 'doughnut',
            data: {
                labels: typeLabels,
                datasets: [{
                    data: typeLabels.map(t => typeTotals[t].toFixed(1)),
                    backgroundColor: ['rgba(45, 90, 22, 0.75)', 'rgba(139, 92, 246, 0.75)', 'rgba(6, 182, 212, 0.75)', 'rgba(234, 179, 8, 0.75)'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: chartThemeColors().text } }
                }
            }
        });
    }

    // ==========================================================
    // Order Status per Customer (all statuses, not just dispatched)
    // ==========================================================
    const STATUS_KEYS = ['Pending Approval', 'Preparing', 'Dispatched', 'Completed', 'Cancelled'];
    const statusStats = {};
    allOrdersInRange.forEach(o => {
        if (!o.customer_id) return;
        if (!statusStats[o.customer_id]) statusStats[o.customer_id] = {};
        statusStats[o.customer_id][o.status] = (statusStats[o.customer_id][o.status] || 0) + 1;
    });

    const statusRows = Object.keys(statusStats).map(customerId => {
        const customer = (customers || []).find(c => c.id === parseInt(customerId));
        const counts = statusStats[customerId];
        const total = STATUS_KEYS.reduce((sum, k) => sum + (counts[k] || 0), 0);
        return { name: customer ? customer.name : 'Unknown', counts, total };
    }).sort((a, b) => b.total - a.total);

    const statusTbody = document.getElementById('rep-order-status-table-body');
    if (statusTbody) {
        statusTbody.innerHTML = '';
        if (statusRows.length === 0) {
            statusTbody.innerHTML = `<tr><td colspan="7" class="table-empty-state">No orders in selected period</td></tr>`;
        } else {
            statusRows.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${r.name}</strong></td>
                    <td class="text-center">${r.counts['Pending Approval'] || 0}</td>
                    <td class="text-center">${r.counts['Preparing'] || 0}</td>
                    <td class="text-center">${r.counts['Dispatched'] || 0}</td>
                    <td class="text-center">${r.counts['Completed'] || 0}</td>
                    <td style="text-align:center; color:var(--danger);">${r.counts['Cancelled'] || 0}</td>
                    <td style="text-align:center; font-weight:700;">${r.total}</td>
                `;
                statusTbody.appendChild(tr);
            });
        }
    }

    const statusExportBtn = document.getElementById('btn-export-order-status-report');
    if (statusExportBtn) {
        statusExportBtn.addEventListener('click', (e) => { e.stopPropagation();
            const exportData = statusRows.map(r => ({
                'Customer Name': r.name,
                'Pending': r.counts['Pending Approval'] || 0,
                'Preparing': r.counts['Preparing'] || 0,
                'Dispatched': r.counts['Dispatched'] || 0,
                'Completed': r.counts['Completed'] || 0,
                'Cancelled': r.counts['Cancelled'] || 0,
                'Total': r.total
            }));
            exportToExcel(exportData, 'Order_Status_per_Customer');
        });
    }

    // ==========================================================
    // Coffee Preference by Customer (top coffee bought, from dispatched orders)
    // ==========================================================
    const prefStats = {}; // customerId -> { coffeeName -> { bags, kg } }
    (orderItems || []).forEach(item => {
        const customerId = orderIdToCustomerId[item.request_order_id];
        if (!customerId) return;
        let coffeeName = '';
        if (item.coffee_type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === item.single_coffee_id);
            coffeeName = gb ? gb.name : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === item.blend_recipe_id);
            coffeeName = r ? r.name : 'Blend';
        }
        const qty = parseInt(item.quantity_requested) || 0;
        const sizeG = parseInt(item.bag_size_g) || 0;
        if (!prefStats[customerId]) prefStats[customerId] = {};
        if (!prefStats[customerId][coffeeName]) prefStats[customerId][coffeeName] = { bags: 0, kg: 0 };
        prefStats[customerId][coffeeName].bags += qty;
        prefStats[customerId][coffeeName].kg += (qty * sizeG) / 1000;
    });

    const prefRows = Object.keys(prefStats).map(customerId => {
        const customer = (customers || []).find(c => c.id === parseInt(customerId));
        const entries = Object.entries(prefStats[customerId]).sort((a, b) => b[1].bags - a[1].bags);
        const [topCoffee, topStats] = entries[0];
        return { name: customer ? customer.name : 'Unknown', topCoffee, bags: topStats.bags, kg: topStats.kg };
    }).sort((a, b) => b.bags - a.bags);

    const prefTbody = document.getElementById('rep-coffee-pref-table-body');
    if (prefTbody) {
        prefTbody.innerHTML = '';
        if (prefRows.length === 0) {
            prefTbody.innerHTML = `<tr><td colspan="4" class="table-empty-state">No dispatched orders in selected period</td></tr>`;
        } else {
            prefRows.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${r.name}</strong></td>
                    <td>${r.topCoffee}</td>
                    <td class="text-center">${r.bags}</td>
                    <td style="text-align:center; font-weight:700;">${r.kg.toFixed(1)}</td>
                `;
                prefTbody.appendChild(tr);
            });
        }
    }

    const prefExportBtn = document.getElementById('btn-export-coffee-pref-report');
    if (prefExportBtn) {
        prefExportBtn.addEventListener('click', (e) => { e.stopPropagation();
            const exportData = prefRows.map(r => ({
                'Customer Name': r.name,
                'Top Coffee': r.topCoffee,
                'Total Bags': r.bags,
                'Total (kg)': r.kg.toFixed(1)
            }));
            exportToExcel(exportData, 'Coffee_Preference_by_Customer');
        });
    }
}

// ============================================================
// STOCK OPNAME (physical stock count / reconciliation)
// ============================================================

// Holds the groups being counted during an in-progress stock take so
// finalizeStockTake() can adjust the underlying source rows.
let currentStockTakeGroups = null;

function resolvePackedCoffeeName(item, batches, greenbeans, recipes) {
    let name = item.custom_coffee_name || 'Roasted Coffee';
    if (item.roast_batch_id) {
        const b = (batches || []).find(x => x.id === item.roast_batch_id);
        if (b) {
            if (b.coffee_type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === b.single_coffee_id);
                if (gb) name = gb.name;
            } else {
                const r = (recipes || []).find(rec => rec.id === b.blend_recipe_id);
                if (r) name = r.name;
            }
        }
    }
    return name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
}

// Build the list of countable units. Green bean is one row per coffee; bulk and
// packed are aggregated to what a human physically counts (per coffee, per
// coffee+size) so a single actual count can map onto several system rows.
async function buildStockTakeGroups() {
    const [
        { data: greenbeans },
        { data: bulk },
        { data: packed },
        { data: batches },
        { data: recipes }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('bulk_roasted_coffee'),
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('blend_recipes')
    ]);

    const groups = [];

    // Green bean — one countable unit per coffee (always shown).
    (greenbeans || []).forEach(g => {
        groups.push({
            category: 'greenbean',
            label: g.name || `Green #${g.id}`,
            unit: 'kg',
            field: 'stock_kg',
            systemQty: parseFloat(g.stock_kg) || 0,
            rows: [{ table: 'green_coffee', rec: g }]
        });
    });

    // Bulk roasted — aggregate by coffee_name across machine rows.
    const bulkByName = {};
    (bulk || []).forEach(b => {
        const key = b.coffee_name || `Bulk #${b.id}`;
        if (!bulkByName[key]) bulkByName[key] = [];
        bulkByName[key].push(b);
    });
    Object.keys(bulkByName).forEach(name => {
        const rows = bulkByName[name];
        const systemQty = rows.reduce((s, r) => s + (parseFloat(r.bulk_available) || 0), 0);
        if (systemQty <= 0) return;
        groups.push({
            category: 'bulk',
            label: name,
            unit: 'kg',
            field: 'bulk_available',
            systemQty,
            rows: rows.map(r => ({ table: 'bulk_roasted_coffee', rec: r }))
        });
    });

    // Packed coffee — aggregate by coffee name + bag size across batches/machines.
    const packedByKey = {};
    (packed || []).forEach(p => {
        const name = resolvePackedCoffeeName(p, batches, greenbeans, recipes);
        const size = parseInt(p.bag_size_g) || 0;
        const key = `${name}|${size}`;
        if (!packedByKey[key]) packedByKey[key] = { name, size, rows: [] };
        packedByKey[key].rows.push(p);
    });
    Object.values(packedByKey).forEach(grp => {
        const systemQty = grp.rows.reduce((s, r) => s + (parseInt(r.quantity) || 0), 0);
        if (systemQty <= 0) return;
        const sizeLabel = grp.size >= 1000 ? `${grp.size / 1000}kg` : `${grp.size}g`;
        groups.push({
            category: 'packed',
            label: `${grp.name} (${sizeLabel})`,
            unit: 'bags',
            field: 'quantity',
            systemQty,
            rows: grp.rows.map(r => ({ table: 'packed_coffee', rec: r }))
        });
    });

    return groups;
}

function stockCategoryLabel(cat) {
    if (cat === 'greenbean') return window.t ? (window.t('cat_greenbean') || 'Green Bean') : 'Green Bean';
    if (cat === 'bulk') return window.t ? (window.t('cat_bulk') || 'Bulk Roasted') : 'Bulk Roasted';
    if (cat === 'packed') return window.t ? (window.t('cat_packed') || 'Packed') : 'Packed';
    return cat;
}

async function loadStockOpnameReport(startDate, endDate) {
    // Wire buttons (idempotent — onclick assignment, not addEventListener).
    const newBtn = document.getElementById('btn-stockopname-new');
    if (newBtn) newBtn.onclick = startStockTake;
    const cancelBtn = document.getElementById('btn-stockopname-cancel');
    if (cancelBtn) cancelBtn.onclick = cancelStockTake;
    const finalizeBtn = document.getElementById('btn-stockopname-finalize');
    if (finalizeBtn) finalizeBtn.onclick = finalizeStockTake;
    const printBtn = document.getElementById('btn-stockopname-print');
    if (printBtn) printBtn.onclick = printStockCountForm;

    // Default to history view.
    const sheet = document.getElementById('stockopname-sheet');
    const history = document.getElementById('stockopname-history');
    if (sheet) sheet.classList.add('hidden');
    if (history) history.classList.remove('hidden');

    const { data: takes } = await fetchData('stock_takes');
    const filtered = (takes || []).filter(t => {
        const d = t.take_date || t.created_at?.split('T')[0];
        if (!d) return true;
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        return true;
    }).sort((a, b) => (b.take_date || '').localeCompare(a.take_date || '') || b.id - a.id);

    const tbody = document.getElementById('stockopname-history-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="table-empty-state">${window.t ? (window.t('stockopname_empty') || 'No stock takes recorded yet.') : 'No stock takes recorded yet.'}</td></tr>`;
        return;
    }
    filtered.forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${t.take_date || '-'}</strong></td>
            <td>${t.performed_by || '-'}</td>
            <td class="text-center">${t.total_items || 0}</td>
            <td style="text-align:center; ${(t.variance_items || 0) > 0 ? 'color:var(--danger); font-weight:700;' : ''}">${t.variance_items || 0}</td>
            <td>${t.notes || '-'}</td>
            <td class="text-center"><button class="btn btn-secondary btn-sm" onclick="viewStockTake(${t.id})">${window.t ? (window.t('btn_view') || 'View') : 'View'}</button></td>
        `;
        tbody.appendChild(tr);
    });
}

async function startStockTake() {
    const tbody = document.getElementById('stockopname-count-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">Loading…</td></tr>`;

    const groups = await buildStockTakeGroups();
    currentStockTakeGroups = groups;

    const sheet = document.getElementById('stockopname-sheet');
    const history = document.getElementById('stockopname-history');
    if (sheet) sheet.classList.remove('hidden');
    if (history) history.classList.add('hidden');

    const notesInput = document.getElementById('stockopname-notes');
    if (notesInput) notesInput.value = '';

    if (tbody) {
        tbody.innerHTML = '';
        groups.forEach((g, i) => {
            const sysDisplay = g.unit === 'kg' ? g.systemQty.toFixed(1) : g.systemQty;
            const step = g.unit === 'kg' ? '0.1' : '1';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span style="font-size:0.72rem; color:#0891b2; font-weight:600; background:rgba(6,182,212,0.1); padding:2px 7px; border-radius:6px;">${stockCategoryLabel(g.category)}</span></td>
                <td><strong>${g.label}</strong></td>
                <td class="text-center">${sysDisplay} ${g.unit}</td>
                <td class="text-center"><input type="number" class="form-control stockopname-actual-input" data-group-index="${i}" value="${g.systemQty}" step="${step}" min="0" style="width:110px; text-align:center; margin:0 auto;"></td>
                <td  class="stockopname-variance-cell text-center" data-group-index="${i}">0</td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.stockopname-actual-input').forEach(input => {
            input.addEventListener('input', () => {
                const idx = parseInt(input.getAttribute('data-group-index'));
                const g = currentStockTakeGroups[idx];
                const actual = parseFloat(input.value);
                const cell = tbody.querySelector(`.stockopname-variance-cell[data-group-index="${idx}"]`);
                if (!cell) return;
                if (isNaN(actual)) { cell.textContent = '-'; cell.style.color = 'var(--text-muted)'; return; }
                const variance = actual - g.systemQty;
                const vDisplay = g.unit === 'kg' ? variance.toFixed(1) : variance;
                cell.textContent = variance > 0 ? `+${vDisplay}` : `${vDisplay}`;
                cell.style.color = variance === 0 ? 'var(--text-muted)' : (variance > 0 ? 'var(--success)' : 'var(--danger)');
                cell.style.fontWeight = variance === 0 ? '400' : '700';
            });
        });
    }
}

function cancelStockTake() {
    currentStockTakeGroups = null;
    const sheet = document.getElementById('stockopname-sheet');
    const history = document.getElementById('stockopname-history');
    if (sheet) sheet.classList.add('hidden');
    if (history) history.classList.remove('hidden');
}

// Push a group's counted total back onto its underlying source rows. Surplus is
// added to the first row; a shortage is deducted across rows until satisfied.
function applyStockGroupAdjustment(group, actual) {
    const changed = [];
    const field = group.field;
    let delta = actual - group.systemQty;
    if (Math.abs(delta) < 1e-9) return changed;
    if (delta > 0) {
        const row = group.rows[0];
        row.rec[field] = (parseFloat(row.rec[field]) || 0) + delta;
        changed.push(row);
    } else {
        let deduct = -delta;
        for (const row of group.rows) {
            if (deduct <= 1e-9) break;
            const avail = parseFloat(row.rec[field]) || 0;
            const take = Math.min(avail, deduct);
            if (take > 0) { row.rec[field] = avail - take; deduct -= take; changed.push(row); }
        }
    }
    return changed;
}

async function finalizeStockTake() {
    if (!currentStockTakeGroups) return;
    const tbody = document.getElementById('stockopname-count-body');
    if (!tbody) return;

    // Read actual counts.
    const lines = [];
    const adjustments = [];
    currentStockTakeGroups.forEach((g, i) => {
        const input = tbody.querySelector(`.stockopname-actual-input[data-group-index="${i}"]`);
        let actual = input ? parseFloat(input.value) : NaN;
        if (isNaN(actual)) actual = g.systemQty; // blank = unchanged
        const variance = actual - g.systemQty;
        lines.push({
            category: g.category,
            item_name: g.label,
            unit: g.unit,
            system_qty: g.systemQty,
            actual_qty: actual,
            variance: variance
        });
        if (Math.abs(variance) > 1e-9) adjustments.push({ group: g, actual });
    });

    const varianceCount = lines.filter(l => Math.abs(l.variance) > 1e-9).length;
    const confirmMsg = (window.t ? (window.t('confirm_stockopname_finalize') || 'Finalize this stock take? System stock will be adjusted to match your counts.') : 'Finalize this stock take? System stock will be adjusted to match your counts.')
        + `\n\nItems: ${lines.length}  |  Variances: ${varianceCount}`;
    if (!confirm(confirmMsg)) return;

    // Save the parent record FIRST. If the stock_takes table is missing, bail out
    // before touching any live stock so nothing gets adjusted half-way.
    const { data: parent, error: parentErr } = await saveData('stock_takes', {
        take_date: new Date().toISOString().split('T')[0],
        performed_by: (currentUser && currentUser.name) ? currentUser.name : 'Unknown',
        notes: (document.getElementById('stockopname-notes') || {}).value || '',
        total_items: lines.length,
        variance_items: varianceCount
    });
    if (parentErr || !parent || !parent.id) {
        alert('Failed to save stock take (has the stock_takes table been created in Supabase?): ' + (parentErr ? parentErr.message : 'no id returned'));
        return;
    }

    // Adjust the live source rows.
    for (const adj of adjustments) {
        const changedRows = applyStockGroupAdjustment(adj.group, adj.actual);
        for (const row of changedRows) {
            await saveData(row.table, row.rec);
        }
    }

    // Save the audit line items.
    for (const line of lines) {
        await saveData('stock_take_items', { stock_take_id: parent.id, ...line });
    }

    alert(window.t ? (window.t('alert_stockopname_saved') || 'Stock take finalized and stock adjusted.') : 'Stock take finalized and stock adjusted.');
    currentStockTakeGroups = null;
    await loadStockOpnameReport('', '');
    if (typeof scheduleDashboardRefresh === 'function') scheduleDashboardRefresh();
}

async function viewStockTake(takeId) {
    const [
        { data: takes },
        { data: items }
    ] = await Promise.all([
        fetchData('stock_takes'),
        fetchData('stock_take_items')
    ]);
    const take = (takes || []).find(t => t.id === takeId);
    const lines = (items || []).filter(it => it.stock_take_id === takeId);

    let rowsHtml = '';
    lines.forEach(l => {
        const sys = l.unit === 'kg' ? parseFloat(l.system_qty).toFixed(1) : l.system_qty;
        const act = l.unit === 'kg' ? parseFloat(l.actual_qty).toFixed(1) : l.actual_qty;
        const varN = parseFloat(l.variance) || 0;
        const varDisplay = l.unit === 'kg' ? varN.toFixed(1) : varN;
        const varColor = varN === 0 ? 'var(--text-muted)' : (varN > 0 ? 'var(--success)' : 'var(--danger)');
        rowsHtml += `
            <tr>
                <td style="padding:6px 10px; border-bottom:1px solid var(--border);"><span style="font-size:0.7rem; color:#0891b2; background:rgba(6,182,212,0.1); padding:2px 6px; border-radius:5px;">${stockCategoryLabel(l.category)}</span></td>
                <td style="padding:6px 10px; border-bottom:1px solid var(--border);">${l.item_name}</td>
                <td style="padding:6px 10px; border-bottom:1px solid var(--border); text-align:center;">${sys} ${l.unit}</td>
                <td style="padding:6px 10px; border-bottom:1px solid var(--border); text-align:center;">${act} ${l.unit}</td>
                <td style="padding:6px 10px; border-bottom:1px solid var(--border); text-align:center; color:${varColor}; font-weight:${varN === 0 ? '400' : '700'};">${varN > 0 ? '+' : ''}${varDisplay}</td>
            </tr>`;
    });

    const html = `
        <div style="margin-bottom:12px; font-size:0.85rem; color:var(--text-secondary);">
            <strong>${take ? (take.take_date || '') : ''}</strong> — ${take ? (take.performed_by || '') : ''}
            ${take && take.notes ? `<br>${take.notes}` : ''}
        </div>
        <div style="max-height:60vh; overflow-y:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                <thead>
                    <tr>
                        <th style="text-align:left; padding:6px 10px; border-bottom:2px solid var(--border);">${window.t ? (window.t('col_category') || 'Category') : 'Category'}</th>
                        <th style="text-align:left; padding:6px 10px; border-bottom:2px solid var(--border);">${window.t ? (window.t('col_item') || 'Item') : 'Item'}</th>
                        <th style="text-align:center; padding:6px 10px; border-bottom:2px solid var(--border);">${window.t ? (window.t('col_system_qty') || 'System') : 'System'}</th>
                        <th style="text-align:center; padding:6px 10px; border-bottom:2px solid var(--border);">${window.t ? (window.t('col_actual_qty') || 'Actual') : 'Actual'}</th>
                        <th style="text-align:center; padding:6px 10px; border-bottom:2px solid var(--border);">${window.t ? (window.t('col_variance') || 'Variance') : 'Variance'}</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml || `<tr><td colspan="5" style="text-align:center; padding:16px; color:var(--text-muted);">No line items.</td></tr>`}</tbody>
            </table>
        </div>
    `;
    openModal(window.t ? (window.t('stockopname_detail_title') || 'Stock Take Detail') : 'Stock Take Detail', html);
}

// Print a blank counting form (one page per category) for the team to fill in
// physically before typing the numbers back into the system.
async function printStockCountForm() {
    const groups = await buildStockTakeGroups();
    const cs = companySettings;
    // Fill each A4 page: aim for a fixed total number of rows so the table reaches
    // the bottom. Empty rows top up whatever the data rows don't cover; if the data
    // alone already exceeds a page, still add a few blanks for write-ins.
    const TARGET_ROWS_PER_PAGE = 22;
    const MIN_EMPTY_ROWS = 4;

    const byCat = { greenbean: [], bulk: [], packed: [] };
    groups.forEach(g => { if (byCat[g.category]) byCat[g.category].push(g); });

    const subtitle = window.t ? (window.t('form_stockcount_subtitle') || 'Stock Count Form') : 'Stock Count Form';
    const tHeaderItem = window.t ? (window.t('col_item') || 'Item') : 'Item';
    const tHeaderSystem = window.t ? (window.t('col_system_qty') || 'System') : 'System';
    const tHeaderActual = window.t ? (window.t('col_actual_qty') || 'Actual') : 'Actual';
    const tHeaderNotes = window.t ? (window.t('col_notes') || 'Notes') : 'Notes';
    const tDate = window.t ? (window.t('col_date') || 'Date') : 'Date';
    const tBy = window.t ? (window.t('col_performed_by') || 'Counted By') : 'Counted By';

    function renderPage(catKey, isLast) {
        const list = byCat[catKey] || [];
        let rows = '';
        let idx = 1;
        list.forEach(g => {
            const sys = g.unit === 'kg' ? g.systemQty.toFixed(1) : g.systemQty;
            rows += `<tr>
                <td class="c">${idx++}</td>
                <td>${g.label}</td>
                <td class="c">${sys} ${g.unit}</td>
                <td class="blank"></td>
                <td class="blank"></td>
            </tr>`;
        });
        const emptyCount = Math.max(TARGET_ROWS_PER_PAGE - list.length, MIN_EMPTY_ROWS);
        for (let i = 0; i < emptyCount; i++) {
            rows += `<tr>
                <td class="c">${idx++}</td>
                <td class="blank"></td>
                <td class="blank"></td>
                <td class="blank"></td>
                <td class="blank"></td>
            </tr>`;
        }
        return `
        <div class="page" ${isLast ? '' : 'style="page-break-after:always;"'}>
            <div class="letterhead">
                <div class="lh-left">
                    ${cs.show_logo_in_print && cs.logo_base64 ? '<img class="lh-logo" src="' + cs.logo_base64 + '" alt="Logo">' : ''}
                    <div>
                        <div class="lh-name">${cs.company_name || 'Coffee Roastery'}</div>
                        <div class="lh-contact">${cs.address ? cs.address : ''}</div>
                    </div>
                </div>
                <div class="lh-right">
                    <div class="doc-title">${stockCategoryLabel(catKey)}</div>
                    <div class="doc-sub">${subtitle}</div>
                </div>
            </div>
            <div class="meta">
                <span>${tDate}: _______________________</span>
                <span>${tBy}: _______________________</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th style="width:34px;">#</th>
                        <th>${tHeaderItem}</th>
                        <th style="width:100px;">${tHeaderSystem}</th>
                        <th style="width:120px;">${tHeaderActual}</th>
                        <th style="width:150px;">${tHeaderNotes}</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="signoff">
                <div class="sig"><div class="sig-line"></div><div class="sig-lbl">Counted By</div></div>
                <div class="sig"><div class="sig-line"></div><div class="sig-lbl">Checked By</div></div>
                <div class="sig"><div class="sig-line"></div><div class="sig-lbl">Approved By</div></div>
            </div>
        </div>`;
    }

    const pages = renderPage('greenbean', false) + renderPage('bulk', false) + renderPage('packed', true);

    const printContent = `<!DOCTYPE html>
<html>
<head>
    <title>${subtitle}</title>
    <style>
        @page { size: A4; margin: 14mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 12px; }
        .page { max-width: 210mm; margin: 0 auto; padding: 6px; }
        .letterhead { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 3px solid #2d5016; margin-bottom: 14px; }
        .lh-left { display: flex; align-items: center; gap: 12px; }
        .lh-logo { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; border: 1px solid #e5e5e5; }
        .lh-name { font-size: 18px; font-weight: 800; color: #2d5016; line-height: 1.2; }
        .lh-contact { font-size: 10px; color: #777; margin-top: 2px; }
        .lh-right { text-align: right; }
        .doc-title { font-size: 17px; font-weight: 800; color: #2d5016; text-transform: uppercase; letter-spacing: 0.5px; }
        .doc-sub { font-size: 10px; color: #999; margin-top: 2px; }
        .meta { display: flex; gap: 40px; font-size: 11px; color: #555; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; }
        thead th { background: #2d5016; color: #fff; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; text-align: left; border: 1px solid #2d5016; }
        tbody td { padding: 6px 10px; border: 1px solid #cfcfcf; font-size: 12px; height: 26px; }
        tbody td.c { text-align: center; }
        tbody td.blank { background: #fff; }
        .signoff { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; margin-top: 24px; }
        .sig { text-align: center; }
        .sig-line { border-top: 1px solid #333; margin-bottom: 4px; padding-top: 32px; }
        .sig-lbl { font-size: 10px; text-transform: uppercase; color: #666; font-weight: 600; }
        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
    </style>
</head>
<body>
    ${pages}
    <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`;

    const w = window.open('', '_blank');
    w.document.write(printContent);
    w.document.close();
}

// Fullscreen Table Popup
function openFullscreenTable(tableId, title) {
    const sourceTable = document.getElementById(tableId);
    if (!sourceTable) return;

    const modal = document.getElementById('modal-fullscreen-chart');
    const titleEl = document.getElementById('fullscreen-chart-title');
    const chartContainer = document.getElementById('fullscreen-chart-container');

    titleEl.textContent = title || '';
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';

    // Hide canvas, show table clone
    const canvasEl = document.getElementById('fullscreen-chart-canvas');
    if (canvasEl) canvasEl.parentElement.style.display = 'none';

    // Remove old cloned table if exists
    const oldClone = chartContainer.querySelector('.fullscreen-table-clone');
    if (oldClone) oldClone.remove();

    const tableClone = sourceTable.cloneNode(true);
    tableClone.className = 'fullscreen-table-clone';
    tableClone.style.cssText = 'width:100%; overflow:auto;';
    chartContainer.appendChild(tableClone);
}

// Override closeFullscreenChart to also clean up table
const _origClose = closeFullscreenChart;
closeFullscreenChart = function() {
    const chartContainer = document.getElementById('fullscreen-chart-container');
    const cloned = chartContainer?.querySelector('.fullscreen-table-clone');
    if (cloned) cloned.remove();
    const canvasEl = document.getElementById('fullscreen-chart-canvas');
    if (canvasEl) canvasEl.parentElement.style.display = '';
    _origClose();
};


// --- INITIAL BOOTSTRAP ---
(async function bootstrap() {
    await syncCustomRolesFromSupabase();
    checkAuthentication();
    makeTabsDraggable();
    initTableFilters();
    initRoastingBatchPagination();
    initHandoverPagination();

    // Resume on whatever section was open before the last refresh, instead
    // of always resetting to Dashboard. Falls back to Dashboard if nothing
    // was saved yet, or if the saved id no longer exists (e.g. after a
    // section was renamed/removed in an update). navigateTo()'s own
    // permission check still applies, so a role change since last visit
    // correctly redirects rather than landing on a now-forbidden section.
    let startSection = 'sec-dashboard';
    try {
        const savedSection = localStorage.getItem(LAST_SECTION_KEY);
        if (savedSection && document.getElementById(savedSection)) startSection = savedSection;
    } catch (e) {}
    navigateTo(startSection);
})();


// ==========================================================================
// GLOBAL BARCODE SCANNER LISTENER
// ==========================================================================
// USB/Bluetooth barcode scanners act as a keyboard: they "type" the encoded
// value very fast (well under human typing speed) then send a configurable
// terminator key — Enter is common, but plenty of cheap/generic scanners
// ship configured for Tab, or no terminator at all. Originally this only
// listened for Enter, so a scanner set to Tab (or none) produced no visible
// error and simply appeared to "not work" — confirmed by reproducing it here
// with a synthetic Tab-terminated scan.
//
// Fix: listen for Enter/Tab as an immediate commit, AND arm an idle-timeout
// fallback the moment the buffer starts matching our 'RMP:' prefix — if no
// further keystroke arrives within BARCODE_IDLE_COMMIT_MS, treat the burst as
// finished and commit it regardless of terminator. The idle-timer is only
// armed after the prefix already matches, so normal manual typing elsewhere
// (which is both slower and essentially never starts with 'RMP:') can't
// accidentally trigger it.
// A valid scan still has to wait on openQuickRoastModal's 5 parallel
// fetchData() calls (green_coffee/blend_recipes/machines/roast_batches/
// blend_ingredients) before anything appears on screen — on a slow or
// congested connection that gap is long enough that operators on the floor
// perceive the scan as having done nothing, and scan again. Two fixes below:
// an instant toast the moment the scan is validated (decoupled from how long
// the modal takes to actually populate), and a scanInProgress guard so an
// impatient re-scan during that gap doesn't kick off a second overlapping
// fetch+modal-open race.
(function() {
    let barcodeBuffer = '';
    let lastKeyTime = 0;
    let idleCommitTimer = null;
    let scanInProgress = false;
    const BARCODE_MIN_LENGTH = 8; // minimum barcode length
    const BARCODE_IDLE_COMMIT_MS = 80; // no-terminator fallback: commit after this much silence

    function showScanToast(text, bg) {
        const toast = document.createElement('div');
        toast.style.cssText = `position:fixed; bottom:20px; right:20px; background:${bg}; color:white; padding:12px 20px; border-radius:8px; font-weight:700; z-index:99999; box-shadow:0 4px 12px rgba(0,0,0,0.3); animation: fadeIn 0.3s;`;
        toast.textContent = text;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    function commitBuffer() {
        const candidate = barcodeBuffer;
        barcodeBuffer = '';
        clearTimeout(idleCommitTimer);
        if (candidate.length < BARCODE_MIN_LENGTH || !candidate.startsWith('RMP:')) return;

        if (scanInProgress) {
            showScanToast('⏳ Still loading the previous scan — please wait...', '#d97706');
            return;
        }
        scanInProgress = true;
        showScanToast('📷 Barcode detected — opening...', '#0369a1');
        Promise.resolve(handleBarcodeScan(candidate))
            .catch(err => {
                console.error('Barcode scan handling failed:', err);
                showScanToast('⚠️ Failed to open scan form — see console.', '#dc2626');
            })
            .finally(() => { scanInProgress = false; });
    }

    document.addEventListener('keydown', (e) => {
        const now = Date.now();

        if (e.key === 'Enter' || e.key === 'Tab') {
            if (barcodeBuffer.length >= BARCODE_MIN_LENGTH && barcodeBuffer.startsWith('RMP:')) {
                e.preventDefault();
                e.stopPropagation();
                commitBuffer();
            } else {
                barcodeBuffer = '';
                clearTimeout(idleCommitTimer);
            }
            return;
        }

        if (e.key && e.key.length === 1) { // printable character
            if (now - lastKeyTime > 200) {
                barcodeBuffer = ''; // reset if too slow (manual typing)
            }
            barcodeBuffer += e.key;
            lastKeyTime = now;

            clearTimeout(idleCommitTimer);
            if (barcodeBuffer.startsWith('RMP:')) {
                idleCommitTimer = setTimeout(commitBuffer, BARCODE_IDLE_COMMIT_MS);
            }
        }
    });
})();


// ==========================================================================
// BARCODE GENERATOR
// ==========================================================================

async function showBarcodeLabels(coffeeType, coffeeId, coffeeName) {
    const { data: machines } = await fetchData('machines');
    if (!machines || machines.length === 0) {
        alert('No machines configured. Please add machines in Settings first.');
        return;
    }
    
    let labelsHtml = '<div style="display: flex; flex-wrap: wrap; gap: 16px; justify-content: center;">';
    
    machines.forEach((m, idx) => {
        const barcodeValue = `RMP:${coffeeType}:${coffeeId}:${m.id}`;
        labelsHtml += `
            <div style="border: 2px dashed var(--border); border-radius: 8px; padding: 16px; text-align: center; min-width: 220px;">
                <svg id="barcode-label-${idx}"></svg>
                <div style="margin-top: 8px; font-weight: 700; font-size: 0.9rem;">${coffeeName}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">🏭 ${m.name}</div>
                <button class="btn btn-secondary btn-sm" style="margin-top: 8px;" onclick="printSingleBarcode('${barcodeValue}', '${coffeeName.replace(/'/g, "\\'")}', '${m.name.replace(/'/g, "\\'")}')">
                    🖨️ Print
                </button>
            </div>
        `;
    });
    labelsHtml += '</div>';
    
    openModal(`🏷️ Barcodes: ${coffeeName}`, labelsHtml, '700px');
    
    // Render barcodes after modal opens
    setTimeout(() => {
        machines.forEach((m, idx) => {
            const barcodeValue = `RMP:${coffeeType}:${coffeeId}:${m.id}`;
            const el = document.getElementById(`barcode-label-${idx}`);
            if (el && typeof JsBarcode !== 'undefined') {
                JsBarcode(el, barcodeValue, {
                    format: 'CODE128',
                    width: 1.5,
                    height: 50,
                    displayValue: true,
                    fontSize: 11,
                    margin: 5
                });
            }
        });
    }, 200);
}

// Same physical 50x25mm sticker + aspect-ratio-safe scaling used by the
// other barcode stickers in the app (roasting log, packed coffee lot,
// printAllBarcodes' sticker-50x25 preset). Previously this had no @page size
// and no CSS scaling at all, so the raw JsBarcode SVG (width:2/height:60 in
// source units, ~112mm wide for a 16-char RMP code) rendered at its full
// intrinsic size and got clipped/mis-scaled by the label printer driver
// instead of shrinking to fit — that's what made it unscannable even though
// the in-modal preview (different JsBarcode call, showBarcodeLabels) looked fine.
function printSingleBarcode(barcodeValue, coffeeName, machineName) {
    const printWin = window.open('', '_blank', 'width=400,height=300');
    printWin.document.write(`
        <html><head><title>Barcode Label</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <style>
            @page { size: 50mm 25mm; margin: 1mm; }
            body { display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100vh; margin:0; padding:0; box-sizing:border-box; font-family: Arial, sans-serif; }
            .label { text-align:center; width:100%; padding: 0 2mm; box-sizing:border-box; }
            .name { font-weight:700; font-size: 11px; margin-top: 2px; line-height:1; }
            .machine { font-size: 9px; color: #666; line-height:1; }
            svg#bc { max-width: 100%; width: auto; height: auto; max-height: 14mm; display: block; margin: 0 auto; }
        </style></head><body>
        <div class="label">
            <svg id="bc"></svg>
            <div class="name">${coffeeName}</div>
            <div class="machine">🏭 ${machineName}</div>
        </div>
        <script>
            JsBarcode('#bc', '${barcodeValue}', { format: 'CODE128', width: 1.3, height: 60, displayValue: true, fontSize: 9, margin: 3 });
            setTimeout(() => { window.print(); }, 500);
        <\/script>
        </body></html>
    `);
    printWin.document.close();
}

// Presets covering both "full sheet, multi-label grid" printers (A4/Letter)
// and single-label thermal/sticker roll printers (one label per physical
// page so the roll advances correctly). barW/barH/fontSize are tuned per
// preset so the barcode + text stay legible at that label's physical size.
// barMaxHeightMm caps the rendered barcode height (mm) for pagePerLabel
// presets, same fix already proven on the roasting/packed-coffee stickers:
// without it, a long RMP:Type:id:machineId code forces the SVG to shrink to
// fit the label's width, and since height wasn't independently capped the
// bars end up razor-thin/too-short to scan (this is what was broken here —
// see the 2026-07-13 "greenbean barcode unreadable" fix).
const BARCODE_PRINT_PRESETS = {
    'a4-3col':      { label: 'A4 — 3 labels per row (standard)',        pageSize: 'A4',            margin: '10mm', columns: 3, barW: 1.2, barH: 40, fontSize: 9,  pagePerLabel: false },
    'a4-2col':      { label: 'A4 — 2 labels per row (larger)',          pageSize: 'A4',            margin: '10mm', columns: 2, barW: 1.6, barH: 55, fontSize: 12, pagePerLabel: false },
    'letter-3col':  { label: 'Letter — 3 labels per row',               pageSize: 'letter',        margin: '10mm', columns: 3, barW: 1.2, barH: 40, fontSize: 9,  pagePerLabel: false },
    'sticker-100x50': { label: 'Sticker roll 100×50mm — 1 per page',    pageSize: '100mm 50mm',    margin: '3mm',  columns: 1, barW: 2,   barH: 60, fontSize: 12, pagePerLabel: true, barMaxHeightMm: 20 },
    'sticker-60x40':  { label: 'Sticker roll 60×40mm — 1 per page',     pageSize: '60mm 40mm',     margin: '2mm',  columns: 1, barW: 1.5, barH: 55, fontSize: 9,  pagePerLabel: true, barMaxHeightMm: 14 },
    'sticker-50x25':  { label: 'Sticker roll 50×25mm — 1 per page',     pageSize: '50mm 25mm',     margin: '1mm',  columns: 1, barW: 1.3, barH: 60, fontSize: 9,  pagePerLabel: true, barMaxHeightMm: 14 },
};

function openBarcodePrintSizeModal() {
    const optionsHtml = Object.entries(BARCODE_PRINT_PRESETS).map(([key, p]) => `<option value="${key}">${p.label}</option>`).join('');
    const html = `
        <form id="modal-barcode-size-form">
            <div class="form-group">
                <label class="form-label">Paper / Label Size</label>
                <select id="m-barcode-size" class="form-control" required>${optionsHtml}</select>
                <p class="text-muted-xs" style="margin-top:8px;">Pick whichever matches what's loaded in your printer — a full sheet (A4/Letter) prints several labels per page, a sticker roll size prints one label per page so the roll advances correctly.</p>
            </div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Print</button>
            </div>
        </form>
    `;
    openModal('🖨️ Print All Barcode Labels', html);
    document.getElementById('modal-barcode-size-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const sizeKey = document.getElementById('m-barcode-size').value;
        document.getElementById('btn-close-modal').click();
        printAllBarcodes(sizeKey);
    });
}

async function printAllBarcodes(sizeKey = 'a4-3col') {
    const preset = BARCODE_PRINT_PRESETS[sizeKey] || BARCODE_PRINT_PRESETS['a4-3col'];
    const [
        { data: greenbeans },
        { data: recipes },
        { data: machines }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines')
    ]);

    if (!machines || machines.length === 0) {
        alert('No machines configured.');
        return;
    }

    let allLabels = '';

    // Singles
    (greenbeans || []).forEach(g => {
        (machines || []).forEach(m => {
            const barcodeValue = `RMP:Single:${g.id}:${m.id}`;
            allLabels += `
                <div class="label-item">
                    <svg class="bc" data-value="${barcodeValue}"></svg>
                    <div class="name">${g.name}</div>
                    <div class="machine">🏭 ${m.name}</div>
                </div>
            `;
        });
    });

    // Blends
    (recipes || []).forEach(r => {
        (machines || []).forEach(m => {
            const barcodeValue = `RMP:Blend:${r.id}:${m.id}`;
            allLabels += `
                <div class="label-item">
                    <svg class="bc" data-value="${barcodeValue}"></svg>
                    <div class="name">${r.name}</div>
                    <div class="machine">🏭 ${m.name}</div>
                </div>
            `;
        });
    });

    // In single-label-per-page mode each item IS the page, so it's sized to
    // fill it (and centered) rather than sitting in a bordered grid cell;
    // page-break-after on all-but-the-last avoids a trailing blank page.
    const itemStyle = preset.pagePerLabel
        ? 'text-align: center; page-break-inside: avoid; display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100vh; box-sizing:border-box;'
        : 'text-align: center; border: 1px dashed #ccc; padding: 8px; page-break-inside: avoid;';
    const pageBreakRule = preset.pagePerLabel ? '.label-item:not(:last-child) { page-break-after: always; }' : '';

    const printWin = window.open('', '_blank', 'width=800,height=600');
    printWin.document.write(`
        <html><head><title>All Barcode Labels</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <style>
            @page { size: ${preset.pageSize}; margin: ${preset.margin}; }
            body { margin: 0; padding: ${preset.pagePerLabel ? '0' : preset.margin}; font-family: Arial, sans-serif; }
            .grid { display: grid; grid-template-columns: repeat(${preset.columns}, 1fr); gap: 8px; }
            .label-item { ${itemStyle} }
            ${pageBreakRule}
            .name { font-weight: 700; font-size: ${preset.fontSize + 2}px; margin-top: 3px; }
            .machine { font-size: ${preset.fontSize}px; color: #666; }
            /* width:auto + height:auto (not width:100%) preserves the
               barcode's aspect ratio when it shrinks to fit — otherwise a
               long RMP:Type:id:machineId code gets squashed thinner than
               its module width setting, which is what made it unscannable. */
            svg.bc { max-width: 100%; width: auto; height: auto; display: block; margin: 0 auto; ${preset.pagePerLabel ? `max-height: ${preset.barMaxHeightMm || 20}mm;` : ''} }
        </style></head><body>
        <div class="grid">${allLabels}</div>
        <script>
            document.querySelectorAll('.bc').forEach(el => {
                JsBarcode(el, el.dataset.value, { format: 'CODE128', width: ${preset.barW}, height: ${preset.barH}, displayValue: true, fontSize: ${preset.fontSize}, margin: 3 });
            });
            setTimeout(() => { window.print(); }, 800);
        <\/script>
        </body></html>
    `);
    printWin.document.close();
}

