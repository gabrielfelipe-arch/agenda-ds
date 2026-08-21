const TOKEN_KEY = 'agenda5588.token';
const EMAIL_KEY = 'agenda5588.lastEmail';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getLastEmail(): string {
  return localStorage.getItem(EMAIL_KEY) || '';
}

export function setLastEmail(email: string) {
  localStorage.setItem(EMAIL_KEY, email);
}

/**
 * Marca, apenas neste aparelho, que existe biometria cadastrada para o e-mail.
 * Fica no dispositivo de propósito: evita expor no servidor quais e-mails têm passkey.
 */
const BIO_KEY = 'agenda5588.bioReady';
const BIO_ASKED_KEY = 'agenda5588.bioAsked';

export function getBioReadyEmail(): string {
  return localStorage.getItem(BIO_KEY) || '';
}

export function setBioReadyEmail(email: string) {
  localStorage.setItem(BIO_KEY, email);
}

export function clearBioReadyEmail() {
  localStorage.removeItem(BIO_KEY);
}

export function wasBioAsked(email: string): boolean {
  return localStorage.getItem(BIO_ASKED_KEY) === email;
}

export function markBioAsked(email: string) {
  localStorage.setItem(BIO_ASKED_KEY, email);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && token) {
    setToken(null);
    onUnauthorized?.();
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message = (data as { error?: string })?.error || `Erro ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Download autenticado: o token vai no cabeçalho, nunca na URL. */
export async function downloadFile(path: string, fallbackName: string) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      onUnauthorized?.();
    }
    throw new ApiError('Não foi possível gerar o arquivo', res.status);
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export type UploadKind = 'background' | 'header';

export async function uploadImage(kind: UploadKind, file: File): Promise<{ url: string }> {
  const token = getToken();
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/admin/upload/${kind}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok) throw new ApiError(data.error || 'Falha no upload', res.status);
  return { url: data.url! };
}

/* --------------------------------- tipos --------------------------------- */

export type Status = 'pendente' | 'confirmado' | 'recusado' | 'realizado' | 'cancelado';
export type Role = 'admin' | 'gerente';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface AgendaRequest {
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

export interface FormConfig {
  title: string;
  description: string;
  backgroundUrl: string;
  headerImageUrl: string;
  successMessage: string;
  open: boolean;
  audienceOptions: string[];
}

export interface CalendarEvent {
  id: string;
  requestId?: string;
  protocol?: string;
  summary: string;
  status?: Status;
  date?: string;
  start: string;
  end: string;
  startTime?: string;
  endTime?: string;
  arrivalTime?: string;
  location: string;
  audience?: string;
  whatsapp?: string;
  description: string;
  htmlLink: string;
}

export const STATUS_LABELS: Record<Status, string> = {
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  recusado: 'Recusado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  gerente: 'Gerente de agenda',
};
