import { getSettings } from './db.js';
import { buildReportModel, isDateKey, daysBetween, loadCustomerSegments, renderReportPdf, reportFileName } from './report.js';

export function registerReportRoutes(app, { db, requireAdmin }) {
  // Kundenbericht als PDF. Body: { customer_id, type: 'week'|'month'|'range', from, to, options, download }
  app.post('/api/reports/customer', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body ?? {};
    const type = ['week', 'month', 'range'].includes(b.type) ? b.type : 'range';
    if (!isDateKey(b.from) || !isDateKey(b.to) || b.to < b.from) {
      return reply.code(400).send({ error: 'Zeitraum ungültig (von und bis als Datum)' });
    }
    if (daysBetween(b.from, b.to).length > 370) return reply.code(400).send({ error: 'Der Zeitraum darf höchstens ein Jahr lang sein' });
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(b.customer_id));
    if (!customer) return reply.code(404).send({ error: 'Kunde nicht gefunden' });

    const options = b.options ?? {};
    const rate = customer.hourly_rate ?? null;
    const wantsMoney = options.cols?.amount ?? true;
    if (rate == null && (wantsMoney || options.cols?.rate)) {
      return reply.code(400).send({
        error: 'Für diesen Kunden ist noch kein Stundensatz eingetragen. Bitte unter „Kunden und Projekte“ nachtragen oder Satz und Betrag abschalten.',
      });
    }
    const address =
      customer.address ||
      db.prepare("SELECT address FROM sites WHERE customer_id = ? AND address IS NOT NULL AND address != '' ORDER BY id LIMIT 1").get(customer.id)?.address ||
      '';
    const company = getSettings(db).company ?? {};
    const { segments, breaks } = loadCustomerSegments(db, customer.id, b.from, b.to);
    const model = buildReportModel({
      segments,
      breaks,
      customer: { name: customer.name, address },
      rate,
      issuer: { name: company.name, email: company.email },
      type,
      from: b.from,
      to: b.to,
      options,
    });
    const pdf = await renderReportPdf(model);
    const name = reportFileName(model, type, b.from, b.to);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `${b.download ? 'attachment' : 'inline'}; filename="bericht.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`);
    return reply.send(pdf);
  });
}
