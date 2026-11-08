/* Visit tracker -> POST /api/seen (views/landing_api.py -> "Visits" sheet).
   One row per page view: a "view" event once the page has really been seen,
   then "update" events with engagement whenever the tab is hidden or closed.
   Disclosed in the footer privacy note. No cookies; a random visitor ID in localStorage.
   Per-recipient links: share advitiaum.com/?r=<who> and the row shows <who>. */
(function () {
  'use strict';
  var nav = window.navigator || {};
  // Automation and obvious bots never report (the server filters again).
  if (nav.webdriver || /bot|crawl|spider|headless|lighthouse|preview/i.test(nav.userAgent || '')) {
    window.__adv = { vid: '', ref: '', mark: function () {} };
    return;
  }

  function rid(n) {
    var a = new Uint8Array(n), s = '', c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    for (var i = 0; i < n; i++) s += c[a[i] % c.length];
    return s;
  }
  function store(kind) { try { var s = window[kind]; s.setItem('__t', '1'); s.removeItem('__t'); return s; } catch (e) { return null; } }
  var ls = store('localStorage'), ss = store('sessionStorage');
  function get(s, k) { return s ? s.getItem(k) || '' : ''; }
  function put(s, k, v) { if (s) try { s.setItem(k, v); } catch (e) { /* quota */ } }

  var q = new URLSearchParams(location.search);
  var clean = function (v) { return (v || '').replace(/[^\w.@+-]/g, '').slice(0, 80); };
  var ref = clean(q.get('r') || q.get('ref')) || get(ss, 'adv_ref');
  if (ref) put(ss, 'adv_ref', ref);
  var firstRef = get(ls, 'adv_first_ref');
  if (!firstRef && ref) { firstRef = ref; put(ls, 'adv_first_ref', ref); }

  var vid = get(ls, 'adv_vid');
  if (!vid) { vid = rid(16); put(ls, 'adv_vid', vid); }
  var n = +get(ls, 'adv_n') || 0;
  if (!get(ss, 'adv_counted')) { n += 1; put(ls, 'adv_n', String(n)); put(ss, 'adv_counted', '1'); }

  var visitId = rid(20), sentView = false;
  var active = 0, since = document.visibilityState === 'visible' ? Date.now() : 0;
  var maxScroll = 0, sections = [], clicks = [], arm = '', formState = '';

  function engaged() { return Math.round((active + (since ? Date.now() - since : 0)) / 1000); }
  function base(event) {
    var conn = nav.connection || {};
    return {
      event: event, visit_id: visitId, vid: vid, n: String(n), ref: ref, first_ref: firstRef,
      utm_source: q.get('utm_source') || '', utm_medium: q.get('utm_medium') || '', utm_campaign: q.get('utm_campaign') || '',
      referrer: document.referrer || '', path: location.pathname + location.search,
      screen: screen.width + 'x' + screen.height, viewport: innerWidth + 'x' + innerHeight, dpr: String(window.devicePixelRatio || 1),
      lang: nav.language || '', tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '', conn: conn.effectiveType || '',
      duration: String(engaged()), scroll: String(maxScroll), sections: sections.join(' > '), clicks: clicks.join(' | '),
      arm: arm, form: formState
    };
  }
  function send(event) {
    var body = JSON.stringify(base(event));
    try {
      if (nav.sendBeacon && nav.sendBeacon('/api/seen', new Blob([body], { type: 'application/json' }))) return;
    } catch (e) { /* fall through */ }
    try { fetch('/api/seen', { method: 'POST', body: body, keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }); } catch (e) { /* offline */ }
  }

  // "view" only after 1.5 s of the page actually being visible (skips prerender / background tabs).
  var viewTimer = null;
  function armView() {
    if (sentView || viewTimer || document.visibilityState !== 'visible') return;
    viewTimer = setTimeout(function () { viewTimer = null; if (document.visibilityState === 'visible') { sentView = true; send('view'); } }, 1500);
  }
  var lastUpdate = 0;
  function flush() {
    if (!sentView) return;
    var now = Date.now(); if (now - lastUpdate < 800) return; lastUpdate = now;
    send('update');
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { since = Date.now(); armView(); }
    else { if (since) { active += Date.now() - since; since = 0; } clearTimeout(viewTimer); viewTimer = null; flush(); }
  });
  addEventListener('pagehide', function () { if (since) { active += Date.now() - since; since = 0; } lastUpdate = 0; flush(); });
  armView();

  // Engagement signals.
  addEventListener('scroll', function () {
    var h = document.documentElement, max = h.scrollHeight - innerHeight;
    var p = max > 0 ? Math.round(Math.min(1, scrollY / max) * 100) : 100;
    if (p > maxScroll) maxScroll = p;
  }, { passive: true });
  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting && sections.indexOf(e.target.id) < 0) sections.push(e.target.id);
      });
    }, { threshold: 0.35 });
    document.querySelectorAll('main > section[id]').forEach(function (s) { io.observe(s); });
  }
  function mark(label) {
    label = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (label && clicks.length < 25 && clicks[clicks.length - 1] !== label) clicks.push(label);
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('a, button');
    if (!el) return;
    if (el.classList.contains('arm')) { arm = /household/i.test(el.textContent) ? 'household' : 'legacy'; mark('Platform: ' + arm); return; }
    var href = el.getAttribute('href') || '';
    if (href.indexOf('mailto:') === 0) mark('Email link');
    else if (el.matches('.btn, .btn-nav, .pill-link, .nav-link, .foot-col a')) mark(el.textContent);
  }, true);

  window.__adv = {
    vid: vid, ref: ref || firstRef, visitId: visitId,
    mark: mark,
    form: function (state) { formState = state; mark('Form ' + state); if (state === 'sent') { lastUpdate = 0; flush(); } }
  };
})();
