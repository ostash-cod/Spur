import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Standard-Einstellungen aus dem Bauplan (alles später in den Einstellungen änderbar).
export const DEFAULT_SETTINGS = {
  company: {
    name: 'Volodymyr Ostash Fliesen, Trockenbau, Renovierungen',
    address: 'Keltenstraße 31, 82343 Pöcking',
    email: '',
  },
  // Die Firma hat noch keine Koordinaten; Wladi trägt sie in den Einstellungen ein.
  firma: { lat: null, lng: null, radius_m: 100 },
  lager: { lat: 47.96137940326983, lng: 11.30548442373459, radius_m: 100 },
  site_radius_m: 100,
  unknown_place_minutes: 10,
  // [ab Stunden Arbeitszeit, Pause in Minuten]
  break_rules: [
    [2.5, 15],
    [5, 30],
    [7.5, 45],
    [10, 60],
  ],
  km_rate_customer: 0.5,
  km_rate_employee: 0.3,
  // Variante C: Rohe GPS-Punkte bleiben auf dem Handy und werden dort nach so vielen Stunden gelöscht (nach Tagesende).
  phone_points_hours: 48,
  // Betriebsschalter: Änderungen protokollieren (alter und neuer Wert). Standard aus, es gibt keine stillen Originale. Später für andere Firmen einschaltbar.
  protocol_changes: false,
  // Variante B (Betriebsschalter): 0 = aus. 7 bis 14 = Handys schicken den Weg, der Server löscht ihn nach so vielen Tagen.
  server_route_days: 0,
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'de' CHECK (language IN ('de','ru','uk')),
  role TEXT NOT NULL DEFAULT 'worker' CHECK (role IN ('admin','worker')),
  uses_private_car INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  UNIQUE (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS days_user_started ON days (user_id, started_at);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  hourly_rate REAL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  name TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  radius_m REAL,
  color TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  date TEXT NOT NULL,
  site_id INTEGER REFERENCES sites(id),
  text TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS notes_date ON notes (date);
CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  file TEXT NOT NULL DEFAULT '',
  ext TEXT NOT NULL DEFAULT 'pdf',
  bytes INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, client_id)
);
CREATE TABLE IF NOT EXISTS receipt_allocs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  text TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS receipt_allocs_site ON receipt_allocs (site_id);
CREATE TABLE IF NOT EXISTS sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (user_id, date)
);
CREATE TABLE IF NOT EXISTS week_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  week_start TEXT NOT NULL,
  status TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  reject_note TEXT,
  UNIQUE (user_id, week_start)
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  site_id INTEGER REFERENCES sites(id),
  taken_at INTEGER NOT NULL,
  file TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  UNIQUE (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS photos_taken ON photos (taken_at);
CREATE TABLE IF NOT EXISTS site_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id INTEGER NOT NULL REFERENCES days(id),
  client_id TEXT NOT NULL,
  site_id INTEGER REFERENCES sites(id),
  kind TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('work','travel','private','break')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  UNIQUE (day_id, client_id)
);
CREATE TABLE IF NOT EXISTS trip_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id INTEGER NOT NULL REFERENCES days(id),
  started_at INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('normal','material','private')),
  site_id INTEGER REFERENCES sites(id),
  UNIQUE (day_id, started_at)
);
-- Änderungsprotokoll: wird nur geschrieben, wenn der Betriebsschalter protocol_changes an ist (Standard aus). Ältere Einträge bleiben.
CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at INTEGER NOT NULL,
  changed_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS change_log_item ON change_log (item, item_id);
CREATE TABLE IF NOT EXISTS points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id INTEGER NOT NULL REFERENCES days(id),
  ts INTEGER NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  acc REAL,
  UNIQUE (day_id, ts)
);
`;

export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // Spätere Ergänzungen an bestehenden Tabellen (läuft bei jedem Start, ist wiederholbar)
  const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!hasColumn('customers', 'address')) db.exec('ALTER TABLE customers ADD COLUMN address TEXT');
  if (!hasColumn('sites', 'system')) db.exec('ALTER TABLE sites ADD COLUMN system TEXT');
  if (!hasColumn('users', 'can_receipts')) db.exec('ALTER TABLE users ADD COLUMN can_receipts INTEGER NOT NULL DEFAULT 0');
  if (!hasColumn('users', 'home_km')) db.exec('ALTER TABLE users ADD COLUMN home_km REAL');
  if (!hasColumn('notes', 'kind')) db.exec("ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'arbeit'");
  const tm = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'trip_marks'").get();
  if (tm && !tm.sql.includes("'private'")) {
    db.exec(`ALTER TABLE trip_marks RENAME TO trip_marks_old;
      CREATE TABLE trip_marks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_id INTEGER NOT NULL REFERENCES days(id),
        started_at INTEGER NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('normal','material','private')),
        site_id INTEGER REFERENCES sites(id),
        UNIQUE (day_id, started_at)
      );
      INSERT INTO trip_marks (id, day_id, started_at, mode, site_id) SELECT id, day_id, started_at, mode, site_id FROM trip_marks_old;
      DROP TABLE trip_marks_old;`);
  }
  if (!hasColumn('segments', 'activity')) db.exec('ALTER TABLE segments ADD COLUMN activity TEXT');
  if (!hasColumn('segments', 'billing')) db.exec('ALTER TABLE segments ADD COLUMN billing TEXT');
  if (!hasColumn('sites', 'kind')) db.exec("ALTER TABLE sites ADD COLUMN kind TEXT NOT NULL DEFAULT 'baustelle'");
  // Kunden wie in LexOffice: Firma oder Privatperson, Adresse in einzelnen Feldern, Kundennummer.
  // name und address bleiben als Anzeige erhalten und werden aus diesen Feldern zusammengesetzt.
  for (const col of ['kind', 'salutation', 'first_name', 'last_name', 'company', 'contact_person', 'street', 'zip', 'city', 'country', 'phone', 'customer_no', 'note']) {
    if (!hasColumn('customers', col)) {
      db.exec(`ALTER TABLE customers ADD COLUMN ${col} TEXT`);
      if (col === 'note') splitOldAddresses(db);
    }
  }
  // Schritt 3: Chef ändert, teilt und löscht Abschnitte. Gelöscht wird nur ausgeblendet (deleted_at).
  // chef_edited = 1: Das Handy darf den Abschnitt (oder Tag) nicht mehr überschreiben – die Änderung des Chefs gewinnt.
  if (!hasColumn('segments', 'deleted_at')) db.exec('ALTER TABLE segments ADD COLUMN deleted_at INTEGER');
  if (!hasColumn('segments', 'chef_edited')) db.exec('ALTER TABLE segments ADD COLUMN chef_edited INTEGER NOT NULL DEFAULT 0');
  if (!hasColumn('segments', 'created_at')) db.exec('ALTER TABLE segments ADD COLUMN created_at INTEGER');
  if (!hasColumn('segments', 'updated_at')) db.exec('ALTER TABLE segments ADD COLUMN updated_at INTEGER');
  if (!hasColumn('days', 'chef_edited')) db.exec('ALTER TABLE days ADD COLUMN chef_edited INTEGER NOT NULL DEFAULT 0');
  // Testmodus mit Karte: nur für den Chef, nur als Schalter. Dann schickt sein Handy den Weg an den Server.
  if (!hasColumn('users', 'gps_test')) db.exec('ALTER TABLE users ADD COLUMN gps_test INTEGER NOT NULL DEFAULT 0');
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insert.run(key, JSON.stringify(value));
  }
  // Ab wann Variante C gilt. Ältere Punkte auf dem Server löscht nie ein Automatismus, nur Wladi selbst.
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('points_policy_since', JSON.stringify(Date.now()));
  ensureSystemSites(db);
  return db;
}

/** Bestehende Kunden: „Straße Nr, PLZ Ort“ in einzelne Felder aufteilen, wenn es eindeutig geht. Name wird Firmenname. */
function splitOldAddresses(db) {
  const upd = db.prepare("UPDATE customers SET kind = 'firma', company = ?, street = ?, zip = ?, city = ?, country = 'Deutschland' WHERE id = ?");
  for (const c of db.prepare('SELECT id, name, address FROM customers').all()) {
    const m = String(c.address ?? '').match(/^\s*(.+?)\s*,\s*(\d{5})\s+(.+?)\s*$/);
    upd.run(c.name, m ? m[1] : c.address ?? null, m ? m[2] : null, m ? m[3] : null, c.id);
  }
}

/** Darf dieser Benutzer GPS-Punkte an den Server schicken? Nur im Testmodus des Chefs oder mit Variante B. */
export function mayUploadPoints(db, user) {
  if (user.role === 'admin' && user.gps_test) return true;
  return Number(getSettings(db).server_route_days) > 0;
}

/**
 * Variante B: Punkte nach der eingestellten Zahl von Tagen löschen. Punkte aus dem Testmodus des Chefs bleiben.
 * Punkte von vor Variante C werden hier nie angefasst (Wladi entscheidet darüber selbst).
 */
export function purgeRoutePoints(db, now = Date.now()) {
  const s = getSettings(db);
  const days = Number(s.server_route_days);
  if (!(days > 0)) return 0;
  const since = Number(s.points_policy_since) || now;
  const cutoff = now - days * 86_400_000;
  return Number(
    db.prepare(
      `DELETE FROM points WHERE ts >= ? AND ts < ? AND day_id IN (
         SELECT d.id FROM days d JOIN users u ON u.id = d.user_id WHERE NOT (u.role = 'admin' AND u.gps_test = 1))`,
    ).run(since, cutoff).changes,
  );
}

const SYSTEM_SITES = {
  lager: { name: 'Lager', color: '#546E7A' },
  firma: { name: 'Firma', color: '#37474F' },
};

// Lager und Firma sind feste Orte. Ihre Position kommt aus den Einstellungen.
export function ensureSystemSites(db) {
  const settings = getSettings(db);
  for (const [key, def] of Object.entries(SYSTEM_SITES)) {
    const place = settings[key] ?? {};
    const address = key === 'firma' ? settings.company?.address ?? null : null;
    const row = db.prepare('SELECT id FROM sites WHERE system = ?').get(key);
    if (row) {
      db.prepare('UPDATE sites SET lat = ?, lng = ?, radius_m = ?, address = COALESCE(?, address) WHERE id = ?').run(
        place.lat ?? null,
        place.lng ?? null,
        place.radius_m ?? null,
        address,
        row.id,
      );
    } else {
      db.prepare('INSERT INTO sites (name, address, lat, lng, radius_m, color, system) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        def.name,
        address,
        place.lat ?? null,
        place.lng ?? null,
        place.radius_m ?? null,
        def.color,
        key,
      );
    }
  }
}

export function getSettings(db) {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    out[row.key] = JSON.parse(row.value);
  }
  return out;
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

/** Merkt eine Änderung (alter und neuer Wert), aber nur wenn der Betriebsschalter „protocol_changes“ an ist. Standard aus. */
export function logChange(db, { item, itemId, field, oldValue, newValue, by }) {
  if (String(oldValue ?? '') === String(newValue ?? '')) return;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'protocol_changes'").get();
  if (!row || JSON.parse(row.value) !== true) return;
  db.prepare('INSERT INTO change_log (item, item_id, field, old_value, new_value, changed_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    item, itemId, field, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue), Date.now(), by ?? null,
  );
}
