/* RDF_planning v2 — agency form. Reads config from #rdf-config. No build step.
 *
 * Views: login → home ("My sites") → form (4 steps) → done.
 * render() rebuilds the screen on navigation and clicks. While typing, only
 * each field's border + hint are refreshed (refreshLooks), so the focused
 * input is never replaced.
 */
(function () {
  'use strict';
  const CFG = JSON.parse(document.getElementById('rdf-config').textContent);
  const app = document.getElementById('app');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p2 = v => String(v).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const today = () => iso(new Date());
  const addDays = k => { const d = new Date(); d.setDate(d.getDate() + k); return iso(d); };
  const num = v => parseFloat(String(v == null ? '' : v).replace(/,/g, '')) || 0;
  const fmt = v => num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const fd = s => (s ? String(s).split('-').reverse().join('-') : '—');
  const cleanNum = v => { let s = String(v).replace(/[^\d.]/g, ''); const i = s.indexOf('.'); if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '').slice(0, 2); return s.slice(0, 12); };
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('rdf2_' + k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rdf2_' + k, JSON.stringify(v)); } catch (e) { /* quota / private mode */ } },
    del(k) { try { localStorage.removeItem('rdf2_' + k); } catch (e) { /* ignore */ } },
  };

  // ---------------------------------------------------------------- form definition
  const M = { RDF: 'RDF', Soil: 'Soil', Inert: 'Inert', CnD: 'C&D' };
  const MK = Object.keys(M);
  const F = (k, l, t, h, half, ph) => ({ k, l, t, h, half, ph });
  const STEPS = [
    { name: 'Site', cards: [
      { t: 'Site & phase', d: 'Type the site and phase this report is for.', dot: 'site', f: [F('site', 'Site name', 'text', 'Type the full site name. Sites you entered before are suggested.', 0, 'e.g. Kadapa'), F('phase', 'Phase', 'text', 'An agency can report many phases, one entry each.', 0, 'e.g. Phase 3')] },
      { t: 'Work period', d: 'End date can be planned (future) or actual.', dot: 'site', f: [F('start', 'Start date', 'date', 'Day work began', 1), F('end', 'End date', 'date', 'Past or future', 1)] },
      { t: 'ULB quantities', d: 'Legacy waste, in metric tonnes.', dot: 'site', f: [F('awarded', 'Total qty awarded by ULB', 'num', 'As per work order', 1), F('processed', 'Total qty processed', 'num', 'Processed so far', 1)] },
      { t: 'Completion', d: '', dot: 'site', f: [F('remDate', 'When will the site be 100% remediated?', 'date', 'Expected date. Past or future.')] },
      { t: 'Site status', d: '', dot: 'site', f: [
        F('reclaimed', 'Site is 100% reclaimed, with no disposals pending', 'check', 'Tick only if nothing is left to dispose. Every balance at site must then be 0.'),
        F('freshDump', 'Is fresh waste being dumped on the site you reclaimed?', 'yesno', 'New waste arriving after remediation.')] },
    ] },
    { name: 'RDF', cards: [
      { t: 'RDF disposal', d: 'Refuse-derived fuel sent to cement or waste-to-energy (WtE) plants.', dot: 'RDF', f: [F('rdfLast', 'Last date of RDF disposal', 'dateMax', 'Today or earlier', 1), F('rdfDaily', 'RDF disposed every day', 'num', 'Average per day. 0 if stopped.', 1), F('RDF_cum', 'Cumulative RDF disposed', 'num', 'Total sent so far', 1), F('RDF_bal', 'Balance RDF at site', 'num', 'Still waiting at site', 1)] },
      { t: 'Factories', d: 'Where the RDF went. One row per factory.', dot: 'RDF', factories: true },
      { t: 'RDF timeline & issues', d: '', dot: 'RDF', f: [F('RDF_tl', 'Timeline to complete RDF disposal', 'date', 'Past or future'), F('RDF_iss', 'Any issues in disposing RDF?', 'area', 'Optional. Write as much as you need.', 0, 'e.g. Plant accepting only 2 trucks a day')] },
    ] },
    { name: 'Soil · Inert · C&D', cards: ['Soil', 'Inert', 'CnD'].map(m => ({ t: M[m], d: '', dot: m, f: [
      F(m + '_cum', 'Cumulative ' + M[m] + ' disposed', 'num', '0 or more', 1), F(m + '_bal', 'Balance ' + M[m] + ' at site', 'num', '0 or more', 1),
      F(m + '_tl', 'Timeline to complete ' + M[m] + ' disposal', 'date', 'Past or future'), F(m + '_iss', 'Any issues in disposing ' + M[m] + '?', 'area', 'Optional. Write as much as you need.')] })) },
    { name: 'Review', cards: [{ t: 'Other remarks', d: '', dot: 'site', f: [F('remarks', 'Any other remarks or concerns by the agency?', 'area', 'Optional. Write as much as you need.')] }] },
  ];
  const FIELDS = STEPS.flatMap((s, i) => s.cards.flatMap(c => (c.f || []).map(f => ({ ...f, step: i }))));
  const def = k => FIELDS.find(f => f.k === k);
  const stepOf = k => (k.startsWith('fac') ? 1 : (def(k) || { step: 0 }).step);
  const FAC_HINT = 'Cement or WtE plant, with the quantity sent there. Factories you used before are suggested.';

  function blank() {
    const x = { id: '', site: '', phase: '', start: '', end: '', awarded: '', processed: '', remDate: '', reclaimed: '', freshDump: '', rdfLast: '', rdfDaily: '', factories: [{ name: '', qty: '' }], remarks: '' };
    MK.forEach(m => Object.assign(x, { [m + '_cum']: '', [m + '_bal']: '', [m + '_tl']: '', [m + '_iss']: '' }));
    return x;
  }

  // ---------------------------------------------------------------- state
  const S = {
    view: 'loading', agency: '', entries: [], factories: [],
    agIn: store.get('lastAgency', ''), pinIn: '', loginErr: '', busy: false,
    step: 0, x: blank(), tried: {}, err: '', fromReview: false, last: null,
  };

  // ---------------------------------------------------------------- validation (errors block, warnings don't)
  function check(x) {
    const E = {}, t = today();
    const err = (k, m) => (E[k] = E[k] || [m, 0]), warn = (k, m) => (E[k] = E[k] || [m, 1]);
    const empty = k => String(x[k] == null ? '' : x[k]).trim() === '';
    ['site', 'phase'].forEach(k => empty(k) && err(k, 'Required.'));
    ['start', 'end', 'remDate', 'rdfLast', ...MK.map(m => m + '_tl')].forEach(k => empty(k) && err(k, 'Pick a date.'));
    ['awarded', 'processed', 'rdfDaily', ...MK.flatMap(m => [m + '_cum', m + '_bal'])].forEach(k => empty(k) && err(k, 'Required. Enter 0 if none.'));
    if (x.freshDump !== 'yes' && x.freshDump !== 'no') err('freshDump', 'Choose Yes or No.');
    if (x.reclaimed === 'yes') {
      MK.forEach(m => { if (num(x[m + '_bal']) > 0) err(m + '_bal', 'Site is marked 100% reclaimed with no disposals pending, so this must be 0.'); });
      if (x.remDate > t) warn('remDate', 'Site is marked 100% reclaimed, but this date is in the future.');
    }
    if (x.start && x.end && x.end < x.start) err('end', `Before the start date (${fd(x.start)}).`);
    if (x.rdfLast && x.rdfLast > t) err('rdfLast', 'Can’t be in the future.');
    if (x.start && x.rdfLast && x.rdfLast < x.start) err('rdfLast', 'Before work started.');
    if (x.start && x.remDate && x.remDate < x.start) err('remDate', 'Before the start date.');
    if (x.awarded !== '' && num(x.processed) > num(x.awarded)) warn('processed', 'More than the quantity awarded. Please check.');
    MK.forEach(m => { if (x.remDate && x[m + '_tl'] > x.remDate) warn(m + '_tl', 'Later than the 100% remediation date.'); });
    const bal = num(x.RDF_bal), day = num(x.rdfDaily);
    if (bal > 0 && x.RDF_tl && x.rdfDaily !== '') {
      if (day === 0) warn('RDF_tl', `Disposal is 0 MT/day but ${fmt(bal)} MT is still at site.`);
      else { const need = Math.ceil(bal / day), pd = addDays(need); if (x.RDF_tl < pd) warn('RDF_tl', `At ${fmt(day)} MT/day the balance needs ${need} days (≈ ${fd(pd)}).`); }
    }
    const seen = {};
    x.factories.forEach((f, i) => {
      const nm = f.name.trim().toLowerCase();
      if (!nm && num(f.qty)) err('fac' + i, 'Type the factory name.');
      else if (nm && seen[nm]) err('fac' + i, 'Already added above.');
      if (nm) seen[nm] = 1;
    });
    const named = x.factories.filter(f => f.name.trim()), sum = x.factories.reduce((s, f) => s + num(f.qty), 0);
    if (num(x.RDF_cum) > 0 && !named.length) err('fac', 'Add at least one factory.');
    else if (sum > num(x.RDF_cum) + 0.01) err('fac', `Factory total (${fmt(sum)} MT) is more than cumulative RDF (${fmt(x.RDF_cum)} MT).`);
    else if (named.length && sum < num(x.RDF_cum) - 0.01) warn('fac', `Factory total is ${fmt(sum)} of ${fmt(x.RDF_cum)} MT.`);
    return E;
  }
  // Errors show once the agency tried to continue, or the field has a value; warnings always.
  function show(E, k) {
    const e = E[k]; if (!e) return null;
    const filled = k.startsWith('fac') || String(S.x[k] == null ? '' : S.x[k]).trim() !== '';
    return (S.tried[stepOf(k)] || e[1] || filled) ? e : null;
  }
  const lookCls = e => (e ? (e[1] ? 'is-warn' : 'is-err') : '');
  const hintCls = e => (e ? (e[1] ? 'hint warn' : 'hint err') : 'hint');

  // ---------------------------------------------------------------- drafts (new entries only)
  let draftTimer = 0;
  const writeDraft = () => { if (S.view === 'form' && !S.x.id && S.agency) store.set('draft_' + S.agency, S.x); };
  function saveDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(writeDraft, 400); }
  const getDraft = () => { const d = store.get('draft_' + S.agency, null); return d && Array.isArray(d.factories) ? d : null; };

  // ---------------------------------------------------------------- views
  function header() {
    const ctr = { login: 'LOG IN', home: 'MY SITES', done: 'DONE', form: `STEP ${S.step + 1}/4` }[S.view] || '';
    const stepper = S.view === 'form' ? `<div class="stepper">${STEPS.map((s, i) => `<div class="${i <= S.step ? 'on' : ''} ${i === S.step ? 'cur' : ''}"><i></i><span>${esc(s.name)}</span></div>`).join('')}</div>` : '';
    return `<header class="top"><div class="top-row"><div class="top-t"><span class="t">RDF Planning</span><span class="s">${esc(S.agency || 'Legacy waste remediation')}</span></div><span class="ctr">${ctr}</span></div>${stepper}</header>`;
  }

  function loginView() {
    return `<div class="h big"><h2>Agency log in</h2><p>Type your agency name and the 4-digit PIN shared by the Swachh Andhra team.</p></div>
      <label class="fld"><span class="lbl">Agency name</span>
        <input class="in" autocomplete="organization" autocapitalize="words" placeholder="Type your agency name" value="${esc(S.agIn)}" data-login="agency">
        <span class="hint">As registered, e.g. Tharuni Associates. Capital letters don’t matter.</span></label>
      <label class="fld"><span class="lbl">PIN</span>
        <input class="in pin" style="${S.loginErr ? 'border-color:var(--err-line)' : ''}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="••••" value="${esc(S.pinIn)}" data-login="pin"></label>
      ${S.loginErr ? `<div class="err-box">${esc(S.loginErr)}</div>` : ''}
      <button type="button" class="btn" data-act="login" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Checking…' : 'Log in'}</button>`;
  }

  function homeView() {
    const d = getDraft();
    const list = S.entries.map((e, i) => `<div class="entry"><div><b>${esc(e.site)} · ${esc(e.phase)}</b><span>Updated ${fd(String(e.submitted).split(' ')[0])} · ${e.reclaimed === 'yes' ? '100% reclaimed' : `RDF at site ${fmt(e.RDF_bal)} MT`}</span></div><button type="button" class="sm g" data-act="edit-entry" data-i="${i}">Edit</button></div>`).join('');
    return `<div class="row"><h2 class="title">My sites</h2><button type="button" class="sm" data-act="logout">Log out</button></div>
      ${S.err ? `<div class="err-box">${esc(S.err)}</div>` : ''}
      ${d ? `<div class="warnbox"><span>There’s an unsaved entry on this phone (${esc(d.site || 'no site yet')}).</span><div class="acts"><button type="button" class="sm p" data-act="draft-restore">Continue it</button><button type="button" class="sm" data-act="draft-discard">Discard</button></div></div>` : ''}
      <button type="button" class="btn" data-act="new">+ New site / phase entry</button>
      ${list || '<div class="empty">No entries yet. Tap “New site / phase entry” to add your first site.</div>'}
      ${S.entries.length ? '<button type="button" class="btn ghost" data-act="csv">Download all my data (CSV)</button>' : ''}`;
  }

  function fieldHtml(f, E) {
    const e = show(E, f.k), v = S.x[f.k] == null ? '' : S.x[f.k];
    let input;
    if (f.t === 'check') {
      return `<div class="fld full ${lookCls(e)}" data-w="${f.k}"><label class="chk"><input type="checkbox" data-k="${f.k}" ${v === 'yes' ? 'checked' : ''}><span class="box" aria-hidden="true"></span><span class="lbl">${esc(f.l)}</span></label>
        <span class="${hintCls(e)}" data-h="${f.k}">${esc(e ? e[0] : f.h)}</span></div>`;
    }
    if (f.t === 'yesno') input = `<div class="seg" role="group">${['yes', 'no'].map(o => `<button type="button" class="${o} ${v === o ? 'on' : ''}" data-act="yn" data-k="${f.k}" data-v="${o}" aria-pressed="${v === o}">${o === 'yes' ? 'Yes' : 'No'}</button>`).join('')}</div>`;
    else if (f.t === 'num') input = `<div class="unit"><input inputmode="decimal" placeholder="0" value="${esc(v)}" data-k="${f.k}" data-num><span>MT</span></div>`;
    else if (f.t.startsWith('date')) input = `<input class="in" type="date" ${f.t === 'dateMax' ? `max="${today()}"` : ''} value="${esc(v)}" data-k="${f.k}">`;
    else if (f.t === 'area') input = `<textarea class="in" rows="3" placeholder="${esc(f.ph || '')}" data-k="${f.k}">${esc(v)}</textarea>`;
    else input = `<input class="in" list="dl_${f.k}" autocomplete="off" autocapitalize="words" placeholder="${esc(f.ph || '')}" value="${esc(v)}" data-k="${f.k}">`;
    return `<div class="fld ${f.half ? '' : 'full'} ${lookCls(e)}" data-w="${f.k}"><span class="lbl">${esc(f.l)}</span>${input}<span class="${hintCls(e)}" data-h="${f.k}">${esc(e ? e[0] : f.h)}</span></div>`;
  }

  function factoriesHtml(E) {
    const only = S.x.factories.length === 1;
    const rows = S.x.factories.map((f, i) => {
      const e = show(E, 'fac' + i);
      return `<div class="fac ${lookCls(e)}" data-w="fac${i}"><div class="fr">
          <input class="in" list="dl_fac" autocomplete="off" placeholder="Factory name" value="${esc(f.name)}" data-fac="name" data-i="${i}">
          <div class="unit"><input inputmode="decimal" placeholder="0" value="${esc(f.qty)}" data-fac="qty" data-i="${i}" data-num><span>MT</span></div>
          <button type="button" class="x" data-act="fac-remove" data-i="${i}" ${only ? 'disabled' : ''} aria-label="Remove factory">×</button></div>
        <span class="${hintCls(e)}" data-h="fac${i}" ${e ? '' : 'hidden'}>${esc(e ? e[0] : '')}</span></div>`;
    }).join('');
    const n = show(E, 'fac');
    return rows + `<button type="button" class="add" data-act="fac-add">+ Add another factory</button>
      <span class="fac-note ${hintCls(n)}" data-h="fac">${esc(n ? n[0] : FAC_HINT)}</span>`;
  }

  function summaryRows(x) {
    return STEPS.map((s, i) => ({ name: s.name, i, rows: s.cards.flatMap(c => c.factories
      ? x.factories.filter(f => f.name.trim()).map(f => ({ k: f.name, v: fmt(f.qty) + ' MT' }))
      : c.f.map(f => ({ k: f.l, v: f.t === 'num' ? fmt(x[f.k]) + ' MT' : f.t.startsWith('date') ? fd(x[f.k])
        : f.t === 'check' ? (x[f.k] === 'yes' ? 'Yes' : 'No') : f.t === 'yesno' ? ({ yes: 'Yes', no: 'No' }[x[f.k]] || '—')
        : (String(x[f.k] || '').trim() || '—') }))) }));
  }

  function formView() {
    const E = check(S.x);
    const cards = STEPS[S.step].cards.map(c => `<div class="card"><div class="ch"><span class="dot" style="background:var(--dot-${c.dot})"></span><div><b>${esc(c.t)}</b>${c.d ? `<span>${esc(c.d)}</span>` : ''}</div></div>
      ${c.factories ? factoriesHtml(E) : c.f.map(f => fieldHtml(f, E)).join('')}</div>`).join('');
    const review = S.step === 3 ? summaryRows(S.x).map(s => `<div class="rv"><div class="rh"><b>${esc(s.name)}</b><button type="button" class="sm g" data-act="edit-step" data-step="${s.i}">Edit</button></div>
      <div class="rb">${s.rows.map(r => `<div class="kv"><span>${esc(r.k)}</span><b>${esc(r.v)}</b></div>`).join('')}</div></div>`).join('') : '';
    return `<h2 class="title">${esc(STEPS[S.step].name)}</h2>${cards}${review}`;
  }

  function doneView() {
    return `<div class="done"><div class="ok">✓</div><h2>${S.last.edited ? 'Changes saved' : 'Submitted'}</h2><span class="rid">${esc(S.last.id)}</span>
        <p>Saved in the RDF Planning sheet. ${S.last.csvLater ? 'The CSV in Drive updates within a few minutes.' : 'Your CSV in Drive has been updated too.'}</p></div>
      <button type="button" class="btn" data-act="new">+ Add another site / phase</button>
      <div class="note">Report your next site now — you stay logged in.</div>
      <button type="button" class="btn ghost" data-act="csv">Download all my data (CSV)</button>
      <button type="button" class="btn ghost" data-act="pdf">Download PDF</button>
      <button type="button" class="btn plain" data-act="home">Back to my sites</button>`;
  }

  function nav() {
    if (S.view !== 'form') return '';
    const label = S.busy ? 'Submitting…' : S.step === 3 ? (S.x.id ? 'Save changes' : 'Submit') : S.fromReview ? 'Save & back to review' : 'Continue';
    return `<div class="nav"><div id="r-err">${S.err ? `<div class="err-box">${esc(S.err)}</div>` : ''}</div>
      <div class="bar"><button type="button" class="btn back" data-act="back" ${S.busy ? 'disabled' : ''}>Back</button><button type="button" class="btn grow" data-act="next" ${S.busy ? 'disabled' : ''}>${label}</button></div></div>`;
  }

  function datalists() {
    const uniq = a => [...new Set(a.filter(Boolean))].sort((p, q) => p.localeCompare(q));
    const dl = (id, list) => `<datalist id="${id}">${list.map(o => `<option value="${esc(o)}"></option>`).join('')}</datalist>`;
    return dl('dl_site', uniq(S.entries.map(e => e.site))) + dl('dl_phase', uniq(S.entries.map(e => e.phase)))
      + dl('dl_fac', uniq([...S.factories, ...S.x.factories.map(f => f.name.trim())]));
  }

  function render(top) {
    const body = { loading: () => '<div class="loading">Loading…</div>', login: loginView, home: homeView, form: formView, done: doneView }[S.view]();
    const y = window.scrollY;
    app.innerHTML = header() + `<main class="body">${S.view === 'form' ? datalists() : ''}${body}</main>` + nav();
    window.scrollTo(0, top ? 0 : y);
  }

  // Refresh borders + hints in place while typing.
  function refreshLooks() {
    const E = check(S.x);
    app.querySelectorAll('[data-w]').forEach(w => {
      const k = w.dataset.w, e = show(E, k), isFac = k.startsWith('fac');
      w.classList.remove('is-err', 'is-warn'); const c = lookCls(e); if (c) w.classList.add(c);
      const h = app.querySelector(`[data-h="${k}"]`);
      if (h) { h.className = hintCls(e); h.textContent = e ? e[0] : isFac ? '' : def(k).h; h.hidden = isFac && !e; }
    });
    const n = app.querySelector('[data-h="fac"]');
    if (n) { const e = show(E, 'fac'); n.className = 'fac-note ' + hintCls(e); n.textContent = e ? e[0] : FAC_HINT; }
  }
  function setErr(m) { S.err = m; const el = document.getElementById('r-err'); if (el) el.innerHTML = m ? `<div class="err-box">${esc(m)}</div>` : ''; }

  // ---------------------------------------------------------------- network
  async function api(url, opts) {
    let r;
    try { r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...opts }); }
    catch (e) { throw new Error('No internet connection. Check your signal and try again.'); }
    let data = null; try { data = await r.json(); } catch (e) { /* not JSON */ }
    if (r.status === 401 && data && data.auth === false) throw Object.assign(new Error(data.error || 'Please log in again.'), { auth: true });
    if (!data) throw new Error('Server error (' + r.status + '). Try again.');
    if (!data.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function signedIn(d) {
    S.agency = d.agency; S.entries = d.entries || []; S.factories = d.factories || [];
    S.agIn = d.agency; store.set('lastAgency', d.agency);
    S.view = 'home'; S.err = ''; render(true);
  }
  function signedOut(msg) {
    Object.assign(S, { view: 'login', agency: '', entries: [], pinIn: '', loginErr: msg || '', busy: false, err: '' });
    render(true);
  }
  async function boot() {
    try { signedIn(await api(CFG.api.me)); }
    catch (e) { signedOut(e.auth ? '' : e.message); }
  }
  async function login() {
    const a = S.agIn.trim().replace(/\s+/g, ' ');
    if (!a || !/^\d{4}$/.test(S.pinIn)) { S.loginErr = 'Enter your agency name and 4-digit PIN.'; return render(); }
    S.busy = true; S.loginErr = ''; render();
    try { const d = await post(CFG.api.login, { agency: a, pin: S.pinIn }); S.busy = false; S.pinIn = ''; signedIn(d); }
    catch (e) { S.busy = false; S.pinIn = ''; S.loginErr = e.message; render(); }
  }
  async function logout() {
    try { await post(CFG.api.logout, {}); } catch (e) { /* signed out locally anyway */ }
    signedOut('');
  }

  // ---------------------------------------------------------------- form flow
  function openForm(x) {
    S.x = { ...blank(), ...x, factories: x.factories && x.factories.length ? x.factories.map(f => ({ name: String(f.name || ''), qty: String(f.qty == null ? '' : f.qty) })) : [{ name: '', qty: '' }] };
    Object.assign(S, { view: 'form', step: 0, tried: {}, err: '', fromReview: false });
    render(true);
  }
  function goStep(n, fromReview) { S.step = n; S.fromReview = !!fromReview; S.err = ''; render(true); }

  function next() {
    if (S.step === 0) { S.x.site = S.x.site.trim().replace(/\s+/g, ' '); S.x.phase = S.x.phase.trim().replace(/\s+/g, ' '); }
    const E = check(S.x);
    if (S.step === 3) return submit(E);
    const bad = Object.keys(E).filter(k => !E[k][1] && stepOf(k) === S.step);
    if (bad.length) {
      S.tried[S.step] = true;
      S.err = bad.length === 1 ? E[bad[0]][0].replace(/\.$/, '') + ' — see the red note.' : `${bad.length} fields need attention. See the red notes.`;
      return render();
    }
    goStep(S.fromReview ? 3 : S.step + 1);
  }
  function back() {
    if (S.fromReview) return goStep(3);
    if (S.step === 0) { S.view = 'home'; S.err = ''; return render(true); }
    goStep(S.step - 1);
  }

  async function submit(E) {
    const bad = Object.keys(E).filter(k => !E[k][1]);
    if (bad.length) { const st = stepOf(bad[0]); S.tried[st] = true; S.step = st; S.fromReview = false; S.err = 'Please fix the fields in red.'; return render(true); }
    if (navigator.onLine === false) return setErr('No internet connection. Your entry is saved on this phone. Tap Submit again when you’re back online.');
    S.busy = true; S.err = ''; render();
    const entry = { ...S.x, factories: S.x.factories.filter(f => f.name.trim()) };
    try {
      const r = await post(CFG.api.submit, { entry });
      if (!entry.id) { clearTimeout(draftTimer); store.del('draft_' + S.agency); }
      S.entries = r.entries || S.entries; S.factories = r.factories || S.factories;
      S.x = { ...entry, id: r.id };
      S.last = { id: r.id, edited: !!r.edited, csvLater: !!r.csvLater };
      S.busy = false; S.view = 'done'; render(true);
    } catch (e) {
      S.busy = false;
      if (e.auth) return signedOut(e.message);
      S.err = e.message; render();
    }
  }

  function download(href) { const a = document.createElement('a'); a.href = href; document.body.appendChild(a); a.click(); a.remove(); }

  // Printable summary — "Save as PDF" in the phone's print dialog.
  function printPdf() {
    const x = S.x;
    const body = summaryRows(x).map(s => `<h3>${esc(s.name)}</h3><table>${s.rows.map(r => `<tr><th>${esc(r.k)}</th><td>${esc(r.v)}</td></tr>`).join('')}</table>`).join('');
    const html = `<html><head><title>${esc(x.id)}</title><style>body{font-family:Arial,sans-serif;font-size:10.5pt;color:#222;margin:28px}h1{font-size:16pt;margin:0}h3{margin:18px 0 6px;font-size:11.5pt}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top;white-space:pre-wrap}th{width:45%;background:#f1f6f2;font-weight:600}</style></head><body><h1>RDF Planning — ${esc(x.site)} · ${esc(x.phase)}</h1><div>${esc(S.agency)} · ${esc(x.id)} · ${esc(new Date().toLocaleString('en-IN'))}</div>${body}</body></html>`;
    const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'; document.body.appendChild(fr);
    fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
    setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 1500); }, 250);
  }

  // ---------------------------------------------------------------- events
  app.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.login === 'agency') { S.agIn = t.value.slice(0, 80); return; }
    if (t.dataset.login === 'pin') { t.value = t.value.replace(/\D/g, '').slice(0, 4); S.pinIn = t.value; return; }
    if (t.dataset.num !== undefined) { const v = cleanNum(t.value); if (v !== t.value) t.value = v; }
    if (t.type === 'checkbox') S.x[t.dataset.k] = t.checked ? 'yes' : '';
    else if (t.dataset.k) S.x[t.dataset.k] = t.value;
    else if (t.dataset.fac) S.x.factories[Number(t.dataset.i)][t.dataset.fac] = t.value;
    else return;
    setErr(''); refreshLooks(); saveDraft();
  });
  app.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.login) { e.preventDefault(); login(); }
  });
  app.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const i = Number(b.dataset.i);
    switch (b.dataset.act) {
      case 'login': return login();
      case 'logout': return logout();
      case 'new': return openForm(blank());
      case 'home': S.view = 'home'; S.err = ''; return render(true);
      case 'edit-entry': return openForm(JSON.parse(JSON.stringify(S.entries[i])));
      case 'draft-restore': return openForm(getDraft() || blank());
      case 'draft-discard': store.del('draft_' + S.agency); return render();
      case 'next': return next();
      case 'back': return back();
      case 'edit-step': return goStep(Number(b.dataset.step), true);
      case 'fac-add': {
        S.x.factories.push({ name: '', qty: '' }); render(); saveDraft();
        const f = app.querySelectorAll('[data-fac="name"]'); if (f.length) f[f.length - 1].focus();
        return;
      }
      case 'fac-remove': if (S.x.factories.length > 1) { S.x.factories.splice(i, 1); render(); saveDraft(); } return;
      case 'yn': S.x[b.dataset.k] = b.dataset.v; setErr(''); render(); return saveDraft();
      case 'csv': return download(CFG.api.csv);
      case 'pdf': return printPdf();
    }
  });
  window.addEventListener('beforeunload', () => { clearTimeout(draftTimer); writeDraft(); });

  render();
  boot();
})();
