/* RDF_planning — agency form. Reads config from #rdf-config. No build step.
 *
 * Rendering: render() rebuilds the screen on navigation and on clicks.
 * While typing, only the dependent regions (paint(...)) are redrawn so the
 * focused input is never replaced.
 */
(function () {
  'use strict';
  const CFG = JSON.parse(document.getElementById('rdf-config').textContent);
  const app = document.getElementById('app');
  const byId = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => parseFloat(String(v == null ? '' : v).replace(/,/g, '')) || 0;
  const fmt = (n, d = 2) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d });
  const fd = s => { if (!s) return ''; const [y, m, d] = String(s).split('-'); return `${d}-${m}-${y}`; };
  const lc = s => String(s || '').trim().toLowerCase();
  // Pasted numbers often carry +91 / 0 / spaces — keep the 10-digit mobile.
  const mobile = v => { v = String(v).replace(/\D/g, ''); if (v.length > 10 && /^(91|0)/.test(v)) v = v.replace(/^(91|0)/, ''); return v.slice(0, 10); };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const decimal = v => { v = String(v).replace(/[^\d.]/g, ''); const i = v.indexOf('.'); return i < 0 ? v : v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, ''); };
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('rdf_' + k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rdf_' + k, JSON.stringify(v)); } catch (e) { /* quota / private mode */ } },
    del(k) { try { localStorage.removeItem('rdf_' + k); } catch (e) { /* ignore */ } },
  };
  const MAX_FILE = 10 * 1024 * 1024;
  const LABELS = ['Site', 'Work', 'RDF', 'Files', 'Review'];

  // ---------------------------------------------------------------- state
  const S = {
    screen: 'loading',                 // loading | login | form | done
    agencies: [], loginAgency: store.get('lastAgency', ''), pin: '', loginErr: '', busy: false,
    agency: '', sites: [], phases: [], dests: [],
    step: 0, fromReview: false, err: '',
    f: null,
    pending: [], pendingFor: '', pendLoading: false, pendOpen: '', pendQty: '', pendFile: null, pendErr: '', pendBusy: false,
    done: null,
    focus: '',                          // open combobox key
  };
  function blank() {
    return { site: '', phase: '', cluster: '', awarded: '', startDate: '', endDate: '', land: '', rdfGen: '',
      dispatches: [newD()], attachments: [], uploader: store.get('uploader', ''), phone: store.get('phone', '') };
  }
  function newD() { return { id: uid(), dest: '', qty: '', date: '', hasCert: '', certQty: '', file: null }; }

  // Drafts survive a reload or a dropped connection. Files can't be kept, so they are re-attached.
  let draftTimer = 0;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      if (!S.agency || !S.f) return;
      const f = { ...S.f, attachments: [], dispatches: S.f.dispatches.map(d => ({ ...d, file: null })) };
      store.set('draft_' + S.agency, { f, step: S.step });
    }, 400);
  }
  function loadDraft() {
    const d = store.get('draft_' + S.agency, null);
    if (!d || !d.f || !Array.isArray(d.f.dispatches)) return false;
    S.f = { ...blank(), ...d.f, attachments: [] };
    if (!S.f.dispatches.length) S.f.dispatches = [newD()];
    S.step = Math.min(Math.max(Number(d.step) || 0, 0), 4);
    return true;
  }

  // ---------------------------------------------------------------- derived
  function mySites() { return [...S.sites, ...store.get('sites_' + S.agency, [])]; }
  function siteMeta() {
    const f = S.f, s = lc(f.site), p = lc(f.phase);
    const r = mySites().find(x => lc(x.site) === s && lc(x.phase) === p);
    if (r) return { known: true, cluster: r.cluster || '—', awarded: num(r.awarded), awardedStr: fmt(r.awarded) };
    const aw = num(f.awarded);
    return { known: false, cluster: f.cluster.trim() || '—', awarded: aw, awardedStr: aw ? fmt(aw) : '—' };
  }
  function calc(f) {
    const gen = num(f.rdfGen); let disposed = 0, certified = 0;
    f.dispatches.forEach(d => { const q = num(d.qty); disposed += q; if (d.hasCert === 'yes') certified += Math.min(num(d.certQty), q); });
    return { gen, disposed, certified, pending: disposed - certified, atSite: Math.max(gen - disposed, 0), pct: gen ? disposed / gen * 100 : 0 };
  }
  function dStatus(d) {
    const q = num(d.qty), cq = num(d.certQty);
    if (d.hasCert === 'no') return [q ? `${fmt(q)} MT added to Certificate pending automatically. Attach the certificate later from this site.` : 'Will be added to Certificate pending automatically.', 'warn'];
    if (d.hasCert !== 'yes') return null;
    if (!d.certQty) return ['Enter the quantity printed on the certificate.', 'mute'];
    if (cq > q) return [`Certificate (${fmt(cq)} MT) is more than RDF disposed (${fmt(q)} MT). Check the numbers.`, 'bad'];
    if (cq < q) return [`Certificate covers ${fmt(cq)} of ${fmt(q)} MT — ${fmt(q - cq)} MT moves to Certificate pending.`, 'warn'];
    if (!d.file) return ['Quantities match — attach the certificate.', 'mute'];
    return ['Certified — quantities match.', 'ok'];
  }
  function validate(step) {
    const f = S.f;
    if (step === 0) {
      if (!f.site.trim()) return 'Enter the site.';
      if (!f.phase.trim()) return 'Enter the phase.';
      if (!siteMeta().known && num(f.awarded) <= 0) return 'Enter awarded legacy quantity for this new site.';
    }
    if (step === 1) {
      if (!f.startDate) return 'Enter the date work started.';
      if (f.endDate && f.endDate < f.startDate) return 'Work ended date is before work started.';
      if (num(f.rdfGen) <= 0) return 'Enter RDF generated (MT).';
    }
    if (step === 2) {
      for (let i = 0; i < f.dispatches.length; i++) {
        const d = f.dispatches[i], n = `Destination ${i + 1}: `, q = num(d.qty), cq = num(d.certQty);
        if (!d.dest.trim()) return n + 'enter the cement / WtE plant.';
        if (q <= 0) return n + 'enter RDF disposed.';
        if (!d.date) return n + 'enter date disposed.';
        if (!d.hasCert) return n + 'choose Yes or No for certificate.';
        if (d.hasCert === 'yes') {
          if (cq <= 0) return n + 'enter certificate quantity.';
          if (cq > q) return n + 'certificate quantity is more than RDF disposed.';
          if (!d.file) return n + 'attach the certificate.';
        }
      }
      const c = calc(f);
      if (c.disposed > c.gen + 1e-9) return `RDF disposed (${fmt(c.disposed)} MT) is more than RDF generated (${fmt(c.gen)} MT).`;
    }
    if (step === 3) {
      if (!f.uploader.trim()) return 'Enter your name.';
      if (!/^[6-9]\d{9}$/.test(f.phone)) return 'Enter a valid 10-digit mobile number.';
    }
    return '';
  }

  // ---------------------------------------------------------------- combobox options
  function comboOptions(key) {
    const f = S.f;
    if (key === 'site') {
      const ms = mySites(), count = {};
      ms.forEach(r => { count[r.site] = (count[r.site] || 0) + 1; });
      return Object.keys(count).sort((a, b) => a.localeCompare(b)).map(s => ({ label: s, tag: count[s] > 1 ? count[s] + ' phases' : '' }));
    }
    if (key === 'phase') {
      const here = mySites().filter(r => lc(r.site) === lc(f.site)).map(r => r.phase);
      const all = [...new Set([...here, ...S.phases, ...store.get('phases', [])].filter(Boolean))];
      return all.map(p => ({ label: p, tag: here.includes(p) ? 'this site' : '' }))
        .sort((a, b) => (b.tag ? 1 : 0) - (a.tag ? 1 : 0) || a.label.localeCompare(b.label));
    }
    const used = new Set(S.dests.map(lc));
    return [...new Set([...S.dests, ...store.get('dests', [])].filter(Boolean))].sort((a, b) => a.localeCompare(b))
      .map(x => ({ label: x, tag: used.has(lc(x)) ? '' : 'this phone' }));
  }
  function comboValue(key) {
    if (key === 'site') return S.f.site;
    if (key === 'phase') return S.f.phase;
    const d = S.f.dispatches.find(x => 'd:' + x.id === key); return d ? d.dest : '';
  }
  const EMPTY = { site: 'No saved sites — type a name', phase: 'Type a phase', d: 'No saved plants yet — type a name' };
  function comboList(key) {
    const value = comboValue(key), v = lc(value);
    const items = comboOptions(key).filter(o => !v || o.label.toLowerCase().includes(v)).slice(0, 40);
    if (!items.length) return `<div class="opt-empty">${v ? '“' + esc(value) + '” will be saved as new' : EMPTY[key.startsWith('d:') ? 'd' : key]}</div>`;
    return items.map(o => `<button type="button" class="opt${o.label === value ? ' sel' : ''}" data-pick="${esc(key)}" data-val="${esc(o.label)}"><b style="font-weight:400">${esc(o.label)}</b><span>${esc(o.tag)}</span></button>`).join('');
  }
  function combo(key, value, placeholder, attrs) {
    const open = S.focus === key;
    return `<div class="combo" data-combo="${esc(key)}">
      <input class="in" autocomplete="off" autocapitalize="words" placeholder="${esc(placeholder)}" value="${esc(value)}" data-combo-in="${esc(key)}" ${attrs || ''}>
      <button type="button" class="tg" tabindex="-1" data-combo-tg="${esc(key)}" aria-label="Show list">▾</button>
      <div class="list" id="list-${esc(key)}" ${open ? '' : 'hidden'}>${open ? comboList(key) : ''}</div>
    </div>`;
  }
  function openCombo(key) {
    if (S.focus && S.focus !== key) closeCombo();
    S.focus = key;
    const el = byId('list-' + key); if (el) { el.innerHTML = comboList(key); el.hidden = false; }
  }
  function closeCombo() {
    const el = S.focus && byId('list-' + S.focus); if (el) { el.hidden = true; el.innerHTML = ''; }
    S.focus = '';
  }
  function refreshCombo(key) { const el = byId('list-' + key); if (el && !el.hidden) el.innerHTML = comboList(key); }

  // ---------------------------------------------------------------- screens
  function header() {
    const f = S.f, authed = S.screen === 'form' || S.screen === 'done';
    const sub = !authed ? 'Legacy waste remediation' : (f && f.site ? `${S.agency} · ${f.site}` : S.agency);
    const ctr = S.screen === 'login' ? 'LOG IN' : S.screen === 'done' ? 'DONE' : S.screen === 'form' ? `STEP ${S.step + 1}/5` : '';
    const stepper = S.screen === 'form' ? `<div class="stepper">${LABELS.map((l, i) => `<div class="${i <= S.step ? 'on' : ''} ${i === S.step ? 'cur' : ''}"><i></i><span>${l}</span></div>`).join('')}</div>` : '';
    return `<header class="top"><div class="top-row"><div class="top-t"><span class="t">RDF Planning</span><span class="s" id="hsub">${esc(sub)}</span></div><span class="ctr">${ctr}</span></div>${stepper}</header>`;
  }

  function loginView() {
    return `<div class="h big"><h2>Agency log in</h2><p>Select your agency and enter the 4-digit PIN shared by the Swachh Andhra team.</p></div>
      <label class="fld"><span class="lbl">Agency name</span>
        <select class="in" data-login="agency"><option value="">${S.agencies.length ? 'Select agency' : 'Loading agencies…'}</option>${S.agencies.map(a => `<option value="${esc(a)}" ${a === S.loginAgency ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      <label class="fld"><span class="lbl">PIN</span>
        <input class="in pin ${S.loginErr ? 'bad' : ''}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="••••" value="${esc(S.pin)}" data-login="pin"></label>
      ${S.loginErr ? `<div class="err">${esc(S.loginErr)}</div>` : ''}
      <button type="button" class="btn" data-act="login" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Checking…' : 'Log in'}</button>
      <div class="note c">Forgot PIN? Contact the district RDF coordinator.</div>`;
  }

  function metaRegion() {
    const f = S.f, m = siteMeta();
    if (!f.site.trim() || !f.phase.trim()) return '';
    if (m.known) {
      return `<div class="g2"><div class="card meta"><span class="cap">Cluster</span><b>${esc(m.cluster)}</b></div><div class="card meta"><span class="cap">Awarded legacy qty</span><b>${m.awardedStr} MT</b></div></div>`;
    }
    return `<div class="warnbox">New site/phase — enter cluster and awarded quantity. It will be remembered.</div>
      <div class="g2">
        <label class="fld"><span class="lbl">Cluster</span><input class="in" placeholder="Package…" value="${esc(f.cluster)}" data-f="cluster"></label>
        <label class="fld"><span class="lbl">Awarded qty (MT)</span><input class="in" inputmode="decimal" placeholder="0" value="${esc(f.awarded)}" data-f="awarded" data-num></label>
      </div>`;
  }

  function step0() {
    const f = S.f;
    return `<div class="h"><h2>Site details</h2><p>Type the site and phase — pick from the list to reuse a saved name.</p></div>
      <div class="card who"><span class="av">${esc((S.agency || '?')[0])}</span><div class="nm"><span class="cap">Agency</span><b>${esc(S.agency)}</b></div><button type="button" class="sm" data-act="logout">Log out</button></div>
      <div class="fld"><span class="lbl">Site</span>${combo('site', f.site, 'Type site name')}</div>
      <div class="fld"><span class="lbl">Phase</span>${combo('phase', f.phase, 'Type phase, e.g. Phase 3')}</div>
      <div id="r-meta" style="display:flex;flex-direction:column;gap:16px">${metaRegion()}</div>`;
  }

  function step1() {
    const f = S.f;
    return `<div class="h"><h2>Work progress</h2><p>${esc(f.site)} · ${esc(f.phase)}</p></div>
      <div class="g2">
        <label class="fld"><span class="lbl">Work started on</span><input class="in" type="date" value="${esc(f.startDate)}" data-f="startDate"></label>
        <label class="fld"><span class="lbl">Work ended on</span><input class="in" type="date" value="${esc(f.endDate)}" data-f="endDate"></label>
      </div>
      <div class="note" style="margin-top:-8px;font-size:12.5px">Leave “ended on” empty if work is ongoing.</div>
      <label class="fld"><span class="lbl">Land reclaimed (acres)</span><input class="in" inputmode="decimal" placeholder="0.00" value="${esc(f.land)}" data-f="land" data-num></label>
      <label class="fld"><span class="lbl">RDF generated (MT)</span><input class="in" inputmode="decimal" placeholder="Total RDF produced at site" value="${esc(f.rdfGen)}" data-f="rdfGen" data-num></label>
      <div class="info">RDF generated = RDF already sent to cement plants + RDF still at site waiting to be sent. You’ll record where it went on the next step.</div>`;
  }

  function totalsRegion() {
    const c = calc(S.f);
    const t = [['Generated', fmt(c.gen), ''], ['Disposed', fmt(c.disposed), ''], ['At site', fmt(c.atSite), ''],
      ['Disposed %', c.pct.toFixed(1) + '%', c.disposed > c.gen ? 'c-bad' : 'c-green'], ['Certified', fmt(c.certified), 'c-green'],
      ['Cert pending', fmt(c.pending), c.pending > 0 ? 'c-warn' : '']];
    return t.map(([k, v, cl]) => `<div><span>${k}</span><b class="${cl}">${v}</b></div>`).join('');
  }

  function pendingRegion() {
    if (S.pendLoading) return `<div class="note">Checking earlier entries for ${esc(S.f.site)}…</div>`;
    if (!S.pending.length) return '';
    const items = S.pending.map(p => {
      const key = p.recordId + '|' + p.line, open = S.pendOpen === key;
      return `<div class="pi">
        <div class="row"><div><b>${esc(p.dest)}</b><span>${fmt(p.pending)} MT pending · sent ${esc(fd(p.date))} · ${esc(p.recordId)}</span></div>${open ? '' : `<button type="button" class="sm" data-act="pend-open" data-key="${esc(key)}">Add certificate</button>`}</div>
        ${open ? `<div class="g2"><input class="in" inputmode="decimal" placeholder="Cert qty (MT)" value="${esc(S.pendQty)}" data-pend="qty" data-num>
            <label class="pfile">${esc(S.pendFile ? S.pendFile.name : 'Attach file')}<input type="file" class="hide" accept="application/pdf,image/*" data-file="pend"></label></div>
          ${S.pendErr ? `<div class="perr">${esc(S.pendErr)}</div>` : ''}
          <div class="acts"><button type="button" class="sm t" data-act="pend-cancel">Cancel</button><button type="button" class="sm p" data-act="pend-save" ${S.pendBusy ? 'disabled' : ''}>${S.pendBusy ? 'Saving…' : 'Save certificate'}</button></div>` : ''}
      </div>`;
    }).join('');
    return `<div class="pend"><div class="ph"><b>Waiting for co-processing certificate</b><span>Earlier entries for ${esc(S.f.site)}. Attach the certificate when the plant issues it.</span></div>${items}</div>`;
  }

  function badge(d) {
    const st = dStatus(d);
    return st ? `<div class="badge ${st[1]}">${esc(st[0])}</div>` : '';
  }

  function dCard(d, i, many) {
    const yes = d.hasCert === 'yes', no = d.hasCert === 'no';
    return `<div class="dcard" data-i="${i}">
      <div class="dh"><span>Destination ${i + 1}</span>${many ? `<button type="button" class="sm x" data-act="d-remove" data-i="${i}">Remove</button>` : ''}</div>
      <div class="fld"><span class="lbl">Destination (cement / WtE plant)</span>${combo('d:' + d.id, d.dest, 'Type plant name, location')}<span class="note">New names are remembered for next time.</span></div>
      <div class="g2">
        <label class="fld"><span class="lbl">RDF disposed (MT)</span><input class="in" inputmode="decimal" placeholder="0.00" value="${esc(d.qty)}" data-d="qty" data-i="${i}" data-num></label>
        <label class="fld"><span class="lbl">Date disposed</span><input class="in" type="date" value="${esc(d.date)}" data-d="date" data-i="${i}"></label>
      </div>
      <div class="fld"><span class="lbl">Co-processing certificate received?</span>
        <div class="seg"><button type="button" class="yes ${yes ? 'on' : ''}" data-act="d-yes" data-i="${i}">Yes</button><button type="button" class="no ${no ? 'on' : ''}" data-act="d-no" data-i="${i}">No</button></div></div>
      ${yes ? `<label class="fld"><span class="lbl">Quantity on certificate (MT)</span><input class="in" inputmode="decimal" placeholder="As printed on certificate" value="${esc(d.certQty)}" data-d="certQty" data-i="${i}" data-num></label>
        <label class="cfile ${d.file ? 'has' : ''}"><span class="ic">${d.file ? '✓' : '↑'}</span><span class="tx"><b>${esc(d.file ? d.file.name : 'Attach co-processing certificate')}</b><span>PDF or photo · saved to RDF Certificates</span></span>
          <input type="file" class="hide" accept="application/pdf,image/*" data-file="cert" data-i="${i}"></label>` : ''}
      <div id="badge-${i}">${badge(d)}</div>
    </div>`;
  }

  function step2() {
    const f = S.f;
    return `<div class="h"><h2>RDF disposed</h2><p>Add each cement / WtE plant the RDF was sent to.</p></div>
      <div class="totals" id="r-totals">${totalsRegion()}</div>
      <div id="r-pending">${pendingRegion()}</div>
      ${f.dispatches.map((d, i) => dCard(d, i, f.dispatches.length > 1)).join('')}
      <button type="button" class="add" data-act="d-add"><b>+</b>Add another destination</button>`;
  }

  function step3() {
    const f = S.f;
    return `<div class="h"><h2>Attachments &amp; contact</h2><p>Site photos, weighbridge slips or any other document.</p></div>
      ${f.attachments.map((a, i) => `<div class="card att"><span class="ext">${esc((a.name.split('.').pop() || '').slice(0, 4).toUpperCase())}</span><span class="nm">${esc(a.name)}</span><button type="button" data-act="att-remove" data-i="${i}" aria-label="Remove">×</button></div>`).join('')}
      <label class="addfile"><b>+</b>Add attachments<input type="file" class="hide" multiple data-file="att"></label>
      <div class="rule"></div>
      <label class="fld"><span class="lbl">Uploaded by</span><input class="in" placeholder="Full name" autocomplete="name" value="${esc(f.uploader)}" data-f="uploader"></label>
      <label class="fld"><span class="lbl">Uploader phone number</span>
        <span class="phone"><span>+91</span><input type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="10-digit mobile" value="${esc(f.phone)}" data-f="phone"></span></label>`;
  }

  function step4() {
    const f = S.f, c = calc(f), m = siteMeta();
    const green = 'c-green', warn = 'c-warn';
    const sec = (title, n, rows) => `<div class="rv"><div class="rh"><b>${title}</b><button type="button" class="sm g" data-act="edit" data-step="${n}">Edit</button></div>
      <div class="rb">${rows.map(([k, v, cl]) => `<div class="kv"><span>${esc(k)}</span><b class="${cl || ''}">${esc(v)}</b></div>`).join('')}</div></div>`;
    return `<div class="h"><h2>Review &amp; submit</h2><p>Tap Edit on any section to change it.</p></div>
      ${sec('Site details', 0, [['Agency', S.agency], ['Site', f.site], ['Cluster', m.cluster], ['Phase', f.phase], ['Awarded legacy qty', m.awardedStr + ' MT']])}
      ${sec('Work progress', 1, [['Work started on', fd(f.startDate)], ['Work ended on', fd(f.endDate) || 'Ongoing'], ['Land reclaimed', fmt(f.land) + ' acres'], ['RDF generated', fmt(c.gen) + ' MT']])}
      ${sec('RDF disposed', 2, [
        ...f.dispatches.map(d => {
          const full = d.hasCert === 'yes' && num(d.certQty) >= num(d.qty);
          return [d.dest || '—', `${fmt(d.qty)} MT · ${fd(d.date)} · ${d.hasCert === 'yes' ? (full ? 'cert ✓' : 'part cert') : 'cert pending'}`, full ? green : warn];
        }),
        ['RDF disposed %', c.pct.toFixed(1) + '%'], ['Certified RDF', fmt(c.certified) + ' MT', green],
        ['Certificate pending', fmt(c.pending) + ' MT', c.pending > 0 ? warn : ''], ['RDF at site', fmt(c.atSite) + ' MT']])}
      ${sec('Attachments & contact', 3, [['Attachments', f.attachments.length ? f.attachments.length + ' file(s)' : 'None'], ['Uploaded by', f.uploader], ['Phone', '+91 ' + f.phone]])}`;
  }

  function doneView() {
    const d = S.done;
    const msg = d.pending > 0
      ? `${fmt(d.pending)} MT is in Certificate pending. Open this form for ${d.site} when the plant issues the certificate.`
      : 'All RDF disposed in this entry is certified.';
    const rows = [['RDF_plan', `1 row · status ${d.pending > 0 ? 'Certificate pending' : 'Complete'}`], ['RDF_dispatch', `${d.dispatchCount} row(s)`],
      ['Records folder', d.recordsPath], ['Certificates folder', d.certsPath]];
    return `<div class="done"><div class="ok">✓</div><h2>Submitted</h2><span class="rid">${esc(d.id)}</span><p>${esc(msg)}</p></div>
      <div class="dl">${rows.map(([k, v]) => `<div><span class="cap">${esc(k)}</span><code>${esc(v)}</code></div>`).join('')}</div>
      <button type="button" class="btn" data-act="pdf">Download PDF</button>
      <button type="button" class="btn sec" data-act="csv"><span>Download all my data (CSV)</span><small>${d.csvRows} rows · all ${esc(S.agency)} entries</small></button>
      <button type="button" class="btn ghost" data-act="new">New entry</button>`;
  }

  function nav() {
    if (S.screen !== 'form') return '';
    const label = S.busy ? 'Submitting…' : S.step === 4 ? 'Submit' : S.fromReview ? 'Save & back to review' : 'Continue';
    return `<div class="nav"><div id="r-err">${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}</div>
      <div class="bar">${S.step > 0 ? `<button type="button" class="btn back" data-act="back" ${S.busy ? 'disabled' : ''}>Back</button>` : ''}<button type="button" class="btn grow" data-act="next" ${S.busy ? 'disabled' : ''}>${label}</button></div></div>`;
  }

  function render(scrollTop) {
    let body;
    if (S.screen === 'loading') body = '<div class="loading">Loading…</div>';
    else if (S.screen === 'login') body = loginView();
    else if (S.screen === 'done') body = doneView();
    else body = [step0, step1, step2, step3, step4][S.step]();
    const y = window.scrollY;
    app.innerHTML = header() + `<main class="body">${body}</main>` + nav();
    window.scrollTo(0, scrollTop ? 0 : y);
  }
  function paint(id, html) { const el = byId(id); if (el) el.innerHTML = html; }
  function setErr(msg) { S.err = msg; paint('r-err', msg ? `<div class="err">${esc(msg)}</div>` : ''); }

  // ---------------------------------------------------------------- network
  async function api(url, opts) {
    let r;
    try { r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...opts }); }
    catch (e) { throw new Error('No connection. Check your signal and try again.'); }
    let data = null; try { data = await r.json(); } catch (e) { /* not JSON */ }
    if (r.status === 401 && data && data.auth === false) throw Object.assign(new Error(data.error || 'Please log in again.'), { auth: true });
    if (r.status === 413) throw new Error((data && data.error) || 'Files are too large. Remove some or use smaller photos.');
    if (!data) throw new Error('Server error (' + r.status + '). Try again.');
    if (!data.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function signedIn(data) {
    S.agency = data.agency; S.sites = data.sites || []; S.phases = data.phases || []; S.dests = data.destinations || [];
    store.set('lastAgency', S.agency);
    S.f = blank(); S.step = 0; S.fromReview = false; S.err = ''; S.done = null;
    S.pending = []; S.pendingFor = ''; S.pendOpen = '';
    if (loadDraft()) {
      const files = S.f.dispatches.some(d => d.hasCert === 'yes');
      S.err = 'Your unsent entry was restored.' + (files ? ' Attach the certificates again before submitting.' : '');
    }
    S.screen = 'form'; render(true);
    if (S.step === 2) loadPending();
  }
  function signedOut(msg) {
    S.screen = 'login'; S.agency = ''; S.f = null; S.pin = ''; S.loginErr = msg || ''; S.busy = false; S.focus = '';
    render(true);
    if (!S.agencies.length) loadAgencies();
  }
  async function loadAgencies() {
    try { const d = await api(CFG.api.agencies); S.agencies = d.agencies || []; if (!S.agencies.includes(S.loginAgency)) S.loginAgency = ''; }
    catch (e) { S.loginErr = e.message; }
    if (S.screen === 'login') render();
  }
  async function boot() {
    try { signedIn(await api(CFG.api.me)); }
    catch (e) { signedOut(e.auth ? '' : e.message); }
  }
  async function login() {
    const a = S.loginAgency, pin = S.pin;
    if (!a) { S.loginErr = 'Select your agency.'; return render(); }
    if (!/^\d{4}$/.test(pin)) { S.loginErr = 'Enter your 4-digit PIN.'; return render(); }
    S.busy = true; S.loginErr = ''; render();
    try { const d = await post(CFG.api.login, { agency: a, pin }); S.busy = false; S.pin = ''; signedIn(d); }
    catch (e) { S.busy = false; S.pin = ''; S.loginErr = e.message; render(); }
  }
  async function logout() {
    try { await post(CFG.api.logout, {}); } catch (e) { /* signed out locally anyway */ }
    signedOut('');
  }

  async function loadPending() {
    const site = S.f.site.trim(), key = lc(site);
    if (!site || S.pendingFor === key) return;
    S.pendingFor = key; S.pendLoading = true; S.pending = []; paint('r-pending', pendingRegion());
    try { const d = await api(CFG.api.pending + '?site=' + encodeURIComponent(site)); if (S.pendingFor === key) S.pending = d.pending || []; }
    catch (e) { if (e.auth) return signedOut(e.message); S.pendingFor = ''; }
    S.pendLoading = false;
    if (S.screen === 'form' && S.step === 2) paint('r-pending', pendingRegion());
  }
  async function savePending() {
    const p = S.pending.find(x => x.recordId + '|' + x.line === S.pendOpen), q = num(S.pendQty);
    if (!p) return;
    if (q <= 0) S.pendErr = 'Enter the certificate quantity.';
    else if (q > p.pending + 1e-9) S.pendErr = `Only ${fmt(p.pending)} MT is pending for this entry.`;
    else if (!S.pendFile) S.pendErr = 'Attach the certificate.';
    else S.pendErr = '';
    if (S.pendErr) return paint('r-pending', pendingRegion());
    S.pendBusy = true; paint('r-pending', pendingRegion());
    try {
      const file = await toPayload(S.pendFile);
      const d = await post(CFG.api.certificate, { recordId: p.recordId, line: p.line, certQty: q, file });
      S.pending = d.pending || []; S.pendOpen = ''; S.pendQty = ''; S.pendFile = null;
    } catch (e) {
      if (e.auth) { S.pendBusy = false; return signedOut(e.message); }
      S.pendErr = e.message;
    }
    S.pendBusy = false; paint('r-pending', pendingRegion());
  }

  // Photos are shrunk on the phone (max 1600px JPEG) so uploads work on weak signal.
  function readB64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Could not read ' + (blob.name || 'file'))); r.readAsDataURL(blob); });
  }
  function shrink(file) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        cv.toBlob(b => resolve(b && b.size < file.size ? b : null), 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  async function toPayload(file) {
    let blob = file, name = file.name, type = file.type || 'application/octet-stream';
    if (/^image\/(jpeg|png|webp|heic|heif)$/.test(type) && file.size > 400 * 1024) {
      const small = await shrink(file);
      if (small) { blob = small; type = 'image/jpeg'; name = name.replace(/\.[^.]+$/, '') + '.jpg'; }
    }
    return { name, mimeType: type, data: await readB64(blob) };
  }

  async function submit() {
    for (let s = 0; s < 4; s++) { const e = validate(s); if (e) { S.step = s; S.fromReview = false; S.err = e; return render(true); } }
    const f = S.f, m = siteMeta();
    S.busy = true; S.err = ''; render();
    try {
      const dispatches = [];
      for (const d of f.dispatches) {
        dispatches.push({ dest: d.dest.trim(), qty: d.qty, date: d.date, hasCert: d.hasCert,
          certQty: d.hasCert === 'yes' ? d.certQty : '', certFile: d.hasCert === 'yes' && d.file ? await toPayload(d.file) : null });
      }
      const attachments = [];
      for (const a of f.attachments) attachments.push(await toPayload(a));
      const record = { site: f.site.trim(), phase: f.phase.trim(), cluster: m.known ? '' : f.cluster.trim(), awarded: m.known ? '' : f.awarded,
        startDate: f.startDate, endDate: f.endDate, land: f.land, rdfGen: f.rdfGen, uploader: f.uploader.trim(), phone: f.phone, dispatches, attachments };
      const body = JSON.stringify({ record });
      if (body.length > CFG.maxBodyBytes) throw new Error(`Files are too large together (${(body.length / 1048576).toFixed(1)} MB). Remove some or use smaller photos.`);
      const res = await api(CFG.api.submit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

      // Remember names for the dropdowns next time.
      store.set('uploader', f.uploader.trim()); store.set('phone', f.phone);
      store.set('dests', [...new Set([...store.get('dests', []), ...dispatches.map(d => d.dest)])]);
      store.set('phases', [...new Set([...store.get('phases', []), res.phase])]);
      const k = x => lc(x.site) + '|' + lc(x.phase);
      const ns = { site: res.site, phase: res.phase, cluster: m.cluster === '—' ? '' : m.cluster, awarded: m.awarded };
      store.set('sites_' + S.agency, [...store.get('sites_' + S.agency, []).filter(x => k(x) !== k(ns)), ns]);
      S.dests = [...new Set([...S.dests, ...dispatches.map(d => d.dest)])];
      store.del('draft_' + S.agency);

      S.done = { ...res, dispatchCount: dispatches.length };
      S.busy = false; S.screen = 'done'; render(true);
    } catch (e) {
      S.busy = false;
      if (e.auth) return signedOut(e.message);
      S.err = e.message; render();
    }
  }

  function download(href, name) {
    const a = document.createElement('a'); a.href = href; if (name) a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function downloadPdf() {
    const bin = atob(S.done.pdfData || ''), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    download(url, S.done.pdfName || S.done.id + '.pdf');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---------------------------------------------------------------- navigation
  function goStep(n, fromReview) {
    S.step = n; S.fromReview = !!fromReview; S.err = ''; S.focus = ''; S.pendOpen = '';
    render(true); saveDraft();
    if (n === 2) loadPending();
  }
  function next() {
    if (S.step === 4) return submit();
    const e = validate(S.step);
    if (e) return setErr(e);
    goStep(S.fromReview ? 4 : S.step + 1);
  }
  function back() { goStep(S.fromReview ? 4 : S.step - 1); }

  function pickCombo(key, val) {
    const input = document.querySelector(`[data-combo-in="${CSS.escape(key)}"]`);
    if (input) input.value = val;
    setComboValue(key, val);
    closeCombo();
  }
  function setComboValue(key, val) {
    const f = S.f;
    if (key === 'site') {
      f.site = val;
      const ph = mySites().filter(r => lc(r.site) === lc(val)).map(r => r.phase);
      if (ph.length === 1 && f.phase !== ph[0]) { f.phase = ph[0]; const pi = document.querySelector('[data-combo-in="phase"]'); if (pi) pi.value = ph[0]; }
      paint('hsub', esc(val.trim() ? `${S.agency} · ${val.trim()}` : S.agency));
      S.pendingFor = '';
    } else if (key === 'phase') f.phase = val;
    else { const d = f.dispatches.find(x => 'd:' + x.id === key); if (d) d.dest = val; }
    if (key === 'site' || key === 'phase') paint('r-meta', metaRegion());
    setErr(''); saveDraft();
  }

  function addFiles(files) {
    const list = [...(files || [])];
    const big = list.find(fl => fl.size > MAX_FILE && !/^image\//.test(fl.type));
    if (big) { alert(`${big.name} is larger than 10 MB. Use a smaller file.`); return list.filter(fl => fl !== big); }
    return list;
  }

  // ---------------------------------------------------------------- events
  app.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.num !== undefined) { const v = decimal(t.value); if (v !== t.value) t.value = v; }
    if (t.dataset.login === 'pin') { t.value = t.value.replace(/\D/g, '').slice(0, 4); S.pin = t.value; return; }
    if (t.dataset.comboIn) { setComboValue(t.dataset.comboIn, t.value); if (S.focus !== t.dataset.comboIn) openCombo(t.dataset.comboIn); else refreshCombo(t.dataset.comboIn); return; }
    if (t.dataset.f) {
      let v = t.value;
      if (t.dataset.f === 'phone') { v = mobile(v); if (v !== t.value) t.value = v; }
      S.f[t.dataset.f] = v; setErr(''); saveDraft(); return;
    }
    if (t.dataset.d) {
      const i = Number(t.dataset.i), d = S.f.dispatches[i]; if (!d) return;
      d[t.dataset.d] = t.value;
      paint('r-totals', totalsRegion()); paint('badge-' + i, badge(d)); setErr(''); saveDraft(); return;
    }
    if (t.dataset.pend === 'qty') { S.pendQty = t.value; return; }
  });

  app.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.login === 'agency') { S.loginAgency = t.value; S.loginErr = ''; return; }
    if (!t.dataset.file) return;
    const files = addFiles(t.files);
    t.value = '';
    if (!files.length) return;
    if (t.dataset.file === 'cert') { S.f.dispatches[Number(t.dataset.i)].file = files[0]; setErr(''); render(); }
    else if (t.dataset.file === 'att') { S.f.attachments = [...S.f.attachments, ...files].slice(0, 10); render(); }
    else if (t.dataset.file === 'pend') { S.pendFile = files[0]; S.pendErr = ''; paint('r-pending', pendingRegion()); }
  });

  app.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.login === 'pin') { e.preventDefault(); login(); }
    if (e.key === 'Escape' && S.focus) closeCombo();
  });

  // Combobox: open on focus, close shortly after blur; picks use mousedown so the input keeps focus.
  app.addEventListener('focusin', e => { const k = e.target.dataset && e.target.dataset.comboIn; if (k) openCombo(k); });
  app.addEventListener('focusout', e => {
    const k = e.target.dataset && e.target.dataset.comboIn; if (!k) return;
    setTimeout(() => { if (S.focus === k && !(document.activeElement && document.activeElement.dataset.comboIn === k)) closeCombo(); }, 150);
  });
  app.addEventListener('mousedown', e => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { e.preventDefault(); pickCombo(pick.dataset.pick, pick.dataset.val); return; }
    const tg = e.target.closest('[data-combo-tg]');
    if (tg) {
      e.preventDefault(); const k = tg.dataset.comboTg;
      if (S.focus === k) closeCombo(); else { const inp = document.querySelector(`[data-combo-in="${CSS.escape(k)}"]`); if (inp) inp.focus(); openCombo(k); }
    }
  });

  app.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const i = Number(b.dataset.i), f = S.f;
    switch (b.dataset.act) {
      case 'login': return login();
      case 'logout': return logout();
      case 'next': return next();
      case 'back': return back();
      case 'edit': return goStep(Number(b.dataset.step), true);
      case 'd-add': {
        f.dispatches.push(newD()); render(); saveDraft();
        const cards = app.querySelectorAll('.dcard'); const last = cards[cards.length - 1];
        if (last) last.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      case 'd-remove': f.dispatches.splice(i, 1); S.err = ''; render(); return saveDraft();
      case 'd-yes': f.dispatches[i].hasCert = 'yes'; S.err = ''; render(); return saveDraft();
      case 'd-no': Object.assign(f.dispatches[i], { hasCert: 'no', certQty: '', file: null }); S.err = ''; render(); return saveDraft();
      case 'att-remove': f.attachments.splice(i, 1); return render();
      case 'pend-open': {
        const p = S.pending.find(x => x.recordId + '|' + x.line === b.dataset.key);
        S.pendOpen = b.dataset.key; S.pendQty = p ? String(p.pending) : ''; S.pendFile = null; S.pendErr = '';
        return paint('r-pending', pendingRegion());
      }
      case 'pend-cancel': S.pendOpen = ''; S.pendErr = ''; return paint('r-pending', pendingRegion());
      case 'pend-save': return savePending();
      case 'pdf': return downloadPdf();
      case 'csv': return download(CFG.api.csv);
      case 'new': S.f = blank(); S.step = 0; S.done = null; S.err = ''; S.fromReview = false; S.pendingFor = ''; S.screen = 'form'; return render(true);
    }
  });

  window.addEventListener('beforeunload', () => { if (S.screen === 'form') { clearTimeout(draftTimer); draftTimer = 0; const f = S.f; if (f) store.set('draft_' + S.agency, { f: { ...f, attachments: [], dispatches: f.dispatches.map(d => ({ ...d, file: null })) }, step: S.step }); } });

  render();
  boot();
})();
