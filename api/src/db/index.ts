import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { env } from '../env.js';
import type { Database } from './types.js';

const dialect = new PostgresDialect({
  pool: new pg.Pool({ connectionString: env.databaseUrl }),
});

export const db = new Kysely<Database>({ dialect });
