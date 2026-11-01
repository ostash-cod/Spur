import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { buildApp } from '../src/app.js';
import { SITE_COLORS } from '../src/sites.js';

async function setup(fetchImpl) {
  const db = openDb(':memory:');
  const a = createUser(db, { name: 'Chef', role: 'admin' });
  const w = createUser(db, { name: 'Mitarbeiter' });
  const app = await buildApp({ db, fetchImpl });
  const tok = async (c) => (await app.inject({ method: 'POST', url: '/api/login', payload: { code: c } })).json().token;
  const at = await tok(a.code);
  const wt = await tok(w.code);
  const h = (t) => ({ authorization: `Bearer ${t}` });
  const call = (method, url, token, payload) => app.inject({ method, url, headers: h(token), payload });
  return { db, app, at, wt, call };
}

test('Kunden: anlegen, ändern, archivieren, nur für den Chef', async () => {
  const { call, at, wt } = await setup();
  assert.equal((await call('GET', '/api/customers', wt)).statusCode, 403);
  assert.equal((await call('POST', '/api/customers', at, { name: '  ' })).statusCode, 400);
  assert.equal((await call('POST', '/api/customers', at, { name: 'X', hourly_rate: -5 })).statusCode, 400);

  const c = (await call('POST', '/api/customers', at, { name: 'WEG Lilienstraße', email: 'verwaltung@example.org', hourly_rate: 55 })).json();
  assert.equal(c.hourly_rate, 55);
  const upd = (await call('PATCH', `/api/customers/${c.id}`, at, { hourly_rate: 58, archived: true })).json();
  assert.equal(upd.hourly_rate, 58);
  assert.equal(upd.archived, true);
  assert.equal(upd.email, 'verwaltung@example.org');
  assert.equal((await call('PATCH', '/api/customers/999', at, { name: 'x' })).statusCode, 404);
});

test('Baustellen: Farbe automatisch, Radius aus den Einstellungen, Pflichtfelder', async () => {
  const { call, at } = await setup();
  assert.equal((await call('POST', '/api/sites', at, {})).statusCode, 400);
  assert.equal((await call('POST', '/api/sites', at, { name: 'A', lat: 47.9 })).statusCode, 400, 'Breite ohne Länge');
  assert.equal((await call('POST', '/api/sites', at, { name: 'A', lat: 99, lng: 11 })).statusCode, 400);
  assert.equal((await call('POST', '/api/sites', at, { name: 'A', radius_m: 5 })).statusCode, 400);
  assert.equal((await call('POST', '/api/sites', at, { name: 'A', color: 'rot' })).statusCode, 400);
  assert.equal((await call('POST', '/api/sites', at, { name: 'A', customer_id: 99 })).statusCode, 400);

  const colors = [];
  for (const n of ['Eins', 'Zwei', 'Drei']) {
    const s = (await call('POST', '/api/sites', at, { name: n, lat: 47.96, lng: 11.31 })).json();
    colors.push(s.color);
    assert.equal(s.radius_m, 100, 'Standardradius aus den Einstellungen');
    assert.equal(s.radius_custom, false);
    assert.equal(s.active, true);
  }
  assert.deepEqual(colors, SITE_COLORS.slice(0, 3), 'jede Baustelle bekommt eine andere Farbe');
  assert.ok(!SITE_COLORS.some((c) => ['#F5C400', '#FFD600'].includes(c.toUpperCase())), 'Gelb ist reserviert');
});

test('Baustellen: Mitarbeiter sehen nur aktive, Chef sieht alle, Änderungen gelten sofort', async () => {
  const { call, at, wt } = await setup();
  const cust = (await call('POST', '/api/customers', at, { name: 'Bauer' })).json();
  const s1 = (await call('POST', '/api/sites', at, { name: 'Lilienstraße 77', address: 'Lilienstraße 77, 81669 München', customer_id: cust.id, lat: 48.12, lng: 11.6, radius_m: 150 })).json();
  const s2 = (await call('POST', '/api/sites', at, { name: 'Tutzing' })).json();
  assert.equal(s1.customer_name, 'Bauer');
  assert.equal(s1.radius_m, 150);
  assert.equal(s1.radius_custom, true);

  await call('PATCH', `/api/sites/${s2.id}`, at, { active: false });
  const forWorker = (await call('GET', '/api/sites', wt)).json();
  assert.deepEqual(forWorker.map((s) => s.name), ['Lilienstraße 77']);
  const forAdmin = (await call('GET', '/api/sites?all=1', at)).json();
  assert.equal(forAdmin.length, 2);

  await call('PATCH', `/api/sites/${s1.id}`, at, { archived: true });
  assert.equal((await call('GET', '/api/sites', wt)).json().length, 0);

  assert.equal((await call('POST', '/api/sites', wt, { name: 'Neu' })).statusCode, 403, 'nur der Chef legt Baustellen an');
  assert.equal((await call('PATCH', `/api/sites/${s1.id}`, wt, { name: 'x' })).statusCode, 403);
  assert.equal((await call('PATCH', '/api/sites/999', at, { name: 'x' })).statusCode, 404);

  // Radius zurück auf Standard stellen
  const back = (await call('PATCH', `/api/sites/${s1.id}`, at, { radius_m: null })).json();
  assert.equal(back.radius_m, 100);
  assert.equal(back.radius_custom, false);
});

test('Adresssuche: Treffer, Zwischenspeicher, Fehler, nur Chef', async () => {
  let calls = 0;
  const fake = async (url, opts) => {
    calls++;
    assert.match(String(url), /nominatim\.openstreetmap\.org\/search/);
    assert.match(String(url), /q=Lilienstra%C3%9Fe%2077/);
    assert.match(opts.headers['User-Agent'], /Spur/);
    assert.ok(!/@/.test(opts.headers['User-Agent']), 'keine E-Mail-Adresse in der Anfrage');
    return { ok: true, json: async () => [{ display_name: 'Lilienstraße 77, München', lat: '48.1234', lon: '11.6012' }, { display_name: 'kaputt', lat: 'x', lon: 'y' }] };
  };
  const { call, at, wt } = await setup(fake);
  assert.equal((await call('GET', '/api/geocode?q=Lilienstra%C3%9Fe%2077', wt)).statusCode, 403);
  assert.equal((await call('GET', '/api/geocode?q=ab', at)).statusCode, 400);
  const r = await call('GET', '/api/geocode?q=Lilienstra%C3%9Fe%2077', at);
  assert.deepEqual(r.json(), [{ label: 'Lilienstraße 77, München', lat: 48.1234, lng: 11.6012 }]);
  await call('GET', '/api/geocode?q=Lilienstra%C3%9Fe%2077', at);
  assert.equal(calls, 1, 'zweite Suche kommt aus dem Zwischenspeicher');

  const broken = await setup(async () => { throw new Error('offline'); });
  const e = await broken.call('GET', '/api/geocode?q=Irgendwo%20Strasse%201', broken.at);
  assert.equal(e.statusCode, 502);
  assert.match(e.json().error, /von Hand/);
});
