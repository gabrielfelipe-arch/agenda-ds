export const STATUSES = ['pendente', 'confirmado', 'recusado', 'realizado', 'cancelado'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  recusado: 'Recusado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
};

export function audienceOptions(): string[] {
  // De 10 em 10 ate 100; acima disso as faixas ficam mais largas.
  const opts = ['De 5 a 10 pessoas'];
  for (let i = 10; i < 100; i += 10) opts.push(`De ${i} a ${i + 10} pessoas`);
  opts.push('De 100 a 150 pessoas', 'De 150 a 200 pessoas', 'Mais de 200 pessoas');
  return opts;
}

/** Durações aceitas. O valor 4 representa "mais de 3 horas". */
export const DURATION_VALUES = [1, 2, 3, 4] as const;

export function durationLabel(hours: number): string {
  if (hours >= 4) return 'Mais de 3 horas';
  return `${hours} hora${hours > 1 ? 's' : ''}`;
}

export interface RequestRow {
  id: string;
  protocol: string;
  created_at: string;
  updated_at: string;
  status: Status;
  requester_name: string;
  whatsapp: string;
  event_date: string;
  start_time: string;
  duration_hours: number;
  arrival_time: string;
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  reference: string | null;
  audience: string;
  agenda: string;
  needs_material: number;
  team_size: number | null;
  admin_notes: string | null;
  google_event_id: string | null;
  google_event_link: string | null;
  confirmed_at: string | null;
}

export function formatAddress(r: Partial<RequestRow>): string {
  const parts: string[] = [];
  const line1 = [r.street, r.number].filter(Boolean).join(', ');
  if (line1) parts.push(line1);
  if (r.complement) parts.push(r.complement);
  if (r.district) parts.push(r.district);
  const cityState = [r.city, r.state].filter(Boolean).join(' - ');
  if (cityState) parts.push(cityState);
  if (r.cep) parts.push(`CEP ${r.cep}`);
  return parts.join(', ');
}

export function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Data de hoje no fuso do servidor (TZ do container), em AAAA-MM-DD. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function weekdayBR(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long' });
}

export function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + hours * 60;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Remove emojis e simbolos pictograficos, preservando acentuacao e a formatacao
 * do WhatsApp (*negrito*, _italico_). Usado quando o destino nao lida bem com
 * caracteres fora da codepage legada — caso do aplicativo desktop no Windows.
 */
export function stripEmojis(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}️⃣]/gu, '')
    .replace(/‍/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+/, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderTemplate(tpl: string, r: RequestRow): string {
  const map: Record<string, string> = {
    nome: r.requester_name,
    data: formatDateBR(r.event_date),
    hora: r.start_time,
    duracao: durationLabel(r.duration_hours),
    chegada: r.arrival_time,
    endereco: formatAddress(r),
    publico: r.audience,
    pauta: r.agenda,
    protocolo: r.protocol,
    fim: addHours(r.start_time, r.duration_hours),
    whatsapp: r.whatsapp,
    material: r.needs_material ? 'Sim' : 'Não',
    equipe: r.team_size != null ? String(r.team_size) : '',
  };
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => map[k] ?? '');
}

export function onlyDigits(v: string): string {
  return (v || '').replace(/\D+/g, '');
}

/** Campos textuais preenchidos pelo solicitante são sempre gravados em caixa alta. */
export const UPPERCASE_FIELDS = [
  'requester_name',
  'street',
  'complement',
  'district',
  'city',
  'state',
  'reference',
  'agenda',
] as const;

export function upper(v: string | undefined | null): string {
  return (v || '').toUpperCase();
}

export function upperFields<T extends Record<string, unknown>>(data: T): T {
  const out = { ...data };
  for (const f of UPPERCASE_FIELDS) {
    if (typeof out[f] === 'string') (out as Record<string, unknown>)[f] = (out[f] as string).toUpperCase();
  }
  return out;
}

/** Telefone só com dígitos e DDI do Brasil. */
export function waPhone(whatsapp: string): string {
  const digits = onlyDigits(whatsapp);
  return digits.length <= 11 ? `55${digits}` : digits;
}

export function waLink(whatsapp: string, message: string): string {
  return `https://wa.me/${waPhone(whatsapp)}?text=${encodeURIComponent(message)}`;
}

/* ------------------------------- eventos ------------------------------- */

export const EVENT_STATUSES = ['ativo', 'cancelado'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export interface EventRow {
  id: string;
  slug: string;
  created_at: string;
  updated_at: string;
  status: EventStatus;
  title: string;
  event_date: string;
  start_time: string;
  end_time: string | null;
  location: string;
  description: string | null;
  image_url: string | null;
  collect_open: number;
  request_id: string | null;
  created_by: string | null;
}

export interface AttendeeRow {
  id: string;
  event_id: string;
  created_at: string;
  name: string;
  whatsapp: string;
  cep: string | null;
  district: string | null;
  city: string | null;
}

/** Identificador curto para o link público do evento (ex.: k7x2mq9d). */
export function newSlug(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

/** "17:20" -> "17h20"; "20:00" -> "20h" (formato usado nas mensagens de WhatsApp). */
export function timeBR(time: string): string {
  const [h, m] = time.split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

/** "24/8" — dia/mês sem zeros à esquerda, como se escreve em mensagem. */
export function shortDateBR(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}/${m}`;
}

/** Rótulo do período da mensagem semanal: "24 a 30/8" ou "28/8 a 3/9". */
export function periodLabel(fromISO: string, toISO: string): string {
  const [, fm, fd] = fromISO.split('-').map(Number);
  const [, tm, td] = toISO.split('-').map(Number);
  if (fromISO === toISO) return `${fd}/${fm}`;
  if (fm === tm) return `${fd} a ${td}/${tm}`;
  return `${fd}/${fm} a ${td}/${tm}`;
}

/** Agora no fuso informado, em "AAAA-MM-DDTHH:MM" — comparável com data+hora de evento. */
export function nowLocalISO(tz: string): string {
  // O locale sv-SE formata como "AAAA-MM-DD HH:mm:ss".
  return new Date().toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16).replace(' ', 'T');
}

/**
 * Limite de inscrição de um evento: 2 horas após o início.
 * Depois disso o link mostra "inscrições encerradas" sozinho.
 */
export function registrationCutoffISO(eventDate: string, startTime: string, graceHours = 2): string {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m + graceHours * 60;
  const dayOffset = Math.floor(total / 1440);
  const hh = String(Math.floor((total % 1440) / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  let date = eventDate;
  if (dayOffset > 0) {
    const [y, mo, d] = eventDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d + dayOffset));
    date = dt.toISOString().slice(0, 10);
  }
  return `${date}T${hh}:${mm}`;
}
