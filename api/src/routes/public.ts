import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import * as shareService from '../services/shareService.js';
import * as certificateService from '../services/certificateService.js';

// Unauthenticated, read-only endpoints for things that are public by
// nature: an org's logo (it appears on learner-facing pages and documents).
export const publicRouter = Router();

publicRouter.get('/orgs/:orgId/logo', async (req, res, next) => {
  try {
    const orgId = z.string().uuid().safeParse(req.params.orgId);
    if (!orgId.success) throw notFound('Logo not found');
    const org = await db.selectFrom('organisations').select(['logo_data', 'logo_mime']).where('id', '=', orgId.data).executeTakeFirst();
    if (!org?.logo_data || !org.logo_mime) throw notFound('Logo not found');
    // URLs carry ?v=<updated time>, so a changed logo gets a new URL and
    // the old one can be cached hard.
    res
      .set('Content-Type', org.logo_mime)
      .set('Cache-Control', 'public, max-age=86400')
      .set('X-Content-Type-Options', 'nosniff')
      .set('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(org.logo_data);
  } catch (err) {
    next(err);
  }
});

// Funder share page data — aggregate results only (services/shareService).
publicRouter.get('/share/:token', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store').json(await shareService.getSharedCohort(req.params.token));
  } catch (err) {
    next(err);
  }
});

// Certificate verification: what's printed on the certificate, nothing more.
publicRouter.get('/certificates/:code', async (req, res, next) => {
  try {
    res.json(await certificateService.verifyCertificate(req.params.code));
  } catch (err) {
    next(err);
  }
});
