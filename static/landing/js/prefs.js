/* Accessibility and language settings (the "Accessibility & language" button in the header).
   Loaded in <head> without defer so saved settings apply before the page paints (no flash).

   Settings, saved in this browser only (localStorage "adv_prefs"; nothing is sent to us):
     text      0 / 1 / 2   larger text             -> html.a11y-text-1 / a11y-text-2
     contrast  high contrast                       -> html.a11y-contrast
     still     stop animations                     -> html.a11y-still (hero scenes, CSS motion)
     links     underline links                     -> html.a11y-links
     spacing   wider letter, word and line spacing -> html.a11y-spacing (WCAG 1.4.12 values)
     font      plain sans-serif font               -> html.a11y-font

   Language: Google's translate widget, loaded ONLY after the visitor picks a language (CSP in
   views/landing.py allows Google's translate hosts). The choice is kept in Google's own
   "googtrans" cookie, so the next page opens translated too. English clears it and reloads. */
(function () {
  'use strict';
  var H = document.documentElement, KEY = 'adv_prefs';
  var FLAGS = ['contrast', 'still', 'links', 'spacing', 'font'];
  var LANGS = [
    ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'],
    ['nl', 'Nederlands'], ['ar', 'العربية'], ['hi', 'हिन्दी'], ['id', 'Bahasa Indonesia'], ['ja', '日本語'], ['ko', '한국어'],
    ['zh-CN', '中文（简体）'], ['tr', 'Türkçe'], ['ru', 'Русский'], ['sw', 'Kiswahili'],
  ];

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode: applies to this page only */ } }
  var prefs = load();

  function apply() {
    var t = +prefs.text || 0;
    H.classList.toggle('a11y-text-1', t === 1);
    H.classList.toggle('a11y-text-2', t === 2);
    FLAGS.forEach(function (f) { H.classList.toggle('a11y-' + f, !!prefs[f]); });
  }
  apply();

  // ---------------------------------------------------------------- language (Google Translate)
  function currentLang() {
    var m = /(?:^|;\s*)googtrans=\/[^/]*\/([^;]+)/.exec(document.cookie);
    return m ? decodeURIComponent(m[1]) : 'en';
  }
  function setCookie(v, days) {
    var exp = days < 0 ? '; expires=Thu, 01 Jan 1970 00:00:00 GMT' : '';
    var host = location.hostname, parts = host.split('.');
    document.cookie = 'googtrans=' + v + '; path=/' + exp + '; SameSite=Lax';
    if (parts.length > 1) document.cookie = 'googtrans=' + v + '; path=/; domain=.' + parts.slice(-2).join('.') + exp + '; SameSite=Lax';
  }
  var gtState = 0;   // 0 not loaded, 1 loading, 2 ready
  function loadGT() {
    if (gtState) return;
    gtState = 1;
    var slot = document.getElementById('gt-slot');
    if (!slot) { slot = document.createElement('div'); slot.id = 'gt-slot'; slot.className = 'gt-slot'; slot.setAttribute('aria-hidden', 'true'); document.body.appendChild(slot); }
    window.advGTInit = function () {
      try {
        new window.google.translate.TranslateElement({ pageLanguage: 'en', autoDisplay: false }, 'gt-slot');
        gtState = 2;
        pick(currentLang());
      } catch (e) { gtState = 0; status('Translation could not start. Please try again later.'); }
    };
    var s = document.createElement('script');
    s.src = 'https://translate.google.com/translate_a/element.js?cb=advGTInit';
    s.async = true;
    s.onerror = function () { gtState = 0; status('Translation is not available right now (it may be blocked on this network).'); };
    document.head.appendChild(s);
  }
  // Drive Google's hidden language dropdown; it appears a moment after the widget starts.
  function pick(lang, tries) {
    var combo = document.querySelector('#gt-slot select.goog-te-combo');
    if (!combo) { if ((tries || 0) < 40) setTimeout(function () { pick(lang, (tries || 0) + 1); }, 150); return; }
    if (combo.value !== lang) { combo.value = lang; combo.dispatchEvent(new Event('change')); }
    H.setAttribute('data-lang', lang);
  }
  function setLang(lang) {
    if (lang === 'en') {
      if (currentLang() === 'en' && !gtState) return;
      setCookie('', -1);
      location.reload();
      return;
    }
    setCookie('/en/' + lang, 365);
    if (gtState === 2) pick(lang); else loadGT();
    status('Translated by Google. Machine translation may contain errors; the English text is the authoritative version.');
  }

  // ---------------------------------------------------------------- panel
  var msgEl = null;
  function status(t) { if (msgEl) msgEl.textContent = t; }

  function replayHero() { if (window.__hero && window.__hero.play) window.__hero.play(window.__hero.index < 0 ? 0 : window.__hero.index); }

  function init() {
    if (currentLang() !== 'en') loadGT();          // the visitor chose a language on an earlier page
    var dlg = document.getElementById('prefs');
    if (!dlg) return;
    msgEl = dlg.querySelector('[data-prefs-msg]');
    var sel = dlg.querySelector('#prefs-lang');
    if (sel && !sel.options.length) {
      LANGS.forEach(function (l) { var o = document.createElement('option'); o.value = l[0]; o.textContent = l[1]; o.lang = l[0]; sel.appendChild(o); });
    }
    function sync() {
      dlg.querySelectorAll('input[name="prefs-text"]').forEach(function (r) { r.checked = +r.value === (+prefs.text || 0); });
      FLAGS.forEach(function (f) { var c = dlg.querySelector('[data-pref="' + f + '"]'); if (c) c.checked = !!prefs[f]; });
      if (sel) sel.value = currentLang();
      if (currentLang() !== 'en') status('Translated by Google. Machine translation may contain errors; the English text is the authoritative version.');
    }
    document.querySelectorAll('[data-prefs-open]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); sync(); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); });
    });
    dlg.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'prefs-text') { prefs.text = +t.value; save(prefs); apply(); replayHero(); return; }
      var f = t.getAttribute('data-pref');
      if (f) { prefs[f] = t.checked; save(prefs); apply(); if (f === 'still' || f === 'font' || f === 'spacing') replayHero(); return; }
      if (t.id === 'prefs-lang') setLang(t.value);
    });
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) { dlg.close(); return; }                          // backdrop
      if (e.target.closest('[data-prefs-reset]')) {
        prefs = {}; save(prefs); apply(); sync(); replayHero();
        status('Display settings reset.');
      }
    });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
