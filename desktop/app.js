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

  const siteRows = visibleSites.map((s) =>
    h(
      'tr',
      { class: s.archived ? 'inaktiv' : '' },
      h('td', {}, h('span', { class: 'dot', style: `background:${s.color}`, title: s.color })),
      h('td', {}, h('strong', {}, s.name), s.system ? h('span', { class: 'badge', style: 'margin-left:6px' }, 'fester Ort') : null),
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
        h('button', { class: 'small danger', onclick: () => deleteWithConfirm('Baustelle', s, `/sites/${s.id}`) }, 'Löschen'),
      ),
    ),
  );

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

function siteDialog(site, customers) {
  const s = site ?? {};
  const byId = new Map(customers.map((c) => [c.id, c]));
  const name = h('input', { id: 's-name', value: s.name ?? '', placeholder: 'zum Beispiel Lilienstraße 77', style: 'max-width:none' });
  const cust = h(
    'select',
    { id: 's-cust', style: 'max-width:none', onchange: () => updateCustomerUi() },
    h('option', { value: '' }, '– kein Kunde –'),
    customers.filter((c) => !c.archived || c.id === s.customer_id).map((c) => h('option', { value: c.id, selected: c.id === s.customer_id }, c.name)),
  );
  const copyAddr = h('button', { type: 'button', class: 'small', style: 'margin-top:6px', onclick: () => { const c = byId.get(Number(cust.value)); if (c?.address) { addr.value = c.address; searchNow(true); } } }, 'Adresse vom Kunden übernehmen');
  const autoCust = h('input', { type: 'checkbox', id: 's-autocust' });
  const autoCustRow = h('label', { class: 'check' }, autoCust, 'Kunde mit gleichem Namen anlegen');
  const addr = h('input', { id: 's-addr', value: s.address ?? '', placeholder: 'Straße Nr, PLZ Ort', style: 'max-width:none', oninput: () => scheduleSearch(), onblur: () => searchNow(false) });
  const lat = h('input', { id: 's-lat', value: showNum(s.lat), inputmode: 'decimal', placeholder: '48,12345', oninput: () => { manualCoords = true; } });
  const lng = h('input', { id: 's-lng', value: showNum(s.lng), inputmode: 'decimal', placeholder: '11,60123', oninput: () => { manualCoords = true; } });
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

  // Sucht die Koordinaten, sobald die Adresse eingegeben ist, und zeigt den Treffer zur Kontrolle.
  function scheduleSearch() {
    clearTimeout(timer);
    timer = setTimeout(() => searchNow(false), 1200);
  }
  async function searchNow(force) {
    clearTimeout(timer);
    const q = addr.value.trim();
    if (q.length < 6 || (!force && q === lastQuery)) return;
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
    h('h2', {}, site ? 'Baustelle bearbeiten' : 'Neue Baustelle'),
    h('label', { for: 's-name' }, 'Name der Baustelle'),
    name,
    h('label', { for: 's-cust' }, 'Kunde (optional)'),
    cust,
    autoCustRow,
    h('label', { for: 's-addr' }, 'Adresse der Baustelle'),
    addr,
    copyAddr,
    found,
    h('div', { class: 'row' }, h('div', {}, h('label', { for: 's-lat' }, 'Breite'), lat), h('div', {}, h('label', { for: 's-lng' }, 'Länge'), lng), h('div', {}, h('label', { for: 's-rad' }, 'Radius (m)'), rad)),
    h('p', { class: 'hint' }, 'Die Position wird aus der Adresse automatisch gesucht und kann von Hand geändert werden. Mit ihr erkennt die App die Ankunft. Ohne Radius gilt der Standard aus den Einstellungen.'),
    h('div', {}, h('button', { type: 'button', class: 'small', onclick: () => searchNow(true) }, 'Position erneut suchen')),
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
            const body = { name: name.value, customer_id: cust.value ? Number(cust.value) : null, address: addr.value, lat: la, lng: ln, radius_m: r };
            if (color) body.color = color;
            if (!site && !cust.value && autoCust.checked) body.create_customer = true;
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

const pad2 = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
  return out;
}

function timelineView(day, siteById) {
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
    if (b.type === 'travel') {
      box.append(
        h('div', { class: 'block travel', style: `top:${top}px;height:${height}px` }, vanIcon(), h('div', {}, h('strong', {}, `${b.label} · ${dur}`), height >= 44 ? h('div', { class: 'small' }, times) : null)),
      );
    } else {
      const color = b.site?.color ?? '#B8BCC2';
      const fg = isLight(color) ? '#1B1C1E' : '#FFFFFF';
      const name = b.site?.name ?? 'Ohne Baustelle';
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

async function tagesansicht(main, userId, dateStr) {
  const users = await api('/users');
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error('Mitarbeiter nicht gefunden');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateStr ?? '') ? dateStr : toDateStr(new Date());
  const [yy, mm, dd] = date.split('-').map(Number);
  const from = new Date(yy, mm - 1, dd).getTime();
  const to = new Date(yy, mm - 1, dd + 1).getTime();
  const [days, sites] = await Promise.all([api(`/days?user_id=${userId}&from=${from}&to=${to}`), api('/sites?all=1')]);
  const siteById = new Map(sites.map((x) => [x.id, x]));

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
          timelineView(d, siteById),
          h('details', { style: 'margin:10px 0' }, h('summary', {}, 'Abschnitte als Liste'), segmentList(d, siteById)),
          h('details', {}, h('summary', {}, 'Gefahrener Weg mit Baustellen, Lager und Firma (Kreise = Erkennungsradius)'), trackSvg(d.points, sites)),
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

  const placeCard = (title, key, hint, extra = null) =>
    h(
      'div',
      { class: 'card' },
      h('h2', {}, title),
      h('div', { class: 'row' }, field('Breite (lat)', `${key}-lat`, showNum(s[key].lat)), field('Länge (lng)', `${key}-lng`, showNum(s[key].lng)), field('Radius in Metern', `${key}-r`, showNum(s[key].radius_m))),
      h('p', { class: 'hint' }, hint),
      extra,
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
    placeCard('Firma (Keltenstraße 31) – Standort', 'firma', 'Hier gilt als Start der Anfahrt zu den Kunden. Die App erkennt die Firma als festen Ort, wenn die Position eingetragen ist.', findFirma),
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
