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
        { data: roastBatches },
        { data: productionLotBatches },
        { data: roastBatchGreenLots },
        { data: greenCoffeeLots }
    ] = await Promise.all([
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('green_coffee_intake'),
        fetchData('blend_ingredients'),
        fetchData('roast_batches'),
        fetchData('production_lot_batches'),
        fetchData('roast_batch_green_lots'),
        fetchData('green_coffee_lots')
    ]);

    const machine = (machines || []).find(m => m.id === lot.machine_id);

    // V2 1·CHAIN precision: show ALL values as lists when a lot resolves to
    // multiple batches/green lots — no representative-single collapsing,
    // only true duplicates collapse (e.g. every batch used the same
    // supplier). See V2_ROADMAP.md 1·CHAIN.
    const uniqueJoin = (values) => {
        const clean = [...new Set(values.filter(v => v !== null && v !== undefined && v !== ''))];
        return clean.length > 0 ? clean.join(', ') : '-';
    };

    // Every roast batch that actually fed this production lot (same
    // coffee+machine+day, snapshotted at print time — see
    // syncProductionLotBatches in js/packing.js). Falls back to the older
    // single latest_roast_batch_id approximation for lots printed before
    // that wiring existed.
    const linkedBatchIds = (productionLotBatches || [])
        .filter(plb => plb.production_lot_id === lot.id)
        .map(plb => plb.roast_batch_id);
    const feedingBatches = linkedBatchIds.length > 0
        ? (roastBatches || []).filter(b => linkedBatchIds.includes(b.id))
        : (roastBatches || []).filter(b => b.id === lot.latest_roast_batch_id);

    const roastDateText = uniqueJoin(feedingBatches.map(b => b.roast_date));
    const roastDegreeText = uniqueJoin(feedingBatches.map(b => b.roast_degree));

    // The actual green_coffee_lots those batches drew from (recorded by 1B's
    // FIFO consumption) — real per-lot traceability instead of a "most
    // recent intake for this coffee" approximation.
    const feedingBatchIds = feedingBatches.map(b => b.id);
    const drawnGreenLotIds = [...new Set(
        (roastBatchGreenLots || [])
            .filter(rbgl => feedingBatchIds.includes(rbgl.roast_batch_id))
            .map(rbgl => rbgl.green_coffee_lot_id)
    )];
    const drawnGreenLots = (greenCoffeeLots || []).filter(gl => drawnGreenLotIds.includes(gl.id));

    let processText = '-';
    let supplierText = '-';
    let greenbeanDateText = '-';
    let moistureText = '-';
    let waterActivityText = '-';
    let densityText = '-';

    if (drawnGreenLots.length > 0) {
        const coffeesForLots = drawnGreenLots
            .map(gl => (greenCoffees || []).find(g => g.id === gl.green_coffee_id))
            .filter(Boolean);
        processText = uniqueJoin(coffeesForLots.map(g => g.process));
        supplierText = uniqueJoin(drawnGreenLots.map(gl => gl.supplier));
        greenbeanDateText = uniqueJoin(drawnGreenLots.map(gl => gl.arrival_date));
        moistureText = uniqueJoin(coffeesForLots.map(g => g.moisture_content));
        waterActivityText = uniqueJoin(coffeesForLots.map(g => g.water_activity));
        densityText = uniqueJoin(coffeesForLots.map(g => g.density));
    } else if (lot.coffee_type === 'Blend') {
        // Fallback: batches predate 1B's lot-level consumption tracking
        // (roast_batch_green_lots never populated for them) — same
        // coffee-level approximation Tracking always used.
        const ingredients = (blendIngredients || []).filter(bi => bi.blend_recipe_id === lot.blend_recipe_id);
        const origins = ingredients
            .map(bi => (greenCoffees || []).find(g => g.id === bi.green_coffee_id))
            .filter(Boolean);

        if (origins.length > 0) {
            processText = origins.map(g => `${g.name} (${g.process || '-'})`).join('; ');
            supplierText = origins.map(g => `${g.name}: ${g.supplier || '-'}`).join('; ');
            moistureText = uniqueJoin(origins.map(g => g.moisture_content));
            waterActivityText = uniqueJoin(origins.map(g => g.water_activity));
            densityText = uniqueJoin(origins.map(g => g.density));

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
            moistureText = gb.moisture_content ?? '-';
            waterActivityText = gb.water_activity ?? '-';
            densityText = gb.density ?? '-';
            const intakeDates = (greenCoffeeIntake || [])
                .filter(gi => gi.green_coffee_id === gb.id)
                .map(gi => gi.date)
                .filter(Boolean)
                .sort((a, b) => new Date(b) - new Date(a));
            greenbeanDateText = intakeDates[0] || gb.purchase_date || '-';
        }
    }

    document.getElementById('tracking-result-coffee-name').textContent = lot.coffee_name || '-';
    document.getElementById('tracking-result-lot-code').textContent = lot.lot_code;
    document.getElementById('tracking-result-process').textContent = processText;
    document.getElementById('tracking-result-supplier').textContent = supplierText;
    document.getElementById('tracking-result-machine').textContent = machine ? machine.name : '-';
    document.getElementById('tracking-result-greenbean-date').textContent = greenbeanDateText;
    document.getElementById('tracking-result-roast-date').textContent = roastDateText;
    document.getElementById('tracking-result-roast-degree').textContent = roastDegreeText;
    document.getElementById('tracking-result-pack-date').textContent = lot.production_date || '-';
    document.getElementById('tracking-result-moisture').textContent = moistureText;
    document.getElementById('tracking-result-water-activity').textContent = waterActivityText;
    document.getElementById('tracking-result-density').textContent = densityText;

    setTrackingResultState('result');
}
