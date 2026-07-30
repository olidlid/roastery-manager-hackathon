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
    // GLOBAL BARCODE SCANNER LISTENER section in app.js). production_lots
    // codes are {coffee code}-{machine code}{MMDDYY}{lot number} (see
    // buildLotCode in js/packing.js) — never starts with 'RMP:', so no
    // ambiguity between the two.
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

// V2 1·CHAIN precision: show ALL values as lists when a lot resolves to
// multiple batches/green lots — no representative-single collapsing, only
// true duplicates collapse (e.g. every batch used the same supplier).
// See V2_ROADMAP.md 1·CHAIN.
function trackingUniqueJoin(values) {
    const clean = [...new Set(values.filter(v => v !== null && v !== undefined && v !== ''))];
    return clean.length > 0 ? clean.join(', ') : '-';
}

// Resolves the origin chain (process/supplier/dates/roast info) for one
// production_lot-shaped object. Extracted out of performTrackingSearch so
// V2 1I's post-blend branch can call it again per-component (a post-blend's
// each source is itself always a non-post-blend coffee, so this never
// recurses more than one level deep). `lotLike` needs: id (nullable —
// null means "no label was ever printed for this source, resolve shallow"),
// coffee_type, single_coffee_id, blend_recipe_id, latest_roast_batch_id.
function resolveLotChain(lotLike, ctx) {
    const { greenCoffees, greenCoffeeIntake, blendIngredients, roastBatches, productionLotBatches, roastBatchGreenLots, greenCoffeeLots } = ctx;

    // Every roast batch that actually fed this production lot (same
    // coffee+machine+day, snapshotted at print time — see
    // syncProductionLotBatches in js/packing.js). Falls back to the older
    // single latest_roast_batch_id approximation for lots printed before
    // that wiring existed, or (for a component with no lot at all) resolves
    // to nothing, which is the correct "no batch-level precision" answer.
    const linkedBatchIds = (productionLotBatches || [])
        .filter(plb => plb.production_lot_id === lotLike.id)
        .map(plb => plb.roast_batch_id);
    const feedingBatches = linkedBatchIds.length > 0
        ? (roastBatches || []).filter(b => linkedBatchIds.includes(b.id))
        : (roastBatches || []).filter(b => b.id === lotLike.latest_roast_batch_id);

    const roastDateText = trackingUniqueJoin(feedingBatches.map(b => b.roast_date));
    const roastDegreeText = trackingUniqueJoin(feedingBatches.map(b => b.roast_degree));

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
        processText = trackingUniqueJoin(coffeesForLots.map(g => g.process));
        supplierText = trackingUniqueJoin(drawnGreenLots.map(gl => gl.supplier));
        greenbeanDateText = trackingUniqueJoin(drawnGreenLots.map(gl => gl.arrival_date));
        moistureText = trackingUniqueJoin(coffeesForLots.map(g => g.moisture_content));
        waterActivityText = trackingUniqueJoin(coffeesForLots.map(g => g.water_activity));
        densityText = trackingUniqueJoin(coffeesForLots.map(g => g.density));
    } else if (lotLike.coffee_type === 'Blend') {
        // Fallback: batches predate 1B's lot-level consumption tracking
        // (roast_batch_green_lots never populated for them) — same
        // coffee-level approximation Tracking always used.
        const ingredients = (blendIngredients || []).filter(bi => bi.blend_recipe_id === lotLike.blend_recipe_id);
        const origins = ingredients
            .map(bi => (greenCoffees || []).find(g => g.id === bi.green_coffee_id))
            .filter(Boolean);

        if (origins.length > 0) {
            processText = origins.map(g => `${g.name} (${g.process || '-'})`).join('; ');
            supplierText = origins.map(g => `${g.name}: ${g.supplier || '-'}`).join('; ');
            moistureText = trackingUniqueJoin(origins.map(g => g.moisture_content));
            waterActivityText = trackingUniqueJoin(origins.map(g => g.water_activity));
            densityText = trackingUniqueJoin(origins.map(g => g.density));

            const intakeDates = (greenCoffeeIntake || [])
                .filter(gi => origins.some(g => g.id === gi.green_coffee_id))
                .map(gi => gi.date)
                .filter(Boolean)
                .sort((a, b) => new Date(b) - new Date(a));
            greenbeanDateText = intakeDates[0] || origins.map(g => g.purchase_date).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || '-';
        }
    } else {
        const gb = (greenCoffees || []).find(g => g.id === lotLike.single_coffee_id);
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

    return { processText, supplierText, greenbeanDateText, roastDateText, roastDegreeText, moistureText, waterActivityText, densityText };
}

async function performTrackingSearch(rawCode) {
    const code = rawCode.trim().toUpperCase();

    const [{ data: lots }, { data: packedLotsForSearch }] = await Promise.all([
        fetchData('production_lots'),
        fetchData('packed_coffee_lots')
    ]);
    let lot = (lots || []).find(l => (l.lot_code || '').toUpperCase() === code);

    // V2 FIFO strip code: the short code printed on packed-coffee stickers
    // (e.g. "10021") isn't itself a production_lots.lot_code — it's a
    // shorthand for one. If the direct lookup above missed, try resolving
    // it (or the packed lot's own long-form lot_code) via packed_coffee_lots
    // and follow that lot's production_lot_id back to the same row the
    // direct search would have found — same result screen either way, so
    // whichever code someone has in hand (long or short) finds it.
    if (!lot) {
        const matchedPacked = (packedLotsForSearch || []).find(l =>
            (l.strip_code || '') === rawCode.trim() || (l.lot_code || '').toUpperCase() === code
        );
        if (matchedPacked && matchedPacked.production_lot_id) {
            lot = (lots || []).find(l => l.id === matchedPacked.production_lot_id);
        }
    }

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
        { data: greenCoffeeLots },
        { data: bulkList },
        { data: postBlendComponents },
        { data: packedCoffeeLots },
        { data: packedList },
        { data: roastingPlans }
    ] = await Promise.all([
        fetchData('machines'),
        fetchData('green_coffee'),
        fetchData('green_coffee_intake'),
        fetchData('blend_ingredients'),
        fetchData('roast_batches'),
        fetchData('production_lot_batches'),
        fetchData('roast_batch_green_lots'),
        fetchData('green_coffee_lots'),
        fetchData('bulk_roasted_coffee'),
        fetchData('post_blend_components'),
        fetchData('packed_coffee_lots'),
        fetchData('packed_coffee'),
        fetchData('roasting_plans')
    ]);

    const ctx = { greenCoffees, greenCoffeeIntake, blendIngredients, roastBatches, productionLotBatches, roastBatchGreenLots, greenCoffeeLots };
    const machine = (machines || []).find(m => m.id === lot.machine_id);
    const chain = resolveLotChain(lot, ctx);

    document.getElementById('tracking-result-coffee-name').textContent = lot.coffee_name || '-';
    document.getElementById('tracking-result-lot-code').textContent = lot.lot_code;
    document.getElementById('tracking-result-process').textContent = chain.processText;
    document.getElementById('tracking-result-supplier').textContent = chain.supplierText;
    document.getElementById('tracking-result-machine').textContent = machine ? machine.name : '-';
    document.getElementById('tracking-result-greenbean-date').textContent = chain.greenbeanDateText;
    document.getElementById('tracking-result-roast-date').textContent = chain.roastDateText;
    document.getElementById('tracking-result-roast-degree').textContent = chain.roastDegreeText;
    document.getElementById('tracking-result-pack-date').textContent = lot.production_date || '-';
    document.getElementById('tracking-result-moisture').textContent = chain.moistureText;
    document.getElementById('tracking-result-water-activity').textContent = chain.waterActivityText;
    document.getElementById('tracking-result-density').textContent = chain.densityText;

    // V2 1I: post-blend nested chain — a post-blend bulk's own "lot chain"
    // is meaningless (it wasn't roasted, it was assembled from other stock),
    // so instead recursively resolve each post_blend_components row's own
    // origin and render it as an indented sub-list under the main result.
    const compositionEl = document.getElementById('tracking-result-composition');
    if (compositionEl) {
        const bulk = (bulkList || []).find(b => b.id === lot.bulk_roasted_coffee_id);
        if (bulk && bulk.is_post_blend && bulk.source_plan_id) {
            // V2 1I-b: recipe-based post-blend — components are fresh roast
            // batches (roast_batches.roast_plan_id), not existing stock, so
            // resolve each sub-plan's own chain directly instead of via
            // post_blend_components (that table is 1I-a only).
            const subPlans = (roastingPlans || []).filter(p => p.parent_plan_id === bulk.source_plan_id);
            const rowsHtml = subPlans.map(sp => {
                const gb = (greenCoffees || []).find(g => g.id === sp.single_coffee_id);
                const label = gb ? gb.name : 'Unknown';
                const kg = parseFloat(sp.fulfilled_roasted_kg) || 0;

                const subFeedingBatches = (roastBatches || []).filter(b => b.roast_plan_id === sp.id);
                const subFeedingBatchIds = subFeedingBatches.map(b => b.id);
                const subDrawnGreenLotIds = [...new Set(
                    (roastBatchGreenLots || [])
                        .filter(rbgl => subFeedingBatchIds.includes(rbgl.roast_batch_id))
                        .map(rbgl => rbgl.green_coffee_lot_id)
                )];
                const subDrawnGreenLots = (greenCoffeeLots || []).filter(gl => subDrawnGreenLotIds.includes(gl.id));

                let detailHtml = '<span style="color: var(--text-muted); font-size: 0.8rem;">No further trace available</span>';
                if (subDrawnGreenLots.length > 0) {
                    const process = trackingUniqueJoin(subDrawnGreenLots.map(gl => (greenCoffees || []).find(g => g.id === gl.green_coffee_id)).filter(Boolean).map(g => g.process));
                    const supplier = trackingUniqueJoin(subDrawnGreenLots.map(gl => gl.supplier));
                    const roastDate = trackingUniqueJoin(subFeedingBatches.map(b => b.roast_date));
                    detailHtml = `<div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.5;">
                        Process: ${process} · Supplier: ${supplier}<br>
                        Roasted: ${roastDate} · Machine: ${(machines || []).find(m => m.id === sp.machine_id)?.name || '-'}
                    </div>`;
                } else if (gb) {
                    detailHtml = `<div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.5;">
                        Process: ${gb.process || '-'} · Supplier: ${gb.supplier || '-'}
                    </div>`;
                }

                return `<li style="margin-bottom: 10px; padding-left: 12px; border-left: 2px solid var(--border-color);">
                    <div style="font-weight: 600;">${label} <span style="font-weight: 400; color: var(--text-muted); font-family: monospace; font-size: 0.8rem;">— ${kg.toFixed(2)} kg${sp.status === 'Stopped' ? ' (stopped short)' : ''}</span></div>
                    ${detailHtml}
                </li>`;
            }).join('');

            compositionEl.innerHTML = `<div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                <div style="font-weight: 700; margin-bottom: 8px;">Post-Blend Composition</div>
                <ul style="list-style: none; margin: 0; padding: 0;">${rowsHtml || '<li style="color: var(--text-muted);">No components recorded</li>'}</ul>
            </div>`;
            compositionEl.classList.remove('hidden');
        } else if (bulk && bulk.is_post_blend) {
            const comps = (postBlendComponents || []).filter(c => c.blend_bulk_id === bulk.id);
            const rowsHtml = comps.map(c => {
                let label = 'Unknown';
                let originLot = null;

                if (c.source_type === 'Bulk') {
                    const srcBulk = (bulkList || []).find(b => b.id === c.source_bulk_id);
                    label = srcBulk ? srcBulk.coffee_name : 'Unknown';
                    // Most recent label ever printed for this source bulk, if any.
                    originLot = (lots || [])
                        .filter(l => l.bulk_roasted_coffee_id === c.source_bulk_id)
                        .sort((a, b) => (b.production_date || '').localeCompare(a.production_date || ''))[0] || null;
                    if (!originLot && srcBulk) {
                        // No label was ever printed for this source — resolve
                        // shallow, straight off the bulk row (name/process/
                        // supplier only, no batch-level roast/green-lot precision).
                        originLot = { id: null, coffee_type: srcBulk.coffee_type, single_coffee_id: srcBulk.single_coffee_id, blend_recipe_id: srcBulk.blend_recipe_id, latest_roast_batch_id: null };
                    }
                } else {
                    const plLot = (packedCoffeeLots || []).find(l => l.id === c.source_packed_lot_id);
                    const packed = plLot ? (packedList || []).find(p => p.id === plLot.packed_coffee_id) : null;
                    label = packed ? (packed.custom_coffee_name || 'Roasted Coffee') : 'Unknown';
                    if (plLot && plLot.production_lot_id) {
                        originLot = (lots || []).find(l => l.id === plLot.production_lot_id) || null;
                    }
                }

                const kg = parseFloat(c.kg) || 0;
                let detailHtml = '<span style="color: var(--text-muted); font-size: 0.8rem;">No further trace available</span>';
                if (originLot) {
                    const subChain = resolveLotChain(originLot, ctx);
                    detailHtml = `<div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.5;">
                        Process: ${subChain.processText} · Supplier: ${subChain.supplierText}<br>
                        Green arrival: ${subChain.greenbeanDateText} · Roasted: ${subChain.roastDateText}
                    </div>`;
                }

                return `<li style="margin-bottom: 10px; padding-left: 12px; border-left: 2px solid var(--border-color);">
                    <div style="font-weight: 600;">${label} <span style="font-weight: 400; color: var(--text-muted); font-family: monospace; font-size: 0.8rem;">— ${kg.toFixed(2)} kg</span></div>
                    ${detailHtml}
                </li>`;
            }).join('');

            compositionEl.innerHTML = `<div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                <div style="font-weight: 700; margin-bottom: 8px;">Post-Blend Composition</div>
                <ul style="list-style: none; margin: 0; padding: 0;">${rowsHtml || '<li style="color: var(--text-muted);">No components recorded</li>'}</ul>
            </div>`;
            compositionEl.classList.remove('hidden');
        } else {
            compositionEl.innerHTML = '';
            compositionEl.classList.add('hidden');
        }
    }

    setTrackingResultState('result');
}
