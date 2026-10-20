/* Review Finder — data layer.
 * Built for static hosting (GitHub Pages / Netlify):
 *  - Businesses are published in data/businesses.json. The admin edits a working copy in
 *    localStorage and exports a fresh businesses.json to commit to the repo.
 *  - Feedback is POSTed to each business's webhook (Make / Zapier / Netlify Function → WhatsApp + email)
 *    and also kept in localStorage on the device that submitted it (demo / inbox).
 */
const RC = (() => {
  const K = { biz: 'rc.businesses.v1', fb: 'rc.feedback.v1', settings: 'rc.settings.v1' };

  const read = (k, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; }
  };
  const write = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { console.warn('storage', e); return false; }
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

  const uid = () => Math.random().toString(36).slice(2, 10);
  const slugify = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  const newBusiness = () => ({
    id: uid(),
    slug: '',
    name: '',
    tagline: 'Your feedback helps us get better every day.',
    logo: '',
    theme: { preset: 'sunset', ...THEMES.sunset },
    threshold: 4,
    googleReviewUrl: '',
    whatsapp: ['', ''],
    webhookUrl: '',
    social: { instagram: '', tiktok: '', snapchat: '', facebook: '', x: '', website: '' },
    createdAt: new Date().toISOString(),
  });

  async function fetchPublished() {
    try {
      const r = await fetch('data/businesses.json', { cache: 'no-store' });
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : (j.businesses || []);
    } catch { return []; }
  }

  // Admin working copy: seeded from the published file the first time.
  async function adminList() {
    let list = read(K.biz, null);
    if (!list) { list = await fetchPublished(); write(K.biz, list); }
    return list;
  }
  const saveList = (list) => write(K.biz, list);

  // Guest page: the published version wins. With draft=true (admin "Open page"), this browser's
  // unpublished copy wins. A business that only exists locally is still shown so it can be tested.
  async function getBusiness(slug, draft = false) {
    const local = (read(K.biz, []) || []).find((b) => b.slug === slug);
    if (draft && local) return local;
    return (await fetchPublished()).find((b) => b.slug === slug) || local || null;
  }

  function googleLink(b) {
    const v = (b.googleReviewUrl || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    // A bare Google Place ID
    return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(v)}`;
  }

  const settings = () => ({ publicUrl: '', ...read(K.settings, {}) });
  const saveSettings = (s) => write(K.settings, s);

  // Reduce any pasted address (e.g. ".../review.html?b=x" or ".../admin.html#publish") to the site folder.
  function siteBase(raw) {
    let v = (raw || '').trim();
    if (!v) v = location.href;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try {
      const u = new URL(v);
      let path = u.pathname;
      const i = path.search(/\/[^/]*\.html?(\/|$)/i); // cut at the first *.html segment
      if (i !== -1) path = path.slice(0, i);
      if (!path.endsWith('/')) path += '/';
      return u.origin + path;
    } catch { return ''; }
  }

  function reviewUrl(b) {
    return `${siteBase(settings().publicUrl)}review.html?b=${encodeURIComponent(b.slug)}`;
  }

  // Feedback
  const listFeedback = () => read(K.fb, []);
  function addFeedback(item) {
    const list = listFeedback();
    list.unshift(item);
    if (!write(K.fb, list)) {
      // Storage full: keep the message, drop the photos.
      list[0] = { ...item, images: [], imagesDropped: item.images?.length || 0 };
      write(K.fb, list.slice(0, 200));
    }
  }
  function updateFeedback(id, patch) {
    write(K.fb, listFeedback().map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  async function deliver(b, item) {
    if (!b.webhookUrl) return { ok: false, reason: 'no-webhook' };
    try {
      const r = await fetch(b.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, business: { slug: b.slug, name: b.name }, notify: b.whatsapp.filter(Boolean) }),
      });
      return { ok: r.ok, status: r.status };
    } catch (e) { return { ok: false, reason: String(e) }; }
  }

  const waLink = (phone, text) =>
    `https://wa.me/${(phone || '').replace(/[^\d]/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

  // Resize an image file to a data URL (keeps localStorage + webhook payloads small).
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
    THEMES, SOCIAL, uid, slugify, newBusiness, fetchPublished, adminList, saveList, getBusiness,
    googleLink, siteBase, reviewUrl, settings, saveSettings, listFeedback, addFeedback, updateFeedback,
    deliver, waLink, resizeImage, initials, esc, read, write, K,
  };
})();
