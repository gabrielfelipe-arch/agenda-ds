import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { db, getSettings, setSettings } from '../db';
import { env } from '../env';
import { AuthedRequest, requireAuth, requireRole } from '../auth';
import {
  RequestRow,
  STATUSES,
  STATUS_LABELS,
  Status,
  addHours,
  durationLabel,
  formatDateBR,
  onlyDigits,
  renderTemplate,
  stripEmojis,
  upperFields,
  waLink,
  weekdayBR,
  waPhone,
} from '../shared';
import * as gcal from '../services/googleCalendar';

function logActivity(req: import('express').Request, requestId: string | null, action: string, detail = '') {
  const user = (req as AuthedRequest).user;
  db.prepare(
    'INSERT INTO activity_log (created_at, user_id, user_name, request_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(new Date().toISOString(), user?.id ?? null, user?.name ?? null, requestId, action, detail);
}

export const adminRouter = Router();
adminRouter.use(requireAuth);

/* ------------------------------ listagem ------------------------------ */

interface Filters {
  status?: string | string[];
  from?: string;
  to?: string;
  q?: string;
  city?: string | string[];
  district?: string | string[];
  audience?: string | string[];
}

/** Aceita `city=A&city=B` e também `city=A,B`. */
function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
}

/** Monta um IN (...) com parâmetros nomeados, comparando sem diferenciar maiúsculas. */
function inClause(
  column: string,
  values: string[],
  prefix: string,
  params: Record<string, unknown>,
  caseInsensitive = true
): string {
  const holders = values.map((v, i) => {
    const key = `${prefix}${i}`;
    params[key] = caseInsensitive ? v.toLowerCase() : v;
    return `@${key}`;
  });
  const col = caseInsensitive ? `LOWER(${column})` : column;
  return `${col} IN (${holders.join(', ')})`;
}

function buildQuery(f: Filters) {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  const statuses = asList(f.status).filter((v) => (STATUSES as readonly string[]).includes(v));
  if (statuses.length) where.push(inClause('status', statuses, 'st', params, false));

  if (f.from) {
    where.push('event_date >= @from');
    params.from = f.from;
  }
  if (f.to) {
    where.push('event_date <= @to');
    params.to = f.to;
  }

  const cities = asList(f.city);
  if (cities.length) where.push(inClause('city', cities, 'ct', params));

  const districts = asList(f.district);
  if (districts.length) where.push(inClause('district', districts, 'ds', params));

  const audiences = asList(f.audience);
  if (audiences.length) where.push(inClause('audience', audiences, 'au', params, false));
  if (f.q) {
    where.push(
      '(LOWER(requester_name) LIKE @q OR whatsapp LIKE @q OR LOWER(agenda) LIKE @q OR LOWER(protocol) LIKE @q OR LOWER(street) LIKE @q OR LOWER(district) LIKE @q)'
    );
    params.q = `%${f.q.toLowerCase()}%`;
  }

  const sql = `SELECT * FROM requests ${
    where.length ? `WHERE ${where.join(' AND ')}` : ''
  } ORDER BY event_date ASC, start_time ASC`;
  return { sql, params };
}

function queryRequests(f: Filters): RequestRow[] {
  const { sql, params } = buildQuery(f);
  return db.prepare(sql).all(params) as RequestRow[];
}

adminRouter.get('/requests', (req, res) => {
  const rows = queryRequests(req.query as Filters);
  res.json({ items: rows, total: rows.length });
});

adminRouter.get('/stats', (_req, res) => {
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM requests GROUP BY status').all() as {
    status: Status;
    n: number;
  }[];
  const total = byStatus.reduce((a, b) => a + b.n, 0);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = db
    .prepare("SELECT COUNT(*) AS n FROM requests WHERE event_date >= ? AND status = 'confirmado'")
    .get(today) as { n: number };
  res.json({
    total,
    upcomingConfirmed: upcoming.n,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
  });
});

/**
 * Opções de filtro derivadas do que existe de fato no banco — evita oferecer
 * combinações que nunca retornariam nada. Cada opção vem com a contagem.
 */
adminRouter.get('/options', (_req, res) => {
  const facet = (column: string) =>
    db
      .prepare(
        `SELECT ${column} AS value, COUNT(*) AS count FROM requests
         WHERE ${column} IS NOT NULL AND TRIM(${column}) <> ''
         GROUP BY ${column} ORDER BY ${column}`
      )
      .all() as { value: string; count: number }[];

  const statusRows = facet('status');
  const statuses = (STATUSES as readonly string[])
    .map((value) => ({ value, count: statusRows.find((r) => r.value === value)?.count ?? 0 }))
    .filter((s) => s.count > 0);

  const districts = db
    .prepare(
      `SELECT district AS value, city, COUNT(*) AS count FROM requests
       WHERE district IS NOT NULL AND TRIM(district) <> ''
       GROUP BY district, city ORDER BY district`
    )
    .all() as { value: string; city: string; count: number }[];

  res.json({
    statuses,
    cities: facet('city'),
    districts,
    audiences: facet('audience'),
    total: (db.prepare('SELECT COUNT(*) AS n FROM requests').get() as { n: number }).n,
  });
});

adminRouter.get('/requests/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id) as RequestRow | undefined;
  if (!row) return res.status(404).json({ error: 'Solicitação não encontrada' });
  res.json(row);
});

/* ------------------------------ edição ------------------------------ */

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  admin_notes: z.string().max(4000).optional(),
  requester_name: z.string().min(3).max(150).optional(),
  whatsapp: z.string().min(10).max(20).optional(),
  event_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  start_time: z.string().regex(timeRe).optional(),
  arrival_time: z.string().regex(timeRe).optional(),
  duration_hours: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  cep: z.string().max(12).optional(),
  street: z.string().max(200).optional(),
  number: z.string().max(20).optional(),
  complement: z.string().max(120).optional(),
  district: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(2).optional(),
  reference: z.string().max(200).optional(),
  audience: z.string().max(60).optional(),
  agenda: z.string().max(4000).optional(),
  syncGoogle: z.boolean().optional(),
});

adminRouter.patch('/requests/:id', async (req, res) => {
  const current = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id) as RequestRow | undefined;
  if (!current) return res.status(404).json({ error: 'Solicitação não encontrada' });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: `Campo inválido: ${issue.path.join('.')} - ${issue.message}` });
  }
  // A edição pelo admin segue a mesma regra do formulário: texto em caixa alta.
  const { syncGoogle, ...rest } = parsed.data;
  const data = upperFields(rest);
  if (data.whatsapp) data.whatsapp = onlyDigits(data.whatsapp);
  if (data.number) data.number = data.number.toUpperCase();
  if (data.cep) data.cep = onlyDigits(data.cep);

  const inicio = data.start_time ?? current.start_time;
  const chegada = data.arrival_time ?? current.arrival_time;
  if (chegada > inicio) {
    return res.status(400).json({
      error: 'O horário de chegada da equipe deve ser anterior ou igual ao início do evento.',
    });
  }

  const keys = Object.keys(data) as (keyof typeof data)[];
  if (keys.length) {
    const sets = keys.map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE requests SET ${sets}, updated_at = @updated_at WHERE id = @id`).run({
      ...data,
      updated_at: new Date().toISOString(),
      id: req.params.id,
    });
  }

  if (data.status === 'confirmado' && current.status !== 'confirmado') {
    db.prepare('UPDATE requests SET confirmed_at = ? WHERE id = ?').run(new Date().toISOString(), req.params.id);
  }

  let updated = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id) as RequestRow;
  const warnings: string[] = [];

  if (syncGoogle !== false && gcal.isConnected()) {
    try {
      if (updated.status === 'confirmado' || updated.status === 'realizado') {
        const ev = await gcal.upsertEvent(updated);
        if (ev) {
          db.prepare('UPDATE requests SET google_event_id = ?, google_event_link = ? WHERE id = ?').run(
            ev.id,
            ev.link,
            updated.id
          );
        }
      } else if (updated.google_event_id) {
        await gcal.deleteEvent(updated.google_event_id);
        db.prepare('UPDATE requests SET google_event_id = NULL, google_event_link = NULL WHERE id = ?').run(
          updated.id
        );
      }
      updated = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id) as RequestRow;
    } catch (e) {
      warnings.push(`Falha ao sincronizar com o Google Agenda: ${(e as Error).message}`);
    }
  }

  const remarcou =
    (data.event_date && data.event_date !== current.event_date) ||
    (data.start_time && data.start_time !== current.start_time);
  if (remarcou) {
    logActivity(
      req,
      updated.id,
      'reagendamento',
      `${formatDateBR(current.event_date)} ${current.start_time} -> ${formatDateBR(updated.event_date)} ${updated.start_time}`
    );
  }

  if (data.status && data.status !== current.status) {
    logActivity(req, updated.id, 'status', `${STATUS_LABELS[current.status]} -> ${STATUS_LABELS[updated.status]}`);
  } else if (keys.length) {
    logActivity(req, updated.id, 'edicao', keys.join(', '));
  }

  res.json({ item: updated, warnings });
});

adminRouter.post('/requests/:id/sync', async (req, res) => {
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id) as RequestRow | undefined;
  if (!row) return res.status(404).json({ error: 'Solicitação não encontrada' });
  if (!gcal.isConnected()) return res.status(400).json({ error: 'Google Agenda não está conectado' });
  try {
    const ev = await gcal.upsertEvent(row);
    if (ev) {
      db.prepare('UPDATE requests SET google_event_id = ?, google_event_link = ? WHERE id = ?').run(
        ev.id,
        ev.link,
        row.id
      );
    }
    res.json({ item: db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id) });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

adminRouter.delete('/requests/:id', requireRole('admin'), async (req, res) => {
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id) as RequestRow | undefined;
  if (!row) return res.status(404).json({ error: 'Solicitação não encontrada' });
  if (row.google_event_id && gcal.isConnected()) {
    try {
      await gcal.deleteEvent(row.google_event_id);
    } catch {
      /* segue com a exclusão local */
    }
  }
  db.prepare('DELETE FROM requests WHERE id = ?').run(req.params.id);
  logActivity(req, null, 'exclusao', `${row.protocol} - ${row.requester_name}`);
  res.json({ ok: true });
});

/* ------------------------------ whatsapp ------------------------------ */

adminRouter.get('/requests/:id/whatsapp', (req, res) => {
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id) as RequestRow | undefined;
  if (!row) return res.status(404).json({ error: 'Solicitação não encontrada' });
  const s = getSettings();
  const kind = String(req.query.kind || 'confirm');
  const templates: Record<string, string> = {
    confirm: s.whatsapp_confirm_template,
    reject: s.whatsapp_reject_template,
    reschedule: s.whatsapp_reschedule_template,
  };
  const tpl = templates[kind] || s.whatsapp_confirm_template;
  const rendered = renderTemplate(tpl, row);

  // A tela informa `plain=1` quando o destino e o WhatsApp Web no computador.
  // 'auto' (padrao): emojis no celular, texto limpo no computador.
  const mode = s.whatsapp_emojis || 'auto';
  const plainRequested = String(req.query.plain || '') === '1';
  const semEmojis = mode === 'never' || (mode === 'auto' && plainRequested);
  const message = semEmojis ? stripEmojis(rendered) : rendered;
  const rotulos: Record<string, string> = {
    confirm: 'mensagem de confirmação',
    reject: 'mensagem de recusa',
    reschedule: 'mensagem de remarcação',
  };
  logActivity(req, row.id, 'whatsapp', rotulos[kind] || rotulos.confirm);
  // O telefone vai separado: a tela monta o link conforme o aparelho
  // (celular abre o app; no computador vai para o WhatsApp Web, que preserva os emojis).
  res.json({ message, phone: waPhone(row.whatsapp), link: waLink(row.whatsapp, message) });
});

/* ------------------------------ exportação ------------------------------ */

adminRouter.get('/export.xlsx', async (req, res) => {
  const rows = queryRequests(req.query as Filters);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Agenda 5588';
  const ws = wb.addWorksheet('Solicitações', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'Protocolo', key: 'protocol', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Data do evento', key: 'event_date', width: 16 },
    { header: 'Dia da semana', key: 'weekday', width: 16 },
    { header: 'Início', key: 'start_time', width: 9 },
    { header: 'Término', key: 'end_time', width: 9 },
    { header: 'Duração', key: 'duration_label', width: 16 },
    { header: 'Chegada', key: 'arrival_time', width: 10 },
    { header: 'Solicitante', key: 'requester_name', width: 30 },
    { header: 'WhatsApp', key: 'whatsapp', width: 16 },
    { header: 'CEP', key: 'cep', width: 12 },
    { header: 'Endereço', key: 'street', width: 32 },
    { header: 'Número', key: 'number', width: 10 },
    { header: 'Complemento', key: 'complement', width: 18 },
    { header: 'Bairro', key: 'district', width: 20 },
    { header: 'Cidade', key: 'city', width: 20 },
    { header: 'UF', key: 'state', width: 6 },
    { header: 'Referência', key: 'reference', width: 24 },
    { header: 'Público estimado', key: 'audience', width: 22 },
    { header: 'Pauta / Briefing', key: 'agenda', width: 60 },
    { header: 'Observações internas', key: 'admin_notes', width: 40 },
    { header: 'Link Google Agenda', key: 'google_event_link', width: 30 },
    { header: 'Criado em', key: 'created_at', width: 20 },
    { header: 'Confirmado em', key: 'confirmed_at', width: 20 },
    { header: 'Última alteração', key: 'updated_at', width: 20 },
  ];

  for (const r of rows) {
    ws.addRow({
      ...r,
      status: r.status.charAt(0).toUpperCase() + r.status.slice(1),
      event_date: formatDateBR(r.event_date),
      weekday: weekdayBR(r.event_date),
      duration_label: durationLabel(r.duration_hours),
      end_time: addHours(r.start_time, r.duration_hours),
      created_at: new Date(r.created_at).toLocaleString('pt-BR'),
      confirmed_at: r.confirmed_at ? new Date(r.confirmed_at).toLocaleString('pt-BR') : '',
      updated_at: new Date(r.updated_at).toLocaleString('pt-BR'),
    });
  }

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2C5E' } };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 22;
  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };
  ws.eachRow({ includeEmpty: false }, (row, i) => {
    if (i === 1) return;
    row.alignment = { vertical: 'top', wrapText: true };
  });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="solicitacoes-agenda-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

/* ------------------------------ configurações ------------------------------ */

adminRouter.get('/settings', requireRole('admin'), (_req, res) => {
  const s = getSettings();
  const { google_tokens, ...rest } = s;
  res.json({
    ...rest,
    google_client_secret: s.google_client_secret ? '********' : '',
    google_connected: gcal.isConnected(),
    google_redirect_uri: gcal.redirectUri(),
  });
});

const settingsSchema = z.object({
  form_title: z.string().max(200).optional(),
  form_description: z.string().max(5000).optional(),
  form_background_url: z.string().max(500).optional(),
  form_header_image_url: z.string().max(500).optional(),
  form_success_message: z.string().max(1000).optional(),
  form_open: z.enum(['true', 'false']).optional(),
  whatsapp_confirm_template: z.string().max(4000).optional(),
  whatsapp_reject_template: z.string().max(4000).optional(),
  whatsapp_reschedule_template: z.string().max(4000).optional(),
  whatsapp_emojis: z.enum(['auto', 'always', 'never']).optional(),
  google_client_id: z.string().max(300).optional(),
  google_client_secret: z.string().max(300).optional(),
  google_calendar_id: z.string().max(300).optional(),
  google_event_prefix: z.string().max(60).optional(),
  timezone: z.string().max(60).optional(),
});

adminRouter.put('/settings', requireRole('admin'), (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Configuração inválida' });
  const patch = { ...parsed.data } as Record<string, string>;
  if (patch.google_client_secret === '********') delete patch.google_client_secret;
  setSettings(patch);
  res.json({ ok: true });
});

/* ------------------------------ upload ------------------------------ */

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, env.uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 6) || '.jpg';
      const kind = (_req.params as { kind?: string }).kind === 'header' ? 'header' : 'bg';
      cb(null, `${kind}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

const UPLOAD_TARGETS: Record<string, string> = {
  background: 'form_background_url',
  header: 'form_header_image_url',
};

adminRouter.post('/upload/:kind', requireRole('admin'), upload.single('file'), (req, res) => {
  const setting = UPLOAD_TARGETS[req.params.kind];
  if (!setting) return res.status(400).json({ error: 'Tipo de imagem inválido' });
  if (!req.file) return res.status(400).json({ error: 'Envie uma imagem JPG, PNG ou WEBP de até 8MB' });
  const url = `/uploads/${req.file.filename}`;
  setSettings({ [setting]: url });
  res.json({ url });
});

adminRouter.get('/uploads', requireRole('admin'), (_req, res) => {
  const files = fs.existsSync(env.uploadsDir) ? fs.readdirSync(env.uploadsDir) : [];
  res.json({ files: files.map((f) => `/uploads/${f}`) });
});

/* ------------------------------ histórico ------------------------------ */

adminRouter.get('/activity', (req, res) => {
  const requestId = String(req.query.request_id || '');
  const rows = requestId
    ? db
        .prepare('SELECT * FROM activity_log WHERE request_id = ? ORDER BY id DESC LIMIT 200')
        .all(requestId)
    : db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 200').all();
  res.json({ items: rows });
});
