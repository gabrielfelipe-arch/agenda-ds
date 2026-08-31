/**
 * Backup do banco de PRODUÇÃO (Turso) usado pela Vercel.
 *
 * Baixa todas as tabelas e grava um arquivo .sqlite restaurável, com data no
 * nome, em três destinos (os que existirem):
 *
 *   1. backups/producao/           (pasta do projeto, fora do git)
 *   2. E:\Backups-Agenda5588\      (HD local)
 *   3. <Google Drive>\Backups-Agenda5588\  (quando o Drive para Desktop
 *      estiver logado — o arquivo sobe para a nuvem sozinho)
 *
 * Credenciais em .backup.env na raiz do projeto (fora do git). Não usar o
 * .env: colocar TURSO_DATABASE_URL lá faria o app local apontar para produção.
 *
 * Mantém os últimos 30 arquivos em cada destino.
 *
 * Uso:  node scripts/backup-producao.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'server', 'package.json'));
const { createClient } = require('@libsql/client');

/* ----------------------------- credenciais ----------------------------- */
const envFile = path.join(root, '.backup.env');
if (!fs.existsSync(envFile)) {
  console.error('[backup] .backup.env não encontrado na raiz do projeto.');
  process.exit(1);
}
const cred = {};
for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.trim().match(/^([A-Z_]+)=(.*)$/);
  if (m) cred[m[1]] = m[2];
}
if (!cred.TURSO_DATABASE_URL || !cred.TURSO_AUTH_TOKEN) {
  console.error('[backup] defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN em .backup.env');
  process.exit(1);
}

/* ------------------------------- destinos ------------------------------- */
function driveMount() {
  for (let c = 68; c <= 90; c++) {
    const letra = String.fromCharCode(c);
    for (const nome of ['Meu Drive', 'My Drive']) {
      const p = `${letra}:\\${nome}`;
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h');
const nomeArquivo = `agenda5588-producao-${stamp}.sqlite`;

const destinos = [path.join(root, 'backups', 'producao')];
if (fs.existsSync('E:\\')) destinos.push('E:\\Backups-Agenda5588');
const drive = driveMount();
if (drive) destinos.push(path.join(drive, 'Backups-Agenda5588'));

/* -------------------------------- dump -------------------------------- */
const remoto = createClient({ url: cred.TURSO_DATABASE_URL, authToken: cred.TURSO_AUTH_TOKEN });

const tmp = path.join(root, 'backups', 'producao', `.tmp-${process.pid}.sqlite`);
fs.mkdirSync(path.dirname(tmp), { recursive: true });
// Limpa temporários de execuções anteriores (o Windows às vezes segura o handle).
for (const f of fs.readdirSync(path.dirname(tmp)).filter((f) => f.startsWith('.tmp-'))) {
  try {
    fs.unlinkSync(path.join(path.dirname(tmp), f));
  } catch {
    /* ainda em uso: fica para a próxima */
  }
}
const local = createClient({ url: `file:${tmp}` });

const master = await remoto.execute(
  "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL"
);
let linhas = 0;
for (const row of master.rows.filter((r) => String(r[1]).toUpperCase().includes('CREATE TABLE'))) {
  await local.execute(String(row[1]));
}
for (const row of master.rows.filter((r) => !String(r[1]).toUpperCase().includes('CREATE TABLE'))) {
  await local.execute(String(row[1]));
}
const tabelas = master.rows
  .filter((r) => String(r[1]).toUpperCase().includes('CREATE TABLE'))
  .map((r) => String(r[0]));

for (const tabela of tabelas) {
  const dados = await remoto.execute(`SELECT * FROM "${tabela}"`);
  if (!dados.rows.length) continue;
  const cols = dados.columns.map((c) => `"${c}"`).join(', ');
  const marcas = dados.columns.map(() => '?').join(', ');
  const stmts = dados.rows.map((r) => ({
    sql: `INSERT INTO "${tabela}" (${cols}) VALUES (${marcas})`,
    args: dados.columns.map((_, i) => r[i]),
  }));
  for (let i = 0; i < stmts.length; i += 200) {
    await local.batch(stmts.slice(i, i + 200), 'write');
  }
  linhas += dados.rows.length;
  console.log(`[backup] ${tabela}: ${dados.rows.length} linhas`);
}
local.close();
remoto.close();

/* ------------------------- grava e faz a rotação ------------------------- */
let gravados = 0;
for (const destino of destinos) {
  try {
    fs.mkdirSync(destino, { recursive: true });
    fs.copyFileSync(tmp, path.join(destino, nomeArquivo));
    gravados++;
    console.log(`[backup] gravado em ${path.join(destino, nomeArquivo)}`);
    const antigos = fs
      .readdirSync(destino)
      .filter((f) => f.startsWith('agenda5588-producao-') && f.endsWith('.sqlite'))
      .sort()
      .reverse()
      .slice(30);
    for (const velho of antigos) fs.unlinkSync(path.join(destino, velho));
  } catch (e) {
    console.warn(`[backup] falhou em ${destino}: ${e.message}`);
  }
}
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

if (!drive) console.warn('[backup] Google Drive não está logado nesta máquina — destino pulado.');
if (!gravados) {
  console.error('[backup] NENHUM destino gravado!');
  process.exit(1);
}
console.log(`[backup] concluído: ${linhas} linhas, ${gravados} destino(s).`);
