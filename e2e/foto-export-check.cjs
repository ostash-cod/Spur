// Hinweis: mit UTF-8-Spracheinstellung starten (LC_ALL=C.UTF-8), sonst legt der Browser-Speicher Ordner mit Umlauten nicht an.
// Prüft den Knopf "Fotos exportieren" in der Tagesansicht: Ordner schreiben (über den Browser-Dateispeicher OPFS
// statt eines echten Laufwerks) und ZIP-Weg. Aufruf: node e2e/foto-export-check.cjs  (Testfotos: /tmp/spur-test-photo-0..2.jpg)
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
let srv;
const DIR = '/tmp/spur-e2e-foto';
(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  srv = spawn('node', ['--no-warnings', path.join(__dirname, '..', 'server', 'src', 'index.js')], { env: { ...process.env, SPUR_DATA_DIR: DIR, PORT: '3114' }, stdio: 'ignore' });
  for (let i = 0; i < 60 && !fs.existsSync(DIR + '/erster-zugang.txt'); i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 500));
  const base = 'http://127.0.0.1:3114';
  const adminCode = fs.readFileSync(DIR + '/erster-zugang.txt', 'utf8').match(/: ([A-Z0-9-]+)/)[1];
  const j = async (p, body, token) => (await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
  const admin = await j('/api/login', { code: adminCode });
  const lili = await j('/api/sites', { name: 'Lilienstraße', lat: 48.12, lng: 11.6 }, admin.token);
  const tut = await j('/api/sites', { name: 'Tutzing', lat: 47.9, lng: 11.28 }, admin.token);
  const me = await j('/api/me', null, admin.token);
  const now = new Date();
  const T = (h, m, s) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, s).getTime();
  const day = await j('/api/days', { client_id: 'e2e-foto-day-1', started_at: T(7, 0, 0), ended_at: T(16, 0, 0) }, admin.token);
  await j(`/api/days/${day.id}/segments`, { segments: [
    { client_id: 'seg-foto-0001', site_id: lili.id, kind: 'work', started_at: T(8, 0, 0), ended_at: T(12, 0, 0), source: 'manual' },
    { client_id: 'seg-foto-0002', site_id: tut.id, kind: 'work', started_at: T(13, 0, 0), ended_at: T(15, 0, 0), source: 'manual' } ] }, admin.token);
  const shots = [[10, 42, 13, lili.id, 0], [10, 42, 13, lili.id, 1], [10, 50, 0, lili.id, 2], [13, 30, 0, null, 0]];
  const sizes = [];
  for (let i = 0; i < shots.length; i++) {
    const [h, m, s, site, f] = shots[i];
    const body = fs.readFileSync(`/tmp/spur-test-photo-${f}.jpg`);
    sizes.push(body.length);
    const headers = { 'Content-Type': 'image/jpeg', Authorization: 'Bearer ' + admin.token, 'x-client-id': 'photo-e2e-' + (1000 + i), 'x-taken-at': String(T(h, m, s)) };
    if (site) headers['x-site-id'] = String(site);
    const r = await fetch(base + '/api/photos', { method: 'POST', headers, body });
    if (r.status !== 201) throw new Error('Foto-Upload: ' + r.status);
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
  // Ersatz für den Ordner-Auswahldialog: ein Ordner im Browser-Dateispeicher, darin schon ein Baustellen-Ordner "Lilienstraße 12"
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      const top = await root.getDirectoryHandle('Laufende Baustellen', { create: true });
      await top.getDirectoryHandle('Lilienstraße 12', { create: true });
      return top;
    };
  });
  await page.goto(base + '/');
  await page.fill('#code', adminCode); await page.click('#login-form button');
  await page.waitForSelector('table');
  await page.goto(base + `/#/mitarbeiter/${me.id}`);
  await page.waitForSelector('#foto-export');
  console.log('Knopf:', (await page.textContent('#foto-export')).trim());
  await page.click('#foto-export');
  await page.waitForSelector('#fx-site');
  console.log('Auswahl:', (await page.locator('#fx-site option').allInnerTexts()).join(' | '));
  await page.selectOption('#fx-site', 'Lilienstraße');
  await page.screenshot({ path: DIR + '/dialog.png' });
  await page.click('button:has-text("In den Ordner speichern")');
  await page.waitForSelector('text=Fertig:');
  const msg = (await page.locator('dialog p.hint').first().textContent());
  console.log('Meldung:', (await page.locator('dialog').innerText()).split('\n').find((l) => l.startsWith('Fertig')));

  const listing = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const out = {};
    const walk = async (dir, prefix) => {
      for await (const e of dir.values()) {
        if (e.kind === 'directory') { out[prefix + e.name + '/'] = { size: 0, text: null }; await walk(e, prefix + e.name + '/'); }
        else { const f = await e.getFile(); out[prefix + e.name] = { size: f.size, text: e.name.endsWith('.csv') ? await f.text() : null }; }
      }
    };
    await walk(root, '');
    return out;
  });
  const names = Object.keys(listing).sort();
  console.log(names.join('\n'));
  const dstr = (() => { const d = now; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const folder = `Laufende Baustellen/Lilienstraße 12/Fotos/Spur ${dstr}/`;
  const expect = [`${dstr}_10-42-13_Lilienstrasse.jpg`, `${dstr}_10-42-13_Lilienstrasse_2.jpg`, `${dstr}_10-50-00_Lilienstrasse.jpg`, 'fotos.csv'].map((n) => folder + n);
  if (JSON.stringify(names.filter((n) => n.startsWith('Laufende') && !n.endsWith('/'))) !== JSON.stringify(expect.sort())) throw new Error('Dateien stimmen nicht: ' + JSON.stringify(names));
  if (names.some((n) => n.includes('Tutzing')) || names.filter((n) => n.endsWith('/')).length !== 4) throw new Error('Andere Baustelle mit exportiert');
  if (listing[folder + `${dstr}_10-50-00_Lilienstrasse.jpg`].size !== sizes[2]) throw new Error('Foto wurde verändert');
  const csv = listing[folder + 'fotos.csv'].text.trimEnd().split('\r\n');
  console.log(csv.join('\n'));
  if (csv.length !== 4 || csv[0] !== 'Datei;Datum;Uhrzeit;Baustelle;Mitarbeiter;Notiz') throw new Error('CSV falsch');
  if (!csv[1].includes(';10:42:13;Lilienstraße;') || !csv[3].includes(';10:50:00;')) throw new Error('CSV Zeiten falsch');
  console.log('Ordner-Export: ok (vorhandener Ordner "Lilienstraße 12" benutzt, Größe unverändert)');

  // Zweiter Lauf: nichts doppelt, nichts überschrieben
  await page.click('button:has-text("In den Ordner speichern")');
  await page.waitForFunction(() => /3 lagen schon da/.test(document.querySelector('dialog').innerText));
  console.log('Zweiter Lauf:', (await page.locator('dialog').innerText()).split('\n').find((l) => l.startsWith('Fertig')));

  // ZIP für alle Baustellen
  await page.selectOption('#fx-site', '');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Als ZIP laden")')]);
  const zp = DIR + '/' + dl.suggestedFilename();
  await dl.saveAs(zp);
  const listZip = execFileSync('python3', ['-I', '-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("\\n".join(sorted(z.namelist())))', zp]).toString().trim().split('\n');
  console.log(dl.suggestedFilename() + ':\n' + listZip.join('\n'));
  if (listZip.length !== 6 || !listZip.some((n) => n.startsWith('Tutzing/Fotos/Spur ') && n.endsWith('fotos.csv'))) throw new Error('ZIP falsch');
  console.log('ZIP: ok');
  console.log('Probleme:', problems.length ? problems : 'keine');
  await browser.close(); srv.kill();
})().catch((e) => { console.error('FEHLER', e); srv && srv.kill(); process.exit(1); });
