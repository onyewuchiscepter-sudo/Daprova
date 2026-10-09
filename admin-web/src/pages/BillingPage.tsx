import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch, resolveApiUrl } from '../api';
import { Banner, Button, PageHeader } from '../components/ui';
import { TIER_LABEL } from '../components/UpgradePrompt';

type Features = {
  analytics_scores: string;
  learner_certificate: boolean;
  certificate_white_label_option?: boolean;
  equity_dashboard: boolean;
  multi_cohort_trend_comparison: boolean;
  live_funder_monitoring_link: false | string;
  tracer_survey: boolean;
  integrations: string[];
  support_tier: string;
};
type Tier = {
  tier_id: string;
  display_name: string;
  students_per_year_min: number;
  students_per_year_max: number | null;
  base_fee_monthly_ngn: number | null;
  base_fee_per_cohort_cycle_ngn: number | null;
  assessment_fee_per_learner_ngn: number;
  concurrent_cohorts_limit: number | null;
  funder_reports_included_per_year: number | null;
  additional_report_fee_ngn: number | null;
  requires_custom_quote?: boolean;
  features: Features;
};
type Summary = {
  pricing_version: string;
  billing_status: string;
  billing_frequency: 'monthly' | 'per_cohort_cycle';
  is_enterprise_custom: boolean;
  tier: Tier;
  tier_effective_date: string;
  pending_tier: string | null;
  tier_lock: { until: string | null } | null;
  volume: { trailing_12_months: number; tier_by_volume: string; tier_next_cycle: string; band_min: number; band_max: number | null; projected: number | null; enterprise_threshold: number };
  cohorts: { open: number; limit: number | null; auto_finalize_after_days: number };
  trial: { active: boolean; free_cohorts_remaining: number; free_learners: number; trial_cohort: { id: string; name: string } | null };
  next_base_invoice: { date: string | null; amount_ngn: number | null; basis: string } | null;
  quota: { period_start: string; period_end: string; included: number | null; used: number; remaining: number | null; next_report_fee_ngn: number | null };
  outstanding: { count: number; total_ngn: number };
  blocked: { invoice_id: string; invoice_number: string; after_days: number } | null;
  tiers: Tier[];
  chosen_tier: string | null;
  pending_billing_frequency: 'monthly' | 'per_cohort_cycle' | null;
  self_serve: 'available' | 'locked' | 'contact_sales';
  awaiting_payment_cohorts: Array<{ id: string; name: string }>;
};
type Frequency = 'monthly' | 'per_cohort_cycle';
type Quote = { summary: string; charge_ngn: number };
type Line = { category: string; description: string; quantity: number; unit_ngn: number; amount_ngn: number };
type Invoice = {
  id: string;
  invoice_number: string;
  kind: string;
  tier_id: string;
  cohort_name: string | null;
  billing_period_start: string;
  billing_period_end: string;
  total_ngn: string;
  line_items: Line[];
  status: 'pending' | 'paid' | 'overdue' | 'void';
  due_date: string;
  paid_at: string | null;
  notes: string | null;
  on_paid: { type: 'start_plan' | 'upgrade_plan' | 'open_cohort'; tier?: string } | null;
  created_at: string;
};

const naira = (v: number | string | null | undefined) => (v === null || v === undefined ? '—' : `₦${Number(v).toLocaleString()}`);
const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const KIND: Record<string, string> = {
  monthly_base: 'Monthly base fee',
  cohort_cycle_base: 'Cohort cycle base fee',
  cohort_completion: 'Assessments & certificates',
  report_overage: 'Additional funder report',
  plan_change: 'Plan change',
};
const STATUS_STYLE: Record<string, string> = {
  paid: 'bg-gain-wash text-gain-deep',
  pending: 'bg-amber-wash text-amber',
  overdue: 'bg-flag-wash text-flag',
  void: 'bg-ground text-sage',
};

function featureRows(t: Tier): Array<[string, string]> {
  const f = t.features;
  const yes = (v: unknown) => (v ? '✓' : '—');
  return [
    ['Concurrent cohorts', t.concurrent_cohorts_limit === null ? 'Unlimited' : String(t.concurrent_cohorts_limit)],
    ['Analytics & scores', { basic: 'Basic', full: 'Full', custom: 'Full + custom' }[f.analytics_scores] ?? f.analytics_scores],
    ['Learner certificates', f.certificate_white_label_option ? '✓ + white-label' : '✓'],
    ['Equity dashboard', yes(f.equity_dashboard)],
    ['Compare cohorts over time', yes(f.multi_cohort_trend_comparison)],
    [
      'Live funder link',
      !f.live_funder_monitoring_link ? '—' : f.live_funder_monitoring_link === 'single_funder_view' ? 'One per cohort' : f.live_funder_monitoring_link === 'multi_funder_historical' ? 'One per funder' : 'Portfolio-ready',
    ],
    ['Follow-up (tracer) survey', yes(f.tracer_survey)],
    ['Funder reports / year', t.funder_reports_included_per_year === null ? 'Negotiated' : String(t.funder_reports_included_per_year)],
    ['Extra report', t.additional_report_fee_ngn === null ? 'Negotiated' : naira(t.additional_report_fee_ngn)],
    [
      'Support',
      { email_selfserve: 'Email', email_plus_onboarding_call: 'Email + onboarding call', priority: 'Priority', dedicated_account_contact: 'Dedicated contact' }[f.support_tier] ?? f.support_tier,
    ],
  ];
}

// Pricing & Billing Spec: the org's plan, usage against it, and invoices.
export default function BillingPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice, setNotice] = useState<{ tone: 'gain' | 'amber' | 'flag'; text: string } | null>(null);
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);

  const { data: s, error } = useQuery<Summary>({ queryKey: ['billing'], queryFn: () => apiFetch('/api/v1/billing') });
  const { data: invoices } = useQuery<Invoice[]>({ queryKey: ['invoices'], queryFn: () => apiFetch('/api/v1/billing/invoices') });

  const pay = useMutation({
    mutationFn: (invoiceId: string) => apiFetch(`/api/v1/billing/invoices/${invoiceId}/pay`, { method: 'POST' }),
    onSuccess: (r: { checkoutUrl: string }) => window.location.assign(resolveApiUrl(r.checkoutUrl)),
    onError: (err: Error) => setNotice({ tone: 'flag', text: err.message }),
  });

  // Back from the payment gateway.
  const paymentRef = searchParams.get('payment') ?? searchParams.get('reference') ?? searchParams.get('tx_ref');
  useEffect(() => {
    if (!paymentRef) return;
    setSearchParams({}, { replace: true });
    setNotice({ tone: 'amber', text: 'Checking your payment…' });
    apiFetch(`/api/v1/payments/${encodeURIComponent(paymentRef)}/verify`, { method: 'POST' })
      .then((p: { status: string; invoice_number: string | null; failure_reason: string | null }) => {
        queryClient.invalidateQueries({ queryKey: ['invoices'] });
        queryClient.invalidateQueries({ queryKey: ['billing'] });
        if (p.status === 'confirmed') setNotice({ tone: 'gain', text: `Payment received${p.invoice_number ? ` for invoice ${p.invoice_number}` : ''} — thank you.` });
        else if (p.status === 'pending') setNotice({ tone: 'amber', text: 'Payment is still processing. This page updates once it clears (usually within a minute).' });
        else setNotice({ tone: 'flag', text: `Payment didn't go through${p.failure_reason ? ` (${p.failure_reason})` : ''}. You can try again.` });
      })
      .catch((err: Error) => setNotice({ tone: 'flag', text: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentRef]);

  if (error) return <Banner tone="flag">{(error as Error).message}</Banner>;
  if (!s) return <p className="text-sm text-ink-soft">Loading…</p>;

  const t = s.tier;
  const bandMax = t.students_per_year_max ?? s.volume.enterprise_threshold;
  const bandPct = Math.min(100, Math.round(((s.volume.trailing_12_months - t.students_per_year_min) / Math.max(1, bandMax - t.students_per_year_min)) * 100));
  const nextTier = s.tiers[s.tiers.findIndex((x) => x.tier_id === t.tier_id) + 1];

  return (
    <div className="space-y-6">
      <PageHeader title="Plan & billing" sub={`Pricing version ${s.pricing_version} — your prices stay as they are until you're told otherwise.`} />

      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      {s.blocked && (
        <Banner tone="flag">
          Invoice {s.blocked.invoice_number} is more than {s.blocked.after_days} days overdue, so new cohorts and new funder reports are paused. Your running cohorts
          and learners aren't affected. Pay it below to continue.
        </Banner>
      )}
      {s.billing_status === 'pending_manual_quote' && !s.is_enterprise_custom && (
        <Banner tone="amber">Your programme size needs an Enterprise plan. Our team will contact you to set it up — new cohorts are paused until then.</Banner>
      )}
      {s.trial.active && (
        <Banner tone="gain">
          Free trial: your first cohort{s.trial.trial_cohort ? ` (${s.trial.trial_cohort.name})` : ''} is free — no base fee, and assessments for up to {s.trial.free_learners}{' '}
          learners are included. Billing starts when you finalise it or start a second cohort, or choose a plan below to start now.
        </Banner>
      )}
      {s.awaiting_payment_cohorts.length > 0 && (
        <Banner tone="amber">
          Waiting for payment before learners can start:{' '}
          {s.awaiting_payment_cohorts.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ', '}
              <Link to={`/cohorts/${c.id}`} className="underline">
                {c.name}
              </Link>
            </span>
          ))}
          . Pay its cohort fee below or from the cohort page.
        </Banner>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-paper rounded-lg border border-rule p-5 md:col-span-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-sage">Your plan</p>
          <div className="flex flex-wrap items-baseline gap-3 mt-1">
            <h2 className="font-display font-semibold text-[26px] text-ink">{t.display_name}</h2>
            <span className="text-sm text-ink-soft">
              since {date(s.tier_effective_date)} · billed {s.billing_frequency === 'monthly' ? 'monthly' : 'per cohort cycle'}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 text-sm">
            <dt className="text-ink-soft">Base fee</dt>
            <dd className="font-mono text-ink">
              {s.billing_frequency === 'monthly'
                ? t.base_fee_monthly_ngn === null
                  ? 'By agreement'
                  : `${naira(t.base_fee_monthly_ngn)} / month`
                : t.base_fee_per_cohort_cycle_ngn === null
                  ? 'By agreement'
                  : `${naira(t.base_fee_per_cohort_cycle_ngn)} / cohort cycle`}
            </dd>
            <dt className="text-ink-soft">Assessment & certificate</dt>
            <dd className="font-mono text-ink">{naira(t.assessment_fee_per_learner_ngn)} per learner (pre + post)</dd>
            <dt className="text-ink-soft">Cohorts running</dt>
            <dd className="font-mono text-ink">
              {s.cohorts.open}
              {s.cohorts.limit !== null ? ` of ${s.cohorts.limit}` : ' (unlimited)'}
            </dd>
            <dt className="text-ink-soft">Next base-fee invoice</dt>
            <dd className="font-mono text-ink">
              {s.trial.active
                ? 'After your free trial'
                : !s.next_base_invoice
                  ? 'By agreement'
                  : s.next_base_invoice.basis === 'monthly'
                    ? `${naira(s.next_base_invoice.amount_ngn)} on ${date(s.next_base_invoice.date)}`
                    : `${naira(s.next_base_invoice.amount_ngn)} when a cohort starts`}
            </dd>
          </dl>
          <p className="text-xs text-sage mt-4">
            Assessment fees are invoiced when you finalise a cohort (or automatically {s.cohorts.auto_finalize_after_days} days after its end date), for learners who
            completed both the pre- and post-assessment, at the plan you're on at that point.
          </p>
        </div>

        <div className="bg-paper rounded-lg border border-rule p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-sage">Funder reports this year</p>
          <p className="font-mono text-[26px] font-semibold text-ink mt-1">
            {s.quota.used}
            <span className="text-base text-ink-soft"> / {s.quota.included ?? '∞'}</span>
          </p>
          <p className="text-xs text-sage">
            {date(s.quota.period_start)} – {date(s.quota.period_end)}
          </p>
          <p className="text-sm text-ink-soft mt-2">
            {s.quota.included === null
              ? 'Included in your agreement.'
              : s.quota.remaining
                ? `${s.quota.remaining} more included.`
                : `Each extra report is ${naira(t.additional_report_fee_ngn)}.`}
          </p>
        </div>
      </div>

      <ChoosePlan s={s} onDone={(text) => setNotice({ tone: 'gain', text })} onError={(text) => setNotice({ tone: 'flag', text })} />

      <div className="bg-paper rounded-lg border border-rule p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display font-semibold text-[16px] text-ink">Learners assessed in the last 12 months</h3>
          <span className="font-mono text-ink">{s.volume.trailing_12_months.toLocaleString()}</span>
        </div>
        <div className="h-2 bg-ground rounded-sm overflow-hidden mt-3">
          <div className="h-full bg-gain" style={{ width: `${Math.max(2, bandPct)}%` }} />
        </div>
        <div className="flex justify-between text-xs text-sage mt-1">
          <span>{t.students_per_year_min.toLocaleString()}</span>
          <span>
            {t.display_name} ends at {bandMax.toLocaleString()}
          </span>
        </div>
        {s.tier_lock ? (
          <p className="text-sm text-ink-soft mt-3">
            Your {t.display_name} plan has been set by the Daprova team
            {s.tier_lock.until ? ` until ${date(s.tier_lock.until)}` : ''}, so it won't change with your learner numbers
            {s.tier_lock.until ? ' before then' : ''}. Questions about your plan? Reply to any Daprova email or contact us.
          </p>
        ) : (
          <p className="text-sm text-ink-soft mt-3">
            {s.chosen_tier
              ? `You chose ${TIER_LABEL[s.chosen_tier] ?? s.chosen_tier}. If your yearly volume outgrows it, you move up automatically at the start of a billing cycle, never below the plan you chose.`
              : 'Your plan follows your yearly volume and changes automatically at the start of a billing cycle — never backdated.'}
            {s.pending_tier && ` Based on your recent volume you'll move to ${TIER_LABEL[s.pending_tier] ?? s.pending_tier} at the next renewal.`}
            {!s.pending_tier && s.volume.tier_next_cycle !== t.tier_id && ` Your recent volume fits ${TIER_LABEL[s.volume.tier_next_cycle]}; that applies from your next cycle.`}
            {nextTier && !nextTier.requires_custom_quote && ` ${nextTier.display_name} starts at ${nextTier.students_per_year_min.toLocaleString()} learners a year.`}
            {` Programmes of ${s.volume.enterprise_threshold.toLocaleString()}+ learners a year are on Enterprise (contact sales).`}
          </p>
        )}
      </div>

      <div className="bg-paper rounded-lg border border-rule overflow-x-auto">
        <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
          <h3 className="font-display font-semibold text-[16px] text-ink">Invoices</h3>
          {s.outstanding.count > 0 && (
            <span className="text-sm text-ink-soft">
              {s.outstanding.count} to pay · {naira(s.outstanding.total_ngn)}
            </span>
          )}
        </div>
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-ground text-left text-ink-soft">
            <tr>
              <th className="p-3">Invoice</th>
              <th className="p-3">For</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3">Due</th>
              <th className="p-3">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {invoices?.map((inv) => (
              <InvoiceRow
                key={inv.id}
                inv={inv}
                open={openInvoice === inv.id}
                onToggle={() => setOpenInvoice(openInvoice === inv.id ? null : inv.id)}
                onPay={() => pay.mutate(inv.id)}
                paying={pay.isPending && pay.variables === inv.id}
              />
            ))}
            {invoices?.length === 0 && (
              <tr>
                <td colSpan={6} className="p-3 text-ink-soft">
                  No invoices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-paper rounded-lg border border-rule p-5 overflow-x-auto">
        <h3 className="font-display font-semibold text-[16px] text-ink mb-3">All plans</h3>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left">
              <th className="py-2 pr-3 text-ink-soft font-medium"></th>
              {s.tiers.map((x) => (
                <th key={x.tier_id} className={`py-2 px-3 font-semibold ${x.tier_id === t.tier_id ? 'text-gain' : 'text-ink'}`}>
                  {x.display_name}
                  {x.tier_id === t.tier_id && <span className="block font-mono text-[10px] uppercase tracking-[0.1em]">Your plan</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            <tr>
              <td className="py-2 pr-3 text-ink-soft">Learners / year</td>
              {s.tiers.map((x) => (
                <td key={x.tier_id} className="py-2 px-3 font-mono">
                  {x.students_per_year_max === null ? `${x.students_per_year_min.toLocaleString()}+` : `${x.students_per_year_min}–${(x.students_per_year_max - 1).toLocaleString()}`}
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-2 pr-3 text-ink-soft">Base fee (monthly)</td>
              {s.tiers.map((x) => (
                <td key={x.tier_id} className="py-2 px-3 font-mono">
                  {x.base_fee_monthly_ngn === null ? 'Contact sales' : naira(x.base_fee_monthly_ngn)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-2 pr-3 text-ink-soft">Base fee (per cohort cycle)</td>
              {s.tiers.map((x) => (
                <td key={x.tier_id} className="py-2 px-3 font-mono">
                  {x.base_fee_per_cohort_cycle_ngn === null ? 'Custom' : naira(x.base_fee_per_cohort_cycle_ngn)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-2 pr-3 text-ink-soft">Assessment & certificate / learner</td>
              {s.tiers.map((x) => (
                <td key={x.tier_id} className="py-2 px-3 font-mono">
                  {naira(x.assessment_fee_per_learner_ngn)}
                </td>
              ))}
            </tr>
            {featureRows(s.tiers[0]).map(([label], i) => (
              <tr key={label}>
                <td className="py-2 pr-3 text-ink-soft">{label}</td>
                {s.tiers.map((x) => (
                  <td key={x.tier_id} className="py-2 px-3">
                    {featureRows(x)[i][1]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoiceRow({ inv, open, onToggle, onPay, paying }: { inv: Invoice; open: boolean; onToggle: () => void; onPay: () => void; paying: boolean }) {
  const payable = inv.status === 'pending' || inv.status === 'overdue';
  return (
    <>
      <tr>
        <td className="p-3">
          <button onClick={onToggle} className="font-mono text-xs underline text-ink" aria-expanded={open}>
            {inv.invoice_number}
          </button>
          <div className="text-xs text-sage">{date(inv.created_at)}</div>
        </td>
        <td className="p-3">
          {inv.on_paid?.type === 'open_cohort'
            ? 'Cohort fee (opens the cohort)'
            : inv.on_paid?.type === 'start_plan'
              ? `${TIER_LABEL[inv.on_paid.tier ?? ''] ?? 'Plan'}: first month`
              : inv.on_paid?.type === 'upgrade_plan'
                ? `Upgrade to ${TIER_LABEL[inv.on_paid.tier ?? ''] ?? 'a new plan'}`
                : (KIND[inv.kind] ?? inv.kind)}
          {inv.cohort_name && <div className="text-xs text-sage">{inv.cohort_name}</div>}
        </td>
        <td className="p-3 text-right font-mono">{naira(inv.total_ngn)}</td>
        <td className="p-3 text-ink-soft">{payable ? date(inv.due_date) : inv.paid_at ? `Paid ${date(inv.paid_at)}` : '—'}</td>
        <td className="p-3">
          <span className={`font-mono text-[11px] rounded px-2 py-0.5 capitalize ${STATUS_STYLE[inv.status]}`}>{inv.status}</span>
        </td>
        <td className="p-3 text-right">
          {payable && (
            <button onClick={onPay} disabled={paying} className="text-xs bg-gain text-white rounded px-3 py-1 disabled:opacity-50">
              {paying ? 'Opening…' : 'Pay'}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-ground">
          <td colSpan={6} className="px-3 pb-3 pt-1">
            <table className="w-full text-xs">
              <tbody>
                {inv.line_items.map((l, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-3">{l.description}</td>
                    <td className="py-1 pr-3 text-right font-mono">
                      {l.quantity} × {naira(l.unit_ngn)}
                    </td>
                    <td className="py-1 text-right font-mono">{naira(l.amount_ngn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-sage mt-1">
              {TIER_LABEL[inv.tier_id] ?? inv.tier_id} plan · period {date(inv.billing_period_start)} – {date(inv.billing_period_end)}
              {inv.notes ? ` · ${inv.notes}` : ''}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

// Self-serve plan choice: pick a plan and how to be billed, see exactly what
// happens and what it costs, then confirm (or pay, when something is due now).
function ChoosePlan({ s, onDone, onError }: { s: Summary; onDone: (text: string) => void; onError: (text: string) => void }) {
  const queryClient = useQueryClient();
  const selfServe = s.tiers.filter((x) => !x.requires_custom_quote && x.base_fee_monthly_ngn !== null);
  const [tier, setTier] = useState(s.chosen_tier ?? s.tier.tier_id);
  const [freq, setFreq] = useState<Frequency>(s.pending_billing_frequency ?? s.billing_frequency);
  const order = s.tiers.map((x) => x.tier_id);
  const minIndex = order.indexOf(s.volume.tier_by_volume);
  const nothingScheduled = !s.pending_billing_frequency && (!s.chosen_tier || s.chosen_tier === s.tier.tier_id);
  const isCurrent = !s.trial.active && tier === s.tier.tier_id && freq === s.billing_frequency && nothingScheduled;
  const isScheduled = !s.trial.active && tier === (s.chosen_tier ?? s.tier.tier_id) && freq === (s.pending_billing_frequency ?? s.billing_frequency) && !nothingScheduled;

  const quote = useQuery<Quote, Error>({
    queryKey: ['plan-quote', tier, freq],
    queryFn: () => apiFetch(`/api/v1/billing/plan/quote?tier=${tier}&billing_frequency=${freq}`),
    enabled: s.self_serve === 'available' && !isCurrent && !isScheduled,
    retry: false,
  });

  const confirm = useMutation({
    mutationFn: () => apiFetch('/api/v1/billing/plan', { method: 'POST', body: JSON.stringify({ tier, billing_frequency: freq }) }),
    onSuccess: (r: { applied: boolean; summary: string; checkoutUrl?: string }) => {
      if (!r.applied && r.checkoutUrl) {
        window.location.assign(resolveApiUrl(r.checkoutUrl));
        return;
      }
      queryClient.invalidateQueries();
      onDone(`Done. ${r.summary}`);
    },
    onError: (err: Error) => onError(err.message),
  });

  if (s.self_serve === 'locked') return null;
  if (s.self_serve === 'contact_sales') {
    return (
      <div className="bg-paper rounded-lg border border-rule p-5">
        <h3 className="font-display font-semibold text-[16px] text-ink">Change your plan</h3>
        <p className="text-sm text-ink-soft mt-2">Your plan is arranged with the Daprova team. Reply to any Daprova email or contact us to change it.</p>
      </div>
    );
  }

  const fee = (x: Tier) => (freq === 'monthly' ? x.base_fee_monthly_ngn : x.base_fee_per_cohort_cycle_ngn);
  const scheduledText = [
    s.chosen_tier && s.chosen_tier !== s.tier.tier_id ? `you move to ${TIER_LABEL[s.chosen_tier] ?? s.chosen_tier}` : null,
    s.pending_billing_frequency ? `you switch to ${s.pending_billing_frequency === 'monthly' ? 'monthly' : 'per-cohort'} billing` : null,
  ]
    .filter(Boolean)
    .join(' and ');

  return (
    <div className="bg-paper rounded-lg border border-rule p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display font-semibold text-[16px] text-ink">{s.trial.active ? 'Choose a plan' : 'Change your plan'}</h3>
        <div role="radiogroup" aria-label="Billing frequency" className="inline-flex rounded border border-rule overflow-hidden text-sm">
          {(['monthly', 'per_cohort_cycle'] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={freq === f}
              onClick={() => setFreq(f)}
              className={`px-3 py-1.5 ${freq === f ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink'}`}
            >
              {f === 'monthly' ? 'Pay monthly' : 'Pay per cohort'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-sage mt-1">
        {freq === 'monthly'
          ? "One base fee each month, however many cohorts you run (up to your plan's limit)."
          : 'A base fee for each cohort, paid when you create it, before it opens to learners. Suits programmes that run a cohort or two a year.'}
      </p>

      <div role="radiogroup" aria-label="Plan" className="grid sm:grid-cols-3 gap-3 mt-4">
        {selfServe.map((x) => {
          const tooSmall = order.indexOf(x.tier_id) < minIndex;
          const selected = tier === x.tier_id;
          return (
            <button
              key={x.tier_id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={tooSmall}
              onClick={() => setTier(x.tier_id)}
              className={`text-left rounded-lg border p-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                selected ? 'border-gain ring-1 ring-gain' : 'border-rule hover:border-ink'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">{x.display_name}</span>
                {x.tier_id === s.tier.tier_id && <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-gain">Current</span>}
              </div>
              <p className="font-mono text-[18px] text-ink mt-1">
                {naira(fee(x))}
                <span className="text-xs text-ink-soft"> / {freq === 'monthly' ? 'month' : 'cohort'}</span>
              </p>
              <p className="text-xs text-ink-soft mt-1">
                {x.concurrent_cohorts_limit === null ? 'Unlimited cohorts at a time' : `${x.concurrent_cohorts_limit} cohort${x.concurrent_cohorts_limit === 1 ? '' : 's'} at a time`} ·{' '}
                {naira(x.assessment_fee_per_learner_ngn)} per learner assessed
              </p>
              {tooSmall && <p className="text-xs text-flag mt-1">Your learner numbers need a bigger plan.</p>}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-sage mt-2">
        Full feature comparison is under "All plans" below. Programmes of {s.volume.enterprise_threshold.toLocaleString()}+ learners a year: contact sales for Enterprise.
      </p>

      <div className="mt-4 border-t border-rule pt-4">
        {isCurrent ? (
          <p className="text-sm text-ink-soft">This is your current plan. Pick a different plan or way to pay to see what would change.</p>
        ) : isScheduled ? (
          <p className="text-sm text-ink-soft">Already scheduled: at your next renewal {scheduledText}. Pick your current plan to cancel it.</p>
        ) : quote.isLoading ? (
          <p className="text-sm text-ink-soft">Working out the cost…</p>
        ) : quote.error ? (
          <p className="text-sm text-ink-soft">{quote.error.message}</p>
        ) : quote.data ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink max-w-2xl">{quote.data.summary}</p>
            <Button onClick={() => confirm.mutate()} disabled={confirm.isPending}>
              {confirm.isPending ? 'Working…' : quote.data.charge_ngn > 0 ? `Pay ${naira(quote.data.charge_ngn)}` : 'Confirm'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
