import { createHash, randomBytes, randomInt } from 'node:crypto';

// Ohne verwechselbare Zeichen (0/O, 1/I/L), damit der Code am Handy leicht einzutippen ist.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateCode() {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// Frühere Schreibweise (Umlaute bleiben erhalten). Wird weiter akzeptiert, damit bereits gesetzte Codes gelten.
export function normalizeCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// Aktuelle Schreibweise: Groß/Klein, Leerzeichen, Striche und Zeichen-Zusätze (zum Beispiel die
// Pünktchen auf ä) zählen nicht. So macht es keinen Unterschied, wie die Handy-Tastatur ein ä erzeugt.
export function foldCode(code) {
  return String(code ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

export function hashCode(code) {
  return sha(foldCode(code));
}

// Alle Hashes, mit denen ein eingegebener Code gespeichert sein könnte (neu und früher).
export function candidateHashes(code) {
  const raw = String(code ?? '');
  return [...new Set([sha(foldCode(raw)), sha(normalizeCode(raw)), sha(normalizeCode(raw.normalize('NFC')))])];
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
