import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = 5000;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const isId = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 64;

// Notizen (pro Mitarbeiter, Tag und Baustelle) und Fotos (JPEG, vom Handy).
export function registerNoteRoutes(app, { db, requireUser, requireAdmin, photoDir }) {
  app.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: MAX_PHOTO_BYTES }, (_req, body, done) => done(null, body));

  const noteRow = (r) => ({ id: r.id, user_id: r.user_id, user_name: r.user_name, client_id: r.client_id, date: r.date, site_id: r.site_id, text: r.text, updated_at: r.updated_at });
  const NOTE_SELECT = 'SELECT n.*, u.name AS user_name FROM notes n JOIN users u ON u.id = n.user_id';

  // Notiz anlegen oder ändern (gleiche client_id = gleiche Notiz). Leerer Text löscht sie.
  app.post('/api/notes', { preHandler: requireUser }, async (req, reply) => {
    const b = req.body ?? {};
    if (!isId(b.client_id)) return reply.code(400).send({ error: 'client_id fehlt' });
    if (typeof b.date !== 'string' || !DATE_RE.test(b.date)) return reply.code(400).send({ error: 'Datum ungültig' });
    if (b.site_id != null && !db.prepare('SELECT 1 FROM sites WHERE id = ?').get(Number(b.site_id))) {
      return reply.code(400).send({ error: 'Baustelle nicht gefunden' });
    }
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (text.length > MAX_NOTE) return reply.code(400).send({ error: 'Die Notiz ist zu lang' });
    if (!text) {
      db.prepare('DELETE FROM notes WHERE user_id = ? AND client_id = ?').run(req.user.id, b.client_id);
      return { deleted: true };
    }
    const at = Number.isInteger(b.updated_at) ? b.updated_at : Date.now();
    db.prepare(
      `INSERT INTO notes (user_id, client_id, date, site_id, text, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, client_id) DO UPDATE SET date = excluded.date, site_id = excluded.site_id, text = excluded.text, updated_at = excluded.updated_at
       WHERE excluded.updated_at >= notes.updated_at`,
    ).run(req.user.id, b.client_id, b.date, b.site_id ?? null, text, at);
    const row = db.prepare('SELECT id FROM notes WHERE user_id = ? AND client_id = ?').get(req.user.id, b.client_id);
    return { id: row.id };
  });

  // Notizen eines Zeitraums. Der Chef sieht alle (optional user_id), Mitarbeiter nur ihre eigenen.
  app.get('/api/notes', { preHandler: requireUser }, async (req, reply) => {
    const from = String(req.query.from ?? req.query.date ?? '');
    const to = String(req.query.to ?? req.query.date ?? '');
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) return reply.code(400).send({ error: 'from und to (Datum) werden gebraucht' });
    const admin = req.user.role === 'admin';
    const uid = admin ? (req.query.user_id ? Number(req.query.user_id) : null) : req.user.id;
    const rows = uid
      ? db.prepare(`${NOTE_SELECT} WHERE n.date >= ? AND n.date <= ? AND n.user_id = ? ORDER BY n.date, n.updated_at`).all(from, to, uid)
      : db.prepare(`${NOTE_SELECT} WHERE n.date >= ? AND n.date <= ? ORDER BY n.date, n.updated_at`).all(from, to);
    return rows.map(noteRow);
  });

  app.patch('/api/notes/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM notes WHERE id = ?').get(id)) return reply.code(404).send({ error: 'Notiz nicht gefunden' });
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > MAX_NOTE) return reply.code(400).send({ error: 'Text fehlt oder ist zu lang' });
    db.prepare('UPDATE notes SET text = ?, updated_at = ? WHERE id = ?').run(text, Date.now(), id);
    return noteRow(db.prepare(`${NOTE_SELECT} WHERE n.id = ?`).get(id));
  });

  app.delete('/api/notes/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const info = db.prepare('DELETE FROM notes WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) return reply.code(404).send({ error: 'Notiz nicht gefunden' });
    return { ok: true };
  });

  // Foto hochladen: Körper = JPEG-Datei. Kopfzeilen: x-client-id, x-taken-at (Millisekunden), x-site-id (optional).
  app.post('/api/photos', { preHandler: requireUser }, async (req, reply) => {
    const body = req.body;
    const clientId = String(req.headers['x-client-id'] ?? '');
    const takenAt = Number(req.headers['x-taken-at']);
    const siteId = req.headers['x-site-id'] ? Number(req.headers['x-site-id']) : null;
    if (!isId(clientId)) return reply.code(400).send({ error: 'x-client-id fehlt' });
    if (!Buffer.isBuffer(body) || body.length < 100) return reply.code(400).send({ error: 'Kein Bild' });
    if (!(body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)) return reply.code(415).send({ error: 'Nur JPEG-Bilder' });
    if (!Number.isInteger(takenAt) || takenAt < Date.UTC(2020, 0, 1) || takenAt > Date.UTC(2100, 0, 1)) return reply.code(400).send({ error: 'x-taken-at ungültig' });
    if (siteId != null && !db.prepare('SELECT 1 FROM sites WHERE id = ?').get(siteId)) return reply.code(400).send({ error: 'Baustelle nicht gefunden' });
    const existing = db.prepare('SELECT id FROM photos WHERE user_id = ? AND client_id = ?').get(req.user.id, clientId);
    if (existing) return { id: existing.id }; // schon angekommen (zweiter Versuch)
    const info = db.prepare('INSERT INTO photos (user_id, client_id, site_id, taken_at, file, bytes) VALUES (?, ?, ?, ?, ?, ?)').run(req.user.id, clientId, siteId, takenAt, '', body.length);
    const id = Number(info.lastInsertRowid);
    const rel = join(String(req.user.id), `${id}.jpg`);
    mkdirSync(join(photoDir, String(req.user.id)), { recursive: true });
    writeFileSync(join(photoDir, rel), body, { mode: 0o600 });
    db.prepare('UPDATE photos SET file = ? WHERE id = ?').run(rel, id);
    return reply.code(201).send({ id });
  });

  // Liste der Fotos: Chef alle (optional user_id, site_id), Mitarbeiter nur eigene. from/to in Millisekunden.
  app.get('/api/photos', { preHandler: requireUser }, async (req, reply) => {
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return reply.code(400).send({ error: 'from und to (Millisekunden) werden gebraucht' });
    const admin = req.user.role === 'admin';
    const where = ['p.taken_at >= ?', 'p.taken_at < ?'];
    const args = [from, to];
    if (!admin) { where.push('p.user_id = ?'); args.push(req.user.id); }
    else if (req.query.user_id) { where.push('p.user_id = ?'); args.push(Number(req.query.user_id)); }
    if (req.query.site_id) { where.push('p.site_id = ?'); args.push(Number(req.query.site_id)); }
    return db
      .prepare(`SELECT p.id, p.user_id, u.name AS user_name, p.site_id, p.taken_at, p.bytes FROM photos p JOIN users u ON u.id = p.user_id WHERE ${where.join(' AND ')} ORDER BY p.taken_at`)
      .all(...args);
  });

  app.get('/api/photos/:id/file', { preHandler: requireUser }, async (req, reply) => {
    const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(req.params.id));
    if (!row || (req.user.role !== 'admin' && row.user_id !== req.user.id)) return reply.code(404).send({ error: 'Foto nicht gefunden' });
    const path = join(photoDir, row.file);
    if (!row.file || !existsSync(path)) return reply.code(404).send({ error: 'Datei fehlt' });
    return reply.type('image/jpeg').header('Cache-Control', 'private, max-age=86400').send(readFileSync(path));
  });

  app.delete('/api/photos/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(req.params.id));
    if (!row) return reply.code(404).send({ error: 'Foto nicht gefunden' });
    db.prepare('DELETE FROM photos WHERE id = ?').run(row.id);
    try { unlinkSync(join(photoDir, row.file)); } catch { /* Datei war schon weg */ }
    return { ok: true };
  });
}
