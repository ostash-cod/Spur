import { writeFileSync, chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';
import { createUser } from './auth.js';
import { buildApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.SPUR_DATA_DIR ?? join(here, '..', 'data');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const db = openDb(join(dataDir, 'spur.db'));

// Erster Start: Chef-Zugang anlegen. Der Code steht nur in dieser Datei, nie im Protokoll.
const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
if (!hasUsers) {
  const { code } = createUser(db, { name: 'Wladi', language: 'uk', role: 'admin', uses_private_car: 0 });
  const file = join(dataDir, 'erster-zugang.txt');
  if (!existsSync(file)) {
    writeFileSync(file, `Zugangscode für Wladi (Chef): ${code}\nDiese Datei nach dem ersten Anmelden löschen.\n`);
    chmodSync(file, 0o600);
  }
  console.log(`Chef-Zugang angelegt. Der Code steht in ${file}`);
}

const app = await buildApp({
  db,
  staticDir: join(here, '..', '..', 'desktop'),
  logger: { level: 'info', redact: ['req.headers.authorization'] },
});
await app.listen({ port, host });
