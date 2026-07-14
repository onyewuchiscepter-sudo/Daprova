// Self-serve signup (docs/org-onboarding-spec.md §1) is the first path that
// generates an organisations.slug automatically rather than taking it as an
// explicit admin-supplied input (bootstrap.ts, platformService.ts).
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'org'
  );
}
