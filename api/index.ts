// Entrada unica da Vercel: todas as rotas /api/* caem aqui e o Express roteia.
import type { IncomingMessage, ServerResponse } from 'http';
import { app, ensureReady } from '../server/src/index';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ensureReady();
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
