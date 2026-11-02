// TTD dashboard. Every request goes to this site's own /TTD/api/*, which needs the signed-in session.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  var mt = function (v) { return nf2.format(v || 0); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var iso = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  function api(path) {
    return fetch('/TTD/api/' + path, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { location.href = '/TTD'; throw new Error('Signed out'); }
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('Error ' + r.status)); return j; });
    });
  }
  function showErr(msg) { var e = $('err'); e.textContent = msg || ''; e.hidden = !msg; }

  // ------------------------------------------------------------------ tabs
  var current = 'overview';
  document.querySelectorAll('.tab').forEach(function (b) {
    b.addEventListener('click', function () { show(b.dataset.view); });
  });
  function show(v) {
    current = v;
    document.querySelectorAll('.tab').forEach(function (b) { var on = b.dataset.view === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    ['overview', 'reports', 'cameras'].forEach(function (x) { $('v-' + x).hidden = x !== v; });
    showErr('');
    if (v === 'overview') loadOverview();
    if (v === 'reports') loadReport();
    if (v === 'cameras') camStart(); else camStopView();
  }

  // ------------------------------------------------------------------ overview
  function loadOverview() {
    return api('overview').then(function (o) {
      showErr('');
      $('o-awarded').textContent = nf0.format(o.awarded_mt);
      $('o-proc').textContent = mt(o.processed_mt);
      $('o-pct').textContent = o.pct.toFixed(1) + '%';
      $('o-bal').textContent = mt(o.balance_mt);
      $('o-fill').style.width = Math.min(100, o.pct) + '%';
      $('o-bar').setAttribute('aria-valuenow', o.pct);
      $('o-trips').textContent = nf0.format(o.trips_today);
      $('o-trips-s').textContent = o.trips_today_complete + ' complete' + (o.trips_today > o.trips_today_complete ? ', ' + (o.trips_today - o.trips_today_complete) + ' awaiting empty weight' : '');
      $('o-inward').textContent = mt(o.processed_mt);
      $('o-inward-s').textContent = '+' + mt(o.inward_today_mt) + ' MT today';
      document.querySelectorAll('[data-mat]').forEach(function (el) { el.textContent = mt(o.disposed[el.dataset.mat]); });
      $('o-upd').textContent = o.updated;
    }).catch(function (e) { showErr(e.message); });
  }
  setInterval(function () { if (current === 'overview' && !document.hidden) loadOverview(); }, 60000);

  // ------------------------------------------------------------------ reports
  var rview = 'day';
  function defaultRange() {
    var t = new Date(), f = new Date(t);
    if (rview === 'day') f.setDate(1); else { f.setMonth(0); f.setDate(1); }
    $('r-from').value = iso(f); $('r-to').value = iso(t);
  }
  document.querySelectorAll('[data-rview]').forEach(function (b) {
    b.addEventListener('click', function () {
      rview = b.dataset.rview;
      document.querySelectorAll('[data-rview]').forEach(function (x) { x.classList.toggle('on', x === b); });
      defaultRange(); loadReport();
    });
  });
  $('r-from').addEventListener('change', loadReport);
  $('r-to').addEventListener('change', loadReport);
  function qs() { return 'view=' + rview + '&from=' + encodeURIComponent($('r-from').value) + '&to=' + encodeURIComponent($('r-to').value); }
  function loadReport() {
    if (!$('r-from').value) defaultRange();
    $('r-pdf').href = '/TTD/report.pdf?' + qs();
    return api('report?' + qs()).then(function (r) {
      showErr('');
      var label = { MSW: 'MSW inward', CnD: 'C&amp;D' };
      var mats = r.materials;
      var head = '<thead><tr><th>' + (r.view === 'day' ? 'Day' : 'Month') + '</th><th>Trips</th>' +
        mats.map(function (m) { return '<th' + (m === r.inward ? ' class="inward"' : '') + '>' + (label[m] || esc(m)) + '</th>'; }).join('') +
        '<th>Disposed</th></tr></thead>';
      var body = r.rows.slice().reverse().map(function (x) {
        var zero = !x.trips && !x.MSW && !x.disposed;
        return '<tr' + (zero ? ' class="zero"' : '') + '><td>' + esc(x.label) + '</td><td>' + x.trips + '</td>' +
          mats.map(function (m) { return '<td' + (m === r.inward ? ' class="inward"' : '') + '>' + mt(x[m]) + '</td>'; }).join('') +
          '<td>' + mt(x.disposed) + '</td></tr>';
      }).join('');
      var t = r.total;
      var foot = '<tfoot><tr><td>Total</td><td>' + t.trips + '</td>' + mats.map(function (m) { return '<td>' + mt(t[m]) + '</td>'; }).join('') +
        '<td>' + mt(t.disposed) + '</td></tr></tfoot>';
      $('r-table').innerHTML = head + '<tbody>' + (body || '<tr><td colspan="99" class="empty">No trips in these dates.</td></tr>') + '</tbody>' + foot;
    }).catch(function (e) { showErr(e.message); });
  }

  // ------------------------------------------------------------------ live cameras (on demand)
  // Nothing streams until Watch is clicked. A watched camera asks for its newest picture about
  // once a second (short requests). The cloud ends each Watch after 5 minutes (410).
  var CV = { cams: [], names: {}, q: 'normal', tiles: {}, stateT: null, maxMin: 5 };
  var mins = function (n) { return n + (n === 1 ? ' minute' : ' minutes'); };
  function camState() {
    return api('live/state').then(function (s) {
      $('c-plant').className = 'pill ' + (s.plant_online ? 'pill--ok' : 'pill--off');
      $('c-plant').textContent = s.plant_online ? 'Site online' : 'Site offline';
      var w = s.weight;
      $('c-weight').textContent = (w && w.connected ? nf0.format(w.weight) : '—') + ' kg' + (w && w.connected && w.stable ? ' · stable' : '');
      CV.maxMin = s.max_minutes;
      $('c-info').textContent = 'Cameras switch on only when you click Watch, and stop after ' + mins(s.max_minutes) + ' to save data.';
      s.cams.forEach(function (c) { CV.names[c[0]] = c[1]; });
      var ids = s.cams.map(function (c) { return c[0]; });
      if (JSON.stringify(ids) !== JSON.stringify(CV.cams)) { CV.cams = ids; camDraw(); }
      else ids.forEach(function (c) { var t = CV.tiles[c]; if (t) t.el.querySelector('.cam-name').textContent = CV.names[c] || c; });
    });
  }
  function camDraw() {
    Object.keys(CV.tiles).forEach(function (c) { if (CV.cams.indexOf(c) < 0) { camStop(c); CV.tiles[c].el.remove(); delete CV.tiles[c]; } });
    var grid = $('c-grid');
    var wait = grid.querySelector('.cam.wide'); if (wait) wait.remove();
    CV.cams.forEach(function (c) {
      var t = CV.tiles[c];
      if (!t) {
        var el = document.createElement('div'); el.className = 'cam'; el.dataset.cam = c;
        t = CV.tiles[c] = { el: el, on: false, timer: null, url: null };
        camIdle(c);
      }
      grid.appendChild(t.el);   // keeps the site's camera order
    });
  }
  function camIdle(c, msg) {
    var t = CV.tiles[c];
    t.el.innerHTML = '<span class="cam-name"></span><span class="cam-age" hidden></span><div class="go"><span>' + esc(msg || 'Not watching') +
      '</span><button class="btn">' + (msg ? 'Watch again' : 'Watch') + '</button><small>' + mins(CV.maxMin) + ' per Watch</small></div>';
    t.el.querySelector('.cam-name').textContent = CV.names[c] || c;
    t.el.querySelector('.go .btn').addEventListener('click', function () { camWatch(c); });
  }
  function camWatch(c) {
    var t = CV.tiles[c];
    if (!t || t.on) return;
    t.on = true;
    t.el.innerHTML = '<span class="cam-name"></span><span class="cam-age" hidden></span><span class="cam-wait">Switching on… (up to 20 s)</span><button class="stop-one">Stop</button>';
    t.el.querySelector('.cam-name').textContent = CV.names[c] || c;
    t.el.querySelector('.stop-one').addEventListener('click', function () { camStop(c); camIdle(c); });
    camPoll(c, true);
  }
  function camStop(c) {
    var t = CV.tiles[c]; if (!t) return;
    t.on = false; clearTimeout(t.timer);
    if (t.url) { URL.revokeObjectURL(t.url); t.url = null; }
  }
  function camPoll(c, first) {
    var t = CV.tiles[c];
    if (!t || !t.on) return;
    var wait = CV.q === 'high' ? 500 : 1000;
    var next = function () { if (t.on) t.timer = setTimeout(function () { camPoll(c, false); }, wait); };
    if (document.hidden) { wait = 2000; return next(); }   // tab hidden: stop asking, so the site stops sending
    fetch('/TTD/api/live/' + c + '.jpg?q=' + CV.q + (first ? '&start=1' : ''), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      if (!t.on) return;
      if (r.status === 401) { location.href = '/TTD'; return; }
      if (r.status === 410) { camStop(c); camIdle(c, 'Stopped after ' + mins(CV.maxMin)); return; }
      if (r.status !== 200) { if (r.status !== 204) wait = 3000; return; }
      var age = +r.headers.get('X-Age');
      return r.blob().then(function (b) {
        var url = URL.createObjectURL(b), img = t.el.querySelector('img');
        if (!img) { img = document.createElement('img'); img.alt = CV.names[c] || c; t.el.prepend(img); var w = t.el.querySelector('.cam-wait'); if (w) w.remove(); }
        img.src = url;
        if (t.url) URL.revokeObjectURL(t.url);
        t.url = url;
        var tag = t.el.querySelector('.cam-age'); tag.hidden = !(age > 4); tag.textContent = 'delayed ' + Math.round(age) + ' s';
      });
    }).catch(function () { wait = 3000; }).then(next);
  }
  function camStopAll() { Object.keys(CV.tiles).forEach(function (c) { if (CV.tiles[c].on) { camStop(c); camIdle(c); } }); }
  function camOpen() {
    if (!CV.cams.length) $('c-grid').innerHTML = '<div class="cam wide"><span>Checking which cameras the site has…</span></div>';
    camState().catch(function (e) { $('c-grid').innerHTML = '<div class="cam wide"><span>' + esc(e.message) + '</span></div>'; CV.cams = []; });
    clearInterval(CV.stateT);
    CV.stateT = setInterval(function () { camState().catch(function () {}); }, 5000);
  }
  function camStart() { camOpen(); }
  function camStopView() { clearInterval(CV.stateT); camStopAll(); }
  document.querySelectorAll('[data-q]').forEach(function (b) {
    b.addEventListener('click', function () { CV.q = b.dataset.q; document.querySelectorAll('[data-q]').forEach(function (x) { x.classList.toggle('on', x === b); }); });
  });
  $('c-all').addEventListener('click', function () { CV.cams.forEach(camWatch); });
  $('c-stop').addEventListener('click', camStopAll);

  loadOverview();
})();
