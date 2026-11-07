const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Local database runner requires a localhost DATABASE_URL.');
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const directory = path.resolve(__dirname, '../.local-postgres');
  const postgres = new EmbeddedPostgres({
    databaseDir: directory,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    port: Number(url.port || 5432),
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {},
    onError: message => console.error(String(message)),
  });
  if (!fs.existsSync(path.join(directory, 'PG_VERSION'))) await postgres.initialise();
  await postgres.start();
  const admin = postgres.getPgClient('postgres', '127.0.0.1');
  await admin.connect();
  const name = decodeURIComponent(url.pathname.slice(1));
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!exists.rowCount) await admin.query('CREATE DATABASE "' + name.replaceAll('"', '""') + "\" ENCODING 'UTF8' TEMPLATE template0");
  await admin.end();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = await client.query("SELECT to_regclass('public.users') AS users");
    if (!schema.rows[0].users) {
      // Only bootstrap an empty database; never run the schema's reset statements.
      const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
      if (tables.rowCount) throw new Error('Database has existing tables; refusing to bootstrap automatically.');
      const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').replace(/^DROP TABLE .*;\r?$/gm, '');
      await client.query(sql);
      const seed = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8').split('-- Test users')[0];
      await client.query(seed);
    }
    for (const file of fs.readdirSync(path.join(__dirname, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
      await client.query(fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8'));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  console.log('Local AURA database ready on port ' + (url.port || 5432) + '. Data persists in backend/.local-postgres.');
  const stop = async () => { await postgres.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main().catch(error => { console.error(error.message); process.exit(1); });
