import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { buildApp } from '../src/app.js';

test('Wochenzettel: schicken, bestätigen, sperren, PDF, Rechte', async () => {
  const db = openDb(':memory:');
  const a = createUser(db, { name: 'Chef', role: 'admin' });
  const w = createUser(db, { name: 'Mitarbeiter' });
  const w2 = createUser(db, { name: 'Zweiter' });
  const app = await buildApp({ db });
  const tok = async (c) => (await app.inject({ method: 'POST', url: '/api/login', payload: { code: c } })).json().token;
  const [at, wt, w2t] = [await tok(a.code), await tok(w.code), await tok(w2.code)];
  const call = (m, u, t, p) => app.inject({ method: m, url: u, headers: { authorization: `Bearer ${t}` }, payload: p });
  const site = Number(db.prepare("INSERT INTO sites (name, color, kind) VALUES ('Lilienstraße', '#E91E63', 'baustelle')").run().lastInsertRowid);
  const t0 = Date.UTC(2026, 10, 9, 6, 0); // Montag 09.11.2026 07:00
  const sheet = (date, off = 0) => ({
    date, start: t0 + off, end: t0 + off + 9 * 3600000, pause_min: 30,
    lines: [{ kind: 'travel', from: t0 + off, to: t0 + off + 1800000, km: 10, vehicle: 'privat' }, { kind: 'work', site_id: site, from: t0 + off + 1800000, to: t0 + off + 9 * 3600000 }],
  });
  assert.equal((await call('POST', '/api/sheets', wt, sheet('2026-11-09'))).statusCode, 200);
  assert.equal((await call('POST', '/api/sheets', wt, sheet('2026-11-10', 86400000))).statusCode, 200);

  // Rechte und Prüfung
  assert.equal((await call('POST', '/api/week-sheets', wt, { user_id: w.id, week_start: '2026-11-09' })).statusCode, 403);
  assert.equal((await call('POST', '/api/week-sheets', at, { user_id: w.id, week_start: '2026-11-16' })).statusCode, 400, 'leere Woche');
  assert.equal((await call('POST', '/api/week-sheets', at, { user_id: w.id, week_start: 'x' })).statusCode, 400);

  // Chef korrigiert einen Zettel
  const list = (await call('GET', '/api/sheets?from=2026-11-09&to=2026-11-15', at)).json();
  assert.equal(list.length, 2);
  const mon = list.find((s) => s.date === '2026-11-09');
  assert.equal((await call('PUT', `/api/sheets/${mon.id}`, wt, { ...mon })).statusCode, 403);
  assert.equal((await call('PUT', `/api/sheets/${mon.id}`, at, { ...mon, pause_min: 45 })).statusCode, 200);

  // Schicken (Mittwoch im Wochenbereich zählt zur selben Woche)
  const sent = await call('POST', '/api/week-sheets', at, { user_id: w.id, week_start: '2026-11-11' });
  assert.equal(sent.statusCode, 200);
  const ws = sent.json();
  assert.equal(ws.status, 'sent');
  assert.equal(ws.week_start, '2026-11-09');
  assert.equal(ws.snapshot.days.length, 2);
  assert.equal(ws.snapshot.days[0].pause_min, 45);
  assert.equal(ws.snapshot.km_privat, 20);
  assert.equal(ws.snapshot.days[0].lines[1].site_name, 'Lilienstraße');

  // Sichtbarkeit
  assert.equal((await call('GET', '/api/week-sheets', wt)).json().length, 1);
  assert.equal((await call('GET', '/api/week-sheets', w2t)).json().length, 0);
  assert.equal((await call('POST', `/api/week-sheets/${ws.id}/confirm`, w2t, { agree: true })).statusCode, 404);

  // Ändert sich ein Tag nach dem Schicken, wird die Woche zurückgenommen
  assert.equal((await call('PUT', `/api/sheets/${mon.id}`, at, { ...mon, pause_min: 30 })).statusCode, 200);
  assert.equal((await call('GET', '/api/week-sheets', at)).json().length, 0);
  const again = (await call('POST', '/api/week-sheets', at, { user_id: w.id, week_start: '2026-11-09' })).json();

  // „Etwas stimmt nicht“
  assert.equal((await call('POST', `/api/week-sheets/${again.id}/reject`, wt, { note: '' })).statusCode, 400);
  const rej = (await call('POST', `/api/week-sheets/${again.id}/reject`, wt, { note: 'Dienstag war ich länger' })).json();
  assert.equal(rej.status, 'rejected');
  assert.equal(rej.reject_note, 'Dienstag war ich länger');
  const re = (await call('POST', '/api/week-sheets', at, { user_id: w.id, week_start: '2026-11-09' })).json();
  assert.equal(re.status, 'sent');
  assert.equal(re.reject_note, null);

  // Bestätigen
  assert.equal((await call('POST', `/api/week-sheets/${re.id}/confirm`, wt, {})).statusCode, 400);
  const before = Date.now();
  const conf = (await call('POST', `/api/week-sheets/${re.id}/confirm`, wt, { agree: true })).json();
  assert.equal(conf.status, 'confirmed');
  assert.ok(conf.confirmed_at >= before);

  // Gesperrt
  assert.equal((await call('POST', '/api/sheets', wt, sheet('2026-11-09'))).statusCode, 409);
  assert.equal((await call('PUT', `/api/sheets/${mon.id}`, at, { ...mon, pause_min: 10 })).statusCode, 409);
  assert.equal((await call('POST', '/api/week-sheets', at, { user_id: w.id, week_start: '2026-11-09' })).statusCode, 409);
  assert.equal((await call('POST', `/api/week-sheets/${re.id}/reject`, wt, { note: 'doch nicht' })).statusCode, 409);
  assert.equal((await call('POST', `/api/week-sheets/${re.id}/confirm`, wt, { agree: true })).statusCode, 409);
  // andere Woche bleibt frei
  assert.equal((await call('POST', '/api/sheets', wt, sheet('2026-11-16', 7 * 86400000))).statusCode, 200);

  // PDF
  const pdf = await call('GET', `/api/week-sheets/${re.id}/pdf`, wt);
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.rawPayload.subarray(0, 4).toString(), '%PDF');
  assert.equal((await call('GET', `/api/week-sheets/${re.id}/pdf`, w2t)).statusCode, 404);
});
