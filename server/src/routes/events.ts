import { Router } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { db, getSettings } from '../db';
import { env } from '../env';
import { AuthedRequest, requireAuth, requireRole } from '../auth';
import {
  AttendeeRow,
  EVENT_TYPES,
  EventRow,
  RequestRow,
  addHours,
  formatAddress,
  formatDateBR,
  newSlug,
  nowLocalISO,
  onlyDigits,
  periodLabel,
  registrationCutoffISO,
  shortDateBR,
  stripEmojis,
  timeBR,
  upper,
  weekdayBR,
} from '../shared';

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

/** Evento já passou do prazo (início + 2h): o link público deixa de existir. */
function isExpired(ev: Pick<EventRow, 'event_date' | 'start_time'>): boolean {
  return nowLocalISO(env.timezone) > registrationCutoffISO(ev.event_date, ev.start_time);
}

/** Inscrição aberta = evento ativo, lista aberta e ainda dentro do prazo. */
function registrationOpen(ev: Pick<EventRow, 'status' | 'collect_open' | 'event_date' | 'start_time'>): boolean {
  if (ev.status !== 'ativo' || !ev.collect_open) return false;
  return !isExpired(ev);
}

/* ============================== público ============================== */

export const publicEventsRouter = Router();

/** Dados exibidos na página de inscrição. Nada além do necessário. */
publicEventsRouter.get('/:slug', async (req, res) => {
  const ev = await db.prepare('SELECT * FROM events WHERE slug = ?').get<EventRow>(req.params.slug);
  // Depois do evento o link expira: responde como se não existisse.
  if (!ev || ev.status !== 'ativo' || isExpired(ev)) {
    return res.status(404).json({ error: 'Evento não encontrado' });
  }
  // A imagem do topo e a mesma do formulario de agendamento (Configuracoes).
  const s = await getSettings();
  res.json({
    slug: ev.slug,
    title: ev.title,
    event_date: ev.event_date,
    start_time: ev.start_time,
    end_time: ev.end_time,
    location: ev.location,
    description: ev.description || '',
    image_url: s.form_header_image_url || '',
    collect_open: registrationOpen(ev),
  });
});

const attendeeSchema = z.object({
  name: z.string().trim().min(3, 'Informe o nome completo').max(150),
  whatsapp: z.string().trim().min(10, 'WhatsApp inválido').max(20),
  cep: z.string().trim().max(12).optional().default(''),
  district: z.string().trim().max(120).optional().default(''),
  city: z.string().trim().max(120).optional().default(''),
  // Honeypot: campo invisível no formulário. Gente não preenche; robô preenche.
  website: z.string().max(200).optional().default(''),
});

publicEventsRouter.post('/:slug/attendees', async (req, res) => {
  const ev = await db.prepare('SELECT * FROM events WHERE slug = ?').get<EventRow>(req.params.slug);
  if (!ev || ev.status !== 'ativo' || isExpired(ev)) {
    return res.status(404).json({ error: 'Evento não encontrado' });
  }
  if (!registrationOpen(ev)) {
    return res.status(403).json({ error: 'As inscrições deste evento já foram encerradas.' });
  }

  const parsed = attendeeSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: issue.message, field: issue.path.join('.') });
  }
  const d = parsed.data;

  // Robô caiu no honeypot: responde sucesso e descarta.
  if (d.website) return res.status(201).json({ ok: true });

  const whatsapp = onlyDigits(d.whatsapp);
  if (whatsapp.length < 10 || whatsapp.length > 13) {
    return res.status(400).json({ error: 'WhatsApp inválido. Use DDD + número.', field: 'whatsapp' });
  }

  const dup = await db
    .prepare('SELECT id FROM attendees WHERE event_id = ? AND whatsapp = ?')
    .get<{ id: string }>(ev.id, whatsapp);
  if (dup) {
    // Já estava na lista: confirma sem duplicar.
    return res.status(200).json({ ok: true, already: true });
  }

  await db
    .prepare(
      `INSERT INTO attendees (id, event_id, created_at, name, whatsapp, cep, district, city)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      crypto.randomUUID(),
      ev.id,
      new Date().toISOString(),
      upper(d.name),
      whatsapp,
      onlyDigits(d.cep),
      upper(d.district),
      upper(d.city)
    );

  res.status(201).json({ ok: true });
});

/* =============================== admin =============================== */

export const adminEventsRouter = Router();
adminEventsRouter.use(requireAuth);

function toItem(ev: EventRow & { attendee_count?: number }) {
  return { ...ev, collect_open: Boolean(ev.collect_open), registration_open: registrationOpen(ev) };
}

adminEventsRouter.get('/', async (req, res) => {
  const from = typeof req.query.from === 'string' && dateRe.test(req.query.from) ? req.query.from : '';
  const to = typeof req.query.to === 'string' && dateRe.test(req.query.to) ? req.query.to : '';
  const where: string[] = [];
  const args: string[] = [];
  if (from) {
    where.push('e.event_date >= ?');
    args.push(from);
  }
  if (to) {
    where.push('e.event_date <= ?');
    args.push(to);
  }
  const rows = await db
    .prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM attendees a WHERE a.event_id = e.id) AS attendee_count
       FROM events e
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY e.event_date, e.start_time`
    )
    .all<EventRow & { attendee_count: number }>(...args);
  res.json({ items: rows.map(toItem) });
});

const eventSchema = z.object({
  title: z.string().trim().min(3, 'Informe o nome do evento').max(200),
  event_date: z.string().regex(dateRe, 'Data inválida'),
  start_time: z.string().regex(timeRe, 'Horário inválido'),
  end_time: z.string().regex(timeRe, 'Horário inválido').optional().or(z.literal('')).default(''),
  location: z.string().trim().min(3, 'Informe o local').max(300),
  description: z.string().trim().max(4000).optional().default(''),
  collect_open: z.boolean().optional().default(true),
  event_type: z.enum(EVENT_TYPES).optional().or(z.literal('')).default(''),
  status: z.enum(['ativo', 'cancelado']).optional(),
});

adminEventsRouter.post('/', async (req, res) => {
  const user = (req as AuthedRequest).user!;

  // Criação a partir de uma solicitação confirmada: herda os dados dela.
  const fromRequest = typeof req.body?.request_id === 'string' ? req.body.request_id : '';
  let base: Partial<z.infer<typeof eventSchema>> = {};
  if (fromRequest) {
    const r = await db.prepare('SELECT * FROM requests WHERE id = ?').get<RequestRow>(fromRequest);
    if (!r) return res.status(404).json({ error: 'Solicitação não encontrada' });
    base = {
      title: r.agenda.length > 80 ? `${r.agenda.slice(0, 77)}...` : r.agenda,
      event_date: r.event_date,
      start_time: r.start_time,
      end_time: addHours(r.start_time, r.duration_hours),
      location: formatAddress(r) || 'A definir',
      description: '',
      event_type: (r.event_type as (typeof EVENT_TYPES)[number]) || undefined,
    };
  }

  const parsed = eventSchema.safeParse({ ...base, ...req.body });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: issue.message, field: issue.path.join('.') });
  }
  const d = parsed.data;

  const now = new Date().toISOString();
  const ev: EventRow = {
    id: crypto.randomUUID(),
    slug: newSlug(),
    created_at: now,
    updated_at: now,
    status: 'ativo',
    title: upper(d.title),
    event_date: d.event_date,
    start_time: d.start_time,
    end_time: d.end_time || null,
    location: upper(d.location),
    description: d.description || null,
    image_url: null,
    collect_open: d.collect_open ? 1 : 0,
    event_type: d.event_type || null,
    request_id: fromRequest || null,
    created_by: user.name,
  };

  await db
    .prepare(
      `INSERT INTO events (id, slug, created_at, updated_at, status, title, event_date, start_time,
        end_time, location, description, image_url, collect_open, event_type, request_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ev.id,
      ev.slug,
      ev.created_at,
      ev.updated_at,
      ev.status,
      ev.title,
      ev.event_date,
      ev.start_time,
      ev.end_time,
      ev.location,
      ev.description,
      ev.image_url,
      ev.collect_open,
      ev.event_type,
      ev.request_id,
      ev.created_by
    );

  res.status(201).json({ item: toItem({ ...ev, attendee_count: 0 } as EventRow & { attendee_count: number }) });
});

adminEventsRouter.patch('/:id', async (req, res) => {
  const ev = await db.prepare('SELECT * FROM events WHERE id = ?').get<EventRow>(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado' });

  const parsed = eventSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: issue.message, field: issue.path.join('.') });
  }
  const d = parsed.data;

  const next = {
    title: d.title !== undefined ? upper(d.title) : ev.title,
    event_date: d.event_date ?? ev.event_date,
    start_time: d.start_time ?? ev.start_time,
    end_time: d.end_time !== undefined ? d.end_time || null : ev.end_time,
    location: d.location !== undefined ? upper(d.location) : ev.location,
    description: d.description !== undefined ? d.description || null : ev.description,
    collect_open: d.collect_open !== undefined ? (d.collect_open ? 1 : 0) : ev.collect_open,
    event_type: d.event_type !== undefined ? d.event_type || null : ev.event_type,
    status: d.status ?? ev.status,
    updated_at: new Date().toISOString(),
  };

  await db
    .prepare(
      `UPDATE events SET title = ?, event_date = ?, start_time = ?, end_time = ?, location = ?,
        description = ?, collect_open = ?, event_type = ?, status = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      next.title,
      next.event_date,
      next.start_time,
      next.end_time,
      next.location,
      next.description,
      next.collect_open,
      next.event_type,
      next.status,
      next.updated_at,
      ev.id
    );

  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM attendees WHERE event_id = ?')
    .get<{ n: number }>(ev.id);
  res.json({ item: toItem({ ...ev, ...next, attendee_count: count?.n ?? 0 } as EventRow & { attendee_count: number }) });
});

adminEventsRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  const ev = await db.prepare('SELECT id FROM events WHERE id = ?').get<{ id: string }>(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado' });
  await db.prepare('DELETE FROM attendees WHERE event_id = ?').run(ev.id);
  await db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
  res.json({ ok: true });
});

/* --------------------------- lista de presença --------------------------- */

adminEventsRouter.get('/:id/attendees', async (req, res) => {
  const ev = await db.prepare('SELECT id FROM events WHERE id = ?').get<{ id: string }>(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado' });
  const rows = await db
    .prepare('SELECT * FROM attendees WHERE event_id = ? ORDER BY created_at')
    .all<AttendeeRow>(ev.id);
  res.json({ items: rows });
});

adminEventsRouter.get('/:id/attendees.xlsx', async (req, res) => {
  const ev = await db.prepare('SELECT * FROM events WHERE id = ?').get<EventRow>(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado' });
  const rows = await db
    .prepare('SELECT * FROM attendees WHERE event_id = ? ORDER BY created_at')
    .all<AttendeeRow>(ev.id);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Participantes');
  ws.columns = [
    { header: '#', key: 'n', width: 6 },
    { header: 'Nome', key: 'name', width: 36 },
    { header: 'WhatsApp', key: 'whatsapp', width: 18 },
    { header: 'Bairro', key: 'district', width: 24 },
    { header: 'Cidade', key: 'city', width: 22 },
    { header: 'CEP', key: 'cep', width: 12 },
    { header: 'Inscrito em', key: 'created_at', width: 20 },
  ];
  ws.getRow(1).font = { bold: true };
  rows.forEach((a, i) =>
    ws.addRow({
      n: i + 1,
      name: a.name,
      whatsapp: a.whatsapp,
      district: a.district || '',
      city: a.city || '',
      cep: a.cep || '',
      created_at: a.created_at.slice(0, 16).replace('T', ' '),
    })
  );

  const safe = ev.title.replace(/[^\w\d]+/g, '-').replace(/-+/g, '-').slice(0, 40).toLowerCase();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="presenca-${safe}-${ev.event_date}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

/* --------------------------- mensagem da semana --------------------------- */

/**
 * Monta a mensagem de divulgação no formato usado nos grupos:
 * cabeçalho com o período, eventos agrupados por dia e, quando a lista de
 * presença está aberta, o link de inscrição logo abaixo do local.
 */
adminEventsRouter.get('/message', async (req, res) => {
  const from = typeof req.query.from === 'string' && dateRe.test(req.query.from) ? req.query.from : '';
  const to = typeof req.query.to === 'string' && dateRe.test(req.query.to) ? req.query.to : '';
  if (!from || !to) return res.status(400).json({ error: 'Informe o período (from/to)' });

  const rows = await db
    .prepare(
      "SELECT * FROM events WHERE event_date BETWEEN ? AND ? AND status = 'ativo' ORDER BY event_date, start_time"
    )
    .all<EventRow>(from, to);
  if (!rows.length) return res.status(404).json({ error: 'Nenhum evento ativo no período escolhido.' });

  const s = await getSettings();
  const header = (s.events_msg_header || '').replace(/\{\{\s*periodo\s*\}\}/g, periodLabel(from, to));
  const linkLabel = s.events_msg_link_label || '📝 Confirme presença:';

  const byDay = new Map<string, EventRow[]>();
  for (const ev of rows) {
    const list = byDay.get(ev.event_date) || [];
    list.push(ev);
    byDay.set(ev.event_date, list);
  }

  const blocks: string[] = [];
  for (const [date, list] of byDay) {
    const lines: string[] = [`📅 *${shortDateBR(date)} (${weekdayBR(date)})*`];
    for (const ev of list) {
      lines.push('');
      lines.push(`➡️ ${ev.title}`);
      lines.push(`🕐 ${timeBR(ev.start_time)}`);
      lines.push(`📍 ${ev.location}`);
      if (registrationOpen(ev)) lines.push(`${linkLabel} ${env.publicUrl}/evento/${ev.slug}`);
    }
    blocks.push(lines.join('\n'));
  }

  const parts = [header.trim(), blocks.join('\n====\n\n')];
  const footer = (s.events_msg_footer || '').trim();
  if (footer) parts.push(footer);

  // Mesma regra das mensagens de confirmação: no computador (plain=1, modo auto)
  // os emojis saem, porque o aplicativo do Windows os exibe quebrados.
  const mode = s.whatsapp_emojis || 'auto';
  const plainRequested = String(req.query.plain || '') === '1';
  const semEmojis = mode === 'never' || (mode === 'auto' && plainRequested);
  const text = parts.join('\n\n');

  res.json({ text: semEmojis ? stripEmojis(text) : text, count: rows.length, period: periodLabel(from, to) });
});
