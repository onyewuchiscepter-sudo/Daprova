import { db } from '../index.js';
import { firebaseAuth } from '../../lib/firebaseAdmin.js';

const DEV_ORG = { name: 'Acme EdTech (Dev)', slug: 'acme-edtech-dev', contact_email: 'admin@acme-edtech.test' };
const DEV_ADMIN = { email: 'admin@acme-edtech.test', password: 'devpassword123', display_name: 'Dev Admin' };
const DEV_VIEWER = { email: 'viewer@acme-edtech.test', password: 'devpassword123', display_name: 'Dev Viewer' };

async function upsertFirebaseUser(email: string, password: string) {
  try {
    return await firebaseAuth.getUserByEmail(email);
  } catch {
    return firebaseAuth.createUser({ email, password, emailVerified: true });
  }
}

async function main() {
  const org = await db
    .selectFrom('organisations')
    .selectAll()
    .where('slug', '=', DEV_ORG.slug)
    .executeTakeFirst()
    .then(
      (existing) =>
        existing ??
        db
          .insertInto('organisations')
          .values(DEV_ORG)
          .returningAll()
          .executeTakeFirstOrThrow(),
    );

  for (const [spec, role] of [
    [DEV_ADMIN, 'admin'],
    [DEV_VIEWER, 'viewer'],
  ] as const) {
    const fbUser = await upsertFirebaseUser(spec.email, spec.password);
    const existing = await db.selectFrom('users').selectAll().where('auth_uid', '=', fbUser.uid).executeTakeFirst();
    if (!existing) {
      await db
        .insertInto('users')
        .values({
          org_id: org.id,
          email: spec.email,
          display_name: spec.display_name,
          role,
          auth_provider: 'firebase',
          auth_uid: fbUser.uid,
        })
        .execute();
      console.log(`[seed] created ${role} user ${spec.email}`);
    } else {
      console.log(`[seed] ${role} user ${spec.email} already exists`);
    }
  }

  console.log('[seed] done. Login with:');
  console.log(`  admin:  ${DEV_ADMIN.email} / ${DEV_ADMIN.password}`);
  console.log(`  viewer: ${DEV_VIEWER.email} / ${DEV_VIEWER.password}`);
  await db.destroy();
}

main().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
