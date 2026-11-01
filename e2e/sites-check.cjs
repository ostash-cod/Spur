const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
let srv;
(async () => {
  fs.rmSync('/tmp/spur-e2e3', { recursive: true, force: true });
  srv = spawn('node', ['--no-warnings', '/home/claude/spur/server/src/index.js'], { env: { ...process.env, SPUR_DATA_DIR: '/tmp/spur-e2e3', PORT: '3113' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const base = 'http://127.0.0.1:3113';
  const code = fs.readFileSync('/tmp/spur-e2e3/erster-zugang.txt', 'utf8').match(/: ([A-Z0-9-]+)/)[1];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.goto(base + '/');
  await page.fill('#code', code); await page.click('#login-form button');
  await page.waitForSelector('table');
  await page.click('a[data-page=kunden]');
  await page.waitForSelector('text=Noch keine Baustelle angelegt');

  // Kunde anlegen
  await page.click('button:has-text("Neuer Kunde")');
  await page.fill('#c-name2', 'WEG Lilienstraße'); await page.fill('#c-mail', 'verwaltung@example.org'); await page.fill('#c-rate', '55,5');
  await page.click('dialog button.primary');
  await page.waitForSelector('td:has-text("55,5 €/h")');
  console.log('Kunde angelegt: ok');

  // Baustelle mit Koordinaten von Hand
  await page.click('button:has-text("Neue Baustelle")');
  await page.fill('#s-name', 'Lilienstraße 77'); await page.selectOption('#s-cust', { label: 'WEG Lilienstraße' });
  await page.fill('#s-addr', 'Lilienstraße 77, 81669 München');
  await page.click('button:has-text("Koordinaten suchen")');
  await page.waitForSelector('dialog .error:not(:empty)');
  console.log('Adresssuche ohne Internet ->', (await page.textContent('dialog .error')).slice(0, 70));
  await page.fill('#s-lat', '48,1234'); await page.fill('#s-lng', '11,6012');
  await page.click('dialog button.primary');
  await page.waitForSelector('td strong:has-text("Lilienstraße 77")');
  const row = page.locator('tbody tr', { hasText: 'Lilienstraße 77' }).first();
  console.log('Zeile:', (await row.innerText()).replace(/\s+/g, ' ').slice(0, 120));

  // Zweite Baustelle ohne Koordinaten, andere Farbe automatisch
  await page.click('button:has-text("Neue Baustelle")');
  await page.fill('#s-name', 'Tutzing'); await page.click('dialog button.primary');
  await page.waitForSelector('td strong:has-text("Tutzing")');
  const dots = await page.$$eval('td .dot', (els) => els.map((e) => e.style.background));
  console.log('Farben:', dots.join(' | '), '→ verschieden:', new Set(dots).size === dots.length);
  console.log('Warnung ohne Koordinaten:', await page.locator('.warn').count());
  await page.screenshot({ path: '/tmp/spur-e2e3/kunden.png', fullPage: true });

  // Bearbeiten: Farbe wählen, Radius
  await page.locator('tbody tr', { hasText: 'Tutzing' }).locator('button:has-text("Bearbeiten")').click();
  await page.click('.swatch[aria-label="Farbe #FB8C00"]'); await page.fill('#s-rad', '150');
  await page.fill('#s-lat', '47,9'); await page.fill('#s-lng', '11,28');
  await page.click('dialog button.primary');
  await page.waitForSelector('tbody tr:has-text("Tutzing"):has-text("150 m")');
  console.log('Bearbeitet: ok');

  // Archivieren und wieder anzeigen
  await page.locator('tbody tr', { hasText: 'Tutzing' }).locator('button:has-text("Archivieren")').click();
  await page.waitForFunction(() => !document.body.innerText.includes('Tutzing'));
  await page.check('text=Archivierte anzeigen >> input, label:has-text("Archivierte anzeigen") input');
  await page.waitForSelector('tr.inaktiv:has-text("Tutzing")');
  console.log('Archiv: ok');

  // Die Handy-API liefert nur aktive, nicht archivierte Baustellen
  const tok = (await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).json()).token;
  const sites = await (await fetch(base + '/api/sites', { headers: { Authorization: 'Bearer ' + tok } })).json();
  console.log('Für das Handy:', sites.map((s) => `${s.name} (${s.color}, ${s.radius_m} m)`).join('; '));
  console.log('Probleme:', problems.length ? problems : 'keine');
  await browser.close(); srv.kill();
})().catch((e) => { console.error('FEHLER', e); srv && srv.kill(); process.exit(1); });
