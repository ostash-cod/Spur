import ExcelJS from 'exceljs';

const TZ = 'Europe/Berlin';
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const weekday = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'UTC' });
const deDate = (date) => date.split('-').reverse().join('.');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n) => Math.round(n * 100) / 100;

function loadSheets(db, userId, from, to) {
  return db
    .prepare('SELECT date, data FROM sheets WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date')
    .all(userId, from, to)
    .map((r) => ({ date: r.date, ...JSON.parse(r.data) }));
}

/** Lohnzettel: pro Tag Beginn, Ende, Pause, bezahlte Stunden (Dezimalstunden). */
export function payrollModel(db, user, from, to) {
  const days = loadSheets(db, user.id, from, to).map((s) => {
    const paidMs = Math.max(0, s.end - s.start - s.pause_min * 60000);
    return { date: s.date, start: s.start, end: s.end, pause_min: s.pause_min, paid_hours: round2(paidMs / 3600000) };
  });
  return { user: user.name, from, to, days, total_hours: round2(days.reduce((a, d) => a + d.paid_hours, 0)) };
}

/** Kilometergeld: nur Fahrten mit dem Privatauto. Start und Ziel der Fahrt kommen aus den Nachbarzeilen. */
export function mileageModel(db, user, from, to, rate) {
  const siteName = (id) => (id ? db.prepare('SELECT name FROM sites WHERE id = ?').get(id)?.name ?? 'Baustelle' : null);
  const place = (l) => (!l ? 'Zuhause' : l.kind === 'work' ? siteName(l.site_id) ?? 'Baustelle' : l.kind === 'break' ? 'Pause' : 'Ort');
  const rows = [];
  for (const s of loadSheets(db, user.id, from, to)) {
    s.lines.forEach((l, i) => {
      if (l.kind !== 'travel' || l.vehicle !== 'privat' || !(l.km > 0)) return;
      const prev = s.lines[i - 1];
      const next = s.lines[i + 1];
      rows.push({ date: s.date, from_time: l.from, to_time: l.to, route: `${place(prev)} → ${place(next)}`, km: l.km, amount: round2(l.km * rate) });
    });
  }
  const km = Math.round(rows.reduce((a, r) => a + r.km, 0) * 10) / 10;
  return { user: user.name, from, to, rate, rows, total_km: km, total_amount: round2(km * rate) };
}

export async function payrollXlsx(m) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Lohnzettel');
  ws.addRow([`Stundennachweis ${m.user}`]).font = { bold: true, size: 14 };
  ws.addRow([`${deDate(m.from)} bis ${deDate(m.to)}`]);
  ws.addRow([]);
  ws.addRow(['Datum', 'Tag', 'Beginn', 'Ende', 'Pause (Min)', 'Bezahlt (Std)']).font = { bold: true };
  for (const d of m.days) ws.addRow([deDate(d.date), weekday(d.date), fmtTime(d.start), fmtTime(d.end), d.pause_min, d.paid_hours]);
  const total = ws.addRow(['Summe', '', '', '', '', m.total_hours]);
  total.font = { bold: true };
  ws.getColumn(6).numFmt = '0.00';
  [14, 8, 10, 10, 13, 15].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function mileageXlsx(m) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Kilometergeld');
  ws.addRow([`Kilometergeld ${m.user}`]).font = { bold: true, size: 14 };
  ws.addRow([`${deDate(m.from)} bis ${deDate(m.to)} · ${String(m.rate).replace('.', ',')} € pro Kilometer`]);
  ws.addRow([]);
  ws.addRow(['Datum', 'Von', 'Bis', 'Strecke', 'Kilometer', 'Betrag (€)']).font = { bold: true };
  for (const r of m.rows) ws.addRow([deDate(r.date), fmtTime(r.from_time), fmtTime(r.to_time), r.route, r.km, r.amount]);
  const total = ws.addRow(['Summe', '', '', '', m.total_km, m.total_amount]);
  total.font = { bold: true };
  ws.getColumn(5).numFmt = '0.0';
  ws.getColumn(6).numFmt = '0.00';
  [14, 9, 9, 36, 12, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function registerPayrollRoutes(app, { db, requireAdmin }) {
  const common = (req, reply) => {
    const { user_id, from, to } = req.query;
    if (!DATE_RE.test(String(from)) || !DATE_RE.test(String(to)) || to < from) { reply.code(400).send({ error: 'Zeitraum ungültig (von und bis als Datum)' }); return null; }
    const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(Number(user_id));
    if (!user) { reply.code(404).send({ error: 'Mitarbeiter nicht gefunden' }); return null; }
    return { user, from, to };
  };
  const send = (reply, buf, name) =>
    reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename="${name}"`).send(buf);
  const safe = (s) => s.replace(/[^\wäöüÄÖÜß-]+/g, '_');

  app.get('/api/reports/payroll', { preHandler: requireAdmin }, async (req, reply) => {
    const c = common(req, reply);
    if (!c) return;
    const m = payrollModel(db, c.user, c.from, c.to);
    if (req.query.format === 'xlsx') return send(reply, await payrollXlsx(m), `Stundennachweis_${safe(c.user.name)}_${c.from}_${c.to}.xlsx`);
    return m;
  });

  app.get('/api/reports/mileage', { preHandler: requireAdmin }, async (req, reply) => {
    const c = common(req, reply);
    if (!c) return;
    const rate = Number(String(req.query.rate ?? '0.30').replace(',', '.'));
    if (!Number.isFinite(rate) || rate < 0 || rate > 5) return reply.code(400).send({ error: 'Satz ungültig' });
    const m = mileageModel(db, c.user, c.from, c.to, rate);
    if (req.query.format === 'xlsx') return send(reply, await mileageXlsx(m), `Kilometergeld_${safe(c.user.name)}_${c.from}_${c.to}.xlsx`);
    return m;
  });
}
