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
                roasting_view: true, roasting_plan_add: true, roasting_plan_edit: true, roasting_plan_delete: true,
                roasting_batch_view: true, roasting_batch_add: true, roasting_batch_edit: true, roasting_batch_delete: true, roasting_batch_approve: true,
                blend_view: true, blend_add: true, blend_edit: true, blend_delete: true,
                production_potential_view: true,
                packing_view: true, packing_daily: true, packing_order_view: true, packing_records_view: true, packing_unpack: true, packing_completed_view: true,
                sales_request_view: true, sales_request_create: true, sales_request_edit: true, sales_request_delete: true, sales_request_print: true,
                dispatch_approval_view: true, dispatch_approval_approve: true, dispatch_approval_dispatch: true, dispatch_approval_print: true,
                customer_view: true, customer_add: true, customer_edit: true, customer_delete: true,
                reports_view: true, reports_stockopname_view: true,
                settings_general: true, settings_production: true, settings_system: true,
                user_management: true
            }
        },
        {
            id: 2, name: 'Admin', color: '#dc2626', is_system: true,
            permissions: {
                dashboard: true,
                greenbean_view: true, greenbean_delete: true,
                greenbean_arrival_view: true, greenbean_arrival_add: true, greenbean_arrival_edit: true, greenbean_arrival_delete: true,
                roasting_view: true, roasting_plan_add: true, roasting_plan_edit: true, roasting_plan_delete: true,
                roasting_batch_view: true, roasting_batch_add: true, roasting_batch_edit: true, roasting_batch_delete: true, roasting_batch_approve: true,
                blend_view: true, blend_add: true, blend_edit: true, blend_delete: true,
                production_potential_view: true,
                packing_view: true, packing_daily: true, packing_order_view: true, packing_records_view: true, packing_unpack: true, packing_completed_view: true,
                sales_request_view: true, sales_request_create: true, sales_request_edit: true, sales_request_delete: true, sales_request_print: true,
                dispatch_approval_view: true, dispatch_approval_approve: true, dispatch_approval_dispatch: true, dispatch_approval_print: true,
                customer_view: true, customer_add: true, customer_edit: true, customer_delete: true,
                reports_view: true, reports_stockopname_view: true,
                settings_general: true, settings_production: true, settings_system: true,
                user_management: true
            }
        },
        {
            id: 3, name: 'Production Leader', color: '#2d5016', is_system: false,
            permissions: {
                dashboard: true,
                greenbean_view: true, greenbean_delete: true,
                greenbean_arrival_view: true, greenbean_arrival_add: true, greenbean_arrival_edit: true, greenbean_arrival_delete: true,
                roasting_view: true, roasting_plan_add: true, roasting_plan_edit: true, roasting_plan_delete: true,
                roasting_batch_view: true, roasting_batch_add: true, roasting_batch_edit: true, roasting_batch_delete: true, roasting_batch_approve: true,
                blend_view: true, blend_add: true, blend_edit: true, blend_delete: true,
                production_potential_view: true,
                packing_view: true, packing_daily: true, packing_order_view: true, packing_records_view: true, packing_unpack: true, packing_completed_view: true,
                sales_request_view: true, sales_request_create: false, sales_request_edit: false, sales_request_delete: false, sales_request_print: true,
                dispatch_approval_view: true, dispatch_approval_approve: true, dispatch_approval_dispatch: true, dispatch_approval_print: true,
                customer_view: true, customer_add: false, customer_edit: false, customer_delete: false,
                reports_view: true, reports_stockopname_view: true,
                settings_general: false, settings_production: true, settings_system: false,
                user_management: false
            }
        },
        {
            id: 4, name: 'Roaster', color: '#b45309', is_system: false,
            permissions: {
                dashboard: true,
                greenbean_view: true, greenbean_delete: false,
                greenbean_arrival_view: false, greenbean_arrival_add: false, greenbean_arrival_edit: false, greenbean_arrival_delete: false,
                roasting_view: true, roasting_plan_add: false, roasting_plan_edit: false, roasting_plan_delete: false,
                roasting_batch_view: true, roasting_batch_add: true, roasting_batch_edit: false, roasting_batch_delete: false, roasting_batch_approve: false,
                blend_view: true, blend_add: false, blend_edit: false, blend_delete: false,
                production_potential_view: true,
                packing_view: false, packing_daily: false, packing_order_view: false, packing_records_view: false, packing_unpack: false, packing_completed_view: false,
                sales_request_view: false, sales_request_create: false, sales_request_edit: false, sales_request_delete: false, sales_request_print: false,
                dispatch_approval_view: false, dispatch_approval_approve: false, dispatch_approval_dispatch: false, dispatch_approval_print: false,
                customer_view: false, customer_add: false, customer_edit: false, customer_delete: false,
                reports_view: false, reports_stockopname_view: false,
                settings_general: false, settings_production: false, settings_system: false,
                user_management: false
            }
        },
        {
            id: 5, name: 'Packing Team', color: '#0369a1', is_system: false,
            permissions: {
                dashboard: true,
                greenbean_view: false, greenbean_delete: false,
                greenbean_arrival_view: false, greenbean_arrival_add: false, greenbean_arrival_edit: false, greenbean_arrival_delete: false,
                roasting_view: false, roasting_plan_add: false, roasting_plan_edit: false, roasting_plan_delete: false,
                roasting_batch_view: false, roasting_batch_add: false, roasting_batch_edit: false, roasting_batch_delete: false, roasting_batch_approve: false,
                blend_view: false, blend_add: false, blend_edit: false, blend_delete: false,
                production_potential_view: false,
                packing_view: true, packing_daily: true, packing_order_view: true, packing_records_view: true, packing_unpack: true, packing_completed_view: true,
                sales_request_view: true, sales_request_create: false, sales_request_edit: false, sales_request_delete: false, sales_request_print: false,
                dispatch_approval_view: false, dispatch_approval_approve: false, dispatch_approval_dispatch: false, dispatch_approval_print: false,
                customer_view: false, customer_add: false, customer_edit: false, customer_delete: false,
                reports_view: false, reports_stockopname_view: false,
                settings_general: false, settings_production: false, settings_system: false,
                user_management: false
            }
        },
        {
            id: 6, name: 'Sales Agent', color: '#7c3aed', is_system: false,
            permissions: {
                dashboard: true,
                greenbean_view: false, greenbean_delete: false,
                greenbean_arrival_view: false, greenbean_arrival_add: false, greenbean_arrival_edit: false, greenbean_arrival_delete: false,
                roasting_view: false, roasting_plan_add: false, roasting_plan_edit: false, roasting_plan_delete: false,
                roasting_batch_view: false, roasting_batch_add: false, roasting_batch_edit: false, roasting_batch_delete: false, roasting_batch_approve: false,
                blend_view: false, blend_add: false, blend_edit: false, blend_delete: false,
                production_potential_view: false,
                packing_view: false, packing_daily: false, packing_order_view: false, packing_records_view: false, packing_unpack: false, packing_completed_view: false,
                sales_request_view: true, sales_request_create: true, sales_request_edit: true, sales_request_delete: true, sales_request_print: true,
                dispatch_approval_view: false, dispatch_approval_approve: false, dispatch_approval_dispatch: false, dispatch_approval_print: false,
                customer_view: true, customer_add: true, customer_edit: true, customer_delete: false,
                reports_view: true, reports_stockopname_view: true,
                settings_general: false, settings_production: false, settings_system: false,
                user_management: false
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

    // Label settings
    if (document.getElementById('sett-label-width')) {
        document.getElementById('sett-label-width').value = companySettings.label_width || 50;
        document.getElementById('sett-label-height').value = companySettings.label_height || 30;
        document.getElementById('sett-label-show-code').checked = companySettings.label_show_code !== false;
        document.getElementById('sett-label-show-coffee').checked = companySettings.label_show_coffee !== false;
        document.getElementById('sett-label-show-date').checked = companySettings.label_show_date !== false;
        document.getElementById('sett-label-show-machine').checked = companySettings.label_show_machine !== false;
        document.getElementById('sett-label-show-weight').checked = companySettings.label_show_weight !== false;
        document.getElementById('sett-label-show-dep').checked = companySettings.label_show_dep !== false;
        document.getElementById('sett-label-show-operator').checked = companySettings.label_show_operator !== false;
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
    'sec-customers': { title: 'Customer Management', subtitle: 'Manage wholesale and retail customers' }
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
            await loadPackingSection();
            break;
        case 'sec-customers':
            await loadCustomersSection();
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
        'tab-recipe-potential': 'production_potential_view',
        // Greenbean tabs
        'tab-add-gb-history': 'greenbean_arrival_view',
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
    if (btnCustomPacking) btnCustomPacking.style.display = hasPermission('packing_daily') ? '' : 'none';
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

let _customerFilterType = 'all';

function filterCustomers(type) {
    _customerFilterType = type;
    document.querySelectorAll('.customer-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === type);
    });
    loadCustomersSection();
}

async function loadCustomersSection(filterType) {
    if (filterType) _customerFilterType = filterType;
    const { data: customers } = await fetchData('customers');
    const tbody = document.getElementById('customers-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const searchVal = (document.getElementById('customer-search')?.value || '').toLowerCase();
    
    let filtered = (customers || []).filter(c => {
        if (_customerFilterType !== 'all' && c.type !== _customerFilterType) return false;
        if (searchVal && !c.name.toLowerCase().includes(searchVal) && !c.customer_id.toLowerCase().includes(searchVal)) return false;
        return true;
    });
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--text-muted); padding: 32px 0;">No customers found</td></tr>';
        return;
    }
    
    filtered.forEach(c => {
        const typeBadge = c.type === 'Wholesale' 
            ? '<span style="background:var(--primary-light); color:var(--primary); padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">🏭 Wholesale</span>'
            : '<span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">☕ Retail</span>';
        
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

async function openCustomerModal(editId = null) {
    const { data: customers } = await fetchData('customers');
    let existing = null;
    if (editId) {
        existing = (customers || []).find(c => c.id === editId);
    }
    
    const html = `
        <form id="modal-customer-form" novalidate>
            <div class="form-row">
                <div class="form-group" style="flex:1;">
                    <label class="form-label">Customer ID</label>
                    <input type="text" id="m-cust-id" class="form-control" readonly placeholder="Auto Generated" value="${existing ? existing.customer_id : ''}">
                </div>
                <div class="form-group" style="flex:1;">
                    <label class="form-label">Type</label>
                    <select id="m-cust-type" class="form-control" ${editId ? 'disabled' : ''} required>
                        <option value="Wholesale" ${existing?.type === 'Wholesale' ? 'selected' : ''}>🏭 Wholesale</option>
                        <option value="Retail" ${existing?.type === 'Retail' || !existing ? 'selected' : ''}>☕ Retail</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Customer / Company Name</label>
                <input type="text" id="m-cust-name" class="form-control" required value="${existing ? existing.name : ''}" placeholder="e.g. PT Kopi Nusantara">
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1;">
                    <label class="form-label">Contact Person</label>
                    <input type="text" id="m-cust-contact" class="form-control" value="${existing?.contact_person || ''}" placeholder="PIC name">
                </div>
                <div class="form-group" style="flex:1;">
                    <label class="form-label">Phone</label>
                    <input type="text" id="m-cust-phone" class="form-control" value="${existing?.phone || ''}" placeholder="08xxx">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1;">
                    <label class="form-label">Email</label>
                    <input type="email" id="m-cust-email" class="form-control" value="${existing?.email || ''}" placeholder="email@example.com">
                </div>
                <div class="form-group" style="flex:1;">
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
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">${editId ? 'Save Changes' : 'Add Customer'}</button>
            </div>
        </form>
    `;
    
    openModal(editId ? 'Edit Customer' : 'Add New Customer', html, '650px');
    
    // Auto-generate customer ID for new customers
    const typeSelect = document.getElementById('m-cust-type');
    const custIdInput = document.getElementById('m-cust-id');
    
    async function generateCustomerId() {
        const type = typeSelect.value;
        const prefix = type === 'Wholesale' ? 'WHL' : 'RTL';
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
    
    // Form submit
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
        
        const { error } = await saveData('customers', record);
        if (error) {
            alert('Failed to save customer: ' + error.message);
        } else {
            document.getElementById('btn-close-modal').click();
            await loadCustomersSection();
        }
    });
}

async function deleteCustomer(id) {
    if (!confirm('Are you sure you want to delete this customer?')) return;
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
    
    const [
        { data: orders },
        { data: orderItems }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items')
    ]);
    
    const custOrders = (orders || []).filter(o => o.customer_id === customerId);
    
    let historyHtml = '';
    if (custOrders.length === 0) {
        historyHtml = '<p style="text-align:center; color:var(--text-muted); padding:20px;">No order history for this customer</p>';
    } else {
        historyHtml = `<table class="data-table" style="width:100%;">
            <thead><tr>
                <th>Order #</th><th>Date</th><th>Items</th><th>Status</th>
            </tr></thead><tbody>`;
        
        custOrders.sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''));
        
        custOrders.forEach(o => {
            const items = (orderItems || []).filter(i => i.request_order_id === o.id);
            const itemsSummary = items.map(i => `${i.coffee_name || 'Item'} (${i.grind || '-'}, ${i.size_g || '-'}g x${i.quantity || 0})`).join('<br>');
            const statusColor = o.status === 'Dispatched' ? 'var(--success)' : o.status === 'Approved' ? 'var(--primary)' : 'var(--warning)';
            
            historyHtml += `<tr>
                <td><code>${o.order_number || '#ORD-'+o.id}</code></td>
                <td>${o.order_date || '-'}</td>
                <td style="font-size:0.8rem;">${itemsSummary || '-'}</td>
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
    
    openModal(`Customer: ${customer.name}`, html, '800px');
}

async function loadTabSpecificData(tabId) {
    switch (tabId) {
        case 'tab-green-inventory':
            await loadGreenbeanInventory();
            break;
        case 'tab-add-gb-history':
            await loadIntakeHistory();
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
            mtdRoastTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">${window.t ? window.t("msg_no_roast_mtd") || "No roasting output this month" : "No roasting output this month"}</td></tr>`;
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


// ==========================================================================
// SECTION 4: PACKING & RETAIL INVENTORY
// ==========================================================================
async function loadPackingSection() {
    // 1. Initialize Tabs (run once)
    const nav = document.getElementById('packing-tabs-nav');
    if (nav && !nav.hasAttribute('data-init')) {
        nav.setAttribute('data-init', 'true');
        const tabBtns = nav.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                // Remove active from all
                tabBtns.forEach(b => {
                    b.classList.remove('active');
                    b.style.color = 'var(--text-secondary)';
                    b.style.borderBottomColor = 'transparent';
                });
                // Add active to clicked
                btn.classList.add('active');
                btn.style.color = 'var(--primary)';
                btn.style.borderBottomColor = 'var(--primary)';
                
                // Hide all contents
                document.querySelectorAll('.packing-tab-content').forEach(c => c.classList.add('hidden'));
                
                // Show target
                const target = document.getElementById(btn.getAttribute('data-target'));
                if (target) target.classList.remove('hidden');
                
                // If it's the requests tab, load data
                if (btn.getAttribute('data-target') === 'tab-order-request') {
                    loadPackingRequestsSection();
                } else if (btn.getAttribute('data-target') === 'tab-packing-history') {
                    loadPackingHistorySection();
                } else if (btn.getAttribute('data-target') === 'tab-packing-records') {
                    loadPackingRecordsTable();
                }
            });
        });
    }

    // Autofill date field
    const packingDateEl = document.getElementById('packing-date');
    if (packingDateEl && !packingDateEl.value) {
        packingDateEl.value = new Date().toISOString().split('T')[0];
    }

    const [
        { data: bulkList },
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: packagingSizes }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('packaging_sizes')
    ]);
    
    const rowsContainer = document.getElementById('packing-sheet-rows');
    if (!rowsContainer) return;
    
    // Clear and rebuild rows
    rowsContainer.innerHTML = '';
    
    addPackingRow(bulkList, greenbeans, recipes, machines, packagingSizes);
    
    // Wire up Add Row button
    const btnAdd = document.getElementById('btn-add-packing-sheet-row');
    if (btnAdd) {
        btnAdd.onclick = (e) => {
            e.preventDefault();
            const currentRows = document.querySelectorAll('.packing-sheet-row').length;
            if (currentRows >= 4) {
                alert(window.t ? window.t("msg_max_four_coffee") : "Maximum 4 coffee boxes allowed at a time.");
                return;
            }
            addPackingRow(bulkList, greenbeans, recipes, machines, packagingSizes);
        };
    }
    
    // Wire up Form Submission
    const form = document.getElementById('packing-sheet-form');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            await submitPackingSheet();
        };
    }
}

async function loadPackingRecordsTable() {
    const { data: records } = await fetchData('packing_records');
    const tbody = document.getElementById('packing-records-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No packing records found.</td></tr>`;
        return;
    }

    const sorted = [...records].sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);

    sorted.forEach(rec => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${rec.date || '-'}</td>
            <td><strong>${rec.coffee_name || '-'}</strong></td>
            <td>${rec.machine_name || '-'}</td>
            <td>${rec.size_label || (rec.bag_size_g ? (rec.bag_size_g >= 1000 ? `${rec.bag_size_g/1000}kg` : `${rec.bag_size_g}g`) : '-')}</td>
            <td>${rec.quantity || 0}</td>
        `;
        tbody.appendChild(tr);
    });
}

// === Export: Packing Records ===
document.getElementById('btn-export-packing-records').addEventListener('click', () => {
    openExportPackingRecordsModal();
});

async function openExportPackingRecordsModal() {
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = today.substring(0, 8) + '01';
    const html = `
        <form id="modal-export-packing-records-form">
            <div style="margin-bottom: 16px; color: var(--text-secondary); font-size: 0.9rem;">
                Select the date range for the packing records you want to export.
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">From Date</label>
                    <input type="date" id="m-export-pack-from" class="form-control" value="${firstOfMonth}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">To Date</label>
                    <input type="date" id="m-export-pack-to" class="form-control" value="${today}" required>
                </div>
            </div>
            <div id="export-pack-preview-count" style="margin-bottom: 16px; font-size: 0.85rem; color: var(--text-muted); font-style: italic;"></div>
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Export
                </button>
            </div>
        </form>
    `;
    openModal('Export Packing Records', html, '450px');

    const fromEl = document.getElementById('m-export-pack-from');
    const toEl = document.getElementById('m-export-pack-to');
    const previewEl = document.getElementById('export-pack-preview-count');
    const { data: records } = await fetchData('packing_records');

    const updatePreview = () => {
        const from = fromEl.value;
        const to = toEl.value;
        if (!from || !to) { previewEl.textContent = ''; return; }
        const count = (records || []).filter(r => r.date >= from && r.date <= to).length;
        previewEl.textContent = `${count} record(s) found in selected range.`;
    };
    fromEl.addEventListener('change', updatePreview);
    toEl.addEventListener('change', updatePreview);
    updatePreview();

    document.getElementById('modal-export-packing-records-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fromDate = fromEl.value;
        const toDate = toEl.value;
        if (fromDate > toDate) { alert('From Date must be before or equal to To Date.'); return; }

        const filtered = (records || [])
            .filter(r => r.date >= fromDate && r.date <= toDate)
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        if (filtered.length === 0) {
            await showWarningModal('No packing records found in the selected date range.', false);
            return;
        }

        const rows = filtered.map(r => ({
            'Date': r.date || '-',
            'Coffee Name': r.coffee_name || '-',
            'Machine': r.machine_name || '-',
            'Size': r.size_label || '-',
            'Quantity': r.quantity || 0
        }));
        exportToExcel(rows, `Packing_Records_${fromDate}_to_${toDate}`);
        document.getElementById('btn-close-modal').click();
    });
}

async function loadPackingRequestsSection() {
    const [
        { data: orders },
        { data: orderItems },
        { data: greenbeans },
        { data: recipes },
        { data: packedGoods },
        { data: roastBatches },
        { data: machines },
        { data: customers }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('machines'),
        fetchData('customers')
    ]);
    
    const tbody = document.getElementById('packing-requests-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    // Filter only orders in "Preparing" status
    const preparingOrders = (orders || []).filter(o => o.status === 'Preparing');
    
    if (preparingOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">${window.t ? window.t("msg_no_preparing") : "No preparing orders found."}</td></tr>`;
        return;
    }
    
    // Build a stock lookup map: "Type-CoffeeId-SizeG" -> total stock
    const batchMap = new Map();
    (roastBatches || []).forEach(b => batchMap.set(b.id, b));
    
    const stockMap = new Map();
    (packedGoods || []).forEach(p => {
        if (p.roast_batch_id) {
            const batch = batchMap.get(p.roast_batch_id);
            if (batch) {
                const cId = batch.coffee_type === 'Single' ? batch.single_coffee_id : batch.blend_recipe_id;
                const key = `${batch.coffee_type}-${cId}-${p.bag_size_g}`;
                stockMap.set(key, (stockMap.get(key) || 0) + (parseInt(p.quantity) || 0));
            }
        }
        if (!p.roast_batch_id && p.custom_coffee_name) {
            const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
            const matchGb = (greenbeans || []).find(g => g.name === cleanName);
            if (matchGb) {
                const key = `Single-${matchGb.id}-${p.bag_size_g}`;
                stockMap.set(key, (stockMap.get(key) || 0) + (parseInt(p.quantity) || 0));
            } else {
                const matchRec = (recipes || []).find(r => r.name === cleanName);
                if (matchRec) {
                    const key = `Blend-${matchRec.id}-${p.bag_size_g}`;
                    stockMap.set(key, (stockMap.get(key) || 0) + (parseInt(p.quantity) || 0));
                }
            }
        }
    });
    
    // Sort by order_date descending
    preparingOrders.sort((a, b) => new Date(b.order_date) - new Date(a.order_date) || b.id - a.id);
    const limitedPreparingOrders = preparingOrders.slice(0, 50);
    
    let tbodyHtml = '';
    for (const order of limitedPreparingOrders) {
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);
        
        // Check if ALL items in this order are fully prepared
        const allItemsReady = items.length > 0 && items.every(i => {
            const req = parseInt(i.quantity_requested) || 0;
            const prep = parseInt(i.quantity_prepared) || 0;
            return prep >= req;
        });
        
        let itemsHtml = `<div style="display: flex; flex-direction: column; gap: 8px;">`;
        for (const item of items) {
            const type = item.coffee_type;
            const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
            
            let coffeeName = '';
            if (type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === coffeeId);
                coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
            } else {
                const r = (recipes || []).find(rec => rec.id === coffeeId);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
            }
            
            // Machine info
            const itemMachine = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
            const machineTag = itemMachine ? `<span style="font-size:0.72rem; color:#0891b2; font-weight:600; background:rgba(6,182,212,0.1); padding:1px 6px; border-radius:4px; margin-left:6px;">${itemMachine.name}</span>` : '';
            
            const totalRequested = parseInt(item.quantity_requested) || 0;
            const alreadyPrepared = parseInt(item.quantity_prepared) || 0;
            const pendingPack = Math.max(0, totalRequested - alreadyPrepared);
            const isCompleted = alreadyPrepared >= totalRequested;
            
            // Get current packed stock for this coffee+size
            const stockKey = `${type}-${coffeeId}-${item.bag_size_g}`;
            const currentStock = stockMap.get(stockKey) || 0;
            
            // Max the user can input = min(pendingPack, currentStock)
            const maxReady = Math.min(pendingPack, currentStock);
            
            // If ALL items ready, hide individual Ready buttons — Dispatch button shown at order level
            let packHtml = '';
            if (allItemsReady) {
                packHtml = `
                    <span style="color: var(--success); font-weight: bold; font-size: 0.8rem; display: flex; align-items: center; gap: 4px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        Completed
                    </span>
                `;
            } else if (isCompleted) {
                packHtml = `
                    <span style="color: var(--success); font-weight: bold; font-size: 0.8rem; display: flex; align-items: center; gap: 4px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        Completed
                    </span>
                `;
            } else {
                packHtml = `
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <input type="number" class="form-control inp-prepared" min="0" max="${maxReady}" data-max="${maxReady}" value="0" style="width: 80px; padding: 4px 8px;" placeholder="0">
                        <button class="btn btn-primary btn-sm btn-mark-ready" data-id="${item.id}" data-order="${order.id}" ${maxReady === 0 ? 'disabled style="opacity:0.5; pointer-events:none;"' : ''}>Ready</button>
                    </div>
                `;
            }
            
            // Build info line
            let infoLine = `Requested: <strong>${totalRequested}</strong> | From Stock: <strong>${currentStock}</strong>`;
            if (alreadyPrepared > 0 && !isCompleted) {
                infoLine += ` | Prepared: <strong style="color: var(--primary);">${alreadyPrepared}</strong> | Pending Pack: <strong style="color: var(--danger);">${pendingPack}</strong>`;
            } else if (!isCompleted) {
                infoLine += ` | Pending Pack: <strong style="color: var(--danger);">${pendingPack}</strong>`;
            } else {
                infoLine += ` | Prepared: <strong style="color: var(--success);">${alreadyPrepared}</strong>`;
            }
            
            itemsHtml += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: ${allItemsReady ? 'rgba(16,185,129,0.06)' : 'rgba(0,0,0,0.02)'}; padding: 8px; border-radius: 4px; border: 1px solid ${allItemsReady ? 'rgba(16,185,129,0.25)' : 'var(--border-color)'};">
                    <div style="font-size: 0.85rem;">
                        <strong>${coffeeName}</strong> - ${item.bag_size_g}g${machineTag}<br/>
                        <span style="color: var(--text-secondary); font-size: 0.75rem;">
                            ${infoLine}
                        </span>
                    </div>
                    <div>
                        ${packHtml}
                    </div>
                </div>
            `;
        }
        itemsHtml += `</div>`;
        
        // Dispatch button (shown when ALL items are ready)
        const dispatchBtnHtml = allItemsReady ? `
            <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
                <button class="btn btn-success btn-sm btn-dispatch-order" data-order="${order.id}" style="padding: 6px 20px; font-weight: 700; font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                    Dispatch
                </button>
            </div>
        ` : '';
        
        tbodyHtml += `
        <tr>
            <td style="vertical-align: top; padding-top: 12px;">
                ${order.order_date}<br/>
                <code>${order.order_number || '#ORD-'+order.id}</code>
            </td>
            <td style="vertical-align: top; padding-top: 12px;">
                <strong>${order.sales_name}</strong>
                ${(() => { const cust = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null; return cust ? `<br/><span style="font-size:0.75rem; color:var(--text-secondary);">👤 ${cust.name}</span>` : ''; })()}
            </td>
            <td style="vertical-align: top; padding-top: 12px;">${itemsHtml}${dispatchBtnHtml}</td>
            <td style="vertical-align: top; padding-top: 12px;">
                <button class="btn btn-secondary btn-sm btn-print-order" data-id="${order.id}" style="display:inline-flex; align-items:center; gap:4px; white-space:nowrap;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    Print Order
                </button>
            </td>
        </tr>
        `;
    }
    tbody.innerHTML = tbodyHtml;
    
    // Clamp input value in real-time
    tbody.addEventListener('input', function(e) {
        const inp = e.target.closest('.inp-prepared');
        if (inp) {
            const max = parseInt(inp.getAttribute('data-max')) || 0;
            let val = parseInt(inp.value) || 0;
            if (val < 0) { inp.value = 0; }
            if (val > max) { inp.value = max; }
        }
    });
    
    // EVENT DELEGATION
    tbody.onclick = async function(e) {
        // Handle Ready button
        const btnReady = e.target.closest('.btn-mark-ready');
        if (btnReady) {
            const itemId = parseInt(btnReady.getAttribute('data-id'));
            const orderId = parseInt(btnReady.getAttribute('data-order'));
            const inp = btnReady.closest('div').querySelector('.inp-prepared');
            const max = parseInt(inp.getAttribute('data-max')) || 0;
            let qtyToReady = parseInt(inp.value) || 0;
            
            if (qtyToReady <= 0) {
                await showWarningModal('Please enter a quantity greater than 0.', false);
                return;
            }
            
            // Enforce max limit
            if (qtyToReady > max) {
                qtyToReady = max;
                inp.value = max;
            }
            
            await markOrderItemReady(orderId, itemId, qtyToReady);
            return;
        }
        
        // Handle Dispatch button
        const btnDispatch = e.target.closest('.btn-dispatch-order');
        if (btnDispatch) {
            const orderId = parseInt(btnDispatch.getAttribute('data-order'));
            if (!await showWarningModal('Dispatch this order? This confirms the sales team has picked up the packed items.')) return;
            await dispatchOrder(orderId);
            return;
        }
        
        // Handle Print Order button
        const btnPrint = e.target.closest('.btn-print-order');
        if (btnPrint) {
            const orderId = parseInt(btnPrint.getAttribute('data-id'));
            await printOrderDetail(orderId);
        }
    };
}

async function markOrderItemReady(orderId, itemId, qtyToReady) {
    const [
        { data: orderItems },
        { data: packedGoods },
        { data: greenbeans },
        { data: recipes },
        { data: roastBatches }
    ] = await Promise.all([
        fetchData('request_order_items'),
        fetchData('packed_coffee'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('roast_batches')
    ]);
    
    const item = orderItems.find(i => i.id === itemId);
    if (!item) return;
    
    const totalRequested = parseInt(item.quantity_requested) || 0;
    const alreadyPrepared = parseInt(item.quantity_prepared) || 0;
    const pendingPack = totalRequested - alreadyPrepared;
    
    // Clamp qty: cannot exceed pending
    const actualQty = Math.min(qtyToReady, pendingPack);
    if (actualQty <= 0) return;
    
    // Deduct from packed_coffee stock
    const type = item.coffee_type;
    const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
    
    const matchingPacked = (packedGoods || []).filter(p => {
        if (p.roast_batch_id) {
            const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
            if (!batch) return false;
            return batch.coffee_type === type && (type === 'Single' ? batch.single_coffee_id === coffeeId : batch.blend_recipe_id === coffeeId);
        }
        if (p.custom_coffee_name) {
            const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
            if (type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === coffeeId);
                return gb && gb.name === cleanName;
            } else {
                const rec = (recipes || []).find(r => r.id === coffeeId);
                return rec && rec.name === cleanName;
            }
        }
        return false;
    });
    const szItems = matchingPacked.filter(p => parseInt(p.bag_size_g) === parseInt(item.bag_size_g));
    
    let remainingDeduct = actualQty;
    for (const p of szItems) {
        if (remainingDeduct <= 0) break;
        let avail = parseInt(p.quantity) || 0;
        if (avail > 0) {
            let take = Math.min(avail, remainingDeduct);
            p.quantity = avail - take;
            remainingDeduct -= take;
            await saveData('packed_coffee', p);
        }
    }
    
    // Update item: increment prepared, update status
    const newPrepared = alreadyPrepared + actualQty;
    item.quantity_prepared = newPrepared;
    
    if (newPrepared >= totalRequested) {
        item.item_status = 'Ready for Handover';
    } else {
        item.item_status = 'Packing';
    }
    const { error: itemErr } = await saveData('request_order_items', item);
    if (itemErr) {
        alert("Failed to update item status: " + itemErr.message);
        return;
    }

    loadPackingRequestsSection();
    scheduleDashboardRefresh();
}

// ============================================================
// PRINT ORDER DETAIL - Sales Order Request A4
// ============================================================
async function printOrderDetail(orderId) {
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
    
    const order = (orders || []).find(o => o.id === orderId);
    if (!order) return;
    const items = (orderItems || []).filter(i => i.request_order_id === orderId);
    
    let itemsTableRows = '';
    let totalBags = 0;
    let totalWeightKg = 0;
    
    for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const type = item.coffee_type;
        const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
        let coffeeName = '';
        if (type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === coffeeId);
            coffeeName = gb ? gb.name : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === coffeeId);
            coffeeName = r ? r.name : 'Blend';
        }
        const mach = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
        const machName = mach ? mach.name : '-';
        const qty = parseInt(item.quantity_requested) || 0;
        const sizeG = parseInt(item.bag_size_g) || 0;
        const weightKg = (qty * sizeG) / 1000;
        const allocated = parseInt(item.quantity_allocated) || 0;
        const pending = parseInt(item.quantity_pending) || 0;
        totalBags += qty;
        totalWeightKg += weightKg;
        
        const sizeLabel = sizeG >= 1000 ? `${sizeG/1000}kg` : `${sizeG}g`;
        itemsTableRows += `
            <tr>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${idx + 1}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; font-weight:600;">${coffeeName}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${machName}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${sizeLabel}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;">${qty}</td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:center;"></td>
                <td style="padding:8px 12px; border:1px solid #ddd; text-align:left;"><span style="display:inline-block; width:13px; height:13px; border:1.5px solid #555; border-radius:2px; vertical-align:middle; margin-right:6px;"></span> Completed</td>
            </tr>`;
    }
    
    // Use the live companySettings (loaded from Supabase by loadCompanySettings()) —
    // do NOT read the 'mock_company_settings' localStorage cache here, it is seeded
    // once on first-ever page load and never refreshed by real saves.
    const cs = companySettings;

    const printContent = `<!DOCTYPE html>
<html>
<head>
    <title>Sales Order - ${order.order_number || '#ORD-'+order.id}</title>
    <style>
        @page { size: A4; margin: 18mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 13px; }
        .order-doc { max-width: 210mm; margin: 0 auto; padding: 20px; }

        /* Letterhead */
        .letterhead { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 3px solid #2d5016; margin-bottom: 20px; }
        .letterhead-left { display: flex; align-items: center; gap: 14px; }
        .letterhead-logo { width: 52px; height: 52px; border-radius: 8px; object-fit: cover; }
        .letterhead-name { font-size: 20px; font-weight: 800; color: #2d5016; line-height: 1.2; }
        .letterhead-contact { font-size: 10px; color: #666; line-height: 1.5; margin-top: 2px; }
        .letterhead-right { text-align: right; }
        .letterhead-right .doc-title { font-size: 18px; font-weight: 800; color: #2d5016; letter-spacing: 0.5px; text-transform: uppercase; }
        .letterhead-right .doc-subtitle { font-size: 10px; color: #888; margin-top: 2px; }

        /* Info section */
        .info-section { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; }
        .info-section .info-left { font-size: 12px; color: #666; }
        .info-block { text-align: right; }
        .info-block .info-row { display: flex; justify-content: flex-end; gap: 12px; font-size: 12px; line-height: 2; }
        .info-block .info-label { color: #888; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.3px; }
        .info-block .info-value { color: #1a1a1a; font-weight: 700; min-width: 140px; text-align: left; }

        /* Table */
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        thead th { background: #2d5016; color: #fff; padding: 9px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid #2d5016; }
        tbody td { padding: 8px 10px; border: 1px solid #ddd; font-size: 12px; }
        tfoot td { background: #f0f5eb; font-weight: 700; padding: 9px 10px; border: 1px solid #ddd; font-size: 12px; }

        /* Notes */
        .notes { border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin-top: 16px; }
        .notes .label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #888; margin-bottom: 4px; }

        /* Footer */
        .print-footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #eee; font-size: 10px; color: #999; text-align: center; }
        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
    </style>
</head>
<body>
    <div class="order-doc">
        <div class="letterhead">
            <div class="letterhead-left">
                ${cs.show_logo_in_print && cs.logo_base64 ? '<img class="letterhead-logo" src="' + cs.logo_base64 + '" alt="Logo">' : ''}
                <div>
                    <div class="letterhead-name">${cs.company_name || 'Coffee Roastery'}</div>
                    <div class="letterhead-contact">
                        ${cs.address ? cs.address + '<br>' : ''}${cs.phone ? cs.phone : ''}${cs.email ? ' · ' + cs.email : ''}
                    </div>
                </div>
            </div>
            <div class="letterhead-right">
                <div class="doc-title">Sales Order</div>
                <div class="doc-subtitle">${order.order_number || '#ORD-'+order.id}</div>
            </div>
        </div>

        <div class="info-section">
            <div class="info-left"></div>
            <div class="info-block">
                <div class="info-row">
                    <span class="info-label">Order Number</span>
                    <span class="info-value">${order.order_number || '#ORD-'+order.id}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Order Date</span>
                    <span class="info-value">${order.order_date}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Sales Agent</span>
                    <span class="info-value">${order.sales_name || '-'}</span>
                </div>
            </div>
        </div>

        <table>
            <thead>
                <tr>
                    <th style="width:30px;">#</th>
                    <th>Coffee Name</th>
                    <th style="width:100px;">Machine</th>
                    <th style="width:55px;">Size</th>
                    <th style="width:45px;">Qty</th>
                    <th style="width:70px;">Prepared</th>
                    <th style="width:110px;">Status</th>
                </tr>
            </thead>
            <tbody>${itemsTableRows}</tbody>
            <tfoot>
                <tr>
                    <td colspan="4" style="text-align:right; border:1px solid #ddd;">Total</td>
                    <td style="text-align:center; border:1px solid #ddd;">${totalBags}</td>
                    <td colspan="2" style="border:1px solid #ddd;"></td>
                </tr>
            </tfoot>
        </table>
        ${order.notes ? '<div class="notes"><div class="label">Notes / Customer Info</div><div>' + order.notes + '</div></div>' : ''}
    </div>
    <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
}

async function dispatchOrder(orderId) {
    const { data: orders } = await fetchData('request_orders');
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    
    order.status = 'Dispatched';
    await saveData('request_orders', order);
    
    await showWarningModal('✅ Order dispatched! The sales team has picked up the packed items.', false);
    loadPackingRequestsSection();
    scheduleDashboardRefresh();
}

function addPackingRow(bulkList, greenbeans, recipes, machines, packagingSizes, selectedCoffeeId = null) {
    const rowsContainer = document.getElementById('packing-sheet-rows');
    if (!rowsContainer) return;
    
    let singleHtml = '';
    (greenbeans || []).forEach(gb => {
        const val = `Single-${gb.id}`;
        singleHtml += `
            <option value="${val}" ${selectedCoffeeId && selectedCoffeeId.toString() === val ? 'selected' : ''}>
                ${gb.name}
            </option>
        `;
    });

    let blendHtml = '';
    (recipes || []).forEach(r => {
        const val = `Blend-${r.id}`;
        blendHtml += `
            <option value="${val}" ${selectedCoffeeId && selectedCoffeeId.toString() === val ? 'selected' : ''}>
                ${r.name}
            </option>
        `;
    });

    const optionsHtml = `
        <optgroup label="Single Origin">
            ${singleHtml}
        </optgroup>
        <optgroup label="Blend Recipes">
            ${blendHtml}
        </optgroup>
    `;
    
    const rowId = 'pack-row-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    
    const rowDiv = document.createElement('div');
    rowDiv.id = rowId;
    rowDiv.className = 'packing-sheet-row';
    rowDiv.style.cssText = 'background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;';
    
    rowDiv.innerHTML = `
        <div style="display: flex; gap: 10px; align-items: flex-end; margin-bottom: 8px;">
            <div class="form-group" style="flex: 1; margin-bottom: 0;">
                <label class="form-label" style="font-size: 0.8rem; margin-bottom: 2px; font-weight: 600;" data-i18n="col_p_name">${window.t ? window.t("col_p_name") : "Coffee Name"}</label>
                <select class="form-control pack-coffee-select" style="width: 100%; padding: 4px 8px; height: 32px;" required>
                    ${optionsHtml}
                </select>
            </div>
            <button type="button" class="btn btn-danger btn-sm btn-remove-pack-row" style="padding: 4px 10px; height: 32px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </div>
        <div class="machine-rows-container" style="display: flex; flex-direction: column; gap: 6px;"></div>
    `;
    
    rowsContainer.appendChild(rowDiv);
    
    // Delete handler
    const btnDel = rowDiv.querySelector('.btn-remove-pack-row');
    btnDel.onclick = () => {
        if (rowsContainer.children.length > 1) {
            rowDiv.remove();
            validatePackingStock();
        } else {
            alert(window.t ? window.t("msg_min_one_coffee") : "Minimum one coffee required.");
        }
    };
    
    const select = rowDiv.querySelector('.pack-coffee-select');
    const mContainer = rowDiv.querySelector('.machine-rows-container');
    
    const activeSizes = (packagingSizes || []).filter(s => s.is_visible).sort((a,b) => a.gram - b.gram);
    
    const renderMachineRows = () => {
        mContainer.innerHTML = '';
        const coffeeKey = select.value;
        const [type, idStr] = coffeeKey.split('-');
        const id = parseInt(idStr);
        
        const matchedBulks = (bulkList || []).filter(b => b.coffee_type === type && (type === 'Single' ? b.single_coffee_id === id : b.blend_recipe_id === id));
        
        if (matchedBulks.length === 0) {
            let machineOptions = '<option value="0">Select Machine...</option>';
            (machines || []).forEach(m => {
                machineOptions += `<option value="${m.id}">${m.name}</option>`;
            });

            const subRow = document.createElement('div');
            subRow.className = 'machine-pack-subrow';
            subRow.dataset.bulkId = '0';
            subRow.dataset.machineId = '0';
            subRow.dataset.avail = '0';
            subRow.style.cssText = 'background: rgba(0,0,0,0.02); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px;';
            
            let sizeInputsHtml = '';
            activeSizes.forEach(s => {
                sizeInputsHtml += `
                    <div style="flex:1; min-width:70px;">
                        <label style="font-size:0.7rem; color:var(--text-secondary); margin-bottom:2px; display:block;">${s.label}</label>
                        <input type="number" class="form-control pack-qty-dynamic" data-gram="${s.gram}" data-name="${s.label}" min="0" value="0" style="width:100%; padding: 2px 6px; height: 28px; font-size: 0.85rem;">
                    </div>
                `;
            });
            
            subRow.innerHTML = `
                <div style="display:flex; gap: 10px; align-items:center; margin-bottom:4px;">
                    <select class="form-control pack-machine-select" style="font-size: 0.8rem; padding: 2px 6px; height: 28px; width: 180px; font-weight: 600;">
                        ${machineOptions}
                    </select>
                    <span style="color:var(--text-secondary); font-size:0.8rem;">(Stock: 0.00 kg)</span>
                </div>
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    ${sizeInputsHtml}
                </div>
                <div class="warning-bubble hidden" style="width: 100%; background: rgba(234, 88, 12, 0.15); border: 1px solid #ea580c; color: #ea580c; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; margin-top: 6px; display: flex; align-items: center; gap: 6px; font-weight: 500;"></div>
            `;
            
            subRow.querySelector('.pack-machine-select').onchange = (e) => {
                subRow.dataset.machineId = e.target.value;
            };
            
            subRow.querySelectorAll('input').forEach(inp => {
                inp.oninput = () => validatePackingStock();
            });
            mContainer.appendChild(subRow);
            validatePackingStock();
            return;
        }
        
        if (activeSizes.length === 0) {
            mContainer.innerHTML = `<div style="font-size:0.85rem; color:var(--danger);">No packaging sizes configured. Please add sizes in Settings.</div>`;
            return;
        }
        
        matchedBulks.forEach(bulkItem => {
            const m = (machines || []).find(mac => mac.id === bulkItem.machine_id);
            const machineName = m ? m.name : 'Unknown Machine';
            const stock = parseFloat(bulkItem.bulk_available) || 0;
            
            const subRow = document.createElement('div');
            subRow.className = 'machine-pack-subrow';
            subRow.dataset.bulkId = bulkItem.id;
            subRow.dataset.machineId = bulkItem.machine_id || 0;
            subRow.dataset.avail = stock;
            subRow.style.cssText = 'background: rgba(0,0,0,0.02); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px;';
            
            let sizeInputsHtml = '';
            activeSizes.forEach(s => {
                sizeInputsHtml += `
                    <div style="flex:1; min-width:70px;">
                        <label style="font-size:0.7rem; color:var(--text-secondary); margin-bottom:2px; display:block;">${s.label}</label>
                        <input type="number" class="form-control pack-qty-dynamic" data-gram="${s.gram}" data-name="${s.label}" min="0" value="0" style="width:100%; padding: 2px 6px; height: 28px; font-size: 0.85rem;">
                    </div>
                `;
            });
            
            subRow.innerHTML = `
                <div style="font-size:0.8rem; font-weight:600; margin-bottom:4px; color:var(--text-color);">${machineName} <span style="color:var(--text-secondary); font-weight:normal;">(Stock: ${stock.toFixed(2)} kg)</span></div>
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    ${sizeInputsHtml}
                </div>
                <div class="warning-bubble hidden" style="width: 100%; background: rgba(234, 88, 12, 0.15); border: 1px solid #ea580c; color: #ea580c; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; margin-top: 6px; display: flex; align-items: center; gap: 6px; font-weight: 500;"></div>
            `;
            
            subRow.querySelectorAll('input').forEach(inp => {
                inp.oninput = () => validatePackingStock();
            });
            mContainer.appendChild(subRow);
        });
        validatePackingStock();
    };
    
    select.onchange = renderMachineRows;
    renderMachineRows();
}

function validatePackingStock() {
    const subrows = document.querySelectorAll('.machine-pack-subrow');
    subrows.forEach(sub => {
        const avail = parseFloat(sub.dataset.avail) || 0;
        
        let totalKg = 0;
        sub.querySelectorAll('.pack-qty-dynamic').forEach(inp => {
            const gram = parseFloat(inp.getAttribute('data-gram')) || 0;
            const qty = parseInt(inp.value) || 0;
            totalKg += (gram * qty) / 1000;
        });
        
        const bubble = sub.querySelector('.warning-bubble');
        if (totalKg > avail) {
            bubble.classList.remove('hidden');
            let template = window.t ? window.t("msg_warn_exceed") : "Required quantity {totalNeeded} kg exceeds available stock {avail} kg.";
            if (!template) template = "Required quantity {totalNeeded} kg exceeds available stock {avail} kg.";
            template = template.replace("{totalNeeded}", totalKg.toFixed(2)).replace("{avail}", avail.toFixed(2));
            bubble.innerHTML = template;
        } else {
            bubble.classList.add('hidden');
        }
    });
}

async function submitPackingSheet() {
    const [
        { data: bulkList },
        { data: packedList },
        { data: greenbeans },
        { data: recipes }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('packed_coffee'),
        fetchData('green_coffee'),
        fetchData('blend_recipes')
    ]);
    
    const subrows = document.querySelectorAll('.machine-pack-subrow');
    if (subrows.length === 0) return;
    
    let hasExceeded = false;
    let exceededInfo = [];
    
    const additions = [];
    
    subrows.forEach(sub => {
        const bulkId = parseInt(sub.dataset.bulkId);
        const machineId = parseInt(sub.dataset.machineId);
        const avail = parseFloat(sub.dataset.avail) || 0;
        
        let totalKg = 0;
        const subAdditions = [];
        
        sub.querySelectorAll('.pack-qty-dynamic').forEach(inp => {
            const gram = parseFloat(inp.getAttribute('data-gram')) || 0;
            const qty = parseInt(inp.value) || 0;
            const kg = (gram * qty) / 1000;
            totalKg += kg;
            
            if (qty > 0) {
                subAdditions.push({ sizeG: gram, qty: qty, totalKg: kg, label: inp.getAttribute('data-name') });
            }
        });
        
        if (totalKg === 0) return;
        
        const row = sub.closest('.packing-sheet-row');
        const coffeeKey = row.querySelector('.pack-coffee-select').value;
        const [type, idStr] = coffeeKey.split('-');
        const id = parseInt(idStr);
        
        let coffeeName = '';
        if (type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === id);
            coffeeName = gb ? gb.name : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === id);
            coffeeName = r ? r.name : 'Blend Recipe';
        }
        
        if (totalKg > avail) {
            hasExceeded = true;
            exceededInfo.push(`- ${coffeeName}: ${totalKg.toFixed(2)} kg req, ${avail.toFixed(2)} kg avail.`);
        }
        
        subAdditions.forEach(sa => {
            additions.push({ bulkId, machineId, coffeeName, type, id, sizeG: sa.sizeG, qty: sa.qty, totalKg: sa.totalKg, label: sa.label });
        });
    });
    
    if (additions.length === 0) return;
    
    const invalidAdd = additions.find(a => a.machineId === 0);
    if (invalidAdd) {
        alert("Please select a Machine for " + invalidAdd.coffeeName);
        return;
    }
    
    if (hasExceeded) {
        let confirmText = window.t ? window.t("msg_confirm_exceed") : "Warning: The following quantities exceed available stock:\n{info}\n\nDo you want to proceed anyway?";
        if (!confirmText) confirmText = "Warning: The following quantities exceed available stock:\n{info}\n\nDo you want to proceed anyway?";
        confirmText = confirmText.replace("{info}", exceededInfo.join('\n'));
        const proceed = await showWarningModal(confirmText);
        if (!proceed) return;
    }
    
    try {
        const bulkUpdates = {};
        
        additions.forEach(add => {
            if (add.bulkId && add.bulkId !== 0 && !isNaN(add.bulkId)) {
                if (!bulkUpdates[add.bulkId]) bulkUpdates[add.bulkId] = 0;
                bulkUpdates[add.bulkId] += add.totalKg;
            }
        });
        
        for (const bulkId in bulkUpdates) {
            const bulkItem = (bulkList || []).find(b => b.id === parseInt(bulkId));
            if (bulkItem) {
                bulkItem.bulk_available = parseFloat(bulkItem.bulk_available) - bulkUpdates[bulkId];
                if (bulkItem.bulk_available < 0) bulkItem.bulk_available = 0;
                await saveData('bulk_roasted_coffee', bulkItem);
            }
        }
        
        for (const add of additions) {
            const existing = (packedList || []).find(p => 
                !p.roast_batch_id && 
                p.custom_coffee_name === add.coffeeName && 
                parseInt(p.bag_size_g) === parseInt(add.sizeG) &&
                parseInt(p.machine_id) === parseInt(add.machineId)
            );
            
            if (existing) {
                existing.quantity = parseInt(existing.quantity) + add.qty;
                await saveData('packed_coffee', existing);
            } else {
                const newPacked = {
                    roast_batch_id: null,
                    machine_id: add.machineId,
                    custom_coffee_name: add.coffeeName,
                    bag_size_g: add.sizeG,
                    quantity: add.qty,
                    selling_price: 12.00
                };
                await saveData('packed_coffee', newPacked);
            }
        }
        
        // Save packing records for history (match production schema)
        const packingDate = document.getElementById('packing-date')?.value || new Date().toISOString().split('T')[0];
        for (const add of additions) {
            await saveData('packing_records', {
                date: packingDate,
                pack_date: packingDate,
                source_type: add.type,
                source_id: add.id,
                coffee_name: `${add.coffeeName} (${add.type})`,
                machine_id: add.machineId,
                bag_size_g: add.sizeG,
                size_g: add.sizeG,
                quantity: add.qty,
                status: 'Completed'
            });
        }
        
        await showWarningModal(window.t ? window.t("msg_pack_saved") : "Packing saved successfully.", false);
        
        const rowsContainer = document.getElementById('packing-sheet-rows');
        if (rowsContainer) rowsContainer.innerHTML = '';
        
        await loadPackingSection();
        scheduleDashboardRefresh();
    } catch (err) {
        console.error('Packing submit error:', err);
        alert('Error during packing save: ' + err.message);
    }
}

// Package bulk coffee batch modal
async function openPackingModal(bulkId) {
    const { data: bulkList } = await fetchData('bulk_roasted_coffee');
    const record = bulkList.find(b => b.id === bulkId);
    if (!record) return;

    const html = `
        <form id="modal-packing-form">
            <div class="form-group">
                <label class="form-label">Source Roasted Coffee</label>
                <input type="text" class="form-control" value="${record.coffee_name} (Available Bulk: ${parseFloat(record.bulk_available).toFixed(2)} kg)" readonly>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Bag Size / Retail Weight</label>
                    <select id="m-pack-size" class="form-control">
                        <option value="250" selected>250 grams (g)</option>
                        <option value="500">500 grams (g)</option>
                        <option value="1000">1000 grams / 1kg (g)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Bags to Produce</label>
                    <input type="number" id="m-pack-qty" class="form-control" value="10" min="1" required>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">Calculated Bulk Weight Needed</label>
                <input type="text" id="m-pack-calc-weight" class="form-control" style="background:var(--border); font-weight:700;" readonly value="2.5 kg">
            </div>

            <div class="form-group">
                <label class="form-label">Retail Selling Price per Bag</label>
                <input type="number" step="0.01" id="m-pack-price" class="form-control" value="12.00">
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Run Packaging</button>
            </div>
        </form>
    `;

    openModal('Run Retail Packaging Line', html);

    const sizeSelect = document.getElementById('m-pack-size');
    const qtyInput = document.getElementById('m-pack-qty');
    const calcWeight = document.getElementById('m-pack-calc-weight');

    function updateCalc() {
        const size = parseInt(sizeSelect.value) || 250;
        const qty = parseInt(qtyInput.value) || 0;
        const kgNeeded = (size * qty) / 1000;
        calcWeight.value = `${kgNeeded.toFixed(2)} kg`;
    }
    sizeSelect.addEventListener('change', updateCalc);
    qtyInput.addEventListener('input', updateCalc);
    updateCalc();

    document.getElementById('modal-packing-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const size = parseInt(sizeSelect.value);
        const qty = parseInt(qtyInput.value);
        const weightNeeded = (size * qty) / 1000;

        // 1. Verify enough bulk stock remaining
        if (parseFloat(record.bulk_available) < weightNeeded) {
            alert(window.t("alert_insufficient_bulk").replace("{avail}", parseFloat(record.bulk_available).toFixed(2)).replace("{req}", weightNeeded));
            return;
        }

        // 2. Add to packed_coffee inventory table
        const { data: existingPacked } = await fetchData('packed_coffee');
        const duplicate = existingPacked.find(p => 
            !p.roast_batch_id && 
            p.custom_coffee_name === record.coffee_name && 
            p.bag_size_g === size
        );

        if (duplicate) {
            duplicate.quantity = parseInt(duplicate.quantity) + qty;
            await saveData('packed_coffee', duplicate);
        } else {
            const newPacked = {
                roast_batch_id: null,
                custom_coffee_name: record.coffee_name,
                bag_size_g: size,
                quantity: qty,
                selling_price: parseFloat(document.getElementById('m-pack-price').value) || 12.00
            };
            await saveData('packed_coffee', newPacked);
        }

        // 3. Deduct from bulk stock
        record.bulk_available = parseFloat(record.bulk_available) - weightNeeded;
        await saveData('bulk_roasted_coffee', record);

        modalContainer.classList.add('hidden');
        loadPackingSection();
        scheduleDashboardRefresh();
    });
}

// Adjust Packed Coffee Stock level manually
async function adjustPackedStock(id) {
    const { data: packed } = await fetchData('packed_coffee');
    const record = packed.find(p => p.id === id);
    if (!record) return;

    const newQtyStr = prompt("Enter new inventory bag quantity count:", record.quantity);
    if (newQtyStr === null) return;
    const newQty = parseInt(newQtyStr);
    
    if (!isNaN(newQty) && newQty >= 0) {
        record.quantity = newQty;
        await saveData('packed_coffee', record);
        loadPackingSection();
        scheduleDashboardRefresh();
    } else {
        alert(window.t("alert_invalid_qty"));
    }
}

// Manual outside packaging (outside roasted bean source)
const btnCustomPack = document.getElementById('btn-custom-pack');
if (btnCustomPack) {
    btnCustomPack.addEventListener('click', async () => {
    const html = `
        <form id="modal-custom-pack-form">
            <div class="form-group">
                <label class="form-label">Coffee Name</label>
                <input type="text" id="m-cp-name" class="form-control" placeholder="e.g. Guest Roast Coffee" required>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Bag Size / Retail Weight</label>
                    <select id="m-cp-size" class="form-control">
                        <option value="250" selected>250 g</option>
                        <option value="500">500 g</option>
                        <option value="1000">1kg</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Inventory Quantity (Bags)</label>
                    <input type="number" id="m-cp-qty" class="form-control" value="20" min="1" required>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">Retail Selling Price per Bag</label>
                <input type="number" step="0.01" id="m-cp-price" class="form-control" value="15.00">
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Add Custom Stock</button>
            </div>
        </form>
    `;

    openModal('Import Custom Retail Stock', html);

    document.getElementById('modal-custom-pack-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const record = {
            roast_batch_id: null, // manual
            custom_coffee_name: document.getElementById('m-cp-name').value,
            bag_size_g: parseInt(document.getElementById('m-cp-size').value),
            quantity: parseInt(document.getElementById('m-cp-qty').value),
            selling_price: parseFloat(document.getElementById('m-cp-price').value) || 15.00
        };

        await saveData('packed_coffee', record);
        modalContainer.classList.add('hidden');
        loadPackingSection();
        scheduleDashboardRefresh();
    });
    });
}

// ==========================================================================
// SECTION 5: HANDOVER (SERAH TERIMA SALES)
// ==========================================================================
let activeSelectedOrderId = null;

async function loadHandoverSection() {
    await loadSalesDispatchRequestsTable();
    await loadDispatchApprovalTable();
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
        { data: customers }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('customers')
    ]);
    const tbody = document.getElementById('request-orders-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!orders || orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">${window.t ? window.t("msg_no_orders") : "No orders found."}</td></tr>`;
        return;
    }

    const sortedOrders = [...orders]
        .sort((a, b) => new Date(b.order_date) - new Date(a.order_date) || b.id - a.id);

    const batchMap = new Map();
    (roastBatches || []).forEach(b => batchMap.set(b.id, b));

    const stockMap = new Map();
    (packedGoods || []).forEach(p => {
        if (p.roast_batch_id) {
            const batch = batchMap.get(p.roast_batch_id);
            if (batch) {
                const cId = batch.coffee_type === 'Single' ? batch.single_coffee_id : batch.blend_recipe_id;
                const key = `${batch.coffee_type}-${cId}-${p.bag_size_g}`;
                stockMap.set(key, (stockMap.get(key) || 0) + (parseInt(p.quantity) || 0));
            }
        }
        // Also match packed_coffee saved via daily packing (custom_coffee_name, no roast_batch_id)
        if (!p.roast_batch_id && p.custom_coffee_name) {
            let resolvedKey = null;
            const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
            const matchGb = (greenbeans || []).find(g => g.name === cleanName);
            if (matchGb) {
                resolvedKey = `Single-${matchGb.id}-${p.bag_size_g}`;
            } else {
                const matchRec = (recipes || []).find(r => r.name === cleanName);
                if (matchRec) resolvedKey = `Blend-${matchRec.id}-${p.bag_size_g}`;
            }
            if (resolvedKey) {
                stockMap.set(resolvedKey, (stockMap.get(resolvedKey) || 0) + (parseInt(p.quantity) || 0));
            }
        }
    });

    const totalItems = sortedOrders.length;
    const totalPages = Math.ceil(totalItems / requestPageSize) || 1;
    if (requestCurrentPage > totalPages) {
        requestCurrentPage = totalPages;
    }

    const startIndex = (requestCurrentPage - 1) * requestPageSize;
    const endIndex = Math.min(startIndex + requestPageSize, totalItems);
    const paginatedOrders = sortedOrders.slice(startIndex, endIndex);

    // Update stats text
    const pageInfo = document.getElementById('request-page-info');
    if (pageInfo) {
        const startVal = totalItems === 0 ? 0 : startIndex + 1;
        const template = window.t ? window.t('pagination_info') : 'Show {start} - {end} of {total}';
        pageInfo.textContent = template.replace('{start}', startVal).replace('{end}', endIndex).replace('{total}', totalItems);
    }

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

    // Render pagination page buttons
    const paginationContainer = document.getElementById('request-pagination-pages');
    if (paginationContainer) {
        paginationContainer.innerHTML = '';
        if (totalPages > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.className = `pagination-btn ${requestCurrentPage === 1 ? 'disabled' : ''}`;
            prevBtn.innerHTML = `&lt;`;
            prevBtn.addEventListener('click', () => {
                if (requestCurrentPage > 1) {
                    requestCurrentPage--;
                    loadSalesDispatchRequestsTable();
                }
            });
            paginationContainer.appendChild(prevBtn);

            for (let i = 1; i <= totalPages; i++) {
                const pageBtn = document.createElement('button');
                pageBtn.className = `pagination-btn ${requestCurrentPage === i ? 'active' : ''}`;
                pageBtn.textContent = i;
                pageBtn.addEventListener('click', () => {
                    requestCurrentPage = i;
                    loadSalesDispatchRequestsTable();
                });
                paginationContainer.appendChild(pageBtn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.className = `pagination-btn ${requestCurrentPage === totalPages ? 'disabled' : ''}`;
            nextBtn.innerHTML = `&gt;`;
            nextBtn.addEventListener('click', () => {
                if (requestCurrentPage < totalPages) {
                    requestCurrentPage++;
                    loadSalesDispatchRequestsTable();
                }
            });
            paginationContainer.appendChild(nextBtn);
        }
    }

    let tbodyHtml = '';
    for (const order of paginatedOrders) {
        let needsRoast = false;
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);
        
        if (order.status === 'Pending Approval') {
            for (const item of items) {
                const type = item.coffee_type;
                const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
                const size = parseInt(item.bag_size_g);
                
                const key = `${type}-${coffeeId}-${size}`;
                const packedStock = stockMap.get(key) || 0;
                
                if (item.quantity_requested > packedStock) {
                    needsRoast = true;
                    break;
                }
            }
        }
        
        const isPending = order.status === 'Pending Approval';
        let actionColumnContent = '';
        if (isPending) {
            actionColumnContent = `
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <button class="btn btn-primary btn-sm btn-edit-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>
                    <button class="btn btn-danger btn-sm btn-delete-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Delete</button>
                </div>
            `;
        } else if (order.status === 'Cancelled') {
            actionColumnContent = `
                <span style="color: #b91c1c; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                    Cancelled
                </span>
            `;
        } else if (order.status === 'Dispatched') {
            actionColumnContent = `
                <span style="color: #0891b2; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.3); border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                    Dispatched
                </span>
            `;
        } else {
            const allItemsReady = items.every(item => item.item_status === 'Ready for Handover');
            if (allItemsReady) {
                const labelReadyToDispatch = window.t ? window.t("status_ready_to_dispatch") || "Ready to Dispatch" : "Ready to Dispatch";
                actionColumnContent = `
                    <span style="color: #15803d; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #dcfce7; border: 1px solid #bbf7d0; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                        <i class="lucide-check-circle" style="width:14px; height:14px;"></i> ${labelReadyToDispatch}
                    </span>
                `;
            } else {
                const labelOnProgress = window.t ? window.t("status_on_progress") || "On Progress" : "On Progress";
                actionColumnContent = `
                    <span style="color: #1d4ed8; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                        <span style="display:inline-block; width:6px; height:6px; background:#1d4ed8; border-radius:50%;"></span> ${labelOnProgress}
                    </span>
                `;
            }
        }

        let itemsHtml = `<div style="display: flex; flex-direction: column; gap: 8px;">`;
        for (const item of items) {
            const type = item.coffee_type;
            const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
            
            let coffeeName = '';
            if (type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === coffeeId);
                coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
            } else {
                const r = (recipes || []).find(rec => rec.id === coffeeId);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
            }
            
            const statusBadge = getItemStatusBadge(item.item_status);
            
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
                <span style="font-size:0.75rem; color:var(--text-secondary);">${order.order_date}</span>
                ${needsRoast ? `<div style="margin-top: 4px;"><span style="font-size:0.65rem; color: var(--danger); font-weight: bold;">⚠️ ${window.t ? window.t('badge_auto_roast') : 'Auto-Roast Required'}</span></div>` : ''}
            </td>
            <td>
                <strong>${order.sales_name}</strong>
                ${(() => { const cust = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null; return cust ? `<br/><span style="font-size:0.75rem; color:var(--text-secondary);">👤 ${cust.name} <code style="font-size:0.65rem;">${cust.customer_id}</code></span>` : ''; })()}
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

async function loadDispatchApprovalTable() {
    const [
        { data: orders },
        { data: orderItems },
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: customers }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('customers')
    ]);
    const tbody = document.getElementById('approval-orders-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!orders || orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">${window.t ? window.t("msg_no_orders") : "No orders found."}</td></tr>`;
        return;
    }

    const sortedOrders = [...orders]
        .sort((a, b) => new Date(b.order_date) - new Date(a.order_date) || b.id - a.id);

    const totalItems = sortedOrders.length;
    const totalPages = Math.ceil(totalItems / approvalPageSize) || 1;
    if (approvalCurrentPage > totalPages) {
        approvalCurrentPage = totalPages;
    }

    const startIndex = (approvalCurrentPage - 1) * approvalPageSize;
    const endIndex = Math.min(startIndex + approvalPageSize, totalItems);
    const paginatedOrders = sortedOrders.slice(startIndex, endIndex);

    // Update stats text
    const pageInfo = document.getElementById('approval-page-info');
    if (pageInfo) {
        const startVal = totalItems === 0 ? 0 : startIndex + 1;
        const template = window.t ? window.t('pagination_info') : 'Show {start} - {end} of {total}';
        pageInfo.textContent = template.replace('{start}', startVal).replace('{end}', endIndex).replace('{total}', totalItems);
    }

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

    // Render pagination page buttons
    const paginationContainer = document.getElementById('approval-pagination-pages');
    if (paginationContainer) {
        paginationContainer.innerHTML = '';
        if (totalPages > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.className = `pagination-btn ${approvalCurrentPage === 1 ? 'disabled' : ''}`;
            prevBtn.innerHTML = `&lt;`;
            prevBtn.addEventListener('click', () => {
                if (approvalCurrentPage > 1) {
                    approvalCurrentPage--;
                    loadDispatchApprovalTable();
                }
            });
            paginationContainer.appendChild(prevBtn);

            for (let i = 1; i <= totalPages; i++) {
                const pageBtn = document.createElement('button');
                pageBtn.className = `pagination-btn ${approvalCurrentPage === i ? 'active' : ''}`;
                pageBtn.textContent = i;
                pageBtn.addEventListener('click', () => {
                    approvalCurrentPage = i;
                    loadDispatchApprovalTable();
                });
                paginationContainer.appendChild(pageBtn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.className = `pagination-btn ${approvalCurrentPage === totalPages ? 'disabled' : ''}`;
            nextBtn.innerHTML = `&gt;`;
            nextBtn.addEventListener('click', () => {
                if (approvalCurrentPage < totalPages) {
                    approvalCurrentPage++;
                    loadDispatchApprovalTable();
                }
            });
            paginationContainer.appendChild(nextBtn);
        }
    }

    let tbodyHtml = '';
    for (const order of paginatedOrders) {
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);

        // Build card-style items like Sales Dispatch Request
        let itemsHtml = `<div style="display: flex; flex-direction: column; gap: 8px;">`;
        for (const item of items) {
            let coffeeName = '';
            if (item.coffee_type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === item.single_coffee_id);
                coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
            } else {
                const r = (recipes || []).find(rec => rec.id === item.blend_recipe_id);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
            }
            
            const itemMach = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
            const machTag = itemMach ? `<span style="font-size:0.72rem; color:#0891b2; font-weight:600; background:rgba(6,182,212,0.1); padding:1px 6px; border-radius:4px; margin-left:6px;">${itemMach.name}</span>` : '';
            
            const statusBadge = getItemStatusBadge(item.item_status);
            
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
        let actionColumnContent = '';
        if (isPending) {
            actionColumnContent = `
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <button class="btn btn-success btn-sm btn-approve-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;vertical-align:middle;margin-right:4px;"><polyline points="20 6 9 17 4 12"/></svg> Approve</button>
                    <button class="btn btn-primary btn-sm btn-edit-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>
                </div>
            `;
        } else if (order.status === 'Cancelled') {
            actionColumnContent = `<span style="color: #b91c1c; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">Cancelled</span>`;
        } else if (order.status === 'Dispatched') {
            actionColumnContent = `
                <span style="color: #0891b2; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.3); border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                    Dispatched
                </span>
            `;
        } else if (order.status === 'Preparing') {
            const canEdit = true;
            actionColumnContent = `
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <span style="color: #8b5cf6; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: rgba(139,92,246,0.1); border: 1px solid rgba(139,92,246,0.3); border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                        <span style="display:inline-block; width:6px; height:6px; background:#8b5cf6; border-radius:50%;"></span> Preparing
                    </span>
                    ${canEdit ? `<button class="btn btn-primary btn-sm btn-edit-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>` : ''}
                </div>
            `;
        } else {
            const allReady = items.every(item => item.item_status === 'Ready for Handover');
            if (allReady) {
                actionColumnContent = `<span style="color: #15803d; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #dcfce7; border: 1px solid #bbf7d0; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;"><i class="lucide-check-circle" style="width:14px; height:14px;"></i> Completed</span>`;
            } else {
                actionColumnContent = `<span style="color: #1d4ed8; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;"><span style="display:inline-block; width:6px; height:6px; background:#1d4ed8; border-radius:50%;"></span> On Progress</span>`;
            }
        }

        tbodyHtml += `
        <tr data-order-id="${order.id}" style="cursor: pointer;" class="table-row-hover">
            <td>
                <code>${order.order_number || '#ORD-'+order.id}</code><br/>
                <span style="font-size:0.75rem; color:var(--text-secondary);">${order.order_date}</span>
            </td>
            <td>
                <strong>${order.sales_name}</strong>
                ${(() => { const cust = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null; return cust ? `<br/><span style="font-size:0.75rem; color:var(--text-secondary);">👤 ${cust.name} <code style="font-size:0.65rem;">${cust.customer_id}</code></span>` : ''; })()}
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
        const btnEdit = e.target.closest('.btn-edit-order');
        if (btnEdit) {
            openSalesRequestModal(parseInt(btnEdit.getAttribute('data-id')));
            return;
        }
        // Row click → detail popup
        const tr = e.target.closest('tr[data-order-id]');
        if (tr) {
            const orderId = parseInt(tr.getAttribute('data-order-id'));
            openOrderDetailPopup(orderId, orders, orderItems, greenbeans, recipes, machines);
        }
    };

    applyFiltersForTable(document.querySelector('#tab-dispatch-approval table'));
    if (typeof window.translatePage === 'function') window.translatePage();
}

function openOrderDetailPopup(orderId, orders, orderItems, greenbeans, recipes, machines) {
    const order = (orders || []).find(o => o.id === orderId);
    if (!order) return;

    const items = (orderItems || []).filter(i => i.request_order_id === orderId);

    const badgeColor = order.status === 'Dispatched' ? 'rgba(6,182,212,0.15)' :
                       order.status === 'Completed' ? 'rgba(16,185,129,0.15)' :
                       order.status === 'Preparing' ? 'rgba(139,92,246,0.15)' :
                       order.status === 'Approved' ? 'rgba(59,130,246,0.15)' :
                       order.status === 'Cancelled' ? 'rgba(239,68,68,0.15)' :
                       'rgba(245,158,11,0.15)';
    const textCol = order.status === 'Dispatched' ? '#0891b2' :
                    order.status === 'Completed' ? 'var(--success)' :
                    order.status === 'Preparing' ? '#8b5cf6' :
                    order.status === 'Approved' ? 'var(--info)' :
                    order.status === 'Cancelled' ? 'var(--danger)' :
                    'var(--warning)';

    // Build items table
    let itemsHtml = '';
    let totalBags = 0;
    items.forEach((item, idx) => {
        let coffeeName = '';
        if (item.coffee_type === 'Single') {
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

        itemsHtml += `
            <tr>
                <td style="text-align: center;">${idx + 1}</td>
                <td><strong>${coffeeName}</strong></td>
                <td style="text-align: center;">${item.coffee_type || '-'}</td>
                <td style="text-align: center;">${machName}</td>
                <td style="text-align: center;">${sizeLabel}</td>
                <td style="text-align: center;"><strong>${item.quantity_requested || 0}</strong></td>
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
        <div class="overlay-card" style="max-width: 650px; width: 95%; padding: 28px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; font-weight: 800; color: var(--text-primary);">Order Detail</h3>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-close-order-detail">&times;</button>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin-bottom: 20px; font-size: 0.85rem;">
                <div>
                    <span style="color: var(--text-muted); font-size: 0.75rem;">Order Number</span>
                    <div style="font-weight: 700;">${order.order_number || '#ORD-' + order.id}</div>
                </div>
                <div>
                    <span style="color: var(--text-muted); font-size: 0.75rem;">Sales Agent</span>
                    <div style="font-weight: 700;">${order.sales_name}</div>
                </div>
                <div>
                    <span style="color: var(--text-muted); font-size: 0.75rem;">Order Date</span>
                    <div style="font-weight: 700;">${order.order_date}</div>
                </div>
                <div>
                    <span style="color: var(--text-muted); font-size: 0.75rem;">Status</span>
                    <div><span style="font-size:0.75rem; padding: 2px 8px; border-radius: 9999px; font-weight:700; background: ${badgeColor}; color: ${textCol};">${order.status}</span></div>
                </div>
                ${order.notes ? `<div style="grid-column: 1 / -1;"><span style="color: var(--text-muted); font-size: 0.75rem;">Notes</span><div style="font-weight: 600;">${order.notes}</div></div>` : ''}
            </div>

            <h4 style="font-size: 0.85rem; font-weight: 700; margin-bottom: 8px; color: var(--text-primary);">Order Items (${items.length})</h4>
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th style="text-align: center; width: 40px;">#</th>
                            <th>Coffee Name</th>
                            <th style="text-align: center;">Type</th>
                            <th style="text-align: center;">Machine</th>
                            <th style="text-align: center;">Size</th>
                            <th style="text-align: center;">Qty (bags)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                        <tr style="font-weight: 700; border-top: 2px solid var(--border); background: rgba(255,255,255,0.03);">
                            <td colspan="5" style="text-align: right;">Total Bags</td>
                            <td style="text-align: center; color: var(--primary);"><strong>${totalBags}</strong></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    existingPopup.classList.remove('hidden');
    document.getElementById('btn-close-order-detail').onclick = () => existingPopup.classList.add('hidden');
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
        { data: machines }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('packed_coffee'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('roast_batches'),
        fetchData('machines')
    ]);
    
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const items = orderItems.filter(i => i.request_order_id === orderId);
    
    // Build machine options HTML
    const machineOptionsHtml = (machines || []).map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    
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
        if (type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === coffeeId);
            coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === coffeeId);
            coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
        }
        
        const matchingPacked = (packedGoods || []).filter(p => {
            if (p.roast_batch_id) {
                const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
                return batch && batch.coffee_type === type && (batch.single_coffee_id === coffeeId || batch.blend_recipe_id === coffeeId);
            }
            // Also match by custom_coffee_name
            if (p.custom_coffee_name) {
                const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
                if (type === 'Single') {
                    const gb = (greenbeans || []).find(g => g.id === coffeeId);
                    return gb && gb.name === cleanName;
                } else {
                    const rec = (recipes || []).find(r => r.id === coffeeId);
                    return rec && rec.name === cleanName;
                }
            }
            return false;
        });
        const szItems = matchingPacked.filter(p => parseInt(p.bag_size_g) === size);
        const packedStock = szItems.reduce((acc, p) => acc + (parseInt(p.quantity) || 0), 0);
        
        let fulfillQty = Math.min(packedStock, item.quantity_requested);
        let prodQty = item.quantity_requested > packedStock ? (item.quantity_requested - packedStock) : 0;
        
        // Resolve machine name from item
        const itemMachine = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
        const machineLabel = itemMachine ? `<span style="font-size: 0.8rem; color: var(--primary); font-weight: 600;"> • ${itemMachine.name}</span>` : '';
        
        // Build machine options with pre-selection
        let itemMachineOptionsHtml = `<option value="">-- Select Machine --</option>`;
        (machines || []).forEach(m => {
            const selected = item.machine_id === m.id ? 'selected' : '';
            itemMachineOptionsHtml += `<option value="${m.id}" ${selected}>${m.name}</option>`;
        });
        
        htmlContent += `
            <div class="approval-item-row" data-id="${item.id}" style="background: rgba(0,0,0,0.02); border: 1px solid var(--border-color); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <div style="font-weight: bold; margin-bottom: 8px; color: var(--text-primary);">${coffeeName} - ${size}g${machineLabel}</div>
                <div style="display: flex; gap: 20px; font-size: 0.85rem; align-items: center;">
                    <div style="flex:1;">
                        <span style="color: var(--text-secondary);" data-i18n="lbl_requested">Requested:</span> <strong>${item.quantity_requested}</strong>
                    </div>
                    <div style="flex:1;">
                        <span style="color: var(--text-secondary);" data-i18n="lbl_packed_stock">Packed Stock:</span> <strong style="${packedStock < item.quantity_requested ? 'color: var(--danger);' : ''}">${packedStock}</strong>
                    </div>
                </div>
                <div style="display: flex; gap: 15px; margin-top: 15px; align-items: flex-end;">
                    <div style="flex: 1;">
                        <label class="form-label" style="font-size: 0.75rem;" data-i18n="lbl_fulfill_packed">Fulfill from Packed</label>
                        <input type="number" class="form-control inp-fulfill" min="0" max="${packedStock}" value="${fulfillQty}" required>
                    </div>
                    <div style="flex: 1;">
                        <label class="form-label" style="font-size: 0.75rem;" data-i18n="lbl_send_prod">Send to Production</label>
                        <input type="number" class="form-control inp-prod" min="0" value="${prodQty}" required>
                    </div>
                </div>
                <div class="machine-select-row" style="margin-top: 12px; ${prodQty > 0 ? '' : 'display: none;'}">
                    <label class="form-label" style="font-size: 0.75rem;">Machine for Production</label>
                    <select class="form-control sel-machine" style="padding: 6px 10px;">
                        ${itemMachineOptionsHtml}
                    </select>
                </div>
            </div>
        `;
    }
    
    htmlContent += `
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--border-color);">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                <button type="submit" class="btn btn-primary" data-i18n="btn_confirm_approve">Confirm Approval</button>
            </div>
        </form>
    `;
    
    openModal(window.t ? window.t('modal_approve_order') : 'Approve Order', htmlContent);
    
    // Toggle machine dropdown visibility when inp-prod changes
    document.querySelectorAll('.approval-item-row .inp-prod').forEach(inp => {
        inp.addEventListener('input', function() {
            const row = this.closest('.approval-item-row');
            const machineRow = row.querySelector('.machine-select-row');
            const val = parseInt(this.value) || 0;
            machineRow.style.display = val > 0 ? '' : 'none';
        });
    });
    
    document.getElementById('modal-approve-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const rows = document.querySelectorAll('.approval-item-row');
        
        for (const r of rows) {
            const itemId = parseInt(r.getAttribute('data-id'));
            const fQty = parseInt(r.querySelector('.inp-fulfill').value);
            const pQty = parseInt(r.querySelector('.inp-prod').value);
            const selMachine = r.querySelector('.sel-machine');
            const machineId = selMachine ? (parseInt(selMachine.value) || null) : null;
            
            const item = orderItems.find(i => i.id === itemId);
            if (!item) continue;
            
            item.quantity_allocated = fQty;
            item.quantity_pending = pQty;
            item.item_status = pQty > 0 ? 'Planned' : 'Packing';
            
            await saveData('request_order_items', item);
            
            // Deduct packed stock
            if (fQty > 0) {
                const type = item.coffee_type;
                const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
                const matchingPacked = (packedGoods || []).filter(p => {
                    if (p.roast_batch_id) {
                        const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
                        return batch && batch.coffee_type === type && (batch.single_coffee_id === coffeeId || batch.blend_recipe_id === coffeeId);
                    }
                    if (p.custom_coffee_name) {
                        const cleanName = p.custom_coffee_name.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '');
                        if (type === 'Single') {
                            const gb = (greenbeans || []).find(g => g.id === coffeeId);
                            return gb && gb.name === cleanName;
                        } else {
                            const rec = (recipes || []).find(r => r.id === coffeeId);
                            return rec && rec.name === cleanName;
                        }
                    }
                    return false;
                });
                const szItems = matchingPacked.filter(p => parseInt(p.bag_size_g) === parseInt(item.bag_size_g));
                
                let remainingDeduct = fQty;
                for (const p of szItems) {
                    if (remainingDeduct <= 0) break;
                    let avail = parseInt(p.quantity) || 0;
                    if (avail > 0) {
                        let take = Math.min(avail, remainingDeduct);
                        p.quantity = avail - take;
                        remainingDeduct -= take;
                        await saveData('packed_coffee', p);
                    }
                }
            }
            
            // Create Roast Plan (Pending - not auto-executed)
            if (pQty > 0) {
                const weightKg = (pQty * parseInt(item.bag_size_g)) / 1000;
                // Add a buffer for yield (roughly / 0.85)
                const targetRoast = weightKg / 0.85;
                
                const planRecord = {
                    day: new Date().toLocaleDateString('en-US', {weekday:'long'}),
                    plan_date: new Date().toISOString().split('T')[0],
                    coffee_type: item.coffee_type,
                    single_coffee_id: item.single_coffee_id,
                    blend_recipe_id: item.blend_recipe_id,
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
        
        order.status = 'Preparing';
        await saveData('request_orders', order);
        
        modalContainer.classList.add('hidden');
        
        loadHandoverSection();
        scheduleDashboardRefresh();
    });
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
        { data: machines }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('blend_ingredients'),
        fetchData('sales_agents'),
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('machines')
    ]);

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

    // Subtract committed (Pending / Preparing) orders from packed stock
    const activeOrders = (requestOrders || []).filter(o => ['Pending Approval', 'Preparing'].includes(o.status));
    const activeOrderIds = activeOrders.map(o => o.id);
    const committedPackedMap = {};
    (requestOrderItems || []).forEach(item => {
        if (activeOrderIds.includes(item.request_order_id)) {
            if (orderId !== null && item.request_order_id === orderId) return;
            const cId = item.coffee_type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
            const key = `${item.coffee_type}-${cId}-${item.bag_size_g}`;
            const qty = parseInt(item.quantity_pending) || parseInt(item.quantity_requested) || 0;
            committedPackedMap[key] = (committedPackedMap[key] || 0) + qty;
        }
    });

    Object.keys(originalPackedStocks).forEach(k => {
        originalPackedStocks[k] = Math.max(0, originalPackedStocks[k] - (committedPackedMap[k] || 0));
    });

    // ── Layer 3: Calculate Greenbean Allocations from OTHER rows ────────────
    function getGreenbeanAllocations(excludeRow = null) {
        const gbAlloc = {};
        const rows = document.getElementById('sales-items-list').querySelectorAll('.sales-item-row');
        rows.forEach(row => {
            if (row === excludeRow) return;
            const sel = row.querySelector('.item-select');
            const qtyEl = row.querySelector('.item-qty');
            const sizeEl = row.querySelector('.item-size');
            if (!sel || !sel.value) return;
            const qty = parseInt(qtyEl.value) || 0;
            if (qty <= 0) return;
            
            const sizeG = parseInt(sizeEl.value) || 250;
            const requiredKg = (qty * sizeG) / 1000 / 0.85;

            const [type, idStr] = sel.value.split('-');
            const coffeeId = parseInt(idStr);

            if (type === 'Single') {
                gbAlloc[coffeeId] = (gbAlloc[coffeeId] || 0) + requiredKg;
            } else {
                const r = (recipes || []).find(rec => rec.id === coffeeId);
                if (r) {
                    const ings = (ingredients || []).filter(i => parseInt(i.blend_recipe_id) === r.id);
                    ings.forEach(ing => {
                        const gbId = parseInt(ing.green_coffee_id);
                        const ratio = parseFloat(ing.percentage) / 100;
                        gbAlloc[gbId] = (gbAlloc[gbId] || 0) + (requiredKg * ratio);
                    });
                }
            }
        });
        return gbAlloc;
    }

    function getPotentialBags(type, coffeeId, sizeG, gbAllocFromOtherRows = {}) {
        let maxGbKg = 0;
        if (type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === coffeeId);
            const avail = gb ? parseFloat(gb.stock_kg) : 0;
            const claimed = gbAllocFromOtherRows[coffeeId] || 0;
            maxGbKg = Math.max(0, avail - claimed);
        } else {
            const r = (recipes || []).find(rec => rec.id === coffeeId);
            if (r) {
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
                maxGbKg = minLimit === Infinity ? 0 : minLimit;
            }
        }
        return Math.floor((maxGbKg * 0.85 * 1000) / sizeG);
    }

    // ── Generate dropdowns ───────────────────────────────────────────────────
    const agentListHTML = (agents || []).map(a => `<option value="${a.name}">`).join('');
    const singleLbl = window.t ? window.t('opt_req_single') : 'Single Origin';
    const blendLbl = window.t ? window.t('opt_req_blend') : 'Blend';
    let coffeeOptionsHtml = `<option value="" disabled selected>-- Select Item --</option>`;
    coffeeOptionsHtml += `<optgroup label="${singleLbl}">`;
    coffeeOptionsHtml += (greenbeans || []).map(g => `<option value="Single-${g.id}">${g.name}</option>`).join('');
    coffeeOptionsHtml += `</optgroup>`;
    coffeeOptionsHtml += `<optgroup label="${blendLbl}">`;
    coffeeOptionsHtml += (recipes || []).map(r => `<option value="Blend-${r.id}">${r.name}</option>`).join('');
    coffeeOptionsHtml += `</optgroup>`;

    // Machine options
    let machineOptionsHtml = `<option value="" disabled selected>-- Machine --</option>`;
    machineOptionsHtml += (machines || []).map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    // Customer options
    const { data: customersList } = await fetchData('customers');
    let customerOptionsHtml = '';
    const whlCustomers = (customersList || []).filter(c => c.type === 'Wholesale' && c.is_active !== false);
    const rtlCustomers = (customersList || []).filter(c => c.type === 'Retail' && c.is_active !== false);
    if (whlCustomers.length) {
        customerOptionsHtml += '<optgroup label="🏭 Wholesale">';
        customerOptionsHtml += whlCustomers.map(c => `<option value="${c.id}" ${existingOrder?.customer_id === c.id ? 'selected' : ''}>${c.customer_id} - ${c.name}</option>`).join('');
        customerOptionsHtml += '</optgroup>';
    }
    if (rtlCustomers.length) {
        customerOptionsHtml += '<optgroup label="☕ Retail">';
        customerOptionsHtml += rtlCustomers.map(c => `<option value="${c.id}" ${existingOrder?.customer_id === c.id ? 'selected' : ''}>${c.customer_id} - ${c.name}</option>`).join('');
        customerOptionsHtml += '</optgroup>';
    }

    const html = `
        <form id="modal-request-form" novalidate>
            <div class="form-row">
                <div class="form-group" style="flex: 1;">
                    <label class="form-label" data-i18n="lbl_req_order_no">Order Number</label>
                    <input type="text" id="m-req-orderno" class="form-control" readonly placeholder="Auto Generated" data-i18n-placeholder="ph_req_auto_gen" value="${existingOrder ? existingOrder.order_number : ''}">
                </div>
                <div class="form-group" style="flex: 2;">
                    <label class="form-label" data-i18n="lbl_req_agent">Sales Agent Name</label>
                    <input type="text" id="m-req-sales" class="form-control" list="agent-list" required autocomplete="off" value="${existingOrder ? existingOrder.sales_name : ''}">
                    <datalist id="agent-list">${agentListHTML}</datalist>
                </div>
            </div>
            <div class="form-group" style="margin-top: 12px;">
                <label class="form-label">Customer</label>
                <select id="m-req-customer" class="form-control" required>
                    <option value="" disabled selected>-- Select Customer --</option>
                    ${customerOptionsHtml}
                </select>
            </div>
            
            <div class="form-group" style="margin-top: 15px;">
                <label class="form-label" data-i18n="lbl_req_items_list">Order Items</label>
                <div id="sales-items-list" style="max-height: 45vh; overflow-y: auto; padding-right: 12px; margin-right: -4px;">
                    <!-- Dynamic Rows -->
                </div>
                <button type="button" id="btn-add-sales-item" class="btn btn-secondary btn-sm" style="margin-top: 10px; width: 100%;">
                    + <span data-i18n="btn_add_another_item">Add Another Item</span>
                </button>
            </div>

            <div class="form-group">
                <label class="form-label" data-i18n="lbl_req_notes">Order Notes / Customer Info</label>
                <input type="text" id="m-req-notes" class="form-control" placeholder="e.g. Customer Coffee Shop Gayo" data-i18n-placeholder="ph_req_notes" value="${existingOrder ? (existingOrder.notes || '') : ''}">
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()" data-i18n="btn_cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">${orderId !== null ? 'Save Edit' : 'Submit Request'}</button>
            </div>
        </form>
    `;

    const titleStr = orderId !== null ? 'Edit Sales Request' : 'Submit Sales Request Order';
    openModal(titleStr, html, '800px');

    const itemsList = document.getElementById('sales-items-list');
    const agentInput = document.getElementById('m-req-sales');
    const orderNoInput = document.getElementById('m-req-orderno');

    // ── Order Number Generation ──────────────────────────────────────────────
    if (!existingOrder) {
        agentInput.addEventListener('input', () => {
            const name = agentInput.value.trim();
            if (!name) { orderNoInput.value = ''; return; }
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
            let maxSeq = 0;
            (requestOrders || []).forEach(o => {
                if (o.order_number) {
                    const match = o.order_number.match(/^[A-Z0-9]+(\d{6})(\d{3})$/);
                    if (match && match[1] === datePart) { const s = parseInt(match[2]); if (s > maxSeq) maxSeq = s; }
                }
            });
            orderNoInput.value = `${agentCode}${datePart}${String(maxSeq + 1).padStart(3, '0')}`;
        });
    }

    // ── Reactive Stock Allocation (Layer 2 & 3) ─────────────────────────────
    function getAllocations() {
        const alloc = {};
        itemsList.querySelectorAll('.sales-item-row').forEach(row => {
            const sel = row.querySelector('.item-select');
            const sizeEl = row.querySelector('.item-size');
            const qtyEl = row.querySelector('.item-qty');
            if (!sel.value) return;
            const qty = parseInt(qtyEl.value) || 0;
            if (qty <= 0) return;
            const key = `${sel.value}-${sizeEl.value}`;
            alloc[key] = (alloc[key] || 0) + qty;
        });
        return alloc;
    }

    let checkStockTimer = null;

    function updateAllRowsStockDisplays() {
        // Show loading state for all active info boxes
        itemsList.querySelectorAll('.sales-item-row').forEach(row => {
            const sel = row.querySelector('.item-select');
            const infoBox = row.querySelector('.item-info-box');
            if (sel.value) {
                infoBox.style.display = 'block';
                const checkingText = window.t ? window.t('lbl_stock_checking') : 'Stock Checking...';
                infoBox.innerHTML = `<span style="display:inline-block; animation: spin 1s linear infinite; margin-right: 5px;">⏳</span> ${checkingText}`;
            } else {
                infoBox.style.display = 'none';
            }
        });

        if (checkStockTimer) clearTimeout(checkStockTimer);
        
        checkStockTimer = setTimeout(() => {
            const totalAlloc = getAllocations();
            
            itemsList.querySelectorAll('.sales-item-row').forEach(currentRow => {
                const sel = currentRow.querySelector('.item-select');
                const machineEl = currentRow.querySelector('.item-machine');
                const sizeEl = currentRow.querySelector('.item-size');
                const qtyEl = currentRow.querySelector('.item-qty');
                const infoBox = currentRow.querySelector('.item-info-box');
                const warnDiv = currentRow.querySelector('.item-qty-warn');

                if (!sel.value) { infoBox.style.display = 'none'; return; }

                const [type, idStr] = sel.value.split('-');
                const coffeeId = parseInt(idStr);
                const sizeG = parseInt(sizeEl.value);
                const currentQty = parseInt(qtyEl.value) || 0;
                const selectedMachineId = machineEl.value ? parseInt(machineEl.value) : null;

                // 1. Build per-machine stock cards for ALL machines
                let machineCardsHtml = '<div style="display: flex; gap: 6px; flex-wrap: wrap;">';
                (machines || []).forEach(m => {
                    const isActiveMachine = selectedMachineId === m.id;
                    const borderColor = isActiveMachine ? 'var(--primary)' : 'rgba(255,255,255,0.1)';
                    const bgColor = isActiveMachine ? 'rgba(45,106,79,0.12)' : 'transparent';
                    const nameColor = isActiveMachine ? 'var(--primary)' : 'var(--text-secondary)';

                    let sizesHtml = '';
                    [250, 500, 1000].forEach(sz => {
                        const mKey = `${type}-${coffeeId}-${sz}-${m.id}`;
                        const machStock = perMachinePackedStocks[mKey] || 0;
                        const isSelected = (sz === sizeG);
                        const highlight = isSelected ? 'font-weight:700; color: var(--text-primary);' : 'color: var(--text-muted);';
                        const szLabel = sz >= 1000 ? `${sz/1000}kg` : `${sz}g`;
                        sizesHtml += `<span style="${highlight} font-size: 0.75rem; margin-right: 8px;">${szLabel}: <strong>${machStock}</strong></span>`;
                    });

                    machineCardsHtml += `
                        <div style="border: 1px solid ${borderColor}; border-radius: 4px; padding: 4px 8px; background: ${bgColor}; min-width: 80px; flex: 1;">
                            <div style="font-size: 0.72rem; font-weight: 700; color: ${nameColor}; margin-bottom: 1px; white-space: nowrap; line-height: 1.2;">${isActiveMachine ? '▸ ' : ''}${m.name}</div>
                            <div style="display: flex; gap: 2px; flex-wrap: wrap; line-height: 1.2;">${sizesHtml}</div>
                        </div>
                    `;
                });
                machineCardsHtml += '</div>';
                
                // Calculate aggregate for validation (subtract other rows' allocations)
                let currentSizeAvailPacked = 0;
                {
                    const stockKey = `${sel.value}-${sizeG}`;
                    const totalAllocForThisSize = totalAlloc[stockKey] || 0;
                    const allocByThisRow = currentQty;
                    const otherAlloc = Math.max(0, totalAllocForThisSize - allocByThisRow);
                    const packKey = `${type}-${coffeeId}-${sizeG}`;
                    const totalPacked = originalPackedStocks[packKey] || 0;
                    currentSizeAvailPacked = Math.max(0, totalPacked - otherAlloc);
                }

                // 2. Potential production in KG
                const gbAllocFromOtherRows = getGreenbeanAllocations(currentRow);
                const potentialBags = getPotentialBags(type, coffeeId, sizeG, gbAllocFromOtherRows);
                const potentialKg = ((potentialBags * sizeG) / 1000).toFixed(2);

                // Build UI
                const potLbl = window.t ? window.t('lbl_potential_prod') : 'Potential Prod';

                infoBox.innerHTML = `
                    ${machineCardsHtml}
                    <div style="margin-top: 4px; padding-top: 3px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 0.75rem; line-height: 1.2;"><strong style="color: var(--primary);">${potLbl}:</strong> ~${potentialKg} kg</div>
                `;

                // Store for submit validation
                currentRow.dataset.packedStock = currentSizeAvailPacked;
                currentRow.dataset.potentialBags = potentialBags;

            });
        }, 500); // 500ms animation
    }

    function addSalesItemRow(initialItemData = null) {
        const row = document.createElement('div');
        row.className = 'sales-item-row';
        row.style = 'display: flex; flex-direction: column; margin-bottom: 20px; position: relative;';

        row.innerHTML = `
            <div style="display: flex; gap: 10px; align-items: flex-end; width: 100%;">
                <div style="flex: 2 1 160px; min-width: 0;">
                    <label class="form-label" style="font-size: 0.78rem; margin-bottom: 4px; white-space: nowrap;" data-i18n="lbl_req_coffee_sel">Coffee</label>
                    <select class="form-control item-select" required>
                        ${coffeeOptionsHtml}
                    </select>
                </div>
                <div style="flex: 1.5 1 130px; min-width: 0;">
                    <label class="form-label" style="font-size: 0.78rem; margin-bottom: 4px; white-space: nowrap;">Machine</label>
                    <select class="form-control item-machine" required>
                        ${machineOptionsHtml}
                    </select>
                </div>
                <div style="flex: 0 0 75px;">
                    <label class="form-label" style="font-size: 0.78rem; margin-bottom: 4px; white-space: nowrap;" data-i18n="lbl_req_size">Size</label>
                    <select class="form-control item-size" required>
                        <option value="250">250g</option>
                        <option value="500">500g</option>
                        <option value="1000">1kg</option>
                    </select>
                </div>
                <div style="flex: 0 0 65px;">
                    <label class="form-label" style="font-size: 0.78rem; margin-bottom: 4px; white-space: nowrap;" data-i18n="lbl_req_qty">Qty</label>
                    <input type="number" class="form-control item-qty" min="1" value="1" required>
                </div>
                <button type="button" class="btn btn-danger btn-remove-row" style="padding: 0; width: 34px; height: 34px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">&times;</button>
            </div>
            <div class="item-info-box" style="width: 100%; margin-top: 5px; font-size: 0.75rem; color: var(--text-secondary); background: rgba(0,0,0,0.2); padding: 5px 8px; border-radius: 5px; display: none; line-height: 1.2;"></div>
        `;

        itemsList.appendChild(row);

        const sel = row.querySelector('.item-select');
        const machineEl = row.querySelector('.item-machine');
        const sizeEl = row.querySelector('.item-size');
        const qtyEl = row.querySelector('.item-qty');

        if (initialItemData) {
            const coffeeVal = `${initialItemData.coffee_type}-${initialItemData.single_coffee_id || initialItemData.blend_recipe_id}`;
            sel.value = coffeeVal;
            if (initialItemData.machine_id) machineEl.value = initialItemData.machine_id;
            sizeEl.value = initialItemData.bag_size_g;
            qtyEl.value = initialItemData.quantity_requested;
            
            // Store original item id for plan sync
            row.dataset.originalItemId = initialItemData.id;
        }

        // If editing approved/preparing order: lock all fields except qty
        const isApprovedEdit = existingOrder && (existingOrder.status === 'Preparing' || existingOrder.status === 'Approved');
        if (isApprovedEdit && initialItemData) {
            sel.disabled = true;
            sel.style.opacity = '0.6';
            machineEl.disabled = true;
            machineEl.style.opacity = '0.6';
            sizeEl.disabled = true;
            sizeEl.style.opacity = '0.6';
            row.querySelector('.btn-remove-row').style.display = 'none';
        }

        // Remove handler
        row.querySelector('.btn-remove-row').addEventListener('click', () => {
            if (itemsList.querySelectorAll('.sales-item-row').length > 1) {
                row.remove();
                updateAllRowsStockDisplays();
            } else {
                alert(window.t('alert_min_one_item') || 'At least one item is required.');
            }
        });

        // Reactive listeners
        sel.addEventListener('change', updateAllRowsStockDisplays);
        machineEl.addEventListener('change', updateAllRowsStockDisplays);
        sizeEl.addEventListener('change', updateAllRowsStockDisplays);
        qtyEl.addEventListener('input', updateAllRowsStockDisplays);

        if (typeof window.translatePage === 'function') window.translatePage();
    }

    // Populate rows
    if (existingItems && existingItems.length > 0) {
        existingItems.forEach(item => addSalesItemRow(item));
        updateAllRowsStockDisplays();
    } else {
        addSalesItemRow();
    }

    // Hide "Add Another Item" button and lock header fields for approved/preparing orders
    const isApprovedEdit = existingOrder && (existingOrder.status === 'Preparing' || existingOrder.status === 'Approved');
    if (isApprovedEdit) {
        const addBtn = document.getElementById('btn-add-sales-item');
        if (addBtn) addBtn.style.display = 'none';
        
        // Lock header fields - leader can only edit qty
        if (agentInput) { agentInput.disabled = true; agentInput.style.opacity = '0.6'; }
        if (orderNoInput) { orderNoInput.disabled = true; orderNoInput.style.opacity = '0.6'; }
        const notesInput = document.getElementById('m-req-notes');
        if (notesInput) { notesInput.disabled = true; notesInput.style.opacity = '0.6'; }
    }

    document.getElementById('btn-add-sales-item').addEventListener('click', () => {
        addSalesItemRow();
    });

    document.getElementById('modal-request-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Validation for empty required fields
        let isValid = true;
        const form = e.target;
        form.querySelectorAll('.custom-empty-warn').forEach(w => w.remove());
        
        form.querySelectorAll('[required]').forEach(el => {
            if (!el.value || el.value.trim() === '') {
                isValid = false;
                el.parentElement.style.position = 'relative';
                const warnBubble = document.createElement('div');
                warnBubble.className = 'custom-empty-warn';
                warnBubble.style = 'position: absolute; bottom: -28px; left: 0; background: var(--danger); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; z-index: 10; white-space: nowrap; box-shadow: 0 2px 5px rgba(0,0,0,0.25);';
                warnBubble.innerHTML = `⚠️ ${window.t ? window.t('alert_field_required') : 'Field is required'}<div style="position: absolute; top: -4px; left: 10px; width: 8px; height: 8px; background: var(--danger); transform: rotate(45deg);"></div>`;
                el.parentElement.appendChild(warnBubble);
                const removeHandler = () => { if(warnBubble.parentNode) warnBubble.remove(); };
                el.addEventListener('input', removeHandler, {once:true});
                el.addEventListener('change', removeHandler, {once:true});
            }
        });
        if (!isValid) return;
        
        const rows = document.querySelectorAll('.sales-item-row');
        let needsRoastingQueue = false;
        let blocked = false;
        
        for (const r of rows) {
            const packed = parseInt(r.dataset.packedStock) || 0;
            const potential = parseInt(r.dataset.potentialBags) || 0;
            const qty = parseInt(r.querySelector('.item-qty').value);
            
            if (qty > packed) {
                if (qty <= (packed + potential)) {
                    needsRoastingQueue = true;
                } else {
                    blocked = true;
                }
            }
        }
        
        if (blocked) {
            const forceProceed = await showWarningModal(
                window.t ? window.t('alert_stock_absolutely_insufficient') : "Total available stock and potential production are insufficient for one or more items. Do you still want to continue?",
                true, 'Warning', 'Continue Anyway'
            );
            if (!forceProceed) return;
        }
        
        if (needsRoastingQueue) {
            const proceed = await showWarningModal(window.t ? window.t('prompt_roasting_queue') : "Packed stock is insufficient for some items. Do you want the remainder to enter the production queue?");
            if (!proceed) return;
        }

        const salesName = agentInput.value.trim();
        let agentCode = 'AG';
        const existingAgent = (agents || []).find(a => a.name.toLowerCase() === salesName.toLowerCase());
        if (!existingAgent) {
            const parts = salesName.split(' ');
            agentCode = parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : salesName.substring(0, 2).toUpperCase();
            await saveData('sales_agents', { name: salesName, code: agentCode });
        }
        
        // 1. Save Request Order header
        const orderRecord = {
            id: orderId || undefined,
            order_number: orderNoInput.value,
            order_date: existingOrder ? existingOrder.order_date : new Date().toISOString().split('T')[0],
            sales_name: salesName,
            status: existingOrder ? existingOrder.status : 'Pending Approval',
            notes: document.getElementById('m-req-notes').value,
            customer_id: parseInt(document.getElementById('m-req-customer')?.value) || null
        };

        const { data: savedOrder, error } = await saveData('request_orders', orderRecord);
        if (error) {
            alert((window.t ? window.t('alert_order_failed') : "Ordering failed: {msg}").replace("{msg}", error.message));
            return;
        }

        // If editing approved/preparing order: update qty in-place and sync plans
        const isApprovedEdit = existingOrder && (existingOrder.status === 'Preparing' || existingOrder.status === 'Approved');
        
        if (orderId !== null && isApprovedEdit) {
            // Update qty on existing items and sync linked plans
            const { data: allPlans } = await fetchData('roasting_plans');
            
            for (const r of rows) {
                const originalItemId = parseInt(r.dataset.originalItemId);
                const newQty = parseInt(r.querySelector('.item-qty').value);
                
                // Find the existing item
                const oldItem = (requestOrderItems || []).find(i => i.id === originalItemId);
                if (!oldItem) continue;
                
                const oldQty = oldItem.quantity_requested;
                oldItem.quantity_requested = newQty;
                
                // Recalculate pending qty (new total minus already allocated)
                const allocated = oldItem.quantity_allocated || 0;
                oldItem.quantity_pending = Math.max(0, newQty - allocated);
                
                await saveData('request_order_items', oldItem);
                
                // Update linked plan target if exists
                const linkedPlan = (allPlans || []).find(p => p.request_order_item_id === originalItemId);
                if (linkedPlan) {
                    const pendingQty = oldItem.quantity_pending;
                    const weightKg = (pendingQty * parseInt(oldItem.bag_size_g)) / 1000;
                    const targetRoast = weightKg / 0.85;
                    linkedPlan.target_roasted_kg = parseFloat(targetRoast.toFixed(2));
                    
                    // Check if plan is now completed
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
            
            // Save new items
            for (const r of rows) {
                const val = r.querySelector('.item-select').value;
                const [type, idStr] = val.split('-');
                const qty = parseInt(r.querySelector('.item-qty').value);
                const machId = r.querySelector('.item-machine').value ? parseInt(r.querySelector('.item-machine').value) : null;
                
                const itemRecord = {
                    request_order_id: savedOrder.id,
                    coffee_type: type,
                    single_coffee_id: type === 'Single' ? parseInt(idStr) : null,
                    blend_recipe_id: type === 'Blend' ? parseInt(idStr) : null,
                    machine_id: machId,
                    bag_size_g: parseInt(r.querySelector('.item-size').value),
                    quantity_requested: qty,
                    quantity_allocated: 0,
                    quantity_pending: qty,
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
            for (const r of rows) {
                const val = r.querySelector('.item-select').value;
                const [type, idStr] = val.split('-');
                const qty = parseInt(r.querySelector('.item-qty').value);
                const machId = r.querySelector('.item-machine').value ? parseInt(r.querySelector('.item-machine').value) : null;
                
                const itemRecord = {
                    request_order_id: savedOrder.id,
                    coffee_type: type,
                    single_coffee_id: type === 'Single' ? parseInt(idStr) : null,
                    blend_recipe_id: type === 'Blend' ? parseInt(idStr) : null,
                    machine_id: machId,
                    bag_size_g: parseInt(r.querySelector('.item-size').value),
                    quantity_requested: qty,
                    quantity_allocated: 0,
                    quantity_pending: qty,
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
    });
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

// ==========================================================================
// SECTION 6: USER MANAGEMENT
// ==========================================================================
async function loadUsersSection() {
    const { data: users } = await fetchData('profiles');
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = '';

    // Hide Developer role users from the list (incognito)
    const visibleUsers = (users || []).filter(u => u.role !== 'Developer');

    if (visibleUsers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No operator accounts registered.</td></tr>`;
        return;
    }

    const sortedUsers = [...visibleUsers].sort((a, b) => (b.created_at && a.created_at ? new Date(b.created_at) - new Date(a.created_at) : 0));

    sortedUsers.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${user.name}</strong></td>
            <td><code>${user.email || '-'}</code></td>
            <td><span class="potential-badge">${user.role}</span></td>
            <td>${user.created_at ? new Date(user.created_at).toLocaleDateString() : '2026-06-28'}</td>
            <td>
                <button class="btn btn-secondary btn-sm btn-edit-user" data-id="${user.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-edit-user').forEach(btn => {
        btn.addEventListener('click', () => editUserRole(btn.getAttribute('data-id')));
    });
}

async function editUserRole(userId) {
    const { data: users } = await fetchData('profiles');
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const roles = JSON.parse(localStorage.getItem('mock_custom_roles')) || [];
    const roleOptions = roles.filter(r => r.name !== 'Developer').map(r => 
        `<option value="${r.name}" ${user.role === r.name ? 'selected' : ''}>${r.name}</option>`
    ).join('');
    
    const html = `
        <form id="modal-edit-role-form">
            <div class="form-group">
                <label class="form-label">User</label>
                <input type="text" class="form-control" value="${user.name}" disabled>
            </div>
            <div class="form-group">
                <label class="form-label">Assign Role</label>
                <select id="m-edit-role" class="form-control">${roleOptions}</select>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Role</button>
            </div>
        </form>
    `;
    openModal('Edit User Role', html);
    document.getElementById('modal-edit-role-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newRole = document.getElementById('m-edit-role').value;
        const { error } = await saveData('profiles', { id: user.id, role: newRole });
        if (error) {
            alert('Failed to save role: ' + error.message);
            return;
        }
        document.getElementById('btn-close-modal').click();
        loadUsersSection();
    });
}

// Invite new user modal
document.getElementById('btn-invite-user').addEventListener('click', () => {
    const roles = JSON.parse(localStorage.getItem('mock_custom_roles')) || [];
    const roleOptionsHtml = roles.filter(r => r.name !== 'Developer').map(r => 
        `<option value="${r.name}">${r.name}</option>`
    ).join('');

    const passwordFieldHtml = !isMockMode ? `
        <div class="form-group" style="margin-top: 12px;">
            <label class="form-label">Initial Password</label>
            <input type="password" id="m-inv-pass" class="form-control" placeholder="Minimum 6 characters" required minlength="6">
        </div>
    ` : '';

    const html = `
        <form id="modal-invite-form">
            <div class="form-group">
                <label class="form-label">Full Name</label>
                <input type="text" id="m-inv-name" class="form-control" placeholder="e.g. Alice Roaster" required>
            </div>
            <div class="form-group" style="margin-top: 12px;">
                <label class="form-label">Email Address</label>
                <input type="email" id="m-inv-user" class="form-control" placeholder="e.g. alice@roastery.com" required>
            </div>
            ${passwordFieldHtml}
            <div class="form-group" style="margin-top: 12px;">
                <label class="form-label">Assigned Work Role</label>
                <select id="m-inv-role" class="form-control">${roleOptionsHtml}</select>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 25px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Create Account</button>
            </div>
        </form>
    `;

    openModal('Register New Operator Account', html);

    document.getElementById('modal-invite-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('m-inv-name').value;
        const email = document.getElementById('m-inv-user').value;
        const role = document.getElementById('m-inv-role').value;

        if (isMockMode) {
            const record = {
                id: 'mock-' + Math.random().toString(36).substr(2, 9),
                name: name,
                username: email,
                role: role,
                created_at: new Date().toISOString()
            };

            await saveData('profiles', record);
            modalContainer.classList.add('hidden');
            loadUsersSection();
        } else {
            const password = document.getElementById('m-inv-pass').value;
            
            // 1. Sign up the user in Supabase auth using a temporary client
            // We use a temp client so it doesn't log out the current admin session!
            const tempClient = supabase.createClient(
                window.SUPABASE_URL,
                window.SUPABASE_ANON_KEY,
                {
                    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
                }
            );

            const { data, error } = await tempClient.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        full_name: name,
                        user_name: email.split('@')[0]
                    }
                }
            });

            if (error) {
                console.error("Supabase SignUp Error:", error);
                let msg = error.message || "Unknown error occurred";
                if (msg === '{}') {
                    msg = "Error dari database (pastikan tabel profiles sudah sesuai dan tidak ada error pada trigger on_auth_user_created).";
                }
                alert("Registration failed: " + msg);
                return;
            }

            // 2. Wait a split second for trigger to insert into profiles, then update role
            if (data.user) {
                setTimeout(async () => {
                    const { error: profileError } = await window.supabaseClient
                        .from('profiles')
                        .update({ role: role })
                        .eq('id', data.user.id);
                    if (profileError) {
                        console.error("Failed to update role in profile:", profileError);
                    }
                    loadUsersSection();
                }, 800);
            }

            alert("Operator account created successfully!" + 
                  "\nNote: If email confirmation is enabled in your Supabase Dashboard, the user must click the confirmation link in their email inbox before they can sign in.");
            
            modalContainer.classList.add('hidden');
            loadUsersSection();
        }
    });
});

// ============================================================
// ROLE & PERMISSIONS MANAGEMENT
// ============================================================
const PERMISSION_GROUPS = [
    { label: '📊 Dashboard', keys: [{ key: 'dashboard', label: 'Access Dashboard' }] },
    { label: '🌿 Greenbean — Inventory', keys: [
        { key: 'greenbean_view', label: 'View Stock' },
        { key: 'greenbean_edit', label: 'Edit / Adjust Stock' },
        { key: 'greenbean_delete', label: 'Delete Greenbean' }
    ]},
    { label: '☕ Bulk Roasted Coffee', keys: [
        { key: 'bulk_view', label: 'View' },
        { key: 'bulk_edit', label: 'Edit' },
        { key: 'bulk_delete', label: 'Delete' }
    ]},
    { label: '📦 Packed Coffee Stock', keys: [
        { key: 'packed_view', label: 'View' },
        { key: 'packed_edit', label: 'Edit' },
        { key: 'packed_delete', label: 'Delete' }
    ]},
    { label: '🌿 Greenbean — Arrival', keys: [
        { key: 'greenbean_arrival_view', label: 'View' },
        { key: 'greenbean_arrival_add', label: 'Add Lot' },
        { key: 'greenbean_arrival_edit', label: 'Edit Lot' },
        { key: 'greenbean_arrival_delete', label: 'Delete Lot' }
    ]},
    { label: '🔥 Roasting — Plans', keys: [
        { key: 'roasting_view', label: 'View' },
        { key: 'roasting_plan_add', label: 'Add Plan' },
        { key: 'roasting_plan_edit', label: 'Edit Plan' },
        { key: 'roasting_plan_delete', label: 'Delete Plan' }
    ]},
    { label: '🔥 Roasting — Batch Logs', keys: [
        { key: 'roasting_batch_view', label: 'View' },
        { key: 'roasting_batch_add', label: 'Add Batch' },
        { key: 'roasting_batch_edit', label: 'Edit Batch' },
        { key: 'roasting_batch_delete', label: 'Delete Batch' },
        { key: 'roasting_batch_approve', label: 'Approve Test Batch' }
    ]},
    { label: '🔥 Roasting — Blend Recipes', keys: [
        { key: 'blend_view', label: 'View' },
        { key: 'blend_add', label: 'Add Recipe' },
        { key: 'blend_edit', label: 'Edit Recipe' },
        { key: 'blend_delete', label: 'Delete Recipe' }
    ]},
    { label: '🔥 Roasting — Production Potential', keys: [
        { key: 'production_potential_view', label: 'View' }
    ]},
    { label: '📦 Packing', keys: [
        { key: 'packing_view', label: 'View Packing Page' },
        { key: 'packing_daily', label: 'Daily Packing (pack)' },
        { key: 'packing_order_view', label: 'View Order Requests' },
        { key: 'packing_records_view', label: 'View Records' },
        { key: 'packing_unpack', label: 'Unpack' },
        { key: 'packing_completed_view', label: 'View Completed Orders' }
    ]},
    { label: '🚚 Sales — Dispatch Request', keys: [
        { key: 'sales_request_view', label: 'View' },
        { key: 'sales_request_create', label: 'Create Order' },
        { key: 'sales_request_edit', label: 'Edit Order' },
        { key: 'sales_request_delete', label: 'Delete Order' },
        { key: 'sales_request_print', label: 'Print Order' }
    ]},
    { label: '🚚 Sales — Dispatch Approval', keys: [
        { key: 'dispatch_approval_view', label: 'View' },
        { key: 'dispatch_approval_approve', label: 'Approve Order' },
        { key: 'dispatch_approval_dispatch', label: 'Dispatch Order' },
        { key: 'dispatch_approval_print', label: 'Print Waybill' }
    ]},
    { label: '👥 Customers', keys: [
        { key: 'customer_view', label: 'View Customers' },
        { key: 'customer_add', label: 'Add Customer' },
        { key: 'customer_edit', label: 'Edit Customer' },
        { key: 'customer_delete', label: 'Delete Customer' }
    ]},
    { label: '📈 Reports', keys: [
        { key: 'reports_view', label: 'View Reports' },
        { key: 'reports_stockopname_view', label: 'Stock Opname Tab' }
    ]},
    { label: '⚙️ Settings', keys: [
        { key: 'settings_general', label: 'General' },
        { key: 'settings_production', label: 'Production' },
        { key: 'settings_system', label: 'System' }
    ]},
    { label: '🔐 Administration', keys: [{ key: 'user_management', label: 'User & Role Management' }] }
];

function loadRoleManagement() {
    const container = document.getElementById('roles-list-container');
    if (!container) return;

    const roles = JSON.parse(localStorage.getItem('mock_custom_roles')) || [];

    // Canonical permission key set (the master list). Older roles were seeded
    // before some keys were added, so their own permissions object may have
    // fewer keys — counting against Object.keys(role.permissions) made the
    // denominator inconsistent (e.g. one role "/41", another "/45"). Always
    // measure against the full canonical set so every row shows the same total.
    const ALL_PERM_KEYS = PERMISSION_GROUPS.flatMap(g => g.keys.map(k => k.key));
    const totalPerms = ALL_PERM_KEYS.length;

    container.innerHTML = roles.map(role => {
        const permCount = ALL_PERM_KEYS.filter(key => roleHasPermission(role, key)).length;
        const pctColor = permCount === totalPerms ? '#16a34a' : permCount > totalPerms / 2 ? '#ca8a04' : '#dc2626';
        
        return `
        <div style="border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 8px; background: var(--bg-card); display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 10px; height: 10px; border-radius: 50%; background: ${role.color};"></div>
                <div>
                    <span style="font-weight: 700; font-size: 0.9rem;">${role.name}</span>
                    ${role.is_system ? '<span style="font-size: 0.65rem; background: var(--bg-hover); padding: 1px 6px; border-radius: 4px; margin-left: 6px; color: var(--text-muted);">System</span>' : ''}
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
                        <span style="color: ${pctColor}; font-weight: 600;">${permCount}</span> / ${totalPerms} permissions
                    </div>
                </div>
            </div>
            <div style="display: flex; gap: 6px;">
                <button class="btn btn-secondary btn-sm btn-edit-role" data-id="${role.id}" style="padding: 4px 10px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
                ${!role.is_system ? `<button class="btn btn-danger btn-sm btn-delete-role" data-id="${role.id}" style="padding: 4px 10px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>` : ''}
            </div>
        </div>`;
    }).join('');
    
    container.querySelectorAll('.btn-edit-role').forEach(btn => {
        btn.addEventListener('click', () => openRoleModal(parseInt(btn.getAttribute('data-id'))));
    });
    container.querySelectorAll('.btn-delete-role').forEach(btn => {
        btn.addEventListener('click', () => deleteRole(parseInt(btn.getAttribute('data-id'))));
    });

    // The enclosing settings accordion locks its max-height to a fixed pixel
    // value when first opened. Adding/removing roles changes the list height,
    // so with overflow:hidden the extra rows get clipped (invisible). If the
    // accordion is currently open, grow its max-height to fit the new content.
    const accBody = container.closest('.settings-card-body, .settings-accordion-body');
    if (accBody && accBody.style.maxHeight && accBody.style.maxHeight !== '0px') {
        accBody.style.maxHeight = accBody.scrollHeight + 'px';
    }
}

function openRoleModal(roleId) {
    const roles = JSON.parse(localStorage.getItem('mock_custom_roles')) || [];
    const role = roleId ? roles.find(r => r.id === roleId) : null;
    const isSystem = role ? role.is_system : false;
    const title = role ? `Edit Role: ${role.name}` : 'Create New Role';
    
    const colors = ['#dc2626','#b45309','#16a34a','#0369a1','#6b21a8','#475569','#2d5016','#7c3aed','#0891b2','#be185d'];
    const currentColor = role ? role.color : '#0369a1';
    
    const colorPicker = colors.map(c => 
        `<div class="role-color-opt" data-color="${c}" style="width:24px;height:24px;border-radius:6px;background:${c};cursor:pointer;border:2px solid ${c === currentColor ? 'var(--text-primary)' : 'transparent'};transition:all 0.2s;" onclick="document.querySelectorAll('.role-color-opt').forEach(e=>e.style.borderColor='transparent');this.style.borderColor='var(--text-primary)';document.getElementById('m-role-color').value=this.dataset.color;"></div>`
    ).join('');
    
    const permGroups = PERMISSION_GROUPS.map(group => {
        const checkboxes = group.keys.map(k => {
            // roleHasPermission (not the raw stored value) so a role that
            // inherits a split-out permission via fallback shows the box
            // checked — otherwise saving the role would silently strip that
            // inherited access by writing the key as false.
            const checked = role ? roleHasPermission(role, k.key) : false;
            const disabled = isSystem ? 'disabled' : '';
            return `<label style="display:inline-flex;align-items:center;gap:4px;font-size:0.8rem;color:var(--text-secondary);cursor:${isSystem ? 'not-allowed' : 'pointer'};min-width:140px;">
                <input type="checkbox" name="perm_${k.key}" ${checked ? 'checked' : ''} ${disabled} style="accent-color:var(--primary);"> ${k.label}
            </label>`;
        }).join('');
        return `<div style="margin-bottom:12px;">
            <div style="font-size:0.8rem;font-weight:700;color:var(--text-primary);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border);">${group.label}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px 16px;">${checkboxes}</div>
        </div>`;
    }).join('');
    
    const html = `
        <form id="modal-role-form">
            <input type="hidden" id="m-role-id" value="${roleId || ''}">
            <input type="hidden" id="m-role-color" value="${currentColor}">
            <div class="form-group" style="margin-bottom:14px;">
                <label class="form-label">Role Name</label>
                <input type="text" id="m-role-name" class="form-control" value="${role ? role.name : ''}" placeholder="e.g. QC Inspector" required ${isSystem ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin-bottom:16px;">
                <label class="form-label">Color</label>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">${colorPicker}</div>
            </div>
            <div style="max-height:350px;overflow-y:auto;padding-right:8px;margin-bottom:16px;border:1px solid var(--border);border-radius:8px;padding:14px;">
                <h4 style="margin:0 0 12px;font-size:0.9rem;">Permissions</h4>
                ${permGroups}
            </div>
            ${isSystem ? '<p style="font-size:0.75rem;color:var(--text-muted);text-align:center;">⚠️ System roles cannot be modified.</p>' : ''}
            <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:16px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                ${!isSystem ? '<button type="submit" class="btn btn-primary">Save Role</button>' : ''}
            </div>
        </form>
    `;
    
    openModal(title, html);
    
    if (!isSystem) {
        document.getElementById('modal-role-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveRole();
        });
    }
}

async function saveRole() {
    const roles = JSON.parse(localStorage.getItem('mock_custom_roles')) || [];
    const roleId = document.getElementById('m-role-id').value;
    const roleName = document.getElementById('m-role-name').value.trim();
    const roleColor = document.getElementById('m-role-color').value;

    if (!roleName) { alert('Role name is required.'); return; }

    // Check duplicate name
    const duplicate = roles.find(r => r.name.toLowerCase() === roleName.toLowerCase() && String(r.id) !== String(roleId));
    if (duplicate) { alert('A role with this name already exists.'); return; }

    // Collect permissions from checkboxes
    const permissions = {};
    PERMISSION_GROUPS.forEach(group => {
        group.keys.forEach(k => {
            const cb = document.querySelector(`input[name="perm_${k.key}"]`);
            permissions[k.key] = cb ? cb.checked : false;
        });
    });

    const record = { name: roleName, color: roleColor, is_system: false, permissions };
    if (roleId) record.id = parseInt(roleId);

    const { error } = await upsertData('custom_roles', record);
    if (error) {
        console.error('Failed to save role to Supabase:', error);
        alert('Failed to save role: ' + error.message);
        return;
    }

    await syncCustomRolesFromSupabase();
    document.getElementById('btn-close-modal').click();
    loadRoleManagement();
    applyRoleAccess(); // re-apply in case current user's role was edited
}

async function deleteRole(roleId) {
    const roles = JSON.parse(localStorage.getItem('mock_custom_roles')) || [];
    const role = roles.find(r => r.id === roleId);
    if (!role) return;
    if (role.is_system) { alert('System roles cannot be deleted.'); return; }

    if (!await showWarningModal(`Delete role "${role.name}"? Users with this role will lose their access configuration.`)) return;

    const { error } = await window.supabaseClient.from('custom_roles').delete().eq('id', roleId);
    if (error) {
        console.error('Failed to delete role from Supabase:', error);
        alert('Failed to delete role: ' + error.message);
        return;
    }

    await syncCustomRolesFromSupabase();
    loadRoleManagement();
}

// Wire up Create Role button
const btnAddRole = document.getElementById('btn-add-role');
if (btnAddRole) {
    btnAddRole.addEventListener('click', () => openRoleModal(null));
}

// --- MACHINE MANAGEMENT SECTION (SUB-TAB 4) ---
async function loadMachinesSection() {
    const { data: machines } = await fetchData('machines');
    const tbody = document.getElementById('machines-table-body');
    tbody.innerHTML = '';

    if (machines.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">${window.t("msg_no_machines")}</td></tr>`;
        return;
    }

    const sortedMachines = [...machines].sort((a, b) => b.id - a.id);

    sortedMachines.forEach(mach => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${mach.name}</strong></td>
            <td><code>${mach.code}</code></td>
            <td>${mach.capacity_g ? mach.capacity_g + ' g' : mach.ideal_batch_size_g + ' g'}</td>
            <td>${mach.ideal_batch_size_g} g</td>
            <td>
                <button class="btn btn-secondary btn-sm btn-edit-machine" data-id="${mach.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
                <button class="btn btn-danger btn-sm btn-delete-machine" data-id="${mach.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-edit-machine').forEach(btn => {
        btn.addEventListener('click', () => openMachineModal(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-delete-machine').forEach(btn => {
        btn.addEventListener('click', () => deleteMachine(parseInt(btn.getAttribute('data-id'))));
    });
}

async function openMachineModal(id = null) {
    let mach = { name: '', code: '', capacity_g: 5000, ideal_batch_size_g: 5000 };
    if (id) {
        const { data: machines } = await fetchData('machines');
        mach = machines.find(m => m.id === id) || mach;
    }

    const html = `
        <form id="modal-machine-form">
            <div class="form-group">
                <label class="form-label" data-i18n="col_m_name">Machine Name</label>
                <input type="text" id="m-mach-name" class="form-control" value="${mach.name}" placeholder="e.g. Probat 12kg" required>
            </div>
            <div class="form-group">
                <label class="form-label" data-i18n="col_m_code">Code</label>
                <input type="text" id="m-mach-code" class="form-control" value="${mach.code}" placeholder="e.g. M4" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" data-i18n="col_m_capacity">Capacity (g)</label>
                    <input type="number" id="m-mach-capacity" class="form-control" value="${mach.capacity_g || mach.ideal_batch_size_g}" required>
                </div>
                <div class="form-group">
                    <label class="form-label" data-i18n="col_m_ideal">Ideal Batch Size (g)</label>
                    <input type="number" id="m-mach-ideal" class="form-control" value="${mach.ideal_batch_size_g}" required>
                </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Machine</button>
            </div>
        </form>
    `;

    openModal(id ? 'Edit Roaster Machine' : 'Add Roaster Machine', html);
    window.translatePage(); // apply dynamic translations

    document.getElementById('modal-machine-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const record = {
            id: id || undefined,
            name: document.getElementById('m-mach-name').value,
            code: document.getElementById('m-mach-code').value,
            capacity_g: parseInt(document.getElementById('m-mach-capacity').value),
            ideal_batch_size_g: parseInt(document.getElementById('m-mach-ideal').value)
        };

        const { error } = await saveData('machines', record);
        if (error) {
            alert(window.t("alert_save_failed").replace("{msg}", error.message));
        } else {
            modalContainer.classList.add('hidden');
            loadMachinesSection();
        }
    });
}

async function deleteMachine(id) {
    if (await showDeleteConfirmModal('this roaster machine')) {
        const { error } = await deleteData('machines', id);
        if (error) {
            await showWarningModal(window.t("alert_delete_failed").replace("{msg}", error.message), false);
        } else {
            loadMachinesSection();
        }
    }
}

// ==========================================================================
// SECTION 7: SYSTEM SETTINGS
// ==========================================================================
document.getElementById('settings-minqty-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    companySettings.min_stock_greenbean_kg = parseFloat(document.getElementById('sett-min-greenbean').value) || 0;
    companySettings.min_production_potential_kg = parseFloat(document.getElementById('sett-min-prod-potential').value) || 0;
    
    // Save packed sizes minimums
    const sizeInputs = document.querySelectorAll('.minqty-size-input');
    const minPacked = {};
    sizeInputs.forEach(input => {
        const size = input.getAttribute('data-size');
        const val = parseInt(input.value) || 0;
        minPacked[size] = val;
    });
    companySettings.min_stock_packed_sizes = minPacked;

    if (isMockMode) {
        localStorage.setItem('mock_company_settings', JSON.stringify(companySettings));
        alert(window.t("alert_settings_saved") || "Settings saved successfully.");
    } else {
        const { error } = await upsertData('company_settings', {
            id: 1,
            min_stock_greenbean_kg: companySettings.min_stock_greenbean_kg,
            min_production_potential_kg: companySettings.min_production_potential_kg,
            min_stock_packed_sizes: companySettings.min_stock_packed_sizes
        });

        if (error) {
            console.error(error);
            alert("Failed to save minimum quantities: " + error.message);
        } else {
            alert(window.t("alert_settings_saved") || "Settings saved successfully.");
        }
    }
});

document.getElementById('settings-company-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    companySettings.company_name = document.getElementById('sett-company-name').value;
    companySettings.slogan = document.getElementById('sett-slogan').value;
    companySettings.phone = document.getElementById('sett-phone').value;
    companySettings.email = document.getElementById('sett-email').value;
    companySettings.address = document.getElementById('sett-address').value;
    companySettings.weight_unit = document.getElementById('sett-weight').value;
    companySettings.currency = document.getElementById('sett-currency').value;

    if (isMockMode) {
        localStorage.setItem('mock_company_settings', JSON.stringify(companySettings));
    } else {
        const { error } = await upsertData('company_settings', { id: 1, ...companySettings });
        if (error) {
            alert("Failed to save company profile: " + error.message);
            return;
        }
    }

    applyCompanySettings();
    alert(window.t("alert_settings_saved"));
});

document.getElementById('settings-print-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    companySettings.handover_title = document.getElementById('sett-print-title').value;
    companySettings.show_logo_in_print = document.getElementById('sett-print-logo').checked;
    companySettings.print_footer_text = document.getElementById('sett-print-footer').value;

    if (isMockMode) {
        localStorage.setItem('mock_company_settings', JSON.stringify(companySettings));
    } else {
        const { error } = await upsertData('company_settings', { id: 1, ...companySettings });
        if (error) {
            alert("Failed to save print settings: " + error.message);
            return;
        }
    }

    applyCompanySettings();
    alert(window.t("alert_settings_saved"));
});

document.getElementById('settings-label-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    companySettings.label_width = parseInt(document.getElementById('sett-label-width').value);
    companySettings.label_height = parseInt(document.getElementById('sett-label-height').value);
    companySettings.label_show_code = document.getElementById('sett-label-show-code').checked;
    companySettings.label_show_coffee = document.getElementById('sett-label-show-coffee').checked;
    companySettings.label_show_date = document.getElementById('sett-label-show-date').checked;
    companySettings.label_show_machine = document.getElementById('sett-label-show-machine').checked;
    companySettings.label_show_weight = document.getElementById('sett-label-show-weight').checked;
    companySettings.label_show_dep = document.getElementById('sett-label-show-dep').checked;
    companySettings.label_show_operator = document.getElementById('sett-label-show-operator').checked;

    if (isMockMode) {
        localStorage.setItem('mock_company_settings', JSON.stringify(companySettings));
    } else {
        const { error } = await upsertData('company_settings', { id: 1, ...companySettings });
        if (error) {
            alert("Failed to save label settings: " + error.message);
            return;
        }
    }

    applyCompanySettings();
    alert(window.t("alert_settings_saved"));
});

// Logo base64 converter
document.getElementById('sett-logo-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onloadend = async () => {
            companySettings.logo_base64 = reader.result;
            if (isMockMode) {
                localStorage.setItem('mock_company_settings', JSON.stringify(companySettings));
            } else {
                const { error } = await upsertData('company_settings', { id: 1, logo_base64: reader.result });
                if (error) {
                    alert("Failed to save logo: " + error.message);
                    return;
                }
            }
            applyCompanySettings();
        };
        reader.readAsDataURL(file);
    }
});

// Logo file picker trigger
const logoInput = document.getElementById('sett-logo-upload');

// Theme toggling is handled inline in index.html to ensure it runs immediately and independently

// --- PROTOTYPE ROLE SWITCHER ---
const roleSwitcher = document.getElementById('role-play-switcher');
if (roleSwitcher) {
    roleSwitcher.addEventListener('change', () => {
        const selectedRole = roleSwitcher.value;
        if (isMockMode) {
            localStorage.setItem('mock_active_role', selectedRole);
            currentUser.role = selectedRole;
            document.getElementById('user-role-lbl').textContent = selectedRole;
            alert(window.t("alert_simulating_role").replace("{role}", selectedRole));
        }
    });
}

// --- THEME SWITCHER ---
// Handled inline in HTML

// --- LANGUAGE SWITCHER ---
const langSwitcher = document.getElementById('language-switcher');
if (langSwitcher) {
    langSwitcher.value = window.currentLanguage;
    // event listener is handled inline in HTML to avoid double-firing
}
window.addEventListener('languageChanged', (e) => {
    if (langSwitcher) {
        langSwitcher.value = e.detail;
    }
    
    // Reload all active sections to refresh dynamically generated texts and tables
    const dashboardSec = document.getElementById('sec-dashboard');
    if (dashboardSec && !dashboardSec.classList.contains('hidden')) {
        scheduleDashboardRefresh();
    }
    const greenbeanSec = document.getElementById('sec-greenbean');
    if (greenbeanSec && !greenbeanSec.classList.contains('hidden')) {
        loadGreenbeanInventory();
        loadBlendRecipes();
        loadRecipeProductionPotential();
        loadIntakeHistory();
    }
    const roastingSec = document.getElementById('sec-roasting');
    if (roastingSec && !roastingSec.classList.contains('hidden')) {
        loadRoastingPlans();
        loadRoastingBatches();
    }
    const packingSec = document.getElementById('sec-packing');
    if (packingSec && !packingSec.classList.contains('hidden')) {
        loadPackingSection();
    }
    const handoverSec = document.getElementById('sec-handover');
    if (handoverSec && !handoverSec.classList.contains('hidden')) {
        loadHandoverSection();
    }
    const usersSec = document.getElementById('sec-users');
    if (usersSec && !usersSec.classList.contains('hidden')) {
        loadUsersSection();
    }
    const settingsSec = document.getElementById('sec-settings');
    if (settingsSec && !settingsSec.classList.contains('hidden')) {
        loadMachinesSection();
        loadPackagingSizesTable();
    }
    const reportsSec = document.getElementById('sec-reports');
    if (reportsSec && !reportsSec.classList.contains('hidden')) {
        loadReportsSection();
    }
});

// --- REGISTER DYNAMIC ENTITY MODAL TRIGGER BUTTONS ---
const btnAddGb = document.getElementById('btn-add-greenbean');
if (btnAddGb) {
    btnAddGb.addEventListener('click', () => openGreenbeanModal());
}

const btnAddLot = document.getElementById('btn-add-lot');
if (btnAddLot) {
    btnAddLot.addEventListener('click', () => openIntakeModal());
    btnAddLot.style.display = hasPermission('greenbean_arrival_add') ? '' : 'none';
}

// RBAC: hide Arrival tab if no permission
const arrivalTabBtn = document.querySelector('#sec-greenbean .tab-btn[data-tab="tab-add-gb-history"]');
if (arrivalTabBtn) arrivalTabBtn.style.display = hasPermission('greenbean_arrival_view') ? '' : 'none';

const btnAddRec = document.getElementById('btn-add-recipe');
if (btnAddRec) {
    btnAddRec.addEventListener('click', () => openRecipeModal());
}

const btnAddMach = document.getElementById('btn-add-machine');
if (btnAddMach) {
    btnAddMach.addEventListener('click', () => openMachineModal());
}

// --- PACKAGING SIZES MANAGEMENT ---
async function loadPackagingSizesTable() {
    const tbody = document.getElementById('packaging-sizes-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const { data: sizes, error: fetchErr } = await fetchData('packaging_sizes');
    console.log('[PackagingSize] fetchData result:', { sizes, fetchErr });
    
    if (fetchErr) {
        console.error('[PackagingSize] Fetch error:', fetchErr);
        // Force direct fetch bypassing cache
        try {
            const { data: directData } = await window.supabaseClient.from('packaging_sizes').select('id, label, gram, is_visible');
            console.log('[PackagingSize] Direct fetch result:', directData);
            if (directData && directData.length > 0) {
                renderPackagingSizesRows(tbody, directData);
                return;
            }
        } catch(e) { console.error('[PackagingSize] Direct fetch also failed:', e); }
    }

    if (!sizes || sizes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No packaging sizes found.</td></tr>`;
        return;
    }
    
    renderPackagingSizesRows(tbody, sizes);
}

function renderPackagingSizesRows(tbody, sizes) {
    sizes.sort((a,b) => (parseFloat(a.gram)||0) - (parseFloat(b.gram)||0)).forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${s.label}</strong></td>
            <td>${s.gram} g</td>
            <td>
                <label class="switch" style="transform: scale(0.8); transform-origin: left center;">
                    <input type="checkbox" class="toggle-visibility-pack" data-id="${s.id}" ${s.is_visible ? 'checked' : ''} disabled>
                    <span class="slider round"></span>
                </label>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-outline btn-sm btn-edit-pack-size" data-id="${s.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>
                    <button class="btn btn-danger btn-sm btn-delete-pack-size" data-id="${s.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    document.querySelectorAll('.btn-edit-pack-size').forEach(btn => {
        btn.addEventListener('click', () => openPackagingSizeModal(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-delete-pack-size').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (await showDeleteConfirmModal('this packaging size')) {
                await deleteData('packaging_sizes', parseInt(btn.getAttribute('data-id')));
                loadPackagingSizesTable();
                scheduleDashboardRefresh();
            }
        });
    });
}

async function openPackagingSizeModal(id = null) {
    let size = { label: '', gram: 250, is_visible: true };
    if (id) {
        const { data: sizes } = await fetchData('packaging_sizes');
        const found = sizes.find(s => s.id === id);
        if (found) size = found;
    }
    
    const html = `
        <div id="modal-pack-size-form">
            <div class="form-group">
                <label class="form-label">Label / Size Name</label>
                <input type="text" id="m-ps-label" class="form-control" value="${size.label}" placeholder="e.g. 250g, Small Bag" required>
            </div>
            <div class="form-group">
                <label class="form-label">Weight in Grams (Used for Stock Deduction)</label>
                <input type="number" id="m-ps-gram" class="form-control" value="${size.gram}" min="1" required>
            </div>
            <div class="form-group" style="display: flex; align-items: center; gap: 10px; margin-top: 20px;">
                <label class="switch">
                    <input type="checkbox" id="m-ps-visible" ${size.is_visible ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
                <label class="form-label" style="margin-bottom:0; cursor:pointer;" for="m-ps-visible">Show in Packing Form</label>
            </div>
            <button type="button" id="btn-save-pack-size" class="btn btn-primary" style="width:100%; margin-top:24px;">Save Size</button>
        </div>
    `;
    
    openModal(id ? 'Edit Packaging Size' : 'Add Packaging Size', html);
    
    document.getElementById('btn-save-pack-size').onclick = async () => {
        const labelInput = document.getElementById('m-ps-label').value.trim();
        const gramInput = document.getElementById('m-ps-gram').value;
        
        if (!labelInput || !gramInput) {
            alert("Please fill all required fields.");
            return;
        }
        
        const saveDataObj = {
            label: labelInput,
            gram: parseFloat(gramInput),
            is_visible: document.getElementById('m-ps-visible').checked
        };
        
        if (id) saveDataObj.id = id;
        
        console.log('[PackagingSize] Saving:', saveDataObj);
        const { error } = await saveData('packaging_sizes', saveDataObj);
        if (error) {
            console.error('[PackagingSize] Save failed:', error);
            alert('Failed to save packaging size: ' + error.message);
            return;
        }
        
        modalContainer.classList.add('hidden');
        loadPackagingSizesTable();
        scheduleDashboardRefresh();
    };
}

const btnAddPackSize = document.getElementById('btn-add-pack-size');
if (btnAddPackSize) {
    btnAddPackSize.addEventListener('click', () => openPackagingSizeModal());
}

// --- RESET MOCK DATABASE (flush bloated localStorage) ---
window.resetMockDatabase = async function() {
    if (!await showWarningModal('⚠️ This will RESET all data to default sample data. All your test entries will be lost. Continue?')) return;
    // Clear all mock tables
    for (const key in MOCK_DB) {
        localStorage.removeItem(`mock_${key}`);
    }
    localStorage.removeItem('mock_company_settings');
    localStorage.removeItem('mock_custom_roles');
    // Re-seed defaults
    initMockDatabases();
    // Clear in-memory cache
    _dbCache.clear();
    await showWarningModal('✅ Database reset to defaults. Refreshing page...', false);
    location.reload();
};

window.debugInspectStorage = function() {
    const infoEl = document.getElementById('debug-storage-info');
    if (!infoEl) return;
    let html = '<strong>localStorage Table Sizes:</strong><br>';
    let totalBytes = 0;
    for (const key in MOCK_DB) {
        const raw = localStorage.getItem(`mock_${key}`);
        const bytes = raw ? raw.length : 0;
        totalBytes += bytes;
        let parsed = [];
        try { parsed = JSON.parse(raw) || []; } catch(e) {}
        const rowCount = Array.isArray(parsed) ? parsed.length : '?';
        const kbStr = (bytes / 1024).toFixed(1) + ' KB';
        const warn = bytes > 50000 ? ' ⚠️ LARGE' : '';
        html += `${key}: <strong>${rowCount} rows</strong> (${kbStr})${warn}<br>`;
    }
    html += `<br><strong>Total: ${(totalBytes/1024).toFixed(1)} KB</strong>`;
    if (totalBytes > 200000) {
        html += ' — <span style="color:var(--danger); font-weight:bold;">⚠️ Database too large, this is causing freezes! Click Reset.</span>';
    }
    infoEl.innerHTML = html;
};

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

            // Find target element we are dragging over
            const siblings = [...container.querySelectorAll('.tab-btn:not(.dragging)')];
            const nextSibling = siblings.find(sibling => {
                const box = sibling.getBoundingClientRect();
                // Determine horizontal midpoint comparison for sorting order
                const offset = e.clientX - box.left - box.width / 2;
                return offset < 0;
            });

            if (nextSibling) {
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


async function loadBulkRoastedSection() {
    const [
        { data: bulkList },
        { data: machines }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('machines')
    ]);
    const tbody = document.getElementById('bulk-roasted-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Rewrite Header Dynamically
    const thead = tbody.parentElement.querySelector('thead');
    if (thead) {
        let thHtml = `<th data-i18n="col_name">${window.t ? window.t('col_name') || 'Coffee Name' : 'Coffee Name'}</th>`;
        machines.forEach(m => {
            thHtml += `<th>${m.name}</th>`;
        });
        thHtml += `<th>Action</th>`;
        thead.innerHTML = `<tr>${thHtml}</tr>`;
    }

    const activeBulk = [...bulkList]
        .filter(b => parseFloat(b.bulk_available) > 0.005);

    if (activeBulk.length === 0) {
        const colCount = 2 + machines.length;
        tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; color:var(--text-muted);">${window.t ? window.t("msg_no_bulk_avail") || "No bulk coffee available." : "No bulk coffee available."}</td></tr>`;
        return;
    }

    const grouped = {};
    activeBulk.forEach(rec => {
        if (!grouped[rec.coffee_name]) {
            grouped[rec.coffee_name] = {
                coffee_name: rec.coffee_name,
                machineTotals: {}
            };
        }
        
        if (!grouped[rec.coffee_name].machineTotals[rec.machine_id]) {
            grouped[rec.coffee_name].machineTotals[rec.machine_id] = 0;
        }
        grouped[rec.coffee_name].machineTotals[rec.machine_id] += parseFloat(rec.bulk_available);
    });

    const groupedArr = Object.values(grouped).sort((a,b) => a.coffee_name.localeCompare(b.coffee_name));

    groupedArr.forEach(grp => {
        const tr = document.createElement('tr');
        let tds = `<td><strong>${grp.coffee_name}</strong></td>`;
        
        machines.forEach(m => {
            const val = grp.machineTotals[m.id] || 0;
            tds += `<td>${val > 0 ? `<strong>${val.toFixed(1)} kg</strong>` : '<span style="color:var(--text-muted);">-</span>'}</td>`;
        });
        
        tds += `
            <td style="white-space: nowrap;">
                <button class="btn btn-outline btn-sm btn-edit-bulk" data-coffee="${encodeURIComponent(grp.coffee_name)}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>
                <button class="btn btn-danger btn-sm btn-delete-bulk" data-coffee="${encodeURIComponent(grp.coffee_name)}" style="margin-left: 4px;"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
            </td>
        `;
        tr.innerHTML = tds;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-edit-bulk').forEach(btn => {
        btn.addEventListener('click', () => openEditBulkModal(decodeURIComponent(btn.getAttribute('data-coffee'))));
    });

    document.querySelectorAll('.btn-delete-bulk').forEach(btn => {
        btn.addEventListener('click', async () => {
            const coffeeName = decodeURIComponent(btn.getAttribute('data-coffee'));
            const confirmed = await showWarningModal(`Are you sure you want to delete all bulk stock for "${coffeeName}"?\n\nThis action cannot be undone.`);
            if (!confirmed) return;
            const { data: allBulk } = await fetchData('bulk_roasted_coffee');
            const toDelete = (allBulk || []).filter(b => b.coffee_name === coffeeName);
            for (const item of toDelete) {
                await deleteData('bulk_roasted_coffee', item.id);
            }
            await loadBulkRoastedSection();
            scheduleDashboardRefresh();
        });
    });
}

async function openEditBulkModal(coffeeName) {
    const [
        { data: bulkList },
        { data: machines }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('machines')
    ]);
    
    const records = bulkList.filter(b => b.coffee_name === coffeeName);
    
    let rowsHtml = '';
    records.forEach(rec => {
        const m = machines.find(m => m.id === rec.machine_id);
        const machineName = m ? m.name : 'Unknown';
        
        rowsHtml += `
            <div class="form-group" style="display:flex; justify-content:space-between; align-items:center; gap: 10px;">
                <label class="form-label" style="flex:1; margin-bottom:0;">${machineName}</label>
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="number" class="form-control bulk-edit-input" data-id="${rec.id}" value="${parseFloat(rec.bulk_available).toFixed(2)}" step="0.01" min="0" style="width: 100px;">
                    <span style="font-size:0.85rem; color:var(--text-secondary);">kg</span>
                </div>
            </div>
        `;
    });
    
    const html = `
        <div id="modal-edit-bulk-form">
            <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 20px;">Edit stock for <strong>${coffeeName}</strong></p>
            ${rowsHtml}
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="button" id="btn-save-edit-bulk" class="btn btn-primary">Save Changes</button>
            </div>
        </div>
    `;
    
    openModal('Edit Bulk Stock', html);
    
    document.getElementById('btn-save-edit-bulk').onclick = async () => {
        const inputs = document.querySelectorAll('.bulk-edit-input');
        for (const inp of inputs) {
            const id = parseInt(inp.getAttribute('data-id'));
            const newVal = parseFloat(inp.value);
            
            const targetRec = bulkList.find(b => b.id === id);
            if (targetRec && parseFloat(targetRec.bulk_available) !== newVal) {
                targetRec.bulk_available = newVal;
                await saveData('bulk_roasted_coffee', targetRec);
            }
        }
        
        modalContainer.classList.add('hidden');
        loadBulkRoastedSection();
        scheduleDashboardRefresh();
    };
}

async function loadPackedCoffeeSection() {
    const [
        { data: packed },
        { data: batches },
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: sizes }
    ] = await Promise.all([
        fetchData('packed_coffee'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('packaging_sizes')
    ]);
    const activeSizes = (sizes || []).filter(s => s.is_visible).sort((a, b) => a.gram - b.gram);
    const tbody = document.getElementById('packed-coffee-stock-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // One-time cleanup for the user's specific requested row
    if (packed) {
        const filteredPacked = packed.filter(p => !(p.custom_coffee_name === 'Sidikalang Robusta (Single)' && parseInt(p.quantity) === 0));
        if (filteredPacked.length !== packed.length) {
            setMockTable('packed_coffee', filteredPacked);
            // update local variable
            packed.length = 0;
            packed.push(...filteredPacked);
        }
    }

    const resolved = (packed || []).map(item => {
        let coffeeName = item.custom_coffee_name || 'Roasted Coffee';
        if (item.roast_batch_id) {
            const b = batches.find(x => x.id === item.roast_batch_id);
            if (b) {
                if (b.coffee_type === 'Single') {
                    const gb = greenbeans.find(g => g.id === b.single_coffee_id);
                    if (gb) coffeeName = gb.name;
                } else {
                    const r = recipes.find(rec => rec.id === b.blend_recipe_id);
                    if (r) coffeeName = r.name;
                }
            }
        }
        
        // Normalize names to avoid duplicates like "Sidikalang Robusta (Single)" vs "Sidikalang Robusta"
        if (coffeeName.endsWith(' (Single)')) {
            coffeeName = coffeeName.replace(' (Single)', '');
        }
        if (coffeeName.endsWith(' (Blend)')) {
            coffeeName = coffeeName.replace(' (Blend)', '');
        }
        
        return { ...item, coffeeName };
    });

    // Group by coffee name and then machine
    const grouped = {};
    
    // First, ensure ALL green beans and blend recipes are present in the grouped object
    (greenbeans || []).forEach(gb => {
        if (!grouped[gb.name]) grouped[gb.name] = { coffeeName: gb.name, machines: {} };
    });
    (recipes || []).forEach(r => {
        if (!grouped[r.name]) grouped[r.name] = { coffeeName: r.name, machines: {} };
    });

    resolved.forEach(item => {
        let machineName = 'Unknown';
        if (item.machine_id) {
            const m = machines.find(mac => mac.id === item.machine_id);
            if (m) machineName = m.name;
        } else if (item.roast_batch_id) {
            const b = batches.find(x => x.id === item.roast_batch_id);
            if (b && b.machine_id) {
                const m = machines.find(mac => mac.id === b.machine_id);
                if (m) machineName = m.name;
            }
        }
        
        item.machineName = machineName;
        const groupKey = item.coffeeName;
        
        if (!grouped[groupKey]) grouped[groupKey] = { coffeeName: item.coffeeName, machines: {} };
        if (!grouped[groupKey].machines[machineName]) {
            grouped[groupKey].machines[machineName] = { machineName: machineName, sizes: {} };
        }
        
        const sizeKey = item.bag_size_g || 0;
        if (!grouped[groupKey].machines[machineName].sizes[sizeKey]) {
            grouped[groupKey].machines[machineName].sizes[sizeKey] = { sizeG: sizeKey, qty: 0 };
        }
        grouped[groupKey].machines[machineName].sizes[sizeKey].qty += parseInt(item.quantity) || 0;
    });
    
    // For any coffee that has NO machines (never packed), give it an 'Unknown' machine with 0 stock for active sizes
    Object.values(grouped).forEach(group => {
        if (Object.keys(group.machines).length === 0) {
            group.machines['Unknown'] = { machineName: 'Unknown', sizes: {} };
            activeSizes.forEach(sz => {
                group.machines['Unknown'].sizes[sz.gram] = { sizeG: sz.gram, qty: 0 };
            });
        }
    });

    // Determine the active machine columns to display
    let hasUnknown = false;
    Object.values(grouped).forEach(group => {
        if (group.machines['Unknown'] && Object.values(group.machines['Unknown'].sizes).some(s => s.qty > 0)) {
            hasUnknown = true;
        }
    });

    const activeMachinesList = machines.slice().sort((a,b) => a.name.localeCompare(b.name));
    if (hasUnknown) {
        activeMachinesList.push({ id: 'unknown', name: 'Unknown' });
    }

    // Update thead
    const theadRow = document.getElementById('packed-coffee-stock-table-head');
    if (theadRow) {
        let thHtml = `<th data-i18n="col_name">${window.t ? window.t('col_name') : 'Coffee Name'}</th>`;
        activeMachinesList.forEach(m => {
            thHtml += `<th style="text-align: center;">${m.name}</th>`;
        });
        thHtml += `<th data-i18n="col_action">${window.t ? window.t('col_action') : 'Action'}</th>`;
        theadRow.innerHTML = thHtml;
    }

    if (Object.keys(grouped).length === 0) {
        tbody.innerHTML = `<tr><td colspan="${activeMachinesList.length + 2}" style="text-align:center; color:var(--text-muted);">${window.t ? window.t("msg_no_packed_avail") : 'No packed coffee available.'}</td></tr>`;
        return;
    }

    Object.values(grouped).sort((a,b) => a.coffeeName.localeCompare(b.coffeeName)).forEach(group => {
        const tr = document.createElement('tr');
        
        let html = `<td style="vertical-align: middle; padding: 12px 20px;"><strong>${group.coffeeName}</strong></td>`;
        
        activeMachinesList.forEach(mach => {
            const machData = group.machines[mach.name] || { sizes: {} };
            
            const sizesHtml = activeSizes.map((sz, idx) => {
                const qty = machData.sizes[sz.gram] ? machData.sizes[sz.gram].qty : 0;
                const minSizes = companySettings.min_stock_packed_sizes || {};
                const minQty = minSizes[sz.gram] || 0;
                const isLow = qty < minQty;
                const colorStyle = isLow ? 'color:var(--danger);' : 'color:var(--text-secondary);';
                
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: ${idx < activeSizes.length - 1 ? '1px dashed var(--border)' : 'none'};">
                        <span style="background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:6px; padding:2px 6px; font-size:0.75rem; font-weight:700;">${sz.gram}g</span>
                        <span style="font-size:0.8rem; font-weight:600; ${colorStyle}">${qty} ${window.t ? window.t("lbl_bags") : 'bags'}</span>
                    </div>
                `;
            }).join('');
            
            html += `<td style="vertical-align: top; padding: 8px 12px; min-width: 140px;">${sizesHtml}</td>`;
        });
        
        html += `
            <td style="vertical-align: middle; padding: 12px 20px; white-space: nowrap;">
                <button class="btn btn-outline btn-sm btn-edit-packed" data-coffee="${encodeURIComponent(group.coffeeName)}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit
                </button>
                <button class="btn btn-danger btn-sm btn-delete-packed" data-coffee="${encodeURIComponent(group.coffeeName)}" style="margin-left: 4px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
            </td>
        `;
        
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-edit-packed').forEach(btn => {
        btn.addEventListener('click', () => openEditPackedModal(decodeURIComponent(btn.getAttribute('data-coffee'))));
    });

    document.querySelectorAll('.btn-delete-packed').forEach(btn => {
        btn.addEventListener('click', async () => {
            const coffeeName = decodeURIComponent(btn.getAttribute('data-coffee'));
            const confirmed = await showWarningModal(`Are you sure you want to delete all packed stock for "${coffeeName}"?\n\nThis action cannot be undone.`);
            if (!confirmed) return;
            const { data: allPacked } = await fetchData('packed_coffee');
            const toDelete = (allPacked || []).filter(p => (p.custom_coffee_name === coffeeName || p.custom_coffee_name === coffeeName.replace(/ \(Single\)$/, '').replace(/ \(Blend\)$/, '')));
            for (const item of toDelete) {
                await deleteData('packed_coffee', item.id);
            }
            await loadPackedCoffeeSection();
            scheduleDashboardRefresh();
        });
    });
}

async function openEditPackedModal(coffeeName) {
    const [
        { data: packed },
        { data: machines },
        { data: batches },
        { data: greenbeans },
        { data: recipes }
    ] = await Promise.all([
        fetchData('packed_coffee'),
        fetchData('machines'),
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes')
    ]);
    
    const resolved = packed.map(item => {
        let name = item.custom_coffee_name || 'Roasted Coffee';
        if (item.roast_batch_id) {
            const b = batches.find(x => x.id === item.roast_batch_id);
            if (b) {
                if (b.coffee_type === 'Single') {
                    const gb = greenbeans.find(g => g.id === b.single_coffee_id);
                    if (gb) name = gb.name;
                } else {
                    const r = recipes.find(rec => rec.id === b.blend_recipe_id);
                    if (r) name = r.name;
                }
            }
        }
        return { ...item, resolvedName: name };
    });
    
    const records = resolved.filter(r => r.resolvedName === coffeeName);
    
    let rowsHtml = '';
    
    if (records.length === 0) {
        rowsHtml = `<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">This coffee has never been packed.<br>Please use the <strong>Packing</strong> feature to add stock first.</div>`;
    } else {
        records.sort((a,b) => (a.machine_id || 0) - (b.machine_id || 0) || (a.bag_size_g || 0) - (b.bag_size_g || 0)).forEach(rec => {
        let machineName = 'Unknown';
        if (rec.machine_id) {
            const m = machines.find(mac => mac.id === rec.machine_id);
            if (m) machineName = m.name;
        } else if (rec.roast_batch_id) {
            const b = batches.find(x => x.id === rec.roast_batch_id);
            if (b && b.machine_id) {
                const m = machines.find(mac => mac.id === b.machine_id);
                if (m) machineName = m.name;
            }
        }
        
        rowsHtml += `
            <div class="form-group" style="display:flex; justify-content:space-between; align-items:center; gap: 10px; border-bottom: 1px dashed var(--border); padding-bottom: 10px; margin-bottom: 10px;">
                <label class="form-label" style="flex:1; margin-bottom:0;">
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">${machineName}</div>
                    <div style="font-weight: 600;">Size: ${rec.bag_size_g}g</div>
                </label>
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="number" class="form-control packed-edit-input" data-id="${rec.id}" value="${rec.quantity}" min="0" style="width: 100px;">
                    <span style="font-size:0.85rem; color:var(--text-secondary);">bags</span>
                </div>
            </div>
        `;
    });
    }
    
    const html = `
        <div id="modal-edit-packed-form">
            <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 20px;">Edit packed inventory for <strong>${coffeeName}</strong></p>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 10px;">
                ${rowsHtml}
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="button" id="btn-save-edit-packed" class="btn btn-primary">Save Changes</button>
            </div>
        </div>
    `;
    
    openModal('Edit Packed Stock', html);
    
    document.getElementById('btn-save-edit-packed').onclick = async () => {
        const inputs = document.querySelectorAll('.packed-edit-input');
        for (const inp of inputs) {
            const id = parseInt(inp.getAttribute('data-id'));
            const newVal = parseInt(inp.value);
            
            const targetRec = packed.find(p => p.id === id);
            if (targetRec && parseInt(targetRec.quantity) !== newVal) {
                targetRec.quantity = newVal;
                await saveData('packed_coffee', targetRec);
            }
        }
        
        modalContainer.classList.add('hidden');
        loadPackedCoffeeSection();
        scheduleDashboardRefresh();
    };
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
                    legend: { labels: { color: 'var(--text-primary)' } }
                },
                scales: {
                    x: { ticks: { color: 'var(--text-secondary)' } },
                    y: { ticks: { color: 'var(--text-secondary)' } }
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
                    legend: { labels: { color: 'var(--text-primary)' } }
                },
                scales: {
                    x: { ticks: { color: 'var(--text-secondary)' } },
                    y: { ticks: { color: 'var(--text-secondary)' } }
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
            thHtml += `<th style="text-align: center;">${m}</th>`;
        });
        thHtml += '<th style="text-align: center; font-weight:800;">Total</th>';
        theadRow.innerHTML = thHtml;
    }

    // Build table body
    const tbody = document.getElementById('rep-pack-table-body');
    if (tbody) tbody.innerHTML = '';

    const coffeeNames = Object.keys(grouped).sort();

    if (coffeeNames.length === 0 && tbody) {
        tbody.innerHTML = `<tr><td colspan="${activeMachines.length + 2}" style="text-align:center; color:var(--text-muted); padding:20px;">No packed data in selected period</td></tr>`;
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
                    legend: { labels: { color: 'var(--text-primary)' } }
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

    // Filter orders that are dispatched within date range
    const filteredOrders = (orders || []).filter(o => {
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
            thHtml += `<th style="text-align: center;">${m}</th>`;
        });
        theadRow.innerHTML = thHtml + '<th style="text-align: center; font-weight:800;">Total</th>';
    }

    // Build table body
    const tbody = document.getElementById('rep-sales-table-body');
    if (tbody) tbody.innerHTML = '';

    const coffeeNames = Object.keys(grouped).sort();

    if (coffeeNames.length === 0 && tbody) {
        tbody.innerHTML = `<tr><td colspan="${activeMachines.length + 2}" style="text-align:center; color:var(--text-muted); padding:20px;">No dispatched orders in selected period</td></tr>`;
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
                    legend: { labels: { color: 'var(--text-primary)' } }
                },
                scales: {
                    x: { ticks: { color: 'var(--text-secondary)' } },
                    y: { ticks: { color: 'var(--text-secondary)' } }
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

    // Only count orders that actually shipped — mirrors Sales Dispatch report's
    // definition of "volume" (Pending/Cancelled orders never left the warehouse).
    const filteredOrders = (orders || []).filter(o => (o.status === 'Dispatched' || o.status === 'Completed') && inDateRange(o));

    // All orders in range regardless of status — used for the status-breakdown table below.
    const allOrdersInRange = (orders || []).filter(inDateRange);

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
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">No dispatched orders in selected period</td></tr>`;
        } else {
            rows.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${r.name}</strong></td>
                    <td><code>${r.code}</code></td>
                    <td>${r.type}</td>
                    <td style="text-align:center;">${r.orders}</td>
                    <td style="text-align:center;">${r.bags}</td>
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
                    legend: { labels: { color: 'var(--text-primary)' } }
                },
                scales: {
                    x: { ticks: { color: 'var(--text-secondary)' } },
                    y: { ticks: { color: 'var(--text-secondary)' } }
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
                    legend: { position: 'bottom', labels: { color: 'var(--text-primary)' } }
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
            statusTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">No orders in selected period</td></tr>`;
        } else {
            statusRows.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${r.name}</strong></td>
                    <td style="text-align:center;">${r.counts['Pending Approval'] || 0}</td>
                    <td style="text-align:center;">${r.counts['Preparing'] || 0}</td>
                    <td style="text-align:center;">${r.counts['Dispatched'] || 0}</td>
                    <td style="text-align:center;">${r.counts['Completed'] || 0}</td>
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
            prefTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:20px;">No dispatched orders in selected period</td></tr>`;
        } else {
            prefRows.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${r.name}</strong></td>
                    <td>${r.topCoffee}</td>
                    <td style="text-align:center;">${r.bags}</td>
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
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">${window.t ? (window.t('stockopname_empty') || 'No stock takes recorded yet.') : 'No stock takes recorded yet.'}</td></tr>`;
        return;
    }
    filtered.forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${t.take_date || '-'}</strong></td>
            <td>${t.performed_by || '-'}</td>
            <td style="text-align:center;">${t.total_items || 0}</td>
            <td style="text-align:center; ${(t.variance_items || 0) > 0 ? 'color:var(--danger); font-weight:700;' : ''}">${t.variance_items || 0}</td>
            <td>${t.notes || '-'}</td>
            <td style="text-align:center;"><button class="btn btn-secondary btn-sm" onclick="viewStockTake(${t.id})">${window.t ? (window.t('btn_view') || 'View') : 'View'}</button></td>
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
                <td style="text-align:center;">${sysDisplay} ${g.unit}</td>
                <td style="text-align:center;"><input type="number" class="form-control stockopname-actual-input" data-group-index="${i}" value="${g.systemQty}" step="${step}" min="0" style="width:110px; text-align:center; margin:0 auto;"></td>
                <td style="text-align:center;" class="stockopname-variance-cell" data-group-index="${i}">0</td>
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

// --- INITIAL BOOTSTRAP ---
(async function bootstrap() {
    await syncCustomRolesFromSupabase();
    checkAuthentication();
    makeTabsDraggable();
    initTableFilters();
    initRoastingBatchPagination();
    initHandoverPagination();
    navigateTo('sec-dashboard'); // start on dashboard
})();

// ==========================================================================
// TRANSLATION MANAGER ACTIONS & CSV SUPPORT
// ==========================================================================

async function loadTranslationManager() {
    const tableBody = document.getElementById('translation-manager-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    const enDict = window.translations.en || {};
    const arDict = window.translations.ar || {};
    
    // Get all sorted keys
    const keys = Object.keys(enDict).sort();

    keys.forEach(key => {
        const enVal = enDict[key] || '';
        const arVal = arDict[key] || '';

        const tr = document.createElement('tr');
        tr.className = 'translation-row';
        tr.setAttribute('data-key', key);

        tr.innerHTML = `
            <td style="font-family: monospace; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); word-break: break-all; vertical-align: top; padding: 12px 8px;">
                ${key}
            </td>
            <td style="padding: 8px;">
                <textarea class="form-control translation-en-input" style="font-size: 0.82rem; padding: 8px; width: 100%; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); resize: vertical; min-height: 36px; line-height: 1.4;" rows="1">${enVal}</textarea>
            </td>
            <td style="padding: 8px;">
                <textarea class="form-control translation-ar-input" style="font-size: 0.82rem; padding: 8px; width: 100%; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); direction: rtl; resize: vertical; min-height: 36px; line-height: 1.4;" rows="1">${arVal}</textarea>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

function filterTranslationTable() {
    const query = document.getElementById('translation-search-input').value.toLowerCase().trim();
    const rows = document.querySelectorAll('#translation-manager-table-body .translation-row');

    rows.forEach(row => {
        const key = row.getAttribute('data-key').toLowerCase();
        const enVal = row.querySelector('.translation-en-input').value.toLowerCase();
        const arVal = row.querySelector('.translation-ar-input').value.toLowerCase();

        if (key.includes(query) || enVal.includes(query) || arVal.includes(query)) {
            row.classList.remove('hidden');
        } else {
            row.classList.add('hidden');
        }
    });
}

function saveTranslationsChanges() {
    const rows = document.querySelectorAll('#translation-manager-table-body .translation-row');
    const overrides = { en: {}, ar: {} };

    rows.forEach(row => {
        const key = row.getAttribute('data-key');
        const enVal = row.querySelector('.translation-en-input').value;
        const arVal = row.querySelector('.translation-ar-input').value;

        overrides.en[key] = enVal;
        overrides.ar[key] = arVal;
    });

    // Save to localStorage overrides
    localStorage.setItem('app_translations_override', JSON.stringify(overrides));

    // Update active dictionary
    if (!window.translations) {
        window.translations = { en: {}, ar: {} };
    }
    for (const lang in overrides) {
        if (!window.translations[lang]) window.translations[lang] = {};
        for (const key in overrides[lang]) {
            window.translations[lang][key] = overrides[lang][key];
        }
    }

    // Apply translations globally
    if (window.translatePage) {
        window.translatePage();
    }

    // Refresh translation table display
    loadTranslationManager();

    alert(window.t ? window.t('msg_translations_saved') : 'Translations updated successfully!');
}

function exportTranslationsCSV() {
    const enDict = window.translations.en || {};
    const arDict = window.translations.ar || {};
    const keys = Object.keys(enDict).sort();

    const csvRows = [
        ['Key', 'English', 'Arabic']
    ];

    keys.forEach(key => {
        const enVal = enDict[key] || '';
        const arVal = arDict[key] || '';
        csvRows.push([key, enVal, arVal]);
    });

    // Generate CSV string: quote wrap and escape double-quotes
    const csvContent = csvRows.map(row => 
        row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
    ).join('\r\n');

    // Prepend UTF-8 BOM to make Excel render Arabic correctly as Unicode
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'roastery_translations.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function importTranslationsCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const parsedData = parseCSVString(text);

        if (parsedData.length < 2) {
            alert('Format file CSV tidak valid atau kosong.');
            return;
        }

        // Validate headers (row 0)
        const headers = parsedData[0];
        if (headers[0] !== 'Key' || headers[1] !== 'English' || headers[2] !== 'Arabic') {
            alert('Format file CSV salah. Kolom harus berupa: Key, English, Arabic');
            return;
        }

        // Apply loaded rows to the input elements in the table
        let importCount = 0;
        for (let i = 1; i < parsedData.length; i++) {
            const row = parsedData[i];
            if (row.length < 3) continue;

            const key = row[0];
            const enVal = row[1];
            const arVal = row[2];

            const tr = document.querySelector(`#translation-manager-table-body .translation-row[data-key="${key}"]`);
            if (tr) {
                const enInput = tr.querySelector('.translation-en-input');
                const arInput = tr.querySelector('.translation-ar-input');
                if (enInput) enInput.value = enVal;
                if (arInput) arInput.value = arVal;
                importCount++;
            }
        }

        alert(window.t ? window.t('msg_translations_imported') : `Imported ${importCount} keys successfully! Review changes and click Save.`);
        
        // Reset file input value
        event.target.value = '';
    };
    reader.readAsText(file, 'UTF-8');
}

// Robust CSV parser state-machine handling quotes and newlines
function parseCSVString(text) {
    const result = [];
    let row = [];
    let col = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                col += '"';
                i++; // Skip the next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            row.push(col);
            col = '';
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') {
                i++;
            }
            row.push(col);
            result.push(row);
            row = [];
            col = '';
        } else {
            col += char;
        }
    }
    if (col || row.length > 0) {
        row.push(col);
        result.push(row);
    }
    return result;
}

function resetTranslations() {
    const confirmMsg = window.currentLanguage === 'ar' 
        ? 'هل أنت متأكد أنك تريد إعادة تعيين كافة الترجمات إلى الافتراضيات؟' 
        : 'Are you sure you want to reset all translations to defaults?';

    if (!confirm(confirmMsg)) return;

    localStorage.removeItem('app_translations_override');
    
    // Reload page to apply default translations
    window.location.reload();
}

async function openCustomPackingModal() {
    const [
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: sizes }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('packaging_sizes')
    ]);
    const activeSizes = (sizes || []).filter(s => s.is_visible).sort((a, b) => a.gram - b.gram);

    // List of coffee name suggestions
    const coffeeNames = new Set();
    if (greenbeans) greenbeans.forEach(gb => coffeeNames.add(gb.name));
    if (recipes) recipes.forEach(r => coffeeNames.add(r.name));
    
    const datalistOptions = Array.from(coffeeNames).map(name => `<option value="${name}"></option>`).join('');
    const machineOptions = machines.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    const sizesHtml = activeSizes.map(sz => `
        <div class="form-group" style="flex: 1; margin-bottom: 0;">
            <label class="form-label">${sz.gram}g</label>
            <input type="number" min="0" class="form-control custom-pack-size-input" data-gram="${sz.gram}" value="0" placeholder="0">
        </div>
    `).join('');

    const html = `
        <form id="modal-custom-packing-form" novalidate>
            <div class="form-group">
                <label class="form-label">Coffee Name</label>
                <input type="text" id="m-custpack-coffee" class="form-control" placeholder="Select or type coffee name..." list="custpack-coffee-list" required>
                <datalist id="custpack-coffee-list">
                    ${datalistOptions}
                </datalist>
            </div>
            
            <div class="form-row" style="margin-top: 15px;">
                <div class="form-group">
                    <label class="form-label">Roaster Machine</label>
                    <select id="m-custpack-machine" class="form-control" required>
                        <option value="" disabled selected>-- Select Machine --</option>
                        ${machineOptions}
                    </select>
                </div>
            </div>

            <div style="margin-top: 20px;">
                <label class="form-label">Quantity per Package size</label>
                <div style="display: flex; gap: 12px; align-items: flex-end;">
                    ${sizesHtml}
                </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 25px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Packing</button>
            </div>
        </form>
    `;

    openModal('Custom Packing', html, '600px');
    
    document.getElementById('modal-custom-packing-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const coffeeName = document.getElementById('m-custpack-coffee').value.trim();
        const machineId = parseInt(document.getElementById('m-custpack-machine').value);
        
        if (!coffeeName || isNaN(machineId)) {
            alert("Please complete the coffee name and select a machine.");
            return;
        }

        const sizeInputs = document.querySelectorAll('.custom-pack-size-input');
        const packsToSave = [];
        
        sizeInputs.forEach(inp => {
            const qty = parseInt(inp.value) || 0;
            const gram = parseInt(inp.getAttribute('data-gram'));
            if (qty > 0) {
                packsToSave.push({ gram, qty });
            }
        });

        if (packsToSave.length === 0) {
            alert("Please input quantity for at least one package size.");
            return;
        }

        const { data: packed } = await fetchData('packed_coffee');

        for (const item of packsToSave) {
            // Find existing row matching the exact custom coffee name, machine, and size
            const existing = (packed || []).find(p => 
                p.roast_batch_id === null && 
                p.machine_id === machineId && 
                p.bag_size_g === item.gram && 
                (p.custom_coffee_name || '').toLowerCase() === coffeeName.toLowerCase()
            );

            if (existing) {
                existing.quantity = (parseInt(existing.quantity) || 0) + item.qty;
                await saveData('packed_coffee', existing);
            } else {
                const newPacked = {
                    roast_batch_id: null,
                    machine_id: machineId,
                    custom_coffee_name: coffeeName,
                    bag_size_g: item.gram,
                    quantity: item.qty
                };
                await saveData('packed_coffee', newPacked);
            }
        }

        modalContainer.classList.add('hidden');
        loadPackedCoffeeSection();
        scheduleDashboardRefresh();
        await showWarningModal("Custom packing stock added successfully.", false);
    });
}

async function loadPackingHistorySection() {
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
    const tbody = document.getElementById('packing-history-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!orders || orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No completed orders found.</td></tr>`;
        return;
    }

    // Only show orders where all items are Ready for Handover, or status is Dispatched
    const historyOrders = [...orders]
        .filter(o => {
            if (o.status === 'Dispatched') return true;
            // Include orders where ALL items are Ready for Handover
            const items = (orderItems || []).filter(i => i.request_order_id === o.id);
            if (items.length > 0 && items.every(i => i.item_status === 'Ready for Handover')) return true;
            return false;
        })
        .sort((a, b) => new Date(b.order_date) - new Date(a.order_date) || b.id - a.id);

    if (historyOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No completed orders found.</td></tr>`;
        return;
    }

    let tbodyHtml = '';
    for (const order of historyOrders) {
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);
        
        // Build items detail
        let itemsDetailHtml = '';
        if (items.length > 0) {
            itemsDetailHtml = `<div style="display: flex; flex-direction: column; gap: 4px;">`;
            for (const item of items) {
                const type = item.coffee_type;
                const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
                let coffeeName = '';
                if (type === 'Single') {
                    const gb = (greenbeans || []).find(g => g.id === coffeeId);
                    coffeeName = gb ? gb.name : 'Single Origin';
                } else {
                    const r = (recipes || []).find(rec => rec.id === coffeeId);
                    coffeeName = r ? r.name : 'Blend';
                }
                const sizeG = item.bag_size_g || '?';
                const requested = parseInt(item.quantity_requested) || 0;
                const histMach = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
                const histMachTag = histMach ? `<span style="font-size:0.68rem; color:#0891b2; font-weight:600; background:rgba(6,182,212,0.1); padding:0px 5px; border-radius:3px; margin-left:4px;">${histMach.name}</span>` : '';
                
                itemsDetailHtml += `
                    <div style="display:flex; align-items:center; gap:8px; font-size:0.82rem;">
                        <span style="font-weight:600; color:var(--text-primary);">${coffeeName}</span>${histMachTag}
                        <span style="display:inline-flex; align-items:center; gap:4px; background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:6px; padding:1px 8px; font-size:0.78rem; font-weight:600; color:var(--text-secondary);">
                            ${sizeG}g: <strong style="color:var(--primary);">${requested} bags</strong>
                        </span>
                    </div>`;
            }
            itemsDetailHtml += `</div>`;
        } else {
            itemsDetailHtml = '<span style="color:var(--text-muted);">-</span>';
        }
        
        // Ready date
        const readyDate = order.ready_date || order.order_date;
        
        // Dispatched column
        const isDispatched = order.status === 'Dispatched';
        const dispatchedCell = isDispatched 
            ? `<span style="font-weight:600; font-size:0.85rem;">${order.dispatched_date || order.order_date}</span>`
            : `<span style="font-size:0.72rem; color:var(--warning); font-weight:600; display:inline-flex; align-items:center; gap:3px;"><span style="display:inline-block; width:5px; height:5px; background:var(--warning); border-radius:50%;"></span>Waiting for Dispatch</span>`;
        
        // Status badge
        const statusBadge = isDispatched
            ? `<span style="font-size:0.75rem; padding:2px 10px; border-radius:9999px; font-weight:700; background:rgba(6,182,212,0.15); color:#0891b2; display:inline-block;">Dispatched</span>`
            : `<span style="font-size:0.75rem; padding:2px 10px; border-radius:9999px; font-weight:700; background:rgba(16,185,129,0.15); color:var(--success); display:inline-block;">Ready</span>`;
        
        tbodyHtml += `
        <tr>
            <td><strong>${order.order_date}</strong></td>
            <td><code style="font-size:0.8rem;">${order.order_number || '#ORD-'+order.id}</code></td>
            <td><strong>${order.sales_name || '-'}</strong></td>
            <td>${itemsDetailHtml}</td>
            <td><span style="font-size:0.8rem;">${readyDate}</span></td>
            <td>${dispatchedCell}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn btn-secondary btn-sm btn-print-waybill" data-id="${order.id}" style="display:inline-flex; align-items:center; gap:4px; white-space:nowrap;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    Print Waybill
                </button>
            </td>
        </tr>`;
    }
    tbody.innerHTML = tbodyHtml;

    // Attach print waybill handlers
    document.querySelectorAll('.btn-print-waybill').forEach(btn => {
        btn.addEventListener('click', () => printWaybill(parseInt(btn.getAttribute('data-id'))));
    });

    applyFiltersForTable(document.querySelector('#tab-packing-history table'));
}

// ============================================================
// PRINT WAYBILL - A4 Format
// ============================================================
async function printWaybill(orderId) {
    const [
        { data: orders },
        { data: orderItems },
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: customers }
    ] = await Promise.all([
        fetchData('request_orders'),
        fetchData('request_order_items'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('customers')
    ]);

    const order = (orders || []).find(o => o.id === orderId);
    if (!order) return;
    const items = (orderItems || []).filter(i => i.request_order_id === orderId);
    const customer = order.customer_id ? (customers || []).find(c => c.id === order.customer_id) : null;
    
    let itemsTableRows = '';
    let totalBags = 0;
    let totalWeightKg = 0;
    
    for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const type = item.coffee_type;
        const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
        let coffeeName = '';
        if (type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === coffeeId);
            coffeeName = gb ? gb.name : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === coffeeId);
            coffeeName = r ? r.name : 'Blend';
        }
        const mach = item.machine_id ? (machines || []).find(m => m.id === item.machine_id) : null;
        const machCode = mach ? (mach.code || mach.name) : '-';
        const qty = parseInt(item.quantity_requested) || 0;
        const sizeG = parseInt(item.bag_size_g) || 0;
        const weightKg = (qty * sizeG) / 1000;
        totalBags += qty;
        totalWeightKg += weightKg;

        const sizeLabel = sizeG >= 1000 ? `${sizeG/1000}kg` : `${sizeG}g`;
        itemsTableRows += `
            <tr>
                <td style="text-align:center;">${idx + 1}</td>
                <td style="font-weight:600;">${coffeeName}</td>
                <td>${machCode}</td>
                <td>${sizeLabel}</td>
                <td style="text-align:center;">${qty}</td>
                <td style="text-align:center;">${weightKg.toFixed(1)} kg</td>
            </tr>`;
    }
    
    // Use the live companySettings (loaded from Supabase by loadCompanySettings()) —
    // do NOT read the 'mock_company_settings' localStorage cache here, it is seeded
    // once on first-ever page load and never refreshed by real saves.
    const cs = companySettings;

    const printContent = `<!DOCTYPE html>
<html>
<head>
    <title>Waybill - ${order.order_number || '#ORD-'+order.id}</title>
    <style>
        @page { size: A4; margin: 16mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 13px; background: #fff; }
        .waybill { max-width: 210mm; margin: 0 auto; padding: 8px; }

        /* Letterhead */
        .letterhead { display: flex; justify-content: space-between; align-items: center; padding-bottom: 16px; border-bottom: 3px solid #2d5016; margin-bottom: 24px; }
        .letterhead-left { display: flex; align-items: center; gap: 14px; }
        .letterhead-logo { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; border: 1px solid #e5e5e5; }
        .letterhead-name { font-size: 21px; font-weight: 800; color: #2d5016; line-height: 1.2; }
        .letterhead-contact { font-size: 10px; color: #777; line-height: 1.6; margin-top: 3px; }
        .letterhead-right { text-align: right; }
        .letterhead-right .doc-title { font-size: 19px; font-weight: 800; color: #2d5016; letter-spacing: 0.5px; text-transform: uppercase; }
        .letterhead-right .doc-subtitle { font-size: 11px; color: #999; margin-top: 3px; font-weight: 600; }

        /* Info cards */
        .info-section { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
        .info-card { background: #f7f9f5; border: 1px solid #e2e8dc; border-radius: 8px; padding: 14px 16px; }
        .info-card .card-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #2d5016; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #dde5d3; }
        .info-card .info-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 3px 0; }
        .info-card .info-label { color: #888; font-weight: 600; }
        .info-card .info-value { color: #1a1a1a; font-weight: 700; text-align: right; }
        .info-card .customer-name { font-size: 15px; font-weight: 800; color: #1a1a1a; margin-bottom: 2px; }
        .info-card .customer-code { display: inline-block; font-size: 10px; font-weight: 700; color: #2d5016; background: #e2e8dc; padding: 2px 8px; border-radius: 10px; margin-bottom: 8px; }

        /* Table */
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; border-radius: 8px; overflow: hidden; }
        thead th { background: #2d5016; color: #fff; padding: 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; }
        thead th:first-child { text-align: center; }
        tbody tr:nth-child(even) { background: #f7f9f5; }
        tbody td { padding: 9px 10px; border-bottom: 1px solid #e5e5e5; font-size: 12px; }
        tfoot td { background: #eef3e8; font-weight: 700; padding: 10px; border-top: 2px solid #2d5016; font-size: 12px; }

        /* Notes */
        .notes { border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px 14px; margin-bottom: 24px; background: #fafafa; }
        .notes .label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #888; margin-bottom: 4px; }

        /* Signature */
        .signature-area { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; margin-top: 40px; }
        .sig-box { text-align: center; }
        .sig-box .sig-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #666; margin-bottom: 60px; }
        .sig-box .sig-line { border-top: 1px solid #333; padding-top: 6px; font-size: 11px; color: #999; }

        /* Footer */
        .print-footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e5e5e5; text-align: center; font-size: 10px; color: #999; }

        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
    </style>
</head>
<body>
    <div class="waybill">
        <div class="letterhead">
            <div class="letterhead-left">
                ${cs.show_logo_in_print && cs.logo_base64 ? '<img class="letterhead-logo" src="' + cs.logo_base64 + '" alt="Logo">' : ''}
                <div>
                    <div class="letterhead-name">${cs.company_name || 'Coffee Roastery'}</div>
                    <div class="letterhead-contact">
                        ${cs.address ? cs.address + '<br>' : ''}${cs.phone ? cs.phone : ''}${cs.email ? ' · ' + cs.email : ''}
                    </div>
                </div>
            </div>
            <div class="letterhead-right">
                <div class="doc-title">Delivery Waybill</div>
                <div class="doc-subtitle">${order.order_number || '#ORD-'+order.id}</div>
            </div>
        </div>

        <div class="info-section">
            <div class="info-card">
                <div class="card-title">Bill To</div>
                ${customer ? `
                    <div class="customer-name">${customer.name}</div>
                    <div class="customer-code">${customer.customer_id}</div>
                    ${customer.city ? `<div class="info-row"><span class="info-label">City</span><span class="info-value">${customer.city}</span></div>` : ''}
                    ${customer.phone ? `<div class="info-row"><span class="info-label">Phone</span><span class="info-value">${customer.phone}</span></div>` : ''}
                ` : `
                    <div class="customer-name">-</div>
                `}
                <div class="info-row">
                    <span class="info-label">Sales Agent</span>
                    <span class="info-value">${order.sales_name || '-'}</span>
                </div>
            </div>
            <div class="info-card">
                <div class="card-title">Order Details</div>
                <div class="info-row">
                    <span class="info-label">Order Number</span>
                    <span class="info-value">${order.order_number || '#ORD-'+order.id}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Order Date</span>
                    <span class="info-value">${order.order_date}</span>
                </div>
            </div>
        </div>

        <table>
            <thead>
                <tr>
                    <th style="width:30px;">#</th>
                    <th>Coffee Name</th>
                    <th style="width:100px;">Type</th>
                    <th style="width:60px;">Size</th>
                    <th style="width:50px; text-align:center;">Qty</th>
                    <th style="width:80px; text-align:center;">Weight</th>
                </tr>
            </thead>
            <tbody>${itemsTableRows}</tbody>
            <tfoot>
                <tr>
                    <td colspan="4" style="text-align:right;">Total</td>
                    <td style="text-align:center;">${totalBags}</td>
                    <td style="text-align:center;">${totalWeightKg.toFixed(1)} kg</td>
                </tr>
            </tfoot>
        </table>
        ${order.notes ? '<div class="notes"><div class="label">Notes</div><div>' + order.notes + '</div></div>' : ''}
        <div class="signature-area">
            <div class="sig-box"><div class="sig-label">Prepared By</div><div class="sig-line">Name / Date</div></div>
            <div class="sig-box"><div class="sig-label">Checked By</div><div class="sig-line">Name / Date</div></div>
            <div class="sig-box"><div class="sig-label">Received By</div><div class="sig-line">Name / Date</div></div>
        </div>
        ${cs.print_footer_text ? '<div class="print-footer">' + cs.print_footer_text + '</div>' : ''}
    </div>
    <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
}

// ==========================================================================
// SETTINGS ACCORDION TOGGLE
// ==========================================================================
function toggleSettingsCard(headerEl) {
    const body = headerEl.nextElementSibling;
    const chevron = headerEl.querySelector('.accordion-chevron');
    if (body.style.maxHeight && body.style.maxHeight !== '0px') {
        body.style.maxHeight = '0';
        chevron.style.transform = 'rotate(0deg)';
    } else {
        body.style.maxHeight = body.scrollHeight + 'px';
        chevron.style.transform = 'rotate(180deg)';
    }
}

// ==========================================================================
// GLOBAL BARCODE SCANNER LISTENER
// ==========================================================================
(function() {
    let barcodeBuffer = '';
    let lastKeyTime = 0;
    const BARCODE_THRESHOLD = 50; // ms between keystrokes for barcode vs manual
    const BARCODE_MIN_LENGTH = 8; // minimum barcode length
    
    document.addEventListener('keydown', (e) => {
        // Don't intercept if user is typing in an input/textarea
        const tag = (e.target.tagName || '').toLowerCase();
        const isInputField = tag === 'input' || tag === 'textarea' || tag === 'select';
        
        const now = Date.now();
        
        if (e.key === 'Enter') {
            if (barcodeBuffer.length >= BARCODE_MIN_LENGTH && barcodeBuffer.startsWith('RMP:')) {
                e.preventDefault();
                e.stopPropagation();
                handleBarcodeScan(barcodeBuffer);
            }
            barcodeBuffer = '';
            return;
        }
        
        if (e.key && e.key.length === 1) { // printable character
            if (now - lastKeyTime > 200) {
                barcodeBuffer = ''; // reset if too slow (manual typing)
            }
            barcodeBuffer += e.key;
            lastKeyTime = now;
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

function printSingleBarcode(barcodeValue, coffeeName, machineName) {
    const printWin = window.open('', '_blank', 'width=400,height=300');
    printWin.document.write(`
        <html><head><title>Barcode Label</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <style>
            body { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; margin:0; font-family: Arial, sans-serif; }
            .label { text-align:center; padding: 10px; }
            .name { font-weight:700; font-size: 14px; margin-top: 5px; }
            .machine { font-size: 12px; color: #666; }
            @media print { body { margin: 0; } }
        </style></head><body>
        <div class="label">
            <svg id="bc"></svg>
            <div class="name">${coffeeName}</div>
            <div class="machine">🏭 ${machineName}</div>
        </div>
        <script>
            JsBarcode('#bc', '${barcodeValue}', { format: 'CODE128', width: 2, height: 60, displayValue: true, fontSize: 12, margin: 5 });
            setTimeout(() => { window.print(); }, 500);
        <\/script>
        </body></html>
    `);
    printWin.document.close();
}

async function printAllBarcodes() {
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
    
    const printWin = window.open('', '_blank', 'width=800,height=600');
    printWin.document.write(`
        <html><head><title>All Barcode Labels</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <style>
            @page { size: A4; margin: 10mm; }
            body { margin: 0; padding: 10mm; font-family: Arial, sans-serif; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
            .label-item { text-align: center; border: 1px dashed #ccc; padding: 8px; page-break-inside: avoid; }
            .name { font-weight: 700; font-size: 11px; margin-top: 3px; }
            .machine { font-size: 10px; color: #666; }
            svg { max-width: 100%; }
        </style></head><body>
        <div class="grid">${allLabels}</div>
        <script>
            document.querySelectorAll('.bc').forEach(el => {
                JsBarcode(el, el.dataset.value, { format: 'CODE128', width: 1.2, height: 40, displayValue: true, fontSize: 9, margin: 3 });
            });
            setTimeout(() => { window.print(); }, 800);
        <\/script>
        </body></html>
    `);
    printWin.document.close();
}

