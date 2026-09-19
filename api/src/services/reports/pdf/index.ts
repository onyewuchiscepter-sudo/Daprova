import type { ReportDataContract } from '../../reportDataService.js';
import { FUNDER_TEMPLATE_LABELS, FunderTemplateKey, isFunderTemplateKey } from '../templateRegistry.js';
import { drawBrandBar, drawFooters, drawWatermark, newDocument, setAccent, toBuffer } from './primitives.js';
import { renderMasterCardFoundation } from './templates/masterCardFoundation.js';
import { renderTonyElumeluFoundation } from './templates/tonyElumeluFoundation.js';
import { renderGizUsaid } from './templates/gizUsaid.js';
import { renderGenericDonor } from './templates/genericDonor.js';

const RENDERERS: Record<FunderTemplateKey, (doc: PDFKit.PDFDocument, data: ReportDataContract) => void> = {
  mastercard_foundation: renderMasterCardFoundation,
  tony_elumelu_foundation: renderTonyElumeluFoundation,
  giz_usaid: renderGizUsaid,
  generic_donor: renderGenericDonor,
};

export { FUNDER_TEMPLATE_LABELS, isFunderTemplateKey };
export type { FunderTemplateKey };

export async function renderReportPdf(templateKey: FunderTemplateKey, data: ReportDataContract, opts: { watermark?: string } = {}): Promise<Buffer> {
  const doc = newDocument();
  setAccent(doc, data.branding.color);
  drawBrandBar(doc, data.branding);
  RENDERERS[templateKey](doc, data); // pdfkit drawing calls are synchronous
  drawFooters(doc, data.branding);
  if (opts.watermark) drawWatermark(doc, opts.watermark);
  return toBuffer(doc); // attaches listeners and calls doc.end() only after content is drawn
}
