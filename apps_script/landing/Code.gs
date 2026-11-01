// Advitia Labs website — leads + visit tracker (Apps Script, bound to a Google Sheet).
// Called ONLY by advitiaum.com (views/landing_api.py) over HTTPS POST with a shared TOKEN.
// Setup steps: docs/landing.md → "Contact form and visit tracker".
//
// Tabs (created automatically):
//   Leads    one row per contact-form message; every lead is also emailed to NOTIFY_TO.
//   Visits   one row per page view, updated with engagement (time, scroll, sections, clicks).

const CONFIG = {
  TOKEN: 'CHANGE-ME-long-random-string',                  // must equal LANDING_SCRIPT_TOKEN in app.yaml
  NOTIFY_TO: 'wecare@advitiaum.com, saiteja7050@gmail.com', // lead emails go here (comma-separated)
  NOTIFY_ON_LINK_OPEN: true,  // email when someone opens a ?r=<name> link (first view of that visit)
  RETENTION_MONTHS: 12,       // Visits older than this are deleted daily (run setup() once)
  TZ: 'Asia/Kolkata',
};

// ---------- nothing below this line needs editing ----------
const BUILD = '2026-11-01-v1';
const LEADS = 'Leads', VISITS = 'Visits';
const LEAD_COLS = [
  ['Received (IST)', 'received_at'], ['Name', 'name'], ['Email', 'email'], ['Looking for', 'interest'], ['Details', 'details'],
  ['Link (?r=)', 'ref'], ['Visitor ID', 'visitor_id'], ['City', 'city'], ['Region', 'region'], ['Country', 'country'],
  ['Network', 'network'], ['IP (anonymised)', 'ip'], ['Referrer', 'referrer'], ['User agent', 'user_agent'], ['Status', null],
];
const VISIT_COLS = [
  ['Visit ID', 'visit_id'], ['Started (IST)', 'at'], ['Last update (IST)', 'at'], ['Link (?r=)', 'ref'], ['First link ever', 'first_ref'],
  ['City', 'city'], ['Region', 'region'], ['Country', 'country'], ['Map', 'latlng'], ['Network', 'network'], ['ASN', 'asn'],
  ['Datacenter?', 'datacenter'], ['IP (anonymised)', 'ip'], ['Device', 'device'], ['OS', 'os'], ['Browser', 'browser'],
  ['Screen', 'screen'], ['Language', 'lang'], ['Time zone', 'tz'], ['Referrer', 'referrer'], ['UTM source', 'utm_source'],
  ['UTM medium', 'utm_medium'], ['UTM campaign', 'utm_campaign'], ['Path', 'path'], ['Visitor ID', 'vid'], ['Visit # (this browser)', 'n'],
  ['Engaged (s)', 'duration'], ['Scroll %', 'scroll'], ['Sections reached', 'sections'], ['Clicks', 'clicks'],
  ['Platform viewed', 'arm'], ['Form', 'form'],
];
// Columns an "update" event may overwrite.
const VISIT_UPDATABLE = ['Last update (IST)', 'Engaged (s)', 'Scroll %', 'Sections reached', 'Clicks', 'Platform viewed', 'Form'];

function doGet() {
  return json_({ ok: true, service: 'advitia-landing', build: BUILD });
}

function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (!body || body.token !== CONFIG.TOKEN || CONFIG.TOKEN.indexOf('CHANGE-ME') === 0) return json_({ ok: false, error: 'unauthorised' });
  const d = body.data || {};
  try {
    if (body.action === 'lead') return json_(lead_(d));
    if (body.action === 'visit') return json_(visit_(d));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  }
}

// ---------- Leads ----------
function lead_(d) {
  const sh = sheet_(LEADS, LEAD_COLS);
  withLock_(() => sh.appendRow(LEAD_COLS.map(c => safe_(c[1] ? d[c[1]] : ''))));
  const rows = [
    ['Name', d.name], ['Email', d.email], ['Looking for', d.interest], ['Details', d.details],
    ['Opened via link', d.ref], ['Location', [d.city, d.region, d.country].filter(String).join(', ')],
    ['Network', d.network], ['Referrer', d.referrer], ['Received', d.received_at + ' IST'],
  ].filter(r => r[1]);
  const html = '<div style="font-family:Georgia,serif;color:#121A14;max-width:560px">'
    + '<p style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#0F7A3E;margin:0 0 8px">New message from advitiaum.com</p>'
    + '<h2 style="font-weight:400;margin:0 0 16px">' + esc_(d.name) + ' · ' + esc_(d.interest) + '</h2>'
    + '<table style="border-collapse:collapse;width:100%;font-size:15px">'
    + rows.map(r => '<tr><td style="padding:8px 12px 8px 0;color:#5C6B62;vertical-align:top;white-space:nowrap">' + esc_(r[0])
      + '</td><td style="padding:8px 0;border-bottom:1px solid #E8EDEA;white-space:pre-wrap">' + esc_(r[1]) + '</td></tr>').join('')
    + '</table><p style="color:#5C6B62;font-size:13px;margin-top:20px">Reply to this email to answer ' + esc_(d.name) + ' directly.</p></div>';
  MailApp.sendEmail({
    to: CONFIG.NOTIFY_TO,
    replyTo: d.email,
    name: 'Advitia Labs website',
    subject: 'New lead: ' + oneLine_(d.interest) + ' — ' + oneLine_(d.name),
    htmlBody: html,
    body: rows.map(r => r[0] + ': ' + r[1]).join('\n'),
  });
  return { ok: true };
}

// ---------- Visits ----------
function visit_(d) {
  if (!d.visit_id) return { ok: false, error: 'no visit id' };
  const sh = sheet_(VISITS, VISIT_COLS);
  const head = VISIT_COLS.map(c => c[0]);
  let notify = false;
  withLock_(() => {
    const found = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1)
      .createTextFinder(d.visit_id).matchEntireCell(true).findNext();
    if (!found) {
      const row = VISIT_COLS.map(c => {
        if (c[0] === 'Map') return d.latlng ? '=HYPERLINK("https://maps.google.com/?q=' + String(d.latlng).replace(/[^0-9.,-]/g, '') + '","map")' : '';
        return safe_(d[c[1]]);
      });
      sh.appendRow(row);
      notify = d.event === 'view' && !!d.ref && CONFIG.NOTIFY_ON_LINK_OPEN;
      return;
    }
    const r = found.getRow();
    VISIT_UPDATABLE.forEach(name => {
      const key = VISIT_COLS[head.indexOf(name)][1], v = d[key];
      if (v !== undefined && v !== '') sh.getRange(r, head.indexOf(name) + 1).setValue(safe_(v));
    });
  });
  if (notify) {
    const where = [d.city, d.region, d.country].filter(String).join(', ') || 'unknown location';
    MailApp.sendEmail({
      to: CONFIG.NOTIFY_TO, name: 'Advitia Labs website',
      subject: 'Link opened: ' + oneLine_(d.ref) + ' — ' + where,
      body: 'Your link ?r=' + d.ref + ' was opened.\n\nWhere: ' + where + '\nNetwork: ' + (d.network || '—')
        + '\nDevice: ' + [d.device, d.os, d.browser].filter(String).join(' · ') + '\nVisit # from this browser: ' + (d.n || '1')
        + '\nTime: ' + d.at + ' IST\n\nFull details: the "Visits" tab of this sheet.',
    });
  }
  return { ok: true };
}

// ---------- Housekeeping ----------
// Run once from the editor: installs the daily retention cleanup.
function setup() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'purgeOldVisits').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('purgeOldVisits').timeBased().everyDays(1).atHour(3).inTimezone(CONFIG.TZ).create();
  sheet_(LEADS, LEAD_COLS); sheet_(VISITS, VISIT_COLS);
}

function purgeOldVisits() {
  const sh = SpreadsheetApp.getActive().getSheetByName(VISITS);
  if (!sh || sh.getLastRow() < 2) return;
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - CONFIG.RETENTION_MONTHS);
  const stamp = Utilities.formatDate(cutoff, CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss');
  const started = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getDisplayValues();
  // Rows are appended in time order: delete the leading block that is older than the cutoff.
  let n = 0; while (n < started.length && started[n][0] && started[n][0] < stamp) n++;
  if (n) withLock_(() => sh.deleteRows(2, n));
}

// ---------- helpers ----------
function sheet_(name, cols) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(c => c[0])]).setFontWeight('bold').setBackground('#E4F6E9');
    sh.setFrozenRows(1);
    // Plain text everywhere (no date/number guessing on user input), except the Map link column.
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    const map = cols.findIndex(c => c[0] === 'Map');
    if (map >= 0) sh.getRange(1, map + 1, sh.getMaxRows(), 1).setNumberFormat('General');
  }
  return sh;
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
// Spreadsheet formula injection guard: user text must never start a formula.
function safe_(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).slice(0, 2000);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function oneLine_(s) { return String(s || '').replace(/[\r\n]+/g, ' ').slice(0, 120); }
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
