import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { buildApp } from '../src/app.js';

test('Belege: Freischaltung, Hochladen, Aufteilen, Eingangskorb', async () => {
  const db = openDb(':memory:');
  const a = createUser(db, { name: 'Chef', role: 'admin' });
  const w = createUser(db, { name: 'Mitarbeiter' });
  const app = await buildApp({ db });
  const tok = async (c) => (await app.inject({ method: 'POST', url: '/api/login', payload: { code: c } })).json().token;
  const [at, wt] = [await tok(a.code), await tok(w.code)];
  const call = (m, u, t, p, h = {}) => app.inject({ method: m, url: u, headers: { authorization: `Bearer ${t}`, ...h }, payload: p });
  const s1 = Number(db.prepare("INSERT INTO sites (name, color, kind) VALUES ('Lilienstraße', '#E91E63', 'baustelle')").run().lastInsertRowid);
  const s2 = Number(db.prepare("INSERT INTO sites (name, color, kind) VALUES ('Lager', '#999999', 'lager')").run().lastInsertRowid);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 1)]);
  const hdr = { 'content-type': 'application/pdf', 'x-client-id': 'receipt-0001-aaaa', 'x-taken-at': String(Date.now()) };

  assert.equal((await call('POST', '/api/receipts', wt, pdf, hdr)).statusCode, 403, 'Mitarbeiter ohne Freischaltung');
  assert.equal((await call('GET', '/api/me', at)).json().can_receipts, true, 'Chef hat es immer');
  assert.equal((await call('GET', '/api/me', wt)).json().can_receipts, false);
  const uid = (await call('GET', '/api/me', wt)).json().id;
  await call('PATCH', `/api/users/${uid}`, at, { can_receipts: true });
  assert.equal((await call('GET', '/api/me', wt)).json().can_receipts, true);

  const up = await call('POST', '/api/receipts', wt, pdf, hdr);
  assert.equal(up.statusCode, 201);
  assert.equal((await call('POST', '/api/receipts', wt, pdf, hdr)).statusCode, 200, 'zweites Mal: dieselbe Datei');
  assert.equal((await call('POST', '/api/receipts', wt, Buffer.alloc(300, 2), { ...hdr, 'content-type': 'application/pdf', 'x-client-id': 'receipt-0002-bbbb' })).statusCode, 415, 'kein PDF');

  const inbox = (await call('GET', '/api/receipts?unassigned=1', at)).json();
  assert.equal(inbox.length, 1);
  const r = await call('POST', '/api/receipts/allocs', wt, { client_id: 'receipt-0001-aaaa', allocs: [{ site_id: s1, text: '10 von 20 Schienen' }, { site_id: s2, text: '10 Stück Vorrat' }] });
  assert.equal(r.statusCode, 200);
  assert.equal((await call('GET', '/api/receipts?unassigned=1', at)).json().length, 0);
  const forSite = (await call('GET', `/api/receipts?site_id=${s1}`, at)).json();
  assert.equal(forSite.length, 1);
  assert.equal(forSite[0].allocs.length, 2);
  assert.equal(forSite[0].allocs[0].text, '10 von 20 Schienen');
  const file = await call('GET', `/api/receipts/${forSite[0].id}/file`, at);
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'application/pdf');
  assert.equal((await call('GET', `/api/receipts/${forSite[0].id}/file`, wt)).statusCode, 403, 'Mitarbeiter sehen Belege nicht');
  assert.equal((await call('PUT', `/api/receipts/${forSite[0].id}/allocs`, at, { allocs: [{ site_id: 99999 }] })).statusCode, 400);
  assert.equal((await call('PUT', `/api/receipts/${forSite[0].id}/allocs`, at, { allocs: [] })).statusCode, 200);
  assert.equal((await call('GET', '/api/receipts?unassigned=1', at)).json().length, 1, 'zurück im Eingangskorb');
});
