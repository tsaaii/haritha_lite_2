/* /peshi meeting invite builder. Plain JS, no framework: the form drives a live 720px card,
   which is exported to PNG in the browser (html-to-image). Nothing is sent to the server. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  var PRESET_GROUPS = [
    { name: 'SAC', items: ['COO, SAC', 'ED, SAC', 'JD, SAC', 'Chief Engineer, SAC'] },
    { name: 'Urban (SBM-U)', items: ['Executive Engineer (Urban), SAC', "DEE's (Urban), SAC", "AEE's (Urban), SAC"] },
    { name: 'Grameen (SBM-G)', items: ['Executive Engineer (Grameen), SAC', "DEE's (Grameen), SAC", "AEE's (Grameen), SAC"] }
  ];
  var RANK = ['COO, SAC', 'ED, SAC', 'JD, SAC', 'Chief Engineer, SAC', 'Executive Engineer (Urban), SAC',
    'Executive Engineer (Grameen), SAC', "DEE's (Urban), SAC", "DEE's (Grameen), SAC", "AEE's (Urban), SAC", "AEE's (Grameen), SAC"];
  var VENUES = { tidco: 'Conference Hall, TIDCO', sac: 'Conference Hall, SAC' };
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DEPT_FULL = { 'SBM-U': 'Swachh Bharat Mission – Urban', 'SBM-G': 'Swachh Bharat Mission – Gramin' };

  var s = {
    dept: 'SBM-U', help: true,
    // Display order. Presets are inserted by seniority; drag to change it.
    participants: ['Chief Engineer, SAC', 'Executive Engineer (Urban), SAC']
  };

  var rank = function (p) { var i = RANK.indexOf(p); return i < 0 ? 999 : i; };
  var val = function (id) { return $(id).value.trim(); };
  var radio = function (name) { var r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function addParticipant(name) {
    if (!name || s.participants.indexOf(name) >= 0) return;
    var r = rank(name), at = s.participants.length;
    if (r < 999) {           // seniority slot: before the first more-junior (or hand-typed) entry
      for (var i = 0; i < s.participants.length; i++) if (rank(s.participants[i]) > r) { at = i; break; }
    }
    s.participants.splice(at, 0, name);
  }
  function sortBySeniority() {
    var idx = {}; s.participants.forEach(function (p, i) { idx[p] = i; });
    s.participants.sort(function (a, b) { return (rank(a) - rank(b)) || (idx[a] - idx[b]); });
  }

  /* ---------- form-side renders ---------- */
  function renderChips() {
    var box = $('chips'); box.textContent = '';
    PRESET_GROUPS.forEach(function (g) {
      var grp = el('div', 'chip-group'); grp.appendChild(el('div', 'chip-group-name', g.name));
      var row = el('div', 'chips');
      g.items.forEach(function (label) {
        var on = s.participants.indexOf(label) >= 0;
        var b = el('button', 'chip', (on ? '✓ ' : '+ ') + label);
        b.type = 'button'; b.setAttribute('aria-pressed', String(on));
        b.addEventListener('click', function () {
          if (on) s.participants = s.participants.filter(function (p) { return p !== label; });
          else addParticipant(label);
          renderParticipants();
        });
        row.appendChild(b);
      });
      grp.appendChild(row); box.appendChild(grp);
    });
  }

  function renderList() {
    var ol = $('plist'); ol.textContent = '';
    s.participants.forEach(function (name, i) {
      var li = el('li'); li.dataset.name = name;
      var h = el('button', 'grip', '⠿'); h.type = 'button';
      h.setAttribute('aria-label', 'Drag to reorder ' + name);
      h.addEventListener('pointerdown', startDrag);
      h.addEventListener('keydown', keyMove);
      li.appendChild(h);
      li.appendChild(el('span', 'plist-n', (i + 1) + '.'));
      li.appendChild(el('span', 'plist-name', name));
      var x = el('button', 'x', '×'); x.type = 'button'; x.title = 'Remove'; x.setAttribute('aria-label', 'Remove ' + name);
      x.addEventListener('click', function () {
        s.participants = s.participants.filter(function (p) { return p !== name; });
        renderParticipants();
      });
      li.appendChild(x);
      ol.appendChild(li);
    });
    $('pempty').hidden = s.participants.length > 0;
    $('sortBtn').hidden = s.participants.length < 2;
  }

  function renderParticipants() { renderChips(); renderList(); renderCard(); }

  /* ---------- press-and-drag reorder (finger or mouse) ---------- */
  var drag = null;
  function startDrag(e) {
    if (e.button > 0) return;
    e.preventDefault();
    var li = e.currentTarget.parentNode;
    if (e.currentTarget.releasePointerCapture) { try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {} }
    drag = { li: li, id: e.pointerId };
    li.classList.add('lifted');
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (_) {} }
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }
  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var ol = $('plist'), li = drag.li, y = e.clientY;
    var prev = li.previousElementSibling, next = li.nextElementSibling;
    if (prev) { var pr = prev.getBoundingClientRect(); if (y < pr.top + pr.height / 2) { ol.insertBefore(prev, li.nextSibling); renumber(); } }
    if (next) { var nr = next.getBoundingClientRect(); if (y > nr.top + nr.height / 2) { ol.insertBefore(next, li); renumber(); } }
    // Only neighbours move in the DOM, never the dragged row, so the drag is not interrupted.
    // Keep the list in view while dragging near the screen edge.
    var vh = window.innerHeight;
    if (y < 60) window.scrollBy(0, -8); else if (y > vh - 120) window.scrollBy(0, 8);
  }
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    window.removeEventListener('pointermove', moveDrag); window.removeEventListener('pointerup', endDrag); window.removeEventListener('pointercancel', endDrag);
    drag.li.classList.remove('lifted');
    drag = null;
    s.participants = Array.prototype.map.call($('plist').children, function (li) { return li.dataset.name; });
    renderList(); renderCard();
  }
  function renumber() {
    Array.prototype.forEach.call($('plist').children, function (li, i) { li.querySelector('.plist-n').textContent = (i + 1) + '.'; });
  }
  function keyMove(e) {   // keyboard: focus the grip, then arrow up/down
    var d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    var name = e.currentTarget.parentNode.dataset.name, i = s.participants.indexOf(name), j = i + d;
    if (j < 0 || j >= s.participants.length) return;
    s.participants.splice(i, 1); s.participants.splice(j, 0, name);
    renderList(); renderCard();
    $('plist').children[j].querySelector('.grip').focus();
  }

  /* ---------- the card ---------- */
  function fmtDate(v) {
    if (!v) return '—';
    var p = v.split('-'), day = DAYS[new Date(+p[0], +p[1] - 1, +p[2]).getDay()];
    return p[2] + '.' + p[1] + '.' + p[0] + ' (' + day + ')';
  }
  function fmtTime(v) {
    if (!v) return '—';
    var p = v.split(':').map(Number), h = p[0], ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + String(p[1]).padStart(2, '0') + ' ' + ap + ' onwards';
  }

  function renderCard() {
    var g = s.dept === 'SBM-G';
    $('card').className = 'card ' + (g ? 'theme-g' : 'theme-u');
    document.body.classList.toggle('theme-g', g);
    $('oDeptFull').textContent = DEPT_FULL[s.dept];
    $('oTitle').textContent = val('title') || 'Meeting title';
    var chair = radio('chair');
    $('chairOther').hidden = chair !== 'other';
    $('oChair').textContent = chair === 'other' ? (val('chairOther') || '—') : 'Managing Director, SAC';
    $('oDate').textContent = fmtDate($('date').value);
    $('oTime').textContent = fmtTime($('time').value);

    var parts = $('oParts'); parts.textContent = '';
    if (!s.participants.length) parts.textContent = '—';
    s.participants.forEach(function (name, i) {
      var row = el('div', 'c-li');
      row.appendChild(el('span', 'c-li-n', (i + 1) + '.'));
      row.appendChild(el('span', 'c-li-t', name));
      parts.appendChild(row);
    });

    var venue = radio('venue');
    $('venueOther').hidden = venue !== 'other';
    $('oVenue').textContent = venue === 'other' ? (val('venueOther') || '—') : VENUES[venue];

    var zoom = val('zoom');
    $('oZoomK').hidden = $('oZoom').hidden = !zoom;
    $('oZoom').textContent = zoom;

    var notes = val('notes');
    $('oNoteRow').hidden = !notes;
    $('oNote').textContent = notes;

    $('oHelp').hidden = !s.help;
    fit();
  }

  /* ---------- scale the 720px card to the preview column ---------- */
  function fit() {
    var box = $('box'), card = $('card'), sc = $('scaler');
    var w = box.clientWidth, k = Math.min(1, w / 720);
    sc.style.transform = 'scale(' + k + ')';
    sc.style.marginLeft = Math.max(0, (w - 720 * k) / 2) + 'px';
    box.style.height = (card.offsetHeight * k) + 'px';
  }

  /* ---------- export ---------- */
  var fontCSS = null;
  function opts() {
    return document.fonts.ready.then(function () {
      return Promise.all(['400', '700'].map(function (w) { return document.fonts.load(w + ' 20px Pagella').catch(function () {}); }));
    }).then(function () {
      if (fontCSS !== null) return;
      return window.htmlToImage.getFontEmbedCSS($('card')).then(function (c) { fontCSS = c; }, function () { fontCSS = ''; });
    }).then(function () {
      return { pixelRatio: 1.5, fontEmbedCSS: fontCSS || undefined, backgroundColor: '#ffffff' };
    });
  }
  function fileName() { return s.dept + '_meeting_' + ($('date').value || 'undated') + '.png'; }
  function flash(btn, text, ms) {
    btn.textContent = text;
    clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.textContent = btn.dataset.label; btn.disabled = false; }, ms);
  }

  function download() {
    var btn = $('dlBtn');
    if (!window.htmlToImage) return Promise.resolve();
    btn.disabled = true; btn.textContent = 'Saving…';
    return opts().then(function (o) { return window.htmlToImage.toBlob($('card'), o); }).then(function (blob) {
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = fileName(); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      flash(btn, btn.dataset.label, 0);
    }).catch(function () { flash(btn, 'Failed, try again', 2500); });
  }

  function copy() {
    var btn = $('copyBtn');
    if (!window.htmlToImage) return;
    btn.disabled = true; btn.textContent = 'Copying…';
    // The blob promise goes straight into ClipboardItem so Safari keeps the user gesture.
    var blobP = opts().then(function (o) { return window.htmlToImage.toBlob($('card'), o); });
    var p;
    try { p = navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]); }
    catch (e) { p = Promise.reject(e); }
    p.then(function () { flash(btn, 'Copied', 2500); }, function () {
      download().then(function () { flash(btn, 'Downloaded instead', 2500); });
    });
  }

  /* ---------- wire up ---------- */
  function init() {
    $('form').addEventListener('submit', function (e) { e.preventDefault(); });
    $('form').addEventListener('input', renderCard);
    $('form').addEventListener('change', renderCard);
    Array.prototype.forEach.call(document.querySelectorAll('.dept'), function (b) {
      b.addEventListener('click', function () {
        s.dept = b.dataset.dept;
        Array.prototype.forEach.call(document.querySelectorAll('.dept'), function (o) { o.setAttribute('aria-checked', String(o === b)); });
        renderCard();
      });
    });
    var addDraft = function () { var v = val('draft'); if (!v) return; addParticipant(v); $('draft').value = ''; renderParticipants(); $('draft').focus(); };
    $('addDraft').addEventListener('click', addDraft);
    $('draft').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addDraft(); } });
    $('sortBtn').addEventListener('click', function () { sortBySeniority(); renderList(); renderCard(); });
    $('helpFooter').addEventListener('click', function () {
      s.help = !s.help; this.setAttribute('aria-checked', String(s.help)); renderCard();
    });
    ['copyBtn', 'dlBtn'].forEach(function (id) { $(id).dataset.label = $(id).textContent; });
    $('copyBtn').addEventListener('click', copy);
    $('dlBtn').addEventListener('click', download);
    if (window.ResizeObserver) { var ro = new ResizeObserver(fit); ro.observe($('box')); ro.observe($('card')); }
    else window.addEventListener('resize', fit);
    document.fonts && document.fonts.ready.then(fit);
    renderParticipants();
  }
  init();
})();
