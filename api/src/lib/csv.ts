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
