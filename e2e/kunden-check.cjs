// Kunden wie in LexOffice: Firma und Privatperson anlegen, suchen, Baustelle am Kunden anlegen.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const DATA = '/tmp/spur-e2e-kunden';
let srv;
(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  srv = spawn('node', ['--no-warnings', path.join(__dirname, '..', 'server', 'src', 'index.js')], { env: { ...process.env, SPUR_DATA_DIR: DATA, PORT: '3119' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const base = 'http://127.0.0.1:3119';
  const code = fs.readFileSync(`${DATA}/erster-zugang.txt`, 'utf8').match(/: ([A-Z0-9-]+)/)[1];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto(base + '/');
  await page.fill('#code', code); await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');
  await page.goto(base + '/#/kunden');
  await page.waitForSelector('h2:has-text("Kunden")');
  const order = await page.locator('.card h2').allInnerTexts();
  if (!order[0].startsWith('Kunden')) throw new Error('Kunden stehen nicht oben: ' + order.join(' | '));

  // Firma
  await page.click('button:has-text("Neuer Kunde")');
  await page.waitForFunction(() => document.getElementById('k-nr').value === '10000');
  await page.fill('#k-firma', 'Hausverwaltung Berg GmbH');
  await page.fill('#k-ansprech', 'Frau Huber');
  await page.fill('#k-strasse', 'Hauptstraße 1');
  await page.fill('#k-plz', '82343');
  await page.fill('#k-ort', 'Pöcking');
  await page.fill('#k-tel', '08157 123');
  await page.fill('#k-mail', 'info@example.org');
  await page.fill('#k-satz', '55');
  await page.screenshot({ path: `${DATA}/1-firma.png` });
  await page.click('dialog button:has-text("Speichern")');
  await page.waitForSelector('td:has-text("Hausverwaltung Berg GmbH")');

  // Privatperson
  await page.click('button:has-text("Neuer Kunde")');
  await page.click('dialog button:has-text("Privatperson")');
  if (await page.isVisible('#k-firma')) throw new Error('Firmenfeld bei Privatperson sichtbar');
  await page.selectOption('#k-anrede', 'Frau');
  await page.fill('#k-vorname', 'Anna');
  await page.fill('#k-nachname', 'Schröder');
  await page.fill('#k-strasse', 'Seestraße 5');
  await page.fill('#k-plz', '82319');
  await page.fill('#k-ort', 'Starnberg');
  const nr = await page.inputValue('#k-nr');
  await page.click('dialog button:has-text("Speichern")');
  await page.waitForSelector('td:has-text("Anna Schröder")');
  console.log('Kundennummer Privatperson:', nr);

  // Fehler: doppelte Kundennummer
  await page.click('button:has-text("Neuer Kunde")');
  await page.waitForFunction(() => document.getElementById('k-nr').value !== '');
  await page.fill('#k-firma', 'Doppelt GmbH');
  await page.fill('#k-nr', '10000');
  await page.click('dialog button:has-text("Speichern")');
  await page.waitForFunction(() => document.querySelector('dialog .error').textContent.includes('gibt es schon'));
  console.log('Doppelte Nummer:', await page.textContent('dialog .error'));
  await page.click('dialog button:has-text("Abbrechen")');

  // Suche
  await page.fill('input[type=search]', 'starnberg');
  const visible = await page.locator('.card').first().locator('tbody tr:visible td:nth-child(2) strong').allInnerTexts();
  if (visible.join() !== 'Anna Schröder') throw new Error('Suche falsch: ' + visible);
  await page.fill('input[type=search]', '');

  // Baustelle am Kunden
  const row = page.locator('tr', { hasText: 'Anna Schröder' });
  await row.locator('button:has-text("+ Baustelle")').click();
  const chosen = await page.$eval('#s-cust', (s) => s.options[s.selectedIndex].text);
  const addr = await page.inputValue('#s-addr');
  console.log('Neue Baustelle: Kunde =', chosen, '| Adresse =', addr);
  if (chosen !== 'Anna Schröder' || addr !== 'Seestraße 5, 82319 Starnberg') throw new Error('Baustelle nicht vorausgefüllt');
  await page.fill('#s-name', 'Bad Schröder');
  await page.fill('#s-lat', '47,99'); await page.fill('#s-lng', '11,34');
  await page.click('dialog button:has-text("Speichern")');
  await page.waitForSelector('td:has-text("Bad Schröder")');
  const count = await page.locator('tr', { hasText: 'Anna Schröder' }).first().locator('td:nth-child(6)').innerText();
  console.log('Baustellen bei Anna Schröder:', count);

  // Bearbeiten: Felder kommen zurück
  await page.locator('tr', { hasText: 'Hausverwaltung Berg' }).locator('button:has-text("Bearbeiten")').click();
  console.log('Bearbeiten:', await page.inputValue('#k-firma'), '|', await page.inputValue('#k-plz'), await page.inputValue('#k-ort'));
  await page.click('dialog button:has-text("Abbrechen")');
  await page.screenshot({ path: `${DATA}/2-liste.png`, fullPage: true });
  console.log('Probleme:', problems.length ? problems : 'keine');
  await browser.close(); srv.kill();
})().catch((e) => { console.error('FEHLER', e); srv && srv.kill(); process.exit(1); });
