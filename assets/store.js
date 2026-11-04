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
  // Quick-pick issues on low ratings, per type of business
  const ISSUES_BY_TYPE = {
    restaurant: ['food', 'service', 'staff', 'clean', 'value'],
    hotel: ['room', 'checkin', 'staff', 'clean', 'value'],
    clinic: ['wait', 'doctor', 'staff', 'clean', 'billing', 'booking'],
    salon: ['wait', 'result', 'staff', 'clean', 'value'],
    retail: ['wait', 'stock', 'staff', 'clean', 'value'],
    other: ['wait', 'staff', 'clean', 'value'],
  };
  const ISSUE_KEYS = [...new Set(Object.values(ISSUES_BY_TYPE).flat())];
  const ISSUE_ICON = { food: '🍽️', service: '⏱️', staff: '🙋', clean: '🧹', value: '💸', room: '🛏️', checkin: '🛎️', wait: '⏳', doctor: '🩺', billing: '🧾', booking: '📅', result: '✨', stock: '📦' };
  const issuesFor = (b) => ISSUES_BY_TYPE[b?.businessType] || ISSUES_BY_TYPE.restaurant;
  // Hotels also get Booking.com help (guests: how to review there; owners: reply in the Extranet).
  const usesBooking = (b) => b?.businessType === 'hotel';
  const BOOKING_TRIPS_URL = 'https://secure.booking.com/mytrips.html';
  const BOOKING_EXTRANET_URL = 'https://admin.booking.com/';
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
    id: r.id, slug: r.slug, name: r.name, tagline: r.tagline, nameAr: r.name_ar || '', taglineAr: r.tagline_ar || '', businessType: r.business_type || 'restaurant', bookingUrl: r.booking_url || '', logo: r.logo,
    theme: { ...THEMES.sunset, ...(r.theme || {}) }, threshold: r.threshold,
    googleReviewUrl: r.google_review_url, whatsapp: [...(r.whatsapp || []), '', ''].slice(0, 2),
    webhookUrl: r.webhook_url, social: { ...EMPTY_SOCIAL, ...(r.social || {}) },
    staff: r.staff || [],
    groupId: r.group_id || '', branchName: r.branch_name || '', branchNameAr: r.branch_name_ar || '',
    createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const toRow = (b) => ({
    slug: b.slug, name: b.name || '', tagline: b.tagline || '', name_ar: b.nameAr || '', tagline_ar: b.taglineAr || '', business_type: b.businessType || 'restaurant', booking_url: (b.bookingUrl || '').trim(), logo: b.logo || '',
    theme: b.theme || {}, threshold: +b.threshold || 4,
    google_review_url: b.googleReviewUrl || '', whatsapp: (b.whatsapp || ['', '']).map((x) => (x || '').trim()),
    webhook_url: b.webhookUrl || '', social: b.social || {},
    staff: (b.staff || []).map((x) => x.trim()).filter(Boolean).slice(0, 50),
    group_id: b.groupId || null, branch_name: (b.branchName || '').trim(), branch_name_ar: (b.branchNameAr || '').trim(),
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
      // Branches linked directly or through a group (supabase/008_groups.sql); older databases: direct links only.
      let ids;
      const r = await sb.rpc('my_business_ids');
      if (!r.error) ids = (r.data || []).map((x) => (typeof x === 'string' ? x : x.my_business_ids));
      else {
        const { data: m, error } = await sb.from('business_members').select('business_id').eq('email', user.email);
        fail(error);
        ids = (m || []).map((x) => x.business_id);
      }
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
    for (let tries = 0; tries < 8 && (res.error?.code === 'PGRST204' || res.error?.code === '42703'); tries++) {
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

  // ---------- Groups (brands with several branches; needs supabase/008_groups.sql) ----------
  async function listGroups() {
    if (!sb) return [];
    const { data, error } = await sb.from('business_groups').select('*').order('name');
    return error ? [] : data.map((g) => ({ id: g.id, name: g.name, nameAr: g.name_ar || '' }));
  }
  async function createGroup(name, nameAr = '') {
    const { data, error } = await sb.from('business_groups').insert({ name: name.trim(), name_ar: nameAr.trim() }).select().single();
    fail(error);
    return { id: data.id, name: data.name, nameAr: data.name_ar || '' };
  }
  async function listGroupMembers(groupId) {
    const { data, error } = await sb.from('group_members').select('email').eq('group_id', groupId).order('email');
    fail(error);
    return data.map((r) => r.email);
  }
  async function setGroupMembers(groupId, emails) {
    const clean = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const current = await listGroupMembers(groupId);
    const add = clean.filter((e) => !current.includes(e));
    const del = current.filter((e) => !clean.includes(e));
    if (add.length) fail((await sb.from('group_members').insert(add.map((email) => ({ group_id: groupId, email })))).error);
    if (del.length) fail((await sb.from('group_members').delete().eq('group_id', groupId).in('email', del)).error);
    return clean;
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
      lang: item.lang === 'ar' ? 'ar' : 'en',
      recommend: ['yes', 'maybe', 'no'].includes(item.recommend) ? item.recommend : '',
      shoutout: (item.shoutout || '').trim().slice(0, 60),
    };
    // Private feedback gets a secret link so the guest can follow it up (needs supabase/007_follow_up.sql).
    if (item.route === 'private') review.ticket = token();
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
    // Any column the database doesn't have yet is dropped; issues are then kept inside the text.
    let saved = review;
    let { error } = await withMissingColumns(review, (row) => {
      saved = row;
      if (!('issues' in row) && review.issues.length && !row.text.startsWith('[')) row = { ...row, text: `[${review.issues.join(', ')}] ${row.text}`.trim() };
      return sb.from('reviews').insert(row);
    });
    // Database not yet updated for the newer issue types: keep the feedback, with the issues in the text.
    if (error?.code === '23514' && review.issues.length) {
      ({ error } = await sb.from('reviews').insert({ ...saved, issues: [], text: `[${review.issues.join(', ')}] ${review.text}`.trim() }));
    }
    const ticket = !error && saved.ticket ? saved.ticket : null;
    return { ok: !error, error: error?.message, review, ticket };
  }

  async function listReviews(businessIds, { since = null, limit = 500 } = {}) {
    if (!businessIds.length) return [];
    let q = sb.from('reviews').select('*').in('business_id', businessIds);
    if (since) q = q.gte('created_at', since);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
    fail(error);
    return data;
  }

  function token() {
    const a = crypto.getRandomValues(new Uint8Array(18));
    return Array.from(a, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 28);
  }
  // Guest status page: read their own feedback by its secret link, and answer "Did we fix it?".
  async function getTicket(t) {
    const { data, error } = await sb.rpc('get_ticket', { t });
    fail(error);
    return data;
  }
  async function rateTicket(t, v) {
    const { data, error } = await sb.rpc('rate_ticket', { t, v });
    fail(error);
    return data;
  }

  // AI summaries and suggested replies (supabase/functions/ai-assist). Returns { text } or { error }.
  async function aiAssist(payload) {
    try {
      const { data, error } = await sb.functions.invoke('ai-assist', { body: payload });
      return error ? { error: 'off' } : data;
    } catch { return { error: 'off' }; }
  }

  // Anonymous averages per business type (needs supabase/006_cx_insights.sql; empty if not run yet).
  async function cxBenchmarks(since) {
    const { data, error } = await sb.rpc('cx_benchmarks', { since });
    return error ? [] : data || [];
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
  const groupName = (g, lang) => (g ? ((lang === 'ar' && g.nameAr) || g.name || '').trim() : '');
  const branchName = (b, lang) => ((lang === 'ar' && b.branchNameAr) || b.branchName || '').trim();
  // "Al Bahr Seafood · Tahlia Street" — the branch is added only when set and not already in the name.
  function displayName(b, lang) {
    const n = localName(b, lang), br = branchName(b, lang);
    return br && !n.includes(br) ? `${n} · ${br}` : n;
  }
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
  // QR codes: this browser's override (Settings) > the site-wide PUBLIC_URL in config.js > the current address.
  const reviewUrl = (b) => `${siteBase(settings().publicUrl || cfg.PUBLIC_URL)}review.html?b=${encodeURIComponent(b.slug)}`;

  const statusUrl = (ticket) => `${siteBase(settings().publicUrl || cfg.PUBLIC_URL)}status.html?t=${encodeURIComponent(ticket)}`;

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
    configured, sb, BUSINESS_TYPES, ISSUE_KEYS, ISSUE_ICON, issuesFor, usesBooking, BOOKING_TRIPS_URL, BOOKING_EXTRANET_URL, THEMES, SOCIAL, uid, uuid, slugify, newBusiness,
    session, signIn, signOut, updatePassword, me,
    fetchPublished, listBusinesses, getBusiness, createBusiness, saveBusiness, deleteBusiness, importBusinesses,
    listMembers, setMembers, submitReview, listReviews, cxBenchmarks, aiAssist, getTicket, rateTicket, updateReview, photoUrls,
    listGroups, createGroup, listGroupMembers, setGroupMembers,
    localName, groupName, branchName, displayName, localTagline, googleLink, GOOGLE_REPLY_URL, googleReviewsUrl, siteBase, reviewUrl, statusUrl, settings, saveSettings, deliver, waLink, resizeImage, initials, esc,
  };
})();
