import { auth as gauth, calendar as calendarApi, calendar_v3 } from '@googleapis/calendar';
import { getSettings, setSettings } from '../db';
import { env } from '../env';
import { RequestRow, addHours, durationLabel, formatAddress } from '../shared';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

export function redirectUri(): string {
  return `${env.publicUrl}/api/google/callback`;
}

type OAuth2Client = InstanceType<typeof gauth.OAuth2>;

export async function makeOAuthClient(): Promise<OAuth2Client | null> {
  const s = await getSettings();
  if (!s.google_client_id || !s.google_client_secret) return null;
  const client = new gauth.OAuth2(s.google_client_id, s.google_client_secret, redirectUri());
  if (s.google_tokens) {
    try {
      client.setCredentials(JSON.parse(s.google_tokens));
    } catch {
      /* tokens malformados: ignora */
    }
  }
  client.on('tokens', (tokens) => {
    // O evento de refresh e sincrono, mas a gravacao agora e assincrona.
    // Se falhar, nao pode derrubar a requisicao em andamento.
    void (async () => {
      try {
        const current = (await getSettings()).google_tokens;
        const merged = { ...(current ? JSON.parse(current) : {}), ...tokens };
        await setSettings({ google_tokens: JSON.stringify(merged) });
      } catch (e) {
        console.warn('[google] falha ao salvar tokens renovados:', (e as Error).message);
      }
    })();
  });
  return client;
}

export async function isConnected(): Promise<boolean> {
  const s = await getSettings();
  if (!s.google_tokens) return false;
  try {
    const t = JSON.parse(s.google_tokens);
    return Boolean(t.refresh_token || t.access_token);
  } catch {
    return false;
  }
}

export async function authUrl(state: string): Promise<string | null> {
  const client = await makeOAuthClient();
  if (!client) return null;
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  });
}

export async function exchangeCode(code: string): Promise<void> {
  const client = await makeOAuthClient();
  if (!client) throw new Error('Credenciais do Google não configuradas');
  const { tokens } = await client.getToken(code);
  const current = (await getSettings()).google_tokens;
  const merged = { ...(current ? JSON.parse(current) : {}), ...tokens };
  await setSettings({ google_tokens: JSON.stringify(merged) });
}

export async function disconnect(): Promise<void> {
  await setSettings({ google_tokens: '' });
}

async function calendarClient(): Promise<calendar_v3.Calendar | null> {
  const client = await makeOAuthClient();
  if (!client || !(await isConnected())) return null;
  return calendarApi({ version: 'v3', auth: client });
}

export async function listCalendars() {
  const cal = await calendarClient();
  if (!cal) return [];
  const res = await cal.calendarList.list({ maxResults: 100 });
  return (res.data.items || []).map((c) => ({
    id: c.id!,
    summary: c.summary || c.id!,
    primary: Boolean(c.primary),
    accessRole: c.accessRole || '',
  }));
}

/** O id do calendário principal de uma conta Google é o próprio e-mail. */
export async function getUserEmail(): Promise<string> {
  const cal = await calendarClient();
  if (!cal) return '';
  try {
    const res = await cal.calendars.get({ calendarId: 'primary' });
    const id = res.data.id || '';
    return id.includes('@') ? id : '';
  } catch {
    return '';
  }
}

async function buildEventBody(r: RequestRow): Promise<calendar_v3.Schema$Event> {
  const s = await getSettings();
  const tz = s.timezone || env.timezone;
  const prefix = s.google_event_prefix ? `${s.google_event_prefix} ` : '';
  const endTime = addHours(r.start_time, r.duration_hours);
  return {
    summary: `${prefix}${r.requester_name}`,
    location: formatAddress(r),
    description: [
      `Protocolo: ${r.protocol}`,
      `Solicitante: ${r.requester_name}`,
      `WhatsApp: ${r.whatsapp}`,
      `Chegada da equipe: ${r.arrival_time}`,
      `Duração: ${durationLabel(r.duration_hours)}`,
      `Público estimado: ${r.audience}`,
      '',
      'Pauta / briefing:',
      r.agenda,
      r.admin_notes ? `\nObservações internas: ${r.admin_notes}` : '',
    ].join('\n'),
    start: { dateTime: `${r.event_date}T${r.start_time}:00`, timeZone: tz },
    end: { dateTime: `${r.event_date}T${endTime}:00`, timeZone: tz },
    reminders: { useDefault: true },
  };
}

export async function upsertEvent(r: RequestRow): Promise<{ id: string; link: string } | null> {
  const cal = await calendarClient();
  if (!cal) return null;
  const calendarId = (await getSettings()).google_calendar_id || 'primary';
  const body = await buildEventBody(r);
  if (r.google_event_id) {
    try {
      const res = await cal.events.update({ calendarId, eventId: r.google_event_id, requestBody: body });
      return { id: res.data.id!, link: res.data.htmlLink || '' };
    } catch {
      /* evento removido no Google: recria abaixo */
    }
  }
  const res = await cal.events.insert({ calendarId, requestBody: body });
  return { id: res.data.id!, link: res.data.htmlLink || '' };
}

export async function deleteEvent(eventId: string): Promise<void> {
  const cal = await calendarClient();
  if (!cal) return;
  const calendarId = (await getSettings()).google_calendar_id || 'primary';
  try {
    await cal.events.delete({ calendarId, eventId });
  } catch {
    /* já removido */
  }
}

export async function listEvents(timeMin: string, timeMax: string) {
  const cal = await calendarClient();
  if (!cal) return [];
  const calendarId = (await getSettings()).google_calendar_id || 'primary';
  const res = await cal.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 500,
  });
  return (res.data.items || []).map((e) => ({
    id: e.id!,
    summary: e.summary || '(sem título)',
    location: e.location || '',
    description: e.description || '',
    start: e.start?.dateTime || e.start?.date || '',
    end: e.end?.dateTime || e.end?.date || '',
    htmlLink: e.htmlLink || '',
  }));
}
