/**
 * Minimal SQL migration runner: applies server/migrations/NNN_name.sql in order, each in its own
 * transaction, recording applied names in schema_migrations. Safe to run repeatedly.
 * CLI: `npm run db:migrate` (uses the same DATABASE_URL / PGLITE_DIR as the server).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Db } from './db';

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

export interface Migration { name: string; sql: string }

export function listMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map(name => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

/** Returns the names applied by this call. */
export async function migrate(db: Db, migrations: Migration[] = listMigrations()): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(row => row.name));
  const done: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    await db.tx(async q => {
      // Statements are split on semicolons at line ends; migration files avoid functions/DO blocks.
      for (const statement of migration.sql.split(/;\s*(?:\r?\n|$)/).map(part => part.trim()).filter(Boolean)) {
        if (statement.split(/\r?\n/).every(line => line.trim() === '' || line.trim().startsWith('--'))) continue;
        await q.query(statement);
      }
      await q.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
    });
    done.push(migration.name);
  }
  return done;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const { loadConfig } = await import('./config');
  const { openDb } = await import('./db');
  const db = await openDb(loadConfig());
  try {
    const done = await migrate(db);
    console.log(done.length ? `Applied migrations: ${done.join(', ')}` : 'Database is up to date.');
  } finally {
    await db.close();
  }
}
