const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
let srv;
(async () => {
  fs.rmSync('/tmp/spur-e2e4', { recursive: true, force: true });
  srv = spawn('node', ['--no-warnings', '/home/claude/spur/server/src/index.js'], { env: { ...process.env, SPUR_DATA_DIR: '/tmp/spur-e2e4', PORT: '3115' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const code = fs.readFileSync('/tmp/spur-e2e4/erster-zugang.txt', 'utf8').match(/: ([A-Z0-9-]+)/)[1];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route('**/api/maplink*', (r) => {
    const u = decodeURIComponent(new URL(r.request().url()).searchParams.get('url'));
    if (/kaputt/.test(u)) return r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'In diesem Link steht keine Position.' }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lat: 47.9655, lng: 11.3123 }) });
  });
  await page.route('**/api/geocode*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ label: 'Keltenstraße 31, 82343 Pöcking', lat: 47.965, lng: 11.312 }]) }));
  await page.goto('http://127.0.0.1:3115/');
  await page.fill('#code', code); await page.click('#login-form button'); await page.waitForSelector('table');
  await page.click('a[data-page=einstellungen]'); await page.waitForSelector('#firma-lat');

  // 1) Nur die Breite eintragen -> klare Meldung mit Namen
  await page.fill('#firma-lat', '47,965');
  await page.click('#main form button[type=submit]');
  await page.waitForSelector('[role=status].error');
  console.log('Nur Breite ->', await page.textContent('[role=status]'));

  // 2) Google-Maps-Text in die Breite einfügen -> beide Felder gefüllt
  await page.fill('#firma-lat', ''); await page.fill('#firma-lat', '47.96512, 11.31234');
  console.log('Aufgeteilt:', await page.inputValue('#firma-lat'), '|', await page.inputValue('#firma-lng'));

  // 2b) Deutsche Schreibweise mit Komma bleibt eine einzelne Zahl
  await page.fill('#firma-lng', ''); await page.fill('#firma-lat', '47,965');
  console.log('Deutsche Zahl bleibt:', await page.inputValue('#firma-lat'), '| Länge leer:', (await page.inputValue('#firma-lng')) === '');
  await page.fill('#firma-lat', '47,96512 11,31234');
  console.log('Deutsch mit Leerzeichen:', await page.inputValue('#firma-lat'), '|', await page.inputValue('#firma-lng'));

  // 2c) Google-Maps-Link ins Feld Breite einfügen
  await page.fill('#lager-lat', 'https://maps.app.goo.gl/MoHJRb1xH5keaX6U9');
  await page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('übernommen'));
  console.log('Link -> Lager:', await page.inputValue('#lager-lat'), '|', await page.inputValue('#lager-lng'));
  await page.fill('#lager-lat', 'https://maps.app.goo.gl/kaputt');
  await page.waitForSelector('[role=status].error');
  console.log('Link ohne Position ->', await page.textContent('[role=status]'));

  // 2d) Neues Feld „Position“: Google-Text und Link
  const pos = page.locator('#main .card', { hasText: 'Lager Pöcking' }).locator('input[placeholder^="Link oder"]');
  await pos.fill('47.96138, 11.30548');
  console.log('Position-Feld Koordinaten:', await page.inputValue('#lager-lat'), '|', await page.inputValue('#lager-lng'), '| Feld geleert:', (await pos.inputValue()) === '');
  await pos.fill('https://maps.app.goo.gl/MoHJRb1xH5keaX6U9');
  await page.waitForFunction(() => document.querySelector('#lager-lat').value === '47,9655');
  console.log('Position-Feld Link:', await page.inputValue('#lager-lat'), '|', await page.inputValue('#lager-lng'));
  console.log('Prüf-Link:', await page.locator('#main .card', { hasText: 'Lager Pöcking' }).locator('a:has-text("Google Maps")').getAttribute('href'));
  await pos.fill('Hallo Welt'); await pos.dispatchEvent('change');
  await page.waitForSelector('[role=status].error');
  console.log('Unsinn ->', await page.textContent('[role=status]'));

  // 3) Position aus der Adresse suchen
  await page.click('button:has-text("Position aus der Firmenadresse suchen")');
  await page.waitForSelector('[role=status].ok');
  console.log('Suche:', (await page.textContent('[role=status]')).trim().slice(0, 70), '|', await page.inputValue('#firma-lat'), await page.inputValue('#firma-lng'));

  // 4) Speichern klappt, Firma wird zum festen Ort
  await page.click('#main form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('[role=status]').textContent === 'Gespeichert.');
  await page.click('a[data-page=kunden]'); await page.waitForSelector('td strong:has-text("Firma")');
  const row = (await page.locator('tbody tr', { hasText: 'Firma' }).first().innerText()).replace(/\s+/g, ' ');
  console.log('Firma in der Liste:', row.slice(0, 100));
  await browser.close(); srv.kill();
})().catch((e) => { console.error('FEHLER', e.message.slice(0, 300)); srv && srv.kill(); process.exit(1); });
