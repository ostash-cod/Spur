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
  await page.route('**/api/geocode*', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (/Nirgendwo/.test(q)) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { label: 'Lilienstraße 77, 81669 München', lat: 48.123456, lng: 11.601234 },
      { label: 'Lilienstraße 77, 12345 Anderswo', lat: 50.1, lng: 8.2 } ]) });
  });
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
  await page.click('#s-name'); // Adressfeld verlassen löst die Suche aus
  await page.waitForSelector('#s-found .ok');
  console.log('Automatisch gefunden:', (await page.textContent('#s-found .ok')).trim());
  console.log('Koordinaten gefüllt:', await page.inputValue('#s-lat'), await page.inputValue('#s-lng'));
  await page.click('#s-found button.result');
  console.log('Anderen Treffer gewählt:', await page.inputValue('#s-lat'));
  await page.fill('#s-lat', '48,1234'); await page.fill('#s-lng', '11,6012');
  await page.fill('#s-addr', 'Lilienstraße 77, 81669 München Nord'); await page.fill('#s-name', 'Lilienstraße 77'); await page.waitForTimeout(1600);
  console.log('Von Hand eingetragene Koordinaten bleiben:', await page.inputValue('#s-lat'));
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

  // Kunde mit gleichem Namen automatisch anlegen
  await page.click('button:has-text("Neue Baustelle")');
  await page.fill('#s-name', 'Familie Meier'); await page.fill('#s-addr', 'Dorfstraße 5, Pöcking');
  await page.check('#s-autocust');
  await page.click('dialog button.primary');
  await page.waitForSelector('td:has-text("Familie Meier")');
  console.log('Kunde automatisch angelegt:', (await page.locator('tbody tr', { hasText: 'Familie Meier' }).first().innerText()).replace(/\s+/g, ' ').slice(0, 80));

  // Adresse vom Kunden übernehmen
  await page.click('button:has-text("Neuer Kunde")');
  await page.fill('#c-name2', 'Hausverwaltung Schmidt'); await page.fill('#c-addr', 'Bürostraße 9, 80331 München');
  await page.click('dialog button.primary');
  await page.waitForSelector('td:has-text("Bürostraße 9")');
  await page.click('button:has-text("Neue Baustelle")');
  await page.fill('#s-name', 'Balkon Schmidt'); await page.selectOption('#s-cust', { label: 'Hausverwaltung Schmidt' });
  await page.click('button:has-text("Adresse vom Kunden übernehmen")');
  console.log('Adresse übernommen:', await page.inputValue('#s-addr'));
  await page.waitForSelector('#s-found .ok');
  await page.click('dialog button.primary');
  await page.waitForSelector('td strong:has-text("Balkon Schmidt")');

  // Nichts gefunden
  await page.click('button:has-text("Neue Baustelle")');
  await page.fill('#s-addr', 'Nirgendwo Straße 1'); await page.click('#s-name');
  await page.waitForSelector('#s-found .warn');
  console.log('Nichts gefunden:', (await page.textContent('#s-found .warn')).slice(0, 50));
  await page.click('dialog button:has-text("Abbrechen")');

  // Löschen: Kunde mit Baustelle ist gesperrt, danach erlaubt
  page.on('dialog', (d) => d.accept());
  const dialogs = [];
  page.on('dialog', (d) => dialogs.push(d.message()));
  // Archivieren und wieder anzeigen
  await page.locator('tbody tr', { hasText: 'Tutzing' }).locator('button:has-text("Archivieren")').click();
  await page.waitForFunction(() => !document.body.innerText.includes('Tutzing'));
  await page.check('text=Archivierte anzeigen >> input, label:has-text("Archivierte anzeigen") input');
  await page.waitForSelector('tr.inaktiv:has-text("Tutzing")');
  console.log('Archiv: ok');

  // Die Handy-API liefert nur aktive, nicht archivierte Baustellen
  const tok = (await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).json()).token;
  const sites = await (await fetch(base + '/api/sites', { headers: { Authorization: 'Bearer ' + tok } })).json();
  // Baustelle ohne Zeiten löschen
  await page.locator('tbody tr', { hasText: 'Balkon Schmidt' }).locator('button:has-text("Löschen")').click();
  await page.waitForFunction(() => !document.body.innerText.includes('Balkon Schmidt'));
  // Kunde ohne Baustellen löschen
  await page.locator('tbody tr', { hasText: 'Hausverwaltung Schmidt' }).locator('button:has-text("Löschen")').click();
  await page.waitForFunction(() => !document.body.innerText.includes('Hausverwaltung Schmidt'));
  console.log('Löschen: ok (Dialoge:', dialogs.length, ')');
  console.log('Für das Handy:', sites.map((s) => `${s.name} (${s.color}, ${s.radius_m} m)`).join('; '));
  console.log('Probleme:', problems.length ? problems : 'keine');
  await browser.close(); srv.kill();
})().catch((e) => { console.error('FEHLER', e); srv && srv.kill(); process.exit(1); });
