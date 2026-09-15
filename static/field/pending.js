/* Field report — office status page. */
(function () {
  'use strict';
  const CFG = JSON.parse(document.getElementById('field-config').textContent);
  const NS = 'fr_' + CFG.brand + '_';
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0'); const t = new Date();
  let PIN = sessionStorage.getItem(NS + 'pin') || '', DATA = null;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(CFG.swUrl, { scope: CFG.formUrl }).catch(() => {});
  }

  $('date').value = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  $('pin').addEventListener('keydown', e => { if (e.key === 'Enter') open_(); });
  $('open').onclick = open_;
  $('date').onchange = load;
  $('copy').onclick = copy;

  function open_() { PIN = $('pin').value.trim(); load(); }

  async function load() {
    if (!PIN) return;
    $('open').disabled = true; $('msg').textContent = ''; $('appMsg').textContent = '';
    try {
      const r = await fetch(CFG.api.status, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: PIN, date: $('date').value }), cache: 'no-store' });
      let data = null; try { data = await r.json(); } catch (e) { /* */ }
      if (!data || !data.ok) throw new Error((data && data.error) || ('Server error (' + r.status + ').'));
      render(data);
    } catch (err) {
      const m = err instanceof TypeError ? 'No connection.' : err.message;
      $('open').disabled = false;
      if ($('app').style.display === 'flex') $('appMsg').textContent = m; else $('msg').textContent = m;
      if (/pin/i.test(m)) { sessionStorage.removeItem(NS + 'pin'); }
    }
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function render(r) {
    DATA = r; sessionStorage.setItem(NS + 'pin', PIN);
    $('lock').style.display = 'none'; $('app').style.display = 'flex';
    $('nSub').textContent = r.submitted.length; $('nPen').textContent = r.pending.length;
    $('nPen').style.color = r.pending.length ? 'var(--leaf)' : '#fff';
    $('pending').innerHTML = r.pending.length
      ? r.pending.map(p => `<div class="item"><div><div class="n">${esc(p.site)}</div><div class="s">${esc(p.operator)} · <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></div></div><span class="tag">Pending</span></div>`).join('')
      : '<div class="ok">Every site has reported.</div>';
    $('submitted').innerHTML = r.submitted.length
      ? r.submitted.map(s => `<div class="item"><div><div class="n">${esc(s.site)}</div><div class="s">${esc(s.operator)} · ${esc(s.time)}</div></div><div class="qtyc">${esc(s.msw)} t · ${esc(s.disposed)} t</div></div>`).join('')
      : '<div class="item"><div class="hint">No reports yet for this day.</div></div>';
    $('sheet').style.display = r.sheetUrl ? 'block' : 'none'; if (r.sheetUrl) $('sheet').href = r.sheetUrl;
  }

  function copy() {
    if (!DATA) return;
    const text = `${CFG.org} · pending site reports · ${DATA.date}\n` +
      (DATA.pending.length ? DATA.pending.map(p => `• ${p.site} — ${p.operator} ${p.phone}`).join('\n') : 'Every site has reported.');
    const done = () => { $('copy').textContent = 'Copied'; setTimeout(() => $('copy').textContent = 'Copy as text', 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done); else { prompt('Copy:', text); done(); }
  }

  if (PIN) { $('pin').value = PIN; load(); }
})();
