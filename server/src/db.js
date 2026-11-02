import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Standard-Einstellungen aus dem Bauplan (alles später in den Einstellungen änderbar).
export const DEFAULT_SETTINGS = {
  company: {
    name: 'Volodymyr Ostash Fliesen, Trockenbau, Renovierungen',
    address: 'Keltenstraße 31, 82343 Pöcking',
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
  mode TEXT NOT NULL CHECK (mode IN ('normal','material')),
  site_id INTEGER REFERENCES sites(id),
  UNIQUE (day_id, started_at)
);
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
  if (!hasColumn('sites', 'kind')) db.exec("ALTER TABLE sites ADD COLUMN kind TEXT NOT NULL DEFAULT 'baustelle'");
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insert.run(key, JSON.stringify(value));
  }
  ensureSystemSites(db);
  return db;
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
