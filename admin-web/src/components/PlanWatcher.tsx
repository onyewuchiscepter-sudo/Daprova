import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api';

export type OrgPlan = {
  tier_id: string;
  name: string;
  features: Record<string, unknown>;
  concurrent_cohorts_limit: number | null;
  locked: boolean;
  version: string;
};

const PLAN_KEY = ['org-plan'];

// The org's plan, re-checked every 15s and whenever the tab regains focus.
// Plans can be changed by the Daprova team at any time, and features follow
// the plan immediately, so an open dashboard mustn't keep showing the old one.
export function useOrgPlan() {
  return useQuery<OrgPlan>({
    queryKey: PLAN_KEY,
    queryFn: () => apiFetch('/api/v1/org/plan'),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

// When the plan changes under an open dashboard: refresh everything the page
// shows (so unlocked features appear and removed ones disappear without a
// reload) and tell the person what happened.
export function PlanChangeNotice() {
  const queryClient = useQueryClient();
  const { data } = useOrgPlan();
  const last = useRef<{ version: string; name: string } | null>(null);
  const [notice, setNotice] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    const prev = last.current;
    last.current = { version: data.version, name: data.name };
    if (!prev || prev.version === data.version) return;
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== PLAN_KEY[0] });
    setNotice({ from: prev.name, to: data.name });
  }, [data, queryClient]);

  if (!notice) return null;
  const changed = notice.from !== notice.to;
  return (
    <div role="status" className="bg-gain-wash text-ink border-b border-gain/20 px-6 py-2.5 text-sm flex items-start justify-between gap-4">
      <span>
        {changed ? (
          <>
            Your plan is now <strong>{notice.to}</strong> (was {notice.from}). What you can use has been updated on this page.{' '}
          </>
        ) : (
          <>Your {notice.to} plan's settings were updated. This page has been refreshed. </>
        )}
        <Link to="/billing" className="underline">
          See plan details
        </Link>
      </span>
      <button onClick={() => setNotice(null)} className="shrink-0 text-ink-soft hover:text-ink underline text-xs">
        Dismiss
      </button>
    </div>
  );
}

// Small plan label for the header.
export function PlanBadge({ linkToBilling }: { linkToBilling: boolean }) {
  const { data } = useOrgPlan();
  if (!data) return null;
  const label = (
    <span
      className="font-mono text-[10px] uppercase tracking-[0.1em] border border-rule rounded px-1.5 py-0.5 text-sage whitespace-nowrap"
      title={data.locked ? 'Plan set by the Daprova team' : 'Your plan'}
    >
      {data.name}
    </span>
  );
  return linkToBilling ? (
    <Link to="/billing" className="hover:opacity-80">
      {label}
    </Link>
  ) : (
    label
  );
}
