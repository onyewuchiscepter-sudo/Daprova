import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, resolveApiUrl } from '../api';
import { DaprovaMark } from './Logo';

type OrgProfile = { id: string; name: string; logo_url: string | null; brand_color: string | null };

const DEFAULT_COLOR = '#0e7c5a';
const MAX_BYTES = 300 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// The org's own logo and accent colour. Saved for every org; applied to a
// cohort's reports, assessment pages and certificates when that cohort is on
// the Growth plan or above.
export default function BrandingCard() {
  const queryClient = useQueryClient();
  const { data: org } = useQuery<OrgProfile>({ queryKey: ['org-profile'], queryFn: () => apiFetch('/api/v1/org') });

  const [color, setColor] = useState(DEFAULT_COLOR);
  const [pendingLogo, setPendingLogo] = useState<string | null | undefined>(undefined); // undefined = unchanged, null = remove
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (org) setColor(org.brand_color ?? DEFAULT_COLOR);
  }, [org]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/org/branding', {
        method: 'PUT',
        body: JSON.stringify({ brand_color: color, ...(pendingLogo !== undefined ? { logo: pendingLogo } : {}) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-profile'] });
      queryClient.invalidateQueries({ queryKey: ['org'] });
      setPendingLogo(undefined);
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err: Error) => setError(err.message),
  });

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setError('Use a PNG or JPEG image.');
    if (file.size > MAX_BYTES) return setError('Logo must be 300 KB or smaller.');
    setError(null);
    setPendingLogo(await readAsDataUrl(file));
  }

  const shownLogo = pendingLogo === undefined ? (org?.logo_url ? resolveApiUrl(org.logo_url) : null) : pendingLogo;

  return (
    <div className="bg-paper rounded-lg border border-rule p-5">
      <h2 className="font-display font-semibold text-[18px] tracking-[-0.01em] text-ink mb-1">Branding</h2>
      <p className="text-sm text-ink-soft mb-4">
        Your logo and colour on funder reports, learner assessment pages and certificates. Applies to cohorts on the <strong>Growth</strong> plan or above;
        other cohorts use Daprova's branding.
      </p>

      <div className="grid sm:grid-cols-[1fr_auto] gap-6 items-start">
        <div className="space-y-4">
          <div>
            <p className="text-xs text-ink-soft mb-1.5">Logo (PNG or JPEG, up to 300 KB; a wide logo on a transparent background works best)</p>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={onPick} />
              <button onClick={() => fileInput.current?.click()} className="text-sm border rounded px-3 py-1.5 hover:border-ink">
                {shownLogo ? 'Replace logo' : 'Upload logo'}
              </button>
              {shownLogo && (
                <button onClick={() => setPendingLogo(null)} className="text-sm text-flag hover:underline">
                  Remove
                </button>
              )}
            </div>
          </div>
          <label className="block text-xs text-ink-soft">
            Accent colour
            <span className="mt-1 flex items-center gap-2">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 border rounded cursor-pointer" aria-label="Accent colour" />
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm font-mono w-28"
                aria-label="Accent colour hex"
                maxLength={7}
              />
              {color !== DEFAULT_COLOR && (
                <button onClick={() => setColor(DEFAULT_COLOR)} className="text-xs text-ink-soft underline">
                  Reset
                </button>
              )}
            </span>
          </label>
          {error && <p className="text-xs text-flag">{error}</p>}
          <div className="flex items-center gap-3">
            <button onClick={() => save.mutate()} disabled={save.isPending} className="text-sm bg-gain text-white rounded px-3 py-1.5 disabled:opacity-50">
              {save.isPending ? 'Saving…' : 'Save branding'}
            </button>
            {saved && <span className="text-xs text-gain">Saved</span>}
          </div>
        </div>

        {/* Live preview of a report header */}
        <div className="w-full sm:w-72 rounded border border-rule overflow-hidden text-left" aria-label="Report header preview">
          <div className="p-3 bg-paper">
            <div className="h-10 flex items-center">
              {shownLogo ? <img src={shownLogo} alt="Your logo" className="max-h-10 max-w-[160px] object-contain" /> : <DaprovaMark size={32} />}
            </div>
            <p className="mt-2 font-semibold text-ink text-sm">Programme Impact Report</p>
            <p className="text-[11px] text-ink-soft">{org?.name ?? 'Your organisation'}</p>
            <div className="mt-2 h-[2px]" style={{ background: color }} />
            <p className="mt-2 text-xs font-semibold" style={{ color }}>
              Learning Outcomes
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
