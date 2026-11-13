// Prüft die Seite „Lohn und Kilometer“: Zettel abgeben, Tabellen anzeigen, Excel herunterladen.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
let srv;
const ok = (cond, msg) => { console.log(cond ? 'OK  ' : 'FEHLER', msg); if (!cond) process.exitCode = 1; };
(async () => {
  fs.rmSync('/tmp/spur-e2e7', { recursive: true, force: true });
  srv = spawn('node', ['--no-warnings', require('node:path').join(__dirname, '..', 'server', 'src', 'index.js')], { env: { ...process.env, SPUR_DATA_DIR: '/tmp/spur-e2e7', PORT: '3118' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const base = 'http://127.0.0.1:3118';
  const code = fs.readFileSync('/tmp/spur-e2e7/erster-zugang.txt', 'utf8').match(/: ([A-Z0-9-]+)/)[1];
  const json = async (path, token, body, method = 'POST') => (await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })).json();
  const login = async (c) => (await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c }) })).json()).token;
  const boss = await login(code);
  const w = await json('/users', boss, { name: 'Mykhaylo Yatsyshin' });
  const wt = await login(w.code);
  const site = await json('/sites', boss, { name: 'Lilienstraße 77' });
  const now = new Date();
  const d = (h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const r = await json('/sheets', wt, { date, start: d(7, 0), end: d(17, 0), pause_min: 30, lines: [
    { kind: 'travel', from: d(7, 0), to: d(7, 20), km: 14.5, vehicle: 'privat' },
    { kind: 'work', site_id: site.id, from: d(7, 20), to: d(16, 40) },
    { kind: 'travel', from: d(16, 40), to: d(17, 0), km: 14.5, vehicle: 'privat' } ] });
  ok(r.ok === true, 'Zettel abgegeben');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  await page.fill('#code', code); await page.click('#login-form button'); await page.waitForSelector('table');
  await page.click('a[data-page=lohn]'); await page.waitForSelector('text=Lohnzettel · Mykhaylo');
  ok(await page.isVisible('text=9,50'), 'Bezahlte Stunden 9,50 (10 Stunden minus 30 Minuten)');
  ok(await page.isVisible('text=29,0'), 'Kilometer 29,0');
  ok(await page.isVisible('text=8,70'), 'Betrag 8,70 Euro');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Excel herunterladen >> nth=0')]);
  ok(dl.suggestedFilename().endsWith('.xlsx'), 'Excel-Datei wird heruntergeladen: ' + dl.suggestedFilename());
  ok(errors.length === 0, 'keine Fehler im Browser ' + errors.join('; '));
  await browser.close();
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => srv && srv.kill());
