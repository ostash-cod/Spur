const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

let srv;
(async () => {
  fs.rmSync('/tmp/spur-e2e', { recursive: true, force: true });
  srv = spawn('node', ['--no-warnings', require('node:path').join(__dirname, '..', 'server', 'src', 'index.js')], {
    env: { ...process.env, SPUR_DATA_DIR: '/tmp/spur-e2e', PORT: '3111' }, stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1500));
  const code = fs.readFileSync('/tmp/spur-e2e/erster-zugang.txt', 'utf8').match(/: ([A-Z0-9-]+)/)[1];

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

  await page.goto('http://127.0.0.1:3111/');
  await page.screenshot({ path: '/tmp/spur-e2e/1-login.png' });

  // falscher Code
  await page.fill('#code', 'AAAA-AAAA'); await page.click('#login-form button');
  await page.waitForFunction(() => document.getElementById('login-error').textContent.length > 0);
  console.log('falscher Code ->', await page.textContent('#login-error'));

  // richtiger Code
  await page.fill('#code', code.toLowerCase()); await page.click('#login-form button');
  await page.waitForSelector('#shell:not(.hidden)');
  await page.waitForSelector('table');
  console.log('Mitarbeiterzeilen:', await page.locator('tbody tr').count());

  // Mitarbeiter anlegen
  await page.fill('#new-name', 'Mykhaylo'); await page.check('#new-car');
  await page.click('#main form button[type=submit]');
  await page.waitForSelector('dialog[open] .code-box');
  const newCode = await page.textContent('.code-box');
  console.log('Code-Format ok:', /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(newCode));
  await page.screenshot({ path: '/tmp/spur-e2e/2-code.png' });
  await page.click('dialog button.primary');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
  console.log('Zeilen nach Anlegen:', await page.locator('tbody tr').count());
  await page.screenshot({ path: '/tmp/spur-e2e/3-mitarbeiter.png' });

  // Privatauto-Schalter
  const box = page.locator('tbody tr', { hasText: 'Mykhaylo' }).locator('input[type=checkbox]').first();
  console.log('Privatauto an:', await box.isChecked());
  await box.uncheck(); await page.waitForTimeout(300);
  await page.reload(); await page.waitForSelector('table');
  console.log('nach Reload aus:', !(await page.locator('tbody tr', { hasText: 'Mykhaylo' }).locator('input[type=checkbox]').first().isChecked()));

  // Einstellungen
  await page.click('a[data-page=einstellungen]');
  await page.waitForSelector('#lager-lat');
  console.log('Lager:', await page.inputValue('#lager-lat'), await page.inputValue('#lager-lng'));
  await page.fill('#unknown', '12,5'); await page.click('#main form button[type=submit]');
  await page.waitForFunction(() => /Gespeichert|[A-Za-z]/.test(document.querySelector('[role=status]').textContent) && document.querySelector('[role=status]').textContent !== 'Speichert …');
  console.log('Status:', await page.textContent('[role=status]'));
  await page.fill('#site-r', '-5'); await page.click('#main form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('[role=status]').className === 'error');
  console.log('Fehlermeldung:', await page.textContent('[role=status]'));
  await page.screenshot({ path: '/tmp/spur-e2e/4-einstellungen.png', fullPage: true });

  // Eigener Code für Mykhaylo (Chef setzt ihn) und Anmeldung damit
  await page.goto('http://127.0.0.1:3111/#/mitarbeiter'); await page.waitForSelector('table');
  await page.locator('tbody tr', { hasText: 'Mykhaylo' }).locator('button:has-text("Eigenen Code")').click();
  await page.fill('#own-code', 'zu kurz'); await page.click('dialog button.primary');
  await page.waitForFunction(() => document.querySelector('dialog .error').textContent.length > 0);
  console.log('Kurzer Code ->', await page.textContent('dialog .error'));
  await page.fill('#own-code', 'Putz Estrich Dämmung 77'); await page.click('dialog button.primary');
  await page.waitForSelector('dialog .code-box');
  console.log('Code gezeigt:', (await page.textContent('dialog .code-box')).trim());
  await page.screenshot({ path: '/tmp/spur-e2e/5-eigener-code.png' });
  await page.click('dialog button.primary');

  // Mitarbeiter-Code darf nicht in die Desktop-Ansicht
  await page.click('#logout'); await page.waitForSelector('#login:not(.hidden)');
  await page.fill('#code', 'putz estrich dämmung 77'); await page.click('#login-form button');
  await page.waitForFunction(() => document.getElementById('login-error').textContent.length > 0);
  console.log('Mitarbeiter am Desktop ->', await page.textContent('#login-error'));

  // Handy-Breite
  await page.setViewportSize({ width: 390, height: 800 });
  console.log('Probleme:', problems.length ? problems : 'keine');
  await browser.close(); srv.kill();
})().catch((e) => { console.error('FEHLER', e); srv && srv.kill(); process.exit(1); });
