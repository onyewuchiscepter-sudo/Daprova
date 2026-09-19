import { db } from '../db/index.js';
import { badRequest, notFound } from './errors.js';
import { hasFeature } from '../services/pricingService.js';
import { DAPROVA_MARK_PNG_BASE64 } from './daprovaMarkPng.js';

export const DEFAULT_BRAND_COLOR = '#0e7c5a';
const MAX_LOGO_BYTES = 300 * 1024;

export type Logo = { data: Buffer; mime: 'image/png' | 'image/jpeg' };

export type Branding = {
  orgName: string;
  // True when the org's own logo/colour is applied (the cohort's tier
  // includes custom_branding and the org has set something); otherwise
  // Daprova's own mark and colour are used.
  custom: boolean;
  color: string;
  logo: Logo;
  // Public URL for the org's logo, when custom — for web pages; documents
  // embed `logo` directly.
  logoUrl: string | null;
};

let daprovaMark: Logo | undefined;
export function daprovaLogo(): Logo {
  return (daprovaMark ??= { data: Buffer.from(DAPROVA_MARK_PNG_BASE64, 'base64'), mime: 'image/png' });
}

export function orgLogoPath(orgId: string, updatedAt: Date | string | null): string {
  const v = updatedAt ? new Date(updatedAt).getTime() : 0;
  return `/api/v1/public/orgs/${orgId}/logo?v=${v}`;
}

// Accepts a data URL from the browser. Only PNG and JPEG: those are what
// both pdfkit and docx can embed, and unlike SVG they can't carry script.
// The declared type is checked against the file's actual magic bytes.
export function parseLogoDataUrl(dataUrl: string): Logo {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) throw badRequest('Logo must be a PNG or JPEG image');
  const data = Buffer.from(match[2], 'base64');
  if (data.length > MAX_LOGO_BYTES) throw badRequest('Logo must be 300 KB or smaller');
  const isPng = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const mime = match[1] as Logo['mime'];
  if ((mime === 'image/png' && !isPng) || (mime === 'image/jpeg' && !isJpeg)) throw badRequest('Logo file is not a valid PNG or JPEG');
  return { data, mime };
}

export function parseBrandColor(color: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw badRequest('Brand colour must be a hex colour like #0e7c5a');
  return color.toLowerCase();
}

// Pixel size of a PNG or JPEG, so documents can keep the logo's aspect ratio.
export function imageSize(logo: Logo): { width: number; height: number } {
  const d = logo.data;
  if (logo.mime === 'image/png') return { width: d.readUInt32BE(16), height: d.readUInt32BE(20) };
  let i = 2;
  while (i < d.length) {
    if (d[i] !== 0xff) break;
    const marker = d[i + 1];
    const len = d.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: d.readUInt16BE(i + 5), width: d.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return { width: 1, height: 1 };
}

export async function brandingForCohort(orgId: string, cohortId: string): Promise<Branding> {
  const org = await db
    .selectFrom('organisations')
    .select(['id', 'name', 'brand_color', 'logo_data', 'logo_mime', 'logo_updated_at'])
    .where('id', '=', orgId)
    .executeTakeFirst();
  if (!org) throw notFound('Organisation not found');

  const hasOwn = !!org.logo_data || !!org.brand_color;
  const custom = hasOwn && (await hasFeature(orgId, cohortId, 'custom_branding'));
  if (!custom) return { orgName: org.name, custom: false, color: DEFAULT_BRAND_COLOR, logo: daprovaLogo(), logoUrl: null };

  const ownLogo = org.logo_data && org.logo_mime ? { data: org.logo_data, mime: org.logo_mime as Logo['mime'] } : null;
  return {
    orgName: org.name,
    custom: true,
    color: org.brand_color ?? DEFAULT_BRAND_COLOR,
    logo: ownLogo ?? daprovaLogo(),
    logoUrl: ownLogo ? orgLogoPath(org.id, org.logo_updated_at as unknown as string) : null,
  };
}

// For public, token-addressed pages (assessment, certificates) that know
// the cohort but not the org.
export async function brandingForCohortId(cohortId: string): Promise<Branding> {
  const row = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select('courses.org_id')
    .where('cohorts.id', '=', cohortId)
    .executeTakeFirst();
  if (!row) throw notFound('Cohort not found');
  return brandingForCohort(row.org_id, cohortId);
}
