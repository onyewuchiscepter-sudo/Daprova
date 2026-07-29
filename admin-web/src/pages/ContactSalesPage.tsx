import AuthShell from '../components/AuthShell';

// docs/org-onboarding-spec.md §5.5 — reached only when signup's expected
// student count crosses the Enterprise threshold; the org already exists
// (billing_status = 'pending_manual_quote') and is activated later through
// Model B once terms are agreed, so this is a holding screen, not a form.
export default function ContactSalesPage() {
  return (
    <AuthShell
      eyebrow="Enterprise"
      title="We'll be in touch"
      intro="Your organisation is created. At your cohort size, pricing is set by quote rather than self-serve checkout, so someone from our team will contact you to agree terms and open full access."
    >
      <p className="text-sm text-ink-soft">
        Nothing else is needed from you right now. If it's urgent, reach us at{' '}
        <a href="mailto:sales@daprova.com" className="text-ink underline hover:text-gain">
          sales@daprova.com
        </a>
        .
      </p>
    </AuthShell>
  );
}
