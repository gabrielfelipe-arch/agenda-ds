import fs from 'fs';
import path from 'path';
import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './env';
import { seedAdminUser } from './auth';
import { initSchema, seedSettings } from './db';
import { publicRouter } from './routes/public';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { usersRouter } from './routes/users';
import { adminEventsRouter, publicEventsRouter } from './routes/events';
import { googleRouter } from './routes/google';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.public.blob.vercel-storage.com'],
        connectSrc: ["'self'", 'https://viacep.com.br'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        formAction: ["'self'"],
        // Sem HTTPS no acesso local por IP: a diretiva padrao do helmet
        // (upgrade-insecure-requests) forcaria os assets para https:// e a
        // pagina nao carregaria. Na Vercel o HTTPS ja e obrigatorio.
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  })
);

// Em produção o front é servido pelo próprio servidor (mesma origem).
// CORS só é liberado para a origem pública configurada.
app.use(cors({ origin: env.nodeEnv === 'production' ? [env.publicUrl] : true, credentials: false }));
app.use(express.json({ limit: '1mb' }));

const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas solicitações enviadas deste dispositivo. Tente novamente mais tarde.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Muitas tentativas de login. Aguarde alguns minutos.' },
});

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Rotas públicas: apenas leitura do cabeçalho do formulário e gravação da solicitação.
// Nenhum dado de solicitante é exposto sem autenticação.
app.use('/api/public/requests', publicFormLimiter);
app.use('/api/public', publicRouter);

// Inscrição em eventos: mesmo espírito do formulário público, limite um pouco maior
// (o link circula em grupos, várias pessoas podem dividir a mesma rede/IP).
const attendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas inscrições enviadas desta rede. Tente novamente em instantes.' },
});
app.use('/api/public/events/:slug/attendees', attendLimiter);
app.use('/api/public/events', publicEventsRouter);

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/webauthn/login', loginLimiter);
app.use('/api/auth', authRouter);

app.use('/api/admin/users', usersRouter);
app.use('/api/admin/events', adminEventsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/google', googleRouter);

app.use(
  '/uploads',
  express.static(env.uploadsDir, { maxAge: '7d', index: false, dotfiles: 'deny', fallthrough: true })
);

// Front-end (SPA)
if (fs.existsSync(env.webDir)) {
  app.use(express.static(env.webDir, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(env.webDir, 'index.html'));
  });
}

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Recurso não encontrado' });
  res.status(404).send('Não encontrado');
});

// Handler final: nunca devolve stack trace ao cliente.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[erro]', err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

/**
 * Schema + cargas iniciais. Roda uma vez por processo; em serverless isso
 * significa uma vez por cold start, o que e barato (tudo e idempotente).
 */
let ready: Promise<void> | null = null;
export function ensureReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await initSchema();
      await seedSettings();
      await seedAdminUser();
    })().catch((e) => {
      ready = null; // permite tentar de novo na proxima requisicao
      throw e;
    });
  }
  return ready;
}

export { app };

// Modo local/Docker: sobe o servidor HTTP. Na Vercel quem chama e api/index.ts.
if (!process.env.VERCEL) {
  ensureReady()
    .then(() => {
      app.listen(env.port, '0.0.0.0', () => {
        console.log(`Agenda 5588 rodando em http://0.0.0.0:${env.port} (público: ${env.publicUrl})`);
        if (env.jwtSecret === 'troque-este-segredo-em-producao') {
          console.warn('[aviso] defina JWT_SECRET no .env antes de expor o sistema.');
        }
        if (env.adminPassword === 'admin123') {
          console.warn('[aviso] defina ADMIN_PASSWORD no .env: a senha padrão está em uso.');
        }
      });
    })
    .catch((e) => {
      console.error('[fatal] falha ao inicializar o banco:', e);
      process.exit(1);
    });
}
