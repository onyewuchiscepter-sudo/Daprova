import { sql } from 'kysely';
import { db } from '../db/index.js';

// docs/org-onboarding-spec.md §7.2 — v1 scope is deliberately loose:
// "exact/normalized matching on phone and domain, plus simple name
// similarity (e.g. lowercased/trimmed comparison...) — refine the matching
// algorithm later if it proves too loose or too strict in practice."
export type FraudMatchReason = 'phone_match' | 'domain_match' | 'name_similarity';
export type FraudMatch = { matchedOrgId: string; reason: FraudMatchReason };

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function extractDomain(urlOrEmail: string): string | null {
  const afterAt = urlOrEmail.includes('@') ? urlOrEmail.split('@')[1] : urlOrEmail;
  if (!afterAt) return null;
  return afterAt
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase()
    .trim();
}

// Checked against existing orgs' admin contact info, not the new org's own
// (freshly-created, necessarily empty) history — this is what catches
// someone re-registering under a new org name to get another free trial.
export async function findFraudMatches(opts: {
  newOrgId: string;
  orgName: string;
  websiteUrl?: string | null;
  adminEmail: string;
  adminPhone?: string | null;
}): Promise<FraudMatch[]> {
  const matches: FraudMatch[] = [];
  const normalizedName = opts.orgName.trim().toLowerCase();
  const domain = (opts.websiteUrl && extractDomain(opts.websiteUrl)) || extractDomain(opts.adminEmail);
  const normalizedPhone = opts.adminPhone ? normalizePhone(opts.adminPhone) : null;

  const nameMatches = await db
    .selectFrom('organisations')
    .select('id')
    .where('id', '!=', opts.newOrgId)
    .where('deleted_at', 'is', null)
    .where(sql<boolean>`lower(trim(name)) = ${normalizedName}`)
    .execute();
  for (const row of nameMatches) matches.push({ matchedOrgId: row.id, reason: 'name_similarity' });

  if (domain) {
    const domainMatches = await db
      .selectFrom('organisations')
      .select(['id', 'website_url', 'contact_email'])
      .where('id', '!=', opts.newOrgId)
      .where('deleted_at', 'is', null)
      .execute();
    for (const row of domainMatches) {
      const existingDomain = (row.website_url && extractDomain(row.website_url)) || extractDomain(row.contact_email);
      if (existingDomain && existingDomain === domain) matches.push({ matchedOrgId: row.id, reason: 'domain_match' });
    }
  }

  if (normalizedPhone) {
    const withPhones = await db
      .selectFrom('people')
      .innerJoin('org_memberships', 'org_memberships.person_id', 'people.id')
      .select(['org_memberships.org_id', 'people.phone'])
      .where('org_memberships.org_id', '!=', opts.newOrgId)
      .where('org_memberships.deleted_at', 'is', null)
      .execute();
    const seen = new Set<string>();
    for (const row of withPhones) {
      if (row.phone && normalizePhone(row.phone) === normalizedPhone && !seen.has(row.org_id)) {
        seen.add(row.org_id);
        matches.push({ matchedOrgId: row.org_id, reason: 'phone_match' });
      }
    }
  }

  return matches;
}

export async function recordFraudMatches(orgId: string, matches: FraudMatch[]): Promise<void> {
  if (matches.length === 0) return;
  await db
    .insertInto('signup_fraud_flags')
    .values(matches.map((m) => ({ org_id: orgId, matched_org_id: m.matchedOrgId, match_reason: m.reason })))
    .execute();
  await db.updateTable('organisations').set({ signup_review_status: 'flagged' }).where('id', '=', orgId).execute();
}
