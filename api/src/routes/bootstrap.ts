import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { badRequest, forbidden, notFound, conflict } from '../lib/errors.js';
import { seedFrameworkTemplates, seedMultiCourseTemplate } from '../db/seed/frameworks.js';
import { writeAuditLog } from '../lib/auditLog.js';

export const bootstrapRouter = Router();

// Every route here is gated on BOOTSTRAP_SECRET: unset, the router answers
// 404. Compared in constant time so response timing can't leak the secret.
function assertBootstrapSecret(req: Request) {
  if (!env.bootstrapSecret) throw notFound();
  const given = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${env.bootstrapSecret}`);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw forbidden();
}

// POST /api/v1/bootstrap/templates — seeds the 6 competency framework
// templates (reuses the exact same seeding logic as the local dev seed
// script). Unlike the org bootstrap below, this is safe to call more than
// once: seedFrameworkTemplates() already skips any template that exists.
// Same secret gate as the rest of this router.
bootstrapRouter.post('/templates', async (req, res, next) => {
  try {
    assertBootstrapSecret(req);

    const before = await db.selectFrom('competency_frameworks').select('id').where('is_template', '=', true).execute();
    await seedFrameworkTemplates();
    await seedMultiCourseTemplate();
    const after = await db.selectFrom('competency_frameworks').select('id').where('is_template', '=', true).execute();

    res.json({ templates_before: before.length, templates_after: after.length });
  } catch (err) {
    next(err);
  }
});

// One-time provisioning for the first org + admin user in an environment
// with no direct database access (see env.ts for the full rationale).
// Double-gated: requires BOOTSTRAP_SECRET to be set AND matched, and refuses
// to run at all once any organisation already exists — so once used, it's
// inert even if the secret leaks or is never unset.
const bootstrapSchema = z.object({
  org_name: z.string().min(1),
  org_slug: z.string().min(1),
  contact_email: z.string().email(),
  admin_email: z.string().email(),
  admin_display_name: z.string().optional(),
  admin_auth_uid: z.string().min(1),
});

bootstrapRouter.post('/', async (req, res, next) => {
  try {
    assertBootstrapSecret(req);

    const existingOrg = await db.selectFrom('organisations').select('id').executeTakeFirst();
    if (existingOrg) throw conflict('Bootstrap already completed — an organisation already exists');

    const body = bootstrapSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const data = body.data;

    const org = await db
      .insertInto('organisations')
      .values({ name: data.org_name, slug: data.org_slug, contact_email: data.contact_email })
      .returningAll()
      .executeTakeFirstOrThrow();

    const person = await db
      .insertInto('people')
      .values({
        email: data.admin_email,
        display_name: data.admin_display_name ?? null,
        auth_provider: 'firebase',
        auth_uid: data.admin_auth_uid,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const membership = await db
      .insertInto('org_memberships')
      .values({ person_id: person.id, org_id: org.id, role: 'admin' })
      .returningAll()
      .executeTakeFirstOrThrow();

    res.status(201).json({ org: { id: org.id, name: org.name, slug: org.slug }, user: { id: person.id, email: person.email, role: membership.role } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/bootstrap/platform-admin — grants platform-admin status
// (docs/org-onboarding-spec.md §7.1) to an existing person by email. Solves
// the same bootstrapping problem the org-bootstrap above solves for the
// first org admin: granting platform-admin is normally an owner-only
// platform action, but there's no platform admin yet to grant the first
// one. Like the org bootstrap it is one-time: once any owner exists it
// refuses, and staff are managed from the platform console (Team), where
// every change is logged. So a leaked secret can't be used to make someone
// an owner after setup.
const bootstrapPlatformAdminSchema = z.object({
  person_email: z.string().email(),
  platform_role: z.enum(['support', 'owner']),
});

bootstrapRouter.post('/platform-admin', async (req, res, next) => {
  try {
    assertBootstrapSecret(req);

    const body = bootstrapPlatformAdminSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const data = body.data;

    const owner = await db.selectFrom('platform_admins').select('id').where('platform_role', '=', 'owner').executeTakeFirst();
    if (owner) throw conflict('A platform owner already exists — add or change staff from the platform console (Team).');

    const person = await db.selectFrom('people').selectAll().where('email', '=', data.person_email).executeTakeFirst();
    if (!person) throw notFound('No person with that email — they must sign in at least once first');

    const existing = await db.selectFrom('platform_admins').selectAll().where('person_id', '=', person.id).executeTakeFirst();
    const admin = existing
      ? await db
          .updateTable('platform_admins')
          .set({ platform_role: data.platform_role })
          .where('id', '=', existing.id)
          .returningAll()
          .executeTakeFirstOrThrow()
      : await db
          .insertInto('platform_admins')
          .values({ person_id: person.id, platform_role: data.platform_role })
          .returningAll()
          .executeTakeFirstOrThrow();

    await writeAuditLog({
      actorPersonId: null,
      actorContext: 'system',
      action: 'platform_admin_bootstrapped',
      details: { person_id: person.id, email: person.email, platform_role: admin.platform_role },
    });
    res.status(existing ? 200 : 201).json({ person_id: person.id, email: person.email, platform_role: admin.platform_role });
  } catch (err) {
    next(err);
  }
});
