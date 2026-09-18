import { AsyncLocalStorage } from 'node:async_hooks';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { env } from '../env.js';
import { IS_WORKERS } from '../lib/runtime.js';
import type { Database } from './types.js';

function createDb(connectionString: string, maxConnections?: number) {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: maxConnections }) }),
  });
}

// Two lifetimes, one import. On Node (index.ts, migrations, seeds) there's a
// single process-wide pool, created on first use. On Cloudflare Workers a
// socket opened while handling one request can't be touched by another, so
// worker.ts wraps each request in withRequestDb(), which gives that request
// its own short-lived pool (cheap: Hyperdrive keeps the real connections to
// Postgres warm). `db` resolves to whichever applies, so the ~all call sites
// that `import { db }` don't need to know which runtime they're on.
const requestDb = new AsyncLocalStorage<Kysely<Database>>();
let processDb: Kysely<Database> | undefined;

function currentDb(): Kysely<Database> {
  const scoped = requestDb.getStore();
  if (scoped) return scoped;
  if (IS_WORKERS) {
    throw new Error('db used outside withRequestDb() on Workers');
  }
  return (processDb ??= createDb(env.databaseUrl));
}

export const db = new Proxy({} as Kysely<Database>, {
  get(_target, prop) {
    const target = currentDb();
    const value = Reflect.get(target, prop, target);
    // Kysely uses #private fields, so methods must run with the real instance as `this`.
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

export async function withRequestDb<T>(connectionString: string, fn: () => Promise<T>): Promise<T> {
  const scoped = createDb(connectionString, 5);
  try {
    return await requestDb.run(scoped, fn);
  } finally {
    await scoped.destroy();
  }
}
