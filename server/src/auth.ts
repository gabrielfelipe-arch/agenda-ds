import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { env } from './env';

export type Role = 'admin' | 'gerente';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  gerente: 'Gerente de agenda',
};

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  active: number;
  created_at: string;
  last_login_at: string | null;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: Boolean(u.active),
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  };
}

export interface AuthPayload {
  sub: string;
  email: string;
  role: Role;
}

export interface AuthedRequest extends Request {
  user?: UserRow;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function checkPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(user: UserRow): string {
  const payload: AuthPayload = { sub: user.id, email: user.email, role: user.role };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '12h' });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, env.jwtSecret) as AuthPayload;
  } catch {
    return null;
  }
}

export function findUserByEmail(email: string): Promise<UserRow | undefined> {
  return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get<UserRow>(email.trim());
}

export function findUserById(id: string): Promise<UserRow | undefined> {
  return db.prepare('SELECT * FROM users WHERE id = ?').get<UserRow>(id);
}

/** Cria o administrador inicial a partir das variáveis de ambiente, se ainda não houver usuários. */
export async function seedAdminUser() {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').get<{ n: number }>();
  if ((row?.n ?? 0) > 0) return;
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, active, created_at)
     VALUES (?, ?, ?, ?, 'admin', 1, ?)`
  ).run(crypto.randomUUID(), 'Administrador', env.adminEmail.toLowerCase(), hashPassword(env.adminPassword), now);
  console.log(`[auth] usuário administrador inicial criado: ${env.adminEmail}`);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // O token só é aceito pelo cabeçalho Authorization: nunca por querystring
  // (evita vazamento por logs de acesso, histórico do navegador e Referer).
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  const user = await findUserById(payload.sub);
  if (!user || !user.active) return res.status(401).json({ error: 'Usuário inativo ou inexistente.' });
  (req as AuthedRequest).user = user;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Seu perfil não tem permissão para esta ação.' });
    }
    next();
  };
}
