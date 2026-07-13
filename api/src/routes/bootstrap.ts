import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { badRequest, forbidden, notFound, conflict } from '../lib/errors.js';
import { seedFrameworkTemplates } from '../db/seed/frameworks.js';

export const bootstrapRouter = Router();

// POST /api/v1/bootstrap/templates — seeds the 6 competency framework
// templates (reuses the exact same seeding logic as the local dev seed
// script). Unlike the org bootstrap below, this is safe to call more than
// once: seedFrameworkTemplates() already skips any template that exists.
// Same secret gate as the rest of this router.
bootstrapRouter.post('/templates', async (req, res, next) => {
  try {
    if (!env.bootstrapSecret) throw notFound();
    const header = req.headers.authorization;
    if (header !== `Bearer ${env.bootstrapSecret}`) throw forbidden();

    const before = await db.selectFrom('competency_frameworks').select('id').where('is_template', '=', true).execute();
    await seedFrameworkTemplates();
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
    if (!env.bootstrapSecret) throw notFound();
    const header = req.headers.authorization;
    if (header !== `Bearer ${env.bootstrapSecret}`) throw forbidden();

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
// one. Unlike the one-time org bootstrap, this is safe to call repeatedly
// (upserts the role) — same secret gate as the rest of this router.
const bootstrapPlatformAdminSchema = z.object({
  person_email: z.string().email(),
  platform_role: z.enum(['support', 'owner']),
});

bootstrapRouter.post('/platform-admin', async (req, res, next) => {
  try {
    if (!env.bootstrapSecret) throw notFound();
    const header = req.headers.authorization;
    if (header !== `Bearer ${env.bootstrapSecret}`) throw forbidden();

    const body = bootstrapPlatformAdminSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const data = body.data;

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

    res.status(existing ? 200 : 201).json({ person_id: person.id, email: person.email, platform_role: admin.platform_role });
  } catch (err) {
    next(err);
  }
});
