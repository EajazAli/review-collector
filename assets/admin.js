(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('editor');
  const SOCIAL_KEYS = Object.keys(RC.SOCIAL);

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
        <span><b>${RC.esc(b.name || 'Untitled')}</b><small>Threshold ${b.threshold}★ · /${RC.esc(b.slug)}</small></span></button>`;
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
    if (dirty && !confirm('You have unsaved changes. Discard them?')) return;
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
    if (dirty && !confirm('You have unsaved changes. Discard them?')) return;
    dirty = false;
    const b = { ...RC.newBusiness(), name: 'New business', slug: uniqueSlug('new-business') };
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
      `<button type="button" role="radio" data-n="${n}">${n}★<small>${['Everything', '2★ and up', '3★ and up', '4★ and up', 'Only 5★'][n - 1]}</small></button>`).join('');
    $('swatches').innerHTML = Object.entries(RC.THEMES).map(([k, t]) =>
      `<button type="button" class="sw" data-k="${k}" data-label="${t.label}" title="${t.label}" style="background:linear-gradient(150deg,${t.from},${t.to})"></button>`).join('');
    $('socialFields').innerHTML = SOCIAL_KEYS.map((k) =>
      `<label class="f"><span>${RC.SOCIAL[k].label}</span><input name="social_${k}" placeholder="${k === 'website' ? 'www.example.com' : '@handle'}" /></label>`).join('');
  }

  function fillForm() {
    const d = draft;
    form.bizName.value = d.name; form.slug.value = d.slug; form.tagline.value = d.tagline || '';
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
      n >= t ? `<span class="pub">${n}★ Google</span>` : `<span class="priv">${n}★ Private</span>`).join('');
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
    catch { toast("Couldn't read that image"); }
    $('logoInput').value = '';
  }
  $('logoRemove').addEventListener('click', () => { draft.logo = ''; renderLogo(); markDirty(); });
  function renderLogo() {
    $('logoImg').hidden = !draft.logo; $('logoPh').hidden = !!draft.logo; $('logoRemove').hidden = !draft.logo;
    if (draft.logo) $('logoImg').src = draft.logo;
  }

  $('testGoogle').addEventListener('click', () => {
    const url = RC.googleLink(draft);
    if (!url) return toast('Add a Google review link first');
    window.open(url, '_blank', 'noopener');
  });

  function markDirty() {
    dirty = true;
    $('saveStatus').textContent = 'Unsaved changes';
    refresh();
  }

  let saving = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!draft.name.trim()) return toast('Add a business name');
    if (!draft.slug) return toast('Add a page link');
    if (list.some((b) => b.slug === draft.slug && b.id !== draft.id)) return toast('That page link is already used');
    saving = true;
    $('saveStatus').textContent = 'Saving…';
    try {
      const saved = await RC.saveBusiness(draft);
      if (user.isAdmin) draft.members = (await RC.setMembers(draft.id, (draft.members || '').split(/[\s,;]+/))).join('\n');
      list = list.map((b) => (b.id === saved.id ? saved : b));
      draft = { ...structuredClone(saved), members: draft.members };
      fillForm();
      dirty = false;
      $('saveStatus').textContent = 'Saved · live now';
      renderList(); refresh();
      toast('Saved');
    } catch (err) {
      $('saveStatus').textContent = 'Not saved';
      toast(friendly(err));
    } finally { saving = false; }
  });

  $('deleteBiz').addEventListener('click', async () => {
    if (!confirm(`Delete "${draft.name}" and all its reviews? Printed QR codes for it will stop working.`)) return;
    try {
      await RC.deleteBusiness(draft.id);
      list = list.filter((b) => b.id !== draft.id);
      dirty = false; currentId = null; draft = null;
      if (list[0]) select(list[0].id); else renderList();
      toast('Deleted');
    } catch (e) { toast(friendly(e)); }
  });

  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  function friendly(err) {
    const m = err?.message || String(err);
    if (/duplicate key|unique/i.test(m)) return 'That page link is already taken';
    if (/row-level security|permission/i.test(m)) return "You don't have permission to do that";
    if (/JWT|session/i.test(m)) return 'Your session expired. Please sign in again.';
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
    if (typeof QRCodeStyling === 'undefined') { $('qr').textContent = 'QR library failed to load (check your connection).'; return; }
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
    try { await navigator.clipboard.writeText($('pageUrl').value); toast('Link copied'); } catch { $('pageUrl').select(); }
  });
  $('printCard').addEventListener('click', () => window.print());

  function renderDelivery() {
    const n = $('deliveryNote');
    const wa = draft.whatsapp.filter(Boolean);
    if (draft.webhookUrl) {
      n.className = 'note ok';
      n.textContent = `Automatic: feedback and photos are sent to your webhook${wa.length ? `, which should forward them to ${wa.join(' and ')}` : ''}.`;
    } else if (wa.length) {
      n.className = 'note';
      n.textContent = `Every low rating is saved under Reviews. The guest's WhatsApp also opens a message to ${wa[0]}, which they send. Add a webhook to alert both numbers automatically.`;
    } else {
      n.className = 'note';
      n.textContent = 'Low ratings are saved under Reviews. Add a WhatsApp number to also get them on your phone.';
    }
  }

  // ---------- Reviews ----------
  async function loadReviews() {
    $('feed').innerHTML = '<div class="card"><p class="muted">Loading reviews…</p></div>';
    try {
      reviews = await RC.listReviews(list.map((b) => b.id));
      photoLinks = await RC.photoUrls(reviews.flatMap((r) => r.images || []));
    } catch (e) { toast(friendly(e)); reviews = []; }
    renderInbox();
  }

  function renderInbox() {
    const fb = $('fBiz');
    const cur = fb.value || 'all';
    fb.innerHTML = `<option value="all">All businesses</option>` + list.map((b) => `<option value="${b.id}">${RC.esc(b.name)}</option>`).join('');
    fb.value = list.some((b) => b.id === cur) ? cur : 'all';
    fb.hidden = list.length < 2;

    const scoped = reviews.filter((r) => fb.value === 'all' || r.business_id === fb.value);
    const priv = scoped.filter((r) => r.route === 'private');
    const avg = scoped.length ? (scoped.reduce((s, r) => s + r.rating, 0) / scoped.length).toFixed(1) : '–';
    $('stats').innerHTML = [
      [scoped.length, 'Total ratings'],
      [scoped.length - priv.length, 'Sent to Google'],
      [priv.filter((r) => r.status !== 'resolved').length, 'Open private feedback'],
      [avg, 'Average rating'],
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
          <span class="tag ${r.route === 'private' ? 'priv' : 'pub'}">${r.route === 'private' ? 'Private' : 'Google'}</span>
          ${r.status === 'resolved' ? '<span class="tag">Resolved</span>' : ''}
          <time>${new Date(r.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time>
        </div>
        ${r.text ? `<p>${RC.esc(r.text)}</p>` : '<p class="muted">No comment</p>'}
        ${r.images?.length ? `<div class="fb-imgs">${r.images.map((p) => photoLinks[p] ? `<img src="${RC.esc(photoLinks[p])}" alt="Guest photo">` : '').join('')}</div>` : ''}
        ${r.route === 'google' ? `<div class="fb-foot">
          <span class="who-line">Guest was sent to Google${RC.googleReviewsUrl(biz(r.business_id)) ? ` · <a class="link small" target="_blank" rel="noopener" href="${RC.esc(RC.googleReviewsUrl(biz(r.business_id)))}">See it on Google</a>` : ''}</span>
          <a class="btn g-btn" target="_blank" rel="noopener" href="${RC.GOOGLE_REPLY_URL}" title="Opens your Google Business Profile reviews, where you can reply"><svg viewBox="0 0 48 48" aria-hidden="true">${document.querySelector('#openGoogleReviews svg').innerHTML}</svg>Reply on Google</a>
        </div>` : ''}
        ${r.route === 'private' ? `<div class="fb-foot">
          <span class="who-line">${RC.esc(r.guest_name || 'Anonymous')}${r.guest_phone ? ' · ' + RC.esc(r.guest_phone) : ''}</span>
          ${r.guest_phone ? `<a class="btn" target="_blank" rel="noopener" href="${RC.waLink(r.guest_phone, `Hi ${r.guest_name || ''}, this is ${name(r.business_id)}. Thank you for your feedback, we're sorry about your visit.`)}">Reply on WhatsApp</a>` : ''}
          <button class="btn" data-toggle="${r.id}">${r.status === 'resolved' ? 'Reopen' : 'Mark resolved'}</button>
        </div>` : ''}
      </article>`).join('')
      : `<div class="card empty"><h2>Nothing here yet</h2><p class="muted">Ratings from your QR code will appear here.</p></div>`;

    const open = reviews.filter((r) => r.route === 'private' && r.status !== 'resolved').length;
    $('inboxCount').hidden = !open; $('inboxCount').textContent = open;
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
    try { await RC.updatePassword($('newPw').value); $('newPw').value = ''; toast('Password updated'); }
    catch (err) { toast(friendly(err)); }
  });
  $('savePublic').addEventListener('click', () => {
    const raw = $('publicUrl').value.trim();
    const v = raw ? RC.siteBase(raw) : '';
    if (raw && !v) return toast("That doesn't look like a web address");
    RC.saveSettings({ ...RC.settings(), publicUrl: v });
    $('publicUrl').value = v;
    toast('Saved. QR codes now use this address');
    refresh();
  });
  async function runImport(arr) {
    if (!Array.isArray(arr) || !arr.length) return toast('No businesses found to import');
    if (!confirm(`Import ${arr.length} business(es) into the database?`)) return;
    try {
      const n = await RC.importBusinesses(arr);
      list = await RC.listBusinesses(user);
      currentId = null; dirty = false;
      if (list[0]) await select(list[0].id); else renderList();
      toast(`Imported ${n} business(es)`);
    } catch (e) { toast(friendly(e)); }
  }
  $('importLive').addEventListener('click', async () => runImport(await RC.fetchPublished()));
  $('importJson').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await runImport(Array.isArray(data) ? data : data.businesses);
    } catch { toast("That file isn't a valid businesses.json"); }
    e.target.value = '';
  });

  $('signOut').addEventListener('click', async () => {
    if (dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
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

  // ---------- Boot ----------
  (async () => {
    if (!RC.configured) {
      return gate(`<h2>Connect the database</h2><p>Review Finder needs its Supabase details. Add the Project URL and anon key to <code>assets/config.js</code>, then reload.</p>`);
    }
    try { user = await RC.me(); } catch { user = null; }
    if (!user) { location.replace('login.html'); return; }

    document.body.classList.toggle('is-admin', user.isAdmin);
    $('whoEmail').textContent = user.email;
    $('whoRole').textContent = user.isAdmin ? 'H&H admin' : 'Business owner';
    $('whoAv').textContent = user.email[0].toUpperCase();
    if (!user.isAdmin) {
      $('tabBizLabel').textContent = 'My business';
      $('bizTitle').textContent = 'My business';
      $('bizSub').textContent = 'Customise your review page and download your QR code.';
      $('emptyTitle').textContent = 'No business linked yet';
      $('emptyText').textContent = 'Your login is not linked to a business yet. Please contact H&H Technology.';
    }

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
