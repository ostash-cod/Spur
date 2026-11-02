const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
let srv;
(async () => {
  fs.rmSync('/tmp/spur-e2e5', { recursive: true, force: true });
  srv = spawn('node', ['--no-warnings', '/home/claude/spur/server/src/index.js'], { env: { ...process.env, SPUR_DATA_DIR: '/tmp/spur-e2e5', PORT: '3116' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const base = 'http://127.0.0.1:3116';
  const adminCode = fs.readFileSync('/tmp/spur-e2e5/erster-zugang.txt', 'utf8').match(/: ([A-Z0-9-]+)/)[1];
  const j = async (path, body, token, method) => (await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
  const admin = await j('/api/login', { code: adminCode });
  const created = await j('/api/users', { name: 'Mykhaylo', language: 'ru', uses_private_car: true }, admin.token);
  const worker = await j('/api/login', { code: created.code });
  const now = new Date(); const T = (h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
  const day = await j('/api/days', { client_id: 'e2e-trip-0001', started_at: T(7, 0), ended_at: T(16, 0) }, worker.token);
  const lil = await j('/api/sites', { name: 'Lilienstraße 77', lat: 48.12, lng: 11.6 }, admin.token);
  const tut = await j('/api/sites', { name: 'Tutzing', lat: 47.9, lng: 11.28 }, admin.token);
  const bri = await j('/api/sites', { name: 'Brillux', kind: 'haendler', lat: 48.0, lng: 11.5 }, worker.token);
  console.log('Händler angelegt vom Mitarbeiter:', bri.kind);
  await j(`/api/days/${day.id}/segments`, { segments: [
    { client_id: 'seg-trip-0001', site_id: lil.id, kind: 'work', started_at: T(7, 30), ended_at: T(10, 0), source: 'auto' },
    { client_id: 'seg-trip-0002', site_id: bri.id, kind: 'work', started_at: T(10, 25), ended_at: T(10, 45), source: 'auto' },
    { client_id: 'seg-trip-0003', site_id: lil.id, kind: 'work', started_at: T(11, 10), ended_at: T(13, 0), source: 'auto' },
    { client_id: 'seg-trip-0004', site_id: tut.id, kind: 'work', started_at: T(13, 40), ended_at: T(15, 30), source: 'auto' } ] }, worker.token);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
  await page.goto(base + '/');
  await page.fill('#code', adminCode); await page.click('#login-form button'); await page.waitForSelector('table');
  // Händler-Liste
  await page.click('a[data-page=kunden]'); await page.waitForSelector('h2:has-text("Händler")');
  console.log('Händler in der Liste:', (await page.locator('.card', { hasText: 'Händler (Baumarkt' }).locator('tbody tr').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ')).join(' | '));
  await page.click('button:has-text("Neuer Händler")'); await page.waitForSelector('dialog[open] h2:has-text("Neuer Händler")');
  console.log('Händler-Dialog ohne Kunde:', (await page.locator('dialog[open] #s-cust').count()) === 0);
  await page.click('dialog[open] button:has-text("Abbrechen")');

  await page.click('a[data-page=mitarbeiter]'); await page.click('a[href^="#/mitarbeiter/"]:has-text("Mykhaylo")'); await page.waitForSelector('.timeline .block');
  const stripes = async () => page.locator('.timeline .block.striped').count();
  console.log('Streifen-Blöcke (automatisch):', await stripes(), '| Texte:', (await page.locator('.timeline .block.striped').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ')).join(' | '));
  await page.screenshot({ path: '/tmp/spur-e2e5/tag1.png', fullPage: true });
  // Klick auf die erste gestreifte Fahrt -> normale Fahrt
  await page.locator('.timeline .block.striped').first().click();
  await page.waitForSelector('dialog[open] h2:has-text("Fahrt ändern")');
  console.log('Dialog-Text:', (await page.textContent('dialog[open] .hint')).trim());
  await page.click('dialog[open] button:has-text("Normale Fahrt")');
  await page.waitForFunction(() => document.querySelectorAll('.timeline .block.striped').length === 0);
  console.log('Streifen nach „Normale Fahrt“:', await stripes());
  // Die Fahrt Lilienstraße -> Tutzing (keine Streifen) als Materialfahrt für Tutzing
  const travel = page.locator('.timeline .block.travel', { hasText: 'Fahrt' }).last();
  await travel.click(); await page.waitForSelector('dialog[open] h2:has-text("Fahrt ändern")');
  await page.selectOption('#trip-site', { label: 'Tutzing' });
  await page.click('dialog[open] button:has-text("Als Materialfahrt speichern")');
  await page.waitForFunction(() => document.querySelectorAll('.timeline .block.striped').length > 0);
  console.log('Streifen nach Zuordnung zu Tutzing:', (await page.locator('.timeline .block.striped').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ')).join(' | '));
  // zurück auf automatisch für die erste Gruppe
  await page.screenshot({ path: '/tmp/spur-e2e5/tag2.png', fullPage: true });
  console.log('Probleme:', problems.length ? problems : 'keine');
  await browser.close(); srv.kill();
})().catch((e) => { console.error('FEHLER', e.message.slice(0, 400)); srv && srv.kill(); process.exit(1); });
