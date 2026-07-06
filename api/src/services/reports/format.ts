export function formatPct(v: number | null): string {
  return v === null ? '—' : `${v}%`;
}
export function formatSigned(v: number | null, suffix = ''): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${v}${suffix}`;
}
