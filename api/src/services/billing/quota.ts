import { sql } from 'kysely';
import { db } from '../../db/index.js';
import type { OrgBilling, TierConfig } from './plan.js';

// §4/§7 — the funder-report allowance is annual, on a rolling 12-month window
// from the org's signup anniversary (matching how trailing volume is
// measured), independent of billing frequency.

export function quotaWindow(orgCreatedAt: Date | string, now = new Date()) {
  const created = new Date(orgCreatedAt);
  const start = new Date(created);
  start.setUTCFullYear(now.getUTCFullYear());
  if (start > now) start.setUTCFullYear(start.getUTCFullYear() - 1);
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return { start, end };
}

export async function quotaStatus(org: OrgBilling, tier: TierConfig) {
  const { start, end } = quotaWindow(org.created_at as unknown as string);
  const row = await db
    .selectFrom('report_quota_usage')
    .select('reports_used')
    .where('org_id', '=', org.id)
    .where('period_start', '=', start)
    .executeTakeFirst();
  const used = row?.reports_used ?? 0;
  const included = tier.funder_reports_included_per_year; // null = unlimited/negotiated
  return {
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    included,
    used,
    remaining: included === null ? null : Math.max(0, included - used),
    // What the next report costs once the allowance is used up (null = included).
    next_report_fee_ngn: included !== null && used >= included ? tier.additional_report_fee_ngn : null,
  };
}

export async function recordReportUsage(org: OrgBilling) {
  const { start, end } = quotaWindow(org.created_at as unknown as string);
  await db
    .insertInto('report_quota_usage')
    .values({ org_id: org.id, period_start: start, period_end: end, reports_used: 1 })
    .onConflict((oc) => oc.columns(['org_id', 'period_start']).doUpdateSet({ reports_used: sql`report_quota_usage.reports_used + 1` }))
    .execute();
}
