/* Review Finder — languages (English / Arabic).
 * Markup:  data-i18n="key" (text) · data-i18n-html="key" (trusted HTML) · data-i18n-ph="key" (placeholder)
 *          data-i18n-aria="key" (aria-label + title)
 * Script:  I18N.t('key', { name: 'X' })  → "Hello {name}" style substitution
 * Choice:  ?lang=ar|en in the URL  >  saved choice  >  phone/browser language  >  English
 */
const I18N = (() => {
  const KEY = 'rf.lang';
  const SUPPORTED = ['en', 'ar'];
  const dict = { en: {}, ar: {} };

  function fromUrl() {
    const v = new URLSearchParams(location.search).get('lang');
    return SUPPORTED.includes(v) ? v : null;
  }
  function saved() {
    try { const v = localStorage.getItem(KEY); return SUPPORTED.includes(v) ? v : null; } catch { return null; }
  }
  // First supported language in the device's preference list wins.
  function fromDevice() {
    const prefs = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
    for (const p of prefs) {
      const base = String(p).toLowerCase().split('-')[0];
      if (SUPPORTED.includes(base)) return base;
    }
    return 'en';
  }
  const detect = () => fromUrl() || saved() || fromDevice();

  let lang = detect();

  function add(more) {
    for (const l of SUPPORTED) Object.assign(dict[l], more[l] || {});
  }

  function t(key, vars) {
    let s = dict[lang][key] ?? dict.en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
    return s;
  }

  function apply(root = document) {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === 'ar' ? 'rtl' : 'ltr';
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const v = t(el.dataset.i18nAria); el.setAttribute('aria-label', v); el.title = v;
    });
    document.querySelectorAll('[data-lang-toggle]').forEach((b) => {
      b.textContent = lang === 'ar' ? 'English' : 'العربية';
      b.lang = lang === 'ar' ? 'en' : 'ar';
      b.setAttribute('aria-label', lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
    });
    if (dict[lang]['doc.title'] && document.body?.dataset.titleKey) document.title = t(document.body.dataset.titleKey);
  }

  function set(l, remember = true) {
    if (!SUPPORTED.includes(l) || l === lang) return;
    lang = l;
    if (remember) { try { localStorage.setItem(KEY, l); } catch { /* private mode */ } }
    apply();
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  // Any element with data-lang-toggle switches language on click.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang-toggle]');
    if (b) { e.preventDefault(); set(lang === 'ar' ? 'en' : 'ar'); }
  });

  const fmtNum = (n) => new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-US').format(n);
  const fmtDate = (d) => new Date(d).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  // Set lang/dir as early as possible to avoid a flash of the wrong direction.
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  return { add, t, apply, set, detect, fmtNum, fmtDate, get lang() { return lang; } };
})();

I18N.add({
  en: {
    'common.loading': 'Loading…',
  },
  ar: {
    'common.loading': 'جارٍ التحميل…',
  },
});
