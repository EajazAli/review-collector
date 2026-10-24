(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const isPreview = params.has('preview');

  const t = (k, v) => I18N.t(k, v);
  const mood = (r) => t(`r.mood.${r}`);
  const starsText = (n) => (n === 1 ? t('r.stars.1') : n === 2 ? t('r.stars.2') : t('r.stars.n', { n: I18N.fmtNum(n) }));
  // Face keyframes per rating (0 = not rated yet)
  // mouth: x1 y1 cx cy x2 y2 | eyeRy | brow: lx1 ly1 lx2 ly2 | browOpacity | cheekOpacity
  const FACES = [
    { m: [72, 110, 100, 108, 128, 104], ry: 13, b: [44, 34, 80, 34], bo: 0, c: 0 },
    { m: [70, 120, 100, 82, 130, 120], ry: 12, b: [42, 42, 80, 24], bo: 1, c: 0 },
    { m: [72, 114, 100, 100, 128, 112], ry: 12, b: [44, 38, 80, 30], bo: .9, c: 0 },
    { m: [72, 110, 100, 108, 128, 104], ry: 12.5, b: [44, 34, 80, 34], bo: 0, c: 0 },
    { m: [70, 104, 100, 124, 130, 104], ry: 12, b: [44, 30, 80, 30], bo: 0, c: .35 },
    { m: [62, 96, 100, 140, 138, 96], ry: 8, b: [44, 26, 80, 24], bo: 0, c: .6 },
  ];

  let biz = null;
  // Quick-pick issues for low ratings (keys are stored; labels come from the language file).
  const ISSUES = [
    { key: 'food', icon: '🍽️' },
    { key: 'service', icon: '⏱️' },
    { key: 'staff', icon: '🙋' },
    { key: 'clean', icon: '🧹' },
    { key: 'value', icon: '💸' },
  ];
  const picked = new Set();
  const I18N_LABEL = {
    en: { food: 'Food quality', service: 'Slow service', staff: 'Staff attitude', clean: 'Cleanliness', value: 'Poor value for money' },
    ar: { food: 'جودة الطعام', service: 'بطء الخدمة', staff: 'تعامل الموظفين', clean: 'النظافة', value: 'لا يستحق السعر' },
  };
  let rating = 0;
  let photos = [];
  // Before a star is chosen the face switches between happy and curious.
  // br = right brow (otherwise mirrored from the left), tilt = head tilt in degrees.
  const IDLE = [
    { m: [66, 100, 100, 132, 134, 100], ry: 11, b: [44, 30, 80, 30], bo: 0, c: .4, tilt: 3 },                            // happy
    { m: [86, 112, 102, 106, 118, 112], ry: 14, b: [42, 22, 80, 18], br: [158, 38, 120, 38], bo: 1, c: 0, tilt: -7 },  // curious
  ];
  const mirror = (b) => [200 - b[0], b[1], 200 - b[2], b[3]];
  const norm = (f) => ({ ...f, br: f.br || mirror(f.b), tilt: f.tilt || 0 });
  let face = norm(IDLE[0]);
  let idleTimer = 0, idleStep = 0;
  function startIdle() {
    if (idleTimer) return;
    idleStep = 0;
    morphFace(IDLE[0], true);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    idleTimer = setInterval(() => { idleStep ^= 1; morphFace(IDLE[idleStep], true, 560); }, 2300);
  }
  function stopIdle() { clearInterval(idleTimer); idleTimer = 0; }
  let anim = 0;
  let doneKind = null;     // which thank-you screen is showing (re-rendered on language change)
  let sheetCopied = null;  // state of the Google steps sheet

  // ---------- Theme & content ----------
  function applyBusiness(b) {
    biz = b;
    const th = b.theme || RC.THEMES.sunset;
    const root = document.documentElement.style;
    root.setProperty('--from', th.from); root.setProperty('--to', th.to);
    root.setProperty('--ink', th.ink || '#fff'); root.setProperty('--face', th.face || '#1E1A17');
    document.querySelector('meta[name=theme-color]').content = th.to;
    $('logo').innerHTML = b.logo ? `<img src="${RC.esc(b.logo)}" alt="">` : RC.esc(RC.initials(b.name));
    renderText();
  }

  // Keep the headline on one line: step the font down to 16px, then allow wrapping as a last resort.
  function fitHeadline() {
    const h = $('headline');
    h.classList.remove('wrap');
    h.style.fontSize = '';
    if (!h.clientWidth) return;
    let size = parseFloat(getComputedStyle(h).fontSize);
    while (h.scrollWidth > h.clientWidth && size > 16) { size -= 1; h.style.fontSize = size + 'px'; }
    if (h.scrollWidth > h.clientWidth) h.classList.add('wrap');
  }
  // Re-fit whenever the screen appears or changes size (it is measured as 0 while hidden).
  new ResizeObserver(() => { if (biz) fitHeadline(); }).observe($('rate'));
  document.fonts?.ready.then(() => { if (biz) fitHeadline(); });

  // Business name and subtitle in the guest's language (Arabic versions are optional per business).
  const bizName = () => RC.localName(biz, I18N.lang) || t('r.thisPlace');
  function renderText() {
    if (!biz) return;
    const name = RC.localName(biz, I18N.lang);
    document.title = name ? t('r.docTitle', { name }) : t('r.docTitleDefault');
    $('bizName').textContent = name;
    // Owner's own headline if set, otherwise the personalised default.
    $('headline').textContent = RC.localTagline(biz, I18N.lang) || t('r.headline');
    fitHeadline();
    renderDots();
    renderChips();
    renderSocials();
    renderThumbs();
    setRating(rating, false);
    if (doneKind) showDone(doneKind);
    if (!$('sheet').hidden) renderSheet();
    $('choiceMgmtTitle').textContent = t('r.choice.mgmt', { name: bizName() });
  }

  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="star" d="M12 2.8l2.75 5.6 6.15.9-4.45 4.35 1.05 6.15L12 16.9l-5.5 2.9 1.05-6.15L3.1 9.3l6.15-.9z"/></svg>'
    + '<span class="burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';

  function renderDots() {
    const wrap = $('rating');
    wrap.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dot';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-label', t('r.dotAria', { n: I18N.fmtNum(i), mood: mood(i) }));
      btn.style.setProperty('--i', i - 1);
      btn.innerHTML = STAR;
      btn.addEventListener('click', () => setRating(i));
      wrap.appendChild(btn);
    }
  }
  function renderChips() {
    $('chips').innerHTML = ISSUES.map((it) =>
      `<button type="button" class="chip${picked.has(it.key) ? ' on' : ''}" data-key="${it.key}" aria-pressed="${picked.has(it.key)}">`
      + `<span class="chip-ic" aria-hidden="true">${it.icon}</span><span>${t(`r.issue.${it.key}`)}</span>`
      + '<svg class="chip-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>').join('');
  }
  $('chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const k = chip.dataset.key;
    picked.has(k) ? picked.delete(k) : picked.add(k);
    chip.classList.toggle('on', picked.has(k));
    chip.setAttribute('aria-pressed', String(picked.has(k)));
    chip.classList.remove('pop'); void chip.offsetWidth; chip.classList.add('pop');
    updateTextPrompt();
  });
  // After a low rating, glide the page so every issue sits above the floating Send button.
  function revealIssues() {
    requestAnimationFrame(() => {
      const box = $('issuesBox').getBoundingClientRect();
      const limit = $('cta').getBoundingClientRect().top - 16;
      if (box.bottom > limit) {
        const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
        scrollBy({ top: box.bottom - limit, behavior: smooth ? 'smooth' : 'auto' });
      }
    });
  }

  // With an issue picked, typing becomes optional.
  function updateTextPrompt() {
    if (!rating || isPublic()) return;
    const optional = picked.size > 0;
    $('textLabel').textContent = t(optional ? 'r.text.labelBadOptional' : 'r.text.labelBad');
    $('text').placeholder = t(optional ? 'r.text.phBadOptional' : 'r.text.phBad');
  }

  // Stars run left to right in every language, so Right/Up = higher.
  $('rating').addEventListener('keydown', (e) => {
    const up = e.key === 'ArrowUp' || e.key === 'ArrowRight';
    const down = e.key === 'ArrowDown' || e.key === 'ArrowLeft';
    if (up) { setRating(Math.min(5, rating + 1)); e.preventDefault(); }
    if (down) { setRating(Math.max(1, rating - 1)); e.preventDefault(); }
    $('rating').querySelectorAll('.dot')[Math.max(0, rating - 1)]?.focus();
  });

  const isPublic = () => rating >= (biz?.threshold || 4);

  function setRating(r, animate = true) {
    rating = r;
    $('rating').classList.toggle('rated', r > 0);
    document.querySelectorAll('.dot').forEach((d, i) => {
      const on = i < r;
      d.classList.toggle('on', on);
      // Replay the micro-animations: filled stars pop in sequence, the chosen star sparkles.
      d.classList.remove('pop', 'burst-on');
      if (animate && on) { void d.offsetWidth; d.classList.add('pop'); if (i === r - 1) d.classList.add('burst-on'); }
      d.setAttribute('aria-checked', String(i === r - 1));
      d.tabIndex = (i === Math.max(0, r - 1)) ? 0 : -1;
    });
    const moodEl = $('mood');
    moodEl.textContent = mood(r);
    moodEl.classList.add('pop'); setTimeout(() => moodEl.classList.remove('pop'), 180);
    if (r) { stopIdle(); morphFace(FACES[r], animate); } else startIdle();

    const cta = $('cta');
    // Google's rules: every guest must be free to review on Google, whatever their rating.
    $('gAnyway').hidden = !r || isPublic() || !RC.googleLink(biz || {});
    if (!r) { cta.disabled = true; cta.textContent = t('r.submit'); $('details').hidden = true; return; }
    $('details').hidden = false;
    cta.disabled = false;
    if (isPublic()) {
      cta.className = 'cta google';
      cta.innerHTML = `<svg class="g" viewBox="0 0 48 48" aria-hidden="true">${document.querySelector('.g-logo svg').innerHTML}</svg>${t('r.postGoogle')}`;
      $('textLabel').textContent = t('r.text.labelGood');
      $('text').placeholder = t('r.text.phGood');
      $('privateFields').hidden = true;
      $('issuesBox').hidden = true;
    } else {
      cta.className = 'cta';
      cta.textContent = t('r.send');
      $('textLabel').textContent = t('r.text.labelBad');
      $('text').placeholder = t('r.text.phBad');
      $('privateFields').hidden = false;
      // Quick-pick issues are for restaurants / cafés only
      $('issuesBox').hidden = !RC.usesIssues(biz);
      if (!RC.usesIssues(biz)) picked.clear();
      updateTextPrompt();
      if (animate && RC.usesIssues(biz)) revealIssues();
    }
  }

  // ---------- Face animation ----------
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function drawFace(f) {
    const [x1, y1, cx, cy, x2, y2] = f.m;
    $('mouth').setAttribute('d', `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`);
    $('eyeL').setAttribute('ry', f.ry); $('eyeR').setAttribute('ry', f.ry);
    const [a, b, c, d] = f.b;
    const [e, g, h, k] = f.br;
    $('browL').setAttribute('d', `M${a} ${b} L${c} ${d}`);
    $('browR').setAttribute('d', `M${e} ${g} L${h} ${k}`);
    $('face').style.transform = `rotate(${f.tilt}deg)`;
    $('browL').style.opacity = $('browR').style.opacity = f.bo;
    $('cheekL').style.opacity = $('cheekR').style.opacity = f.c;
  }
  function morphFace(target, animate, duration = 380) {
    target = norm(target);
    cancelAnimationFrame(anim);
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { face = structuredClone(target); drawFace(face); return; }
    const from = structuredClone(face);
    const start = performance.now();
    const step = (now) => {
      const t = ease(Math.min(1, (now - start) / duration));
      face = {
        m: from.m.map((v, i) => lerp(v, target.m[i], t)),
        ry: lerp(from.ry, target.ry, t),
        b: from.b.map((v, i) => lerp(v, target.b[i], t)),
        br: from.br.map((v, i) => lerp(v, target.br[i], t)),
        tilt: lerp(from.tilt, target.tilt, t),
        bo: lerp(from.bo, target.bo, t),
        c: lerp(from.c, target.c, t),
      };
      drawFace(face);
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  // ---------- Photos ----------
  $('photos').addEventListener('change', async (e) => {
    const files = [...e.target.files].slice(0, 4 - photos.length);
    for (const f of files) {
      try { photos.push(await RC.resizeImage(f)); } catch { toast(t('r.toast.badImg')); }
    }
    if (e.target.files.length > files.length) toast(t('r.toast.max4'));
    e.target.value = '';
    renderThumbs();
  });
  function renderThumbs() {
    $('thumbs').innerHTML = photos.map((src, i) =>
      `<div class="thumb"><img src="${src}" alt="${t('r.photoAlt', { n: i + 1 })}"><button type="button" data-i="${i}" aria-label="${t('r.removePhoto')}">×</button></div>`).join('');
  }
  $('thumbs').addEventListener('click', (e) => {
    const i = e.target.dataset?.i;
    if (i !== undefined) { photos.splice(+i, 1); renderThumbs(); }
  });

  // ---------- Submit ----------
  $('cta').addEventListener('click', async () => {
    if (!rating || !biz) return;
    const text = $('text').value.trim();
    const item = { rating, route: isPublic() ? 'google' : 'private', text, lang: I18N.lang };

    if (isPublic()) { await openGoogle(item); return; }

    if (!text && !photos.length && !picked.size) { toast(t('r.toast.tellUs')); $('chips').querySelector('.chip')?.focus(); return; }
    Object.assign(item, { guestName: $('guestName').value.trim(), guestPhone: $('guestPhone').value.trim(), issues: [...picked] });
    if (isPreview) { toast(t('r.toast.preview')); return; }

    const cta = $('cta');
    cta.classList.add('busy'); cta.textContent = t('r.sending');
    const res = await RC.submitReview(biz, item, photos);
    await RC.deliver(biz, { ...res.review, slug: biz.slug, photos: photos.length ? photos : undefined });
    cta.classList.remove('busy'); cta.textContent = t('r.send');

    // Alert the owner on WhatsApp (text only; photos are in their dashboard).
    const owner = (biz.whatsapp || []).find(Boolean);
    if (!biz.webhookUrl && owner) {
      const who = [item.guestName, item.guestPhone].filter(Boolean).join(' · ');
      const msg = [
        `LOW RATING ${rating}/5 | تقييم منخفض ${rating}/5`,
        biz.name,
        '',
        picked.size ? 'Issues / المشكلات: ' + [...picked].map((k) => `${I18N_LABEL.en[k]} / ${I18N_LABEL.ar[k]}`).join(', ') : '',
        text || (picked.size ? '' : '(no comment / بدون تعليق)'),
        who ? `\nFrom / من: ${who}` : '',
        photos.length ? `\n${photos.length} photo(s) / صور: see your Review Finder dashboard / راجع لوحة Review Finder` : '',
        I18N.lang === 'ar' ? '\n(Guest used Arabic / الضيف استخدم العربية)' : '',
      ].filter((x) => x !== '').join('\n');
      const url = RC.waLink(owner, msg);
      $('waRetry').href = url;
      $('waRetry').hidden = false;
      showDone('private');
      location.href = url; // opens WhatsApp on phones
      return;
    }
    showDone('private');
  });

  // Copy the guest's text and show the "how to post on Google" steps. Records the rating once.
  async function openGoogle(item, record = true) {
    let copied = false;
    if (item.text) { try { await navigator.clipboard.writeText(item.text); copied = true; } catch { /* clipboard blocked */ } }
    sheetCopied = copied ? 'copied' : (item.text ? 'copyFirst' : 'writeFew');
    $('toGoogle').href = RC.googleLink(biz) || '#';
    renderSheet();
    $('sheet').hidden = false;
    if (record && !isPreview) {
      RC.submitReview(biz, { ...item, route: 'google', lang: I18N.lang }).then(({ review }) => RC.deliver(biz, { ...review, slug: biz.slug }));
    }
  }

  function renderSheet() {
    $('stepCopy').innerHTML = t(`r.sheet.${sheetCopied || 'writeFew'}`);
    $('stepStars').innerHTML = t('r.sheet.stars', { stars: RC.esc(starsText(rating || 5)) });
  }

  // Second layer for low ratings: Google is always an option, and so is the management.
  $('gAnyway').addEventListener('click', () => {
    $('choiceMgmtTitle').textContent = t('r.choice.mgmt', { name: bizName() });
    $('choice').hidden = false;
  });
  $('choiceGoogle').addEventListener('click', async () => {
    $('choice').hidden = true;
    await openGoogle({ rating, text: $('text').value.trim() });
  });
  $('choiceMgmt').addEventListener('click', () => {
    $('choice').hidden = true;
    $('text').focus();
    toast(t('r.toast.tellMgmt'));
  });
  $('choiceClose').addEventListener('click', () => { $('choice').hidden = true; });
  $('choice').addEventListener('click', (e) => { if (e.target === $('choice')) $('choice').hidden = true; });
  // After a private message, the guest can still post on Google.
  $('gAfter').addEventListener('click', () => openGoogle({ rating, text: $('text').value.trim() }, false));

  $('toGoogle').addEventListener('click', (e) => {
    if ($('toGoogle').getAttribute('href') === '#') { e.preventDefault(); toast(t('r.toast.noGoogle')); return; }
    setTimeout(() => { $('sheet').hidden = true; if ($('done').hidden) showDone('google'); }, 300);
  });
  $('sheetClose').addEventListener('click', () => { $('sheet').hidden = true; });
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) $('sheet').hidden = true; });
  $('skip').addEventListener('click', () => showDone('skip'));
  $('again').addEventListener('click', reset);

  function showDone(kind) {
    const wasShowing = doneKind;
    doneKind = kind;
    $('gAfter').hidden = kind !== 'private' || !RC.googleLink(biz);
    $('doneTitle').textContent = t(`r.done.${kind}.t`);
    $('doneText').textContent = t(`r.done.${kind}.x`, { name: bizName() });
    $('rate').hidden = true;
    $('done').hidden = false;
    if (!wasShowing) scrollTo(0, 0);
  }

  function reset() {
    photos = []; renderThumbs(); picked.clear(); renderChips(); $('waRetry').hidden = true;
    $('text').value = ''; $('guestName').value = ''; $('guestPhone').value = '';
    setRating(0, false);
    doneKind = null;
    $('done').hidden = true; $('rate').hidden = false;
  }

  const ICONS = {
    instagram: '<path d="M12 7.3A4.7 4.7 0 1 0 12 16.7 4.7 4.7 0 0 0 12 7.3zm0 7.7a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0zM12 3.6c2.7 0 3 0 4.1.1 2.7.1 4 1.4 4.1 4.1.1 1.1.1 1.4.1 4.1s0 3-.1 4.1c-.1 2.7-1.4 4-4.1 4.1-1.1.1-1.4.1-4.1.1s-3 0-4.1-.1c-2.7-.1-4-1.4-4.1-4.1C3.7 15 3.6 14.7 3.6 12s0-3 .1-4.1C3.8 5.1 5.1 3.8 7.9 3.7 9 3.6 9.3 3.6 12 3.6zM12 2C9.3 2 8.9 2 7.9 2.1 4.2 2.2 2.2 4.2 2.1 7.9 2 8.9 2 9.3 2 12s0 3.1.1 4.1c.1 3.6 2.2 5.7 5.8 5.8 1 .1 1.4.1 4.1.1s3.1 0 4.1-.1c3.6-.1 5.7-2.2 5.8-5.8.1-1 .1-1.4.1-4.1s0-3.1-.1-4.1C21.8 4.3 19.8 2.2 16.1 2.1 15.1 2 14.7 2 12 2z"/>',
    tiktok: '<path d="M16.6 3c.3 2.3 1.6 3.7 3.9 3.9v2.6c-1.3.1-2.5-.3-3.9-1.1v5.1c0 6.4-7 8.4-9.8 3.8-1.8-3 -.7-8.2 5.1-8.4v2.7c-.4.1-.9.2-1.3.3-1.3.4-2 1.3-1.8 2.7.4 2.8 5.5 3.6 5.1-1.8V3h2.7z"/>',
    snapchat: '<path d="M12 2.5c2.9 0 5 2.2 5 5.1v2.1c.6.1 1.3-.4 1.7 0 .5.5-.4 1.1-1.5 1.5.3 1.3 2 3.3 3.8 3.7.2.6-.9 1-2.2 1.2-.2.4-.1 1-.5 1.1-.7.2-1.6-.3-2.7.2-1.1.5-2 1.8-3.6 1.8s-2.5-1.3-3.6-1.8c-1.1-.5-2 0-2.7-.2-.4-.1-.3-.7-.5-1.1-1.3-.2-2.4-.6-2.2-1.2 1.8-.4 3.5-2.4 3.8-3.7-1.1-.4-2-1-1.5-1.5.4-.4 1.1.1 1.7 0V7.6c0-2.9 2.1-5.1 5-5.1z"/>',
    facebook: '<path d="M13.5 21v-8h2.7l.4-3.2h-3.1V7.8c0-.9.3-1.5 1.6-1.5h1.6V3.5c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1v2.3H7.6V13h2.7v8h3.2z"/>',
    x: '<path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L1.9 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z"/>',
    website: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.6 15.6 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8 8 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h2.9c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16zM8 8H5.1a8 8 0 0 1 4.3-3.6C8.8 5.5 8.3 6.7 8 8zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8 8 0 0 1 0 4h-3.4z"/>',
  };
  function renderSocials() {
    const links = Object.entries(biz.social || {}).filter(([, v]) => v && v.trim());
    $('socials').innerHTML = links.length
      ? `<span class="label">${t('r.followUs')}</span>` + links.map(([k, v]) =>
        `<a class="social" href="${RC.esc(RC.SOCIAL[k].url(v.trim()))}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>${t(`social.${k}`)}</a>`).join('')
      : '';
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  // ---------- Live preview from the admin dashboard ----------
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'rc-preview') return;
    const wasHidden = $('rate').hidden && $('done').hidden;
    applyBusiness(e.data.business);
    if (wasHidden) { $('missing').hidden = true; $('rate').hidden = false; }
    if (e.data.showDone) showDone('google');
  });

  // ---------- Language ----------
  window.addEventListener('langchange', renderText);
  // The dashboard's live preview follows the language chosen in the dashboard.
  window.addEventListener('storage', (e) => { if (e.key === 'rf.lang' && e.newValue) I18N.set(e.newValue, false); });

  // ---------- Boot ----------
  I18N.apply();
  renderDots();
  drawFace(face);
  (async () => {
    // Tolerate mangled links like "?b=test/review.html?b=test" from older QR codes.
    const slug = (params.get('b') || '').split(/[/?#&]/)[0].trim().toLowerCase();
    const b = slug ? await RC.getBusiness(slug) : null;
    if (b) { applyBusiness(b); $('rate').hidden = false; }
    else if (!isPreview) $('missing').hidden = false;
    if (isPreview) parent.postMessage({ type: 'rc-preview-ready' }, location.origin);
  })();
})();
