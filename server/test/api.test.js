import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSetting, purgeRoutePoints } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { buildApp } from '../src/app.js';

let app, admin, worker;
let adminToken, workerToken;

async function login(code) {
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { code } });
  return res;
}
const auth = (token) => ({ authorization: `Bearer ${token}` });

before(async () => {
  const db = openDb(':memory:');
  admin = createUser(db, { name: 'Wladi', language: 'uk', role: 'admin' });
  worker = createUser(db, { name: 'Mykhaylo', language: 'ru', uses_private_car: 1 });
  app = await buildApp({ db });
  adminToken = (await login(admin.code)).json().token;
  workerToken = (await login(worker.code)).json().token;
});

test('Anmeldung: richtiger Code, Tippfehler in Schreibweise egal', async () => {
  const res = await login(worker.code.toLowerCase().replace('-', ' '));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().user.name, 'Mykhaylo');
  assert.equal(res.json().user.uses_private_car, true);
});

test('Anmeldung: falscher Code wird abgelehnt', async () => {
  const res = await login('AAAA-AAAA');
  assert.equal(res.statusCode, 401);
});

test('Ohne Anmeldung kein Zugriff', async () => {
  assert.equal((await app.inject({ url: '/api/me' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/users' })).statusCode, 401);
});

test('Mitarbeiter sehen die Mitarbeiterliste nicht', async () => {
  const res = await app.inject({ url: '/api/users', headers: auth(workerToken) });
  assert.equal(res.statusCode, 403);
});

test('Chef legt Mitarbeiter an, Code wird nur einmal gezeigt', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: auth(adminToken),
    payload: { name: 'Serhii', language: 'uk', uses_private_car: false },
  });
  assert.equal(res.statusCode, 201);
  const { user, code } = res.json();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(user.uses_private_car, false);
  const list = await app.inject({ url: '/api/users', headers: auth(adminToken) });
  assert.ok(list.json().every((u) => !('code' in u) && !('code_hash' in u)));
  assert.equal((await login(code)).statusCode, 200);
});

test('Ungültige Sprache wird abgelehnt', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: auth(adminToken),
    payload: { name: 'Test', language: 'xx' },
  });
  assert.equal(res.statusCode, 400);
});

test('Auto-Knopf pro Mitarbeiter ein- und ausschalten', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/users/${worker.id}`,
    headers: auth(adminToken),
    payload: { uses_private_car: false },
  });
  assert.equal(res.json().uses_private_car, false);
  const me = await app.inject({ url: '/api/me', headers: auth(workerToken) });
  assert.equal(me.json().uses_private_car, false);
});

test('Neuer Code macht den alten ungültig und beendet alte Sitzungen', async () => {
  const oldCode = worker.code;
  const res = await app.inject({
    method: 'POST',
    url: `/api/users/${worker.id}/new-code`,
    headers: auth(adminToken),
  });
  const newCode = res.json().code;
  assert.notEqual(newCode, oldCode);
  assert.equal((await login(oldCode)).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/me', headers: auth(workerToken) })).statusCode, 401);
  workerToken = (await login(newCode)).json().token;
});

test('Deaktivierter Mitarbeiter kann sich nicht mehr anmelden', async () => {
  const created = (
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(adminToken),
      payload: { name: 'Praktikant' },
    })
  ).json();
  await app.inject({
    method: 'PATCH',
    url: `/api/users/${created.user.id}`,
    headers: auth(adminToken),
    payload: { active: false },
  });
  assert.equal((await login(created.code)).statusCode, 401);
});

test('Chef kann sich nicht selbst deaktivieren', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: '/api/users/1',
    headers: auth(adminToken),
    payload: { active: false },
  });
  assert.equal(res.statusCode, 400);
});

test('Standard-Einstellungen: Pausenstaffel, 10 Minuten, Lager Pöcking', async () => {
  const res = await app.inject({ url: '/api/settings', headers: auth(workerToken) });
  const s = res.json();
  assert.deepEqual(s.break_rules, [
    [2.5, 15],
    [5, 30],
    [7.5, 45],
    [10, 60],
  ]);
  assert.equal(s.unknown_place_minutes, 10);
  assert.equal(s.lager.lat, 47.96137940326983);
  assert.equal(s.lager.lng, 11.30548442373459);
  assert.equal(s.lager.radius_m, 100);
  assert.equal(s.km_rate_employee, 0.3);
  assert.equal(s.km_rate_customer, 0.5);
});

test('Nur der Chef ändert Einstellungen, und sie werden geprüft', async () => {
  const forbidden = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: auth(workerToken),
    payload: { unknown_place_minutes: 5 },
  });
  assert.equal(forbidden.statusCode, 403);

  const ok = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: auth(adminToken),
    payload: {
      unknown_place_minutes: 5,
      firma: { lat: 47.96, lng: 11.31, radius_m: 80 },
      break_rules: [
        [5, 30],
        [2.5, 15],
      ],
    },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().unknown_place_minutes, 5);
  assert.equal(ok.json().firma.radius_m, 80);
  assert.deepEqual(ok.json().break_rules, [
    [2.5, 15],
    [5, 30],
  ]);

  for (const bad of [
    { unknown_place_minutes: -1 },
    { lager: { lat: 99, lng: 11, radius_m: 100 } },
    { lager: { lat: 47, lng: null, radius_m: 100 } },
    { break_rules: [] },
    { gibt_es_nicht: 1 },
  ]) {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: auth(adminToken),
      payload: bad,
    });
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
  }
});

test('Zu viele falsche Codes werden gebremst', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await login('ZZZZ-ZZZZ');
  assert.equal(last.statusCode, 429);
});

// --- Tage und GPS-Punkte ---------------------------------------------------
test('Tag anlegen ist wiederholbar und aktualisiert das Ende', async () => {
  const db2 = openDb(':memory:');
  const a = createUser(db2, { name: 'Chef', role: 'admin' });
  const w = createUser(db2, { name: 'Mitarbeiter' });
  const app2 = await buildApp({ db: db2 });
  const tok = async (c) => (await app2.inject({ method: 'POST', url: '/api/login', payload: { code: c } })).json().token;
  const at = await tok(a.code), wt = await tok(w.code);
  const t0 = Date.UTC(2026, 10, 2, 6, 0, 0);

  const first = await app2.inject({ method: 'POST', url: '/api/days', headers: auth(wt), payload: { client_id: 'abc-12345678', started_at: t0, ended_at: null } });
  assert.equal(first.statusCode, 200);
  const again = await app2.inject({ method: 'POST', url: '/api/days', headers: auth(wt), payload: { client_id: 'abc-12345678', started_at: t0, ended_at: t0 + 3_600_000 } });
  assert.equal(again.json().id, first.json().id);

  const pts = [0, 15, 30].map((s, i) => ({ ts: t0 + s * 1000, lat: 47.96 + i * 0.001, lng: 11.3, acc: 8 }));
  // Variante C: Ohne Testmodus und ohne Variante B nimmt der Server keine Punkte an, meldet aber Erfolg.
  const dropped = await app2.inject({ method: 'POST', url: `/api/days/${first.json().id}/points`, headers: auth(wt), payload: { points: pts } });
  assert.equal(dropped.statusCode, 200);
  assert.deepEqual(dropped.json(), { added: 0, dropped: 3 });
  assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM points').get().n, 0, 'keine Rohpunkte auf dem Server');
  const me = (await app2.inject({ url: '/api/me', headers: auth(wt) })).json();
  assert.equal(me.upload_points, false);
  assert.equal(me.points_hours, 48);

  // Variante B eingeschaltet: Punkte werden gespeichert.
  setSetting(db2, 'server_route_days', 7);
  assert.equal((await app2.inject({ url: '/api/me', headers: auth(wt) })).json().upload_points, true);
  const add = await app2.inject({ method: 'POST', url: `/api/days/${first.json().id}/points`, headers: auth(wt), payload: { points: pts } });
  assert.equal(add.json().added, 3);
  const dup = await app2.inject({ method: 'POST', url: `/api/days/${first.json().id}/points`, headers: auth(wt), payload: { points: pts } });
  assert.equal(dup.json().added, 0, 'doppelt gesendete Punkte werden nicht doppelt gespeichert');

  const q = `/api/days?user_id=${w.id}&from=${t0 - 1000}&to=${t0 + 86_400_000}`;
  const list = await app2.inject({ url: q, headers: auth(at) });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().length, 1);
  assert.equal(list.json()[0].ended_at, t0 + 3_600_000);
  assert.equal(list.json()[0].points.length, 3);

  assert.equal((await app2.inject({ url: q, headers: auth(wt) })).statusCode, 403, 'Mitarbeiter sehen keine Tagesliste');
});

test('Variante C: Testmodus nur für den Chef, Variante B löscht nur neue Punkte nach Frist', async () => {
  const db2 = openDb(':memory:');
  const a = createUser(db2, { name: 'Chef', role: 'admin' });
  const w = createUser(db2, { name: 'Mitarbeiter' });
  const app2 = await buildApp({ db: db2 });
  const tok = async (c) => (await app2.inject({ method: 'POST', url: '/api/login', payload: { code: c } })).json().token;
  const at = await tok(a.code), wt = await tok(w.code);

  const forWorker = await app2.inject({ method: 'PATCH', url: `/api/users/${w.id}`, headers: auth(at), payload: { gps_test: true } });
  assert.equal(forWorker.statusCode, 400, 'kein Testmodus für Mitarbeiter');
  const forChef = await app2.inject({ method: 'PATCH', url: `/api/users/${a.id}`, headers: auth(at), payload: { gps_test: true } });
  assert.equal(forChef.json().gps_test, true);
  assert.equal((await app2.inject({ url: '/api/me', headers: auth(at) })).json().upload_points, true);
  assert.equal((await app2.inject({ url: '/api/me', headers: auth(wt) })).json().upload_points, false);

  for (const [body, ok] of [[{ server_route_days: 3 }, false], [{ server_route_days: 0 }, true], [{ server_route_days: 10 }, true], [{ phone_points_hours: 12 }, false], [{ phone_points_hours: 48 }, true]]) {
    const r = await app2.inject({ method: 'PUT', url: '/api/settings', headers: auth(at), payload: body });
    assert.equal(r.statusCode, ok ? 200 : 400, JSON.stringify(body));
  }

  // Löschen: alte Punkte (vor Variante C) bleiben, Testmodus-Punkte des Chefs bleiben, neue Mitarbeiter-Punkte nach 10 Tagen weg.
  const now = Date.now();
  setSetting(db2, 'points_policy_since', now - 30 * 86_400_000);
  const day = (uid, cid) => db2.prepare('INSERT INTO days (user_id, client_id, started_at) VALUES (?, ?, ?)').run(uid, cid, now).lastInsertRowid;
  const wd = day(w.id, 'w-12345678'), ad = day(a.id, 'a-12345678');
  const pt = db2.prepare('INSERT INTO points (day_id, ts, lat, lng) VALUES (?, ?, 47, 11)');
  pt.run(wd, now - 40 * 86_400_000); // vor Variante C
  pt.run(wd, now - 20 * 86_400_000); // zu alt
  pt.run(wd, now - 2 * 86_400_000); // noch in der Frist
  pt.run(ad, now - 20 * 86_400_000); // Testmodus Chef
  assert.equal(purgeRoutePoints(db2, now), 1);
  assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM points').get().n, 3);
  setSetting(db2, 'server_route_days', 0);
  pt.run(wd, now - 20 * 86_400_000 + 1);
  assert.equal(purgeRoutePoints(db2, now), 0, 'Variante B aus: nichts wird gelöscht');
});

test('Punkte nur für eigene Tage und nur gültige Werte', async () => {
  const db2 = openDb(':memory:');
  const w1 = createUser(db2, { name: 'Eins' });
  const w2 = createUser(db2, { name: 'Zwei' });
  const app2 = await buildApp({ db: db2 });
  const tok = async (c) => (await app2.inject({ method: 'POST', url: '/api/login', payload: { code: c } })).json().token;
  const t1 = await tok(w1.code), t2 = await tok(w2.code);
  const t0 = Date.UTC(2026, 10, 2, 6, 0, 0);
  const day = (await app2.inject({ method: 'POST', url: '/api/days', headers: auth(t1), payload: { client_id: 'xyz-12345678', started_at: t0 } })).json();

  const foreign = await app2.inject({ method: 'POST', url: `/api/days/${day.id}/points`, headers: auth(t2), payload: { points: [{ ts: t0, lat: 47, lng: 11 }] } });
  assert.equal(foreign.statusCode, 404);
  for (const bad of [[], [{ ts: 5, lat: 47, lng: 11 }], [{ ts: t0, lat: 99, lng: 11 }], [{ ts: t0, lat: 'x', lng: 11 }]]) {
    const res = await app2.inject({ method: 'POST', url: `/api/days/${day.id}/points`, headers: auth(t1), payload: { points: bad } });
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
  }
  const badDay = await app2.inject({ method: 'POST', url: '/api/days', headers: auth(t1), payload: { client_id: 'kurz', started_at: t0 } });
  assert.equal(badDay.statusCode, 400);
  const endBeforeStart = await app2.inject({ method: 'POST', url: '/api/days', headers: auth(t1), payload: { client_id: 'abc-87654321', started_at: t0, ended_at: t0 - 1 } });
  assert.equal(endBeforeStart.statusCode, 400);
});

// --- Eigener Zugangscode ---------------------------------------------------
test('Eigener Code: Regeln, Umlaute, Doppelte, Sitzungen', async () => {
  const db2 = openDb(':memory:');
  const a = createUser(db2, { name: 'Chef', role: 'admin' });
  const w = createUser(db2, { name: 'Mitarbeiter' });
  const app2 = await buildApp({ db: db2 });
  const login2 = async (c) => app2.inject({ method: 'POST', url: '/api/login', payload: { code: c } });
  const at = (await login2(a.code)).json().token;
  const wt = (await login2(w.code)).json().token;
  const put = (id, code, token = at) => app2.inject({ method: 'PUT', url: `/api/users/${id}/code`, headers: auth(token), payload: { code } });

  assert.equal((await put(a.id, 'zu kurz')).statusCode, 400);
  assert.equal((await put(a.id, 'aaaaaaaaaaaaaaa')).statusCode, 400, 'nur ein Zeichen wiederholt ist zu einfach');
  assert.equal((await put(w.id, 'Fliesen Bad Küche 2026', wt)).statusCode, 403, 'Mitarbeiter dürfen keinen Code setzen');

  const mine = 'Fliesen Bad Küche 2026';
  assert.equal((await put(a.id, mine)).statusCode, 200);
  assert.equal((await app2.inject({ url: '/api/me', headers: auth(at) })).statusCode, 200, 'Chef bleibt angemeldet');
  assert.equal((await login2(a.code)).statusCode, 401, 'der alte Code gilt nicht mehr');
  for (const variant of [mine, mine.toUpperCase(), 'fliesen-bad-küche-2026', '  Fliesen   Bad Küche 2026 ']) {
    assert.equal((await login2(variant)).statusCode, 200, `Schreibweise egal: ${variant}`);
  }
  assert.equal((await put(w.id, mine)).statusCode, 409, 'derselbe Code für zwei Personen geht nicht');

  const workerCode = 'Putz Estrich Dämmung 77';
  assert.equal((await put(w.id, workerCode)).statusCode, 200);
  assert.equal((await app2.inject({ url: '/api/me', headers: auth(wt) })).statusCode, 401, 'alte Anmeldung des Mitarbeiters endet');
  assert.equal((await login2(workerCode)).statusCode, 200);
  assert.equal((await put(999, mine)).statusCode, 404);
});

test('Umlaute: Handy-Tastatur (zerlegt) und PC (zusammengesetzt) ergeben denselben Code, auch bei früher gespeicherten Codes', async () => {
  const db2 = openDb(':memory:');
  const a = createUser(db2, { name: 'Chef', role: 'admin' });
  const app2 = await buildApp({ db: db2 });
  const login2 = (c) => app2.inject({ method: 'POST', url: '/api/login', payload: { code: c } });
  const at = (await login2(a.code)).json().token;
  const nfc = 'Putz Estrich Dämmung 77'.normalize('NFC');
  const nfd = nfc.normalize('NFD');
  assert.notEqual(nfc, nfd);
  const set = await app2.inject({ method: 'PUT', url: `/api/users/${a.id}/code`, headers: auth(at), payload: { code: nfc } });
  assert.equal(set.statusCode, 200);
  for (const v of [nfc, nfd, nfc.toUpperCase(), nfd.toUpperCase(), 'PUTZ-ESTRICH-DAMMUNG-77']) {
    assert.equal((await login2(v)).statusCode, 200, v);
  }
  // Früher gespeicherter Code (Umlaut bleibt Teil des Codes) gilt weiter, auch bei zerlegter Eingabe
  const { createHash } = await import('node:crypto');
  const legacy = createHash('sha256').update('SPÄTERCODE12345'.normalize('NFC')).digest('hex');
  db2.prepare('UPDATE users SET code_hash = ? WHERE id = ?').run(legacy, a.id);
  for (const v of ['Späterercode'.length ? 'spätercode12345' : '', 'spätercode12345'.normalize('NFD'), 'SPÄTERCODE-12345']) {
    assert.equal((await login2(v)).statusCode, 200, v);
  }
  assert.equal((await login2('anderer code 1234567')).statusCode, 401);
});

test('Besichtigung: Art wird gespeichert, nur der Chef setzt die Abrechnung', async () => {
  const db2 = openDb(':memory:');
  const a = createUser(db2, { name: 'Chef', role: 'admin' });
  const w = createUser(db2, { name: 'Mitarbeiter' });
  const app2 = await buildApp({ db: db2 });
  const tok = async (c) => (await app2.inject({ method: 'POST', url: '/api/login', payload: { code: c } })).json().token;
  const at = await tok(a.code), wt = await tok(w.code);
  const t0 = Date.UTC(2026, 10, 2, 6, 0, 0);
  const day = (await app2.inject({ method: 'POST', url: '/api/days', headers: auth(wt), payload: { client_id: 'day-12345678', started_at: t0, ended_at: null } })).json();
  const seg = { client_id: 'seg-12345678', kind: 'work', started_at: t0, ended_at: t0 + 3_600_000, activity: 'besichtigung' };
  const r = await app2.inject({ method: 'POST', url: `/api/days/${day.id}/segments`, headers: auth(wt), payload: { segments: [seg, { ...seg, client_id: 'seg-87654321', activity: 'quatsch' }] } });
  assert.equal(r.statusCode, 200);
  const list = (await app2.inject({ method: 'GET', url: `/api/days?user_id=${w.id}&from=${t0 - 1000}&to=${t0 + 86_400_000}`, headers: auth(at) })).json();
  const segs = list[0].segments;
  assert.equal(segs.find((s) => s.client_id === 'seg-12345678').activity, 'besichtigung');
  assert.equal(segs.find((s) => s.client_id === 'seg-87654321').activity, null);
  const id = segs[0].id;
  assert.equal((await app2.inject({ method: 'PATCH', url: `/api/segments/${id}`, headers: auth(wt), payload: { billing: 'bill' } })).statusCode, 403);
  assert.equal((await app2.inject({ method: 'PATCH', url: `/api/segments/${id}`, headers: auth(at), payload: { billing: 'bill' } })).statusCode, 200);
  assert.equal((await app2.inject({ method: 'PATCH', url: `/api/segments/${id}`, headers: auth(at), payload: { billing: 'x' } })).statusCode, 400);
});
