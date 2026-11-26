import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileSafe, folderSafe, localParts, buildCsv, planExport, csvRows, crc32, makeZip } from '../../desktop/foto-export.js';

const at = (h, m, s) => new Date(2026, 10, 26, h, m, s).getTime();

test('Dateiname: Uhrzeit und Baustelle ohne Umlaute', () => {
  assert.equal(fileSafe('Lilienstraße'), 'Lilienstrasse');
  assert.equal(fileSafe('Müller & Söhne, Tutzing'), 'Mueller-Soehne-Tutzing');
  assert.equal(fileSafe('???'), 'Baustelle');
  assert.equal(localParts(at(10, 42, 13)).stamp, '2026-11-26_10-42-13');
  const plan = planExport([{ id: 1, taken_at: at(10, 42, 13), user_name: 'Wladi', site: 'Lilienstraße' }]);
  assert.equal(plan[0].files[0].fileName, '2026-11-26_10-42-13_Lilienstrasse.jpg');
});

test('Ordnername: Umlaute bleiben, verbotene Zeichen fallen weg', () => {
  assert.equal(folderSafe('Lilienstraße 12'), 'Lilienstraße 12');
  assert.equal(folderSafe('A/B: "C"?'), 'A-B- -C--'.replace(/ +/g, ' '));
  assert.equal(folderSafe('Haus. '), 'Haus');
  assert.equal(folderSafe(''), 'Ohne Baustelle');
});

test('Plan: nach Uhrzeit sortiert, gleiche Sekunde bekommt Zähler, Gruppen je Baustelle', () => {
  const plan = planExport([
    { id: 3, taken_at: at(11, 0, 0), user_name: 'Wladi', site: 'Tutzing' },
    { id: 2, taken_at: at(10, 0, 5), user_name: 'Wladi', site: 'Lilienstraße' },
    { id: 1, taken_at: at(10, 0, 5), user_name: 'Wladi', site: 'Lilienstraße' },
    { id: 4, taken_at: at(9, 0, 0), user_name: 'Wladi', site: null },
  ]);
  const lili = plan.find((g) => g.siteName === 'Lilienstraße');
  assert.deepEqual(lili.files.map((f) => f.fileName), ['2026-11-26_10-00-05_Lilienstrasse.jpg', '2026-11-26_10-00-05_Lilienstrasse_2.jpg']);
  assert.deepEqual(lili.files.map((f) => f.photo.id), [1, 2]);
  assert.equal(plan.find((g) => g.siteName === 'Ohne Baustelle').folderName, 'Ohne Baustelle');
  assert.equal(plan.length, 3);
});

test('CSV: Kopfzeile, Semikolon, eine Zeile je Foto, Notiz leer, Anführungszeichen bei Sonderzeichen', () => {
  const plan = planExport([
    { id: 1, taken_at: at(10, 42, 13), user_name: 'Wladi', site: 'Lilienstraße' },
    { id: 2, taken_at: at(10, 43, 0), user_name: 'Wladi', site: 'Lilienstraße' },
  ]);
  const csv = buildCsv(csvRows(plan[0]));
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'Datei;Datum;Uhrzeit;Baustelle;Mitarbeiter;Notiz');
  assert.equal(lines[1], '2026-11-26_10-42-13_Lilienstrasse.jpg;2026-11-26;10:42:13;Lilienstraße;Wladi;');
  assert.equal(lines.length, 3);
  assert.equal(buildCsv([['a;b', 'c"d', 'e', 'f', 'g', '']]).split('\r\n')[1], '"a;b";"c""d";e;f;g;');
});

test('ZIP: gültig, Namen und Inhalt stimmen', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const dir = mkdtempSync(join(tmpdir(), 'spur-zip-'));
  try {
    const a = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
    const zip = makeZip([
      { name: 'Lilienstraße/Fotos/Spur 2026-11-26/a.jpg', data: a, ms: at(10, 0, 0) },
      { name: 'Lilienstraße/Fotos/Spur 2026-11-26/fotos.csv', data: new TextEncoder().encode('Datei;Datum\r\n'), ms: at(10, 0, 0) },
    ]);
    writeFileSync(join(dir, 't.zip'), zip);
    const out = execFileSync('python3', ['-I', '-c', `
import zipfile,sys,hashlib
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
n=sorted(z.namelist()); print('|'.join(n)); print(hashlib.md5(z.read(n[0])).hexdigest())
`, join(dir, 't.zip')]).toString().trim().split('\n');
    assert.equal(out[0], 'Lilienstraße/Fotos/Spur 2026-11-26/a.jpg|Lilienstraße/Fotos/Spur 2026-11-26/fotos.csv');
    const md5 = execFileSync('python3', ['-I', '-c', 'import hashlib,sys; print(hashlib.md5(bytes((i*7)%256 for i in range(70000))).hexdigest())']).toString().trim();
    assert.equal(out[1], md5);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
