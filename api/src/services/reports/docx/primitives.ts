import { BorderStyle, HeadingLevel, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';

// docx builds a document out of Paragraph/Table trees rather than an
// imperative drawing API, so — unlike the pdfkit primitives — each helper
// here is a pure function returning the elements to insert, not a mutation
// of shared cursor state. Table widths use WidthType.PERCENTAGE so they
// always fill the page's content area regardless of margin settings.

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const CELL_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

export function reportHeader(opts: { templateTitle: string; orgName: string; cohortName: string; courseName: string; dateRange: string }): Paragraph[] {
  return [
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 100 }, children: [new TextRun({ text: opts.templateTitle, bold: true })] }),
    new Paragraph({
      spacing: { after: 20 },
      children: [new TextRun({ text: `${opts.orgName} · ${opts.courseName} · ${opts.cohortName}`, color: '555555', size: 22 })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 8 } },
      children: [new TextRun({ text: opts.dateRange, color: '555555', size: 22 })],
    }),
  ];
}

export function sectionTitle(title: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 }, children: [new TextRun({ text: title, bold: true })] });
}

export function paragraph(text: string): Paragraph {
  return new Paragraph({ spacing: { after: 200 }, children: [new TextRun(text || '—')] });
}

export function numberedList(items: string[]): Paragraph[] {
  return items.map((item, i) => new Paragraph({ spacing: { after: 60 }, children: [new TextRun(`${i + 1}. ${item}`)] }));
}

export function keyValueGrid(pairs: Array<[string, string]>): Table {
  const rows: TableRow[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const pair = pairs.slice(i, i + 2);
    rows.push(
      new TableRow({
        children: pair.map(
          ([label, value]) =>
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              borders: CELL_BORDERS,
              margins: { top: 100, bottom: 200, left: 0, right: 200 },
              children: [
                new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: label, color: '666666', size: 16 })] }),
                new Paragraph({ children: [new TextRun({ text: value, bold: true, size: 26 })] }),
              ],
            }),
        ),
      }),
    );
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

export function table(headers: string[], rows: string[][], columnWidths?: number[]): Table {
  const totalWeight = columnWidths ? columnWidths.reduce((a, b) => a + b, 0) : headers.length;
  const widths = columnWidths ?? headers.map(() => 1);

  function cell(text: string, i: number, bold: boolean, shaded: boolean) {
    return new TableCell({
      width: { size: (widths[i] / totalWeight) * 100, type: WidthType.PERCENTAGE },
      shading: shaded ? { type: ShadingType.SOLID, color: 'F1F5F9', fill: 'F1F5F9' } : undefined,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })],
    });
  }

  const headerRow = new TableRow({ children: headers.map((h, i) => cell(h, i, true, true)) });
  const bodyRows = rows.map((row) => new TableRow({ children: row.map((v, i) => cell(v, i, false, false)) }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [headerRow, ...bodyRows],
  });
}

export { formatPct, formatSigned } from '../format.js';
