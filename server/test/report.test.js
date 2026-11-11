import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/auth.js';
import { buildReportModel, renderReportPdf, periodLabel, isoWeek, fmtH, fmtEur, reportFileName } from '../src/report.js';

const T = (d, hm) => {
  const [h, m] = hm.split(':').map(Number);
  const [y, mo, da] = d.split('-').map(Number);
  return Date.UTC(y, mo - 1, da, h - 2, m); // Sommerzeit (UTC+2)
};
const seg = (userId, name, d, a, b) => ({ userId, name, start: T(d, a), end: T(d, b) });
const base = { customer: { name: 'SN 26055', address: 'Lilienstraße 77, 82343 Pöcking' }, rate: 55, from: '2026-05-26', to: '2026-05-31', type: 'range' };

test('Zeitraum-Beschriftung: Woche, Monat, Von–Bis', () => {
  assert.equal(periodLabel('week', '2026-05-26', '2026-06-01'), 'KW 22/2026');
  assert.equal(periodLabel('month', '2026-10-01', '2026-10-31'), 'Oktober 2026');
  assert.equal(periodLabel('range', '2026-05-26', '2026-06-03'), '26.05.2026 – 03.06.2026');
  assert.deepEqual(isoWeek('2026-01-01'), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 });
});

test('Zahlenformat: Dezimalstunden mit h, Euro mit Tausenderpunkt', () => {
  assert.equal(fmtH(0.75), '0,75 h');
  assert.equal(fmtH(74.5), '74,50 h');
  assert.equal(fmtEur(4097.5), '4.097,50 €');
  assert.equal(fmtEur(55), '55,00 €');
});

test('Modell: ein Block pro Tag, Namen sortiert, Pause nur wenn gezeigt, Summe stimmt', () => {
  const segments = [
    seg(2, 'Serhii', '2026-05-26', '07:15', '15:45'),
    seg(1, 'Mykhaylo', '2026-05-26', '07:00', '12:00'),
    seg(1, 'Mykhaylo', '2026-05-26', '12:45', '16:00'),
    seg(1, 'Mykhaylo', '2026-05-28', '09:00', '09:30'),
  ];
  const breaks = [{ userId: 1, start: T('2026-05-26', '12:00'), end: T('2026-05-26', '12:45') }];
  const m = buildReportModel({ ...base, segments, breaks });
  assert.equal(m.rows.length, 2); // Tage ohne Arbeit sind aus
  const day = m.rows[0];
  assert.equal(day.label, 'Di. 26.05.2026');
  assert.deepEqual(day.persons.map((p) => p.name), ['Mykhaylo', 'Serhii']);
  const my = day.persons[0];
  assert.equal(my.von, '07:00');
  assert.equal(my.bis, '16:00');
  assert.equal(my.netto, 8.25);
  assert.equal(my.pause, 0.75);
  assert.equal(my.brutto, 9);
  assert.equal(my.betrag, 453.75);
  assert.equal(m.rows[1].persons[0].netto, 0.5);
  assert.equal(m.totals.netto, 8.25 + 8.5 + 0.5);
  assert.equal(m.totals.betrag, 453.75 + 467.5 + 27.5);
  // Ohne Pausenspalte keine Pause und Brutto = Netto
  const ohne = buildReportModel({ ...base, segments, breaks, options: { cols: { pause: false } } });
  assert.equal(ohne.rows[0].persons[0].pause, 0);
  assert.equal(ohne.rows[0].persons[0].brutto, 8.25);
});

test('Tage ohne Arbeit: nur mit Häkchen, dann jeder Kalendertag', () => {
  const segments = [seg(1, 'A', '2026-05-27', '07:00', '08:00')];
  const mit = buildReportModel({ ...base, segments, options: { zero_days: true } });
  assert.equal(mit.rows.length, 6);
  assert.equal(mit.rows[0].persons.length, 0);
  assert.equal(mit.rows[5].weekday, 6); // Sonntag 31.05.
});

test('Aufrunden auf 15 Minuten', () => {
  const segments = [seg(1, 'A', '2026-05-27', '07:00', '08:05')];
  const m = buildReportModel({ ...base, segments, options: { round_minutes: 15 } });
  assert.equal(m.rows[0].persons[0].netto, 1.25);
});

test('Dateiname nach Schema', () => {
  const m = buildReportModel({ ...base, segments: [], from: '2026-02-01', to: '2026-02-17' });
  assert.equal(reportFileName(m, 'range', '2026-02-01', '2026-02-17'), 'SN 26055, Lilienstraße 77, 01.02. bis 17.02.2026');
});

test('PDF: erzeugt, auch mit sehr langer Notiz über mehrere Seiten und im Querformat', async () => {
  const segments = [seg(1, 'A', '2026-05-26', '07:00', '16:00'), seg(2, 'B', '2026-05-26', '07:00', '16:00')];
  const notes = { '2026-05-26': 'Wände gespachtelt und geschliffen. '.repeat(400) };
  for (const options of [{}, { orientation: 'landscape', cols: { rate: true } }]) {
    const pdf = await renderReportPdf(buildReportModel({ ...base, segments, notes, options }));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
    assert.ok(pages >= 2, `mehrere Seiten erwartet, gefunden ${pages}`);
  }
});

async function setup() {
  const db = openDb(':memory:');
  const boss = createUser(db, { name: 'Wladi', language: 'de', role: 'admin' });
  const worker = createUser(db, { name: 'Mykhaylo', language: 'de' });
  const app = await buildApp({ db });
  const login = async (code) => (await app.inject({ method: 'POST', url: '/api/login', payload: { code } })).json().token;
  return { db, app, boss, worker, bossToken: await login(boss.code), workerToken: await login(worker.code) };
}

test('Route: PDF für einen Kunden, nur für den Chef, mit Prüfung der Eingaben', async () => {
  const { db, app, worker, bossToken, workerToken } = await setup();
  const cust = db.prepare("INSERT INTO customers (name, address, hourly_rate) VALUES ('SN 26055', 'Lilienstraße 77, Pöcking', 55)").run();
  const site = db.prepare("INSERT INTO sites (customer_id, name, color) VALUES (?, 'Lilienstraße 77', '#ff0000')").run(Number(cust.lastInsertRowid));
  const day = db.prepare('INSERT INTO days (user_id, client_id, started_at, ended_at) VALUES (?, ?, ?, ?)').run(worker.id, 'client-day-1', T('2026-05-26', '07:00'), T('2026-05-26', '16:00'));
  db.prepare("INSERT INTO segments (day_id, client_id, site_id, kind, started_at, ended_at) VALUES (?, 'client-seg-1', ?, 'work', ?, ?)").run(
    Number(day.lastInsertRowid), Number(site.lastInsertRowid), T('2026-05-26', '07:00'), T('2026-05-26', '16:00'),
  );
  const payload = { customer_id: Number(cust.lastInsertRowid), type: 'range', from: '2026-05-26', to: '2026-05-31' };
  const auth = (t) => ({ authorization: `Bearer ${t}` });

  assert.equal((await app.inject({ method: 'POST', url: '/api/reports/customer', payload })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/reports/customer', payload, headers: auth(workerToken) })).statusCode, 403);

  const ok = await app.inject({ method: 'POST', url: '/api/reports/customer', payload, headers: auth(bossToken) });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['content-type'], 'application/pdf');
  assert.match(ok.headers['content-disposition'], /inline/);
  assert.match(decodeURIComponent(ok.headers['content-disposition']), /SN 26055, Lilienstraße 77, 26\.05\. bis 31\.05\.2026\.pdf/);
  assert.equal(ok.rawPayload.subarray(0, 5).toString(), '%PDF-');

  const bad = await app.inject({ method: 'POST', url: '/api/reports/customer', payload: { ...payload, to: '2026-05-01' }, headers: auth(bossToken) });
  assert.equal(bad.statusCode, 400);
  const nocust = await app.inject({ method: 'POST', url: '/api/reports/customer', payload: { ...payload, customer_id: 999 }, headers: auth(bossToken) });
  assert.equal(nocust.statusCode, 404);

  db.prepare('UPDATE customers SET hourly_rate = NULL').run();
  const norate = await app.inject({ method: 'POST', url: '/api/reports/customer', payload, headers: auth(bossToken) });
  assert.equal(norate.statusCode, 400);
  assert.match(norate.json().error, /Stundensatz/);
  const noMoney = await app.inject({ method: 'POST', url: '/api/reports/customer', payload: { ...payload, options: { cols: { amount: false } } }, headers: auth(bossToken) });
  assert.equal(noMoney.statusCode, 200);
});

test('Besichtigung: Zeit sichtbar, aber 0 € (free); bei Abrechnung (bill) wie normale Arbeit', () => {
  const normal = { ...seg(1, 'Wladi', '2026-05-26', '08:00', '09:00'), free: false };
  const besicht = { ...seg(1, 'Wladi', '2026-05-26', '09:00', '10:00'), free: true };
  const m = buildReportModel({ ...base, segments: [normal, besicht] });
  const p = m.rows.find((r) => r.persons.length).persons[0];
  assert.equal(p.netto, 2);
  assert.equal(p.betrag, 55);
  const m2 = buildReportModel({ ...base, segments: [normal, { ...besicht, free: false }] });
  assert.equal(m2.rows.find((r) => r.persons.length).persons[0].betrag, 110);
});
