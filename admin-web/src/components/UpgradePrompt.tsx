import { Link } from 'react-router-dom';

export const TIER_LABEL: Record<string, string> = { starter: 'Starter', growth: 'Growth', scale: 'Scale', enterprise: 'Enterprise' };

// Shown in place of a feature the organisation's plan doesn't include. The
// API enforces the same rule (403 UPGRADE_REQUIRED); this just explains it.
export default function UpgradePrompt({ title, children, requiredTier }: { title: string; children?: React.ReactNode; requiredTier?: string | null }) {
  return (
    <div className="bg-paper rounded-lg border border-rule p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-sage mb-1">
        {requiredTier ? `${TIER_LABEL[requiredTier] ?? requiredTier} plan and above` : 'Not on your plan'}
      </p>
      <h3 className="font-display font-semibold text-[16px] text-ink mb-1">{title}</h3>
      {children && <div className="text-sm text-ink-soft mb-3">{children}</div>}
      <p className="text-sm text-ink-soft">
        Plans move up automatically as your yearly learner numbers grow, or we can move you sooner.{' '}
        <Link to="/billing" className="text-ink underline">
          See plans & billing
        </Link>
      </p>
    </div>
  );
}
