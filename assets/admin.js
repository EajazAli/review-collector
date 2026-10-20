(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('editor');
  const SOCIAL_KEYS = Object.keys(RC.SOCIAL);

  let list = [];
  let currentId = null;
  let draft = null;
  let dirty = false;
  let previewReady = false;

  // ---------- Navigation ----------
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  function showView(v) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
    document.querySelectorAll('.view').forEach((s) => (s.hidden = s.id !== `view-${v}`));
    if (v === 'inbox') renderInbox();
    if (v === 'publish') $('publicUrl').value = RC.settings().publicUrl;
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
    $('bizList').hidden = list.length === 0;
    $('workspace').hidden = !currentId;
  }
  $('bizList').addEventListener('click', (e) => {
    const id = e.target.closest('.biz')?.dataset.id;
    if (id && id !== currentId) select(id);
  });

  function select(id) {
    if (dirty && !confirm('You have unsaved changes. Discard them?')) return;
    currentId = id;
    draft = structuredClone(list.find((b) => b.id === id));
    draft.whatsapp = draft.whatsapp || ['', ''];
    draft.social = { ...RC.newBusiness().social, ...(draft.social || {}) };
    dirty = false;
    fillForm();
    renderList();
    refresh();
  }

  function addBusiness() {
    if (dirty && !confirm('You have unsaved changes. Discard them?')) return;
    dirty = false;
    const b = RC.newBusiness();
    b.name = 'New business';
    b.slug = uniqueSlug('new-business');
    list.push(b);
    RC.saveList(list);
    select(b.id);
    form.bizName.focus(); form.bizName.select();
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
    form.from.value = d.theme.from; form.to.value = d.theme.to; form.ink.value = d.theme.ink || '#ffffff'; form.face.value = d.theme.face || '#1e1a17';
    form.googleReviewUrl.value = d.googleReviewUrl || '';
    form.wa0.value = d.whatsapp[0] || ''; form.wa1.value = d.whatsapp[1] || '';
    form.webhookUrl.value = d.webhookUrl || '';
    SOCIAL_KEYS.forEach((k) => (form[`social_${k}`].value = d.social[k] || ''));
    renderLogo(); renderThreshold(); renderSwatches();
  }

  form.addEventListener('input', (e) => {
    const n = e.target.name;
    if (!n || !draft) return;
    const v = e.target.value;
    if (n === 'bizName') {
      const auto = !draft.slug || draft.slug === RC.slugify(draft.name) || /^new-business(-\d+)?$/.test(draft.slug);
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

  // Logo upload (click or drag & drop)
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

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!draft.name.trim()) return toast('Add a business name');
    if (!draft.slug) return toast('Add a page link');
    if (list.some((b) => b.slug === draft.slug && b.id !== draft.id)) return toast('That page link is already used');
    draft.updatedAt = new Date().toISOString();
    list = list.map((b) => (b.id === draft.id ? structuredClone(draft) : b));
    if (!RC.saveList(list)) return toast('Browser storage is full. Try a smaller logo.');
    dirty = false;
    $('saveStatus').textContent = 'Saved · remember to publish';
    renderList();
    toast('Saved');
  });

  $('deleteBiz').addEventListener('click', () => {
    if (!confirm(`Delete "${draft.name}"? Printed QR codes for it will stop working once you publish.`)) return;
    list = list.filter((b) => b.id !== draft.id);
    RC.saveList(list);
    dirty = false; currentId = null; draft = null;
    if (list[0]) select(list[0].id); else renderList();
  });

  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- Preview + QR ----------
  let qrTimer;
  function refresh() {
    if (!draft) return;
    sendPreview();
    const url = RC.reviewUrl(draft);
    $('pageUrl').value = url;
    $('openPage').href = url + '&draft=1';
    const t = draft.theme;
    $('tableCard').style.background = `linear-gradient(160deg, ${t.from}, ${t.to})`;
    $('tableCard').style.color = t.ink;
    $('tcHead').innerHTML = (draft.logo ? `<img src="${draft.logo}" alt="">` : `<span class="ini">${RC.esc(RC.initials(draft.name))}</span>`) + `<span>${RC.esc(draft.name)}</span>`;
    renderDelivery();
    clearTimeout(qrTimer);
    qrTimer = setTimeout(renderQR, 200);
  }

  function sendPreview() {
    const f = $('preview');
    if (previewReady) f.contentWindow.postMessage({ type: 'rc-preview', business: draft }, location.origin);
  }
  window.addEventListener('message', (e) => {
    if (e.origin === location.origin && e.data?.type === 'rc-preview-ready') { previewReady = true; sendPreview(); }
  });

  let qr = null;
  function renderQR() {
    if (typeof QRCodeStyling === 'undefined') { $('qr').textContent = 'QR library failed to load (check your connection).'; return; }
    const dark = mix(draft.theme.to, '#000000', 0.35);
    const opts = {
      width: 600, height: 600, type: 'canvas', margin: 0,
      data: RC.reviewUrl(draft),
      image: draft.logo || undefined,
      qrOptions: { errorCorrectionLevel: draft.logo ? 'H' : 'M' },
      dotsOptions: { type: 'rounded', color: dark },
      cornersSquareOptions: { type: 'extra-rounded', color: draft.theme.to },
      cornersDotOptions: { type: 'dot', color: dark },
      backgroundOptions: { color: '#ffffff' },
      imageOptions: { margin: 8, imageSize: 0.34, hideBackgroundDots: true, crossOrigin: 'anonymous' },
    };
    qr = new QRCodeStyling(opts);
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
      n.textContent = `Without a webhook, the guest's WhatsApp opens a chat to ${wa[0]} with their message (photos can't be attached this way). Add a webhook to reach both contacts automatically, with photos.`;
    } else {
      n.className = 'note';
      n.textContent = 'Add a WhatsApp contact or a webhook. Otherwise low ratings are only saved on the guest\'s phone.';
    }
  }

  // ---------- Inbox ----------
  function seedDemoFeedback() {
    if (RC.read('rc.demoSeeded', false) || RC.listFeedback().length || !list[0]) return;
    const slug = list[0].slug;
    const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    [
      { rating: 2, route: 'private', text: 'Waited 40 minutes for our mains and the biryani arrived lukewarm. Staff were friendly though.', guestName: 'Sara', guestPhone: '+966 55 000 0000', createdAt: ago(3) },
      { rating: 5, route: 'google', text: 'Best karak in Jeddah! Lovely staff.', createdAt: ago(7) },
      { rating: 1, route: 'private', text: 'Found a hair in the dessert. Not happy.', guestName: '', guestPhone: '', createdAt: ago(26), status: 'resolved' },
      { rating: 4, route: 'google', text: 'Great food, a bit loud on Friday night.', createdAt: ago(30) },
    ].forEach((f) => RC.addFeedback({ id: RC.uid(), slug, status: 'new', demo: true, images: [], ...f }));
    RC.write('rc.demoSeeded', true);
  }

  function renderInbox() {
    const all = RC.listFeedback();
    const fb = $('fBiz');
    const cur = fb.value || 'all';
    fb.innerHTML = `<option value="all">All businesses</option>` + list.map((b) => `<option value="${RC.esc(b.slug)}">${RC.esc(b.name)}</option>`).join('');
    fb.value = list.some((b) => b.slug === cur) ? cur : 'all';

    const scoped = all.filter((f) => fb.value === 'all' || f.slug === fb.value);
    const priv = scoped.filter((f) => f.route === 'private');
    const avg = scoped.length ? (scoped.reduce((s, f) => s + f.rating, 0) / scoped.length).toFixed(1) : '–';
    $('stats').innerHTML = [
      [scoped.length, 'Total ratings'],
      [scoped.length - priv.length, 'Sent to Google'],
      [priv.filter((f) => f.status !== 'resolved').length, 'Open private feedback'],
      [avg, 'Average rating'],
    ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

    const shown = $('fRoute').value === 'all' ? scoped : priv;
    const name = (slug) => list.find((b) => b.slug === slug)?.name || slug;
    $('feed').innerHTML = shown.length ? shown.map((f) => `
      <article class="fb ${f.status === 'resolved' ? 'resolved' : ''}">
        <div class="fb-top">
          <span class="dots" aria-label="${f.rating} out of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= f.rating ? 'on' : ''}"></i>`).join('')}</span>
          <b>${RC.esc(name(f.slug))}</b>
          <span class="tag ${f.route === 'private' ? 'priv' : 'pub'}">${f.route === 'private' ? 'Private' : 'Google'}</span>
          ${f.status === 'resolved' ? '<span class="tag">Resolved</span>' : ''}
          ${f.demo ? '<span class="tag demo">Demo</span>' : ''}
          <time>${new Date(f.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time>
        </div>
        ${f.text ? `<p>${RC.esc(f.text)}</p>` : '<p class="muted">No comment</p>'}
        ${f.images?.length ? `<div class="fb-imgs">${f.images.map((s) => `<img src="${s}" alt="Guest photo">`).join('')}</div>` : ''}
        ${f.route === 'private' ? `<div class="fb-foot">
          <span class="who">${RC.esc(f.guestName || 'Anonymous')}${f.guestPhone ? ' · ' + RC.esc(f.guestPhone) : ''}</span>
          ${f.guestPhone ? `<a class="btn" target="_blank" rel="noopener" href="${RC.waLink(f.guestPhone, `Hi ${f.guestName || ''}, this is ${name(f.slug)}. Thank you for your feedback, we're sorry about your visit.`)}">Reply on WhatsApp</a>` : ''}
          <button class="btn" data-toggle="${f.id}">${f.status === 'resolved' ? 'Reopen' : 'Mark resolved'}</button>
        </div>` : ''}
      </article>`).join('')
      : `<div class="card empty"><h2>Nothing here yet</h2><p class="muted">Private feedback will appear here.</p></div>`;

    const open = all.filter((f) => f.route === 'private' && f.status !== 'resolved').length;
    $('inboxCount').hidden = !open; $('inboxCount').textContent = open;
  }
  $('fBiz').addEventListener('change', renderInbox);
  $('fRoute').addEventListener('change', renderInbox);
  $('feed').addEventListener('click', (e) => {
    const id = e.target.dataset?.toggle;
    if (id) {
      const f = RC.listFeedback().find((x) => x.id === id);
      RC.updateFeedback(id, { status: f.status === 'resolved' ? 'new' : 'resolved' });
      renderInbox();
    }
    if (e.target.matches('.fb-imgs img')) {
      const lb = document.createElement('div');
      lb.className = 'lightbox'; lb.innerHTML = `<img src="${e.target.src}" alt="">`;
      lb.onclick = () => lb.remove(); document.body.appendChild(lb);
    }
  });

  // ---------- Publish ----------
  $('savePublic').addEventListener('click', () => {
    let v = $('publicUrl').value.trim();
    if (v && !/^https?:\/\//.test(v)) v = 'https://' + v;
    RC.saveSettings({ ...RC.settings(), publicUrl: v });
    $('publicUrl').value = v;
    toast('Saved. QR codes now use this address');
    refresh();
  });
  $('exportJson').addEventListener('click', () => {
    if (dirty) toast('Note: you have unsaved changes that are not in this file');
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'businesses.json' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('importJson').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const arr = Array.isArray(data) ? data : data.businesses;
      if (!Array.isArray(arr)) throw new Error();
      if (!confirm(`Replace your ${list.length} business(es) with ${arr.length} from the file?`)) return;
      list = arr; RC.saveList(list); dirty = false; currentId = null;
      list[0] ? select(list[0].id) : renderList();
      toast('Imported');
    } catch { toast("That file isn't a valid businesses.json"); }
    e.target.value = '';
  });
  $('reloadPublished').addEventListener('click', async () => {
    const pub = await RC.fetchPublished();
    if (!confirm(`Replace what's in this browser with the ${pub.length} business(es) on the live site?`)) return;
    list = pub; RC.saveList(list); dirty = false; currentId = null;
    list[0] ? select(list[0].id) : renderList();
    toast('Reloaded from live site');
  });

  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  // ---------- Boot ----------
  (async () => {
    buildStaticControls();
    list = await RC.adminList();
    $('preview').src = 'review.html?preview=1';
    seedDemoFeedback();
    if (list[0]) select(list[0].id); else renderList();
    renderInbox();
    const v = location.hash.slice(1);
    if (['businesses', 'inbox', 'publish'].includes(v)) showView(v);
  })();
})();
