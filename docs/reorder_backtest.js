/* ============================================================================
   Next-order prediction — backtest
   ----------------------------------------------------------------------------
   Paste this whole file into the browser console while logged into Roastery
   Manager. It replays every prediction method against the real order history
   and prints how far each one would have been off, in days.

   Nothing is written to the database — it only reads.

   Re-run it whenever you want (in a month, in a year). If "rhythm" stops
   winning and "consumption" starts winning, the customers' behaviour has
   changed and the weighting in the app will follow it automatically.
   ========================================================================== */
(async () => {
  const sb = window.supabaseClient;
  const DAY = 86400000;
  const MIN_ORDERS = 3;          // fewer than this: no prediction at all
  const RECENT_GAPS = 6;         // only the most recent gaps count
  const CLAMP_LOW = 0.5, CLAMP_HIGH = 2.5;   // × the customer's usual gap

  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const fmt = n => n == null ? '—' : n.toFixed(2);

  // ---------- load ----------
  const [{ data: customers }, { data: orders }, { data: items }] = await Promise.all([
    sb.from('customers').select('id,name,type'),
    sb.from('request_orders').select('id,customer_id,order_date'),
    sb.from('request_order_items').select('request_order_id,quantity_requested,bag_size_g')
  ]);
  const kgByOrder = {};
  items.forEach(i => {
    kgByOrder[i.request_order_id] = (kgByOrder[i.request_order_id] || 0)
      + (parseInt(i.quantity_requested) || 0) * (parseInt(i.bag_size_g) || 0) / 1000;
  });

  const histories = customers.map(c => ({
    name: c.name, type: c.type,
    orders: orders
      .filter(o => o.customer_id === c.id && o.order_date)
      .map(o => ({ d: o.order_date, kg: +(kgByOrder[o.id] || 0).toFixed(2) }))
      .sort((a, b) => a.d.localeCompare(b.d))
  })).filter(h => h.orders.length >= MIN_ORDERS);

  // ---------- the methods ----------
  // Each takes the orders BEFORE the one being predicted, and returns a gap in days.
  const gapsOf = past => { const g = []; for (let i = 1; i < past.length; i++)
    g.push((new Date(past[i].d) - new Date(past[i - 1].d)) / DAY); return g; };

  const methods = {
    rhythm: past => median(gapsOf(past).slice(-RECENT_GAPS)),

    consumption: past => {
      const span = (new Date(past[past.length - 1].d) - new Date(past[0].d)) / DAY;
      const kgBefore = past.slice(0, -1).reduce((s, o) => s + o.kg, 0);
      const lastKg = past[past.length - 1].kg;
      if (!(span > 0) || !(kgBefore > 0) || !(lastKg > 0)) return null;
      return lastKg / (kgBefore / span);          // kg of the last order ÷ kg per day
    },

    // what the app will actually show: both, weighted by how each has done
    // for THIS customer so far, then clamped to a sane range
    weighted: (past, self) => {
      const r = methods.rhythm(past), c = methods.consumption(past);
      if (r == null) return c;
      if (c == null || past.length < 6) return r;
      const errR = self.errors.rhythm.length ? mean(self.errors.rhythm) : null;
      const errC = self.errors.consumption.length ? mean(self.errors.consumption) : null;
      let p;
      if (errR == null || errC == null) { p = r; }
      else {
        const wR = 1 / (errR + 1), wC = 1 / (errC + 1);
        p = (r * wR + c * wC) / (wR + wC);
      }
      return Math.min(Math.max(p, r * CLAMP_LOW), r * CLAMP_HIGH);
    }
  };

  // ---------- replay ----------
  const all = { rhythm: [], consumption: [], weighted: [] };
  const perCustomer = [];

  histories.forEach(h => {
    const self = { errors: { rhythm: [], consumption: [], weighted: [] } };
    for (let i = MIN_ORDERS - 1; i < h.orders.length; i++) {
      const past = h.orders.slice(0, i);
      const actual = (new Date(h.orders[i].d) - new Date(past[past.length - 1].d)) / DAY;
      for (const name of Object.keys(methods)) {
        const p = methods[name](past, self);
        if (p == null) continue;
        const err = Math.abs(p - actual);
        self.errors[name].push(err);
        all[name].push(err);
      }
    }
    perCustomer.push({
      customer: h.name, type: h.type, orders: h.orders.length,
      rhythm: fmt(mean(self.errors.rhythm)),
      consumption: fmt(mean(self.errors.consumption)),
      weighted: fmt(mean(self.errors.weighted)),
      best: ['rhythm', 'consumption', 'weighted']
        .filter(m => self.errors[m].length)
        .sort((a, b) => mean(self.errors[a]) - mean(self.errors[b]))[0] || '—'
    });
  });

  // ---------- report ----------
  console.log(`%cNext-order backtest · ${new Date().toISOString().split('T')[0]}`,
    'font-weight:bold;font-size:14px');
  console.log(`Customers with ${MIN_ORDERS}+ orders: ${histories.length} · predictions replayed: ${all.rhythm.length}`);
  console.table(Object.keys(all).map(m => ({
    method: m, predictions: all[m].length, 'mean error (days)': fmt(mean(all[m]))
  })));
  console.table(perCustomer.sort((a, b) => b.orders - a.orders));
  console.log('Lower is better. If "consumption" ever beats "rhythm" overall, customers have moved to ' +
              'a replenishment pattern and the weighting will follow on its own.');
})();
