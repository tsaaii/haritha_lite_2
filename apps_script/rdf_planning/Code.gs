// RDF Planning — Apps Script backend (bound to the "Haritha RDF Planning" sheet).
// Called ONLY by advitiaum.com (views/rdf.py) over HTTPS POST with a shared TOKEN.
//
// The PIN is checked once, at login. After that Flask keeps the agency in its
// signed session and sends it with the TOKEN, so `agency` on every other action
// can be trusted — only Flask knows TOKEN.
//
// Sheet tabs:
//   Sites         Phase_data.csv imported as-is (agency_name, site_name, phase, cluster, target_mt …)
//   RDF_plan      one row per submission          (created by setup)
//   RDF_dispatch  one row per destination          (created by setup)
//   All_RDF_data  every agency, one row per destination, the 20 CSV columns (rebuilt on every change)
// Drive (under ROOT_FOLDER_ID):
//   RDF Planning Records/All_agencies_RDF_data.csv  same rows as All_RDF_data
//   RDF Planning Records/<Agency>/<Agency>_RDF_data.csv
//   RDF Planning Records/<Agency>/<Phase>/<Site>/   submission PDF + other attachments
//   RDF Certificates/<Agency>/<Site>/<Phase>/       co-processing certificates

const CONFIG = {
  TOKEN: 'CHANGE-ME-long-random-string',   // must equal RDF_SCRIPT_TOKEN in app.yaml
  ROOT_FOLDER_ID: '',                      // Drive folder "Haritha RDF" — the part after /folders/ in its URL
  TZ: 'Asia/Kolkata',
  MAX_PIN_TRIES: 5,                        // wrong PINs before the agency is locked out …
  LOCK_MINUTES: 15,                        // … for this long
  MAX_FILE_MB: 15,
};

// One PIN or password per agency (4–32 characters, no spaces, keep the quotes).
// Run makePins() once, paste the logged block over this one, then
// Deploy › Manage deployments › Edit › New version.
// Only agencies listed here appear in the login dropdown.
const AGENCY_PINS = {
  // 'Tharuni Associates': '1234',
};

const PLAN_HEAD = ['Record ID', 'Submitted at', 'Agency Name', 'Site', 'Cluster', 'Phase',
  'Awarded Legacy Qty (MT)', 'Work started on', 'Work ended on', 'Land reclaimed (acres)',
  'RDF generated (MT)', 'RDF disposed (MT)', 'RDF disposed %', 'Certified RDF (MT)',
  'Certificate pending (MT)', 'RDF at site (MT)', 'RDF sent to', 'Status',
  'Records folder', 'Submission PDF', 'Other attachments', 'Uploaded by', 'Uploader phone'];
const DISP_HEAD = ['Record ID', 'Agency', 'Site', 'Phase', 'Destination',
  'RDF disposed (MT)', 'Date disposed', 'Certificate', 'Cert qty (MT)',
  'Pending qty (MT)', 'Cert status', 'Certificate file', 'Entered at', 'Line'];
const CSV_HEAD = ['Record ID', 'Submitted at', 'Agency', 'Site', 'Cluster', 'Phase',
  'Awarded Legacy Qty (MT)', 'Work started on', 'Work ended on', 'Land reclaimed (acres)',
  'RDF generated (MT)', 'Destination', 'RDF disposed (MT)', 'Date disposed', 'Certificate',
  'Cert qty (MT)', 'Pending qty (MT)', 'Cert status', 'Uploaded by', 'Uploader phone'];

const PENDING = 'Certificate pending';
const BUILD = '2026-09-26c';   // shown by doGet — bump when you change this file

// ---------- HTTP ----------
function doGet() {
  // Open the /exec URL in a browser to see which code the live deployment runs.
  const has = n => { try { return typeof eval(n) === 'function'; } catch (e) { return false; } };
  return json_({ ok: true, service: 'rdf_planning', build: BUILD, note: 'POST only',
    functions: ['agencies_', 'checkPin_', 'submit_', 'allData_'].filter(n => !has(n)).length ? 'MISSING — paste the whole Code.gs again' : 'all present',
    agencies: has('agencies_') ? agencies_().length : 0 });
}

function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!CONFIG.TOKEN || CONFIG.TOKEN.indexOf('CHANGE-ME') === 0 || body.token !== CONFIG.TOKEN) {
      throw new Error('Unauthorised.');
    }
    const agency = String(body.agency || '');
    switch (body.action) {
      case 'agencies':    out = { agencies: agencies_() }; break;
      case 'login':       checkPin_(agency, body.pin); out = bootstrap_(agency); break;
      case 'bootstrap':   knownAgency_(agency); out = bootstrap_(agency); break;
      case 'pending':     knownAgency_(agency); out = { pending: pending_(agency, body.site) }; break;
      case 'submit':      knownAgency_(agency); out = submit_(agency, body.record || {}); break;
      case 'certificate': knownAgency_(agency); out = addCertificate_(agency, body); break;
      case 'csv':         knownAgency_(agency); out = { csv: agencyCsv_(agency) }; break;
      default: throw new Error('Unknown action.');
    }
    out.ok = true;
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return json_(out);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- PIN login ----------
const PIN_RE = /^\S{4,32}$/;
function pinOf_(agency) {
  return Object.prototype.hasOwnProperty.call(AGENCY_PINS, agency) ? String(AGENCY_PINS[agency]) : '';
}

function agencies_() {
  return Object.keys(AGENCY_PINS).filter(a => PIN_RE.test(pinOf_(a))).sort();
}

function knownAgency_(agency) {
  if (!PIN_RE.test(pinOf_(agency))) {
    throw new Error('Unknown agency.');
  }
}

function checkPin_(agency, pin) {
  knownAgency_(agency);
  const cache = CacheService.getScriptCache();
  const key = 'pinfail_' + Utilities.base64EncodeWebSafe(agency);
  const fails = Number(cache.get(key) || 0);
  if (fails >= CONFIG.MAX_PIN_TRIES) {
    throw new Error('Too many wrong PINs. Try again in ' + CONFIG.LOCK_MINUTES + ' minutes.');
  }
  if (String(pin) !== pinOf_(agency)) {
    cache.put(key, String(fails + 1), CONFIG.LOCK_MINUTES * 60);
    throw new Error('Wrong PIN for ' + agency + '. Try again.');
  }
  cache.remove(key);
}

// Everything the form needs after login — only this agency's sites.
function bootstrap_(agency) {
  return { agency: agency, sites: sitesFor_(agency), phases: phases_(), destinations: destinations_() };
}

// ---------- masters ----------
// Sites tab (Phase_data.csv) plus any new site/phase this agency entered before.
function sitesFor_(agency) {
  const out = [], seen = {};
  const add = (site, phase, cluster, awarded) => {
    site = clean_(site); phase = clean_(phase);
    const k = lc_(site) + '|' + lc_(phase);
    if (!site || !phase || seen[k]) return;
    seen[k] = true;
    out.push({ site: site, phase: phase, cluster: clean_(cluster), awarded: num_(awarded) });
  };
  rows_('Sites').forEach(r => { if (clean_(r.agency_name) === agency) add(r.site_name, r.phase, r.cluster, r.target_mt); });
  rows_('RDF_plan').forEach(r => { if (r['Agency Name'] === agency) add(r['Site'], r['Phase'], r['Cluster'], r['Awarded Legacy Qty (MT)']); });
  return out;
}

function phases_() {
  const s = {};
  rows_('Sites').forEach(r => { const p = clean_(r.phase); if (p) s[p] = 1; });
  rows_('RDF_plan').forEach(r => { const p = clean_(r['Phase']); if (p) s[p] = 1; });
  return Object.keys(s).sort();
}

function destinations_() {
  const s = {};
  rows_('RDF_dispatch').forEach(r => { const d = clean_(r['Destination']); if (d) s[d] = 1; });
  return Object.keys(s).sort();
}

// Earlier destinations for this site still waiting for a co-processing certificate.
function pending_(agency, site) {
  const want = lc_(site);
  return rows_('RDF_dispatch')
    .filter(r => r['Agency'] === agency && lc_(r['Site']) === want && num_(r['Pending qty (MT)']) > 0)
    .map(r => ({
      recordId: String(r['Record ID']), line: Number(r['Line']) || 0, dest: String(r['Destination']),
      qty: num_(r['RDF disposed (MT)']), pending: num_(r['Pending qty (MT)']), date: iso_(r['Date disposed']),
    }));
}

// ---------- submit ----------
function submit_(agency, r) {
  const site0 = clean_(r.site), phase0 = clean_(r.phase);
  if (!site0) throw new Error('Enter the site.');
  if (!phase0) throw new Error('Enter the phase.');
  // Reuse the saved spelling so "kadapa" and "Kadapa" land in one folder.
  const known = sitesFor_(agency).filter(x => lc_(x.site) === lc_(site0) && lc_(x.phase) === lc_(phase0))[0];
  const site = known ? known.site : site0, phase = known ? known.phase : phase0;
  const cluster = known ? known.cluster : clean_(r.cluster);
  const awarded = known ? known.awarded : positive_(r.awarded, 'Awarded legacy quantity');

  const start = date_(r.startDate, 'Work started on');
  const end = r.endDate ? date_(r.endDate, 'Work ended on') : null;
  if (end && end < start) throw new Error('Work ended date is before work started.');
  const land = nonNeg_(r.land, 'Land reclaimed');
  const gen = positive_(r.rdfGen, 'RDF generated');
  const uploader = clean_(r.uploader), phone = clean_(r.phone).replace(/\D/g, '');
  if (!uploader) throw new Error('Enter your name.');
  if (!/^[6-9]\d{9}$/.test(phone)) throw new Error('Enter a valid 10-digit mobile number.');

  const list = Array.isArray(r.dispatches) ? r.dispatches : [];
  if (!list.length) throw new Error('Add at least one destination.');
  if (list.length > 30) throw new Error('Too many destinations in one entry.');
  const ds = list.map((d, i) => {
    const n = 'Destination ' + (i + 1) + ': ';
    const dest = clean_(d.dest).slice(0, 150);
    if (!dest) throw new Error(n + 'enter the plant name.');
    const qty = positive_(d.qty, n + 'RDF disposed');
    const date = date_(d.date, n + 'date disposed');
    const hasCert = d.hasCert === 'yes';
    if (!hasCert && d.hasCert !== 'no') throw new Error(n + 'choose Yes or No for certificate.');
    const certQty = hasCert ? positive_(d.certQty, n + 'certificate quantity') : 0;
    if (certQty > qty + 1e-9) throw new Error(n + 'certificate quantity is more than RDF disposed.');
    if (hasCert && !(d.certFile && d.certFile.data)) throw new Error(n + 'attach the certificate.');
    return { dest: dest, qty: qty, date: date, hasCert: hasCert, certQty: certQty, file: hasCert ? d.certFile : null };
  });
  const disposed = ds.reduce((s, d) => s + d.qty, 0);
  const certified = ds.reduce((s, d) => s + d.certQty, 0);
  if (disposed > gen + 1e-9) throw new Error('RDF disposed (' + disposed + ' MT) is more than RDF generated (' + gen + ' MT).');
  const pending = disposed - certified, atSite = Math.max(gen - disposed, 0);
  const others = Array.isArray(r.attachments) ? r.attachments.slice(0, 10) : [];

  // Short lock: a unique ID and the folders (two first-time uploads must not
  // create twin folders). Drive uploads happen outside the lock.
  const res = reserve_(agency, site, phase);
  const id = res.id;

  const dRows = ds.map((d, i) => {
    const url = d.file ? save_(res.certDir, d.file, id + '_D' + (i + 1)) : '';
    const left = d.qty - d.certQty;
    return [id, txt_(agency), txt_(site), txt_(phase), txt_(d.dest), d.qty, d.date,
      d.hasCert ? 'Yes' : 'No', d.certQty, left, left > 0 ? PENDING : 'Certified', url, new Date(), i + 1];
  });
  const otherUrls = others.map(f => save_(res.recDir, f, id)).join('\n');

  const when = Utilities.formatDate(new Date(), CONFIG.TZ, 'dd MMM yyyy, HH:mm');
  const pdf = pdf_(res.recDir, id, when, {
    agency: agency, site: site, phase: phase, cluster: cluster || '—', awarded: awarded,
    start: fmtDate_(start), end: end ? fmtDate_(end) : 'Ongoing', land: land, gen: gen,
    disposed: disposed, pct: gen ? disposed / gen * 100 : 0, certified: certified, pending: pending, atSite: atSite,
    uploader: uploader, phone: phone,
    dispatches: ds.map(d => ({ dest: d.dest, qty: d.qty, date: fmtDate_(d.date), cert: d.hasCert ? 'Yes' : 'Pending', certQty: d.certQty })),
    attachments: others.map(f => clean_(f.name)).join(', ') || 'None',
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let csv;
  try {
    append_('RDF_dispatch', DISP_HEAD, dRows);
    append_('RDF_plan', PLAN_HEAD, [[
      id, new Date(), txt_(agency), txt_(site), txt_(cluster), txt_(phase), awarded,
      start, end || 'Ongoing', land, gen, disposed, gen ? disposed / gen : 0, certified, pending, atSite,
      txt_(ds.map(d => d.dest).join('; ')), pending > 0 ? PENDING : 'Complete',
      res.recDir.getUrl(), pdf.getUrl(), otherUrls, txt_(uploader), "'" + phone,
    ]]);
    csv = agencyCsv_(agency);
    allData_();
  } finally {
    lock.releaseLock();
  }
  return {
    id: id, pending: pending, pdfName: pdf.getName(),
    pdfData: Utilities.base64Encode(pdf.getBlob().getBytes()),
    csvRows: Math.max(csv.split('\r\n').length - 1, 0),
    recordsPath: ['RDF Planning Records', agency, phase, site].join(' / '),
    certsPath: ['RDF Certificates', agency, site, phase].join(' / '),
    site: site, phase: phase,
  };
}

function reserve_(agency, site, phase) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    let id = 'RDF-' + Utilities.formatDate(new Date(), CONFIG.TZ, 'yyMMdd-HHmmss');
    const last = props.getProperty('lastId') || '';
    if (last === id || last.indexOf(id + '-') === 0) id += '-' + (Number(last.split('-')[3] || 1) + 1);
    props.setProperty('lastId', id);
    return {
      id: id,
      recDir: path_(['RDF Planning Records', agency, phase, site]),
      certDir: path_(['RDF Certificates', agency, site, phase]),
    };
  } finally {
    lock.releaseLock();
  }
}

// ---------- certificate that arrives days after the RDF ----------
function addCertificate_(agency, b) {
  const recordId = clean_(b.recordId), line = Number(b.line);
  const q = positive_(b.certQty, 'Certificate quantity');
  if (!b.file || !b.file.data) throw new Error('Attach the certificate.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_('RDF_dispatch');
    const v = sh.getDataRange().getValues(), h = v[0];
    const c = name => h.indexOf(name);
    for (let r = 1; r < v.length; r++) {
      const row = v[r];
      if (String(row[c('Record ID')]) !== recordId || Number(row[c('Line')]) !== line || row[c('Agency')] !== agency) continue;
      const pend = num_(row[c('Pending qty (MT)')]);
      if (pend <= 0) throw new Error('This entry is already certified.');
      if (q > pend + 1e-9) throw new Error('Only ' + pend + ' MT is pending for this entry.');
      const site = String(row[c('Site')]), phase = String(row[c('Phase')]);
      const url = save_(path_(['RDF Certificates', agency, site, phase]), b.file, recordId + '_D' + line + '_late');
      const left = Math.max(pend - q, 0);
      const set = (name, val) => sh.getRange(r + 1, c(name) + 1).setValue(val);
      set('Certificate', 'Yes');
      set('Cert qty (MT)', num_(row[c('Cert qty (MT)')]) + q);
      set('Pending qty (MT)', left);
      set('Cert status', left > 0 ? PENDING : 'Certified');
      set('Certificate file', [row[c('Certificate file')], url].filter(String).join('\n'));
      SpreadsheetApp.flush();
      refreshPlan_(recordId);
      agencyCsv_(agency);
      allData_();
      return { left: left, pending: pending_(agency, site) };
    }
  } finally {
    lock.releaseLock();
  }
  throw new Error('Entry not found.');
}

function refreshPlan_(id) {
  const d = rows_('RDF_dispatch').filter(x => String(x['Record ID']) === id);
  const cert = d.reduce((s, x) => s + num_(x['Cert qty (MT)']), 0);
  const pend = d.reduce((s, x) => s + num_(x['Pending qty (MT)']), 0);
  const sh = sheet_('RDF_plan');
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = sh.getRange('A:A').getValues().map(x => String(x[0])).indexOf(id) + 1;
  if (row < 2) return;
  sh.getRange(row, h.indexOf('Certified RDF (MT)') + 1).setValue(cert);
  sh.getRange(row, h.indexOf('Certificate pending (MT)') + 1).setValue(pend);
  sh.getRange(row, h.indexOf('Status') + 1).setValue(pend > 0 ? PENDING : 'Complete');
}

// ---------- CSV rows: one per destination, joined with its RDF_plan row ----------
// agency = null → every agency. Values are raw (numbers, Dates) for the sheet tab.
function dataRows_(agency) {
  const plan = {};
  rows_('RDF_plan').forEach(p => { plan[String(p['Record ID'])] = p; });
  return rows_('RDF_dispatch').filter(d => !agency || d['Agency'] === agency).map(d => {
    const p = plan[String(d['Record ID'])] || {};
    return [d['Record ID'], p['Submitted at'], d['Agency'], d['Site'], p['Cluster'], d['Phase'],
      p['Awarded Legacy Qty (MT)'], p['Work started on'], p['Work ended on'],
      p['Land reclaimed (acres)'], p['RDF generated (MT)'], d['Destination'],
      d['RDF disposed (MT)'], d['Date disposed'], d['Certificate'], d['Cert qty (MT)'],
      d['Pending qty (MT)'], d['Cert status'], p['Uploaded by'], p['Uploader phone']];
  });
}

function toCsv_(rows) {
  const cell = (v, i) => {
    if (v instanceof Date) v = Utilities.formatDate(v, CONFIG.TZ, i === 1 ? 'dd-MM-yyyy HH:mm' : 'dd-MM-yyyy');
    v = String(v == null ? '' : v).replace(/^'/, '');
    if (/^[=+\-@]/.test(v) && isNaN(Number(v))) v = "'" + v;   // no formulas when opened in Excel
    return '"' + v.replace(/"/g, '""') + '"';
  };
  return [CSV_HEAD].concat(rows).map(r => r.map(cell).join(',')).join('\r\n');
}

function writeCsv_(dir, name, csv) {
  const old = dir.getFilesByName(name);
  if (old.hasNext()) old.next().setContent(csv);
  else dir.createFile(name, csv, MimeType.CSV);
}

// One CSV per agency — rewritten on every change. Same file as "Download all my data".
function agencyCsv_(agency) {
  const csv = toCsv_(dataRows_(agency));
  writeCsv_(path_(['RDF Planning Records', agency]), agency + '_RDF_data.csv', csv);
  return csv;
}

// Every agency: the All_RDF_data tab and All_agencies_RDF_data.csv — rebuilt on every change.
// Also safe to Run by hand after editing RDF_plan / RDF_dispatch directly.
function allData_() {
  const rows = dataRows_(null);
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('All_RDF_data');
  if (!sh) {
    sh = ss.insertSheet('All_RDF_data');
    sh.setFrozenRows(1);
  }
  sh.clearContents();
  const phone = CSV_HEAD.indexOf('Uploader phone');
  // Text read back from the sheet must stay text: no formulas, phone keeps its leading digits.
  const vals = rows.map(r => r.map((v, i) => i === phone ? "'" + String(v).replace(/^'/, '') : (typeof v === 'string' ? txt_(v) : v)));
  sh.getRange(1, 1, 1, CSV_HEAD.length).setValues([CSV_HEAD]).setFontWeight('bold').setBackground('#e6f4ea');
  if (vals.length) sh.getRange(2, 1, vals.length, CSV_HEAD.length).setValues(vals);
  sh.getRange('B:B').setNumberFormat('dd-MM-yyyy HH:mm');
  sh.getRange('H:I').setNumberFormat('dd-MM-yyyy');
  sh.getRange('N:N').setNumberFormat('dd-MM-yyyy');
  writeCsv_(path_(['RDF Planning Records']), 'All_agencies_RDF_data.csv', toCsv_(rows));
}

function rebuildAllData() { allData_(); }

// ---------- helpers ----------
function sheet_(n) { return SpreadsheetApp.getActive().getSheetByName(n); }

function rows_(n) {
  const sh = sheet_(n);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues();
  const h = v.shift().map(k => String(k).trim());
  return v.map(r => { const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o; });
}

function append_(n, head, rows) {
  if (!rows.length) return;
  const sh = ensureSheet_(n, head);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
}

// Get a tab, creating it with its header row if it is missing or empty (no need to run setup first).
function ensureSheet_(n, head) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(n) || ss.insertSheet(n);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#e6f4ea');
    sh.setFrozenRows(1);
    if (n === 'RDF_plan') {
      sh.getRange('M:M').setNumberFormat('0.0%');
      sh.getRange('B:B').setNumberFormat('dd-MM-yyyy HH:mm');
      sh.getRange('H:I').setNumberFormat('dd-MM-yyyy');
    } else if (n === 'RDF_dispatch') {
      sh.getRange('G:G').setNumberFormat('dd-MM-yyyy');
      sh.getRange('M:M').setNumberFormat('dd-MM-yyyy HH:mm');
    }
  }
  return sh;
}

function path_(names) {                       // get-or-create nested folders
  if (!CONFIG.ROOT_FOLDER_ID) throw new Error('ROOT_FOLDER_ID is not set in Code.gs.');
  return names.reduce((dir, n) => {
    n = folderName_(n);
    const it = dir.getFoldersByName(n);
    return it.hasNext() ? it.next() : dir.createFolder(n);
  }, DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID));
}

function save_(dir, f, prefix) {              // f = {name, mimeType, data(base64)}
  const bytes = Utilities.base64Decode(String(f.data || ''));
  if (!bytes.length) throw new Error('Empty file: ' + f.name);
  if (bytes.length > CONFIG.MAX_FILE_MB * 1024 * 1024) throw new Error('File too large: ' + f.name);
  const name = prefix + '_' + (clean_(f.name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file');
  const blob = Utilities.newBlob(bytes, String(f.mimeType || 'application/octet-stream'), name);
  return dir.createFile(blob).getUrl();
}

function pdf_(dir, id, when, p) {
  const tpl = HtmlService.createTemplateFromFile('Pdf');
  tpl.p = p; tpl.id = id; tpl.when = when;
  tpl.fmt = (n, d) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d == null ? 2 : d });
  const blob = tpl.evaluate().getBlob().getAs(MimeType.PDF).setName(id + '_' + folderName_(p.site) + '.pdf');
  return dir.createFile(blob);
}

function clean_(s) { return String(s == null ? '' : s).trim(); }
function lc_(s) { return clean_(s).toLowerCase(); }
function num_(v) { return typeof v === 'number' ? v : (parseFloat(String(v == null ? '' : v).replace(/,/g, '')) || 0); }
function folderName_(s) { return clean_(s).replace(/[\\/]/g, '-').slice(0, 100) || '_'; }
// User text written to the sheet: a leading = + - @ would otherwise become a formula.
function txt_(s) { s = clean_(s); return /^[=+\-@]/.test(s) ? "'" + s : s; }

function positive_(v, label) {
  const n = Number(v);
  if (v === '' || v == null || !isFinite(n) || n <= 0) throw new Error(label + ': enter a number above 0.');
  return n;
}
function nonNeg_(v, label) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  if (!isFinite(n) || n < 0) throw new Error(label + ': enter a number.');
  return n;
}
function date_(s, label) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean_(s));
  if (!m) throw new Error(label + ': enter a date.');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function iso_(v) { return v instanceof Date ? Utilities.formatDate(v, CONFIG.TZ, 'yyyy-MM-dd') : clean_(v); }
function fmtDate_(d) { return Utilities.formatDate(d, CONFIG.TZ, 'dd-MM-yyyy'); }

// ---------- run once ----------
function setup() {
  DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);   // fails loudly if the ID is wrong
  const ss = SpreadsheetApp.getActive();
  ensureSheet_('RDF_plan', PLAN_HEAD);
  ensureSheet_('RDF_dispatch', DISP_HEAD);
  allData_();
  if (!ss.getSheetByName('Sites')) Logger.log('WARNING: no "Sites" tab. Import Phase_data.csv and rename the tab to Sites.');
  Logger.log('Build ' + BUILD);
  Logger.log('Agencies that can log in: ' + (agencies_().join(', ') || 'none — run makePins() and paste AGENCY_PINS'));
}

// Logs a fresh AGENCY_PINS block (keeps existing PINs/passwords, random 4-digit PIN for new agencies).
// Copy it from View › Logs (Execution log) over the AGENCY_PINS block above.
function makePins() {
  const names = {};
  rows_('Sites').forEach(r => { const a = clean_(r.agency_name); if (a) names[a] = 1; });
  const lines = Object.keys(names).sort().map(a =>
    "  '" + a.replace(/'/g, "\\'") + "': '" + (AGENCY_PINS[a] || String(1000 + Math.floor(Math.random() * 9000))) + "',");
  Logger.log('const AGENCY_PINS = {\n' + lines.join('\n') + '\n};');
}
