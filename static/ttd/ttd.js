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
    if (v === 'cameras') camStart(); else camStop();
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
  // Short requests only: the newest picture about once a second. The site sends pictures only
  // while someone is asking, so closing this tab stops the data within ~12 seconds.
  var CV = { on: false, cams: null, pick: null, names: {}, q: 'normal', timers: [], until: 0, urls: {}, stateT: null };
  function camStop(msg) {
    CV.on = false; CV.timers.forEach(clearTimeout); CV.timers = []; clearInterval(CV.stateT);
    if (msg) {
      $('c-grid').innerHTML = '<div class="cam wide"><span>' + esc(msg) + '</span><button class="btn" id="c-again">Watch again</button></div>';
      $('c-again').addEventListener('click', camStart);
    }
  }
  function camState() {
    return api('live/state').then(function (s) {
      $('c-plant').className = 'pill ' + (s.plant_online ? 'pill--ok' : 'pill--off');
      $('c-plant').textContent = s.plant_online ? 'Site online' : 'Site offline';
      var w = s.weight;
      $('c-weight').textContent = (w && w.connected ? nf0.format(w.weight) : '—') + ' kg' + (w && w.connected && w.stable ? ' · stable' : '');
      $('c-info').textContent = 'Pictures are sent from the site only while this view is open. Viewing stops after ' + s.max_minutes + ' minutes to save data.';
      var ids = s.cams.map(function (c) { return c[0]; });
      s.cams.forEach(function (c) { CV.names[c[0]] = c[1]; });
      if (JSON.stringify(ids) !== JSON.stringify(CV.cams)) {
        CV.cams = ids;
        if (!CV.pick || !CV.pick.every(function (c) { return ids.indexOf(c) >= 0; })) CV.pick = ids.slice();
        camButtons();
        if (CV.on) camDraw();
      }
      return s;
    });
  }
  function camButtons() {
    var opts = CV.cams.map(function (c) { return [[c], CV.names[c] || c]; });
    if (CV.cams.length > 1) opts.push([CV.cams.slice(), 'All']);
    var box = $('c-pick'); box.innerHTML = '';
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'chip' + (o[0].join() === CV.pick.join() ? ' on' : ''); b.textContent = o[1];
      b.addEventListener('click', function () { CV.pick = o[0]; camButtons(); camStart(); });
      box.appendChild(b);
    });
  }
  function camDraw() {
    CV.timers.forEach(clearTimeout); CV.timers = [];
    var grid = $('c-grid'); grid.innerHTML = '';
    CV.pick.forEach(function (c) {
      var d = document.createElement('div'); d.className = 'cam';
      d.innerHTML = '<span class="cam-name"></span><span class="cam-age" hidden></span><span class="cam-wait">Waiting for the site to send pictures… (up to 20 s)</span>';
      d.querySelector('.cam-name').textContent = CV.names[c] || c;
      grid.appendChild(d);
      camPoll(c, d);
    });
  }
  function camPoll(cam, tile) {
    if (!CV.on) return;
    if (Date.now() > CV.until) return camStop('Viewing paused to save data.');
    var wait = CV.q === 'high' ? 500 : 1000;
    var next = function () { if (CV.on) CV.timers.push(setTimeout(function () { camPoll(cam, tile); }, wait)); };
    if (document.hidden) { wait = 2000; return next(); }   // tab hidden: stop asking, so the site stops sending
    fetch('/TTD/api/live/' + cam + '.jpg?q=' + CV.q, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { location.href = '/TTD'; return; }
      if (r.status !== 200) { if (r.status !== 204) wait = 3000; return; }
      var age = +r.headers.get('X-Age');
      return r.blob().then(function (b) {
        var url = URL.createObjectURL(b), img = tile.querySelector('img');
        if (!img) { img = document.createElement('img'); img.alt = CV.names[cam] || cam; tile.appendChild(img); var w = tile.querySelector('.cam-wait'); if (w) w.remove(); }
        img.src = url;
        if (CV.urls[cam]) URL.revokeObjectURL(CV.urls[cam]);
        CV.urls[cam] = url;
        var tag = tile.querySelector('.cam-age'); tag.hidden = !(age > 4); tag.textContent = 'delayed ' + Math.round(age) + ' s';
      });
    }).catch(function () { wait = 3000; }).then(next);
  }
  function camStart() {
    camStop();
    camState().then(function (s) {
      CV.on = true; CV.until = Date.now() + s.max_minutes * 60000;
      CV.stateT = setInterval(function () { camState().catch(function () {}); }, 3000);
      camDraw();
    }).catch(function (e) { camStop(e.message); });
  }
  document.querySelectorAll('[data-q]').forEach(function (b) {
    b.addEventListener('click', function () { CV.q = b.dataset.q; document.querySelectorAll('[data-q]').forEach(function (x) { x.classList.toggle('on', x === b); }); });
  });
  $('c-stop').addEventListener('click', function () { camStop('Stopped.'); });

  loadOverview();
})();
