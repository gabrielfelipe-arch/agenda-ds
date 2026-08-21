import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const root = path.resolve(__dirname, '..', '..');

/**
 * O sistema roda em dois modos, com o mesmo codigo:
 *
 *  - local/Docker: banco em arquivo SQLite e uploads em disco;
 *  - Vercel (serverless): banco no Turso e uploads no Vercel Blob.
 *
 * A presenca de TURSO_DATABASE_URL e o que decide o modo.
 */
const tursoUrl = process.env.TURSO_DATABASE_URL || '';

export const env = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(root, 'uploads'),
  webDir: process.env.WEB_DIR || path.join(root, 'web', 'dist'),
  seedDir: process.env.SEED_DIR || path.join(root, 'seed'),
  jwtSecret: process.env.JWT_SECRET || 'troque-este-segredo-em-producao',
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@agenda5588.local').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:8080').replace(/\/+$/, ''),
  timezone: process.env.TZ || 'America/Sao_Paulo',
  rpName: process.env.RP_NAME || 'Agenda 5588',

  // Banco remoto (Turso). Vazio = usa o arquivo SQLite local.
  tursoUrl,
  tursoToken: process.env.TURSO_AUTH_TOKEN || '',

  // Storage de imagens. A Vercel injeta BLOB_READ_WRITE_TOKEN sozinha
  // quando o store esta ligado ao projeto.
  blobToken: process.env.BLOB_READ_WRITE_TOKEN || '',

  /** true quando roda na Vercel: sem disco gravavel, sem processo longo. */
  get serverless() {
    return Boolean(process.env.VERCEL) || Boolean(tursoUrl);
  },
};
