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
  const opts = ['De 5 a 10 pessoas'];
  for (let i = 10; i < 200; i += 10) opts.push(`De ${i} a ${i + 10} pessoas`);
  opts.push('Mais de 200 pessoas');
  return opts;
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

export function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + hours * 60;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function renderTemplate(tpl: string, r: RequestRow): string {
  const map: Record<string, string> = {
    nome: r.requester_name,
    data: formatDateBR(r.event_date),
    hora: r.start_time,
    duracao: `${r.duration_hours} hora${r.duration_hours > 1 ? 's' : ''}`,
    chegada: r.arrival_time,
    endereco: formatAddress(r),
    publico: r.audience,
    pauta: r.agenda,
    protocolo: r.protocol,
    fim: addHours(r.start_time, r.duration_hours),
    whatsapp: r.whatsapp,
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

export function waLink(whatsapp: string, message: string): string {
  let digits = onlyDigits(whatsapp);
  if (digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
