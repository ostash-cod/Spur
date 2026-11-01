import { createHash, randomBytes, randomInt } from 'node:crypto';

// Ohne verwechselbare Zeichen (0/O, 1/I/L), damit der Code am Handy leicht einzutippen ist.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateCode() {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizeCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashCode(code) {
  return createHash('sha256').update(normalizeCode(code)).digest('hex');
}

export function newToken() {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

// Legt einen Benutzer mit neuem Zugangscode an. Der Klartext-Code wird nur hier zurückgegeben.
export function createUser(db, { name, language = 'de', role = 'worker', uses_private_car = 0 }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      const info = db
        .prepare(
          'INSERT INTO users (name, language, role, uses_private_car, code_hash) VALUES (?, ?, ?, ?, ?)',
        )
        .run(name, language, role, uses_private_car ? 1 : 0, hashCode(code));
      return { id: Number(info.lastInsertRowid), code };
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
    }
  }
  throw new Error('Konnte keinen eindeutigen Zugangscode erzeugen');
}

export function rotateCode(db, userId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      db.prepare('UPDATE users SET code_hash = ? WHERE id = ?').run(hashCode(code), userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      return code;
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
    }
  }
  throw new Error('Konnte keinen eindeutigen Zugangscode erzeugen');
}

export function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    role: row.role,
    uses_private_car: !!row.uses_private_car,
    active: !!row.active,
  };
}
