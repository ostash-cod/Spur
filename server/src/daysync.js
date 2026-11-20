import { dateKey } from './report.js';
import { touchWeek } from './weeksheets.js';

const R5 = 5 * 60000;
const r5 = (ms) => Math.round(ms / R5) * R5;

const sheetRowOf = (db, day) =>
  db.prepare('SELECT * FROM sheets WHERE user_id = ? AND date = ?').get(day.user_id, dateKey(day.started_at));

// Bevor der Chef zum ersten Mal an einem Tag etwas ändert, merkt sich Spur still den Originalzustand (Abschnitte, Tagesgrenzen, Zettel).
// Es gibt keinen Verlauf und keinen Text in der Ansicht, nur den Weg zurück: restoreDay.
export function snapshotDay(db, dayId) {
  if (db.prepare('SELECT 1 FROM day_originals WHERE day_id = ?').get(dayId)) return;
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(dayId);
  if (!day) return;
  const segments = db.prepare('SELECT id, started_at, ended_at, site_id, kind, billing, activity, deleted_at, chef_edited FROM segments WHERE day_id = ?').all(dayId);
  const sheet = sheetRowOf(db, day);
  db.prepare('INSERT INTO day_originals (day_id, snapshot, saved_at) VALUES (?, ?, ?)').run(
    dayId,
    JSON.stringify({ day: { started_at: day.started_at, ended_at: day.ended_at, chef_edited: day.chef_edited }, segments, sheet: sheet ? sheet.data : null }),
    Date.now(),
  );
}

export const hasOriginal = (db, dayId) => !!db.prepare('SELECT 1 FROM day_originals WHERE day_id = ?').get(dayId);

/** Prüft, ob der Zettel dieses Tages noch geändert werden darf (Woche nicht bestätigt). Ohne Zettel: ja. */
export function sheetEditable(db, dayId) {
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(dayId);
  const row = day && sheetRowOf(db, day);
  if (!row) return true;
  const ws = db.prepare('SELECT status FROM week_sheets WHERE user_id = ? AND week_start = ?').get(row.user_id, mondayKey(row.date));
  return !(ws && ws.status === 'confirmed');
}

function mondayKey(date) {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Überträgt Änderungen an Abschnitten auf den abgegebenen Zettel des Tages (der Zettel bleibt die Grundlage für den Lohn).
 * changes: [{ before: {from,to,site_id,kind} | null, after: {...} | [{...}, {...}] | null }]
 * Pause und Kilometer bleiben, wie sie sind. Fahrten, die an einem geänderten Abschnitt hingen, wandern mit.
 * Gibt true zurück, wenn der Zettel geändert wurde.
 */
export function syncSheet(db, dayId, changes) {
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(dayId);
  const row = day && sheetRowOf(db, day);
  if (!row) return false;
  const data = JSON.parse(row.data);
  const lines = data.lines.map((l) => ({ ...l })).sort((a, b) => a.from - b.from);
  // Fahrten merken, woran sie hingen (Ende des Vorgängers, Beginn des Nachfolgers).
  const links = new Map();
  lines.forEach((l, i) => {
    if (l.kind !== 'travel') return;
    const prev = lines[i - 1], next = lines[i + 1];
    links.set(l, { prev: prev && prev.to === l.from ? prev : null, next: next && next.from === l.to ? next : null });
  });
  const removed = new Set();
  let changed = false;
  const same = (l, b) => l.kind === b.kind && (l.site_id ?? null) === (b.site_id ?? null) && Math.abs(l.from - b.from) <= R5 && Math.abs(l.to - b.to) <= R5;
  for (const { before, after } of changes) {
    if (!before) continue;
    const line = lines.find((l) => !removed.has(l) && l.kind !== 'travel' && same(l, before));
    if (!line) continue;
    const parts = after == null ? [] : Array.isArray(after) ? after : [after];
    changed = true;
    if (!parts.length) { removed.add(line); continue; }
    const [first, ...more] = parts;
    Object.assign(line, { kind: first.kind, site_id: first.site_id ?? null, from: r5(first.from), to: r5(first.to) });
    for (const m of more) lines.push({ kind: m.kind, site_id: m.site_id ?? null, from: r5(m.from), to: r5(m.to), km: null, vehicle: null });
  }
  if (!changed) return false;
  for (const [t, { prev, next }] of links) {
    if (prev && !removed.has(prev)) t.from = prev.to;
    if (next && !removed.has(next)) t.to = next.from;
    if (t.to < t.from) t.to = t.from;
  }
  const out = lines.filter((l) => !removed.has(l)).sort((a, b) => a.from - b.from);
  data.lines = out;
  if (out.length) {
    data.start = Math.min(data.start, out[0].from);
    data.end = Math.max(data.end, Math.max(...out.map((l) => l.to)));
  }
  if (!touchWeek(db, row.user_id, row.date)) return false;
  db.prepare('UPDATE sheets SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id);
  return true;
}

/** Zurück zum Original: Abschnitte, Tagesgrenzen und Zettel, wie sie vor der ersten Änderung des Chefs waren. */
export function restoreDay(db, dayId) {
  const snapRow = db.prepare('SELECT snapshot FROM day_originals WHERE day_id = ?').get(dayId);
  if (!snapRow) return { error: 'Kein Original gespeichert', code: 404 };
  const snap = JSON.parse(snapRow.snapshot);
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(dayId);
  const sheet = snap.sheet != null ? sheetRowOf(db, day) : null;
  if (sheet && !touchWeek(db, sheet.user_id, sheet.date)) return { error: 'Diese Woche ist bestätigt und gesperrt', code: 409 };
  const now = Date.now();
  const known = new Set(snap.segments.map((s) => s.id));
  for (const s of snap.segments) {
    db.prepare('UPDATE segments SET started_at = ?, ended_at = ?, site_id = ?, kind = ?, billing = ?, activity = ?, deleted_at = ?, chef_edited = ?, updated_at = ? WHERE id = ?')
      .run(s.started_at, s.ended_at, s.site_id, s.kind, s.billing, s.activity, s.deleted_at, s.chef_edited, now, s.id);
  }
  for (const s of db.prepare('SELECT id FROM segments WHERE day_id = ? AND deleted_at IS NULL').all(dayId)) {
    if (!known.has(s.id)) db.prepare('UPDATE segments SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, s.id);
  }
  db.prepare('UPDATE days SET started_at = ?, ended_at = ?, chef_edited = ? WHERE id = ?').run(snap.day.started_at, snap.day.ended_at, snap.day.chef_edited, dayId);
  if (sheet) db.prepare('UPDATE sheets SET data = ? WHERE id = ?').run(snap.sheet, sheet.id);
  db.prepare('DELETE FROM day_originals WHERE day_id = ?').run(dayId);
  return { ok: true };
}
