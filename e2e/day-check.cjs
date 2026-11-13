const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
let srv;
(async () => {
  fs.rmSync('/tmp/spur-e2e2', { recursive: true, force: true });
  srv = spawn('node', ['--no-warnings', require('node:path').join(__dirname, '..', 'server', 'src', 'index.js')], { env: { ...process.env, SPUR_DATA_DIR: '/tmp/spur-e2e2', PORT: '3112' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const base = 'http://127.0.0.1:3112';
  const adminCode = fs.readFileSync('/tmp/spur-e2e2/erster-zugang.txt', 'utf8').match(/: ([A-Z0-9-]+)/)[1];
  const j = async (path, body, token) => (await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();

  const admin = await j('/api/login', { code: adminCode });
  const created = await j('/api/users', { name: 'Mykhaylo', language: 'ru', uses_private_car: true }, admin.token);
  const worker = await j('/api/login', { code: created.code });

  // Ein Tag wie vom Handy: heute 07:00 bis 15:30 (Ortszeit des Browsers), Weg von der Firma nach München
  const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 30).getTime();
  const day = await j('/api/days', { client_id: 'e2e-test-0001', started_at: start, ended_at: end }, worker.token);
  const points = [];
  for (let i = 0; i <= 60; i++) points.push({ ts: start + i * 15000, lat: 47.9667 + i * 0.0021 + Math.sin(i / 6) * 0.002, lng: 11.3167 + i * 0.0032, acc: 6 });
  const added = await j(`/api/days/${day.id}/points`, { points }, worker.token);
  // Variante C: Der Server nimmt die Punkte eines Mitarbeiters nicht an.
  if (added.added !== 0 || added.dropped !== points.length) throw new Error('Server hat Rohpunkte gespeichert: ' + JSON.stringify(added));
  console.log('Punkte vom Server verworfen:', added.dropped);
  const s1 = await j('/api/sites', { name: 'Lilienstraße 77', lat: 48.12, lng: 11.6, customer_id: null }, admin.token);
  const s2 = await j('/api/sites', { name: 'Tutzing', lat: 47.9, lng: 11.28 }, admin.token);
  const sysSites = await j('/api/sites?all=1', null, admin.token);
  const lagerId = sysSites.find((s) => s.system === 'lager').id;
  const firmaId = sysSites.find((s) => s.system === 'firma').id;
  const T = (h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
  const seg = await j(`/api/days/${day.id}/segments`, { segments: [
    { client_id: 'seg-aaaa-0000', site_id: firmaId, kind: 'work', started_at: T(7, 0), ended_at: T(7, 20), source: 'auto' },
    { client_id: 'seg-aaaa-0001', site_id: s1.id, kind: 'work', started_at: T(7, 55), ended_at: T(11, 30), source: 'auto' },
    { client_id: 'seg-aaaa-0002', site_id: lagerId, kind: 'work', started_at: T(11, 50), ended_at: T(11, 58), source: 'auto' },
    { client_id: 'seg-aaaa-0003', site_id: s2.id, kind: 'work', started_at: T(12, 30), ended_at: T(15, 40), source: 'manual' } ] }, worker.token);
  console.log('Abschnitte gespeichert:', seg.saved);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
  await page.goto(base + '/');
  await page.fill('#code', adminCode); await page.click('#login-form button');
  await page.waitForSelector('table');
  await page.click('a[href^="#/mitarbeiter/"]:has-text("Mykhaylo")');
  await page.waitForSelector('.timeline .block');
  console.log('Überschrift:', await page.textContent('h1'));
  console.log('Karte:', (await page.textContent('.card h2')).trim());
  console.log('Abschnitte am Desktop:', (await page.locator('.card table tbody tr').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ')).join(' | '));
  if (await page.locator('summary:has-text("Gefahrener Weg")').count()) throw new Error('Karte ohne Testmodus sichtbar');
  if (await page.locator('text=GPS-Punkte').count()) throw new Error('Zahl der GPS-Punkte ohne Testmodus sichtbar');
  console.log('Keine Karte, keine Punktzahl: ok');
  await page.screenshot({ path: '/tmp/spur-e2e2/tag.png', fullPage: true });

  // Testmodus des Chefs: Sein eigener Tag zeigt die Karte.
  const meAdmin = await j('/api/me', null, admin.token);
  await fetch(base + '/api/users/' + meAdmin.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin.token }, body: JSON.stringify({ gps_test: true }) });
  const aday = await j('/api/days', { client_id: 'e2e-chef-0001', started_at: start, ended_at: end }, admin.token);
  const aadd = await j(`/api/days/${aday.id}/points`, { points }, admin.token);
  if (aadd.added !== points.length) throw new Error('Testmodus speichert nicht: ' + JSON.stringify(aadd));
  await page.goto(base + `/#/mitarbeiter/${meAdmin.id}`);
  await page.click('summary:has-text("Gefahrener Weg")');
  await page.waitForSelector('svg.track');
  console.log('Testmodus Karte:', (await page.textContent('summary:has-text("Gefahrener Weg")')).trim());
  await page.goto(base + `/#/mitarbeiter/${created.user.id}`);
  await page.waitForSelector('.timeline .block');
  await page.click('text=← Vortag');
  await page.waitForSelector('text=An diesem Tag wurde nichts aufgezeichnet');
  console.log('Vortag leer: ok');
  console.log('Probleme:', problems.length ? problems : 'keine');
  await browser.close(); srv.kill();
})().catch((e) => { console.error('FEHLER', e); srv && srv.kill(); process.exit(1); });
