/* Field report — operator form. Reads config from #field-config. */
(function () {
  'use strict';
  const CFG = JSON.parse(document.getElementById('field-config').textContent);
  const NS = 'fr_' + CFG.brand + '_';           // localStorage namespace — both apps share one origin
  const $ = id => document.getElementById(id);
  const QTY = { msw: 'MSW inward', soil: 'Soil disposed', inert: 'Inert disposed', rdf: 'RDF disposed', cnd: 'C&D disposed' };
  const store = {
    get: k => { try { return JSON.parse(localStorage.getItem(NS + k)); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { /* quota */ } },
  };
  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isoLocal = d => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  // ---- Service worker: lets the page open with no signal ----
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(CFG.swUrl, { scope: CFG.formUrl }).catch(() => {});
  }

  // ---- Identity: asked once ----
  const who = store.get('who');
  if (who && who.operator && who.phone) { $('operator').value = who.operator; $('phone').value = who.phone; lockWho(); }
  function lockWho() {
    $('whoName').textContent = $('operator').value; $('whoPhone').textContent = $('phone').value;
    $('who').style.display = 'flex'; $('whoEdit').style.display = 'none';
  }
  $('whoChange').onclick = () => { $('who').style.display = 'none'; $('whoEdit').style.display = 'flex'; $('operator').focus(); };

  // ---- Defaults ----
  const today = new Date();
  $('startDate').value = isoDate(today); $('endDate').value = isoDate(today);
  $('startTime').value = '08:00'; $('endTime').value = '17:00';
  const lastSite = store.get('site'); if (lastSite) $('site').value = lastSite;

  // ---- Material chips ----
  const sel = {};
  $('chips').innerHTML = Object.keys(QTY).map(k => `<button type="button" class="chip" id="c_${k}" data-k="${k}">${QTY[k]}</button>`).join('');
  $('chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) toggle(b.dataset.k); });
  function toggle(k) {
    sel[k] = !sel[k];
    $('c_' + k).classList.toggle('on', sel[k]); $('q_' + k).classList.toggle('on', sel[k]);
    if (sel[k]) $(k).focus(); else $(k).value = '';
    $('none').style.display = Object.keys(sel).some(x => sel[x]) ? 'none' : 'block';
    $('err').style.display = 'none';
  }
  function resetMaterials() {
    for (const k in QTY) { sel[k] = false; $('c_' + k).classList.remove('on'); $('q_' + k).classList.remove('on'); $(k).value = ''; }
    $('none').style.display = 'block';
  }

  // ---- Site suggestions (cached so they show offline too) ----
  function renderSites(list) {
    $('sites').innerHTML = (list || []).map(s => `<option value="${String(s).replace(/"/g, '&quot;')}">`).join('');
  }
  renderSites(store.get('sites'));
  fetch(CFG.api.sites, { cache: 'no-store' }).then(r => r.json()).then(r => {
    if (r && r.ok) { store.set('sites', r.sites); renderSites(r.sites); }
  }).catch(() => {});

  // ---- Collect / validate ----
  function collect() {
    const d = {
      operator: $('operator').value.trim(), phone: $('phone').value.replace(/\D/g, ''), site: $('site').value.trim(),
      startDate: $('startDate').value, startTime: $('startTime').value, endDate: $('endDate').value, endTime: $('endTime').value,
      remarks: $('remarks').value.trim(), capturedAt: isoLocal(new Date()),
    };
    for (const k in QTY) d[k] = sel[k] ? $(k).value.trim() : '0';
    return d;
  }
  function validate(d) {
    if (!d.operator) return ['Please type your name.', 'operator'];
    if (!/^\d{10}$/.test(d.phone)) return ['Phone number needs 10 digits.', 'phone'];
    if (!d.site) return ['Please type the site name.', 'site'];
    if (!d.startDate || !d.endDate || !d.startTime || !d.endTime) return ['Please fill the shift dates and times.', 'startDate'];
    for (const k in QTY) if (d[k] === '' || isNaN(Number(d[k])) || Number(d[k]) < 0) return [QTY[k] + ': type the tonnes.', k];
    return null;
  }
  function showErr(msg, focusId) { const e = $('err'); e.textContent = msg; e.style.display = 'block'; if (focusId) $(focusId).focus(); }
  function sendState(busy) { $('send').disabled = busy; $('send').textContent = busy ? 'Sending…' : 'Send report'; }

  // ---- Network ----
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    let data = null; try { data = await r.json(); } catch (e) { /* fallthrough */ }
    if (!data) throw Object.assign(new Error('Server error (' + r.status + ').'), { transient: r.status >= 500 });
    if (!data.ok) throw Object.assign(new Error(data.error || 'Rejected.'), { transient: r.status >= 500 });
    return data;
  }

  $('send').onclick = async () => {
    const d = collect(); const v = validate(d);
    if (v) return showErr(v[0], v[1]);
    $('err').style.display = 'none'; sendState(true);
    store.set('who', { operator: d.operator, phone: d.phone }); store.set('site', d.site); lockWho();
    if (!navigator.onLine) return queue(d);
    try {
      const res = await post(CFG.api.submit, d);
      store.set('last', { d, res }); showSent(d, res, false);
    } catch (err) {
      sendState(false);
      // TypeError = fetch itself failed (no network). 5xx = server hiccup. Both: keep it on the phone.
      if (err instanceof TypeError || err.transient) queue(d); else showErr(err.message);
    }
  };

  // ---- Offline queue ----
  function queue(d) { const q = store.get('queue') || []; q.push(d); store.set('queue', q); updateQueued(); showSent(d, null, true); }
  let flushing = false;
  async function flushQueue() {
    if (flushing || !navigator.onLine) return;
    flushing = true;
    try {
      let q = store.get('queue') || [];
      while (q.length) {
        try { await post(CFG.api.submit, q[0]); }
        catch (err) {
          if (err instanceof TypeError || err.transient) break;   // still no route — try later
          // Permanent rejection (validation): drop it so one bad row can't block the rest.
        }
        q = (store.get('queue') || []).slice(1); store.set('queue', q); updateQueued();
      }
    } finally { flushing = false; }
  }
  function updateQueued() {
    const q = store.get('queue') || []; const el = $('queued');
    el.style.display = q.length ? 'block' : 'none';
    el.textContent = q.length ? `${q.length} report${q.length > 1 ? 's' : ''} waiting for signal — will send automatically.` : '';
  }
  function netState() { $('offline').style.display = navigator.onLine ? 'none' : 'block'; if (navigator.onLine) flushQueue(); }
  window.addEventListener('online', netState); window.addEventListener('offline', netState);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
  netState(); updateQueued(); flushQueue();

  // ---- Sent screen ----
  function beforeCutoff() { const [h, m] = CFG.cutoff.split(':').map(Number); const n = new Date(); return n.getHours() * 60 + n.getMinutes() < h * 60 + m; }
  function showSent(d, res, queued) {
    $('form').style.display = 'none'; $('sent').style.display = 'flex'; window.scrollTo(0, 0);
    sendState(false);
    $('sentTitle').textContent = queued ? 'Saved. Will send when signal returns.' : (res && res.replaced ? 'Report updated.' : 'Report sent.');
    $('sentSub').textContent = d.site + ' · ' + new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const disposed = ['soil', 'inert', 'rdf', 'cnd'].reduce((a, k) => a + Number(d[k]), 0);
    $('sum').innerHTML = Object.keys(QTY).filter(k => Number(d[k]) > 0).map(k => `<div><span>${QTY[k]}</span><span>${Number(d[k])} t</span></div>`).join('')
      + `<div><span>Total disposed</span><span>${Math.round(disposed * 100) / 100} t</span></div>`;
    const ok = beforeCutoff();
    $('editBtn').style.display = ok ? 'block' : 'none';
    $('editHint').textContent = ok ? `Editing closes at ${CFG.cutoff}. Sending again replaces this one.` : 'Editing has closed for today.';
  }
  function editReport() { $('sent').style.display = 'none'; $('form').style.display = 'flex'; window.scrollTo(0, 0); }
  $('editBtn').onclick = editReport;
  $('anotherBtn').onclick = () => { $('site').value = ''; resetMaterials(); $('remarks').value = ''; editReport(); $('site').focus(); };
})();
