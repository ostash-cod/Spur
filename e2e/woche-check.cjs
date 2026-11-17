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
  const base = 'http://127.0.0.1:3121';
  for (let i = 0; i < 60; i++) { // warten, bis der Server antwortet
    try { if ((await fetch(base + '/api/health')).ok && fs.existsSync(`${DATA}/erster-zugang.txt`)) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
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
  // Donnerstag: voller Tag mit vielen kurzen Abschnitten. Freitag: Tag ohne Ende.
  const haendler = await call('POST', '/api/sites', { name: 'Hage Baumarkt', kind: 'haendler', lat: 47.9, lng: 11.3 }, admin.token);
  const d4 = await call('POST', '/api/days', { client_id: 'woche-do-0001', started_at: T(3, 6, 50), ended_at: T(3, 18, 0) }, st);
  const segs4 = []; let t = T(3, 7, 0); let i = 0;
  for (const [sid, min, gap] of [[haendler.id, 25, 18], [site.id, 89, 19], [haendler.id, 21, 18], [site.id, 93, 25], [krug.id, 14, 22], [haendler.id, 79, 32], [site.id, 52, 15], [haendler.id, 7, 10]]) {
    segs4.push({ client_id: `w-do-seg-000${i++}`, site_id: sid, kind: 'work', started_at: t, ended_at: t + min * 60000, source: 'auto' });
    t += (min + gap) * 60000;
  }
  await call('POST', `/api/days/${d4.id}/segments`, { segments: segs4 }, st);
  await call('POST', '/api/days', { client_id: 'woche-fr-0001', started_at: T(4, 17, 0), ended_at: null }, st);
  await call('POST', '/api/notes', { client_id: 'w-note-00001', date: ds(0), site_id: site.id, text: 'Wand im Schlafzimmer vorbehandelt.\n- Leibungen bearbeitet\n- Eckschienen gesetzt' }, st);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);
  await call('POST', '/api/photos', jpeg, st, { 'x-client-id': 'w-photo-0001', 'x-taken-at': String(T(0, 9, 0)), 'x-site-id': String(site.id) });
  await call('POST', '/api/sheets', { date: ds(0), start: T(0, 7, 10), end: T(0, 15, 30), pause_min: 30, lines: [] }, st);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1050 } });
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
  // (Donnerstag und Freitag kommen dazu)
  if (!foot[0].includes('7:50 h')) throw new Error('Montag Stunden falsch (erwartet 7:50 h ohne Pause): ' + foot[0]);
  console.log('Woche:', (await page.innerText('.wsum')).replace(/\s+/g, ' '));
  await page.screenshot({ path: `${DATA}/woche.png` });
  const fri = (await page.locator('.wfootday').nth(4).innerText()).replace(/\s+/g, ' ');
  console.log('Freitag (nicht beendet):', fri);
  if (!fri.includes('nicht beendet')) throw new Error('Offener Tag nicht erkannt');
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.wcol')].some((c) => [...c.children].some((b) => b.offsetTop + b.offsetHeight > c.offsetHeight + 1)));
  if (overflow) throw new Error('Block ragt über die Spalte hinaus');
  const width = await page.evaluate(() => document.querySelector('.wcard').getBoundingClientRect().width);
  console.log('Breite der Wochenansicht:', Math.round(width), 'px');
  if (width < 1500) throw new Error('Wochenansicht nutzt nicht die ganze Breite');

  // Block anklicken: kleines Fenster mit Notiz, Fotos und Knöpfen
  page.on('dialog', (dl) => dl.accept());
  await page.locator('.wblock', { hasText: 'Leibungen bearbeitet' }).click();
  await page.waitForSelector('dialog button:has-text("Bearbeiten")');
  await page.waitForSelector('dialog img[src^="blob:"]');
  console.log('Fenster:', (await page.innerText('dialog')).split('\n').filter(Boolean).slice(0, 5).join(' | '));
  await page.screenshot({ path: `${DATA}/fenster.png` });

  // Bearbeiten: Ende 12:00 -> 11:30, Beschreibung ändern
  await page.click('dialog button:has-text("Bearbeiten")');
  await page.waitForSelector('#e-start');
  if (await page.inputValue('#e-start') !== '07:40' || await page.inputValue('#e-end') !== '12:00') throw new Error('Zeiten nicht vorausgefüllt');
  await page.fill('#e-end', '11:30');
  await page.fill('#e-desc', 'Wand im Schlafzimmer vorbehandelt und aufgeräumt.');
  console.log('Bearbeiten:', (await page.textContent('#e-dur')), '|', (await page.innerText('dialog')).match(/Erstellt:[^\n]*/)[0]);
  await page.screenshot({ path: `${DATA}/bearbeiten.png` });
  await page.click('dialog button:has-text("Speichern")');
  await page.waitForSelector('.wblock .wnote:has-text("aufgeräumt")');
  const monFoot = (await page.locator('.wfootday').first().innerText()).replace(/\s+/g, ' ');
  console.log('Montag nach Änderung:', monFoot);
  if (!monFoot.includes('401,00 €')) throw new Error('Betrag nach Änderung falsch (erwartet 6:41 h x 60 = 401,00 €): ' + monFoot);

  // Fehler: Überschneidung
  await page.locator('.wblock', { hasText: 'aufgeräumt' }).click();
  await page.click('dialog button:has-text("Bearbeiten")');
  await page.fill('#e-end', '13:00');
  await page.click('dialog button:has-text("Speichern")');
  await page.waitForFunction(() => document.querySelector('dialog .error').textContent.includes('überschneidet'));
  console.log('Überschneidung:', await page.textContent('dialog .error'));
  await page.click('dialog button:has-text("Abbrechen")');

  // Teilen: Mittwoch 12:20–16:00 um 14:00
  const before = await page.locator('.wblock').count();
  await page.locator('.wcol').nth(2).locator('.wblock', { hasText: '3:40 h' }).click();
  await page.click('dialog button:has-text("Teilen")');
  await page.fill('#s-at', '14:00');
  await page.click('dialog button.primary:has-text("Teilen")');
  await page.waitForFunction((n) => document.querySelectorAll('.wblock').length === n + 1, before);
  console.log('Geteilt: Blöcke', before, '->', before + 1);

  // Den zweiten Teil einer anderen Baustelle geben
  await page.locator('.wcol').nth(2).locator('.wblock', { hasText: '2:00 h' }).click();
  await page.click('dialog button:has-text("Bearbeiten")');
  await page.selectOption('#e-site', { label: 'Tobias Krug' });
  await page.click('dialog button:has-text("Speichern")');
  await page.waitForFunction(() => ([...document.querySelectorAll('.wcol')][2]?.innerText ?? '').split('Tobias Krug').length === 3);
  console.log('Zweiter Teil jetzt Tobias Krug: ok');

  // Löschen
  const n2 = await page.locator('.wblock').count();
  await page.locator('.wcol').nth(2).locator('.wblock', { hasText: '2:00 h' }).click();
  await page.click('dialog button:has-text("Löschen")');
  await page.waitForFunction((n) => document.querySelectorAll('.wblock').length < n, n2);
  const wed = (await page.locator('.wfootday').nth(2).innerText()).replace(/\s+/g, ' ');
  console.log('Gelöscht, Mittwoch jetzt:', wed);
  if (!wed.includes('08:00 – 14:00') || !wed.includes('6:00 h')) throw new Error('Tag nach Löschen am Ende nicht gekürzt');

  // Fahrt: Knopf "Fahrt ändern"
  await page.locator('.wblock', { hasText: 'Anfahrt' }).first().click();
  await page.waitForSelector('dialog button:has-text("Fahrt ändern")');
  await page.click('dialog button:has-text("Fahrt ändern")');
  await page.waitForSelector('dialog h2:has-text("Fahrt ändern")');
  await page.click('dialog button:has-text("Abbrechen")');
  console.log('Fahrt ändern: ok');
  await page.screenshot({ path: `${DATA}/woche-nachher.png` });

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
