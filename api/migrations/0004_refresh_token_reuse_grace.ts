import { Kysely, sql } from 'kysely';

// Refresh-token rotation (routes/auth.ts's /auth/refresh) revokes the
// presented token and issues a new one on every call. Two near-simultaneous
// requests presenting the *same* token — React 18 StrictMode double-invoking
// the restore-on-mount effect in dev, or just two browser tabs open at
// once — race: the first rotates it fine, the second finds it already
// revoked and 401s, losing the session entirely even though the person
// never actually did anything wrong. `replaced_by_jti` lets /auth/refresh
// recognize "this token was already rotated a moment ago" and transparently
// hand back a session for the token it was rotated into, instead of failing.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('refresh_tokens').addColumn('replaced_by_jti', 'varchar(100)').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('refresh_tokens').dropColumn('replaced_by_jti').execute();
}
