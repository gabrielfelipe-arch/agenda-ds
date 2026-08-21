import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, uploadImage, type UploadKind } from '../api';
import { Icon, useToast } from '../ui';

interface Settings {
  form_title: string;
  form_description: string;
  form_background_url: string;
  form_header_image_url: string;
  form_success_message: string;
  form_open: string;
  whatsapp_confirm_template: string;
  whatsapp_reject_template: string;
  google_client_id: string;
  google_client_secret: string;
  google_calendar_id: string;
  google_event_prefix: string;
  timezone: string;
  google_connected: boolean;
  google_redirect_uri: string;
}

interface GoogleStatus {
  connected: boolean;
  configured: boolean;
  calendarId: string;
  redirectUri: string;
  account: string;
}

const TABS = ['Formulário', 'Mensagens', 'Google Agenda'] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('google') ? 'Google Agenda' : 'Formulário');
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Settings>('/admin/settings')
      .then(setS)
      .catch((e) => toast.err((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const g = params.get('google');
    if (!g) return;
    const msg = params.get('msg') || '';
    if (g === 'ok') toast.ok(msg || 'Google Agenda conectado.');
    else toast.err(msg || 'Falha ao conectar o Google Agenda.');
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => (p ? { ...p, [k]: v } : p));

  async function save() {
    if (!s) return;
    setBusy(true);
    try {
      const { google_connected, google_redirect_uri, ...payload } = s;
      void google_connected;
      void google_redirect_uri;
      await api.put('/admin/settings', payload);
      toast.ok('Configurações salvas.');
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!s) {
    return (
      <div className="loading-page">
        <div className="spinner dark" />
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Configurações</h1>
          <p className="page-sub">Aparência do formulário, mensagens de WhatsApp e integração com o Google</p>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={busy}>
          {busy && <div className="spinner" />}
          Salvar alterações
        </button>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Formulário' && <FormTab s={s} set={set} />}
      {tab === 'Mensagens' && <MessagesTab s={s} set={set} />}
      {tab === 'Google Agenda' && <GoogleTab s={s} set={set} />}
    </>
  );
}

type Setter = <K extends keyof Settings>(k: K, v: Settings[K]) => void;

function FormTab({ s, set }: { s: Settings; set: Setter }) {
  const toast = useToast();
  const bgRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<UploadKind | null>(null);

  async function pick(kind: UploadKind, file: File) {
    setUploading(kind);
    try {
      const res = await uploadImage(kind, file);
      set(kind === 'header' ? 'form_header_image_url' : 'form_background_url', res.url);
      toast.ok(kind === 'header' ? 'Banner do cabeçalho atualizado.' : 'Imagem de fundo atualizada.');
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="section-title">Cabeçalho do formulário</div>
        <div className="field">
          <label className="label">Título</label>
          <input className="input" value={s.form_title} onChange={(e) => set('form_title', e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Descrição</label>
          <span className="hint">Aparece abaixo do título, igual ao Google Forms. Quebras de linha são mantidas.</span>
          <textarea
            className="textarea"
            rows={8}
            value={s.form_description}
            onChange={(e) => set('form_description', e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">Mensagem de confirmação de envio</label>
          <textarea
            className="textarea"
            rows={3}
            value={s.form_success_message}
            onChange={(e) => set('form_success_message', e.target.value)}
          />
        </div>
        <div className="field">
          <label className="switch">
            <input
              type="checkbox"
              checked={s.form_open !== 'false'}
              onChange={(e) => set('form_open', e.target.checked ? 'true' : 'false')}
            />
            <span>Formulário aberto para novas solicitações</span>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Banner do cabeçalho</div>
        <p className="hint" style={{ marginBottom: 12 }}>
          Arte que aparece no topo do formulário, acima do título. Funciona melhor em formato faixa
          (proporção próxima de 4:1, por exemplo 800×200 ou 1600×400).
        </p>

        {s.form_header_image_url && (
          <img
            src={s.form_header_image_url}
            alt="Prévia do banner"
            style={{
              display: 'block',
              width: '100%',
              maxWidth: 560,
              height: 'auto',
              borderRadius: 10,
              border: '1px solid var(--line)',
              marginBottom: 14,
            }}
          />
        )}

        <div className="field">
          <label className="label">Caminho do banner</label>
          <input
            className="input"
            value={s.form_header_image_url}
            onChange={(e) => set('form_header_image_url', e.target.value)}
            placeholder="/assets/5588.jpg"
          />
        </div>

        <input
          ref={headerRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick('header', f);
            e.target.value = '';
          }}
        />
        <button
          className="btn btn-ghost"
          onClick={() => headerRef.current?.click()}
          disabled={uploading !== null}
        >
          {uploading === 'header' ? <div className="spinner dark" /> : <Icon.Plus />}
          Enviar banner
        </button>
        {s.form_header_image_url && (
          <button
            className="btn btn-danger btn-sm"
            style={{ marginLeft: 8 }}
            onClick={() => set('form_header_image_url', '')}
          >
            Remover
          </button>
        )}
      </div>

      <div className="card">
        <div className="section-title">Imagem de fundo (marca d'água)</div>
        <p className="hint" style={{ marginBottom: 12 }}>
          A imagem dos candidatos aparece como marca d'água opaca atrás do formulário, no estilo sombra de
          documento — sem atrapalhar a leitura dos campos.
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div
            style={{
              width: 190,
              height: 240,
              borderRadius: 12,
              border: '1px solid var(--line)',
              background: '#f8fafd',
              position: 'relative',
              overflow: 'hidden',
              flex: 'none',
            }}
          >
            {s.form_background_url && (
              <img
                src={s.form_background_url}
                alt="Prévia do fundo"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  objectPosition: 'center top',
                  opacity: 0.12,
                  filter: 'grayscale(0.3) contrast(0.92) blur(1px)',
                }}
              />
            )}
            <div style={{ position: 'relative', padding: 12 }}>
              <div style={{ height: 8, width: '60%', background: 'var(--navy)', borderRadius: 4 }} />
              <div style={{ height: 6, width: '85%', background: '#dde5f0', borderRadius: 4, marginTop: 10 }} />
              <div style={{ height: 6, width: '75%', background: '#dde5f0', borderRadius: 4, marginTop: 6 }} />
              <div style={{ height: 34, background: '#fff', border: '1px solid var(--line)', borderRadius: 6, marginTop: 14 }} />
              <div style={{ height: 34, background: '#fff', border: '1px solid var(--line)', borderRadius: 6, marginTop: 8 }} />
            </div>
          </div>

          <div style={{ flex: '1 1 260px' }}>
            <div className="field">
              <label className="label">Caminho da imagem</label>
              <input
                className="input"
                value={s.form_background_url}
                onChange={(e) => set('form_background_url', e.target.value)}
                placeholder="/assets/candidatos.jpg"
              />
              <span className="hint">
                Use o botão abaixo para enviar a arte dos candidatos, ou informe um caminho já existente.
              </span>
            </div>
            <input
              ref={bgRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pick('background', f);
                e.target.value = '';
              }}
            />
            <button
              className="btn btn-ghost"
              onClick={() => bgRef.current?.click()}
              disabled={uploading !== null}
            >
              {uploading === 'background' ? <div className="spinner dark" /> : <Icon.Plus />}
              Enviar imagem de fundo
            </button>
            {s.form_background_url && (
              <button
                className="btn btn-danger btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => set('form_background_url', '')}
              >
                Remover
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const PLACEHOLDERS = [
  ['{{nome}}', 'nome do solicitante'],
  ['{{data}}', 'data do evento (dd/mm/aaaa)'],
  ['{{hora}}', 'horário de início'],
  ['{{fim}}', 'horário de término'],
  ['{{duracao}}', 'duração em horas'],
  ['{{chegada}}', 'horário de chegada da equipe'],
  ['{{endereco}}', 'endereço completo'],
  ['{{publico}}', 'público estimado'],
  ['{{pauta}}', 'pauta / briefing'],
  ['{{protocolo}}', 'número do protocolo'],
];

function MessagesTab({ s, set }: { s: Settings; set: Setter }) {
  return (
    <div className="stack">
      <div className="card">
        <div className="section-title">Variáveis disponíveis</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {PLACEHOLDERS.map(([k, d]) => (
            <span key={k} className="code" style={{ display: 'inline-block' }} title={d}>
              {k}
            </span>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          O WhatsApp aceita *negrito*, _itálico_ e emojis. As quebras de linha são mantidas.
        </p>
      </div>

      <div className="card">
        <div className="section-title">Mensagem de confirmação</div>
        <textarea
          className="textarea"
          rows={16}
          value={s.whatsapp_confirm_template}
          onChange={(e) => set('whatsapp_confirm_template', e.target.value)}
        />
      </div>

      <div className="card">
        <div className="section-title">Mensagem de recusa / retorno negativo</div>
        <textarea
          className="textarea"
          rows={10}
          value={s.whatsapp_reject_template}
          onChange={(e) => set('whatsapp_reject_template', e.target.value)}
        />
      </div>
    </div>
  );
}

function GoogleTab({ s, set }: { s: Settings; set: Setter }) {
  const toast = useToast();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [calendars, setCalendars] = useState<{ id: string; summary: string; primary: boolean }[]>([]);
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    try {
      const st = await api.get<GoogleStatus>('/google/status');
      setStatus(st);
      if (st.connected) {
        const cal = await api.get<{ items: typeof calendars }>('/google/calendars');
        setCalendars(cal.items);
      }
    } catch {
      /* silencioso */
    }
  }

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setBusy(true);
    try {
      // salva as credenciais antes de iniciar o OAuth
      await api.put('/admin/settings', {
        google_client_id: s.google_client_id,
        ...(s.google_client_secret && s.google_client_secret !== '********'
          ? { google_client_secret: s.google_client_secret }
          : {}),
      });
      const res = await api.get<{ url: string }>('/google/auth-url');
      window.location.href = res.url;
    } catch (e) {
      toast.err((e as Error).message);
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Desconectar o Google Agenda? Os eventos já criados permanecem no Google.')) return;
    try {
      await api.post('/google/disconnect');
      toast.ok('Google Agenda desconectado.');
      setCalendars([]);
      await loadStatus();
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="section-title">Situação da integração</div>
        {status?.connected ? (
          <div className="alert alert-ok">
            Conectado{status.account ? ` como ${status.account}` : ''}. Agendas confirmadas são criadas
            automaticamente no Google Agenda.
          </div>
        ) : (
          <div className="alert alert-warn">
            Não conectado. O sistema funciona normalmente, mas os eventos não serão enviados ao Google Agenda.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => void connect()} disabled={busy}>
            <Icon.Google />
            {status?.connected ? 'Reconectar' : 'Conectar com o Google'}
          </button>
          {status?.connected && (
            <button className="btn btn-danger" onClick={() => void disconnect()}>
              Desconectar
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => void loadStatus()}>
            <Icon.Refresh />
            Verificar
          </button>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Credenciais OAuth</div>
        <p className="hint" style={{ marginBottom: 14 }}>
          No Google Cloud Console crie um projeto, ative a <strong>Google Calendar API</strong> e gere uma
          credencial do tipo <strong>ID do cliente OAuth · Aplicativo da Web</strong>. Copie o Client ID e o
          Client Secret aqui e cadastre exatamente esta URI de redirecionamento:
        </p>
        <code className="code">{s.google_redirect_uri}</code>

        <div className="field" style={{ marginTop: 16 }}>
          <label className="label">Client ID</label>
          <input
            className="input"
            value={s.google_client_id}
            onChange={(e) => set('google_client_id', e.target.value)}
            placeholder="000000-xxxx.apps.googleusercontent.com"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label className="label">Client Secret</label>
          <input
            className="input"
            type="password"
            value={s.google_client_secret}
            onChange={(e) => set('google_client_secret', e.target.value)}
            placeholder="GOCSPX-…"
            autoComplete="off"
          />
          <span className="hint">Deixe os asteriscos para manter o segredo já salvo.</span>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Agenda de destino</div>
        {calendars.length > 0 ? (
          <div className="field">
            <label className="label">Calendário</label>
            <select
              className="select"
              value={s.google_calendar_id}
              onChange={(e) => set('google_calendar_id', e.target.value)}
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.summary}
                  {c.primary ? ' (principal)' : ''}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="field">
            <label className="label">ID do calendário</label>
            <input
              className="input"
              value={s.google_calendar_id}
              onChange={(e) => set('google_calendar_id', e.target.value)}
              placeholder="primary"
            />
            <span className="hint">Conecte a conta para escolher o calendário em uma lista.</span>
          </div>
        )}

        <div className="grid-2">
          <div className="field">
            <label className="label">Prefixo no título do evento</label>
            <input
              className="input"
              value={s.google_event_prefix}
              onChange={(e) => set('google_event_prefix', e.target.value)}
              placeholder="[AGENDA 5588]"
            />
          </div>
          <div className="field">
            <label className="label">Fuso horário</label>
            <input className="input" value={s.timezone} onChange={(e) => set('timezone', e.target.value)} />
          </div>
        </div>
      </div>
    </div>
  );
}
