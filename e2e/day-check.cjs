const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
let srv;
(async () => {
  fs.rmSync('/tmp/spur-e2e2', { recursive: true, force: true });
  srv = spawn('node', ['--no-warnings', '/home/claude/spur/server/src/index.js'], { env: { ...process.env, SPUR_DATA_DIR: '/tmp/spur-e2e2', PORT: '3112' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const base = 'http://127.0.0.1:3112';
  const adminCode = fs.readFileSync('/tmp/spur-e2e2/erster-zugang.txt', 'utf8').match(/: ([A-Z0-9-]+)/)[1];
  const j = async (path, body, token) => (await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();

  const admin = await j('/api/login', { code: adminCode });
  const created = await j('/api/users', { name: 'Mykhaylo', language: 'ru', uses_private_car: true }, admin.token);
  const worker = await j('/api/login', { code: created.code });

  // Ein Tag wie vom Handy: heute 07:00 bis 15:30 (Ortszeit des Browsers), Weg von der Firma nach München
  const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 30).getTime();
  const day = await j('/api/days', { client_id: 'e2e-test-0001', started_at: start, ended_at: end }, worker.token);
  const points = [];
  for (let i = 0; i <= 60; i++) points.push({ ts: start + i * 15000, lat: 47.9667 + i * 0.0021 + Math.sin(i / 6) * 0.002, lng: 11.3167 + i * 0.0032, acc: 6 });
  const added = await j(`/api/days/${day.id}/points`, { points }, worker.token);
  console.log('Punkte gespeichert:', added.added);
  const s1 = await j('/api/sites', { name: 'Lilienstraße 77', lat: 48.12, lng: 11.6 }, admin.token);
  const s2 = await j('/api/sites', { name: 'Tutzing', lat: 47.9, lng: 11.28 }, admin.token);
  const seg = await j(`/api/days/${day.id}/segments`, { segments: [
    { client_id: 'seg-aaaa-0001', site_id: s1.id, kind: 'work', started_at: start + 30 * 60000, ended_at: start + 4 * 3600000, source: 'manual' },
    { client_id: 'seg-aaaa-0002', site_id: s2.id, kind: 'work', started_at: start + 4.5 * 3600000, ended_at: null, source: 'manual' } ] }, worker.token);
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
  await page.waitForSelector('svg.track');
  console.log('Überschrift:', await page.textContent('h1'));
  console.log('Karte:', (await page.textContent('.card h2')).trim());
  console.log('Hinweis:', (await page.textContent('.card .hint')).trim());
  console.log('Abschnitte am Desktop:', (await page.locator('.card table tbody tr').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ')).join(' | '));
  await page.screenshot({ path: '/tmp/spur-e2e2/tag.png' });
  await page.click('text=← Vortag');
  await page.waitForSelector('text=An diesem Tag wurde nichts aufgezeichnet');
  console.log('Vortag leer: ok');
  console.log('Probleme:', problems.length ? problems : 'keine');
  await browser.close(); srv.kill();
})().catch((e) => { console.error('FEHLER', e); srv && srv.kill(); process.exit(1); });
