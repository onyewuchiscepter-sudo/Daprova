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

    const user = await db
      .insertInto('users')
      .values({
        org_id: org.id,
        email: data.admin_email,
        display_name: data.admin_display_name ?? null,
        role: 'admin',
        auth_provider: 'firebase',
        auth_uid: data.admin_auth_uid,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    res.status(201).json({ org: { id: org.id, name: org.name, slug: org.slug }, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
});
