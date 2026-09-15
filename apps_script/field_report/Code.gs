// Field daily site report — Apps Script backend.
// One copy of this file per brand (two Apps Script projects). Only CONFIG differs.
// Called ONLY by advitiaum.com (views/field.py) over HTTPS POST with a shared TOKEN.

const CONFIG = {
  FOLDER_NAME: 'Tharuni_daily_reports',        // AP Urban project: 'APUrban_daily_reports'
  REGISTRY_NAME: '_Tharuni_site_registry',     // AP Urban project: '_APUrban_site_registry'
  PIN: '43210',                                // AP Urban project: '98765'
  TOKEN: 'CHANGE-ME-long-random-string',       // must equal TH_SCRIPT_TOKEN / AP_SCRIPT_TOKEN in app.yaml
  TZ: 'Asia/Kolkata',
};

const HEADERS = ['Site', 'Operator', 'Phone', 'Start date', 'Start time', 'End date', 'End time',
  'MSW inward (t)', 'Soil disposed (t)', 'Inert disposed (t)', 'RDF disposed (t)', 'C&D disposed (t)',
  'Remarks', 'Submitted at', 'Captured at'];
const QTY_COLS = [8, 9, 10, 11, 12];   // 1-based
const COL_SUBMITTED = 14;              // 1-based

// ---------- HTTP ----------
function doGet() {
  return json_({ ok: true, service: CONFIG.FOLDER_NAME, note: 'POST only' });
}

function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!CONFIG.TOKEN || body.token !== CONFIG.TOKEN) throw new Error('Unauthorised.');
    switch (body.action) {
      case 'suggestions': out = { ok: true, sites: registryRows_().map(r => r[0]) }; break;
      case 'submit':      out = submitReport_(body.report || {}); break;
      case 'status':      out = getStatus_(body.pin, body.date); break;
      default: throw new Error('Unknown action.');
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return json_(out);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Submit ----------
function submitReport_(d) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const clean = s => String(s == null ? '' : s).trim();
    const num = v => { const n = Number(v); if (v === '' || isNaN(n) || n < 0) throw new Error('Every quantity must be a number.'); return n; };
    const site = clean(d.site), operator = clean(d.operator), phone = clean(d.phone).replace(/\D/g, '');
    if (!site) throw new Error('Site name is required.');
    if (!operator) throw new Error('Operator name is required.');
    if (!/^\d{10}$/.test(phone)) throw new Error('Phone must be 10 digits.');
    const qty = [num(d.msw), num(d.soil), num(d.inert), num(d.rdf), num(d.cnd)];

    const now = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss');
    // A report queued on the phone overnight must land in the day it was
    // captured, not the day the phone found signal. Trust capturedAt if sane
    // (ISO local, not in the future, within 7 days); else use today.
    const capturedAt = clean(d.capturedAt);
    const reportDate = reportDateFor_(capturedAt);
    const sheet = dailySheet_(reportDate);
    const row = [site, operator, phone, clean(d.startDate), clean(d.startTime), clean(d.endDate), clean(d.endTime)]
      .concat(qty).concat([clean(d.remarks), now, capturedAt || now]);

    // Same site, same day => replace; otherwise append.
    const data = sheet.getDataRange().getValues();
    let target = -1;
    for (let i = 1; i < data.length; i++) {
      const a = String(data[i][0]).trim().toLowerCase();
      if (a === 'total') continue;
      if (a === site.toLowerCase()) { target = i + 1; break; }
    }
    removeTotalsRow_(sheet);
    if (target > 0) sheet.getRange(target, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    writeTotalsRow_(sheet);

    upsertRegistry_(site, operator, phone, reportDate);
    return { ok: true, date: reportDate, replaced: target > 0, sheetUrl: sheet.getParent().getUrl() };
  } finally {
    lock.releaseLock();
  }
}

function reportDateFor_(capturedAt) {
  const today = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd');
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(capturedAt || '');
  if (!m) return today;
  const d = m[1] + '-' + m[2] + '-' + m[3];
  const diffDays = (new Date(today) - new Date(d)) / 86400000;
  return (diffDays >= 0 && diffDays <= 7) ? d : today;
}

// ---------- Status ----------
function getStatus_(pin, dateStr) {
  if (String(pin || '') !== CONFIG.PIN) throw new Error('Wrong PIN.');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? dateStr : Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd');
  const file = findDailyFile_(date);
  const submitted = [];
  if (file) {
    const data = SpreadsheetApp.open(file).getSheets()[0].getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r[0] || String(r[0]).trim().toLowerCase() === 'total') continue;
      const disposed = [8, 9, 10, 11].reduce((a, c) => a + (Number(r[c]) || 0), 0);
      const sub = r[COL_SUBMITTED - 1];
      submitted.push({
        site: r[0], operator: r[1], phone: String(r[2]),
        msw: Number(r[7]) || 0, disposed: Math.round(disposed * 100) / 100,
        time: sub instanceof Date ? Utilities.formatDate(sub, CONFIG.TZ, 'h:mm a') : String(sub).slice(11, 16),
      });
    }
  }
  const done = new Set(submitted.map(s => String(s.site).trim().toLowerCase()));
  const pending = registryRows_()
    .filter(r => !done.has(String(r[0]).trim().toLowerCase()))
    .map(r => ({ site: r[0], operator: r[1], phone: String(r[2]), lastReport: String(r[3]) }));
  return { ok: true, date, submitted, pending, sheetUrl: file ? file.getUrl() : null };
}

// ---------- Drive / Sheets ----------
function folder_() {
  const it = DriveApp.getFoldersByName(CONFIG.FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.FOLDER_NAME);
}
function dailyName_(date) { return date + ' - All Site Status'; }
function findDailyFile_(date) {
  const it = folder_().getFilesByName(dailyName_(date));
  return it.hasNext() ? it.next() : null;
}
function dailySheet_(date) {
  let file = findDailyFile_(date);
  if (!file) {
    const ss = SpreadsheetApp.create(dailyName_(date));
    file = DriveApp.getFileById(ss.getId());
    file.moveTo(folder_());
    const sh = ss.getSheets()[0];
    sh.setName('All sites');
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#EEEEEE');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, HEADERS.length, 130);
    // Phone column as text so leading zeros / 10-digit numbers stay intact.
    sh.getRange(2, 3, 1000, 1).setNumberFormat('@');
    return sh;
  }
  return SpreadsheetApp.open(file).getSheets()[0];
}
function removeTotalsRow_(sheet) {
  const last = sheet.getLastRow();
  if (last > 1 && String(sheet.getRange(last, 1).getValue()).trim().toLowerCase() === 'total') sheet.deleteRow(last);
}
function writeTotalsRow_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return;
  const r = last + 1;
  sheet.getRange(r, 1).setValue('Total');
  QTY_COLS.forEach(c => {
    const L = sheet.getRange(1, c).getA1Notation().replace(/\d+/, '');
    sheet.getRange(r, c).setFormula('=SUM(' + L + '2:' + L + last + ')');
  });
  sheet.getRange(r, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#F5F5F5');
}
function registry_() {
  const f = folder_();
  const it = f.getFilesByName(CONFIG.REGISTRY_NAME);
  if (it.hasNext()) return SpreadsheetApp.open(it.next()).getSheets()[0];
  const ss = SpreadsheetApp.create(CONFIG.REGISTRY_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(f);
  const sh = ss.getSheets()[0];
  sh.appendRow(['Site', 'Last operator', 'Phone', 'Last report']);
  sh.getRange(2, 3, 1000, 1).setNumberFormat('@');
  return sh;
}
function registryRows_() {
  const v = registry_().getDataRange().getValues();
  return v.slice(1).filter(r => r[0]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}
function upsertRegistry_(site, operator, phone, date) {
  const sh = registry_();
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]).trim().toLowerCase() === site.toLowerCase()) {
      sh.getRange(i + 1, 1, 1, 4).setValues([[v[i][0], operator, phone, date]]);
      return;
    }
  }
  sh.appendRow([site, operator, phone, date]);
}

// Run once from the editor to trigger the Drive/Sheets permission prompt
// before deploying; also creates the folder so you can see it exists.
function setupOnce() {
  Logger.log('Folder: ' + folder_().getUrl());
  Logger.log('Registry: ' + registry_().getParent().getUrl());
}
