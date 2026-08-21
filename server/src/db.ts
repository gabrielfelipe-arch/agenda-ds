import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { env } from './env';

fs.mkdirSync(env.dataDir, { recursive: true });
fs.mkdirSync(env.uploadsDir, { recursive: true });

export const db = new Database(path.join(env.dataDir, 'agenda.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  protocol TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  requester_name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  duration_hours INTEGER NOT NULL,
  arrival_time TEXT NOT NULL,
  cep TEXT,
  street TEXT,
  number TEXT,
  complement TEXT,
  district TEXT,
  city TEXT,
  state TEXT,
  reference TEXT,
  audience TEXT NOT NULL,
  agenda TEXT NOT NULL,
  admin_notes TEXT,
  google_event_id TEXT,
  google_event_link TEXT,
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'gerente',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device_name TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  request_id TEXT,
  action TEXT NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_requests_date ON requests(event_date);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_wa_user ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_log_request ON activity_log(request_id);
`);

export type SettingsMap = Record<string, string>;

export const DEFAULT_SETTINGS: SettingsMap = {
  form_title: 'SOLICITAÇÃO DE AGENDA - TODOS PELA SAÚDE',
  form_description:
    'Este formulário é destinado à solicitação de agendas e atividades públicas relacionadas às candidaturas de Daniel Soranz (5588), para deputado federal, e Eduardo Paes (55), para governador do Rio de Janeiro.\n\nAs solicitações serão analisadas, considerando a organização e a disponibilidade das agendas.\n\nO retorno será realizado pelo WhatsApp informado no momento da inscrição.\n\nO preenchimento deste formulário representa uma solicitação de agenda e não uma confirmação de realização.',
  form_background_url: '/assets/candidatos.jpg',
  form_header_image_url: '/assets/5588.jpg',
  form_success_message:
    'Solicitação enviada com sucesso! Nossa equipe fará a análise e o retorno será feito pelo WhatsApp informado.',
  form_open: 'true',
  whatsapp_confirm_template: `✅ *AGENDA CONFIRMADA!*

Olá, *{{nome}}*! 👋
Sua solicitação de agenda foi *CONFIRMADA*. 🎉

🗓️ *Data:* {{data}}
⏰ *Início:* {{hora}}
⏳ *Duração:* {{duracao}}
🚗 *Chegada da equipe:* {{chegada}}
📍 *Local:* {{endereco}}
👥 *Público estimado:* {{publico}}

📝 *Pauta:* {{pauta}}

Contamos com você! Qualquer alteração, responda por aqui. 💙

*Seu voto é + saúde para sua família* 💚
*Daniel Soranz 5588* | *Eduardo Paes 55*`,
  whatsapp_reject_template: `Olá, *{{nome}}*! 👋

Agradecemos muito o seu convite para o dia *{{data}}*. 🙏

Infelizmente, não será possível confirmar essa agenda devido à disponibilidade do cronograma. 😔

Seguimos à disposição para novas oportunidades!

*Daniel Soranz 5588* | *Eduardo Paes 55* 💙`,
  whatsapp_reschedule_template: `\u{1F504} *AGENDA REMARCADA*

Ol\u00e1, *{{nome}}*! \u{1F44B}
Conforme combinamos, sua agenda foi *remarcada*. \u2705

\u{1F5D3}\ufe0f *Nova data:* {{data}}
\u23f0 *In\u00edcio:* {{hora}}
\u23f3 *Dura\u00e7\u00e3o:* {{duracao}}
\u{1F697} *Chegada da equipe:* {{chegada}}
\u{1F4CD} *Local:* {{endereco}}
\u{1F465} *P\u00fablico estimado:* {{publico}}

\u{1F4DD} *Pauta:* {{pauta}}

Nos vemos l\u00e1! \u{1F499}

*Seu voto \u00e9 + sa\u00fade para sua fam\u00edlia* \u{1F49A}
*Daniel Soranz 5588* | *Eduardo Paes 55*`,
  whatsapp_emojis: 'auto',
  google_client_id: '',
  google_client_secret: '',
  google_calendar_id: 'primary',
  google_tokens: '',
  google_event_prefix: '[AGENDA 5588]',
  timezone: 'America/Sao_Paulo',
};

export function getSettings(): SettingsMap {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map: SettingsMap = { ...DEFAULT_SETTINGS };
  for (const r of rows) map[r.key] = r.value ?? '';
  return map;
}

export function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULT_SETTINGS[key] ?? '';
}

export function setSettings(patch: SettingsMap) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const tx = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) stmt.run(k, v);
  });
  tx(Object.entries(patch));
}
