/* Review Finder — data layer.
 * Backend: Supabase (Postgres + Auth + Storage), configured in assets/config.js.
 *  - businesses: public read (the guest page needs them); clients edit their own; H&H admins manage all
 *  - reviews: guests insert anonymously; only that business's logins can read them
 *  - photos: private bucket, shown to owners via short-lived signed links
 * If Supabase isn't configured yet, the guest page falls back to data/businesses.json (read-only).
 */
const RC = (() => {
  const cfg = window.RF_CONFIG || {};
  const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const K = { settings: 'rc.settings.v1' };
  const read = (k, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; }
  };
  const write = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
  };

  const THEMES = {
    hh:       { label: 'H&H',      from: '#4C5CF0', to: '#000212', ink: '#FFFFFF', face: '#FFFFFF' },
    sunset:   { label: 'Sunset',   from: '#FFB23F', to: '#F2581E', ink: '#FFFFFF', face: '#1E1A17' },
    berry:    { label: 'Berry',    from: '#FF6FA5', to: '#B4236C', ink: '#FFFFFF', face: '#2A0F1E' },
    ocean:    { label: 'Ocean',    from: '#4FD1E8', to: '#2563EB', ink: '#FFFFFF', face: '#0B1B3A' },
    forest:   { label: 'Forest',   from: '#7ED98A', to: '#1F8A5B', ink: '#FFFFFF', face: '#0D2A1E' },
    grape:    { label: 'Grape',    from: '#B38CFF', to: '#5B2BD9', ink: '#FFFFFF', face: '#1C1036' },
    midnight: { label: 'Midnight', from: '#3A3F58', to: '#11131C', ink: '#FFFFFF', face: '#FFC86B' },
    sand:     { label: 'Sand',     from: '#FFF1D6', to: '#F5C98B', ink: '#3B2A12', face: '#3B2A12' },
  };
  // Business types; quick-pick issues are offered to restaurant / café guests only.
  const BUSINESS_TYPES = ['restaurant', 'hotel', 'salon', 'clinic', 'retail', 'other'];
  const ISSUE_KEYS = ['food', 'service', 'staff', 'clean', 'value'];
  const usesIssues = (b) => (b?.businessType || 'restaurant') === 'restaurant';
  const EMPTY_SOCIAL = { instagram: '', tiktok: '', snapchat: '', facebook: '', x: '', website: '' };

  const uid = () => Math.random().toString(36).slice(2, 10);
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    }));
  const slugify = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  const newBusiness = () => ({
    slug: '',
    name: '',
    tagline: '',
    nameAr: '',
    taglineAr: '',
    businessType: 'restaurant',
    logo: '',
    theme: { preset: 'sunset', ...THEMES.sunset },
    threshold: 4,
    googleReviewUrl: '',
    whatsapp: ['', ''],
    webhookUrl: '',
    social: { ...EMPTY_SOCIAL },
  });

  // ---------- Row mapping ----------
  const fromRow = (r) => ({
    id: r.id, slug: r.slug, name: r.name, tagline: r.tagline, nameAr: r.name_ar || '', taglineAr: r.tagline_ar || '', businessType: r.business_type || 'restaurant', logo: r.logo,
    theme: { ...THEMES.sunset, ...(r.theme || {}) }, threshold: r.threshold,
    googleReviewUrl: r.google_review_url, whatsapp: [...(r.whatsapp || []), '', ''].slice(0, 2),
    webhookUrl: r.webhook_url, social: { ...EMPTY_SOCIAL, ...(r.social || {}) },
    createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const toRow = (b) => ({
    slug: b.slug, name: b.name || '', tagline: b.tagline || '', name_ar: b.nameAr || '', tagline_ar: b.taglineAr || '', business_type: b.businessType || 'restaurant', logo: b.logo || '',
    theme: b.theme || {}, threshold: +b.threshold || 4,
    google_review_url: b.googleReviewUrl || '', whatsapp: (b.whatsapp || ['', '']).map((x) => (x || '').trim()),
    webhook_url: b.webhookUrl || '', social: b.social || {},
  });
  const fail = (error) => { if (error) throw new Error(error.message || String(error)); };

  // ---------- Auth ----------
  async function session() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session;
  }
  async function signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    fail(error);
  }
  async function signOut() { if (sb) await sb.auth.signOut(); }
  async function updatePassword(password) { const { error } = await sb.auth.updateUser({ password }); fail(error); }
  async function me() {
    const s = await session();
    if (!s) return null;
    const email = (s.user.email || '').toLowerCase();
    const { data } = await sb.from('admins').select('email').eq('email', email).maybeSingle();
    return { email, isAdmin: !!data };
  }

  // ---------- Businesses ----------
  async function fetchPublished() {
    try {
      const r = await fetch('data/businesses.json', { cache: 'no-store' });
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : (j.businesses || []);
    } catch { return []; }
  }

  // Businesses this login may manage (admins: all).
  async function listBusinesses(user) {
    let q = sb.from('businesses').select('*').order('created_at');
    if (!user.isAdmin) {
      const { data: m, error } = await sb.from('business_members').select('business_id').eq('email', user.email);
      fail(error);
      const ids = (m || []).map((x) => x.business_id);
      if (!ids.length) return [];
      q = q.in('id', ids);
    }
    const { data, error } = await q;
    fail(error);
    return data.map(fromRow);
  }

  // Public lookup for the guest page.
  async function getBusiness(slug) {
    if (sb) {
      const { data, error } = await sb.from('businesses').select('*').eq('slug', slug).maybeSingle();
      if (!error && data) return fromRow(data);
    }
    // Not in the database (yet): fall back to the old static file so printed QR codes keep working.
    return (await fetchPublished()).find((b) => b.slug === slug) || null;
  }

  async function uploadLogo(businessId, dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
    const path = `${businessId}/logo-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from('logos').upload(path, blob, { contentType: blob.type, upsert: true });
    fail(error);
    return sb.storage.from('logos').getPublicUrl(path).data.publicUrl;
  }

  // Retry without any column the database doesn't have yet (a supabase/00x_*.sql update not run).
  async function withMissingColumns(row, run) {
    let res = await run(row);
    for (let tries = 0; tries < 4 && (res.error?.code === 'PGRST204' || res.error?.code === '42703'); tries++) {
      const col = /'(\w+)' column|column \w+\.(\w+)/.exec(res.error.message || '');
      const name = col && (col[1] || col[2]);
      if (!name || !(name in row)) break;
      const { [name]: _drop, ...rest } = row;
      row = rest;
      res = await run(row);
    }
    return res;
  }

  async function createBusiness(b) {
    const { data, error } = await withMissingColumns(toRow(b), (row) => sb.from('businesses').insert(row).select().single());
    fail(error);
    return fromRow(data);
  }

  async function saveBusiness(b) {
    if (b.logo && b.logo.startsWith('data:')) b = { ...b, logo: await uploadLogo(b.id, b.logo) };
    const { data, error } = await withMissingColumns(toRow(b), (row) => sb.from('businesses').update(row).eq('id', b.id).select().single());
    fail(error);
    return fromRow(data);
  }

  async function deleteBusiness(id) {
    const { error } = await sb.from('businesses').delete().eq('id', id);
    fail(error);
  }

  // Import (admin): upsert by slug, uploading any embedded logos.
  async function importBusinesses(list) {
    let n = 0;
    for (const raw of list) {
      if (!raw.slug) continue;
      const { data: existing } = await sb.from('businesses').select('id').eq('slug', raw.slug).maybeSingle();
      const id = existing?.id || (await createBusiness({ ...raw, logo: '' })).id;
      await saveBusiness({ ...raw, id });
      n++;
    }
    return n;
  }

  // ---------- Client logins (members) ----------
  async function listMembers(businessId) {
    const { data, error } = await sb.from('business_members').select('email').eq('business_id', businessId).order('email');
    fail(error);
    return data.map((r) => r.email);
  }
  async function setMembers(businessId, emails) {
    const clean = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const current = await listMembers(businessId);
    const add = clean.filter((e) => !current.includes(e));
    const del = current.filter((e) => !clean.includes(e));
    if (add.length) fail((await sb.from('business_members').insert(add.map((email) => ({ business_id: businessId, email })))).error);
    if (del.length) fail((await sb.from('business_members').delete().eq('business_id', businessId).in('email', del)).error);
    return clean;
  }

  // ---------- Reviews ----------
  async function submitReview(b, item, photos = []) {
    const review = {
      id: uuid(), business_id: b.id, rating: item.rating, route: item.route, text: item.text || '',
      guest_name: item.guestName || '', guest_phone: item.guestPhone || '', images: [], status: 'new',
      issues: (item.issues || []).filter((k) => ISSUE_KEYS.includes(k)),
    };
    const inDb = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.id || '');
    if (!sb || !inDb) return { ok: false, reason: 'not-in-database', review };
    for (let i = 0; i < photos.length; i++) {
      try {
        const blob = await (await fetch(photos[i])).blob();
        const path = `${b.id}/${review.id}-${i + 1}.jpg`;
        const { error } = await sb.storage.from('review-photos').upload(path, blob, { contentType: 'image/jpeg' });
        if (!error) review.images.push(path);
      } catch { /* keep going without this photo */ }
    }
    let { error } = await sb.from('reviews').insert(review);
    // Database not yet updated with supabase/003_issues.sql: keep the issues inside the text instead.
    if (error?.code === 'PGRST204' || error?.code === '42703') {
      const { issues, ...rest } = review;
      if (issues.length) rest.text = `[${issues.join(', ')}] ${rest.text}`.trim();
      ({ error } = await sb.from('reviews').insert(rest));
    }
    return { ok: !error, error: error?.message, review };
  }

  async function listReviews(businessIds) {
    if (!businessIds.length) return [];
    const { data, error } = await sb.from('reviews').select('*').in('business_id', businessIds)
      .order('created_at', { ascending: false }).limit(500);
    fail(error);
    return data;
  }
  async function updateReview(id, patch) {
    const { error } = await sb.from('reviews').update(patch).eq('id', id);
    fail(error);
  }
  async function photoUrls(paths) {
    if (!paths.length) return {};
    const { data, error } = await sb.storage.from('review-photos').createSignedUrls(paths, 3600);
    if (error) return {};
    return Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  }

  // Business text in the guest's language. Arabic falls back to the English name; the subtitle
  // falls back to a built-in default so an English line never appears on an Arabic page.
  const DEFAULT_TAGLINE_EN = 'Your feedback helps us get better every day.';
  const localName = (b, lang) => ((lang === 'ar' && b.nameAr) || b.name || '').trim();
  function localTagline(b, lang) {
    if (lang === 'ar') return (b.taglineAr || '').trim();
    const v = (b.tagline || '').trim();
    return v === DEFAULT_TAGLINE_EN ? '' : v;
  }

  // ---------- Links & helpers ----------
  function googleLink(b) {
    const v = (b.googleReviewUrl || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(v)}`; // bare Place ID
  }

  // Where an owner replies to Google reviews (signed in with the account that manages the profile).
  const GOOGLE_REPLY_URL = 'https://business.google.com/reviews';
  function placeId(b) {
    const v = (b.googleReviewUrl || '').trim();
    if (!v) return '';
    if (!/^https?:/i.test(v)) return v;
    try { return new URL(v).searchParams.get('placeid') || ''; } catch { return ''; }
  }
  // Public list of the business's Google reviews (needs a Place ID).
  const googleReviewsUrl = (b) => (placeId(b) ? `https://search.google.com/local/reviews?placeid=${encodeURIComponent(placeId(b))}` : '');

  const settings = () => ({ publicUrl: '', ...read(K.settings, {}) });
  const saveSettings = (s) => write(K.settings, s);

  // Reduce any pasted address (e.g. ".../review.html?b=x" or ".../admin.html#x") to the site folder.
  function siteBase(raw) {
    let v = (raw || '').trim();
    if (!v) v = location.href;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try {
      const u = new URL(v);
      let path = u.pathname;
      const i = path.search(/\/[^/]*\.html?(\/|$)/i);
      if (i !== -1) path = path.slice(0, i);
      if (!path.endsWith('/')) path += '/';
      return u.origin + path;
    } catch { return ''; }
  }
  const reviewUrl = (b) => `${siteBase(settings().publicUrl)}review.html?b=${encodeURIComponent(b.slug)}`;

  async function deliver(b, payload) {
    if (!b.webhookUrl) return { ok: false, reason: 'no-webhook' };
    try {
      const r = await fetch(b.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, business: { slug: b.slug, name: b.name }, notify: b.whatsapp.filter(Boolean) }),
      });
      return { ok: r.ok, status: r.status };
    } catch (e) { return { ok: false, reason: String(e) }; }
  }

  const waLink = (phone, text) =>
    `https://wa.me/${(phone || '').replace(/[^\d]/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

  function resizeImage(file, max = 1280, type = 'image/jpeg', quality = 0.75) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL(type, quality));
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SOCIAL = {
    instagram: { label: 'Instagram', url: (v) => /^https?:/.test(v) ? v : `https://instagram.com/${v.replace(/^@/, '')}` },
    tiktok:    { label: 'TikTok',    url: (v) => /^https?:/.test(v) ? v : `https://www.tiktok.com/@${v.replace(/^@/, '')}` },
    snapchat:  { label: 'Snapchat',  url: (v) => /^https?:/.test(v) ? v : `https://www.snapchat.com/add/${v.replace(/^@/, '')}` },
    facebook:  { label: 'Facebook',  url: (v) => /^https?:/.test(v) ? v : `https://facebook.com/${v}` },
    x:         { label: 'X',         url: (v) => /^https?:/.test(v) ? v : `https://x.com/${v.replace(/^@/, '')}` },
    website:   { label: 'Website',   url: (v) => /^https?:/.test(v) ? v : `https://${v}` },
  };

  return {
    configured, sb, BUSINESS_TYPES, ISSUE_KEYS, usesIssues, THEMES, SOCIAL, uid, uuid, slugify, newBusiness,
    session, signIn, signOut, updatePassword, me,
    fetchPublished, listBusinesses, getBusiness, createBusiness, saveBusiness, deleteBusiness, importBusinesses,
    listMembers, setMembers, submitReview, listReviews, updateReview, photoUrls,
    localName, localTagline, googleLink, GOOGLE_REPLY_URL, googleReviewsUrl, siteBase, reviewUrl, settings, saveSettings, deliver, waLink, resizeImage, initials, esc,
  };
})();
