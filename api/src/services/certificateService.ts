import crypto from 'node:crypto';
import PDFDocument from '@foliojs-fork/pdfkit';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { badRequest, notFound } from '../lib/errors.js';
import { brandingForCohortId } from '../lib/branding.js';
import { toBuffer } from './reports/pdf/primitives.js';

// Completion certificates: issued once a learner has submitted their
// post-assessment, showing their measured learning gain. Each gets a short
// verification code (stored on the learner) that anyone — an employer, a
// funder — can check on the public verify page.

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function newCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `DPV-${out.slice(0, 4)}-${out.slice(4)}`;
}

export function verifyUrl(code: string) {
  return `${env.adminDashboardOrigin}/verify/${code}`;
}

async function loadCertificateData(learnerId: string) {
  const row = await db
    .selectFrom('learners')
    .innerJoin('cohorts', 'cohorts.id', 'learners.cohort_id')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .innerJoin('organisations', 'organisations.id', 'courses.org_id')
    .select([
      'learners.id',
      'learners.display_name',
      'learners.certificate_code',
      'cohorts.id as cohort_id',
      'cohorts.name as cohort_name',
      'courses.name as course_name',
      'organisations.name as org_name',
    ])
    .where('learners.id', '=', learnerId)
    .executeTakeFirst();
  if (!row) throw notFound('Learner not found');

  const sessions = await db
    .selectFrom('assessment_sessions')
    .select(['session_type', 'total_score', 'completed_at', 'status'])
    .where('learner_id', '=', learnerId)
    .where('status', '=', 'completed')
    .execute();
  const pre = sessions.find((s) => s.session_type === 'pre');
  const post = sessions.find((s) => s.session_type === 'post');
  return { ...row, pre, post };
}

async function ensureCode(learnerId: string, existing: string | null): Promise<string> {
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    try {
      const updated = await db
        .updateTable('learners')
        .set({ certificate_code: code })
        .where('id', '=', learnerId)
        .where('certificate_code', 'is', null)
        .returning('certificate_code')
        .executeTakeFirst();
      if (updated?.certificate_code) return updated.certificate_code;
      // Someone else issued it in the meantime — use theirs.
      const row = await db.selectFrom('learners').select('certificate_code').where('id', '=', learnerId).executeTakeFirstOrThrow();
      if (row.certificate_code) return row.certificate_code;
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err; // unique clash: try another code
    }
  }
  throw new Error('Could not allocate a certificate code');
}

const fmtScore = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

async function renderCertificate(learnerId: string): Promise<{ pdf: Buffer; code: string; filename: string }> {
  const data = await loadCertificateData(learnerId);
  if (!data.post) throw badRequest('A certificate is available once the post-assessment has been submitted.');
  const code = await ensureCode(data.id, data.certificate_code);
  const branding = await brandingForCohortId(data.cohort_id);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
  const W = doc.page.width;
  const H = doc.page.height;
  const accent = branding.color;

  doc.rect(0, 0, W, H).fill('#ffffff');
  doc.rect(24, 24, W - 48, H - 48).lineWidth(3).strokeColor(accent).stroke();
  doc.rect(34, 34, W - 68, H - 68).lineWidth(0.75).strokeColor(accent).stroke();

  doc.image(branding.logo.data, W / 2 - 80, 62, { fit: [160, 56], align: 'center', valign: 'center' });

  const center = (text: string, y: number, size: number, opts: { bold?: boolean; color?: string } = {}) => {
    doc
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(size)
      .fillColor(opts.color ?? '#12212e')
      .text(text, 60, y, { width: W - 120, align: 'center' });
  };

  center('CERTIFICATE OF COMPLETION', 138, 13, { bold: true, color: accent });
  center('This certifies that', 170, 12, { color: '#4a5a63' });
  center(data.display_name ?? 'Learner', 192, 34, { bold: true });
  center('has successfully completed', 244, 12, { color: '#4a5a63' });
  center(data.course_name, 264, 20, { bold: true });
  center(`delivered by ${data.org_name}`, 292, 12, { color: '#4a5a63' });

  const pre = fmtScore(data.pre?.total_score);
  const post = fmtScore(data.post.total_score);
  if (pre !== null && post !== null) {
    const gain = Math.round((post - pre) * 10) / 10;
    center(`Assessed skill: ${pre}% before, ${post}% after   (${gain >= 0 ? '+' : ''}${gain} points)`, 330, 14, { bold: true, color: accent });
  } else if (post !== null) {
    center(`Final assessment score: ${post}%`, 330, 14, { bold: true, color: accent });
  }

  const completed = new Date(data.post.completed_at as unknown as string);
  const dateText = completed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  doc.font('Helvetica').fontSize(10).fillColor('#4a5a63');
  doc.text(`Completed ${dateText}`, 80, H - 118, { width: 300 });
  doc.text(`Certificate ${code}`, 80, H - 102, { width: 300 });
  doc.text(`Verify at ${verifyUrl(code)}`, W - 380, H - 102, { width: 300, align: 'right' });
  doc.fontSize(8).fillColor('#888').text(branding.custom ? 'Learning gain measured with Daprova' : 'Issued with Daprova', W - 380, H - 86, { width: 300, align: 'right' });

  const pdf = await toBuffer(doc);
  const safeName = (data.display_name ?? 'learner').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'learner';
  return { pdf, code, filename: `certificate-${safeName}.pdf` };
}

// Learner-facing: from the assessment page, using the learner's own token.
export async function certificateForLearnerToken(cohortToken: string, learnerToken: string) {
  const learner = await db
    .selectFrom('learners')
    .innerJoin('cohorts', 'cohorts.id', 'learners.cohort_id')
    .select('learners.id')
    .where('learners.learner_token', '=', learnerToken)
    .where((eb) => eb.or([eb('cohorts.pre_link_token', '=', cohortToken), eb('cohorts.post_link_token', '=', cohortToken)]))
    .executeTakeFirst();
  if (!learner) throw notFound('Learner not found for this link');
  return renderCertificate(learner.id);
}

// Admin-facing: any learner in one of the org's cohorts.
export async function certificateForAdmin(orgId: string, cohortId: string, learnerId: string) {
  const learner = await db
    .selectFrom('learners')
    .innerJoin('cohorts', 'cohorts.id', 'learners.cohort_id')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select('learners.id')
    .where('learners.id', '=', learnerId)
    .where('cohorts.id', '=', cohortId)
    .where('courses.org_id', '=', orgId)
    .executeTakeFirst();
  if (!learner) throw notFound('Learner not found');
  return renderCertificate(learner.id);
}

// Public verification. Returns only what's printed on the certificate.
export async function verifyCertificate(code: string) {
  const normalized = code.trim().toUpperCase();
  const learner = await db.selectFrom('learners').select('id').where('certificate_code', '=', normalized).executeTakeFirst();
  if (!learner) throw notFound('No certificate with that code');
  const data = await loadCertificateData(learner.id);
  if (!data.post) throw notFound('No certificate with that code');
  const pre = fmtScore(data.pre?.total_score);
  const post = fmtScore(data.post.total_score);
  return {
    code: normalized,
    learner_name: data.display_name,
    course_name: data.course_name,
    org_name: data.org_name,
    completed_at: data.post.completed_at,
    pre_score: pre,
    post_score: post,
    gain: pre !== null && post !== null ? Math.round((post - pre) * 10) / 10 : null,
  };
}
