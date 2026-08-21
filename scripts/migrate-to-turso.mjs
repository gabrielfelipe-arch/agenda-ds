// Copia o banco local (data/agenda.sqlite) para o Turso.
// Uso:  TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/migrate-to-turso.mjs
// Rode a partir da raiz do projeto, com o container local PARADO (para nao gravar durante a copia).
import { createClient } from '@libsql/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) {
  console.error('Defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN antes de rodar.');
  process.exit(1);
}

const local = createClient({ url: `file:${path.join(root, 'data', 'agenda.sqlite')}` });
const remote = createClient({ url, authToken: token });

const TABLES = ['users', 'settings', 'requests', 'webauthn_credentials', 'activity_log'];

// Garante o schema no destino antes de copiar.
const schema = await local.execute(
  "SELECT sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
);
for (const row of schema.rows) {
  await remote.executeMultiple(String(row.sql).replace(/^CREATE (TABLE|INDEX)/i, 'CREATE $1 IF NOT EXISTS'));
}

for (const table of TABLES) {
  const res = await local.execute(`SELECT * FROM ${table}`);
  if (!res.rows.length) {
    console.log(`${table}: vazio`);
    continue;
  }
  const cols = res.columns;
  const placeholders = cols.map(() => '?').join(', ');
  const stmts = res.rows.map((r) => ({
    sql: `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
    args: cols.map((_, i) => r[i]),
  }));
  await remote.batch(stmts, 'write');
  console.log(`${table}: ${res.rows.length} linhas migradas`);
}
console.log('Migração concluída.');
