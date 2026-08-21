import { Router } from 'express';
import { z } from 'zod';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { db, putTransient, takeTransient } from '../db';
import { env } from '../env';
import {
  AuthedRequest,
  UserRow,
  checkPassword,
  findUserByEmail,
  hashPassword,
  requireAuth,
  signToken,
  toPublicUser,
} from '../auth';

export const authRouter = Router();

/* ------------------------- helpers de WebAuthn ------------------------- */

function rpID(): string {
  try {
    return new URL(env.publicUrl).hostname;
  } catch {
    return 'localhost';
  }
}

function expectedOrigins(): string[] {
  const list = new Set<string>([env.publicUrl]);
  const extra = process.env.WEBAUTHN_ORIGINS || '';
  for (const o of extra.split(',').map((s) => s.trim()).filter(Boolean)) list.add(o.replace(/\/+$/, ''));
  return [...list];
}

/* Desafios vao para o banco: em serverless a verificacao pode cair em outra
 * instancia, e um Map em memoria se perderia entre as duas requisicoes. */
function putChallenge(key: string, challenge: string) {
  return putTransient(`wa:${key}`, challenge, 5 * 60_000);
}

function takeChallenge(key: string): Promise<string | null> {
  return takeTransient(`wa:${key}`);
}

interface CredentialRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
}

function credentialsOf(userId: string): Promise<CredentialRow[]> {
  return db
    .prepare('SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC')
    .all<CredentialRow>(userId);
}

async function touchLogin(user: UserRow) {
  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
}

/* ------------------------------- login ------------------------------- */

const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const user = await findUserByEmail(parsed.data.email);
  if (!user || !checkPassword(parsed.data.password, user.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos' });
  }
  if (!user.active) return res.status(403).json({ error: 'Usuário desativado. Procure um administrador.' });

  await touchLogin(user);
  res.json({ token: signToken(user), user: toPublicUser(user) });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user!;
  res.json({ user: toPublicUser(user), passkeys: (await credentialsOf(user.id)).length });
});

const passwordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8, 'A nova senha deve ter ao menos 8 caracteres'),
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user!;
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!checkPassword(parsed.data.current_password, user.password_hash)) {
    return res.status(400).json({ error: 'Senha atual incorreta' });
  }
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    hashPassword(parsed.data.new_password),
    user.id
  );
  res.json({ ok: true });
});

/* --------------------- biometria: cadastro (passkey) --------------------- */

authRouter.post('/webauthn/register/options', requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user!;
  const existing = await credentialsOf(user.id);
  const options = await generateRegistrationOptions({
    rpName: env.rpName,
    rpID: rpID(),
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports ? (JSON.parse(c.transports) as AuthenticatorTransportLike[]) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
  });
  await putChallenge(`reg:${user.id}`, options.challenge);
  res.json(options);
});

type AuthenticatorTransportLike = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';

authRouter.post('/webauthn/register/verify', requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user!;
  const expectedChallenge = await takeChallenge(`reg:${user.id}`);
  if (!expectedChallenge) return res.status(400).json({ error: 'Desafio expirado. Tente novamente.' });

  try {
    const verification = await verifyRegistrationResponse({
      response: req.body.response,
      expectedChallenge,
      expectedOrigin: expectedOrigins(),
      expectedRPID: rpID(),
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Não foi possível validar a biometria' });
    }
    const { credential } = verification.registrationInfo;
    await db.prepare(
      `INSERT INTO webauthn_credentials (id, user_id, public_key, counter, transports, device_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET public_key = excluded.public_key, counter = excluded.counter`
    ).run(
      credential.id,
      user.id,
      Buffer.from(credential.publicKey).toString('base64'),
      credential.counter,
      JSON.stringify(credential.transports || []),
      String(req.body.device_name || 'Este dispositivo').slice(0, 60),
      new Date().toISOString()
    );
    res.json({ ok: true, credentials: (await credentialsOf(user.id)).map(publicCredential) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

function publicCredential(c: CredentialRow) {
  return {
    id: c.id,
    device_name: c.device_name,
    created_at: c.created_at,
    last_used_at: c.last_used_at,
  };
}

authRouter.get('/webauthn/credentials', requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user!;
  res.json({ items: (await credentialsOf(user.id)).map(publicCredential) });
});

authRouter.delete('/webauthn/credentials/:id', requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user!;
  await db.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
  res.json({ ok: true, items: (await credentialsOf(user.id)).map(publicCredential) });
});

/* ---------------------- biometria: login (passkey) ---------------------- */

authRouter.post('/webauthn/login/options', async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const user = email ? await findUserByEmail(email) : undefined;
  if (!user || !user.active) return res.status(404).json({ error: 'Usuário não encontrado neste dispositivo' });

  const creds = await credentialsOf(user.id);
  if (!creds.length) {
    return res.status(404).json({ error: 'Nenhuma biometria cadastrada para este usuário' });
  }

  const options = await generateAuthenticationOptions({
    rpID: rpID(),
    userVerification: 'preferred',
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: c.transports ? (JSON.parse(c.transports) as AuthenticatorTransportLike[]) : undefined,
    })),
  });
  await putChallenge(`auth:${user.id}`, options.challenge);
  res.json(options);
});

authRouter.post('/webauthn/login/verify', async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const user = email ? await findUserByEmail(email) : undefined;
  if (!user || !user.active) return res.status(401).json({ error: 'Usuário inválido' });

  const expectedChallenge = await takeChallenge(`auth:${user.id}`);
  if (!expectedChallenge) return res.status(400).json({ error: 'Desafio expirado. Tente novamente.' });

  const response = req.body.response;
  const cred = await db
    .prepare('SELECT * FROM webauthn_credentials WHERE id = ? AND user_id = ?')
    .get<CredentialRow>(String(response?.id || ''), user.id);
  if (!cred) return res.status(401).json({ error: 'Biometria não reconhecida' });

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: expectedOrigins(),
      expectedRPID: rpID(),
      requireUserVerification: false,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64')),
        counter: cred.counter,
        transports: cred.transports ? (JSON.parse(cred.transports) as AuthenticatorTransportLike[]) : undefined,
      },
    });
    if (!verification.verified) return res.status(401).json({ error: 'Biometria não validada' });

    await db.prepare('UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?').run(
      verification.authenticationInfo.newCounter,
      new Date().toISOString(),
      cred.id
    );
    await touchLogin(user);
    res.json({ token: signToken(user), user: toPublicUser(user) });
  } catch (e) {
    res.status(401).json({ error: (e as Error).message });
  }
});

/** Informa ao front se o servidor está em contexto seguro para WebAuthn. */
authRouter.get('/webauthn/support', (_req, res) => {
  const origin = env.publicUrl;
  const secure = origin.startsWith('https://') || /localhost|127\.0\.0\.1/.test(origin);
  res.json({ enabled: secure, rpID: rpID(), origin });
});
