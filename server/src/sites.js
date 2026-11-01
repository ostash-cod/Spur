import { getSettings } from './db.js';

// Farben für Baustellen. Gelb (Anfahrt) und Nebelgrau (Pause, Privat) sind reserviert.
export const SITE_COLORS = [
  '#2E9E4F', // Grün
  '#7E57C2', // Lila
  '#1E88E5', // Blau
  '#FB8C00', // Orange
  '#00897B', // Türkis
  '#D81B60', // Pink
  '#8D6E63', // Braun
  '#3949AB', // Indigo
  '#7CB342', // Hellgrün
  '#00ACC1', // Cyan
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function text(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
}

function checkPlace(b, partial = false) {
  const hasLat = b.lat !== undefined;
  const hasLng = b.lng !== undefined;
  if (!hasLat && !hasLng) return null;
  if (b.lat === null && b.lng === null) return null;
  if (!isNum(b.lat) || !isNum(b.lng) || Math.abs(b.lat) > 90 || Math.abs(b.lng) > 180) {
    return 'Koordinaten ungültig (Breite −90 bis 90, Länge −180 bis 180, beide zusammen)';
  }
  return null;
}

export function registerSiteRoutes(app, { db, requireUser, requireAdmin, fetchImpl = fetch }) {
  const siteRow = (r, defaultRadius) => ({
    id: r.id,
    customer_id: r.customer_id,
    customer_name: r.customer_name ?? null,
    name: r.name,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    radius_m: r.radius_m ?? defaultRadius,
    radius_custom: r.radius_m != null,
    color: r.color,
    active: !!r.active,
    archived: !!r.archived,
    system: r.system ?? null,
  });

  const SITE_SELECT = `SELECT s.*, c.name AS customer_name FROM sites s LEFT JOIN customers c ON c.id = s.customer_id`;

  // --- Kunden (nur Chef) ---
  const customerRow = (r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    email: r.email,
    hourly_rate: r.hourly_rate,
    archived: !!r.archived,
  });

  app.get('/api/customers', { preHandler: requireAdmin }, async () =>
    db.prepare('SELECT * FROM customers ORDER BY archived, name COLLATE NOCASE').all().map(customerRow),
  );

  app.post('/api/customers', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body ?? {};
    const name = text(b.name);
    if (!name) return reply.code(400).send({ error: 'Name fehlt' });
    if (b.hourly_rate != null && (!isNum(b.hourly_rate) || b.hourly_rate < 0)) {
      return reply.code(400).send({ error: 'Stundensatz ungültig' });
    }
    const info = db
      .prepare('INSERT INTO customers (name, address, email, hourly_rate) VALUES (?, ?, ?, ?)')
      .run(name, text(b.address, 300), text(b.email), b.hourly_rate ?? null);
    return reply.code(201).send(customerRow(db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(info.lastInsertRowid))));
  });

  app.patch('/api/customers/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ error: 'Kunde nicht gefunden' });
    const b = req.body ?? {};
    const name = b.name === undefined ? row.name : text(b.name);
    if (!name) return reply.code(400).send({ error: 'Name fehlt' });
    const rate = b.hourly_rate === undefined ? row.hourly_rate : b.hourly_rate;
    if (rate != null && (!isNum(rate) || rate < 0)) return reply.code(400).send({ error: 'Stundensatz ungültig' });
    db.prepare('UPDATE customers SET name = ?, address = ?, email = ?, hourly_rate = ?, archived = ? WHERE id = ?').run(
      name,
      b.address === undefined ? row.address : text(b.address, 300),
      b.email === undefined ? row.email : text(b.email),
      rate ?? null,
      b.archived === undefined ? row.archived : b.archived ? 1 : 0,
      id,
    );
    return customerRow(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
  });

  // Löschen nur, wenn nichts mehr daran hängt. Sonst archivieren.
  app.delete('/api/customers/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'Kunde nicht gefunden' });
    }
    if (db.prepare('SELECT 1 FROM sites WHERE customer_id = ?').get(id)) {
      return reply.code(409).send({ error: 'Zu diesem Kunden gibt es noch Baustellen. Bitte archiviere ihn stattdessen oder lösche zuerst die Baustellen.' });
    }
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    return { ok: true };
  });

  // --- Baustellen ---
  // Jeder angemeldete Mitarbeiter bekommt die aktiven Baustellen (für die Kacheln und die Erkennung).
  app.get('/api/sites', { preHandler: requireUser }, async (req) => {
    const radius = getSettings(db).site_radius_m;
    const all = req.user.role === 'admin' && req.query.all === '1';
    const rows = db
      .prepare(`${SITE_SELECT} ${all ? '' : 'WHERE s.archived = 0 AND s.active = 1'} ORDER BY s.archived, (s.system IS NOT NULL), s.name COLLATE NOCASE`)
      .all();
    return rows.map((r) => siteRow(r, radius));
  });

  app.post('/api/sites', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body ?? {};
    const name = text(b.name);
    if (!name) return reply.code(400).send({ error: 'Name fehlt' });
    const placeErr = checkPlace(b);
    if (placeErr) return reply.code(400).send({ error: placeErr });
    if (b.radius_m != null && (!isNum(b.radius_m) || b.radius_m < 20 || b.radius_m > 2000)) {
      return reply.code(400).send({ error: 'Radius muss zwischen 20 und 2000 Metern liegen' });
    }
    if (b.customer_id != null && !db.prepare('SELECT 1 FROM customers WHERE id = ?').get(Number(b.customer_id))) {
      return reply.code(400).send({ error: 'Kunde nicht gefunden' });
    }
    let customerId = b.customer_id ?? null;
    if (customerId == null && b.create_customer === true) {
      const c = db.prepare('INSERT INTO customers (name, address) VALUES (?, ?)').run(name, text(b.address, 300));
      customerId = Number(c.lastInsertRowid);
    }
    let color = b.color;
    if (color != null && !COLOR_RE.test(color)) return reply.code(400).send({ error: 'Farbe ungültig' });
    if (color == null) {
      const used = new Set(db.prepare('SELECT color FROM sites WHERE archived = 0').all().map((r) => r.color.toUpperCase()));
      color = SITE_COLORS.find((c) => !used.has(c.toUpperCase())) ?? SITE_COLORS[used.size % SITE_COLORS.length];
    }
    const info = db
      .prepare('INSERT INTO sites (customer_id, name, address, lat, lng, radius_m, color) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(customerId, name, text(b.address, 300), b.lat ?? null, b.lng ?? null, b.radius_m ?? null, color.toUpperCase());
    const radius = getSettings(db).site_radius_m;
    return reply.code(201).send(siteRow(db.prepare(`${SITE_SELECT} WHERE s.id = ?`).get(Number(info.lastInsertRowid)), radius));
  });

  app.patch('/api/sites/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ error: 'Baustelle nicht gefunden' });
    const b = req.body ?? {};
    if (row.system && Object.keys(b).some((k) => !['active', 'color'].includes(k))) {
      return reply.code(400).send({ error: 'Lager und Firma werden in den Einstellungen verwaltet. Hier kannst du nur Farbe und „aktiv“ ändern.' });
    }
    const name = b.name === undefined ? row.name : text(b.name);
    if (!name) return reply.code(400).send({ error: 'Name fehlt' });
    const placeErr = checkPlace(b);
    if (placeErr) return reply.code(400).send({ error: placeErr });
    if (b.radius_m != null && (!isNum(b.radius_m) || b.radius_m < 20 || b.radius_m > 2000)) {
      return reply.code(400).send({ error: 'Radius muss zwischen 20 und 2000 Metern liegen' });
    }
    if (b.customer_id != null && !db.prepare('SELECT 1 FROM customers WHERE id = ?').get(Number(b.customer_id))) {
      return reply.code(400).send({ error: 'Kunde nicht gefunden' });
    }
    if (b.color !== undefined && !COLOR_RE.test(b.color)) return reply.code(400).send({ error: 'Farbe ungültig' });
    const pick = (key, current) => (b[key] === undefined ? current : b[key]);
    db.prepare(
      `UPDATE sites SET customer_id = ?, name = ?, address = ?, lat = ?, lng = ?, radius_m = ?, color = ?, active = ?, archived = ? WHERE id = ?`,
    ).run(
      pick('customer_id', row.customer_id) ?? null,
      name,
      b.address === undefined ? row.address : text(b.address, 300),
      pick('lat', row.lat) ?? null,
      pick('lng', row.lng) ?? null,
      pick('radius_m', row.radius_m) ?? null,
      (pick('color', row.color)).toUpperCase(),
      b.active === undefined ? row.active : b.active ? 1 : 0,
      b.archived === undefined ? row.archived : b.archived ? 1 : 0,
      id,
    );
    const radius = getSettings(db).site_radius_m;
    return siteRow(db.prepare(`${SITE_SELECT} WHERE s.id = ?`).get(id), radius);
  });

  app.delete('/api/sites/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM sites WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'Baustelle nicht gefunden' });
    }
    if (db.prepare('SELECT 1 FROM sites WHERE id = ? AND system IS NOT NULL').get(id)) {
      return reply.code(409).send({ error: 'Lager und Firma sind feste Orte und können nicht gelöscht werden.' });
    }
    if (db.prepare('SELECT 1 FROM segments WHERE site_id = ?').get(id)) {
      return reply.code(409).send({ error: 'Für diese Baustelle sind schon Zeiten gebucht. Bitte archiviere sie stattdessen, sonst gehen Stunden verloren.' });
    }
    db.prepare('DELETE FROM sites WHERE id = ?').run(id);
    return { ok: true };
  });

  // --- Koordinaten aus einer Adresse suchen (OpenStreetMap, über den Server) ---
  let lastGeocode = 0;
  const cache = new Map();
  app.get('/api/geocode', { preHandler: requireAdmin }, async (req, reply) => {
    const q = text(req.query.q, 200);
    if (!q || q.length < 4) return reply.code(400).send({ error: 'Bitte eine Adresse eingeben' });
    if (cache.has(q)) return cache.get(q);
    // Der Kartendienst erlaubt höchstens eine Anfrage pro Sekunde.
    const wait = lastGeocode + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastGeocode = Date.now();
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=de&addressdetails=0&q=${encodeURIComponent(q)}`;
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': 'Spur-Zeiterfassung/0.1 (https://github.com/ostash-cod/Spur)', 'Accept-Language': 'de' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      const out = data
        .map((d) => ({ label: String(d.display_name), lat: Number(d.lat), lng: Number(d.lon) }))
        .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng));
      if (cache.size > 200) cache.clear();
      cache.set(q, out);
      return out;
    } catch {
      return reply.code(502).send({ error: 'Die Adresssuche ist gerade nicht erreichbar. Du kannst die Koordinaten auch von Hand eintragen.' });
    }
  });
}
