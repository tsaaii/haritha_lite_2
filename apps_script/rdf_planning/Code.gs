// RDF Planning v2 — Apps Script backend (bound to the "Haritha RDF Planning" sheet).
// Called ONLY by advitiaum.com (views/rdf.py) over HTTPS POST with a shared TOKEN.
//
// The agency types its name and PIN once, at login. After that Flask keeps the
// agency in its signed session and sends it with the TOKEN, so `agency` on every
// other action can be trusted — only Flask knows TOKEN.
//
// Sheet tab:
//   RDF_plan_v2   one row per site + phase entry (34 columns). Editing an entry
//                 rewrites its row. Created automatically the first time it's needed.
//                 (The v1 tabs RDF_plan / RDF_dispatch / All_RDF_data are left as they are.)
// Drive (under ROOT_FOLDER_ID), rewritten in the background a few minutes after a submit
// (run setup() once to install that timer; without it they're rewritten during the submit):
//   RDF Planning/<Agency>/<Agency>_RDF_plan.csv   ← the file the agency downloads
//   RDF Planning/All_agencies_RDF_plan.csv

const CONFIG = {
  TOKEN: 'CHANGE-ME-long-random-string',   // must equal RDF_SCRIPT_TOKEN in app.yaml
  ROOT_FOLDER_ID: '',                      // Drive folder "Haritha RDF" — the part after /folders/ in its URL
  TZ: 'Asia/Kolkata',
  MAX_PIN_TRIES: 5,                        // wrong PINs before that agency name is locked out …
  LOCK_MINUTES: 15,                        // … for this long
};

// One PIN or password per agency (4–32 characters, no spaces, keep the quotes).
// Change one here, then Deploy › Manage deployments › Edit › New version.
const AGENCY_PINS = {
  // 'Tharuni Associates': '1234',
};

// ---------- nothing below this line needs editing ----------
const BUILD = '2026-09-29-v2e';   // shown by doGet — bump when you change this file
const API_VERSION = 2;            // the website refuses to log in if this doesn't match
const SHEET = 'RDF_plan_v2';      // the one tab this script writes to
// Defaults, so an older CONFIG block (kept from a previous version) still works.
const TZ = CONFIG.TZ || 'Asia/Kolkata';
const MAX_PIN_TRIES = CONFIG.MAX_PIN_TRIES || 5;
const LOCK_MINUTES = CONFIG.LOCK_MINUTES || 15;
const CSV_EVERY_MIN = 5;          // background refresh of the Drive CSVs (1, 5, 10, 15 or 30)

const MATERIALS = ['RDF', 'Soil', 'Inert', 'CnD'];
const LABEL = { RDF: 'RDF', Soil: 'Soil', Inert: 'Inert', CnD: 'C&D' };
const HEADERS = [
  'Record ID', 'Submitted at', 'Agency', 'Site', 'Phase', 'Start date', 'End date',
  'Total qty awarded by ULB (MT)', 'Total qty processed by ULB (MT)', 'Site 100% remediation date',
  'Last date of RDF disposal', 'RDF disposed per day (MT)',
  'Cumulative RDF disposed (MT)', 'Cumulative Soil disposed (MT)', 'Cumulative Inert disposed (MT)', 'Cumulative C&D disposed (MT)',
  'RDF disposed factory name(s)',
  'Balance RDF at site (MT)', 'Balance Soil at site (MT)', 'Balance Inert at site (MT)', 'Balance C&D at site (MT)',
  'Timeline RDF disposal', 'Timeline Soil disposal', 'Timeline Inert disposal', 'Timeline C&D disposal',
  'Issues RDF', 'Issues Soil', 'Issues Inert', 'Issues C&D', 'Other remarks',
  // Added later — kept at the end so rows already in the tab stay aligned.
  'Site 100% reclaimed, no disposals pending', 'Fresh waste dumped on reclaimed site',
  'Plan to dispose RDF', 'Where the remaining RDF goes',
];
const DATE_COLS = [5, 6, 9, 10, 21, 22, 23, 24];   // 0-based: start, end, remDate, rdfLast, 4 timelines

// ---------- HTTP ----------
function doGet() {
  // Open the /exec URL in a browser to see which code the live deployment runs.
  return json_({ ok: true, service: 'rdf_planning', build: BUILD, note: 'POST only', agencies: agencyNames_().length, sheet: SHEET });
}

function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!CONFIG.TOKEN || CONFIG.TOKEN.indexOf('CHANGE-ME') === 0 || body.token !== CONFIG.TOKEN) {
      throw new Error('Unauthorised.');
    }
    switch (body.action) {
      case 'login':  { const a = checkPin_(body.agency, body.pin); out = bootstrap_(a); break; }
      case 'list':   out = bootstrap_(known_(body.agency)); break;
      case 'submit': { const a = known_(body.agency); out = save_(a, body.entry || {}); break; }
      case 'csv':    out = { csv: toCsv_(sheetValues_().filter(r => r[2] === known_(body.agency))) }; break;
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

// ---------- login: typed agency name (any capitalisation) + PIN ----------
const PIN_RE = /^\S{4,32}$/;
function agencyNames_() {
  return Object.keys(AGENCY_PINS).filter(a => PIN_RE.test(String(AGENCY_PINS[a])));
}
function norm_(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }
function find_(name) { const n = norm_(name); return agencyNames_().filter(a => norm_(a) === n)[0] || ''; }

function known_(agency) {
  const a = find_(agency);
  if (!a || a !== agency) throw new Error('Unknown agency.');
  return a;
}

// Same message for an unknown name and a wrong PIN, so names can't be probed.
function checkPin_(name, pin) {
  const cache = CacheService.getScriptCache();
  const key = 'pinfail_' + Utilities.base64EncodeWebSafe(norm_(name)).slice(0, 200);
  const fails = Number(cache.get(key) || 0);
  if (fails >= MAX_PIN_TRIES) {
    throw new Error('Too many wrong attempts. Try again in ' + LOCK_MINUTES + ' minutes.');
  }
  const a = find_(name);
  if (!a || String(pin) !== String(AGENCY_PINS[a])) {
    const left = MAX_PIN_TRIES - fails - 1;
    cache.put(key, String(fails + 1), LOCK_MINUTES * 60);
    throw new Error(left > 0
      ? 'Agency name or PIN is wrong. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.'
      : 'Too many wrong attempts. Try again in ' + LOCK_MINUTES + ' minutes.');
  }
  cache.remove(key);
  return a;
}

// What the form needs: this agency's entries + factory names anyone has used.
function bootstrap_(agency) {
  const all = rows_();
  const fac = {};
  all.forEach(r => parseFactories_(r['RDF disposed factory name(s)']).forEach(f => { fac[f.name] = 1; }));
  return { api: API_VERSION, agency: agency, entries: all.filter(r => r['Agency'] === agency).map(toEntry_), factories: Object.keys(fac).sort() };
}

// ---------- validation (same rules as the form) ----------
function clean_(x) {
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const e = [];
  const str = k => String(x[k] == null ? '' : x[k]).trim();
  const out = {};
  const num = (k, label) => {
    const s = str(k).replace(/,/g, '');
    if (s === '') { e.push(label + ' is required (enter 0 if none).'); return; }
    const n = Number(s);
    if (!isFinite(n) || n < 0) { e.push(label + ' must be 0 or more.'); return; }
    out[k] = Math.round(n * 100) / 100;
  };
  const date = (k, label) => {
    const s = str(k);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) { e.push(label + ': pick a date.'); return; }
    out[k] = s;
  };
  const text = (k, max) => { out[k] = str(k).slice(0, max || 2000); };

  out.id = str('id').slice(0, 40);
  out.site = str('site').replace(/\s+/g, ' ').slice(0, 150);
  out.phase = str('phase').replace(/\s+/g, ' ').slice(0, 100);
  if (!out.site) e.push('Site name is required.');
  if (!out.phase) e.push('Phase is required.');
  date('start', 'Start date');
  date('end', 'End date');                       // may be in the future
  date('remDate', '100% remediation date');      // past or future
  date('rdfLast', 'Last date of RDF disposal');
  if (out.start && out.end && out.end < out.start) e.push('End date is before the start date.');
  if (out.rdfLast && out.rdfLast > today) e.push('Last date of RDF disposal cannot be in the future.');
  if (out.start && out.rdfLast && out.rdfLast < out.start) e.push('Last date of RDF disposal is before work started.');
  if (out.start && out.remDate && out.remDate < out.start) e.push('100% remediation date is before the start date.');
  num('awarded', 'Total qty awarded by ULB');
  num('processed', 'Total qty processed by ULB');
  num('rdfDaily', 'RDF disposed per day');
  MATERIALS.forEach(m => {
    num(m + '_cum', 'Cumulative ' + LABEL[m] + ' disposed');
    num(m + '_bal', 'Balance ' + LABEL[m] + ' at site');
    date(m + '_tl', LABEL[m] + ' disposal timeline');
    text(m + '_iss');
  });
  text('remarks');
  text('rdfPlan'); text('rdfRest');
  if ((out.RDF_bal || 0) > 0) {
    if (!out.rdfPlan) e.push('What is your plan to dispose RDF? is required while RDF is still at site.');
    if (!out.rdfRest) e.push('Where does the remaining RDF go? is required while RDF is still at site.');
  }
  out.reclaimed = str('reclaimed') === 'yes' ? 'Yes' : 'No';
  const fresh = str('freshDump');
  if (fresh !== 'yes' && fresh !== 'no') e.push('Answer Yes or No: is fresh waste being dumped on the reclaimed site?');
  out.freshDump = fresh === 'yes' ? 'Yes' : 'No';
  if (out.reclaimed === 'Yes') {
    const left = MATERIALS.filter(m => out[m + '_bal'] > 0).map(m => LABEL[m]);
    if (left.length) e.push('Site is marked 100% reclaimed with no disposals pending, but balance at site is not 0 for: ' + left.join(', ') + '.');
  }

  out.factories = (Array.isArray(x.factories) ? x.factories : []).slice(0, 30)
    // ; ( ) would break the "Name (qty MT); Name (qty MT)" cell format, so they become spaces.
    .map(f => ({ name: String((f && f.name) || '').replace(/[;()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150),
                 qty: Math.round((Number(String((f && f.qty) || 0).replace(/,/g, '')) || 0) * 100) / 100 }))
    .filter(f => f.name);
  if (out.factories.some(f => f.qty < 0)) e.push('Factory quantities must be 0 or more.');
  const names = out.factories.map(f => f.name.toLowerCase());
  if (names.length !== Object.keys(names.reduce((o, n) => (o[n] = 1, o), {})).length) e.push('The same factory is added twice.');
  if (out.RDF_cum > 0 && !out.factories.length) e.push('Add the factory the RDF was sent to.');
  if (out.factories.reduce((s, f) => s + f.qty, 0) > (out.RDF_cum || 0) + 0.01) e.push('Factory quantities add up to more than cumulative RDF disposed.');

  if (e.length) throw new Error(e.join(' '));
  return out;
}

// ---------- save: new row, or rewrite the agency's own row when entry.id is set ----------
function save_(agency, entry) {
  const x = clean_(entry);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let id;
  try {
    const sh = sheet_();
    let row;
    if (x.id) {
      const ids = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
      const i = ids.findIndex(r => String(r[0]) === x.id && r[2] === agency);
      if (i < 0) throw new Error('Entry not found for this agency.');
      id = x.id; row = i + 2;
    } else {
      id = newId_();
      row = sh.getLastRow() + 1;
    }
    sh.getRange(row, 1, 1, HEADERS.length).setValues([toRow_(id, agency, x)]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  // Drive is the slow part of a submit. With the timer from setup() installed,
  // just mark this agency's CSV as out of date; refreshCsvs() rewrites it shortly.
  const later = markCsvDirty_(agency);
  if (!later) writeCsvs_([agency]);
  const b = bootstrap_(agency);
  return { id: id, edited: !!x.id, csvLater: later, csvRows: b.entries.length, entries: b.entries, factories: b.factories };
}

function newId_() {   // caller holds the script lock
  const props = PropertiesService.getScriptProperties();
  let id = 'RDF-' + Utilities.formatDate(new Date(), TZ, 'yyMMdd-HHmmss');
  const last = props.getProperty('lastId') || '';
  if (last === id || last.indexOf(id + '-') === 0) id += '-' + (Number(last.split('-')[3] || 1) + 1);
  props.setProperty('lastId', id);
  return id;
}

function toRow_(id, agency, x) {
  const d = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : ''; };
  return [
    id, new Date(), txt_(agency), txt_(x.site), txt_(x.phase), d(x.start), d(x.end), x.awarded, x.processed,
    d(x.remDate), d(x.rdfLast), x.rdfDaily,
    ...MATERIALS.map(m => x[m + '_cum']),
    txt_(x.factories.map(f => f.name + ' (' + f.qty + ' MT)').join('; ')),
    ...MATERIALS.map(m => x[m + '_bal']),
    ...MATERIALS.map(m => d(x[m + '_tl'])),
    ...MATERIALS.map(m => txt_(x[m + '_iss'])),
    txt_(x.remarks),
    x.reclaimed, x.freshDump,
    txt_(x.rdfPlan), txt_(x.rdfRest),
  ];
}

// ---------- read back (for "My sites" and Edit) ----------
function parseFactories_(s) {
  return String(s || '').split('; ').filter(String).map(p => {
    const m = /^(.*) \(([\d.]+) MT\)$/.exec(p);
    return m ? { name: m[1], qty: m[2] } : { name: p, qty: '' };
  });
}

function toEntry_(r) {
  const iso = v => (v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v == null ? '' : v));
  const s = v => String(v == null ? '' : v);
  const x = {
    id: s(r['Record ID']),
    submitted: r['Submitted at'] instanceof Date ? Utilities.formatDate(r['Submitted at'], TZ, 'yyyy-MM-dd HH:mm') : s(r['Submitted at']),
    site: s(r['Site']), phase: s(r['Phase']), start: iso(r['Start date']), end: iso(r['End date']),
    awarded: s(r['Total qty awarded by ULB (MT)']), processed: s(r['Total qty processed by ULB (MT)']),
    remDate: iso(r['Site 100% remediation date']), rdfLast: iso(r['Last date of RDF disposal']),
    rdfDaily: s(r['RDF disposed per day (MT)']), remarks: s(r['Other remarks']),
    factories: parseFactories_(r['RDF disposed factory name(s)']),
    reclaimed: r['Site 100% reclaimed, no disposals pending'] === 'Yes' ? 'yes' : '',
    freshDump: ({ Yes: 'yes', No: 'no' })[r['Fresh waste dumped on reclaimed site']] || '',
    rdfPlan: s(r['Plan to dispose RDF']), rdfRest: s(r['Where the remaining RDF goes']),
  };
  MATERIALS.forEach(m => {
    x[m + '_cum'] = s(r['Cumulative ' + LABEL[m] + ' disposed (MT)']);
    x[m + '_bal'] = s(r['Balance ' + LABEL[m] + ' at site (MT)']);
    x[m + '_tl'] = iso(r['Timeline ' + LABEL[m] + ' disposal']);
    x[m + '_iss'] = s(r['Issues ' + LABEL[m]]);
  });
  return x;
}

// ---------- CSV in Drive: one per agency + one for all agencies ----------
function sheetValues_() {
  const sh = sheet_();
  return sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getValues();
}

function toCsv_(rows) {
  const cell = (v, i) => {
    if (v instanceof Date) v = Utilities.formatDate(v, TZ, i === 1 ? 'dd-MM-yyyy HH:mm' : 'dd-MM-yyyy');
    v = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(v) && isNaN(Number(v))) v = "'" + v;   // no formulas when opened in Excel
    return '"' + v.replace(/"/g, '""') + '"';
  };
  return [HEADERS].concat(rows).map(r => r.map(cell).join(',')).join('\r\n');
}

// Rewrites <Agency>_RDF_plan.csv for the given agencies, and All_agencies_RDF_plan.csv.
function writeCsvs_(agencies) {
  const vals = sheetValues_();
  const root = folder_(DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID), 'RDF Planning');
  agencies.forEach(a => put_(folder_(root, folderName_(a)), a + '_RDF_plan.csv', toCsv_(vals.filter(r => r[2] === a))));
  put_(root, 'All_agencies_RDF_plan.csv', toCsv_(vals));
}

// Returns true when the background timer will write the CSVs (so the submit doesn't).
function markCsvDirty_(agency) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('csvTimer') !== '1') return false;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const dirty = JSON.parse(props.getProperty('csvDirty') || '[]');
    if (dirty.indexOf(agency) < 0) dirty.push(agency);
    props.setProperty('csvDirty', JSON.stringify(dirty));
  } finally {
    lock.releaseLock();
  }
  return true;
}

// Run by the timer that setup() installs. Cheap when nothing changed.
function refreshCsvs() {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let dirty;
  try {
    dirty = JSON.parse(props.getProperty('csvDirty') || '[]');
    props.deleteProperty('csvDirty');
  } finally {
    lock.releaseLock();
  }
  if (!dirty.length) return;
  try {
    writeCsvs_(dirty);
  } catch (err) {
    dirty.forEach(a => markCsvDirty_(a));   // try again next time
    throw err;
  }
}

// ---------- helpers ----------
function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) sh = ss.insertSheet(SHEET);
  const head = sh.getLastRow() === 0 ? [] : sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  if (head.length && head.length < HEADERS.length && head.every((h, i) => h === HEADERS[i])) {
    // Tab made by an earlier build: add the new column names at the end.
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#e6f4ea').setWrap(true);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#e6f4ea').setWrap(true);
    sh.setFrozenRows(1);
    sh.setFrozenColumns(5);
    DATE_COLS.forEach(c => sh.getRange(2, c + 1, sh.getMaxRows() - 1).setNumberFormat('dd-mm-yyyy'));
    sh.getRange(2, 2, sh.getMaxRows() - 1).setNumberFormat('dd-mm-yyyy hh:mm');
  }
  return sh;
}

function rows_() {
  const sh = sheet_();
  if (sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), HEADERS.length).getValues();
  const h = v.shift().map(k => String(k).trim());
  return v.map(r => { const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o; });
}

function folder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function put_(dir, name, text) {
  const it = dir.getFilesByName(name);
  if (it.hasNext()) it.next().setContent(text);
  else dir.createFile(name, text, MimeType.CSV);
}
function folderName_(s) { return String(s).trim().replace(/[\\/]/g, '-').slice(0, 100) || '_'; }
// User text written to the sheet: a leading = + - @ would otherwise become a formula.
function txt_(s) { s = String(s == null ? '' : s).trim(); return /^[=+\-@]/.test(s) ? "'" + s : s; }

// ---------- optional: run once to check setup ----------
function setup() {
  if (!CONFIG.ROOT_FOLDER_ID) throw new Error('Set ROOT_FOLDER_ID in CONFIG first.');
  DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);   // fails loudly if the ID is wrong
  sheet_();                                          // creates RDF_plan_v2 with its header row
  // Timer that keeps the Drive CSVs up to date, so submits don't wait for Drive.
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'refreshCsvs')) {
    ScriptApp.newTrigger('refreshCsvs').timeBased().everyMinutes(CSV_EVERY_MIN).create();
  }
  PropertiesService.getScriptProperties().setProperty('csvTimer', '1');
  writeCsvs_([...new Set(sheetValues_().map(r => String(r[2])).filter(String))]);
  Logger.log('Build ' + BUILD);
  Logger.log('Drive CSVs are refreshed every ' + CSV_EVERY_MIN + ' minutes after a submit.');
  Logger.log('Agencies that can log in: ' + (agencyNames_().join(', ') || 'none — fill AGENCY_PINS'));
}
