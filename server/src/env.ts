import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const root = path.resolve(__dirname, '..', '..');

export const env = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(root, 'uploads'),
  webDir: process.env.WEB_DIR || path.join(root, 'web', 'dist'),
  jwtSecret: process.env.JWT_SECRET || 'troque-este-segredo-em-producao',
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@agenda5588.local').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:8080').replace(/\/+$/, ''),
  timezone: process.env.TZ || 'America/Sao_Paulo',
  rpName: process.env.RP_NAME || 'Agenda 5588',
};
