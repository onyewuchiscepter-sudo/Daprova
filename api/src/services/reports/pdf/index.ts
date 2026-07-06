import type { ReportDataContract } from '../../reportDataService.js';
import { newDocument, toBuffer } from './primitives.js';
import { renderMasterCardFoundation } from './templates/masterCardFoundation.js';
import { renderTonyElumeluFoundation } from './templates/tonyElumeluFoundation.js';
import { renderGizUsaid } from './templates/gizUsaid.js';
import { renderGenericDonor } from './templates/genericDonor.js';

export const FUNDER_TEMPLATES = {
  mastercard_foundation: { label: 'MasterCard Foundation', render: renderMasterCardFoundation },
  tony_elumelu_foundation: { label: 'Tony Elumelu Foundation', render: renderTonyElumeluFoundation },
  giz_usaid: { label: 'GIZ / USAID', render: renderGizUsaid },
  generic_donor: { label: 'Generic Donor', render: renderGenericDonor },
} as const;

export type FunderTemplateKey = keyof typeof FUNDER_TEMPLATES;
export function isFunderTemplateKey(key: string): key is FunderTemplateKey {
  return key in FUNDER_TEMPLATES;
}

export async function renderReportPdf(templateKey: FunderTemplateKey, data: ReportDataContract): Promise<Buffer> {
  const doc = newDocument();
  FUNDER_TEMPLATES[templateKey].render(doc, data); // pdfkit drawing calls are synchronous
  return toBuffer(doc); // attaches listeners and calls doc.end() only after content is drawn
}
