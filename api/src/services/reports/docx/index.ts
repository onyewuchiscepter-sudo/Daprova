import { Document, Packer, Paragraph, Table } from 'docx';
import type { ReportDataContract } from '../../reportDataService.js';
import { FUNDER_TEMPLATE_LABELS, FunderTemplateKey, isFunderTemplateKey } from '../templateRegistry.js';
import { renderMasterCardFoundation } from './templates/masterCardFoundation.js';
import { renderTonyElumeluFoundation } from './templates/tonyElumeluFoundation.js';
import { renderGizUsaid } from './templates/gizUsaid.js';
import { renderGenericDonor } from './templates/genericDonor.js';

const RENDERERS: Record<FunderTemplateKey, (data: ReportDataContract) => (Paragraph | Table)[]> = {
  mastercard_foundation: renderMasterCardFoundation,
  tony_elumelu_foundation: renderTonyElumeluFoundation,
  giz_usaid: renderGizUsaid,
  generic_donor: renderGenericDonor,
};

export { FUNDER_TEMPLATE_LABELS, isFunderTemplateKey };
export type { FunderTemplateKey };

export async function renderReportDocx(templateKey: FunderTemplateKey, data: ReportDataContract): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: RENDERERS[templateKey](data) }],
  });
  return Packer.toBuffer(doc);
}
