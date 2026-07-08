// AUTH & PERMISSIONS MODULE - ROASTERY MANAGER V2
// Plain script (shared global scope — NOT an ES module). Split out of app.js
// during the V1 refactor. Loaded AFTER db.js and BEFORE the UI modules and
// app.js, since login/permission checks are needed everywhere.
//
// NOTE: the three "instant prime from cache" IIFEs (primeBrandFromCache,
// primeUserFromCache, primeMenuAccessFromCache) deliberately stayed in
// app.js instead of moving here. They execute immediately at script-parse
// time, and primeMenuAccessFromCache assigns to `currentUser` — a `let`
// declared in app.js. Since auth.js loads BEFORE app.js, referencing
// `currentUser` from here at top-level would hit it before its `let`
// binding has executed (temporal dead zone) and throw. Keeping all three
// IIFEs together in app.js (where the state they touch is declared) avoids
// that; the functions they call (hasPermission, applyMenuVisibility,
// SECTION_PERMISSIONS below) are fine to live here since they're only
// invoked later, at runtime, well after every script has loaded.

// ============================================================
// CUSTOM ROLES SYNC — Supabase is the source of truth; localStorage
// key 'mock_custom_roles' is kept only as a synchronous read cache
// for permission checks (hasPermission, etc.)
// ============================================================
async function syncCustomRolesFromSupabase() {
    try {
        const { data, error } = await window.supabaseClient.from('custom_roles').select('*');
        if (error) throw error;

        if (data && data.length > 0) {
            localStorage.setItem('mock_custom_roles', JSON.stringify(data));
        } else {
            const { error: seedError } = await window.supabaseClient.from('custom_roles').insert(MOCK_DB.custom_roles);
            if (seedError) throw seedError;
            localStorage.setItem('mock_custom_roles', JSON.stringify(MOCK_DB.custom_roles));
        }
    } catch (e) {
        console.error('Failed to sync custom_roles from Supabase:', e);
        if (!localStorage.getItem('mock_custom_roles')) {
            localStorage.setItem('mock_custom_roles', JSON.stringify(MOCK_DB.custom_roles));
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

// ============================================================
// DYNAMIC GREETING SYSTEM
// ============================================================
function updateGreeting(userName) {
    const firstName = (userName || 'User').split(' ')[0];
    const hour = new Date().getHours();
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);

    // Time-based icon
    let icon = '👋';
    if (hour >= 5 && hour < 10) icon = '🌅';
    else if (hour >= 10 && hour < 14) icon = '☀️';
    else if (hour >= 14 && hour < 17) icon = '🌤️';
    else if (hour >= 17 && hour < 20) icon = '🌇';
    else icon = '🌙';

    // 30+ rotating greetings
    const greetings = [
        `Welcome back, ${firstName}!`,
        `Good to see you, ${firstName}!`,
        `Hey ${firstName}, let's get productive!`,
        `Hello ${firstName}, ready to roast?`,
        `Hi ${firstName}, great day ahead!`,
        `What's brewing, ${firstName}?`,
        `Rise and grind, ${firstName}! ☕`,
        `Hey there, ${firstName}!`,
        `Happy roasting, ${firstName}!`,
        `Welcome aboard, ${firstName}!`,
        `Let's make great coffee, ${firstName}!`,
        `Good vibes, ${firstName}!`,
        `Coffee time, ${firstName}! ☕`,
        `Stay caffeinated, ${firstName}!`,
        `Hello ${firstName}, beans are waiting!`,
        `Fired up and ready, ${firstName}!`,
        `Let's crush it today, ${firstName}!`,
        `Fresh batch incoming, ${firstName}!`,
        `Keep it roasty, ${firstName}!`,
        `On a roll today, ${firstName}!`,
        `Hey ${firstName}, let's brew success!`,
        `Another great day, ${firstName}!`,
        `Time to shine, ${firstName}!`,
        `Full steam ahead, ${firstName}!`,
        `Hey ${firstName}, the aroma awaits!`,
        `Let's get things roasting, ${firstName}!`,
        `Glad you're here, ${firstName}!`,
        `Hey ${firstName}, perfection in every bean!`,
        `Quality first, ${firstName}!`,
        `The roastery awaits you, ${firstName}!`,
    ];

    const greetingIndex = dayOfYear % greetings.length;
    const greetingText = greetings[greetingIndex];

    const iconEl = document.getElementById('greeting-icon');
    const textEl = document.getElementById('greeting-text');
    if (iconEl) iconEl.textContent = icon;
    if (textEl) textEl.textContent = greetingText;
}

// ============================================================
// SECTION PERMISSIONS MAPPING
const SECTION_PERMISSIONS = {
    'sec-dashboard': 'dashboard',
    'sec-greenbean': 'greenbean_view',
    'sec-bulk-roasted': 'bulk_view',
    'sec-packed-coffee': 'packed_view',
    'sec-roasting': 'roasting_view',
    'sec-packing': 'packing_view',
    'sec-customers': ['customer_view'],
    'sec-handover': ['sales_request_view', 'dispatch_approval_view'],
    'sec-reports': 'reports_view',
    'sec-settings': ['settings_general', 'settings_production', 'settings_system'],
};

// When a permission is split out of a broader one, roles saved before the new
// key existed won't have it — hasPermission would then return false and the
// feature would silently disappear for everyone until re-granted. Mapping the
// new key to its parent here means those older roles keep their existing access
// (they inherit the parent's value) until an admin explicitly toggles the new
// key on or off.
const PERMISSION_FALLBACKS = {
    reports_stockopname_view: 'reports_view',
    // All of these actions were previously ungated — anyone who could see the
    // section could do them. Falling back (chained, resolved recursively) to
    // the section's view permission preserves that exactly, so no existing
    // role loses access; admins can now tighten each one explicitly.
    greenbean_edit: 'greenbean_view',
    bulk_view: 'greenbean_view',
    bulk_edit: 'bulk_view',
    bulk_delete: 'bulk_view',
    packed_view: 'greenbean_view',
    packed_edit: 'packed_view',
    packed_delete: 'packed_view',
};

// Effective permission for a specific role object, honouring PERMISSION_FALLBACKS
// when the granular key isn't explicitly stored on the role yet.
function roleHasPermission(role, key) {
    if (!role) return false;
    if (role.permissions[key] !== undefined) return role.permissions[key] === true;
    const fallback = PERMISSION_FALLBACKS[key];
    if (fallback) return roleHasPermission(role, fallback);
    return false;
}

function hasPermission(key) {
    if (!currentUser) return false;
    const roleName = currentUser.role;
    const roles = JSON.parse(localStorage.getItem('mock_custom_roles')) || [];
    const role = roles.find(r => r.name === roleName);
    if (!role) return true; // if role not found, default allow (for backward compat)
    return roleHasPermission(role, key);
}

function getFirstAllowedSection() {
    const sections = [
        'sec-dashboard',
        'sec-greenbean',
        'sec-bulk-roasted',
        'sec-packed-coffee',
        'sec-roasting',
        'sec-packing',
        'sec-customers',
        'sec-handover',
        'sec-reports',
        'sec-settings'
    ];
    for (const sec of sections) {
        const perm = SECTION_PERMISSIONS[sec];
        if (!perm) return sec; // default allow
        let allowed = false;
        if (Array.isArray(perm)) {
            allowed = perm.some(p => hasPermission(p));
        } else {
            allowed = hasPermission(perm);
        }
        if (allowed) return sec;
    }
    return 'sec-dashboard'; // fallback
}

// Just the visibility toggling (menu items + permission-gated settings cards).
// Split out from applyRoleAccess() so it can also be run the instant a cached
// role is available on page load — see primeMenuAccessFromCache in app.js —
// without the "force redirect off a forbidden section" logic that isn't safe
// to run before the rest of the app has actually bootstrapped.
function applyMenuVisibility() {
    if (!currentUser) return;

    // Sidebar menu items
    document.querySelectorAll('.menu-item[data-target], .menu-subitem[data-target]').forEach(item => {
        const target = item.getAttribute('data-target');
        const perm = SECTION_PERMISSIONS[target];
        if (!perm) return;

        let visible = false;
        if (Array.isArray(perm)) {
            visible = perm.some(p => hasPermission(p));
        } else {
            visible = hasPermission(perm);
        }
        item.style.display = visible ? '' : 'none';
    });

    // Handle inventory parent menu item dropdown: if all subitems are hidden, hide parent
    const menuInventory = document.getElementById('menu-inventory');
    if (menuInventory) {
        const subItems = ['sec-greenbean', 'sec-bulk-roasted', 'sec-packed-coffee'];
        const anyVisible = subItems.some(sec => {
            const perm = SECTION_PERMISSIONS[sec];
            return perm ? hasPermission(perm) : true;
        });
        menuInventory.style.display = anyVisible ? '' : 'none';
    }

    // Debug Tools card — Developer only
    const debugCard = document.getElementById('card-sett-debug');
    if (debugCard) {
        debugCard.style.display = (currentUser.role === 'Developer') ? '' : 'none';
    }

    // User Management & Role cards — only for user_management permission
    const usersCard = document.getElementById('card-sett-users');
    if (usersCard) {
        usersCard.style.display = hasPermission('user_management') ? '' : 'none';
    }
    const rolesCard = document.getElementById('card-sett-roles');
    if (rolesCard) {
        rolesCard.style.display = hasPermission('user_management') ? '' : 'none';
    }
}

function applyRoleAccess() {
    if (!currentUser) return;
    applyMenuVisibility();

    // Force redirection if they are on a forbidden section
    const currentSection = Array.from(pageSections).find(sec => !sec.classList.contains('hidden'))?.id;
    if (currentSection) {
        const perm = SECTION_PERMISSIONS[currentSection];
        if (perm) {
            let hasAccess = Array.isArray(perm) ? perm.some(p => hasPermission(p)) : hasPermission(perm);
            if (!hasAccess) {
                navigateTo(getFirstAllowedSection());
            }
        }
    }
}

function checkAuthentication() {
    if (!checkDatabaseConnection()) return;

    // Listen for auth state changes (handles OAuth redirect)
    window.supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
            authOverlay.classList.add('hidden');
            document.getElementById('app-container').style.display = 'flex';
            loadUserProfile(session.user.id);
            scheduleDashboardRefresh();
            if (window.__pendingPasswordRecovery) {
                window.__pendingPasswordRecovery = false;
                showSetNewPasswordModal();
            }
        } else if (event === 'SIGNED_OUT') {
            authOverlay.classList.remove('hidden');
            document.getElementById('app-container').style.display = 'none';
            currentUser = null;
        } else if (event === 'PASSWORD_RECOVERY' && session) {
            authOverlay.classList.add('hidden');
            document.getElementById('app-container').style.display = 'flex';
            loadUserProfile(session.user.id);
            scheduleDashboardRefresh();
            showSetNewPasswordModal();
        }
    });

    // Also check current session
    window.supabaseClient.auth.getSession().then(({ data: { session } }) => {
        if (!session) {
            authOverlay.classList.remove('hidden');
            document.getElementById('app-container').style.display = 'none';
        } else {
            authOverlay.classList.add('hidden');
            document.getElementById('app-container').style.display = 'flex';
            loadUserProfile(session.user.id);
            scheduleDashboardRefresh();
            if (window.__pendingPasswordRecovery) {
                window.__pendingPasswordRecovery = false;
                showSetNewPasswordModal();
            }
        }
    });
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
        updateGreeting(currentUser.name);
        applyRoleAccess();
        loadCompanySettings();
        try {
            localStorage.setItem('cached_user_identity', JSON.stringify({ name: currentUser.name, role: currentUser.role }));
        } catch (e) { /* localStorage full/unavailable — non-critical, skip caching */ }
    } catch (e) {
        console.error("UserProfile load failed, falling back:", e);
        currentUser = { id: userId, username: 'user', role: 'Leader', name: 'Production Leader' };
        loadCompanySettings();
    }
}
