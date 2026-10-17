/**
 * Database access. PostgreSQL through `pg` when DATABASE_URL is set (production), otherwise
 * embedded PGlite (PostgreSQL compiled to WASM) in a local directory or in memory (tests).
 * Both speak the same SQL, so migrations and queries are shared.
 */
import { mkdirSync } from 'node:fs';
import type { ServerConfig } from './config';

export interface QueryResult<R> { rows: R[] }
export interface Queryable {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>>;
}
export interface Db extends Queryable {
  kind: 'postgres' | 'pglite';
  /** Run `fn` in one transaction; rolls back if it throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Run a script with several statements (migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export async function openPglite(dir: string | null): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) mkdirSync(dir, { recursive: true });
  const pg = dir ? await PGlite.create(dir) : await PGlite.create();
  // PGlite runs one query at a time; transactions use its own exclusive transaction API.
  return {
    kind: 'pglite',
    query: async <R>(sql: string, params?: unknown[]) => ({ rows: (await pg.query<R>(sql, params)).rows }),
    tx: <T>(fn: (q: Queryable) => Promise<T>) => pg.transaction(async t => fn({
      query: async <R>(sql: string, params?: unknown[]) => ({ rows: (await t.query<R>(sql, params)).rows }),
    })),
    exec: async (sql: string) => { await pg.exec(sql); },
    close: () => pg.close(),
  };
}

export async function openPostgres(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // Never let an idle-client error crash the process; the next query reconnects.
  pool.on('error', error => console.error('[db] idle client error', error.name));
  return {
    kind: 'postgres',
    query: async <R>(sql: string, params?: unknown[]) => ({ rows: (await pool.query(sql, params)).rows as R[] }),
    tx: async <T>(fn: (q: Queryable) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: async <R>(sql: string, params?: unknown[]) => ({ rows: (await client.query(sql, params)).rows as R[] }) });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    exec: async (sql: string) => { await pool.query(sql); },
    close: () => pool.end(),
  };
}

export function openDb(config: ServerConfig): Promise<Db> {
  return config.database.kind === 'postgres' ? openPostgres(config.database.url) : openPglite(config.database.dir);
}
