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
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insert.run(key, JSON.stringify(value));
  }
  return db;
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
