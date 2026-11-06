// Prüft die Seite „Berichte“ im Browser: Kunde wählen, Zeitraum, Vorschau und PDF-Download.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
let srv;
const ok = (cond, msg) => { console.log(cond ? 'OK  ' : 'FEHLER', msg); if (!cond) process.exitCode = 1; };
(async () => {
  fs.rmSync('/tmp/spur-e2e5', { recursive: true, force: true });
  srv = spawn('node', ['--no-warnings', '/home/claude/spur/server/src/index.js'], { env: { ...process.env, SPUR_DATA_DIR: '/tmp/spur-e2e5', PORT: '3116' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const base = 'http://127.0.0.1:3116';
  const code = fs.readFileSync('/tmp/spur-e2e5/erster-zugang.txt', 'utf8').match(/: ([A-Z0-9-]+)/)[1];
  const call = async (path, token, body, method = 'POST') => (await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })).json();
  const boss = (await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).json()).token;
  const w = await call('/users', boss, { name: 'Mykhaylo Yatsyshin' });
  const wt = (await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: w.code }) })).json()).token;
  const cust = await call('/customers', boss, { name: 'SN 26055', address: 'Lilienstraße 77, 82343 Pöcking', hourly_rate: 55 });
  const site = await call('/sites', boss, { name: 'Lilienstraße 77', customer_id: cust.id });
  const day = await call('/days', wt, { client_id: 'day-e2e-0001', started_at: Date.UTC(2026, 4, 26, 5, 0), ended_at: Date.UTC(2026, 4, 26, 14, 0) });
  await call(`/days/${day.id}/segments`, wt, { segments: [{ client_id: 'seg-e2e-0001', site_id: site.id, kind: 'work', started_at: Date.UTC(2026, 4, 26, 5, 0), ended_at: Date.UTC(2026, 4, 26, 14, 0) }] });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  await page.fill('#code', code); await page.click('#login-form button'); await page.waitForSelector('table');
  await page.click('a[data-page=berichte]'); await page.waitForSelector('#rb-kunde');
  ok((await page.textContent('#rb-kunde')).includes('SN 26055'), 'Kunde steht in der Auswahl');

  await page.fill('#rb-von', '2026-05-26'); await page.fill('#rb-bis', '2026-05-31');
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/reports/customer')), page.click('text=Vorschau')]);
  ok(res.status() === 200 && res.headers()['content-type'] === 'application/pdf', 'Vorschau liefert ein PDF');
  await page.waitForFunction(() => document.querySelector('iframe').src.startsWith('blob:'));
  ok(true, 'Vorschau-Fenster zeigt das PDF');

  // Woche und Monat
  await page.selectOption('#rb-typ', 'week'); await page.fill('#rb-tag', '2026-05-27');
  const [wk] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/reports/customer')), page.click('text=Vorschau')]);
  ok(wk.status() === 200 && JSON.parse(wk.request().postData()).from === '2026-05-25' && JSON.parse(wk.request().postData()).to === '2026-05-31', 'Woche: Montag bis Sonntag');
  await page.selectOption('#rb-typ', 'month'); await page.fill('#rb-monat', '2026-02');
  const [mo] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/reports/customer')), page.click('text=Vorschau')]);
  const mb = JSON.parse(mo.request().postData());
  ok(mb.from === '2026-02-01' && mb.to === '2026-02-28', 'Monat: 1. bis letzter Tag');

  // Spalten abhaken und Download
  await page.selectOption('#rb-typ', 'range');
  await page.uncheck('label:has-text("Pause") input'); await page.uncheck('label:has-text("Notiz") input');
  // Playwright zeigt bei Blob-Downloads immer „download“; deshalb den Namen am Verweis lesen.
  await page.evaluate(() => { HTMLAnchorElement.prototype.click = function () { window.__dl = this.getAttribute('download'); }; });
  await page.click('text=PDF speichern');
  await page.waitForFunction(() => window.__dl);
  const name = await page.evaluate(() => window.__dl);
  ok(name === 'SN 26055, Lilienstraße 77, 26.05. bis 31.05.2026.pdf', 'Dateiname: ' + name);
  await page.click('text=Einstellungen für diesen Kunden merken');
  await page.reload(); await page.click('a[data-page=berichte]'); await page.waitForSelector('#rb-kunde');
  ok(!(await page.isChecked('label:has-text("Pause") input')), 'Vorlage pro Kunde wird wieder geladen');
  await page.screenshot({ path: '/tmp/berichte.png', fullPage: true });
  ok(errors.length === 0, 'keine Fehler im Browser ' + errors.join('|'));
  await browser.close();
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => srv.kill());
