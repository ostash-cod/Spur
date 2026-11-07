const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set(['work', 'travel', 'break', 'private']);
const VEHICLES = new Set(['privat', 'firma']);
const isMs = (v) => Number.isInteger(v) && v > 0;

// Tageszettel: Der Mitarbeiter gibt am Tagesende seine Abschnitte, Kilometer und Pause ab.
// Gespeichert wird nur der Zettel. Ob er mit GPS, mit Stoppuhr oder von Hand entstand, erfährt der Server nicht.
export function registerSheetRoutes(app, { db, requireUser }) {
  const rowOut = (r) => ({ id: r.id, user_id: r.user_id, user_name: r.user_name, date: r.date, submitted_at: r.submitted_at, ...JSON.parse(r.data) });

  app.post('/api/sheets', { preHandler: requireUser }, async (req, reply) => {
    const b = req.body ?? {};
    if (typeof b.date !== 'string' || !DATE_RE.test(b.date)) return reply.code(400).send({ error: 'Datum ungültig' });
    if (!isMs(b.start) || !isMs(b.end) || b.end < b.start) return reply.code(400).send({ error: 'Beginn und Ende ungültig' });
    if (!Array.isArray(b.lines) || b.lines.length > 200) return reply.code(400).send({ error: 'Abschnitte ungültig' });
    const pause = Number.isInteger(b.pause_min) ? b.pause_min : 0;
    if (pause < 0 || pause > 600) return reply.code(400).send({ error: 'Pause ungültig' });
    const lines = [];
    for (const l of b.lines) {
      if (!l || !KINDS.has(l.kind) || !isMs(l.from) || !isMs(l.to) || l.to < l.from) return reply.code(400).send({ error: 'Abschnitt ungültig' });
      const km = l.km == null ? null : Number(l.km);
      if (km != null && (!Number.isFinite(km) || km < 0 || km > 1000)) return reply.code(400).send({ error: 'Kilometer ungültig' });
      if (l.vehicle != null && !VEHICLES.has(l.vehicle)) return reply.code(400).send({ error: 'Fahrzeug ungültig' });
      let siteId = null;
      if (l.site_id != null) {
        siteId = Number(l.site_id);
        if (!db.prepare('SELECT 1 FROM sites WHERE id = ?').get(siteId)) return reply.code(400).send({ error: 'Baustelle nicht gefunden' });
      }
      lines.push({ kind: l.kind, site_id: siteId, from: l.from, to: l.to, km: km == null ? null : Math.round(km * 10) / 10, vehicle: l.vehicle ?? null });
    }
    const data = JSON.stringify({ start: b.start, end: b.end, pause_min: pause, lines });
    db.prepare(
      `INSERT INTO sheets (user_id, date, submitted_at, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET submitted_at = excluded.submitted_at, data = excluded.data`,
    ).run(req.user.id, b.date, Date.now(), data);
    return { ok: true };
  });

  // Chef: alle (optional user_id), Mitarbeiter: nur eigene.
  app.get('/api/sheets', { preHandler: requireUser }, async (req, reply) => {
    const from = String(req.query.from ?? req.query.date ?? '');
    const to = String(req.query.to ?? req.query.date ?? '');
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) return reply.code(400).send({ error: 'from und to (Datum) werden gebraucht' });
    const base = 'SELECT s.*, u.name AS user_name FROM sheets s JOIN users u ON u.id = s.user_id WHERE s.date >= ? AND s.date <= ?';
    let rows;
    if (req.user.role === 'admin') {
      rows = req.query.user_id
        ? db.prepare(`${base} AND s.user_id = ? ORDER BY s.date`).all(from, to, Number(req.query.user_id))
        : db.prepare(`${base} ORDER BY s.date, u.name`).all(from, to);
    } else {
      rows = db.prepare(`${base} AND s.user_id = ? ORDER BY s.date`).all(from, to, req.user.id);
    }
    return rows.map(rowOut);
  });
}
