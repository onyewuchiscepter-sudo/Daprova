import { Router } from 'express';
import { z } from 'zod';
import { badRequest, unauthorized } from '../lib/errors.js';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import { issueSession, REFRESH_COOKIE, refreshCookieOpts } from '../lib/sessionIssuance.js';
import { signUpOrg } from '../services/orgSignupService.js';

export const signupRouter = Router();

const ORG_TYPES = ['edtech', 'training_academy', 'ngo', 'bootcamp', 'school', 'other'] as const;
const USE_CASES = ['skills_training_outcomes', 'admissions_or_placement_testing', 'certification', 'donor_or_funder_reporting', 'other'] as const;
const CADENCES = ['one_off', 'quarterly', 'continuous_rolling'] as const;
const REFERRAL_SOURCES = ['referral', 'social_media', 'event', 'existing_client', 'other'] as const;

const signupSchema = z.object({
  org_name: z.string().min(1),
  org_type: z.enum(ORG_TYPES),
  cac_registration_number: z.string().min(1),
  website_url: z.string().url().optional(),
  address: z.string().optional(),
  admin_full_name: z.string().min(1),
  admin_title: z.string().optional(),
  admin_phone: z.string().optional(),
  primary_use_case: z.enum(USE_CASES),
  expected_student_count: z.number().int().positive(),
  expected_cadence: z.enum(CADENCES),
  reports_to_funder: z.boolean(),
  reports_to_funder_name: z.string().optional(),
  referral_source: z.enum(REFERRAL_SOURCES),
});

function parse<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw badRequest('Invalid request body', result.error.flatten());
  return result.data;
}

// docs/org-onboarding-spec.md §1 Model A — public, no existing session. The
// client creates the Firebase user first (same SDK call LoginPage.tsx uses
// for sign-in), then calls this with that ID token plus the signup form.
signupRouter.post('/', async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('Missing Firebase ID token');
    const idToken = header.slice('Bearer '.length);
    const decoded = await firebaseAuth.verifyIdToken(idToken).catch(() => {
      throw unauthorized('Invalid Firebase ID token');
    });
    if (!decoded.email) throw unauthorized('Firebase account has no email');

    const body = parse(signupSchema, req.body);
    const { org, membership } = await signUpOrg(decoded.uid, decoded.email, body);

    const { sessionToken, refreshToken } = await issueSession(membership.person_id, org.id);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOpts);
    res.status(201).json({
      session_token: sessionToken,
      user: { id: membership.person_id, email: decoded.email, display_name: body.admin_full_name, role: 'admin', org_id: org.id },
      org: {
        id: org.id,
        name: org.name,
        billing_status: org.billing_status,
        signup_review_status: org.signup_review_status,
        verification_status: org.verification_status,
      },
    });
  } catch (err) {
    next(err);
  }
});
