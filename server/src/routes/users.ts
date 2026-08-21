import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import {
  AuthedRequest,
  UserRow,
  findUserByEmail,
  hashPassword,
  requireAuth,
  requireRole,
  toPublicUser,
} from '../auth';

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole('admin'));

async function allUsers() {
  const rows = await db.prepare('SELECT * FROM users ORDER BY name COLLATE NOCASE').all<UserRow>();
  return rows.map(toPublicUser);
}

async function countActiveAdmins(exceptId?: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?")
    .get<{ n: number }>(exceptId || '');
  return row?.n ?? 0;
}

usersRouter.get('/', async (_req, res) => {
  res.json({ items: await allUsers() });
});

const createSchema = z.object({
  name: z.string().trim().min(3, 'Informe o nome').max(120),
  email: z.string().trim().email('E-mail inválido').max(160),
  password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres').max(100),
  role: z.enum(['admin', 'gerente']),
});

usersRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;
  if (await findUserByEmail(d.email)) return res.status(409).json({ error: 'Já existe um usuário com este e-mail' });

  await db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(crypto.randomUUID(), d.name, d.email.toLowerCase(), hashPassword(d.password), d.role, new Date().toISOString());

  res.status(201).json({ items: await allUsers() });
});

const updateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  email: z.string().trim().email().max(160).optional(),
  role: z.enum(['admin', 'gerente']).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres').max(100).optional(),
});

usersRouter.patch('/:id', async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get<UserRow>(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;

  if (d.email) {
    const other = await findUserByEmail(d.email);
    if (other && other.id !== target.id) return res.status(409).json({ error: 'E-mail já utilizado' });
  }

  const losingAdmin =
    (d.role && d.role !== 'admin' && target.role === 'admin') || (d.active === false && target.role === 'admin');
  if (losingAdmin && (await countActiveAdmins(target.id)) === 0) {
    return res.status(400).json({ error: 'É preciso manter ao menos um administrador ativo' });
  }
  if (target.id === me.id && d.active === false) {
    return res.status(400).json({ error: 'Você não pode desativar o próprio usuário' });
  }

  const sets: string[] = [];
  const params: Record<string, unknown> = { id: target.id };
  if (d.name) (sets.push('name = @name'), (params.name = d.name));
  if (d.email) (sets.push('email = @email'), (params.email = d.email.toLowerCase()));
  if (d.role) (sets.push('role = @role'), (params.role = d.role));
  if (d.active !== undefined) (sets.push('active = @active'), (params.active = d.active ? 1 : 0));
  if (d.password) (sets.push('password_hash = @password_hash'), (params.password_hash = hashPassword(d.password)));

  if (sets.length) await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run(params);
  if (d.password) await db.prepare('DELETE FROM webauthn_credentials WHERE user_id = ?').run(target.id);

  res.json({ items: await allUsers() });
});

usersRouter.delete('/:id', async (req, res) => {
  const me = (req as AuthedRequest).user!;
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get<UserRow>(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (target.id === me.id) return res.status(400).json({ error: 'Você não pode excluir o próprio usuário' });
  if (target.role === 'admin' && (await countActiveAdmins(target.id)) === 0) {
    return res.status(400).json({ error: 'É preciso manter ao menos um administrador ativo' });
  }
  await db.prepare('DELETE FROM webauthn_credentials WHERE user_id = ?').run(target.id);
  await db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.json({ items: await allUsers() });
});
