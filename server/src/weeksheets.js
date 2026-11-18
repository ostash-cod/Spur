import PDFDocument from 'pdfkit';

// Wochenzettel: Der Chef prüft die Tageszettel einer Woche, korrigiert sie bei Bedarf und schickt die Woche
// an den Mitarbeiter. Der Mitarbeiter bestätigt am Handy („geprüft und einverstanden“) mit dem echten Datum.
// Danach ist die Woche gesperrt (Regel der App) und bleibt im Archiv. Es werden keine früheren Fassungen aufbewahrt.

const TZ = 'Europe/Berlin';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const fmtStamp = (ms) => new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ });
const deDate = (d) => d.split('-').reverse().join('.');
const fmtH = (ms) => `${Math.floor(ms / 3600000)}:${String(Math.round((ms % 3600000) / 60000)).padStart(2, '0')} Std.`;
const WD = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
const wdOf = (d) => WD[new Date(`${d}T12:00:00Z`).getUTCDay()];

export function mondayOfDate(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isoWeek(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return { year: d.getUTCFullYear(), week };
}

/**
 * Wird aufgerufen, bevor ein Tageszettel geschrieben wird.
 * false = Woche ist bestätigt und gesperrt. Eine geschickte, noch nicht bestätigte Woche wird zurückgenommen
 * (der Chef muss sie nach der Änderung neu schicken).
 */
export function touchWeek(db, userId, date) {
  const ws = mondayOfDate(date);
  const row = db.prepare('SELECT id, status FROM week_sheets WHERE user_id = ? AND week_start = ?').get(userId, ws);
  if (!row) return true;
  if (row.status === 'confirmed') return false;
  db.prepare('DELETE FROM week_sheets WHERE id = ?').run(row.id);
  return true;
}

function buildSnapshot(db, user, weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const siteName = (id) => (id ? db.prepare('SELECT name FROM sites WHERE id = ?').get(id)?.name ?? 'Baustelle' : null);
  const rows = db.prepare('SELECT date, data FROM sheets WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date').all(user.id, weekStart, weekEnd);
  const days = rows.map((r) => {
    const s = JSON.parse(r.data);
    const paid = Math.max(0, s.end - s.start - s.pause_min * 60000);
    return {
      date: r.date, start: s.start, end: s.end, pause_min: s.pause_min, paid_ms: paid,
      lines: s.lines.map((l) => ({ kind: l.kind, site_name: siteName(l.site_id), from: l.from, to: l.to, km: l.km ?? null, vehicle: l.vehicle ?? null })),
    };
  });
  const km = days.flatMap((d) => d.lines).filter((l) => l.kind === 'travel' && l.vehicle === 'privat').reduce((a, l) => a + (l.km ?? 0), 0);
  const { year, week } = isoWeek(weekStart);
  return {
    user_name: user.name, week_start: weekStart, week_end: weekEnd, kw: week, year, days,
    total_paid_ms: days.reduce((a, d) => a + d.paid_ms, 0), km_privat: Math.round(km * 10) / 10,
  };
}

function lineLabel(l) {
  if (l.kind === 'work') return l.site_name ?? 'Baustelle';
  if (l.kind === 'travel') return `Fahrt${l.vehicle ? (l.vehicle === 'firma' ? ' (Firmenauto)' : ' (Privatauto)') : ''}${l.km != null ? `, ${String(l.km).replace('.', ',')} km` : ''}`;
  return { break: 'Pause', private: 'Privat' }[l.kind] ?? l.kind;
}

export function renderWeekPdf(w) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const snap = w.snapshot;
  doc.font('Helvetica-Bold').fontSize(16).text(`Wochenzettel KW ${snap.kw}/${snap.year}`);
  doc.font('Helvetica').fontSize(11).text(`${snap.user_name} · ${deDate(snap.week_start)} bis ${deDate(snap.week_end)}`).moveDown(0.8);
  for (const d of snap.days) {
    if (doc.y > 720) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).text(`${wdOf(d.date)} ${deDate(d.date)} · ${fmtTime(d.start)} bis ${fmtTime(d.end)} · Pause ${d.pause_min} Min · bezahlt ${fmtH(d.paid_ms)}`);
    doc.font('Helvetica').fontSize(10);
    for (const l of d.lines) {
      if (doc.y > 770) doc.addPage();
      doc.text(`${fmtTime(l.from)} bis ${fmtTime(l.to)}   ${lineLabel(l)}`, { indent: 12 });
    }
    doc.moveDown(0.6);
  }
  if (doc.y > 730) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).text(`Summe bezahlt: ${fmtH(snap.total_paid_ms)} · Privatauto: ${String(snap.km_privat).replace('.', ',')} km`).moveDown(1);
  doc.font('Helvetica').fontSize(10);
  if (w.status === 'confirmed') {
    doc.text(`Dieser Zettel wurde vom Mitarbeiter geprüft und bestätigt am ${fmtStamp(w.confirmed_at)} Uhr.`);
  } else {
    doc.text('Zur Prüfung durch den Mitarbeiter. Noch nicht bestätigt.');
  }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fontSize(8).fillColor('#666666').text(`Seite ${i + 1} von ${range.count}`, 40, 810, { width: 515, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

export function registerWeekSheetRoutes(app, { db, requireUser, requireAdmin }) {
  const out = (r) => ({
    id: r.id, user_id: r.user_id, user_name: r.user_name, week_start: r.week_start, status: r.status,
    sent_at: r.sent_at, confirmed_at: r.confirmed_at, reject_note: r.reject_note, snapshot: JSON.parse(r.snapshot),
  });
  const load = (id) => db.prepare('SELECT w.*, u.name AS user_name FROM week_sheets w JOIN users u ON u.id = w.user_id WHERE w.id = ?').get(id);

  // Chef: Woche an den Mitarbeiter schicken (nimmt den aktuellen Stand der Tageszettel).
  app.post('/api/week-sheets', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body ?? {};
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(b.user_id));
    if (!user) return reply.code(404).send({ error: 'Mitarbeiter nicht gefunden' });
    if (typeof b.week_start !== 'string' || !DATE_RE.test(b.week_start)) return reply.code(400).send({ error: 'Woche ungültig' });
    const ws = mondayOfDate(b.week_start);
    const old = db.prepare('SELECT * FROM week_sheets WHERE user_id = ? AND week_start = ?').get(user.id, ws);
    if (old?.status === 'confirmed') return reply.code(409).send({ error: 'Diese Woche ist schon bestätigt und gesperrt' });
    const snap = buildSnapshot(db, user, ws);
    if (!snap.days.length) return reply.code(400).send({ error: 'In dieser Woche gibt es noch keinen abgegebenen Tageszettel' });
    db.prepare(
      `INSERT INTO week_sheets (user_id, week_start, status, snapshot, sent_at, confirmed_at, reject_note) VALUES (?, ?, 'sent', ?, ?, NULL, NULL)
       ON CONFLICT(user_id, week_start) DO UPDATE SET status = 'sent', snapshot = excluded.snapshot, sent_at = excluded.sent_at, confirmed_at = NULL, reject_note = NULL`,
    ).run(user.id, ws, JSON.stringify(snap), Date.now());
    const row = db.prepare('SELECT id FROM week_sheets WHERE user_id = ? AND week_start = ?').get(user.id, ws);
    return out(load(row.id));
  });

  // Chef: alle (optional user_id), Mitarbeiter: nur eigene. Nach Wochenbeginn (Montag) gefiltert.
  app.get('/api/week-sheets', { preHandler: requireUser }, async (req, reply) => {
    const from = String(req.query.from ?? '0000-01-01');
    const to = String(req.query.to ?? '9999-12-31');
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return reply.code(400).send({ error: 'from und to (Datum) ungültig' });
    const base = 'SELECT w.*, u.name AS user_name FROM week_sheets w JOIN users u ON u.id = w.user_id WHERE w.week_start >= ? AND w.week_start <= ?';
    let rows;
    if (req.user.role === 'admin') {
      rows = req.query.user_id
        ? db.prepare(`${base} AND w.user_id = ? ORDER BY w.week_start DESC`).all(from, to, Number(req.query.user_id))
        : db.prepare(`${base} ORDER BY w.week_start DESC, u.name`).all(from, to);
    } else {
      rows = db.prepare(`${base} AND w.user_id = ? ORDER BY w.week_start DESC`).all(from, to, req.user.id);
    }
    return rows.map(out);
  });

  // Mitarbeiter: „Ich habe die Datei geprüft und bin einverstanden.“ Die Zeit ist die echte Zeit des Servers.
  app.post('/api/week-sheets/:id/confirm', { preHandler: requireUser }, async (req, reply) => {
    const r = load(Number(req.params.id));
    if (!r || r.user_id !== req.user.id) return reply.code(404).send({ error: 'Wochenzettel nicht gefunden' });
    if (r.status === 'confirmed') return reply.code(409).send({ error: 'Schon bestätigt' });
    if (req.body?.agree !== true) return reply.code(400).send({ error: 'Bitte bestätigen' });
    db.prepare("UPDATE week_sheets SET status = 'confirmed', confirmed_at = ?, reject_note = NULL WHERE id = ?").run(Date.now(), r.id);
    return out(load(r.id));
  });

  // Mitarbeiter: „Etwas stimmt nicht.“ Der Chef sieht den Hinweis und schickt die Woche neu.
  app.post('/api/week-sheets/:id/reject', { preHandler: requireUser }, async (req, reply) => {
    const r = load(Number(req.params.id));
    if (!r || r.user_id !== req.user.id) return reply.code(404).send({ error: 'Wochenzettel nicht gefunden' });
    if (r.status === 'confirmed') return reply.code(409).send({ error: 'Schon bestätigt und gesperrt' });
    const note = String(req.body?.note ?? '').trim().slice(0, 500);
    if (!note) return reply.code(400).send({ error: 'Bitte kurz schreiben, was nicht stimmt' });
    db.prepare("UPDATE week_sheets SET status = 'rejected', reject_note = ? WHERE id = ?").run(note, r.id);
    return out(load(r.id));
  });

  // PDF (Chef, oder der Mitarbeiter für seinen eigenen Zettel).
  app.get('/api/week-sheets/:id/pdf', { preHandler: requireUser }, async (req, reply) => {
    const r = load(Number(req.params.id));
    if (!r || (req.user.role !== 'admin' && r.user_id !== req.user.id)) return reply.code(404).send({ error: 'Wochenzettel nicht gefunden' });
    const pdf = await renderWeekPdf({ status: r.status, confirmed_at: r.confirmed_at, snapshot: JSON.parse(r.snapshot) });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="wochenzettel.pdf"`);
    return reply.send(pdf);
  });
}
