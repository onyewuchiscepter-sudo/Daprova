import { Link } from 'react-router-dom';

// Shared primitives for the authenticated app surface. Restrained by design:
// jade is reserved for primary actions and positive figures, everything else
// is ink on paper. See Layout.tsx for the reasoning.

export function PageHeader({
  title,
  eyebrow,
  sub,
  actions,
}: {
  title: string;
  eyebrow?: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        {eyebrow && <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-sage mb-1.5">{eyebrow}</p>}
        <h1 className="font-display font-semibold text-[26px] leading-tight tracking-[-0.015em] text-ink">{title}</h1>
        {sub && <p className="mt-1.5 text-sm text-ink-soft">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`font-display font-semibold text-[18px] tracking-[-0.01em] text-ink ${className}`}>{children}</h2>;
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-paper border border-rule rounded-lg ${className}`}>{children}</div>;
}

const BTN_BASE =
  'inline-flex items-center justify-center text-sm rounded px-3.5 py-2 transition-colors disabled:opacity-50 disabled:pointer-events-none';

export const btn = {
  primary: `${BTN_BASE} bg-gain text-white font-medium hover:bg-gain-deep`,
  secondary: `${BTN_BASE} border border-rule text-ink hover:border-ink`,
  danger: `${BTN_BASE} text-flag hover:bg-flag-wash`,
  quiet: 'text-sm text-ink-soft hover:text-ink underline',
};

export function Button({
  children,
  variant = 'primary',
  ...rest
}: { children: React.ReactNode; variant?: keyof typeof btn } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`${btn[variant]} ${rest.className ?? ''}`}>
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  children,
  variant = 'primary',
}: {
  to: string;
  children: React.ReactNode;
  variant?: keyof typeof btn;
}) {
  return (
    <Link to={to} className={btn[variant]}>
      {children}
    </Link>
  );
}

// Figures get mono + tabular treatment everywhere — this is a measurement
// product, and digits that shift width as a dashboard polls look broken.
export function Stat({ label, value, tone = 'ink' }: { label: string; value: React.ReactNode; tone?: 'ink' | 'gain' | 'sage' }) {
  const toneClass = tone === 'gain' ? 'text-gain' : tone === 'sage' ? 'text-sage' : 'text-ink';
  return (
    <div className="bg-paper border border-rule rounded-lg px-4 py-3.5">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-sage">{label}</p>
      <p className={`font-mono text-[21px] font-semibold mt-1 ${toneClass}`}>{value}</p>
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'gain' | 'amber' | 'flag' }) {
  const tones = {
    neutral: 'text-sage border-rule',
    gain: 'text-gain border-gain/30 bg-gain-wash',
    amber: 'text-amber border-amber/30 bg-amber-wash',
    flag: 'text-flag border-flag/30 bg-flag-wash',
  };
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.1em] border rounded px-1.5 py-0.5 ${tones[tone]}`}>{children}</span>
  );
}

export function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-paper border border-rule rounded-lg px-6 py-12 text-center">
      <p className="text-sm text-ink-soft">{children}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Banner({ tone, children }: { tone: 'gain' | 'amber' | 'flag'; children: React.ReactNode }) {
  const tones = {
    gain: 'bg-gain-wash text-gain border-gain/20',
    amber: 'bg-amber-wash text-amber border-amber/20',
    flag: 'bg-flag-wash text-flag border-flag/20',
  };
  return <div className={`text-sm rounded-lg border px-4 py-3 ${tones[tone]}`}>{children}</div>;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`border border-rule rounded bg-paper px-3 py-2 min-h-[44px] text-sm text-ink placeholder:text-sage focus:border-gain focus:outline-none ${
        props.className ?? ''
      }`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`border border-rule rounded bg-paper px-3 py-2 min-h-[44px] text-sm text-ink focus:border-gain focus:outline-none ${
        props.className ?? ''
      }`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`border border-rule rounded bg-paper px-3 py-2 min-h-[44px] text-sm text-ink placeholder:text-sage focus:border-gain focus:outline-none ${
        props.className ?? ''
      }`}
    />
  );
}

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="block text-[13px] font-medium text-ink mb-1.5">
      {children}
      {hint && <span className="block mt-0.5 text-xs font-normal text-sage">{hint}</span>}
    </span>
  );
}
