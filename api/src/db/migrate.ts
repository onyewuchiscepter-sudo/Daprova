import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Kysely, Migrator, type Migration, type MigrationProvider } from 'kysely';
import { db } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationFolder = path.join(__dirname, '..', '..', 'migrations');

// Kysely's built-in FileMigrationProvider passes raw filesystem paths straight
// to dynamic import(), which throws ERR_UNSUPPORTED_ESM_URL_SCHEME on Windows
// (a bare "C:\..." path isn't a valid ESM specifier). Converting through
// pathToFileURL fixes it while keeping the same folder-of-files convention.
class WindowsSafeFileMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    const files = await fs.readdir(migrationFolder);
    const migrations: Record<string, Migration> = {};
    for (const fileName of files) {
      if (!fileName.endsWith('.ts') && !fileName.endsWith('.js')) continue;
      const fullPath = path.join(migrationFolder, fileName);
      const migration = await import(pathToFileURL(fullPath).href);
      const name = fileName.replace(/\.(ts|js)$/, '');
      migrations[name] = migration;
    }
    return migrations;
  }
}

const migrator = new Migrator({
  db: db as unknown as Kysely<unknown>,
  provider: new WindowsSafeFileMigrationProvider(),
});

// Exported so the API server can run pending migrations on startup (see
// index.ts) — a single-instance deployment like this one doesn't have the
// multi-instance-race concerns that make startup migrations risky at larger
// scale, and it avoids needing separate external DB access just to apply
// schema changes to whatever's hosting the database.
export async function runMigrationsToLatest(): Promise<void> {
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    console.log(`[migrate] ${r.status}: ${r.migrationName}`);
  }
  if (error) throw error;
}

async function main() {
  const direction = process.argv[2] ?? 'up';
  if (direction === 'down') {
    const { error, results } = await migrator.migrateDown();
    for (const r of results ?? []) console.log(`[migrate] ${r.status}: ${r.migrationName}`);
    if (error) {
      console.error('[migrate] failed', error);
      process.exit(1);
    }
  } else {
    await runMigrationsToLatest();
  }
  await db.destroy();
}

// Only run as a CLI entrypoint (npm run migrate) — not when imported by index.ts.
const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  main().catch((err) => {
    console.error('[migrate] failed', err);
    process.exit(1);
  });
}
