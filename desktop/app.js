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
const berichte = placeholder('Berichte', 'Kundenbericht, Wochennachweis, Lohnbericht und Kilometerblatt.', 'Schritt 5');
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
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Privatauto'), h('th', {}, 'Status'), h('th', {}, ''))),
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

async function kunden(main) {
  const [sites, customers] = await Promise.all([api('/sites?all=1'), api('/customers')]);
  const showArchived = sessionStorageGet('show-archived') === '1';
  const visibleSites = sites.filter((s) => showArchived || !s.archived);
  const visibleCustomers = customers.filter((c) => showArchived || !c.archived);

  const siteRows = visibleSites.map((s) =>
    h(
      'tr',
      { class: s.archived ? 'inaktiv' : '' },
      h('td', {}, h('span', { class: 'dot', style: `background:${s.color}`, title: s.color })),
      h('td', {}, h('strong', {}, s.name)),
      h('td', {}, s.customer_name ?? '–'),
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
      h(
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
      ),
    ),
  );

  const customerRows = visibleCustomers.map((c) =>
    h(
      'tr',
      { class: c.archived ? 'inaktiv' : '' },
      h('td', {}, h('strong', {}, c.name)),
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
      h('div', { class: 'actions', style: 'justify-content:space-between;align-items:center;margin-bottom:10px' }, h('h2', { style: 'margin:0' }, 'Kunden'), h('button', { onclick: () => customerDialog(null) }, 'Neuer Kunde')),
      customerRows.length
        ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Kunde'), h('th', {}, 'E-Mail'), h('th', {}, 'Stundensatz'), h('th', {}, ''))), h('tbody', {}, customerRows))
        : h('p', { class: 'hint' }, 'Noch kein Kunde angelegt. Ein Kunde ist optional, eine Baustelle geht auch ohne.'),
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

function siteDialog(site, customers) {
  const s = site ?? {};
  const name = h('input', { id: 's-name', value: s.name ?? '', placeholder: 'zum Beispiel Lilienstraße 77', style: 'max-width:none' });
  const cust = h(
    'select',
    { id: 's-cust', style: 'max-width:none' },
    h('option', { value: '' }, '– kein Kunde –'),
    customers.filter((c) => !c.archived || c.id === s.customer_id).map((c) => h('option', { value: c.id, selected: c.id === s.customer_id }, c.name)),
  );
  const addr = h('input', { id: 's-addr', value: s.address ?? '', placeholder: 'Straße Nr, PLZ Ort', style: 'max-width:none' });
  const lat = h('input', { id: 's-lat', value: showNum(s.lat), inputmode: 'decimal', placeholder: '48,12345' });
  const lng = h('input', { id: 's-lng', value: showNum(s.lng), inputmode: 'decimal', placeholder: '11,60123' });
  const rad = h('input', { id: 's-rad', value: s.radius_custom ? showNum(s.radius_m) : '', inputmode: 'decimal', placeholder: 'Standard' });
  const results = h('div', { style: 'margin-top:8px' });
  const err = h('p', { class: 'error' });
  let color = s.color ?? null;

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

  const search = h(
    'button',
    {
      type: 'button',
      onclick: async () => {
        err.textContent = '';
        results.replaceChildren(h('p', { class: 'hint' }, 'Sucht …'));
        try {
          const found = await api(`/geocode?q=${encodeURIComponent(addr.value)}`);
          results.replaceChildren(
            found.length
              ? h('div', {}, h('p', { class: 'hint' }, 'Treffer anklicken:'), ...found.map((f) => h('button', { type: 'button', class: 'small result', onclick: () => { lat.value = showNum(Number(f.lat.toFixed(6))); lng.value = showNum(Number(f.lng.toFixed(6))); results.replaceChildren(h('p', { class: 'hint ok' }, `Übernommen: ${f.label}`)); } }, f.label)))
              : h('p', { class: 'hint' }, 'Nichts gefunden. Trage die Koordinaten von Hand ein (in Google Maps mit der rechten Maustaste auf den Ort klicken).'),
          );
        } catch (ex) {
          results.replaceChildren();
          err.textContent = ex.message;
        }
      },
    },
    'Koordinaten suchen',
  );

  const d = openDialog(
    h('h2', {}, site ? 'Baustelle bearbeiten' : 'Neue Baustelle'),
    h('label', { for: 's-name' }, 'Name der Baustelle'),
    name,
    h('label', { for: 's-cust' }, 'Kunde (optional)'),
    cust,
    h('label', { for: 's-addr' }, 'Adresse'),
    addr,
    h('div', { style: 'margin-top:8px' }, search),
    results,
    h('div', { class: 'row' }, h('div', {}, h('label', { for: 's-lat' }, 'Breite'), lat), h('div', {}, h('label', { for: 's-lng' }, 'Länge'), lng), h('div', {}, h('label', { for: 's-rad' }, 'Radius (m)'), rad)),
    h('p', { class: 'hint' }, 'Mit den Koordinaten erkennt die App die Ankunft. Der Radius ist optional, ohne Eintrag gilt der Standard aus den Einstellungen.'),
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
            const body = {
              name: name.value,
              customer_id: cust.value ? Number(cust.value) : null,
              address: addr.value,
              lat: la,
              lng: ln,
              radius_m: r,
            };
            if (color) body.color = color;
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
  name.focus();
}

function customerDialog(c) {
  const name = h('input', { id: 'c-name2', value: c?.name ?? '', style: 'max-width:none' });
  const email = h('input', { id: 'c-mail', value: c?.email ?? '', type: 'email', style: 'max-width:none' });
  const rate = h('input', { id: 'c-rate', value: showNum(c?.hourly_rate), inputmode: 'decimal', placeholder: 'zum Beispiel 55' });
  const err = h('p', { class: 'error' });
  const d = openDialog(
    h('h2', {}, c ? 'Kunde bearbeiten' : 'Neuer Kunde'),
    h('label', { for: 'c-name2' }, 'Name'),
    name,
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
              await api(c ? `/customers/${c.id}` : '/customers', { method: c ? 'PATCH' : 'POST', body: { name: name.value, email: email.value, hourly_rate: r } });
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

const pad2 = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
function fmtDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(min / 60)}:${pad2(min % 60)} h`;
}

// Zeichnet den Weg als einfache Linie (ohne Kartendienst), Nord ist oben.
function trackSvg(points) {
  const W = 640;
  const H = 340;
  const P = 24;
  if (points.length === 0) return h('p', { class: 'hint' }, 'Keine GPS-Punkte für diesen Tag.');
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const spanX = Math.max((maxLng - minLng) * k, 1e-5);
  const spanY = Math.max(maxLat - minLat, 1e-5);
  const scale = Math.min((W - 2 * P) / spanX, (H - 2 * P) / spanY);
  const x = (lng) => P + ((lng - minLng) * k - 0) * scale + ((W - 2 * P) - spanX * scale) / 2;
  const y = (lat) => P + (maxLat - lat) * scale + ((H - 2 * P) - spanY * scale) / 2;
  const line = points.map((p) => `${x(p.lng).toFixed(1)},${y(p.lat).toFixed(1)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  return svg(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'track', role: 'img', 'aria-label': 'Gefahrener Weg' },
    svg('rect', { width: W, height: H, rx: 10, fill: '#f2f3f4' }),
    svg('polyline', { points: line, fill: 'none', stroke: '#2b2d31', 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    svg('circle', { cx: x(first.lng), cy: y(first.lat), r: 7, fill: '#1f8a3b', stroke: '#fff', 'stroke-width': 2 }),
    svg('circle', { cx: x(last.lng), cy: y(last.lat), r: 7, fill: '#c62828', stroke: '#fff', 'stroke-width': 2 }),
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
  const days = await api(`/days?user_id=${userId}&from=${from}&to=${to}`);

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
          trackSvg(d.points),
        );
      })
    : [h('div', { class: 'card placeholder' }, 'An diesem Tag wurde nichts aufgezeichnet.')];

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
  };

  const placeCard = (title, key, hint) =>
    h(
      'div',
      { class: 'card' },
      h('h2', {}, title),
      h('div', { class: 'row' }, field('Breite (lat)', `${key}-lat`, showNum(s[key].lat)), field('Länge (lng)', `${key}-lng`, showNum(s[key].lng)), field('Radius in Metern', `${key}-r`, showNum(s[key].radius_m))),
      h('p', { class: 'hint' }, hint),
    );

  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        status.className = 'hint';
        status.textContent = 'Speichert …';
        const read = (id) => num($(id).value);
        const place = (key) => ({ lat: read(`${key}-lat`), lng: read(`${key}-lng`), radius_m: read(`${key}-r`) });
        const rules = [...ruleRows.children].map((row) => [num(row.querySelector('.r-h').value), num(row.querySelector('.r-m').value)]);
        const body = {
          company: { name: f.name.value, address: f.address.value },
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
    h('div', { class: 'card' }, h('h2', {}, 'Firma'), h('label', { for: 'c-name' }, 'Name'), f.name, h('label', { for: 'c-addr' }, 'Adresse'), f.address),
    placeCard('Firma (Keltenstraße 31) – Standort', 'firma', 'Hier gilt als Start der Anfahrt zu den Kunden. Koordinaten noch leer: später am Handy vor Ort übernehmen oder aus Google Maps kopieren.'),
    placeCard('Lager Pöcking – Standort', 'lager', 'Koordinaten wie in Google Maps (mit Punkt oder Komma).'),
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
}

// --- Start -----------------------------------------------------------------
Object.assign(pages, { mitarbeiter, kunden, berichte, statistik, einstellungen });

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
