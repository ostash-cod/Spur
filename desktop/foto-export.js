// Foto-Export: Fotos eines Tages in einen Ordner am PC schreiben (zum Beispiel ein Google-Drive-Ordner)
// oder als ZIP-Datei laden. Nichts hier löscht, überschreibt oder verkleinert Fotos.

const pad2 = (n) => String(n).padStart(2, '0');

/** Umlaute und ß für Dateinamen: ä → ae, ß → ss. */
export function translit(s) {
  return String(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss');
}

/** Sicherer Teil eines Dateinamens: nur Buchstaben und Ziffern, Rest wird zu Bindestrich. */
export function fileSafe(s) {
  const t = translit(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return t || 'Baustelle';
}

/** Ordnername: Umlaute bleiben, nur die in Windows verbotenen Zeichen fallen weg. */
export function folderSafe(s) {
  const t = String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return t || 'Ohne Baustelle';
}

/** Ortszeit eines Fotos: Datum, Uhrzeit und Zeitstempel für den Dateinamen. */
export function localParts(ms) {
  const d = new Date(ms);
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hh = pad2(d.getHours()), mi = pad2(d.getMinutes()), ss = pad2(d.getSeconds());
  return { date, time: `${hh}:${mi}:${ss}`, stamp: `${date}_${hh}-${mi}-${ss}` };
}

export function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = ['Datei', 'Datum', 'Uhrzeit', 'Baustelle', 'Mitarbeiter', 'Notiz'];

export function buildCsv(rows) {
  return [CSV_HEADER, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/**
 * Plan: Fotos nach Baustelle gruppieren, nach Uhrzeit sortieren, Dateinamen vergeben.
 * photos: [{ id, taken_at, user_name, site }]  (site = Name der Baustelle oder null)
 * Ergebnis: [{ siteName, folderName, files: [{ photo, fileName }] }]
 */
export function planExport(photos) {
  const groups = new Map();
  for (const p of [...photos].sort((a, b) => a.taken_at - b.taken_at || a.id - b.id)) {
    const name = p.site || 'Ohne Baustelle';
    if (!groups.has(name)) groups.set(name, { siteName: name, folderName: folderSafe(name), files: [], used: new Set() });
    const g = groups.get(name);
    const base = `${localParts(p.taken_at).stamp}_${fileSafe(name)}`;
    let fileName = `${base}.jpg`;
    for (let n = 2; g.used.has(fileName); n++) fileName = `${base}_${n}.jpg`;
    g.used.add(fileName);
    g.files.push({ photo: p, fileName });
  }
  return [...groups.values()].map(({ siteName, folderName, files }) => ({ siteName, folderName, files }));
}

export function csvRows(group) {
  return group.files.map(({ photo, fileName }) => {
    const t = localParts(photo.taken_at);
    return [fileName, t.date, t.time, group.siteName, photo.user_name ?? '', ''];
  });
}

// --- Ordner schreiben (Chrome/Edge) --------------------------------------------------------------

export const canPickFolder = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('spur-desktop', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function kv(op, key, value) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', op === 'get' ? 'readonly' : 'readwrite');
      const st = tx.objectStore('kv');
      const req = op === 'get' ? st.get(key) : st.put(value, key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

/** Der zuletzt gewählte Ordner (oder undefined). */
export const rememberedFolder = () => kv('get', 'fotoZiel');

/** Ordner wählen lassen und merken. Muss aus einem Klick heraus aufgerufen werden. */
export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'spur-fotos', mode: 'readwrite' });
  await kv('set', 'fotoZiel', handle);
  return handle;
}

/** Schreibrecht prüfen, wenn nötig neu erfragen (Klick nötig). */
export async function ensureWrite(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

const dirKey = (s) => fileSafe(s).toLowerCase();

/** Ordner der Baustelle unter dem Zielordner: vorhandenen nehmen (gleicher oder passender Name), sonst anlegen. */
export async function findOrCreateSiteDir(root, folderName) {
  const want = dirKey(folderName);
  const fits = (have) => have === want || have.startsWith(want + '-') || want.startsWith(have + '-');
  const exact = [], loose = [];
  for await (const entry of root.values()) {
    if (entry.kind !== 'directory') continue;
    const have = dirKey(entry.name);
    if (have === want) exact.push(entry);
    else if (fits(have)) loose.push(entry);
  }
  const pick = exact[0] ?? loose.sort((a, b) => a.name.length - b.name.length)[0];
  return pick ?? root.getDirectoryHandle(folderName, { create: true });
}

async function existingSize(dir, name) {
  try {
    return (await (await dir.getFileHandle(name)).getFile()).size;
  } catch {
    return null;
  }
}

/** Freier Dateiname im Ordner. Gibt { name, skip } zurück: skip = gleiche Datei liegt schon da. */
async function freeName(dir, name, size) {
  const dot = name.lastIndexOf('.');
  const stem = name.slice(0, dot), ext = name.slice(dot);
  for (let n = 1; n < 1000; n++) {
    const cand = n === 1 ? name : `${stem}_v${n}${ext}`;
    const have = await existingSize(dir, cand);
    if (have == null) return { name: cand, skip: false };
    if (have === size) return { name: cand, skip: true };
  }
  throw new Error('Kein freier Dateiname: ' + name);
}

async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

/**
 * Plan in den gewählten Ordner schreiben: <Ziel>/<Baustelle>/Fotos/Spur <Datum>/
 * fetchBytes(photo) holt das Bild vom Server. onProgress(fertig, gesamt).
 * Ergebnis: { written, skipped, folders: ['Baustelle/Fotos/Spur 2026-11-26', ...] }
 */
export async function writePlan(root, plan, date, fetchBytes, onProgress = () => {}) {
  const total = plan.reduce((a, g) => a + g.files.length, 0);
  let done = 0, written = 0, skipped = 0;
  const folders = [];
  for (const g of plan) {
    const siteDir = await findOrCreateSiteDir(root, g.folderName);
    const outName = `Spur ${date}`;
    const out = await (await siteDir.getDirectoryHandle('Fotos', { create: true })).getDirectoryHandle(outName, { create: true });
    folders.push(`${siteDir.name}\\Fotos\\${outName}`);
    const rows = [];
    for (const f of g.files) {
      const bytes = new Uint8Array(await fetchBytes(f.photo));
      const free = await freeName(out, f.fileName, bytes.length);
      if (free.skip) skipped++;
      else { await writeFile(out, free.name, bytes); written++; }
      const t = localParts(f.photo.taken_at);
      rows.push([free.name, t.date, t.time, g.siteName, f.photo.user_name ?? '', '']);
      onProgress(++done, total);
    }
    await writeFile(out, 'fotos.csv', buildCsv(rows));
  }
  return { written, skipped, folders };
}

// --- ZIP (ohne Komprimierung; JPEG lässt sich nicht weiter packen) ---------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, data: Uint8Array, ms }] → Uint8Array der ZIP-Datei */
export function makeZip(entries) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const d = new Date(e.ms ?? Date.now());
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dat = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const crc = crc32(e.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, dat, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, e.data.length, true); lh.setUint32(22, e.data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, e.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, dat, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, e.data.length, true); ch.setUint32(24, e.data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + e.data.length;
  }
  const csize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let pos = 0;
  for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}

/** Plan als ZIP: <Baustelle>/Fotos/Spur <Datum>/<Datei> und dort fotos.csv. */
export async function buildZip(plan, date, fetchBytes, onProgress = () => {}) {
  const total = plan.reduce((a, g) => a + g.files.length, 0);
  let done = 0;
  const entries = [];
  const enc = new TextEncoder();
  for (const g of plan) {
    const base = `${g.folderName}/Fotos/Spur ${date}/`;
    for (const f of g.files) {
      entries.push({ name: base + f.fileName, data: new Uint8Array(await fetchBytes(f.photo)), ms: f.photo.taken_at });
      onProgress(++done, total);
    }
    entries.push({ name: base + 'fotos.csv', data: enc.encode(buildCsv(csvRows(g))), ms: Date.now() });
  }
  return makeZip(entries);
}
