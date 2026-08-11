// SETTINGS MODULE - ROASTERY MANAGER V2
// Plain script (shared global scope — NOT an ES module). Split out of app.js
// during the V1 refactor. Covers User Management, Role & Permissions
// (incl. PERMISSION_GROUPS), Machines, Packaging Sizes, the Developer debug
// tools (resetMockDatabase/debugInspectStorage), and the Translation
// Manager. Load order: after db.js/auth.js/greenbean.js/roasting.js/
// packing.js/sales.js, before app.js.
//
// Company Profile forms (loadCompanySettings/applyCompanySettings) and the
// login/auth wiring (Google login, email login, forgot password) stayed in
// app.js even though they render inside the Settings/Login screens — the
// former is called from auth.js's loadUserProfile, the latter is core auth
// flow, both established in earlier phases of this refactor.

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
        tbody.innerHTML = `<tr><td colspan="5" class="text-center-muted">No operator accounts registered.</td></tr>`;
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
                <button class="btn btn-secondary btn-sm btn-edit-user" data-id="${user.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
                ${hasPermission('user_management') ? `<button class="btn btn-secondary btn-sm btn-reset-user-pw ml-1" data-id="${user.id}" data-name="${user.name}" title="Reset password"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg></button>` : ''}
                ${(hasPermission('user_delete') && currentUser && user.id !== currentUser.id) ? `<button class="btn btn-danger btn-sm btn-delete-user ml-1" data-id="${user.id}" data-name="${user.name}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-edit-user').forEach(btn => {
        btn.addEventListener('click', () => editUserRole(btn.getAttribute('data-id')));
    });
    document.querySelectorAll('.btn-reset-user-pw').forEach(btn => {
        btn.addEventListener('click', () => openAdminResetPasswordModal(btn.getAttribute('data-id'), btn.getAttribute('data-name')));
    });
    document.querySelectorAll('.btn-delete-user').forEach(btn => {
        btn.addEventListener('click', () => deleteUserAccount(btn.getAttribute('data-id'), btn.getAttribute('data-name')));
    });
}

// Admin-triggered DIRECT password reset (no email). The anon key can't set
// another user's password, so this calls the `admin-reset-password` Supabase
// Edge Function, which holds the service_role key server-side and re-checks
// the caller's admin permission before doing it. The user's session JWT is
// attached automatically by functions.invoke() so the function knows who is
// calling. If the function isn't deployed yet, invoke() surfaces that error.
async function openAdminResetPasswordModal(userId, name) {
    if (!userId) return;
    const html = `
        <form id="admin-reset-pw-form">
            <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;">Set a new password for <strong>${name}</strong>. It takes effect immediately — no email is sent.</p>
            <div class="form-group">
                <label class="form-label">New Password</label>
                <input type="password" id="m-admin-new-pw" class="form-control" placeholder="Minimum 6 characters" required minlength="6">
            </div>
            <div class="form-group" style="margin-top:12px;">
                <label class="form-label">Confirm Password</label>
                <input type="password" id="m-admin-new-pw-confirm" class="form-control" required minlength="6">
            </div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Reset Password</button>
            </div>
        </form>
    `;
    openModal(`Reset Password — ${name}`, html);
    document.getElementById('admin-reset-pw-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pass = document.getElementById('m-admin-new-pw').value;
        const confirmPass = document.getElementById('m-admin-new-pw-confirm').value;
        if (pass !== confirmPass) {
            alert('Passwords do not match.');
            return;
        }

        const { data, error } = await window.supabaseClient.functions.invoke('admin-reset-password', {
            body: { userId, newPassword: pass }
        });

        if (error) {
            // functions.invoke wraps a non-2xx response in a FunctionsHttpError
            // whose .context is the raw Response — dig out the JSON { error }.
            let msg = error.message || 'Unknown error';
            try {
                if (error.context && typeof error.context.json === 'function') {
                    const body = await error.context.json();
                    if (body && body.error) msg = body.error;
                }
            } catch (_) { /* keep the generic message */ }
            alert('Failed to reset password: ' + msg);
            return;
        }
        if (data && data.error) {
            alert('Failed to reset password: ' + data.error);
            return;
        }

        document.getElementById('btn-close-modal').click();
        await showWarningModal(`Password for "${name}" has been reset. They can now sign in with the new password.`, false, null, null, 'success');
    });
}

// Removes the user's PROFILE row (role + all app access). Their Supabase Auth
// login still exists — the anon key can't call the admin API to delete the
// auth.users row, so a full login removal must be done in Supabase Dashboard →
// Authentication → Users. With the loadUserProfile hardening (sign out when the
// profile row is gone), a profile-less login can no longer get in, so deleting
// the profile is an effective access revocation on its own.
async function deleteUserAccount(userId, userName) {
    if (currentUser && userId === currentUser.id) {
        alert('You cannot delete your own account.');
        return;
    }
    const confirmed = await showDeleteConfirmModal(`the account "${userName}"`);
    if (!confirmed) return;

    const { error } = await deleteData('profiles', userId);
    if (error) {
        alert('Failed to delete user: ' + error.message);
        return;
    }
    loadUsersSection();
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
            <div class="modal-footer-actions">
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
        <div class="form-group mt-25" >
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
            <div class="form-group mt-25" >
                <label class="form-label">Email Address</label>
                <input type="email" id="m-inv-user" class="form-control" placeholder="e.g. alice@roastery.com" required>
            </div>
            ${passwordFieldHtml}
            <div class="form-group mt-25" >
                <label class="form-label">Assigned Work Role</label>
                <select id="m-inv-role" class="form-control">${roleOptionsHtml}</select>
            </div>

            <div class="modal-footer-actions-lg">
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
    { label: '📤 Greenbean — Outbound', keys: [
        { key: 'greenbean_outbound_view', label: 'View' },
        { key: 'greenbean_outbound_add', label: 'Add Shipment' },
        { key: 'greenbean_outbound_edit', label: 'Edit Shipment' },
        { key: 'greenbean_outbound_delete', label: 'Delete Shipment' }
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
        { key: 'packing_daily', label: 'Pack from Bulk (Ready to Pack)' },
        { key: 'packing_print_barcode', label: 'Print Barcode' },
        { key: 'packing_manual_add', label: 'Add Manual Packed Stock' },
        { key: 'packing_order_view', label: 'View Order Requests' },
        { key: 'packing_records_view', label: 'View Records' },
        { key: 'packing_unpack', label: 'Unpack' },
        { key: 'packing_repack', label: 'Repack' },
        { key: 'packing_stock_release', label: 'Stock Release (non-sales goods out)' },
        { key: 'packing_completed_view', label: 'View Completed Orders' },
        { key: 'packing_dispatch_checkout', label: 'Checkout Order (POS Dispatch)' }
    ]},
    { label: '🚚 Sales — Dispatch Request', keys: [
        { key: 'sales_request_view', label: 'View' },
        { key: 'sales_request_view_own', label: 'View (Own Orders Only)' },
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
    { label: '🔍 Tracking', keys: [
        { key: 'tracking_view', label: 'View Tracking Page' }
    ]},
    { label: '⚙️ Settings', keys: [
        { key: 'settings_general', label: 'General' },
        { key: 'settings_production', label: 'Production' },
        { key: 'settings_system', label: 'System' }
    ]},
    { label: '🔐 Administration', keys: [
        { key: 'user_management', label: 'User & Role Management' },
        { key: 'user_delete', label: 'Delete User' }
    ]}
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

    // Hide the Developer role entirely (incognito super-role) — same intent as
    // hiding Developer-role users from the operator list in loadUsersSection().
    container.innerHTML = roles.filter(r => r.name !== 'Developer').map(role => {
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
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
                ${!role.is_system ? `<button class="btn btn-danger btn-sm btn-delete-role" data-id="${role.id}" style="padding: 4px 10px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
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
        tbody.innerHTML = `<tr><td colspan="5" class="text-center-muted">${window.t("msg_no_machines")}</td></tr>`;
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
                <button class="btn btn-secondary btn-sm btn-edit-machine" data-id="${mach.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
                <button class="btn btn-danger btn-sm btn-delete-machine" data-id="${mach.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
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

            <div class="modal-footer-actions">
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

// Roasting log sticker and packed coffee sticker are now both a fixed
// 50x25mm with a scannable barcode (see printStickerLabel in roasting.js and
// printLotBarcodeLabels in packing.js) — no more width/height inputs here,
// just which text lines print alongside each sticker's barcode. Both forms
// write into the single label_layout JSONB column (company_settings), one
// key per sticker type, so future field additions don't need a new migration.
async function saveLabelLayout(section, patch) {
    companySettings.label_layout = companySettings.label_layout || {};
    companySettings.label_layout[section] = { ...(companySettings.label_layout[section] || {}), ...patch };

    if (isMockMode) {
        localStorage.setItem('mock_company_settings', JSON.stringify(companySettings));
    } else {
        const { error } = await upsertData('company_settings', { id: 1, label_layout: companySettings.label_layout });
        if (error) {
            alert("Failed to save label settings: " + error.message);
            return;
        }
    }

    applyCompanySettings();
    alert(window.t("alert_settings_saved"));
}

document.getElementById('settings-roast-label-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveLabelLayout('roasting', {
        coffee_name: document.getElementById('sett-roast-label-show-coffee-name').checked,
        machine: document.getElementById('sett-roast-label-show-machine').checked,
        coffee_code: document.getElementById('sett-roast-label-show-coffee-code').checked,
    });
});

document.getElementById('settings-packed-label-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const barcodeHeightInput = parseFloat(document.getElementById('sett-packed-label-barcode-height').value);
    await saveLabelLayout('packed', {
        code: document.getElementById('sett-packed-label-show-code').checked,
        coffee_name: document.getElementById('sett-packed-label-show-coffee-name').checked,
        dates: document.getElementById('sett-packed-label-show-dates').checked,
        machine: document.getElementById('sett-packed-label-show-machine').checked,
        barcode_height_mm: (barcodeHeightInput && barcodeHeightInput > 0) ? barcodeHeightInput : 18,
    });
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
            const { data: directData } = await window.supabaseClient.from('packaging_sizes').select('id, label, gram, is_visible, carton_multiplier, size_digit');
            console.log('[PackagingSize] Direct fetch result:', directData);
            if (directData && directData.length > 0) {
                renderPackagingSizesRows(tbody, directData);
                return;
            }
        } catch(e) { console.error('[PackagingSize] Direct fetch also failed:', e); }
    }

    if (!sizes || sizes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center-muted">No packaging sizes found.</td></tr>`;
        return;
    }
    
    renderPackagingSizesRows(tbody, sizes);
}

function renderPackagingSizesRows(tbody, sizes) {
    sizes.sort((a,b) => (parseFloat(a.gram)||0) - (parseFloat(b.gram)||0)).forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${s.label}</strong></td>
            <td>${s.gram} g${s.carton_multiplier ? ` <span style="color: var(--text-secondary); font-size: 0.8em;">(&times;${s.carton_multiplier}/carton)</span>` : ''}</td>
            <td>${s.size_digit !== null && s.size_digit !== undefined ? `<code>${s.size_digit}</code>` : `<span style="color: var(--text-secondary); font-size: 0.85em;">Not set</span>`}</td>
            <td>
                <label class="switch" style="transform: scale(0.8); transform-origin: left center;">
                    <input type="checkbox" class="toggle-visibility-pack" data-id="${s.id}" ${s.is_visible ? 'checked' : ''} disabled>
                    <span class="slider round"></span>
                </label>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-outline btn-sm btn-edit-pack-size" data-id="${s.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle-mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>
                    <button class="btn btn-danger btn-sm btn-delete-pack-size" data-id="${s.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
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
    let size = { label: '', gram: 250, is_visible: true, carton_multiplier: null, size_digit: null };
    const { data: allSizes } = await fetchData('packaging_sizes');
    if (id) {
        const found = (allSizes || []).find(s => s.id === id);
        if (found) size = found;
    }

    // Auto-assigned, not user-typed (per user request) — same "auto code"
    // convention as Custom Blend's Bulk Code preview. Only computed for a
    // NEW size; an existing size keeps whatever digit it was given at
    // creation, even when editing its other fields. Picks the lowest unused
    // digit 0-9 across every packaging size (not just visible ones) so two
    // sizes can never collide; null (shown as "—") if all 10 are taken,
    // which just means this size won't participate in the FIFO strip/barcode
    // feature until an old size's digit frees up.
    let assignedDigit = size.size_digit;
    if (!id) {
        const used = new Set((allSizes || []).map(s => s.size_digit).filter(d => d !== null && d !== undefined));
        assignedDigit = null;
        for (let d = 0; d <= 9; d++) {
            if (!used.has(d)) { assignedDigit = d; break; }
        }
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
            <div class="form-group">
                <label class="form-label">Pcs per Carton (optional)</label>
                <input type="number" id="m-ps-carton" class="form-control" value="${size.carton_multiplier ?? ''}" min="1" placeholder="e.g. 10 — leave blank for no carton label option">
            </div>
            <div class="form-group">
                <label class="form-label">FIFO Digit (auto)</label>
                <input type="text" id="m-ps-fifo-digit" class="form-control" value="${assignedDigit === null ? 'None available' : assignedDigit}" disabled style="color:var(--text-muted);">
                <span style="font-size:0.78rem; color:var(--text-muted);">Leading digit of this size's FIFO strip code/barcode — assigned automatically, can't be changed here.</span>
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

        const cartonInput = document.getElementById('m-ps-carton').value;
        const saveDataObj = {
            label: labelInput,
            gram: parseFloat(gramInput),
            is_visible: document.getElementById('m-ps-visible').checked,
            carton_multiplier: cartonInput ? parseFloat(cartonInput) : null,
            size_digit: assignedDigit
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
    await showWarningModal('Database reset to defaults. Refreshing page...', false, null, null, 'success');
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
