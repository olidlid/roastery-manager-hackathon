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
    currency: 'SAR',
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
                greenbean_analysis_add: true, greenbean_analysis_edit: true,
                greenbean_outbound_view: true, greenbean_outbound_add: true, greenbean_outbound_edit: true, greenbean_outbound_delete: true,
                roasting_view: true, roasting_plan_add: true, roasting_plan_edit: true, roasting_plan_delete: true,
                roasting_batch_view: true, roasting_batch_add: true, roasting_batch_edit: true, roasting_batch_delete: true, roasting_batch_approve: true,
                blend_view: true, blend_add: true, blend_edit: true, blend_delete: true,
                production_potential_view: true,
                packing_view: true, packing_daily: true, packing_print_barcode: true, packing_manual_add: true, packing_order_view: true, packing_records_view: true, packing_unpack: true, packing_repack: true, packing_stock_release: true, packing_completed_view: true, packing_dispatch_checkout: true, packing_waste_control: true,
                sales_request_view: true, sales_request_view_own: false, sales_request_create: true, sales_request_edit: true, sales_request_delete: true, sales_request_print: true,
                dispatch_approval_view: true, dispatch_approval_approve: true, dispatch_approval_dispatch: true, dispatch_approval_print: true,
                customer_view: true, customer_add: true, customer_edit: true, customer_delete: true, customer_cat_retail: true, customer_cat_wholesale: true, customer_cat_supermarket: true,
                crm_manage: true,   // CRM_PAGE_PLAN.md §5.3 — halaman CRM management
                purchase_request_view: true, purchase_request_create: true, purchase_request_edit: true, purchase_request_delete: true, purchase_request_view_own: false, purchase_approval_view: true, purchase_approval_decide: true,
                other_items_view: true, other_items_add: true, other_items_edit: true, other_items_delete: true, other_items_stock_in: true, other_items_release: true,
                reports_view: true, reports_stockopname_view: true, reports_stockopname_perform: true,
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
                greenbean_analysis_add: true, greenbean_analysis_edit: true,
                greenbean_outbound_view: true, greenbean_outbound_add: true, greenbean_outbound_edit: true, greenbean_outbound_delete: true,
                roasting_view: true, roasting_plan_add: true, roasting_plan_edit: true, roasting_plan_delete: true,
                roasting_batch_view: true, roasting_batch_add: true, roasting_batch_edit: true, roasting_batch_delete: true, roasting_batch_approve: true,
                blend_view: true, blend_add: true, blend_edit: true, blend_delete: true,
                production_potential_view: true,
                packing_view: true, packing_daily: true, packing_print_barcode: true, packing_manual_add: true, packing_order_view: true, packing_records_view: true, packing_unpack: true, packing_repack: true, packing_stock_release: true, packing_completed_view: true, packing_dispatch_checkout: true, packing_waste_control: true,
                sales_request_view: true, sales_request_view_own: false, sales_request_create: true, sales_request_edit: true, sales_request_delete: true, sales_request_print: true,
                dispatch_approval_view: true, dispatch_approval_approve: true, dispatch_approval_dispatch: true, dispatch_approval_print: true,
                customer_view: true, customer_add: true, customer_edit: true, customer_delete: true, customer_cat_retail: true, customer_cat_wholesale: true, customer_cat_supermarket: true,
                crm_manage: true,   // CRM_PAGE_PLAN.md §5.3 — halaman CRM management
                purchase_request_view: true, purchase_request_create: true, purchase_request_edit: true, purchase_request_delete: true, purchase_request_view_own: false, purchase_approval_view: true, purchase_approval_decide: true,
                other_items_view: true, other_items_add: true, other_items_edit: true, other_items_delete: true, other_items_stock_in: true, other_items_release: true,
                reports_view: true, reports_stockopname_view: true, reports_stockopname_perform: true,
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
                greenbean_analysis_add: true, greenbean_analysis_edit: true,
                greenbean_outbound_view: true, greenbean_outbound_add: true, greenbean_outbound_edit: true, greenbean_outbound_delete: true,
                roasting_view: true, roasting_plan_add: true, roasting_plan_edit: true, roasting_plan_delete: true,
                roasting_batch_view: true, roasting_batch_add: true, roasting_batch_edit: true, roasting_batch_delete: true, roasting_batch_approve: true,
                blend_view: true, blend_add: true, blend_edit: true, blend_delete: true,
                production_potential_view: true,
                packing_view: true, packing_daily: true, packing_print_barcode: true, packing_manual_add: true, packing_order_view: true, packing_records_view: true, packing_unpack: true, packing_repack: true, packing_stock_release: true, packing_completed_view: true, packing_dispatch_checkout: true, packing_waste_control: true,
                sales_request_view: true, sales_request_view_own: false, sales_request_create: false, sales_request_edit: false, sales_request_delete: false, sales_request_print: true,
                dispatch_approval_view: true, dispatch_approval_approve: true, dispatch_approval_dispatch: true, dispatch_approval_print: true,
                customer_view: true, customer_add: false, customer_edit: false, customer_delete: false, customer_cat_retail: true, customer_cat_wholesale: true, customer_cat_supermarket: true,
                crm_manage: true,   // CRM_PAGE_PLAN.md §5.3 — halaman CRM management
                purchase_request_view: true, purchase_request_create: true, purchase_request_edit: true, purchase_request_delete: true, purchase_request_view_own: false, purchase_approval_view: true, purchase_approval_decide: true,
                other_items_view: true, other_items_add: true, other_items_edit: true, other_items_delete: true, other_items_stock_in: true, other_items_release: true,
                reports_view: true, reports_stockopname_view: true, reports_stockopname_perform: true,
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
                greenbean_analysis_add: false, greenbean_analysis_edit: false,
                greenbean_outbound_view: false, greenbean_outbound_add: false, greenbean_outbound_edit: false, greenbean_outbound_delete: false,
                roasting_view: true, roasting_plan_add: false, roasting_plan_edit: false, roasting_plan_delete: false,
                // roasting_batch_approve extended to Roaster (TEST_BATCH_CARD_PLAN.md
                // §1/§4): gates both the Batch Log table's Approve button AND the new
                // Ready to Pack Test card's Approve/Approve & Combine buttons. This is
                // only the MOCK_DB seed used to first-populate custom_roles if the
                // table is ever empty (see CLAUDE.md "Full Supabase Mode") — it does
                // NOT retroactively change an already-populated production table.
                // Production also needs the manual step: Settings → Role Management →
                // Roaster → check "Approve Test Batch" → Save.
                roasting_batch_view: true, roasting_batch_add: true, roasting_batch_edit: false, roasting_batch_delete: false, roasting_batch_approve: true,
                blend_view: true, blend_add: false, blend_edit: false, blend_delete: false,
                production_potential_view: true,
                packing_view: false, packing_daily: false, packing_print_barcode: false, packing_manual_add: false, packing_order_view: false, packing_records_view: false, packing_unpack: false, packing_repack: false, packing_stock_release: false, packing_completed_view: false, packing_dispatch_checkout: false, packing_waste_control: false,
                sales_request_view: false, sales_request_view_own: false, sales_request_create: false, sales_request_edit: false, sales_request_delete: false, sales_request_print: false,
                dispatch_approval_view: false, dispatch_approval_approve: false, dispatch_approval_dispatch: false, dispatch_approval_print: false,
                customer_view: false, customer_add: false, customer_edit: false, customer_delete: false, customer_cat_retail: false, customer_cat_wholesale: false, customer_cat_supermarket: false,
                crm_manage: false,   // CRM_PAGE_PLAN.md §5.3 — halaman CRM management
                purchase_request_view: true, purchase_request_create: true, purchase_request_edit: true, purchase_request_delete: true, purchase_request_view_own: false, purchase_approval_view: false, purchase_approval_decide: false,
                other_items_view: false, other_items_add: false, other_items_edit: false, other_items_delete: false, other_items_stock_in: false, other_items_release: false,
                reports_view: false, reports_stockopname_view: false, reports_stockopname_perform: false,
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
                greenbean_analysis_add: false, greenbean_analysis_edit: false,
                greenbean_outbound_view: false, greenbean_outbound_add: false, greenbean_outbound_edit: false, greenbean_outbound_delete: false,
                roasting_view: false, roasting_plan_add: false, roasting_plan_edit: false, roasting_plan_delete: false,
                roasting_batch_view: false, roasting_batch_add: false, roasting_batch_edit: false, roasting_batch_delete: false, roasting_batch_approve: false,
                blend_view: false, blend_add: false, blend_edit: false, blend_delete: false,
                production_potential_view: false,
                packing_view: true, packing_daily: true, packing_print_barcode: true, packing_manual_add: true, packing_order_view: true, packing_records_view: true, packing_unpack: true, packing_repack: true, packing_stock_release: true, packing_completed_view: true, packing_dispatch_checkout: true, packing_waste_control: false,
                sales_request_view: true, sales_request_view_own: false, sales_request_create: false, sales_request_edit: false, sales_request_delete: false, sales_request_print: false,
                dispatch_approval_view: false, dispatch_approval_approve: false, dispatch_approval_dispatch: false, dispatch_approval_print: false,
                customer_view: false, customer_add: false, customer_edit: false, customer_delete: false, customer_cat_retail: false, customer_cat_wholesale: false, customer_cat_supermarket: false,
                crm_manage: false,   // CRM_PAGE_PLAN.md §5.3 — halaman CRM management
                purchase_request_view: true, purchase_request_create: true, purchase_request_edit: true, purchase_request_delete: true, purchase_request_view_own: false, purchase_approval_view: false, purchase_approval_decide: false,
                other_items_view: true, other_items_add: false, other_items_edit: false, other_items_delete: false, other_items_stock_in: false, other_items_release: false,
                reports_view: false, reports_stockopname_view: false, reports_stockopname_perform: false,
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
                greenbean_analysis_add: false, greenbean_analysis_edit: false,
                greenbean_outbound_view: false, greenbean_outbound_add: false, greenbean_outbound_edit: false, greenbean_outbound_delete: false,
                roasting_view: false, roasting_plan_add: false, roasting_plan_edit: false, roasting_plan_delete: false,
                roasting_batch_view: false, roasting_batch_add: false, roasting_batch_edit: false, roasting_batch_delete: false, roasting_batch_approve: false,
                blend_view: false, blend_add: false, blend_edit: false, blend_delete: false,
                production_potential_view: false,
                packing_view: false, packing_daily: false, packing_print_barcode: false, packing_manual_add: false, packing_order_view: false, packing_records_view: false, packing_unpack: false, packing_repack: false, packing_stock_release: false, packing_completed_view: false, packing_dispatch_checkout: false, packing_waste_control: false,
                sales_request_view: true, sales_request_view_own: false, sales_request_create: true, sales_request_edit: true, sales_request_delete: true, sales_request_print: true,
                dispatch_approval_view: false, dispatch_approval_approve: false, dispatch_approval_dispatch: false, dispatch_approval_print: false,
                customer_view: true, customer_add: true, customer_edit: true, customer_delete: false, customer_cat_retail: true, customer_cat_wholesale: true, customer_cat_supermarket: true,
                crm_manage: false,   // CRM_PAGE_PLAN.md §5.3 — halaman CRM management
                purchase_request_view: true, purchase_request_create: true, purchase_request_edit: true, purchase_request_delete: true, purchase_request_view_own: false, purchase_approval_view: false, purchase_approval_decide: false,
                other_items_view: true, other_items_add: false, other_items_edit: false, other_items_delete: false, other_items_stock_in: false, other_items_release: false,
                reports_view: true, reports_stockopname_view: true, reports_stockopname_perform: false,
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

const btnAddAnalysis = document.getElementById('btn-add-analysis');
if (btnAddAnalysis) {
    btnAddAnalysis.addEventListener('click', () => openAnalysisRecordModal());
    btnAddAnalysis.style.display = hasPermission('greenbean_analysis_add') ? '' : 'none';
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
    document.getElementById('sett-currency').value = companySettings.currency || 'SAR';
    
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
        document.getElementById('sett-packed-label-barcode-height').value = packedLayout.barcode_height_mm || 18;
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
    'sec-other-items': { title: 'Other Items', subtitle: 'Goods bought from outside and resold — they never pass through roasting or packing' },
    'sec-roasting': { title: 'Production', subtitle: 'Schedule roasting production runs, log batches, and manage plans' },
    'sec-packing': { title: 'Packaging & Retail Inventory', subtitle: 'Transfer bulk roasted beans to retail-size retail packaging' },
    'sec-users': { title: 'User Account Management', subtitle: 'Manage operator details, roles, and warehouse access rights' },
    'sec-settings': { title: 'System Settings', subtitle: 'Configure branding, printing layouts, and connection endpoints' },
    'sec-reports': { title: 'Reports', subtitle: '' },
    'sec-handover': { title: 'Handover', subtitle: '' },
    'sec-crm': { title: 'CRM', subtitle: 'Customer directory, reorder timing, and how the team is doing' },
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

// ==========================================================================
// WHAT'S NEW POPUP (WHATS_NEW_POPUP_PLAN.md)
// ==========================================================================
// One entry per release; newest first is not required (checkWhatsNewPopup
// only ever looks up WHATS_NEW_VERSION by value), but keeping newest-first
// makes this readable as a changelog on its own. Each item's `before`/
// `after`/`alt` are optional — a release note without a screenshot is
// still valid (F6 in the plan: "butir tanpa gambar tetap sah").
//
// Screenshots decision (2026-08-29, plan §5.1): light theme only, redamed
// with a neutral border so they still read cleanly on a dark-themed card.
const WHATS_NEW_VERSION = '2026-08-29';

const WHATS_NEW_RELEASES = [
    {
        version: '2026-08-29',
        date: '29-08-2026',
        items: [
            // Restructured 2026-08-31 per user request: one focused/zoomed
            // screenshot per concrete UI addition instead of one item with a
            // whole-modal before/after pair — each page below points at
            // exactly the element its caption describes. Captured the same
            // way as before (headless-Chrome/puppeteer-core against the live
            // local app, auth bypassed client-side for the screenshot only,
            // light theme), this time with elementHandle-scoped clips
            // (form-group / .so-panel) instead of full-page shots.
            {
                title: { en: 'Check stock before you commit to a quantity', ar: 'تحقق من المخزون قبل تحديد الكمية' },
                body: {
                    en: 'A new "Stock Check" button was added next to the Sales Agent Name field, to check packed coffee stock, green bean stock, and potential production before adding items to the order.',
                    ar: 'تمت إضافة زر جديد "فحص المخزون" بجانب حقل اسم مندوب المبيعات، للتحقق من مخزون القهوة المعبأة، والبن الأخضر، والإنتاج المحتمل قبل إضافة عناصر إلى الطلب.'
                },
                image: 'images/whatsnew/2026-08-29/stock-check-button.png',
                alt: {
                    en: 'The new Stock Check button next to Sales Agent Name',
                    ar: 'زر فحص المخزون الجديد بجانب اسم مندوب المبيعات'
                }
            },
            {
                title: { en: 'Every item you add shows up on the right', ar: 'كل عنصر تضيفه يظهر في الجانب الأيمن' },
                body: {
                    en: 'Items you\'ve added now appear as cards on the right side of the form. Click any card to edit it — no more scrolling through a long stack of repeated rows to find the one you want to change.',
                    ar: 'العناصر التي أضفتها تظهر الآن كبطاقات في الجانب الأيمن من النموذج. اضغط على أي بطاقة لتعديلها — لا حاجة بعد الآن للتمرير عبر صفوف متكررة طويلة للعثور على العنصر الذي تريد تغييره.'
                },
                image: 'images/whatsnew/2026-08-29/order-items-panel.png',
                alt: {
                    en: 'The Order Items panel on the right, showing an added item and a "click a card to edit it" hint',
                    ar: 'لوحة عناصر الطلب على اليمين، تعرض عنصراً مُضافاً وتلميحاً "اضغط على البطاقة للتعديل"'
                }
            },
            {
                title: { en: 'Add a new customer without leaving the form', ar: 'أضف عميلاً جديداً دون مغادرة النموذج' },
                body: {
                    en: 'The "Add New" button next to Customer is now colored so it stands out. You can add a brand new customer directly from this button — no need to leave the page to another menu.',
                    ar: 'أصبح زر "إضافة جديد" بجانب حقل العميل ملوّناً ليكون أكثر وضوحاً. يمكنك إضافة عميل جديد تماماً مباشرة من هذا الزر — دون الحاجة لمغادرة الصفحة إلى قائمة أخرى.'
                },
                image: 'images/whatsnew/2026-08-29/add-new-customer-button.png',
                alt: {
                    en: 'The purple "Add New" customer button next to the Customer dropdown',
                    ar: 'زر "إضافة جديد" الأرجواني بجانب قائمة العميل'
                }
            }
            // Other 2026-08-29 changes (Preparing card wrap fix, batch-date
            // smart default, customer Wholesale default) were built in the
            // same session but are intentionally left OUT of this release's
            // popup per user request 2026-08-31 — this update is scoped to
            // announcing the Sales Order modal redesign only. Their images
            // (images/whatsnew/2026-08-29/preparing-card-{before,after}.png)
            // and the original single-item before/after copy for the whole
            // modal (images/whatsnew/2026-08-29/sales-order-{before,after}.png)
            // are still sitting on disk / in git history if a future release
            // wants to surface them separately.
        ]
    }
];

// Re-show policy (user request 2026-08-31, replaces the earlier "1-hour
// snooze then never again" design entirely):
//   - Trigger is clicking "Submit Request" (js/sales.js btn-create-request),
//     not just navigating to the Item Request page.
//   - Checking "Don't show update notices again" stops it forever (unchanged).
//   - Otherwise, it re-shows on every Submit Request click, up to
//     WHATS_NEW_MAX_PER_DAY times per calendar day, resetting each new day.
//   - That daily-capped cycle only runs for WHATS_NEW_EXPIRE_MS from the
//     FIRST time this version's popup was ever shown — past that, it stops
//     appearing for good even without the checkbox.
const WHATS_NEW_STORAGE_KEYS = {
    optOut: 'whatsnew_opt_out',
    firstShownAt: 'whatsnew_first_shown_at',
    firstShownVersion: 'whatsnew_first_shown_version',
    dailyDate: 'whatsnew_daily_date',
    dailyVersion: 'whatsnew_daily_version',
    dailyCount: 'whatsnew_daily_count'
};
const WHATS_NEW_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week from first show
const WHATS_NEW_MAX_PER_DAY = 2;

function whatsNewIsOptedOut() {
    try { return localStorage.getItem(WHATS_NEW_STORAGE_KEYS.optOut) === '1'; }
    catch (e) { return false; }
}

function whatsNewSetOptOut(value) {
    try {
        if (value) localStorage.setItem(WHATS_NEW_STORAGE_KEYS.optOut, '1');
        else localStorage.removeItem(WHATS_NEW_STORAGE_KEYS.optOut);
    } catch (e) { /* localStorage unavailable — nothing to persist */ }
}

// Reads today's shown-count for `version` without writing anything —
// shared by whatsNewShouldShow (read-only check) and whatsNewRecordShown
// (read-then-increment), so the "does today's stored date/version match"
// logic can't drift between the two.
function whatsNewTodaysCount(version) {
    const todayStr = new Date().toISOString().split('T')[0];
    const dailyDate = localStorage.getItem(WHATS_NEW_STORAGE_KEYS.dailyDate);
    const dailyVersion = localStorage.getItem(WHATS_NEW_STORAGE_KEYS.dailyVersion);
    if (dailyDate !== todayStr || dailyVersion !== version) return 0;
    return parseInt(localStorage.getItem(WHATS_NEW_STORAGE_KEYS.dailyCount), 10) || 0;
}

function whatsNewShouldShow(version) {
    try {
        if (whatsNewIsOptedOut()) return false;

        // Hard 1-week expiry from the first time this version was ever
        // shown — firstShownAt is written once and never overwritten (see
        // whatsNewRecordShown), so this date can't get pushed forward by
        // later shows.
        if (localStorage.getItem(WHATS_NEW_STORAGE_KEYS.firstShownVersion) === version) {
            const firstShownAt = parseInt(localStorage.getItem(WHATS_NEW_STORAGE_KEYS.firstShownAt), 10) || 0;
            if (firstShownAt && (Date.now() - firstShownAt) >= WHATS_NEW_EXPIRE_MS) return false;
        }

        return whatsNewTodaysCount(version) < WHATS_NEW_MAX_PER_DAY;
    } catch (e) {
        // Fails closed, same spirit as checkStockFreezeBanner below — a
        // popup that can't reliably remember it was dismissed must not
        // reappear on every single click instead.
        return false;
    }
}

// Called once per ACTUAL display (checkWhatsNewPopup, never on a forceShow
// re-open from Settings — that shouldn't burn into the daily/weekly budget).
function whatsNewRecordShown(version) {
    try {
        if (localStorage.getItem(WHATS_NEW_STORAGE_KEYS.firstShownVersion) !== version) {
            localStorage.setItem(WHATS_NEW_STORAGE_KEYS.firstShownAt, String(Date.now()));
            localStorage.setItem(WHATS_NEW_STORAGE_KEYS.firstShownVersion, version);
        }
        // MUST read the pre-existing count before writing today's
        // date/version below — whatsNewTodaysCount decides "is the stored
        // count actually for today" by comparing against those same two
        // keys, so overwriting them first makes every count look like it's
        // already today's and the daily reset never happens (found live
        // 2026-08-31: count kept climbing past WHATS_NEW_MAX_PER_DAY forever
        // instead of resetting on a new day).
        const previousCount = whatsNewTodaysCount(version);
        const todayStr = new Date().toISOString().split('T')[0];
        localStorage.setItem(WHATS_NEW_STORAGE_KEYS.dailyDate, todayStr);
        localStorage.setItem(WHATS_NEW_STORAGE_KEYS.dailyVersion, version);
        localStorage.setItem(WHATS_NEW_STORAGE_KEYS.dailyCount, String(previousCount + 1));
    } catch (e) {}
}

async function checkWhatsNewPopup() {
    try {
        // The overlay element is created once and reused — hidden via class
        // toggle, never removed from the DOM (same lifecycle as
        // showWarningModal's container). So its mere existence doesn't mean
        // it's currently open; only the hidden class does.
        const existing = document.getElementById('whats-new-modal-container');
        if (existing && !existing.classList.contains('hidden')) return;
        const release = WHATS_NEW_RELEASES.find(r => r.version === WHATS_NEW_VERSION);
        if (!release || !release.items || release.items.length === 0) return;
        if (!whatsNewShouldShow(WHATS_NEW_VERSION)) return;
        whatsNewRecordShown(WHATS_NEW_VERSION);
        openWhatsNewModal(release);
    } catch (e) {
        console.error("Failed to check What's New popup:", e);
    }
}

// Renders as its OWN stacked overlay (z-index 2000, same pattern as
// showWarningModal/openAddCustomerShortcutModal) instead of through
// openModal() — openModal shares one #modal-container, so opening this on
// top of any other open modal would silently wipe it out.
//
// `forceShow` bypasses whatsNewShouldShow entirely — used by the Settings
// "Show What's New" button, which must work even after the release was
// already seen or opted out of.
function openWhatsNewModal(release, forceShow = false) {
    let container = document.getElementById('whats-new-modal-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'whats-new-modal-container';
        container.className = 'overlay';
        container.style.zIndex = '2000';
        document.body.appendChild(container);
    }

    let page = 0;
    const total = release.items.length;

    const lang = () => (window.currentLanguage === 'ar' ? 'ar' : 'en');
    const pick = (field) => field ? (field[lang()] || field.en || '') : '';

    function teardown() {
        document.removeEventListener('keydown', onKeyDown);
        container.classList.add('hidden');
        container.innerHTML = '';
    }

    // No snooze state to write anymore — whether this shows again is
    // governed entirely by the daily cap / 1-week expiry recorded at OPEN
    // time (whatsNewRecordShown in checkWhatsNewPopup), not at close time.
    // Dismissing mid-way (X / Escape / Skip) is just... closing.
    function closeAndDismiss() {
        teardown();
    }

    function closeAndFinish() {
        const cb = document.getElementById('whats-new-opt-out-checkbox');
        if (!forceShow && cb && cb.checked) whatsNewSetOptOut(true);
        teardown();
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') { e.preventDefault(); closeAndDismiss(); }
    }

    function render() {
        const item = release.items[page];
        const isLast = page === total - 1;
        const altText = pick(item.alt) || pick(item.title);

        const dots = release.items.map((_, i) => `
            <span style="width:${i === page ? '16px' : '6px'}; height:6px; border-radius:9999px; background:${i === page ? 'var(--primary)' : 'var(--border)'}; display:inline-block; transition: width 0.2s ease;"></span>
        `).join('');

        // width/height are placeholders for aspect-ratio, not the final
        // render size — actual sizing is CSS (width:100%; height:auto).
        // Kept anyway per plan §5.1 so a slow-loading image doesn't cause
        // layout jump while it's still fetching.
        const imageHtml = (item.before && item.after) ? `
            <div class="whats-new-image-pair" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:16px;">
                <div>
                    <div style="font-size:0.72rem; font-weight:700; color:var(--text-muted); margin-bottom:4px;">${window.t('whatsnew_before')}</div>
                    <img src="${item.before}" alt="${altText}" loading="lazy" width="360" height="220" style="width:100%; height:auto; max-width:100%; display:block; border:1px solid var(--border); border-radius:8px;">
                </div>
                <div>
                    <div style="font-size:0.72rem; font-weight:700; color:var(--primary); margin-bottom:4px;">${window.t('whatsnew_after')}</div>
                    <img src="${item.after}" alt="${altText}" loading="lazy" width="360" height="220" style="width:100%; height:auto; max-width:100%; display:block; border:1px solid var(--primary); border-radius:8px;">
                </div>
            </div>
        ` : (item.image ? `
            <div class="whats-new-image-single" style="margin-top:16px;">
                <img src="${item.image}" alt="${altText}" loading="lazy" width="480" height="260" style="width:100%; height:auto; max-width:100%; display:block; border:1px solid var(--border); border-radius:8px;">
            </div>
        ` : '');

        const checkboxHtml = isLast ? `
            <div style="padding-top:14px; border-top:1px solid var(--border); margin-top:16px;">
                <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer;">
                    <input type="checkbox" id="whats-new-opt-out-checkbox" style="width:15px; height:15px; margin:2px 0 0;">
                    <span>
                        <span style="font-size:0.8rem;">${window.t('whatsnew_optout_label')}</span>
                        <span style="display:block; font-size:0.7rem; color:var(--text-muted); margin-top:2px; line-height:1.4;">${window.t('whatsnew_optout_hint')}</span>
                    </span>
                </label>
            </div>
        ` : '';

        container.innerHTML = `
            <div class="overlay-card" style="max-width:760px; width:92vw; max-height:85vh; padding:0; gap:0; display:flex; flex-direction:column; overflow:hidden;">
                <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--border); flex-shrink:0;">
                    <div style="display:flex; align-items:baseline; gap:8px;">
                        <h3 style="margin:0; font-size:1.05rem; font-weight:700;">${window.t('whatsnew_title')}</h3>
                        <span style="font-size:0.75rem; color:var(--text-muted);">${release.date}</span>
                    </div>
                    <button type="button" id="whats-new-btn-close" style="background:transparent; border:0; cursor:pointer; color:var(--text-muted); font-size:1.4rem; line-height:1; padding:0;">&times;</button>
                </div>
                <div style="padding:18px 20px; overflow-y:auto; flex:1;">
                    <div style="font-size:1rem; font-weight:700; margin-bottom:6px;">${pick(item.title)}</div>
                    <div style="font-size:0.85rem; color:var(--text-secondary); line-height:1.55;">${pick(item.body)}</div>
                    ${imageHtml}
                    ${checkboxHtml}
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-top:1px solid var(--border); flex-shrink:0;">
                    <div style="display:flex; gap:6px; align-items:center;">${dots}</div>
                    <div style="display:flex; gap:8px;">
                        ${page > 0 ? `<button type="button" id="whats-new-btn-back" class="btn btn-secondary">${window.t('whatsnew_back')}</button>` : ''}
                        ${!isLast ? `<button type="button" id="whats-new-btn-skip" class="btn btn-secondary">${window.t('whatsnew_skip')}</button>` : ''}
                        <button type="button" id="whats-new-btn-next" class="btn btn-primary">${isLast ? window.t('whatsnew_done') : window.t('whatsnew_next')}</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('whats-new-btn-close').addEventListener('click', closeAndDismiss);
        const backBtn = document.getElementById('whats-new-btn-back');
        if (backBtn) backBtn.addEventListener('click', () => { page -= 1; render(); });
        const skipBtn = document.getElementById('whats-new-btn-skip');
        if (skipBtn) skipBtn.addEventListener('click', closeAndDismiss);
        document.getElementById('whats-new-btn-next').addEventListener('click', () => {
            if (isLast) { closeAndFinish(); }
            else { page += 1; render(); }
        });
    }

    render();
    container.classList.remove('hidden');
    document.addEventListener('keydown', onKeyDown);
}

// Settings > What's New card (plan §7 / Fase 3): reversible opt-out and a
// way to see the popup again on demand. Without this, the opt-out
// checkbox in the popup itself would be a one-way door.
function initWhatsNewSettingsCard() {
    const checkbox = document.getElementById('sett-whatsnew-optout');
    if (checkbox) {
        checkbox.checked = whatsNewIsOptedOut();
        checkbox.onchange = () => whatsNewSetOptOut(checkbox.checked);
    }
    const showBtn = document.getElementById('btn-open-whats-new');
    if (showBtn) {
        showBtn.onclick = () => {
            const release = WHATS_NEW_RELEASES.find(r => r.version === WHATS_NEW_VERSION);
            if (release) openWhatsNewModal(release, true);
        };
    }
}

// Stock Opname Phase 2: soft UX layer only — the database trigger
// (stock_take_freeze_guard) already rejects writes regardless of whether
// this banner is shown or a request never fires. Checked from navigateTo()
// below (fire-and-forget, doesn't block navigation) so every page shows it
// without needing a per-section integration; bootstrap() always ends by
// calling navigateTo() too, so this also covers the very first page load.
async function checkStockFreezeBanner() {
    const banner = document.getElementById('stock-freeze-banner');
    if (!banner) return;
    try {
        const { data: takes } = await fetchData('stock_takes');
        const open = (takes || []).find(t => t.status === 'counting' || t.status === 'posting');
        if (!open) {
            banner.classList.add('hidden');
            return;
        }
        const textEl = document.getElementById('stock-freeze-banner-text');
        if (textEl) {
            const template = window.t
                ? (window.t('stockopname_banner_text') || 'Stock opname in progress (started {date} by {user}) — stock changes are locked until it is finalized or cancelled.')
                : 'Stock opname in progress (started {date} by {user}) — stock changes are locked until it is finalized or cancelled.';
            const dateStr = open.started_at ? open.started_at.split('T')[0] : (open.take_date || '');
            textEl.textContent = template.replace('{date}', dateStr).replace('{user}', open.started_by || open.performed_by || '-');
        }
        banner.classList.remove('hidden');
    } catch (e) {
        console.error('Failed to check stock opname freeze status:', e);
    }
}

function navigateTo(sectionId) {
    closeMobileSidebar();
    checkStockFreezeBanner();

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
    const inventorySections = ['sec-greenbean', 'sec-bulk-roasted', 'sec-packed-coffee', 'sec-other-items'];
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

// --- SUB-TABS MANAGEMENT FOR PURCHASE REQUEST (PURCHASE_REQUEST_PLAN.md) ---
const purchasingTabBtns = document.querySelectorAll('#sec-purchasing .tab-btn');
const purchasingTabContents = document.querySelectorAll('#sec-purchasing .tab-content');

purchasingTabBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const targetTab = btn.getAttribute('data-tab');

        purchasingTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        purchasingTabContents.forEach(content => {
            if (content.id === targetTab) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });

        saveLastTab('sec-purchasing', targetTab);
        await loadPurchasingTabSpecificData(targetTab);
    });
});

// --- SUB-TABS MANAGEMENT FOR CRM (CRM_PAGE_PLAN.md §7) ---
const crmTabBtns = document.querySelectorAll('#sec-crm .tab-btn');
const crmTabContents = document.querySelectorAll('#sec-crm .tab-content');

crmTabBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const targetTab = btn.getAttribute('data-tab');

        crmTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        crmTabContents.forEach(content => {
            content.classList.toggle('hidden', content.id !== targetTab);
        });

        saveLastTab('sec-crm', targetTab);
        await loadCrmMainTab(targetTab);
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

// --- SUB-TABS MANAGEMENT FOR CUSTOMERS (Directory | CRM Insights) ---
// Wiring tab #sec-customers dihapus 2026-09-27: halamannya dilebur ke CRM.

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
        case 'sec-other-items':
            await loadOtherItemsSection();
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
            // What's New used to fire here (just landing on the page) —
            // moved to the "Submit Request" button's own click handler in
            // js/sales.js per user request 2026-08-31, so it triggers on
            // that specific action instead of every visit to this section.
            break;
        case 'sec-crm':
            await loadCrmSectionEntry();
            break;
        case 'sec-purchasing':
            const activePurchasingTabBtn = document.querySelector('#sec-purchasing .tab-btn.active');
            if (activePurchasingTabBtn) {
                await loadPurchasingTabSpecificData(activePurchasingTabBtn.getAttribute('data-tab'));
            } else {
                await loadPurchasingSection();
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
        'tab-code-definitions': 'blend_view',
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
        // Purchase Request tabs (PURCHASE_REQUEST_PLAN.md §3.6 — the whole
        // point of this entry: a role without purchase_approval_view never
        // even sees the Approval tab button, same mechanism as the Handover
        // entry right above).
        'tab-purchase-approval': 'purchase_approval_view',
        // Settings tabs
        'tab-sett-general': 'settings_general',
        'tab-sett-production': 'settings_production',
        'tab-sett-system': 'settings_system',
        // Reports tabs
        'tab-rep-stockopname': 'reports_stockopname_view',
        // CRM: satu tab satu izin. Tanpa crm_manage, user hanya melihat tab
        // Customer — direktori yang dulu berdiri sendiri di sidebar.
        'tab-crm-customer': 'customer_view',
        'tab-crm-performance': 'crm_manage',
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
    const btnAddAnalysisEl = document.getElementById('btn-add-analysis');
    if (btnAddAnalysisEl) {
        btnAddAnalysisEl.style.display = hasPermission('greenbean_analysis_add') ? '' : 'none';
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

    // --- PURCHASE REQUEST BUTTON (PURCHASE_REQUEST_PLAN.md) ---
    // Per-row Edit/Cancel buttons are gated at render time in
    // js/purchasing.js itself (ownership + status + permission all factor
    // in), same as this file's own pattern below for .btn-edit-order — only
    // this static "New Request" button needs the sweep here.
    const btnCreatePR = document.getElementById('btn-create-purchase-request');
    if (btnCreatePR) btnCreatePR.style.display = hasPermission('purchase_request_create') ? '' : 'none';
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
    const custSection = document.getElementById('tab-crm-customer');
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
        case 'tab-gb-analysis':
            await loadGreenCoffeeAnalysisSection();
            break;
    }
    enforceGranularPermissions();
}



async function loadSettingTabSpecificData(tabId) {
    switch (tabId) {
        case 'tab-sett-general':
            await loadCompanySettings();
            initWhatsNewSettingsCard();
            break;
        case 'tab-sett-production':
            await loadMachinesSection();
            await loadPackagingSizesTable();
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
    // 1. Load everything this render needs in one go. These 8 tables were
    // previously fetched as one Promise.all here plus 4 more one-at-a-time
    // awaits further down the function — none of the 4 later ones depend on
    // anything except greenbeans/batches/orders from this same batch, so
    // splitting them into separate round-trips just serialized independent
    // reads for no reason. Folding them into one Promise.all turns ~5
    // sequential round-trips into 1.
    const [
        { data: greenbeans },
        { data: batches },
        { data: packed },
        { data: orders },
        { data: intakes },
        { data: recipes },
        { data: orderItems },
        { data: plans }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('roast_batches'),
        fetchData('packed_coffee'),
        fetchData('request_orders'),
        fetchData('green_coffee_intake'),
        fetchData('blend_recipes'),
        fetchData('request_order_items'),
        fetchData('roasting_plans')
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
                // `recipes` was already fetched once above for the MTD roasting
                // group — this used to re-fetch the whole blend_recipes table
                // from Supabase on every iteration of this loop (once per
                // blend plan shown today), the same table, for data that
                // never changes within this render.
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
    const roastingBadges = [document.getElementById('badge-nav-roasting'), document.getElementById('badge-tab-roast-plans')];
    // PURCHASE_REQUEST_PLAN.md mockup layer 4 ("Approval <3>"). Gated on
    // purchase_approval_decide (the DECIDE permission), same reasoning as
    // dispatch's badge above being gated on dispatch_approval_approve rather
    // than the weaker _view key — a badge that tells someone "N things need
    // YOUR decision" shouldn't show for a role that can only look.
    const purchaseApprovalBadges = [document.getElementById('badge-nav-purchasing'), document.getElementById('badge-tab-purchase-approval')];

    const canApprove = hasPermission('dispatch_approval_approve');
    const canAddRoasting = hasPermission('roasting_batch_add');
    const canDecidePurchase = hasPermission('purchase_approval_decide');

    // These 3 fetches don't depend on each other — they used to run as 3
    // sequential awaits (each its own network round-trip) even though this
    // function is called after essentially every mutation across the app via
    // scheduleDashboardRefresh(). Only fetch what the current role can
    // actually see a badge for, and fetch those in parallel.
    const [ordersRes, plansRes, prsRes] = await Promise.all([
        canApprove ? fetchData('request_orders') : Promise.resolve({ data: null }),
        canAddRoasting ? fetchData('roasting_plans') : Promise.resolve({ data: null }),
        canDecidePurchase ? fetchData('purchase_requests') : Promise.resolve({ data: null })
    ]);

    if (canApprove) {
        const pendingApprovalCount = (ordersRes.data || []).filter(o => o.status === 'Pending Approval').length;
        paint(approvalBadges, pendingApprovalCount);
    } else {
        paint(approvalBadges, 0);
    }

    if (canAddRoasting) {
        const pendingPlanCount = (plansRes.data || []).filter(p => p.status !== 'Completed').length;
        paint(roastingBadges, pendingPlanCount);
    } else {
        paint(roastingBadges, 0);
    }

    if (canDecidePurchase) {
        const pendingPrCount = (prsRes.data || []).filter(p => p.status === 'Requested').length;
        paint(purchaseApprovalBadges, pendingPrCount);
    } else {
        paint(purchaseApprovalBadges, 0);
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
// `type` ('warning' | 'success') swaps the icon/color/default title so a
// genuine success confirmation (e.g. "Packing saved successfully.") doesn't
// show the same red warning triangle as an actual error or validation
// message — both used to share this one dialog with no visual distinction.
// `title` stays null by default (rather than a fixed string) so it can
// fall back to the correct translated default for whichever `type` was
// requested, instead of always defaulting to "Warning".
// `cancelText` (optional) relabels the Cancel button of a confirm dialog —
// e.g. "Edit" when backing out means going back to fix an entry. Omitted, it
// stays the translated "Cancel", so every existing caller is unaffected.
function showWarningModal(message, isConfirm = true, title = null, confirmText = null, type = 'warning', cancelText = null) {
    return new Promise((resolve) => {
        let resolved = false;
        const isSuccess = type === 'success';

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

        // Icon + color follow `type`, independent of the title text.
        const iconEl = document.getElementById('warn-dialog-icon');
        if (iconEl) {
            iconEl.textContent = isSuccess ? '✅' : '⚠️';
            iconEl.style.color = isSuccess ? 'var(--success)' : 'var(--danger)';
        }

        // Set title
        const titleEl = document.getElementById('warn-dialog-title');
        if (titleEl) {
            const defaultTitle = isSuccess ? 'Success' : 'Warning';
            const defaultKey = isSuccess ? 'success_header' : 'warn_header';
            titleEl.textContent = (!title && window.t) ? (window.t(defaultKey) || defaultTitle) : (title || defaultTitle);
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
            cancelBtn.textContent = cancelText || (window.t ? window.t('btn_cancel') : 'Cancel');
            cancelBtn.addEventListener('click', function() { finish(false); });
            buttonsDiv.appendChild(cancelBtn);
        }

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = isSuccess ? 'btn btn-primary' : 'btn btn-danger';
        okBtn.style.cssText = isSuccess
            ? 'min-width: 100px; background: var(--success); color: #fff;'
            : 'min-width: 100px; background: var(--danger); color: #fff;';
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
    clearDailyLoginDate();
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

// Registry for the handful of tables that paginate client-side (Roasting
// Batch Logs, Dispatch Request, Dispatch Approval — see registration calls
// in roasting.js/sales.js). Every OTHER filterable table renders its full
// dataset into the DOM at once, so the plain show/hide branch below already
// sees everything; these three used to slice their data to just the current
// page BEFORE building any HTML, which meant the filter dropdown only ever
// listed values from whatever page happened to be open, and a match outside
// that page simply had no row to show at all (found 2026-07-29). Fixed by
// having these tables render every row unconditionally and register here so
// applyFiltersForTable can filter the full set FIRST, then paginate the
// filtered result — pagination becomes a view over "what currently matches",
// not over "everything, independent of the filter".
const PAGINATED_FILTER_TABLES = {};

// Registry for a table's free-text search box (id of the <input>), keyed by
// tableId same as PAGINATED_FILTER_TABLES — lets applyFiltersForTable (any
// table, not just this one) fold a substring match over the whole row's
// text into the same pass as the column checkbox filters, instead of a
// separate search mechanism that would fight pagination/filter state.
const SEARCH_INPUT_FOR_TABLE = {};

function registerSearchInput(tableId, inputId) {
    SEARCH_INPUT_FOR_TABLE[tableId] = inputId;
}

function registerPaginatedFilterTable(tableId, config) {
    // config: { getPage, setPage, getPageSize, paginationContainerId, infoElId }
    PAGINATED_FILTER_TABLES[tableId] = config;
}

// Renders the "Show X-Y of Z" text and prev/numbered/next buttons for a
// registered table, using totalItems = the FILTERED count (not the raw
// dataset size) — returns the (possibly clamped) current page so the caller
// knows exactly which slice to reveal. Button clicks just re-run
// applyFiltersForTable on the already-rendered rows instead of re-fetching,
// since every row already exists in the DOM.
function renderPaginationControls(tableId, totalItems) {
    const cfg = PAGINATED_FILTER_TABLES[tableId];
    if (!cfg) return 1;
    const pageSize = cfg.getPageSize();
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    let currentPage = cfg.getPage();
    if (currentPage > totalPages) { currentPage = totalPages; cfg.setPage(currentPage); }
    if (currentPage < 1) { currentPage = 1; cfg.setPage(currentPage); }

    if (cfg.infoElId) {
        const infoEl = document.getElementById(cfg.infoElId);
        if (infoEl) {
            const startVal = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
            const endVal = Math.min(currentPage * pageSize, totalItems);
            const template = window.t ? window.t('pagination_info') : 'Show {start} - {end} of {total}';
            infoEl.textContent = template.replace('{start}', startVal).replace('{end}', endVal).replace('{total}', totalItems);
        }
    }

    const container = cfg.paginationContainerId ? document.getElementById(cfg.paginationContainerId) : null;
    if (container) {
        container.innerHTML = '';
        if (totalPages > 1) {
            const rerun = () => applyFiltersForTable(document.querySelector(`#${tableId} table`));

            const prevBtn = document.createElement('button');
            prevBtn.className = `pagination-btn ${currentPage === 1 ? 'disabled' : ''}`;
            prevBtn.innerHTML = `&lt;`;
            prevBtn.addEventListener('click', () => {
                if (cfg.getPage() > 1) { cfg.setPage(cfg.getPage() - 1); rerun(); }
            });
            container.appendChild(prevBtn);

            for (let i = 1; i <= totalPages; i++) {
                const pageBtn = document.createElement('button');
                pageBtn.className = `pagination-btn ${currentPage === i ? 'active' : ''}`;
                pageBtn.textContent = i;
                pageBtn.addEventListener('click', () => { cfg.setPage(i); rerun(); });
                container.appendChild(pageBtn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.className = `pagination-btn ${currentPage === totalPages ? 'disabled' : ''}`;
            nextBtn.innerHTML = `&gt;`;
            nextBtn.addEventListener('click', () => {
                if (cfg.getPage() < totalPages) { cfg.setPage(cfg.getPage() + 1); rerun(); }
            });
            container.appendChild(nextBtn);
        }
    }
    return currentPage;
}

// --- COLUMN-SPECIFIC MULTI-SELECT CHECKBOX FILTERS ---
function applyFiltersForTable(table) {
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const allRows = Array.from(tbody.querySelectorAll('tr'));

    const ths = table.querySelectorAll('.filterable-th');
    const tabContent = table.closest('.tab-content') || table.closest('.packing-tab-content');
    if (!tabContent) return;
    const tableId = tabContent.id;

    // Skip warning/"no items" placeholder rows from both filtering and pagination math.
    const dataRows = allRows.filter(row => !(row.cells.length <= 1 && row.querySelector('td[colspan]')));

    const searchInputId = SEARCH_INPUT_FOR_TABLE[tableId];
    const searchInput = searchInputId ? document.getElementById(searchInputId) : null;
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    const rowMatches = (row) => {
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
        // Free-text search (if this table has one registered): substring
        // match against the row's full visible text, so one box searches
        // batch code, coffee name, machine, date, etc. at once instead of
        // needing a separate input per column.
        if (matches && searchTerm && !row.textContent.toLowerCase().includes(searchTerm)) {
            matches = false;
        }
        return matches;
    };

    const pagCfg = PAGINATED_FILTER_TABLES[tableId];
    if (pagCfg) {
        const matchingRows = dataRows.filter(rowMatches);
        const currentPage = renderPaginationControls(tableId, matchingRows.length);
        const pageSize = pagCfg.getPageSize();
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, matchingRows.length);
        const visibleSet = new Set(matchingRows.slice(startIndex, endIndex));
        dataRows.forEach(row => { row.style.display = visibleSet.has(row) ? '' : 'none'; });
    } else {
        dataRows.forEach(row => { row.style.display = rowMatches(row) ? '' : 'none'; });
    }

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
let agentReportChart = null;
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
        'rep-customer-type-chart': customerTypeChart,
        'rep-agents-chart': agentReportChart
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
        case 'tab-rep-agents':
            await loadAgentLeaderboardReport(startVal, endVal);
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
    // Layered with CUSTOMER_CATEGORY_ROLE_PLAN.md Fase 5 (Grup C): a role
    // also loses orders outside its allowed customer categories here.
    const ownVisibleOrders = filterOrdersByCustomerCategory(filterOwnOrders(orders));

    // Only count orders that actually shipped — mirrors Sales Dispatch report's
    // definition of "volume" (Pending/Cancelled orders never left the warehouse).
    const filteredOrders = ownVisibleOrders.filter(o => (o.status === 'Dispatched' || o.status === 'Completed') && inDateRange(o));

    // All orders in range regardless of status — used for the status-breakdown table below.
    const allOrdersInRange = ownVisibleOrders.filter(inDateRange);

    // stats[customerId] = { orderCount, bags, kg, ... } — shared helper, js/db.js
    const stats = computeOrderStatsByKey(filteredOrders, orderItems, { groupByFn: o => o.customer_id || null });

    // Still needed below by the Coffee Preference by Customer section, which
    // groups order ITEMS by customer independently of computeOrderStatsByKey.
    const orderIdToCustomerId = {};
    filteredOrders.forEach(o => { if (o.customer_id) orderIdToCustomerId[o.id] = o.customer_id; });

    const rows = Object.keys(stats).map(customerId => {
        const customer = (customers || []).find(c => c.id === parseInt(customerId));
        return {
            name: customer ? customer.name : 'Unknown',
            code: customer ? customer.customer_id : '-',
            type: customer ? customer.type : '-',
            orders: stats[customerId].orderCount,
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

// Sales Agent Leaderboard — mirrors loadCustomerReport's structure exactly,
// grouping by sales_name instead of customer_id. sales_name is free text but
// in practice always auto-filled from currentUser.name at order creation
// (js/sales.js, readonly #m-req-sales input), not a true FK to sales_agents,
// so it's really "which staff member created this order" — acceptable here
// since it's system-set, not freely typed, but two accounts with the same
// display name in different casing would still be counted separately.
async function loadAgentLeaderboardReport(startDate, endDate) {
    const [{ data: orders }, { data: orderItems }] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items')
    ]);

    const visibleOrders = filterOrdersByCustomerCategory(filterOwnOrders(orders));

    const stats = computeOrderStatsByKey(visibleOrders, orderItems, {
        groupByFn: o => (o.sales_name || '').trim() || 'Unknown',
        startDate, endDate
    });

    const rows = Object.keys(stats).map(name => ({
        name,
        orders: stats[name].orderCount,
        bags: stats[name].bags,
        kg: stats[name].kg
    })).sort((a, b) => b.kg - a.kg);

    const tbody = document.getElementById('rep-agents-table-body');
    if (tbody) {
        tbody.innerHTML = '';
        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="table-empty-state">No dispatched orders in selected period</td></tr>`;
        } else {
            rows.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${r.name}</strong></td>
                    <td class="text-center">${r.orders}</td>
                    <td class="text-center">${r.bags}</td>
                    <td style="text-align:center; font-weight:700;">${r.kg.toFixed(1)}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    const topRows = rows.slice(0, 10);
    const ctx = document.getElementById('rep-agents-chart');
    if (ctx) {
        if (agentReportChart) agentReportChart.destroy();
        agentReportChart = new Chart(ctx, {
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

    const exportBtn = document.getElementById('btn-export-agent-report');
    if (exportBtn) {
        exportBtn.addEventListener('click', (e) => { e.stopPropagation();
            const exportData = rows.map(r => ({
                'Agent Name': r.name,
                'Total Orders': r.orders,
                'Total Bags': r.bags,
                'Total (kg)': r.kg.toFixed(1)
            }));
            exportToExcel(exportData, 'Sales_Agent_Leaderboard');
        });
    }
}

// ============================================================
// STOCK OPNAME (physical stock count / reconciliation)
// ============================================================

// Holds the groups being counted during an in-progress stock take so
// finalizeStockTake() can adjust the underlying source rows. Each group
// carries an added .itemId (its stock_take_items row), .actualQty and
// .counted once a stock take is active (Stock Opname Phase 1) — these are
// NOT present on the plain objects buildStockTakeGroups() returns.
let currentStockTakeGroups = null;
// The stock_takes.id currently in 'counting' status, or null. Set by
// startStockTake()/resumeStockTake(), cleared by cancel/finalize.
let currentStockTakeId = null;
// { date, by } when the current sheet was resumed from an already-open
// take (rather than freshly started this session) — shown in the progress
// note so a returning counter knows they're picking up someone else's work.
let stockTakeResumeInfo = null;
// Typed-but-unsaved Actual values, keyed by stock_take_items id -> raw input
// string (user decision 2026-09-22: counts are saved with one explicit
// "Save Counts" click, not per row on blur — the per-row save flashed the
// Saving pill once per row and swallowed failures into the console). Kept
// outside currentStockTakeGroups so a sheet re-render (lot detail, found
// item) or an in-page resume never drops what was typed.
let stockTakeDrafts = new Map();
let stockTakeSaveInFlight = false;
// Which section tab of the count sheet is showing ('greenbean', 'bulk' or
// 'packed|<machine name>'). Only hides rows — save/finalize always cover
// every row of the take.
let stockTakeActiveSection = null;
// Fase 4: packed_coffee_lots + production_lots, fetched once per open take
// and reused by every lot-detail screen (print Tahap 2, the detail modal,
// the bottom bar's lot count) instead of refetching per group. Safe to
// cache for the whole take because Fase 2's freeze trigger blocks writes to
// these tables for as long as the take stays 'counting'/'posting'. Reset
// whenever a take opens or ends so a later take starts with fresh data.
let _stockOpnamePackedLotsCache = null;
async function getStockOpnamePackedLotsCache() {
    if (!_stockOpnamePackedLotsCache) {
        const [{ data: lots }, { data: productionLots }] = await Promise.all([
            fetchData('packed_coffee_lots'), fetchData('production_lots')
        ]);
        _stockOpnamePackedLotsCache = { lots: lots || [], productionLots: productionLots || [] };
    }
    return _stockOpnamePackedLotsCache;
}

// Stock Opname Fase 3: same identity resolution as the old
// resolvePackedCoffeeName (name-resolution logic kept byte-for-byte
// identical so grouping doesn't silently change), extended to also return
// the coffee's short `code` (green_coffee.code / blend_recipes.code) for
// the sheet's Kode column (STOCK_OPNAME_PLAN.md §4.1/§4.2). This is the
// only caller of the old function, so it's replaced rather than kept
// alongside it.
function resolvePackedCoffeeIdentity(item, batches, greenbeans, recipes) {
    let name = item.custom_coffee_name || 'Roasted Coffee';
    let code = '';
    if (item.roast_batch_id) {
        const b = (batches || []).find(x => x.id === item.roast_batch_id);
        if (b) {
            if (b.coffee_type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === b.single_coffee_id);
                if (gb) { name = gb.name; code = gb.code || ''; }
            } else {
                const r = (recipes || []).find(rec => rec.id === b.blend_recipe_id);
                if (r) { name = r.name; code = r.code || ''; }
            }
        }
    } else if (item.single_coffee_id) {
        const gb = (greenbeans || []).find(g => g.id === item.single_coffee_id);
        if (gb) { name = gb.name; code = gb.code || ''; }
    } else if (item.blend_recipe_id) {
        const r = (recipes || []).find(rec => rec.id === item.blend_recipe_id);
        if (r) { name = r.name; code = r.code || ''; }
    }
    name = name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
    if (!code) {
        // Manual/custom packing with no linked identity at all — same
        // name-matching fallback js/packing.js's own
        // resolvePackedCoffeeIdentity uses, so a hand-typed entry still
        // gets a code once its name happens to match a real coffee/recipe.
        const gbMatch = (greenbeans || []).find(g => g.name === name);
        if (gbMatch) code = gbMatch.code || '';
        else {
            const rMatch = (recipes || []).find(r => r.name === name);
            if (rMatch) code = rMatch.code || '';
        }
    }
    return { name, code };
}

// Bulk rows carry single_coffee_id/blend_recipe_id/custom_coffee_code
// directly (no roast_batch indirection) — see bulk_roasted_coffee schema.
function resolveBulkCoffeeCode(row, greenbeans, recipes) {
    if (row.custom_coffee_code) return row.custom_coffee_code;
    if (row.single_coffee_id) {
        const gb = (greenbeans || []).find(g => g.id === row.single_coffee_id);
        if (gb && gb.code) return gb.code;
    }
    if (row.blend_recipe_id) {
        const r = (recipes || []).find(rec => rec.id === row.blend_recipe_id);
        if (r && r.code) return r.code;
    }
    const gbMatch = (greenbeans || []).find(g => g.name === row.coffee_name);
    if (gbMatch && gbMatch.code) return gbMatch.code;
    const rMatch = (recipes || []).find(r => r.name === row.coffee_name);
    return rMatch ? (rMatch.code || '') : '';
}

// Build the list of countable units. Green bean is one row per coffee; bulk and
// packed are aggregated to what a human physically counts (per coffee, per
// coffee+size) so a single actual count can map onto several system rows.
// `onlyCategory` (added for per-category Stock Opname, user request
// 2026-08-31) restricts the result to one of 'greenbean'/'bulk'/'packed' —
// left null this still returns everything, which resumeStockTake() relies
// on (it matches saved stock_take_items back to groups by (category, label)
// key, so handing it every category's groups even for a single-category
// take is harmless — items from other categories just never match anything).
async function buildStockTakeGroups(onlyCategory = null) {
    const [
        { data: greenbeans },
        { data: bulk },
        { data: packed },
        { data: batches },
        { data: recipes },
        { data: machines }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('bulk_roasted_coffee'),
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('blend_recipes'),
        fetchData('machines')
    ]);

    const groups = [];

    // Green bean — one countable unit per coffee (always shown).
    (greenbeans || []).forEach(g => {
        groups.push({
            category: 'greenbean',
            label: g.name || `Green #${g.id}`,
            coffeeCode: g.code || '',
            unit: 'kg',
            field: 'stock_kg',
            systemQty: parseFloat(g.stock_kg) || 0,
            rows: [{ table: 'green_coffee', rec: g }]
        });
    });

    // Bulk roasted — aggregate by coffee_name across machine rows (bulk has
    // no per-machine physical separation the way packed does — it's all
    // loose beans in one holding area regardless of which machine roasted it).
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
            coffeeCode: resolveBulkCoffeeCode(rows[0], greenbeans, recipes),
            unit: 'kg',
            field: 'bulk_available',
            systemQty,
            rows: rows.map(r => ({ table: 'bulk_roasted_coffee', rec: r }))
        });
    });

    // Packed coffee — aggregate by coffee name + bag size + machine (cacat
    // #5 fix: a team physically counts one machine's shelf at a time, so a
    // group spanning several machines couldn't be reconciled against what's
    // in front of them). machine_id is a direct packed_coffee column, so no
    // batch indirection is needed for the grouping key itself.
    const packedByKey = {};
    (packed || []).forEach(p => {
        const { name, code } = resolvePackedCoffeeIdentity(p, batches, greenbeans, recipes);
        const size = parseInt(p.bag_size_g) || 0;
        const machineId = p.machine_id || null;
        const key = `${name}|${size}|${machineId}`;
        if (!packedByKey[key]) packedByKey[key] = { name, code, size, machineId, rows: [] };
        packedByKey[key].rows.push(p);
    });
    Object.values(packedByKey).forEach(grp => {
        const systemQty = grp.rows.reduce((s, r) => s + (parseInt(r.quantity) || 0), 0);
        if (systemQty <= 0) return;
        const sizeLabel = grp.size >= 1000 ? `${grp.size / 1000}kg` : `${grp.size}g`;
        const machine = grp.machineId ? (machines || []).find(m => m.id === grp.machineId) : null;
        const machineName = machine ? machine.name : (window.t ? (window.t('stockopname_unknown_machine') || 'Unknown machine') : 'Unknown machine');
        groups.push({
            category: 'packed',
            label: `${grp.name} · ${sizeLabel} · ${machineName}`,
            coffeeCode: grp.code,
            machineName,
            bagSizeG: grp.size,
            unit: 'bags',
            field: 'quantity',
            systemQty,
            rows: grp.rows.map(r => ({ table: 'packed_coffee', rec: r }))
        });
    });

    return onlyCategory ? groups.filter(g => g.category === onlyCategory) : groups;
}

// One row order for the count sheet AND the printed Stock Count Form (user
// request 2026-10-01): green bean by code; bulk as built; packed by machine,
// then code, name, size. Rows without a code go last; found items (added
// during the count) go last within their machine.
const STOCK_CATEGORY_ORDER = { greenbean: 0, bulk: 1, packed: 2 };
function stockGroupMachine(g) {
    if (g.category !== 'packed') return null;
    if (g.machineName) return g.machineName;
    // Found/stale rows rebuilt from a saved item: the label ends in the machine.
    const parts = String(g.label || '').split(' · ');
    return parts.length > 1 ? parts[parts.length - 1] : '-';
}
function stockGroupSection(g) {
    return g.category === 'packed' ? `packed|${stockGroupMachine(g)}` : g.category;
}
function compareStockGroupsByCode(a, b) {
    return (!a.coffeeCode - !b.coffeeCode)
        || String(a.coffeeCode || '').localeCompare(String(b.coffeeCode || ''), undefined, { numeric: true })
        || String(a.label || '').localeCompare(String(b.label || ''))
        || (a.bagSizeG || 0) - (b.bagSizeG || 0);
}
function sortStockTakeGroups(groups) {
    return (groups || []).map((g, i) => ({ g, i })).sort((x, y) => {
        const a = x.g, b = y.g;
        const cat = (STOCK_CATEGORY_ORDER[a.category] ?? 9) - (STOCK_CATEGORY_ORDER[b.category] ?? 9);
        if (cat) return cat;
        if (a.category === 'bulk') return x.i - y.i;
        if (a.category === 'packed') {
            const m = stockGroupMachine(a).localeCompare(stockGroupMachine(b));
            if (m) return m;
            const found = !!a.isFoundItem - !!b.isFoundItem;
            if (found) return found;
        }
        return compareStockGroupsByCode(a, b) || x.i - y.i;
    }).map(x => x.g);
}

function stockCategoryLabel(cat) {
    if (cat === 'greenbean') return window.t ? (window.t('cat_greenbean') || 'Green Bean') : 'Green Bean';
    if (cat === 'bulk') return window.t ? (window.t('cat_bulk') || 'Bulk Roasted') : 'Bulk Roasted';
    if (cat === 'packed') return window.t ? (window.t('cat_packed') || 'Packed') : 'Packed';
    return cat;
}

async function loadStockOpnameReport(startDate, endDate) {
    // Wire buttons (idempotent — onclick assignment, not addEventListener).
    // Start/Cancel/Finalize are gated on reports_stockopname_perform (Stock
    // Opname Phase 2) — separate from reports_stockopname_view, which only
    // controls whether this tab is visible at all. Opening a stock take
    // freezes stock transactions for every user in the app (the database
    // trigger enforces this regardless), so starting/ending one can't be
    // left to whoever merely has view access to this tab. Disabled rather
    // than hidden so a view-only user still understands the feature exists
    // and why they can't use it, matching this file's own dispatch-button
    // convention (~line 1685).
    const canPerform = hasPermission('reports_stockopname_perform');
    const newBtn = document.getElementById('btn-stockopname-new');
    if (newBtn) {
        // NOT `newBtn.onclick = startStockTake` — the browser calls an
        // onclick handler with the click's Event object as the first
        // argument, which would land in startStockTake's `category`
        // parameter and be treated as an (invalid, truthy) category,
        // skipping the picker entirely (found live 2026-08-31, right after
        // per-category Stock Opname shipped — every direct click silently
        // built zero groups instead of opening the picker).
        newBtn.onclick = () => startStockTake();
        newBtn.disabled = !canPerform;
        newBtn.title = canPerform ? '' : 'No permission to start a stock opname';
    }
    const cancelBtn = document.getElementById('btn-stockopname-cancel');
    if (cancelBtn) {
        cancelBtn.onclick = cancelStockTake;
        cancelBtn.disabled = !canPerform;
        cancelBtn.title = canPerform ? '' : 'No permission to cancel a stock opname';
    }
    const finalizeBtn = document.getElementById('btn-stockopname-finalize');
    if (finalizeBtn) {
        finalizeBtn.onclick = openStockTakeReviewModal;
        finalizeBtn.disabled = !canPerform;
        finalizeBtn.title = canPerform ? '' : 'No permission to finalize a stock opname';
    }
    // Print Count Form is a blank paper form for a stock take that hasn't
    // started yet, so it asks the category the same way starting a new take
    // does — printing all three categories on one form would defeat the
    // point of separating the counting process by category.
    const printBtn = document.getElementById('btn-stockopname-print');
    if (printBtn) printBtn.onclick = () => openStockOpnameCategoryPickerModal((cat) => printStockCountForm(cat));

    const categoryFilter = document.getElementById('stockopname-category-filter');
    if (categoryFilter) {
        categoryFilter.onchange = () => {
            const startInput = document.getElementById('rep-filter-start');
            const endInput = document.getElementById('rep-filter-end');
            loadStockOpnameReport(startInput ? startInput.value : '', endInput ? endInput.value : '');
        };
    }

    // Stock Opname Phase 1: an opname already 'counting' (or stuck
    // 'posting' — Phase 6 will handle that transition; for now it's
    // treated the same as counting so the sheet is never silently
    // abandoned) takes over this view instead of showing history. This is
    // what makes the count sheet resumable after a refresh (cacat #4) —
    // the sheet lives in stock_take_items now, not only in a JS variable.
    const { data: openCheck } = await fetchData('stock_takes');
    const openTake = (openCheck || []).find(t => t.status === 'counting' || t.status === 'posting');
    if (openTake) {
        await resumeStockTake(openTake);
        return;
    }

    // Default to history view.
    const sheet = document.getElementById('stockopname-sheet');
    const history = document.getElementById('stockopname-history');
    if (sheet) sheet.classList.add('hidden');
    if (history) history.classList.remove('hidden');

    const [{ data: takes }, { data: allItems }] = await Promise.all([
        fetchData('stock_takes'),
        fetchData('stock_take_items')
    ]);
    const categoryFilterVal = categoryFilter ? categoryFilter.value : '';
    const filtered = (takes || []).filter(t => {
        const d = t.take_date || t.created_at?.split('T')[0];
        if (d) {
            if (startDate && d < startDate) return false;
            if (endDate && d > endDate) return false;
        }
        // Legacy takes (category NULL, from before this feature) covered
        // all three at once — they only drop out of a specific category
        // filter, never out of "All Categories".
        if (categoryFilterVal && t.category !== categoryFilterVal) return false;
        return true;
    }).sort((a, b) => (b.take_date || '').localeCompare(a.take_date || '') || b.id - a.id);

    // Fase 7: accuracy needs each take's own items, so group once here
    // instead of re-filtering the full stock_take_items table per row.
    const itemsByTake = new Map();
    (allItems || []).forEach(it => {
        if (!itemsByTake.has(it.stock_take_id)) itemsByTake.set(it.stock_take_id, []);
        itemsByTake.get(it.stock_take_id).push(it);
    });

    const tbody = document.getElementById('stockopname-history-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="table-empty-state">${window.t ? (window.t('stockopname_empty') || 'No stock takes recorded yet.') : 'No stock takes recorded yet.'}</td></tr>`;
        return;
    }
    filtered.forEach(t => {
        const accuracy = computeStockTakeAccuracy(itemsByTake.get(t.id));
        const accuracyDisplay = accuracy
            ? `${accuracy.pct.toFixed(0)}% <span style="color:var(--text-muted); font-weight:400;">(${accuracy.matched}/${accuracy.total})</span>`
            : '—';
        const statusKey = t.status === 'cancelled' ? 'stockopname_status_cancelled' : 'stockopname_status_posted';
        const statusFallback = t.status === 'cancelled' ? 'Cancelled' : 'Posted';
        const statusColor = t.status === 'cancelled' ? 'var(--text-muted)' : 'var(--success)';
        // NULL = a take from before categories were separated — it really
        // did cover all three at once, so it's labeled "All" rather than
        // guessing one category.
        const categoryLabel = t.category ? stockCategoryLabel(t.category) : (window.t ? (window.t('stockopname_category_all') || 'All') : 'All');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${t.take_date || '-'}</strong></td>
            <td>${categoryLabel}</td>
            <td><span style="font-size:0.72rem; font-weight:700; color:${statusColor};">${window.t ? (window.t(statusKey) || statusFallback) : statusFallback}</span></td>
            <td>${t.performed_by || '-'}</td>
            <td class="text-center">${t.total_items || 0} <span style="color:var(--text-muted);">(${t.skipped_items || 0} ${window.t ? (window.t('stockopname_col_skipped') || 'not counted') : 'not counted'})</span></td>
            <td style="text-align:center; ${(t.variance_items || 0) > 0 ? 'color:var(--danger); font-weight:700;' : ''}">${t.variance_items || 0}</td>
            <td class="text-center">${accuracyDisplay}</td>
            <td>${t.notes || '-'}</td>
            <td class="text-center"><button class="btn btn-secondary btn-sm" onclick="viewStockTake(${t.id})">${window.t ? (window.t('btn_view') || 'View') : 'View'}</button></td>
        `;
        tbody.appendChild(tr);
    });
}

// Fase 7: matched top-level counted rows ÷ all top-level counted rows.
// Deliberately excludes two kinds of row a raw count over stock_take_items
// would otherwise skew:
//  - lot-detail children (parent_item_id set) — whether a LOT matches
//    Stage 1 is a different question from "did the physical count match
//    the system", and one messy coffee's dozen lot rows shouldn't dominate
//    the denominator.
//  - found items (is_found_item) — system_qty is always 0 by definition,
//    so they can never "match"; that's the system having no record at
//    all, not a counting miss, and would unfairly drag accuracy down for
//    a genuinely good count.
function computeStockTakeAccuracy(items) {
    const topLevel = (items || []).filter(it => !it.parent_item_id && !it.is_found_item && it.counted);
    if (topLevel.length === 0) return null;
    const matched = topLevel.filter(it => stockOpnameVarianceIsMatch(it.category, parseFloat(it.system_qty) || 0, parseFloat(it.variance) || 0)).length;
    return { matched, total: topLevel.length, pct: (matched / topLevel.length) * 100 };
}

// User request 2026-08-31 (separating the opname PROCESS per category):
// stock_takes_one_active_uniq still allows only one active take at a time
// regardless of category (explicit decision — "di waktu yang berbeda", not
// concurrent), so this is a picker in front of the SAME single-take flow,
// not a way to run three at once. Stacked overlay (its own #overlay div),
// same pattern as openApproveAndCombineModal, so it never collides with
// whatever else might be open.
function openStockOpnameCategoryPickerModal(onChoose) {
    let container = document.getElementById('stockopname-category-modal-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'stockopname-category-modal-container';
        container.className = 'overlay';
        container.style.zIndex = '2000';
        document.body.appendChild(container);
    }

    const categories = [
        { key: 'greenbean', icon: '🌱' },
        { key: 'bulk', icon: '☕' },
        { key: 'packed', icon: '📦' }
    ];
    container.innerHTML = `
        <div class="overlay-card" style="max-width: 420px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:16px;">
                <h3 style="font-size:1.1rem; font-weight:700;" data-i18n="stockopname_pick_category_title">Which stock do you want to count?</h3>
                <button type="button" id="btn-close-stockopname-category" style="background:transparent; border:0; cursor:pointer; color:var(--text-muted); font-size:1.5rem; line-height:1;">&times;</button>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${categories.map(c => `
                    <button type="button" class="btn btn-secondary btn-stockopname-pick-category" data-category="${c.key}" style="justify-content:flex-start; gap:10px; padding:12px 14px; font-size:0.95rem;">
                        <span style="font-size:1.2rem;">${c.icon}</span> ${stockCategoryLabel(c.key)}
                    </button>
                `).join('')}
            </div>
        </div>
    `;
    container.classList.remove('hidden');

    const close = () => container.classList.add('hidden');
    document.getElementById('btn-close-stockopname-category').addEventListener('click', close);
    container.querySelectorAll('.btn-stockopname-pick-category').forEach(btn => {
        btn.addEventListener('click', () => {
            const cat = btn.getAttribute('data-category');
            close();
            onChoose(cat);
        });
    });
    if (window.translatePage) window.translatePage();
}

// Starts a brand new stock take, OR — if one is already open — resumes it
// instead. Two people clicking "New Stock Take" close together must not
// both succeed: stock_takes_one_active_uniq (Phase 0) rejects a second
// 'counting'/'posting' row, and the check below avoids even attempting
// that in the common case.
// `category` is null on the very first call (from the button) — resuming
// an already-open take short-circuits before it's ever needed; starting a
// genuinely new one opens the category picker and re-invokes this function
// with the user's choice.
async function startStockTake(category = null) {
    _stockOpnamePackedLotsCache = null;

    const { data: existingTakes } = await fetchData('stock_takes');
    const openTake = (existingTakes || []).find(t => t.status === 'counting' || t.status === 'posting');
    if (openTake) {
        const tbody = document.getElementById('stockopname-count-body');
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">Loading…</td></tr>`;
        await resumeStockTake(openTake);
        return;
    }

    if (!category) {
        openStockOpnameCategoryPickerModal((chosen) => startStockTake(chosen));
        return;
    }

    const tbody = document.getElementById('stockopname-count-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">Loading…</td></tr>`;

    const groups = await buildStockTakeGroups(category);
    if (groups.length === 0) {
        if (tbody) tbody.innerHTML = '';
        await showWarningModal(
            window.t ? (window.t('stockopname_category_empty') || 'There is no stock in this category to count yet.') : 'There is no stock in this category to count yet.',
            false
        );
        return;
    }

    const { data: newTake, error: startErr } = await saveData('stock_takes', {
        take_date: new Date().toISOString().split('T')[0],
        status: 'counting',
        category,
        started_at: new Date().toISOString(),
        started_by: (currentUser && currentUser.name) || null,
        performed_by: (currentUser && currentUser.name) || null
    });
    if (startErr || !newTake || !newTake.id) {
        // Someone else may have started one in the instant between the
        // check above and this insert — the unique index would reject
        // this insert with exactly that race. Recover by loading whatever
        // is now open instead of leaving the user stuck on an error.
        const { data: refetched } = await fetchData('stock_takes');
        const stillOpen = (refetched || []).find(t => t.status === 'counting' || t.status === 'posting');
        if (stillOpen) { await resumeStockTake(stillOpen); return; }
        alert('Failed to start stock take: ' + (startErr ? startErr.message : 'no id returned'));
        if (tbody) tbody.innerHTML = '';
        return;
    }

    currentStockTakeId = newTake.id;
    stockTakeResumeInfo = null;

    // One stock_take_items row per group, up front, uncounted. This is
    // what makes the sheet resumable after a refresh (cacat #4) — the
    // count now lives in the database from the moment the take opens, not
    // only in this JS variable.
    for (const g of groups) {
        const { data: itemRow, error: itemErr } = await saveData('stock_take_items', {
            stock_take_id: newTake.id,
            category: g.category,
            item_name: g.label,
            unit: g.unit,
            system_qty: g.systemQty,
            actual_qty: null,
            variance: null,
            counted: false,
            // Fase 7 bugfix: these snapshot columns existed since Fase 0 and
            // buildStockTakeGroups has computed coffeeCode since Fase 3, but
            // this insert never actually saved them — the live Tahap 1
            // sheet never noticed because it reads g.coffeeCode from the
            // in-memory group, not this row, so every take's Kode column
            // was silently null in the database until Fase 7's history/
            // detail view (which HAS to read from the DB, there's no live
            // group to fall back on) made the gap visible.
            coffee_code: g.coffeeCode || null,
            machine_name: g.machineName || null,
            bag_size_g: g.bagSizeG || null
        });
        if (itemErr) { console.error('Failed to create stock_take_items row for', g.label, itemErr); continue; }
        g.itemId = itemRow ? itemRow.id : null;
        g.actualQty = null;
        g.counted = false;
    }

    currentStockTakeGroups = sortStockTakeGroups(groups);
    stockTakeActiveSection = null;
    stockTakeDrafts = new Map();

    const sheet = document.getElementById('stockopname-sheet');
    const history = document.getElementById('stockopname-history');
    if (sheet) sheet.classList.remove('hidden');
    if (history) history.classList.add('hidden');

    const notesInput = document.getElementById('stockopname-notes');
    if (notesInput) notesInput.value = '';

    renderStockTakeSheet();
}

// Loads an already-open stock take (status 'counting'/'posting') from
// stock_take_items instead of starting a new one — called both when the
// Stock Opname tab is opened while one is running, and when
// startStockTake() finds one already open.
async function resumeStockTake(take) {
    currentStockTakeId = take.id;
    _stockOpnamePackedLotsCache = null;

    const [{ data: items }, groups, { data: machinesForFound }] = await Promise.all([
        fetchData('stock_take_items'),
        buildStockTakeGroups(),
        fetchData('machines')
    ]);
    const allMyItems = (items || []).filter(it => it.stock_take_id === take.id);
    // Fase 4: lot-detail rows (parent_item_id set) are children of a group
    // row, not groups of their own — split them out first so the
    // (category, item_name) matching below only ever sees top-level rows;
    // otherwise every saved lot row would fail to match any group and get
    // pushed in as a bogus extra "stale" row.
    const myItems = allMyItems.filter(it => !it.parent_item_id);
    const childItemsByParent = new Map();
    allMyItems.filter(it => it.parent_item_id).forEach(it => {
        if (!childItemsByParent.has(it.parent_item_id)) childItemsByParent.set(it.parent_item_id, []);
        childItemsByParent.get(it.parent_item_id).push(it);
    });

    // Match each saved item row back to a freshly-built group by
    // (category, item_name) — the same identity printStockCountForm and
    // the pre-Phase-1 finalize already treated a group as having. Live
    // data can drift between when the take was opened and now (Phase 2's
    // freeze isn't wired up until the next phase), so a saved row that no
    // longer matches any current group is kept as a read-only "stale" row
    // rather than silently dropped — it still needs to show up so the
    // sheet's total isn't missing rows, but finalize can't post an
    // adjustment for it since its source rows are gone (see
    // finalizeStockTake's stale-row handling below).
    const byKey = new Map(groups.map(g => [`${g.category}|${g.label}`, g]));
    const resumedGroups = [];
    myItems.forEach(item => {
        const key = `${item.category}|${item.item_name}`;
        const g = byKey.get(key);
        const actualQty = (item.actual_qty === null || item.actual_qty === undefined) ? null : parseFloat(item.actual_qty);
        if (g) {
            g.itemId = item.id;
            g.actualQty = actualQty;
            g.counted = !!item.counted;
            const children = childItemsByParent.get(item.id);
            if (children && children.length > 0) {
                g.detailed = true;
                g.lotBreakdown = children.map(c => ({
                    lotId: c.ref_id,
                    lotCode: c.lot_code,
                    stripCode: c.strip_code,
                    systemQty: parseFloat(c.system_qty) || 0,
                    actualQty: (c.actual_qty === null || c.actual_qty === undefined) ? null : parseFloat(c.actual_qty),
                    itemId: c.id
                }));
            }
            resumedGroups.push(g);
        } else if (item.is_found_item) {
            // Fase 5: a found item never has a matching fresh-built group
            // (buildStockTakeGroups can't produce one — that's the whole
            // point, its system stock was 0/hidden) so it would otherwise
            // fall into the stale-row branch below and lose its ability to
            // post. foundMeta is reconstructed from the label this same
            // modal writes (`name · size · machine` / `name · machine` —
            // always the first ' · '-separated piece) plus the snapshot
            // columns saved at add-time, so a refresh doesn't strand it.
            const machine = (machinesForFound || []).find(m => m.name === item.machine_name);
            resumedGroups.push({
                category: item.category,
                label: item.item_name,
                unit: item.unit,
                coffeeCode: item.coffee_code || '',
                systemQty: 0,
                rows: [],
                itemId: item.id,
                actualQty,
                counted: !!item.counted,
                isFoundItem: true,
                foundMeta: {
                    coffeeName: (item.item_name || '').split(' · ')[0],
                    machineId: machine ? machine.id : null,
                    gram: item.bag_size_g ? parseInt(item.bag_size_g) : null
                }
            });
        } else {
            resumedGroups.push({
                category: item.category,
                label: item.item_name,
                unit: item.unit,
                systemQty: parseFloat(item.system_qty) || 0,
                rows: [],
                stale: true,
                itemId: item.id,
                actualQty,
                counted: !!item.counted
            });
        }
    });

    currentStockTakeGroups = sortStockTakeGroups(resumedGroups);
    stockTakeActiveSection = null;
    stockTakeResumeInfo = { date: (take.started_at ? take.started_at.split('T')[0] : (take.take_date || '')), by: take.started_by || take.performed_by || '-' };

    const sheet = document.getElementById('stockopname-sheet');
    const history = document.getElementById('stockopname-history');
    if (sheet) sheet.classList.remove('hidden');
    if (history) history.classList.add('hidden');

    const notesInput = document.getElementById('stockopname-notes');
    if (notesInput) notesInput.value = take.notes || '';

    renderStockTakeSheet();
}

// Renders (or re-renders) the count sheet body from currentStockTakeGroups
// — used by both a fresh start and a resume, so the two paths can't drift
// apart in how a row looks.
function renderStockTakeSheet() {
    const tbody = document.getElementById('stockopname-count-body');
    if (!tbody || !currentStockTakeGroups) return;

    tbody.innerHTML = '';
    currentStockTakeGroups.forEach((g, i) => {
        const sysDisplay = g.unit === 'kg' ? g.systemQty.toFixed(1) : g.systemQty;
        const step = g.unit === 'kg' ? '0.1' : '1';
        const draft = g.itemId ? stockTakeDrafts.get(g.itemId) : undefined;
        const hasDraft = draft !== undefined;
        const hasValue = hasDraft ? draft !== '' : (g.actualQty !== null && g.actualQty !== undefined);
        const shownValue = hasDraft ? draft : g.actualQty;
        const valueAttr = hasValue ? `value="${shownValue}"` : '';
        const shownQty = hasValue ? parseFloat(shownValue) : null;
        const staleTag = g.stale ? ` <span style="font-size:0.65rem; color:var(--warning);" title="${window.t ? (window.t('stockopname_stale_row') || 'not found — item changed since this take started') : 'not found — item changed since this take started'}">⚠</span>` : '';
        // Fase 5: a found item never had a real packed_coffee row at Tahap
        // 1 time (that's why it needed this button at all) — its lots don't
        // exist until Finalize creates them, so it gets the same "found"
        // marker instead of a stale one and no lot-detail arrow.
        const foundTag = g.isFoundItem ? ` <span style="font-size:0.65rem; color:var(--success); font-weight:700;" title="${window.t ? (window.t('stockopname_found_row') || 'found item — not in the original list') : 'found item — not in the original list'}">🔍</span>` : '';
        // Fase 4 §4.5 point 1: the arrow opens the lot-detail modal for this
        // group alone — only packed has lots to detail (§1: "Tahap 2 hanya
        // berlaku untuk packed coffee"), and a stale or found row has no
        // live rows to fetch lots from, so both get a blank cell instead.
        const arrowCell = (g.category === 'packed' && !g.stale && !g.isFoundItem)
            ? `<td class="text-center" style="cursor:pointer; color:var(--text-muted); font-weight:700;" onclick="openStockTakeDetailModal([${i}])" title="${window.t ? (window.t('stockopname_open_detail') || 'Enter lot detail') : 'Enter lot detail'}">›</td>`
            : `<td></td>`;
        const tr = document.createElement('tr');
        tr.dataset.section = stockGroupSection(g);
        tr.innerHTML = `
            <td class="text-center" style="font-family:monospace; font-weight:700;">${g.coffeeCode || '—'}</td>
            <td><strong>${g.label}</strong>${staleTag}${foundTag}</td>
            <td class="text-center">${sysDisplay} ${g.unit}</td>
            <td class="text-center"><input type="number" class="form-control stockopname-actual-input${hasDraft ? ' stockopname-unsaved' : ''}" data-group-index="${i}" ${valueAttr} step="${step}" min="0" placeholder="—" style="width:110px; text-align:center; margin:0 auto;"></td>
            <td class="stockopname-status-cell text-center" data-group-index="${i}">${stockOpnameStatusHtml(g, (shownQty === null || isNaN(shownQty)) ? null : shownQty)}</td>
            ${arrowCell}
        `;
        tbody.appendChild(tr);
    });

    // Tab already reaches the next Aktual input via native browser tab
    // order (each input is the only focusable element in its row); Enter
    // needs its own handler since a plain <input> doesn't move focus on its
    // own — typing from the printed sheet has to work without a mouse
    // (STOCK_OPNAME_PLAN.md §4.2).
    const inputs = Array.from(tbody.querySelectorAll('.stockopname-actual-input'));
    inputs.forEach((input) => {
        input.addEventListener('input', () => { updateVarianceCell(input); recordStockTakeDraft(input); });
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const visible = inputs.filter(x => !x.closest('tr').classList.contains('hidden'));
            const next = visible[visible.indexOf(input) + 1];
            if (next) next.focus(); else input.blur();
        });
    });
    renderStockTakeTabs();

    // Fase 4 §4.2: "Cetak rincian"/"Input rincian" are always available in
    // the header, regardless of whether anything currently needs detailing
    // — idempotent onclick assignment, same convention loadStockOpnameReport
    // already uses for the Start/Cancel/Finalize buttons.
    // Green bean has nothing to "find" — buildStockTakeGroups always
    // includes every green_coffee row regardless of stock level, unlike
    // bulk/packed which skip zero-stock rows, so a green-bean-only take
    // (per-category Stock Opname, user request 2026-08-31) hides this
    // button entirely rather than opening a modal whose category dropdown
    // only ever offered bulk/packed anyway.
    const activeTakeCategory = (currentStockTakeGroups && currentStockTakeGroups.length) ? currentStockTakeGroups[0].category : null;
    const addFoundBtn = document.getElementById('btn-stockopname-add-found');
    if (addFoundBtn) {
        addFoundBtn.onclick = openAddFoundItemModal;
        addFoundBtn.classList.toggle('hidden', activeTakeCategory === 'greenbean');
    }
    const printStage2Btn = document.getElementById('btn-stockopname-print-stage2');
    if (printStage2Btn) printStage2Btn.onclick = printStockCountFormStage2;
    const printStage2BarBtn = document.getElementById('btn-stockopname-print-stage2-bar');
    if (printStage2BarBtn) printStage2BarBtn.onclick = printStockCountFormStage2;
    const detailAllHandler = async () => {
        if (!(await ensureStockTakeCountsSaved())) return;
        const needing = stockOpnameGroupsNeedingDetail();
        if (needing.length === 0) {
            await showWarningModal(window.t ? (window.t('stockopname_detail_none') || 'No differences to detail yet — enter Stage 1 counts first.') : 'No differences to detail yet — enter Stage 1 counts first.', false);
            return;
        }
        openStockTakeDetailModal(needing.map(x => x.i));
    };
    const detailAllBtn = document.getElementById('btn-stockopname-detail-all');
    if (detailAllBtn) detailAllBtn.onclick = detailAllHandler;
    const saveCountsBtn = document.getElementById('btn-stockopname-save-counts');
    if (saveCountsBtn) saveCountsBtn.onclick = () => saveStockTakeCounts();
    const detailAllBarBtn = document.getElementById('btn-stockopname-detail-all-bar');
    if (detailAllBarBtn) detailAllBarBtn.onclick = detailAllHandler;

    updateProgressNote();
    updateStockTakeDetailBar();
}

function formatVarianceText(variance, unit) {
    const vDisplay = unit === 'kg' ? variance.toFixed(1) : variance;
    return variance > 0 ? `+${vDisplay}` : `${vDisplay}`;
}

// Stock Opname Fase 3: green bean is counted in kg by hand-weighing, so it
// will essentially never land on the system figure to the last decimal —
// it gets a tolerance. Packed (whole bags) and bulk roasted coffee both
// require an exact match: packed because it's a whole-unit count, and bulk
// by the user's explicit choice (2026-08-26) — bulk_available IS also a
// decimal kg column technically, same shape as green bean, but the user
// wants bulk held to exact-match anyway rather than extending the
// tolerance there. See STOCK_OPNAME_PLAN.md Fase 3 for this decision.
const STOCKOPNAME_KG_TOLERANCE_PCT = 0.01;
const STOCKOPNAME_KG_TOLERANCE_MIN_KG = 0.1;

// Fase 7: pulled out of stockOpnameIsMatch so history/accuracy reporting
// can reuse the exact same tolerance rule from already-saved
// stock_take_items rows (category/system_qty/variance), without needing a
// live `group` object — the live sheet and the history view must never be
// able to disagree about what counts as a match.
function stockOpnameVarianceIsMatch(category, systemQty, variance) {
    if (category !== 'greenbean') return Math.abs(variance) < 1e-9;
    const tolerance = Math.max(STOCKOPNAME_KG_TOLERANCE_MIN_KG, systemQty * STOCKOPNAME_KG_TOLERANCE_PCT);
    return Math.abs(variance) <= tolerance;
}

function stockOpnameIsMatch(group, actual) {
    return stockOpnameVarianceIsMatch(group.category, group.systemQty, actual - group.systemQty);
}

// Renders the Status cell's content for one group: "—" when nothing has
// been typed yet, a match tick when within tolerance, or the raw variance
// (always the true number — tolerance only decides the label, never hides
// the figure) when it isn't.
function stockOpnameStatusHtml(g, actualQty) {
    // Fase 4: once a group has been broken down lot-by-lot, that lot-level
    // truth is authoritative over the raw group total (§4.4 "rincian lot
    // selalu menang") — shown as its own status rather than falling through
    // to Match/Difference, so the counter can see at a glance which rows
    // still need a second look and which are already fully resolved.
    if (g.detailed) {
        const label = window.t ? (window.t('stockopname_status_detailed') || 'Detailed') : 'Detailed';
        return `<span style="color:var(--success); font-weight:700;">📋 ${label}</span>`;
    }
    if (actualQty === null || actualQty === undefined) {
        return `<span style="color:var(--text-muted);">—</span>`;
    }
    if (stockOpnameIsMatch(g, actualQty)) {
        const label = window.t ? (window.t('stockopname_status_match') || 'Match') : 'Match';
        return `<span style="color:var(--success); font-weight:700;">✓ ${label}</span>`;
    }
    const variance = actualQty - g.systemQty;
    const label = window.t ? (window.t('col_variance') || 'Difference') : 'Difference';
    const vDisplay = formatVarianceText(variance, g.unit);
    const color = variance > 0 ? 'var(--success)' : 'var(--danger)';
    return `<span style="color:${color}; font-weight:700;">${label} ${vDisplay}</span>`;
}

// Live UI feedback as the user types — does NOT save. Persistence happens
// only when the user presses Save Counts, see saveStockTakeCounts.
function updateVarianceCell(input) {
    const idx = parseInt(input.getAttribute('data-group-index'));
    const g = currentStockTakeGroups[idx];
    const tbody = document.getElementById('stockopname-count-body');
    const cell = tbody ? tbody.querySelector(`.stockopname-status-cell[data-group-index="${idx}"]`) : null;
    if (!g || !cell) return;
    const raw = input.value;
    // Fase 4: typing a different number by hand overrides whatever lot
    // detail produced this group's current total — the "Detailed" status
    // stops being true the moment the number it was based on changes, so
    // it must clear live, not just on save (saveStockTakeCounts below does the
    // same for the persisted copy).
    if (g.detailed && parseFloat(raw) !== g.actualQty) g.detailed = false;
    if (raw === '') { cell.innerHTML = stockOpnameStatusHtml(g, null); return; }
    const actual = parseFloat(raw);
    if (isNaN(actual)) { cell.innerHTML = stockOpnameStatusHtml(g, null); return; }
    cell.innerHTML = stockOpnameStatusHtml(g, actual);
}

function soT(key, fallback) {
    if (!window.t) return fallback;
    const v = window.t(key);
    return v && v !== key ? v : fallback;
}

// Records (or clears) the unsaved draft for one Actual input. A value typed
// back to exactly what is already saved stops being a draft.
function recordStockTakeDraft(input) {
    const idx = parseInt(input.getAttribute('data-group-index'));
    const g = currentStockTakeGroups ? currentStockTakeGroups[idx] : null;
    if (!g || !g.itemId) return;
    const raw = input.value;
    const saved = (g.actualQty === null || g.actualQty === undefined) ? '' : String(g.actualQty);
    const same = raw === saved || (raw !== '' && saved !== '' && parseFloat(raw) === parseFloat(saved));
    if (same) stockTakeDrafts.delete(g.itemId);
    else stockTakeDrafts.set(g.itemId, raw);
    input.classList.toggle('stockopname-unsaved', !same);
    updateProgressNote();
}

function updateStockTakeSaveButton() {
    const btn = document.getElementById('btn-stockopname-save-counts');
    if (!btn) return;
    const n = stockTakeDrafts.size;
    const label = soT('btn_stockopname_save_counts', 'Save Counts');
    btn.textContent = n > 0 ? `${label} (${n})` : label;
    btn.disabled = n === 0 || stockTakeSaveInFlight;
}

// Full-screen processing lock for multi-step saves (stock count sheet,
// green bean arrival). Sits above the global Saving pill (z-index 100000)
// so the per-write pill no longer flashes on and off underneath while a
// batch of rows is being written. Nothing on the page can be clicked until
// release().
function lockProcessingScreen(text) {
    const overlay = document.createElement('div');
    overlay.className = 'processing-lock';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
        <div class="processing-lock-card">
            <div class="processing-lock-spinner"></div>
            <div class="processing-lock-text"></div>
            <div class="processing-lock-hint"></div>
        </div>
    `;
    const textEl = overlay.querySelector('.processing-lock-text');
    const hintEl = overlay.querySelector('.processing-lock-hint');
    textEl.textContent = text;
    hintEl.textContent = soT('stockopname_lock_hint', 'Please wait, do not close or refresh this page.');
    document.body.appendChild(overlay);
    return {
        setText(t) { textEl.textContent = t; },
        release() { overlay.remove(); }
    };
}

// Saves every drafted count in one go, then re-reads the rows from the
// database and only treats a row as saved once the stored value matches
// what was typed. Rows that fail stay drafts (still on screen, still
// marked unsaved) so nothing typed is ever silently lost.
// silentSuccess: used when another action (Finalize, lot detail, ...) saves
// first — it only needs to hear about failures.
// Returns true when every draft was saved and verified.
async function saveStockTakeCounts({ silentSuccess = false } = {}) {
    if (stockTakeSaveInFlight) return false;
    if (!currentStockTakeGroups || stockTakeDrafts.size === 0) {
        if (!silentSuccess) await showWarningModal(soT('stockopname_nothing_to_save', 'There are no unsaved counts.'), false);
        return true;
    }
    stockTakeSaveInFlight = true;
    updateStockTakeSaveButton();
    const lock = lockProcessingScreen(soT('stockopname_saving_counts', 'Saving counts…'));
    const byItemId = new Map(currentStockTakeGroups.filter(g => g.itemId).map(g => [g.itemId, g]));
    const expected = new Map();   // itemId -> number|null
    const failed = [];            // group labels
    let verifiedCount = 0;
    try {
        for (const [itemId, raw] of [...stockTakeDrafts.entries()]) {
            const g = byItemId.get(itemId);
            if (!g) { stockTakeDrafts.delete(itemId); continue; }
            const isEmpty = raw === '';
            const actual = isEmpty ? null : parseFloat(raw);
            if (!isEmpty && isNaN(actual)) { failed.push(g.label); continue; }

            // Fase 4: a typed total that no longer matches the lot-sum it was
            // built from makes those lot rows stale — they'd resurrect
            // g.detailed on the next resume otherwise, so they're deleted,
            // not just orphaned (updateVarianceCell already cleared
            // g.detailed live).
            if (!g.detailed && g.lotBreakdown && g.lotBreakdown.length > 0) {
                for (const l of g.lotBreakdown) {
                    if (l.itemId) await deleteData('stock_take_items', l.itemId);
                }
                g.lotBreakdown = null;
            }

            const { error } = await saveData('stock_take_items', {
                id: itemId,
                actual_qty: actual,
                variance: isEmpty ? null : (actual - g.systemQty),
                counted: !isEmpty,
                counted_at: isEmpty ? null : new Date().toISOString(),
                counted_by: isEmpty ? null : ((currentUser && currentUser.name) || null)
            });
            if (error) { console.error('Failed to save counted value for', g.label, error); failed.push(g.label); continue; }
            expected.set(itemId, actual);
        }

        if (expected.size > 0) {
            lock.setText(soT('stockopname_verifying_counts', 'Checking the database…'));
            const { data: rows, error: readErr } = await window.supabaseClient
                .from('stock_take_items').select('id, actual_qty, counted').in('id', [...expected.keys()]);
            const stored = new Map((rows || []).map(r => [r.id, r]));
            for (const [itemId, actual] of expected.entries()) {
                const g = byItemId.get(itemId);
                const r = stored.get(itemId);
                const storedQty = (r && r.actual_qty !== null && r.actual_qty !== undefined) ? parseFloat(r.actual_qty) : null;
                const ok = !readErr && r && (actual === null
                    ? (storedQty === null && !r.counted)
                    : (storedQty !== null && Math.abs(storedQty - actual) < 1e-6 && !!r.counted));
                if (!ok) { failed.push(g.label); continue; }
                g.actualQty = actual;
                g.counted = actual !== null;
                stockTakeDrafts.delete(itemId);
                verifiedCount++;
            }
        }
    } catch (err) {
        console.error('saveStockTakeCounts error:', err);
        failed.push(err && err.message ? err.message : String(err));
    } finally {
        lock.release();
        stockTakeSaveInFlight = false;
    }

    // Refresh unsaved markers from the (now smaller) draft map.
    document.querySelectorAll('#stockopname-count-body .stockopname-actual-input').forEach(input => {
        const g = currentStockTakeGroups ? currentStockTakeGroups[parseInt(input.getAttribute('data-group-index'))] : null;
        input.classList.toggle('stockopname-unsaved', !!(g && g.itemId && stockTakeDrafts.has(g.itemId)));
    });
    updateProgressNote();
    updateStockTakeDetailBar();

    if (failed.length > 0) {
        await showWarningModal(
            soT('stockopname_save_failed', 'These counts were NOT saved:\n{lines}\n\nThey are still on screen (marked unsaved). Press Save Counts to try again.')
                .replace('{lines}', failed.map(l => `• ${l}`).join('\n')),
            false, soT('stockopname_save_failed_title', 'Some counts not saved'), null, 'warning');
        return false;
    }
    if (!silentSuccess) {
        await showWarningModal(
            soT('stockopname_saved_ok', '{n} counts saved and verified in the database.').replace('{n}', verifiedCount),
            false, soT('stockopname_saved_ok_title', 'Counts saved'), null, 'success');
    }
    return true;
}

// Called at the top of every action that reads the saved counts (lot
// detail, found item, detail sheet print, finalize) so it never works from
// numbers that only exist on screen.
async function ensureStockTakeCountsSaved() {
    if (stockTakeDrafts.size === 0) return true;
    return saveStockTakeCounts({ silentSuccess: true });
}

// Refresh / close-tab guard while anything typed is still unsaved.
window.addEventListener('beforeunload', (e) => {
    if (stockTakeDrafts.size > 0) { e.preventDefault(); e.returnValue = ''; }
});

function updateProgressNote() {
    const el = document.getElementById('stockopname-progress-note');
    if (!el || !currentStockTakeGroups) return;
    const counted = currentStockTakeGroups.filter(g => g.counted).length;
    const total = currentStockTakeGroups.length;
    el.classList.remove('hidden');
    const countTemplate = window.t ? (window.t('stockopname_progress') || '{counted} of {total} items counted') : '{counted} of {total} items counted';
    let text = countTemplate.replace('{counted}', counted).replace('{total}', total);
    if (stockTakeResumeInfo) {
        const resumeTemplate = window.t ? (window.t('stockopname_resuming') || 'Resuming stock take started {date} by {user}.') : 'Resuming stock take started {date} by {user}.';
        text = resumeTemplate.replace('{date}', stockTakeResumeInfo.date).replace('{user}', stockTakeResumeInfo.by) + ' ' + text;
    }
    if (stockTakeDrafts.size > 0) {
        text += ' · ' + soT('stockopname_unsaved_note', '{n} unsaved').replace('{n}', stockTakeDrafts.size);
    }
    el.textContent = text;
    updateStockTakeSaveButton();
    updateStockTakeTabCounts();
}

// Section tabs above the count table: one per category, and one per machine
// for packed (stock is split per machine). Hidden when there's one section.
function renderStockTakeTabs() {
    const bar = document.getElementById('stockopname-sheet-tabs');
    const tbody = document.getElementById('stockopname-count-body');
    if (!bar || !tbody || !currentStockTakeGroups) return;
    const sections = [];
    currentStockTakeGroups.forEach(g => { const s = stockGroupSection(g); if (!sections.includes(s)) sections.push(s); });
    if (!sections.includes(stockTakeActiveSection)) stockTakeActiveSection = sections[0] || null;
    const multiCategory = new Set(currentStockTakeGroups.map(g => g.category)).size > 1;
    const label = s => {
        if (!s.startsWith('packed|')) return stockCategoryLabel(s);
        const machine = s.slice(7);
        return multiCategory ? `${stockCategoryLabel('packed')} · ${machine}` : machine;
    };
    const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    if (sections.length <= 1) {
        bar.classList.add('hidden');
        bar.innerHTML = '';
    } else {
        bar.classList.remove('hidden');
        bar.innerHTML = sections.map(s => `<button type="button" class="btn btn-secondary btn-sm so-tab${s === stockTakeActiveSection ? ' active' : ''}" data-section="${esc(s)}">${esc(label(s))} <span class="so-tab-count" data-section="${esc(s)}"></span></button>`).join('');
        bar.querySelectorAll('.so-tab').forEach(btn => {
            btn.onclick = () => { stockTakeActiveSection = btn.dataset.section; renderStockTakeTabs(); };
        });
    }
    tbody.querySelectorAll('tr[data-section]').forEach(tr => {
        tr.classList.toggle('hidden', sections.length > 1 && tr.dataset.section !== stockTakeActiveSection);
    });
    updateStockTakeTabCounts();
}

function updateStockTakeTabCounts() {
    const bar = document.getElementById('stockopname-sheet-tabs');
    if (!bar || !currentStockTakeGroups) return;
    bar.querySelectorAll('.so-tab-count').forEach(span => {
        const inSection = currentStockTakeGroups.filter(g => stockGroupSection(g) === span.dataset.section);
        span.textContent = `${inSection.filter(g => g.counted).length}/${inSection.length}`;
    });
}

// Cancelling marks the row 'cancelled' (STOCK_OPNAME_PLAN.md §5.1) — it is
// never deleted, so an abandoned attempt stays visible in history with who
// opened it. Async because it now has to persist the status change; the
// onclick assignment in loadStockOpnameReport works the same way
// finalizeStockTake's already did.
async function cancelStockTake() {
    if (currentStockTakeId) {
        const { error } = await saveData('stock_takes', { id: currentStockTakeId, status: 'cancelled' });
        if (error) { console.error('Failed to cancel stock take:', error); alert('Failed to cancel: ' + error.message); return; }
    }
    currentStockTakeGroups = null;
    currentStockTakeId = null;
    stockTakeResumeInfo = null;
    _stockOpnamePackedLotsCache = null;
    stockTakeDrafts = new Map();
    const sheet = document.getElementById('stockopname-sheet');
    const history = document.getElementById('stockopname-history');
    if (sheet) sheet.classList.add('hidden');
    if (history) history.classList.remove('hidden');
    await loadStockOpnameReport('', '');
}

// Applies a stock-take count delta to each category's real source of truth
// instead of a derived/aggregate column — green_coffee.stock_kg and
// packed_coffee.quantity are trigger-derived from their lots
// (sync_green_coffee_stock / sync_packed_coffee_quantity), and
// bulk_roasted_coffee rows are themselves lot-grained (STOCK_LEDGER_PLAN.md
// Phase 6) — a direct write to any of these got silently reverted/bypassed
// the ledger. Reuses the helpers each area's own edit modal already uses:
// createGreenCoffeeLot / consumeGreenCoffeeLotsFifo (js/roasting.js — loads
// before this file) for green, applyPackedCoffeeManualQtyDelta
// (js/packing.js — loads before this file) for packed, refund_bulk_lot /
// consume_bulk_lot RPCs directly for bulk. Deliberately does NOT touch
// quantity_kg/quantity_pcs on existing green/packed lots (STOCK_LEDGER_
// PLAN.md F6) — an increase always lands as a new, clearly-labeled
// adjustment record rather than rewriting how much an existing lot
// originally held; bulk has no such separate "originally held" figure to
// protect (bulk_available is the only stock number a row carries), so its
// increase branch below adjusts the row directly instead.
// Fase 6: returns true/false instead of nothing — executeStockTakePosting
// needs to know whether THIS group's write actually succeeded so it can
// stop and revert status on the first real failure rather than silently
// continuing (§5.2's "posting gagal di tengah" case). A shortfall (some of
// the requested kg/pcs couldn't be drawn from any lot) counts as failure
// here even though the underlying helpers don't throw for it.
async function applyStockGroupAdjustmentToLots(group, actual, stockTakeId) {
    const delta = actual - group.systemQty;
    if (Math.abs(delta) < 1e-9) return true;

    if (group.category === 'greenbean') {
        const bean = group.rows[0].rec;
        if (delta > 0) {
            const lot = await createGreenCoffeeLot({
                coffeeId: bean.id,
                coffeeCode: bean.code,
                arrivalDate: new Date().toISOString().split('T')[0],
                quantityKg: delta,
                supplier: 'Stock Take Adjustment',
                purchasePricePerKg: null
            });
            return !!lot;
        } else {
            const { draws, shortfallKg } = await consumeGreenCoffeeLotsFifo(bean.id, -delta);
            for (const d of draws) {
                await saveData('green_coffee_lot_adjustments', {
                    green_coffee_id: bean.id,
                    green_coffee_lot_id: d.lotId,
                    kg: d.kg,
                    adjustment_date: new Date().toISOString().split('T')[0],
                    adjusted_by: (currentUser && currentUser.name) || null,
                    // Tags this row as stock-opname-sourced so the Stock
                    // History ledger (js/greenbean.js renderStockHistoryTab)
                    // can show a "Stock Opname" tag distinct from a plain
                    // manual edit (js/greenbean.js's own write leaves these
                    // NULL) — added 2026-08-30, ref_table/ref_id columns.
                    ref_table: 'stock_takes',
                    ref_id: stockTakeId
                });
            }
            return shortfallKg < 1e-9;
        }
    }

    if (group.category === 'packed') {
        // A packed group can aggregate several packed_coffee rows (same
        // coffee+size, different machines) — split the delta across them in
        // the same row order applyStockGroupAdjustment used: surplus lands
        // on the first row, shortage drains rows in list order.
        if (delta > 0) {
            return await applyPackedCoffeeManualQtyDelta(group.rows[0].rec.id, delta, 'stocktake', 'stock_takes', stockTakeId);
        } else {
            let remaining = -delta;
            for (const row of group.rows) {
                if (remaining <= 0) break;
                const avail = parseFloat(row.rec.quantity) || 0;
                const take = Math.min(avail, remaining);
                if (take <= 0) continue;
                const ok = await applyPackedCoffeeManualQtyDelta(row.rec.id, -take, 'stocktake', 'stock_takes', stockTakeId);
                if (!ok) return false;
                remaining -= take;
            }
            return remaining <= 1e-9;
        }
    }

    if (group.category === 'bulk') {
        // STOCK_LEDGER_PLAN.md Phase 6: bulk_roasted_coffee now has its own
        // atomic RPCs + movement ledger, so this no longer needs the plain
        // read-modify-write applyStockGroupAdjustment above (kept only as a
        // historical comment — this function is the only caller now). Each
        // row here already IS one lot, so surplus/shortage apply directly
        // to rows, same order convention as the 'packed' branch above:
        // surplus lands on the first row, shortage drains rows in list
        // order.
        if (delta > 0) {
            // refund_bulk_lot RETURNS a row via `RETURNING bulk_available` —
            // for a bulk_id that doesn't exist, that UPDATE matches zero
            // rows and comes back as {data: null, error: null} (no
            // Postgres exception at all, confirmed live) — checking only
            // `error` would silently treat that as success.
            const { data, error } = await window.supabaseClient.rpc('refund_bulk_lot', {
                p_bulk_id: group.rows[0].rec.id, p_kg: delta,
                p_operation: 'stocktake', p_ref_table: 'stock_takes', p_ref_id: stockTakeId,
                p_user: (currentUser && currentUser.name) || null
            });
            if (error || data === null) { console.error('refund_bulk_lot RPC failed:', error || 'no matching row'); return false; }
            return true;
        } else {
            let remaining = -delta;
            for (const row of group.rows) {
                if (remaining <= 0) break;
                const avail = parseFloat(row.rec.bulk_available) || 0;
                const take = Math.min(avail, remaining);
                if (take <= 0) continue;
                // consume_bulk_lot returns the ACTUAL kg consumed (via a
                // before/after diff), which is 0 — not an error — for a
                // bulk_id that doesn't exist or already has less than
                // requested. Track the real returned amount, not the
                // requested `take`, so a silent no-op still shows up as a
                // shortfall below instead of being counted as applied.
                const { data: takenKg, error } = await window.supabaseClient.rpc('consume_bulk_lot', {
                    p_bulk_id: row.rec.id, p_kg: take,
                    p_operation: 'stocktake', p_ref_table: 'stock_takes', p_ref_id: stockTakeId,
                    p_user: (currentUser && currentUser.name) || null
                });
                if (error) { console.error('consume_bulk_lot RPC failed:', error); return false; }
                remaining -= parseFloat(takenKg) || 0;
            }
            return remaining <= 1e-9;
        }
    }
    return true;
}

// Fase 4 cacat #6: writes a detailed group's true per-lot counts directly —
// no distribution guessing. A lot the counter left blank in the detail
// modal is skipped entirely here (same "blank = not counted, don't touch
// it" rule as everywhere else in this feature), so its remaining_pcs stays
// whatever it already was.
//
// Fase 6: marks each lot's own stock_take_items child row with posted_at
// the moment its write succeeds (finer-grained than the group level —
// matches cacat #6's own "per lot, not per group" spirit) and returns
// false on the first failed lot, so executeStockTakePosting can stop and
// revert status instead of silently leaving some lots unposted. A retry
// skips lots already marked via `postedLotItemIds`, so it resumes from the
// lot that failed rather than re-writing ones that already succeeded.
async function applyStockGroupDetailedLotsAdjustment(group, stockTakeId, postedLotItemIds) {
    for (const l of group.lotBreakdown) {
        if (l.actualQty === null || l.actualQty === undefined) continue;
        if (l.itemId && postedLotItemIds && postedLotItemIds.has(l.itemId)) continue;
        // Returns the new remaining_pcs via `RETURNING` — for a lot_id that
        // no longer exists, that's zero matched rows and {data: null,
        // error: null} (confirmed live: no Postgres exception at all), so
        // `data === null` has to be checked as failure too, not just `error`.
        const { data, error } = await window.supabaseClient.rpc('set_packed_lot_remaining', {
            p_lot_id: l.lotId, p_pcs: l.actualQty,
            p_operation: 'stocktake', p_ref_table: 'stock_takes', p_ref_id: stockTakeId,
            p_user: (currentUser && currentUser.name) || null
        });
        if (error || data === null) { console.error('set_packed_lot_remaining RPC failed:', error || 'no matching lot'); return false; }
        if (l.itemId) await saveData('stock_take_items', { id: l.itemId, posted_at: new Date().toISOString() });
    }
    return true;
}

// Fase 4 §4.3/§4.4/§4.5: groups that currently need a Tahap 2 lot count —
// a packed group with a typed Aktual that's outside tolerance and not
// already detailed. Drives the bottom bar, the "Input rincian"/"Cetak
// rincian" bar buttons, and Stage 2's print sheet — kept as one function so
// all three can never disagree about which groups qualify.
function stockOpnameGroupsNeedingDetail() {
    if (!currentStockTakeGroups) return [];
    const out = [];
    currentStockTakeGroups.forEach((g, i) => {
        if (g.category !== 'packed' || g.stale || g.detailed) return;
        if (g.actualQty === null || g.actualQty === undefined) return;
        if (stockOpnameIsMatch(g, g.actualQty)) return;
        out.push({ g, i });
    });
    return out;
}

// FIFO-sorted remaining-stock lots for one packed group's underlying
// packed_coffee row(s) — same convention js/packing.js's openStockByLotModal
// uses for roast date (true production date via production_lot_id, falling
// back to packed_date for manual/unlinked lots) and "oldest first" ordering.
// Takes the shared cache's raw tables so callers looping over many groups
// don't refetch per group.
function lotsForPackedGroupFromCache(group, cache) {
    const packedIds = new Set(group.rows.filter(r => r.table === 'packed_coffee').map(r => r.rec.id));
    const lots = (cache.lots || [])
        .filter(l => packedIds.has(l.packed_coffee_id) && (parseInt(l.remaining_pcs) || 0) > 0)
        .map(l => {
            const pl = l.production_lot_id ? (cache.productionLots || []).find(p => p.id === l.production_lot_id) : null;
            return {
                lotId: l.id,
                lotCode: l.lot_code,
                stripCode: l.strip_code,
                roastDate: pl ? pl.production_date : null,
                packedDate: l.packed_date,
                systemQty: parseInt(l.remaining_pcs) || 0,
                actualQty: null
            };
        })
        .sort((a, b) => new Date(a.roastDate || a.packedDate || 0) - new Date(b.roastDate || b.packedDate || 0));
    lots.forEach((l, idx) => { l.pickFirst = idx === 0; });
    return lots;
}

// Updates the "3 grup selisih · 9 lot perlu dihitung rinci" bar under the
// count table — hidden while nothing needs detailing.
async function updateStockTakeDetailBar() {
    const bar = document.getElementById('stockopname-detail-bar');
    const textEl = document.getElementById('stockopname-detail-bar-text');
    if (!bar || !textEl) return;
    const needing = stockOpnameGroupsNeedingDetail();
    if (needing.length === 0) { bar.classList.add('hidden'); return; }
    const cache = await getStockOpnamePackedLotsCache();
    const totalLots = needing.reduce((sum, { g }) => sum + lotsForPackedGroupFromCache(g, cache).length, 0);
    const template = window.t ? (window.t('stockopname_detail_bar_text') || '{groups} group(s) with a difference · {lots} lot(s) need a detail count') : '{groups} group(s) with a difference · {lots} lot(s) need a detail count';
    textEl.textContent = template.replace('{groups}', needing.length).replace('{lots}', totalLots);
    bar.classList.remove('hidden');
}

// Stage 2 print sheet (§4.3) — one block per group that currently needs
// detailing, with a blank lot table for the team to fill in by hand.
async function printStockCountFormStage2() {
    if (!(await ensureStockTakeCountsSaved())) return;
    const needing = stockOpnameGroupsNeedingDetail();
    if (needing.length === 0) {
        await showWarningModal(window.t ? (window.t('stockopname_detail_none') || 'No differences to detail yet — enter Stage 1 counts first.') : 'No differences to detail yet — enter Stage 1 counts first.', false);
        return;
    }
    const cache = await getStockOpnamePackedLotsCache();
    const cs = companySettings;
    const subtitle = window.t ? (window.t('stockopname_print_stage2_subtitle') || 'Lot Detail Count Form') : 'Lot Detail Count Form';
    const tStrip = window.t ? (window.t('col_strip_code') || 'Strip') : 'Strip';
    const tLot = window.t ? (window.t('col_lot_date') || 'Lot / Packed Date') : 'Lot / Packed Date';
    const tSystem = window.t ? (window.t('col_system_qty') || 'System') : 'System';
    const tActual = window.t ? (window.t('col_actual_qty') || 'Actual') : 'Actual';
    const tNotes = window.t ? (window.t('col_notes') || 'Notes') : 'Notes';
    const tPickFirst = window.t ? (window.t('stockopname_pick_first') || 'PICK FIRST') : 'PICK FIRST';
    const tDate = window.t ? (window.t('col_date') || 'Date') : 'Date';
    const tBy = window.t ? (window.t('col_performed_by') || 'Counted By') : 'Counted By';

    let blocks = '';
    needing.forEach(({ g }) => {
        const lots = lotsForPackedGroupFromCache(g, cache);
        const variance = g.actualQty - g.systemQty;
        const rows = lots.map(l => `<tr>
            <td>${l.stripCode || '-'}${l.pickFirst ? ` <span class="pick-first">${tPickFirst}</span>` : ''}</td>
            <td>${l.lotCode || '-'}<br><span class="lot-date">${l.roastDate || l.packedDate || '-'}</span></td>
            <td class="c">${l.systemQty}</td>
            <td class="blank"></td>
            <td class="blank"></td>
        </tr>`).join('');
        blocks += `
        <div class="group-block">
            <div class="group-header">
                <span class="group-code">${g.coffeeCode || ''}</span>
                <span class="group-name">${g.label}</span>
                <span class="group-stats">${tSystem} ${g.systemQty} · ${tActual} ${g.actualQty} · ${window.t ? (window.t('col_variance') || 'Difference') : 'Difference'} ${variance > 0 ? '+' : ''}${variance}</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>${tStrip}</th>
                        <th>${tLot}</th>
                        <th style="width:80px;">${tSystem}</th>
                        <th style="width:100px;">${tActual}</th>
                        <th style="width:130px;">${tNotes}</th>
                    </tr>
                </thead>
                <tbody>${rows || `<tr><td colspan="5" class="c">-</td></tr>`}</tbody>
            </table>
        </div>`;
    });

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
        .meta { display: flex; gap: 40px; font-size: 11px; color: #555; margin-bottom: 16px; }
        .group-block { margin-bottom: 20px; break-inside: avoid; }
        .group-header { display: flex; align-items: baseline; gap: 10px; background: #f3f4e8; border-left: 4px solid #2d5016; padding: 6px 10px; margin-bottom: 6px; }
        .group-code { font-family: monospace; font-weight: 800; font-size: 13px; }
        .group-name { font-weight: 700; font-size: 12px; }
        .group-stats { margin-left: auto; font-size: 11px; color: #555; }
        table { width: 100%; border-collapse: collapse; }
        thead th { background: #2d5016; color: #fff; padding: 7px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; text-align: left; border: 1px solid #2d5016; }
        tbody td { padding: 6px 10px; border: 1px solid #cfcfcf; font-size: 12px; height: 24px; }
        tbody td.c { text-align: center; }
        tbody td.blank { background: #fff; }
        .lot-date { font-size: 10px; color: #777; }
        .pick-first { font-size: 9px; font-weight: 800; color: #b45309; background: #fef3c7; padding: 1px 5px; border-radius: 4px; }
        .signoff { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; margin-top: 24px; }
        .sig { text-align: center; }
        .sig-line { border-top: 1px solid #333; margin-bottom: 4px; padding-top: 32px; }
        .sig-lbl { font-size: 10px; text-transform: uppercase; color: #666; font-weight: 600; }
        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
    </style>
</head>
<body>
    <div class="page">
        <div class="letterhead">
            <div class="lh-left">
                ${cs.show_logo_in_print && cs.logo_base64 ? '<img class="lh-logo" src="' + cs.logo_base64 + '" alt="Logo">' : ''}
                <div>
                    <div class="lh-name">${cs.company_name || 'Coffee Roastery'}</div>
                    <div class="lh-contact">${cs.address ? cs.address : ''}</div>
                </div>
            </div>
            <div class="lh-right">
                <div class="doc-title">${window.t ? (window.t('cat_packed') || 'Packed') : 'Packed'}</div>
                <div class="doc-sub">${subtitle}</div>
            </div>
        </div>
        <div class="meta">
            <span>${tDate}: _______________________</span>
            <span>${tBy}: _______________________</span>
        </div>
        ${blocks}
        <div class="signoff">
            <div class="sig"><div class="sig-line"></div><div class="sig-lbl">Counted By</div></div>
            <div class="sig"><div class="sig-line"></div><div class="sig-lbl">Checked By</div></div>
            <div class="sig"><div class="sig-line"></div><div class="sig-lbl">Approved By</div></div>
        </div>
    </div>
</body>
</html>`;

    const w = window.open('', '_blank');
    w.document.write(printContent);
    w.document.close();
}

// Fase 4 §4.4/§4.5 — the Tahap 2 input modal. groupIndices can be one index
// (row-arrow spot-check, may or may not currently be in variance) or many
// (the "Input rincian" buttons, always fed by stockOpnameGroupsNeedingDetail
// so they only ever open groups that actually need it).
async function openStockTakeDetailModal(groupIndices) {
    if (!currentStockTakeGroups || !groupIndices || groupIndices.length === 0) return;
    if (!(await ensureStockTakeCountsSaved())) return;
    const targets = groupIndices
        .map(i => ({ i, g: currentStockTakeGroups[i] }))
        .filter(({ g }) => g && g.category === 'packed' && !g.stale);
    if (targets.length === 0) return;

    const cache = await getStockOpnamePackedLotsCache();
    const blocks = targets.map(({ i, g }) => {
        // Reopening an already-detailed group shows its saved lot figures
        // for editing rather than a blank re-fetch — the lot list itself
        // can't have changed mid-take (writes are frozen), only the counts
        // typed against it can.
        const lots = (g.detailed && g.lotBreakdown) ? g.lotBreakdown : lotsForPackedGroupFromCache(g, cache);
        return { i, g, lots };
    });

    let bodyHtml = '';
    blocks.forEach(({ i, g, lots }) => {
        const rows = lots.map((l, li) => `
            <tr>
                <td>${l.stripCode || '-'}${l.pickFirst ? ` <span style="font-size:0.65rem; font-weight:800; color:#b45309; background:#fef3c7; padding:1px 5px; border-radius:4px;">${window.t ? (window.t('stockopname_pick_first') || 'PICK FIRST') : 'PICK FIRST'}</span>` : ''}</td>
                <td>${l.lotCode || '-'}<br><span style="font-size:0.7rem; color:var(--text-muted);">${l.roastDate || l.packedDate || '-'}</span></td>
                <td class="text-center">${l.systemQty}</td>
                <td class="text-center"><input type="number" class="form-control sod-lot-input" data-group-index="${i}" data-lot-index="${li}" ${l.actualQty !== null && l.actualQty !== undefined ? `value="${l.actualQty}"` : ''} step="1" min="0" placeholder="—" style="width:90px; text-align:center; margin:0 auto;"></td>
            </tr>`).join('');
        bodyHtml += `
        <div class="sod-group" data-group-index="${i}" style="margin-bottom:18px; border:1px solid var(--border); border-radius:10px; overflow:hidden;">
            <div style="background:var(--bg-app); padding:10px 14px; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
                <span style="font-family:monospace; font-weight:800;">${g.coffeeCode || ''}</span>
                <strong>${g.label}</strong>
                <span style="margin-left:auto; font-size:0.78rem; color:var(--text-muted);">${window.t ? (window.t('col_system_qty') || 'System') : 'System'} ${g.systemQty} · ${window.t ? (window.t('stockopname_stage1_label') || 'Stage 1') : 'Stage 1'} ${g.actualQty ?? '-'}</span>
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr style="background:var(--bg-app);">
                            <th style="text-align:left; padding:6px 10px; font-size:0.72rem;">${window.t ? (window.t('col_strip_code') || 'Strip') : 'Strip'}</th>
                            <th style="text-align:left; padding:6px 10px; font-size:0.72rem;">${window.t ? (window.t('col_lot_date') || 'Lot / Date') : 'Lot / Date'}</th>
                            <th style="text-align:center; padding:6px 10px; font-size:0.72rem;">${window.t ? (window.t('col_system_qty') || 'System') : 'System'}</th>
                            <th style="text-align:center; padding:6px 10px; font-size:0.72rem;">${window.t ? (window.t('col_actual_qty') || 'Actual') : 'Actual'}</th>
                        </tr>
                    </thead>
                    <tbody>${rows || `<tr><td colspan="4" style="text-align:center; padding:12px; color:var(--text-muted);">-</td></tr>`}</tbody>
                </table>
            </div>
            <div class="sod-sum" data-group-index="${i}" style="padding:8px 14px; font-size:0.8rem; border-top:1px solid var(--border);"></div>
        </div>`;
    });

    const footerId = 'sod-footer-text';
    const html = `
        <div style="max-height:65vh; overflow-y:auto; padding-right:4px;">${bodyHtml}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; padding-top:12px; border-top:1px solid var(--border);">
            <span id="${footerId}" style="font-size:0.8rem; color:var(--text-muted);"></span>
            <div style="display:flex; gap:8px;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('btn-close-modal').click()">${window.t ? (window.t('btn_cancel') || 'Cancel') : 'Cancel'}</button>
                <button type="button" class="btn btn-primary btn-sm" id="btn-sod-save">${window.t ? (window.t('btn_save_detail') || 'Save Detail') : 'Save Detail'}</button>
            </div>
        </div>
    `;
    openModal(window.t ? (window.t('stockopname_detail_modal_title') || 'Lot Detail') : 'Lot Detail', html, '760px');

    function readGroupInputs(i) {
        return Array.from(document.querySelectorAll(`.sod-lot-input[data-group-index="${i}"]`))
            .map(inp => {
                const raw = inp.value;
                return raw === '' ? null : parseFloat(raw);
            });
    }

    function refreshSumRow(i, g, lots) {
        const values = readGroupInputs(i);
        const sumCell = document.querySelector(`.sod-sum[data-group-index="${i}"]`);
        if (!sumCell) return;
        const anyFilled = values.some(v => v !== null && !isNaN(v));
        if (!anyFilled) { sumCell.innerHTML = ''; return; }
        const total = values.reduce((s, v, idx) => s + ((v === null || isNaN(v)) ? lots[idx].systemQty : v), 0);
        const stage1 = g.actualQty;
        if (stage1 !== null && stage1 !== undefined && Math.abs(total - stage1) < 1e-9) {
            const t = window.t ? (window.t('stockopname_lot_sum_match') || 'Lot count matches the Stage 1 total') : 'Lot count matches the Stage 1 total';
            sumCell.innerHTML = `<span style="color:var(--success); font-weight:600;">✓ ${t} (${total})</span>`;
        } else {
            const t = window.t ? (window.t('stockopname_lot_sum_mismatch') || 'Lot total ({lots}) differs from Stage 1 ({stage1}) — lot detail will be used') : 'Lot total ({lots}) differs from Stage 1 ({stage1}) — lot detail will be used';
            sumCell.innerHTML = `<span style="color:var(--warning); font-weight:600;">⚠ ${t.replace('{lots}', total).replace('{stage1}', stage1 ?? '-')}</span>`;
        }
    }

    function refreshFooter() {
        const el = document.getElementById(footerId);
        if (!el) return;
        const allInputs = document.querySelectorAll('.sod-lot-input');
        const filled = Array.from(allInputs).filter(inp => inp.value !== '').length;
        const template = window.t ? (window.t('stockopname_detail_footer') || '{filled} of {total} lots filled') : '{filled} of {total} lots filled';
        el.textContent = template.replace('{filled}', filled).replace('{total}', allInputs.length);
    }

    blocks.forEach(({ i, g, lots }) => refreshSumRow(i, g, lots));
    refreshFooter();

    document.querySelectorAll('.sod-lot-input').forEach(inp => {
        inp.addEventListener('input', () => {
            const i = parseInt(inp.getAttribute('data-group-index'));
            const block = blocks.find(b => b.i === i);
            if (block) refreshSumRow(block.i, block.g, block.lots);
            refreshFooter();
        });
    });

    const saveBtn = document.getElementById('btn-sod-save');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            saveBtn.disabled = true;
            for (const { i, g, lots } of blocks) {
                const values = readGroupInputs(i);
                const filledLots = lots.map((l, idx) => ({ ...l, actualQty: values[idx] }));
                await saveStockTakeDetailForGroup(i, g, filledLots);
            }
            document.getElementById('btn-close-modal').click();
            renderStockTakeSheet();
        };
    }
}

// Persists one group's lot breakdown: each counted lot becomes/updates a
// child stock_take_items row (parent_item_id -> the group's own row,
// ref_table/ref_id -> the lot), then the parent row is updated to the lot
// sum — "rincian lot selalu menang" (§4.4). A lot left blank keeps
// contributing its ORIGINAL system quantity to that sum rather than being
// treated as 0, since leaving a lot uncounted means "not verified", not
// "confirmed empty" — the same distinction blank Stage 1 cells already draw
// (cacat #1), just applied one level down.
async function saveStockTakeDetailForGroup(groupIndex, g, filledLots) {
    let sumActual = 0;
    for (const l of filledLots) {
        const hasValue = l.actualQty !== null && l.actualQty !== undefined && !isNaN(l.actualQty);
        sumActual += hasValue ? l.actualQty : l.systemQty;
        if (!hasValue) continue;
        const payload = {
            stock_take_id: currentStockTakeId,
            category: 'packed',
            item_name: `${g.label} · ${l.stripCode || l.lotCode || l.lotId}`,
            unit: 'bags',
            system_qty: l.systemQty,
            actual_qty: l.actualQty,
            variance: l.actualQty - l.systemQty,
            counted: true,
            counted_at: new Date().toISOString(),
            counted_by: (currentUser && currentUser.name) || null,
            parent_item_id: g.itemId,
            ref_table: 'packed_coffee_lots',
            ref_id: l.lotId,
            strip_code: l.stripCode || null,
            lot_code: l.lotCode || null
        };
        if (l.itemId) payload.id = l.itemId;
        const { data, error } = await saveData('stock_take_items', payload);
        if (error) { console.error('Failed to save lot detail for', g.label, l.lotCode, error); continue; }
        if (data) l.itemId = data.id;
    }

    g.actualQty = sumActual;
    g.counted = true;
    g.detailed = true;
    g.lotBreakdown = filledLots;

    if (g.itemId) {
        const { error } = await saveData('stock_take_items', {
            id: g.itemId,
            actual_qty: sumActual,
            variance: sumActual - g.systemQty,
            counted: true,
            counted_at: new Date().toISOString(),
            counted_by: (currentUser && currentUser.name) || null
        });
        if (error) console.error('Failed to update parent row after lot detail for', g.label, error);
    }
}

// Fase 5 §Barang temuan (cacat #2): buildStockTakeGroups filters bulk and
// packed groups whose system quantity is <= 0 (green bean never gets that
// filter — see the comment on that forEach — so it can never have a
// "found" case, only bulk/packed can). A team that physically finds real
// stock for one of these during counting has nowhere to enter it without
// this button, short of printing hundreds of blank zero-stock rows nobody
// wants (the whole reason cacat #2 wasn't just "remove the filter").
// Deliberately requires picking an existing green_coffee/blend_recipes
// entry from the list (not a free-typed name) — this is for stock the
// system already knows about but temporarily lost track of, not for
// registering a brand new coffee identity through a stock count.
async function openAddFoundItemModal() {
    if (!currentStockTakeGroups || !currentStockTakeId) return;
    if (!(await ensureStockTakeCountsSaved())) return;
    const [
        { data: greenbeans }, { data: recipes }, { data: machines }, { data: sizes }
    ] = await Promise.all([
        fetchData('green_coffee'), fetchData('blend_recipes'),
        fetchData('machines'), fetchData('packaging_sizes')
    ]);
    const activeSizes = (sizes || []).filter(s => s.is_visible).sort((a, b) => a.gram - b.gram);

    // Same "CODE — NAME" datalist convention as js/packing.js's
    // openCustomPackingModal, so identity resolves the same way every other
    // manual-entry flow in the app does.
    const coffeeByName = new Map();
    (greenbeans || []).forEach(gb => { if (!coffeeByName.has(gb.name)) coffeeByName.set(gb.name, { code: gb.code || '' }); });
    (recipes || []).forEach(r => { if (!coffeeByName.has(r.name)) coffeeByName.set(r.name, { code: r.code || '' }); });
    const displayToName = new Map();
    const sortedNames = Array.from(coffeeByName.keys()).sort((a, b) => a.localeCompare(b));
    const datalistOptions = sortedNames.map(name => {
        const code = coffeeByName.get(name).code;
        const display = code ? `${code} — ${name}` : name;
        displayToName.set(display, name);
        return `<option value="${display}"></option>`;
    }).join('');
    const machineOptions = (machines || []).map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    const sizeOptions = activeSizes.map(s => `<option value="${s.gram}">${s.gram >= 1000 ? (s.gram / 1000) + 'kg' : s.gram + 'g'}</option>`).join('');

    // A category-scoped take (per-category Stock Opname, user request
    // 2026-08-31) only offers ITS OWN category here — a found item added
    // under a different category than the active take's own would create a
    // stock_take_items row that disagrees with stock_takes.category. Falls
    // back to both options for a legacy mixed take (activeTakeCategory
    // null/'greenbean' — greenbean never reaches this modal at all, see the
    // hidden button above, so 'greenbean' here only means "no active take
    // groups yet", not a real choice to lock to).
    const activeTakeCategory = (currentStockTakeGroups && currentStockTakeGroups.length) ? currentStockTakeGroups[0].category : null;
    const categoryOptionsHtml = (activeTakeCategory === 'bulk' || activeTakeCategory === 'packed')
        ? `<option value="${activeTakeCategory}">${stockCategoryLabel(activeTakeCategory)}</option>`
        : `<option value="bulk">${window.t ? (window.t('cat_bulk') || 'Bulk Roasted') : 'Bulk Roasted'}</option>
           <option value="packed">${window.t ? (window.t('cat_packed') || 'Packed') : 'Packed'}</option>`;

    const html = `
        <form id="modal-found-item-form" novalidate>
            <div class="form-group">
                <label class="form-label">${window.t ? (window.t('col_category') || 'Category') : 'Category'}</label>
                <select id="fi-category" class="form-control" required ${(activeTakeCategory === 'bulk' || activeTakeCategory === 'packed') ? 'disabled' : ''}>
                    ${categoryOptionsHtml}
                </select>
            </div>
            <div class="form-group mt-3">
                <label class="form-label">${window.t ? (window.t('col_item') || 'Item') : 'Item'}</label>
                <input type="text" id="fi-coffee" class="form-control" list="fi-coffee-list" placeholder="..." required>
                <datalist id="fi-coffee-list">${datalistOptions}</datalist>
            </div>
            <div class="form-row mt-3">
                <div class="form-group" id="fi-size-group">
                    <label class="form-label">${window.t ? (window.t('stockopname_lbl_bag_size') || 'Bag Size') : 'Bag Size'}</label>
                    <select id="fi-size" class="form-control">${sizeOptions}</select>
                </div>
                <div class="form-group">
                    <label class="form-label">${window.t ? (window.t('stockopname_lbl_machine') || 'Machine') : 'Machine'}</label>
                    <select id="fi-machine" class="form-control" required>
                        <option value="" disabled selected>--</option>
                        ${machineOptions}
                    </select>
                </div>
            </div>
            <div class="form-group mt-3">
                <label class="form-label">${window.t ? (window.t('col_actual_qty') || 'Actual') : 'Actual'}</label>
                <input type="number" id="fi-qty" class="form-control" min="1" step="1" required>
            </div>
            <div class="modal-footer-actions-lg">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">${window.t ? (window.t('btn_cancel') || 'Cancel') : 'Cancel'}</button>
                <button type="submit" class="btn btn-primary">${window.t ? (window.t('btn_stockopname_add_found') || 'Add Found Item') : 'Add Found Item'}</button>
            </div>
        </form>
    `;
    openModal(window.t ? (window.t('stockopname_add_found_title') || 'Add Found Item') : 'Add Found Item', html, '560px');

    const catSelect = document.getElementById('fi-category');
    const sizeGroup = document.getElementById('fi-size-group');
    const qtyInput = document.getElementById('fi-qty');
    function syncCategoryFields() {
        const isPacked = catSelect.value === 'packed';
        sizeGroup.style.display = isPacked ? '' : 'none';
        document.getElementById('fi-size').required = isPacked;
        // Bulk is counted in kg (decimal) same as everywhere else in this
        // feature — packed stays whole bags. Forgetting this made bulk
        // quantities silently truncate to an integer (found live: typed
        // 5.5kg, saved as 5).
        qtyInput.step = isPacked ? '1' : '0.1';
    }
    catSelect.addEventListener('change', syncCategoryFields);
    syncCategoryFields();

    document.getElementById('modal-found-item-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const category = catSelect.value;
        const typed = document.getElementById('fi-coffee').value.trim();
        const coffeeName = displayToName.get(typed) || typed;
        const info = coffeeByName.get(coffeeName);
        const machineId = parseInt(document.getElementById('fi-machine').value);
        const qty = category === 'packed' ? parseInt(qtyInput.value) : parseFloat(qtyInput.value);

        if (!info) {
            alert(window.t ? (window.t('alert_stockopname_found_unknown_coffee') || 'Please pick a coffee from the list — this is for stock the system already knows about, not a brand new coffee.') : 'Please pick a coffee from the list — this is for stock the system already knows about, not a brand new coffee.');
            return;
        }
        if (isNaN(machineId) || isNaN(qty) || qty <= 0) {
            alert(window.t ? (window.t('alert_stockopname_found_incomplete') || 'Please complete all fields with a quantity greater than 0.') : 'Please complete all fields with a quantity greater than 0.');
            return;
        }

        const machineName = ((machines || []).find(m => m.id === machineId) || {}).name || '';
        let label, unit, gram = null;
        if (category === 'packed') {
            gram = parseInt(document.getElementById('fi-size').value);
            const sizeLabel = gram >= 1000 ? `${gram / 1000}kg` : `${gram}g`;
            label = `${coffeeName} · ${sizeLabel} · ${machineName}`;
            unit = 'bags';
        } else {
            label = `${coffeeName} · ${machineName}`;
            unit = 'kg';
        }

        // Deliberately does NOT touch real stock here — same as every other
        // row on the sheet, the adjustment only happens at Finalize
        // (finalizeStockTake's foundItemAdjustments branch), so an
        // abandoned/cancelled take never left a found item's stock
        // half-applied.
        const { data: itemRow, error: itemErr } = await saveData('stock_take_items', {
            stock_take_id: currentStockTakeId,
            category, item_name: label, unit,
            system_qty: 0, actual_qty: qty, variance: qty,
            counted: true, counted_at: new Date().toISOString(),
            counted_by: (currentUser && currentUser.name) || null,
            is_found_item: true,
            coffee_code: info.code || null,
            machine_name: machineName || null,
            bag_size_g: gram
        });
        if (itemErr) { console.error('Failed to save found item row:', itemErr); alert('Failed to save found item: ' + itemErr.message); return; }

        currentStockTakeGroups.push({
            category, label, coffeeCode: info.code || '', unit,
            systemQty: 0, rows: [], itemId: itemRow ? itemRow.id : null,
            actualQty: qty, counted: true, isFoundItem: true,
            foundMeta: { coffeeName, machineId, gram }
        });

        document.getElementById('btn-close-modal').click();
        renderStockTakeSheet();
    });
}

// Fase 5 posting: resolves the found item's identity fresh at posting time
// (green_coffee/blend_recipes lookup by name) rather than storing
// single_coffee_id/blend_recipe_id up front — foundMeta is the same shape
// whether it came from a same-session add or a resume reconstruction, so
// this is the one place that needs to know about coffee_type at all.
async function applyFoundItemAdjustment(group, qty, stockTakeId) {
    if (!qty || qty <= 0 || !group.foundMeta) return true;
    const { coffeeName, machineId, gram } = group.foundMeta;
    if (!machineId) { console.error('Found item has no resolvable machine, skipping adjustment:', group.label); return false; }

    if (group.category === 'packed') {
        const row = await getOrCreatePackedCoffeeRow(coffeeName, gram, machineId);
        if (!row) { console.error('Failed to resolve packed row for found item', group.label); return false; }
        return await applyPackedCoffeeManualQtyDelta(row.id, qty, 'stocktake', 'stock_takes', stockTakeId);
    }

    if (group.category === 'bulk') {
        const [{ data: greenbeans }, { data: recipes }, { data: bulkList }] = await Promise.all([
            fetchData('green_coffee'), fetchData('blend_recipes'), fetchData('bulk_roasted_coffee')
        ]);
        const gb = (greenbeans || []).find(g => g.name === coffeeName);
        const recipe = !gb ? (recipes || []).find(r => r.name === coffeeName) : null;
        if (!gb && !recipe) { console.error('Could not resolve coffee identity for found bulk item', group.label); return false; }
        const coffeeType = gb ? 'Single' : 'Blend';
        const singleId = gb ? gb.id : null;
        const blendId = recipe ? recipe.id : null;

        // Same existing-row-vs-fresh-insert shape js/roasting.js's
        // addWeightToBulkRoastedCoffee uses, adapted here since that helper
        // hardcodes mv_operation:'roast' and can't be reused as-is —
        // matched by identity + machine only (not production_date), since
        // a found item has no real roast day to match against; refunding
        // into whatever row already carries this identity is correct
        // regardless of when it was originally roasted, but a brand new
        // row gets today's date rather than guessing an old one.
        const existing = (bulkList || []).find(b =>
            b.coffee_type === coffeeType &&
            (coffeeType === 'Single' ? b.single_coffee_id === singleId : b.blend_recipe_id === blendId) &&
            b.machine_id === machineId && !b.is_repack
        );
        if (existing) {
            // Same null-for-nonexistent-row gap as applyStockGroupAdjustmentToLots'
            // refund_bulk_lot call — check the returned value, not just error.
            const { data, error } = await window.supabaseClient.rpc('refund_bulk_lot', {
                p_bulk_id: existing.id, p_kg: qty,
                p_operation: 'stocktake', p_ref_table: 'stock_takes', p_ref_id: stockTakeId,
                p_user: (currentUser && currentUser.name) || null
            });
            if (error || data === null) { console.error('refund_bulk_lot RPC failed for found item:', error || 'no matching row'); return false; }
        } else {
            const { error } = await saveData('bulk_roasted_coffee', {
                coffee_type: coffeeType,
                single_coffee_id: singleId,
                blend_recipe_id: blendId,
                machine_id: machineId,
                coffee_name: coffeeName,
                bulk_available: qty,
                production_date: new Date().toISOString().split('T')[0],
                mv_operation: 'stocktake', mv_ref_table: 'stock_takes', mv_ref_id: stockTakeId,
                mv_user: (currentUser && currentUser.name) || null
            });
            if (error) { console.error('Failed to insert bulk row for found item:', error); return false; }
        }
    }
    return true;
}

// Fase 6: reads the sheet's current DOM state into everything the review
// modal needs to render AND everything posting needs to execute — kept as
// one function so the two can never disagree about what "this take" means.
// Pure read, no writes — safe to call as many times as needed (the review
// modal calls it once to render, executeStockTakePosting calls it again
// fresh at Post-click time in case anything changed while the modal was open).
function collectStockTakeFinalizeData() {
    const tbody = document.getElementById('stockopname-count-body');
    const lines = [];
    const adjustments = [];
    const detailedLotGroups = [];
    const foundItemGroups = [];
    const itemUpdates = [];
    if (!currentStockTakeGroups || !tbody) {
        return { lines, adjustments, detailedLotGroups, foundItemGroups, itemUpdates, countedCount: 0, skippedCount: 0, varianceCount: 0 };
    }

    // Stock Opname Phase 1 cacat #1 fix: a blank input is no longer
    // coerced into "matches system" — it is skipped entirely, both from
    // the adjustment list and from being marked counted.
    currentStockTakeGroups.forEach((g, i) => {
        const input = tbody.querySelector(`.stockopname-actual-input[data-group-index="${i}"]`);
        const raw = input ? input.value : '';
        if (raw === '') return;
        const actual = parseFloat(raw);
        if (isNaN(actual)) return;

        const variance = actual - g.systemQty;
        // Fase 3: "no adjustment needed" is now decided by
        // stockOpnameIsMatch (tolerance-aware for kg categories), not a
        // bare != 0 check — must stay consistent with what the Status
        // column showed the counter, or a row marked "Match" on screen
        // would still silently trigger a stock adjustment here. The raw
        // variance is still stored on the item row either way — tolerance
        // only decides whether it drives an adjustment, it never hides the
        // true count.
        const matched = stockOpnameIsMatch(g, actual);
        lines.push({ group: g, category: g.category, item_name: g.label, coffeeCode: g.coffeeCode, unit: g.unit, systemQty: g.systemQty, actual, variance, matched });
        if (g.itemId) {
            itemUpdates.push({
                id: g.itemId, actual_qty: actual, variance, counted: true,
                counted_at: new Date().toISOString(), counted_by: (currentUser && currentUser.name) || null
            });
        }
        // Fase 4 cacat #6: a detailed group's per-lot counts are always the
        // ones written to stock, regardless of whether the group's TOTAL
        // happens to match the system total — individual lots can still
        // have shifted against each other even when their sum nets out even
        // (a real risk since detailing exists specifically to catch that).
        // This is checked before the matched/guessed-split branch below so
        // a detailed-and-matching group never silently skips its lot writes.
        if (g.isFoundItem) {
            // Fase 5: a found item's systemQty is always 0 by definition, so
            // it can never "match" — it always needs its stock created,
            // never distributed via the guessed-split branch below (there
            // is nothing existing to distribute against).
            foundItemGroups.push({ group: g, actual });
        } else if (g.detailed && g.category === 'packed' && g.lotBreakdown) {
            detailedLotGroups.push(g);
        } else if (!matched) {
            if (g.stale) {
                // This item's stock_take_items row no longer matches any
                // current group (its source rows changed or vanished since
                // the take was opened — resumeStockTake's stale-row path).
                // The count itself is still saved above so it isn't lost,
                // but there is nothing safe to adjust it against.
                console.warn(`Stock opname: skipping stock adjustment for stale item "${g.label}" — its source rows no longer match. Only the count was recorded.`);
            } else {
                adjustments.push({ group: g, actual });
            }
        }
    });

    const countedCount = lines.length;
    const skippedCount = currentStockTakeGroups.length - countedCount;
    const varianceCount = lines.filter(l => !l.matched).length;
    return { lines, adjustments, detailedLotGroups, foundItemGroups, itemUpdates, countedCount, skippedCount, varianceCount };
}

// Fase 6 (replaces the bare confirm() this used to be): shows what Posting
// will actually do before it happens. Not an approval gate (§2's own
// decision stands) — just makes sure whoever clicks Posting has seen the
// impact, especially the items that will NOT be touched because they were
// never counted.
async function openStockTakeReviewModal() {
    if (!currentStockTakeGroups || !currentStockTakeId) return;
    if (!(await ensureStockTakeCountsSaved())) return;
    const collected = collectStockTakeFinalizeData();
    const { lines, countedCount, skippedCount, varianceCount } = collected;

    const varianceLines = lines.filter(l => !l.matched);
    // A detailed group can still need real lot writes even when its OWN
    // total matches the system total (cacat #6 — see collectStockTakeFinalizeData's
    // comment), which means it wouldn't appear in varianceLines above
    // despite genuinely changing stock. Its lot-level variance rows are
    // surfaced here instead, each carrying its own strip code per §6's spec.
    const detailedLotVarianceRows = [];
    collected.detailedLotGroups.forEach(g => {
        (g.lotBreakdown || []).forEach(l => {
            if (l.actualQty === null || l.actualQty === undefined) return;
            const v = l.actualQty - l.systemQty;
            if (Math.abs(v) < 1e-9) return;
            detailedLotVarianceRows.push({ label: g.label, coffeeCode: g.coffeeCode, stripCode: l.stripCode, systemQty: l.systemQty, actual: l.actualQty, variance: v });
        });
    });

    const rowHtml = (coffeeCode, itemName, systemQty, actual, variance, unit) => `
        <tr>
            <td style="font-family:monospace;">${coffeeCode || '—'}</td>
            <td>${itemName}</td>
            <td class="text-center">${systemQty} ${unit}</td>
            <td class="text-center">${actual} ${unit}</td>
            <td class="text-center" style="font-weight:700; color:${variance > 0 ? 'var(--success)' : 'var(--danger)'};">${formatVarianceText(variance, unit)}</td>
        </tr>`;
    let rowsHtml = varianceLines.map(l => rowHtml(l.coffeeCode, l.item_name, l.systemQty, l.actual, l.variance, l.unit)).join('');
    rowsHtml += detailedLotVarianceRows.map(r => rowHtml(r.coffeeCode, `${r.label} · ${r.stripCode || '-'}`, r.systemQty, r.actual, r.variance, 'bags')).join('');

    const skippedWarning = skippedCount > 0
        ? `<div style="margin-bottom:14px; padding:10px 14px; border-radius:8px; background:rgba(217,119,6,0.1); border:1px solid var(--warning); color:var(--warning); font-size:0.85rem; font-weight:600;">${(window.t ? (window.t('stockopname_review_uncounted_warning') || '{count} item(s) have not been counted and will not be adjusted.') : '{count} item(s) have not been counted and will not be adjusted.').replace('{count}', skippedCount)}</div>`
        : '';

    const html = `
        <div style="display:flex; gap:16px; margin-bottom:14px; flex-wrap:wrap;">
            <div style="flex:1; min-width:110px; padding:10px; border-radius:8px; background:var(--bg-app); text-align:center;">
                <div style="font-size:1.3rem; font-weight:800;">${countedCount}</div>
                <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase;">${window.t ? (window.t('stockopname_review_counted') || 'Counted') : 'Counted'}</div>
            </div>
            <div style="flex:1; min-width:110px; padding:10px; border-radius:8px; background:var(--bg-app); text-align:center;">
                <div style="font-size:1.3rem; font-weight:800; color:${skippedCount > 0 ? 'var(--warning)' : 'inherit'};">${skippedCount}</div>
                <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase;">${window.t ? (window.t('stockopname_review_not_counted') || 'Not Counted') : 'Not Counted'}</div>
            </div>
            <div style="flex:1; min-width:110px; padding:10px; border-radius:8px; background:var(--bg-app); text-align:center;">
                <div style="font-size:1.3rem; font-weight:800; color:${varianceCount > 0 ? 'var(--danger)' : 'inherit'};">${varianceCount}</div>
                <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase;">${window.t ? (window.t('col_variance') || 'Difference') : 'Difference'}</div>
            </div>
        </div>
        ${skippedWarning}
        <div class="table-container" style="max-height:44vh; overflow-y:auto;">
            <table>
                <thead>
                    <tr>
                        <th>${window.t ? (window.t('col_stockopname_code') || 'Code') : 'Code'}</th>
                        <th>${window.t ? (window.t('col_item') || 'Item') : 'Item'}</th>
                        <th style="text-align:center;">${window.t ? (window.t('col_system_qty') || 'System') : 'System'}</th>
                        <th style="text-align:center;">${window.t ? (window.t('col_actual_qty') || 'Actual') : 'Actual'}</th>
                        <th style="text-align:center;">${window.t ? (window.t('col_variance') || 'Difference') : 'Difference'}</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml || `<tr><td colspan="5" class="table-empty-state">${window.t ? (window.t('stockopname_review_no_diff') || 'No differences.') : 'No differences.'}</td></tr>`}</tbody>
            </table>
        </div>
        <div class="modal-footer-actions-lg">
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">${window.t ? (window.t('btn_cancel') || 'Cancel') : 'Cancel'}</button>
            <button type="button" class="btn btn-primary" id="btn-stockopname-post">${window.t ? (window.t('btn_stockopname_post') || 'Posting') : 'Posting'}</button>
        </div>
    `;
    openModal(window.t ? (window.t('stockopname_review_title') || 'Review & Post') : 'Review & Post', html, '680px');

    const postBtn = document.getElementById('btn-stockopname-post');
    if (postBtn) {
        postBtn.onclick = async () => {
            postBtn.disabled = true;
            document.getElementById('btn-close-modal').click();
            await executeStockTakePosting();
        };
    }
}

// Fase 6: the actual posting sequence — `counting` -> `posting` -> write
// every adjustment (marking each item's `posted_at` the moment IT succeeds)
// -> `posted`. Re-collects fresh from the DOM rather than trusting whatever
// the review modal saw, in case anything changed in between.
//
// "Status aman adalah status terkunci" (§5.2): if any adjustment fails,
// status goes back to `counting` — never left sitting in `posting`, which
// the freeze trigger blocks the same as `counting` but has no defined way
// out of on its own. Items that already got `posted_at` keep it, so
// clicking Finalize again resumes past them instead of double-applying —
// checked here via a fresh fetch of stock_take_items, not the in-memory
// group state, so this is safe even after a page reload mid-recovery.
async function executeStockTakePosting() {
    if (!currentStockTakeGroups || !currentStockTakeId) return;
    const takeId = currentStockTakeId;
    const collected = collectStockTakeFinalizeData();
    const { itemUpdates, countedCount, skippedCount, varianceCount } = collected;

    const { data: takes } = await fetchData('stock_takes');
    const takeRow = (takes || []).find(t => t.id === takeId);
    if (!takeRow || (takeRow.status !== 'counting' && takeRow.status !== 'posting')) {
        alert(window.t ? (window.t('alert_stockopname_take_not_open') || 'This stock take is no longer open — reload the page.') : 'This stock take is no longer open — reload the page.');
        return;
    }
    if (takeRow.status === 'counting') {
        const { error: postingErr } = await saveData('stock_takes', { id: takeId, status: 'posting' });
        if (postingErr) { alert('Failed to start posting: ' + postingErr.message); return; }
    }

    // Re-affirming counted values is not a stock write — safe to redo on
    // every attempt regardless of what already posted.
    for (const upd of itemUpdates) await saveData('stock_take_items', upd);

    const { data: freshItems } = await fetchData('stock_take_items');
    const myItems = (freshItems || []).filter(it => it.stock_take_id === takeId);
    const postedItemIds = new Set(myItems.filter(it => it.posted_at).map(it => it.id));

    let failed = false;

    for (const adj of collected.adjustments) {
        if (adj.group.itemId && postedItemIds.has(adj.group.itemId)) continue;
        const ok = await applyStockGroupAdjustmentToLots(adj.group, adj.actual, takeId);
        if (!ok) { failed = true; break; }
        if (adj.group.itemId) await saveData('stock_take_items', { id: adj.group.itemId, posted_at: new Date().toISOString() });
    }

    if (!failed) {
        for (const g of collected.detailedLotGroups) {
            const ok = await applyStockGroupDetailedLotsAdjustment(g, takeId, postedItemIds);
            if (!ok) { failed = true; break; }
            if (g.itemId && !postedItemIds.has(g.itemId)) {
                await saveData('stock_take_items', { id: g.itemId, posted_at: new Date().toISOString() });
            }
        }
    }

    if (!failed) {
        for (const { group, actual } of collected.foundItemGroups) {
            if (group.itemId && postedItemIds.has(group.itemId)) continue;
            const ok = await applyFoundItemAdjustment(group, actual, takeId);
            if (!ok) { failed = true; break; }
            if (group.itemId) await saveData('stock_take_items', { id: group.itemId, posted_at: new Date().toISOString() });
        }
    }

    if (failed) {
        await saveData('stock_takes', { id: takeId, status: 'counting' });
        alert(window.t ? (window.t('alert_stockopname_posting_failed') || 'Posting failed partway through. Adjustments already applied were kept — the take is locked again as "counting". Fix the issue, then use Finalize again to resume from where it stopped.') : 'Posting failed partway through. Adjustments already applied were kept — the take is locked again as "counting". Fix the issue, then use Finalize again to resume from where it stopped.');
        if (typeof resumeStockTake === 'function') await resumeStockTake({ id: takeId, ...takeRow, status: 'counting' });
        return;
    }

    const { error: postedErr } = await saveData('stock_takes', {
        id: takeId,
        status: 'posted',
        posted_at: new Date().toISOString(),
        total_items: currentStockTakeGroups.length,
        variance_items: varianceCount,
        counted_items: countedCount,
        skipped_items: skippedCount,
        notes: (document.getElementById('stockopname-notes') || {}).value || ''
    });
    if (postedErr) {
        alert(window.t ? (window.t('alert_stockopname_post_flip_failed') || 'Adjustments were applied but the take could not be marked posted — it is still locked as "posting". Try Finalize again.') : 'Adjustments were applied but the take could not be marked posted — it is still locked as "posting". Try Finalize again.');
        return;
    }

    alert(window.t ? (window.t('alert_stockopname_saved') || 'Stock take finalized and stock adjusted.') : 'Stock take finalized and stock adjusted.');
    currentStockTakeGroups = null;
    currentStockTakeId = null;
    stockTakeResumeInfo = null;
    _stockOpnamePackedLotsCache = null;
    stockTakeDrafts = new Map();
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
    const allLines = (items || []).filter(it => it.stock_take_id === takeId);
    // Fase 7: children (lot-detail rows, parent_item_id set) render nested
    // under their own parent instead of as flat siblings — mixing them in
    // flatly made a detailed group's dozen lot rows indistinguishable from
    // ordinary top-level items, and inflated the row count misleadingly.
    const topLevel = allLines.filter(l => !l.parent_item_id);
    const childrenByParent = new Map();
    allLines.filter(l => l.parent_item_id).forEach(l => {
        if (!childrenByParent.has(l.parent_item_id)) childrenByParent.set(l.parent_item_id, []);
        childrenByParent.get(l.parent_item_id).push(l);
    });

    const fmtQty = (v, unit) => {
        const n = parseFloat(v);
        if (isNaN(n)) return '-';
        return unit === 'kg' ? n.toFixed(1) : n;
    };

    let rowsHtml = '';
    topLevel.forEach(l => {
        const sys = fmtQty(l.system_qty, l.unit);
        // Stock Opname Phase 1: rows saved before this migration have no
        // `counted` value to trust (it defaults false for all historical
        // data — see the migration's own note), so they fall back to the
        // old always-"counted" display.
        const wasCounted = l.counted === true || l.actual_qty !== null;
        const foundTag = l.is_found_item ? ` <span style="font-size:0.65rem; color:var(--success);" title="${window.t ? (window.t('stockopname_found_row') || 'found item') : 'found item'}">🔍</span>` : '';
        const children = childrenByParent.get(l.id) || [];

        let statusHtml;
        if (!wasCounted) {
            statusHtml = `<span style="color:var(--text-muted); font-style:italic;">${window.t ? (window.t('stockopname_not_counted') || 'Not counted') : 'Not counted'}</span>`;
        } else if (children.length > 0) {
            // A detailed group's own status is "Detailed" regardless of
            // whether its final total happens to match system — same
            // convention the live sheet uses (cacat #6: the lots can still
            // have shifted against each other even when the sum nets even).
            statusHtml = `<span style="color:var(--success); font-weight:700;">📋 ${window.t ? (window.t('stockopname_status_detailed') || 'Detailed') : 'Detailed'}</span>`;
        } else {
            const varN = parseFloat(l.variance) || 0;
            const isMatch = stockOpnameVarianceIsMatch(l.category, parseFloat(l.system_qty) || 0, varN);
            statusHtml = isMatch
                ? `<span style="color:var(--success); font-weight:700;">✓ ${window.t ? (window.t('stockopname_status_match') || 'Match') : 'Match'}</span>`
                : `<span style="color:${varN > 0 ? 'var(--success)' : 'var(--danger)'}; font-weight:700;">${window.t ? (window.t('col_variance') || 'Difference') : 'Difference'} ${formatVarianceText(varN, l.unit)}</span>`;
        }

        const actDisplay = wasCounted ? `${fmtQty(l.actual_qty, l.unit)} ${l.unit}` : '—';

        rowsHtml += `
            <tr>
                <td style="padding:6px 10px; border-bottom:1px solid var(--border); font-family:monospace; font-weight:700;">${l.coffee_code || '—'}</td>
                <td style="padding:6px 10px; border-bottom:1px solid var(--border);">${l.item_name}${foundTag}</td>
                <td style="padding:6px 10px; border-bottom:1px solid var(--border); text-align:center;">${sys} ${l.unit}</td>
                <td style="padding:6px 10px; border-bottom:1px solid var(--border); text-align:center;">${actDisplay}</td>
                <td style="padding:6px 10px; border-bottom:1px solid var(--border); text-align:center;">${statusHtml}</td>
            </tr>`;

        // Lot-detail children — one indented sub-row per lot, strip code as
        // the row's own identity (§4.3's convention: "Tidak ada kolom
        // nomor urut — strip code sudah menjadi penanda baris").
        children.forEach(c => {
            const cVarN = parseFloat(c.variance) || 0;
            const cMatch = Math.abs(cVarN) < 1e-9;
            rowsHtml += `
            <tr style="background:var(--bg-app);">
                <td style="padding:4px 10px 4px 24px; border-bottom:1px solid var(--border); font-family:monospace; font-size:0.78rem; color:var(--text-muted);">${c.strip_code || '-'}</td>
                <td style="padding:4px 10px; border-bottom:1px solid var(--border); font-size:0.78rem; color:var(--text-muted);">${c.lot_code || '-'}</td>
                <td style="padding:4px 10px; border-bottom:1px solid var(--border); text-align:center; font-size:0.78rem; color:var(--text-muted);">${fmtQty(c.system_qty, c.unit)} ${c.unit}</td>
                <td style="padding:4px 10px; border-bottom:1px solid var(--border); text-align:center; font-size:0.78rem; color:var(--text-muted);">${fmtQty(c.actual_qty, c.unit)} ${c.unit}</td>
                <td style="padding:4px 10px; border-bottom:1px solid var(--border); text-align:center; font-size:0.78rem; color:${cMatch ? 'var(--text-muted)' : (cVarN > 0 ? 'var(--success)' : 'var(--danger)')};">${cMatch ? '=' : formatVarianceText(cVarN, c.unit)}</td>
            </tr>`;
        });
    });

    const accuracy = computeStockTakeAccuracy(topLevel);
    const accuracySummary = accuracy
        ? ` <span style="margin-left:10px;">· ${window.t ? (window.t('stockopname_col_accuracy') || 'Accuracy') : 'Accuracy'}: <strong>${accuracy.pct.toFixed(0)}%</strong> (${accuracy.matched}/${accuracy.total})</span>`
        : '';

    const categoryLabel = take
        ? (take.category ? stockCategoryLabel(take.category) : (window.t ? (window.t('stockopname_category_all') || 'All') : 'All'))
        : '';
    const html = `
        <div style="margin-bottom:12px; font-size:0.85rem; color:var(--text-secondary);">
            <strong>${take ? (take.take_date || '') : ''}</strong> — ${categoryLabel} — ${take ? (take.performed_by || '') : ''}${accuracySummary}
            ${take && take.notes ? `<br>${take.notes}` : ''}
        </div>
        <div style="max-height:60vh; overflow-y:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                <thead>
                    <tr>
                        <th style="text-align:left; padding:6px 10px; border-bottom:2px solid var(--border);">${window.t ? (window.t('col_stockopname_code') || 'Code') : 'Code'}</th>
                        <th style="text-align:left; padding:6px 10px; border-bottom:2px solid var(--border);">${window.t ? (window.t('col_item') || 'Item') : 'Item'}</th>
                        <th style="text-align:center; padding:6px 10px; border-bottom:2px solid var(--border);">${window.t ? (window.t('col_system_qty') || 'System') : 'System'}</th>
                        <th style="text-align:center; padding:6px 10px; border-bottom:2px solid var(--border);">${window.t ? (window.t('col_actual_qty') || 'Actual') : 'Actual'}</th>
                        <th style="text-align:center; padding:6px 10px; border-bottom:2px solid var(--border);">${window.t ? (window.t('col_status') || 'Status') : 'Status'}</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml || `<tr><td colspan="5" style="text-align:center; padding:16px; color:var(--text-muted);">No line items.</td></tr>`}</tbody>
            </table>
        </div>
    `;
    openModal(window.t ? (window.t('stockopname_detail_title') || 'Stock Take Detail') : 'Stock Take Detail', html, '760px');
}

// Print a blank counting form (one page per category) for the team to fill in
// physically before typing the numbers back into the system.
// `category` (added for per-category Stock Opname, user request 2026-08-31)
// prints just that one category's page instead of all three — called from
// the History toolbar's category picker. Left null this still prints all
// three pages, kept as a fallback rather than removed.
async function printStockCountForm(category = null) {
    const groups = await buildStockTakeGroups(category);
    const cs = companySettings;
    // Fill each A4 page: aim for a fixed total number of rows so the table reaches
    // the bottom. Empty rows top up whatever the data rows don't cover; if the data
    // alone already exceeds a page, still add a few blanks for write-ins.
    const TARGET_ROWS_PER_PAGE = 22;
    const MIN_EMPTY_ROWS = 4;

    const byCat = { greenbean: [], bulk: [], packed: [] };
    groups.forEach(g => { if (byCat[g.category]) byCat[g.category].push(g); });

    const subtitle = window.t ? (window.t('form_stockcount_subtitle') || 'Stock Count Form') : 'Stock Count Form';
    const tHeaderCode = window.t ? (window.t('col_stockopname_code') || 'Code') : 'Code';
    const tHeaderItem = window.t ? (window.t('col_item') || 'Item') : 'Item';
    const tHeaderSystem = window.t ? (window.t('col_system_qty') || 'System') : 'System';
    const tHeaderActual = window.t ? (window.t('col_actual_qty') || 'Actual') : 'Actual';
    const tHeaderNotes = window.t ? (window.t('col_notes') || 'Notes') : 'Notes';
    const tDate = window.t ? (window.t('col_date') || 'Date') : 'Date';
    const tBy = window.t ? (window.t('col_performed_by') || 'Counted By') : 'Counted By';

    const tMachine = window.t ? (window.t('tracking_lbl_machine') || 'Machine') : 'Machine';

    // Same row order as the count sheet (sortStockTakeGroups). Packed is
    // counted one machine's shelf at a time, so it prints one page per
    // machine: the machine moves from every row's label to the page header,
    // and the blank write-in rows belong to that machine.
    function pagesFor(catKey) {
        const list = sortStockTakeGroups(byCat[catKey] || []);
        if (catKey !== 'packed') return [{ catKey, machine: null, list }];
        const byMachine = new Map();
        list.forEach(g => {
            const m = stockGroupMachine(g);
            if (!byMachine.has(m)) byMachine.set(m, []);
            byMachine.get(m).push(g);
        });
        if (byMachine.size === 0) return [{ catKey, machine: null, list: [] }];
        return [...byMachine.entries()].map(([m, rows]) => ({
            catKey, machine: m,
            list: rows.map(g => ({ ...g, label: g.label.endsWith(` · ${m}`) ? g.label.slice(0, -(m.length + 3)) : g.label }))
        }));
    }

    function renderPage({ catKey, machine, list }, isLast) {
        let rows = '';
        list.forEach(g => {
            const sys = g.unit === 'kg' ? g.systemQty.toFixed(1) : g.systemQty;
            rows += `<tr>
                <td class="c" style="font-weight:700;">${g.coffeeCode || ''}</td>
                <td>${g.label}</td>
                <td class="c">${sys} ${g.unit}</td>
                <td class="blank"></td>
                <td class="blank"></td>
            </tr>`;
        });
        const emptyCount = Math.max(TARGET_ROWS_PER_PAGE - list.length, MIN_EMPTY_ROWS);
        for (let i = 0; i < emptyCount; i++) {
            rows += `<tr>
                <td class="blank"></td>
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
                    ${machine ? `<div class="doc-machine">${tMachine}: ${machine}</div>` : ''}
                    <div class="doc-sub">${subtitle}</div>
                </div>
            </div>
            <div class="meta">
                <span>${tDate}: _______________________</span>
                <span>${tBy}: _______________________</span>
            </div>
            <table>
                <thead>
                    ${machine ? `<tr class="machine-row"><th colspan="5">${stockCategoryLabel(catKey)} · ${tMachine}: ${machine}</th></tr>` : ''}
                    <tr>
                        <th style="width:60px;">${tHeaderCode}</th>
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

    const pageSpecs = (category ? [category] : ['greenbean', 'bulk', 'packed']).flatMap(pagesFor);
    const pages = pageSpecs.map((p, i) => renderPage(p, i === pageSpecs.length - 1)).join('');

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
        .doc-machine { display: inline-block; margin-top: 4px; padding: 2px 10px; border: 1.5px solid #2d5016; border-radius: 4px; font-size: 13px; font-weight: 800; color: #2d5016; }
        .meta { display: flex; gap: 40px; font-size: 11px; color: #555; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; }
        thead th { background: #2d5016; color: #fff; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; text-align: left; border: 1px solid #2d5016; }
        tbody td { padding: 6px 10px; border: 1px solid #cfcfcf; font-size: 12px; height: 26px; }
        tbody td.c { text-align: center; }
        tbody td.blank { background: #fff; }
        /* Lives in <thead>, so the browser repeats it on every printed sheet
           of a machine's list, not only the first. */
        thead { display: table-header-group; }
        thead tr.machine-row th { background: #e6eedf; color: #2d5016; font-size: 12px; letter-spacing: 0.3px; padding: 7px 10px; border: 1px solid #2d5016; }
        tbody tr { page-break-inside: avoid; }
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

