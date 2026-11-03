/* Review Finder — CX Insights (dashboard tab).
 * Modelled on how Qualtrics / Medallia report CX: KPI scorecards with period deltas, trends,
 * driver (issue) analysis, location ranking, heatmaps, text themes, alerts and benchmarks.
 * Pure front-end: works on the reviews the signed-in user is allowed to read (RLS), plus an
 * anonymous per-type benchmark from the database. "Sample data" generates a labelled demo set.
 */
const RFInsights = (() => {
  const tr = (k, v) => I18N.t(k, v);
  const num = (n) => I18N.fmtNum(n);
  const pct = (n) => (n == null || isNaN(n) ? '–' : `${I18N.fmtNum(Math.round(n))}%`);
  const esc = (s) => RC.esc(s);
  const DAY = 864e5;
  const LW = 520;      // line chart viewBox width
  const ISSUES = RC.ISSUE_KEYS;
  const ISSUE_ICON = { food: '🍽️', service: '⏱️', staff: '🙋', clean: '🧹', value: '💸' };
  const TYPES = RC.BUSINESS_TYPES;

  let ctx = null;       // { user, list }
  let state = { days: 30, type: 'all', biz: 'all', sample: false, sort: 'csat' };
  let raw = [];         // reviews covering current + previous period
  let bizList = [];     // businesses in scope (real or sample)
  let bench = [];
  let root = null;

  // ---------- Data ----------
  const LEGACY = /^\[((?:food|service|staff|clean|value)(?:,\s*(?:food|service|staff|clean|value))*)\]\s*/;
  const issuesOf = (r) => (r.issues?.length ? r.issues : ((r.text || '').match(LEGACY)?.[1].split(/,\s*/) || []));
  const textOf = (r) => (r.text || '').replace(LEGACY, '');
  const typeOf = (id) => bizList.find((b) => b.id === id)?.businessType || 'restaurant';
  const nameOf = (id) => { const b = bizList.find((x) => x.id === id); return b ? (RC.localName(b, I18N.lang) || b.slug) : ''; };

  async function load() {
    const span = state.days ? state.days * 2 : null;
    if (state.sample) { const s = sample(); bizList = s.biz; raw = s.reviews; bench = []; return; }
    bizList = ctx.list;
    const since = span ? new Date(Date.now() - span * DAY).toISOString() : null;
    raw = await RC.listReviews(bizList.map((b) => b.id), { since, limit: 10000 });
    bench = ctx.user.isAdmin ? [] : await RC.cxBenchmarks(new Date(Date.now() - (state.days || 3650) * DAY).toISOString());
  }

  function scoped(rows) {
    return rows.filter((r) => (state.biz === 'all' || r.business_id === state.biz)
      && (state.type === 'all' || typeOf(r.business_id) === state.type));
  }
  function periods() {
    const now = Date.now();
    if (!state.days) return { cur: scoped(raw), prev: [] };
    const a = now - state.days * DAY, b = now - 2 * state.days * DAY;
    const all = scoped(raw);
    return {
      cur: all.filter((r) => +new Date(r.created_at) >= a),
      prev: all.filter((r) => { const t = +new Date(r.created_at); return t >= b && t < a; }),
    };
  }

  const csat = (rows) => (rows.length ? (100 * rows.filter((r) => r.rating >= 4).length) / rows.length : null);
  const avg = (rows) => (rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : null);
  const share = (rows, f) => (rows.length ? (100 * rows.filter(f).length) / rows.length : null);
  function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  const resolveHours = (rows) => median(rows.filter((r) => r.route === 'private' && r.status === 'resolved' && r.resolved_at)
    .map((r) => (new Date(r.resolved_at) - new Date(r.created_at)) / 36e5).filter((h) => h >= 0));

  // ---------- Small render helpers ----------
  function delta(cur, prev, { unit = 'pts', invert = false, digits = 0 } = {}) {
    if (cur == null || prev == null) return `<span class="ix-delta muted">${tr('ins.noPrev')}</span>`;
    const d = cur - prev;
    const round = Math.abs(d) < 0.05 ? 0 : +d.toFixed(digits);
    if (!round) return `<span class="ix-delta flat">→ ${tr('ins.noChange')}</span>`;
    const good = invert ? round < 0 : round > 0;
    const sign = round > 0 ? '▲' : '▼';
    const val = `${round > 0 ? '+' : '−'}${num(Math.abs(round))}${unit === 'h' ? tr('ins.h') : unit === 'pts' ? ' ' + tr('ins.pts') : ''}`;
    return `<span class="ix-delta ${good ? 'up' : 'down'}"><span class="ix-arr" aria-hidden="true">${sign}</span> ${val} <small>${tr('ins.vsPrev')}</small></span>`;
  }
  function tile(label, value, deltaHtml, hint) {
    return `<div class="ix-tile"><span class="ix-tl">${label}</span><b class="ix-tv">${value}</b>${deltaHtml || ''}${hint ? `<span class="ix-th">${hint}</span>` : ''}</div>`;
  }
  // Horizontal bars (single series, value labels in text ink)
  function bars(items, { max, fmt = (v) => num(v), tip }) {
    const m = max ?? Math.max(1, ...items.map((i) => i.value || 0));
    return `<div class="ix-bars">${items.map((i) => `
      <div class="ix-bar" data-tip="${esc(tip ? tip(i) : `${i.label}: ${fmt(i.value)}`)}">
        <span class="ix-bl">${i.label}</span>
        <span class="ix-bt"><i style="width:${Math.max(0, Math.min(100, (100 * (i.value || 0)) / m))}%"></i></span>
        <span class="ix-bv">${i.value == null ? '–' : fmt(i.value)}${i.sub ? `<small>${i.sub}</small>` : ''}</span>
      </div>`).join('')}</div>`;
  }
  // Single-series line chart with crosshair tooltip (SVG, 2px line, recessive grid)
  function line(points, { yMin = 0, yMax = 100, fmt = pct, id }) {
    const W = LW, H = 210, L = 38, R = 10, T = 12, B = 26;
    const valid = points.filter((p) => p.value != null);
    if (valid.length < 2) return `<p class="ix-empty">${tr('ins.notEnough')}</p>`;
    const x = (i) => L + (i * (W - L - R)) / Math.max(1, points.length - 1);
    const y = (v) => T + (H - T - B) * (1 - (v - yMin) / (yMax - yMin));
    let d = '', started = false;
    points.forEach((p, i) => { if (p.value == null) { started = false; return; } d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`; started = true; });
    const grid = [0, 25, 50, 75, 100].map((g) => { const v = yMin + ((yMax - yMin) * g) / 100; return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="ix-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ix-ax" text-anchor="end">${fmt(v)}</text>`; }).join('');
    const step = Math.ceil(points.length / 6);
    const xl = points.map((p, i) => (i % step === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${H - 6}" class="ix-ax" text-anchor="middle">${esc(p.label)}</text>` : '')).join('');
    const last = valid[valid.length - 1], li = points.lastIndexOf(last);
    return `<div class="ix-line" id="${id}" data-points='${esc(JSON.stringify(points.map((p, i) => ({ x: x(i) / W, l: p.label, v: p.value, n: p.n }))))}'>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr('ins.trendAria'))}">
        ${grid}${xl}
        <path d="${d}" class="ix-path"/>
        <circle cx="${x(li)}" cy="${y(last.value)}" r="4" class="ix-dot"/>
        <line class="ix-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>
      </svg></div>`;
  }
  // Heatmap (sequential single hue, count in each cell, hover tooltip)
  function heat(rowLabels, colLabels, matrix, tipFn) {
    const max = Math.max(1, ...matrix.flat());
    const step = (v) => (v ? Math.min(6, 1 + Math.floor((5 * v) / max)) : 0);
    return `<div class="ix-heat" style="--cols:${colLabels.length}">
      <span></span>${colLabels.map((c) => `<span class="ix-hc">${c}</span>`).join('')}
      ${rowLabels.map((r, i) => `<span class="ix-hr">${r}</span>${matrix[i].map((v, j) => `<span class="ix-cell s${step(v)}" data-tip="${esc(tipFn(i, j, v))}">${v ? num(v) : ''}</span>`).join('')}`).join('')}
    </div>`;
  }

  // ---------- Time helpers (Saudi time) ----------
  const fmtParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', weekday: 'short', hour: 'numeric', hour12: false });
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function riyadh(d) { const p = fmtParts.formatToParts(new Date(d)); return { dow: DOW.indexOf(p.find((x) => x.type === 'weekday').value), hour: +p.find((x) => x.type === 'hour').value % 24 }; }
  const BANDS = [[6, 11], [11, 15], [15, 18], [18, 23], [23, 30]]; // breakfast, lunch, afternoon, dinner, late
  const bandOf = (h) => { const hh = h < 6 ? h + 24 : h; return BANDS.findIndex(([a, b]) => hh >= a && hh < b); };

  function buckets(rows) {
    const days = state.days || Math.max(30, Math.ceil((Date.now() - Math.min(...rows.map((r) => +new Date(r.created_at)), Date.now())) / DAY));
    const size = days <= 31 ? 1 : days <= 120 ? 7 : 30;
    const n = Math.max(2, Math.ceil(days / size));
    const start = Date.now() - n * size * DAY;
    const out = Array.from({ length: n }, (_, i) => ({ t: start + i * size * DAY, rows: [] }));
    rows.forEach((r) => { const i = Math.floor((+new Date(r.created_at) - start) / (size * DAY)); if (out[i]) out[i].rows.push(r); });
    const df = new Intl.DateTimeFormat(I18N.lang === 'ar' ? 'ar-SA' : 'en-GB', size === 30 ? { month: 'short' } : { day: 'numeric', month: 'short' });
    return out.map((b) => ({ label: df.format(new Date(b.t + (size - 1) * DAY)), value: csat(b.rows), n: b.rows.length, count: b.rows.length }));
  }

  // ---------- Text themes ----------
  const STOP = new Set(('the a an and or but to of in on at for with was were is are it this that be been very so we our you your they them i my me not no too just at from had have has will would could there their its as by an if then than also really got get go went one ' +
    'في من على إلى الى عن مع هذا هذه ذلك التي الذي كان كانت هو هي انا أنا نحن لم لا ما و او أو ثم قد كل جدا جداً بس يا عند لكن ان أن إن مره مرة').split(/\s+/));
  function themes(rows) {
    const c = new Map();
    rows.forEach((r) => {
      textOf(r).toLowerCase().replace(/[ً-ٰٟ]/g, '').split(/[^a-z؀-ۿ]+/).forEach((w) => {
        if (w.length < 3 || STOP.has(w)) return;
        c.set(w, (c.get(w) || 0) + 1);
      });
    });
    return [...c.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 14);
  }

  // ---------- Render ----------
  async function render() {
    if (!root) return;
    root.innerHTML = `<div class="card"><p class="muted">${tr('ins.loading')}</p></div>`;
    try { await load(); } catch (e) { root.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`; return; }
    draw();
  }

  function draw() {
    const { cur, prev } = periods();
    const admin = ctx.user.isAdmin;
    const multi = bizList.length > 1;
    const priv = cur.filter((r) => r.route === 'private'), privPrev = prev.filter((r) => r.route === 'private');
    const open = priv.filter((r) => r.status !== 'resolved').length;
    const rh = resolveHours(cur), rhPrev = resolveHours(prev);
    // Service recovery: did the owner reply, and did the guest say it was fixed?
    const replied = (rows) => share(rows, (r) => !!r.reply);
    const answered = priv.filter((r) => r.guest_verdict), answeredPrev = privPrev.filter((r) => r.guest_verdict);
    const wonBack = (rows) => share(rows, (r) => r.guest_verdict === 'fixed');
    const typesPresent = TYPES.filter((t) => bizList.some((b) => (b.businessType || 'restaurant') === t));

    const filters = `<div class="ix-filters">
      <div class="ix-seg" role="group" aria-label="${esc(tr('ins.period'))}">${[7, 30, 90, 365, 0].map((d) => `<button type="button" data-days="${d}" class="${state.days === d ? 'on' : ''}">${tr(d ? `ins.d${d}` : 'ins.all')}</button>`).join('')}</div>
      ${admin && typesPresent.length > 1 ? `<select data-f="type"><option value="all">${tr('ins.allTypes')}</option>${typesPresent.map((t) => `<option value="${t}" ${state.type === t ? 'selected' : ''}>${tr(`a.type.${t}`)}</option>`).join('')}</select>` : ''}
      ${multi ? `<select data-f="biz"><option value="all">${tr('a.f.allBiz')}</option>${bizList.map((b) => `<option value="${b.id}" ${state.biz === b.id ? 'selected' : ''}>${esc(RC.localName(b, I18N.lang) || b.slug)}</option>`).join('')}</select>` : ''}
      <span class="ix-sp"></span>
      <label class="ix-sample"><input type="checkbox" data-f="sample" ${state.sample ? 'checked' : ''}/> ${tr('ins.sample')}</label>
      <button type="button" class="btn" data-act="csv">${tr('ins.csv')}</button>
    </div>${state.sample ? `<p class="ix-banner">${tr('ins.sampleBanner')}</p>` : ''}`;

    if (!cur.length) {
      root.innerHTML = filters + `<div class="card empty"><h2>${tr('ins.emptyT')}</h2><p class="muted">${tr('ins.emptyX')}</p></div>`;
      return;
    }

    // KPI scorecards
    const kpis = `<div class="ix-tiles">
      ${tile(tr('ins.k.responses'), num(cur.length), delta(cur.length, prev.length ? prev.length : null, { unit: 'n' }))}
      ${tile(tr('ins.k.csat'), pct(csat(cur)), delta(csat(cur), csat(prev)), tr('ins.k.csatHint'))}
      ${tile(tr('ins.k.avg'), avg(cur) == null ? '–' : `${num(+avg(cur).toFixed(1))}★`, delta(avg(cur), avg(prev), { digits: 1, unit: 'n' }))}
      ${tile(tr('ins.k.google'), pct(share(cur, (r) => r.route === 'google')), delta(share(cur, (r) => r.route === 'google'), share(prev, (r) => r.route === 'google')))}
      ${tile(tr('ins.k.open'), num(open), '', tr('ins.k.openHint', { n: num(priv.length) }))}
      ${tile(tr('ins.k.resolve'), rh == null ? '–' : `${num(+rh.toFixed(rh < 10 ? 1 : 0))}${tr('ins.h')}`, delta(rh, rhPrev, { unit: 'h', invert: true, digits: 1 }), tr('ins.k.resolveHint'))}
      ${tile(tr('ins.k.replied'), pct(replied(priv)), delta(replied(priv), replied(privPrev)), tr('ins.k.repliedHint'))}
      ${tile(tr('ins.k.won'), pct(wonBack(answered)), delta(wonBack(answered), wonBack(answeredPrev)), tr('ins.k.wonHint', { a: num(answered.length), n: num(priv.length) }))}
    </div>`;

    // Alerts (case management style)
    const alerts = [];
    const now = Date.now();
    const stale = priv.filter((r) => r.status !== 'resolved' && now - new Date(r.created_at) > 48 * 36e5);
    if (stale.length) alerts.push(['critical', tr('ins.al.stale', { n: num(stale.length) })]);
    bizList.forEach((b) => {
      const c = cur.filter((r) => r.business_id === b.id), p = prev.filter((r) => r.business_id === b.id);
      if (c.length >= 5 && p.length >= 5 && csat(p) - csat(c) >= 10) alerts.push(['serious', tr('ins.al.drop', { name: RC.localName(b, I18N.lang) || b.slug, a: pct(csat(p)), b: pct(csat(c)) })]);
    });
    const topIssue = ISSUES.map((k) => [k, priv.filter((r) => issuesOf(r).includes(k)).length]).sort((a, b) => b[1] - a[1])[0];
    if (topIssue && topIssue[1] >= 3) alerts.push(['warning', tr('ins.al.issue', { issue: tr(`a.issue.${topIssue[0]}`), n: num(topIssue[1]) })]);
    const ICON = { critical: '⛔', serious: '▼', warning: '⚠' };
    const alertsHtml = alerts.length ? `<div class="ix-alerts">${alerts.map(([lvl, msg]) => `<div class="ix-alert ${lvl}"><span class="ix-ai" aria-hidden="true">${ICON[lvl]}</span><b>${tr(`ins.lvl.${lvl}`)}</b><span>${esc(msg)}</span></div>`).join('')}</div>` : '';

    // Trend + volume (two charts, never a dual axis)
    const b = buckets(cur);
    const trend = `<div class="ix-grid2">
      <div class="card"><h3>${tr('ins.c.trend')}</h3><p class="muted small">${tr('ins.c.trendSub')}</p>${line(b, { id: 'ixTrend' })}</div>
      <div class="card"><h3>${tr('ins.c.volume')}</h3><p class="muted small">${tr('ins.c.volumeSub')}</p>${bars(b.slice(-8).map((x) => ({ label: x.label, value: x.count })), { tip: (i) => tr('ins.tip.volume', { l: i.label, n: num(i.value) }) })}</div>
    </div>`;

    // Rating distribution
    const dist = [5, 4, 3, 2, 1].map((s) => ({ label: `${num(s)}★`, value: cur.filter((r) => r.rating === s).length }));
    const distHtml = `<div class="card"><h3>${tr('ins.c.dist')}</h3>${bars(dist, { tip: (i) => tr('ins.tip.dist', { l: i.label, n: num(i.value), p: pct((100 * i.value) / cur.length) }), fmt: (v) => `${num(v)} · ${pct((100 * v) / cur.length)}` })}</div>`;

    // Issue drivers: frequency + rating when present
    const withIssues = cur.filter((r) => issuesOf(r).length);
    const drivers = ISSUES.map((k) => { const rows = cur.filter((r) => issuesOf(r).includes(k)); return { k, n: rows.length, avg: avg(rows) }; }).filter((d) => d.n).sort((a, b) => b.n - a.n);
    const driverHtml = `<div class="card"><h3>${tr('ins.c.drivers')}</h3><p class="muted small">${tr('ins.c.driversSub')}</p>
      ${drivers.length ? bars(drivers.map((d) => ({ label: `${ISSUE_ICON[d.k]} ${tr(`a.issue.${d.k}`)}`, value: (100 * d.n) / Math.max(1, withIssues.length), sub: ` · ${num(+d.avg.toFixed(1))}★` })), { max: 100, fmt: pct, tip: (i) => i.label }) : `<p class="ix-empty">${tr('ins.noIssues')}</p>`}</div>`;

    // CSAT by business type (portfolio) or benchmark (owner)
    let segHtml = '';
    if (admin && typesPresent.length) {
      const rows = typesPresent.map((t) => { const rr = cur.filter((r) => typeOf(r.business_id) === t); return { label: tr(`a.type.${t}`), value: csat(rr), sub: ` · ${num(rr.length)}` }; }).filter((x) => x.value != null);
      segHtml = `<div class="card"><h3>${tr('ins.c.byType')}</h3><p class="muted small">${tr('ins.c.byTypeSub')}</p>${bars(rows, { max: 100, fmt: pct, tip: (i) => `${i.label}: ${pct(i.value)} CSAT` })}</div>`;
    } else if (!admin) {
      const myType = bizList[0]?.businessType || 'restaurant';
      const bm = bench.find((x) => x.business_type === myType);
      segHtml = `<div class="card"><h3>${tr('ins.c.bench')}</h3>${bm
        ? bars([{ label: tr('ins.you'), value: csat(cur) }, { label: tr('ins.typeAvg', { type: tr(`a.type.${myType}`) }), value: +bm.csat, sub: ` · ${num(bm.businesses)} ${tr('ins.biz')}` }], { max: 100, fmt: pct })
        : `<p class="ix-empty">${tr('ins.benchSoon')}</p>`}</div>`;
    }

    // Location leaderboard
    let boardHtml = '';
    if (multi) {
      const rows = bizList.map((bz) => {
        const c = cur.filter((r) => r.business_id === bz.id), p = prev.filter((r) => r.business_id === bz.id);
        const pr = c.filter((r) => r.route === 'private');
        const ti = ISSUES.map((k) => [k, pr.filter((r) => issuesOf(r).includes(k)).length]).sort((a, z) => z[1] - a[1])[0];
        return { bz, n: c.length, csat: csat(c), d: c.length && p.length ? csat(c) - csat(p) : null, open: pr.filter((r) => r.status !== 'resolved').length, top: ti && ti[1] ? ti[0] : null };
      }).filter((r) => (state.type === 'all' || (r.bz.businessType || 'restaurant') === state.type) && r.n);
      const key = { csat: (r) => r.csat ?? -1, n: (r) => r.n, open: (r) => r.open, d: (r) => r.d ?? -999 }[state.sort] || ((r) => r.csat);
      rows.sort((a, z) => key(z) - key(a));
      boardHtml = `<div class="card"><h3>${tr('ins.c.board')}</h3><p class="muted small">${tr('ins.c.boardSub')}</p>
        <div class="ix-tablewrap"><table class="ix-table"><thead><tr><th>#</th><th>${tr('ins.t.biz')}</th><th>${tr('a.type')}</th>
        ${[['n', 'ins.t.n'], ['csat', 'ins.k.csat'], ['d', 'ins.t.change'], ['open', 'ins.k.open']].map(([k, l]) => `<th><button type="button" data-sort="${k}" class="${state.sort === k ? 'on' : ''}">${tr(l)}</button></th>`).join('')}<th>${tr('ins.t.top')}</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr><td>${num(i + 1)}</td><td><b>${esc(RC.localName(r.bz, I18N.lang) || r.bz.slug)}</b></td><td>${tr(`a.type.${r.bz.businessType || 'restaurant'}`)}</td><td>${num(r.n)}</td><td><b>${pct(r.csat)}</b></td>
          <td>${r.d == null ? '–' : Math.round(r.d) === 0 ? '<span class="ix-delta flat">→ 0</span>' : `<span class="ix-delta ${r.d >= 0 ? 'up' : 'down'}"><span class="ix-arr">${r.d >= 0 ? '▲' : '▼'}</span> ${num(Math.abs(Math.round(r.d)))}</span>`}</td><td>${num(r.open)}</td><td>${r.top ? `${ISSUE_ICON[r.top]} ${tr(`a.issue.${r.top}`)}` : '–'}</td></tr>`).join('')}</tbody></table></div></div>`;
    }

    // Heatmap business × issue
    let heatBizHtml = '';
    if (multi && withIssues.length) {
      const bs = bizList.filter((bz) => withIssues.some((r) => r.business_id === bz.id));
      const m = bs.map((bz) => ISSUES.map((k) => withIssues.filter((r) => r.business_id === bz.id && issuesOf(r).includes(k)).length));
      heatBizHtml = `<div class="card"><h3>${tr('ins.c.heatBiz')}</h3><p class="muted small">${tr('ins.c.heatBizSub')}</p>
        ${heat(bs.map((bz) => esc(RC.localName(bz, I18N.lang) || bz.slug)), ISSUES.map((k) => `${ISSUE_ICON[k]}<small>${tr(`a.issue.${k}`)}</small>`), m, (i, j, v) => tr('ins.tip.heatBiz', { b: RC.localName(bs[i], I18N.lang) || bs[i].slug, i: tr(`a.issue.${ISSUES[j]}`), n: num(v) }))}</div>`;
    }

    // When problems happen: day × time band for low ratings
    const low = cur.filter((r) => r.rating <= 3);
    let whenHtml = '';
    if (low.length) {
      const m = DOW.map(() => BANDS.map(() => 0));
      low.forEach((r) => { const t = riyadh(r.created_at); const bi = bandOf(t.hour); if (bi >= 0 && t.dow >= 0) m[t.dow][bi]++; });
      whenHtml = `<div class="card"><h3>${tr('ins.c.when')}</h3><p class="muted small">${tr('ins.c.whenSub')}</p>
        ${heat(DOW.map((d) => tr(`ins.dow.${d}`)), BANDS.map((_, i) => tr(`ins.band.${i}`)), m, (i, j, v) => tr('ins.tip.when', { d: tr(`ins.dow.${DOW[i]}`), b: tr(`ins.band.${j}`), n: num(v) }))}</div>`;
    }

    // Text themes
    const th = themes(low);
    const themeHtml = `<div class="card"><h3>${tr('ins.c.themes')}</h3><p class="muted small">${tr('ins.c.themesSub')}</p>
      ${th.length ? `<div class="ix-words">${th.map(([w, n]) => `<span class="ix-word" style="--w:${(0.85 + (0.6 * n) / th[0][1]).toFixed(2)}" data-tip="${esc(tr('ins.tip.word', { w, n: num(n) }))}" dir="auto">${esc(w)} <small>${num(n)}</small></span>`).join('')}</div>` : `<p class="ix-empty">${tr('ins.noWords')}</p>`}</div>`;

    // Language split
    const ar = cur.filter((r) => r.lang === 'ar').length, en = cur.filter((r) => r.lang === 'en').length;
    const langHtml = ar + en ? `<div class="card"><h3>${tr('ins.c.lang')}</h3>${bars([{ label: 'العربية', value: ar }, { label: 'English', value: en }], { fmt: (v) => `${num(v)} · ${pct((100 * v) / (ar + en))}` })}<p class="muted small">${tr('ins.c.langSub')}</p></div>` : '';

    root.innerHTML = filters + alertsHtml + kpis + trend
      + `<div class="ix-grid2">${driverHtml}${distHtml}</div>`
      + `<div class="ix-grid2">${segHtml}${themeHtml}</div>`
      + boardHtml + heatBizHtml + `<div class="ix-grid2">${whenHtml}${langHtml}</div>`
      + `<p class="muted small ix-foot">${tr('ins.foot')}</p>`;
  }

  // ---------- Interaction ----------
  let tipEl;
  function showTip(text, x, y) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'ix-tip'; document.body.appendChild(tipEl); }
    tipEl.textContent = text; tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    tipEl.style.left = `${Math.min(innerWidth - r.width - 8, Math.max(8, x + 14))}px`;
    tipEl.style.top = `${Math.max(8, y - r.height - 10)}px`;
  }
  const hideTip = () => { if (tipEl) tipEl.hidden = true; };

  function bind(el) {
    el.addEventListener('click', (e) => {
      const d = e.target.closest('[data-days]'); if (d) { state.days = +d.dataset.days; render(); return; }
      const s = e.target.closest('[data-sort]'); if (s) { state.sort = s.dataset.sort; draw(); return; }
      if (e.target.closest('[data-act="csv"]')) csv();
    });
    el.addEventListener('change', (e) => {
      const f = e.target.dataset.f; if (!f) return;
      if (f === 'sample') { state.sample = e.target.checked; state.biz = 'all'; state.type = 'all'; render(); return; }
      state[f] = e.target.value; if (f === 'type') state.biz = 'all'; draw();
    });
    el.addEventListener('mousemove', (e) => {
      const t = e.target.closest('[data-tip]');
      if (t) { showTip(t.dataset.tip, e.clientX, e.clientY); return; }
      const ln = e.target.closest('.ix-line');
      if (ln) {
        const pts = JSON.parse(ln.dataset.points); const box = ln.getBoundingClientRect();
        const fx = (e.clientX - box.left) / box.width;
        const p = pts.reduce((a, b) => (Math.abs(b.x - fx) < Math.abs(a.x - fx) ? b : a));
        const cross = ln.querySelector('.ix-cross'); cross.style.display = ''; cross.setAttribute('x1', p.x * LW); cross.setAttribute('x2', p.x * LW);
        showTip(p.v == null ? `${p.l}: ${tr('ins.noData')}` : tr('ins.tip.trend', { l: p.l, v: pct(p.v), n: num(p.n) }), e.clientX, e.clientY); return;
      }
      hideTip();
    });
    el.addEventListener('mouseleave', () => { hideTip(); el.querySelectorAll('.ix-cross').forEach((c) => (c.style.display = 'none')); });
  }

  function csv() {
    const { cur } = periods();
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const head = ['date', 'business', 'type', 'rating', 'route', 'issues', 'status', 'resolved_at', 'language', 'text', 'reply', 'guest_says'];
    const lines = cur.map((r) => [r.created_at, nameOf(r.business_id), typeOf(r.business_id), r.rating, r.route, issuesOf(r).join('|'), r.status, r.resolved_at || '', r.lang || '', textOf(r), r.reply || '', r.guest_verdict || ''].map(q).join(','));
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `review-finder-cx-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Sample data (clearly labelled demo, never mixed with real data) ----------
  function sample() {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const biz = [
      ['s1', 'Al Bahr Seafood', 'مطعم البحر', 'restaurant', 4.3], ['s2', 'Karak House', 'بيت الكرك', 'restaurant', 4.5],
      ['s3', 'Tahlia Grill', 'مشويات التحلية', 'restaurant', 3.7], ['s4', 'Corniche Hotel', 'فندق الكورنيش', 'hotel', 4.1],
      ['s5', 'Glow Salon & Spa', 'صالون جلو', 'salon', 4.4], ['s6', 'Smile Dental Clinic', 'عيادة سمايل', 'clinic', 4.2],
    ].map(([id, name, nameAr, businessType, q]) => ({ id, slug: id, name, nameAr, businessType, q }));
    const words = {
      good: ['Great food and friendly staff', 'Lovely atmosphere, will come again', 'خدمة ممتازة وأكل لذيذ', 'Fast service, very clean', 'أفضل كرك في جدة'],
      bad: { food: ['Food arrived cold', 'الأكل بارد', 'Burger was overcooked'], service: ['Waited 40 minutes for our order', 'Slow service at dinner', 'الطلب تأخر كثير'],
        staff: ['Waiter was rude', 'Staff ignored us', 'الموظف ما كان محترم'], clean: ['Table was dirty', 'Bathroom not clean', 'الطاولة وسخة'], value: ['Too expensive for the portion', 'Prices went up', 'السعر غالي'] },
    };
    const reviews = [];
    const now = Date.now();
    biz.forEach((b) => {
      const n = 280 + Math.floor(rnd() * 200);
      for (let i = 0; i < n; i++) {
        const age = rnd() * 400 * DAY;
        const dinner = rnd() < 0.5;
        const t = new Date(now - age); t.setUTCHours(dinner ? 15 + Math.floor(rnd() * 5) : 6 + Math.floor(rnd() * 8), Math.floor(rnd() * 60));
        const drift = b.id === 's3' && age < 30 * DAY ? -0.8 : 0;  // a recent dip at one location, to show alerts
        let r = Math.round(b.q + drift + (rnd() - 0.5) * 2.6 - (dinner && t.getUTCDay() === 4 ? 0.7 : 0));
        r = Math.max(1, Math.min(5, r));
        const priv = r < 4;
        const issues = priv && b.businessType === 'restaurant' ? [pick(dinner ? ['service', 'service', 'food', 'staff'] : ['food', 'clean', 'value'])].concat(rnd() < 0.25 ? [pick(ISSUES)] : []) : [];
        const uniq = [...new Set(issues)];
        const text = priv ? (uniq.length ? pick(words.bad[uniq[0]]) : pick(Object.values(words.bad).flat())) : (rnd() < 0.6 ? pick(words.good) : '');
        const resolved = priv && rnd() < 0.75;
        const reply = priv && (resolved || rnd() < 0.3) ? 'Sorry about this, we have fixed it.' : '';
        const verdict = reply && rnd() < 0.55 ? (rnd() < b.q / 5.6 ? 'fixed' : 'not_fixed') : '';
        reviews.push({ id: `${b.id}-${i}`, business_id: b.id, rating: r, route: priv ? 'private' : 'google', issues: uniq, text, status: resolved ? 'resolved' : 'new', reply, guest_verdict: verdict,
          created_at: t.toISOString(), resolved_at: resolved ? new Date(+t + (2 + rnd() * 30) * 36e5).toISOString() : null, lang: /[؀-ۿ]/.test(text) || rnd() < 0.4 ? 'ar' : 'en' });
      }
    });
    return { biz, reviews };
  }

  return {
    mount(el, context) {
      ctx = context;
      if (root !== el) { root = el; bind(el); }
      render();
    },
    refresh() { if (root && ctx) draw(); },
  };
})();
