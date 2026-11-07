import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { buildApp } from '../src/app.js';

test('Tageszettel: abgeben, überschreiben, Rechte, Prüfung', async () => {
  const db = openDb(':memory:');
  const a = createUser(db, { name: 'Chef', role: 'admin' });
  const w = createUser(db, { name: 'Mitarbeiter' });
  const w2 = createUser(db, { name: 'Zweiter' });
  const app = await buildApp({ db });
  const tok = async (c) => (await app.inject({ method: 'POST', url: '/api/login', payload: { code: c } })).json().token;
  const [at, wt, w2t] = [await tok(a.code), await tok(w.code), await tok(w2.code)];
  const call = (m, u, t, p) => app.inject({ method: m, url: u, headers: { authorization: `Bearer ${t}` }, payload: p });
  const site = Number(db.prepare("INSERT INTO sites (name, color, kind) VALUES ('Lilienstraße', '#E91E63', 'baustelle')").run().lastInsertRowid);
  const sheet = {
    date: '2026-11-06', start: 1000, end: 50000, pause_min: 45,
    lines: [
      { kind: 'travel', from: 1000, to: 5000, km: 12.34, vehicle: 'privat' },
      { kind: 'work', site_id: site, from: 5000, to: 40000 },
    ],
  };
  assert.equal((await call('POST', '/api/sheets', wt, sheet)).statusCode, 200);
  sheet.pause_min = 30;
  assert.equal((await call('POST', '/api/sheets', wt, sheet)).statusCode, 200, 'zweites Abgeben überschreibt');
  const got = (await call('GET', '/api/sheets?from=2026-11-01&to=2026-11-30', at)).json();
  assert.equal(got.length, 1);
  assert.equal(got[0].pause_min, 30);
  assert.equal(got[0].lines[0].km, 12.3);
  assert.equal(got[0].user_name, 'Mitarbeiter');
  assert.equal('source' in got[0], false);
  assert.equal((await call('GET', '/api/sheets?from=2026-11-01&to=2026-11-30', w2t)).json().length, 0);
  assert.equal((await call('POST', '/api/sheets', wt, { ...sheet, lines: [{ kind: 'travel', from: 5, to: 1, km: 1 }] })).statusCode, 400);
  assert.equal((await call('POST', '/api/sheets', wt, { ...sheet, lines: [{ kind: 'travel', from: 1, to: 5, km: -3 }] })).statusCode, 400);
  assert.equal((await call('POST', '/api/sheets', wt, { ...sheet, date: 'heute' })).statusCode, 400);
});
