// ROASTING MODULE - ROASTERY MANAGER V2
// Plain script (shared global scope — NOT an ES module). Split out of app.js
// during the V1 refactor. Covers Roasting Plans, Batch Logs, Blend Recipes,
// Production Potential, Daily Achievement, and the barcode-scan quick-roast
// flow. Load order: after db.js/auth.js/greenbean.js, before app.js.
//
// exportToExcel/showBarcodeLabels/printSingleBarcode/printAllBarcodes stayed
// in app.js — they're genuinely shared utilities called from multiple
// modules (greenbean, roasting, packing, reports), not roasting-specific.

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
        case 'tab-custom-blend':
            await loadCustomBlendSection();
            break;
        case 'tab-code-definitions':
            await loadCodeDefinitionsTable();
            break;
        case 'tab-recipe-potential':
            await loadRecipeProductionPotential();
            break;
        case 'tab-daily-achievement':
            await loadDailyAchievementTable();
            break;
    }
    enforceGranularPermissions();
}

// // --- TAB 2: Production Potential ---
async function loadRecipeProductionPotential() {
    const [
        { data: greenbeans },
        { data: recipes },
        { data: ingredients },
        { data: machines }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('blend_ingredients'),
        fetchData('machines')
    ]);
    
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
        let hasAlmostEmptyComponent = false;
        const globalMinGB = companySettings.min_stock_greenbean_kg || 0;
        
        recipeIngredients.forEach(ing => {
            const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
            const stock = gb ? parseFloat(gb.stock_kg || 0) : 0;
            const ratio = parseFloat(ing.percentage) / 100;
            
            if (stock <= (globalMinGB * 1.2)) {
                hasAlmostEmptyComponent = true;
            }

            const itemLimit = ratio > 0 ? stock / ratio : Infinity;
            if (itemLimit < maxBlendWeight) {
                maxBlendWeight = itemLimit;
            }
        });

        if (maxBlendWeight === Infinity) maxBlendWeight = 0;
        const potentialYield = maxBlendWeight * 0.85;

        const displayName = recipe.name;

        list.push({
            type: 'Blend',
            name: displayName,
            code: recipe.code,
            recipeId: recipe.id,
            rawStock: maxBlendWeight,
            potentialYield: potentialYield,
            hasAlmostEmptyComponent: hasAlmostEmptyComponent
        });
    });

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center-muted">No potential stock or recipes configured.</td></tr>`;
        return;
    }

    // Sort alphabetically by coffee name
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    list.forEach(item => {
        const tr = document.createElement('tr');
        const isSingle = item.type === 'Single Origin';
        const typeLabel = isSingle ? window.t('potential_single') : window.t('potential_blend');
        const badgeClass = isSingle ? 'badge badge-single' : 'badge badge-blend';

        // Styling for potential yield
        const isPotentialLow = item.potentialYield < (companySettings.min_production_potential_kg || 0);
        const potStyle = isPotentialLow ? 'color: var(--danger);' : '';
        
        let componentWarning = '';
        if (item.type === 'Blend') {
            tr.style.cursor = 'pointer';
            tr.className = 'table-row-hover';

            if (item.hasAlmostEmptyComponent) {
                componentWarning = `<span style="display:inline-block; margin-left: 8px; background:var(--danger); color:white; font-size:0.7rem; padding: 2px 6px; border-radius:12px;" title="one or more of this blend component is almost runs out"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-xs"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Low Component</span>`;
            }
            
            tr.addEventListener('click', () => {
                openLowComponentModal(item.recipeId);
            });
        }

        tr.innerHTML = `
            <td><code>${item.code}</code></td>
            <td><strong>${item.name}</strong> ${componentWarning}</td>
            <td><span class="${badgeClass}">${typeLabel}</span></td>
            <td><strong>${item.rawStock.toFixed(1)} ${companySettings.weight_unit}</strong></td>
            <td style="${potStyle}"><strong>${item.potentialYield.toFixed(1)} ${companySettings.weight_unit}</strong></td>
        `;
        tbody.appendChild(tr);
    });
    applyFiltersForTable(document.querySelector('#tab-recipe-potential table'));
}

// ============================================================
// DAILY ACHIEVEMENT TABLE
// ============================================================
async function loadDailyAchievementTable() {
    const [
        { data: batches },
        { data: machines },
        { data: greenbeans },
        { data: recipes }
    ] = await Promise.all([
        fetchData('roast_batches'),
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_recipes')
    ]);

    const thead = document.getElementById('daily-achievement-thead');
    const tbody = document.getElementById('daily-achievement-tbody');
    if (!thead || !tbody) return;

    const machineList = machines || [];

    // Build thead - 2 rows
    let headerRow1 = '<tr><th rowspan="2" class="va-middle">Date</th>';
    let headerRow2 = '<tr>';
    machineList.forEach(m => {
        headerRow1 += `<th colspan="2" style="text-align: center; border-bottom: 1px solid var(--border);">${m.name}</th>`;
        headerRow2 += `<th style="text-align: center; font-size: 0.75rem;">Greenbean</th><th style="text-align: center; font-size: 0.75rem;">Yield</th>`;
    });
    headerRow1 += '<th colspan="2" style="text-align: center; border-bottom: 1px solid var(--border); font-weight: 800;">Total</th></tr>';
    headerRow2 += '<th style="text-align: center; font-size: 0.75rem; font-weight: 700;">Greenbean</th><th style="text-align: center; font-size: 0.75rem; font-weight: 700;">Yield</th></tr>';
    thead.innerHTML = headerRow1 + headerRow2;

    // Group batches by date
    const dateMap = {};
    (batches || []).forEach(b => {
        const d = b.roast_date || (b.created_at ? b.created_at.split('T')[0] : null);
        if (!d) return;
        if (!dateMap[d]) dateMap[d] = [];
        dateMap[d].push(b);
    });

    const sortedDates = Object.keys(dateMap).sort((a, b) => new Date(b) - new Date(a));

    tbody.innerHTML = '';
    sortedDates.forEach(date => {
        const dayBatches = dateMap[date];
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.className = 'table-row-hover';

        let html = `<td>${date}</td>`;
        let grandInput = 0, grandOutput = 0;

        machineList.forEach(m => {
            const machineBatches = dayBatches.filter(b => b.machine_id === m.id);
            const totalInput = machineBatches.reduce((sum, b) => sum + (parseFloat(b.input_weight_kg) || 0), 0);
            const totalOutput = machineBatches.reduce((sum, b) => sum + (parseFloat(b.output_weight_kg) || 0), 0);
            const yieldPct = totalInput > 0 ? ((totalOutput / totalInput) * 100).toFixed(1) : '-';
            grandInput += totalInput;
            grandOutput += totalOutput;

            html += `<td class="text-center">${totalInput > 0 ? totalInput.toFixed(1) + ' kg' : '<span class="text-muted-color">-</span>'}</td>`;
            html += `<td class="text-center">${totalOutput > 0 ? totalOutput.toFixed(1) + ' kg <span style="font-size:0.7rem; color:var(--text-muted);">(' + yieldPct + '%)</span>' : '<span class="text-muted-color">-</span>'}</td>`;
        });

        const grandYieldPct = grandInput > 0 ? ((grandOutput / grandInput) * 100).toFixed(1) : '-';
        html += `<td style="text-align: center; font-weight: 700;">${grandInput > 0 ? grandInput.toFixed(1) + ' kg' : '-'}</td>`;
        html += `<td style="text-align: center; font-weight: 700;">${grandOutput > 0 ? grandOutput.toFixed(1) + ' kg <span style="font-size:0.7rem; color:var(--text-muted);">(' + grandYieldPct + '%)</span>' : '-'}</td>`;

        tr.innerHTML = html;
        tr.addEventListener('click', () => openDailyDetailPopup(date, dayBatches, machineList, greenbeans, recipes));
        tbody.appendChild(tr);
    });

    // Export button
    const exportBtn = document.getElementById('btn-export-daily-achievement');
    if (exportBtn) {
        exportBtn.onclick = () => exportDailyAchievementToExcel(batches, machineList, greenbeans, recipes);
    }

    // Close popup handler
    const closeBtn = document.getElementById('btn-close-daily-detail');
    if (closeBtn) {
        closeBtn.onclick = () => document.getElementById('daily-detail-overlay').classList.add('hidden');
    }
}

function openDailyDetailPopup(date, dayBatches, machineList, greenbeans, recipes) {
    const overlay = document.getElementById('daily-detail-overlay');
    const titleEl = document.getElementById('daily-detail-title');
    const thead = document.getElementById('daily-detail-thead');
    const tbody = document.getElementById('daily-detail-tbody');

    titleEl.textContent = `Daily Detail — ${date}`;

    // Build coffee map: { coffeeName: { machineId: { input, output } } }
    const coffeeMap = {};
    dayBatches.forEach(b => {
        let coffeeName = '';
        if (b.coffee_type === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === b.single_coffee_id);
            coffeeName = gb ? gb.name : 'Single Origin';
        } else {
            const r = (recipes || []).find(rec => rec.id === b.blend_recipe_id);
            coffeeName = r ? r.name : 'Blend Recipe';
        }

        if (!coffeeMap[coffeeName]) coffeeMap[coffeeName] = {};
        if (!coffeeMap[coffeeName][b.machine_id]) coffeeMap[coffeeName][b.machine_id] = { input: 0, output: 0 };
        coffeeMap[coffeeName][b.machine_id].input += parseFloat(b.input_weight_kg) || 0;
        coffeeMap[coffeeName][b.machine_id].output += parseFloat(b.output_weight_kg) || 0;
    });

    // thead
    let thRow = '<tr><th>Coffee Name</th>';
    machineList.forEach(m => { thRow += `<th class="text-center">${m.name}</th>`; });
    thRow += '<th style="text-align: center; font-weight: 800;">Total</th></tr>';
    thead.innerHTML = thRow;

    // tbody
    tbody.innerHTML = '';
    const machineTotals = {};
    machineList.forEach(m => { machineTotals[m.id] = 0; });
    let totalAll = 0;

    Object.keys(coffeeMap).sort().forEach(coffeeName => {
        const tr = document.createElement('tr');
        let html = `<td><strong>${coffeeName}</strong></td>`;
        let rowTotal = 0;

        machineList.forEach(m => {
            const data = coffeeMap[coffeeName][m.id];
            const output = data ? data.output : 0;
            rowTotal += output;
            machineTotals[m.id] += output;
            html += `<td class="text-center">${output > 0 ? output.toFixed(1) + ' kg' : '<span class="text-muted-color">-</span>'}</td>`;
        });

        totalAll += rowTotal;
        html += `<td style="text-align: center; font-weight: 700;">${rowTotal > 0 ? rowTotal.toFixed(1) + ' kg' : '-'}</td>`;
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });

    // Total row
    const totalTr = document.createElement('tr');
    totalTr.style.cssText = 'font-weight: 700; border-top: 2px solid var(--border); background: rgba(255,255,255,0.03);';
    let totalHtml = '<td><strong>Total</strong></td>';
    machineList.forEach(m => {
        const val = machineTotals[m.id];
        totalHtml += `<td class="text-center">${val > 0 ? val.toFixed(1) + ' kg' : '-'}</td>`;
    });
    totalHtml += `<td style="text-align: center; color: var(--primary);">${totalAll > 0 ? totalAll.toFixed(1) + ' kg' : '-'}</td>`;
    totalTr.innerHTML = totalHtml;
    tbody.appendChild(totalTr);

    overlay.classList.remove('hidden');
}

function exportDailyAchievementToExcel(batches, machineList, greenbeans, recipes) {
    // Show date range picker popup
    const popup = document.createElement('div');
    popup.className = 'overlay';
    popup.style.zIndex = '2100';
    popup.innerHTML = `
        <div class="overlay-card" style="max-width: 380px; text-align: center; padding: 24px;">
            <h3 style="margin-bottom: 16px; font-weight: 700; color: var(--text-primary);">Export Daily Achievement</h3>
            <div style="display: flex; gap: 12px; margin-bottom: 16px;">
                <div class="flex-1">
                    <label class="form-label">From</label>
                    <input type="date" id="exp-da-from" class="form-control">
                </div>
                <div class="flex-1">
                    <label class="form-label">To</label>
                    <input type="date" id="exp-da-to" class="form-control">
                </div>
            </div>
            <div style="display: flex; gap: 12px; justify-content: center;">
                <button class="btn btn-secondary" id="exp-da-cancel" style="min-width: 80px;">Cancel</button>
                <button class="btn btn-primary" id="exp-da-confirm" style="min-width: 80px;">Export</button>
            </div>
        </div>
    `;
    document.body.appendChild(popup);

    // Default dates
    const allDates = (batches || []).map(b => b.roast_date || (b.created_at ? b.created_at.split('T')[0] : '')).filter(d => d).sort();
    document.getElementById('exp-da-from').value = allDates.length > 0 ? allDates[0] : '';
    document.getElementById('exp-da-to').value = allDates.length > 0 ? allDates[allDates.length - 1] : '';

    document.getElementById('exp-da-cancel').onclick = () => popup.remove();
    document.getElementById('exp-da-confirm').onclick = () => {
        const from = document.getElementById('exp-da-from').value;
        const to = document.getElementById('exp-da-to').value;

        // Filter batches
        const filtered = (batches || []).filter(b => {
            const d = b.roast_date || (b.created_at ? b.created_at.split('T')[0] : '');
            return d >= from && d <= to;
        });

        // Build flat rows: Date, Machine, Coffee, Greenbean (kg), Yield (kg)
        // Group by date + machine + coffee
        const rowMap = {};
        filtered.forEach(b => {
            const d = b.roast_date || (b.created_at ? b.created_at.split('T')[0] : '');
            const mach = machineList.find(m => m.id === b.machine_id);
            const machName = mach ? mach.name : 'Unknown';
            let coffeeName = '';
            if (b.coffee_type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === b.single_coffee_id);
                coffeeName = gb ? gb.name : 'Single Origin';
            } else {
                const r = (recipes || []).find(rec => rec.id === b.blend_recipe_id);
                coffeeName = r ? r.name : 'Blend Recipe';
            }
            const key = `${d}||${machName}||${coffeeName}`;
            if (!rowMap[key]) rowMap[key] = { date: d, machine: machName, coffee: coffeeName, input: 0, output: 0 };
            rowMap[key].input += parseFloat(b.input_weight_kg) || 0;
            rowMap[key].output += parseFloat(b.output_weight_kg) || 0;
        });

        const rows = Object.values(rowMap).sort((a, b) => {
            if (a.date !== b.date) return new Date(b.date) - new Date(a.date);
            if (a.machine !== b.machine) return a.machine.localeCompare(b.machine);
            return a.coffee.localeCompare(b.coffee);
        });

        // Build HTML table for export
        let tableHtml = '<table><thead><tr>';
        tableHtml += '<th style="background:#1a5632; color:white; font-weight:bold; padding:10px; border:1px solid #ccc;">Date</th>';
        tableHtml += '<th style="background:#1a5632; color:white; font-weight:bold; padding:10px; border:1px solid #ccc;">Machine</th>';
        tableHtml += '<th style="background:#1a5632; color:white; font-weight:bold; padding:10px; border:1px solid #ccc;">Coffee</th>';
        tableHtml += '<th style="background:#1a5632; color:white; font-weight:bold; padding:10px; border:1px solid #ccc;">Greenbean (kg)</th>';
        tableHtml += '<th style="background:#1a5632; color:white; font-weight:bold; padding:10px; border:1px solid #ccc;">Yield (kg)</th>';
        tableHtml += '</tr></thead><tbody>';

        rows.forEach((r, i) => {
            const bg = i % 2 === 0 ? '#ffffff' : '#f2f2f2';
            tableHtml += `<tr style="background:${bg};">`;
            tableHtml += `<td style="padding:8px; border:1px solid #ccc;">${r.date}</td>`;
            tableHtml += `<td style="padding:8px; border:1px solid #ccc;">${r.machine}</td>`;
            tableHtml += `<td style="padding:8px; border:1px solid #ccc;">${r.coffee}</td>`;
            tableHtml += `<td style="padding:8px; border:1px solid #ccc; text-align:right;">${r.input.toFixed(2)}</td>`;
            tableHtml += `<td style="padding:8px; border:1px solid #ccc; text-align:right;">${r.output.toFixed(2)}</td>`;
            tableHtml += '</tr>';
        });
        tableHtml += '</tbody></table>';

        const blob = new Blob(
            ['\uFEFF<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>' + tableHtml + '</body></html>'],
            { type: 'application/vnd.ms-excel' }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `daily_achievement_${from}_to_${to}.xls`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        popup.remove();
    };
}

async function openLowComponentModal(recipeId) {
    const [
        { data: recipes },
        { data: ingredients },
        { data: greenbeans }
    ] = await Promise.all([
        fetchData('blend_recipes'),
        fetchData('blend_ingredients'),
        fetchData('green_coffee')
    ]);

    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) return;

    const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === recipeId);
    const globalMinGB = companySettings.min_stock_greenbean_kg || 0;
    const threshold = globalMinGB * 1.2;

    let maxBlendWeight = Infinity;
    
    recipeIngs.forEach(ing => {
        const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
        const stock = gb ? parseFloat(gb.stock_kg || 0) : 0;
        const ratio = parseFloat(ing.percentage) / 100;
        
        const itemLimit = ratio > 0 ? stock / ratio : Infinity;
        if (itemLimit < maxBlendWeight) {
            maxBlendWeight = itemLimit;
        }
    });

    const potentialYield = maxBlendWeight * 0.85;

    const ingsHtml = recipeIngs.map(ing => {
        const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
        if (!gb) return '';
        const stock = parseFloat(gb.stock_kg || 0);
        const isLow = stock <= threshold;
        const ratio = parseFloat(ing.percentage) / 100;
        const maxUsable = (maxBlendWeight * ratio).toFixed(1);
        
        const currentStockLbl = window.t ? window.t('lbl_current_stock') : 'Current Stock';
        const usableLbl = window.t ? window.t('lbl_usable') : 'Usable';

        if (isLow) {
            return `
                <div style="padding: 10px; border: 1px solid var(--danger); background: rgba(239,68,68,0.05); border-radius: 6px; margin-bottom: 8px;">
                    <div style="font-weight: 600; color: var(--danger); margin-bottom: 4px;">${gb.name} (${ing.percentage}%)</div>
                    <div style="font-size: 0.9rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 2px;">
                        <span>${currentStockLbl}: <strong style="color: var(--danger);">${stock.toFixed(1)} ${companySettings.weight_unit}</strong></span>
                        <span>${usableLbl}: <strong>${maxUsable} ${companySettings.weight_unit}</strong></span>
                    </div>
                </div>
            `;
        } else {
            return `
                <div style="padding: 10px; border: 1px solid var(--border); background: var(--bg-hover); border-radius: 6px; margin-bottom: 8px;">
                    <div style="font-weight: 600; color: var(--text-main); margin-bottom: 4px;">${gb.name} (${ing.percentage}%)</div>
                    <div style="font-size: 0.9rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 2px;">
                        <span>${currentStockLbl}: <strong>${stock.toFixed(1)} ${companySettings.weight_unit}</strong></span>
                        <span>${usableLbl}: <strong>${maxUsable} ${companySettings.weight_unit}</strong></span>
                    </div>
                </div>
            `;
        }
    }).join('');

    const modalTitle = window.t ? window.t('modal_blend_component_details') : 'Blend Component Details';
    const subheaderText = window.t ? window.t('component_status_for').replace('{name}', recipe.name) : `${recipe.name} Component Status`;
    const maxGBAvailText = window.t ? window.t('lbl_max_greenbean_avail') : 'Max. Greenbean Available';
    const potentialProductionText = window.t ? window.t('lbl_potential_production') : 'Potential Production';
    const ingredientsTitle = window.t ? window.t('lbl_ingredients_title') : 'Ingredients';
    const closeBtnText = window.t ? window.t('btn_close') : 'Close';

    const html = `
        <div style="padding: 10px;">
            <div style="margin-bottom: 16px; font-size: 1.05rem;">
                <strong>${subheaderText}</strong>
            </div>
            
            <div style="margin-bottom: 16px; padding: 12px; border-radius: 6px; background: rgba(59,130,246,0.05); border: 1px solid var(--info);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                    <span>${maxGBAvailText}:</span>
                    <strong>${maxBlendWeight.toFixed(1)} ${companySettings.weight_unit}</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>${potentialProductionText}:</span>
                    <strong>${potentialYield.toFixed(1)} ${companySettings.weight_unit}</strong>
                </div>
            </div>

            <div style="margin-bottom: 8px; font-weight: 600;">${ingredientsTitle}:</div>
            ${ingsHtml}
            <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">${closeBtnText}</button>
            </div>
        </div>
    `;

    openModal(modalTitle, html, '450px');
}

// --- TAB: Custom Blend history ---
// The history is just the existing bulk_roasted_coffee + post_blend_components
// data (from the Custom Blend flow in js/packing.js openCustomBlendModal),
// surfaced in its own tab instead of a brand-new schema. Filtered to exclude
// 1I-b's recipe-assembled blends (those carry source_plan_id) — Custom Blend
// rows never have one, since they're populated via post_blend_components
// instead of a parent roasting plan.
async function loadCustomBlendSection() {
    const tbody = document.getElementById('custom-blend-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const [
        { data: bulkList },
        { data: components },
        { data: packedLots },
        { data: packedList }
    ] = await Promise.all([
        fetchData('bulk_roasted_coffee'),
        fetchData('post_blend_components'),
        fetchData('packed_coffee_lots'),
        fetchData('packed_coffee')
    ]);

    const customBlends = (bulkList || [])
        .filter(b => b.is_post_blend && !b.source_plan_id)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    if (customBlends.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center-muted">No custom blends created yet.</td></tr>';
        return;
    }

    customBlends.forEach(bulk => {
        const comps = (components || []).filter(c => c.blend_bulk_id === bulk.id);
        const totalKg = comps.reduce((s, c) => s + (parseFloat(c.kg) || 0), 0);
        const kgByLabel = new Map();
        comps.forEach(c => {
            let label = 'Unknown';
            if (c.source_type === 'Bulk') {
                const src = (bulkList || []).find(b => b.id === c.source_bulk_id);
                label = src ? src.coffee_name : 'Unknown';
            } else {
                const lot = (packedLots || []).find(l => l.id === c.source_packed_lot_id);
                const packed = lot ? (packedList || []).find(p => p.id === lot.packed_coffee_id) : null;
                label = packed ? (packed.custom_coffee_name || 'Roasted Coffee') : 'Unknown';
            }
            kgByLabel.set(label, (kgByLabel.get(label) || 0) + (parseFloat(c.kg) || 0));
        });
        const compSummary = Array.from(kgByLabel.entries()).map(([label, kg]) => {
            const pct = totalKg > 0 ? (kg / totalKg * 100) : 0;
            return `${label} ${pct.toFixed(0)}%`;
        }).join(' · ');

        const dateStr = (bulk.created_at || '').split('T')[0] || '-';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td><code>${bulk.custom_blend_code || '-'}</code></td>
            <td><code>${bulk.custom_coffee_code || '-'}</code></td>
            <td><strong>${bulk.custom_blend_name || bulk.coffee_name}</strong></td>
            <td style="font-size:0.8rem; color:var(--text-muted);">${compSummary || '-'}</td>
            <td>${totalKg.toFixed(2)} kg</td>
        `;
        tbody.appendChild(tr);
    });
}

// --- TAB: Code Definitions ---
// Maps a green_coffee.code value to a stable trade name shown to Sales (e.g.
// code 2 = "Fantastica") — see js/sales.js openSalesRequestModal for where
// this groups the Single Origin picker, and database/v2_code_definitions_migration.sql.
// Moved here from Settings > Production per user request (2026-07-21) — it's
// a Production-tab concept now, not a settings toggle.
async function loadCodeDefinitionsTable() {
    const tbody = document.getElementById('code-defs-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const [{ data: defs }, { data: greenbeans }] = await Promise.all([
        fetchData('code_definitions'),
        fetchData('green_coffee')
    ]);

    if (!defs || defs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center-muted">No code definitions found.</td></tr>`;
        return;
    }

    renderCodeDefinitionsRows(tbody, defs, greenbeans || []);
}

function renderCodeDefinitionsRows(tbody, defs, greenbeans) {
    [...defs].sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true })).forEach(d => {
        const origins = greenbeans.filter(g => g.code === d.code).map(g => g.name);
        const originsHtml = origins.length
            ? origins.map(n => `<span style="font-size:0.75rem; color:var(--text-secondary); background:var(--bg-glass-active); padding:2px 8px; border-radius:999px; margin-right:4px; display:inline-block; margin-bottom:2px;">${n}</span>`).join('')
            : `<span style="font-size:0.8rem; color:var(--text-muted);">No origins yet</span>`;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${d.code}</code></td>
            <td><strong>${d.name}</strong></td>
            <td>${originsHtml}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-outline btn-sm btn-edit-code-def" data-id="${d.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle-mr-1"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Edit</button>
                    <button class="btn btn-danger btn-sm btn-delete-code-def" data-id="${d.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-edit-code-def').forEach(btn => {
        btn.addEventListener('click', () => openCodeDefinitionModal(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-delete-code-def').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (await showDeleteConfirmModal('this code definition')) {
                await deleteData('code_definitions', parseInt(btn.getAttribute('data-id')));
                loadCodeDefinitionsTable();
            }
        });
    });
}

async function openCodeDefinitionModal(id = null) {
    let def = { code: '', name: '' };
    if (id) {
        const { data: defs } = await fetchData('code_definitions');
        const found = defs.find(d => d.id === id);
        if (found) def = found;
    }

    const html = `
        <div id="modal-code-def-form">
            <div class="form-group">
                <label class="form-label">Code</label>
                <input type="text" id="m-cd-code" class="form-control" value="${def.code}" placeholder="e.g. 2" required>
            </div>
            <div class="form-group">
                <label class="form-label">Trade Name</label>
                <input type="text" id="m-cd-name" class="form-control" value="${def.name}" placeholder="e.g. Fantastica" required>
                <p style="margin:6px 0 0; font-size:0.75rem; color:var(--text-muted);">Shown to Sales instead of the origin's real name.</p>
            </div>
            <button type="button" id="btn-save-code-def" class="btn btn-primary" style="width:100%; margin-top:24px;">Save Code Definition</button>
        </div>
    `;

    openModal(id ? 'Edit Code Definition' : 'Add Code Definition', html);

    document.getElementById('btn-save-code-def').onclick = async () => {
        const codeInput = document.getElementById('m-cd-code').value.trim();
        const nameInput = document.getElementById('m-cd-name').value.trim();

        if (!codeInput || !nameInput) {
            alert("Please fill all required fields.");
            return;
        }

        const { data: existingDefs } = await fetchData('code_definitions');
        const duplicate = (existingDefs || []).find(d => d.code === codeInput && d.id !== id);
        if (duplicate) {
            alert(`Code "${codeInput}" is already defined as "${duplicate.name}".`);
            return;
        }

        const saveDataObj = { code: codeInput, name: nameInput };
        if (id) saveDataObj.id = id;

        const { error } = await saveData('code_definitions', saveDataObj);
        if (error) {
            alert('Failed to save code definition: ' + error.message);
            return;
        }

        modalContainer.classList.add('hidden');
        loadCodeDefinitionsTable();
    };
}

const btnAddCodeDef = document.getElementById('btn-add-code-def');
if (btnAddCodeDef) {
    btnAddCodeDef.addEventListener('click', () => openCodeDefinitionModal());
}

// --- TAB 3: Blend Recipes ---
// V2 1I-b: Pre-Blend (green coffee blended before roasting, the original
// recipe kind) vs Post-Blend (already-roasted singles auto-exploded into a
// per-origin roasting plan then reassembled — see openRoastPlanModal). Same
// blend_recipes/blend_ingredients data model, just a is_post_blend flag.
// All recipes are shown together in one table, distinguished by a Type badge
// (the Pre-Blend/Post-Blend toggle buttons were removed per user request).

async function loadBlendRecipes() {
    const [
        { data: allRecipes },
        { data: ingredients },
        { data: greenbeans },
        { data: machines }
    ] = await Promise.all([
        fetchData('blend_recipes'),
        fetchData('blend_ingredients'),
        fetchData('green_coffee'),
        fetchData('machines')
    ]);

    const recipes = allRecipes || [];

    const tbody = document.getElementById('recipe-table-body');
    tbody.innerHTML = '';

    if (recipes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center-muted">${window.t('msg_no_recipes')}</td></tr>`;
        return;
    }

    const sortedRecipes = [...recipes].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    sortedRecipes.forEach(recipe => {
        // Find ingredients
        const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === recipe.id);
        const ingTexts = recipeIngs.map(ing => {
            const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
            return gb ? `<div style="padding: 4px 0; border-bottom: 1px solid var(--border-light);">${gb.name} <strong>(${ing.percentage}%)</strong></div>` : `<div style="padding: 4px 0; border-bottom: 1px solid var(--border-light);">Unknown <strong>(${ing.percentage}%)</strong></div>`;
        }).join('');

        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.className = 'table-row-hover';
        tr.innerHTML = `
            <td class="va-middle"><code>${recipe.code}</code></td>
            <td class="va-middle"><strong>${recipe.name}</strong></td>
            <td class="va-middle"><div style="display: flex; flex-direction: column;">${ingTexts || '<span style="color: var(--text-muted)">No Ingredients</span>'}</div></td>
            <td class="va-middle"><span class="badge ${recipe.is_post_blend ? 'badge-post-blend' : 'badge-pre-blend'}">${recipe.is_post_blend ? window.t('recipes_filter_post') : window.t('recipes_filter_pre')}</span></td>
            <td class="va-middle">
                <button class="btn btn-secondary btn-sm btn-edit-recipe" data-id="${recipe.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
                <button class="btn btn-danger btn-sm btn-delete-recipe" data-id="${recipe.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
                <button class="btn btn-secondary btn-sm btn-barcode-recipe ml-1" data-id="${recipe.id}" data-name="${recipe.name}" title="Generate Barcodes" ><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="va-middle"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="14" y1="8" x2="14" y2="16"/><line x1="18" y1="8" x2="18" y2="16"/></svg></button>
            </td>
        `;
        
        tr.addEventListener('click', (e) => {
            if (e.target.closest('button')) return; // Ignore if clicking action buttons
            openViewRecipeModal(recipe.id);
        });
        
        const btnEdit = tr.querySelector('.btn-edit-recipe');
        const btnDelete = tr.querySelector('.btn-delete-recipe');
        if (btnEdit) {
            btnEdit.addEventListener('click', (e) => {
                e.stopPropagation();
                openRecipeModal(recipe.id);
            });
        }
        if (btnDelete) {
            btnDelete.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteRecipe(recipe.id);
            });
        }
        const btnBarcode = tr.querySelector('.btn-barcode-recipe');
        if (btnBarcode) {
            btnBarcode.addEventListener('click', (e) => {
                e.stopPropagation();
                showBarcodeLabels('Blend', recipe.id, recipe.name);
            });
        }
        
        tbody.appendChild(tr);
    });

    applyFiltersForTable(document.querySelector('#tab-blend-recipes table'));
}

async function openViewRecipeModal(id) {
    const [
        { data: recipes },
        { data: ingredients },
        { data: greenbeans },
        { data: machines }
    ] = await Promise.all([
        fetchData('blend_recipes'),
        fetchData('blend_ingredients'),
        fetchData('green_coffee'),
        fetchData('machines')
    ]);

    const recipe = recipes.find(r => r.id === id);
    if (!recipe) return;

    const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === id);

    const tableHtml = `
        <div style="overflow-x: auto; margin-bottom: 16px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                <thead>
                    <tr style="background: var(--bg-hover);">
                        <th style="text-align:left; padding:8px; border-bottom:1px solid var(--border);">Ingredients</th>
                        <th style="text-align:left; padding:8px; border-bottom:1px solid var(--border);">Percentage</th>
                        ${machines.map(m => `<th style="text-align:left; padding:8px; border-bottom:1px solid var(--border);">${m.name}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${recipeIngs.map(ing => {
                        const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
                        const name = gb ? gb.name : 'Unknown';
                        const pct = parseFloat(ing.percentage);
                        
                        let machineCols = machines.map(m => {
                            const batchSize = parseFloat(m.ideal_batch_size_g) || 0;
                            const value = (batchSize * (pct / 100)).toFixed(0);
                            return `<td style="padding:8px; border-bottom:1px solid var(--border);">${value}g</td>`;
                        }).join('');
                        
                        return `<tr>
                            <td style="padding:8px; border-bottom:1px solid var(--border);">${name}</td>
                            <td style="padding:8px; border-bottom:1px solid var(--border);"><strong>${pct}%</strong></td>
                            ${machineCols}
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    const html = `
        <div style="padding: 10px;">
            <div style="margin-bottom: 12px; font-size: 1.1rem; color: var(--primary-color);"><strong>${recipe.name}</strong> (<code>${recipe.code}</code>)</div>
            
            <div style="margin-bottom: 8px;"><strong>Ingredients:</strong></div>
            ${tableHtml}
            
            <div style="margin-bottom: 8px;"><strong>Description / Notes:</strong></div>
            <div style="padding: 12px; border: 1px solid var(--border); border-radius: 6px; color: var(--text-secondary); min-height: 60px;">
                ${recipe.description || '<em>No description provided.</em>'}
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Close</button>
            </div>
        </div>
    `;

    openModal('Blend Recipe Details', html, '650px');
}

// --- modal: ADD / EDIT BLEND RECIPE ---
async function openRecipeModal(id = null) {
    const [
        { data: machines },
        { data: greenbeansRaw },
        { data: ingredients },
        { data: greenCoffeeLots }
    ] = await Promise.all([
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('blend_ingredients'),
        fetchData('green_coffee_lots')
    ]);

    // V2 1D: informational only — the blend barcode/consumption logic already
    // auto-resolves each ingredient's oldest lot on its own (see
    // consumeGreenCoffeeLotsFifo in the roast-batch save path); this just
    // surfaces that same recommendation live while building the recipe.
    function findFifoLotCode(greenbeanId) {
        const candidates = (greenCoffeeLots || [])
            .filter(l => l.green_coffee_id === parseInt(greenbeanId) && parseFloat(l.remaining_kg || 0) > 0)
            .sort((a, b) => new Date(a.arrival_date) - new Date(b.arrival_date) || a.id - b.id);
        return candidates[0] ? candidates[0].lot_code : null;
    }
    // Sorted once here so both the ingredient dropdown (built per-row in
    // addComponentRow below) and the "default first coffee" fallback stay
    // alphabetical/consistent.
    const greenbeans = [...(greenbeansRaw || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const defaultMachine = machines[0];
    const defaultCapacity = defaultMachine ? parseFloat(defaultMachine.ideal_batch_size_g) || 5000 : 5000;
    let recipe = { code: '', name: '', description: '' };
    let recipeIngs = [];

    if (id) {
        const { data: recipes } = await fetchData('blend_recipes');
        recipe = recipes.find(r => r.id === id) || recipe;
        recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === id);
    } else {
        // Create an initial empty component row
        recipeIngs = [{ green_coffee_id: greenbeans[0]?.id || '', percentage: 0.0 }];
    }

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

            <div class="form-group" style="margin-top: 4px;">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:500;">
                    <input type="checkbox" id="m-rec-post-blend" ${(id && recipe.is_post_blend) ? 'checked' : ''}>
                    Post-Blend (mix already-roasted singles, instead of roasting the greens together)
                </label>
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

            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Recipe</button>
            </div>
        </form>
    `;

    openModal(id ? 'Edit Coffee Blend Recipe' : 'Create Custom Blend Recipe', html, '550px');

    const componentsList = document.getElementById('recipe-components-list');
    const ratioSumLbl = document.getElementById('ratio-sum-lbl');

    // Populate Initial Component Rows
    recipeIngs.forEach(ing => {
        addComponentRow(ing.green_coffee_id, parseFloat(ing.percentage));
    });

    updateRatioSum();

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

        row.innerHTML = `
            <div class="form-group" style="flex: 2;">
                <select class="form-control comp-select" required>
                    ${greenbeanOpts}
                </select>
                <small class="comp-fifo-lot" style="display:block; color:var(--text-muted); margin-top:2px;"></small>
            </div>
            <div class="form-group flex-1" >
                <input type="number" step="0.1" class="form-control comp-ratio" value="${percentageVal.toFixed(1)}" placeholder="Ratio (%)" required>
            </div>
            <button type="button" class="btn-remove-row">&times;</button>
        `;

        componentsList.appendChild(row);

        const ratioInput = row.querySelector('.comp-ratio');
        const removeBtn = row.querySelector('.btn-remove-row');
        const coffeeSelect = row.querySelector('.comp-select');
        const fifoLabel = row.querySelector('.comp-fifo-lot');

        function updateFifoLabel() {
            const lotCode = findFifoLotCode(coffeeSelect.value);
            fifoLabel.textContent = lotCode ? `FIFO lot: ${lotCode}` : 'FIFO lot: no stock';
        }
        updateFifoLabel();
        coffeeSelect.addEventListener('change', updateFifoLabel);

        ratioInput.addEventListener('input', () => {
            updateRatioSum();
        });

        removeBtn.addEventListener('click', () => {
            row.remove();
            updateRatioSum();
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
            quantity_g: 0
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
            machine_id: null,
            batch_size_g: 0,
            is_post_blend: document.getElementById('m-rec-post-blend').checked,
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
        console.log('[Blend] Saving ingredients:', ingredientsData, 'for recipe id:', activeRecipeId);
        let ingSaveFailed = false;
        for (const ing of ingredientsData) {
            const ingRecord = {
                blend_recipe_id: activeRecipeId,
                green_coffee_id: ing.green_coffee_id,
                percentage: ing.percentage,
                quantity_g: ing.quantity_g || 0
            };
            console.log('[Blend] Inserting ingredient:', ingRecord);
            const { error: ingErr } = await saveData('blend_ingredients', ingRecord);
            if (ingErr) {
                console.error('[Blend] Failed to save ingredient:', ingErr);
                alert('Failed to save ingredient: ' + ingErr.message);
                ingSaveFailed = true;
                break;
            }
        }

        modalContainer.classList.add('hidden');
        loadBlendRecipes();
    });
}

async function deleteRecipe(id) {
    if (await showDeleteConfirmModal('this blend recipe')) {
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
    const [
        { data: plans },
        { data: greenbeans },
        { data: recipes },
        { data: machines }
    ] = await Promise.all([
        fetchData('roasting_plans'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines')
    ]);
    
    const tbody = document.getElementById('plan-table-body');
    tbody.innerHTML = '';

    if (plans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center-muted">${window.t("msg_no_plans")}</td></tr>`;
        return;
    }

    // V2 1I-b: incomplete plans always sit above complete ones (newest first
    // within each group) — so a plan doesn't get buried under a completed
    // one just because the completed one happens to be more recent. Only
    // top-level plans are sorted this way; a post-blend parent's sub-plans
    // render immediately under it regardless of their own dates.
    const topLevelPlans = (plans || []).filter(p => !p.parent_plan_id);
    const sortedPlans = [...topLevelPlans].sort((a, b) => {
        const aDone = a.status === 'Completed' ? 1 : 0;
        const bDone = b.status === 'Completed' ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return new Date(b.plan_date) - new Date(a.plan_date) || b.id - a.id;
    });

    const statusBadgeStyle = (status) =>
        status === 'Completed' ? 'background: rgba(16,185,129,0.15); color: var(--success);' :
        status === 'Stopped' ? 'background: rgba(107,114,128,0.15); color: var(--text-muted);' :
        status === 'In Progress' ? 'background: rgba(245,158,11,0.15); color: var(--warning);' :
        status === 'On Process' ? 'background: rgba(59,130,246,0.15); color: #3b82f6;' :
        'background: rgba(255,255,255,0.05); color: var(--text-muted);';

    function buildPlanRow(plan, { isSubPlan = false, blendBadgeName = null } = {}) {
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
        // Rounded to 2dp: repeated += from multiple batch logs accumulates
        // binary floating-point error (e.g. 18.299999999999997), which showed
        // up raw in the Fulfilled column.
        const targetKg = parseFloat(parseFloat(plan.target_roasted_kg || 0).toFixed(2));
        const fulfilledKg = parseFloat(parseFloat(plan.fulfilled_roasted_kg || 0).toFixed(2));
        if (fulfilledKg >= targetKg && targetKg > 0 && plan.status !== 'Stopped') {
            if (plan.status !== 'Completed') {
                plan.status = 'Completed';
                saveData('roasting_plans', plan);
                syncPlanStatusToOrderItem(plan);
                if (isSubPlan) tryAssemblePostBlend(plan.parent_plan_id);
            }
        }

        const pct = targetKg > 0 ? (fulfilledKg / targetKg) * 100 : 0;
        const displayPct = Math.min(100, pct);

        const badgesHtml = blendBadgeName
            ? `<span style="font-size:0.62rem; font-weight:700; text-transform:uppercase; letter-spacing:0.3px; color:var(--primary); background:var(--primary-glow); border-radius:4px; padding:1px 6px; margin-right:6px; vertical-align:middle;">Post-Blend</span>${isSubPlan ? `<span style="font-size:0.7rem; color:var(--text-muted);">${blendBadgeName} —</span> ` : ''}`
            : '';

        const canStop = isSubPlan && plan.status !== 'Completed' && plan.status !== 'Stopped';

        const tr = document.createElement('tr');
        if (isSubPlan) tr.style.background = 'rgba(255,255,255,0.015)';
        tr.innerHTML = `
            <td>${isSubPlan ? '<span style="color:var(--text-muted); padding-left:16px;">↳</span> ' : ''}${plan.plan_date}${plan.order_ref ? `<br/><span style="font-size:0.68rem; color:#0891b2; font-weight:600; background:rgba(6,182,212,0.1); padding:1px 6px; border-radius:4px; display:inline-block; margin-top:2px;">${plan.order_ref}</span>` : ''}</td>
            <td>${badgesHtml}<strong>${coffeeName}</strong></td>
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
            <td><span style="font-size:0.75rem; padding: 2px 8px; border-radius: 9999px; font-weight:700; ${statusBadgeStyle(plan.status)}">${plan.status}</span></td>
            <td>
                <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    ${canStop ? `<button class="btn btn-secondary btn-sm btn-stop-subplan" data-id="${plan.id}" title="Stop this component">Stop</button>` : ''}
                    ${!isSubPlan && hasPermission('roasting_plan_edit') ? `<button class="btn btn-secondary btn-sm btn-edit-plan" data-id="${plan.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>` : ''}
                    ${!isSubPlan && hasPermission('roasting_plan_delete') ? `<button class="btn btn-danger btn-sm btn-delete-plan" data-id="${plan.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>` : ''}
                </div>
            </td>
        `;
        return tr;
    }

    sortedPlans.forEach(plan => {
        const isPostBlendParent = plan.coffee_type === 'Blend' && !!plan.blend_recipe_id &&
            (plans || []).some(p => p.parent_plan_id === plan.id);
        const recipeForBadge = isPostBlendParent ? recipes.find(r => r.id === plan.blend_recipe_id) : null;

        const tr = buildPlanRow(plan, { isSubPlan: false, blendBadgeName: isPostBlendParent ? (recipeForBadge ? recipeForBadge.name : 'Post-Blend') : null });

        if (isPostBlendParent && plan.status !== 'Completed') {
            const actionsCell = tr.querySelector('td:last-child > div');
            if (actionsCell) {
                const finalizeBtn = document.createElement('button');
                finalizeBtn.className = 'btn btn-secondary btn-sm btn-finalize-postblend';
                finalizeBtn.setAttribute('data-id', plan.id);
                finalizeBtn.title = 'Finalize now, even if some components are still short';
                finalizeBtn.textContent = 'Finalize Now';
                actionsCell.prepend(finalizeBtn);
            }
        }
        tbody.appendChild(tr);

        if (isPostBlendParent) {
            const children = (plans || [])
                .filter(p => p.parent_plan_id === plan.id)
                .sort((a, b) => a.id - b.id);
            children.forEach(child => {
                tbody.appendChild(buildPlanRow(child, { isSubPlan: true, blendBadgeName: recipeForBadge ? recipeForBadge.name : 'Post-Blend' }));
            });
        }
    });

    document.querySelectorAll('.btn-edit-plan').forEach(btn => {
        btn.addEventListener('click', () => openRoastPlanModal(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-delete-plan').forEach(btn => {
        btn.addEventListener('click', () => deletePlan(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-stop-subplan').forEach(btn => {
        btn.addEventListener('click', () => stopPostBlendComponent(parseInt(btn.getAttribute('data-id'))));
    });
    document.querySelectorAll('.btn-finalize-postblend').forEach(btn => {
        btn.addEventListener('click', () => finalizePostBlendNow(parseInt(btn.getAttribute('data-id'))));
    });
    applyFiltersForTable(document.querySelector('#tab-roast-plans table'));
}

async function loadRoastingBatches() {
    const [
        { data: batches },
        { data: greenbeans },
        { data: recipes },
        { data: machines }
    ] = await Promise.all([
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines')
    ]);

    const tbody = document.getElementById('batch-table-body');
    tbody.innerHTML = '';

    if (batches.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center-muted">${window.t("msg_no_batches")}</td></tr>`;
        return;
    }

    const sortedBatches = [...batches].sort((a, b) => new Date(b.roast_date) - new Date(a.roast_date) || b.id - a.id);

    // Registers this table so applyFiltersForTable (js/app.js) filters the
    // FULL sortedBatches list first, then paginates the filtered result —
    // fixes the filter dropdown only ever listing values from whichever
    // page happened to be open (found 2026-07-29). Every row below is now
    // rendered unconditionally; renderPaginationControls (called from
    // applyFiltersForTable at the end of this function) decides which page
    // of the (possibly filtered) rows to actually reveal.
    registerPaginatedFilterTable('tab-roast-logs', {
        getPage: () => batchCurrentPage,
        setPage: (p) => { batchCurrentPage = p; },
        getPageSize: () => batchPageSize,
        paginationContainerId: 'batch-pagination-pages',
        infoElId: 'batch-page-info'
    });

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

    sortedBatches.forEach(batch => {
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
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-xs"><polyline points="20 6 9 17 4 12"/></svg> Approve
                        </button>
                    ` : `
                        <span style="color:var(--success); font-size:0.7rem; font-weight:700; white-space:nowrap;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-inline-xs"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Approved</span>
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
                <button class="btn btn-secondary btn-sm btn-edit-batch" data-id="${batch.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
                <button class="btn btn-danger btn-sm btn-delete-batch" data-id="${batch.id}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="va-middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
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
// The btn-add-plan visibility check (based on the cached role, same as the
// anti-flash IIFEs) lives in app.js, not here — see the comment there for
// why: it touches `currentUser` at top-level/parse time, which is a `let`
// declared in app.js. Since this file loads BEFORE app.js, referencing that
// binding from here would hit it before its declaration runs (temporal dead
// zone) and throw.
if (document.getElementById('btn-custom-packing')) {
    document.getElementById('btn-custom-packing').addEventListener('click', () => {
        openCustomPackingModal();
    });
}
if (document.getElementById('btn-add-custom-blend')) {
    document.getElementById('btn-add-custom-blend').addEventListener('click', () => {
        openCustomBlendModal();
    });
}

async function openRoastPlanModal(editId = null) {
    const [
        { data: greenbeans },
        { data: recipes },
        { data: ingredients },
        { data: plans },
        { data: machines }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('blend_ingredients'),
        fetchData('roasting_plans'),
        fetchData('machines')
    ]);

    let existingPlan = null;
    if (editId) {
        existingPlan = plans.find(p => p.id === editId);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const planDateVal = existingPlan ? existingPlan.plan_date : todayStr;

    // Generate Select Options (alphabetical by coffee name)
    const gbOpts = [...greenbeans].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(g => `<option value="Single-${g.id}">${g.name}</option>`).join('');
    const recOpts = [...recipes].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(r => `<option value="Blend-${r.id}">${r.name}</option>`).join('');
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
            ${editId ? `
            <div class="form-row mt-3" >
                <div class="form-group">
                    <label class="form-label">Status</label>
                    <select id="m-plan-status" class="form-control">
                        <option value="Pending">Pending</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
                    </select>
                </div>
            </div>` : ''}
            
            <div class="form-group mt-3" >
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

            <div class="modal-footer-actions-lg">
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
    
    // Prefill status on edit
    const statusSelect = document.getElementById('m-plan-status');
    if (statusSelect && editId && existingPlan && existingPlan.status) {
        statusSelect.value = existingPlan.status;
    }
    
    // Add event listener to re-evaluate blend compatibility when machine changes
    machineSelect.addEventListener('change', updateAllRowsStockDisplays);

    // Tracks database original stocks for temporary calculations in the form
    const originalStocks = {};
    greenbeans.forEach(gb => {
        originalStocks[gb.id] = parseFloat(gb.stock_kg || 0);
    });

    // Compute how much greenbean stock is already reserved by existing plans in the table
    // (excluding the plan currently being edited)
    const planAllocations = {}; // greenbean_id -> kg reserved by existing plans
    (plans || []).forEach(p => {
        if (editId && p.id === editId) return; // skip the plan being edited
        const targetVal = parseFloat(p.target_roasted_kg) || 0;
        if (targetVal <= 0) return;
        const requiredGb = targetVal / 0.85;
        if (p.coffee_type === 'Single' && p.single_coffee_id) {
            planAllocations[p.single_coffee_id] = (planAllocations[p.single_coffee_id] || 0) + requiredGb;
        } else if (p.coffee_type === 'Blend' && p.blend_recipe_id) {
            const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === p.blend_recipe_id);
            recipeIngs.forEach(ing => {
                const ratio = parseFloat(ing.percentage) / 100;
                planAllocations[ing.green_coffee_id] = (planAllocations[ing.green_coffee_id] || 0) + (requiredGb * ratio);
            });
        }
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
        if (!plansList) return;
        const rows = plansList.querySelectorAll('.coffee-plan-row');
        const totalAllocations = getAllocations();
        
        rows.forEach(currentRow => {
            const select = currentRow.querySelector('.plan-coffee-select');
            const availInput = currentRow.querySelector('.plan-avail-stock');
            const potInput = currentRow.querySelector('.plan-potential-prod');
            const targetInput = currentRow.querySelector('.plan-target-weight');
            const warnDiv = currentRow.querySelector('.plan-target-warn');
            const allocWarnDiv = currentRow.querySelector('.plan-partial-alloc-warn');
            
            let selectVal = select.value;

            if (!selectVal) {
                availInput.value = "0.0";
                potInput.value = "0.0";
                warnDiv.style.display = 'none';
                if (allocWarnDiv) allocWarnDiv.style.display = 'none';
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
            
            // Calculate remaining stock for current row (after popup allocations)
            let availStock = 0;
            let potentialProd = 0;
            
            // Also compute raw stock after plan-table allocations only (to detect partial alloc)
            let rawAvailStock = 0;
            
            if (type === 'Single') {
                const original = originalStocks[id] || 0;
                const allocatedElsewhere = otherAllocations[id] || 0;
                availStock = Math.max(0, original - allocatedElsewhere);
                potentialProd = availStock * 0.85;
                // Raw = original stock minus plan table allocations (not popup rows)
                const planAlloc = planAllocations[id] || 0;
                rawAvailStock = Math.max(0, original - planAlloc);
            } else {
                const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === id);
                if (recipeIngs.length > 0) {
                    let maxBlendWeight = Infinity;
                    let maxBlendWeightRaw = Infinity;
                    recipeIngs.forEach(ing => {
                        const gbId = ing.green_coffee_id;
                        const ratio = parseFloat(ing.percentage) / 100;
                        const original = originalStocks[gbId] || 0;
                        const allocatedElsewhere = otherAllocations[gbId] || 0;
                        const remaining = Math.max(0, original - allocatedElsewhere);
                        const limit = ratio > 0 ? remaining / ratio : Infinity;
                        if (limit < maxBlendWeight) maxBlendWeight = limit;
                        // Raw
                        const planAlloc = planAllocations[gbId] || 0;
                        const remainingRaw = Math.max(0, original - planAlloc);
                        const limitRaw = ratio > 0 ? remainingRaw / ratio : Infinity;
                        if (limitRaw < maxBlendWeightRaw) maxBlendWeightRaw = limitRaw;
                    });
                    if (maxBlendWeight === Infinity) maxBlendWeight = 0;
                    if (maxBlendWeightRaw === Infinity) maxBlendWeightRaw = 0;
                    availStock = maxBlendWeight;
                    potentialProd = availStock * 0.85;
                    rawAvailStock = maxBlendWeightRaw;
                }
            }
            
            // Update values — show available stock after existing plan allocations
            availInput.value = rawAvailStock.toFixed(1);
            potInput.value = (rawAvailStock * 0.85).toFixed(1);

            // Determine if this coffee already has allocations from existing plans in the table
            const hasPlanAlloc = type === 'Single'
                ? (planAllocations[id] || 0) > 0
                : ingredients.filter(ing => ing.blend_recipe_id === id).some(ing => (planAllocations[ing.green_coffee_id] || 0) > 0);

            // Show red "exceeds stock" warning if target > available (after plan deductions)
            const rawPotential = rawAvailStock * 0.85;
            if (currentTarget > rawPotential) {
                warnDiv.style.display = 'block';
                if (hasPlanAlloc) {
                    warnDiv.innerHTML = `
                        ⚠️ Some of stock already used on another plans
                        <div style="position: absolute; top: -4px; left: 10px; width: 8px; height: 8px; background: #e11d48; transform: rotate(45deg);"></div>
                    `;
                } else {
                    warnDiv.innerHTML = `
                        ⚠️ Exceeds Stock!
                        <div style="position: absolute; top: -4px; left: 10px; width: 8px; height: 8px; background: #e11d48; transform: rotate(45deg);"></div>
                    `;
                }
            } else {
                warnDiv.style.display = 'none';
            }
        });
    }

    // V2 1I-b: when a row's selected coffee is a post-blend recipe, render a
    // per-component machine picker below it — each blend_ingredients row
    // becomes its own single-origin sub-plan on submit (see the explode
    // block further down), and each needs its own machine assignment
    // (roadmap decision: "user assigns a machine per component").
    function renderPostBlendComponents(row) {
        const panel = row.querySelector('.post-blend-components');
        const select = row.querySelector('.plan-coffee-select');
        const targetInput = row.querySelector('.plan-target-weight');
        if (!panel) return;

        const selectVal = select.value;
        const [type, idStr] = (selectVal || '').split('-');
        const recipeId = parseInt(idStr);
        const recipe = type === 'Blend' ? (recipes || []).find(r => r.id === recipeId) : null;

        if (!recipe || !recipe.is_post_blend) {
            panel.innerHTML = '';
            panel.classList.add('hidden');
            return;
        }

        const recipeIngs = (ingredients || []).filter(ing => ing.blend_recipe_id === recipeId);
        const targetKg = parseFloat(targetInput.value) || 0;

        panel.classList.remove('hidden');
        panel.innerHTML = `
            <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--primary); margin-bottom: 6px;">Post-Blend — assign a machine per component</div>
            ${recipeIngs.map(ing => {
                const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
                const compTarget = (targetKg * parseFloat(ing.percentage) / 100).toFixed(2);
                return `
                    <div style="display:flex; align-items:center; gap:10px; padding:4px 0;">
                        <div style="flex:1; font-size:0.8rem;">${gb ? gb.name : 'Unknown'} <span style="color:var(--text-muted);">(${ing.percentage}% · ${compTarget}kg)</span></div>
                        <select class="form-control post-blend-comp-machine" data-green-coffee-id="${ing.green_coffee_id}" data-percentage="${ing.percentage}" style="max-width:180px; height:32px; font-size:0.8rem;" required>
                            <option value="" disabled selected>-- Machine --</option>
                            ${machOpts}
                        </select>
                    </div>
                `;
            }).join('') || '<div style="font-size:0.8rem; color:var(--text-muted);">This recipe has no components configured.</div>'}
        `;
    }

    // Helper: bind row events
    function bindRowEvents(row) {
        const select = row.querySelector('.plan-coffee-select');
        const targetInput = row.querySelector('.plan-target-weight');
        const removeBtn = row.querySelector('.btn-remove-coffee-row');

        select.addEventListener('change', () => {
            updateAllRowsStockDisplays();
            renderPostBlendComponents(row);
        });

        targetInput.addEventListener('input', () => {
            updateAllRowsStockDisplays();
            renderPostBlendComponents(row);
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
        row.style = 'display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;';

        row.innerHTML = `
            <div style="display: flex; gap: 12px; align-items: flex-end;">
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
                <div class="form-group flex-1-mb-0" >
                    <label class="form-label">Available Stock (kg)</label>
                    <input type="text" class="form-control plan-avail-stock" value="0.0" readonly>
                </div>
                <div class="form-group flex-1-mb-0" >
                    <label class="form-label">Potential Prod (kg)</label>
                    <input type="text" class="form-control plan-potential-prod" value="0.0" readonly>
                </div>
                <div class="form-group" style="flex: 1.2; margin-bottom: 0; position: relative;">
                    <label class="form-label">Target Weight (kg)</label>
                    <input type="number" step="0.1" class="form-control plan-target-weight" value="${targetVal}" placeholder="e.g. 10.0" required>
                    <div class="plan-target-warn" style="display:none; position: absolute; bottom: -28px; left: 0; background: #e11d48; color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; z-index: 10; white-space: nowrap; box-shadow: 0 2px 5px rgba(0,0,0,0.25);">
                        ⚠️ Exceeds Stock!
                        <div style="position: absolute; top: -4px; left: 10px; width: 8px; height: 8px; background: #e11d48; transform: rotate(45deg);"></div>
                    </div>
                </div>
                ${editId ? '' : `
                <button type="button" class="btn btn-danger btn-remove-coffee-row" style="margin-bottom:0; padding: 10px 14px; height: 38px;">&times;</button>
                `}
            </div>
            <div class="post-blend-components hidden" style="background: var(--bg-app); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px;"></div>
        `;

        plansList.appendChild(row);
        bindRowEvents(row);

        if (selectedVal) {
            row.querySelector('.plan-coffee-select').value = selectedVal;
            renderPostBlendComponents(row);
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
            const msg = window.t ? window.t("msg_confirm_exceed_roast") : "Insufficient Greenbean Stock!\nProceed anyway?";
            const proceed = await showWarningModal(msg);
            if (!proceed) return;
        }

        // Save records
        if (editId) {
            const r = rows[0];
            const selectVal = r.querySelector('.plan-coffee-select').value;
            const targetWeight = parseFloat(r.querySelector('.plan-target-weight').value);
            const [type, idStr] = selectVal.split('-');
            const id = parseInt(idStr);

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
                status: document.getElementById('m-plan-status') ? document.getElementById('m-plan-status').value : (existingPlan.status || 'Pending')
            };

            await saveData('roasting_plans', record);
        } else {
            for (const r of rows) {
                const selectVal = r.querySelector('.plan-coffee-select').value;
                const targetWeight = parseFloat(r.querySelector('.plan-target-weight').value);
                const [type, idStr] = selectVal.split('-');
                const id = parseInt(idStr);
                const recipe = type === 'Blend' ? (recipes || []).find(rec => rec.id === id) : null;

                if (recipe && recipe.is_post_blend) {
                    // V2 1I-b: explode into one parent (bookkeeping only, never
                    // itself roasted) + one single-origin sub-plan per
                    // blend_ingredients component, each sized
                    // target * percentage and carrying its own machine.
                    const { data: parent, error: parentErr } = await saveData('roasting_plans', {
                        day: new Date(planDate).toLocaleDateString('en-US', { weekday: 'long' }),
                        plan_date: planDate,
                        machine_id: null,
                        coffee_type: 'Blend',
                        single_coffee_id: null,
                        blend_recipe_id: id,
                        target_roasted_kg: targetWeight,
                        fulfilled_roasted_kg: 0.0,
                        status: 'Pending',
                        is_post_blend_component: false
                    });
                    if (parentErr || !parent) {
                        await showWarningModal('Failed to create the post-blend plan. Please try again.', false);
                        continue;
                    }

                    const compMachineSelects = r.querySelectorAll('.post-blend-comp-machine');
                    for (const compSel of compMachineSelects) {
                        const gbId = parseInt(compSel.getAttribute('data-green-coffee-id'));
                        const pct = parseFloat(compSel.getAttribute('data-percentage')) || 0;
                        const compMachineId = parseInt(compSel.value) || null;
                        await saveData('roasting_plans', {
                            day: new Date(planDate).toLocaleDateString('en-US', { weekday: 'long' }),
                            plan_date: planDate,
                            machine_id: compMachineId,
                            coffee_type: 'Single',
                            single_coffee_id: gbId,
                            blend_recipe_id: null,
                            target_roasted_kg: targetWeight * pct / 100,
                            fulfilled_roasted_kg: 0.0,
                            status: 'Pending',
                            parent_plan_id: parent.id,
                            is_post_blend_component: true
                        });
                    }
                    continue;
                }

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

async function deletePlan(id) {
    if (await showDeleteConfirmModal('this roasting plan')) {
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
    if (await showDeleteConfirmModal('this roasting batch log')) {
        const { data: batches } = await fetchData('roast_batches');
        const batch = batches.find(b => b.id === id);

        if (batch) {
            // V2 1B: restore stock via the lots this batch actually drew from
            // (green_coffee.stock_kg is DERIVED — see the comment above
            // consumeGreenCoffeeLotsFifo). Must run before the roast_batches
            // delete below, since roast_batch_green_lots cascades on it.
            await refundGreenCoffeeLotsForBatch(id);

            // Refund/deduct from bulk_roasted_coffee if it was already approved/Success
            if (batch.qc_status === 'Success') {
                const { data: bulkList } = await fetchData('bulk_roasted_coffee');
                const bulkRec = bulkList.find(b =>
                    b.coffee_type === batch.coffee_type &&
                    (batch.coffee_type === 'Single' ? b.single_coffee_id === batch.single_coffee_id : b.blend_recipe_id === batch.blend_recipe_id) &&
                    b.machine_id === batch.machine_id &&
                    b.production_date === batch.roast_date
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

// roastDate scopes the pool to a single roast day — bulk is physically kept
// separate per roast day, so a coffee+machine combo roasted again on a
// different day must land in its own row/card, not accumulate into an
// older day's pool (which would blur FIFO and misdate printed lot codes —
// see database/bulk_production_date_migration.sql).
async function addWeightToBulkRoastedCoffee(type, singleId, blendId, machineId, coffeeName, weightKg, roastDate) {
    const { data: bulkList } = await fetchData('bulk_roasted_coffee');
    const existingBulk = bulkList.find(b =>
        b.coffee_type === type &&
        (type === 'Single' ? b.single_coffee_id === singleId : b.blend_recipe_id === blendId) &&
        b.machine_id === machineId &&
        b.production_date === roastDate
    );

    if (existingBulk) {
        existingBulk.bulk_available = parseFloat(existingBulk.bulk_available || 0) + weightKg;
        await saveData('bulk_roasted_coffee', existingBulk);
    } else {
        const newBulk = {
            coffee_type: type,
            single_coffee_id: type === 'Single' ? singleId : null,
            blend_recipe_id: type === 'Blend' ? blendId : null,
            machine_id: machineId,
            coffee_name: coffeeName,
            bulk_available: weightKg,
            production_date: roastDate
        };
        await saveData('bulk_roasted_coffee', newBulk);
    }
}

// V2 1I-b: after a post-blend sub-plan changes status, check whether ALL of
// its siblings (same parent_plan_id) are now terminal (Completed or
// Stopped). Does nothing while any sibling is still open — the blend only
// assembles once every component has either hit its target or been
// deliberately stopped short (see finalizePostBlendPlan for the scale-down
// math).
async function tryAssemblePostBlend(parentPlanId) {
    if (!parentPlanId) return;
    const { data: allPlans } = await fetchData('roasting_plans');
    const parent = (allPlans || []).find(p => p.id === parentPlanId);
    if (!parent || parent.status === 'Completed') return;

    const siblings = (allPlans || []).filter(p => p.parent_plan_id === parentPlanId);
    if (siblings.length === 0) return;

    const allTerminal = siblings.every(s => s.status === 'Completed' || s.status === 'Stopped');
    if (!allTerminal) return;

    await finalizePostBlendPlan(parentPlanId);
}

// V2 1I-b: assembles the post-blend bulk_roasted_coffee row from a parent
// plan's terminal sub-plans. Happy path (every sibling met its own target)
// assembles at the full recipe ratio (scale=1). Under-yield (any sibling
// Stopped short) scales the WHOLE blend down by s = min(fulfilled/target)
// across siblings — the confirmed roadmap decision — so the mix ratio is
// preserved even though the total shrinks. Each component's shortfall
// beyond its scaled share (fulfilled - s*target) spills into its own
// normal single-origin bulk_roasted_coffee card instead of being wasted —
// same idea as recipe over-yield.
async function finalizePostBlendPlan(parentPlanId) {
    const [{ data: allPlans }, { data: recipes }, { data: greenbeans }, { data: allBatches }] = await Promise.all([
        fetchData('roasting_plans'),
        fetchData('blend_recipes'),
        fetchData('green_coffee'),
        fetchData('roast_batches')
    ]);
    const parent = (allPlans || []).find(p => p.id === parentPlanId);
    if (!parent || parent.status === 'Completed') return;
    const siblings = (allPlans || []).filter(p => p.parent_plan_id === parentPlanId);
    if (siblings.length === 0) return;

    const scale = Math.min(1, ...siblings.map(s => {
        const target = parseFloat(s.target_roasted_kg) || 0;
        const fulfilled = parseFloat(s.fulfilled_roasted_kg) || 0;
        return target > 0 ? fulfilled / target : 1;
    }));

    const recipe = (recipes || []).find(r => r.id === parent.blend_recipe_id);
    const blendName = recipe ? recipe.name : 'Post-Blend';

    let assembledKg = 0;
    for (const s of siblings) {
        const target = parseFloat(s.target_roasted_kg) || 0;
        const fulfilled = parseFloat(s.fulfilled_roasted_kg) || 0;
        const contribute = Math.min(fulfilled, target * scale);
        const leftover = Math.max(0, fulfilled - contribute);
        assembledKg += contribute;

        if (leftover > 0.005) {
            const gb = (greenbeans || []).find(g => g.id === s.single_coffee_id);
            // Prefer the actual roast date of the batch(es) that fulfilled this
            // sub-plan (guaranteed to exist whenever fulfilled_roasted_kg > 0 —
            // it's only ever incremented by a real batch save); plan_date is
            // just the scheduled date and can drift from the real roast day.
            const subPlanBatchDates = (allBatches || [])
                .filter(b => b.roasting_plan_id === s.id && b.roast_date)
                .map(b => b.roast_date)
                .sort();
            const leftoverRoastDate = subPlanBatchDates.length > 0
                ? subPlanBatchDates[subPlanBatchDates.length - 1]
                : s.plan_date;
            await addWeightToBulkRoastedCoffee('Single', s.single_coffee_id, null, s.machine_id, gb ? gb.name : 'Roasted Coffee', leftover, leftoverRoastDate);
        }
    }

    if (assembledKg > 0.005) {
        const todayStr = new Date().toISOString().split('T')[0];
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const { data: bulkList } = await fetchData('bulk_roasted_coffee');
        let code = `PB-${dateStr}`;
        let suffix = 2;
        while ((bulkList || []).some(b => b.custom_blend_code === code)) code = `PB-${dateStr}-${suffix++}`;

        await saveData('bulk_roasted_coffee', {
            coffee_name: blendName,
            coffee_type: 'Blend',
            blend_recipe_id: parent.blend_recipe_id,
            is_post_blend: true,
            custom_blend_name: blendName,
            custom_blend_code: code,
            bulk_available: assembledKg,
            machine_id: null,
            source_plan_id: parent.id,
            production_date: todayStr
        });
    }

    parent.status = 'Completed';
    parent.fulfilled_roasted_kg = assembledKg;
    await saveData('roasting_plans', parent);
    await syncPlanStatusToOrderItem(parent);
}

// V2 1I-b: manual "Stop" on one open sub-plan — marks it terminal short of
// target so tryAssemblePostBlend can proceed once every sibling is terminal,
// without waiting for a calendar day-end (this app has no scheduled/cron
// jobs — see the under-yield trigger discussion in V2_ROADMAP.md).
async function stopPostBlendComponent(subPlanId) {
    const proceed = await showWarningModal('Stop roasting this component for now? The blend will assemble at a smaller scale once every other component is also done or stopped.', true);
    if (!proceed) return;

    const { data: allPlans } = await fetchData('roasting_plans');
    const subPlan = (allPlans || []).find(p => p.id === subPlanId);
    if (!subPlan) return;

    subPlan.status = 'Stopped';
    await saveData('roasting_plans', subPlan);
    await tryAssemblePostBlend(subPlan.parent_plan_id);
    await loadRoastingPlans();
}

// V2 1I-b: manual "Finalize now" on the PARENT plan — lets the team assemble
// early even if some sub-plans are still open (each open sibling gets force-
// stopped first so finalizePostBlendPlan's terminal-check passes).
async function finalizePostBlendNow(parentPlanId) {
    const proceed = await showWarningModal('Finalize this blend now? Any component not yet at target will be stopped and the blend assembled at a smaller scale.', true);
    if (!proceed) return;

    const { data: allPlans } = await fetchData('roasting_plans');
    const siblings = (allPlans || []).filter(p => p.parent_plan_id === parentPlanId && p.status !== 'Completed' && p.status !== 'Stopped');
    for (const s of siblings) {
        s.status = 'Stopped';
        await saveData('roasting_plans', s);
    }
    await finalizePostBlendPlan(parentPlanId);
    await loadRoastingPlans();
}

async function approveTestBatch(id) {
    if (await showWarningModal("Are you sure you want to approve this test batch? Doing so will transfer its output weight to the bulk roasted inventory, making it available for packing.")) {
        const { data: batches } = await fetchData('roast_batches');
        const batch = batches.find(b => b.id === id);
        if (batch) {
            // Only save fields that exist in production schema
            const updateRecord = {
                id: batch.id,
                batch_code: batch.batch_code,
                roast_date: batch.roast_date,
                roasting_plan_id: batch.roasting_plan_id,
                coffee_type: batch.coffee_type,
                single_coffee_id: batch.single_coffee_id,
                blend_recipe_id: batch.blend_recipe_id,
                machine_id: batch.machine_id,
                input_weight_kg: batch.input_weight_kg,
                output_weight_kg: batch.output_weight_kg,
                yield_percentage: batch.yield_percentage,
                roast_type: batch.roast_type,
                qc_status: 'Success',
                notes: batch.notes
            };
            await saveData('roast_batches', updateRecord);

            // Fetch coffee name
            const [
                { data: greenbeans },
                { data: recipes }
            ] = await Promise.all([
                fetchData('green_coffee'),
                fetchData('blend_recipes')
            ]);
            let coffeeName = '';
            if (batch.coffee_type === 'Single') {
                const gb = greenbeans.find(g => g.id === batch.single_coffee_id);
                coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
            } else {
                const r = recipes.find(rec => rec.id === batch.blend_recipe_id);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
            }

            await addWeightToBulkRoastedCoffee(batch.coffee_type, batch.single_coffee_id, batch.blend_recipe_id, batch.machine_id, coffeeName, parseFloat(batch.output_weight_kg), batch.roast_date);

            loadRoastingBatches();
            scheduleDashboardRefresh();
        }
    }
}

// Log roasting batch
document.getElementById('btn-add-batch').addEventListener('click', () => {
    openRoastBatchModal();
});

document.getElementById('btn-export-batches').addEventListener('click', () => {
    openExportBatchesModal();
});

async function openExportBatchesModal() {
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = today.substring(0, 8) + '01';

    const html = `
        <form id="modal-export-batches-form">
            <div style="margin-bottom: 16px; color: var(--text-secondary); font-size: 0.9rem;">
                Select the date range for the roasting batch logs you want to export.
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">From Date</label>
                    <input type="date" id="m-export-from" class="form-control" value="${firstOfMonth}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">To Date</label>
                    <input type="date" id="m-export-to" class="form-control" value="${today}" required>
                </div>
            </div>
            <div id="export-preview-count" style="margin-bottom: 16px; font-size: 0.85rem; color: var(--text-muted); font-style: italic;"></div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Export
                </button>
            </div>
        </form>
    `;

    openModal('Export Roasting Batch Logs', html, '450px');

    // Preview count updater
    const fromEl = document.getElementById('m-export-from');
    const toEl = document.getElementById('m-export-to');
    const previewEl = document.getElementById('export-preview-count');

    const { data: batches } = await fetchData('roast_batches');

    const updatePreview = () => {
        const from = fromEl.value;
        const to = toEl.value;
        if (!from || !to) { previewEl.textContent = ''; return; }
        const count = (batches || []).filter(b => b.roast_date >= from && b.roast_date <= to).length;
        previewEl.textContent = `${count} batch(es) found in selected range.`;
    };
    fromEl.addEventListener('change', updatePreview);
    toEl.addEventListener('change', updatePreview);
    updatePreview();

    document.getElementById('modal-export-batches-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fromDate = fromEl.value;
        const toDate = toEl.value;

        if (fromDate > toDate) {
            alert('From Date must be before or equal to To Date.');
            return;
        }

        const [
            { data: greenbeans },
            { data: recipes },
            { data: machines }
        ] = await Promise.all([
            fetchData('green_coffee'),
            fetchData('blend_recipes'),
            fetchData('machines')
        ]);

        const filtered = (batches || [])
            .filter(b => b.roast_date >= fromDate && b.roast_date <= toDate)
            .sort((a, b) => new Date(a.roast_date) - new Date(b.roast_date));

        if (filtered.length === 0) {
            await showWarningModal('No batches found in the selected date range.', false);
            return;
        }

        // Build export data
        const rows = filtered.map(b => {
            let coffeeName = '';
            if (b.coffee_type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === b.single_coffee_id);
                coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
            } else {
                const r = (recipes || []).find(rec => rec.id === b.blend_recipe_id);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend';
            }
            const mach = b.machine_id ? (machines || []).find(m => m.id === b.machine_id) : null;
            const machineName = mach ? mach.name : '-';
            const batchG = parseFloat(b.batch_weight_kg || 0) * 1000;
            const yieldG = parseFloat(b.yield_weight_kg || 0) * 1000;
            const depre = batchG > 0 ? (((batchG - yieldG) / batchG) * 100).toFixed(1) + '%' : '0%';
            return {
                'Date': b.roast_date,
                'Batch Code': b.batch_code || '-',
                'Coffee': coffeeName,
                'Machine': machineName,
                'Batch (g)': batchG,
                'Yield (g)': yieldG,
                'Depreciation': depre,
                'Type': b.batch_type || 'Regular'
            };
        });

        // Generate Excel using SheetJS
        exportToExcel(rows, `Roasting_Batch_Logs_${fromDate}_to_${toDate}`);

        document.getElementById('btn-close-modal').click();
    });
}

// === Export: Lot History ===
document.getElementById('btn-export-lot-history').addEventListener('click', () => {
    openExportLotHistoryModal();
});

async function openExportLotHistoryModal() {
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = today.substring(0, 8) + '01';
    const html = `
        <form id="modal-export-lot-form">
            <div style="margin-bottom: 16px; color: var(--text-secondary); font-size: 0.9rem;">
                Select the date range for the lot history you want to export.
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">From Date</label>
                    <input type="date" id="m-export-lot-from" class="form-control" value="${firstOfMonth}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">To Date</label>
                    <input type="date" id="m-export-lot-to" class="form-control" value="${today}" required>
                </div>
            </div>
            <div id="export-lot-preview-count" style="margin-bottom: 16px; font-size: 0.85rem; color: var(--text-muted); font-style: italic;"></div>
            <div class="modal-footer-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Export
                </button>
            </div>
        </form>
    `;
    openModal('Export Lot History', html, '450px');

    const fromEl = document.getElementById('m-export-lot-from');
    const toEl = document.getElementById('m-export-lot-to');
    const previewEl = document.getElementById('export-lot-preview-count');
    const { data: history } = await fetchData('green_coffee_intake');

    const updatePreview = () => {
        const from = fromEl.value;
        const to = toEl.value;
        if (!from || !to) { previewEl.textContent = ''; return; }
        const count = (history || []).filter(h => h.date >= from && h.date <= to).length;
        previewEl.textContent = `${count} lot(s) found in selected range.`;
    };
    fromEl.addEventListener('change', updatePreview);
    toEl.addEventListener('change', updatePreview);
    updatePreview();

    document.getElementById('modal-export-lot-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fromDate = fromEl.value;
        const toDate = toEl.value;
        if (fromDate > toDate) { alert('From Date must be before or equal to To Date.'); return; }

        const filtered = (history || [])
            .filter(h => h.date >= fromDate && h.date <= toDate)
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        if (filtered.length === 0) {
            await showWarningModal('No lots found in the selected date range.', false);
            return;
        }

        const rows = filtered.map(h => ({
            'Date': h.date || '-',
            'Code': h.code || '-',
            'Coffee Name': h.name || '-',
            'Origin': h.origin || '-',
            'Process': h.process || '-',
            'Quantity (kg)': parseFloat(h.quantity || 0).toFixed(2),
            'Supplier': h.supplier || '-'
        }));
        exportToExcel(rows, `Lot_History_${fromDate}_to_${toDate}`);
        document.getElementById('btn-close-modal').click();
    });
}

// === Export: Blend Recipes ===
document.getElementById('btn-export-blend-recipes').addEventListener('click', async () => {
    const [
        { data: recipes },
        { data: ingredients },
        { data: greenbeans }
    ] = await Promise.all([
        fetchData('blend_recipes'),
        fetchData('blend_ingredients'),
        fetchData('green_coffee')
    ]);

    if (!recipes || recipes.length === 0) {
        await showWarningModal('No blend recipe data to export.', false);
        return;
    }

    const rows = recipes.map(r => {
        const recipeIngredients = (ingredients || []).filter(i => i.blend_recipe_id === r.id);
        const ingredientStr = recipeIngredients.map(ing => {
            const gb = (greenbeans || []).find(g => g.id === ing.green_coffee_id);
            return gb ? `${gb.name} (${ing.percentage}%)` : `Unknown (${ing.percentage}%)`;
        }).join(', ');
        return {
            'Code': r.code || '-',
            'Recipe Name': r.name || '-',
            'Ingredients': ingredientStr || '-'
        };
    });
    exportToExcel(rows, `Blend_Recipes_${new Date().toISOString().split('T')[0]}`);
});

async function openRoastBatchModal(plan = null, editId = null) {
    const [
        { data: greenbeans },
        { data: recipes },
        { data: ingredients },
        { data: machines },
        { data: batches }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('blend_ingredients'),
        fetchData('machines'),
        fetchData('roast_batches')
    ]);

    let existingBatch = null;
    if (editId) {
        existingBatch = batches.find(b => b.id === editId);
    }

    const gbSelectOpts = [...greenbeans].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(g => `<option value="Single-${g.id}">${g.name}</option>`).join('');
    const recSelectOpts = [...recipes].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(r => `<option value="Blend-${r.id}">${r.name}</option>`).join('');
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

            <div class="form-row mt-3" >
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
                <div class="form-group flex-1-mb-0" >
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

            <div class="form-row mt-3" >
                <div class="form-group">
                    <label class="form-label">Greenbean Weight (gram)</label>
                    <input type="number" step="1" id="m-bat-greenbean" class="form-control" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Roasted Weight (gram)</label>
                    <input type="number" step="1" id="m-bat-roasted" class="form-control" required>
                </div>
            </div>

            <div class="form-row mt-3" >
                <div class="form-group flex-1" >
                    <label class="form-label">Depreciation (%)</label>
                    <input type="text" id="m-bat-depreciation" class="form-control" style="background:var(--border); font-weight:700; color:var(--warning);" readonly value="0.0%">
                </div>
                <div class="form-group flex-1">
                    <label class="form-label">Roast Degree / Agtron (optional)</label>
                    <input type="number" step="1" id="m-bat-degree" class="form-control" placeholder="e.g. 58">
                </div>
            </div>

            <div class="form-group mt-3" >
                <label class="form-label">Notes</label>
                <textarea id="m-bat-notes" class="form-control" rows="2" placeholder="First crack timings, end temperature, etc."></textarea>
            </div>

            <div class="modal-footer-actions-lg">
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
    const degreeInput = document.getElementById('m-bat-degree');

    const notesTextarea = document.getElementById('m-bat-notes');

    // V2 1F: auto pre-fill Roast Degree from the most recently logged batch of
    // the same coffee + machine (editable — the operator can override). Blank
    // if no prior batch exists for that combo. Skipped when editing (the
    // batch's own saved value is shown instead, set in the edit branch below).
    function prefillRoastDegree(coffeeVal, machineId) {
        if (!coffeeVal || !machineId) { degreeInput.value = ''; return; }
        const [type, idStr] = coffeeVal.split('-');
        const id = parseInt(idStr);
        const mId = parseInt(machineId);
        const match = (batches || [])
            .filter(b => b.machine_id === mId && b.roast_degree != null &&
                (type === 'Single' ? b.single_coffee_id === id : b.blend_recipe_id === id))
            .sort((a, b) => new Date(b.roast_date) - new Date(a.roast_date) || b.id - a.id)[0];
        degreeInput.value = match ? match.roast_degree : '';
    }
    coffeeSelect.addEventListener('change', () => { if (!editId) prefillRoastDegree(coffeeSelect.value, machineSelect.value); });
    machineSelect.addEventListener('change', () => { if (!editId) prefillRoastDegree(coffeeSelect.value, machineSelect.value); });

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

    const gbWarningBubble = document.createElement('div');
    gbWarningBubble.style.cssText = "color: var(--danger); font-size: 0.8rem; margin-top: 4px; display: none; font-weight: 600;";
    gbWarningBubble.innerHTML = `⚠️ <span data-i18n="alert_insufficient_gb">${window.t ? window.t("alert_insufficient_gb").replace('\n',' ') : "Insufficient Greenbean Stock!"}</span>`;
    greenbeanWeightInput.parentNode.appendChild(gbWarningBubble);

    let hasInsufficientStock = false;

    function checkBatchStock() {
        const coffeeVal = coffeeSelect.value;
        const gbW_kg = (parseFloat(greenbeanWeightInput.value) || 0) / 1000;
        
        hasInsufficientStock = false;
        if (!coffeeVal || gbW_kg <= 0) {
            gbWarningBubble.style.display = 'none';
            return;
        }

        const [type, idStr] = coffeeVal.split('-');
        const id = parseInt(idStr);

        if (type === 'Single') {
            const gb = greenbeans.find(g => g.id === id);
            if (gb && gbW_kg > (gb.stock_kg || 0)) {
                hasInsufficientStock = true;
            }
        } else if (type === 'Blend') {
            const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === id);
            for (let ing of recipeIngs) {
                const gb = greenbeans.find(g => g.id === ing.green_coffee_id);
                const reqKg = gbW_kg * (ing.percentage / 100);
                if (!gb || reqKg > (gb.stock_kg || 0)) {
                    hasInsufficientStock = true;
                    break;
                }
            }
        }

        gbWarningBubble.style.display = hasInsufficientStock ? 'block' : 'none';
    }

    greenbeanWeightInput.addEventListener('input', () => {
        greenbeanWeightInput.dataset.userEdited = "true";
        calcDepreciation();
        checkBatchStock();
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
                checkBatchStock();
            }
        }
    }

    machineSelect.addEventListener('change', updateGeneratedBatchCodeAndWeight);
    coffeeSelect.addEventListener('change', () => {
        updateGeneratedBatchCodeAndWeight();
        checkBatchStock();
    });
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
        degreeInput.value = existingBatch.roast_degree ?? '';
        calcDepreciation();
        checkBatchStock();
    } else if (plan) {
        dateInput.value = todayStr;
        machineSelect.value = getCookie('last_machine_id') || machines[0]?.id || '';
        coffeeSelect.value = `${plan.coffee_type}-${plan.single_coffee_id || plan.blend_recipe_id}`;
        testCheckbox.checked = false;
        greenbeanWeightInput.value = ((plan.target_roasted_kg / 0.85) * 1000).toFixed(0);
        roastedWeightInput.value = (plan.target_roasted_kg * 1000).toFixed(0);
        notesTextarea.value = '';
        prefillRoastDegree(coffeeSelect.value, machineSelect.value);
        calcDepreciation();
        updateGeneratedBatchCodeAndWeight();
        checkBatchStock();
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
        prefillRoastDegree(coffeeSelect.value, machineSelect.value);
        calcDepreciation();
        updateGeneratedBatchCodeAndWeight();
        checkBatchStock();
    }

    // Submit handler
    document.getElementById('modal-batch-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        if (hasInsufficientStock) {
            const proceed = await showWarningModal(
                window.t ? window.t("msg_confirm_exceed_roast") : "Insufficient Greenbean Stock!\nProceed anyway?",
                true
            );
            if (!proceed) return;
        } else {
            const proceed = await showWarningModal(
                "Are you sure you want to finalize this batch? This will deduct green beans and add to bulk stock.",
                true,
                "Confirm Batch",
                "ROASTED!!"
            );
            if (!proceed) return;
        }

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

        // V2 1B: green_coffee.stock_kg is DERIVED (trigger-summed from
        // green_coffee_lots.remaining_kg — see database/v2_lot_tracking_migration.sql),
        // so consumption must go through the lots, not a direct stock_kg write
        // (a direct write here would get silently reverted the next time any
        // lot for that coffee changes, same class of bug fixed in 1A for
        // intake edit/delete). On edit, first refund exactly what the old
        // batch drew (via its recorded roast_batch_green_lots rows), then
        // re-consume FIFO oldest-first for the new input weight.
        if (editId) {
            await refundGreenCoffeeLotsForBatch(editId);
        }

        const lotDraws = [];
        if (type === 'Single') {
            const { draws } = await consumeGreenCoffeeLotsFifo(singleId, inputKg);
            lotDraws.push(...draws);
        } else {
            const recipeIngs = ingredients.filter(ing => ing.blend_recipe_id === blendId);
            for (const ing of recipeIngs) {
                const req = (parseFloat(ing.percentage) / 100) * inputKg;
                const { draws } = await consumeGreenCoffeeLotsFifo(ing.green_coffee_id, req);
                lotDraws.push(...draws);
            }
        }

        // Save Cookies
        setCookie('last_machine_id', machineId.toString());
        setCookie('last_coffee_val', coffeeVal);

        // 3. Save Roast Batch Record (match production schema)
        const yieldPct = outputKg > 0 && inputKg > 0 ? parseFloat(((outputKg / inputKg) * 100).toFixed(2)) : null;
        const record = {
            batch_code: code,
            roast_date: roastDate,
            roasting_plan_id: editId ? existingBatch.roasting_plan_id : (plan ? plan.id : null),
            coffee_type: type,
            single_coffee_id: singleId || null,
            blend_recipe_id: blendId || null,
            machine_id: machineId,
            input_weight_kg: inputKg,
            output_weight_kg: outputKg,
            yield_percentage: yieldPct,
            roast_type: isTest ? 'Test' : 'Regular',
            qc_status: qcStatus,
            notes: notes || null,
            roast_degree: degreeInput.value ? parseFloat(degreeInput.value) : null
        };

        if (editId) {
            record.id = editId;
        }

        const { data: savedBatch, error } = await saveData('roast_batches', record);
        if (error) {
            // Auto-retrying with a regenerated code was considered here, but
            // rejected: a duplicate-key error can also mean the user
            // double-submitted this exact batch (double-click, browser
            // resubmit), in which case silently retrying would log the same
            // physical batch twice under two different codes — a worse,
            // harder-to-notice outcome than stopping and asking. Surface a
            // clear, actionable message instead and let the user check the
            // Batch Logs list before retrying manually.
            const isDuplicateCode = /duplicate key|unique constraint/i.test(error.message || '');
            const msg = isDuplicateCode
                ? `A batch with code "${code}" already exists. This can happen if you double-submitted, or logged another batch for the same coffee/machine/date at nearly the same moment.\n\nPlease check the Batch Logs list to confirm this batch wasn't already saved, then close this form and try again — a fresh code will be generated.`
                : "Logging batch failed: " + error.message;
            alert(msg);
            return;
        }

        // V2 1B: persist which lot(s) this batch drew from, now that the
        // batch has an id (feeds future costing + Tracking traceability).
        await recordRoastBatchGreenLots(savedBatch.id, lotDraws);

        // 4. Update associated plan status
        const { data: plans } = await fetchData('roasting_plans');
        
        // If editing, subtract the old output weight from the linked plan first
        if (editId && existingBatch && existingBatch.roasting_plan_id) {
            const oldPlan = plans.find(p => p.id === existingBatch.roasting_plan_id);
            if (oldPlan) {
                oldPlan.fulfilled_roasted_kg = Math.max(0, parseFloat(oldPlan.fulfilled_roasted_kg || 0) - parseFloat(existingBatch.output_weight_kg || 0));
                oldPlan.status = (oldPlan.fulfilled_roasted_kg >= parseFloat(oldPlan.target_roasted_kg)) ? 'Completed' : 'On Process';
                await saveData('roasting_plans', oldPlan);
                await syncPlanStatusToOrderItem(oldPlan);
            }
        }

        // Find ALL matching active/on-process plans for this coffee and machine
        let matchingPlans = plans.filter(p => 
            p.coffee_type === type && 
            (type === 'Single' ? p.single_coffee_id === singleId : p.blend_recipe_id === blendId) &&
            p.machine_id === machineId &&
            p.status !== 'Completed'
        );

        if (matchingPlans.length > 0) {
            // V2 1I-b: an open post-blend sub-plan for this exact coffee+
            // machine always fills first — accepted limitation per the
            // roadmap (a normal single plan sharing the same coffee+machine
            // while the sub-plan is open gets filled second, even if older).
            // Within the same priority tier, earliest plan_date first, then
            // id ascending (plan_date alone doesn't disambiguate same-day plans).
            matchingPlans.sort((a, b) => {
                const aSub = a.is_post_blend_component ? 0 : 1;
                const bSub = b.is_post_blend_component ? 0 : 1;
                if (aSub !== bSub) return aSub - bSub;
                return (new Date(a.plan_date) - new Date(b.plan_date)) || (a.id - b.id);
            });

            let remainingOutput = outputKg;

            for (let i = 0; i < matchingPlans.length; i++) {
                if (remainingOutput <= 0) break;

                const p = matchingPlans[i];
                const target = parseFloat(p.target_roasted_kg || 0);
                const currentFulfilled = parseFloat(p.fulfilled_roasted_kg || 0);
                const capacity = Math.max(0, target - currentFulfilled);

                if (remainingOutput <= capacity) {
                    p.fulfilled_roasted_kg = currentFulfilled + remainingOutput;
                    p.status = (p.fulfilled_roasted_kg >= target) ? 'Completed' : 'On Process';
                    remainingOutput = 0;
                    await saveData('roasting_plans', p);
                    await syncPlanStatusToOrderItem(p);
                    if (p.is_post_blend_component && p.status === 'Completed') await tryAssemblePostBlend(p.parent_plan_id);
                } else {
                    // Exceeds this plan's capacity
                    if (i === matchingPlans.length - 1) {
                        // If this is the LAST matching plan, it absorbs all the remainder
                        p.fulfilled_roasted_kg = currentFulfilled + remainingOutput;
                        p.status = 'Completed';
                        remainingOutput = 0;
                        await saveData('roasting_plans', p);
                        await syncPlanStatusToOrderItem(p);
                        if (p.is_post_blend_component) await tryAssemblePostBlend(p.parent_plan_id);
                    } else {
                        // Fill this plan to target and continue to next
                        p.fulfilled_roasted_kg = target;
                        p.status = 'Completed';
                        remainingOutput -= capacity;
                        await saveData('roasting_plans', p);
                        await syncPlanStatusToOrderItem(p);
                        if (p.is_post_blend_component) await tryAssemblePostBlend(p.parent_plan_id);
                    }
                }
            }
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
            await addWeightToBulkRoastedCoffee(type, singleId, blendId, machineId, coffeeName, outputKg, roastDate);

        } else if (prevQcStatus === 'Success' && qcStatus !== 'Success') {
            // Transition: Success → Pending  (approved checkbox unchecked)
            // SUBTRACT weight from bulk roasted coffee
            const { data: bulkList } = await fetchData('bulk_roasted_coffee');
            const existingBulk = bulkList.find(b =>
                b.coffee_type === existingBatch.coffee_type &&
                (existingBatch.coffee_type === 'Single'
                    ? b.single_coffee_id === existingBatch.single_coffee_id
                    : b.blend_recipe_id === existingBatch.blend_recipe_id) &&
                b.machine_id === existingBatch.machine_id &&
                b.production_date === existingBatch.roast_date
            );
            if (existingBulk) {
                const prevOutputKg = parseFloat(existingBatch.output_weight_kg || 0);
                existingBulk.bulk_available = Math.max(0, parseFloat(existingBulk.bulk_available || 0) - prevOutputKg);
                await saveData('bulk_roasted_coffee', existingBulk);
            }

        } else if (qcStatus === 'Success' && prevQcStatus === 'Success' && editId && existingBatch) {
            // Staying Success but the batch was edited (e.g. yield/output weight
            // changed) — bulk_available was already counted using the OLD
            // output weight and never gets touched again once it's "already
            // counted", so an edited yield silently never reached bulk stock
            // (bug reported 2026-07-15). Refund the exact old amount from the
            // OLD identity's bulk record, then add the new amount via the
            // normal helper (which resolves/creates the current identity's
            // record) — robust even if coffee/machine also changed on edit.
            const { data: bulkList } = await fetchData('bulk_roasted_coffee');
            const oldBulk = bulkList.find(b =>
                b.coffee_type === existingBatch.coffee_type &&
                (existingBatch.coffee_type === 'Single'
                    ? b.single_coffee_id === existingBatch.single_coffee_id
                    : b.blend_recipe_id === existingBatch.blend_recipe_id) &&
                b.machine_id === existingBatch.machine_id &&
                b.production_date === existingBatch.roast_date
            );
            if (oldBulk) {
                oldBulk.bulk_available = Math.max(0, parseFloat(oldBulk.bulk_available || 0) - parseFloat(existingBatch.output_weight_kg || 0));
                await saveData('bulk_roasted_coffee', oldBulk);
            }
            let coffeeName = '';
            if (type === 'Single') {
                const gb = greenbeans.find(g => g.id === singleId);
                coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
            } else {
                const r = recipes.find(rec => rec.id === blendId);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
            }
            // Refund matched the OLD roast_date (existingBatch.roast_date);
            // re-add uses the NEW roastDate (form value) — these can differ
            // if the user also changed the roast date during this edit.
            await addWeightToBulkRoastedCoffee(type, singleId, blendId, machineId, coffeeName, outputKg, roastDate);
        }
        // else: new batch not Success (Pending, first save) → nothing counted yet


        // 5. If QC fails, log to waste inventory.
        //    Was writing `weight_kg`, but the column is `waste_kg` — every
        //    failed-QC batch silently failed to record its discarded weight
        //    (waste_inventory was empty in production as a result). Also fills
        //    source_type/source_name so the row is identifiable on its own.
        if (qcStatus === 'Failed') {
            const wasteCoffee = type === 'Single'
                ? ((greenbeans.find(g => g.id === singleId) || {}).name || 'Single Origin')
                : ((recipes.find(rec => rec.id === blendId) || {}).name || 'Blend Recipe');
            const wasteRecord = {
                roast_batch_id: savedBatch.id,
                source_type: 'Roast Batch',
                source_name: `${wasteCoffee} (${code})`,
                waste_kg: outputKg,
                discard_date: new Date().toISOString().split('T')[0],
                reason: `Failed QC inspection: ${notes}`,
                recorded_by: (currentUser && currentUser.name) || null
            };
            const { error: wasteErr } = await saveData('waste_inventory', wasteRecord);
            if (wasteErr) console.error('Failed to log waste for failed QC batch:', wasteErr);
        }

        modalContainer.classList.add('hidden');
        loadRoastingSection();
        loadGreenbeanInventory();
        scheduleDashboardRefresh();
    });
}

// Same physical size and visual style as the packed coffee lot label
// (printLotBarcodeLabels in packing.js): fixed 50x25mm, Arial, a scannable
// CODE128 barcode (here encoding the batch's own batch_code) that always
// prints, plus whichever text lines are enabled in Settings → Production →
// Label Layout (companySettings.label_layout.roasting).
async function printStickerLabel(id) {
    const [
        { data: batches },
        { data: greenbeans },
        { data: recipes },
        { data: machines }
    ] = await Promise.all([
        fetchData('roast_batches'),
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines')
    ]);

    const batch = batches.find(b => b.id === id);
    if (!batch) return;

    let coffeeName = '';
    let coffeeCode = '';
    if (batch.coffee_type === 'Single') {
        const gb = greenbeans.find(g => g.id === batch.single_coffee_id);
        coffeeName = gb ? gb.name : 'Single Origin';
        coffeeCode = gb ? (gb.code || '') : '';
    } else {
        const r = recipes.find(rec => rec.id === batch.blend_recipe_id);
        coffeeName = r ? r.name : 'Blend Recipe';
        coffeeCode = r ? (r.code || '') : '';
    }

    const mach = machines.find(m => m.id === batch.machine_id);
    const machineName = mach ? mach.name : 'Unknown';

    const cfg = (companySettings.label_layout && companySettings.label_layout.roasting) || {};
    const showCoffeeName = cfg.coffee_name !== false;
    const showMachine = cfg.machine !== false;
    const showCoffeeCode = cfg.coffee_code !== false;

    let linesHtml = '';
    if (showCoffeeName) linesHtml += `<div class="lbl-line lbl-line-bold">${coffeeName}</div>`;
    if (showMachine) linesHtml += `<div class="lbl-line">${machineName}</div>`;
    if (showCoffeeCode && coffeeCode) linesHtml += `<div class="lbl-line">${coffeeCode}</div>`;

    // Shared rules for both contexts, minus the height on .sticker-item —
    // that has to differ: the actual print window's document body IS the
    // 25mm page (so 100vh correctly fills it), but the in-app preview box
    // below is just a 50x25mm-sized <div> sitting inside the normal page
    // viewport, where 100vh would mean the whole browser window instead —
    // each context appends its own height rule (100% vs 100vh).
    const stickerStyleBase = `
        @page { size: 50mm 25mm; margin: 1mm; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
        .sticker-item {
            width: 100%; box-sizing: border-box;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 0.6mm; text-align: center; padding: 0 1mm;
        }
        /* max-height (not width:100%/height:auto) — batch_code is shorter
           than a lot_code, so scaling it to fill the sticker's full width
           would stretch it proportionally TALLER than the packed-coffee
           barcode, blowing the 25mm height budget. Capping height and
           letting width shrink-to-fit keeps it predictable regardless of
           how many characters the code has. */
        .sticker-svg { max-width: 100%; max-height: 11mm; width: auto; height: auto; display: block; margin: 0 auto; }
        .lbl-line { font-size: 11px; font-weight: 700; line-height: 1; }
        .lbl-line-bold { font-size: 13px; }
    `;

    const html = `
        <div style="display:flex; flex-direction:column; align-items:center; gap:20px; padding:10px;">
            <p style="color:var(--text-muted); font-size:0.85rem; text-align:center;">Print preview — 50mm × 25mm, same size/style as the Packed Coffee label.</p>
            <div style="width:50mm; height:25mm; background:#fff; border:1px dashed #666; border-radius:2px; box-shadow:0 4px 15px rgba(0,0,0,0.15); overflow:hidden;">
                <style>${stickerStyleBase} .sticker-item { height: 100%; }</style>
                <div class="sticker-item">
                    <svg id="sticker-preview-barcode" class="sticker-svg"></svg>
                    ${linesHtml}
                </div>
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

    // JsBarcode is loaded globally (index.html <head>) for the scanner
    // listener elsewhere, so it's available here without a separate include.
    if (typeof JsBarcode !== 'undefined') {
        JsBarcode('#sticker-preview-barcode', batch.batch_code, { format: 'CODE128', width: 1.1, height: 46, displayValue: true, fontSize: 9, margin: 2 });
    }

    document.getElementById('btn-execute-label-print').addEventListener('click', () => {
        // Same printer-driver rotation workaround as buildFixedLabelDocument
        // (packing.js) — see that function's comment for the geometry. The
        // preview above always stays landscape; only the actual print
        // window's @page/.sticker-item CSS change when the toggle is on.
        const rotate = companySettings.label_rotate_90 === true;
        const printStickerCss = rotate
            ? `@page { size: 25mm 50mm; margin: 1mm; }
               body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
               .sticker-item {
                   width: 48mm; height: 23mm; box-sizing: border-box;
                   display: flex; flex-direction: column; align-items: center; justify-content: center;
                   gap: 0.6mm; text-align: center; padding: 0 1mm;
                   position: relative; left: 23mm; top: 0;
                   transform: rotate(90deg); transform-origin: top left;
               }
               .sticker-svg { max-width: 100%; max-height: 11mm; width: auto; height: auto; display: block; margin: 0 auto; }
               .lbl-line { font-size: 11px; font-weight: 700; line-height: 1; }
               .lbl-line-bold { font-size: 13px; }`
            : `${stickerStyleBase} .sticker-item { height: 100vh; }`;

        const printWin = window.open('', '', 'width=400,height=300');
        printWin.document.write(`
            <html><head><title>Print Label</title>
            <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
            <style>${printStickerCss}</style></head>
            <body>
                <div class="sticker-item">
                    <svg id="print-barcode" class="sticker-svg"></svg>
                    ${linesHtml}
                </div>
                <script>
                    JsBarcode('#print-barcode', ${JSON.stringify(batch.batch_code)}, { format: 'CODE128', width: 1.1, height: 46, displayValue: true, fontSize: 9, margin: 2 });
                    setTimeout(() => { window.print(); window.close(); }, 400);
                <\/script>
            </body></html>
        `);
        printWin.document.close();
        document.getElementById('btn-close-modal').click();
    });
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

// ==========================================================================
// V2 1B — FIFO green coffee lot consumption for roast batches.
// green_coffee.stock_kg is DERIVED (trigger-summed from
// green_coffee_lots.remaining_kg — see database/v2_lot_tracking_migration.sql),
// so any roast batch save/edit/delete must adjust the lots themselves rather
// than writing stock_kg directly, or the write gets silently reverted the
// next time any lot for that coffee changes (same bug class fixed in 1A for
// intake edit/delete).
// ==========================================================================

// Deducts kgToConsume from green_coffee_lots for greenCoffeeId. If
// preferredLotId is given (a scanned sack), that lot is drawn from first;
// any shortfall is pulled oldest-arrival-first from the coffee's other lots
// — this WILL draw from an older lot the operator skipped, by design (see
// V2_ROADMAP.md 1B). Clamps at total availability instead of erroring:
// returns {draws: [{lotId, kg}], shortfallKg} so the caller can persist the
// draws to roast_batch_green_lots and optionally warn on a nonzero shortfall.
async function consumeGreenCoffeeLotsFifo(greenCoffeeId, kgToConsume, preferredLotId = null) {
    const { data: allLots } = await fetchData('green_coffee_lots');
    const lots = (allLots || [])
        .filter(l => l.green_coffee_id === greenCoffeeId && parseFloat(l.remaining_kg || 0) > 0)
        .sort((a, b) => new Date(a.arrival_date) - new Date(b.arrival_date) || a.id - b.id);

    const ordered = preferredLotId
        ? [...lots.filter(l => l.id === preferredLotId), ...lots.filter(l => l.id !== preferredLotId)]
        : lots;

    let remainingNeeded = kgToConsume;
    const draws = [];
    for (const lot of ordered) {
        if (remainingNeeded <= 0) break;
        const take = Math.min(parseFloat(lot.remaining_kg || 0), remainingNeeded);
        if (take <= 0) continue;
        const newRemaining = parseFloat(lot.remaining_kg) - take;
        await saveData('green_coffee_lots', { id: lot.id, remaining_kg: newRemaining });
        draws.push({ lotId: lot.id, kg: take });
        remainingNeeded -= take;
    }
    return { draws, shortfallKg: Math.max(0, remainingNeeded) };
}

// Reverses a batch's previously recorded consumption (used before
// re-consuming on edit) by adding kg back to the exact lots it was drawn
// from, then removes those roast_batch_green_lots rows. Safe no-op if the
// batch has none (e.g. logged before 1B shipped, or a lot was deleted since).
async function refundGreenCoffeeLotsForBatch(roastBatchId) {
    const { data: allDraws } = await fetchData('roast_batch_green_lots');
    const mine = (allDraws || []).filter(d => d.roast_batch_id === roastBatchId);
    if (mine.length === 0) return;
    const { data: allLots } = await fetchData('green_coffee_lots');
    for (const d of mine) {
        const lot = (allLots || []).find(l => l.id === d.green_coffee_lot_id);
        if (lot) {
            await saveData('green_coffee_lots', { id: lot.id, remaining_kg: parseFloat(lot.remaining_kg || 0) + parseFloat(d.kg_consumed || 0) });
        }
        await deleteData('roast_batch_green_lots', d.id);
    }
}

// Persists the per-lot draws for a just-saved roast batch.
async function recordRoastBatchGreenLots(roastBatchId, draws) {
    for (const d of draws) {
        await saveData('roast_batch_green_lots', { roast_batch_id: roastBatchId, green_coffee_lot_id: d.lotId, kg_consumed: d.kg });
    }
}

async function handleBarcodeScan(barcode) {
    // Parse barcode: RMP:Single:5:2 or RMP:Blend:3:1 or RMP:Lot:{green_coffee_lot_id}:2
    // (V2 1B, sack sticker printed by 1A) or a bare 7-digit
    // {sizeDigit}{batchNo:04d}{multiplier:02d} (V2 FIFO strip code, packed
    // lot sticker printed by Ready to Pack). No "RMP:" prefix at all this
    // time (not even the single-letter prefix an earlier draft of this
    // feature used) — dropping it entirely, not just shortening it, is what
    // let CODE128 pack the payload dense enough to fix the original
    // scan-reliability complaint (module width went from ~0.28mm to
    // ~0.53mm). The tradeoff: a bare digit string can't self-identify as
    // "one of ours" the way the colon-delimited types can, so a garbage
    // 7-digit scan could theoretically match a real strip_code — mitigated
    // by activeDispatchCheckoutHandler's own "not part of this order" check
    // below, which rejects anything that isn't already a line on the open
    // order regardless of how it got resolved.
    const parts = barcode.split(':');
    const isFifoStripBarcode = /^\d{7}$/.test(barcode);

    if (isFifoStripBarcode) {
        // V2 FIFO strip code: only meaningful while a dispatch checkout
        // modal is open — it registers itself as the active handler (see
        // js/packing.js openDispatchCheckoutModal) so scans land in the
        // right cart instead of silently doing nothing.
        if (typeof window.activeDispatchCheckoutHandler !== 'function') {
            await showWarningModal('Scan this inside an order\'s Checkout screen (Packing → Order Requests → Prepare) — no checkout is open right now.', false);
            return;
        }

        const sizeDigit = parseInt(barcode.charAt(0), 10);
        const stripCode = barcode.slice(0, 5);
        const multRaw = parseInt(barcode.slice(5, 7), 10);

        const [{ data: packagingSizes }, { data: packedLots }] = await Promise.all([
            fetchData('packaging_sizes'),
            fetchData('packed_coffee_lots')
        ]);
        const sizeDef = (packagingSizes || []).find(s => s.size_digit === sizeDigit);
        if (!sizeDef) {
            await showWarningModal(`No packaging size is configured for FIFO digit ${sizeDigit} (Settings → Production → Packaging Sizes).`, false);
            return;
        }
        // Matches the DB's own live-uniqueness guarantee (strip_code is only
        // unique among lots with remaining_pcs > 0 — see
        // packed_coffee_lots_strip_code_live_uniq) — filtering the same way
        // here means this lookup can never find more than one candidate.
        const matchedLot = (packedLots || []).find(l => l.strip_code === stripCode && (parseInt(l.remaining_pcs) || 0) > 0);
        if (!matchedLot) {
            await showWarningModal(`No lot found for strip code ${stripCode} with stock remaining — it may already be fully used or the code was misread.`, false);
            return;
        }

        await window.activeDispatchCheckoutHandler(matchedLot.id, sizeDef.gram, multRaw > 0 ? multRaw : null);
        return;
    }

    if (parts.length !== 4 || parts[0] !== 'RMP') {
        alert('Invalid barcode format: ' + barcode);
        return;
    }

    const [prefix, coffeeType, coffeeIdStr, machineIdStr] = parts;
    const coffeeId = parseInt(coffeeIdStr);
    const machineId = parseInt(machineIdStr);

    if (coffeeType === 'Lot') {
        // V2 1B: a sack barcode encodes the specific green_coffee_lots row,
        // not the coffee directly — resolve it, then warn if an OLDER lot of
        // the same coffee still has stock (the operator may have grabbed a
        // newer sack out of order). Cancel aborts entirely — the Quick Roast
        // Log modal does not open (see V2_ROADMAP.md 1B).
        const lotId = coffeeId;
        const { data: lots } = await fetchData('green_coffee_lots');
        const scannedLot = (lots || []).find(l => l.id === lotId);
        if (!scannedLot) {
            alert('This lot could not be found (it may have been deleted). Scan a current sack label, or log this batch manually.');
            return;
        }

        const olderLot = (lots || [])
            .filter(l => l.green_coffee_id === scannedLot.green_coffee_id && l.id !== lotId && parseFloat(l.remaining_kg || 0) > 0)
            .filter(l => new Date(l.arrival_date) < new Date(scannedLot.arrival_date))
            .sort((a, b) => new Date(a.arrival_date) - new Date(b.arrival_date))[0];

        if (olderLot) {
            const proceed = await showWarningModal(
                `An older lot of this coffee is still in stock: ${olderLot.lot_code} (arrived ${olderLot.arrival_date}, ${parseFloat(olderLot.remaining_kg).toFixed(1)}kg left).\n\nThis sack is from a newer lot (${scannedLot.lot_code}, arrived ${scannedLot.arrival_date}). Roast the older lot first for freshness rotation, unless there's a good reason not to.\n\nProceed with this sack anyway?`,
                true
            );
            if (!proceed) return;
        }

        await openQuickRoastModal('Single', scannedLot.green_coffee_id, machineId, lotId);
        return;
    }

    // Open the quick roast form
    await openQuickRoastModal(coffeeType, coffeeId, machineId);
}

// ==========================================================================
// QUICK ROAST MODAL (Barcode Scan)
// ==========================================================================
async function openQuickRoastModal(coffeeType, coffeeId, machineId, scannedLotId = null) {
    // Fetch required data
    const [
        { data: greenbeans },
        { data: recipes },
        { data: machines },
        { data: batches },
        { data: ingredients }
    ] = await Promise.all([
        fetchData('green_coffee'),
        fetchData('blend_recipes'),
        fetchData('machines'),
        fetchData('roast_batches'),
        fetchData('blend_ingredients')
    ]);
    
    // Lookup coffee name
    let coffeeName = 'Unknown';
    let coffeeVal = '';
    let defaultGreenWeight = 5000;
    
    if (coffeeType === 'Single') {
        const gb = (greenbeans || []).find(g => g.id === coffeeId);
        if (gb) {
            coffeeName = gb.name;
            coffeeVal = `Single-${coffeeId}`;
        }
    } else {
        const rec = (recipes || []).find(r => r.id === coffeeId);
        if (rec) {
            coffeeName = rec.name;
            coffeeVal = `Blend-${coffeeId}`;
            if (rec.batch_size_g) defaultGreenWeight = rec.batch_size_g;
        }
    }
    
    // Lookup machine
    const machine = (machines || []).find(m => m.id === machineId);
    const machineName = machine ? machine.name : 'Unknown';
    if (machine && machine.ideal_batch_size_g) defaultGreenWeight = machine.ideal_batch_size_g;
    
    // Build same form as openBatchLogModal but auto-filled
    const gbSelectOpts = [...(greenbeans || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(g => `<option value="Single-${g.id}" ${g.id === coffeeId && coffeeType === 'Single' ? 'selected' : ''}>${g.name}</option>`).join('');
    const recSelectOpts = [...(recipes || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(r => `<option value="Blend-${r.id}" ${r.id === coffeeId && coffeeType === 'Blend' ? 'selected' : ''}>${r.name}</option>`).join('');
    const machOpts = (machines || []).map(m => `<option value="${m.id}" ${m.id === machineId ? 'selected' : ''}>${m.name}</option>`).join('');
    
    const todayStr = new Date().toISOString().split('T')[0];
    
    const html = `
        <form id="modal-batch-form">
            <div style="background: var(--primary-light); color: var(--primary); padding: 8px 12px; border-radius: 6px; margin-bottom: 16px; font-size: 0.85rem; display: flex; align-items: center; gap: 8px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="14" y1="8" x2="14" y2="16"/><line x1="18" y1="8" x2="18" y2="16"/></svg>
                <strong>Quick Scan Mode</strong> — ${coffeeName} on ${machineName}
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Batch Code</label>
                    <input type="text" id="m-bat-code" class="form-control" value="" readonly style="background:var(--border);">
                </div>
                <div class="form-group">
                    <label class="form-label">Date</label>
                    <input type="date" id="m-bat-date" class="form-control" value="${todayStr}" required>
                </div>
            </div>
            <div class="form-row mt-3" >
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
                    </div>
                </div>
            </div>
            <div class="form-row" style="align-items: flex-end; gap: 15px; margin-top: 15px;">
                <div class="form-group flex-1-mb-0" >
                    <label class="form-label">Coffee</label>
                    <select id="m-bat-coffee" class="form-control" required>
                        <option value="" disabled>-- Select Coffee --</option>
                        <optgroup label="Single Origin">
                            ${gbSelectOpts}
                        </optgroup>
                        <optgroup label="Blend Recipes">
                            ${recSelectOpts}
                        </optgroup>
                    </select>
                </div>
            </div>
            <div class="form-row mt-3" >
                <div class="form-group">
                    <label class="form-label">Greenbean Weight (gram)</label>
                    <input type="number" step="1" id="m-bat-greenbean" class="form-control" value="${defaultGreenWeight}" required>
                </div>
                <div class="form-group">
                    <label class="form-label" style="color:var(--primary); font-weight:700;">Roasted Weight (gram) ← INPUT HERE</label>
                    <input type="number" step="1" id="m-bat-roasted" class="form-control" required style="border: 2px solid var(--primary); font-weight: 700; font-size: 1.1rem;">
                </div>
            </div>
            <div class="form-row mt-3" >
                <div class="form-group flex-1" >
                    <label class="form-label">Depreciation (%)</label>
                    <input type="text" id="m-bat-depreciation" class="form-control" style="background:var(--border); font-weight:700; color:var(--warning);" readonly value="0.0%">
                </div>
                <div class="form-group flex-1">
                    <label class="form-label">Roast Degree / Agtron (optional)</label>
                    <input type="number" step="1" id="m-bat-degree" class="form-control" placeholder="e.g. 58">
                </div>
            </div>
            <div class="form-group mt-3" >
                <label class="form-label">Notes</label>
                <textarea id="m-bat-notes" class="form-control" rows="2" placeholder="First crack timings, end temperature, etc."></textarea>
            </div>
            <div class="modal-footer-actions-lg">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('btn-close-modal').click()">Cancel</button>
                <button type="submit" class="btn btn-primary">ROASTED!!</button>
            </div>
        </form>
    `;

    openModal('⚡ Quick Roast Log (Barcode Scan)', html);

    const batchCodeInput = document.getElementById('m-bat-code');
    const dateInput = document.getElementById('m-bat-date');
    const machineSelect = document.getElementById('m-bat-machine');
    const coffeeSelect = document.getElementById('m-bat-coffee');
    const greenbeanWeightInput = document.getElementById('m-bat-greenbean');
    const roastedWeightInput = document.getElementById('m-bat-roasted');
    const depreciationInput = document.getElementById('m-bat-depreciation');
    const degreeInput = document.getElementById('m-bat-degree');

    // V2 1F: auto pre-fill Roast Degree from the most recently logged batch of
    // the same coffee + machine (editable — operator can override); blank if
    // no prior batch exists for that combo. Same idiom as openRoastBatchModal.
    function prefillRoastDegree(coffeeVal, mid) {
        if (!coffeeVal || !mid) { degreeInput.value = ''; return; }
        const [cType, cIdStr] = coffeeVal.split('-');
        const cId = parseInt(cIdStr);
        const mIdNum = parseInt(mid);
        const match = (batches || [])
            .filter(b => b.machine_id === mIdNum && b.roast_degree != null &&
                (cType === 'Single' ? b.single_coffee_id === cId : b.blend_recipe_id === cId))
            .sort((a, b) => new Date(b.roast_date) - new Date(a.roast_date) || b.id - a.id)[0];
        degreeInput.value = match ? match.roast_degree : '';
    }
    coffeeSelect.addEventListener('change', () => prefillRoastDegree(coffeeSelect.value, machineSelect.value));
    machineSelect.addEventListener('change', () => prefillRoastDegree(coffeeSelect.value, machineSelect.value));
    prefillRoastDegree(coffeeSelect.value, machineSelect.value);

    // Auto-generate batch code
    async function generateCode() {
        const cv = coffeeSelect.value;
        const mid = machineSelect.value;
        if (!cv || !mid) return;
        const [cType, cIdStr] = cv.split('-');
        const cId = parseInt(cIdStr);
        let coffeeCode = 'COF';
        if (cType === 'Single') {
            const gb = (greenbeans || []).find(g => g.id === cId);
            if (gb) coffeeCode = gb.code || gb.name.slice(0, 3).toUpperCase();
        } else {
            const r = (recipes || []).find(rec => rec.id === cId);
            if (r) coffeeCode = r.code || r.name.slice(0, 3).toUpperCase();
        }
        const mach = (machines || []).find(m => m.id === parseInt(mid));
        const machineCode = mach ? (mach.code || mach.name.slice(0, 2).toUpperCase()) : 'M';
        const d = dateInput.value ? new Date(dateInput.value) : new Date();
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const datePart = `${dd}${mm}`;
        let maxSeq = 0;
        const regex = /^([^-]+)-([A-Za-z0-9]+?)(\d{4})-(\d+)$/;
        (batches || []).forEach(b => {
            if (b.batch_code) {
                const match = b.batch_code.match(regex);
                if (match && match[1] === coffeeCode && match[3] === datePart) {
                    const s = parseInt(match[4]); if (s > maxSeq) maxSeq = s;
                }
            }
        });
        batchCodeInput.value = `${coffeeCode}-${machineCode}${datePart}-${maxSeq + 1}`;
    }
    generateCode();
    
    // Auto-calculate depreciation
    function calcDepreciation() {
        const gw = parseFloat(greenbeanWeightInput.value) || 0;
        const rw = parseFloat(roastedWeightInput.value) || 0;
        if (gw > 0 && rw > 0) {
            const pct = ((gw - rw) / gw) * 100;
            depreciationInput.value = pct.toFixed(1) + '%';
        } else {
            depreciationInput.value = '0.0%';
        }
    }
    greenbeanWeightInput.addEventListener('input', calcDepreciation);
    roastedWeightInput.addEventListener('input', calcDepreciation);
    
    // Focus on roasted weight field after a short delay
    setTimeout(() => {
        roastedWeightInput.focus();
    }, 300);
    
    // Form submit - reuse the same save logic
    document.getElementById('modal-batch-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const code = batchCodeInput.value;
        const roastDate = dateInput.value;
        const mId = parseInt(machineSelect.value);
        const cv = coffeeSelect.value;
        const inputKg = parseFloat(greenbeanWeightInput.value) / 1000;
        const outputKg = parseFloat(roastedWeightInput.value) / 1000;
        const isTest = document.getElementById('m-bat-test').checked;
        const notes = document.getElementById('m-bat-notes').value;
        
        if (!cv || !roastDate || !greenbeanWeightInput.value || !roastedWeightInput.value) {
            alert('Please fill all required fields');
            return;
        }
        
        const [type, idStr] = cv.split('-');
        const id = parseInt(idStr);
        const singleId = type === 'Single' ? id : null;
        const blendId = type === 'Blend' ? id : null;
        
        // V2 1B: consume from green_coffee_lots (FIFO), not a direct stock_kg
        // write — see the matching comment in openRoastBatchModal's submit
        // handler for why. A single scanned via a sack barcode draws from
        // that exact lot first, then any shortfall oldest-first; a blend
        // (or a manually re-picked single) has no lot preference.
        const lotDraws = [];
        if (type === 'Single') {
            const { draws } = await consumeGreenCoffeeLotsFifo(id, inputKg, scannedLotId);
            lotDraws.push(...draws);
        } else {
            const recipeIngs = (ingredients || []).filter(ing => ing.blend_recipe_id === blendId);
            for (const ing of recipeIngs) {
                const req = (parseFloat(ing.percentage) / 100) * inputKg;
                const { draws } = await consumeGreenCoffeeLotsFifo(ing.green_coffee_id, req);
                lotDraws.push(...draws);
            }
        }

        const qcStatus = isTest ? 'Pending' : 'Success';

        const yieldPct = outputKg > 0 && inputKg > 0 ? parseFloat(((outputKg / inputKg) * 100).toFixed(2)) : null;
        const record = {
            batch_code: code,
            roast_date: roastDate,
            roasting_plan_id: null,
            coffee_type: type,
            single_coffee_id: singleId || null,
            blend_recipe_id: blendId || null,
            machine_id: mId,
            input_weight_kg: inputKg,
            output_weight_kg: outputKg,
            yield_percentage: yieldPct,
            roast_type: isTest ? 'Test' : 'Regular',
            qc_status: qcStatus,
            notes: notes || null,
            roast_degree: degreeInput.value ? parseFloat(degreeInput.value) : null
        };

        const { data: savedBatch, error } = await saveData('roast_batches', record);
        if (error) {
            // See the same comment in openRoastBatchModal — auto-retrying
            // with a new code risks silently double-logging a batch if this
            // error was actually caused by a double-submit/double-scan
            // rather than a stale sequence number, so this stops and asks
            // instead of guessing.
            const isDuplicateCode = /duplicate key|unique constraint/i.test(error.message || '');
            const msg = isDuplicateCode
                ? `A batch with code "${code}" already exists. This can happen if you scanned/submitted twice, or logged another batch for the same coffee/machine at nearly the same moment.\n\nPlease check the Batch Logs list to confirm this batch wasn't already saved, then close this form and scan again — a fresh code will be generated.`
                : 'Failed to save batch: ' + error.message;
            alert(msg);
            return;
        }

        // V2 1B: persist which lot(s) this batch drew from.
        await recordRoastBatchGreenLots(savedBatch.id, lotDraws);

        // Update associated plan(s) — same matching/fulfillment logic as the
        // regular Roasting Log form (openRoastBatchModal). Without this, a
        // batch logged via barcode scan never advances its roasting plan's
        // fulfilled_roasted_kg, so the plan stays stuck at 0/target forever.
        const { data: plans } = await fetchData('roasting_plans');
        let matchingPlans = (plans || []).filter(p =>
            p.coffee_type === type &&
            (type === 'Single' ? p.single_coffee_id === singleId : p.blend_recipe_id === blendId) &&
            p.machine_id === mId &&
            p.status !== 'Completed'
        );

        if (matchingPlans.length > 0) {
            // Same tiebreak as openRoastBatchModal (including the V2 1I-b
            // "open sub-plan fills first" priority): sub-plans before normal
            // plans, then earliest plan_date, then id ascending.
            matchingPlans.sort((a, b) => {
                const aSub = a.is_post_blend_component ? 0 : 1;
                const bSub = b.is_post_blend_component ? 0 : 1;
                if (aSub !== bSub) return aSub - bSub;
                return (new Date(a.plan_date) - new Date(b.plan_date)) || (a.id - b.id);
            });
            let remainingOutput = outputKg;

            for (let i = 0; i < matchingPlans.length; i++) {
                if (remainingOutput <= 0) break;
                const p = matchingPlans[i];
                const target = parseFloat(p.target_roasted_kg || 0);
                const currentFulfilled = parseFloat(p.fulfilled_roasted_kg || 0);
                const capacity = Math.max(0, target - currentFulfilled);

                if (remainingOutput <= capacity) {
                    p.fulfilled_roasted_kg = currentFulfilled + remainingOutput;
                    p.status = (p.fulfilled_roasted_kg >= target) ? 'Completed' : 'On Process';
                    remainingOutput = 0;
                    await saveData('roasting_plans', p);
                    await syncPlanStatusToOrderItem(p);
                    if (p.is_post_blend_component && p.status === 'Completed') await tryAssemblePostBlend(p.parent_plan_id);
                } else if (i === matchingPlans.length - 1) {
                    p.fulfilled_roasted_kg = currentFulfilled + remainingOutput;
                    p.status = 'Completed';
                    remainingOutput = 0;
                    await saveData('roasting_plans', p);
                    await syncPlanStatusToOrderItem(p);
                    if (p.is_post_blend_component) await tryAssemblePostBlend(p.parent_plan_id);
                } else {
                    p.fulfilled_roasted_kg = target;
                    p.status = 'Completed';
                    remainingOutput -= capacity;
                    await saveData('roasting_plans', p);
                    await syncPlanStatusToOrderItem(p);
                    if (p.is_post_blend_component) await tryAssemblePostBlend(p.parent_plan_id);
                }
            }
        }

        // Bulk Roasted Coffee sync — a new Quick Roast batch is always a fresh
        // insert (never an edit), so the only transition possible is into
        // 'Success' (or 'Pending' if Batch Test, which adds nothing yet).
        if (qcStatus === 'Success') {
            let coffeeName = 'Roasted Coffee';
            if (type === 'Single') {
                const gb = (greenbeans || []).find(g => g.id === singleId);
                coffeeName = gb ? `${gb.name} (Single)` : 'Single Origin';
            } else {
                const r = (recipes || []).find(rec => rec.id === blendId);
                coffeeName = r ? `${r.name} (Blend)` : 'Blend Recipe';
            }
            await addWeightToBulkRoastedCoffee(type, singleId, blendId, mId, coffeeName, outputKg, roastDate);
        }

        // Show success toast
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed; bottom:20px; right:20px; background:#16a34a; color:white; padding:12px 20px; border-radius:8px; font-weight:700; z-index:99999; box-shadow:0 4px 12px rgba(0,0,0,0.3); animation: fadeIn 0.3s;';
        toast.textContent = `✅ Batch ${code} saved! Ready for next scan.`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);

        // Close modal
        document.getElementById('btn-close-modal').click();

        // Refresh if on roasting page
        if (!document.getElementById('sec-roasting')?.classList.contains('hidden')) {
            loadSectionData('sec-roasting');
        }
        loadGreenbeanInventory();
        scheduleDashboardRefresh();
    });
}
