// Spur – Desktop-Oberfläche (Schritt 1: Anmeldung, Mitarbeiter, Einstellungen)

const $ = (id) => document.getElementById(id);

let token = null;
let me = null;

// --- Hilfen ---------------------------------------------------------------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

function storage(op, key, value) {
  try {
    if (op === 'get') return localStorage.getItem(key);
    if (op === 'set') localStorage.setItem(key, value);
    if (op === 'del') localStorage.removeItem(key);
  } catch {
    return null;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    signOutLocally();
    throw new Error('Bitte neu anmelden');
  }
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

// Zahl aus Eingabe lesen, auch mit deutschem Komma ("2,5").
function num(value) {
  const s = String(value ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const showNum = (n) => (n == null ? '' : String(n).replace('.', ','));

// Google Maps liefert Koordinaten als ein Text wie „47.96138, 11.30548“. Wird so etwas ins Feld Breite
// eingefügt, teilen wir es auf Breite und Länge auf.
function splitPair(text) {
  const s = String(text ?? '').trim();
  let m = s.match(/^(-?\d+\.\d+)\s*[,;]\s*(-?\d+\.\d+)$/); // Google-Schreibweise mit Punkten: 47.96, 11.30
  if (!m) m = s.match(/^(-?\d+,\d+)\s+(-?\d+,\d+)$/); // deutsche Schreibweise mit Leerzeichen: 47,96 11,30
  if (!m) m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*[;/]\s*(-?\d+(?:[.,]\d+)?)$/);
  return m ? [m[1].replace('.', ','), m[2].replace('.', ',')] : null;
}
const isLink = (v) => /^https?:\/\//i.test(String(v ?? '').trim());

// Holt Breite und Länge aus einem Google-Maps-Link (der Server öffnet den Link).
async function fillFromLink(url, latEl, lngEl, say) {
  say?.('Liest die Position aus dem Link …', 'hint');
  try {
    const r = await api(`/maplink?url=${encodeURIComponent(url.trim())}`);
    latEl.value = showNum(Number(r.lat.toFixed(6)));
    lngEl.value = showNum(Number(r.lng.toFixed(6)));
    say?.('Position aus dem Link übernommen ✓', 'ok');
    return true;
  } catch (ex) {
    say?.(ex.message, 'error');
    return false;
  }
}

// Ins Feld Breite darf man einfügen: einen Google-Maps-Link, oder „47.96, 11.30“ in einem Stück.
function watchPair(latEl, lngEl, say) {
  let last = latEl.value; // Wert vor dem Einfügen, falls der Link nicht funktioniert
  latEl.addEventListener('input', () => {
    const v = latEl.value.trim();
    if (isLink(v)) {
      latEl.value = last;
      fillFromLink(v, latEl, lngEl, say).then(() => { last = latEl.value; });
      return;
    }
    const pair = splitPair(v);
    if (pair) {
      latEl.value = pair[0];
      lngEl.value = pair[1];
    }
    last = latEl.value;
  });
}

// Ein Feld „Position“: Google-Maps-Link ODER „47.96138, 11.30548“ in einem Stück einfügen.
// Breite und Länge werden darunter ausgefüllt; der Link „In Google Maps prüfen“ zeigt den Punkt.
function positionBox(latEl, lngEl, say, onSet) {
  const input = h('input', { type: 'text', placeholder: 'Link oder Koordinaten aus Google Maps hier einfügen', autocomplete: 'off', style: 'max-width:none' });
  const check = h('a', { class: 'hint', target: '_blank', rel: 'noopener', style: 'display:none' }, 'In Google Maps prüfen ↗');
  const refresh = () => {
    const la = num(latEl.value);
    const ln = num(lngEl.value);
    const ok = la != null && ln != null && !Number.isNaN(la) && !Number.isNaN(ln);
    check.style.display = ok ? '' : 'none';
    if (ok) check.href = `https://www.google.com/maps?q=${la},${ln}`;
  };
  const apply = async () => {
    const v = input.value.trim();
    if (!v) return;
    if (isLink(v)) {
      if (await fillFromLink(v, latEl, lngEl, say)) { input.value = ''; onSet?.(); }
    } else {
      const pair = splitPair(v);
      if (pair) {
        latEl.value = pair[0];
        lngEl.value = pair[1];
        input.value = '';
        say?.('Position übernommen ✓', 'ok');
        onSet?.();
      } else {
        say?.('Das ist weder ein Link noch Koordinaten. Beispiel: 47.96138, 11.30548', 'error');
      }
    }
    refresh();
  };
  input.addEventListener('input', () => {
    const v = input.value.trim();
    if (isLink(v) || splitPair(v)) apply();
  });
  input.addEventListener('change', apply);
  latEl.addEventListener('input', refresh);
  lngEl.addEventListener('input', refresh);
  refresh();
  const box = h('div', {}, h('label', {}, 'Position'), input, check);
  box.refresh = refresh;
  return box;
}

function openDialog(...content) {
  const d = $('dialog');
  d.replaceChildren(...content);
  d.showModal();
  return d;
}

// --- Anmeldung -------------------------------------------------------------
function signOutLocally() {
  token = null;
  me = null;
  storage('del', 'spur-token');
  $('shell').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('code').value = '';
  $('code').focus();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    const res = await api('/login', { method: 'POST', body: { code: $('code').value } });
    if (res.user.role !== 'admin') {
      $('login-error').textContent = 'Die Desktop-Ansicht ist nur für den Chef. Mitarbeiter nutzen die Handy-App.';
      await fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${res.token}` } });
      return;
    }
    token = res.token;
    storage('set', 'spur-token', token);
    me = res.user;
    startShell();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('logout').addEventListener('click', async () => {
  try {
    await api('/logout', { method: 'POST' });
  } catch {
    /* schon abgemeldet */
  }
  signOutLocally();
});

function startShell() {
  $('login').classList.add('hidden');
  $('shell').classList.remove('hidden');
  $('me-name').textContent = me.name;
  if (!location.hash) location.hash = '#/mitarbeiter';
  route();
}

// --- Seiten ----------------------------------------------------------------
const pages = {}; // wird unten gefüllt, wenn alle Seiten definiert sind

function route() {
  const [page, ...args] = (location.hash.replace('#/', '') || 'mitarbeiter').split('/');
  const render = (m) => (pages[page] ?? mitarbeiter)(m, ...args);
  document.querySelectorAll('.menu a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  const main = $('main');
  main.replaceChildren(h('p', { class: 'sub' }, 'Lädt …'));
  render(main).catch((err) => main.replaceChildren(h('p', { class: 'error' }, err.message)));
}
window.addEventListener('hashchange', () => me && route());

function placeholder(title, text, step) {
  return (main) => {
    main.replaceChildren(
      h('h1', {}, title),
      h('div', { class: 'card placeholder' }, h('strong', {}, text), h('p', {}, `Kommt in ${step}.`)),
    );
    return Promise.resolve();
  };
}
// --- Berichte: Kundenbericht (Stundennachweis) als PDF ------------------------------
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Aus der Auswahl (Woche, Monat oder Von–Bis) die beiden Tage machen.
function reportPeriod(type, v) {
  if (type === 'week') {
    if (!v.day) throw new Error('Bitte einen Tag der Woche wählen.');
    const [y, m, d] = v.day.split('-').map(Number);
    const monday = new Date(y, m - 1, d - ((new Date(y, m - 1, d).getDay() + 6) % 7));
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return { from: ymd(monday), to: ymd(sunday) };
  }
  if (type === 'month') {
    if (!v.month) throw new Error('Bitte einen Monat wählen.');
    const [y, m] = v.month.split('-').map(Number);
    return { from: `${y}-${pad2(m)}-01`, to: ymd(new Date(y, m, 0)) };
  }
  if (!v.from || !v.to) throw new Error('Bitte „von“ und „bis“ eintragen.');
  if (v.to < v.from) throw new Error('„bis“ liegt vor „von“.');
  return { from: v.from, to: v.to };
}

async function berichte(main) {
  const customers = (await api('/customers')).filter((c) => !c.archived);
  const today = new Date();
  const COLS = [
    ['names', 'Namen'], ['times', 'Von und Bis'], ['pause', 'Pause'], ['brutto', 'Brutto'], ['netto', 'Netto'],
    ['rate', 'Satz (in der Tabelle)'], ['amount', 'Betrag'], ['note', 'Notiz'],
  ];
  const DEFAULTS = { cols: { names: true, times: true, pause: true, brutto: true, netto: true, rate: false, amount: true, note: true }, rate_head: true, totals: true, zero_days: false, weekend_color: true, round_minutes: 0 };

  const customerSel = h('select', { id: 'rb-kunde' }, customers.map((c) => h('option', { value: c.id }, c.name)));
  const typeSel = h('select', { id: 'rb-typ' }, h('option', { value: 'range' }, 'Von – Bis'), h('option', { value: 'week' }, 'Woche'), h('option', { value: 'month' }, 'Monat'));
  const fromIn = h('input', { id: 'rb-von', type: 'date', value: ymd(new Date(today.getFullYear(), today.getMonth(), 1)) });
  const toIn = h('input', { id: 'rb-bis', type: 'date', value: ymd(today) });
  const dayIn = h('input', { id: 'rb-tag', type: 'date', value: ymd(today) });
  const monthIn = h('input', { id: 'rb-monat', type: 'month', value: `${today.getFullYear()}-${pad2(today.getMonth() + 1)}` });
  const roundSel = h('select', { id: 'rb-runden' }, h('option', { value: 0 }, 'nicht aufrunden'), ...[5, 10, 15].map((m) => h('option', { value: m }, `auf ${m} Minuten aufrunden`)));
  const checks = {};
  const checkBox = (key, label, on) => {
    const input = h('input', { type: 'checkbox', checked: on });
    checks[key] = input;
    return h('label', { class: 'check' }, input, label);
  };
  const colBoxes = COLS.map(([k, label]) => checkBox(`col-${k}`, label, DEFAULTS.cols[k]));
  const otherBoxes = [
    checkBox('rate_head', 'Stundensatz einmal im Kopf', DEFAULTS.rate_head),
    checkBox('totals', 'Gesamtsumme', DEFAULTS.totals),
    checkBox('zero_days', 'Tage ohne Arbeit zeigen', DEFAULTS.zero_days),
    checkBox('weekend_color', 'Wochenende farbig', DEFAULTS.weekend_color),
  ];

  const periodBox = h('div', { class: 'row' });
  const showPeriod = () => {
    const t = typeSel.value;
    periodBox.replaceChildren(
      ...(t === 'range'
        ? [h('div', {}, h('label', { for: 'rb-von' }, 'Von'), fromIn), h('div', {}, h('label', { for: 'rb-bis' }, 'Bis'), toIn)]
        : t === 'week'
          ? [h('div', {}, h('label', { for: 'rb-tag' }, 'Ein Tag aus der Woche'), dayIn)]
          : [h('div', {}, h('label', { for: 'rb-monat' }, 'Monat'), monthIn)]),
    );
  };
  typeSel.addEventListener('change', showPeriod);
  showPeriod();

  const readOptions = () => ({
    cols: Object.fromEntries(COLS.map(([k]) => [k, checks[`col-${k}`].checked])),
    rate_head: checks.rate_head.checked,
    totals: checks.totals.checked,
    zero_days: checks.zero_days.checked,
    weekend_color: checks.weekend_color.checked,
    round_minutes: Number(roundSel.value),
  });
  const applyOptions = (o) => {
    for (const [k] of COLS) checks[`col-${k}`].checked = !!o.cols?.[k];
    for (const k of ['rate_head', 'totals', 'zero_days', 'weekend_color']) checks[k].checked = !!o[k];
    roundSel.value = String(o.round_minutes ?? 0);
  };
  // Einstellungen pro Kunde als Vorlage (in diesem Browser gespeichert)
  const tplKey = () => `spur-bericht-${customerSel.value}`;
  const loadTemplate = () => {
    let o = DEFAULTS;
    try {
      const raw = storage('get', tplKey());
      if (raw) o = { ...DEFAULTS, ...JSON.parse(raw), cols: { ...DEFAULTS.cols, ...(JSON.parse(raw).cols ?? {}) } };
    } catch {
      /* Vorlage unlesbar: Standard nehmen */
    }
    applyOptions(o);
  };
  customerSel.addEventListener('change', loadTemplate);
  loadTemplate();

  const status = h('p', { class: 'hint', role: 'status' });
  const frame = h('iframe', { title: 'Vorschau Kundenbericht', style: 'width:100%;height:78vh;border:1px solid var(--linie);border-radius:8px;background:#fff;display:none' });
  let blobUrl = null;

  async function fetchReport(download) {
    if (!customerSel.value) throw new Error('Bitte einen Kunden wählen. Es gibt noch keinen Kunden.');
    const body = { customer_id: Number(customerSel.value), type: typeSel.value, ...reportPeriod(typeSel.value, { from: fromIn.value, to: toIn.value, day: dayIn.value, month: monthIn.value }), options: readOptions(), download };
    const res = await fetch('/api/reports/customer', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (!res.ok) {
      if (res.status === 401) signOutLocally();
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Fehler ${res.status}`);
    }
    const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('Content-Disposition') ?? '')?.[1];
    return { blob: await res.blob(), name: name ? decodeURIComponent(name) : 'Stundennachweis.pdf' };
  }

  const run = async (download) => {
    status.className = 'hint';
    status.textContent = 'Erstellt den Bericht …';
    try {
      const { blob, name } = await fetchReport(download);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(blob);
      if (download) {
        const a = h('a', { href: blobUrl, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        status.className = 'hint ok';
        status.textContent = `Gespeichert als „${name}“.`;
      } else {
        frame.src = blobUrl;
        frame.style.display = 'block';
        status.textContent = '';
      }
    } catch (ex) {
      status.className = 'error';
      status.textContent = ex.message;
    }
  };

  main.replaceChildren(
    h('h1', {}, 'Berichte'),
    h('p', { class: 'sub' }, 'Kundenbericht (Stundennachweis) als PDF. Alle Arbeitskräfte, die beim Kunden gearbeitet haben, kommen automatisch hinein.'),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Kundenbericht'),
      h('label', { for: 'rb-kunde' }, 'Kunde'),
      customerSel,
      h('label', { for: 'rb-typ' }, 'Zeitraum'),
      typeSel,
      periodBox,
      h('h2', { style: 'margin-top:18px' }, 'Spalten'),
      h('div', { class: 'row' }, colBoxes.map((b) => h('div', {}, b))),
      otherBoxes,
      h('label', { for: 'rb-runden' }, 'Zeiten'),
      roundSel,
      h(
        'div',
        { class: 'actions', style: 'margin-top:16px' },
        h('button', { class: 'primary', type: 'button', onclick: () => run(false) }, 'Vorschau'),
        h('button', { type: 'button', onclick: () => run(true) }, 'PDF speichern'),
        h('button', { type: 'button', class: 'small', onclick: () => { storage('set', tplKey(), JSON.stringify(readOptions())); status.className = 'hint ok'; status.textContent = 'Einstellungen für diesen Kunden gemerkt.'; } }, 'Einstellungen für diesen Kunden merken'),
      ),
      status,
    ),
    frame,
  );
}
const statistik = placeholder('Statistik', 'Stunden und Umsatz pro Monat, Kunde und Projekt.', 'Schritt 7');

// --- Mitarbeiter -----------------------------------------------------------
async function mitarbeiter(main, userId, dateStr) {
  if (userId) return tagesansicht(main, Number(userId), dateStr);
  const users = await api('/users');

  const rows = users.map((u) =>
    h(
      'tr',
      { class: u.active ? '' : 'inaktiv' },
      h('td', {}, h('a', { href: `#/mitarbeiter/${u.id}` }, u.name), ' ', u.role === 'admin' ? h('span', { class: 'badge chef' }, 'Chef') : null),
      h(
        'td',
        {},
        h('input', {
          type: 'checkbox',
          'aria-label': `Auto-Knöpfe für ${u.name}`,
          checked: u.uses_private_car,
          onchange: async (e) => {
            try {
              await api(`/users/${u.id}`, { method: 'PATCH', body: { uses_private_car: e.target.checked } });
            } catch (err) {
              e.target.checked = !e.target.checked;
              alert(err.message);
            }
          },
        }),
      ),
      h(
        'td',
        {},
        u.role === 'admin'
          ? h('span', { class: 'hint' }, 'immer')
          : h('input', {
              type: 'checkbox',
              'aria-label': `Belege für ${u.name}`,
              checked: u.can_receipts,
              onchange: async (e) => {
                try {
                  await api(`/users/${u.id}`, { method: 'PATCH', body: { can_receipts: e.target.checked } });
                } catch (err) {
                  e.target.checked = !e.target.checked;
                  alert(err.message);
                }
              },
            }),
      ),
      h('td', {}, u.active ? 'aktiv' : 'deaktiviert'),
      h(
        'td',
        { class: 'actions' },
        h('button', { class: 'small', onclick: () => setOwnCode(u) }, 'Eigenen Code festlegen'),
        h('button', { class: 'small', onclick: () => newCode(u) }, 'Zufallscode'),
        u.id === me.id
          ? null
          : h(
              'button',
              {
                class: 'small',
                onclick: async () => {
                  await api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } });
                  route();
                },
              },
              u.active ? 'Deaktivieren' : 'Aktivieren',
            ),
      ),
    ),
  );

  const nameIn = h('input', { id: 'new-name', required: true, placeholder: 'Vorname' });
  const carIn = h('input', { type: 'checkbox', id: 'new-car' });
  const err = h('p', { class: 'error' });

  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        try {
          const res = await api('/users', {
            method: 'POST',
            body: { name: nameIn.value, uses_private_car: carIn.checked },
          });
          showCode(res.user.name, res.code, true);
        } catch (ex) {
          err.textContent = ex.message;
        }
      },
    },
    h('div', { class: 'row' }, h('div', {}, h('label', { for: 'new-name' }, 'Name'), nameIn)),
    h('div', { class: 'check' }, carIn, h('label', { for: 'new-car', style: 'margin:0;color:inherit' }, 'Nutzt ein Privatauto (Auto-Knöpfe erscheinen in der App)')),
    h('button', { class: 'primary', type: 'submit' }, 'Mitarbeiter anlegen'),
    err,
  );

  main.replaceChildren(
    h('h1', {}, 'Mitarbeiter'),
    h('p', { class: 'sub' }, 'Jeder Mitarbeiter bekommt einen Zugangscode für die Handy-App.'),
    h(
      'div',
      { class: 'card' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Privatauto'), h('th', {}, 'Belege'), h('th', {}, 'Status'), h('th', {}, ''))),
        h('tbody', {}, rows),
      ),
      h('p', { class: 'hint' }, 'Privatauto: Nur dann erscheinen in der App die Knöpfe für Privatauto und Transporter. Serhii hat zum Beispiel kein Auto.'),
    ),
    h('div', { class: 'card' }, h('h2', {}, 'Neuer Mitarbeiter'), form),
  );
}

// Eigenen, langen Code festlegen (mindestens 12 Zeichen). Das Feld zeigt den Text offen, damit man Tippfehler sieht.
function setOwnCode(u) {
  const input = h('input', { id: 'own-code', autocomplete: 'off', spellcheck: 'false', placeholder: 'zum Beispiel drei Wörter und eine Zahl', style: 'max-width:none' });
  const err = h('p', { class: 'error' });
  const d = openDialog(
    h('h2', {}, `Eigener Code für ${u.name}`),
    h('p', {}, 'Mindestens 12 Buchstaben oder Zahlen. Leerzeichen und Striche zählen nicht mit, Groß- und Kleinschreibung ist egal. Je länger, desto sicherer. Drei bis vier Wörter sind gut.'),
    h('label', { for: 'own-code' }, 'Neuer Code'),
    input,
    err,
    h(
      'div',
      { class: 'actions', style: 'margin-top:14px' },
      h(
        'button',
        {
          class: 'primary',
          onclick: async () => {
            err.textContent = '';
            try {
              await api(`/users/${u.id}/code`, { method: 'PUT', body: { code: input.value } });
              d.close();
              const done = openDialog(
                h('h2', {}, 'Code gespeichert'),
                h('p', {}, `Schreib den Code jetzt auf, zum Beispiel auf Papier. Für ${u.name} gilt ab sofort dieser Code:`),
                h('div', { class: 'code-box', style: 'font-size:1.2rem;letter-spacing:0.02em;word-break:break-word' }, input.value),
                h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => done.close() }, 'Habe ich aufgeschrieben')),
              );
            } catch (ex) {
              err.textContent = ex.message;
            }
          },
        },
        'Speichern',
      ),
      h('button', { onclick: () => d.close() }, 'Abbrechen'),
    ),
  );
  input.focus();
}

async function newCode(u) {
  if (!confirm(`Zufälligen Zugangscode für ${u.name} erzeugen? Der alte Code und die angemeldeten Handys werden damit ungültig. Der neue Code erscheint nur einmal.`)) return;
  const res = await api(`/users/${u.id}/new-code`, { method: 'POST' });
  showCode(u.name, res.code, false);
}

function showCode(name, code, reload) {
  const d = openDialog(
    h('h2', {}, `Zugangscode für ${name}`),
    h('p', {}, 'Dieser Code wird nur jetzt angezeigt. Gib ihn dem Mitarbeiter, er tippt ihn beim ersten Start der App ein.'),
    h('div', { class: 'code-box' }, code),
    h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => d.close() }, 'Fertig')),
  );
  d.addEventListener('close', () => reload && route(), { once: true });
}



// --- Kunden und Baustellen -------------------------------------------------
const SITE_COLORS = ['#2E9E4F', '#7E57C2', '#1E88E5', '#FB8C00', '#00897B', '#D81B60', '#8D6E63', '#3949AB', '#7CB342', '#00ACC1'];

async function deleteWithConfirm(kind, item, path) {
  if (!confirm(`${kind} „${item.name}“ wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
  try {
    await api(path, { method: 'DELETE' });
    route();
  } catch (err) {
    alert(err.message);
  }
}

async function kunden(main) {
  const [sites, customers] = await Promise.all([api('/sites?all=1'), api('/customers')]);
  const showArchived = sessionStorageGet('show-archived') === '1';
  const visibleSites = sites.filter((s) => showArchived || !s.archived);
  const visibleCustomers = customers.filter((c) => showArchived || !c.archived);

  const rowFor = (s, withCustomer) =>
    h(
      'tr',
      { class: s.archived ? 'inaktiv' : '' },
      h('td', {}, h('span', { class: 'dot', style: `background:${s.color}`, title: s.color })),
      h('td', {}, h('strong', {}, s.name), s.system ? h('span', { class: 'badge', style: 'margin-left:6px' }, 'fester Ort') : null),
      withCustomer ? h('td', {}, s.customer_name ?? '–') : null,
      h('td', {}, s.address ?? ''),
      h('td', {}, s.lat == null ? h('span', { class: 'warn' }, 'Koordinaten fehlen') : `${s.radius_m} m`),
      h(
        'td',
        {},
        h('input', {
          type: 'checkbox',
          'aria-label': `${s.name} aktiv`,
          checked: s.active && !s.archived,
          disabled: s.archived,
          onchange: async (e) => {
            try {
              await api(`/sites/${s.id}`, { method: 'PATCH', body: { active: e.target.checked } });
            } catch (err) {
              e.target.checked = !e.target.checked;
              alert(err.message);
            }
          },
        }),
      ),
      s.system ? h('td', { class: 'actions' }, h('a', { href: '#/einstellungen' }, 'Ort in den Einstellungen ändern')) : h(
        'td',
        { class: 'actions' },
        h('button', { class: 'small', onclick: () => siteDialog(s, customers) }, 'Bearbeiten'),
        h(
          'button',
          {
            class: 'small',
            onclick: async () => {
              await api(`/sites/${s.id}`, { method: 'PATCH', body: { archived: !s.archived } });
              route();
            },
          },
          s.archived ? 'Wiederherstellen' : 'Archivieren',
        ),
        h('button', { class: 'small danger', onclick: () => deleteWithConfirm(s.kind === 'haendler' ? 'Händler' : 'Baustelle', s, `/sites/${s.id}`) }, 'Löschen'),
      ),
    );
  const siteRows = visibleSites.filter((s) => s.kind !== 'haendler').map((s) => rowFor(s, true));
  const haendlerRows = visibleSites.filter((s) => s.kind === 'haendler').map((s) => rowFor(s, false));

  const customerRows = visibleCustomers.map((c) =>
    h(
      'tr',
      { class: c.archived ? 'inaktiv' : '' },
      h('td', {}, h('strong', {}, c.name)),
      h('td', {}, c.address ?? ''),
      h('td', {}, c.email ?? ''),
      h('td', {}, c.hourly_rate == null ? '–' : `${showNum(c.hourly_rate)} €/h`),
      h(
        'td',
        { class: 'actions' },
        h('button', { class: 'small', onclick: () => customerDialog(c) }, 'Bearbeiten'),
        h(
          'button',
          {
            class: 'small',
            onclick: async () => {
              await api(`/customers/${c.id}`, { method: 'PATCH', body: { archived: !c.archived } });
              route();
            },
          },
          c.archived ? 'Wiederherstellen' : 'Archivieren',
        ),
        h('button', { class: 'small danger', onclick: () => deleteWithConfirm('Kunde', c, `/customers/${c.id}`) }, 'Löschen'),
      ),
    ),
  );

  main.replaceChildren(
    h('h1', {}, 'Kunden und Projekte'),
    h('p', { class: 'sub' }, 'Baustellen mit Adresse und Farbe. Aktive Baustellen erscheinen in der Handy-App als Kacheln und werden dort automatisch erkannt.'),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'actions', style: 'justify-content:space-between;align-items:center;margin-bottom:10px' }, h('h2', { style: 'margin:0' }, 'Baustellen'), h('button', { class: 'primary', onclick: () => siteDialog(null, customers) }, 'Neue Baustelle')),
      siteRows.length
        ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Baustelle'), h('th', {}, 'Kunde'), h('th', {}, 'Adresse'), h('th', {}, 'Erkennung'), h('th', {}, 'Aktiv'), h('th', {}, ''))), h('tbody', {}, siteRows))
        : h('p', { class: 'hint' }, 'Noch keine Baustelle angelegt.'),
    ),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'actions', style: 'justify-content:space-between;align-items:center;margin-bottom:10px' }, h('h2', { style: 'margin:0' }, 'Händler (Baumarkt, Großhandel)'), h('button', { onclick: () => siteDialog(null, customers, 'haendler') }, 'Neuer Händler')),
      haendlerRows.length
        ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Händler'), h('th', {}, 'Adresse'), h('th', {}, 'Erkennung'), h('th', {}, 'Aktiv'), h('th', {}, ''))), h('tbody', {}, haendlerRows))
        : h('p', { class: 'hint' }, 'Noch kein Händler. Händler legst du am Handy an, wenn du dort bist („Ort hier speichern“), oder hier. Fahrten von einer Baustelle zum Händler und zurück gelten als Materialfahrt.'),
    ),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'actions', style: 'justify-content:space-between;align-items:center;margin-bottom:10px' }, h('h2', { style: 'margin:0' }, 'Kunden'), h('button', { onclick: () => customerDialog(null) }, 'Neuer Kunde')),
      customerRows.length
        ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Kunde'), h('th', {}, 'Adresse'), h('th', {}, 'E-Mail'), h('th', {}, 'Stundensatz'), h('th', {}, ''))), h('tbody', {}, customerRows))
        : h('p', { class: 'hint' }, 'Noch kein Kunde angelegt. Ein Kunde ist optional, eine Baustelle geht auch ohne.'),
      h('p', { class: 'hint' }, 'Löschen geht nur, wenn nichts mehr daran hängt: Ein Kunde ohne Baustellen, eine Baustelle ohne gebuchte Zeiten. Sonst archivieren.'),
    ),
    h(
      'label',
      { class: 'check', style: 'margin-top:0' },
      h('input', {
        type: 'checkbox',
        checked: showArchived,
        onchange: (e) => {
          sessionStorageSet('show-archived', e.target.checked ? '1' : '0');
          route();
        },
      }),
      'Archivierte anzeigen',
    ),
  );
}

function sessionStorageGet(k) {
  try { return sessionStorage.getItem(k); } catch { return null; }
}
function sessionStorageSet(k, v) {
  try { sessionStorage.setItem(k, v); } catch { /* ohne Speicher geht es auch */ }
}

function siteDialog(site, customers, kindArg, draft) {
  const s = { ...(site ?? {}), ...(draft ?? {}) };
  const kind = kindArg ?? site?.kind ?? 'baustelle';
  const isHaendler = kind === 'haendler';
  const byId = new Map(customers.map((c) => [c.id, c]));
  const name = h('input', { id: 's-name', value: s.name ?? '', placeholder: isHaendler ? 'zum Beispiel Brillux Starnberg' : 'zum Beispiel Lilienstraße 77', style: 'max-width:none' });
  const cust = h(
    'select',
    { id: 's-cust', style: 'max-width:none', onchange: () => updateCustomerUi() },
    h('option', { value: '' }, '– kein Kunde –'),
    customers.filter((c) => !c.archived || c.id === s.customer_id).map((c) => h('option', { value: c.id, selected: c.id === s.customer_id }, c.name)),
  );
  const copyAddr = h('button', { type: 'button', class: 'small', style: 'margin-top:6px', onclick: () => { const c = byId.get(Number(cust.value)); if (c?.address) { addr.value = c.address; searchNow(true); } } }, 'Adresse vom Kunden übernehmen');
  const autoCust = h('input', { type: 'checkbox', id: 's-autocust' });
  const autoCustRow = h('label', { class: 'check' }, autoCust, 'Kunde mit gleichem Namen anlegen');
  const addr = h('input', { id: 's-addr', value: s.address ?? '', placeholder: 'Straße Nr, PLZ Ort', style: 'max-width:none', oninput: () => onAddressInput(), onblur: () => searchNow(false) });
  const lat = h('input', { id: 's-lat', value: showNum(s.lat), inputmode: 'decimal', placeholder: '48,12345', oninput: () => { manualCoords = true; } });
  const lng = h('input', { id: 's-lng', value: showNum(s.lng), inputmode: 'decimal', placeholder: '11,60123', oninput: () => { manualCoords = true; } });
  const say = (msg, kind) => {
    found.replaceChildren(h('p', { class: kind === 'error' ? 'warn' : kind === 'ok' ? 'hint ok' : 'hint' }, msg));
    if (kind === 'ok') manualCoords = true; // Die Position aus dem Link wird nicht von der Adresssuche überschrieben.
  };
  watchPair(lat, lng, say);
  const posBox = positionBox(lat, lng, say, () => { manualCoords = true; });
  const rad = h('input', { id: 's-rad', value: s.radius_custom ? showNum(s.radius_m) : '', inputmode: 'decimal', placeholder: 'Standard' });
  const found = h('div', { id: 's-found', style: 'margin-top:6px' });
  const err = h('p', { class: 'error' });
  let color = s.color ?? null;
  let manualCoords = false;
  let lastQuery = (s.address ?? '').trim();
  let timer = null;
  let seq = 0;

  function updateCustomerUi() {
    const c = byId.get(Number(cust.value));
    copyAddr.style.display = c?.address ? '' : 'none';
    autoCustRow.style.display = site || cust.value ? 'none' : '';
  }

  let lastAddr = addr.value;
  function onAddressInput() {
    const v = addr.value.trim();
    if (isLink(v)) {
      addr.value = lastAddr; // der Link selbst gehört nicht ins Adressfeld
      fillFromLink(v, lat, lng, say);
      return;
    }
    lastAddr = addr.value;
    scheduleSearch();
  }

  // Sucht die Koordinaten, sobald die Adresse eingegeben ist, und zeigt den Treffer zur Kontrolle.
  function scheduleSearch() {
    clearTimeout(timer);
    timer = setTimeout(() => searchNow(false), 1200);
  }
  async function searchNow(force) {
    clearTimeout(timer);
    const q = addr.value.trim();
    if (q.length < 6 || isLink(q) || (!force && q === lastQuery)) return;
    lastQuery = q;
    const mine = ++seq;
    found.replaceChildren(h('p', { class: 'hint' }, 'Sucht die Position …'));
    try {
      const hits = await api(`/geocode?q=${encodeURIComponent(q)}`);
      if (mine !== seq) return;
      if (!hits.length) {
        found.replaceChildren(h('p', { class: 'warn' }, 'Zu dieser Adresse wurde nichts gefunden. Trage die Koordinaten von Hand ein (in Google Maps mit der rechten Maustaste auf den Ort klicken).'));
        return;
      }
      const take = (f) => {
        lat.value = showNum(Number(f.lat.toFixed(6)));
        lng.value = showNum(Number(f.lng.toFixed(6)));
        manualCoords = false;
        found.replaceChildren(h('p', { class: 'hint ok' }, `Gefunden: ${f.label} ✓`), ...(hits.length > 1 ? [h('p', { class: 'hint' }, 'Falsch? Anderen Treffer wählen:'), ...hits.filter((x) => x !== f).map((x) => h('button', { type: 'button', class: 'small result', onclick: () => take(x) }, x.label))] : []));
      };
      if (manualCoords && lat.value.trim() !== '') {
        found.replaceChildren(h('p', { class: 'hint' }, 'Deine Koordinaten bleiben stehen. Treffer zur Auswahl:'), ...hits.map((x) => h('button', { type: 'button', class: 'small result', onclick: () => take(x) }, x.label)));
      } else {
        take(hits[0]);
      }
    } catch (ex) {
      if (mine !== seq) return;
      found.replaceChildren(h('p', { class: 'warn' }, ex.message));
    }
  }

  const swatchBox = h('div', { class: 'swatches' });
  const drawSwatches = () => {
    swatchBox.replaceChildren(
      ...(site ? [] : [h('button', { type: 'button', class: `swatch auto${color == null ? ' on' : ''}`, onclick: () => { color = null; drawSwatches(); } }, 'Automatisch')]),
      ...SITE_COLORS.map((c) =>
        h('button', { type: 'button', class: `swatch${color && color.toUpperCase() === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': `Farbe ${c}`, onclick: () => { color = c; drawSwatches(); } }),
      ),
    );
  };
  drawSwatches();

  const d = openDialog(
    h('h2', {}, isHaendler ? (site ? 'Händler bearbeiten' : 'Neuer Händler') : site ? 'Baustelle bearbeiten' : 'Neue Baustelle'),
    h('label', { for: 's-kind' }, 'Art'),
    h(
      'select',
      {
        id: 's-kind',
        style: 'max-width:none',
        onchange: (e) => {
          const draft = { name: name.value, address: addr.value, lat: num(lat.value), lng: num(lng.value) };
          const keep = site ? { customer_id: site.customer_id } : {};
          d.close();
          siteDialog(site, customers, e.target.value, { ...keep, ...draft });
        },
      },
      h('option', { value: 'baustelle', selected: !isHaendler }, 'Baustelle (mit Kunde, eigene Farbe)'),
      h('option', { value: 'haendler', selected: isHaendler }, 'Händler (Baumarkt, Großhandel)'),
    ),
    h('label', { for: 's-name' }, isHaendler ? 'Name des Händlers' : 'Name der Baustelle'),
    name,
    ...(isHaendler ? [] : [h('label', { for: 's-cust' }, 'Kunde (optional)'), cust, autoCustRow]),
    h('label', { for: 's-addr' }, isHaendler ? 'Adresse des Händlers' : 'Adresse der Baustelle'),
    addr,
    ...(isHaendler ? [] : [copyAddr]),
    found,
    posBox,
    h('div', { class: 'row' }, h('div', {}, h('label', { for: 's-lat' }, 'Breite'), lat), h('div', {}, h('label', { for: 's-lng' }, 'Länge'), lng), h('div', {}, h('label', { for: 's-rad' }, 'Radius (m)'), rad)),
    h('p', { class: 'hint' }, 'Die Position wird aus der Adresse automatisch gesucht. Du kannst auch einen Google-Maps-Link in das Feld Adresse oder Breite einfügen. Mit der Position erkennt die App die Ankunft. Ohne Radius gilt der Standard aus den Einstellungen.'),
    h('div', {}, h('button', { type: 'button', class: 'small', onclick: () => searchNow(true) }, 'Position erneut suchen')),
    ...(site?.extra_points?.length ? [extraPointsBox(site)] : []),
    h('label', {}, 'Farbe'),
    swatchBox,
    err,
    h(
      'div',
      { class: 'actions', style: 'margin-top:14px' },
      h(
        'button',
        {
          class: 'primary',
          onclick: async () => {
            err.textContent = '';
            const la = num(lat.value);
            const ln = num(lng.value);
            const r = num(rad.value);
            if (Number.isNaN(la) || Number.isNaN(ln) || Number.isNaN(r)) return (err.textContent = 'Koordinaten und Radius müssen Zahlen sein.');
            if ((la === null) !== (ln === null)) return (err.textContent = 'Breite und Länge nur zusammen eintragen.');
            const body = { name: name.value, customer_id: isHaendler || !cust.value ? null : Number(cust.value), address: addr.value, lat: la, lng: ln, radius_m: r, kind };
            if (color) body.color = color;
            if (!isHaendler && !site && !cust.value && autoCust.checked) body.create_customer = true;
            try {
              await api(site ? `/sites/${site.id}` : '/sites', { method: site ? 'PATCH' : 'POST', body });
              d.close();
              route();
            } catch (ex) {
              err.textContent = ex.message;
            }
          },
        },
        'Speichern',
      ),
      h('button', { onclick: () => d.close() }, 'Abbrechen'),
    ),
  );
  updateCustomerUi();
  name.focus();
}

// Weitere Punkte eines Ortes (Parkplatz, andere Seite), von der App gelernt. Der Chef kann sie löschen.
function extraPointsBox(site) {
  const box = h('div', { style: 'margin:10px 0' }, h('label', {}, 'Weitere Punkte (von der App gelernt)'));
  for (const p of site.extra_points) {
    const row = h(
      'div',
      { class: 'row', style: 'align-items:center;gap:8px;margin:4px 0' },
      h('a', { href: `https://www.google.com/maps?q=${p.lat},${p.lng}`, target: '_blank', rel: 'noopener' }, `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} ↗`),
      h(
        'button',
        {
          type: 'button',
          class: 'small',
          onclick: async () => {
            try {
              await api(`/sites/${site.id}/points/${p.id}`, { method: 'DELETE' });
              row.remove();
            } catch (ex) {
              alert(ex.message);
            }
          },
        },
        'Löschen',
      ),
    );
    box.append(row);
  }
  return box;
}

function customerDialog(c) {
  const name = h('input', { id: 'c-name2', value: c?.name ?? '', style: 'max-width:none' });
  const address = h('input', { id: 'c-addr', value: c?.address ?? '', placeholder: 'Straße Nr, PLZ Ort (Büro oder Rechnungsadresse)', style: 'max-width:none' });
  const email = h('input', { id: 'c-mail', value: c?.email ?? '', type: 'email', style: 'max-width:none' });
  const rate = h('input', { id: 'c-rate', value: showNum(c?.hourly_rate), inputmode: 'decimal', placeholder: 'zum Beispiel 55' });
  const err = h('p', { class: 'error' });
  const d = openDialog(
    h('h2', {}, c ? 'Kunde bearbeiten' : 'Neuer Kunde'),
    h('label', { for: 'c-name2' }, 'Name'),
    name,
    h('label', { for: 'c-addr' }, 'Adresse des Kunden'),
    address,
    h('label', { for: 'c-mail' }, 'E-Mail (für den Versand der Stundennachweise)'),
    email,
    h('label', { for: 'c-rate' }, 'Stundensatz in Euro'),
    rate,
    err,
    h(
      'div',
      { class: 'actions', style: 'margin-top:14px' },
      h(
        'button',
        {
          class: 'primary',
          onclick: async () => {
            const r = num(rate.value);
            if (Number.isNaN(r)) return (err.textContent = 'Der Stundensatz muss eine Zahl sein.');
            try {
              await api(c ? `/customers/${c.id}` : '/customers', { method: c ? 'PATCH' : 'POST', body: { name: name.value, address: address.value, email: email.value, hourly_rate: r } });
              d.close();
              route();
            } catch (ex) {
              err.textContent = ex.message;
            }
          },
        },
        'Speichern',
      ),
      h('button', { onclick: () => d.close() }, 'Abbrechen'),
    ),
  );
  name.focus();
}

// --- Tagesansicht ----------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtDateTime = (ms) => new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
function fmtDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(min / 60)}:${pad2(min % 60)} h`;
}

// Zeichnet den Weg als einfache Linie (ohne Kartendienst), Nord ist oben.
function trackSvg(points, sites = []) {
  const W = 640;
  const H = 340;
  const P = 24;
  if (points.length === 0) return h('p', { class: 'hint' }, 'Keine GPS-Punkte für diesen Tag.');
  const mPerDeg = 111195;
  const near = sites.filter((s) => s.lat != null && s.lng != null && points.some((p) => Math.hypot((p.lat - s.lat) * mPerDeg, (p.lng - s.lng) * mPerDeg * Math.cos((s.lat * Math.PI) / 180)) < 1500));
  const lats = [...points.map((p) => p.lat), ...near.flatMap((s) => [s.lat - s.radius_m / mPerDeg, s.lat + s.radius_m / mPerDeg])];
  const lngs = [...points.map((p) => p.lng), ...near.flatMap((s) => [s.lng - s.radius_m / mPerDeg, s.lng + s.radius_m / mPerDeg])];
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const spanX = Math.max((maxLng - minLng) * k, 1e-5);
  const spanY = Math.max(maxLat - minLat, 1e-5);
  const scale = Math.min((W - 2 * P) / spanX, (H - 2 * P) / spanY);
  const x = (lng) => P + ((lng - minLng) * k - 0) * scale + ((W - 2 * P) - spanX * scale) / 2;
  const y = (lat) => P + (maxLat - lat) * scale + ((H - 2 * P) - spanY * scale) / 2;
  const line = points.map((p) => `${x(p.lng).toFixed(1)},${y(p.lat).toFixed(1)}`).join(' ');
  const circles = near.flatMap((s) => [
    svg('circle', { cx: x(s.lng), cy: y(s.lat), r: Math.max(4, (s.radius_m / mPerDeg) * scale), fill: s.color, 'fill-opacity': 0.18, stroke: s.color, 'stroke-width': 2 }),
    svg('text', { x: x(s.lng), y: y(s.lat) + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#1b1c1e' }, s.name),
  ]);
  const first = points[0];
  const last = points[points.length - 1];
  return svg(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'track', role: 'img', 'aria-label': 'Gefahrener Weg' },
    svg('rect', { width: W, height: H, rx: 10, fill: '#f2f3f4' }),
    ...circles,
    svg('polyline', { points: line, fill: 'none', stroke: '#2b2d31', 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    svg('circle', { cx: x(first.lng), cy: y(first.lat), r: 7, fill: '#1f8a3b', stroke: '#fff', 'stroke-width': 2 }),
    svg('circle', { cx: x(last.lng), cy: y(last.lat), r: 7, fill: '#c62828', stroke: '#fff', 'stroke-width': 2 }),
  );
}



// --- Zeitbalken (senkrecht): Baustellen in ihrer Farbe, Fahrten gelb mit Transporter ------------
const PX_PER_MIN = 1.25;
const MIN_TRAVEL_MS = 2 * 60000;

function vanIcon(size = 26) {
  return svg(
    'svg',
    { viewBox: '0 0 34 20', width: size, height: size * (20 / 34), 'aria-hidden': 'true', style: 'flex:none' },
    svg('rect', { x: 1, y: 2, width: 19, height: 12, rx: 2, fill: '#4B5159' }),
    svg('path', { d: 'M20 5h6.2l5.3 4.2V14H20z', fill: '#4B5159' }),
    svg('path', { d: 'M22 6.8h3.6l3 2.4H22z', fill: '#F5C400' }),
    svg('circle', { cx: 8, cy: 15.5, r: 3, fill: '#4B5159', stroke: '#F5C400', 'stroke-width': 1.5 }),
    svg('circle', { cx: 26, cy: 15.5, r: 3, fill: '#4B5159', stroke: '#F5C400', 'stroke-width': 1.5 }),
  );
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

// Macht aus den Abschnitten die Blöcke des Tages. Die Zeit dazwischen ist Fahrt.
function buildBlocks(day, siteById) {
  const end = day.ended_at ?? Date.now();
  const segs = [...(day.segments ?? [])]
    .filter((s) => s.kind !== 'travel') // „Weiter wie Fahrt“ am Handy: zählt einfach als Fahrt
    .sort((a, b) => a.started_at - b.started_at)
    .map((s) => ({ ...s, ended_at: s.ended_at ?? end }));
  const out = [];
  let cursor = day.started_at;
  for (const s of segs) {
    if (s.started_at - cursor >= MIN_TRAVEL_MS) {
      out.push({ type: 'travel', label: out.length === 0 ? 'Anfahrt' : 'Fahrt', start: cursor, end: s.started_at });
    }
    const start = Math.max(s.started_at, cursor);
    out.push({ type: 'site', seg: s, site: s.site_id != null ? siteById.get(s.site_id) : null, start, end: Math.max(start, s.ended_at) });
    cursor = Math.max(cursor, s.ended_at);
  }
  if (end - cursor >= MIN_TRAVEL_MS) {
    out.push({ type: 'travel', label: !segs.length ? 'Unterwegs' : day.ended_at ? 'Heimfahrt' : 'Unterwegs', start: cursor, end });
  }
  assignTrips(out, day.trip_marks ?? [], siteById);
  return out;
}

// Eine Fahrt-Gruppe ist alles zwischen zwei Baustellen-Blöcken, was nicht Baustelle ist: Fahrten und Händler.
// Fährt man von Baustelle X weg und kommt zu X zurück, ist das automatisch eine Materialfahrt für X (Streifen in der Farbe von X).
// Der Chef kann pro Gruppe ändern: normale Fahrt, oder Materialfahrt für eine andere Baustelle.
const isHaendlerBlock = (b) => b.type === 'site' && b.site?.kind === 'haendler';
const isRunBlock = (b) => b.type === 'travel' || isHaendlerBlock(b);
function assignTrips(blocks, marks, siteById) {
  let i = 0;
  while (i < blocks.length) {
    if (!isRunBlock(blocks[i])) { i += 1; continue; }
    let j = i;
    while (j < blocks.length && isRunBlock(blocks[j])) j += 1;
    const prev = blocks[i - 1];
    const next = blocks[j];
    const real = (b) => b && b.type === 'site' && b.site && !b.site.system && b.site.kind !== 'haendler';
    const auto = real(prev) && real(next) && prev.site.id === next.site.id ? prev.site : null;
    const key = blocks[i].start;
    const mark = marks.find((m) => m.started_at === key) ?? null;
    const isPrivate = mark?.mode === 'private';
    const material = mark ? (mark.mode === 'material' ? siteById.get(mark.site_id) ?? null : null) : auto;
    // Anfahrt: Fahrt, die bei einer Baustelle endet. Heimfahrt: Fahrt, die bei einer Baustelle beginnt und nicht an einer anderen endet.
    const anfahrtSite = !material && !mark && real(next) ? next.site : null;
    const heimSite = !material && !mark && !anfahrtSite && real(prev) ? prev.site : null;
    for (let k = i; k < j; k += 1) {
      const b = blocks[k];
      let target = null;
      let note = '';
      if (material) { target = material; note = `Material für ${material.name}`; }
      else if (b.type === 'travel' && anfahrtSite) { target = anfahrtSite; note = `Anfahrt zu ${anfahrtSite.name}`; }
      else if (b.type === 'travel' && heimSite) { target = heimSite; note = `Heimfahrt von ${heimSite.name}`; }
      b.trip = { key, target: material, auto, mark };
      b.isPrivate = isPrivate;
      b.stripeTarget = target;
      b.stripeNote = note;
    }
    i = j;
  }
}

function timelineView(day, siteById, onTrip) {
  const blocks = buildBlocks(day, siteById);
  if (!blocks.length) return h('p', { class: 'hint' }, 'Noch keine Zeit gebucht.');
  const t0 = Math.floor(day.started_at / 3600000) * 3600000;
  const tEnd = Math.max(...blocks.map((b) => b.end), day.started_at + 3600000);
  const totalMin = (Math.ceil(tEnd / 3600000) * 3600000 - t0) / 60000;
  const box = h('div', { class: 'timeline' });
  for (let m = 0; m <= totalMin; m += 60) {
    box.append(h('div', { class: 'hour', style: `top:${Math.round(m * PX_PER_MIN)}px` }, h('span', {}, fmtTime(t0 + m * 60000))));
  }
  // Kurze Blöcke werden mindestens so hoch gezeichnet, dass man sie lesen kann, und schieben die nächsten ein Stück nach unten.
  let prevBottom = -Infinity;
  for (const b of blocks) {
    const top = Math.max(Math.round(((b.start - t0) / 60000) * PX_PER_MIN), prevBottom + 2);
    const height = Math.max(20, Math.round(((b.end - b.start) / 60000) * PX_PER_MIN) - 2);
    prevBottom = top + height;
    const dur = fmtDuration(b.end - b.start);
    const times = `${fmtTime(b.start)} bis ${fmtTime(b.end)}`;
    const stripe = b.stripeTarget ?? null;
    const priv = b.isPrivate ? 'background:#B8BCC2;color:#1B1C1E;' : '';
    const stripeStyle = stripe ? `background:repeating-linear-gradient(135deg,#F5C400 0 12px,${stripe.color} 12px 24px);color:#1B1C1E;` : '';
    const tripNote = b.isPrivate ? ' · Privatfahrt' : stripe ? ` · ${b.stripeNote}` : '';
    const clickable = onTrip && b.trip ? { class: 'clickable', title: 'Klicken: Fahrt ändern', onclick: () => onTrip(b.trip) } : {};
    if (b.type === 'travel') {
      box.append(
        h('div', { ...clickable, class: `block travel${stripe ? ' striped' : ''}${clickable.class ? ' clickable' : ''}`, style: `top:${top}px;height:${height}px;${priv || stripeStyle}` }, vanIcon(), h('div', {}, h('strong', { class: stripe ? 'on-stripe' : '' }, `${b.label} · ${dur}${tripNote}`), height >= 44 ? h('div', { class: `small${stripe ? ' on-stripe' : ''}` }, times) : null)),
      );
    } else if (isHaendlerBlock(b)) {
      box.append(
        h('div', { ...clickable, class: `block site${stripe ? ' striped' : ''}${clickable.class ? ' clickable' : ''}`, style: `top:${top}px;height:${height}px;${priv || (stripe ? stripeStyle : `background:${b.site.color};color:#FFFFFF;`)}` }, h('div', {}, h('strong', { class: stripe ? 'on-stripe' : '' }, `${b.site.name} · ${dur}${tripNote}`), height >= 44 ? h('div', { class: `small${stripe ? ' on-stripe' : ''}` }, `${times} · Händler`) : null)),
      );
    } else {
      const color = b.site?.color ?? '#B8BCC2';
      const fg = isLight(color) ? '#1B1C1E' : '#FFFFFF';
      const name = b.seg.kind === 'break' ? 'Pause' : b.seg.kind === 'private' ? 'Privat' : b.site?.name ?? 'Ohne Baustelle';
      box.append(
        h(
          'div',
          { class: 'block site', style: `top:${top}px;height:${height}px;background:${color};color:${fg}` },
          h('div', {}, h('strong', {}, `${name} · ${dur}`), height >= 44 ? h('div', { class: 'small' }, `${times}${b.site?.customer_name ? ` · ${b.site.customer_name}` : ''}${b.seg.source === 'auto' ? ' · automatisch' : ''}`) : null),
        ),
      );
    }
  }
  box.style.height = `${Math.max(Math.round(totalMin * PX_PER_MIN), prevBottom + 4)}px`;
  return box;
}

const KIND_LABEL = { work: 'Arbeit', travel: 'Anfahrt', private: 'Privat', break: 'Pause' };
const KIND_COLOR = { travel: '#F5C400', private: '#B8BCC2', break: '#B8BCC2' };

// Zeitabschnitte eines Tages: wo von wann bis wann gearbeitet wurde.
function segmentList(day, siteById) {
  if (!day.segments?.length) return h('p', { class: 'hint' }, 'Noch keine Baustelle gewählt.');
  const rows = day.segments.map((s) => {
    const site = s.site_id != null ? siteById.get(s.site_id) : null;
    const end = s.ended_at ?? Date.now();
    const color = site?.color ?? KIND_COLOR[s.kind] ?? '#B8BCC2';
    return h(
      'tr',
      {},
      h('td', {}, h('span', { class: 'dot', style: `background:${color}` })),
      h('td', {}, h('strong', {}, site?.name ?? KIND_LABEL[s.kind] ?? s.kind), site?.customer_name ? h('span', { class: 'hint' }, ` · ${site.customer_name}`) : null),
      h('td', {}, `${fmtTime(s.started_at)} bis ${s.ended_at ? fmtTime(s.ended_at) : 'läuft noch'}`),
      h('td', {}, fmtDuration(end - s.started_at)),
      h('td', {}, s.source === 'auto' ? 'automatisch' : 'von Hand'),
    );
  });
  return h('table', { style: 'margin:6px 0 10px' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Baustelle'), h('th', {}, 'Zeit'), h('th', {}, 'Dauer'), h('th', {}, 'Wie'))), h('tbody', {}, rows));
}

// Fahrt ändern: Streifen wegnehmen, als Materialfahrt einer Baustelle zuordnen (dem Bauherrn berechnen) oder als Privatfahrt markieren.
function tripDialog(day, trip, sites) {
  const targets = sites.filter((s) => s.kind !== 'haendler' && !s.system && !s.archived);
  const sel = h(
    'select',
    { id: 'trip-site', style: 'max-width:none' },
    ...targets.map((s) => h('option', { value: s.id, selected: s.id === (trip.target?.id ?? trip.auto?.id) }, s.name)),
  );
  const err = h('p', { class: 'error' });
  const save = async (body) => {
    try {
      await api(`/days/${day.id}/trip-mark`, { method: 'PUT', body: { started_at: trip.key, ...body } });
      d.close();
      route();
    } catch (ex) {
      err.textContent = ex.message;
    }
  };
  const state = trip.mark
    ? trip.mark.mode === 'private'
      ? 'Von dir als Privatfahrt eingestellt (nicht für den Kunden).'
      : trip.mark.mode === 'normal'
      ? 'Von dir als normale Fahrt eingestellt.'
      : `Von dir als Materialfahrt für ${trip.target?.name ?? '?'} eingestellt.`
    : trip.auto
      ? `Automatisch erkannt: Materialfahrt für ${trip.auto.name} (Start und Ziel waren dieselbe Baustelle).`
      : 'Normale Fahrt.';
  const d = openDialog(
    h('h2', {}, 'Fahrt ändern'),
    h('p', { class: 'hint' }, state),
    h('label', { for: 'trip-site' }, 'Materialfahrt für Baustelle'),
    sel,
    err,
    h(
      'div',
      { class: 'actions', style: 'margin-top:14px;flex-wrap:wrap' },
      h('button', { class: 'primary', disabled: !targets.length, onclick: () => save({ mode: 'material', site_id: Number(sel.value) }) }, 'Als Materialfahrt speichern'),
      h('button', { onclick: () => save({ mode: 'private' }) }, 'Privatfahrt (grau, nicht für den Kunden)'),
      h('button', { onclick: () => save({ mode: 'normal' }) }, 'Normale Fahrt (ohne Streifen)'),
      trip.mark ? h('button', { onclick: () => save({ mode: 'auto' }) }, 'Zurück auf automatisch') : null,
      h('button', { onclick: () => d.close() }, 'Abbrechen'),
    ),
  );
}

async function tagesansicht(main, userId, dateStr) {
  const users = await api('/users');
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error('Mitarbeiter nicht gefunden');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateStr ?? '') ? dateStr : toDateStr(new Date());
  const [yy, mm, dd] = date.split('-').map(Number);
  const from = new Date(yy, mm - 1, dd).getTime();
  const to = new Date(yy, mm - 1, dd + 1).getTime();
  const [days, sites, notes, photos, sheets] = await Promise.all([
    api(`/days?user_id=${userId}&from=${from}&to=${to}`),
    api('/sites?all=1'),
    api(`/notes?from=${date}&to=${date}&user_id=${userId}`).catch(() => []),
    api(`/photos?from=${from}&to=${to}&user_id=${userId}`).catch(() => []),
    api(`/sheets?from=${date}&to=${date}&user_id=${userId}`).catch(() => []),
  ]);
  const siteById = new Map(sites.map((x) => [x.id, x]));
  // Ort eines Fotos: der gespeicherte, sonst der Abschnitt, in dem es aufgenommen wurde.
  const photoSite = (p) => {
    if (p.site_id) return siteById.get(p.site_id)?.name;
    for (const d of days) for (const sg of d.segments ?? []) {
      if (sg.site_id && sg.started_at <= p.taken_at && p.taken_at <= (sg.ended_at ?? Date.now())) return siteById.get(sg.site_id)?.name;
    }
    return null;
  };
  const photoView = (p) => {
    const img = h('img', { alt: 'Foto', style: 'width:160px;height:120px;object-fit:cover;border-radius:8px;cursor:pointer;background:#eee' });
    const load = async () => {
      const res = await fetch(`/api/photos/${p.id}/file`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Foto nicht ladbar');
      return URL.createObjectURL(await res.blob());
    };
    load().then((u) => { img.src = u; img.onclick = () => window.open(u, '_blank'); }).catch(() => {});
    return h('div', { style: 'display:inline-block;margin:0 10px 10px 0;vertical-align:top' }, img,
      h('div', { class: 'hint' }, `${fmtTime(p.taken_at)}${photoSite(p) ? ' · ' + photoSite(p) : ''}`));
  };
  const sheetCard = sheets.length
    ? (() => {
        const sh = sheets[0];
        const paid = Math.max(0, sh.end - sh.start - sh.pause_min * 60000);
        const kmPriv = sh.lines.filter((l) => l.kind === 'travel' && l.vehicle === 'privat').reduce((a, l) => a + (l.km ?? 0), 0);
        const label = (l) => (l.kind === 'work' ? siteById.get(l.site_id)?.name ?? 'Baustelle' : { travel: 'Fahrt', break: 'Pause', private: 'Privat' }[l.kind]);
        return h('div', { class: 'card' },
          h('h2', {}, `Zettel vom Mitarbeiter · ${fmtTime(sh.start)} bis ${fmtTime(sh.end)}`),
          h('p', { class: 'hint' }, `Abgegeben ${fmtTime(sh.submitted_at)} Uhr`),
          h('table', {}, h('tbody', {}, ...sh.lines.map((l) => h('tr', {},
            h('td', {}, `${fmtTime(l.from)} bis ${fmtTime(l.to)}`),
            h('td', {}, label(l)),
            h('td', {}, l.kind === 'travel' ? (l.vehicle === 'firma' ? 'Firmenauto' : 'Privatauto') : ''),
            h('td', {}, l.kind === 'travel' && l.km != null ? `${String(l.km).replace('.', ',')} km` : ''))))),
          h('p', {}, h('strong', {}, `Pause ${sh.pause_min} Min · bezahlt ${fmtDuration(paid)} · Privatauto ${kmPriv.toFixed(1).replace('.', ',')} km`)));
      })()
    : null;
  const notesCard = notes.length || photos.length
    ? h('div', { class: 'card' },
        h('h2', {}, 'Notizen und Fotos'),
        ...notes.map((n) => h('div', { style: 'margin:0 0 10px' },
          h('strong', {}, (n.kind === 'material' ? '📦 Material · ' : '') + (n.site_id ? siteById.get(n.site_id)?.name ?? 'Baustelle' : 'Ohne Baustelle')),
          h('div', { style: 'white-space:pre-wrap' }, n.text))),
        photos.length ? h('div', {}, ...photos.map(photoView)) : '')
    : null;

  const go = (offset) => {
    location.hash = `#/mitarbeiter/${userId}/${toDateStr(new Date(yy, mm - 1, dd + offset))}`;
  };
  const picker = h('input', {
    type: 'date',
    value: date,
    'aria-label': 'Datum',
    style: 'width:auto',
    onchange: (e) => e.target.value && (location.hash = `#/mitarbeiter/${userId}/${e.target.value}`),
  });

  const cards = days.length
    ? days.map((d) => {
        const end = d.ended_at ?? Date.now();
        return h(
          'div',
          { class: 'card' },
          h('h2', {}, `${fmtTime(d.started_at)} bis ${d.ended_at ? fmtTime(d.ended_at) : 'läuft noch'} · ${fmtDuration(end - d.started_at)}`),
          h('p', { class: 'hint' }, `${d.points.length} GPS-Punkte`),
          timelineView(d, siteById, (trip) => tripDialog(d, trip, sites)),
          h('details', { style: 'margin:10px 0' }, h('summary', {}, 'Abschnitte als Liste'), segmentList(d, siteById)),
          h('details', {}, h('summary', {}, 'Gefahrener Weg mit Baustellen, Lager und Firma (Kreise = Erkennungsradius)'), trackSvg(d.points, sites)),
        );
      })
    : [h('div', { class: 'card placeholder' }, 'An diesem Tag wurde nichts aufgezeichnet.')];
  if (sheetCard) cards.unshift(sheetCard);
  if (notesCard) cards.push(notesCard);

  main.replaceChildren(
    h('p', { class: 'hint' }, h('a', { href: '#/mitarbeiter' }, '← Alle Mitarbeiter')),
    h('h1', {}, user.name),
    h(
      'div',
      { class: 'actions', style: 'margin:10px 0 18px;align-items:center' },
      h('button', { onclick: () => go(-1) }, '← Vortag'),
      picker,
      h('button', { onclick: () => go(1) }, 'Nächster Tag →'),
      h('button', { onclick: () => (location.hash = `#/mitarbeiter/${userId}/${toDateStr(new Date())}`) }, 'Heute'),
    ),
    ...cards,
  );
}

// --- Einstellungen ---------------------------------------------------------
async function einstellungen(main) {
  const s = await api('/settings');
  const field = (label, id, value, extra = {}) =>
    h('div', {}, h('label', { for: id }, label), h('input', { id, value, inputmode: 'decimal', ...extra }));

  const ruleRows = h('div', { id: 'rules' });
  const addRule = (hours = '', min = '') => {
    const row = h(
      'div',
      { class: 'row', style: 'align-items:end;margin-bottom:6px' },
      h('div', {}, h('label', {}, 'Ab Stunden Arbeitszeit'), h('input', { class: 'r-h', value: showNum(hours), inputmode: 'decimal' })),
      h('div', {}, h('label', {}, 'Pause in Minuten'), h('input', { class: 'r-m', value: showNum(min), inputmode: 'decimal' })),
      h('div', { style: 'flex:0 0 auto' }, h('button', { type: 'button', class: 'small', onclick: () => row.remove() }, 'Entfernen')),
    );
    ruleRows.append(row);
  };
  s.break_rules.forEach(([hrs, m]) => addRule(hrs, m));

  const status = h('p', { class: 'hint', role: 'status' });
  const f = {
    name: h('input', { id: 'c-name', value: s.company.name }),
    address: h('input', { id: 'c-addr', value: s.company.address }),
    email: h('input', { id: 'c-mail', type: 'email', value: s.company.email ?? '' }),
  };

  const findFirma = h(
    'button',
    {
      type: 'button',
      class: 'small',
      onclick: async () => {
        status.className = 'hint';
        status.textContent = 'Sucht …';
        try {
          const hits = await api(`/geocode?q=${encodeURIComponent(f.address.value)}`);
          if (!hits.length) throw new Error('Zu dieser Adresse wurde nichts gefunden. Trage die Koordinaten von Hand ein.');
          $('firma-lat').value = showNum(Number(hits[0].lat.toFixed(6)));
          $('firma-lng').value = showNum(Number(hits[0].lng.toFixed(6)));
          status.className = 'hint ok';
          status.textContent = `Gefunden: ${hits[0].label}. Bitte prüfen und unten speichern.`;
        } catch (ex) {
          status.className = 'error';
          status.textContent = ex.message;
        }
      },
    },
    'Position aus der Firmenadresse suchen',
  );

  const sayStatus = (msg, kind) => {
    status.className = kind === 'error' ? 'error' : kind === 'ok' ? 'hint ok' : 'hint';
    status.textContent = msg;
  };
  const placeCard = (title, key, hint, extra = null) => {
    const latF = field('Breite (lat)', `${key}-lat`, showNum(s[key].lat));
    const lngF = field('Länge (lng)', `${key}-lng`, showNum(s[key].lng));
    const posBox = positionBox(latF.querySelector('input'), lngF.querySelector('input'), sayStatus);
    return h(
      'div',
      { class: 'card' },
      h('h2', {}, title),
      posBox,
      h('div', { class: 'row' }, latF, lngF, field('Radius in Metern', `${key}-r`, showNum(s[key].radius_m))),
      h('p', { class: 'hint' }, hint),
      extra,
    );
  };

  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        status.className = 'hint';
        status.textContent = 'Speichert …';
        const read = (id) => num($(id).value);
        const place = (key) => ({ lat: read(`${key}-lat`), lng: read(`${key}-lng`), radius_m: read(`${key}-r`) });
        for (const [key, label] of [['firma', 'Firma'], ['lager', 'Lager']]) {
          const pl = place(key);
          if (Number.isNaN(pl.lat) || Number.isNaN(pl.lng) || Number.isNaN(pl.radius_m)) {
            status.className = 'error';
            status.textContent = `${label}: Breite, Länge und Radius müssen Zahlen sein, zum Beispiel 47,96138.`;
            return;
          }
          if ((pl.lat === null) !== (pl.lng === null)) {
            status.className = 'error';
            status.textContent = `${label}: Breite und Länge nur zusammen eintragen oder beide leer lassen. ${pl.lat === null ? 'Die Breite fehlt.' : 'Die Länge fehlt.'}`;
            return;
          }
        }
        const rules = [...ruleRows.children].map((row) => [num(row.querySelector('.r-h').value), num(row.querySelector('.r-m').value)]);
        const body = {
          company: { name: f.name.value, address: f.address.value, email: f.email.value },
          firma: place('firma'),
          lager: place('lager'),
          site_radius_m: read('site-r'),
          unknown_place_minutes: read('unknown'),
          km_rate_customer: read('km-c'),
          km_rate_employee: read('km-e'),
          break_rules: rules,
        };
        try {
          await api('/settings', { method: 'PUT', body });
          status.className = 'hint ok';
          status.textContent = 'Gespeichert.';
        } catch (ex) {
          status.className = 'error';
          status.textContent = ex.message;
        }
      },
    },
    h('div', { class: 'card' }, h('h2', {}, 'Firma'), h('label', { for: 'c-name' }, 'Name'), f.name, h('label', { for: 'c-addr' }, 'Adresse'), f.address, h('label', { for: 'c-mail' }, 'E-Mail (steht oben rechts im Kundenbericht)'), f.email),
    placeCard('Firma (Keltenstraße 31) – Standort', 'firma', 'Hier gilt als Start der Anfahrt zu den Kunden. Die App erkennt die Firma als festen Ort, wenn die Position eingetragen ist.', findFirma),
    placeCard('Lager Pöcking – Standort', 'lager', 'Link aus Google Maps oder Koordinaten („47.96138, 11.30548“) oben ins Feld Position einfügen.'),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Baustellen und Fahrten'),
      h('div', { class: 'row' }, field('Radius einer Baustelle (m)', 'site-r', showNum(s.site_radius_m)), field('Nachfragen nach (Minuten) an unbekanntem Ort', 'unknown', showNum(s.unknown_place_minutes))),
      h('div', { class: 'row' }, field('Kilometersatz Kunde (€ pro km)', 'km-c', showNum(s.km_rate_customer)), field('Kilometergeld Mitarbeiter (€ pro km)', 'km-e', showNum(s.km_rate_employee))),
    ),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Automatische Pause (Wochennachweis und Lohnbericht)'),
      ruleRows,
      h('button', { type: 'button', class: 'small', onclick: () => addRule() }, 'Zeile hinzufügen'),
      h('p', { class: 'hint' }, 'Es gilt die längere Pause aus eingetragener Pause und dieser Staffel. Im Kundenbericht gibt es keinen Pausenabzug.'),
    ),
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Speichern')),
    status,
  );

  main.replaceChildren(h('h1', {}, 'Einstellungen'), h('p', { class: 'sub' }, 'Firma, Standorte, Pausenregel und Sätze.'), form);
  watchPair($('firma-lat'), $('firma-lng'), sayStatus);
  watchPair($('lager-lat'), $('lager-lng'), sayStatus);
}

// --- Start -----------------------------------------------------------------

// --- Belege: Eingangskorb und Material pro Baustelle -------------------------------------
async function belege(main, siteArg) {
  const sites = await api('/sites?all=1');
  const siteById = new Map(sites.map((x) => [x.id, x]));
  const choices = sites.filter((x) => x.kind !== 'haendler');
  const filterSel = h('select', { style: 'width:auto' },
    h('option', { value: '' }, 'Eingangskorb (ohne Baustelle)'),
    h('option', { value: 'all' }, 'Alle Belege'),
    ...choices.map((x) => h('option', { value: String(x.id) }, x.name + (x.customer_name ? ` · ${x.customer_name}` : ''))),
  );
  filterSel.value = siteArg ?? '';
  filterSel.onchange = () => (location.hash = `#/belege/${filterSel.value}`);
  const box = h('div', {});
  main.replaceChildren(
    h('h1', {}, 'Belege und Material'),
    h('p', { class: 'hint' }, 'Lieferscheine und Rechnungen, die am Handy gescannt wurden. Ordne sie Baustellen oder dem Lager zu. Ein Beleg kann auf mehrere Ziele aufgeteilt werden.'),
    h('div', { class: 'actions', style: 'margin:10px 0 18px;align-items:center' }, h('label', { style: 'margin:0' }, 'Anzeigen: '), filterSel),
    box,
  );
  const query = !siteArg ? '?unassigned=1' : siteArg === 'all' ? '' : `?site_id=${siteArg}`;
  const receipts = await api(`/receipts${query}`);

  const openFile = async (r) => {
    const res = await fetch(`/api/receipts/${r.id}/file`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return alert('Beleg nicht ladbar');
    window.open(URL.createObjectURL(await res.blob()), '_blank');
  };
  const editAllocs = (r) => {
    const rows = r.allocs.map((a) => ({ ...a }));
    const list = h('div', {});
    const draw = () => list.replaceChildren(...rows.map((a, i) => h('div', { style: 'display:flex;gap:8px;margin:6px 0;align-items:center' },
      (() => { const sel = h('select', {}, ...choices.map((x) => h('option', { value: String(x.id) }, x.name))); sel.value = String(a.site_id); sel.onchange = () => (a.site_id = Number(sel.value)); return sel; })(),
      h('input', { type: 'text', value: a.text ?? '', placeholder: 'Menge oder Notiz, zum Beispiel „10 von 20 Stück“', style: 'flex:1', oninput: (e) => (a.text = e.target.value) }),
      h('button', { type: 'button', class: 'small', onclick: () => { rows.splice(i, 1); draw(); } }, 'Entfernen'))));
    draw();
    const msg = h('p', { class: 'hint' });
    const dlg = openDialog(
      h('h2', {}, 'Beleg zuordnen'),
      h('p', { class: 'hint' }, `${fmtDateTime(r.taken_at)} · ${r.user_name}`),
      list,
      h('button', { type: 'button', onclick: () => { rows.push({ site_id: choices[0]?.id, text: '' }); draw(); } }, '+ Ziel hinzufügen'),
      msg,
      h('div', { class: 'actions', style: 'margin-top:12px' },
        h('button', { type: 'button', class: 'primary', onclick: async () => {
          try {
            await api(`/receipts/${r.id}/allocs`, { method: 'PUT', body: { allocs: rows.filter((a) => a.site_id).map((a) => ({ site_id: a.site_id, text: a.text ?? '' })) } });
            dlg?.close?.();
            route();
          } catch (err) { msg.className = 'error'; msg.textContent = err.message; }
        } }, 'Speichern'),
        h('button', { type: 'button', onclick: () => dlg?.close?.() }, 'Abbrechen')),
    );
  };
  const card = (r) => h('div', { class: 'card' },
    h('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' },
      h('strong', {}, `${fmtDateTime(r.taken_at)} · ${r.user_name}`),
      h('button', { type: 'button', class: 'small', onclick: () => openFile(r) }, r.ext === 'pdf' ? 'PDF öffnen' : 'Bild öffnen'),
      h('button', { type: 'button', class: 'small', onclick: () => editAllocs(r) }, r.allocs.length ? 'Zuordnung ändern' : 'Zuordnen'),
      h('button', { type: 'button', class: 'small', onclick: async () => { if (confirm('Diesen Beleg endgültig löschen?')) { await api(`/receipts/${r.id}`, { method: 'DELETE' }); route(); } } }, 'Löschen')),
    r.allocs.length
      ? h('ul', {}, ...r.allocs.map((a) => h('li', {}, h('strong', {}, siteById.get(a.site_id)?.name ?? 'Baustelle'), a.text ? ` – ${a.text}` : '')))
      : h('p', { class: 'hint' }, 'Noch keiner Baustelle zugeordnet.'));
  box.replaceChildren(
    ...(receipts.length ? receipts.map(card) : [h('div', { class: 'card placeholder' }, siteArg ? 'Keine Belege.' : 'Der Eingangskorb ist leer.')]),
  );

  // Material (Notizen „Material“) einer gewählten Baustelle
  if (siteArg && siteArg !== 'all') {
    const mat = await api(`/notes?from=2020-01-01&to=2100-01-01&kind=material&site_id=${siteArg}`);
    box.append(
      h('div', { class: 'card' },
        h('h2', {}, '📦 Material aus dem Lager (Notizen der Mitarbeiter)'),
        mat.length
          ? h('table', {}, h('tbody', {}, ...mat.map((n) => h('tr', {}, h('td', {}, n.date.split('-').reverse().join('.')), h('td', {}, n.user_name), h('td', { style: 'white-space:pre-wrap' }, n.text)))))
          : h('p', { class: 'hint' }, 'Keine Material-Notizen.')),
    );
  }
}

// --- Lohn und Kilometer: Berichte aus den abgegebenen Zetteln --------------------------
async function lohn(main) {
  const users = (await api('/users')).filter((u) => u.active && u.role !== 'admin');
  const today = new Date();
  const userSel = h('select', { id: 'lk-user' }, users.map((u) => h('option', { value: u.id }, u.name)));
  const typeSel = h('select', { id: 'lk-typ' }, h('option', { value: 'week' }, 'Woche'), h('option', { value: 'month' }, 'Monat'), h('option', { value: 'range' }, 'Von – Bis'));
  const dayIn = h('input', { id: 'lk-tag', type: 'date', value: ymd(today) });
  const monthIn = h('input', { id: 'lk-monat', type: 'month', value: `${today.getFullYear()}-${pad2(today.getMonth() + 1)}` });
  const fromIn = h('input', { id: 'lk-von', type: 'date', value: ymd(new Date(today.getFullYear(), today.getMonth(), 1)) });
  const toIn = h('input', { id: 'lk-bis', type: 'date', value: ymd(today) });
  const rateIn = h('input', { id: 'lk-satz', type: 'text', value: '0,30', style: 'width:80px' });
  const dayBox = h('div', {}, h('label', {}, 'Ein Tag aus der Woche'), dayIn);
  const monthBox = h('div', {}, h('label', {}, 'Monat'), monthIn);
  const rangeBox = h('div', {}, h('label', {}, 'Von'), fromIn, h('label', {}, 'Bis'), toIn);
  const result = h('div', {});
  const err = h('p', { class: 'error' });
  const sync = () => {
    dayBox.style.display = typeSel.value === 'week' ? '' : 'none';
    monthBox.style.display = typeSel.value === 'month' ? '' : 'none';
    rangeBox.style.display = typeSel.value === 'range' ? '' : 'none';
  };
  typeSel.onchange = sync;
  sync();

  const query = () => {
    const p = reportPeriod(typeSel.value, { day: dayIn.value, month: monthIn.value, from: fromIn.value, to: toIn.value });
    return `user_id=${userSel.value}&from=${p.from}&to=${p.to}`;
  };
  const rate = () => rateIn.value.trim().replace(',', '.') || '0.30';
  const deDay = (d) => d.split('-').reverse().join('.');
  const num = (n, d = 2) => Number(n).toFixed(d).replace('.', ',');
  const download = async (path, extra) => {
    err.textContent = '';
    try {
      const res = await fetch(`/api${path}?${query()}${extra}&format=xlsx`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Fehler beim Herunterladen');
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'Bericht.xlsx';
      const a = h('a', { href: URL.createObjectURL(await res.blob()), download: name });
      document.body.append(a); a.click(); a.remove();
    } catch (e) { err.textContent = e.message; }
  };
  const show = async () => {
    err.textContent = '';
    try {
      const q = query();
      const [pay, mil] = await Promise.all([api(`/reports/payroll?${q}`), api(`/reports/mileage?${q}&rate=${rate()}`)]);
      result.replaceChildren(
        h('div', { class: 'card' },
          h('h2', {}, `Lohnzettel · ${pay.user}`),
          pay.days.length
            ? h('table', {}, h('thead', {}, h('tr', {}, ...['Datum', 'Beginn', 'Ende', 'Pause (Min)', 'Bezahlt (Std)'].map((t) => h('th', {}, t)))),
                h('tbody', {}, ...pay.days.map((d) => h('tr', {}, h('td', {}, deDay(d.date)), h('td', {}, fmtTime(d.start)), h('td', {}, fmtTime(d.end)), h('td', {}, String(d.pause_min)), h('td', {}, num(d.paid_hours)))),
                  h('tr', {}, h('td', {}, h('strong', {}, 'Summe')), h('td', {}), h('td', {}), h('td', {}), h('td', {}, h('strong', {}, num(pay.total_hours))))))
            : h('p', { class: 'hint' }, 'In diesem Zeitraum wurden keine Zettel abgegeben.'),
          h('button', { type: 'button', onclick: () => download('/reports/payroll', '') }, 'Excel herunterladen')),
        h('div', { class: 'card' },
          h('h2', {}, `Kilometergeld · ${mil.user}`),
          mil.rows.length
            ? h('table', {}, h('thead', {}, h('tr', {}, ...['Datum', 'Von', 'Bis', 'Strecke', 'Kilometer', 'Betrag (€)'].map((t) => h('th', {}, t)))),
                h('tbody', {}, ...mil.rows.map((r) => h('tr', {}, h('td', {}, deDay(r.date)), h('td', {}, fmtTime(r.from_time)), h('td', {}, fmtTime(r.to_time)), h('td', {}, r.route), h('td', {}, num(r.km, 1)), h('td', {}, num(r.amount)))),
                  h('tr', {}, h('td', {}, h('strong', {}, 'Summe')), h('td', {}), h('td', {}), h('td', {}), h('td', {}, h('strong', {}, num(mil.total_km, 1))), h('td', {}, h('strong', {}, num(mil.total_amount))))))
            : h('p', { class: 'hint' }, 'Keine Fahrten mit dem Privatauto in diesem Zeitraum.'),
          h('button', { type: 'button', onclick: () => download('/reports/mileage', `&rate=${rate()}`) }, 'Excel herunterladen')),
      );
    } catch (e) { err.textContent = e.message; result.replaceChildren(); }
  };
  main.replaceChildren(
    h('h1', {}, 'Lohn und Kilometer'),
    h('p', { class: 'hint' }, 'Berechnet aus den Zetteln, die deine Mitarbeiter abgegeben haben. Die Pause ist die Pause auf dem Zettel.'),
    h('div', { class: 'card' },
      h('div', { class: 'form-row' }, h('div', {}, h('label', {}, 'Mitarbeiter'), userSel), h('div', {}, h('label', {}, 'Zeitraum'), typeSel), dayBox, monthBox, rangeBox,
        h('div', {}, h('label', {}, 'Euro pro Kilometer'), rateIn)),
      h('div', { class: 'actions', style: 'margin-top:12px' }, h('button', { type: 'button', class: 'primary', onclick: show }, 'Anzeigen')),
      err),
    result,
  );
  if (users.length) show();
}

Object.assign(pages, { mitarbeiter, kunden, berichte, statistik, einstellungen, belege, lohn });

(async function init() {
  token = storage('get', 'spur-token');
  if (token) {
    try {
      me = await api('/me');
      if (me.role === 'admin') return startShell();
    } catch {
      /* Anmeldung abgelaufen */
    }
  }
  signOutLocally();
})();

// Installierbar machen (Symbol auf dem Desktop).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
