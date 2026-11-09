import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { buildApp } from '../src/app.js';

test('Lohn- und Kilometerbericht aus den Zetteln', async () => {
  const db = openDb(':memory:');
  const a = createUser(db, { name: 'Chef', role: 'admin' });
  const w = createUser(db, { name: 'Mykhaylo' });
  const app = await buildApp({ db });
  const tok = async (c) => (await app.inject({ method: 'POST', url: '/api/login', payload: { code: c } })).json().token;
  const [at, wt] = [await tok(a.code), await tok(w.code)];
  const call = (m, u, t, p) => app.inject({ method: m, url: u, headers: { authorization: `Bearer ${t}` }, payload: p });
  const uid = (await call('GET', '/api/me', wt)).json().id;
  const site = Number(db.prepare("INSERT INTO sites (name, color, kind) VALUES ('Lilienstraße', '#E91E63', 'baustelle')").run().lastInsertRowid);
  const t = (h, m) => Date.UTC(2026, 10, 6, h - 1, m); // Berlin ist im November UTC+1
  const sheet = {
    date: '2026-11-06', start: t(7, 0), end: t(18, 0), pause_min: 45,
    lines: [
      { kind: 'travel', from: t(7, 0), to: t(7, 30), km: 12.34, vehicle: 'privat' },
      { kind: 'work', site_id: site, from: t(7, 30), to: t(17, 30) },
      { kind: 'travel', from: t(17, 30), to: t(18, 0), km: 10, vehicle: 'firma' },
    ],
  };
  assert.equal((await call('POST', '/api/sheets', wt, sheet)).statusCode, 200);
  const q = `user_id=${uid}&from=2026-11-01&to=2026-11-30`;
  const pay = (await call('GET', `/api/reports/payroll?${q}`, at)).json();
  assert.equal(pay.days.length, 1);
  assert.equal(pay.days[0].paid_hours, 10.25, '11 Stunden minus 45 Minuten');
  assert.equal(pay.total_hours, 10.25);
  const mil = (await call('GET', `/api/reports/mileage?${q}`, at)).json();
  assert.equal(mil.rows.length, 1, 'nur die Privatauto-Fahrt');
  assert.equal(mil.rows[0].route, 'Zuhause → Lilienstraße');
  assert.equal(mil.total_km, 12.3);
  assert.equal(mil.total_amount, 3.69);
  const x = await call('GET', `/api/reports/payroll?${q}&format=xlsx`, at);
  assert.equal(x.statusCode, 200);
  assert.ok(x.headers['content-type'].includes('spreadsheetml'));
  assert.equal(x.rawPayload.subarray(0, 2).toString(), 'PK', 'ist eine Excel-Datei (zip)');
  const y = await call('GET', `/api/reports/mileage?${q}&format=xlsx`, at);
  assert.equal(y.statusCode, 200);
  assert.equal((await call('GET', `/api/reports/payroll?${q}`, wt)).statusCode, 403, 'Mitarbeiter dürfen das nicht');
  assert.equal((await call('GET', '/api/reports/payroll?user_id=1&from=x&to=y', at)).statusCode, 400);
});
