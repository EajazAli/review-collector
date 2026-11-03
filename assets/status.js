/* Review Finder — guest follow-up page (status.html?t=<secret>).
 * Shows the guest their own private feedback, where it is (received → being handled → resolved),
 * the management's reply, and asks "Did we fix it?". ?demo=1 shows a sample for sales demos.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const t = (k, v) => I18N.t(k, v);
  const esc = (s) => RC.esc(s);
  const params = new URLSearchParams(location.search);
  const ticket = params.get('t') || '';
  const demo = params.get('demo') === '1';
  let data = null;
  let error = '';
  let busy = false;

  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.75 5.6 6.15.9-4.45 4.35 1.05 6.15L12 16.9l-5.5 2.9 1.05-6.15L3.1 9.3l6.15-.9z"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const fmt = (d) => (d ? new Intl.DateTimeFormat(I18N.lang === 'ar' ? 'ar-SA' : 'en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(d)) : '');

  function sample() {
    const h = (n) => new Date(Date.now() - n * 36e5).toISOString();
    return {
      business: { slug: 'demo', name: 'Al Bahr Seafood', name_ar: 'مطعم البحر', logo: '', theme: RC.THEMES.sunset },
      rating: 2, issues: ['service', 'food'], text: 'We waited 40 minutes and the fish arrived cold.', lang: 'en',
      status: 'resolved', created_at: h(26), resolved_at: h(3), replied_at: h(20), guest_verdict: '',
      reply: 'Thank you for telling us, and we are truly sorry. Friday dinner was understaffed and that is on us. We have added two people to the evening shift. Please ask for Ahmed on your next visit, your meal is on us.',
    };
  }

  function applyTheme(b) {
    const th = (b.theme && b.theme.from) ? b.theme : RC.THEMES.sunset;
    const root = document.documentElement.style;
    root.setProperty('--from', th.from); root.setProperty('--to', th.to);
    root.setProperty('--ink', th.ink || '#fff'); root.setProperty('--face', th.face || '#1E1A17');
    document.querySelector('meta[name=theme-color]').content = th.to;
    $('logo').innerHTML = b.logo ? `<img src="${esc(b.logo)}" alt="">` : esc(RC.initials(b.name));
  }

  function render() {
    I18N.apply();
    if (error || !data) {
      document.title = t('s.docTitle');
      $('body').innerHTML = error ? `<div class="st-card st-center"><h1>${t(`s.err.${error}`)}</h1><p class="muted">${t(`s.err.${error}X`)}</p></div>` : `<p class="st-loading">${t('s.loading')}</p>`;
      return;
    }
    const b = data.business;
    const name = (I18N.lang === 'ar' && b.name_ar) || b.name;
    document.title = t('s.docTitleBiz', { name });
    $('bizName').textContent = name;

    const handled = data.status === 'resolved' || !!data.reply;
    const steps = [
      { key: 'received', done: true, at: data.created_at },
      { key: 'handling', done: handled, at: data.replied_at || (data.status === 'resolved' ? data.resolved_at : null) },
      { key: 'resolved', done: data.status === 'resolved', at: data.resolved_at },
    ];
    const current = steps.findIndex((s) => !s.done);
    const issues = (data.issues || []).filter((k) => RC.ISSUE_KEYS.includes(k));

    const timeline = `<ol class="st-steps">${steps.map((s, i) => `
      <li class="${s.done ? 'done' : ''} ${i === current ? 'now' : ''}">
        <span class="st-dot">${s.done ? CHECK : ''}</span>
        <span class="st-step"><b>${t(`s.step.${s.key}`)}</b>${s.done && s.at ? `<time>${fmt(s.at)}</time>` : (i === current ? `<small>${t(`s.step.${s.key}Wait`)}</small>` : '')}</span>
      </li>`).join('')}</ol>`;

    const yours = `<details class="st-yours"><summary>${t('s.yours')}</summary>
      <div class="st-stars" aria-label="${data.rating}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= data.rating ? 'on' : ''}">${STAR}</i>`).join('')}</div>
      ${issues.length ? `<div class="st-chips">${issues.map((k) => `<span>${t(`r.issue.${k}`)}</span>`).join('')}</div>` : ''}
      ${data.text ? `<p dir="auto">${esc(data.text)}</p>` : ''}
    </details>`;

    const reply = data.reply
      ? `<div class="st-reply"><span class="st-from">${t('s.replyFrom', { name: esc(name) })}<time>${fmt(data.replied_at)}</time></span><p dir="auto">${esc(data.reply)}</p></div>`
      : (data.status === 'resolved' ? '' : `<p class="st-wait">${t('s.noReply', { name: esc(name) })}</p>`);

    let verdict = '';
    if (handled) {
      if (data.guest_verdict) {
        const fixed = data.guest_verdict === 'fixed';
        verdict = `<div class="st-verdict answered"><b>${t(fixed ? 's.v.thanksFixed' : 's.v.thanksNot')}</b><p>${t(fixed ? 's.v.thanksFixedX' : 's.v.thanksNotX', { name: esc(name) })}</p>
          <button type="button" class="st-link" data-change>${t('s.v.change')}</button></div>`;
      } else {
        verdict = `<div class="st-verdict"><b>${t('s.v.q')}</b><div class="st-vbtns">
          <button type="button" data-v="fixed" ${busy ? 'disabled' : ''}><span aria-hidden="true">👍</span>${t('s.v.yes')}</button>
          <button type="button" data-v="not_fixed" ${busy ? 'disabled' : ''}><span aria-hidden="true">👎</span>${t('s.v.no')}</button></div></div>`;
      }
    }

    $('body').innerHTML = `${demo ? `<p class="st-demo">${t('s.demo')}</p>` : ''}
      <h1 class="st-title">${t(handled ? 's.titleHandled' : 's.title')}</h1>
      <div class="st-card">${timeline}</div>
      ${reply || verdict ? `<div class="st-card">${reply}${verdict}</div>` : ''}
      ${yours}
      <p class="st-keep">${t('s.keep')}</p>`;
  }

  $('body').addEventListener('click', async (e) => {
    if (e.target.closest('[data-change]')) { data.guest_verdict = ''; render(); return; }
    const btn = e.target.closest('[data-v]');
    if (!btn || busy) return;
    const v = btn.dataset.v;
    busy = true; render();
    try {
      if (!demo) await RC.rateTicket(ticket, v);
      data.guest_verdict = v;
    } catch { /* keep the question so they can try again */ }
    busy = false; render();
  });

  window.addEventListener('langchange', render);

  (async () => {
    if (demo) { data = sample(); }
    else if (ticket.length < 20) { error = 'link'; }
    else if (!RC.configured) { error = 'offline'; }
    else {
      try { data = await RC.getTicket(ticket); if (!data) error = 'link'; }
      catch { error = 'offline'; }
    }
    if (data) {
      applyTheme(data.business);
      // Show it in the language the guest wrote in, unless they picked one.
      let picked = null;
      try { picked = localStorage.getItem('rf.lang'); } catch { /* storage blocked */ }
      if (!params.get('lang') && !picked && data.lang === 'ar') I18N.set('ar');
    }
    render();
  })();
})();
