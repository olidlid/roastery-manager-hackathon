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
    const { roastBatches, productionLotBatches } = ctx;

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
    return chainFromBatches(feedingBatches, lotLike, ctx);
}

// The chain for a known set of roast batches — shared by resolveLotChain and
// the recipe post-blend rows (whose batches come from a sub-plan instead of a
// printed lot). `lotLike` only needs coffee_type / single_coffee_id /
// blend_recipe_id for the no-lot-tracking fallbacks.
function chainFromBatches(feedingBatches, lotLike, ctx) {
    const { greenCoffees, greenCoffeeIntake, blendIngredients, roastBatchGreenLots, greenCoffeeLots } = ctx;

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
    const searchedPackedLot = (packedLotsForSearch || []).find(l =>
        (l.strip_code || '') === rawCode.trim() || (l.lot_code || '').toUpperCase() === code
    ) || null;

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
        { data: roastingPlans },
        { data: repackSources },
        { data: recipes },
        { data: codeDefinitions }
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
        fetchData('roasting_plans'),
        fetchData('repack_sources'),
        fetchData('blend_recipes'),
        fetchData('code_definitions')
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

    const fieldsEl = document.getElementById('tracking-result-fields');
    if (fieldsEl) fieldsEl.classList.remove('hidden');

    // Blends (custom blends and recipe-assembled post-blends) are a mix of
    // several coffees, so a single Process/Supplier/lab value means nothing
    // for them: the result shows only the blend's own facts, and every
    // origin detail moves into one table row per component (mockup approved
    // 2026-09-29). Repacks and ordinary lots keep the field grid.
    const compositionEl = document.getElementById('tracking-result-composition');
    if (compositionEl) {
        const bulk = (bulkList || []).find(b => b.id === lot.bulk_roasted_coffee_id);
        const typeOf = (type, singleId, blendId) => {
            if (type === 'Single') {
                const g = (greenCoffees || []).find(x => x.id === singleId);
                return g ? { type: 'Single', code: g.code || '' } : null;
            }
            if (type === 'Blend') {
                const r = (recipes || []).find(x => x.id === blendId);
                return r ? { type: 'Blend', code: r.code || '' } : null;
            }
            return null;
        };

        if (bulk && bulk.is_post_blend && bulk.source_plan_id) {
            // Recipe-based post-blend — components are fresh roast batches
            // (roast_batches.roast_plan_id) per sub-plan, not existing stock.
            const subPlans = (roastingPlans || []).filter(p => p.parent_plan_id === bulk.source_plan_id);
            const components = subPlans.map(sp => {
                const gb = (greenCoffees || []).find(g => g.id === sp.single_coffee_id);
                const feeding = (roastBatches || []).filter(b => b.roast_plan_id === sp.id);
                return {
                    name: gb ? gb.name : 'Unknown',
                    identity: gb ? { type: 'Single', code: gb.code || '' } : null,
                    source: 'roast',
                    lotCode: trackingUniqueJoin(feeding.map(b => b.batch_number)),
                    extra: sp.status === 'Stopped' ? stT('trk_stopped_short', 'stopped short') : '',
                    kg: parseFloat(sp.fulfilled_roasted_kg) || 0,
                    chain: chainFromBatches(feeding, { coffee_type: 'Single', single_coffee_id: sp.single_coffee_id }, ctx)
                };
            });
            const roastDate = trackingUniqueJoin(subPlans.flatMap(sp => (roastBatches || []).filter(b => b.roast_plan_id === sp.id).map(b => b.roast_date)));
            renderBlendTracking({ lot, bulk, machine, components, codeDefinitions, packedCoffeeLots, searchedPackedLot, roastDate, roastDateNote: '', isCustom: false });
        } else if (bulk && bulk.is_post_blend) {
            const comps = (postBlendComponents || []).filter(c => c.blend_bulk_id === bulk.id).sort((a, b) => a.id - b.id);
            const components = comps.map(c => {
                const kg = parseFloat(c.kg) || 0;
                if (c.source_type === 'Unregistered') {
                    // Coffee added from outside inventory: the trace ends at
                    // the name and source the user typed.
                    return { name: c.source_name || 'Unregistered coffee', identity: null, source: 'unreg', note: c.source_note || '-', kg, chain: null };
                }
                if (c.source_type === 'Bulk') {
                    const srcBulk = (bulkList || []).find(b => b.id === c.source_bulk_id);
                    // Most recent label ever printed for this source bulk, if any.
                    let originLot = (lots || [])
                        .filter(l => l.bulk_roasted_coffee_id === c.source_bulk_id)
                        .sort((a, b) => (b.production_date || '').localeCompare(a.production_date || ''))[0] || null;
                    const printed = !!originLot;
                    if (!originLot && srcBulk) {
                        // No label was ever printed for this source — resolve
                        // shallow, straight off the bulk row.
                        originLot = { id: null, coffee_type: srcBulk.coffee_type, single_coffee_id: srcBulk.single_coffee_id, blend_recipe_id: srcBulk.blend_recipe_id, latest_roast_batch_id: null };
                    }
                    let lotCode = printed ? originLot.lot_code : '';
                    if (!lotCode && srcBulk && typeof buildPreviewLotCode === 'function') {
                        lotCode = buildPreviewLotCode(srcBulk, machines, greenCoffees, recipes, roastBatches, srcBulk.production_date || '');
                    }
                    const chainOut = originLot ? resolveLotChain(originLot, ctx) : null;
                    if (chainOut && chainOut.roastDateText === '-' && srcBulk && srcBulk.production_date) chainOut.roastDateText = srcBulk.production_date;
                    return {
                        name: srcBulk ? srcBulk.coffee_name : 'Unknown',
                        identity: srcBulk ? typeOf(srcBulk.coffee_type, srcBulk.single_coffee_id, srcBulk.blend_recipe_id) : null,
                        source: 'bulk', lotCode: lotCode || '-', kg, chain: chainOut
                    };
                }
                const plLot = (packedCoffeeLots || []).find(l => l.id === c.source_packed_lot_id);
                const packed = plLot ? (packedList || []).find(p => p.id === plLot.packed_coffee_id) : null;
                const originLot = (plLot && plLot.production_lot_id) ? (lots || []).find(l => l.id === plLot.production_lot_id) || null : null;
                const bagG = packed ? parseFloat(packed.bag_size_g) || 0 : 0;
                const bags = bagG > 0 ? Math.round(kg / (bagG / 1000)) : 0;
                let identity = originLot ? typeOf(originLot.coffee_type, originLot.single_coffee_id, originLot.blend_recipe_id) : null;
                if (!identity && packed) {
                    const clean = String(packed.custom_coffee_name || '').replace(/ \((Single|Blend)\)$/, '');
                    const g = (greenCoffees || []).find(x => x.name === clean);
                    const r = (recipes || []).find(x => x.name === clean);
                    identity = g ? { type: 'Single', code: g.code || '' } : r ? { type: 'Blend', code: r.code || '' }
                        : (packed.coffee_code ? { type: packed.coffee_code_type || '', code: packed.coffee_code } : null);
                }
                return {
                    name: packed ? (packed.custom_coffee_name || 'Roasted Coffee') : 'Unknown',
                    identity, source: 'packed',
                    lotCode: plLot ? (plLot.lot_code || plLot.strip_code || '-') : '-',
                    extra: bags > 0 ? stT('trk_bags', '{n} × {g}g bags').replace('{n}', bags).replace('{g}', bagG) : '',
                    kg, chain: originLot ? resolveLotChain(originLot, ctx) : null
                };
            });
            // A custom blend has no roast batch of its own — its roast date
            // is the one chosen when it was created (bulk production_date).
            renderBlendTracking({
                lot, bulk, machine, components, codeDefinitions, packedCoffeeLots, searchedPackedLot,
                roastDate: bulk.production_date || chain.roastDateText,
                roastDateNote: stT('trk_roast_chosen', 'chosen when the blend was created'),
                isCustom: true
            });
        } else if (bulk && bulk.is_repack) {
            // V2 Repack: a repacked lot's own chain is meaningless the same
            // way a post-blend's is (it wasn't roasted, it was opened from
            // already-finished stock), since repack_sources always points at
            // packed_coffee_lots (repack never opens another bulk directly).
            // The coffee name is deliberately the SAME at every source (V2
            // Repack never renames), so each row is labeled by its strip/lot
            // code instead, to distinguish which physical bag it came from.
            const sources = (repackSources || []).filter(s => s.repack_bulk_id === bulk.id);
            const rowsHtml = sources.map(s => {
                const plLot = (packedCoffeeLots || []).find(l => l.id === s.source_packed_lot_id);
                const code = plLot ? (plLot.strip_code || plLot.lot_code) : 'Unknown';
                const originLot = (plLot && plLot.production_lot_id) ? (lots || []).find(l => l.id === plLot.production_lot_id) : null;

                const pcs = parseInt(s.pcs) || 0;
                const kg = parseFloat(s.kg) || 0;
                let detailHtml = '<span style="color: var(--text-muted); font-size: 0.8rem;">No further trace available</span>';
                if (originLot) {
                    const subChain = resolveLotChain(originLot, ctx);
                    detailHtml = `<div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.5;">
                        Process: ${subChain.processText} · Supplier: ${subChain.supplierText}<br>
                        Green arrival: ${subChain.greenbeanDateText} · Roasted: ${subChain.roastDateText}
                    </div>`;
                }

                return `<li style="margin-bottom: 10px; padding-left: 12px; border-left: 2px solid var(--border-color);">
                    <div style="font-weight: 600; font-family: monospace;">${code} <span style="font-weight: 400; color: var(--text-muted); font-family: inherit; font-size: 0.8rem;">— ${pcs} pcs &middot; ${kg.toFixed(2)} kg</span></div>
                    ${detailHtml}
                </li>`;
            }).join('');

            compositionEl.innerHTML = `<div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                <div style="font-weight: 700; margin-bottom: 8px;">Repack Composition — opened from</div>
                <ul style="list-style: none; margin: 0; padding: 0;">${rowsHtml || '<li style="color: var(--text-muted);">No source lots recorded</li>'}</ul>
            </div>`;
            compositionEl.classList.remove('hidden');
        } else {
            compositionEl.innerHTML = '';
            compositionEl.classList.add('hidden');
        }
    }

    setTrackingResultState('result');
}

function trackingEsc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

// Blend result: title tag + code chip, the blend's own facts in place of the
// single-coffee field grid, then one table row per component.
function renderBlendTracking({ lot, bulk, machine, components, codeDefinitions, packedCoffeeLots, searchedPackedLot, roastDate, roastDateNote, isCustom }) {
    const esc = trackingEsc;
    const fieldsEl = document.getElementById('tracking-result-fields');
    const compositionEl = document.getElementById('tracking-result-composition');
    const titleEl = document.getElementById('tracking-result-coffee-name');
    if (fieldsEl) fieldsEl.classList.add('hidden');

    const code = bulk.custom_coffee_code || '';
    const def = code ? (codeDefinitions || []).find(d => d.code === code) : null;
    const tagText = isCustom ? stT('trk_tag_custom', 'Custom Blend') : stT('trk_tag_post', 'Post-Blend');
    titleEl.innerHTML = `<span>${esc(lot.coffee_name || bulk.custom_blend_name || '-')}<span class="badge-post-blend trk-tag">${esc(tagText)}</span></span>${code ? `<span class="trk-code-chip">${esc(code)}</span>` : ''}`;

    // Packing date: the packed lot that was searched, else every packed lot
    // made from this production lot.
    const packedDates = searchedPackedLot && searchedPackedLot.production_lot_id === lot.id
        ? [searchedPackedLot.packed_date]
        : (packedCoffeeLots || []).filter(l => l.production_lot_id === lot.id).map(l => l.packed_date);
    const packDate = trackingUniqueJoin(packedDates);

    const total = components.reduce((s, c) => s + c.kg, 0);
    const sellsAs = code
        ? `${esc(code)}${def ? ' — ' + esc(def.name) : ''}${bulk.custom_coffee_type ? `<small>${esc(bulk.custom_coffee_type)}</small>` : ''}`
        : '-';
    const fact = (label, value, note) => `<div><dt>${esc(label)}</dt><dd>${value}${note ? `<small>${esc(note)}</small>` : ''}</dd></div>`;
    const factsHtml = `<dl class="trk-facts">
        ${fact(stT('tracking_lbl_lot_code', 'Lot Code'), `<span class="trk-mono">${esc(lot.lot_code)}</span>`)}
        ${fact(stT('trk_sells_as', 'Sells as'), sellsAs)}
        ${fact(stT('tracking_lbl_machine', 'Machine'), esc(machine ? machine.name : '-'))}
        ${fact(stT('tracking_lbl_roast_date', 'Roasting Date'), esc(roastDate || '-'), roastDateNote)}
        ${fact(stT('tracking_lbl_pack_date', 'Packing Date'), esc(packDate))}
        ${fact(stT('trk_blend_size', 'Blend Size'), `<span class="trk-mono">${total.toFixed(2)} kg</span>`,
            stT('trk_components', '{n} components').replace('{n}', components.length) + (bulk.custom_blend_code ? ` · ${bulk.custom_blend_code}` : ''))}
    </dl>`;

    const pillText = { bulk: 'Bulk', packed: 'Packed', unreg: stT('trk_src_unreg', 'Unregistered'), roast: stT('trk_src_roast', 'Roast batch') };
    const cell = v => (v === null || v === undefined || v === '' || v === '-') ? '<td class="trk-dash">-</td>' : `<td>${esc(v)}</td>`;
    const numCell = v => (v === null || v === undefined || v === '' || v === '-') ? '<td class="trk-num trk-dash">-</td>' : `<td class="trk-num">${esc(v)}</td>`;
    const rowsHtml = components.map(c => {
        const pct = total > 0 ? c.kg / total * 100 : 0;
        const sub = c.source === 'unreg'
            ? stT('trk_not_inventory', 'not in inventory')
            : (c.identity ? `${c.identity.type}${c.identity.code ? ' · ' + stT('trk_code', 'code') + ' ' + c.identity.code : ''}` : '');
        const head = `
            <td class="trk-ing">${esc(String(c.name).replace(/ \((Single|Blend)\)$/, ''))}${sub ? `<small>${esc(sub)}</small>` : ''}</td>
            <td><span class="trk-pill trk-pill-${c.source}">${esc(pillText[c.source])}</span>${c.lotCode ? `<span class="trk-lot">${esc(c.lotCode)}</span>` : ''}${c.extra ? `<span class="trk-lot trk-dash">${esc(c.extra)}</span>` : ''}</td>
            <td class="trk-num">${c.kg.toFixed(2)} kg</td>
            <td class="trk-num">${pct.toFixed(0)}%<span class="trk-bar" style="width:${Math.max(2, Math.round(pct * 0.6))}px"></span></td>`;
        if (c.source === 'unreg') {
            return `<tr>${head}<td class="trk-unreg-note" colspan="8"><b>${esc(stT('trk_source', 'Source'))}:</b> ${esc(c.note)} — ${esc(stT('trk_unreg_note', 'not from inventory, so there is no green bean, roast or lab record to trace.'))}</td></tr>`;
        }
        const ch = c.chain || {};
        return `<tr>${head}
            ${cell(ch.processText)}${cell(ch.supplierText)}${cell(ch.greenbeanDateText)}${cell(ch.roastDateText)}${cell(ch.roastDegreeText)}
            ${numCell(ch.moistureText)}${numCell(ch.waterActivityText)}${numCell(ch.densityText)}</tr>`;
    }).join('');

    const th = (key, fb, num) => `<th${num ? ' class="trk-num"' : ''}>${esc(stT(key, fb))}</th>`;
    compositionEl.innerHTML = `${factsHtml}
        <div class="trk-comp-head">
            <h4>${esc(stT('trk_composition', 'Blend Composition'))}</h4>
            <span>${esc(stT('trk_composition_hint', 'Each row traces one ingredient back to its green bean'))}</span>
        </div>
        <div class="table-container trk-table-wrap">
            <table class="trk-table">
                <thead><tr>
                    ${th('trk_col_ingredient', 'Ingredient')}${th('trk_col_source', 'Source')}${th('trk_col_amount', 'Amount', true)}${th('trk_col_share', 'Share', true)}
                    ${th('tracking_lbl_process', 'Process')}${th('tracking_lbl_supplier', 'Supplier')}${th('tracking_lbl_greenbean_date', 'Greenbean Received')}
                    ${th('tracking_lbl_roast_date', 'Roasting Date')}${th('tracking_lbl_roast_degree', 'Roast Degree')}
                    ${th('tracking_lbl_moisture', 'Moisture Content', true)}${th('tracking_lbl_water_activity', 'Water Activity', true)}${th('tracking_lbl_density', 'Density', true)}
                </tr></thead>
                <tbody>${rowsHtml || `<tr><td colspan="12" class="trk-dash">${esc(stT('trk_no_components', 'No components recorded'))}</td></tr>`}</tbody>
                <tfoot><tr>
                    <td colspan="2">${esc(stT('trk_total', 'Total'))}</td>
                    <td class="trk-num">${total.toFixed(2)} kg</td>
                    <td class="trk-num">${components.length ? '100%' : '-'}</td>
                    <td colspan="8"></td>
                </tr></tfoot>
            </table>
        </div>`;
    compositionEl.classList.remove('hidden');
}
