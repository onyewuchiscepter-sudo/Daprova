// Minimal CSV serializer — the export need here (a flat learner roster, no
// embedded newlines expected in practice but names/IDs could contain a
// comma or quote) doesn't justify a new dependency.
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: Array<{ key: keyof T; label: string }>): string {
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => escapeCell(row[c.key])).join(','));
  return [header, ...lines].join('\r\n');
}

// RFC4180-ish parser (handles quoted fields containing commas/quotes/
// newlines) — question text is exactly the kind of free-text field likely
// to contain a comma, so a naive split(',') would silently corrupt rows.
export function fromCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (char === '\r') {
      i++;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}
