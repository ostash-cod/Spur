// Wochenansicht: Blöcke, Notiz auf dem Block, Betrag, abgegeben, Mitarbeiter wechseln, Notiz ändern.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const DATA = '/tmp/spur-e2e-woche';
let srv;
(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  srv = spawn('node', ['--no-warnings', path.join(__dirname, '..', 'server', 'src', 'index.js')], { env: { ...process.env, SPUR_DATA_DIR: DATA, PORT: '3121' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const base = 'http://127.0.0.1:3121';
  const adminCode = fs.readFileSync(`${DATA}/erster-zugang.txt`, 'utf8').match(/: ([A-Z0-9-]+)/)[1];
  const call = async (method, p, body, token, headers = {}) => {
    const res = await fetch(base + p, { method, headers: { ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...(Buffer.isBuffer(body) ? { 'Content-Type': 'image/jpeg' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: Buffer.isBuffer(body) ? body : body ? JSON.stringify(body) : undefined });
    const t = await res.text(); try { return JSON.parse(t); } catch { return t; }
  };
  const admin = await call('POST', '/api/login', { code: adminCode });
  const serhii = await call('POST', '/api/users', { name: 'Serhii Sokolik', language: 'uk' }, admin.token);
  await call('POST', '/api/users', { name: 'Mykhaylo Yatsyshyn', language: 'ru' }, admin.token);
  const st = (await call('POST', '/api/login', { code: serhii.code })).token;
  const cust = await call('POST', '/api/customers', { kind: 'firma', company: 'WEG Lilienstraße', hourly_rate: 60 }, admin.token);
  const site = await call('POST', '/api/sites', { name: 'Lilienstraße 77', customer_id: cust.id, lat: 48.12, lng: 11.6 }, admin.token);
  const krug = await call('POST', '/api/sites', { name: 'Tobias Krug', lat: 48.1, lng: 11.5, color: '#D81B60' }, admin.token);

  // Montag und Mittwoch dieser Woche
  const now = new Date(); const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const T = (dayOff, h, m) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + dayOff, h, m).getTime();
  const ds = (off) => { const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const d1 = await call('POST', '/api/days', { client_id: 'woche-mo-0001', started_at: T(0, 7, 10), ended_at: T(0, 15, 30) }, st);
  await call('POST', `/api/days/${d1.id}/segments`, { segments: [
    { client_id: 'w-mo-seg-0001', site_id: site.id, kind: 'work', started_at: T(0, 7, 40), ended_at: T(0, 12, 0), source: 'auto' },
    { client_id: 'w-mo-seg-0002', site_id: null, kind: 'break', started_at: T(0, 12, 0), ended_at: T(0, 12, 30), source: 'manual' },
    { client_id: 'w-mo-seg-0003', site_id: site.id, kind: 'work', started_at: T(0, 12, 30), ended_at: T(0, 15, 21), source: 'auto' } ] }, st);
  const d3 = await call('POST', '/api/days', { client_id: 'woche-mi-0001', started_at: T(2, 8, 0), ended_at: T(2, 16, 0) }, st);
  await call('POST', `/api/days/${d3.id}/segments`, { segments: [
    { client_id: 'w-mi-seg-0001', site_id: site.id, kind: 'work', started_at: T(2, 8, 20), ended_at: T(2, 11, 0), source: 'auto' },
    { client_id: 'w-mi-seg-0002', site_id: krug.id, kind: 'work', started_at: T(2, 11, 20), ended_at: T(2, 12, 0), source: 'auto' },
    { client_id: 'w-mi-seg-0003', site_id: site.id, kind: 'work', started_at: T(2, 12, 20), ended_at: T(2, 16, 0), source: 'auto' } ] }, st);
  await call('POST', '/api/notes', { client_id: 'w-note-00001', date: ds(0), site_id: site.id, text: 'Wand im Schlafzimmer vorbehandelt.\n- Leibungen bearbeitet\n- Eckschienen gesetzt' }, st);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);
  await call('POST', '/api/photos', jpeg, st, { 'x-client-id': 'w-photo-0001', 'x-taken-at': String(T(0, 9, 0)), 'x-site-id': String(site.id) });
  await call('POST', '/api/sheets', { date: ds(0), start: T(0, 7, 10), end: T(0, 15, 30), pause_min: 30, lines: [] }, st);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && problems.push('console: ' + m.text()));
  await page.goto(base + '/');
  await page.fill('#code', adminCode); await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');
  await page.click('a[data-page=woche]');
  await page.waitForSelector('.wgrid');
  await page.selectOption('.wuser', { label: 'Serhii Sokolik' });
  await page.waitForSelector('.wblock');
  console.log('Kopf:', (await page.textContent('.whead h1')).trim(), '| Mitarbeiter:', await page.$eval('.wuser', (s) => s.options[s.selectedIndex].text));
  if (await page.$eval('.wuser', (s) => s.options[s.selectedIndex].text) !== 'Serhii Sokolik') throw new Error('Falscher Mitarbeiter vorausgewählt');
  const blocks = await page.locator('.wblock').count();
  console.log('Blöcke:', blocks);
  const noteOnBlock = await page.locator('.wblock .wnote').first().innerText();
  if (!noteOnBlock.includes('Leibungen bearbeitet')) throw new Error('Notiz fehlt auf dem Block');
  const cams = await page.locator('.wblock .wfoot span:has-text("📷")').count();
  console.log('Notiz auf dem Block: ok', '| Foto-Zeichen:', cams);
  if (cams !== 1) throw new Error('Foto soll genau auf einem Block stehen');
  const foot = (await page.locator('.wfootday').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  console.log('Montag:', foot[0], '| Mittwoch:', foot[2]);
  if (!foot[0].includes('abgegeben ✓') || !foot[2].includes('noch nicht abgegeben')) throw new Error('Abgegeben-Hinweis falsch');
  if (!foot[0].includes('7:50 h')) throw new Error('Montag Stunden falsch (erwartet 7:50 h ohne Pause): ' + foot[0]);
  console.log('Woche:', (await page.innerText('.wsum')).replace(/\s+/g, ' '));
  await page.screenshot({ path: `${DATA}/woche.png` });

  // Block anklicken, Notiz ändern
  await page.locator('.wblock', { hasText: 'Leibungen bearbeitet' }).click();
  await page.waitForSelector('dialog textarea');
  console.log('Fenster:', (await page.innerText('dialog')).split('\n').slice(0, 4).join(' | '));
  await page.waitForSelector('dialog img[src^="blob:"]');
  await page.screenshot({ path: `${DATA}/fenster.png` });
  await page.fill('dialog textarea', 'Wand im Schlafzimmer vorbehandelt und aufgeräumt.');
  await page.click('dialog button:has-text("Notiz speichern")');
  await page.waitForSelector('.wblock .wnote:has-text("aufgeräumt")');
  console.log('Notiz geändert: ok');

  // Mitarbeiter wechseln und Woche blättern
  await page.selectOption('.wuser', { label: 'Mykhaylo Yatsyshyn' });
  await page.waitForFunction(() => location.hash.includes('/woche/') && document.querySelectorAll('.wblock').length === 0);
  console.log('Wechsel zu Mykhaylo: keine Blöcke, ok');
  const kwBefore = await page.textContent('.whead h1');
  await page.click('button[aria-label="Woche zurück"]');
  await page.waitForFunction((k) => document.querySelector('.whead h1')?.textContent !== k, kwBefore);
  console.log('Zurück:', (await page.textContent('.whead h1')).trim());
  console.log('Probleme:', problems.length ? problems : 'keine');
  await browser.close(); srv.kill();
  if (problems.length) process.exit(1);
})().catch((e) => { console.error('FEHLER', e); srv && srv.kill(); process.exit(1); });
