import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, resolveApiUrl } from '../api';
import { Banner } from './ui';

type PaymentInvoice = { id: string; invoice_number: string; total_ngn: number } | null;

// Per-cohort billing: a new cohort opens to learners once its fee is paid.
// Shows the Pay / Cancel choice while it's unpaid, and checks the payment
// when the gateway sends the admin back here (?payment=<reference>).
export default function CohortPayment({ cohortId, awaitingPayment, invoice, isAdmin }: { cohortId: string; awaitingPayment: boolean; invoice: PaymentInvoice; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice, setNotice] = useState<{ tone: 'gain' | 'amber' | 'flag'; text: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const paymentRef = searchParams.get('payment') ?? searchParams.get('reference');
  useEffect(() => {
    if (!paymentRef) return;
    const next = new URLSearchParams(searchParams);
    ['payment', 'reference', 'trxref'].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true });
    setNotice({ tone: 'amber', text: 'Checking your payment…' });
    apiFetch(`/api/v1/payments/${encodeURIComponent(paymentRef)}/verify`, { method: 'POST' })
      .then((p: { status: string; failure_reason: string | null }) => {
        queryClient.invalidateQueries({ queryKey: ['cohort', cohortId] });
        if (p.status === 'confirmed') setNotice({ tone: 'gain', text: 'Payment received. This cohort is open: share the assessment links with your learners.' });
        else if (p.status === 'pending') setNotice({ tone: 'amber', text: 'Payment is still processing. This page updates once it clears (usually within a minute).' });
        else setNotice({ tone: 'flag', text: `Payment didn't go through${p.failure_reason ? ` (${p.failure_reason})` : ''}. You can try again.` });
      })
      .catch((err: Error) => setNotice({ tone: 'flag', text: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentRef]);

  const pay = useMutation({
    mutationFn: () => apiFetch(`/api/v1/billing/invoices/${invoice!.id}/pay`, { method: 'POST' }),
    onSuccess: (r: { checkoutUrl: string }) => window.location.assign(resolveApiUrl(r.checkoutUrl)),
    onError: (err: Error) => setNotice({ tone: 'flag', text: err.message }),
  });
  const cancel = useMutation({
    mutationFn: () => apiFetch(`/api/v1/cohorts/${cohortId}/cancel-unpaid`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      navigate('/cohorts');
    },
    onError: (err: Error) => setNotice({ tone: 'flag', text: err.message }),
  });

  return (
    <>
      {notice && (
        <div className="mb-4">
          <Banner tone={notice.tone}>{notice.text}</Banner>
        </div>
      )}
      {awaitingPayment && (
        <div className="mb-6 rounded-md px-4 py-3 text-sm bg-amber-wash border border-rule">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-ink">
              {invoice
                ? `This cohort opens to learners once its fee of ₦${invoice.total_ngn.toLocaleString()} is paid. Until then its assessment links won't work.`
                : "This cohort is waiting for payment. Its assessment links won't work until then."}
            </span>
            {isAdmin && (
              <div className="flex gap-2 shrink-0">
                {invoice && (
                  <button onClick={() => pay.mutate()} disabled={pay.isPending} className="text-sm bg-gain text-white rounded px-3 py-1.5 disabled:opacity-50">
                    {pay.isPending ? 'Opening…' : `Pay ₦${invoice.total_ngn.toLocaleString()}`}
                  </button>
                )}
                {!confirmCancel ? (
                  <button onClick={() => setConfirmCancel(true)} className="text-sm border border-rule rounded px-3 py-1.5 hover:border-ink">
                    Cancel cohort…
                  </button>
                ) : (
                  <button onClick={() => cancel.mutate()} disabled={cancel.isPending} className="text-sm text-flag border border-flag rounded px-3 py-1.5 disabled:opacity-50">
                    {cancel.isPending ? 'Cancelling…' : 'Yes, cancel it'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
