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

async function main() {
  const direction = process.argv[2] ?? 'up';
  const { error, results } =
    direction === 'down' ? await migrator.migrateDown() : await migrator.migrateToLatest();

  for (const r of results ?? []) {
    console.log(`[migrate] ${r.status}: ${r.migrationName}`);
  }

  if (error) {
    console.error('[migrate] failed', error);
    process.exit(1);
  }

  await db.destroy();
}

main();
