import { Link } from 'react-router-dom';
import { DaprovaMark } from './Logo';

// Shared chrome for every unauthenticated page (sign in, sign up, contact
// sales, accept invite). The jade rule capping each card is the landing
// page's baseline motif carried through — it's the one decorative thread
// tying the marketing surface to the product.

export function Wordmark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2 font-mono font-semibold text-[15px] tracking-[0.02em] text-ink no-underline">
      <DaprovaMark size={22} />
      <span>
        daprova<span className="text-gain">.</span>
      </span>
    </Link>
  );
}

export default function AuthShell({
  title,
  eyebrow,
  intro,
  children,
  footer,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  intro?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen bg-ground flex flex-col items-center justify-center px-5 py-12">
      <div className={`w-full ${wide ? 'max-w-xl' : 'max-w-sm'}`}>
        <div className="mb-6 text-center">
          <Wordmark />
        </div>

        <div className="bg-paper border border-rule rounded-lg overflow-hidden">
          <div className="h-[3px] bg-gain" />
          <div className="p-7">
            {eyebrow && <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-sage mb-2">{eyebrow}</p>}
            <h1 className="font-display font-semibold text-[24px] leading-tight tracking-[-0.015em] text-ink">{title}</h1>
            {intro && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{intro}</p>}
            <div className="mt-6">{children}</div>
          </div>
        </div>

        {footer && <div className="mt-5 text-center text-sm text-ink-soft">{footer}</div>}
      </div>
    </div>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  minLength?: number;
  min?: number;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-ink mb-1.5">
        {props.label}
        {props.required && <span className="text-sage font-normal"> *</span>}
      </span>
      <input
        className="block w-full border border-rule rounded bg-paper px-3 py-2 min-h-[44px] text-sm text-ink placeholder:text-sage focus:border-gain focus:outline-none"
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        required={props.required}
        placeholder={props.placeholder}
        minLength={props.minLength}
        min={props.min}
        autoComplete={props.autoComplete}
      />
      {props.hint && <span className="block mt-1 text-xs text-sage">{props.hint}</span>}
    </label>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-ink mb-1.5">{props.label}</span>
      <select
        className="block w-full border border-rule rounded bg-paper px-3 py-2 min-h-[44px] text-sm text-ink focus:border-gain focus:outline-none"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SubmitButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full bg-gain text-white text-sm font-medium rounded px-4 py-3 min-h-[44px] hover:bg-gain-deep disabled:opacity-50 disabled:hover:bg-gain transition-colors"
    >
      {children}
    </button>
  );
}

// Errors state what happened and, where possible, what to do about it —
// they don't apologise and they aren't vague.
export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-flag bg-flag-wash border border-flag/20 rounded px-3 py-2">
      {children}
    </p>
  );
}

export function FormNotice({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gain bg-gain-wash border border-gain/20 rounded px-3 py-2">{children}</p>;
}

export function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-sage mb-3">{legend}</legend>
      {children}
    </fieldset>
  );
}
