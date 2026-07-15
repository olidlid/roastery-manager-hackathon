// TRACKING MODULE - ROASTERY MANAGER V2
// Plain script (shared global scope — NOT an ES module). New in V2: lot
// barcode lookup for traceability (see production_lots table, created by
// the "Ready to Pack" print-barcode flow in packing.js). Load order: after
// db.js/auth.js/greenbean.js/roasting.js/packing.js/sales.js/settings.js,
// before app.js.

async function loadTrackingSection() {
    const form = document.getElementById('tracking-search-form');
    const input = document.getElementById('tracking-search-input');
    const scanBtn = document.getElementById('btn-tracking-scan');

    if (form && !form.hasAttribute('data-init')) {
        form.setAttribute('data-init', 'true');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = (input.value || '').trim();
            if (!code) return;
            await performTrackingSearch(code);
        });
    }

    // A barcode scanner acts as a keyboard: focusing the field and letting it
    // "type" the code + Enter is all that's needed — no custom scan-capture
    // logic required, as long as lot codes don't collide with the 'RMP:'
    // prefix the global quick-roast-log scanner listener reacts to (see the
    // GLOBAL BARCODE SCANNER LISTENER section in app.js). Lot codes are
    // generated as 'LOT-...' so there's no ambiguity between the two.
    if (scanBtn && !scanBtn.hasAttribute('data-init')) {
        scanBtn.setAttribute('data-init', 'true');
        scanBtn.addEventListener('click', () => {
            if (!input) return;
            input.value = '';
            input.focus();
        });
    }
}

function setTrackingResultState(state) {
    const empty = document.getElementById('tracking-result-empty');
    const notFound = document.getElementById('tracking-result-notfound');
    const result = document.getElementById('tracking-result-card');
    if (empty) empty.classList.toggle('hidden', state !== 'empty');
    if (notFound) notFound.classList.toggle('hidden', state !== 'notfound');
    if (result) result.classList.toggle('hidden', state !== 'result');
}

async function performTrackingSearch(rawCode) {
    const code = rawCode.trim().toUpperCase();

    const { data: lots } = await fetchData('production_lots');
    const lot = (lots || []).find(l => (l.lot_code || '').toUpperCase() === code);

    if (!lot) {
        setTrackingResultState('notfound');
        return;
    }

    const [
        { data: machines },
        { data: greenCoffees },
        { data: greenCoffeeIntake },
        { data: blendIngredients },
        { data: roastBatches }
    ] = await Promise.all([
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('green_coffee_intake'),
        fetchData('blend_ingredients'),
        fetchData('roast_batches')
    ]);

    const machine = (machines || []).find(m => m.id === lot.machine_id);

    let processText = '-';
    let supplierText = '-';
    let greenbeanDateText = '-';

    if (lot.coffee_type === 'Blend') {
        const ingredients = (blendIngredients || []).filter(bi => bi.blend_recipe_id === lot.blend_recipe_id);
        const origins = ingredients
            .map(bi => (greenCoffees || []).find(g => g.id === bi.green_coffee_id))
            .filter(Boolean);

        if (origins.length > 0) {
            processText = origins.map(g => `${g.name} (${g.process || '-'})`).join('; ');
            supplierText = origins.map(g => `${g.name}: ${g.supplier || '-'}`).join('; ');

            const intakeDates = (greenCoffeeIntake || [])
                .filter(gi => origins.some(g => g.id === gi.green_coffee_id))
                .map(gi => gi.date)
                .filter(Boolean)
                .sort((a, b) => new Date(b) - new Date(a));
            greenbeanDateText = intakeDates[0] || origins.map(g => g.purchase_date).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || '-';
        }
    } else {
        const gb = (greenCoffees || []).find(g => g.id === lot.single_coffee_id);
        if (gb) {
            processText = gb.process || '-';
            supplierText = gb.supplier || '-';
            const intakeDates = (greenCoffeeIntake || [])
                .filter(gi => gi.green_coffee_id === gb.id)
                .map(gi => gi.date)
                .filter(Boolean)
                .sort((a, b) => new Date(b) - new Date(a));
            greenbeanDateText = intakeDates[0] || gb.purchase_date || '-';
        }
    }

    const roastBatch = (roastBatches || []).find(b => b.id === lot.latest_roast_batch_id);
    const roastDateText = roastBatch ? (roastBatch.roast_date || '-') : '-';
    // V2 1F: single-value for now, same limitation as roastDateText above
    // (only the lot's latest_roast_batch_id, not every batch that fed it —
    // full "show ALL values as lists" multi-batch support is deferred to the
    // Tracking precision rework, see V2_ROADMAP.md 1·CHAIN).
    const roastDegreeText = (roastBatch && roastBatch.roast_degree != null) ? roastBatch.roast_degree : '-';

    document.getElementById('tracking-result-coffee-name').textContent = lot.coffee_name || '-';
    document.getElementById('tracking-result-lot-code').textContent = lot.lot_code;
    document.getElementById('tracking-result-process').textContent = processText;
    document.getElementById('tracking-result-supplier').textContent = supplierText;
    document.getElementById('tracking-result-machine').textContent = machine ? machine.name : '-';
    document.getElementById('tracking-result-greenbean-date').textContent = greenbeanDateText;
    document.getElementById('tracking-result-roast-date').textContent = roastDateText;
    document.getElementById('tracking-result-roast-degree').textContent = roastDegreeText;
    document.getElementById('tracking-result-pack-date').textContent = lot.production_date || '-';

    setTrackingResultState('result');
}
