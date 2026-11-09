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
  const own = (r) => r.json().filter((s) => !s.system); // Lager und Firma gibt es immer
  const forWorker = own(await call('GET', '/api/sites', wt));
  assert.deepEqual(forWorker.map((s) => s.name), ['Lilienstraße 77']);
  const forAdmin = own(await call('GET', '/api/sites?all=1', at));
  assert.equal(forAdmin.length, 2);

  await call('PATCH', `/api/sites/${s1.id}`, at, { archived: true });
  assert.equal(own(await call('GET', '/api/sites', wt)).length, 0);

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

// --- Wunschliste: Löschen, Kundenadresse, Kunde automatisch, Zeitabschnitte -----------
test('Kunden: Adresse speichern und löschen nur ohne Baustellen', async () => {
  const { call, at, wt } = await setup();
  const c = (await call('POST', '/api/customers', at, { name: 'Bauer', address: 'Hauptstraße 1, 82343 Pöcking' })).json();
  assert.equal(c.address, 'Hauptstraße 1, 82343 Pöcking');
  assert.equal((await call('PATCH', `/api/customers/${c.id}`, at, { address: 'Neue Straße 2' })).json().address, 'Neue Straße 2');

  const site = (await call('POST', '/api/sites', at, { name: 'Lilienstraße 77', customer_id: c.id })).json();
  assert.equal((await call('DELETE', `/api/customers/${c.id}`, wt)).statusCode, 403);
  const refused = await call('DELETE', `/api/customers/${c.id}`, at);
  assert.equal(refused.statusCode, 409);
  assert.match(refused.json().error, /Baustellen/);

  assert.equal((await call('DELETE', `/api/sites/${site.id}`, at)).statusCode, 200);
  assert.equal((await call('DELETE', `/api/customers/${c.id}`, at)).statusCode, 200);
  assert.equal((await call('GET', '/api/customers', at)).json().length, 0);
  assert.equal((await call('DELETE', `/api/customers/${c.id}`, at)).statusCode, 404);
});

test('Baustelle mit Haken: Kunde mit gleichem Namen und gleicher Adresse wird mit angelegt', async () => {
  const { call, at } = await setup();
  const s = (await call('POST', '/api/sites', at, { name: 'Familie Meier', address: 'Dorfstraße 5, Pöcking', create_customer: true })).json();
  assert.equal(s.customer_name, 'Familie Meier');
  const customers = (await call('GET', '/api/customers', at)).json();
  assert.equal(customers.length, 1);
  assert.equal(customers[0].address, 'Dorfstraße 5, Pöcking');
  // Mit gewähltem Kunden wird kein zweiter angelegt
  await call('POST', '/api/sites', at, { name: 'Zweite', customer_id: customers[0].id, create_customer: true });
  assert.equal((await call('GET', '/api/customers', at)).json().length, 1);
});

test('Zeitabschnitte: speichern, ändern, prüfen, Löschen der Baustelle gesperrt', async () => {
  const { db, app, call, at, wt } = await setup();
  const site = (await call('POST', '/api/sites', at, { name: 'Tutzing', lat: 47.9, lng: 11.28 })).json();
  const t0 = Date.UTC(2026, 10, 2, 6, 0, 0);
  const day = (await call('POST', '/api/days', wt, { client_id: 'seg-test-0001', started_at: t0 })).json();
  const seg = { client_id: 'seg-0001-aaaa', site_id: site.id, kind: 'work', started_at: t0 + 600_000, ended_at: null, source: 'manual' };

  assert.equal((await call('POST', `/api/days/${day.id}/segments`, wt, { segments: [seg] })).statusCode, 200);
  assert.equal((await call('POST', `/api/days/${day.id}/segments`, wt, { segments: [{ ...seg, ended_at: t0 + 7_200_000 }] })).statusCode, 200, 'gleiche client_id aktualisiert');

  const q = `/api/days?user_id=${db.prepare("SELECT id FROM users WHERE name = 'Mitarbeiter'").get().id}&from=${t0 - 1000}&to=${t0 + 86_400_000}`;
  const list = (await call('GET', q, at)).json();
  assert.equal(list[0].segments.length, 1);
  assert.equal(list[0].segments[0].ended_at, t0 + 7_200_000);
  assert.equal(list[0].segments[0].site_id, site.id);

  for (const bad of [[], [{ ...seg, client_id: 'x' }], [{ ...seg, site_id: 999 }], [{ ...seg, kind: 'urlaub', client_id: 'seg-0002-bbbb' }], [{ ...seg, ended_at: t0 - 5, client_id: 'seg-0003-cccc' }]]) {
    assert.equal((await call('POST', `/api/days/${day.id}/segments`, wt, { segments: bad })).statusCode, 400, JSON.stringify(bad).slice(0, 60));
  }
  const refused = await call('DELETE', `/api/sites/${site.id}`, at);
  assert.equal(refused.statusCode, 409);
  assert.match(refused.json().error, /archiviere/);
  assert.equal((await call('POST', `/api/days/9999/segments`, wt, { segments: [seg] })).statusCode, 404);
});

test('Bestehende Datenbank ohne Kundenadresse wird beim Start ergänzt', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const path = join(mkdtempSync(join(tmpdir(), 'spur-mig-')), 'alt.db');
  const old = new DatabaseSync(path);
  old.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT, hourly_rate REAL, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT); INSERT INTO customers (name) VALUES (\'Alt\')');
  old.close();
  const db = openDb(path);
  const cols = db.prepare('PRAGMA table_info(customers)').all().map((c) => c.name);
  assert.ok(cols.includes('address'));
  assert.equal(db.prepare('SELECT name FROM customers').get().name, 'Alt', 'alte Daten bleiben erhalten');
  openDb(path); // zweiter Start geht ohne Fehler
});

// --- Lager und Firma als feste Orte --------------------------------------------
test('Lager und Firma: feste Orte aus den Einstellungen, geschützt, folgen Änderungen', async () => {
  const { call, at, wt } = await setup();
  const list = (await call('GET', '/api/sites?all=1', at)).json();
  const lager = list.find((s) => s.system === 'lager');
  const firma = list.find((s) => s.system === 'firma');
  assert.equal(lager.name, 'Lager');
  assert.equal(lager.lat, 47.96137940326983, 'Lager-Position aus den Einstellungen');
  assert.equal(firma.lat, null, 'Firma hat noch keine Position');
  assert.ok(lager.color && firma.color && lager.color !== firma.color);

  // Mitarbeiter bekommen beide (für Kacheln und Erkennung)
  const forWorker = (await call('GET', '/api/sites', wt)).json();
  assert.ok(forWorker.some((s) => s.system === 'lager') && forWorker.some((s) => s.system === 'firma'));

  // Schutz
  assert.equal((await call('PATCH', `/api/sites/${lager.id}`, at, { name: 'Anderer Name' })).statusCode, 400);
  assert.equal((await call('PATCH', `/api/sites/${lager.id}`, at, { archived: true })).statusCode, 400);
  assert.equal((await call('PATCH', `/api/sites/${lager.id}`, at, { color: '#112233' })).statusCode, 200);
  assert.equal((await call('PATCH', `/api/sites/${lager.id}`, at, { active: false })).statusCode, 200);
  const del = await call('DELETE', `/api/sites/${lager.id}`, at);
  assert.equal(del.statusCode, 409);
  assert.match(del.json().error, /feste Orte/);

  // Einstellungen ändern die Orte mit
  await call('PUT', '/api/settings', at, { firma: { lat: 47.97, lng: 11.31, radius_m: 80 }, lager: { lat: 47.9, lng: 11.2, radius_m: 120 } });
  const after = (await call('GET', '/api/sites?all=1', at)).json();
  const firma2 = after.find((s) => s.system === 'firma');
  assert.equal(firma2.lat, 47.97);
  assert.equal(firma2.radius_m, 80);
  assert.equal(after.find((s) => s.system === 'lager').radius_m, 120);
  assert.equal(after.filter((s) => s.system).length, 2, 'keine doppelten Systemorte');
});

// --- Position aus Google-Maps-Link ---------------------------------------------------
import { coordsFromText, resolveMapLink } from '../src/sites.js';

const headers = (h) => ({ get: (k) => h[k.toLowerCase()] ?? null });

test('Google-Maps-Adressen: Stecknadel hat Vorrang vor Kartenmitte', () => {
  assert.deepEqual(coordsFromText('https://www.google.com/maps/place/X/@48.1111,11.2222,17z/data=!3d47.9611!4d11.3055'), { lat: 47.9611, lng: 11.3055 });
  assert.deepEqual(coordsFromText('https://www.google.com/maps/place/X/@48.1111,11.2222,17z'), { lat: 48.1111, lng: 11.2222 });
  assert.deepEqual(coordsFromText('https://www.google.com/maps?q=47.9611,11.3055'), { lat: 47.9611, lng: 11.3055 });
  assert.deepEqual(coordsFromText('https://maps.google.com/?ll=47.9611%2C11.3055&z=15'), { lat: 47.9611, lng: 11.3055 });
  assert.deepEqual(coordsFromText('https://www.google.com/maps/place/47.9611,-11.3055'), { lat: 47.9611, lng: -11.3055 });
  assert.equal(coordsFromText('https://www.google.com/maps/@99.5,11.2,5z'), null, 'ungültige Breite');
  assert.equal(coordsFromText('nichts'), null);
});

test('Kurzlink wird über die Weiterleitungen aufgelöst, auch über die Einwilligungsseite', async () => {
  const seen = [];
  const fake = async (url) => {
    seen.push(String(url));
    if (url.startsWith('https://maps.app.goo.gl/')) return { status: 302, headers: headers({ location: 'https://consent.google.com/ml?continue=' + encodeURIComponent('https://www.google.com/maps/place/Zuhause/@47.97,11.31,17z/data=!3d47.9655!4d11.3123') }) };
    throw new Error('unerwartet: ' + url);
  };
  const r = await resolveMapLink('https://maps.app.goo.gl/AbCdEf123', fake);
  assert.deepEqual(r, { lat: 47.9655, lng: 11.3123 });
  assert.equal(seen.length, 1, 'nur eine Anfrage nötig');

  const viaHtml = async () => ({ status: 200, headers: headers({}), text: async () => '<html>… "https://www.google.com/maps/@47.5,11.5,15z" …</html>' });
  assert.deepEqual(await resolveMapLink('https://maps.app.goo.gl/x', viaHtml), { lat: 47.5, lng: 11.5 });
});

test('Link-Auflösung: nur Google-Hosts, keine Weiterleitung zu fremden Servern, klare Fehler', async () => {
  const never = async () => { throw new Error('darf nicht aufgerufen werden'); };
  for (const bad of ['http://maps.app.goo.gl/x', 'https://evil.example.com/maps/@1.1,2.2', 'https://google.com.evil.example/maps', 'kein link']) {
    await assert.rejects(resolveMapLink(bad, never), (e) => e.status === 400, bad);
  }
  const toEvil = async () => ({ status: 302, headers: headers({ location: 'https://evil.example.com/steal' }) });
  await assert.rejects(resolveMapLink('https://maps.app.goo.gl/x', toEvil), (e) => e.status === 400, 'Weiterleitung auf fremden Host');
  const empty = async () => ({ status: 200, headers: headers({}), text: async () => '<html>nichts</html>' });
  await assert.rejects(resolveMapLink('https://maps.app.goo.gl/x', empty), (e) => e.status === 422 && /Teilen/.test(e.message));
  const loop = async () => ({ status: 302, headers: headers({ location: 'https://maps.app.goo.gl/again' }) });
  await assert.rejects(resolveMapLink('https://maps.app.goo.gl/x', loop), (e) => e.status === 422, 'Endlosschleife wird abgebrochen');
});

test('Schnittstelle /api/maplink: nur Chef, liefert Breite und Länge, Fehler verständlich', async () => {
  const fake = async () => ({ status: 302, headers: headers({ location: 'https://www.google.com/maps/place/Z/@47.9,11.3,17z/data=!3d47.9655!4d11.3123' }) });
  const { call, at, wt } = await setup(fake);
  const q = '/api/maplink?url=' + encodeURIComponent('https://maps.app.goo.gl/AbC');
  assert.equal((await call('GET', q, wt)).statusCode, 403);
  assert.deepEqual((await call('GET', q, at)).json(), { lat: 47.9655, lng: 11.3123 });
  assert.equal((await call('GET', '/api/maplink?url=' + encodeURIComponent('https://example.com'), at)).statusCode, 400);
  const broken = await setup(async () => { throw new Error('offline'); });
  const e = await broken.call('GET', q, broken.at);
  assert.equal(e.statusCode, 502);
  assert.match(e.json().error, /von Hand/);
});

test('Position setzen (Handy vor Ort): Baustelle, Lager und Firma, nur Chef, nur gültige Werte', async () => {
  const { call, at, wt } = await setup();
  const site = (await call('POST', '/api/sites', at, { name: 'Neu hier' })).json();
  assert.equal(site.lat, null);
  assert.equal((await call('POST', `/api/sites/${site.id}/position`, wt, { lat: 47.9, lng: 11.3 })).statusCode, 403);
  assert.equal((await call('POST', `/api/sites/${site.id}/position`, at, { lat: 99, lng: 11.3 })).statusCode, 400);
  assert.equal((await call('POST', `/api/sites/${site.id}/position`, at, { lat: 47.9 })).statusCode, 400);
  assert.equal((await call('POST', '/api/sites/999/position', at, { lat: 47.9, lng: 11.3 })).statusCode, 404);
  const ok = (await call('POST', `/api/sites/${site.id}/position`, at, { lat: 47.912345, lng: 11.312345 })).json();
  assert.equal(ok.lat, 47.912345);
  assert.equal(ok.radius_m, 100);

  // Lager und Firma: Position landet in den Einstellungen und im festen Ort
  const all = (await call('GET', '/api/sites?all=1', at)).json();
  const firma = all.find((s) => s.system === 'firma');
  const set = (await call('POST', `/api/sites/${firma.id}/position`, at, { lat: 47.9655, lng: 11.3123 })).json();
  assert.equal(set.lat, 47.9655);
  const settings = (await call('GET', '/api/settings', at)).json();
  assert.equal(settings.firma.lat, 47.9655);
  assert.equal(settings.firma.radius_m, 100, 'Radius bleibt');
  assert.equal(all.filter((s) => s.system).length, 2);
});

test('Händler: jeder darf einen anlegen, Baustellen nur der Chef; Art ist änderbar', async () => {
  const { call, at, wt } = await setup();
  const hd = await call('POST', '/api/sites', wt, { name: 'Brillux', kind: 'haendler', lat: 48.0, lng: 11.0 });
  assert.equal(hd.statusCode, 201);
  assert.equal(hd.json().kind, 'haendler');
  assert.equal(hd.json().customer_id, null);
  assert.equal((await call('POST', '/api/sites', wt, { name: 'Baustelle X', lat: 48.0, lng: 11.0 })).statusCode, 403);
  assert.equal((await call('POST', '/api/sites', wt, { name: 'Brillux 2', kind: 'haendler', color: '#112233' })).statusCode, 403, 'Mitarbeiter ohne Sonderwünsche');
  assert.equal((await call('POST', '/api/sites', at, { name: 'Y', kind: 'quatsch' })).statusCode, 400);
  const b = (await call('POST', '/api/sites', at, { name: 'Lilienstraße 77', lat: 48.1, lng: 11.6 })).json();
  assert.equal(b.kind, 'baustelle');
  const all = (await call('GET', '/api/sites', wt)).json();
  assert.ok(all.some((s) => s.kind === 'haendler' && s.name === 'Brillux'));
  const upd = (await call('PATCH', `/api/sites/${hd.json().id}`, at, { kind: 'baustelle' })).json();
  assert.equal(upd.kind, 'baustelle');
});

test('Fahrt-Markierung: Materialfahrt einer Baustelle zuordnen, Streifen wegnehmen, zurücksetzen', async () => {
  const { call, at, wt, db } = await setup();
  const site = (await call('POST', '/api/sites', at, { name: 'Lilienstraße 77', lat: 48.1, lng: 11.6 })).json();
  const dayRes = await call('POST', '/api/days', wt, { client_id: 'day-client-0001', started_at: 1_770_000_000_000 });
  const dayId = dayRes.json().id;
  const mark = (payload) => call('PUT', `/api/days/${dayId}/trip-mark`, at, payload);
  assert.equal((await call('PUT', `/api/days/${dayId}/trip-mark`, wt, { started_at: 1_770_000_600_000, mode: 'normal' })).statusCode, 403);
  assert.equal((await mark({ started_at: 1_770_000_600_000, mode: 'material' })).statusCode, 400, 'Baustelle fehlt');
  assert.equal((await mark({ started_at: 1_770_000_600_000, mode: 'material', site_id: site.id })).statusCode, 200);
  assert.equal((await mark({ started_at: 1_770_000_600_000, mode: 'private' })).statusCode, 200, 'Privatfahrt');
  assert.equal((await mark({ started_at: 1_770_000_600_000, mode: 'normal' })).statusCode, 200, 'überschreibt');
  let days = (await call('GET', `/api/days?user_id=${db.prepare('SELECT user_id FROM days WHERE id = ?').get(dayId).user_id}&from=1700000000000&to=1800000000000`, at)).json();
  assert.deepEqual(days[0].trip_marks, [{ started_at: 1_770_000_600_000, mode: 'normal', site_id: null }]);
  assert.equal((await mark({ started_at: 1_770_000_600_000, mode: 'auto' })).statusCode, 200);
  days = (await call('GET', `/api/days?user_id=${db.prepare('SELECT user_id FROM days WHERE id = ?').get(dayId).user_id}&from=1700000000000&to=1800000000000`, at)).json();
  assert.deepEqual(days[0].trip_marks, []);
  assert.equal((await call('PUT', '/api/days/999/trip-mark', at, { started_at: 1_770_000_600_000, mode: 'normal' })).statusCode, 404);
  assert.equal((await mark({ started_at: 5, mode: 'normal' })).statusCode, 400);
});

test('Art ändern per POST (für das Handy): nur Chef, Händler wird Baustelle mit eigener Farbe und umgekehrt', async () => {
  const { call, at, wt } = await setup();
  const h = (await call('POST', '/api/sites', wt, { name: 'Feichtetstr. 1', kind: 'haendler', lat: 48.0, lng: 11.3 })).json();
  assert.equal(h.color, '#8D6E63');
  assert.equal((await call('POST', `/api/sites/${h.id}/kind`, wt, { kind: 'baustelle' })).statusCode, 403);
  assert.equal((await call('POST', `/api/sites/${h.id}/kind`, at, { kind: 'quatsch' })).statusCode, 400);
  const b = (await call('POST', `/api/sites/${h.id}/kind`, at, { kind: 'baustelle' })).json();
  assert.equal(b.kind, 'baustelle');
  assert.notEqual(b.color, '#8D6E63');
  const back = (await call('POST', `/api/sites/${h.id}/kind`, at, { kind: 'haendler' })).json();
  assert.equal(back.kind, 'haendler');
  assert.equal(back.color, '#8D6E63');
  const sys = (await call('GET', '/api/sites?all=1', at)).json().find((s) => s.system);
  assert.equal((await call('POST', `/api/sites/${sys.id}/kind`, at, { kind: 'haendler' })).statusCode, 400);
  assert.equal((await call('POST', '/api/sites/999/kind', at, { kind: 'haendler' })).statusCode, 404);
});

test('App-Update: Version und Datei werden ausgeliefert, ohne Datei 404', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'spur-apk-'));
  const db = openDb(':memory:');
  const none = await buildApp({ db, apkDir: join(dir, 'gibtsnicht') });
  assert.equal((await none.inject({ method: 'GET', url: '/api/app-version' })).statusCode, 404);
  assert.equal((await none.inject({ method: 'GET', url: '/api/app.apk' })).statusCode, 404);
  writeFileSync(join(dir, 'spur.apk'), 'PK-testdatei');
  writeFileSync(join(dir, 'version.json'), JSON.stringify({ versionCode: 8, versionName: '0.7.0' }));
  const app = await buildApp({ db, apkDir: dir });
  const v = (await app.inject({ method: 'GET', url: '/api/app-version' })).json();
  assert.deepEqual(v, { versionCode: 8, versionName: '0.7.0', size: 12 });
  const f = await app.inject({ method: 'GET', url: '/api/app.apk' });
  assert.equal(f.statusCode, 200);
  assert.equal(f.headers['content-type'], 'application/vnd.android.package-archive');
  assert.equal(f.body, 'PK-testdatei');
});

test('Zusätzliche Punkte: nur in der Nähe, nicht doppelt, Chef kann löschen', async () => {
  const { call, at, wt } = await setup();
  const s = (await call('POST', '/api/sites', at, { name: 'Hagebau', kind: 'haendler', lat: 48.0, lng: 11.0 })).json();
  assert.deepEqual(s.extra_points, []);
  // 200 m nördlich (0,0018 Grad Breite): wird gemerkt
  const near = await call('POST', `/api/sites/${s.id}/points`, wt, { lat: 48.0018, lng: 11.0 });
  assert.equal(near.statusCode, 201);
  assert.equal(near.json().extra_points.length, 1);
  // fast derselbe Punkt: schon abgedeckt, nichts Neues
  const dup = await call('POST', `/api/sites/${s.id}/points`, wt, { lat: 48.0019, lng: 11.0 });
  assert.equal(dup.json().extra_points.length, 1);
  // 5 km entfernt: abgelehnt
  assert.equal((await call('POST', `/api/sites/${s.id}/points`, wt, { lat: 48.05, lng: 11.0 })).statusCode, 422);
  // Löschen nur der Chef
  const pid = near.json().extra_points[0].id;
  assert.equal((await call('DELETE', `/api/sites/${s.id}/points/${pid}`, wt)).statusCode, 403);
  assert.equal((await call('DELETE', `/api/sites/${s.id}/points/${pid}`, at)).statusCode, 200);
  const list = (await call('GET', '/api/sites', wt)).json().find((x) => x.id === s.id);
  assert.deepEqual(list.extra_points, []);
});

test('Handy: Name ändern und Kunde nachträglich anlegen', async () => {
  const { call, at, wt } = await setup();
  const s = (await call('POST', '/api/sites', at, { name: 'Stauffenbergstr 3', lat: 48.0, lng: 11.0 })).json();
  assert.equal(s.customer_id ?? null, null);
  assert.equal((await call('POST', `/api/sites/${s.id}/edit`, wt, { name: 'x' })).statusCode, 403, 'nur Chef');
  assert.equal((await call('POST', `/api/sites/${s.id}/edit`, at, { name: '  ' })).statusCode, 400);
  const e = (await call('POST', `/api/sites/${s.id}/edit`, at, { name: 'Stauffenbergstr 3 · Wolfram', create_customer: true })).json();
  assert.equal(e.name, 'Stauffenbergstr 3 · Wolfram');
  assert.equal(e.customer_name, 'Stauffenbergstr 3 · Wolfram');
  const again = (await call('POST', `/api/sites/${s.id}/edit`, at, { create_customer: true })).json();
  assert.equal(again.customer_id, e.customer_id, 'nicht zweimal anlegen');
  const customers = (await call('GET', '/api/customers', at)).json();
  assert.equal(customers.filter((c) => c.name.startsWith('Stauffenbergstr')).length, 1);
});
