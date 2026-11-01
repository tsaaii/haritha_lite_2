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
    formulas: {}, charts: [],
    newChart() { const o = { setChartType() { return o; }, addRange() { return o; }, setPosition() { return o; }, setOption() { return o; }, build: () => ({}) }; return o; },
    insertChart(c) { sh.charts.push(c); },
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') { const m = /^([A-Z]+)(\d+)/.exec(r); c = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0); r = +m[2]; nr = 1; nc = 1; }
      return {
        getRow: () => r, getColumn: () => c, setFontColor() { return this; },
        setFormula(f) { sh.formulas[r + ',' + c] = f; return this; },
        setValues(v) { v.forEach((row, i) => { rows[r - 1 + i] = row.slice(); }); return this; },
        setFontWeight() { return this; }, setBackground() { return this; },
        setNumberFormat(f) { sh.formats.push([c, nc, f]); return this; },
        setValue(v) { (rows[r - 1] = rows[r - 1] || [])[c - 1] = v; return this; },
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
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)), deleteSheet: sh => { delete sheets[sh.name]; } }) },
  Charts: { ChartType: { GEO: 'geo' } },
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
assert.strictEqual(mails.length, 2, 'team notification + auto-reply');
assert.strictEqual(mails[0].replyTo, 'a@b.co');
// auto-reply: to the sender, replies go to wecare@, never echoes their free text or formula-ish name
const ar = mails[1];
assert.strictEqual(ar.to, 'a@b.co');
assert.strictEqual(ar.replyTo, 'wecare@advitiaum.com');
assert.ok(ar.htmlBody.includes('Hi there,'), 'unsafe name falls back to "there"');
assert.ok(!ar.htmlBody.includes('hi</b>') && !ar.htmlBody.includes('&lt;b&gt;hi') && !ar.body.includes('<b>hi'), 'details never echoed');
assert.ok(ar.htmlBody.includes('<strong>investing</strong>'));
mails.length = 1; // keep the rest of the test's numbering
assert.ok(mails[0].to.includes('wecare@advitiaum.com') && mails[0].to.includes('saiteja7050@gmail.com'));
assert.ok(!mails[0].htmlBody.includes('<b>hi</b>') && mails[0].htmlBody.includes('&lt;b&gt;hi&lt;/b&gt;'));

// first-name cleaning
assert.strictEqual(ctx.firstName_('Garry Tan'), 'Garry');
assert.strictEqual(ctx.firstName_('Visit http://spam.example now'), 'Visit');
assert.strictEqual(ctx.firstName_('ಸಾಯಿ'), 'ಸಾಯಿ');
assert.strictEqual(ctx.firstName_('సాయి తేజ'), 'సాయి');
assert.strictEqual(ctx.firstName_('=IMPORTXML(1)'), 'there');
assert.strictEqual(ctx.firstName_('x'), 'there');
assert.strictEqual(ctx.firstName_('साई तेजा'), 'साई');

// a failing auto-reply must not fail the lead (row already saved)
const realSend = ctx.MailApp.sendEmail; let n0 = 0;
ctx.MailApp.sendEmail = m => { n0++; if (m.to === 'boom@x.co') throw new Error('quota'); };
assert.deepStrictEqual(post({ token: 'secret', action: 'lead', data: { name: 'Ann', email: 'boom@x.co', interest: 'Investing' } }), { ok: true });
assert.strictEqual(n0, 2);
ctx.MailApp.sendEmail = realSend;
sheets.Leads.rows.pop();

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

// Summary tab: built with formulas pointing at the right Visits columns, plus a geo chart
ctx.buildSummary();
const sum = sheets.Summary, f = Object.values(sum.formulas).join('\n');
assert.strictEqual(sum.rows[0][0], 'Visits by country');
assert.ok(f.includes("select H, count(A) where H <> '' and L <> 'yes'"), 'country=H, datacenter=L');
assert.ok(f.includes('select F, G, H, count(A)'), 'city/region/country = F,G,H');
assert.ok(f.includes("select D, count(A), max(B) where D <> ''"), 'links = D, started = B');
assert.ok(f.includes('select J, count(A)'), 'network = J');
assert.ok(f.includes('select N, count(A)'), 'device = N');
assert.ok(f.includes('LEFT(Visits!B2:B, 10)') && f.includes('Visits!L2:L'));
assert.strictEqual(sum.charts.length, 1);
assert.strictEqual(ctx.colLetter_(1), 'A'); assert.strictEqual(ctx.colLetter_(26), 'Z'); assert.strictEqual(ctx.colLetter_(32), 'AF');

console.log('apps script: all assertions passed');
