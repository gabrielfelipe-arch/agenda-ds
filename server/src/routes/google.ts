import { Router } from 'express';
import { db, getSettings } from '../db';
import { requireAuth, requireRole } from '../auth';
import { RequestRow, addHours, formatAddress } from '../shared';
import * as gcal from '../services/googleCalendar';

export const googleRouter = Router();

/** Estados de OAuth pendentes (curta duração). */
const pendingStates = new Map<string, number>();

/* O callback do Google chega sem cabeçalho de autenticação: validado pelo state. */
googleRouter.get('/callback', async (req, res) => {
  const state = String(req.query.state || '');
  const code = String(req.query.code || '');
  const expires = pendingStates.get(state);
  pendingStates.delete(state);

  const done = (ok: boolean, msg: string) =>
    res.redirect(`/admin/configuracoes?google=${ok ? 'ok' : 'erro'}&msg=${encodeURIComponent(msg)}`);

  if (!expires || expires < Date.now()) return done(false, 'Sessão de autorização expirada. Tente novamente.');
  if (!code) return done(false, String(req.query.error || 'Autorização cancelada'));

  try {
    await gcal.exchangeCode(code);
    done(true, 'Google Agenda conectado com sucesso');
  } catch (e) {
    done(false, (e as Error).message);
  }
});

googleRouter.use(requireAuth);

googleRouter.get('/status', async (_req, res) => {
  const connected = gcal.isConnected();
  const s = getSettings();
  res.json({
    connected,
    configured: Boolean(s.google_client_id && s.google_client_secret),
    calendarId: s.google_calendar_id,
    redirectUri: gcal.redirectUri(),
    account: connected ? await gcal.getUserEmail() : '',
  });
});

googleRouter.get('/auth-url', requireRole('admin'), (_req, res) => {
  const state = crypto.randomUUID();
  pendingStates.set(state, Date.now() + 10 * 60_000);
  const url = gcal.authUrl(state);
  if (!url) {
    return res.status(400).json({ error: 'Preencha o Client ID e o Client Secret antes de conectar.' });
  }
  res.json({ url });
});

googleRouter.post('/disconnect', requireRole('admin'), (_req, res) => {
  gcal.disconnect();
  res.json({ ok: true });
});

googleRouter.get('/calendars', requireRole('admin'), async (_req, res) => {
  try {
    res.json({ items: await gcal.listCalendars() });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/**
 * Eventos para as visões de calendário/lista.
 * `source=local` usa o banco (sempre disponível); `source=google` lê a agenda conectada.
 */
googleRouter.get('/events', async (req, res) => {
  const from = String(req.query.from || new Date().toISOString().slice(0, 10));
  const to = String(req.query.to || from);
  const source = String(req.query.source || 'local');

  if (source === 'google') {
    if (!gcal.isConnected()) return res.status(400).json({ error: 'Google Agenda não está conectado' });
    try {
      const items = await gcal.listEvents(`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`);
      return res.json({ source, items });
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
  }

  const rows = db
    .prepare(
      "SELECT * FROM requests WHERE event_date BETWEEN ? AND ? AND status IN ('confirmado','realizado') ORDER BY event_date, start_time"
    )
    .all(from, to) as RequestRow[];

  res.json({
    source: 'local',
    items: rows.map((r) => ({
      id: r.id,
      requestId: r.id,
      protocol: r.protocol,
      summary: r.requester_name,
      status: r.status,
      date: r.event_date,
      start: `${r.event_date}T${r.start_time}:00`,
      end: `${r.event_date}T${addHours(r.start_time, r.duration_hours)}:00`,
      startTime: r.start_time,
      endTime: addHours(r.start_time, r.duration_hours),
      arrivalTime: r.arrival_time,
      location: formatAddress(r),
      audience: r.audience,
      whatsapp: r.whatsapp,
      description: r.agenda,
      htmlLink: r.google_event_link || '',
    })),
  });
});
