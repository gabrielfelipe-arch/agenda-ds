import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { api, ROLE_LABELS, getBioReadyEmail, markBioAsked, setBioReadyEmail, clearBioReadyEmail, wasBioAsked } from '../api';
import { useAuth } from '../auth';
import { Icon, Modal, formatDateTimeBR, initials, isMobileDevice, useToast } from '../ui';

interface Passkey {
  id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export default function AdminLayout() {
  const { user, loading, logout, can, passkeys, refresh } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [bioInvite, setBioInvite] = useState(false);

  // Padrão de app de banco: logou com senha na primeira vez -> oferece ativar a biometria.
  useEffect(() => {
    if (!user || loading) return;
    if (passkeys > 0) {
      setBioReadyEmail(user.email);
      return;
    }
    if (getBioReadyEmail() === user.email) clearBioReadyEmail();
    // O convite só aparece em celular/tablet.
    if (!isMobileDevice() || wasBioAsked(user.email) || !browserSupportsWebAuthn()) return;
    api
      .get<{ enabled: boolean }>('/auth/webauthn/support')
      .then((s) => setBioInvite(s.enabled))
      .catch(() => undefined);
  }, [user, loading, passkeys]);

  if (loading) {
    return (
      <div className="loading-page">
        <div className="spinner dark" />
        <span>Carregando…</span>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  const navItems = [
    { to: '/admin/solicitacoes', label: 'Solicitações', short: 'Agendas', icon: <Icon.List />, roles: ['admin', 'gerente'] },
    { to: '/admin/agenda', label: 'Agenda', short: 'Calendário', icon: <Icon.Calendar />, roles: ['admin', 'gerente'] },
    { to: '/admin/eventos', label: 'Eventos', short: 'Eventos', icon: <Icon.Group />, roles: ['admin', 'gerente'] },
    { to: '/admin/relatorios', label: 'Relatórios', short: 'Relatórios', icon: <Icon.Download />, roles: ['admin', 'gerente'] },
    { to: '/admin/usuarios', label: 'Usuários', short: 'Usuários', icon: <Icon.Users />, roles: ['admin'] },
    { to: '/admin/configuracoes', label: 'Configurações', short: 'Config.', icon: <Icon.Settings />, roles: ['admin'] },
  ].filter((i) => i.roles.includes(user.role));

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="/assets/icon.svg" width={30} height={30} alt="" />
          <div>
            Agenda 5588
            <small>Todos pela Saúde</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">Gestão</div>
          {navItems
            .filter((i) => !i.roles.includes('admin') || i.roles.length > 1)
            .map((i) => (
              <NavLink key={i.to} to={i.to}>
                {i.icon}
                {i.label}
              </NavLink>
            ))}
          {can('admin') && (
            <>
              <div className="sidebar-section">Administração</div>
              {navItems
                .filter((i) => i.roles.length === 1 && i.roles[0] === 'admin')
                .map((i) => (
                  <NavLink key={i.to} to={i.to}>
                    {i.icon}
                    {i.label}
                  </NavLink>
                ))}
            </>
          )}
        </nav>

        <div className="sidebar-foot">
          <button className="sidebar-user" onClick={() => setProfileOpen(true)}>
            <span className="avatar">{initials(user.name)}</span>
            <span className="who">
              <b>{user.name}</b>
              <span>{ROLE_LABELS[user.role]}</span>
            </span>
            <Icon.Chevron />
          </button>
        </div>
      </aside>

      <div className="admin-body">
        <header className="topbar">
          <div className="topbar-title">
            <img src="/assets/icon.svg" width={24} height={24} alt="" />
            Agenda 5588
          </div>
          <div className="topbar-spacer" />
          <button className="avatar avatar-btn" onClick={() => setProfileOpen(true)} aria-label="Meu perfil">
            {initials(user.name)}
          </button>
        </header>

        <main className="admin-main">
          <Outlet />
        </main>
      </div>

      <nav className="nav-mobile">
        {navItems.map((i) => (
          <NavLink key={i.to} to={i.to}>
            {i.icon}
            {i.short}
          </NavLink>
        ))}
      </nav>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} onLogout={logout} />}

      {bioInvite && user && (
        <BiometricInvite
          email={user.email}
          onDone={async () => {
            setBioInvite(false);
            await refresh();
          }}
          onSkip={() => {
            markBioAsked(user.email);
            setBioInvite(false);
          }}
        />
      )}
    </div>
  );
}

function ProfileModal({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ items: Passkey[] }>('/auth/webauthn/credentials')
      .then((r) => setPasskeys(r.items))
      .catch(() => undefined);
    api
      .get<{ enabled: boolean }>('/auth/webauthn/support')
      .then((s) => setBioEnabled(s.enabled && browserSupportsWebAuthn() && isMobileDevice()))
      .catch(() => setBioEnabled(false));
  }, []);

  async function registerBiometrics() {
    setBusy(true);
    try {
      const options = await api.post<PublicKeyCredentialCreationOptionsJSON>('/auth/webauthn/register/options');
      const attestation = await startRegistration({ optionsJSON: options });
      const res = await api.post<{ credentials: Passkey[] }>('/auth/webauthn/register/verify', {
        response: attestation,
        device_name: deviceName(),
      });
      setPasskeys(res.credentials);
      if (user) setBioReadyEmail(user.email);
      await refresh();
      toast.ok('Biometria cadastrada! Você já pode entrar com a digital neste aparelho.');
    } catch (e) {
      const msg = (e as Error).message || '';
      toast.err(/NotAllowed|abort/i.test(msg) ? 'Cadastro de biometria cancelado.' : msg);
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id: string) {
    try {
      const res = await api.del<{ items: Passkey[] }>(`/auth/webauthn/credentials/${encodeURIComponent(id)}`);
      setPasskeys(res.items);
      if (!res.items.length) clearBioReadyEmail();
      await refresh();
      toast.ok('Biometria removida.');
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next });
      setCurrent('');
      setNext('');
      toast.ok('Senha alterada com sucesso.');
    } catch (err) {
      toast.err((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Meu perfil"
      onClose={onClose}
      footer={
        <button
          className="btn btn-danger"
          onClick={() => {
            onLogout();
            navigate('/login', { replace: true });
          }}
        >
          <Icon.Logout />
          Sair da conta
        </button>
      }
    >
      <div className="detail-grid">
        <div className="detail-item">
          <div className="k">Nome</div>
          <div className="v">{user?.name}</div>
        </div>
        <div className="detail-item">
          <div className="k">E-mail</div>
          <div className="v">{user?.email}</div>
        </div>
        <div className="detail-item">
          <div className="k">Perfil</div>
          <div className="v">
            <span className={`pill-role ${user?.role}`}>{user ? ROLE_LABELS[user.role] : ''}</span>
          </div>
        </div>
      </div>

      <div className="section-title">Acesso por biometria</div>
      {!isMobileDevice() ? (
        <div className="alert alert-warn">
          A biometria funciona apenas no celular e no tablet. Neste computador o acesso é sempre por e-mail e
          senha.
        </div>
      ) : !bioEnabled ? (
        <div className="alert alert-warn">
          A biometria exige conexão segura (HTTPS). Acesse pelo endereço HTTPS da Tailscale para habilitar.
        </div>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 12 }}>
            Cadastre a digital ou o reconhecimento facial deste celular para entrar sem digitar a senha. A
            credencial fica guardada apenas neste aparelho.
          </p>
          <button className="btn btn-ghost" onClick={() => void registerBiometrics()} disabled={busy}>
            <Icon.Fingerprint />
            Cadastrar biometria deste aparelho
          </button>
          {passkeys.length > 0 && (
            <div className="stack" style={{ marginTop: 14 }}>
              {passkeys.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: '10px 12px',
                  }}
                >
                  <Icon.Fingerprint />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.device_name || 'Dispositivo'}</div>
                    <div className="cell-soft">
                      Cadastrada em {formatDateTimeBR(p.created_at)}
                      {p.last_used_at ? ` · último uso ${formatDateTimeBR(p.last_used_at)}` : ''}
                    </div>
                  </div>
                  <button className="icon-btn" onClick={() => void removePasskey(p.id)} aria-label="Remover">
                    <Icon.Trash />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="section-title">Alterar senha</div>
      <form onSubmit={changePassword}>
        <div className="grid-2">
          <div className="field">
            <label className="label">Senha atual</label>
            <input
              className="input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="field">
            <label className="label">Nova senha</label>
            <input
              className="input"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy}>
          Salvar nova senha
        </button>
      </form>
    </Modal>
  );
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Este dispositivo';
}


function BiometricInvite({
  email,
  onDone,
  onSkip,
}: {
  email: string;
  onDone: () => void | Promise<void>;
  onSkip: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function activate() {
    setBusy(true);
    try {
      const options = await api.post<PublicKeyCredentialCreationOptionsJSON>('/auth/webauthn/register/options');
      const attestation = await startRegistration({ optionsJSON: options });
      await api.post('/auth/webauthn/register/verify', { response: attestation, device_name: deviceName() });
      setBioReadyEmail(email);
      markBioAsked(email);
      toast.ok('Pronto! Nos próximos acessos você entra com a biometria.');
      await onDone();
    } catch (e) {
      const msg = (e as Error).message || '';
      toast.err(/NotAllowed|abort/i.test(msg) ? 'Ativação cancelada.' : msg);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Entrar mais rápido"
      onClose={onSkip}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onSkip} disabled={busy}>
            Agora não
          </button>
          <button className="btn btn-primary" onClick={() => void activate()} disabled={busy}>
            {busy ? <div className="spinner" /> : <Icon.Fingerprint />}
            Ativar biometria
          </button>
        </>
      }
    >
      <div style={{ textAlign: 'center', padding: '10px 4px 4px' }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: 'var(--blue-50)',
            color: 'var(--navy)',
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 16px',
          }}
        >
          <Icon.Fingerprint className="bio-big" />
        </div>
        <p style={{ margin: 0, lineHeight: 1.6, color: 'var(--ink-soft)' }}>
          Você entrou com e-mail e senha. Quer usar a <strong>digital ou o reconhecimento facial</strong> deste
          aparelho nos próximos acessos?
        </p>
        <p className="hint" style={{ marginTop: 12 }}>
          A biometria não sai do seu dispositivo — o sistema recebe apenas a confirmação de que foi você.
        </p>
      </div>
    </Modal>
  );
}
