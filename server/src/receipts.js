import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 15 * 1024 * 1024;
const isId = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 64;
const isPdf = (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

// Belege (Lieferscheine, Rechnungen): PDF oder JPEG vom Handy, aufteilbar auf mehrere Baustellen oder das Lager.
export function registerReceiptRoutes(app, { db, requireUser, requireAdmin, photoDir }) {
  const dir = join(photoDir, 'receipts');
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: MAX_BYTES }, (_req, body, done) => done(null, body));

  const allowed = (user) => user.role === 'admin' || !!db.prepare('SELECT can_receipts FROM users WHERE id = ?').get(user.id)?.can_receipts;

  const allocsOf = (id) => db.prepare('SELECT site_id, text FROM receipt_allocs WHERE receipt_id = ? ORDER BY id').all(id);
  const out = (r) => ({ id: r.id, user_id: r.user_id, user_name: r.user_name, client_id: r.client_id, taken_at: r.taken_at, ext: r.ext, bytes: r.bytes, allocs: allocsOf(r.id) });

  function saveAllocs(receiptId, list) {
    if (!Array.isArray(list) || list.length > 20) return 'Zuordnung ungültig';
    const clean = [];
    for (const a of list) {
      const siteId = Number(a?.site_id);
      if (!Number.isInteger(siteId) || !db.prepare('SELECT 1 FROM sites WHERE id = ?').get(siteId)) return 'Baustelle nicht gefunden';
      const text = typeof a.text === 'string' ? a.text.trim().slice(0, 500) : '';
      clean.push({ siteId, text });
    }
    db.prepare('DELETE FROM receipt_allocs WHERE receipt_id = ?').run(receiptId);
    for (const a of clean) db.prepare('INSERT INTO receipt_allocs (receipt_id, site_id, text) VALUES (?, ?, ?)').run(receiptId, a.siteId, a.text);
    return null;
  }

  // Beleg hochladen: Körper = PDF oder JPEG. Kopfzeilen: x-client-id, x-taken-at (Millisekunden).
  const upload = async (req, reply) => {
    if (!allowed(req.user)) return reply.code(403).send({ error: 'Belege sind für dich nicht freigeschaltet' });
    const body = req.body;
    const clientId = String(req.headers['x-client-id'] ?? '');
    const takenAt = Number(req.headers['x-taken-at']);
    if (!isId(clientId)) return reply.code(400).send({ error: 'x-client-id fehlt' });
    if (!Buffer.isBuffer(body) || body.length < 100) return reply.code(400).send({ error: 'Keine Datei' });
    const ext = isPdf(body) ? 'pdf' : isJpeg(body) ? 'jpg' : null;
    if (!ext) return reply.code(415).send({ error: 'Nur PDF oder JPEG' });
    if (!Number.isInteger(takenAt) || takenAt < Date.UTC(2020, 0, 1) || takenAt > Date.UTC(2100, 0, 1)) return reply.code(400).send({ error: 'x-taken-at ungültig' });
    const existing = db.prepare('SELECT id FROM receipts WHERE user_id = ? AND client_id = ?').get(req.user.id, clientId);
    if (existing) return { id: existing.id };
    const info = db.prepare('INSERT INTO receipts (user_id, client_id, taken_at, file, ext, bytes) VALUES (?, ?, ?, ?, ?, ?)').run(req.user.id, clientId, takenAt, '', ext, body.length);
    const id = Number(info.lastInsertRowid);
    const rel = `${id}.${ext}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, rel), body, { mode: 0o600 });
    db.prepare('UPDATE receipts SET file = ? WHERE id = ?').run(rel, id);
    return reply.code(201).send({ id });
  };
  app.post('/api/receipts', { preHandler: requireUser }, upload);

  // Zuordnung vom Handy (über client_id) oder vom Desktop (über id). Ersetzt die bisherige Zuordnung.
  app.post('/api/receipts/allocs', { preHandler: requireUser }, async (req, reply) => {
    const row = db.prepare('SELECT * FROM receipts WHERE user_id = ? AND client_id = ?').get(req.user.id, String(req.body?.client_id ?? ''));
    if (!row) return reply.code(404).send({ error: 'Beleg nicht gefunden' });
    const err = saveAllocs(row.id, req.body?.allocs);
    if (err) return reply.code(400).send({ error: err });
    return { ok: true };
  });

  app.put('/api/receipts/:id/allocs', { preHandler: requireAdmin }, async (req, reply) => {
    const row = db.prepare('SELECT * FROM receipts WHERE id = ?').get(Number(req.params.id));
    if (!row) return reply.code(404).send({ error: 'Beleg nicht gefunden' });
    const err = saveAllocs(row.id, req.body?.allocs);
    if (err) return reply.code(400).send({ error: err });
    return out(db.prepare('SELECT r.*, u.name AS user_name FROM receipts r JOIN users u ON u.id = r.user_id WHERE r.id = ?').get(row.id));
  });

  // Liste (nur Chef): ?unassigned=1 = Eingangskorb, ?site_id=… = Belege einer Baustelle, from/to in Millisekunden (optional).
  app.get('/api/receipts', { preHandler: requireAdmin }, async (req) => {
    const where = ['1=1'];
    const args = [];
    if (req.query.unassigned) where.push('NOT EXISTS (SELECT 1 FROM receipt_allocs a WHERE a.receipt_id = r.id)');
    if (req.query.site_id) { where.push('EXISTS (SELECT 1 FROM receipt_allocs a WHERE a.receipt_id = r.id AND a.site_id = ?)'); args.push(Number(req.query.site_id)); }
    if (req.query.from) { where.push('r.taken_at >= ?'); args.push(Number(req.query.from)); }
    if (req.query.to) { where.push('r.taken_at < ?'); args.push(Number(req.query.to)); }
    return db.prepare(`SELECT r.*, u.name AS user_name FROM receipts r JOIN users u ON u.id = r.user_id WHERE ${where.join(' AND ')} ORDER BY r.taken_at DESC LIMIT 500`).all(...args).map(out);
  });

  app.get('/api/receipts/:id/file', { preHandler: requireAdmin }, async (req, reply) => {
    const row = db.prepare('SELECT * FROM receipts WHERE id = ?').get(Number(req.params.id));
    const path = row && row.file ? join(dir, row.file) : null;
    if (!path || !existsSync(path)) return reply.code(404).send({ error: 'Beleg nicht gefunden' });
    return reply.type(row.ext === 'pdf' ? 'application/pdf' : 'image/jpeg').header('Cache-Control', 'private, max-age=86400').send(readFileSync(path));
  });

  app.delete('/api/receipts/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const row = db.prepare('SELECT * FROM receipts WHERE id = ?').get(Number(req.params.id));
    if (!row) return reply.code(404).send({ error: 'Beleg nicht gefunden' });
    db.prepare('DELETE FROM receipt_allocs WHERE receipt_id = ?').run(row.id);
    db.prepare('DELETE FROM receipts WHERE id = ?').run(row.id);
    try { unlinkSync(join(dir, row.file)); } catch { /* Datei war schon weg */ }
    return { ok: true };
  });
}
