document.addEventListener('DOMContentLoaded', () => {
    // Check if connected
    if (!window.isConnected()) {
        document.getElementById('db-setup-modal').classList.remove('hidden');
    } else {
        loadPendingOrders();
    }

    // DB Setup logic
    document.getElementById('btn-save-db').addEventListener('click', () => {
        const url = document.getElementById('setup-url').value.trim();
        const key = document.getElementById('setup-key').value.trim();
        if (url && key) {
            localStorage.setItem('supabase_url', url);
            localStorage.setItem('supabase_key', key);
            window.location.reload();
        } else {
            alert('Please enter both URL and Key.');
        }
    });

    document.getElementById('btn-refresh').addEventListener('click', loadPendingOrders);
});

async function loadPendingOrders() {
    const container = document.getElementById('orders-container');
    const loader = document.getElementById('loading-indicator');
    
    container.innerHTML = '';
    loader.classList.remove('hidden');

    try {
        const { data: orders, error } = await window.fetchData('request_orders');
        if (error) throw error;
        
        const { data: orderItems } = await window.fetchData('request_order_items');
        const { data: greenbeans } = await window.fetchData('green_coffee');
        const { data: recipes } = await window.fetchData('blend_recipes');

        const pendingOrders = (orders || []).filter(o => o.status === 'Pending Approval');
        
        loader.classList.add('hidden');

        if (pendingOrders.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">No pending orders to approve.</div>';
            return;
        }

        // Sort oldest first
        pendingOrders.sort((a, b) => new Date(a.order_date) - new Date(b.order_date));

        for (const order of pendingOrders) {
            const items = (orderItems || []).filter(i => i.request_order_id === order.id);
            let itemsHtml = '';

            items.forEach(item => {
                let itemName = 'Unknown';
                if (item.coffee_type === 'Single') {
                    const gb = (greenbeans || []).find(g => g.id === item.single_coffee_id);
                    if (gb) itemName = gb.name;
                } else if (item.coffee_type === 'Blend') {
                    const rec = (recipes || []).find(r => r.id === item.blend_recipe_id);
                    if (rec) itemName = rec.name;
                }
                itemsHtml += `<div style="margin-bottom:4px;">&bull; ${itemName} - ${item.bag_size_g}g (${item.quantity_requested} bags)</div>`;
            });

            const card = document.createElement('div');
            card.className = 'order-card';
            card.innerHTML = `
                <div class="order-header">
                    <span class="order-title">${order.order_number || 'ORD-' + order.id}</span>
                    <span class="order-badge">Pending</span>
                </div>
                <div class="order-detail"><strong>Sales:</strong> ${order.sales_name || '-'}</div>
                <div class="order-detail"><strong>Date:</strong> ${order.order_date}</div>
                ${order.notes ? `<div class="order-detail"><strong>Notes:</strong> ${order.notes}</div>` : ''}
                <div class="order-items">
                    <strong>Items Requested:</strong>
                    <div style="margin-top:4px;">${itemsHtml || '-'}</div>
                </div>
                <div class="action-bar">
                    <button class="btn btn-outline btn-reject" onclick="handleReject(${order.id})">Reject</button>
                    <button class="btn btn-approve" onclick="handleApprove(${order.id})">
                        <i class="lucide-check" style="width:16px; height:16px;"></i> Approve
                    </button>
                </div>
            `;
            container.appendChild(card);
        }

        // Re-init lucide icons if defined
        if (window.lucide) {
            window.lucide.createIcons();
        }

    } catch (err) {
        loader.classList.add('hidden');
        container.innerHTML = `<div style="color:var(--danger); padding:20px; text-align:center;">Failed to load data: ${err.message}</div>`;
    }
}

async function handleApprove(orderId) {
    if (!confirm('Are you sure you want to approve this order?')) return;
    
    try {
        const { data: orders } = await window.fetchData('request_orders');
        const order = orders.find(o => o.id === orderId);
        if (order) {
            order.status = 'Preparing';
            await window.saveData('request_orders', order);
            
            // Also update items item_status
            const { data: items } = await window.fetchData('request_order_items');
            const relatedItems = items.filter(i => i.request_order_id === orderId);
            for (const item of relatedItems) {
                // simple assumption: push to packing preparing or pending roast
                item.item_status = 'Packing Preparing';
                item.quantity_pending = item.quantity_requested; // all pending to be packed
                await window.saveData('request_order_items', item);
            }
            
            loadPendingOrders();
        }
    } catch(err) {
        alert('Error: ' + err.message);
    }
}

async function handleReject(orderId) {
    if (!confirm('Are you sure you want to reject and cancel this order?')) return;
    
    try {
        const { data: orders } = await window.fetchData('request_orders');
        const order = orders.find(o => o.id === orderId);
        if (order) {
            order.status = 'Cancelled';
            await window.saveData('request_orders', order);
            loadPendingOrders();
        }
    } catch(err) {
        alert('Error: ' + err.message);
    }
}
