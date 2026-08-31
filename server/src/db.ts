import fs from 'fs';
import path from 'path';
import { createClient, type Client, type InArgs, type InValue } from '@libsql/client';
import { env } from './env';

// Em serverless nao existe disco gravavel: os diretorios so sao criados no modo local.
if (!env.serverless) {
  fs.mkdirSync(env.dataDir, { recursive: true });
  fs.mkdirSync(env.uploadsDir, { recursive: true });
}

const client: Client = env.tursoUrl
  ? createClient({ url: env.tursoUrl, authToken: env.tursoToken })
  : createClient({ url: `file:${path.join(env.dataDir, 'agenda.sqlite')}` });

/**
 * Casca fina sobre o cliente libSQL que imita a API do better-sqlite3.
 *
 * O motivo e simples: o codigo inteiro ja estava escrito no estilo
 * `db.prepare(sql).get(args)`, e o cliente novo e assincrono. Mantendo a mesma
 * assinatura, a migracao vira "colocar await na frente" em vez de reescrever
 * as 41 consultas na mao — muito menos espaco para erro.
 *
 * O SQL nao muda: o Turso fala o mesmo dialeto do SQLite.
 */
interface Statement {
  get<T = any>(...args: any[]): Promise<T | undefined>;
  all<T = any>(...args: any[]): Promise<T[]>;
  run(...args: any[]): Promise<void>;
}

/** Aceita tanto `.run(a, b)` posicional quanto `.run({ chave: valor })` nomeado. */
function toArgs(args: any[]): InArgs {
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    return args[0] as InArgs;
  }
  return args as InValue[];
}

/** Converte a linha do libSQL (array-like) em objeto simples. */
function toPlain<T>(columns: string[], row: any): T {
  const out: Record<string, unknown> = {};
  columns.forEach((c, i) => {
    out[c] = row[i];
  });
  return out as T;
}

export const db = {
  prepare(sql: string): Statement {
    return {
      async get<T>(...args: any[]) {
        const res = await client.execute({ sql, args: toArgs(args) });
        return res.rows.length ? toPlain<T>(res.columns, res.rows[0]) : undefined;
      },
      async all<T>(...args: any[]) {
        const res = await client.execute({ sql, args: toArgs(args) });
        return res.rows.map((r) => toPlain<T>(res.columns, r));
      },
      async run(...args: any[]) {
        await client.execute({ sql, args: toArgs(args) });
      },
    };
  },

  /** Executa varias instrucoes de uma vez (usado na criacao do schema). */
  async exec(sql: string) {
    await client.executeMultiple(sql);
  },

  /** Grupo de escritas atomico. */
  async batch(statements: { sql: string; args: InArgs }[]) {
    if (statements.length) await client.batch(statements, 'write');
  },
};

const SCHEMA = `
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
  needs_material INTEGER NOT NULL DEFAULT 0,
  team_size INTEGER,
  event_type TEXT,
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

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo',
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  location TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  collect_open INTEGER NOT NULL DEFAULT 1,
  event_type TEXT,
  request_id TEXT,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS attendees (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  cep TEXT,
  district TEXT,
  city TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  UNIQUE (event_id, whatsapp)
);

CREATE INDEX IF NOT EXISTS idx_requests_date ON requests(event_date);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_attendees_event ON attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_wa_user ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_log_request ON activity_log(request_id);
`;

/**
 * Cria as tabelas se ainda nao existirem. E idempotente e barato, entao pode
 * rodar a cada cold start da funcao serverless sem problema.
 */
export async function initSchema() {
  await db.exec(SCHEMA);
  // Colunas adicionadas depois: o CREATE TABLE acima so vale para bancos novos.
  for (const ddl of [
    'ALTER TABLE requests ADD COLUMN needs_material INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE requests ADD COLUMN team_size INTEGER',
    'ALTER TABLE requests ADD COLUMN event_type TEXT',
    'ALTER TABLE events ADD COLUMN event_type TEXT',
  ]) {
    try {
      await db.exec(ddl);
    } catch {
      /* coluna ja existe */
    }
  }
}

/* ---------------------------------------------------------------------------
 * Estado temporario (desafios WebAuthn, state do OAuth do Google).
 * Antes ficava em Map na memoria do processo; em serverless cada requisicao
 * pode cair em outra instancia, entao esse estado precisa ir para o banco.
 * Reusa a tabela settings com prefixo proprio e expiracao embutida no valor.
 * ------------------------------------------------------------------------- */

export async function putTransient(key: string, value: string, ttlMs: number) {
  const payload = JSON.stringify({ v: value, exp: Date.now() + ttlMs });
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(`_tmp:${key}`, payload);
}

/** Le e consome (uso unico). Devolve null se nao existe ou expirou. */
export async function takeTransient(key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string }>(`_tmp:${key}`);
  await db.prepare('DELETE FROM settings WHERE key = ?').run(`_tmp:${key}`);
  if (!row) return null;
  try {
    const { v, exp } = JSON.parse(row.value);
    return exp > Date.now() ? v : null;
  } catch {
    return null;
  }
}

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
  events_msg_header: `📣 *AGENDA DE AÇÕES* [{{periodo}}]

Pessoal, confira a programação das próximas ações de campanha.
Vamos nos organizar para garantir a presença e a participação de todos!`,
  events_msg_footer: '',
  events_msg_link_label: '📝 Confirme presença:',
  google_client_id: '',
  google_client_secret: '',
  google_calendar_id: 'primary',
  google_tokens: '',
  google_event_prefix: '[AGENDA 5588]',
  timezone: 'America/Sao_Paulo',
};

export async function getSettings(): Promise<SettingsMap> {
  const rows = await db
    .prepare("SELECT key, value FROM settings WHERE key NOT LIKE '_tmp:%'")
    .all<{ key: string; value: string }>();
  const map: SettingsMap = { ...DEFAULT_SETTINGS };
  for (const r of rows) map[r.key] = r.value ?? '';
  return map;
}

export async function getSetting(key: string): Promise<string> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string }>(key);
  return row?.value ?? DEFAULT_SETTINGS[key] ?? '';
}

export async function setSettings(patch: SettingsMap) {
  await db.batch(
    Object.entries(patch).map(([k, v]) => ({
      sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      args: [k, v] as [string, string],
    }))
  );
}

/**
 * Carga inicial de configuracoes. Roda uma unica vez, quando o banco ainda nao
 * tem nenhuma configuracao salva — assim uma implantacao nova ja sobe com o
 * formulario e as mensagens prontos, sem ninguem ter que digitar de novo.
 *
 * O arquivo nao guarda segredos: credenciais e tokens do Google ficam de fora
 * de proposito e sao configurados em cada ambiente.
 */
export async function seedSettings() {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM settings').get<{ n: number }>();
  if ((row?.n ?? 0) > 0) return;

  const candidatos = [
    path.join(env.seedDir, 'settings.json'),
    path.join(__dirname, '..', '..', 'seed', 'settings.json'),
    // Na Vercel a funcao roda a partir de outra raiz; o arquivo vai junto
    // pelo includeFiles do vercel.json.
    path.join(process.cwd(), 'seed', 'settings.json'),
  ];

  try {
    const arquivo = candidatos.find((f) => fs.existsSync(f));
    if (!arquivo) return;

    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as SettingsMap;
    const validas = Object.fromEntries(
      Object.entries(dados).filter(([k, v]) => k in DEFAULT_SETTINGS && typeof v === 'string')
    );
    if (!Object.keys(validas).length) return;
    await setSettings(validas);
    console.log(`[seed] ${Object.keys(validas).length} configuracoes carregadas de ${arquivo}`);
  } catch (e) {
    console.warn('[seed] nao foi possivel ler o arquivo de carga inicial:', (e as Error).message);
  }
}
