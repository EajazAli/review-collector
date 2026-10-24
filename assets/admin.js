(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('editor');
  const SOCIAL_KEYS = Object.keys(RC.SOCIAL);
  const tr = (k, v) => I18N.t(k, v);
  const num = (n) => I18N.fmtNum(n);
  // Quick-pick issues guests can tap on low ratings
  const ISSUE_KEYS = ['food', 'service', 'staff', 'clean'];
  const ISSUE_ICON = { food: '🍽️', service: '⏱️', staff: '🙋', clean: '🧹' };
  // Reviews saved before the issues column existed carry them as a "[food, service] ..." prefix.
  const LEGACY = /^\[((?:food|service|staff|clean)(?:,\s*(?:food|service|staff|clean))*)\]\s*/;
  const issuesOf = (r) => (r.issues?.length ? r.issues : ((r.text || '').match(LEGACY)?.[1].split(/,\s*/) || []));
  const textOf = (r) => (r.text || '').replace(LEGACY, '');

  let user = null;        // { email, isAdmin }
  let list = [];          // businesses this login can manage
  let currentId = null;
  let draft = null;
  let dirty = false;
  let previewReady = false;
  let reviews = [];
  let photoLinks = {};

  // ---------- Navigation ----------
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  function showView(v) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
    document.querySelectorAll('.view').forEach((s) => (s.hidden = s.id !== `view-${v}`));
    if (v === 'inbox') loadReviews();
    if (v === 'settings') { $('publicUrl').value = RC.settings().publicUrl; $('pwEmail').textContent = user.email; }
    history.replaceState(null, '', `#${v}`);
  }

  // ---------- Business list ----------
  function renderList() {
    $('bizList').innerHTML = list.map((b) => {
      const t = b.theme || RC.THEMES.sunset;
      const av = b.logo ? `<img src="${RC.esc(b.logo)}" alt="">` : RC.esc(RC.initials(b.name));
      return `<button class="biz ${b.id === currentId ? 'active' : ''}" data-id="${b.id}">
        <span class="av" style="background:linear-gradient(150deg,${t.from},${t.to})">${av}</span>
        <span><b>${RC.esc(RC.localName(b, I18N.lang) || tr('a.untitled'))}</b><small>${tr('a.thresholdShort', { n: num(b.threshold) })} · <span dir="ltr">/${RC.esc(b.slug)}</span></small></span></button>`;
    }).join('');
    $('emptyState').hidden = list.length > 0;
    // A client with a single business doesn't need the switcher.
    $('bizList').hidden = list.length === 0 || (!user.isAdmin && list.length === 1);
    $('workspace').hidden = !currentId;
  }
  $('bizList').addEventListener('click', (e) => {
    const id = e.target.closest('.biz')?.dataset.id;
    if (id && id !== currentId) select(id);
  });

  async function select(id) {
    if (dirty && !confirm(tr('t.discard'))) return;
    currentId = id;
    draft = structuredClone(list.find((b) => b.id === id));
    draft.members = '';
    dirty = false;
    fillForm();
    renderList();
    refresh();
    $('saveStatus').textContent = '';
    if (user.isAdmin) {
      try { draft.members = (await RC.listMembers(id)).join('\n'); form.members.value = draft.members; }
      catch (e) { toast(e.message); }
    }
  }

  async function addBusiness() {
    if (dirty && !confirm(tr('t.discard'))) return;
    dirty = false;
    const b = { ...RC.newBusiness(), name: tr('a.newBizName'), slug: uniqueSlug('new-business') };
    try {
      const created = await RC.createBusiness(b);
      list.push(created);
      await select(created.id);
      form.bizName.focus(); form.bizName.select();
    } catch (e) { toast(friendly(e)); }
  }
  $('addBiz').addEventListener('click', addBusiness);
  $('addBiz2').addEventListener('click', addBusiness);

  function uniqueSlug(base, selfId) {
    let s = base || 'business', n = 2;
    while (list.some((b) => b.slug === s && b.id !== selfId)) s = `${base}-${n++}`;
    return s;
  }

  // ---------- Form ----------
  function buildStaticControls() {
    $('threshold').innerHTML = [1, 2, 3, 4, 5].map((n) =>
      `<button type="button" role="radio" data-n="${n}">${num(n)}★<small>${tr(`a.th.${n}`)}</small></button>`).join('');
    $('swatches').innerHTML = Object.entries(RC.THEMES).map(([k, t]) =>
      `<button type="button" class="sw" data-k="${k}" data-label="${tr(`theme.${k}`)}" title="${tr(`theme.${k}`)}" style="background:linear-gradient(150deg,${t.from},${t.to})"></button>`).join('');
    $('socialFields').innerHTML = SOCIAL_KEYS.map((k) =>
      `<label class="f"><span>${tr(`social.${k}`)}</span><input name="social_${k}" dir="ltr" placeholder="${k === 'website' ? 'www.example.com' : tr('a.handle.ph')}" /></label>`).join('');
  }

  function fillForm() {
    const d = draft;
    form.bizName.value = d.name; form.slug.value = d.slug; form.tagline.value = d.tagline || '';
    form.nameAr.value = d.nameAr || ''; form.taglineAr.value = d.taglineAr || '';
    form.slug.readOnly = !user.isAdmin;
    form.from.value = d.theme.from; form.to.value = d.theme.to; form.ink.value = d.theme.ink || '#ffffff'; form.face.value = d.theme.face || '#1e1a17';
    form.googleReviewUrl.value = d.googleReviewUrl || '';
    form.wa0.value = d.whatsapp[0] || ''; form.wa1.value = d.whatsapp[1] || '';
    form.webhookUrl.value = d.webhookUrl || '';
    form.members.value = d.members || '';
    SOCIAL_KEYS.forEach((k) => (form[`social_${k}`].value = d.social[k] || ''));
    renderLogo(); renderThreshold(); renderSwatches();
  }

  form.addEventListener('input', (e) => {
    const n = e.target.name;
    if (!n || !draft) return;
    const v = e.target.value;
    if (n === 'bizName') {
      const auto = user.isAdmin && (!draft.slug || draft.slug === RC.slugify(draft.name) || /^new-business(-\d+)?$/.test(draft.slug));
      draft.name = v;
      if (auto) { draft.slug = uniqueSlug(RC.slugify(v), draft.id); form.slug.value = draft.slug; }
    } else if (n === 'slug') {
      draft.slug = RC.slugify(v); if (v !== draft.slug && !v.endsWith('-')) form.slug.value = draft.slug;
    } else if (['from', 'to', 'ink', 'face'].includes(n)) {
      draft.theme = { ...draft.theme, [n]: v, preset: 'custom' }; renderSwatches();
    } else if (n === 'wa0' || n === 'wa1') {
      draft.whatsapp[+n.slice(2)] = v.trim();
    } else if (n.startsWith('social_')) {
      draft.social[n.slice(7)] = v.trim();
    } else {
      draft[n] = v;
    }
    markDirty();
  });

  $('threshold').addEventListener('click', (e) => {
    const n = e.target.closest('button')?.dataset.n;
    if (!n) return;
    draft.threshold = +n; renderThreshold(); markDirty();
  });
  function renderThreshold() {
    const t = draft.threshold;
    $('threshold').querySelectorAll('button').forEach((b) => {
      const on = +b.dataset.n === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
    });
    $('splitBar').innerHTML = [1, 2, 3, 4, 5].map((n) =>
      n >= t ? `<span class="pub">${tr('a.split.google', { n: num(n) })}</span>` : `<span class="priv">${tr('a.split.private', { n: num(n) })}</span>`).join('');
  }

  $('swatches').addEventListener('click', (e) => {
    const k = e.target.closest('.sw')?.dataset.k;
    if (!k) return;
    const t = RC.THEMES[k];
    draft.theme = { preset: k, ...t };
    form.from.value = t.from; form.to.value = t.to; form.ink.value = t.ink; form.face.value = t.face;
    renderSwatches(); markDirty();
  });
  function renderSwatches() {
    $('swatches').querySelectorAll('.sw').forEach((s) => s.classList.toggle('on', s.dataset.k === draft.theme.preset));
  }

  // Logo upload (click or drag & drop). Kept as a data URL until Save, then uploaded to Storage.
  const drop = $('logoDrop');
  $('logoInput').addEventListener('change', (e) => e.target.files[0] && setLogo(e.target.files[0]));
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('logoInput').click(); } });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('drag')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) setLogo(f); });
  async function setLogo(file) {
    try { draft.logo = await RC.resizeImage(file, 320, 'image/png'); renderLogo(); markDirty(); }
    catch { toast(tr('t.badImg')); }
    $('logoInput').value = '';
  }
  $('logoRemove').addEventListener('click', () => { draft.logo = ''; renderLogo(); markDirty(); });
  function renderLogo() {
    $('logoImg').hidden = !draft.logo; $('logoPh').hidden = !!draft.logo; $('logoRemove').hidden = !draft.logo;
    if (draft.logo) $('logoImg').src = draft.logo;
  }

  $('testGoogle').addEventListener('click', () => {
    const url = RC.googleLink(draft);
    if (!url) return toast(tr('t.addGoogle'));
    window.open(url, '_blank', 'noopener');
  });

  function markDirty() {
    dirty = true;
    $('saveStatus').textContent = tr('a.st.unsaved');
    refresh();
  }

  let saving = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!draft.name.trim()) return toast(tr('t.addName'));
    if (!draft.slug) return toast(tr('t.addSlug'));
    if (list.some((b) => b.slug === draft.slug && b.id !== draft.id)) return toast(tr('t.slugUsed'));
    saving = true;
    $('saveStatus').textContent = tr('a.st.saving');
    try {
      const saved = await RC.saveBusiness(draft);
      if (user.isAdmin) draft.members = (await RC.setMembers(draft.id, (draft.members || '').split(/[\s,;]+/))).join('\n');
      list = list.map((b) => (b.id === saved.id ? saved : b));
      draft = { ...structuredClone(saved), members: draft.members };
      fillForm();
      dirty = false;
      $('saveStatus').textContent = tr('a.st.saved');
      renderList(); refresh();
      toast(tr('t.saved'));
    } catch (err) {
      $('saveStatus').textContent = tr('a.st.notSaved');
      toast(friendly(err));
    } finally { saving = false; }
  });

  $('deleteBiz').addEventListener('click', async () => {
    if (!confirm(tr('t.deleteConfirm', { name: draft.name }))) return;
    try {
      await RC.deleteBusiness(draft.id);
      list = list.filter((b) => b.id !== draft.id);
      dirty = false; currentId = null; draft = null;
      if (list[0]) select(list[0].id); else renderList();
      toast(tr('t.deleted'));
    } catch (e) { toast(friendly(e)); }
  });

  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  function friendly(err) {
    const m = err?.message || String(err);
    if (/duplicate key|unique/i.test(m)) return tr('t.slugTaken');
    if (/row-level security|permission/i.test(m)) return tr('t.noPermission');
    if (/JWT|session/i.test(m)) return tr('t.session');
    return m;
  }

  // ---------- Preview + QR ----------
  let qrTimer;
  function refresh() {
    if (!draft) return;
    sendPreview();
    const url = RC.reviewUrl(draft);
    $('pageUrl').value = url;
    $('openPage').href = url;
    const t = draft.theme;
    $('tableCard').style.background = `linear-gradient(160deg, ${t.from}, ${t.to})`;
    $('tableCard').style.color = t.ink;
    $('tcHead').innerHTML = (draft.logo ? `<img src="${RC.esc(draft.logo)}" alt="">` : `<span class="ini">${RC.esc(RC.initials(draft.name))}</span>`) + `<span>${RC.esc(draft.name)}</span>`;
    renderDelivery();
    clearTimeout(qrTimer);
    qrTimer = setTimeout(renderQR, 200);
  }

  function sendPreview() {
    if (previewReady) $('preview').contentWindow.postMessage({ type: 'rc-preview', business: draft }, location.origin);
  }
  window.addEventListener('message', (e) => {
    if (e.origin === location.origin && e.data?.type === 'rc-preview-ready') { previewReady = true; sendPreview(); }
  });

  let qr = null;
  function renderQR() {
    if (typeof QRCodeStyling === 'undefined') { $('qr').textContent = tr('a.qrFail'); return; }
    const dark = mix(draft.theme.to, '#000000', 0.35);
    qr = new QRCodeStyling({
      width: 600, height: 600, type: 'canvas', margin: 0,
      data: RC.reviewUrl(draft),
      image: draft.logo || undefined,
      qrOptions: { errorCorrectionLevel: draft.logo ? 'H' : 'M' },
      dotsOptions: { type: 'rounded', color: dark },
      cornersSquareOptions: { type: 'extra-rounded', color: draft.theme.to },
      cornersDotOptions: { type: 'dot', color: dark },
      backgroundOptions: { color: '#ffffff' },
      imageOptions: { margin: 8, imageSize: 0.34, hideBackgroundDots: true, crossOrigin: 'anonymous' },
    });
    $('qr').innerHTML = '';
    qr.append($('qr'));
  }
  // Darken the theme colour so the QR always has enough contrast to scan.
  function mix(a, b, w) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return '#' + x.map((v, i) => Math.round(v * (1 - w) + y[i] * w).toString(16).padStart(2, '0')).join('');
  }
  $('dlPng').addEventListener('click', () => qr?.download({ name: `qr-${draft.slug}`, extension: 'png' }));
  $('dlSvg').addEventListener('click', () => {
    if (!qr) return;
    new QRCodeStyling({ ...qr._options, type: 'svg' }).download({ name: `qr-${draft.slug}`, extension: 'svg' });
  });
  $('copyUrl').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('pageUrl').value); toast(tr('t.linkCopied')); } catch { $('pageUrl').select(); }
  });
  $('printCard').addEventListener('click', () => window.print());

  function renderDelivery() {
    const n = $('deliveryNote');
    const wa = draft.whatsapp.filter(Boolean);
    if (draft.webhookUrl) {
      n.className = 'note ok';
      n.textContent = wa.length ? tr('a.deliv.webhookWa', { numbers: wa.join(tr('a.and')) }) : tr('a.deliv.webhook');
    } else if (wa.length) {
      n.className = 'note';
      n.textContent = tr('a.deliv.wa', { number: wa[0] });
    } else {
      n.className = 'note';
      n.textContent = tr('a.deliv.none');
    }
  }

  // ---------- Reviews ----------
  async function loadReviews() {
    $('feed').innerHTML = `<div class="card"><p class="muted">${tr('a.loadingReviews')}</p></div>`;
    try {
      reviews = await RC.listReviews(list.map((b) => b.id));
      photoLinks = await RC.photoUrls(reviews.flatMap((r) => r.images || []));
    } catch (e) { toast(friendly(e)); reviews = []; }
    renderInbox();
  }

  function renderInbox() {
    const fb = $('fBiz');
    const cur = fb.value || 'all';
    fb.innerHTML = `<option value="all">${tr('a.f.allBiz')}</option>` + list.map((b) => `<option value="${b.id}">${RC.esc(RC.localName(b, I18N.lang))}</option>`).join('');
    fb.value = list.some((b) => b.id === cur) ? cur : 'all';
    fb.hidden = list.length < 2;

    const scoped = reviews.filter((r) => fb.value === 'all' || r.business_id === fb.value);
    const priv = scoped.filter((r) => r.route === 'private');
    // Most common issues among private feedback
    const counts = Object.fromEntries(ISSUE_KEYS.map((k) => [k, 0]));
    priv.forEach((r) => issuesOf(r).forEach((k) => counts[k]++));
    const ranked = ISSUE_KEYS.filter((k) => counts[k]).sort((a, b) => counts[b] - counts[a]);
    $('issueStats').hidden = !ranked.length;
    $('issueStats').innerHTML = ranked.length ? `<span class="is-title">${tr('a.issues.top')}</span>` + ranked.map((k) => {
      const pct = Math.round((counts[k] / Math.max(1, priv.length)) * 100);
      return `<div class="is-row"><span class="is-label">${ISSUE_ICON[k]} ${tr(`a.issue.${k}`)}</span><span class="is-bar"><i style="width:${pct}%"></i></span><b>${num(counts[k])}</b></div>`;
    }).join('') : '';
    const avg = scoped.length ? (scoped.reduce((s, r) => s + r.rating, 0) / scoped.length).toFixed(1) : '–';
    $('stats').innerHTML = [
      [num(scoped.length), tr('a.stat.total')],
      [num(scoped.length - priv.length), tr('a.stat.google')],
      [num(priv.filter((r) => r.status !== 'resolved').length), tr('a.stat.open')],
      [avg === '–' ? avg : num(+avg), tr('a.stat.avg')],
    ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

    const route = $('fRoute').value;
    const shown = route === 'all' ? scoped : scoped.filter((r) => r.route === route);
    const biz = (id) => list.find((b) => b.id === id) || {};
    const name = (id) => biz(id).name || '';
    $('feed').innerHTML = shown.length ? shown.map((r) => `
      <article class="fb ${r.status === 'resolved' ? 'resolved' : ''}">
        <div class="fb-top">
          <span class="dots" aria-label="${r.rating} out of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= r.rating ? 'on' : ''}"></i>`).join('')}</span>
          <b>${RC.esc(name(r.business_id))}</b>
          <span class="tag ${r.route === 'private' ? 'priv' : 'pub'}">${r.route === 'private' ? tr('a.tag.private') : tr('a.tag.google')}</span>
          ${r.status === 'resolved' ? `<span class="tag">${tr('a.tag.resolved')}</span>` : ''}
          <time>${I18N.fmtDate(r.created_at)}</time>
        </div>
        ${issuesOf(r).length ? `<div class="fb-issues">${issuesOf(r).map((k) => `<span class="tag issue">${ISSUE_ICON[k]} ${tr(`a.issue.${k}`)}</span>`).join('')}</div>` : ''}
        ${textOf(r) ? `<p dir="auto">${RC.esc(textOf(r))}</p>` : (issuesOf(r).length ? '' : `<p class="muted">${tr('a.noComment')}</p>`)}
        ${r.images?.length ? `<div class="fb-imgs">${r.images.map((p) => photoLinks[p] ? `<img src="${RC.esc(photoLinks[p])}" alt="Guest photo">` : '').join('')}</div>` : ''}
        ${r.route === 'google' ? `<div class="fb-foot">
          <span class="who-line">${tr('a.sentToGoogle')}${RC.googleReviewsUrl(biz(r.business_id)) ? ` · <a class="link small" target="_blank" rel="noopener" href="${RC.esc(RC.googleReviewsUrl(biz(r.business_id)))}">${tr('a.seeOnGoogle')}</a>` : ''}</span>
          <a class="btn g-btn" target="_blank" rel="noopener" href="${RC.GOOGLE_REPLY_URL}" title="${tr('a.replyGoogle.title')}"><svg viewBox="0 0 48 48" aria-hidden="true">${document.querySelector('#openGoogleReviews svg').innerHTML}</svg>${tr('a.replyGoogle')}</a>
        </div>` : ''}
        ${r.route === 'private' ? `<div class="fb-foot">
          <span class="who-line">${RC.esc(r.guest_name || tr('a.anonymous'))}${r.guest_phone ? ` · <span dir="ltr">${RC.esc(r.guest_phone)}</span>` : ''}</span>
          ${r.guest_phone ? `<a class="btn" target="_blank" rel="noopener" href="${RC.waLink(r.guest_phone, tr('a.replyWa.msg', { name: r.guest_name || '', biz: name(r.business_id) }))}">${tr('a.replyWa')}</a>` : ''}
          <button class="btn" data-toggle="${r.id}">${r.status === 'resolved' ? tr('a.reopen') : tr('a.resolve')}</button>
        </div>` : ''}
      </article>`).join('')
      : `<div class="card empty"><h2>${tr('a.nothing.title')}</h2><p class="muted">${tr('a.nothing.text')}</p></div>`;

    const open = reviews.filter((r) => r.route === 'private' && r.status !== 'resolved').length;
    $('inboxCount').hidden = !open; $('inboxCount').textContent = num(open);
  }
  $('fBiz').addEventListener('change', renderInbox);
  $('fRoute').addEventListener('change', renderInbox);
  $('feed').addEventListener('click', async (e) => {
    const id = e.target.dataset?.toggle;
    if (id) {
      const r = reviews.find((x) => x.id === id);
      const status = r.status === 'resolved' ? 'new' : 'resolved';
      try { await RC.updateReview(id, { status }); r.status = status; renderInbox(); }
      catch (err) { toast(friendly(err)); }
    }
    if (e.target.matches('.fb-imgs img')) {
      const lb = document.createElement('div');
      lb.className = 'lightbox'; lb.innerHTML = `<img src="${e.target.src}" alt="">`;
      lb.onclick = () => lb.remove(); document.body.appendChild(lb);
    }
  });

  // ---------- Settings ----------
  $('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await RC.updatePassword($('newPw').value); $('newPw').value = ''; toast(tr('t.pwUpdated')); }
    catch (err) { toast(friendly(err)); }
  });
  $('savePublic').addEventListener('click', () => {
    const raw = $('publicUrl').value.trim();
    const v = raw ? RC.siteBase(raw) : '';
    if (raw && !v) return toast(tr('t.badUrl'));
    RC.saveSettings({ ...RC.settings(), publicUrl: v });
    $('publicUrl').value = v;
    toast(tr('t.publicSaved'));
    refresh();
  });
  async function runImport(arr) {
    if (!Array.isArray(arr) || !arr.length) return toast(tr('t.noneToImport'));
    if (!confirm(tr('t.importConfirm', { n: num(arr.length) }))) return;
    try {
      const n = await RC.importBusinesses(arr);
      list = await RC.listBusinesses(user);
      currentId = null; dirty = false;
      if (list[0]) await select(list[0].id); else renderList();
      toast(tr('t.imported', { n: num(n) }));
    } catch (e) { toast(friendly(e)); }
  }
  $('importLive').addEventListener('click', async () => runImport(await RC.fetchPublished()));
  $('importJson').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await runImport(Array.isArray(data) ? data : data.businesses);
    } catch { toast(tr('t.badJson')); }
    e.target.value = '';
  });

  $('signOut').addEventListener('click', async () => {
    if (dirty && !confirm(tr('t.signOutDirty'))) return;
    dirty = false;
    await RC.signOut();
    location.replace('login.html');
  });

  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }

  function gate(html) {
    $('gateMsg').innerHTML = html;
    $('gateMsg').hidden = false;
  }

  // ---------- Language ----------
  function renderLang() {
    document.title = tr('a.docTitle');
    document.querySelectorAll('[data-set-lang]').forEach((b) => b.classList.toggle('primary', b.dataset.setLang === I18N.lang));
    if (!user) return;
    buildStaticControls();
    if (draft) {
      SOCIAL_KEYS.forEach((k) => (form[`social_${k}`].value = draft.social[k] || ''));
      renderThreshold(); renderSwatches(); renderDelivery();
      if (dirty) $('saveStatus').textContent = tr('a.st.unsaved');
    }
    renderList();
    if (!$('view-inbox').hidden || reviews.length) renderInbox();
  }
  window.addEventListener('langchange', renderLang);
  document.querySelectorAll('[data-set-lang]').forEach((b) => b.addEventListener('click', () => I18N.set(b.dataset.setLang)));
  I18N.apply();
  renderLang();

  // ---------- Boot ----------
  (async () => {
    if (!RC.configured) {
      return gate(`<h2>${tr('a.gate.title')}</h2><p>${tr('a.gate.text')}</p>`);
    }
    try { user = await RC.me(); } catch { user = null; }
    if (!user) { location.replace('login.html'); return; }

    document.body.classList.toggle('is-admin', user.isAdmin);
    $('whoEmail').textContent = user.email;
    $('whoRole').dataset.i18n = user.isAdmin ? 'a.role.admin' : 'a.role.owner';
    $('whoAv').textContent = user.email[0].toUpperCase();
    if (!user.isAdmin) {
      // Business owners see "My business" wording; swap the translation keys so language changes keep it.
      $('tabBizLabel').dataset.i18n = 'a.tab.myBusiness';
      $('bizTitle').dataset.i18n = 'a.biz.titleClient';
      $('bizSub').dataset.i18n = 'a.biz.subClient';
      $('emptyTitle').dataset.i18n = 'a.empty.titleClient';
      $('emptyText').dataset.i18n = 'a.empty.textClient';
    }
    I18N.apply();

    buildStaticControls();
    try { list = await RC.listBusinesses(user); } catch (e) { toast(friendly(e)); }
    $('preview').src = 'review.html?preview=1';
    if (list[0]) await select(list[0].id); else renderList();
    document.body.classList.remove('loading');

    const v = location.hash.slice(1);
    if (['businesses', 'inbox', 'settings'].includes(v)) showView(v);
    // Load counts for the badge in the background.
    RC.listReviews(list.map((b) => b.id)).then((r) => { reviews = r; renderInbox(); }).catch(() => {});

    RC.sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('login.html'); });
  })();
})();
