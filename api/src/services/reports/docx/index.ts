import { AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, Packer, PageNumber, Paragraph, Table, TextRun } from 'docx';
import { imageSize, type Branding } from '../../../lib/branding.js';
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

// Logo in the page header (the org's with custom branding, else Daprova's),
// and a brand-coloured rule plus page numbers in the footer.
function brandHeader(branding: Branding): Header {
  const { width, height } = imageSize(branding.logo);
  const h = 40;
  const w = Math.min(160, Math.round((width / height) * h));
  const logo = new ImageRun({ type: branding.logo.mime === 'image/png' ? 'png' : 'jpg', data: branding.logo.data, transformation: { width: w, height: Math.round((w / width) * height) } });
  const children = branding.custom
    ? [logo]
    : [logo, new TextRun({ text: '  daprova', bold: true, size: 32, color: '12212E' }), new TextRun({ text: '.', bold: true, size: 32, color: branding.color.slice(1) })];
  return new Header({ children: [new Paragraph({ children })] });
}

function brandFooter(branding: Branding): Footer {
  const left = branding.custom ? `${branding.orgName} · Measured with Daprova` : 'Generated with Daprova';
  return new Footer({
    children: [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: branding.color.slice(1), space: 4 } },
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: `${left}    ·    Page `, size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888' }), new TextRun({ text: ' of ', size: 16, color: '888888' }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '888888' })],
      }),
    ],
  });
}

export async function renderReportDocx(templateKey: FunderTemplateKey, data: ReportDataContract): Promise<Buffer> {
  const doc = new Document({
    sections: [{ headers: { default: brandHeader(data.branding) }, footers: { default: brandFooter(data.branding) }, children: RENDERERS[templateKey](data) }],
  });
  return Packer.toBuffer(doc);
}
