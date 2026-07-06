// Single source of truth for the 4 funder template keys/labels — both the
// pdf and docx renderers key off this so the two formats can't drift apart
// (e.g. one adding a template the other forgets to implement).
export const FUNDER_TEMPLATE_LABELS = {
  mastercard_foundation: 'MasterCard Foundation',
  tony_elumelu_foundation: 'Tony Elumelu Foundation',
  giz_usaid: 'GIZ / USAID',
  generic_donor: 'Generic Donor',
} as const;

export type FunderTemplateKey = keyof typeof FUNDER_TEMPLATE_LABELS;

export function isFunderTemplateKey(key: string): key is FunderTemplateKey {
  return key in FUNDER_TEMPLATE_LABELS;
}
