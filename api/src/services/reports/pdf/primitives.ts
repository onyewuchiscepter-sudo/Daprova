import PDFDocument from '@foliojs-fork/pdfkit';

// Shared drawing helpers built on pdfkit's imperative API (no external font
// files needed — using the 14 standard PDF fonts built into every reader,
// which is the whole reason this isn't pdfmake; see the PDF rendering
// commit message for the full rationale). Each of the 4 funder templates is
// a short, explicit function that calls these in the order/wording its
// funder expects — not a generic "sections config" engine, since 4 templates
// isn't enough repetition to justify that abstraction.

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4 at 72dpi
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export function newDocument(): PDFKit.PDFDocument {
  return new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
}

export function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + neededHeight > bottom) doc.addPage();
}

// Every call below passes an explicit x (= MARGIN) and width instead of
// relying on pdfkit's implicit cursor (doc.x). drawTable/drawKeyValueGrid
// position cells with absolute x/y writes, which leaves doc.x drifted at
// the last cell's position — silently narrowing/truncating any later
// unconstrained .text() call that assumes it starts back at the margin.
export function drawReportHeader(doc: PDFKit.PDFDocument, opts: { templateTitle: string; orgName: string; cohortName: string; courseName: string; dateRange: string }) {
  doc.fontSize(20).font('Helvetica-Bold').text(opts.templateTitle, MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.3);
  doc.fontSize(11).font('Helvetica').fillColor('#555').text(`${opts.orgName} · ${opts.courseName} · ${opts.cohortName}`, MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.text(opts.dateRange, MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.fillColor('#000');
  doc.moveDown(1);
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_WIDTH, doc.y).strokeColor('#ccc').stroke();
  doc.moveDown(1);
}

export function drawSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  ensureSpace(doc, 40);
  doc.fontSize(14).font('Helvetica-Bold').text(title, MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(10);
}

export function drawParagraph(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 20);
  doc.fontSize(10).font('Helvetica').text(text || '—', MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.8);
}

export function drawNumberedList(doc: PDFKit.PDFDocument, items: string[]) {
  items.forEach((item, i) => {
    ensureSpace(doc, 16);
    doc.fontSize(10).font('Helvetica').text(`${i + 1}. ${item}`, MARGIN, doc.y, { width: CONTENT_WIDTH });
  });
  doc.moveDown(0.8);
}

export function drawKeyValueGrid(doc: PDFKit.PDFDocument, pairs: Array<[string, string]>) {
  const colWidth = CONTENT_WIDTH / 2;
  ensureSpace(doc, Math.ceil(pairs.length / 2) * 32);
  const startY = doc.y;
  pairs.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * colWidth;
    const y = startY + row * 32;
    doc.fontSize(8).font('Helvetica').fillColor('#666').text(label, x, y, { width: colWidth - 10 });
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#000').text(value, x, y + 11, { width: colWidth - 10 });
  });
  doc.y = startY + Math.ceil(pairs.length / 2) * 32;
  doc.moveDown(0.8);
}

// A simple, single-line-per-row table — the report tables here (competency
// areas, equity subgroups) top out around 5-6 rows with short cell values,
// so this deliberately skips text-wrapping/dynamic-row-height complexity a
// general-purpose table renderer would need.
export function drawTable(doc: PDFKit.PDFDocument, headers: string[], rows: string[][], columnWidths?: number[]) {
  const widths = columnWidths ?? headers.map(() => CONTENT_WIDTH / headers.length);
  const rowHeight = 20;

  function drawRow(cells: string[], opts: { bold?: boolean; fill?: string } = {}) {
    ensureSpace(doc, rowHeight);
    const y = doc.y;
    if (opts.fill) {
      doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill(opts.fill);
    }
    let x = MARGIN;
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#000');
    cells.forEach((cell, i) => {
      doc.text(cell, x + 4, y + 6, { width: widths[i] - 8, height: rowHeight - 10, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + rowHeight;
  }

  drawRow(headers, { bold: true, fill: '#f1f5f9' });
  rows.forEach((row) => drawRow(row));
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_WIDTH, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.8);
}

// Module 5 (S11) — shared across all 4 templates rather than duplicated,
// since every funder gets the same 4 numbers + top quotes; only the section
// title varies by template to match that funder's terminology. No-ops when
// null (no survey responses yet) so callers can call this unconditionally.
export function drawSatisfactionSection(
  doc: PDFKit.PDFDocument,
  title: string,
  satisfaction: {
    response_count: number;
    avg_instructor_rating: number | null;
    avg_content_relevance: number | null;
    avg_delivery_satisfaction: number | null;
    nps_score: number | null;
    top_comments: string[];
  } | null,
) {
  if (!satisfaction) return;
  drawSectionTitle(doc, title);
  drawKeyValueGrid(doc, [
    ['Instructor rating', satisfaction.avg_instructor_rating !== null ? `${satisfaction.avg_instructor_rating} / 5` : '—'],
    ['Content relevance', satisfaction.avg_content_relevance !== null ? `${satisfaction.avg_content_relevance} / 5` : '—'],
    ['Delivery satisfaction', satisfaction.avg_delivery_satisfaction !== null ? `${satisfaction.avg_delivery_satisfaction} / 5` : '—'],
    ['Net Promoter Score', satisfaction.nps_score !== null ? String(satisfaction.nps_score) : '—'],
  ]);
  drawParagraph(doc, `Based on ${satisfaction.response_count} learner response${satisfaction.response_count === 1 ? '' : 's'}.`);
  if (satisfaction.top_comments.length > 0) {
    drawNumberedList(doc, satisfaction.top_comments.map((c) => `"${c}"`));
  }
}

export { formatPct, formatSigned } from '../format.js';
