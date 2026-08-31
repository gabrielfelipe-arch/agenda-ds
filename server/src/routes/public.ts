import { Router } from 'express';
import { z } from 'zod';
import { db, getSettings } from '../db';
import { EVENT_TYPES, audienceOptions, onlyDigits, todayISO, upper } from '../shared';

export const publicRouter = Router();

publicRouter.get('/form', async (_req, res) => {
  const s = await getSettings();
  res.json({
    title: s.form_title,
    description: s.form_description,
    backgroundUrl: s.form_background_url,
    headerImageUrl: s.form_header_image_url,
    successMessage: s.form_success_message,
    open: s.form_open !== 'false',
    audienceOptions: audienceOptions(),
  });
});

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const createSchema = z.object({
  requester_name: z.string().trim().min(3, 'Informe o nome completo').max(150),
  whatsapp: z.string().trim().min(10, 'WhatsApp inválido').max(20),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  start_time: z.string().regex(timeRe, 'Horário inválido'),
  duration_hours: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  arrival_time: z.string().regex(timeRe, 'Horário de chegada inválido'),
  cep: z.string().trim().max(12).optional().default(''),
  street: z.string().trim().min(3, 'Informe o endereço').max(200),
  number: z.string().trim().min(1, 'Informe o número').max(20),
  complement: z.string().trim().max(120).optional().default(''),
  district: z.string().trim().max(120).optional().default(''),
  city: z.string().trim().min(2, 'Informe a cidade').max(120),
  state: z.string().trim().max(2).optional().default(''),
  reference: z.string().trim().max(200).optional().default(''),
  event_type: z.enum(EVENT_TYPES, { message: 'Selecione o tipo de evento' }),
  audience: z.string().trim().min(1, 'Selecione o público estimado'),
  agenda: z.string().trim().min(10, 'Descreva a pauta com pelo menos 10 caracteres').max(4000),
  needs_material: z.boolean({ message: 'Informe se necessita material de divulgação' }),
  team_size: z
    .number({ message: 'Informe a quantidade de pessoas na equipe' })
    .int()
    .min(1, 'Informe a quantidade de pessoas na equipe')
    .max(500, 'Quantidade de pessoas inválida'),
});

async function nextProtocol(): Promise<string> {
  const year = new Date().getFullYear();
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM requests WHERE protocol LIKE ?")
    .get<{ n: number }>(`AG-${year}-%`);
  return `AG-${year}-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

publicRouter.post('/requests', async (req, res) => {
  const s = await getSettings();
  if (s.form_open === 'false') {
    return res.status(403).json({ error: 'O formulário está temporariamente fechado para novas solicitações.' });
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: issue.message, field: issue.path.join('.') });
  }
  const d = parsed.data;

  if (!audienceOptions().includes(d.audience)) {
    return res.status(400).json({ error: 'Público estimado inválido', field: 'audience' });
  }

  // Agenda so para frente: a validacao da tela e conveniencia, esta e a que vale.
  if (d.event_date < todayISO()) {
    return res.status(400).json({
      error: 'A data do evento não pode ser no passado.',
      field: 'event_date',
    });
  }

  // A equipe nao pode chegar depois do inicio do evento.
  if (d.arrival_time > d.start_time) {
    return res.status(400).json({
      error: 'O horário de chegada da equipe deve ser anterior ou igual ao início do evento.',
      field: 'arrival_time',
    });
  }

  const whatsapp = onlyDigits(d.whatsapp);
  if (whatsapp.length < 10 || whatsapp.length > 13) {
    return res.status(400).json({ error: 'WhatsApp inválido. Use DDD + número.', field: 'whatsapp' });
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const protocol = await nextProtocol();

  await db.prepare(
    `INSERT INTO requests (
      id, protocol, created_at, updated_at, status, requester_name, whatsapp, event_date,
      start_time, duration_hours, arrival_time, cep, street, number, complement, district,
      city, state, reference, audience, agenda, needs_material, team_size, event_type
    ) VALUES (
      @id, @protocol, @created_at, @updated_at, 'pendente', @requester_name, @whatsapp, @event_date,
      @start_time, @duration_hours, @arrival_time, @cep, @street, @number, @complement, @district,
      @city, @state, @reference, @audience, @agenda, @needs_material, @team_size, @event_type
    )`
  ).run({
    id,
    protocol,
    created_at: now,
    updated_at: now,
    // Dados textuais do solicitante entram sempre em caixa alta.
    requester_name: upper(d.requester_name),
    whatsapp,
    event_date: d.event_date,
    start_time: d.start_time,
    duration_hours: d.duration_hours,
    arrival_time: d.arrival_time,
    cep: onlyDigits(d.cep),
    street: upper(d.street),
    number: upper(d.number),
    complement: upper(d.complement),
    district: upper(d.district),
    city: upper(d.city),
    state: upper(d.state),
    reference: upper(d.reference),
    audience: d.audience,
    agenda: upper(d.agenda),
    needs_material: d.needs_material ? 1 : 0,
    team_size: d.team_size,
    event_type: d.event_type,
  });

  res.status(201).json({ id, protocol, successMessage: s.form_success_message });
});
