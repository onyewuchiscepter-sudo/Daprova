// docs/org-onboarding-spec.md §5.5 — reached only when signup's expected
// student count crosses the Enterprise threshold; the org already exists
// (billing_status = 'pending_manual_quote') and is activated later through
// Model B once terms are agreed, so this is a holding screen, not a form.
export default function ContactSalesPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white shadow rounded-lg p-8 max-w-md w-full text-center space-y-3">
        <h1 className="text-xl font-semibold text-slate-900">Thanks for your interest in Daprova</h1>
        <p className="text-sm text-slate-600">
          Your organisation's scale qualifies for our Enterprise plan, which is set up through a custom quote rather than self-serve checkout. Your
          account has been created — a member of our team will reach out shortly to finalize pricing and activate full access.
        </p>
      </div>
    </div>
  );
}
