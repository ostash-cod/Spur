// Kundenbericht (Stundennachweis) als PDF.
// Aufbau laut Auftrag „Kundenbericht“: pro Tag eine Datumszeile und eine Blockzeile (alle Namen untereinander
// in einer Zelle, die Werte Zeile für Zeile daneben, die Tagesnotiz einmal oben in der Zelle).
import PDFDocument from 'pdfkit';

const TZ = 'Europe/Berlin';
const DAY_MS = 86400000;
const WEEKDAYS = ['Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.', 'So.'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// --- Datum und Zahlen -------------------------------------------------------
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const numFmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const dateKey = (ms) => dateFmt.format(ms); // 2026-05-26 (Ortszeit)
export const clock = (ms) => timeFmt.format(ms); // 07:15
const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const keyOf = (utcMs) => new Date(utcMs).toISOString().slice(0, 10);
export const isDateKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && keyOf(parseKey(k)) === k;
export const dmy = (k) => k.split('-').reverse().join('.');
const weekdayOf = (k) => (new Date(parseKey(k)).getUTCDay() + 6) % 7; // 0 = Montag
export const daysBetween = (from, to) => {
  const out = [];
  for (let t = parseKey(from); t <= parseKey(to); t += DAY_MS) out.push(keyOf(t));
  return out;
};
export function isoWeek(k) {
  const d = new Date(parseKey(k));
  d.setUTCDate(d.getUTCDate() - weekdayOf(k) + 3); // Donnerstag derselben Woche
  const year = d.getUTCFullYear();
  const week1 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d - week1) / DAY_MS - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}
export function periodLabel(type, from, to) {
  if (type === 'week') {
    const { year, week } = isoWeek(from);
    return `KW ${week}/${year}`;
  }
  if (type === 'month') {
    const [y, m] = from.split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
  }
  return `${dmy(from)} – ${dmy(to)}`;
}
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
export const fmtH = (h) => `${numFmt.format(h)} h`;
export const fmtEur = (e) => `${numFmt.format(e)} €`;

export const DEFAULT_OPTIONS = {
  // Spalten (Häkchen). Der Satz steht standardmäßig einmal im Kopf, nicht in der Spalte.
  cols: { names: true, times: true, pause: true, brutto: true, netto: true, rate: false, amount: true, note: true },
  rate_head: true,
  totals: true,
  zero_days: false, // Tage ohne Arbeit zeigen
  weekend_color: true,
  round_minutes: 0, // 0, 5, 10 oder 15 (aufrunden)
  orientation: 'auto', // auto, portrait, landscape
};

function mergeOptions(input = {}) {
  const o = { ...DEFAULT_OPTIONS, ...input, cols: { ...DEFAULT_OPTIONS.cols, ...(input.cols ?? {}) } };
  for (const k of Object.keys(DEFAULT_OPTIONS.cols)) o.cols[k] = !!o.cols[k];
  for (const k of ['rate_head', 'totals', 'zero_days', 'weekend_color']) o[k] = !!o[k];
  o.round_minutes = [5, 10, 15].includes(Number(o.round_minutes)) ? Number(o.round_minutes) : 0;
  if (!['auto', 'portrait', 'landscape'].includes(o.orientation)) o.orientation = 'auto';
  return o;
}

// --- Berechnung ---------------------------------------------------------------
// segments: Arbeitsabschnitte beim Kunden [{ userId, name, start, end }] (Millisekunden)
// breaks: Pausen [{ userId, start, end }], notes: { 'YYYY-MM-DD': 'Text' }
export function buildReportModel({ segments, breaks = [], customer, rate = null, issuer = {}, type = 'range', from, to, options, notes = {} }) {
  const o = mergeOptions(options);
  const step = o.round_minutes;
  const days = new Map(); // Tag -> Mitarbeiter -> Werte
  for (const s of segments) {
    if (!(s.end > s.start)) continue;
    const k = dateKey(s.start);
    if (k < from || k > to) continue;
    if (!days.has(k)) days.set(k, new Map());
    const people = days.get(k);
    const p = people.get(s.userId) ?? { userId: s.userId, name: s.name, start: s.start, end: s.end, workMs: 0, breakMs: 0 };
    p.start = Math.min(p.start, s.start);
    p.end = Math.max(p.end, s.end);
    p.workMs += s.end - s.start;
    people.set(s.userId, p);
  }
  if (o.cols.pause) {
    for (const b of breaks) {
      const p = days.get(dateKey(b.start))?.get(b.userId);
      if (!p) continue;
      const overlap = Math.min(b.end, p.end) - Math.max(b.start, p.start);
      if (overlap > 0) p.breakMs += overlap;
    }
  }

  const rows = [];
  let nettoSum = 0;
  let amountSum = 0;
  for (const k of daysBetween(from, to)) {
    const people = [...(days.get(k)?.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    if (!people.length && !o.zero_days) continue;
    const persons = people.map((p) => {
      const workMin = p.workMs / 60000;
      const minutes = step ? Math.ceil(workMin / step - 1e-9) * step : Math.round(workMin);
      const netto = round2(minutes / 60);
      const pause = round2(Math.round(p.breakMs / 60000) / 60);
      const betrag = round2(netto * (rate ?? 0));
      nettoSum += netto;
      amountSum += betrag;
      return { name: p.name, von: clock(p.start), bis: clock(p.end), pause, brutto: round2(netto + pause), netto, satz: rate, betrag };
    });
    rows.push({ date: k, label: `${WEEKDAYS[weekdayOf(k)]} ${dmy(k)}`, weekday: weekdayOf(k), persons, note: notes[k] ?? '' });
  }
  return {
    customer,
    issuer,
    period: periodLabel(type, from, to),
    rate,
    rows,
    totals: { netto: round2(nettoSum), betrag: round2(amountSum) },
    options: o,
  };
}

// Daten aus der Datenbank holen (Ortszeit-Tage; ein Abschnitt zählt zum Tag seines Beginns).
export function loadCustomerSegments(db, customerId, from, to) {
  const lo = parseKey(from) - DAY_MS;
  const hi = parseKey(to) + 3 * DAY_MS;
  const rows = db
    .prepare(
      `SELECT s.kind AS kind, s.started_at AS start, s.ended_at AS end, d.user_id AS userId, u.name AS name, si.customer_id AS customerId
       FROM segments s
       JOIN days d ON d.id = s.day_id
       JOIN users u ON u.id = d.user_id
       LEFT JOIN sites si ON si.id = s.site_id
       WHERE s.started_at >= ? AND s.started_at < ? AND s.ended_at IS NOT NULL AND s.kind IN ('work','break')`,
    )
    .all(lo, hi);
  return {
    segments: rows.filter((r) => r.kind === 'work' && r.customerId === customerId),
    breaks: rows.filter((r) => r.kind === 'break'),
  };
}

export function reportFileName(model, type, from, to) {
  const street = String(model.customer.address ?? '').split(',')[0].trim();
  let when;
  if (type === 'range') when = `${dmy(from).slice(0, 6)} bis ${dmy(to)}`;
  else when = model.period.replace('/', ' ');
  const name = [model.customer.name, street, when].filter(Boolean).join(', ');
  return name.replace(/[\\/:*?"<>|]/g, '-');
}

// --- PDF ------------------------------------------------------------------------
const PAD = 4;
const P_LINE = 12; // Zeilenhöhe Namen und Werte
const N_LINE = 13; // Zeilenhöhe Notiz
const F_TEXT = 9;
const F_NOTE = 10;
const WEIGHTS = { name: 2.4, von: 0.9, bis: 0.9, pause: 1, brutto: 1, netto: 1, rate: 1.1, amount: 1.3, note: 3.3 };

function wrapText(doc, text, width) {
  const out = [];
  for (const para of String(text).split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (doc.widthOfString(test) <= width) {
        line = test;
        continue;
      }
      if (line) out.push(line);
      line = '';
      let rest = word;
      while (doc.widthOfString(rest) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && doc.widthOfString(rest.slice(0, n)) > width) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

export function renderReportPdf(model) {
  const o = model.options;
  const c = o.cols;
  const cols = [{ key: 'name', title: c.names ? 'Datum / Arbeitskraft' : 'Datum' }];
  if (c.times) cols.push({ key: 'von', title: 'Von' }, { key: 'bis', title: 'Bis' });
  if (c.pause) cols.push({ key: 'pause', title: 'Pause' });
  if (c.brutto) cols.push({ key: 'brutto', title: 'Brutto' });
  if (c.netto) cols.push({ key: 'netto', title: 'Netto' });
  if (c.rate) cols.push({ key: 'rate', title: 'Satz' });
  if (c.amount) cols.push({ key: 'amount', title: 'Betrag' });
  if (c.note) cols.push({ key: 'note', title: 'Notiz' });
  const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && cols.length >= 9);

  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    margins: { top: 36, left: 36, right: 36, bottom: 0 },
    bufferPages: true,
    info: { Title: `Stundennachweis ${model.period}`, Author: model.issuer.name ?? '' },
  });
  const chunks = [];
  doc.on('data', (d) => chunks.push(d));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const left = 36;
  const contentW = pageW - 72;
  const limit = pageH - 48; // unterer Rand der Tabelle
  const totalWeight = cols.reduce((s, col) => s + WEIGHTS[col.key], 0);
  let x = left;
  for (const col of cols) {
    col.w = (contentW * WEIGHTS[col.key]) / totalWeight;
    col.x = x;
    x += col.w;
  }
  const noteCol = cols.find((col) => col.key === 'note');
  const nameCol = cols[0];

  const setFont = (bold, size = F_TEXT) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor('#000');

  // --- Kopf des Berichts (nur Seite 1) ---
  const headTop = 36;
  const third = contentW / 3;
  let leftH = 0;
  let rightH = 0;
  setFont(true, 11);
  doc.text(model.customer.name ?? '', left, headTop, { width: third * 1.05 });
  leftH = doc.y - headTop;
  if (model.customer.address) {
    setFont(false, F_TEXT);
    doc.text(model.customer.address, left, doc.y + 1, { width: third * 1.05 });
    leftH = doc.y - headTop;
  }
  setFont(false, F_TEXT);
  const issuerText = [model.issuer.name, model.issuer.email].filter(Boolean).join('\n');
  if (issuerText) {
    doc.text(issuerText, left + contentW - third * 1.05, headTop, { width: third * 1.05, align: 'right' });
    rightH = doc.y - headTop;
  }
  setFont(true, 13);
  doc.text(model.period, left + third * 0.9, headTop, { width: contentW - third * 1.8, align: 'center' });
  let midH = doc.y - headTop;
  if (o.rate_head && model.rate != null) {
    setFont(false, F_TEXT);
    doc.text(`Stundensatz: ${fmtEur(model.rate)}`, left + third * 0.9, doc.y + 2, { width: contentW - third * 1.8, align: 'center' });
    midH = doc.y - headTop;
  }
  let y = headTop + Math.max(leftH, rightH, midH) + 16;

  // --- Tabelle ---
  const border = '#444444';
  const cell = (col, cy, h, fill, texts) => {
    doc.save().lineWidth(0.5).rect(col.x, cy, col.w, h).fillAndStroke(fill, border).restore();
    for (const t of texts) {
      setFont(t.bold, t.size ?? F_TEXT);
      // Ausrichtung selbst berechnen: Mit „width“ bricht pdfkit Zeilen von sich aus um und überdruckt die nächste.
      const w = doc.widthOfString(t.text);
      const align = t.align ?? 'left';
      const tx = align === 'right' ? col.x + col.w - PAD - w : align === 'center' ? col.x + (col.w - w) / 2 : col.x + PAD;
      doc.text(t.text, tx, cy + t.dy, { lineBreak: false });
    }
  };
  const drawRow = (cy, h, fill, perCol) => {
    for (const col of cols) cell(col, cy, h, fill, perCol(col) ?? []);
  };
  const HEAD_H = P_LINE + 2 * PAD;
  const tableHeader = () => {
    drawRow(y, HEAD_H, '#DCDCDC', (col) => [{ text: col.title, bold: true, align: 'center', dy: PAD }]);
    y += HEAD_H;
  };
  const newPage = () => {
    doc.addPage();
    y = 36;
    tableHeader();
  };
  tableHeader();

  const DATE_PAD = 3;
  const DATE_H = P_LINE + 2 * DATE_PAD;
  const valueText = (col, p) => {
    switch (col.key) {
      case 'name': return p.name;
      case 'von': return p.von;
      case 'bis': return p.bis;
      case 'pause': return fmtH(p.pause);
      case 'brutto': return fmtH(p.brutto);
      case 'netto': return fmtH(p.netto);
      case 'rate': return p.satz == null ? '' : fmtEur(p.satz);
      case 'amount': return fmtEur(p.betrag);
      default: return '';
    }
  };
  const alignOf = (col) => (col.key === 'name' || col.key === 'note' ? 'left' : col.key === 'von' || col.key === 'bis' ? 'center' : 'right');

  // Eine Datumszeile plus Blockzeile zeichnen. persons/noteLines können leer sein (Fortsetzung).
  const drawDay = (row, fill, persons, noteLines, zero) => {
    drawRow(y, DATE_H, fill, (col) => (col.key === 'name' ? [{ text: row.label, bold: true, dy: DATE_PAD }] : []));
    y += DATE_H;
    const lines = Math.max(persons.length, 1, 0);
    const personsH = persons.length ? persons.length * P_LINE : zero ? P_LINE : 0;
    const noteH = noteLines.length * N_LINE;
    const blockH = Math.max(personsH, noteH, P_LINE) + 2 * PAD;
    drawRow(y, blockH, fill, (col) => {
      if (col.key === 'note') {
        return noteLines.map((t, i) => ({ text: t, size: F_NOTE, dy: PAD + i * N_LINE }));
      }
      if (zero) {
        if (col.key === 'netto') return [{ text: fmtH(0), align: 'right', dy: PAD }];
        if (col.key === 'amount') return [{ text: fmtEur(0), align: 'right', dy: PAD }];
        return [];
      }
      return persons.map((p, i) => ({ text: valueText(col, p), align: alignOf(col), dy: PAD + i * P_LINE }));
    });
    void lines;
    y += blockH;
  };

  let dayIndex = 0;
  for (const row of model.rows) {
    const weekend = o.weekend_color && row.weekday >= 5;
    const fill = weekend ? '#F9D6DC' : dayIndex % 2 === 0 ? '#FFFFFF' : '#EFEFEF';
    dayIndex++;
    setFont(false, F_NOTE);
    const noteLines = noteCol && row.note ? wrapText(doc, row.note, noteCol.w - 2 * PAD - 1) : [];
    const zero = row.persons.length === 0;
    const personsH = zero ? P_LINE : row.persons.length * P_LINE;
    const blockH = Math.max(personsH, noteLines.length * N_LINE, P_LINE) + 2 * PAD;
    const need = DATE_H + blockH;
    if (y + need <= limit) {
      drawDay(row, fill, row.persons, noteLines, zero);
      continue;
    }
    const bodyH = limit - (36 + HEAD_H);
    if (need <= bodyH) {
      newPage();
      drawDay(row, fill, row.persons, noteLines, zero);
      continue;
    }
    // Der Block ist länger als eine ganze Seite: die Notiz wird auf mehrere Seiten verteilt, das Datum wiederholt sich.
    let rest = noteLines;
    let first = true;
    while (true) {
      let avail = limit - y - DATE_H - 2 * PAD;
      const minLines = first ? Math.ceil(personsH / N_LINE) + 1 : 2;
      if (avail < minLines * N_LINE) {
        newPage();
        avail = limit - y - DATE_H - 2 * PAD;
      }
      const take = Math.max(1, Math.floor(avail / N_LINE));
      drawDay(row, fill, first ? row.persons : [], rest.slice(0, take), first && zero);
      rest = rest.slice(take);
      if (!rest.length) break;
      first = false;
      newPage();
    }
  }

  // --- Gesamtsumme ---
  if (o.totals) {
    const h = P_LINE + 2 * PAD;
    if (y + h > limit) newPage();
    drawRow(y, h, '#FFFFFF', (col) => {
      if (col === nameCol) return [{ text: 'Gesamtsumme', bold: true, dy: PAD }];
      if (col.key === 'netto') return [{ text: fmtH(model.totals.netto), bold: true, align: 'right', dy: PAD }];
      if (col.key === 'amount') return [{ text: fmtEur(model.totals.betrag), bold: true, align: 'right', dy: PAD }];
      return [];
    });
    y += h;
  }

  // --- Seitenzahlen ---
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    setFont(false, 8);
    doc.fillColor('#666666').text(`Seite ${i + 1} von ${range.count}`, left, pageH - 30, { width: contentW, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
