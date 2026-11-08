/* White paper popup -> POST /api/wp (views/landing_api.py -> "White paper" sheet, full IP).
   Shows once per browser per paper version, after the page has been visible for a few seconds:
     read / download  -> never shown again for this version
     skip / close     -> shown again after SNOOZE_DAYS
   ?wp=1 always shows it (for testing or to point someone at it).
   Every /whitepaper link on the page gets the visitor's ID and ?r= tag, so the server's
   "Opened PDF" row can be matched to the visit. */
(function () {
  'use strict';
  var VERSION = '1.81', DELAY_MS = 4000, SNOOZE_DAYS = 14, KEY = 'adv_wp_' + VERSION;
  var dlg = document.getElementById('wp-dialog');
  var adv = window.__adv;
  if (!dlg || !adv || !adv.vid && !/[?&]wp=1\b/.test(location.search)) return;   // bots/automation: track.js disabled itself

  var nav = window.navigator || {}, q = new URLSearchParams(location.search), t0 = Date.now();
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) { /* private mode */ }
    return '';
  }
  function send(action) {
    var body = JSON.stringify({
      action: action, visit_id: adv.visitId || '', vid: adv.vid || '', ref: adv.ref || '',
      utm_source: q.get('utm_source') || '', utm_medium: q.get('utm_medium') || '', utm_campaign: q.get('utm_campaign') || '',
      referrer: document.referrer || '', path: location.pathname + location.search,
      screen: screen.width + 'x' + screen.height, lang: nav.language || '',
      tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '',
      seconds_on_page: String(Math.round((Date.now() - t0) / 1000))
    });
    try {
      if (nav.sendBeacon && nav.sendBeacon('/api/wp', new Blob([body], { type: 'application/json' }))) return;
    } catch (e) { /* fall through */ }
    try { fetch('/api/wp', { method: 'POST', body: body, keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }); } catch (e) { /* offline */ }
  }

  // Tag every white-paper link with who is opening it.
  document.querySelectorAll('a[href^="/whitepaper"]').forEach(function (a) {
    var u = new URL(a.getAttribute('href'), location.origin);
    if (adv.vid) u.searchParams.set('vid', adv.vid);
    if (adv.ref) u.searchParams.set('r', adv.ref);
    a.setAttribute('href', u.pathname + u.search);
  });

  var chosen = false;
  function close(action) {
    if (!chosen) { chosen = true; send(action); }
    if (action === 'read' || action === 'download') ls(KEY, 'done');
    else ls(KEY, 'snooze:' + (Date.now() + SNOOZE_DAYS * 864e5));
    if (adv.mark) adv.mark('White paper: ' + action);
    if (dlg.open) dlg.close();
  }
  dlg.addEventListener('click', function (e) {
    var b = e.target.closest('[data-wp]');
    if (b) { close(b.getAttribute('data-wp')); return; }       // links still open the PDF themselves
    if (e.target === dlg) close('dismiss');                      // click on the backdrop
  });
  dlg.addEventListener('cancel', function () { close('dismiss'); });   // Esc
  dlg.addEventListener('close', function () { if (!chosen) close('dismiss'); });   // the × button

  function due() {
    if (/[?&]wp=1\b/.test(location.search)) return true;
    var s = ls(KEY);
    if (s === 'done') return false;
    if (s.indexOf('snooze:') === 0 && Date.now() < +s.slice(7)) return false;
    return true;
  }
  function show() {
    if (dlg.open || !due() || document.visibilityState !== 'visible') return;
    // Don't interrupt someone typing in the contact form.
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { setTimeout(show, 5000); return; }
    chosen = false;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    send('shown');
  }
  var timer = setTimeout(show, DELAY_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !timer && !dlg.open && !chosen) timer = setTimeout(show, DELAY_MS);
    else if (document.visibilityState !== 'visible') { clearTimeout(timer); timer = null; }
  });
})();
