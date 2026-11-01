import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { registerSiteRoutes } from './sites.js';
import { getSettings, setSetting, DEFAULT_SETTINGS } from './db.js';
import {
  candidateHashes,
  createUser,
  foldCode,
  hashCode,
  hashToken,
  newToken,
  publicUser,
  rotateCode,
} from './auth.js';

const LANGUAGES = ['de', 'ru', 'uk'];
const MAX_FAILED_LOGINS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v) => v === null || isNum(v);

// Prüft eine Einstellung. Gibt den bereinigten Wert zurück oder wirft einen Fehler mit deutscher Meldung.
const VALIDATORS = {
  company(v) {
    if (typeof v?.name !== 'string' || typeof v?.address !== 'string') {
      throw new Error('Firma braucht Name und Adresse');
    }
    return { name: v.name.trim(), address: v.address.trim() };
  },
  firma: place,
  lager: place,
  site_radius_m: positiveNumber('Radius der Baustellen'),
  unknown_place_minutes: positiveNumber('Minuten für unbekannte Orte'),
  km_rate_customer: positiveNumber('Kilometersatz Kunde'),
  km_rate_employee: positiveNumber('Kilometergeld Mitarbeiter'),
  break_rules(v) {
    if (!Array.isArray(v) || v.length === 0) throw new Error('Pausenregel fehlt');
    const rules = v.map((r) => {
      if (!Array.isArray(r) || r.length !== 2 || !isNum(r[0]) || !isNum(r[1]) || r[0] <= 0 || r[1] < 0) {
        throw new Error('Pausenregel: je Zeile [ab Stunden, Pause in Minuten]');
      }
      return [r[0], r[1]];
    });
    rules.sort((a, b) => a[0] - b[0]);
    return rules;
  },
};

function place(v) {
  if (!isNumOrNull(v?.lat) || !isNumOrNull(v?.lng) || !isNum(v?.radius_m) || v.radius_m <= 0) {
    throw new Error('Ort braucht lat, lng (oder leer) und einen Radius in Metern');
  }
  if ((v.lat === null) !== (v.lng === null)) throw new Error('Breite und Länge nur zusammen leer lassen');
  if (v.lat !== null && (v.lat < -90 || v.lat > 90 || v.lng < -180 || v.lng > 180)) {
    throw new Error('Koordinaten außerhalb des gültigen Bereichs');
  }
  return { lat: v.lat, lng: v.lng, radius_m: v.radius_m };
}

function positiveNumber(label) {
  return (v) => {
    if (!isNum(v) || v <= 0) throw new Error(`${label} muss eine Zahl größer 0 sein`);
    return v;
  };
}

export async function buildApp({ db, staticDir, logger = false, fetchImpl } = {}) {
  // Hinter dem Webserver (Caddy) kommt die echte Adresse des Handys im Kopf der Anfrage.
  const app = Fastify({ logger, trustProxy: process.env.SPUR_TRUST_PROXY === '1' });
  const failedLogins = new Map(); // ip -> [Zeitstempel]

  if (staticDir) {
    await app.register(fastifyStatic, { root: staticDir, prefix: '/' });
  }

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  // Anmeldung prüfen: Authorization: Bearer <token>
  async function requireUser(req, reply) {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const row = token
      ? db
          .prepare(
            `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND u.active = 1`,
          )
          .get(hashToken(token))
      : undefined;
    if (!row) return reply.code(401).send({ error: 'Nicht angemeldet' });
    db.prepare("UPDATE sessions SET last_used = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash = ?").run(
      hashToken(token),
    );
    req.user = row;
  }

  async function requireAdmin(req, reply) {
    const denied = await requireUser(req, reply);
    if (denied) return denied;
    if (req.user.role !== 'admin') return reply.code(403).send({ error: 'Nur für den Chef' });
  }

  app.post('/api/login', async (req, reply) => {
    const ip = req.ip;
    const now = Date.now();
    const recent = (failedLogins.get(ip) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
    if (recent.length >= MAX_FAILED_LOGINS) {
      return reply.code(429).send({ error: 'Zu viele Versuche. Bitte in 15 Minuten noch einmal.' });
    }
    const hashes = candidateHashes(req.body?.code);
    const user = db
      .prepare(`SELECT * FROM users WHERE code_hash IN (${hashes.map(() => '?').join(',')}) AND active = 1`)
      .get(...hashes);
    if (!user) {
      recent.push(now);
      failedLogins.set(ip, recent);
      return reply.code(401).send({ error: 'Zugangscode stimmt nicht' });
    }
    failedLogins.delete(ip);
    const { token, tokenHash } = newToken();
    db.prepare('INSERT INTO sessions (token_hash, user_id) VALUES (?, ?)').run(tokenHash, user.id);
    return { token, user: publicUser(user) };
  });

  app.post('/api/logout', { preHandler: requireUser }, async (req) => {
    const token = req.headers.authorization.slice(7);
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return { ok: true };
  });

  app.get('/api/me', { preHandler: requireUser }, async (req) => publicUser(req.user));

  // --- Mitarbeiter (nur Chef) ---
  app.get('/api/users', { preHandler: requireAdmin }, async () =>
    db.prepare('SELECT * FROM users ORDER BY role, name').all().map(publicUser),
  );

  app.post('/api/users', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return reply.code(400).send({ error: 'Name fehlt' });
    const language = b.language ?? 'de';
    if (!LANGUAGES.includes(language)) {
      return reply.code(400).send({ error: 'Sprache muss de, ru oder uk sein' });
    }
    const { id, code } = createUser(db, { name, language, uses_private_car: !!b.uses_private_car });
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return reply.code(201).send({ user: publicUser(row), code });
  });

  app.patch('/api/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ error: 'Mitarbeiter nicht gefunden' });
    const b = req.body ?? {};
    const next = {
      name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : row.name,
      language: b.language ?? row.language,
      uses_private_car: b.uses_private_car === undefined ? row.uses_private_car : b.uses_private_car ? 1 : 0,
      active: b.active === undefined ? row.active : b.active ? 1 : 0,
    };
    if (!LANGUAGES.includes(next.language)) {
      return reply.code(400).send({ error: 'Sprache muss de, ru oder uk sein' });
    }
    if (id === req.user.id && !next.active) {
      return reply.code(400).send({ error: 'Du kannst dich nicht selbst deaktivieren' });
    }
    db.prepare('UPDATE users SET name = ?, language = ?, uses_private_car = ?, active = ? WHERE id = ?').run(
      next.name,
      next.language,
      next.uses_private_car,
      next.active,
      id,
    );
    if (!next.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  });

  app.post('/api/users/:id/new-code', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'Mitarbeiter nicht gefunden' });
    }
    return { code: rotateCode(db, id) };
  });

  // Chef legt für sich oder einen Mitarbeiter einen eigenen Code fest (mindestens 12 Zeichen).
  app.put('/api/users/:id/code', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'Mitarbeiter nicht gefunden' });
    }
    const raw = req.body?.code;
    const norm = foldCode(raw);
    if (norm.length < 12) {
      return reply.code(400).send({ error: 'Der Code braucht mindestens 12 Buchstaben oder Zahlen (Leerzeichen und Striche zählen nicht).' });
    }
    if (norm.length > 64) return reply.code(400).send({ error: 'Der Code ist zu lang (höchstens 64 Zeichen).' });
    if (/^(.)\1+$/u.test(norm)) return reply.code(400).send({ error: 'Der Code ist zu einfach.' });
    try {
      db.prepare('UPDATE users SET code_hash = ? WHERE id = ?').run(hashCode(raw), id);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return reply.code(409).send({ error: 'Dieser Code ist schon vergeben.' });
      throw err;
    }
    // Andere Anmeldungen dieses Mitarbeiters enden. Die aktuelle Anmeldung des Chefs bleibt.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(id, hashToken(req.headers.authorization.slice(7)));
    return { ok: true };
  });

  // --- Einstellungen ---
  app.get('/api/settings', { preHandler: requireUser }, async () => getSettings(db));

  app.put('/api/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body ?? {};
    const clean = {};
    try {
      for (const [key, value] of Object.entries(body)) {
        if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unbekannte Einstellung: ${key}`);
        clean[key] = VALIDATORS[key](value);
      }
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
    for (const [key, value] of Object.entries(clean)) setSetting(db, key, value);
    return getSettings(db);
  });

  // --- Tage und GPS-Punkte (von der Handy-App) ---
  const MIN_TS = Date.UTC(2020, 0, 1);
  const MAX_TS = Date.UTC(2100, 0, 1);
  const validTs = (v) => Number.isInteger(v) && v >= MIN_TS && v <= MAX_TS;

  // Legt einen Tag an oder aktualisiert ihn (gleiche client_id = gleicher Tag).
  app.post('/api/days', { preHandler: requireUser }, async (req, reply) => {
    const b = req.body ?? {};
    if (typeof b.client_id !== 'string' || b.client_id.length < 8 || b.client_id.length > 64) {
      return reply.code(400).send({ error: 'client_id fehlt' });
    }
    if (!validTs(b.started_at)) return reply.code(400).send({ error: 'Startzeit ungültig' });
    if (b.ended_at != null && (!validTs(b.ended_at) || b.ended_at < b.started_at)) {
      return reply.code(400).send({ error: 'Endzeit ungültig' });
    }
    db.prepare(
      `INSERT INTO days (user_id, client_id, started_at, ended_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, client_id) DO UPDATE SET started_at = excluded.started_at, ended_at = excluded.ended_at`,
    ).run(req.user.id, b.client_id, b.started_at, b.ended_at ?? null);
    const row = db.prepare('SELECT id FROM days WHERE user_id = ? AND client_id = ?').get(req.user.id, b.client_id);
    return { id: row.id };
  });

  app.post('/api/days/:id/points', { preHandler: requireUser }, async (req, reply) => {
    const day = db.prepare('SELECT id FROM days WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!day) return reply.code(404).send({ error: 'Tag nicht gefunden' });
    const points = req.body?.points;
    if (!Array.isArray(points) || points.length === 0 || points.length > 500) {
      return reply.code(400).send({ error: 'Es werden 1 bis 500 Punkte erwartet' });
    }
    for (const p of points) {
      if (!validTs(p?.ts) || !isNum(p?.lat) || !isNum(p?.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) {
        return reply.code(400).send({ error: 'Ungültiger Punkt' });
      }
    }
    const insert = db.prepare('INSERT OR IGNORE INTO points (day_id, ts, lat, lng, acc) VALUES (?, ?, ?, ?, ?)');
    let added = 0;
    db.exec('BEGIN');
    try {
      for (const p of points) {
        added += Number(insert.run(day.id, p.ts, p.lat, p.lng, isNum(p.acc) ? p.acc : null).changes);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { added };
  });

  // Zeitabschnitte (auf welcher Baustelle von wann bis wann), vom Handy; gleiche client_id = gleicher Abschnitt.
  app.post('/api/days/:id/segments', { preHandler: requireUser }, async (req, reply) => {
    const day = db.prepare('SELECT id FROM days WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!day) return reply.code(404).send({ error: 'Tag nicht gefunden' });
    const list = req.body?.segments;
    if (!Array.isArray(list) || list.length === 0 || list.length > 200) {
      return reply.code(400).send({ error: 'Es werden 1 bis 200 Abschnitte erwartet' });
    }
    const KINDS = ['work', 'travel', 'private', 'break'];
    for (const s of list) {
      if (typeof s?.client_id !== 'string' || s.client_id.length < 8 || s.client_id.length > 64) return reply.code(400).send({ error: 'client_id fehlt' });
      if (!validTs(s.started_at) || (s.ended_at != null && (!validTs(s.ended_at) || s.ended_at < s.started_at))) return reply.code(400).send({ error: 'Zeit ungültig' });
      if (!KINDS.includes(s.kind ?? 'work')) return reply.code(400).send({ error: 'Art ungültig' });
      if (s.site_id != null && !db.prepare('SELECT 1 FROM sites WHERE id = ?').get(Number(s.site_id))) return reply.code(400).send({ error: 'Baustelle nicht gefunden' });
    }
    const upsert = db.prepare(
      `INSERT INTO segments (day_id, client_id, site_id, kind, started_at, ended_at, source) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day_id, client_id) DO UPDATE SET site_id = excluded.site_id, kind = excluded.kind, started_at = excluded.started_at, ended_at = excluded.ended_at`,
    );
    db.exec('BEGIN');
    try {
      for (const s of list) upsert.run(day.id, s.client_id, s.site_id ?? null, s.kind ?? 'work', s.started_at, s.ended_at ?? null, s.source === 'auto' ? 'auto' : 'manual');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { saved: list.length };
  });

  // Chef: Tage eines Mitarbeiters in einem Zeitraum (from/to in Millisekunden), mit allen Punkten.
  app.get('/api/days', { preHandler: requireAdmin }, async (req, reply) => {
    const userId = Number(req.query.user_id);
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!Number.isInteger(userId) || !validTs(from) || !validTs(to) || to < from) {
      return reply.code(400).send({ error: 'user_id, from und to werden gebraucht' });
    }
    const days = db
      .prepare('SELECT id, started_at, ended_at FROM days WHERE user_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at')
      .all(userId, from, to);
    const pointStmt = db.prepare('SELECT ts, lat, lng, acc FROM points WHERE day_id = ? ORDER BY ts');
    const segStmt = db.prepare('SELECT client_id, site_id, kind, started_at, ended_at, source FROM segments WHERE day_id = ? ORDER BY started_at');
    return days.map((d) => ({ ...d, points: pointStmt.all(d.id), segments: segStmt.all(d.id) }));
  });

  registerSiteRoutes(app, { db, requireUser, requireAdmin, fetchImpl });

  app.get('/api/health', async () => ({ ok: true }));

  return app;
}
