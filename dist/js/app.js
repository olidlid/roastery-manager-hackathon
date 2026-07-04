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

// --- STATE MANAGEMENT ---
let isMockMode = localStorage.getItem('is_mock_mode') === 'true' || !window.isConnected();
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
    weight_unit: 'kg'
};

// Seed initial offline mock databases (used if not connected to Supabase)
const MOCK_DB = {
    green_coffee: [
        { id: 1, code: 'GB1', name: 'Aceh Gayo Arabica', origin: 'Aceh, Indonesia', process: 'Wet Hulled', stock_kg: 250.0, purchase_date: '2026-05-15', purchase_price_per_kg: 8.50, supplier: 'Gayo Estate' },
        { id: 2, code: 'GB2', name: 'Sidikalang Robusta', origin: 'Dairi, Indonesia', process: 'Full Wash', stock_kg: 180.0, purchase_date: '2026-05-20', purchase_price_per_kg: 5.00, supplier: 'Sidikalang Coop' },
        { id: 3, code: 'GB3', name: 'Toraja Arabica', origin: 'Sulawesi, Indonesia', process: 'Natural', stock_kg: 10.0, purchase_date: '2026-06-01', purchase_price_per_kg: 10.00, supplier: 'Toraja Highlands' }
    ],
    green_coffee_intake: [
        { id: 1, date: '2026-06-25', code: 'GB1', name: 'Aceh Gayo Arabica', origin: 'Aceh, Indonesia', process: 'Wet Hulled', quantity: 250.0, supplier: 'Gayo Estate' },
        { id: 2, date: '2026-06-26', code: 'GB2', name: 'Sidikalang Robusta', origin: 'Dairi, Indonesia', process: 'Full Wash', quantity: 180.0, supplier: 'Sidikalang Coop' },
        { id: 3, date: '2026-06-27', code: 'GB3', name: 'Toraja Arabica', origin: 'Sulawesi, Indonesia', process: 'Natural', quantity: 10.0, supplier: 'Toraja Highlands' }
    ],
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
    roasting_plans: [
        { id: 1, day: 'Monday', plan_date: '2026-06-29', coffee_type: 'Single', single_coffee_id: 1, blend_recipe_id: null, target_roasted_kg: 15.0, fulfilled_roasted_kg: 12.75, status: 'Completed' },
        { id: 2, day: 'Monday', plan_date: '2026-06-29', coffee_type: 'Blend', single_coffee_id: null, blend_recipe_id: 1, target_roasted_kg: 25.0, fulfilled_roasted_kg: 0.0, status: 'Pending' }
    ],
    roast_batches: [
        { id: 1, batch_code: 'B-260628-01', roast_date: '2026-06-28', roast_type: 'Regular', qc_status: 'Success', coffee_type: 'Single', single_coffee_id: 1, blend_recipe_id: null, machine_id: 1, roasting_plan_id: 1, input_weight_kg: 15.0, output_weight_kg: 12.75, yield_percentage: 85.0, remaining_bulk_kg: 4.75, roaster_operator: 'Developer', notes: 'Perfect color development.' }
    ],
    bulk_roasted_coffee: [
        { id: 1, coffee_type: 'Single', single_coffee_id: 1, blend_recipe_id: null, coffee_name: 'Ethiopia Yirgacheffe (Single)', bulk_available: 12.75 }
    ],
    waste_inventory: [],
    packed_coffee: [
        { id: 1, roast_batch_id: 1, custom_coffee_name: null, bag_size_g: 250, quantity: 16, selling_price: 12.00 },
        { id: 2, roast_batch_id: 1, custom_coffee_name: null, bag_size_g: 1000, quantity: 4, selling_price: 42.00 }
    ],
    request_orders: [
        { id: 1, order_number: 'JS260628001', order_date: '2026-06-28', sales_name: 'John Sales', status: 'Pending Approval', notes: 'Urgent delivery for Downtown Cafe' }
    ],
    request_order_items: [
        { id: 1, request_order_id: 1, coffee_type: 'Single', single_coffee_id: 1, blend_recipe_id: null, bag_size_g: 250, quantity_requested: 10, quantity_allocated: 0, quantity_pending: 10 }
    ],
    handover_logs: [],
    profiles: [
        { id: 'dev-id', username: 'developer', role: 'Developer', name: 'Lead Developer' },
        { id: 'roaster-id', username: 'roaster', role: 'Roaster', name: 'Gavin Roaster' }
    ],
    sales_agents: [
        { id: 1, name: 'John Sales', code: 'JS' }
    ]
};

// Initialize localStorage databases if empty
function initMockDatabases() {
    for (const key in MOCK_DB) {
        if (!localStorage.getItem(`mock_${key}`)) {
            localStorage.setItem(`mock_${key}`, JSON.stringify(MOCK_DB[key]));
        }
    }
    if (!localStorage.getItem('mock_company_settings')) {
        localStorage.setItem('mock_company_settings', JSON.stringify(companySettings));
    }
}
initMockDatabases();

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

// Fetch helper that handles both Live and Mock databases
async function fetchData(table) {
    if (isMockMode) {
        return { data: getCachedTable(table), error: null };
    } else {
        try {
            const { data, error } = await window.supabaseClient.from(table).select('*');
            if (error) throw error;
            return { data, error: null };
        } catch (e) {
            console.error(`Supabase fetch failed for ${table}, switching to mock:`, e);
            return { data: getCachedTable(table), error: e };
        }
    }
}

async function saveData(table, record) {
    if (isMockMode) {
        const tableData = getMockTable(table);
        if (record.id) {
            // Update
            const idx = tableData.findIndex(item => item.id === record.id);
            if (idx !== -1) tableData[idx] = { ...tableData[idx], ...record };
        } else {
            // Insert
            record.id = tableData.length > 0 ? Math.max(...tableData.map(d => d.id)) + 1 : 1;
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

async function deleteData(table, id) {
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

// --- OVERLAYS & AUTHENTICATION WIRING ---
const configOverlay = document.getElementById('config-overlay');
const authOverlay = document.getElementById('auth-overlay');
const onboardingOverlay = document.getElementById('onboarding-overlay');

function checkDatabaseConnection() {
    if (!window.isConnected() && !isMockMode) {
        configOverlay.classList.remove('hidden');
        authOverlay.classList.add('hidden');
        return false;
    }
    configOverlay.classList.add('hidden');
    return true;
}

function checkAuthentication() {
    if (!checkDatabaseConnection()) return;
    
    if (isMockMode) {
        currentUser = { id: 'dev-id', name: 'Lead Developer', role: localStorage.getItem('mock_active_role') || 'Developer' };
        document.getElementById('user-name-lbl').textContent = currentUser.name;
        document.getElementById('user-role-lbl').textContent = currentUser.role;
        document.getElementById('user-avatar-lbl').textContent = currentUser.name.charAt(0);
        document.getElementById('role-play-switcher').value = currentUser.role;
        authOverlay.classList.add('hidden');
        document.getElementById('app-container').style.display = 'flex';
        loadCompanySettings();
        scheduleDashboardRefresh();
    } else {
        window.supabaseClient.auth.getSession().then(({ data: { session } }) => {
            if (!session) {
                authOverlay.classList.remove('hidden');
                document.getElementById('app-container').style.display = 'none';
            } else {
                authOverlay.classList.add('hidden');
                document.getElementById('app-container').style.display = 'flex';
                loadUserProfile(session.user.id);
            }
        });
    }
}

async function loadUserProfile(userId) {
    try {
        let { data, error } = await window.supabaseClient.from('profiles').select('*').eq('id', userId).single();
        if (error) throw error;
        currentUser = data;
        document.getElementById('user-name-lbl').textContent = currentUser.name;
        document.getElementById('user-role-lbl').textContent = currentUser.role;
        document.getElementById('user-avatar-lbl').textContent = currentUser.name.charAt(0);
        document.getElementById('role-play-switcher').value = currentUser.role;
        loadCompanySettings();
    } catch (e) {
        console.error("UserProfile load failed, falling back:", e);
        currentUser = { id: userId, username: 'user', role: 'Leader', name: 'Production Leader' };
        loadCompanySettings();
    }
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
    // Update labels and values in Forms
    document.getElementById('sett-company-name').value = companySettings.company_name;
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
    'sec-users': { title: 'User Account Management', subtitle: 'Manage operator details, roles, and warehouse access access rights' },
    'sec-settings': { title: 'System Settings', subtitle: 'Configure branding, printing layouts, and connection endpoints' }
};

function navigateTo(sectionId) {
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
    } else {
        const keyPart = sectionId.replace('sec-', '');
        activePageTitle.setAttribute('data-i18n', `header_title_${keyPart}`);
        activePageSubtitle.setAttribute('data-i18n', `header_subtitle_${keyPart}`);
        activePageTitle.textContent = window.t(`header_title_${keyPart}`);
        activePageSubtitle.textContent = window.t(`header_subtitle_${keyPart}`);
    }

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
}

async function loadRoastingTabSpecificData(tabId) {
    switch (tabId) {
        case 'tab-roast-plans':
            await loadRoastingPlans();
            break;
        case 'tab-roast-logs':
            await loadRoastingBatches();
            break;
        case 'tab-blend-recipes':
            await loadBlendRecipes();
            break;
        case 'tab-recipe-potential':
            await loadRecipeProductionPotential();
            break;
    }
}


async function loadSettingTabSpecificData(tabId) {
    switch (tabId) {
        case 'tab-sett-company':
            await loadCompanySettings();
            break;
        case 'tab-sett-print':
            await loadCompanySettings();
            break;
        case 'tab-sett-users':
            await loadUsersSection();
            break;
        case 'tab-sett-machines':
            await loadMachinesSection();
            break;
        case 'tab-sett-label':
            await loadCompanySettings();
            break;
    }
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
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: batches } = await fetchData('roast_batches');
    const { data: packed } = await fetchData('packed_coffee');
    const { data: orders } = await fetchData('request_orders');
    
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
    const totalMtdRoasted = mtdBatches.reduce((acc, item) => acc + parseFloat(item.roasted_yield_kg || 0), 0);
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
        roastingGroup[name].green += parseFloat(b.green_used_kg || 0);
        roastingGroup[name].yield += parseFloat(b.roasted_yield_kg || 0);
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

            const pct = Math.min(100, ((parseFloat(plan.fulfilled_roasted_kg) / parseFloat(plan.target_roasted_kg)) * 100));

            const planEl = document.createElement('div');
            planEl.style.display = 'flex';
            planEl.style.flexDirection = 'column';
            planEl.style.gap = '6px';
            planEl.innerHTML = `
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                    <strong>${coffeeName}</strong>
                    <span>${plan.fulfilled_roasted_kg}/${plan.target_roasted_kg} kg</span>
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
// SECTION 2: GREENBEANS (TAB 1, 2, 3)
// ==========================================================================

// --- TAB 1: Greenbean Inventory ---
async function loadGreenbeanInventory() {
    const { data: inventory } = await fetchData('green_coffee');
    const tbody = document.getElementById('greenbean-table-body');
    tbody.innerHTML = '';

    if (inventory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">${window.t("msg_no_gb")}</td></tr>`;
        return;
    }

    const sortedInv = [...inventory].sort((a, b) => b.id - a.id);

    sortedInv.forEach(bean => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${bean.code}</code></td>
            <td><strong>${bean.name}</strong></td>
            <td>${bean.origin || '-'}</td>
            <td>${bean.process || '-'}</td>
            <td><strong>${parseFloat(bean.stock_kg).toFixed(1)} ${companySettings.weight_unit}</strong></td>
            <td>${bean.supplier || '-'}</td>
        `;
        tbody.appendChild(tr);
    });
    applyFiltersForTable(document.querySelector('#tab-green-inventory table'));
}

async function loadIntakeHistory() {
    const { data: history } = await fetchData('green_coffee_intake');
    const tbody = document.getElementById('intake-history-table-body');
    tbody.innerHTML = '';

    if (!history || history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">${window.t("msg_no_intakes")}</td></tr>`;
        return;
    }

    // Sort by date descending
    const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);

    sorted.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${item.date}</td>
            <td><code>${item.code}</code></td>
            <td><strong>${item.name}</strong></td>
            <td>${item.origin || '-'}</td>
            <td>${item.process || '-'}</td>
            <td><strong>${parseFloat(item.quantity).toFixed(1)} ${companySettings.weight_unit}</strong></td>
            <td>${item.supplier || '-'}</td>
            <td>
                <button class="btn btn-secondary btn-sm btn-edit-intake" data-id="${item.id}"><i class="lucide-edit-2"></i></button>
                <button class="btn btn-danger btn-sm btn-delete-intake" data-id="${item.id}"><i class="lucide-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Wire up events
    document.querySelectorAll('.btn-edit-intake').forEach(btn => {
        btn.addEventListener('click', () => openIntakeModal(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-delete-intake').forEach(btn => {
        btn.addEventListener('click', () => deleteIntake(parseInt(btn.getAttribute('data-id'))));
    });

    applyFiltersForTable(document.querySelector('#tab-add-gb-history table'));
}

async function openIntakeModal(editId = null) {
    const { data: inventory } = await fetchData('green_coffee');
    const { data: history } = await fetchData('green_coffee_intake');
    
    let intakeItem = null;
    if (editId) {
        intakeItem = history.find(item => item.id === editId);
    }

    // Generate datalist options for autocomplete
    const uniqueNames = [...new Set(inventory.map(g => g.name).filter(Boolean))];
    const uniqueOrigins = [...new Set(inventory.map(g => g.origin).filter(Boolean))];
    const uniqueProcesses = [...new Set(inventory.map(g => g.process).filter(Boolean))];
    const uniqueSuppliers = [...new Set(inventory.map(g => g.supplier).filter(Boolean))];

    const nameOpts = uniqueNames.map(name => `<option value="${name}"></option>`).join('');
    const originOpts = uniqueOrigins.map(origin => `<option value="${origin}"></option>`).join('');
    const processOpts = uniqueProcesses.map(proc => `<option value="${proc}"></option>`).join('');
    const supplierOpts = uniqueSuppliers.map(sup => `<option value="${sup}"></option>`).join('');

    const defaultDate = intakeItem ? intakeItem.date : new Date().toISOString().split('T')[0];
    const defaultName = intakeItem ? intakeItem.name : '';
    const defaultCode = intakeItem ? intakeItem.code : '';
    const defaultOrigin = intakeItem ? intakeItem.origin : '';
    const defaultProcess = intakeItem ? intakeItem.process : '';
    const defaultQty = intakeItem ? parseFloat(intakeItem.quantity) : 100.0;
    const defaultSupplier = intakeItem ? intakeItem.supplier : '';

    const html = `
        <form id="modal-intake-form">
            <div class="form-group">
                <label class="form-label">Arrival Date</label>
                <input type="date" id="m-int-date" class="form-control" value="${defaultDate}" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Coffee Name</label>
                    <input type="text" id="m-int-name" list="int-names-list" class="form-control" value="${defaultName}" placeholder="e.g. Aceh Gayo Arabica" required autocomplete="off">
                    <datalist id="int-names-list">
                        ${nameOpts}
                    </datalist>
                </div>
                <div class="form-group">
                    <label class="form-label">Item Code</label>
                    <input type="text" id="m-int-code" class="form-control" value="${defaultCode}" placeholder="e.g. GB1" required>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Origin Country/Region</label>
                    <input type="text" id="m-int-origin" list="int-origins-list" class="form-control" value="${defaultOrigin}" placeholder="e.g. Aceh, Indonesia" autocomplete="off">
                    <datalist id="int-origins-list">
                        ${originOpts}
                    </datalist>
                </div>
                <div class="form-group">
                    <label class="form-label">Processing Method</label>
                    <input type="text" id="m-int-process" list="int-processes-list" class="form-control" value="${defaultProcess}" placeholder="e.g. Wet Hulled" autocomplete="off">
                    <datalist id="int-processes-list">
                        ${processOpts}
                    </datalist>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Quantity (kg)</label>
                    <input type="number" step="0.1" id="m-int-qty" class="form-control" value="${defaultQty}" min="0.1" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Supplier Name</label>
                    <input type="text" id="m-int-supplier" list="int-suppliers-list" class="form-control" value="${defaultSupplier}" placeholder="e.g. Gayo Estate" autocomplete="off">
                    <datalist id="int-suppliers-list">
                        ${supplierOpts}
                    </datalist>
                </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">${editId ? 'Save Changes' : 'Add Lot'}</button>
            </div>
        </form>
    `;

    openModal(editId ? 'Edit Greenbean Lot (Intake)' : 'Received Lot', html);

    const nameInput = document.getElementById('m-int-name');
    nameInput.addEventListener('input', () => {
        const val = nameInput.value.trim();
        const match = inventory.find(g => g.name.toLowerCase() === val.toLowerCase());
        if (match) {
            document.getElementById('m-int-code').value = match.code || '';
            document.getElementById('m-int-origin').value = match.origin || '';
            document.getElementById('m-int-process').value = match.process || '';
            document.getElementById('m-int-supplier').value = match.supplier || '';
        }
    });

    document.getElementById('modal-intake-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const date = document.getElementById('m-int-date').value;
        const code = document.getElementById('m-int-code').value.trim();
        const name = nameInput.value.trim();
        const origin = document.getElementById('m-int-origin').value.trim();
        const process = document.getElementById('m-int-process').value.trim();
        const quantity = parseFloat(document.getElementById('m-int-qty').value);
        const supplier = document.getElementById('m-int-supplier').value.trim();

        // If editing, subtract old qty from old inventory item first
        if (editId && intakeItem) {
            const oldMatch = inventory.find(g => g.name.toLowerCase() === intakeItem.name.toLowerCase() && g.code.toLowerCase() === intakeItem.code.toLowerCase());
            if (oldMatch) {
                oldMatch.stock_kg = Math.max(0, parseFloat(oldMatch.stock_kg) - parseFloat(intakeItem.quantity));
                await saveData('green_coffee', oldMatch);
            }
        }

        // 1. Save record in green_coffee_intake
        const intakeRecord = {
            id: editId || undefined,
            date,
            code,
            name,
            origin,
            process,
            quantity,
            supplier
        };
        await saveData('green_coffee_intake', intakeRecord);

        // 2. Add to green_coffee stock level or create new record
        const match = inventory.find(g => g.name.toLowerCase() === name.toLowerCase() && g.code.toLowerCase() === code.toLowerCase());
        if (match) {
            match.stock_kg = parseFloat(match.stock_kg) + quantity;
            if (origin) match.origin = origin;
            if (process) match.process = process;
            if (supplier) match.supplier = supplier;
            await saveData('green_coffee', match);
        } else {
            const newBean = {
                code,
                name,
                origin,
                process,
                stock_kg: quantity,
                purchase_price_per_kg: 0.0,
                supplier
            };
            await saveData('green_coffee', newBean);
        }

        modalContainer.classList.add('hidden');
        
        loadIntakeHistory();
        loadGreenbeanInventory();
        scheduleDashboardRefresh(); // Update stats
    });
}

async function deleteIntake(deleteId) {
    if (await showWarningModal("Are you sure you want to delete this intake lot? This will deduct its quantity from the warehouse inventory.")) {
        const { data: history } = await fetchData('green_coffee_intake');
        const item = history.find(i => i.id === deleteId);
        if (!item) return;

        // Deduct quantity from warehouse inventory
        const { data: inventory } = await fetchData('green_coffee');
        const match = inventory.find(g => g.name.toLowerCase() === item.name.toLowerCase() && g.code.toLowerCase() === item.code.toLowerCase());
        if (match) {
            match.stock_kg = Math.max(0, parseFloat(match.stock_kg) - parseFloat(item.quantity));
            await saveData('green_coffee', match);
        }

        // Delete from DB
        const { error } = await deleteData('green_coffee_intake', deleteId);
        if (error) {
            alert(window.t("alert_delete_failed").replace("{msg}", error.message));
        } else {
            loadIntakeHistory();
            loadGreenbeanInventory();
            scheduleDashboardRefresh();
        }
    }
}

// // --- TAB 2: Production Potential ---
async function loadRecipeProductionPotential() {
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
    const { data: ingredients } = await fetchData('blend_ingredients');
    
    const tbody = document.getElementById('potential-table-body');
    tbody.innerHTML = '';

    const list = [];

    // 1. Process Single Origin potential (100% of single greenbean stock * 0.85 yield)
    greenbeans.forEach(bean => {
        const rawStock = parseFloat(bean.stock_kg || 0);
        const potentialYield = rawStock * 0.85;

        list.push({
            type: 'Single Origin',
            name: bean.name,
            code: bean.code,
            rawStock: rawStock,
            potentialYield: potentialYield
        });
    });

    // 2. Process Blend Recipes potential based on limiting greenbean stock
    recipes.forEach(recipe => {
        // Find ingredients for this recipe
        const recipeIngredients = ingredients.filter(ing => ing.blend_recipe_id === recipe.id);
        
        if (recipeIngredients.length === 0) {
            list.push({
                type: 'Blend',
                name: recipe.name,
                code: recipe.code,
                rawStock: 0,
                potentialYield: 0
            });
            return;
        }

        // Calculate limiting greenbean stock
        let maxBlendWeight = Infinity;
        recipeIngredients.forEach(ing => {
            const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
            const stock = gb ? parseFloat(gb.stock_kg || 0) : 0;
            const ratio = parseFloat(ing.percentage) / 100;
            
            const itemLimit = ratio > 0 ? stock / ratio : Infinity;
            if (itemLimit < maxBlendWeight) {
                maxBlendWeight = itemLimit;
            }
        });

        if (maxBlendWeight === Infinity) maxBlendWeight = 0;
        const potentialYield = maxBlendWeight * 0.85;

        list.push({
            type: 'Blend',
            name: recipe.name,
            code: recipe.code,
            rawStock: maxBlendWeight,
            potentialYield: potentialYield
        });
    });

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No potential stock or recipes configured.</td></tr>`;
        return;
    }

    // Sort by potential yield descending
    list.sort((a, b) => b.potentialYield - a.potentialYield);

    list.forEach(item => {
        const tr = document.createElement('tr');
        const isSingle = item.type === 'Single Origin';
        const typeLabel = isSingle ? window.t('potential_single') : window.t('potential_blend');
        const badgeClass = isSingle ? 'badge badge-single' : 'badge badge-blend';

        tr.innerHTML = `
            <td><code>${item.code}</code></td>
            <td><strong>${item.name}</strong></td>
            <td><span class="${badgeClass}">${typeLabel}</span></td>
            <td><strong>${item.rawStock.toFixed(1)} ${companySettings.weight_unit}</strong></td>
            <td><strong>${item.potentialYield.toFixed(1)} ${companySettings.weight_unit}</strong></td>
        `;
        tbody.appendChild(tr);
    });
    applyFiltersForTable(document.querySelector('#tab-recipe-potential table'));
}

// --- TAB 3: Blend Recipes ---
async function loadBlendRecipes() {
    const { data: recipes } = await fetchData('blend_recipes');
    const { data: ingredients } = await fetchData('blend_ingredients');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: machines } = await fetchData('machines');

    const tbody = document.getElementById('recipe-table-body');
    tbody.innerHTML = '';

    if (recipes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No custom blend recipes configured.</td></tr>`;
        return;
    }

    const sortedRecipes = [...recipes].sort((a, b) => b.id - a.id);

    sortedRecipes.forEach(recipe => {
        // Find ingredients
        const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === recipe.id);
        const ingTexts = recipeIngs.map(ing => {
            const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
            return gb ? `${gb.name} (${ing.percentage}%)` : `Unknown (${ing.percentage}%)`;
        });

        // Find machine
        const targetMach = machines.find(m => m.id === recipe.machine_id);
        const machineName = targetMach ? targetMach.name : 'Any Machine';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${recipe.code}</code></td>
            <td><strong>${recipe.name}</strong></td>
            <td>${machineName}</td>
            <td>${recipe.batch_size_g} g</td>
            <td><span style="font-size:0.8rem; color: var(--text-secondary);">${ingTexts.join(', ') || 'No Ingredients'}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm btn-edit-recipe" data-id="${recipe.id}"><i class="lucide-edit-2"></i></button>
                <button class="btn btn-danger btn-sm btn-delete-recipe" data-id="${recipe.id}"><i class="lucide-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Wire up events
    document.querySelectorAll('.btn-edit-recipe').forEach(btn => {
        btn.addEventListener('click', () => openRecipeModal(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-delete-recipe').forEach(btn => {
        btn.addEventListener('click', () => deleteRecipe(parseInt(btn.getAttribute('data-id'))));
    });
    applyFiltersForTable(document.querySelector('#tab-blend-recipes table'));
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
function showWarningModal(message, isConfirm = true, title = 'Warning') {
    return new Promise((resolve) => {
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
                    <p id="warn-dialog-message" style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6;"></p>
                    <div style="display: flex; justify-content: center; gap: 12px;">
                        <button type="button" id="btn-warn-dialog-cancel" class="btn btn-secondary" style="min-width: 100px;">Cancel</button>
                        <button type="button" id="btn-warn-dialog-confirm" class="btn btn-danger" style="min-width: 100px; background: var(--danger); color: #fff;">OK</button>
                    </div>
                </div>
            `;
            document.body.appendChild(warningContainer);
        }

        const titleEl = document.getElementById('warn-dialog-title');
        const cancelBtn = document.getElementById('btn-warn-dialog-cancel');
        const confirmBtn = document.getElementById('btn-warn-dialog-confirm');

        if (titleEl) {
            if (title === 'Warning') {
                titleEl.textContent = window.t ? window.t('warn_header') || 'Warning' : 'Warning';
            } else {
                titleEl.textContent = title;
            }
        }
        
        if (cancelBtn) {
            cancelBtn.textContent = window.t ? window.t('btn_cancel') : 'Cancel';
            cancelBtn.style.display = isConfirm ? 'inline-block' : 'none';
        }
        
        if (confirmBtn) {
            confirmBtn.textContent = window.t ? window.t('btn_confirm_ok') || 'OK' : 'OK';
        }

        document.getElementById('warn-dialog-message').textContent = message;
        warningContainer.classList.remove('hidden');

        cancelBtn.onclick = () => {
            warningContainer.classList.add('hidden');
            resolve(false);
        };

        confirmBtn.onclick = () => {
            warningContainer.classList.add('hidden');
            resolve(true);
        };
    });
}

// --- modal: ADD / EDIT GREENBEAN ---
async function openGreenbeanModal(id = null) {
    const { data: inventory } = await fetchData('green_coffee');
    let bean = { code: '', name: '', origin: '', process: '', stock_kg: 0.0, purchase_price_per_kg: 0, supplier: '' };
    if (id) {
        bean = inventory.find(g => g.id === id) || bean;
    }

    // Gather unique values for datalist dropdowns
    const uniqueNames = [...new Set(inventory.map(g => g.name).filter(Boolean))];
    const uniqueOrigins = [...new Set(inventory.map(g => g.origin).filter(Boolean))];
    const uniqueProcesses = [...new Set(inventory.map(g => g.process).filter(Boolean))];

    const nameOpts = uniqueNames.map(name => `<option value="${name}"></option>`).join('');
    const originOpts = uniqueOrigins.map(origin => `<option value="${origin}"></option>`).join('');
    const processOpts = uniqueProcesses.map(proc => `<option value="${proc}"></option>`).join('');

    const html = `
        <form id="modal-greenbean-form">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Coffee Name</label>
                    <input type="text" id="m-gb-name" list="gb-names-list" class="form-control" value="${bean.name}" placeholder="e.g. Ethiopia Yirgacheffe" required autocomplete="off">
                    <datalist id="gb-names-list">
                        ${nameOpts}
                    </datalist>
                </div>
                <div class="form-group">
                    <label class="form-label">Item Code</label>
                    <input type="text" id="m-gb-code" class="form-control" value="${bean.code}" placeholder="e.g. GB4" required>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Origin Country/Region</label>
                    <input type="text" id="m-gb-origin" list="gb-origins-list" class="form-control" value="${bean.origin}" placeholder="e.g. Sidama, Ethiopia" autocomplete="off">
                    <datalist id="gb-origins-list">
                        ${originOpts}
                    </datalist>
                </div>
                <div class="form-group">
                    <label class="form-label">Processing Method</label>
                    <input type="text" id="m-gb-process" list="gb-processes-list" class="form-control" value="${bean.process}" placeholder="e.g. Washed / Natural" autocomplete="off">
                    <datalist id="gb-processes-list">
                        ${processOpts}
                    </datalist>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Quantity (kg)</label>
                    <input type="number" step="0.1" id="m-gb-stock" class="form-control" value="${bean.stock_kg}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Supplier Name</label>
                    <input type="text" id="m-gb-supplier" class="form-control" value="${bean.supplier}" placeholder="e.g. Royal Coffee Corp">
                </div>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Greenbean</button>
            </div>
        </form>
    `;

    openModal(id ? 'Edit Greenbean Item' : 'Greenbean Intake', html);

    // Auto-fill form values if name matching an existing record is selected/typed
    const nameInput = document.getElementById('m-gb-name');
    nameInput.addEventListener('input', () => {
        const val = nameInput.value.trim();
        const match = inventory.find(g => g.name.toLowerCase() === val.toLowerCase());
        if (match) {
            document.getElementById('m-gb-code').value = match.code || '';
            document.getElementById('m-gb-origin').value = match.origin || '';
            document.getElementById('m-gb-process').value = match.process || '';
            document.getElementById('m-gb-supplier').value = match.supplier || '';
        }
    });

    document.getElementById('modal-greenbean-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const record = {
            id: id || undefined,
            code: document.getElementById('m-gb-code').value,
            name: nameInput.value,
            origin: document.getElementById('m-gb-origin').value,
            process: document.getElementById('m-gb-process').value,
            stock_kg: parseFloat(document.getElementById('m-gb-stock').value),
            purchase_price_per_kg: id ? bean.purchase_price_per_kg : 0.0,
            supplier: document.getElementById('m-gb-supplier').value
        };

        const { error } = await saveData('green_coffee', record);
        if (error) {
            alert(window.t("alert_save_failed").replace("{msg}", error.message));
        } else {
            modalContainer.classList.add('hidden');
            loadGreenbeanInventory();
            scheduleDashboardRefresh(); // Update stats
        }
    });
}

async function deleteGreenbean(id) {
    if (await showWarningModal("Are you sure you want to delete this green coffee bean item from the system?")) {
        const { error } = await deleteData('green_coffee', id);
        if (error) {
            await showWarningModal(window.t("alert_delete_failed").replace("{msg}", error.message), false);
        } else {
            loadGreenbeanInventory();
            scheduleDashboardRefresh();
        }
    }
}

// --- modal: ADD / EDIT BLEND RECIPE ---
async function openRecipeModal(id = null) {
    const { data: machines } = await fetchData('machines');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: ingredients } = await fetchData('blend_ingredients');

    let recipe = { code: '', name: '', machine_id: machines[0]?.id || '', batch_size_g: 5000, description: '' };
    let recipeIngs = [];

    if (id) {
        const { data: recipes } = await fetchData('blend_recipes');
        recipe = recipes.find(r => r.id === id) || recipe;
        recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === id);
    } else {
        // Create an initial empty component row
        recipeIngs = [{ green_coffee_id: greenbeans[0]?.id || '', percentage: 0.0 }];
    }

    // Machine Options
    const machineOptsHtml = machines.map(m => `
        <option value="${m.id}" data-capacity="${m.ideal_batch_size_g}" ${m.id === recipe.machine_id ? 'selected' : ''}>
            ${m.name} (ideal: ${m.ideal_batch_size_g}g)
        </option>
    `).join('');

    // Modal Content Structure
    const html = `
        <form id="modal-recipe-form">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Recipe Code</label>
                    <input type="text" id="m-rec-code" class="form-control" value="${recipe.code}" placeholder="e.g. BL1" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Blend Name</label>
                    <input type="text" id="m-rec-name" class="form-control" value="${recipe.name}" placeholder="e.g. Signature Espresso" required>
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Target Roaster Machine</label>
                    <select id="m-rec-machine" class="form-control" required>
                        ${machineOptsHtml}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Total Batch Size (g)</label>
                    <input type="number" id="m-rec-batch-size" class="form-control" value="${recipe.batch_size_g}" required>
                </div>
            </div>

            <div class="form-group" style="margin-top: 10px;">
                <label class="form-label" style="display:flex; justify-content:space-between; align-items:center;">
                    <span>Recipe Components (Greenbean Mix)</span>
                    <span id="ratio-sum-lbl" style="font-weight: 700; color: var(--warning);">Sum: 0%</span>
                </label>
                <div id="recipe-components-list" style="max-height: 25vh; overflow-y: auto; padding-right: 4px; margin-bottom: 8px;">
                    <!-- Dynamic Component Rows -->
                </div>
                <button type="button" id="btn-add-component-row" class="btn btn-secondary btn-sm" style="margin-top: 10px; width: 100%;">
                    <i class="lucide-plus"></i> Add Coffee Component
                </button>
            </div>

            <div class="form-group">
                <label class="form-label">Roasting Description / Notes</label>
                <textarea id="m-rec-desc" class="form-control" rows="2" placeholder="e.g. target roast level: Medium-Dark, profile notes...">${recipe.description || ''}</textarea>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Recipe</button>
            </div>
        </form>
    `;

    openModal(id ? 'Edit Coffee Blend Recipe' : 'Create Custom Blend Recipe', html, '650px');

    const componentsList = document.getElementById('recipe-components-list');
    const batchSizeInput = document.getElementById('m-rec-batch-size');
    const machineSelect = document.getElementById('m-rec-machine');
    const ratioSumLbl = document.getElementById('ratio-sum-lbl');

    // Populate Initial Component Rows
    recipeIngs.forEach(ing => {
        addComponentRow(ing.green_coffee_id, parseFloat(ing.percentage));
    });

    updateRatioSum();

    // Event: machine selection auto-populates ideal batch size
    machineSelect.addEventListener('change', () => {
        const selectedOpt = machineSelect.options[machineSelect.selectedIndex];
        const capacity = selectedOpt.getAttribute('data-capacity');
        if (capacity) {
            batchSizeInput.value = capacity;
            // When batch size changes, re-sync quantities based on current ratios
            syncAllQuantities();
        }
    });

    // Event: changing batch size manually updates quantities
    batchSizeInput.addEventListener('input', () => {
        syncAllQuantities();
    });

    // Event: Add component row
    document.getElementById('btn-add-component-row').addEventListener('click', () => {
        addComponentRow(greenbeans[0]?.id || '', 0);
    });

    // Function to add a single component row dynamically
    function addComponentRow(greenbeanId, percentageVal) {
        const row = document.createElement('div');
        row.className = 'component-row';

        // Build Greenbean Select Options
        const greenbeanOpts = greenbeans.map(g => `
            <option value="${g.id}" ${g.id === greenbeanId ? 'selected' : ''}>${g.name}</option>
        `).join('');

        // Calculate initial quantity based on batch size
        const batchSize = parseFloat(batchSizeInput.value) || 5000;
        const qtyVal = (percentageVal / 100) * batchSize;

        row.innerHTML = `
            <div class="form-group" style="flex: 2;">
                <select class="form-control comp-select" required>
                    ${greenbeanOpts}
                </select>
            </div>
            <div class="form-group" style="flex: 1;">
                <input type="number" step="1" class="form-control comp-qty" value="${Math.round(qtyVal)}" placeholder="Qty (g)" required>
            </div>
            <div class="form-group" style="flex: 1;">
                <input type="number" step="0.1" class="form-control comp-ratio" value="${percentageVal.toFixed(1)}" placeholder="Ratio (%)" required>
            </div>
            <button type="button" class="btn-remove-row">&times;</button>
        `;

        componentsList.appendChild(row);

        const qtyInput = row.querySelector('.comp-qty');
        const ratioInput = row.querySelector('.comp-ratio');
        const removeBtn = row.querySelector('.btn-remove-row');

        // Bi-directional event listeners
        qtyInput.addEventListener('input', () => {
            const batch = parseFloat(batchSizeInput.value) || 5000;
            const qty = parseFloat(qtyInput.value) || 0;
            const ratio = (qty / batch) * 100;
            ratioInput.value = ratio.toFixed(1);
            updateRatioSum();
        });

        ratioInput.addEventListener('input', () => {
            const batch = parseFloat(batchSizeInput.value) || 5000;
            const ratio = parseFloat(ratioInput.value) || 0;
            const qty = (ratio / 100) * batch;
            qtyInput.value = Math.round(qty);
            updateRatioSum();
        });

        removeBtn.addEventListener('click', () => {
            row.remove();
            updateRatioSum();
        });
    }

    // Bi-directional: sync quantities if batch size is updated
    function syncAllQuantities() {
        const batch = parseFloat(batchSizeInput.value) || 5000;
        const rows = componentsList.querySelectorAll('.component-row');
        rows.forEach(row => {
            const qtyInput = row.querySelector('.comp-qty');
            const ratioInput = row.querySelector('.comp-ratio');
            const ratio = parseFloat(ratioInput.value) || 0;
            const qty = (ratio / 100) * batch;
            qtyInput.value = Math.round(qty);
        });
    }

    // Update the Sum display indicator at the top
    function updateRatioSum() {
        const ratios = Array.from(componentsList.querySelectorAll('.comp-ratio'))
            .map(input => parseFloat(input.value) || 0);
        const sum = ratios.reduce((acc, curr) => acc + curr, 0);
        
        ratioSumLbl.textContent = `Sum: ${sum.toFixed(1)}%`;
        if (Math.abs(sum - 100.0) < 0.05) {
            ratioSumLbl.style.color = 'var(--success)';
        } else {
            ratioSumLbl.style.color = 'var(--warning)';
        }
    }

    // Handle Form Submit
    document.getElementById('modal-recipe-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. Validate Sum equals exactly 100%
        const rows = Array.from(componentsList.querySelectorAll('.component-row'));
        const ingredientsData = rows.map(row => ({
            green_coffee_id: parseInt(row.querySelector('.comp-select').value),
            percentage: parseFloat(row.querySelector('.comp-ratio').value) || 0,
            quantity_g: parseFloat(row.querySelector('.comp-qty').value) || 0
        }));

        const sum = ingredientsData.reduce((acc, curr) => acc + curr.percentage, 0);
        if (Math.abs(sum - 100.0) > 0.1) {
            alert(window.t("alert_blend_ratio_err") + ` (${sum.toFixed(1)}%)`);
            return;
        }

        // 2. Save recipe metadata
        const recipeRecord = {
            id: id || undefined,
            code: document.getElementById('m-rec-code').value,
            name: document.getElementById('m-rec-name').value,
            machine_id: parseInt(document.getElementById('m-rec-machine').value),
            batch_size_g: parseInt(batchSizeInput.value),
            description: document.getElementById('m-rec-desc').value
        };

        const { data: savedRecipe, error: recipeErr } = await saveData('blend_recipes', recipeRecord);
        if (recipeErr) {
            alert(window.t("alert_save_failed").replace("{msg}", recipeErr.message));
            return;
        }

        // 3. Save recipe ingredient linkages (clean recreate for simplicity)
        const activeRecipeId = savedRecipe.id;
        const { data: existingIngs } = await fetchData('blend_ingredients');
        
        // Remove old ingredients for this recipe if editing
        if (id) {
            const ingIdsToDelete = existingIngs
                .filter(ing => ing.blend_recipe_id === id)
                .map(ing => ing.id);
            
            for (const ingId of ingIdsToDelete) {
                await deleteData('blend_ingredients', ingId);
            }
        }

        // Insert new ingredients
        for (const ing of ingredientsData) {
            const ingRecord = {
                blend_recipe_id: activeRecipeId,
                green_coffee_id: ing.green_coffee_id,
                percentage: ing.percentage,
                quantity_g: ing.quantity_g
            };
            await saveData('blend_ingredients', ingRecord);
        }

        modalContainer.classList.add('hidden');
        loadBlendRecipes();
    });
}

async function deleteRecipe(id) {
    if (await showWarningModal("Are you sure you want to delete this coffee recipe? All ingredients linked to this recipe will be removed.")) {
        const { error } = await deleteData('blend_recipes', id);
        if (error) {
            await showWarningModal(window.t("alert_delete_failed").replace("{msg}", error.message), false);
        } else {
            loadBlendRecipes();
        }
    }
}

// ==========================================================================
// SECTION 3: ROASTING PRODUCTION (PLANS & BATCHES)
// ==========================================================================
async function loadRoastingSection() {
    await loadRoastingPlans();
    await loadRoastingBatches();
}

async function loadRoastingPlans() {
    const { data: plans } = await fetchData('roasting_plans');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
    const { data: machines } = await fetchData('machines');
    
    const tbody = document.getElementById('plan-table-body');
    tbody.innerHTML = '';

    if (plans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">${window.t("msg_no_plans")}</td></tr>`;
        return;
    }

    const sortedPlans = [...plans].sort((a, b) => new Date(b.plan_date) - new Date(a.plan_date) || b.id - a.id);

    sortedPlans.forEach(plan => {
        let coffeeName = '';
        if (plan.coffee_type === 'Single') {
            const gb = greenbeans.find(g => g.id === plan.single_coffee_id);
            coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
        } else {
            const r = recipes.find(rec => rec.id === plan.blend_recipe_id);
            coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
        }

        const mach = machines.find(m => m.id === plan.machine_id);
        const machineName = mach ? mach.name : '<span style="color:var(--text-muted);font-style:italic;">—</span>';

        // Automatic Status update if fulfilled >= target
        const targetKg = parseFloat(plan.target_roasted_kg || 0);
        const fulfilledKg = parseFloat(plan.fulfilled_roasted_kg || 0);
        if (fulfilledKg >= targetKg && targetKg > 0) {
            if (plan.status !== 'Completed') {
                plan.status = 'Completed';
                saveData('roasting_plans', plan);
            }
        }

        const pct = targetKg > 0 ? (fulfilledKg / targetKg) * 100 : 0;
        const displayPct = Math.min(100, pct);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${plan.plan_date}</td>
            <td><strong>${coffeeName}</strong></td>
            <td>${machineName}</td>
            <td>${targetKg} kg</td>
            <td>${fulfilledKg} kg</td>
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="flex:1; background:rgba(255,255,255,0.1); height:8px; border-radius:4px; overflow:hidden; min-width:80px;">
                        <div style="width:${displayPct.toFixed(0)}%; height:100%; background:var(--primary); border-radius:4px;"></div>
                    </div>
                    <span style="font-size:0.75rem; font-weight:bold; width:35px; text-align:right;">${displayPct.toFixed(0)}%</span>
                </div>
            </td>
            <td><span style="font-size:0.75rem; padding: 2px 8px; border-radius: 9999px; font-weight:700; ${
                plan.status === 'Completed' ? 'background: rgba(16,185,129,0.15); color: var(--success);' :
                plan.status === 'In Progress' ? 'background: rgba(245,158,11,0.15); color: var(--warning);' :
                plan.status === 'On Process' ? 'background: rgba(59,130,246,0.15); color: #3b82f6;' :
                'background: rgba(255,255,255,0.05); color: var(--text-muted);'
            }">${plan.status}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm btn-edit-plan" data-id="${plan.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
                <button class="btn btn-danger btn-sm btn-delete-plan" data-id="${plan.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-edit-plan').forEach(btn => {
        btn.addEventListener('click', () => openRoastPlanModal(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-delete-plan').forEach(btn => {
        btn.addEventListener('click', () => deletePlan(parseInt(btn.getAttribute('data-id'))));
    });
    applyFiltersForTable(document.querySelector('#tab-roast-plans table'));
}

async function loadRoastingBatches() {
    const { data: batches } = await fetchData('roast_batches');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
    const { data: machines } = await fetchData('machines');

    const tbody = document.getElementById('batch-table-body');
    tbody.innerHTML = '';

    if (batches.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted);">${window.t("msg_no_batches")}</td></tr>`;
        return;
    }

    const sortedBatches = [...batches].sort((a, b) => new Date(b.roast_date) - new Date(a.roast_date) || b.id - a.id);
    const totalItems = sortedBatches.length;

    // Slicing logic for pagination
    const totalPages = Math.ceil(totalItems / batchPageSize) || 1;
    if (batchCurrentPage > totalPages) {
        batchCurrentPage = totalPages;
    }

    const startIndex = (batchCurrentPage - 1) * batchPageSize;
    const endIndex = Math.min(startIndex + batchPageSize, totalItems);
    const paginatedBatches = sortedBatches.slice(startIndex, endIndex);

    // Update Show text
    const pageInfo = document.getElementById('batch-page-info');
    if (pageInfo) {
        pageInfo.textContent = `Show ${totalItems === 0 ? 0 : startIndex + 1} - ${endIndex} of ${totalItems}`;
    }

    // Highlight active page size
    const sizeOpts = document.querySelectorAll('#batch-page-size-selector .page-size-opt');
    sizeOpts.forEach(opt => {
        const size = parseInt(opt.getAttribute('data-size'));
        if (size === batchPageSize) {
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
    const paginationContainer = document.getElementById('batch-pagination-pages');
    if (paginationContainer) {
        paginationContainer.innerHTML = '';
        if (totalPages > 1) {
            // Prev button
            const prevBtn = document.createElement('button');
            prevBtn.className = `pagination-btn ${batchCurrentPage === 1 ? 'disabled' : ''}`;
            prevBtn.innerHTML = `&lt;`;
            prevBtn.addEventListener('click', () => {
                if (batchCurrentPage > 1) {
                    batchCurrentPage--;
                    loadRoastingBatches();
                }
            });
            paginationContainer.appendChild(prevBtn);

            // Page numbers
            for (let i = 1; i <= totalPages; i++) {
                const pageBtn = document.createElement('button');
                pageBtn.className = `pagination-btn ${batchCurrentPage === i ? 'active' : ''}`;
                pageBtn.textContent = i;
                pageBtn.addEventListener('click', () => {
                    batchCurrentPage = i;
                    loadRoastingBatches();
                });
                paginationContainer.appendChild(pageBtn);
            }

            // Next button
            const nextBtn = document.createElement('button');
            nextBtn.className = `pagination-btn ${batchCurrentPage === totalPages ? 'disabled' : ''}`;
            nextBtn.innerHTML = `&gt;`;
            nextBtn.addEventListener('click', () => {
                if (batchCurrentPage < totalPages) {
                    batchCurrentPage++;
                    loadRoastingBatches();
                }
            });
            paginationContainer.appendChild(nextBtn);
        }
    }

    paginatedBatches.forEach(batch => {
        let coffeeName = '';
        if (batch.coffee_type === 'Single') {
            const gb = greenbeans.find(g => g.id === batch.single_coffee_id);
            coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
        } else {
            const r = recipes.find(rec => rec.id === batch.blend_recipe_id);
            coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
        }

        const mach = machines.find(m => m.id === batch.machine_id);
        const machineName = mach ? mach.name : 'Unknown';
        
        const inputG = (parseFloat(batch.input_weight_kg || 0) * 1000).toFixed(0);
        const outputG = (parseFloat(batch.output_weight_kg || 0) * 1000).toFixed(0);
        const depVal = (100 - parseFloat(batch.yield_percentage || 0)).toFixed(1);

        let typeBadgeHtml = '';
        if (batch.roast_type === 'Test') {
            typeBadgeHtml = `
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:0.75rem; padding: 2px 8px; border-radius: 9999px; font-weight:700; background: rgba(245,158,11,0.15); color: var(--warning);">${batch.roast_type}</span>
                    ${batch.qc_status === 'Pending' ? `
                        <button class="btn btn-success btn-sm btn-approve-test-batch" data-id="${batch.id}" style="padding: 2px 6px; font-size: 0.7rem; font-weight: 700; border-radius: 4px;">
                            Approve
                        </button>
                    ` : `
                        <span style="color:var(--success); font-size:0.7rem; font-weight:700; white-space:nowrap;">✓ Approved</span>
                    `}
                </div>
            `;
        } else {
            typeBadgeHtml = `<span style="font-size:0.75rem; padding: 2px 8px; border-radius: 9999px; font-weight:700; background: rgba(16,185,129,0.15); color: var(--success);">${batch.roast_type}</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-col="0">${batch.roast_date}</td>
            <td data-col="1"><code>${batch.batch_code || '-'}</code></td>
            <td data-col="2"><strong>${coffeeName}</strong></td>
            <td data-col="3">${machineName}</td>
            <td data-col="4">${inputG} g</td>
            <td data-col="5">${outputG} g</td>
            <td data-col="6">${depVal}%</td>
            <td data-col="7">${typeBadgeHtml}</td>
            <td>
                <button class="btn btn-secondary btn-sm btn-print-sticker" data-id="${batch.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align:middle;"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Label</button>
            </td>
            <td>
                <button class="btn btn-secondary btn-sm btn-edit-batch" data-id="${batch.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
                <button class="btn btn-danger btn-sm btn-delete-batch" data-id="${batch.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Update checked state of Customize column visibility checkboxes to match our current memory array
    const checkboxes = document.querySelectorAll('.col-toggle-checkbox');
    checkboxes.forEach(cb => {
        const idx = parseInt(cb.getAttribute('data-col-idx'));
        cb.checked = batchVisibleColumns[idx];
    });

    // Apply column visibility hiding
    applyBatchColumnVisibility();

    document.querySelectorAll('.btn-print-sticker').forEach(btn => {
        btn.addEventListener('click', () => printStickerLabel(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-edit-batch').forEach(btn => {
        btn.addEventListener('click', () => openRoastBatchModal(null, parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-delete-batch').forEach(btn => {
        btn.addEventListener('click', () => deleteBatch(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-approve-test-batch').forEach(btn => {
        btn.addEventListener('click', () => approveTestBatch(parseInt(btn.getAttribute('data-id'))));
    });
    applyFiltersForTable(document.querySelector('#tab-roast-logs table'));
}

// --- modal: ADD / EDIT ROASTING PLAN ---
document.getElementById('btn-add-plan').addEventListener('click', () => {
    openRoastPlanModal();
});

async function openRoastPlanModal(editId = null) {
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
    const { data: ingredients } = await fetchData('blend_ingredients');
    const { data: plans } = await fetchData('roasting_plans');
    const { data: machines } = await fetchData('machines');

    let existingPlan = null;
    if (editId) {
        existingPlan = plans.find(p => p.id === editId);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const planDateVal = existingPlan ? existingPlan.plan_date : todayStr;

    // Generate Select Options
    const gbOpts = greenbeans.map(g => `<option value="Single-${g.id}">${g.name}</option>`).join('');
    const recOpts = recipes.map(r => `<option value="Blend-${r.id}">${r.name}</option>`).join('');
    const machOpts = machines.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    const html = `
        <form id="modal-plan-form" novalidate>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Plan Date</label>
                    <input type="date" id="m-plan-date" class="form-control" value="${planDateVal}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Roaster Machine</label>
                    <select id="m-plan-machine" class="form-control" required>
                        <option value="" disabled>-- Select Machine --</option>
                        ${machOpts}
                    </select>
                </div>
            </div>
            
            <div class="form-group" style="margin-top: 15px;">
                <label class="form-label">Coffee Items to Roast</label>
                <div id="coffee-plans-list" style="max-height: 250px; overflow-y: auto; padding-right: 4px; margin-bottom: 8px;">
                    <!-- Dynamic Coffee Rows -->
                </div>
                ${editId ? '' : `
                <button type="button" id="btn-add-coffee-row" class="btn btn-secondary btn-sm" style="margin-top: 10px; width: 100%;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align:middle;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Another Coffee
                </button>
                `}
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 25px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">${editId ? 'Save Changes' : 'Schedule Plan'}</button>
            </div>
        </form>
    `;

    openModal(editId ? 'Edit Roasting Plan' : 'Create New Roasting Plan', html, '700px');

    const plansList = document.getElementById('coffee-plans-list');
    const machineSelect = document.getElementById('m-plan-machine');

    // Prefill machine on edit
    if (editId && existingPlan && existingPlan.machine_id) {
        machineSelect.value = existingPlan.machine_id;
    } else if (machines[0]) {
        machineSelect.value = machines[0].id;
    }

    // Tracks database original stocks for temporary calculations in the form
    const originalStocks = {};
    greenbeans.forEach(gb => {
        originalStocks[gb.id] = parseFloat(gb.stock_kg || 0);
    });

    // If we are editing, we add back the currently scheduled weight of the existing plan to the pool,
    // so that the current plan does not warn about its own database allocation!
    if (editId && existingPlan) {
        const targetVal = parseFloat(existingPlan.target_roasted_kg) || 0;
        const requiredTotalGb = targetVal / 0.85;
        if (existingPlan.coffee_type === 'Single') {
            const id = existingPlan.single_coffee_id;
            if (id) originalStocks[id] = (originalStocks[id] || 0) + requiredTotalGb;
        } else {
            const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === existingPlan.blend_recipe_id);
            recipeIngs.forEach(ing => {
                const gbId = ing.green_coffee_id;
                const ratio = parseFloat(ing.percentage) / 100;
                const requiredIngGb = requiredTotalGb * ratio;
                originalStocks[gbId] = (originalStocks[gbId] || 0) + requiredIngGb;
            });
        }
    }

    // Helper: Calculate allocations across all rows in the popup
    function getAllocations() {
        const allocations = {};
        const rows = plansList.querySelectorAll('.coffee-plan-row');
        
        rows.forEach(row => {
            const select = row.querySelector('.plan-coffee-select');
            const targetInput = row.querySelector('.plan-target-weight');
            const selectVal = select.value;
            const targetVal = parseFloat(targetInput.value) || 0;
            
            if (!selectVal || targetVal <= 0) return;
            
            const [type, idStr] = selectVal.split('-');
            const id = parseInt(idStr);
            const requiredTotalGb = targetVal / 0.85;
            
            if (type === 'Single') {
                allocations[id] = (allocations[id] || 0) + requiredTotalGb;
            } else {
                const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === id);
                recipeIngs.forEach(ing => {
                    const gbId = ing.green_coffee_id;
                    const ratio = parseFloat(ing.percentage) / 100;
                    const requiredIngGb = requiredTotalGb * ratio;
                    allocations[gbId] = (allocations[gbId] || 0) + requiredIngGb;
                });
            }
        });
        
        return allocations;
    }

    // Helper: Update all displays reactively based on other rows
    function updateAllRowsStockDisplays() {
        const rows = plansList.querySelectorAll('.coffee-plan-row');
        const totalAllocations = getAllocations();
        
        rows.forEach(currentRow => {
            const select = currentRow.querySelector('.plan-coffee-select');
            const availInput = currentRow.querySelector('.plan-avail-stock');
            const potInput = currentRow.querySelector('.plan-potential-prod');
            const targetInput = currentRow.querySelector('.plan-target-weight');
            const warnDiv = currentRow.querySelector('.plan-target-warn');
            
            const selectVal = select.value;
            if (!selectVal) {
                availInput.value = "0.0";
                potInput.value = "0.0";
                warnDiv.style.display = 'none';
                return;
            }
            
            // Deduct current row's allocation from total to get other allocations
            const otherAllocations = { ...totalAllocations };
            const currentTarget = parseFloat(targetInput.value) || 0;
            const [type, idStr] = selectVal.split('-');
            const id = parseInt(idStr);
            const currentRequiredTotalGb = currentTarget / 0.85;
            
            if (type === 'Single') {
                otherAllocations[id] = Math.max(0, (otherAllocations[id] || 0) - currentRequiredTotalGb);
            } else {
                const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === id);
                recipeIngs.forEach(ing => {
                    const gbId = ing.green_coffee_id;
                    const ratio = parseFloat(ing.percentage) / 100;
                    const currentRequiredIngGb = currentRequiredTotalGb * ratio;
                    otherAllocations[gbId] = Math.max(0, (otherAllocations[gbId] || 0) - currentRequiredIngGb);
                });
            }
            
            // Calculate remaining stock for current row
            let availStock = 0;
            let potentialProd = 0;
            
            if (type === 'Single') {
                const original = originalStocks[id] || 0;
                const allocatedElsewhere = otherAllocations[id] || 0;
                availStock = Math.max(0, original - allocatedElsewhere);
                potentialProd = availStock * 0.85;
            } else {
                const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === id);
                if (recipeIngs.length > 0) {
                    let maxBlendWeight = Infinity;
                    recipeIngs.forEach(ing => {
                        const gbId = ing.green_coffee_id;
                        const ratio = parseFloat(ing.percentage) / 100;
                        const original = originalStocks[gbId] || 0;
                        const allocatedElsewhere = otherAllocations[gbId] || 0;
                        const remaining = Math.max(0, original - allocatedElsewhere);
                        const limit = ratio > 0 ? remaining / ratio : Infinity;
                        if (limit < maxBlendWeight) {
                            maxBlendWeight = limit;
                        }
                    });
                    if (maxBlendWeight === Infinity) maxBlendWeight = 0;
                    availStock = maxBlendWeight;
                    potentialProd = availStock * 0.85;
                }
            }
            
            // Update values
            availInput.value = availStock.toFixed(1);
            potInput.value = potentialProd.toFixed(1);
            
            // Check warning
            if (currentTarget > potentialProd) {
                warnDiv.style.display = 'block';
            } else {
                warnDiv.style.display = 'none';
            }
        });
    }

    // Helper: bind row events
    function bindRowEvents(row) {
        const select = row.querySelector('.plan-coffee-select');
        const targetInput = row.querySelector('.plan-target-weight');
        const removeBtn = row.querySelector('.btn-remove-coffee-row');

        select.addEventListener('change', () => {
            updateAllRowsStockDisplays();
        });

        targetInput.addEventListener('input', () => {
            updateAllRowsStockDisplays();
        });

        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                if (plansList.querySelectorAll('.coffee-plan-row').length > 1) {
                    row.remove();
                    updateAllRowsStockDisplays();
                } else {
                    alert(window.t("alert_min_one_coffee_plan"));
                }
            });
        }
    }

    // Helper: Add row function
    function addCoffeeRow(selectedVal = '', targetVal = '') {
        const row = document.createElement('div');
        row.className = 'coffee-plan-row';
        row.style = 'display: flex; gap: 12px; align-items: flex-end; margin-bottom: 20px;';

        row.innerHTML = `
            <div class="form-group" style="flex: 2; margin-bottom: 0;">
                <label class="form-label">Select Coffee</label>
                <select class="form-control plan-coffee-select" required>
                    <option value="" disabled ${selectedVal ? '' : 'selected'}>-- Select Coffee --</option>
                    <optgroup label="Single Origin">
                        ${gbOpts}
                    </optgroup>
                    <optgroup label="Blend Recipes">
                        ${recOpts}
                    </optgroup>
                </select>
            </div>
            <div class="form-group" style="flex: 1; margin-bottom: 0;">
                <label class="form-label">Available Stock (kg)</label>
                <input type="text" class="form-control plan-avail-stock" value="0.0" readonly>
            </div>
            <div class="form-group" style="flex: 1; margin-bottom: 0;">
                <label class="form-label">Potential Prod (kg)</label>
                <input type="text" class="form-control plan-potential-prod" value="0.0" readonly>
            </div>
            <div class="form-group" style="flex: 1.2; margin-bottom: 0; position: relative;">
                <label class="form-label">Target Weight (kg)</label>
                <input type="number" step="0.1" class="form-control plan-target-weight" value="${targetVal}" placeholder="e.g. 10.0" required>
                <div class="plan-target-warn" style="display:none; position: absolute; bottom: -28px; left: 0; background: var(--warning); color: #000; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; z-index: 10; white-space: nowrap; box-shadow: 0 2px 5px rgba(0,0,0,0.25);">
                    ⚠️ Exceeds Stock!
                    <div style="position: absolute; top: -4px; left: 10px; width: 8px; height: 8px; background: var(--warning); transform: rotate(45deg);"></div>
                </div>
            </div>
            ${editId ? '' : `
            <button type="button" class="btn btn-danger btn-remove-coffee-row" style="margin-bottom:0; padding: 10px 14px; height: 38px;">&times;</button>
            `}
        `;

        plansList.appendChild(row);
        bindRowEvents(row);

        if (selectedVal) {
            row.querySelector('.plan-coffee-select').value = selectedVal;
        }
    }

    // Initialize with first row
    if (editId && existingPlan) {
        const selectedVal = `${existingPlan.coffee_type}-${existingPlan.single_coffee_id || existingPlan.blend_recipe_id}`;
        addCoffeeRow(selectedVal, existingPlan.target_roasted_kg);
    } else {
        addCoffeeRow();
    }
    
    // Initial display update
    updateAllRowsStockDisplays();

    // Add Coffee row button
    if (!editId) {
        document.getElementById('btn-add-coffee-row').addEventListener('click', () => {
            addCoffeeRow();
            updateAllRowsStockDisplays();
        });
    }

    // Form submit
    document.getElementById('modal-plan-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const form = e.target;
        let isValid = true;
        
        // Remove existing custom empty warnings
        form.querySelectorAll('.custom-empty-warn').forEach(w => w.remove());
        
        // Custom validation for required fields
        const requiredElements = form.querySelectorAll('[required]');
        requiredElements.forEach(el => {
            if (!el.value || el.value.trim() === '') {
                isValid = false;
                
                // Ensure parent is position: relative
                el.parentElement.style.position = 'relative';
                
                const warnBubble = document.createElement('div');
                warnBubble.className = 'custom-empty-warn';
                warnBubble.style = 'position: absolute; bottom: -28px; left: 0; background: var(--danger); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; z-index: 10; white-space: nowrap; box-shadow: 0 2px 5px rgba(0,0,0,0.25);';
                warnBubble.innerHTML = `
                    ${window.t("alert_field_required")}
                    <div style="position: absolute; top: -4px; left: 10px; width: 8px; height: 8px; background: var(--danger); transform: rotate(45deg);"></div>
                `;
                
                el.parentElement.appendChild(warnBubble);
                
                // Remove warning when user types/changes
                const removeHandler = () => {
                    if (warnBubble.parentNode) warnBubble.remove();
                    el.removeEventListener('input', removeHandler);
                    el.removeEventListener('change', removeHandler);
                };
                el.addEventListener('input', removeHandler);
                el.addEventListener('change', removeHandler);
            }
        });

        if (!isValid) return;
        
        const planDate = document.getElementById('m-plan-date').value;
        const rows = plansList.querySelectorAll('.coffee-plan-row');

        // Check if any warnings are active
        let hasWarning = false;
        rows.forEach(r => {
            const selectVal = r.querySelector('.plan-coffee-select').value;
            const targetWeight = parseFloat(r.querySelector('.plan-target-weight').value) || 0;
            const availInput = r.querySelector('.plan-potential-prod');
            const potential = parseFloat(availInput.value) || 0;
            if (targetWeight > potential) {
                hasWarning = true;
            }
        });

        if (hasWarning) {
            const proceed = await showWarningModal("Warning: One or more target weights exceed available stock potential. Do you want to proceed anyway?");
            if (!proceed) return;
        }

        // Save records & Apply stock changes
        if (editId) {
            const r = rows[0];
            const selectVal = r.querySelector('.plan-coffee-select').value;
            const targetWeight = parseFloat(r.querySelector('.plan-target-weight').value);
            const [type, idStr] = selectVal.split('-');
            const id = parseInt(idStr);

            // Refund old selection stock first
            await adjustGreenbeanStock(existingPlan.coffee_type, existingPlan.single_coffee_id || existingPlan.blend_recipe_id, existingPlan.target_roasted_kg, -1);
            // Deduct new selection stock
            await adjustGreenbeanStock(type, id, targetWeight, 1);

            const record = {
                id: editId,
                day: new Date(planDate).toLocaleDateString('en-US', { weekday: 'long' }),
                plan_date: planDate,
                machine_id: parseInt(machineSelect.value) || null,
                coffee_type: type,
                single_coffee_id: type === 'Single' ? id : null,
                blend_recipe_id: type === 'Blend' ? id : null,
                target_roasted_kg: targetWeight,
                fulfilled_roasted_kg: existingPlan.fulfilled_roasted_kg || 0.0,
                status: existingPlan.status || 'Pending'
            };

            await saveData('roasting_plans', record);
        } else {
            for (const r of rows) {
                const selectVal = r.querySelector('.plan-coffee-select').value;
                const targetWeight = parseFloat(r.querySelector('.plan-target-weight').value);
                const [type, idStr] = selectVal.split('-');
                const id = parseInt(idStr);

                // Deduct stock in DB
                await adjustGreenbeanStock(type, id, targetWeight, 1);

                const record = {
                    day: new Date(planDate).toLocaleDateString('en-US', { weekday: 'long' }),
                    plan_date: planDate,
                    machine_id: parseInt(machineSelect.value) || null,
                    coffee_type: type,
                    single_coffee_id: type === 'Single' ? id : null,
                    blend_recipe_id: type === 'Blend' ? id : null,
                    target_roasted_kg: targetWeight,
                    fulfilled_roasted_kg: 0.0,
                    status: 'Pending'
                };

                await saveData('roasting_plans', record);
            }
        }

        modalContainer.classList.add('hidden');
        loadRoastingPlans();
        scheduleDashboardRefresh();
        loadGreenbeanInventory();
    });
}

// Complete Plan shortcut
async function completePlan(id) {
    const { data: plans } = await fetchData('roasting_plans');
    const plan = plans.find(p => p.id === id);
    if (!plan) return;

    // Direct user to Log Batch with filled data!
    openRoastBatchModal(plan);
}

async function adjustGreenbeanStock(type, id, targetRoastedKg, sign = 1) {
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: ingredients } = await fetchData('blend_ingredients');
    
    const requiredTotalGb = (targetRoastedKg / 0.85) * sign;
    
    if (type === 'Single') {
        const gb = greenbeans.find(g => g.id === id);
        if (gb) {
            gb.stock_kg = Math.max(0, parseFloat(gb.stock_kg || 0) - requiredTotalGb);
            await saveData('green_coffee', gb);
        }
    } else {
        const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === id);
        for (const ing of recipeIngs) {
            const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
            if (gb) {
                const ratio = parseFloat(ing.percentage) / 100;
                const requiredIngGb = requiredTotalGb * ratio;
                gb.stock_kg = Math.max(0, parseFloat(gb.stock_kg || 0) - requiredIngGb);
                await saveData('green_coffee', gb);
            }
        }
    }
}

async function deletePlan(id) {
    if (await showWarningModal("Are you sure you want to delete this scheduled roast plan?")) {
        const { data: plans } = await fetchData('roasting_plans');
        const plan = plans.find(p => p.id === id);
        if (plan) {
            await adjustGreenbeanStock(plan.coffee_type, plan.single_coffee_id || plan.blend_recipe_id, plan.target_roasted_kg, -1);
        }
        const { error } = await deleteData('roasting_plans', id);
        if (error) await showWarningModal(error.message, false);
        else {
            loadRoastingPlans();
            scheduleDashboardRefresh();
            loadGreenbeanInventory();
        }
    }
}

async function deleteBatch(id) {
    if (await showWarningModal("Are you sure you want to delete this roasting batch log? This will refund the green coffee stock and remove it from bulk available logs.")) {
        const { data: batches } = await fetchData('roast_batches');
        const { data: greenbeans } = await fetchData('green_coffee');
        const batch = batches.find(b => b.id === id);
        
        if (batch) {
            // Restore green coffee stocks
            if (batch.coffee_type === 'Single') {
                const gb = greenbeans.find(g => g.id === batch.single_coffee_id);
                if (gb) {
                    gb.stock_kg = parseFloat(gb.stock_kg || 0) + parseFloat(batch.input_weight_kg);
                    await saveData('green_coffee', gb);
                }
            } else {
                const { data: ingredients } = await fetchData('blend_ingredients');
                const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === batch.blend_recipe_id);
                for (const ing of recipeIngs) {
                    const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
                    if (gb) {
                        const req = (parseFloat(ing.percentage) / 100) * parseFloat(batch.input_weight_kg);
                        gb.stock_kg = parseFloat(gb.stock_kg || 0) + req;
                        await saveData('green_coffee', gb);
                    }
                }
            }

            // Refund/deduct from bulk_roasted_coffee if it was already approved/Success
            if (batch.qc_status === 'Success') {
                const { data: bulkList } = await fetchData('bulk_roasted_coffee');
                const bulkRec = bulkList.find(b => 
                    b.coffee_type === batch.coffee_type && 
                    (batch.coffee_type === 'Single' ? b.single_coffee_id === batch.single_coffee_id : b.blend_recipe_id === batch.blend_recipe_id)
                );
                if (bulkRec) {
                    bulkRec.bulk_available = Math.max(0, parseFloat(bulkRec.bulk_available) - parseFloat(batch.output_weight_kg));
                    await saveData('bulk_roasted_coffee', bulkRec);
                }
            }
        }
        
        const { error } = await deleteData('roast_batches', id);
        if (error) {
            await showWarningModal(window.t("alert_delete_failed").replace("{msg}", error.message), false);
        } else {
            loadRoastingBatches();
            loadGreenbeanInventory();
            scheduleDashboardRefresh();
        }
    }
}

async function addWeightToBulkRoastedCoffee(type, singleId, blendId, coffeeName, weightKg) {
    const { data: bulkList } = await fetchData('bulk_roasted_coffee');
    const existingBulk = bulkList.find(b => 
        b.coffee_type === type && 
        (type === 'Single' ? b.single_coffee_id === singleId : b.blend_recipe_id === blendId)
    );
    
    if (existingBulk) {
        existingBulk.bulk_available = parseFloat(existingBulk.bulk_available || 0) + weightKg;
        await saveData('bulk_roasted_coffee', existingBulk);
    } else {
        const newBulk = {
            coffee_type: type,
            single_coffee_id: type === 'Single' ? singleId : null,
            blend_recipe_id: type === 'Blend' ? blendId : null,
            coffee_name: coffeeName,
            bulk_available: weightKg
        };
        await saveData('bulk_roasted_coffee', newBulk);
    }
}

async function approveTestBatch(id) {
    if (await showWarningModal("Are you sure you want to approve this test batch? Doing so will transfer its output weight to the bulk roasted inventory, making it available for packing.")) {
        const { data: batches } = await fetchData('roast_batches');
        const batch = batches.find(b => b.id === id);
        if (batch) {
            batch.qc_status = 'Success';
            batch.remaining_bulk_kg = parseFloat(batch.output_weight_kg || 0);
            await saveData('roast_batches', batch);

            // Fetch coffee name
            const { data: greenbeans } = await fetchData('green_coffee');
            const { data: recipes } = await fetchData('blend_recipes');
            let coffeeName = '';
            if (batch.coffee_type === 'Single') {
                const gb = greenbeans.find(g => g.id === batch.single_coffee_id);
                coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
            } else {
                const r = recipes.find(rec => rec.id === batch.blend_recipe_id);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
            }

            await addWeightToBulkRoastedCoffee(batch.coffee_type, batch.single_coffee_id, batch.blend_recipe_id, coffeeName, parseFloat(batch.output_weight_kg));

            loadRoastingBatches();
            scheduleDashboardRefresh();
        }
    }
}

// Log roasting batch
document.getElementById('btn-add-batch').addEventListener('click', () => {
    openRoastBatchModal();
});

async function openRoastBatchModal(plan = null, editId = null) {
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
    const { data: ingredients } = await fetchData('blend_ingredients');
    const { data: machines } = await fetchData('machines');
    const { data: batches } = await fetchData('roast_batches');

    let existingBatch = null;
    if (editId) {
        existingBatch = batches.find(b => b.id === editId);
    }

    const gbSelectOpts = greenbeans.map(g => `<option value="Single-${g.id}">${g.name}</option>`).join('');
    const recSelectOpts = recipes.map(r => `<option value="Blend-${r.id}">${r.name}</option>`).join('');
    const machOpts = machines.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    // Check if this is a test batch being edited (for conditional Approved field)
    const isEditingTestBatch = !!(editId && existingBatch && existingBatch.roast_type === 'Test');
    const approvedChecked = isEditingTestBatch && existingBatch.qc_status === 'Success';

    const html = `
        <form id="modal-batch-form">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Batch Code</label>
                    <input type="text" id="m-bat-code" class="form-control" value="" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Date</label>
                    <input type="date" id="m-bat-date" class="form-control" required>
                </div>
            </div>

            <div class="form-row" style="margin-top: 15px;">
                <div class="form-group">
                    <label class="form-label">Roaster Machine</label>
                    <select id="m-bat-machine" class="form-control" required>
                        ${machOpts}
                    </select>
                </div>
                <div class="form-group" style="display: flex; align-items: center; flex-direction: column; justify-content: flex-end; padding-bottom: 2px;">
                    <label style="width:100%; font-size:0.82rem; font-weight:600; color:var(--text-muted); margin-bottom:8px;">Options</label>
                    <div style="display:flex; gap:20px; align-items:center; width:100%;">
                        <label class="checkbox-container" style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; color: var(--text-main); white-space:nowrap;">
                            <input type="checkbox" id="m-bat-test" style="width: 18px; height: 18px; cursor: pointer;">
                            Batch Test
                        </label>
                        ${isEditingTestBatch ? `
                        <label class="checkbox-container" id="m-bat-approved-wrap" style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; color: var(--success); white-space:nowrap;">
                            <input type="checkbox" id="m-bat-approved" style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--success);" ${approvedChecked ? 'checked' : ''}>
                            ✓ Approved
                        </label>` : ''}
                    </div>
                </div>
            </div>

            <div class="form-row" style="align-items: flex-end; gap: 15px; margin-top: 15px;">
                <div class="form-group" style="flex: 1; margin-bottom: 0;">
                    <label class="form-label">Coffee</label>
                    <select id="m-bat-coffee" class="form-control" required>
                        <option value="" disabled selected>-- Select Coffee --</option>
                        <optgroup label="Single Origin">
                            ${gbSelectOpts}
                        </optgroup>
                        <optgroup label="Blend Recipes">
                            ${recSelectOpts}
                        </optgroup>
                    </select>
                </div>
            </div>

            <div class="form-row" style="margin-top: 15px;">
                <div class="form-group">
                    <label class="form-label">Greenbean Weight (gram)</label>
                    <input type="number" step="1" id="m-bat-greenbean" class="form-control" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Roasted Weight (gram)</label>
                    <input type="number" step="1" id="m-bat-roasted" class="form-control" required>
                </div>
            </div>

            <div class="form-row" style="margin-top: 15px;">
                <div class="form-group" style="flex: 1;">
                    <label class="form-label">Depreciation (%)</label>
                    <input type="text" id="m-bat-depreciation" class="form-control" style="background:var(--border); font-weight:700; color:var(--warning);" readonly value="0.0%">
                </div>
            </div>

            <div class="form-group" style="margin-top: 15px;">
                <label class="form-label">Notes</label>
                <textarea id="m-bat-notes" class="form-control" rows="2" placeholder="First crack timings, end temperature, etc."></textarea>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 25px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">${editId ? 'Save Changes' : 'ROASTED!!'}</button>
            </div>
        </form>
    `;

    openModal(editId ? `Edit Roasting Batch Log` : (plan ? `Log Results for Scheduled Roast` : `Log Roasting Batch`), html);

    const batchCodeInput = document.getElementById('m-bat-code');
    const dateInput = document.getElementById('m-bat-date');
    const machineSelect = document.getElementById('m-bat-machine');
    const coffeeSelect = document.getElementById('m-bat-coffee');
    const testCheckbox = document.getElementById('m-bat-test');
    const approvedCheckbox = document.getElementById('m-bat-approved');
    const greenbeanWeightInput = document.getElementById('m-bat-greenbean');
    const roastedWeightInput = document.getElementById('m-bat-roasted');
    const depreciationInput = document.getElementById('m-bat-depreciation');

    const notesTextarea = document.getElementById('m-bat-notes');

    // Set today's date as default
    const todayStr = new Date().toISOString().split('T')[0];
    dateInput.value = todayStr;

    // Sequential code generation helper
    async function generateSequentialBatchCode(coffeeVal, machineId) {
        if (!coffeeVal || !machineId) return '';
        const [type, idStr] = coffeeVal.split('-');
        const id = parseInt(idStr);
        let coffeeCode = 'COF';
        if (type === 'Single') {
            const gb = greenbeans.find(g => g.id === id);
            if (gb) coffeeCode = gb.code || gb.name.slice(0, 3).toUpperCase();
        } else {
            const r = recipes.find(rec => rec.id === id);
            if (r) coffeeCode = r.code || r.name.slice(0, 3).toUpperCase();
        }
        
        const mach = machines.find(m => m.id === parseInt(machineId));
        const machineCode = mach ? (mach.code || mach.name.slice(0, 2).toUpperCase()) : 'M';
        
        let dateObj = new Date();
        if (dateInput.value) {
            const parts = dateInput.value.split('-');
            if (parts.length === 3) {
                // YYYY-MM-DD format from input type="date"
                dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
            }
        }
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const datePart = `${dd}${mm}`;
        
        let maxSeq = 0;
        const regex = /^([^-]+)-([A-Za-z0-9]+?)(\d{4})-(\d+)$/;

        batches.forEach(b => {
            if (b.batch_code) {
                const match = b.batch_code.match(regex);
                if (match) {
                    const bCoffee = match[1];
                    const bMach = match[2];
                    const bDate = match[3];
                    const bSeq = parseInt(match[4]);
                    
                    if (bCoffee === coffeeCode && bMach === machineCode && bDate === datePart) {
                        if (bSeq > maxSeq) {
                            maxSeq = bSeq;
                        }
                    }
                }
            }
        });
        
        const nextSeq = maxSeq + 1;
        return `${coffeeCode}-${machineCode}${datePart}-${nextSeq}`;
    }

    // Auto-calculate yield rate
    function calcDepreciation() {
        const gbW = parseFloat(greenbeanWeightInput.value) || 0;
        const roastW = parseFloat(roastedWeightInput.value) || 0;
        if (gbW > 0) {
            const dep = ((gbW - roastW) / gbW) * 100;
            depreciationInput.value = `${dep.toFixed(1)}%`;
        } else {
            depreciationInput.value = '0.0%';
        }
    }
    greenbeanWeightInput.addEventListener('input', () => {
        greenbeanWeightInput.dataset.userEdited = "true";
        calcDepreciation();
    });
    roastedWeightInput.addEventListener('input', calcDepreciation);

    async function updateGeneratedBatchCodeAndWeight() {
        if (editId) return; // Do not overwrite batch code in edit mode
        
        const coffeeVal = coffeeSelect.value;
        const machineId = machineSelect.value;
        
        if (coffeeVal && machineId) {
            const generatedCode = await generateSequentialBatchCode(coffeeVal, machineId);
            batchCodeInput.value = generatedCode;
            
            const mach = machines.find(m => m.id === parseInt(machineId));
            if (mach && !greenbeanWeightInput.dataset.userEdited) {
                greenbeanWeightInput.value = mach.ideal_batch_size_g || 5000;
                calcDepreciation();
            }
        }
    }

    machineSelect.addEventListener('change', updateGeneratedBatchCodeAndWeight);
    coffeeSelect.addEventListener('change', updateGeneratedBatchCodeAndWeight);
    dateInput.addEventListener('change', updateGeneratedBatchCodeAndWeight);

    // Prefill logic
    if (editId && existingBatch) {
        batchCodeInput.value = existingBatch.batch_code;
        // Prefill date from existing record, fallback to today
        dateInput.value = existingBatch.roast_date ? existingBatch.roast_date.split('T')[0] : todayStr;
        machineSelect.value = existingBatch.machine_id;
        coffeeSelect.value = `${existingBatch.coffee_type}-${existingBatch.single_coffee_id || existingBatch.blend_recipe_id}`;
        testCheckbox.checked = existingBatch.roast_type === 'Test';
        greenbeanWeightInput.value = (existingBatch.input_weight_kg * 1000).toFixed(0);
        roastedWeightInput.value = (existingBatch.output_weight_kg * 1000).toFixed(0);
        notesTextarea.value = existingBatch.notes || '';
        calcDepreciation();
    } else if (plan) {
        dateInput.value = todayStr;
        machineSelect.value = getCookie('last_machine_id') || machines[0]?.id || '';
        coffeeSelect.value = `${plan.coffee_type}-${plan.single_coffee_id || plan.blend_recipe_id}`;
        testCheckbox.checked = false;
        greenbeanWeightInput.value = ((plan.target_roasted_kg / 0.85) * 1000).toFixed(0);
        roastedWeightInput.value = (plan.target_roasted_kg * 1000).toFixed(0);
        notesTextarea.value = '';
        calcDepreciation();
        updateGeneratedBatchCodeAndWeight();
    } else {
        // Look up cookies
        const lastMachine = getCookie('last_machine_id');
        const lastCoffee = getCookie('last_coffee_val');
        
        dateInput.value = todayStr;
        
        if (lastMachine && machines.some(m => m.id === parseInt(lastMachine))) {
            machineSelect.value = lastMachine;
        } else if (machines[0]) {
            machineSelect.value = machines[0].id;
        }
        
        if (lastCoffee) {
            coffeeSelect.value = lastCoffee;
        }
        
        testCheckbox.checked = false;
        
        // Prefill ideal batch size
        const mach = machines.find(m => m.id === parseInt(machineSelect.value));
        if (mach) {
            greenbeanWeightInput.value = mach.ideal_batch_size_g || 5000;
        } else {
            greenbeanWeightInput.value = 5000;
        }
        
        roastedWeightInput.value = '';
        notesTextarea.value = '';
        calcDepreciation();
        updateGeneratedBatchCodeAndWeight();
    }

    // Submit handler
    document.getElementById('modal-batch-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const coffeeVal = coffeeSelect.value;
        const machineId = parseInt(machineSelect.value);
        const code = batchCodeInput.value;
        const roastDate = dateInput.value || todayStr;
        const isTest = testCheckbox.checked;
        const gbWeightG = parseFloat(greenbeanWeightInput.value);
        const roastedWeightG = parseFloat(roastedWeightInput.value);
        let qcStatus = 'Success';
        if (isTest) {
            // If editing a test batch, respect the approved checkbox state
            if (editId && existingBatch && existingBatch.roast_type === 'Test' && approvedCheckbox) {
                qcStatus = approvedCheckbox.checked ? 'Success' : 'Pending';
            } else {
                qcStatus = 'Pending';
            }
        }
        const notes = notesTextarea.value;

        const inputKg = gbWeightG / 1000;
        const outputKg = roastedWeightG / 1000;

        const [type, idStr] = coffeeVal.split('-');
        const coffeeId = parseInt(idStr);
        const singleId = type === 'Single' ? coffeeId : null;
        const blendId = type === 'Blend' ? coffeeId : null;

        // 1. Stock Verification (including refund of editing batch weights)
        const currentStocks = {};
        greenbeans.forEach(gb => {
            currentStocks[gb.id] = parseFloat(gb.stock_kg || 0);
        });

        if (editId && existingBatch) {
            // Add back old weights for checks
            if (existingBatch.coffee_type === 'Single') {
                currentStocks[existingBatch.single_coffee_id] += parseFloat(existingBatch.input_weight_kg);
            } else {
                const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === existingBatch.blend_recipe_id);
                recipeIngs.forEach(ing => {
                    const req = (parseFloat(ing.percentage) / 100) * parseFloat(existingBatch.input_weight_kg);
                    currentStocks[ing.green_coffee_id] += req;
                });
            }
        }

        // Verify sufficiency
        if (type === 'Single') {
            const avail = currentStocks[singleId] || 0;
            if (avail < inputKg) {
                const gb = greenbeans.find(g => g.id === singleId);
                alert(window.t("alert_insufficient_gb") + ` (${gb ? gb.name : 'Coffee'}: ${avail.toFixed(1)} kg / ${inputKg.toFixed(1)} kg)`);
                return;
            }
        } else {
            const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === blendId);
            let missingStock = false;
            let missingDetails = '';

            for (const ing of recipeIngs) {
                const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
                const req = (parseFloat(ing.percentage) / 100) * inputKg;
                const avail = currentStocks[ing.green_coffee_id] || 0;
                if (avail < req) {
                    missingStock = true;
                    missingDetails += `\n- ${gb ? gb.name : 'Ingredient'}: Need ${req.toFixed(1)}kg, only have ${avail.toFixed(1)}kg`;
                }
            }

            if (missingStock) {
                alert(window.t("alert_insufficient_gb") + `:${missingDetails}`);
                return;
            }
        }

        // 2. Adjust database greenbean inventory stocks
        if (editId && existingBatch) {
            // First refund old
            if (existingBatch.coffee_type === 'Single') {
                const gb = greenbeans.find(g => g.id === existingBatch.single_coffee_id);
                if (gb) {
                    gb.stock_kg = parseFloat(gb.stock_kg || 0) + parseFloat(existingBatch.input_weight_kg);
                    await saveData('green_coffee', gb);
                }
            } else {
                const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === existingBatch.blend_recipe_id);
                for (const ing of recipeIngs) {
                    const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
                    if (gb) {
                        const req = (parseFloat(ing.percentage) / 100) * parseFloat(existingBatch.input_weight_kg);
                        gb.stock_kg = parseFloat(gb.stock_kg || 0) + req;
                        await saveData('green_coffee', gb);
                    }
                }
            }
        }

        // Deduct new
        if (type === 'Single') {
            const gb = greenbeans.find(g => g.id === singleId);
            if (gb) {
                gb.stock_kg = parseFloat(gb.stock_kg || 0) - inputKg;
                await saveData('green_coffee', gb);
            }
        } else {
            const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === blendId);
            for (const ing of recipeIngs) {
                const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
                if (gb) {
                    const req = (parseFloat(ing.percentage) / 100) * inputKg;
                    gb.stock_kg = parseFloat(gb.stock_kg || 0) - req;
                    await saveData('green_coffee', gb);
                }
            }
        }

        // Save Cookies
        setCookie('last_machine_id', machineId.toString());
        setCookie('last_coffee_val', coffeeVal);

        // 3. Save Roast Batch Record
        const record = {
            batch_code: code,
            roast_date: roastDate,
            roast_type: isTest ? 'Test' : 'Regular',
            qc_status: qcStatus,
            coffee_type: type,
            single_coffee_id: singleId,
            blend_recipe_id: blendId,
            machine_id: machineId,
            roasting_plan_id: editId ? existingBatch.roasting_plan_id : (plan ? plan.id : null),
            input_weight_kg: inputKg,
            output_weight_kg: outputKg,
            yield_percentage: (outputKg / inputKg) * 100,
            remaining_bulk_kg: qcStatus === 'Success' ? outputKg : 0.0,
            roaster_operator: currentUser ? currentUser.name : 'Operator',
            notes: notes
        };

        if (editId) {
            record.id = editId;
        }

        const { data: savedBatch, error } = await saveData('roast_batches', record);
        if (error) {
            alert("Logging batch failed: " + error.message);
            return;
        }

        // 4. Update associated plan status (check if coffee AND machine match any active plan)
        const { data: plans } = await fetchData('roasting_plans');
        const matchingPlan = plans.find(p => 
            p.coffee_type === type && 
            (type === 'Single' ? p.single_coffee_id === singleId : p.blend_recipe_id === blendId) &&
            p.machine_id === machineId &&
            p.status !== 'Completed'
        );

        if (matchingPlan) {
            matchingPlan.fulfilled_roasted_kg = parseFloat(matchingPlan.fulfilled_roasted_kg || 0) + outputKg;
            if (parseFloat(matchingPlan.fulfilled_roasted_kg) >= parseFloat(matchingPlan.target_roasted_kg)) {
                matchingPlan.status = 'Completed';
            } else {
                matchingPlan.status = 'On Process';
            }
            await saveData('roasting_plans', matchingPlan);
        }

        // --- Bulk Roasted Coffee Sync ---
        // Determine previous qc_status (for edit mode)
        const prevQcStatus = (editId && existingBatch) ? existingBatch.qc_status : null;

        if (qcStatus === 'Success' && prevQcStatus !== 'Success') {
            // Transition: Pending → Success (or new Regular batch)
            // ADD weight to bulk roasted coffee
            let coffeeName = '';
            if (type === 'Single') {
                const gb = greenbeans.find(g => g.id === singleId);
                coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
            } else {
                const r = recipes.find(rec => rec.id === blendId);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
            }
            await addWeightToBulkRoastedCoffee(type, singleId, blendId, coffeeName, outputKg);

        } else if (prevQcStatus === 'Success' && qcStatus !== 'Success') {
            // Transition: Success → Pending  (approved checkbox unchecked)
            // SUBTRACT weight from bulk roasted coffee
            const { data: bulkList } = await fetchData('bulk_roasted_coffee');
            const existingBulk = bulkList.find(b =>
                b.coffee_type === existingBatch.coffee_type &&
                (existingBatch.coffee_type === 'Single'
                    ? b.single_coffee_id === existingBatch.single_coffee_id
                    : b.blend_recipe_id === existingBatch.blend_recipe_id)
            );
            if (existingBulk) {
                const prevOutputKg = parseFloat(existingBatch.output_weight_kg || 0);
                existingBulk.bulk_available = Math.max(0, parseFloat(existingBulk.bulk_available || 0) - prevOutputKg);
                await saveData('bulk_roasted_coffee', existingBulk);
            }

        }
        // else: Success → Success  → no change needed (already counted)


        // 5. If QC fails, log to waste inventory
        if (qcStatus === 'Failed') {
            const wasteRecord = {
                roast_batch_id: savedBatch.id,
                weight_kg: outputKg,
                discard_date: new Date().toISOString().split('T')[0],
                reason: `Failed QC inspection: ${notes}`
            };
            await saveData('waste_inventory', wasteRecord);
        }

        modalContainer.classList.add('hidden');
        loadRoastingSection();
        loadGreenbeanInventory();
        scheduleDashboardRefresh();
    });
}

async function printStickerLabel(id) {
    const { data: batches } = await fetchData('roast_batches');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
    const { data: machines } = await fetchData('machines');

    const batch = batches.find(b => b.id === id);
    if (!batch) return;

    let coffeeName = '';
    if (batch.coffee_type === 'Single') {
        const gb = greenbeans.find(g => g.id === batch.single_coffee_id);
        coffeeName = gb ? gb.name : 'Single Origin';
    } else {
        const r = recipes.find(rec => rec.id === batch.blend_recipe_id);
        coffeeName = r ? r.name : 'Blend Recipe';
    }

    const mach = machines.find(m => m.id === batch.machine_id);
    const machineName = mach ? mach.name : 'Unknown';

    // Settings fallback
    const width = companySettings.label_width || 50;
    const height = companySettings.label_height || 30;
    
    const showCode = companySettings.label_show_code !== false;
    const showCoffee = companySettings.label_show_coffee !== false;
    const showDate = companySettings.label_show_date !== false;
    const showMachine = companySettings.label_show_machine !== false;
    const showWeight = companySettings.label_show_weight !== false;
    const showDep = companySettings.label_show_dep !== false;
    const showOperator = companySettings.label_show_operator !== false;

    let fieldsHtml = '';
    if (showCode) fieldsHtml += `<div style="font-size:0.75rem; font-weight:bold; border-bottom:1px solid #000; padding-bottom:2px; margin-bottom:4px; font-family:monospace;">${batch.batch_code}</div>`;
    if (showCoffee) fieldsHtml += `<div style="margin-bottom:2px;"><strong>Coffee:</strong> ${coffeeName}</div>`;
    if (showDate) fieldsHtml += `<div style="margin-bottom:2px;"><strong>Date:</strong> ${batch.roast_date}</div>`;
    if (showMachine) fieldsHtml += `<div style="margin-bottom:2px;"><strong>Machine:</strong> ${machineName}</div>`;
    if (showWeight) fieldsHtml += `<div style="margin-bottom:2px;"><strong>Yield:</strong> ${(batch.output_weight_kg * 1000).toFixed(0)} g</div>`;
    if (showDep) fieldsHtml += `<div style="margin-bottom:2px;"><strong>Depreciation:</strong> ${(100 - batch.yield_percentage).toFixed(1)}%</div>`;
    if (showOperator) fieldsHtml += `<div style="margin-bottom:2px;"><strong>Operator:</strong> ${batch.roaster_operator}</div>`;

    const html = `
        <div style="display:flex; flex-direction:column; align-items:center; gap:20px; padding:10px;">
            <p style="color:var(--text-muted); font-size:0.85rem; text-align:center;">This is a print preview matching your active label configuration (${width}mm x ${height}mm).</p>
            
            <!-- Real-size container -->
            <div id="thermal-sticker-preview" style="
                width: ${width}mm; 
                height: ${height}mm; 
                background: #ffffff; 
                color: #000000; 
                border: 1px dashed #666; 
                border-radius: 2px;
                padding: 3mm;
                box-shadow: 0 4px 15px rgba(0,0,0,0.15);
                display: flex;
                flex-direction: column;
                justify-content: flex-start;
                font-family: 'Courier New', Courier, monospace;
                font-size: 0.65rem;
                line-height: 1.2;
                overflow: hidden;
                box-sizing: border-box;
            ">
                ${fieldsHtml}
            </div>

            <div style="display:flex; justify-content:flex-end; gap:12px; width:100%; border-top:1px solid var(--border); padding-top:15px; margin-top:10px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Close</button>
                <button type="button" class="btn btn-primary" id="btn-execute-label-print">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align:middle;"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Print Label
                </button>
            </div>
        </div>
    `;

    openModal('Label Print Preview', html);

    document.getElementById('btn-execute-label-print').addEventListener('click', () => {
        const printWin = window.open('', '', 'width=400,height=300');
        printWin.document.write(`
            <html>
            <head>
                <title>Print Label</title>
                <style>
                    body { margin:0; padding:0; display:flex; justify-content:center; align-items:center; height:100vh; background:#fff; }
                    .label { 
                        width: ${width}mm; 
                        height: ${height}mm; 
                        box-sizing: border-box; 
                        padding: 3mm; 
                        font-family: 'Courier New', Courier, monospace; 
                        font-size: 8pt; 
                        line-height: 1.2; 
                        color: #000;
                    }
                    @media print {
                        @page { size: ${width}mm ${height}mm; margin: 0; }
                        body { width: ${width}mm; height: ${height}mm; }
                    }
                </style>
            </head>
            <body>
                <div class="label">
                    ${fieldsHtml}
                </div>
                <script>
                    window.onload = function() { window.print(); window.close(); }
                </script>
            </body>
            </html>
        `);
        printWin.document.close();
        document.getElementById('btn-close-modal').click();
    });
}

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
                }
            });
        });
    }

    const { data: bulkList } = await fetchData('bulk_roasted_coffee');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
    
    const rowsContainer = document.getElementById('packing-sheet-rows');
    if (!rowsContainer) return;
    
    // Save current values if there are already rows to preserve user input on language change
    const savedValues = [];
    const rows = rowsContainer.querySelectorAll('.packing-sheet-row');
    rows.forEach(row => {
        const select = row.querySelector('.pack-coffee-select');
        const sizeSelect = row.querySelector('.pack-size-select');
        const qtyInput = row.querySelector('.pack-qty-input');
        if (select && sizeSelect && qtyInput) {
            savedValues.push({
                coffeeId: select.value,
                size: sizeSelect.value,
                qty: qtyInput.value
            });
        }
    });
    
    // Clear and rebuild rows with correct translation
    rowsContainer.innerHTML = '';
    
    if (savedValues.length === 0) {
        addPackingRow(bulkList, greenbeans, recipes);
    } else {
        savedValues.forEach(val => {
            addPackingRow(bulkList, greenbeans, recipes, val.coffeeId, val.size, val.qty);
        });
    }
    
    // Wire up Add Row button
    const btnAdd = document.getElementById('btn-add-packing-sheet-row');
    if (btnAdd) {
        btnAdd.onclick = (e) => {
            e.preventDefault();
            addPackingRow(bulkList, greenbeans, recipes);
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

async function loadPackingRequestsSection() {
    const { data: orders } = await fetchData('request_orders');
    const { data: orderItems } = await fetchData('request_order_items');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
    
    const tbody = document.getElementById('packing-requests-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    // Filter only orders in "Preparing" status
    const preparingOrders = (orders || []).filter(o => o.status === 'Preparing');
    
    if (preparingOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">${window.t ? window.t("msg_no_preparing") : "No preparing orders found."}</td></tr>`;
        return;
    }
    
    // Sort by order_date descending and secondary by ID descending
    preparingOrders.sort((a, b) => new Date(b.order_date) - new Date(a.order_date) || b.id - a.id);
    const limitedPreparingOrders = preparingOrders.slice(0, 50);
    
    let tbodyHtml = '';
    for (const order of limitedPreparingOrders) {
        const items = (orderItems || []).filter(i => i.request_order_id === order.id);
        
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
            
            const isReady = item.item_status === 'Ready for Handover';
            const allocated = item.quantity_allocated || 0;
            const pending = item.quantity_pending || 0;
            const totalReq = item.quantity_requested;
            
            // Only items that need to be packed show inputs
            const packHtml = isReady ? `
                <span style="color: var(--success); font-weight: bold; font-size: 0.8rem;">
                    <i class="lucide-check-circle" style="width:14px; height:14px; vertical-align: middle;"></i> ${window.t ? window.t("lbl_ready") : "Ready"}
                </span>
            ` : `
                <div style="display:flex; align-items:center; gap: 10px;">
                    <input type="number" class="form-control inp-prepared" min="0" max="${pending}" value="${item.quantity_prepared || 0}" style="width: 80px; padding: 4px 8px;" placeholder="Prep Qty">
                    <button class="btn btn-primary btn-sm btn-mark-ready" data-id="${item.id}" data-order="${order.id}">Ready</button>
                </div>
            `;
            
            itemsHtml += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.02); padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                    <div style="font-size: 0.85rem;">
                        <strong>${coffeeName}</strong> - ${item.bag_size_g}g<br/>
                        <span style="color: var(--text-secondary); font-size: 0.75rem;">
                            Requested: ${totalReq} | From Stock: ${allocated} | Pending Pack: <strong style="color: var(--danger);">${pending}</strong>
                        </span>
                    </div>
                    <div>
                        ${packHtml}
                    </div>
                </div>
            `;
        }
        itemsHtml += `</div>`;
        
        tbodyHtml += `
        <tr>
            <td style="vertical-align: top; padding-top: 12px;">
                ${order.order_date}<br/>
                <code>${order.order_number || '#ORD-'+order.id}</code>
            </td>
            <td style="vertical-align: top; padding-top: 12px;"><strong>${order.sales_name}</strong></td>
            <td style="vertical-align: top; padding-top: 12px;">${itemsHtml}</td>
        </tr>
        `;
    }
    tbody.innerHTML = tbodyHtml;
    
    // EVENT DELEGATION
    tbody.onclick = async function(e) {
        const btnReady = e.target.closest('.btn-mark-ready');
        if (btnReady) {
            const itemId = parseInt(btnReady.getAttribute('data-id'));
            const orderId = parseInt(btnReady.getAttribute('data-order'));
            const inp = btnReady.closest('div').querySelector('.inp-prepared');
            const qtyPrepared = parseInt(inp.value) || 0;
            
            await markOrderItemReady(orderId, itemId, qtyPrepared);
        }
    };
}

async function markOrderItemReady(orderId, itemId, qtyPrepared) {
    const { data: orderItems } = await fetchData('request_order_items');
    const item = orderItems.find(i => i.id === itemId);
    if (!item) return;
    
    const pending = item.quantity_pending || 0;
    
    if (qtyPrepared < pending) {
        if (!await showWarningModal(window.t ? window.t("msg_partial_pack_confirm") : "You have packed less than the pending amount. Mark this item as fully ready anyway?")) {
            return;
        }
    }
    
    item.quantity_prepared = qtyPrepared;
    item.item_status = 'Ready for Handover';
    await saveData('request_order_items', item);
    
    // Check if ALL items in the order are ready
    const { data: allItems } = await fetchData('request_order_items');
    const orderAllItems = allItems.filter(i => i.request_order_id === orderId);
    const allReady = orderAllItems.every(i => i.item_status === 'Ready for Handover');
    
    if (allReady) {
        const { data: orders } = await fetchData('request_orders');
        const order = orders.find(o => o.id === orderId);
        if (order) {
            order.status = 'Completed';
            await saveData('request_orders', order);
            alert(window.t ? window.t("alert_order_completed") : "All items packed! Order is now Ready for Handover.");
        }
    }
    
    loadPackingRequestsSection();
}

function addPackingRow(bulkList, greenbeans, recipes, selectedCoffeeId = null, selectedSize = null, selectedQty = null) {
    const rowsContainer = document.getElementById('packing-sheet-rows');
    if (!rowsContainer) return;
    
    let singleHtml = '';
    (greenbeans || []).forEach(gb => {
        const bulkItem = (bulkList || []).find(b => b.coffee_type === 'Single' && b.single_coffee_id === gb.id);
        const stock = bulkItem ? parseFloat(bulkItem.bulk_available) : 0;
        const val = `Single-${gb.id}`;
        singleHtml += `
            <option value="${val}" ${selectedCoffeeId && selectedCoffeeId.toString() === val ? 'selected' : ''}>
                ${gb.name} (${window.t("lbl_stock")}: ${stock.toFixed(2)} kg)
            </option>
        `;
    });

    let blendHtml = '';
    (recipes || []).forEach(r => {
        const bulkItem = (bulkList || []).find(b => b.coffee_type === 'Blend' && b.blend_recipe_id === r.id);
        const stock = bulkItem ? parseFloat(bulkItem.bulk_available) : 0;
        const val = `Blend-${r.id}`;
        blendHtml += `
            <option value="${val}" ${selectedCoffeeId && selectedCoffeeId.toString() === val ? 'selected' : ''}>
                ${r.name} (${window.t("lbl_stock")}: ${stock.toFixed(2)} kg)
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
    rowDiv.style.cssText = 'display: flex; gap: 16px; align-items: center; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; position: relative; flex-wrap: wrap; margin-bottom: 8px;';
    
    rowDiv.innerHTML = `
        <!-- Coffee Selector -->
        <div class="form-group" style="flex: 2; min-width: 250px; margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.85rem; margin-bottom: 4px; font-weight: 600;" data-i18n="col_p_name">${window.t("col_p_name")}</label>
            <select class="form-control pack-coffee-select" style="width: 100%;" required>
                ${optionsHtml}
            </select>
        </div>
        
        <!-- Size Selector -->
        <div class="form-group" style="flex: 1; min-width: 120px; margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.85rem; margin-bottom: 4px; font-weight: 600;" data-i18n="lbl_size_fixed">${window.t("lbl_size_fixed")}</label>
            <select class="form-control pack-size-select" style="width: 100%;" required>
                <option value="250" ${selectedSize && selectedSize.toString() === '250' ? 'selected' : ''}>250g</option>
                <option value="500" ${selectedSize && selectedSize.toString() === '500' ? 'selected' : ''}>500g</option>
                <option value="1000" ${selectedSize && selectedSize.toString() === '1000' ? 'selected' : ''}>1000g</option>
            </select>
        </div>
        
        <!-- Quantity Input -->
        <div class="form-group" style="flex: 1; min-width: 120px; margin-bottom: 0;">
            <label class="form-label" style="font-size: 0.85rem; margin-bottom: 4px; font-weight: 600;" data-i18n="lbl_qty_bags">${window.t("lbl_qty_bags")}</label>
            <input type="number" class="form-control pack-qty-input" value="${selectedQty || 1}" min="1" required style="width: 100%;">
        </div>
        
        <!-- Delete Button -->
        <button type="button" class="btn btn-danger btn-sm btn-remove-pack-row" style="margin-top: 20px; padding: 8px 12px; display: flex; align-items: center; justify-content: center; height: 38px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
        
        <!-- Warning Bubble Container -->
        <div class="warning-bubble hidden" style="width: 100%; background: rgba(234, 88, 12, 0.15); border: 1px solid #ea580c; color: #ea580c; padding: 8px 12px; border-radius: 6px; font-size: 0.8rem; margin-top: 10px; display: flex; align-items: center; gap: 6px; font-weight: 500;">
            <!-- Warning will be placed here dynamically -->
        </div>
    `;
    
    rowsContainer.appendChild(rowDiv);
    
    // Delete handler
    const btnDel = rowDiv.querySelector('.btn-remove-pack-row');
    btnDel.onclick = () => {
        if (rowsContainer.children.length > 1) {
            rowDiv.remove();
            validatePackingStock(bulkList, greenbeans, recipes);
        } else {
            alert(window.t("msg_min_one_coffee"));
        }
    };
    
    // Live validation
    rowDiv.querySelector('.pack-coffee-select').onchange = () => validatePackingStock(bulkList, greenbeans, recipes);
    rowDiv.querySelector('.pack-size-select').onchange = () => validatePackingStock(bulkList, greenbeans, recipes);
    rowDiv.querySelector('.pack-qty-input').oninput = () => validatePackingStock(bulkList, greenbeans, recipes);
    
    validatePackingStock(bulkList, greenbeans, recipes);
}

function validatePackingStock(bulkList, greenbeans, recipes) {
    const rows = document.querySelectorAll('.packing-sheet-row');
    const coffeeTotals = {};
    
    rows.forEach(row => {
        const select = row.querySelector('.pack-coffee-select');
        const sizeSelect = row.querySelector('.pack-size-select');
        const qtyInput = row.querySelector('.pack-qty-input');
        
        if (!select || !sizeSelect || !qtyInput) return;
        
        const coffeeKey = select.value;
        const sizeG = parseFloat(sizeSelect.value) || 0;
        const qty = parseFloat(qtyInput.value) || 0;
        const kg = (sizeG * qty) / 1000;
        
        if (!coffeeTotals[coffeeKey]) {
            coffeeTotals[coffeeKey] = 0;
        }
        coffeeTotals[coffeeKey] += kg;
    });
    
    rows.forEach(row => {
        const select = row.querySelector('.pack-coffee-select');
        const bubble = row.querySelector('.warning-bubble');
        if (!select || !bubble) return;
        
        const coffeeKey = select.value;
        const [type, idStr] = coffeeKey.split('-');
        const id = parseInt(idStr);
        
        const bulkItem = (bulkList || []).find(b => {
            if (type === 'Single') {
                return b.coffee_type === 'Single' && b.single_coffee_id === id;
            } else {
                return b.coffee_type === 'Blend' && b.blend_recipe_id === id;
            }
        });
        
        const avail = bulkItem ? (parseFloat(bulkItem.bulk_available) || 0) : 0;
        const totalNeeded = coffeeTotals[coffeeKey] || 0;
        
        if (totalNeeded > avail) {
            bubble.classList.remove('hidden');
            let template = window.t("msg_warn_exceed") || "Required quantity {totalNeeded} kg exceeds available stock {avail} kg.";
            template = template.replace("{totalNeeded}", totalNeeded.toFixed(2)).replace("{avail}", avail.toFixed(2));
            bubble.innerHTML = template;
        } else {
            bubble.classList.add('hidden');
        }
    });
}

async function submitPackingSheet() {
    const { data: bulkList } = await fetchData('bulk_roasted_coffee');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
    const { data: packedList } = await fetchData('packed_coffee');
    
    const rows = document.querySelectorAll('.packing-sheet-row');
    if (rows.length === 0) return;
    
    const bulkUpdates = {};
    const resolvedItems = {};

    (bulkList || []).forEach(item => {
        const key = item.coffee_type === 'Single' 
            ? `Single-${item.single_coffee_id}` 
            : `Blend-${item.blend_recipe_id}`;
        bulkUpdates[key] = parseFloat(item.bulk_available) || 0;
        resolvedItems[key] = item;
    });
    
    let hasExceeded = false;
    let exceededInfo = [];
    
    const additions = {};
    
    rows.forEach(row => {
        const select = row.querySelector('.pack-coffee-select');
        const sizeSelect = row.querySelector('.pack-size-select');
        const qtyInput = row.querySelector('.pack-qty-input');
        
        const coffeeKey = select.value;
        const [type, idStr] = coffeeKey.split('-');
        const id = parseInt(idStr);
        
        let bulkItem = resolvedItems[coffeeKey];
        if (!bulkItem) {
            let coffeeName = '';
            if (type === 'Single') {
                const gb = greenbeans.find(g => g.id === id);
                coffeeName = gb ? gb.name : 'Single Origin';
            } else {
                const r = recipes.find(rec => rec.id === id);
                coffeeName = r ? r.name : 'Blend Recipe';
            }
            
            bulkItem = {
                coffee_type: type,
                single_coffee_id: type === 'Single' ? id : null,
                blend_recipe_id: type === 'Blend' ? id : null,
                coffee_name: coffeeName,
                bulk_available: 0
            };
            resolvedItems[coffeeKey] = bulkItem;
            bulkUpdates[coffeeKey] = 0;
        }
        
        const sizeG = parseInt(sizeSelect.value);
        const qty = parseInt(qtyInput.value) || 0;
        const kgNeeded = (sizeG * qty) / 1000;
        
        bulkUpdates[coffeeKey] -= kgNeeded;
        
        const key = `${bulkItem.coffee_name}|${sizeG}`;
        if (!additions[key]) {
            additions[key] = {
                coffee_name: bulkItem.coffee_name,
                coffee_type: type,
                single_coffee_id: type === 'Single' ? id : null,
                blend_recipe_id: type === 'Blend' ? id : null,
                bag_size_g: sizeG,
                quantity: 0
            };
        }
        additions[key].quantity += qty;
    });
    
    for (const coffeeKey in bulkUpdates) {
        if (bulkUpdates[coffeeKey] < 0) {
            hasExceeded = true;
            const bulkItem = resolvedItems[coffeeKey];
            const originalStock = resolvedItems[coffeeKey].id 
                ? (bulkList.find(b => b.id === resolvedItems[coffeeKey].id).bulk_available) 
                : 0;
            const neededVal = (parseFloat(originalStock) - bulkUpdates[coffeeKey]).toFixed(2);
            exceededInfo.push(`- ${bulkItem.coffee_name}: ${window.t("lbl_needs")} ${neededVal} kg (${window.t("lbl_stock")}: ${parseFloat(originalStock).toFixed(2)} kg)`);
        }
    }
    
    if (hasExceeded) {
        let confirmText = window.t("msg_confirm_exceed");
        confirmText = confirmText.replace("{info}", exceededInfo.join('\n'));
        const proceed = await showWarningModal(confirmText);
        if (!proceed) return;
    }
    
    // Save bulk updates
    for (const coffeeKey in bulkUpdates) {
        const bulkItem = resolvedItems[coffeeKey];
        bulkItem.bulk_available = bulkUpdates[coffeeKey];
        const { data: savedRec } = await saveData('bulk_roasted_coffee', bulkItem);
        if (savedRec && savedRec.id) {
            bulkItem.id = savedRec.id;
        }
    }
    
    // Save packed_coffee updates
    for (const key in additions) {
        const add = additions[key];
        const existing = packedList.find(p => 
            !p.roast_batch_id && 
            p.custom_coffee_name === add.coffee_name && 
            p.bag_size_g === add.bag_size_g
        );
        
        if (existing) {
            existing.quantity = parseInt(existing.quantity) + add.quantity;
            await saveData('packed_coffee', existing);
        } else {
            const newPacked = {
                roast_batch_id: null,
                custom_coffee_name: add.coffee_name,
                bag_size_g: add.bag_size_g,
                quantity: add.quantity,
                selling_price: 12.00
            };
            await saveData('packed_coffee', newPacked);
        }
    }
    
    await showWarningModal(window.t("msg_pack_saved") || "Packing saved successfully.", false);
    
    // Clear container
    const rowsContainer = document.getElementById('packing-sheet-rows');
    if (rowsContainer) {
        rowsContainer.innerHTML = '';
    }
    
    await loadPackingSection();
    scheduleDashboardRefresh();
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
    const { data: orders } = await fetchData('request_orders');
    const { data: orderItems } = await fetchData('request_order_items');
    const { data: packedGoods } = await fetchData('packed_coffee');
    const { data: roastBatches } = await fetchData('roast_batches');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
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
        pageInfo.textContent = `Show ${totalItems === 0 ? 0 : startIndex + 1} - ${endIndex} of ${totalItems}`;
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
                    <button class="btn btn-primary btn-sm btn-edit-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>
                    <button class="btn btn-danger btn-sm btn-delete-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Delete</button>
                </div>
            `;
        } else if (order.status === 'Cancelled') {
            actionColumnContent = `
                <span style="color: #b91c1c; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                    Cancelled
                </span>
            `;
        } else {
            const allItemsReady = items.every(item => item.item_status === 'Ready for Handover');
            if (allItemsReady) {
                const labelCompleted = window.t ? window.t("status_completed") || "Completed" : "Completed";
                actionColumnContent = `
                    <span style="color: #15803d; font-weight: 700; font-size: 0.8rem; padding: 4px 10px; background: #dcfce7; border: 1px solid #bbf7d0; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px;">
                        <i class="lucide-check-circle" style="width:14px; height:14px;"></i> ${labelCompleted}
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
            
            const isReady = item.item_status === 'Ready for Handover';
            
            const statusBadge = isReady ? `
                <span style="color: var(--success); font-weight: bold; font-size: 0.8rem; display:inline-flex; align-items:center; gap:4px;">
                    <i class="lucide-check-circle" style="width:14px; height:14px; vertical-align: middle;"></i> ${window.t ? window.t("lbl_ready") : "Ready"}
                </span>
            ` : `
                <span style="color: var(--warning); font-weight: bold; font-size: 0.8rem; display:inline-flex; align-items:center; gap:4px;">
                    <span style="display:inline-block; width:6px; height:6px; background:var(--warning); border-radius:50%;"></span> ${item.item_status || 'Preparing'}
                </span>
            `;
            
            itemsHtml += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.02); padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                    <div style="font-size: 0.85rem;">
                        <strong>${coffeeName}</strong> - ${item.bag_size_g}g<br/>
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
            <td><strong>${order.sales_name}</strong></td>
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
    const { data: orders } = await fetchData('request_orders');
    const { data: orderItems } = await fetchData('request_order_items');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
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
        pageInfo.textContent = `Show ${totalItems === 0 ? 0 : startIndex + 1} - ${endIndex} of ${totalItems}`;
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
        const itemsSummary = items.map(item => {
            let coffeeName = '';
            if (item.coffee_type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === item.single_coffee_id);
                coffeeName = gb ? gb.name : 'Single';
            } else {
                const r = (recipes || []).find(rec => rec.id === item.blend_recipe_id);
                coffeeName = r ? r.name : 'Blend';
            }
            return `${coffeeName} (${item.bag_size_g}g): ${item.quantity_requested} bags`;
        }).join(', ');

        const badgeColor = order.status === 'Completed' ? 'rgba(16,185,129,0.15)' :
                           order.status === 'Preparing' ? 'rgba(139,92,246,0.15)' :
                           order.status === 'Approved' ? 'rgba(59,130,246,0.15)' :
                           order.status === 'Cancelled' ? 'rgba(239,68,68,0.15)' :
                           'rgba(245,158,11,0.15)';
                           
         const textCol = order.status === 'Completed' ? 'var(--success)' :
                         order.status === 'Preparing' ? '#8b5cf6' :
                         order.status === 'Approved' ? 'var(--info)' :
                         order.status === 'Cancelled' ? 'var(--danger)' :
                         'var(--warning)';

        const isPending = order.status === 'Pending Approval';
        const approveBtn = isPending ? `<button class="btn btn-success btn-sm btn-approve-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Approve</button>` : '';
        const canLeaderEdit = order.status === 'Pending Approval' || order.status === 'Preparing';
        const editBtn = canLeaderEdit ? `<button class="btn btn-primary btn-sm btn-edit-order" data-id="${order.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>` : '';

        tbodyHtml += `
        <tr>
            <td><code>${order.order_number || '#ORD-'+order.id}</code></td>
            <td><strong>${order.sales_name}</strong></td>
            <td>${order.order_date}</td>
            <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${itemsSummary}">${itemsSummary || '-'}</td>
            <td>
                <span style="font-size:0.75rem; padding: 2px 8px; border-radius: 9999px; font-weight:700; background: ${badgeColor}; color: ${textCol}; display:inline-block; width:fit-content;">${order.status}</span>
            </td>
            <td>
                ${approveBtn}
                ${editBtn}
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
    };

    applyFiltersForTable(document.querySelector('#tab-dispatch-approval table'));
    if (typeof window.translatePage === 'function') window.translatePage();
}

// Approve sales request order and allocate packed stock
async function approveSalesOrder(orderId) {
    const { data: orders } = await fetchData('request_orders');
    const { data: orderItems } = await fetchData('request_order_items');
    const { data: packedGoods } = await fetchData('packed_coffee');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
    const { data: roastBatches } = await fetchData('roast_batches');
    
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const items = orderItems.filter(i => i.request_order_id === orderId);
    
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
            const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
            return batch && batch.coffee_type === type && (batch.single_coffee_id === coffeeId || batch.blend_recipe_id === coffeeId);
        });
        const szItems = matchingPacked.filter(p => parseInt(p.bag_size_g) === size);
        const packedStock = szItems.reduce((acc, p) => acc + (parseInt(p.quantity) || 0), 0);
        
        let fulfillQty = Math.min(packedStock, item.quantity_requested);
        let prodQty = item.quantity_requested > packedStock ? (item.quantity_requested - packedStock) : 0;
        
        htmlContent += `
            <div class="approval-item-row" data-id="${item.id}" style="background: rgba(0,0,0,0.02); border: 1px solid var(--border-color); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <div style="font-weight: bold; margin-bottom: 8px; color: var(--text-primary);">${coffeeName} - ${size}g</div>
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
    
    document.getElementById('modal-approve-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const rows = document.querySelectorAll('.approval-item-row');
        
        for (const r of rows) {
            const itemId = parseInt(r.getAttribute('data-id'));
            const fQty = parseInt(r.querySelector('.inp-fulfill').value);
            const pQty = parseInt(r.querySelector('.inp-prod').value);
            
            const item = orderItems.find(i => i.id === itemId);
            if (!item) continue;
            
            item.quantity_allocated = fQty;
            item.quantity_pending = pQty;
            item.item_status = pQty > 0 ? 'Pending Roast' : 'Packing Preparing';
            
            await saveData('request_order_items', item);
            
            // Deduct packed stock
            if (fQty > 0) {
                const type = item.coffee_type;
                const coffeeId = type === 'Single' ? item.single_coffee_id : item.blend_recipe_id;
                const matchingPacked = (packedGoods || []).filter(p => {
                    const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
                    return batch && batch.coffee_type === type && (batch.single_coffee_id === coffeeId || batch.blend_recipe_id === coffeeId);
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
            
            // Inject to Roast Plan
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
                    target_roasted_kg: parseFloat(targetRoast.toFixed(2)),
                    fulfilled_roasted_kg: 0.0,
                    status: 'Pending',
                    order_ref: order.order_number || `#ORD-${order.id}` // linking info
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

// Add// Add sales request modal
document.getElementById('btn-create-request').addEventListener('click', async () => {
    await openSalesRequestModal();
});

async function openSalesRequestModal(orderId = null) {
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
    const { data: ingredients } = await fetchData('blend_ingredients');
    const { data: agents } = await fetchData('sales_agents');
    const { data: requestOrders } = await fetchData('request_orders');
    const { data: requestOrderItems } = await fetchData('request_order_items');
    const { data: packed } = await fetchData('packed_coffee');
    const { data: roastBatches } = await fetchData('roast_batches');

    let existingOrder = null;
    let existingItems = [];
    if (orderId !== null) {
        existingOrder = (requestOrders || []).find(o => o.id === orderId);
        existingItems = (requestOrderItems || []).filter(i => i.request_order_id === orderId);
    }

    // ── Layer 1: Build packed stock snapshot (minus committed orders) ────────
    const originalPackedStocks = {};
    (packed || []).forEach(p => {
        if (p.roast_batch_id) {
            const batch = (roastBatches || []).find(b => b.id === p.roast_batch_id);
            if (batch) {
                const cId = batch.coffee_type === 'Single' ? batch.single_coffee_id : batch.blend_recipe_id;
                const key = `${batch.coffee_type}-${cId}-${p.bag_size_g}`;
                originalPackedStocks[key] = (originalPackedStocks[key] || 0) + (parseInt(p.quantity) || 0);
            }
        }
        if (!p.roast_batch_id && p.custom_coffee_name) {
            const key = `custom-${p.custom_coffee_name}-${p.bag_size_g}`;
            originalPackedStocks[key] = (originalPackedStocks[key] || 0) + (parseInt(p.quantity) || 0);
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
                <button type="submit" class="btn btn-primary" data-i18n="btn_submit_req">Submit Request</button>
            </div>
        </form>
    `;

    const titleStr = orderId !== null ? (window.t ? window.t('modal_edit_req') : 'Edit Sales Request Order') : (window.t ? window.t('modal_submit_req') : 'Submit Sales Request Order');
    openModal(titleStr, html, '650px');

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
                const sizeEl = currentRow.querySelector('.item-size');
                const qtyEl = currentRow.querySelector('.item-qty');
                const infoBox = currentRow.querySelector('.item-info-box');
                const warnDiv = currentRow.querySelector('.item-qty-warn');

                if (!sel.value) { infoBox.style.display = 'none'; return; }

                const [type, idStr] = sel.value.split('-');
                const coffeeId = parseInt(idStr);
                const sizeG = parseInt(sizeEl.value);
                const currentQty = parseInt(qtyEl.value) || 0;

                // 1. Packed Stock calculation (Layer 2)
                let stockBreakdown = '';
                let currentSizeAvailPacked = 0;

                [250, 500, 1000].forEach(sz => {
                    const stockKey = `${sel.value}-${sz}`;
                    const totalAllocForThisSize = totalAlloc[stockKey] || 0;
                    
                    const isSelectedSize = (sz === sizeG);
                    const allocByThisRow = isSelectedSize ? currentQty : 0;
                    
                    const otherAlloc = Math.max(0, totalAllocForThisSize - allocByThisRow);
                    
                    const packKey = `${type}-${coffeeId}-${sz}`;
                    const totalPacked = originalPackedStocks[packKey] || 0;
                    const availPacked = Math.max(0, totalPacked - otherAlloc);
                    
                    if (isSelectedSize) {
                        currentSizeAvailPacked = availPacked;
                    }

                    const highlight = isSelectedSize ? `font-weight:700; color: var(--text-primary);` : '';
                    stockBreakdown += `<span style="margin-right: 8px; ${highlight}">${sz}g: <strong>${availPacked}</strong></span>`;
                });

                // 2. Potential production calculation (Layer 3)
                const gbAllocFromOtherRows = getGreenbeanAllocations(currentRow);
                const potentialBags = getPotentialBags(type, coffeeId, sizeG, gbAllocFromOtherRows);

                // Build UI
                const packedLbl = window.t ? window.t('lbl_packed_stock') : 'Available Packed Stock';
                const potLbl = window.t ? window.t('lbl_potential_prod') : 'Potential Prod';
                const bagsLbl = window.t ? window.t('lbl_bags') : 'bags';

                infoBox.innerHTML = `
                    <div style="margin-bottom: 4px;"><strong>${packedLbl}:</strong> ${stockBreakdown}</div>
                    <div><strong style="color: var(--primary);">${potLbl} (${sizeG}g):</strong> ~${potentialBags} ${bagsLbl}</div>
                `;

                // Store for submit validation
                currentRow.dataset.packedStock = currentSizeAvailPacked;
                currentRow.dataset.potentialBags = potentialBags;

                // Warning tooltip
                if (warnDiv) {
                    if (currentQty > currentSizeAvailPacked && currentQty <= currentSizeAvailPacked + potentialBags) {
                        warnDiv.textContent = `⚠️ Only ${currentSizeAvailPacked} packed, ${currentQty - currentSizeAvailPacked} will go to production queue.`;
                        warnDiv.style.display = 'block';
                        warnDiv.style.background = 'var(--warning)';
                        warnDiv.style.color = '#000';
                    } else if (currentQty > currentSizeAvailPacked + potentialBags) {
                        warnDiv.textContent = `⛔ Exceeds max production capacity!`;
                        warnDiv.style.display = 'block';
                        warnDiv.style.background = 'var(--danger)';
                        warnDiv.style.color = '#fff';
                    } else {
                        warnDiv.style.display = 'none';
                    }
                }
            });
        }, 500); // 500ms animation
    }

    function addSalesItemRow(initialItemData = null) {
        const row = document.createElement('div');
        row.className = 'sales-item-row';
        row.style = 'display: flex; flex-direction: column; margin-bottom: 20px; position: relative;';

        row.innerHTML = `
            <div style="display: flex; gap: 12px; align-items: flex-end; width: 100%; flex-wrap: wrap;">
                <div style="flex: 2 1 200px;">
                    <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;" data-i18n="lbl_req_coffee_sel">Select Item</label>
                    <select class="form-control item-select" required>
                        ${coffeeOptionsHtml}
                    </select>
                </div>
                <div style="flex: 1 1 100px;">
                    <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;" data-i18n="lbl_req_size">Size</label>
                    <select class="form-control item-size" required>
                        <option value="250">250g</option>
                        <option value="500">500g</option>
                        <option value="1000">1kg</option>
                    </select>
                </div>
                <div style="flex: 1 1 100px; position: relative;">
                    <label class="form-label" style="font-size: 0.8rem; margin-bottom: 4px;" data-i18n="lbl_req_qty">Qty (Bags)</label>
                    <input type="number" class="form-control item-qty" min="1" value="1" required>
                    <div class="item-qty-warn" style="display:none; position: absolute; bottom: -26px; left: 0; right: 0; background: var(--warning); color: #000; padding: 3px 7px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; z-index: 10; white-space: nowrap;"></div>
                </div>
                <button type="button" class="btn btn-danger btn-remove-row" style="padding: 0; width: 38px; height: 38px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">&times;</button>
            </div>
            <div class="item-info-box" style="width: 100%; margin-top: 8px; font-size: 0.8rem; color: var(--text-secondary); background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 6px; display: none; line-height: 1.8;"></div>
        `;

        itemsList.appendChild(row);

        const sel = row.querySelector('.item-select');
        const sizeEl = row.querySelector('.item-size');
        const qtyEl = row.querySelector('.item-qty');

        if (initialItemData) {
            const coffeeVal = `${initialItemData.coffee_type}-${initialItemData.single_coffee_id || initialItemData.blend_recipe_id}`;
            sel.value = coffeeVal;
            sizeEl.value = initialItemData.bag_size_g;
            qtyEl.value = initialItemData.quantity_requested;
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
            await showWarningModal(window.t ? window.t('alert_stock_absolutely_insufficient') : "Total available stock and potential production are insufficient for one or more items. Please reduce the quantity.", false);
            return;
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
            notes: document.getElementById('m-req-notes').value
        };

        const { data: savedOrder, error } = await saveData('request_orders', orderRecord);
        if (error) {
            alert((window.t ? window.t('alert_order_failed') : "Ordering failed: {msg}").replace("{msg}", error.message));
            return;
        }

        // If editing, delete all previous request order items first
        if (orderId !== null) {
            const oldItems = (requestOrderItems || []).filter(i => i.request_order_id === orderId);
            for (const item of oldItems) {
                await deleteData('request_order_items', item.id);
            }
        }

        // 2. Save Item Details
        for (const r of rows) {
            const val = r.querySelector('.item-select').value;
            const [type, idStr] = val.split('-');
            const qty = parseInt(r.querySelector('.item-qty').value);
            
            const itemRecord = {
                request_order_id: savedOrder.id,
                coffee_type: type,
                single_coffee_id: type === 'Single' ? parseInt(idStr) : null,
                blend_recipe_id: type === 'Blend' ? parseInt(idStr) : null,
                bag_size_g: parseInt(r.querySelector('.item-size').value),
                quantity_requested: qty,
                quantity_allocated: 0,
                quantity_pending: qty,
                item_status: existingOrder ? existingOrder.status : 'Pending Approval'
            };
            await saveData('request_order_items', itemRecord);
        }

        modalContainer.classList.add('hidden');
        loadHandoverSection();
        scheduleDashboardRefresh();
    });
}

async function deleteSalesOrder(orderId) {
    if (await showWarningModal(window.t ? window.t('confirm_delete_order') : "Are you sure you want to delete this sales request?")) {
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

    if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No operator accounts registered.</td></tr>`;
        return;
    }

    const sortedUsers = [...users].sort((a, b) => (b.created_at && a.created_at ? new Date(b.created_at) - new Date(a.created_at) : 0));

    sortedUsers.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${user.name}</strong></td>
            <td><code>${user.username}</code></td>
            <td><span class="potential-badge">${user.role}</span></td>
            <td>${user.created_at ? new Date(user.created_at).toLocaleDateString() : '2026-06-28'}</td>
            <td>
                <button class="btn btn-secondary btn-sm btn-edit-user" data-id="${user.id}"><i class="lucide-edit-2"></i></button>
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

    const newRole = prompt("Assign new access role for " + user.name + " (Leader, Roaster, Packing, Sales, Developer):", user.role);
    if (!newRole) return;

    const validRoles = ['Leader', 'Roaster', 'Packing', 'Sales', 'Developer'];
    if (validRoles.includes(newRole)) {
        user.role = newRole;
        await saveData('profiles', user);
        loadUsersSection();
    } else {
        alert("Invalid role. Role must be one of: " + validRoles.join(', '));
    }
}

// Invite new user modal
document.getElementById('btn-invite-user').addEventListener('click', () => {
    const html = `
        <form id="modal-invite-form">
            <div class="form-group">
                <label class="form-label">Full Name</label>
                <input type="text" id="m-inv-name" class="form-control" placeholder="e.g. Alice Roaster" required>
            </div>
            <div class="form-group">
                <label class="form-label">Username / Email</label>
                <input type="text" id="m-inv-user" class="form-control" placeholder="e.g. alice@roastery.com" required>
            </div>
            <div class="form-group">
                <label class="form-label">Assigned Work Role</label>
                <select id="m-inv-role" class="form-control">
                    <option value="Roaster">Roaster (Operator)</option>
                    <option value="Leader">Production Leader</option>
                    <option value="Packing">Packing Team</option>
                    <option value="Sales">Sales Agent</option>
                </select>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Create Account</button>
            </div>
        </form>
    `;

    openModal('Register New Operator Account', html);

    document.getElementById('modal-invite-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const record = {
            id: 'mock-' + Math.random().toString(36).substr(2, 9),
            name: document.getElementById('m-inv-name').value,
            username: document.getElementById('m-inv-user').value,
            role: document.getElementById('m-inv-role').value,
            created_at: new Date().toISOString()
        };

        await saveData('profiles', record);
        modalContainer.classList.add('hidden');
        loadUsersSection();
    });
});

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
                <button class="btn btn-secondary btn-sm btn-edit-machine" data-id="${mach.id}"><i class="lucide-edit-2"></i></button>
                <button class="btn btn-danger btn-sm btn-delete-machine" data-id="${mach.id}"><i class="lucide-trash"></i></button>
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
    if (await showWarningModal("Are you sure you want to delete this roaster machine?")) {
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
document.getElementById('settings-company-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    companySettings.company_name = document.getElementById('sett-company-name').value;
    companySettings.phone = document.getElementById('sett-phone').value;
    companySettings.email = document.getElementById('sett-email').value;
    companySettings.address = document.getElementById('sett-address').value;
    companySettings.weight_unit = document.getElementById('sett-weight').value;
    companySettings.currency = document.getElementById('sett-currency').value;

    if (isMockMode) {
        localStorage.setItem('mock_company_settings', JSON.stringify(companySettings));
    } else {
        await window.supabaseClient.from('company_settings').update(companySettings).eq('id', 1);
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
        await window.supabaseClient.from('company_settings').update(companySettings).eq('id', 1);
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
        await window.supabaseClient.from('company_settings').update(companySettings).eq('id', 1);
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
                await window.supabaseClient.from('company_settings').update({ logo_base64: reader.result }).eq('id', 1);
            }
            applyCompanySettings();
        };
        reader.readAsDataURL(file);
    }
});

// Disconnect database connection
document.getElementById('btn-reset-connection').addEventListener('click', async () => {
    if (await showWarningModal("Are you sure you want to clear your Supabase cloud keys? The app will return to offline sandbox mode.")) {
        window.disconnectSupabase();
        localStorage.removeItem('is_mock_mode');
        isMockMode = true;
        checkAuthentication();
        await showWarningModal(window.t("alert_db_connected"), false);
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
    // If reports section is visible, reload it so the charts and dynamic texts reflect the correct language labels
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
}

const btnAddRec = document.getElementById('btn-add-recipe');
if (btnAddRec) {
    btnAddRec.addEventListener('click', () => openRecipeModal());
}

const btnAddMach = document.getElementById('btn-add-machine');
if (btnAddMach) {
    btnAddMach.addEventListener('click', () => openMachineModal());
}

// --- SANDBOX DEVELOPER BYPASS LINK ---
document.getElementById('link-dev-login').addEventListener('click', (e) => {
    e.preventDefault();
    isMockMode = true;
    localStorage.setItem('is_mock_mode', 'true');
    checkAuthentication();
});

// --- RESET MOCK DATABASE (flush bloated localStorage) ---
window.resetMockDatabase = async function() {
    if (!await showWarningModal('⚠️ This will RESET all data to default sample data. All your test entries will be lost. Continue?')) return;
    // Clear all mock tables
    for (const key in MOCK_DB) {
        localStorage.removeItem(`mock_${key}`);
    }
    localStorage.removeItem('mock_company_settings');
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
    if (isMockMode) {
        alert(window.t("alert_oauth_live_only"));
        return;
    }
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

    if (isMockMode) {
        // Sandbox bypass
        currentUser = { id: 'mock-user-1', name: email.split('@')[0], role: 'Leader' };
        authOverlay.classList.add('hidden');
        document.getElementById('app-container').style.display = 'flex';
        loadCompanySettings();
        scheduleDashboardRefresh();
    } else {
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({
            email,
            password
        });
        if (error) {
            alert(window.t("alert_signin_failed").replace("{msg}", error.message));
        } else {
            checkAuthentication();
        }
    }
});

// --- DATABASE CONNECTION SETUP SUBMISSION ---
document.getElementById('config-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = document.getElementById('config-url').value;
    const key = document.getElementById('config-key').value;

    const success = window.initSupabase(url, key);
    if (success) {
        isMockMode = false;
        localStorage.removeItem('is_mock_mode');
        configOverlay.classList.add('hidden');
        checkAuthentication();
    } else {
        alert(window.t("alert_connect_failed"));
    }
});

// --- LOG OUT ---
document.getElementById('btn-logout').addEventListener('click', async () => {
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
    const tabContent = table.closest('.tab-content');
    if (!tabContent) return;
    const tableId = tabContent.id; // e.g. "tab-green-inventory"
    
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
            const tabContent = th.closest('.tab-content');
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

function initRoastingBatchPagination() {
    // 1. Items per page selector click
    const sizeSelector = document.getElementById('batch-page-size-selector');
    if (sizeSelector) {
        sizeSelector.addEventListener('click', (e) => {
            const opt = e.target.closest('.page-size-opt');
            if (opt) {
                batchPageSize = parseInt(opt.getAttribute('data-size'));
                batchCurrentPage = 1;
                loadRoastingBatches();
            }
        });
    }

    // 2. Customize button toggle dropdown
    const btnToggle = document.getElementById('btn-toggle-customize');
    const dropdown = document.getElementById('customize-columns-dropdown');
    if (btnToggle && dropdown) {
        btnToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });
        
        // Hide when clicking outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== btnToggle) {
                dropdown.classList.add('hidden');
            }
        });
    }

    // 3. Column checkboxes change event
    const checkboxes = document.querySelectorAll('.col-toggle-checkbox');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const idx = parseInt(cb.getAttribute('data-col-idx'));
            batchVisibleColumns[idx] = cb.checked;
            applyBatchColumnVisibility();
        });
    });
}

function applyBatchColumnVisibility() {
    batchVisibleColumns.forEach((visible, idx) => {
        const elements = document.querySelectorAll(`#tab-roast-logs [data-col="${idx}"]`);
        elements.forEach(el => {
            el.style.display = visible ? '' : 'none';
        });
    });
}

async function loadBulkRoastedSection() {
    const { data: bulkList } = await fetchData('bulk_roasted_coffee');
    const tbody = document.getElementById('bulk-roasted-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const activeBulk = [...bulkList]
        .filter(b => parseFloat(b.bulk_available) > 0.005)
        .sort((a, b) => b.id - a.id);

    if (activeBulk.length === 0) {
        tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:var(--text-muted);">${window.t("msg_no_bulk_avail")}</td></tr>`;
        return;
    }

    activeBulk.forEach(rec => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${rec.coffee_name}</strong></td>
            <td><strong>${parseFloat(rec.bulk_available).toFixed(1)} kg</strong></td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-pack-bulk-inv').forEach(btn => {
        btn.addEventListener('click', () => openPackingModal(parseInt(btn.getAttribute('data-id'))));
    });
}

async function loadPackedCoffeeSection() {
    const { data: packed } = await fetchData('packed_coffee');
    const { data: batches } = await fetchData('roast_batches');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');
    const tbody = document.getElementById('packed-coffee-stock-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!packed || packed.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">${window.t("msg_no_packed_avail")}</td></tr>`;
        return;
    }

    // Resolve coffee name for each item
    const resolved = packed.map(item => {
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
        return { ...item, coffeeName };
    });

    // Group by coffee name
    const grouped = {};
    resolved.forEach(item => {
        if (!grouped[item.coffeeName]) grouped[item.coffeeName] = [];
        grouped[item.coffeeName].push(item);
    });

    // Render one row per coffee name, with all sizes inline and aligned vertically
    Object.entries(grouped).sort(([a],[b]) => a.localeCompare(b)).forEach(([coffeeName, items]) => {
        // Sort items by bag size
        items.sort((a, b) => (a.bag_size_g || 0) - (b.bag_size_g || 0));

        const sizesHtml = items.map((item, idx) => `
            <div style="padding: 10px 16px; border-bottom: ${idx < items.length - 1 ? '1px dashed var(--border)' : 'none'}; min-height: 42px; display: flex; align-items: center;">
                <span style="background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:6px; padding:2px 10px; font-size:0.85rem; font-weight:700;">
                    ${item.bag_size_g}g
                </span>
            </div>
        `).join('');

        const stockHtml = items.map((item, idx) => `
            <div style="padding: 10px 16px; border-bottom: ${idx < items.length - 1 ? '1px dashed var(--border)' : 'none'}; min-height: 42px; display: flex; align-items: center;">
                <span style="background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:6px; padding:2px 10px; font-size:0.85rem; font-weight:600; color:var(--text-secondary);">
                    ${item.quantity} ${window.t("lbl_bags")}
                </span>
            </div>
        `).join('');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="vertical-align: middle; padding: 12px 20px;"><strong>${coffeeName}</strong></td>
            <td style="padding: 0; vertical-align: top;">${sizesHtml}</td>
            <td style="padding: 0; vertical-align: top;">${stockHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

let gbReportChart = null;
let roastReportChart = null;
let packReportChart = null;
let salesReportChart = null;

async function loadReportsSection() {
    // Set default dates if empty (last 30 days)
    const startInput = document.getElementById('rep-filter-start');
    const endInput = document.getElementById('rep-filter-end');
    if (startInput && !startInput.value) {
        const today = new Date();
        const start = new Date();
        start.setDate(today.getDate() - 30);
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
    }
}

async function loadGreenbeanReport(startDate, endDate) {
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: intakes } = await fetchData('green_coffee_intake');
    const { data: batches } = await fetchData('roast_batches');
    const { data: ingredients } = await fetchData('blend_ingredients');

    const filteredIntakes = (intakes || []).filter(i => {
        const d = i.intake_date || i.created_at?.split('T')[0];
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

    const arrivalsMap = {};
    filteredIntakes.forEach(i => {
        const gId = parseInt(i.green_coffee_id);
        arrivalsMap[gId] = (arrivalsMap[gId] || 0) + (parseFloat(i.quantity) || 0);
    });

    const roastedMap = {};
    filteredBatches.forEach(b => {
        const greenUsed = parseFloat(b.green_used_kg) || 0;
        if (b.coffee_type === 'Single') {
            const gId = parseInt(b.single_coffee_id);
            roastedMap[gId] = (roastedMap[gId] || 0) + greenUsed;
        } else {
            const rId = parseInt(b.blend_recipe_id);
            const recipeIngs = (ingredients || []).filter(ing => parseInt(ing.blend_recipe_id) === rId);
            recipeIngs.forEach(ing => {
                const gId = parseInt(ing.green_coffee_id);
                const percentage = parseFloat(ing.percentage) || 0;
                roastedMap[gId] = (roastedMap[gId] || 0) + (greenUsed * (percentage / 100));
            });
        }
    });

    const tbody = document.getElementById('rep-gb-table-body');
    if (tbody) tbody.innerHTML = '';

    let totalArrivalsAll = 0;
    let totalRoastedAll = 0;
    let totalStockAll = 0;

    const labels = [];
    const arrivalDataset = [];
    const stockDataset = [];

    (greenbeans || []).forEach(gb => {
        const gId = parseInt(gb.id);
        const arrivals = arrivalsMap[gId] || 0;
        const roasted = roastedMap[gId] || 0;
        const currentStock = parseFloat(gb.stock_kg) || 0;

        totalArrivalsAll += arrivals;
        totalRoastedAll += roasted;
        totalStockAll += currentStock;

        labels.push(gb.name);
        arrivalDataset.push(arrivals);
        stockDataset.push(currentStock);

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

    const arrivalsEl = document.getElementById('rep-gb-total-arrivals');
    const roastedEl = document.getElementById('rep-gb-total-roasted');
    const countEl = document.getElementById('rep-gb-active-count');
    const stockEl = document.getElementById('rep-gb-remain-stock');

    if (arrivalsEl) arrivalsEl.textContent = `${totalArrivalsAll.toFixed(1)} kg`;
    if (roastedEl) roastedEl.textContent = `${totalRoastedAll.toFixed(1)} kg`;
    if (countEl) countEl.textContent = (greenbeans || []).length;
    if (stockEl) stockEl.textContent = `${totalStockAll.toFixed(1)} kg`;

    const ctx = document.getElementById('rep-gb-chart');
    if (ctx) {
        if (gbReportChart) gbReportChart.destroy();
        gbReportChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: window.t ? window.t('card_total_arrivals') : 'Total Arrivals (kg)',
                        data: arrivalDataset,
                        backgroundColor: 'rgba(59, 130, 246, 0.65)',
                        borderColor: 'rgb(59, 130, 246)',
                        borderWidth: 1
                    },
                    {
                        label: window.t ? window.t('card_remain_stock') : 'Current Stock (kg)',
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
    const { data: batches } = await fetchData('roast_batches');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');

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
        const green = parseFloat(b.green_used_kg) || 0;
        const yieldKg = parseFloat(b.roasted_yield_kg) || 0;
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
    const { data: packed } = await fetchData('packed_coffee');
    const { data: batches } = await fetchData('roast_batches');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');

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

    let totalBags = 0;
    let totalWeightKg = 0;
    const varieties = new Set();

    const groupMap = {};

    filtered.forEach(item => {
        const bags = parseInt(item.quantity) || 0;
        const sizeG = parseInt(item.bag_size_g) || 250;
        const kg = (bags * sizeG) / 1000;

        totalBags += bags;
        totalWeightKg += kg;
        varieties.add(item.coffeeName);

        const key = `${item.coffeeName}|${sizeG}`;
        if (!groupMap[key]) {
            groupMap[key] = { coffee: item.coffeeName, size: sizeG, bags: 0, weight: 0 };
        }
        groupMap[key].bags += bags;
        groupMap[key].weight += kg;
    });

    const tbody = document.getElementById('rep-pack-table-body');
    if (tbody) tbody.innerHTML = '';

    const labels = [];
    const bagData = [];

    Object.values(groupMap).forEach(val => {
        labels.push(`${val.coffee} (${val.size}g)`);
        bagData.push(val.bags);

        if (tbody) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${val.coffee}</strong></td>
                <td>${val.size}g</td>
                <td>${val.bags}</td>
                <td><strong>${val.weight.toFixed(1)} kg</strong></td>
            `;
            tbody.appendChild(tr);
        }
    });

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
    const { data: orders } = await fetchData('request_orders');
    const { data: orderItems } = await fetchData('request_order_items');
    const { data: greenbeans } = await fetchData('green_coffee');
    const { data: recipes } = await fetchData('blend_recipes');

    const filteredOrders = (orders || []).filter(o => {
        const d = o.order_date || o.created_at?.split('T')[0];
        if (!d) return true;
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        return true;
    });

    const activeOrderIds = filteredOrders.map(o => o.id);

    let totalOrders = filteredOrders.length;
    let completedOrders = filteredOrders.filter(o => o.status === 'Completed').length;
    let pendingOrders = filteredOrders.filter(o => o.status === 'Pending Approval').length;
    let totalBags = 0;

    const groupMap = {};

    (orderItems || []).forEach(item => {
        if (activeOrderIds.includes(item.request_order_id)) {
            const bags = parseInt(item.quantity_requested) || 0;
            totalBags += bags;

            let coffeeName = '';
            if (item.coffee_type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === item.single_coffee_id);
                coffeeName = gb ? gb.name : 'Single';
            } else {
                const r = (recipes || []).find(rec => rec.id === item.blend_recipe_id);
                coffeeName = r ? r.name : 'Blend';
            }

            const sizeG = parseInt(item.bag_size_g) || 250;
            const key = `${coffeeName}|${sizeG}`;

            if (!groupMap[key]) {
                groupMap[key] = { coffee: coffeeName, size: sizeG, bags: 0 };
            }
            groupMap[key].bags += bags;
        }
    });

    const tbody = document.getElementById('rep-sales-table-body');
    if (tbody) tbody.innerHTML = '';

    const labels = [];
    const bagData = [];

    Object.values(groupMap).forEach(val => {
        labels.push(`${val.coffee} (${val.size}g)`);
        bagData.push(val.bags);

        if (tbody) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${val.coffee}</strong></td>
                <td>${val.size}g</td>
                <td>${val.bags}</td>
                <td><span style="font-size:0.75rem; font-weight:700; background:rgba(245,158,11,0.15); color:var(--warning); padding:2px 8px; border-radius:9999px;">Pending</span></td>
            `;
            tbody.appendChild(tr);
        }
    });

    const ordersEl = document.getElementById('rep-sales-total-orders');
    const bagsEl = document.getElementById('rep-sales-total-bags');
    const completedEl = document.getElementById('rep-sales-completed');
    const pendingEl = document.getElementById('rep-sales-pending');

    if (ordersEl) ordersEl.textContent = totalOrders;
    if (bagsEl) bagsEl.textContent = `${totalBags} bags`;
    if (completedEl) completedEl.textContent = completedOrders;
    if (pendingEl) pendingEl.textContent = pendingOrders;

    const ctx = document.getElementById('rep-sales-chart');
    if (ctx) {
        if (salesReportChart) salesReportChart.destroy();
        salesReportChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: window.t ? window.t('card_requested_bags') : 'Requested Bags',
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

// --- INITIAL BOOTSTRAP ---
checkAuthentication();
makeTabsDraggable();
initTableFilters();
initRoastingBatchPagination();
initHandoverPagination();
navigateTo('sec-dashboard'); // start on dashboard
