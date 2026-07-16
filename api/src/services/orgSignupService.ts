import { db } from '../db/index.js';
import { slugify } from '../lib/slug.js';
import { findFraudMatches, recordFraudMatches } from './fraudService.js';
import { ENTERPRISE_THRESHOLD } from './pricingService.js';

export type SignupInput = {
  org_name: string;
  org_type: string;
  cac_registration_number: string;
  website_url?: string;
  address?: string;
  admin_full_name: string;
  admin_title?: string;
  admin_phone?: string;
  primary_use_case: string;
  expected_student_count: number;
  expected_cadence: string;
  reports_to_funder: boolean;
  reports_to_funder_name?: string;
  referral_source: string;
};

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  let suffix = 1;
  while (await db.selectFrom('organisations').select('id').where('slug', '=', candidate).executeTakeFirst()) {
    suffix += 1;
    candidate = `${root}-${suffix}`;
  }
  return candidate;
}

// docs/org-onboarding-spec.md §1 Model A, step 3-5. No cohort is created
// here — expected_student_count is used only for Enterprise routing
// (§5.5) and the fraud check; real per-cohort tier/free-trial assignment
// already happens at first-cohort creation (Sprint 4's assignTierForNewCohort).
//
// verification_status starts 'pending' for every self-serve signup —
// deliberately separate from billing_status/fraud flags. An org can create
// frameworks/courses/cohorts immediately (that's the actual product), but
// team-management actions (invite/role-change/remove/org-profile-edit) stay
// gated until a platform admin reviews the registration details and verifies
// it. Model B (createOrgWithAdmin) skips this entirely — your own team
// creating an org directly is itself the vetting.
export async function signUpOrg(authUid: string, adminEmail: string, input: SignupInput) {
  const slug = await uniqueSlug(input.org_name);
  const billingStatus = input.expected_student_count >= ENTERPRISE_THRESHOLD ? 'pending_manual_quote' : 'active';

  const org = await db
    .insertInto('organisations')
    .values({
      name: input.org_name,
      slug,
      contact_email: adminEmail,
      org_type: input.org_type,
      cac_registration_number: input.cac_registration_number,
      website_url: input.website_url ?? null,
      address: input.address ?? null,
      primary_use_case: input.primary_use_case,
      expected_cadence: input.expected_cadence,
      reports_to_funder: input.reports_to_funder,
      reports_to_funder_name: input.reports_to_funder_name ?? null,
      referral_source: input.referral_source,
      billing_status: billingStatus,
      verification_status: 'pending',
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const matches = await findFraudMatches({
    newOrgId: org.id,
    orgName: input.org_name,
    websiteUrl: input.website_url,
    adminEmail,
    adminPhone: input.admin_phone,
  });
  await recordFraudMatches(org.id, matches);

  // A person who already has a Daprova login gets a new membership on the
  // new org rather than a duplicate people row — §2 confirms multi-org
  // membership is supported. In the normal client flow this branch won't
  // fire (the Firebase account was just freshly created), but it's the
  // correct behavior if it's ever hit rather than colliding on auth_uid.
  let person = await db.selectFrom('people').selectAll().where('auth_uid', '=', authUid).where('deleted_at', 'is', null).executeTakeFirst();
  if (!person) {
    person = await db
      .insertInto('people')
      .values({
        email: adminEmail,
        display_name: input.admin_full_name,
        auth_provider: 'firebase',
        auth_uid: authUid,
        phone: input.admin_phone ?? null,
        title: input.admin_title ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  const membership = await db
    .insertInto('org_memberships')
    .values({ person_id: person.id, org_id: org.id, role: 'admin' })
    .returningAll()
    .executeTakeFirstOrThrow();

  const finalOrg = await db.selectFrom('organisations').selectAll().where('id', '=', org.id).executeTakeFirstOrThrow();

  return { org: finalOrg, person, membership };
}
