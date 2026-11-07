import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { buildApp } from '../src/app.js';

async function setup() {
  const db = openDb(':memory:');
  const a = createUser(db, { name: 'Chef', role: 'admin' });
  const w = createUser(db, { name: 'Mitarbeiter' });
  const w2 = createUser(db, { name: 'Zweiter' });
  const app = await buildApp({ db });
  const tok = async (c) => (await app.inject({ method: 'POST', url: '/api/login', payload: { code: c } })).json().token;
  const at = await tok(a.code);
  const wt = await tok(w.code);
  const w2t = await tok(w2.code);
  const call = (method, url, token, payload, headers = {}) => app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...headers }, payload });
  const site = db.prepare("INSERT INTO sites (name, color, kind) VALUES ('Lilienstraße', '#E91E63', 'baustelle')").run().lastInsertRowid;
  return { db, app, at, wt, w2t, call, site: Number(site) };
}

const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);

test('Notizen: anlegen, ändern, leer löscht, Mitarbeiter sehen nur eigene', async () => {
  const { call, at, wt, w2t, site } = await setup();
  const n = (await call('POST', '/api/notes', wt, { client_id: 'note-0001-aaaa', date: '2026-11-06', site_id: site, text: 'Bad gefliest, Silikon gezogen' })).json();
  assert.ok(n.id);
  // zweites Mal mit anderem Text: dieselbe Notiz
  const again = (await call('POST', '/api/notes', wt, { client_id: 'note-0001-aaaa', date: '2026-11-06', site_id: site, text: 'Bad gefliest', updated_at: Date.now() + 5 })).json();
  assert.equal(again.id, n.id);
  const mine = (await call('GET', '/api/notes?from=2026-11-01&to=2026-11-30', wt)).json();
  assert.equal(mine.length, 1);
  assert.equal(mine[0].text, 'Bad gefliest');
  assert.equal((await call('GET', '/api/notes?from=2026-11-01&to=2026-11-30', w2t)).json().length, 0, 'fremde Notizen nicht sichtbar');
  assert.equal((await call('GET', '/api/notes?from=2026-11-01&to=2026-11-30', at)).json().length, 1, 'Chef sieht alle');
  assert.equal((await call('POST', '/api/notes', wt, { client_id: 'note-0001-aaaa', date: '2026-11-06', text: '  ' })).json().deleted, true);
  assert.equal((await call('GET', '/api/notes?from=2026-11-01&to=2026-11-30', at)).json().length, 0);
  assert.equal((await call('POST', '/api/notes', wt, { client_id: 'x', date: '2026-11-06', text: 'a' })).statusCode, 400);
  assert.equal((await call('POST', '/api/notes', wt, { client_id: 'note-0002-bbbb', date: 'gestern', text: 'a' })).statusCode, 400);
});

test('Notizen: Chef kann ändern und löschen, Mitarbeiter nicht', async () => {
  const { call, at, wt } = await setup();
  const n = (await call('POST', '/api/notes', wt, { client_id: 'note-0003-cccc', date: '2026-11-05', text: 'alt' })).json();
  assert.equal((await call('PATCH', `/api/notes/${n.id}`, wt, { text: 'x' })).statusCode, 403);
  assert.equal((await call('PATCH', `/api/notes/${n.id}`, at, { text: 'neu' })).json().text, 'neu');
  assert.equal((await call('DELETE', `/api/notes/${n.id}`, wt)).statusCode, 403);
  assert.equal((await call('DELETE', `/api/notes/${n.id}`, at)).statusCode, 200);
});

test('Fotos: hochladen, nur JPEG, zweimal gleiche ID = ein Foto, Zugriff nur Besitzer und Chef', async () => {
  const { call, at, wt, w2t, site } = await setup();
  const h = { 'content-type': 'image/jpeg', 'x-client-id': 'photo-0001-aaaa', 'x-taken-at': String(Date.UTC(2026, 10, 6, 9, 0)), 'x-site-id': String(site) };
  const up = await call('POST', '/api/photos', wt, jpeg(), h);
  assert.equal(up.statusCode, 201);
  const id = up.json().id;
  assert.equal((await call('POST', '/api/photos', wt, jpeg(), h)).json().id, id, 'zweiter Versuch: dasselbe Foto');
  assert.equal((await call('POST', '/api/photos', wt, Buffer.alloc(500, 1), h)).statusCode, 415, 'kein JPEG');
  assert.equal((await call('POST', '/api/photos', wt, jpeg(), { ...h, 'x-client-id': 'photo-0002-bbbb', 'x-site-id': '999' })).statusCode, 400, 'Baustelle gibt es nicht');
  const list = (await call('GET', `/api/photos?from=${Date.UTC(2026, 10, 1)}&to=${Date.UTC(2026, 10, 30)}`, at)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].site_id, site);
  const file = await call('GET', `/api/photos/${id}/file`, at);
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'image/jpeg');
  assert.equal((await call('GET', `/api/photos/${id}/file`, wt)).statusCode, 200, 'Besitzer');
  assert.equal((await call('GET', `/api/photos/${id}/file`, w2t)).statusCode, 404, 'anderer Mitarbeiter');
  assert.equal((await call('DELETE', `/api/photos/${id}`, wt)).statusCode, 403);
  assert.equal((await call('DELETE', `/api/photos/${id}`, at)).statusCode, 200);
  assert.equal((await call('GET', `/api/photos/${id}/file`, at)).statusCode, 404);
});
