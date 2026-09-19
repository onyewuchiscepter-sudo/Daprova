import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch, apiFetchBlob, apiPostBlob } from '../api';
import { PdfPreview } from './PdfPreview';

type ReportTemplate = { key: string; label: string };
type NarrativeFields = { background: string; challenges: string; next_steps: string };
type ReportRecord = { id: string; funder_template: string; narrative_json: NarrativeFields; status: string; generated_at: string };
type Quota = { included: number | null; used: number; remaining: number | null; next_report_fee_ngn: number | null; period_end: string };

const EMPTY: NarrativeFields = { background: '', challenges: '', next_steps: '' };

function naira(amount: number) {
  return `₦${amount.toLocaleString()}`;
}

// Module 4: funder reports. Every plan can generate reports; each plan
// includes a number per year, and past that each extra report is billed
// (the admin confirms the fee first — the API answers 402 REPORT_OVERAGE).
// Previews are always free and watermarked.
export default function ReportsPanel({ cohortId }: { cohortId: string }) {
  const queryClient = useQueryClient();
  const { data: billing } = useQuery<{ quota: Quota; blocked: { invoice_number: string } | null }>({
    queryKey: ['billing'],
    queryFn: () => apiFetch('/api/v1/billing'),
    retry: false,
  });
  const quota = billing?.quota;
  const [overage, setOverage] = useState<{ fee: number; message: string } | null>(null);

  const { data: templates } = useQuery<ReportTemplate[]>({
    queryKey: ['report-templates'],
    queryFn: () => apiFetch('/api/v1/reports/templates'),
    staleTime: Infinity,
  });
  const { data: reports } = useQuery<ReportRecord[]>({
    queryKey: ['cohort-reports', cohortId],
    queryFn: () => apiFetch(`/api/v1/cohorts/${cohortId}/reports`),
  });

  const [form, setForm] = useState<NarrativeFields>(EMPTY);
  const [template, setTemplate] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string; watermarked: boolean } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const templateLabel = (key: string) => templates?.find((t) => t.key === key)?.label ?? key;

  const generate = useMutation({
    mutationFn: (confirmOverage: boolean) =>
      apiFetch(`/api/v1/cohorts/${cohortId}/reports`, { method: 'POST', body: JSON.stringify({ template, narrative: form, confirm_overage: confirmOverage }) }),
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'REPORT_OVERAGE') {
        const fee = Number((err.details as { fee_ngn?: number } | undefined)?.fee_ngn ?? quota?.next_report_fee_ngn ?? 0);
        setOverage({ fee, message: err.message });
      }
    },
    onSuccess: () => {
      setOverage(null);
      queryClient.invalidateQueries({ queryKey: ['cohort-reports', cohortId] });
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setForm(EMPTY);
      setTemplate('');
      closePreview();
    },
  });
  const regenerate = useMutation({
    mutationFn: (reportId: string) => apiFetch(`/api/v1/reports/${reportId}/narrative`, { method: 'PATCH', body: JSON.stringify({ narrative: form }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cohort-reports', cohortId] });
      setEditingId(null);
      setForm(EMPTY);
      closePreview();
    },
  });

  function closePreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  async function showDraftPreview() {
    const key = editingId ? reports?.find((r) => r.id === editingId)?.funder_template : template;
    if (!key) return;
    setPreviewError(null);
    setPreviewing(true);
    try {
      const { blob, headers } = await apiPostBlob(`/api/v1/cohorts/${cohortId}/reports/preview`, { template: key, narrative: form });
      closePreview();
      setPreview({ url: URL.createObjectURL(blob), title: `Preview · ${templateLabel(key)}`, watermarked: headers.get('X-Report-Watermarked') === 'true' });
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function viewSaved(report: ReportRecord) {
    const blob = await apiFetchBlob(`/api/v1/reports/${report.id}/download/pdf?inline=1`);
    closePreview();
    setPreview({ url: URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })), title: `${templateLabel(report.funder_template)} · ${new Date(report.generated_at).toLocaleDateString()}`, watermarked: false });
  }

  async function download(reportId: string, format: 'pdf' | 'docx') {
    const blob = await apiFetchBlob(`/api/v1/reports/${reportId}/download/${format}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${reportId}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectedKey = editingId ? reports?.find((r) => r.id === editingId)?.funder_template : template;

  return (
    <div className="space-y-6">
      {billing?.blocked ? (
        <div className="rounded-lg border border-flag/20 bg-flag-wash px-4 py-3 text-sm text-flag">
          New reports are paused until overdue invoice {billing.blocked.invoice_number} is paid.{' '}
          <Link to="/billing" className="underline">
            Go to billing
          </Link>
        </div>
      ) : (
        quota && (
          <div className="rounded-lg border border-rule bg-paper px-4 py-3 text-sm text-ink-soft flex flex-wrap items-center justify-between gap-2">
            <span>
              Funder reports this year:{' '}
              <strong className="text-ink font-mono">
                {quota.used} / {quota.included ?? '∞'}
              </strong>
              {quota.included !== null &&
                (quota.remaining ? ` — ${quota.remaining} more included.` : ` — each extra report is ${naira(quota.next_report_fee_ngn ?? 0)}.`)}
            </span>
            <span className="text-xs text-sage">Previews and re-generating an existing report are free.</span>
          </div>
        )
      )}

      <div className="bg-paper rounded-lg border border-rule p-5">
        <h3 className="font-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-3">{editingId ? 'Edit narrative & regenerate' : 'Write a report'}</h3>
        <div className="space-y-3">
          {!editingId && (
            <label className="block text-xs text-ink-soft">
              Funder template
              <select className="mt-1 block w-full border rounded px-2 py-1.5 text-sm text-ink" value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">Select a template…</option>
                {templates?.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(
            [
              ['background', 'Background / theory of change'],
              ['challenges', 'Challenges'],
              ['next_steps', 'Next steps'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-xs text-ink-soft">
              {label}
              <textarea
                className="mt-1 block w-full border rounded px-2 py-1.5 text-sm text-ink"
                rows={3}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button onClick={showDraftPreview} disabled={!selectedKey || previewing} className="text-sm border rounded px-3 py-1.5 hover:border-ink disabled:opacity-50">
              {previewing ? 'Building preview…' : 'Preview'}
            </button>
            {editingId ? (
              <>
                <button
                  onClick={() => regenerate.mutate(editingId)}
                  disabled={regenerate.isPending}
                  className="text-sm bg-gain text-white rounded px-3 py-1.5 disabled:opacity-50"
                >
                  {regenerate.isPending ? 'Regenerating…' : 'Save & regenerate'}
                </button>
                <button
                  onClick={() => {
                    setEditingId(null);
                    setForm(EMPTY);
                  }}
                  className="text-sm border rounded px-3 py-1.5"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => generate.mutate(false)}
                disabled={!template || generate.isPending}
                className="text-sm bg-gain text-white rounded px-3 py-1.5 disabled:opacity-50"
              >
                {generate.isPending ? 'Generating…' : 'Generate report'}
              </button>
            )}
          </div>
          {previewError && <p className="text-xs text-flag">{previewError}</p>}
          {overage && (
            <div className="rounded-md border border-amber/30 bg-amber-wash px-3 py-2 text-sm text-ink">
              <p>{overage.message}</p>
              <p className="text-xs text-ink-soft mt-1">It will be added to an invoice you can pay from Billing.</p>
              <div className="flex gap-2 mt-2">
                <button onClick={() => generate.mutate(true)} disabled={generate.isPending} className="text-sm bg-gain text-white rounded px-3 py-1.5 disabled:opacity-50">
                  {generate.isPending ? 'Generating…' : `Generate for ${naira(overage.fee)}`}
                </button>
                <button onClick={() => setOverage(null)} className="text-sm border rounded px-3 py-1.5">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {generate.isError && !overage && <p className="text-xs text-flag">{(generate.error as Error).message}</p>}
          {regenerate.isError && <p className="text-xs text-flag">{(regenerate.error as Error).message}</p>}
        </div>
      </div>

      <div className="bg-paper rounded-lg border border-rule overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ground text-left text-ink-soft">
            <tr>
              <th className="p-3">Template</th>
              <th className="p-3">Generated</th>
              <th className="p-3">Status</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {reports?.map((r) => (
              <tr key={r.id}>
                <td className="p-3">{templateLabel(r.funder_template)}</td>
                <td className="p-3 text-ink-soft">{new Date(r.generated_at).toLocaleString()}</td>
                <td className="p-3 capitalize">{r.status}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-3">
                    <button onClick={() => viewSaved(r)} className="text-xs text-ink underline">
                      View
                    </button>
                    <button onClick={() => download(r.id, 'pdf')} className="text-xs text-ink underline">
                      PDF
                    </button>
                    <button onClick={() => download(r.id, 'docx')} className="text-xs text-ink underline">
                      Word
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(r.id);
                        setForm(r.narrative_json);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="text-xs text-ink underline"
                    >
                      Edit & regenerate
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {reports?.length === 0 && (
              <tr>
                <td className="p-3 text-ink-soft" colSpan={4}>
                  No reports generated yet for this cohort.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {preview && (
        <PdfPreview
          url={preview.url}
          title={preview.title}
          onClose={closePreview}
          footer={
            preview.watermarked ? <p className="text-sm text-ink-soft">Watermarked preview — generate the report to download the clean version.</p> : undefined
          }
        />
      )}
    </div>
  );
}
