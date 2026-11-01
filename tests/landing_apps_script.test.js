// Offline test for apps_script/landing/Code.gs with stubbed Google services.
//   node tests/landing_apps_script.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

function makeSheet(name) {
  const rows = [];
  const sh = {
    name, rows, formats: [],
    getLastRow: () => rows.length,
    getMaxRows: () => 1000,
    appendRow: r => rows.push(r.slice()),
    setFrozenRows() {},
    getRange(r, c, nr, nc) {
      return {
        setValues(v) { v.forEach((row, i) => { rows[r - 1 + i] = row.slice(); }); return this; },
        setFontWeight() { return this; }, setBackground() { return this; },
        setNumberFormat(f) { sh.formats.push([c, nc, f]); return this; },
        setValue(v) { rows[r - 1][c - 1] = v; return this; },
        getDisplayValues() { return rows.slice(r - 1, r - 1 + nr).map(x => [String(x[c - 1])]); },
        createTextFinder(q) {
          return { matchEntireCell() { return this; }, findNext() {
            for (let i = r - 1; i < Math.min(rows.length, r - 1 + nr); i++) if (rows[i] && rows[i][c - 1] === q) return { getRow: () => i + 1 };
            return null; } };
        },
      };
    },
    deleteRows(start, n) { rows.splice(start - 1, n); },
  };
  return sh;
}
const sheets = {}, mails = [];
const ctx = {
  console,
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)) }) },
  MailApp: { sendEmail: m => mails.push(m) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
  Utilities: { formatDate: d => d.toISOString().replace('T', ' ').slice(0, 19) },
  ScriptApp: {},
};
vm.createContext(ctx);
const src = fs.readFileSync(path.join(__dirname, '..', 'apps_script', 'landing', 'Code.gs'), 'utf8')
  .replace("TOKEN: 'CHANGE-ME-long-random-string'", "TOKEN: 'secret'");
vm.runInContext(src, ctx);
const post = (body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } });

// auth
assert.strictEqual(post({ token: 'nope', action: 'lead', data: {} }).ok, false);
assert.strictEqual(ctx.doGet().ok, true);

// lead: row + email, formula injection neutralised, reply-to the lead
let r = post({ token: 'secret', action: 'lead', data: { received_at: '2026-11-01 10:00:00', name: '=IMPORTXML("x")', email: 'a@b.co', interest: 'Investing', details: '<b>hi</b>', city: 'Bengaluru', country: 'IN' } });
assert.deepStrictEqual(r, { ok: true });
const lead = sheets.Leads.rows[1];
assert.strictEqual(lead[1], "'=IMPORTXML(\"x\")");
assert.strictEqual(mails.length, 1);
assert.strictEqual(mails[0].replyTo, 'a@b.co');
assert.ok(mails[0].to.includes('wecare@advitiaum.com') && mails[0].to.includes('saiteja7050@gmail.com'));
assert.ok(!mails[0].htmlBody.includes('<b>hi</b>') && mails[0].htmlBody.includes('&lt;b&gt;hi&lt;/b&gt;'));

// visit: view appends, update modifies the same row, link-open email only for ?r=
post({ token: 'secret', action: 'visit', data: { event: 'view', visit_id: 'VISIT00001', at: '2026-11-01 10:01:00', ref: 'yc-garry', city: 'San Francisco', country: 'US', latlng: '37.77,-122.41', device: 'Desktop' } });
post({ token: 'secret', action: 'visit', data: { event: 'view', visit_id: 'VISIT00002', at: '2026-11-01 10:02:00' } });
assert.strictEqual(sheets.Visits.rows.length, 3);
assert.strictEqual(mails.length, 2, 'one link-open email for the ?r= visit only');
assert.ok(mails[1].subject.includes('yc-garry') && mails[1].subject.includes('San Francisco'));
const head = sheets.Visits.rows[0];
post({ token: 'secret', action: 'visit', data: { event: 'update', visit_id: 'VISIT00001', at: '2026-11-01 10:05:00', duration: '184', scroll: '92', sections: 'traction > problem > platform', clicks: 'Request a pilot' } });
assert.strictEqual(sheets.Visits.rows.length, 3, 'update must not append');
const v1 = sheets.Visits.rows[1];
assert.strictEqual(v1[head.indexOf('Engaged (s)')], '184');
assert.strictEqual(v1[head.indexOf('Last update (IST)')], '2026-11-01 10:05:00');
assert.strictEqual(v1[head.indexOf('Started (IST)')], '2026-11-01 10:01:00');
assert.ok(String(v1[head.indexOf('Map')]).startsWith('=HYPERLINK("https://maps.google.com/?q=37.77,-122.41"'));
assert.strictEqual(mails.length, 2, 'updates never email');

// update for an unseen visit (view beacon lost) still records it
post({ token: 'secret', action: 'visit', data: { event: 'update', visit_id: 'VISIT00003', at: '2026-11-01 10:06:00', duration: '12' } });
assert.strictEqual(sheets.Visits.rows.length, 4);

// retention purge removes the old leading rows only
sheets.Visits.rows.splice(1, 0, ['OLD', '2020-01-01 00:00:00']);
ctx.purgeOldVisits();
assert.strictEqual(sheets.Visits.rows[1][0], 'VISIT00001');

console.log('apps script: all assertions passed');
