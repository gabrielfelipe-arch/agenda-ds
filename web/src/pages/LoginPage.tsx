import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import {
  api,
  clearBioReadyEmail,
  getBioReadyEmail,
  getLastEmail,
  setBioReadyEmail,
  setLastEmail,
  type User,
} from '../api';
import { useAuth } from '../auth';
import { Icon, initials, isMobileDevice } from '../ui';

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  // Biometria só em celular/tablet: no computador o acesso é sempre por senha.
  const isMobile = isMobileDevice();
  const bioEmail = isMobile ? getBioReadyEmail() : '';

  const [email, setEmail] = useState(getLastEmail());
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'senha' | 'bio' | null>(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  // Se este aparelho já tem biometria cadastrada, ela é a porta de entrada principal.
  const [mode, setMode] = useState<'bio' | 'senha'>(bioEmail ? 'bio' : 'senha');

  useEffect(() => {
    if (user) navigate('/admin', { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    if (!isMobile || !browserSupportsWebAuthn()) {
      setBioAvailable(false);
      setMode('senha');
      return;
    }
    api
      .get<{ enabled: boolean }>('/auth/webauthn/support')
      .then((s) => {
        setBioAvailable(s.enabled);
        if (!s.enabled) setMode('senha');
      })
      .catch(() => {
        setBioAvailable(false);
        setMode('senha');
      });
  }, [isMobile]);

  function finish(res: { token: string; user: User }) {
    setLastEmail(res.user.email);
    login(res.user, res.token);
    navigate('/admin', { replace: true });
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy('senha');
    try {
      const res = await api.post<{ token: string; user: User }>('/auth/login', {
        email: email.trim(),
        password,
      });
      finish(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function loginWithBiometrics() {
    setError('');
    setBusy('bio');
    try {
      const target = (bioEmail || email || getLastEmail()).trim();
      if (!target) throw new Error('Informe o e-mail para usar a biometria');
      const options = await api.post<PublicKeyCredentialRequestOptionsJSON>('/auth/webauthn/login/options', {
        email: target,
      });
      const assertion = await startAuthentication({ optionsJSON: options });
      const res = await api.post<{ token: string; user: User }>('/auth/webauthn/login/verify', {
        email: target,
        response: assertion,
      });
      setBioReadyEmail(res.user.email);
      finish(res);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/não encontrad|Nenhuma biometria/i.test(msg)) {
        clearBioReadyEmail();
        setMode('senha');
        setError('A biometria deste aparelho não está mais válida. Entre com e-mail e senha.');
      } else {
        setError(/NotAllowed|abort/i.test(msg) ? 'Autenticação biométrica cancelada.' : msg);
      }
    } finally {
      setBusy(null);
    }
  }

  const showBioFirst = mode === 'bio' && bioAvailable && Boolean(bioEmail);

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <img src="/assets/icon.svg" width={34} height={34} alt="" />
          Agenda 5588
        </div>

        <div className="card">
          {showBioFirst ? (
            <>
              <div className="bio-hero">
                <span className="avatar" style={{ width: 46, height: 46, fontSize: '1rem' }}>
                  {initials(bioEmail)}
                </span>
                <h1 className="page-title" style={{ marginTop: 6 }}>
                  Bem-vindo de volta
                </h1>
                <p className="page-sub" style={{ marginTop: 0, textAlign: 'center' }}>
                  {bioEmail}
                </p>

                {error && (
                  <div className="alert alert-error" style={{ width: '100%', margin: '6px 0' }}>
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  className="bio-hero-btn"
                  onClick={() => void loginWithBiometrics()}
                  disabled={busy !== null}
                  aria-label="Entrar com biometria"
                >
                  {busy === 'bio' ? <div className="spinner dark" /> : <Icon.Fingerprint />}
                </button>
                <span className="hint">Toque para entrar com sua digital ou reconhecimento facial</span>

                <button type="button" className="link-btn" onClick={() => setMode('senha')} style={{ marginTop: 8 }}>
                  Entrar com e-mail e senha
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="page-title" style={{ marginBottom: 4 }}>
                Área restrita
              </h1>
              <p className="page-sub" style={{ marginBottom: 20 }}>
                Acesso exclusivo da equipe de agenda.
              </p>

              {error && (
                <div className="alert alert-error" style={{ marginBottom: 16 }}>
                  {error}
                </div>
              )}

              <form onSubmit={submitPassword}>
                <div className="field">
                  <label className="label" htmlFor="email">
                    E-mail
                  </label>
                  <input
                    id="email"
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    required
                    placeholder="voce@exemplo.com"
                  />
                </div>

                <div className="field">
                  <label className="label" htmlFor="senha">
                    Senha
                  </label>
                  <input
                    id="senha"
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>

                <div style={{ marginTop: 20 }}>
                  <button className="btn btn-primary btn-block" type="submit" disabled={busy !== null}>
                    {busy === 'senha' && <div className="spinner" />}
                    Entrar
                  </button>
                </div>
              </form>

              {bioAvailable && bioEmail && (
                <>
                  <div className="divider">ou</div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-block"
                    onClick={() => setMode('bio')}
                    disabled={busy !== null}
                  >
                    <Icon.Fingerprint />
                    Entrar com biometria
                  </button>
                </>
              )}

              {bioAvailable && !bioEmail && (
                <p className="hint" style={{ marginTop: 14, textAlign: 'center' }}>
                  Após entrar com a senha, você poderá ativar o acesso por biometria neste aparelho.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
