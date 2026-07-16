import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { apiFetch } from '../api';
import { useAuth } from '../auth';

const ORG_TYPES = [
  { value: 'edtech', label: 'EdTech' },
  { value: 'training_academy', label: 'Training academy' },
  { value: 'ngo', label: 'NGO' },
  { value: 'bootcamp', label: 'Bootcamp' },
  { value: 'school', label: 'School' },
  { value: 'other', label: 'Other' },
];
const USE_CASES = [
  { value: 'skills_training_outcomes', label: 'Skills training outcomes' },
  { value: 'admissions_or_placement_testing', label: 'Admissions or placement testing' },
  { value: 'certification', label: 'Certification' },
  { value: 'donor_or_funder_reporting', label: 'Donor or funder reporting' },
  { value: 'other', label: 'Other' },
];
const CADENCES = [
  { value: 'one_off', label: 'One-off' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'continuous_rolling', label: 'Continuous / rolling' },
];
const REFERRAL_SOURCES = [
  { value: 'referral', label: 'Referral' },
  { value: 'social_media', label: 'Social media' },
  { value: 'event', label: 'Event' },
  { value: 'existing_client', label: 'Existing Daprova client' },
  { value: 'other', label: 'Other' },
];

export default function SignupPage() {
  const { completeSession } = useAuth();
  const navigate = useNavigate();

  const [orgName, setOrgName] = useState('');
  const [orgType, setOrgType] = useState(ORG_TYPES[0].value);
  const [cacNumber, setCacNumber] = useState('');
  const [website, setWebsite] = useState('');
  const [address, setAddress] = useState('');

  const [adminFullName, setAdminFullName] = useState('');
  const [adminTitle, setAdminTitle] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [password, setPassword] = useState('');

  const [useCase, setUseCase] = useState(USE_CASES[0].value);
  const [expectedStudentCount, setExpectedStudentCount] = useState('');
  const [cadence, setCadence] = useState(CADENCES[0].value);

  const [reportsToFunder, setReportsToFunder] = useState(false);
  const [reportsToFunderName, setReportsToFunderName] = useState('');
  const [referralSource, setReferralSource] = useState(REFERRAL_SOURCES[0].value);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, adminEmail, password);
      const idToken = await cred.user.getIdToken();
      const result = await apiFetch('/api/v1/orgs', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          org_name: orgName,
          org_type: orgType,
          cac_registration_number: cacNumber,
          website_url: website || undefined,
          address: address || undefined,
          admin_full_name: adminFullName,
          admin_title: adminTitle || undefined,
          admin_phone: adminPhone || undefined,
          primary_use_case: useCase,
          expected_student_count: Number(expectedStudentCount),
          expected_cadence: cadence,
          reports_to_funder: reportsToFunder,
          reports_to_funder_name: reportsToFunder ? reportsToFunderName || undefined : undefined,
          referral_source: referralSource,
        }),
      });
      await completeSession(result);
      // docs/org-onboarding-spec.md §5.5 — 1,000+ expected students skips
      // self-serve entirely and routes to a sales conversation instead of
      // the dashboard; the org still exists (dormant) for Model B to
      // activate later once terms are agreed.
      if (result.org.billing_status === 'pending_manual_quote') {
        navigate('/signup/contact-sales');
      } else {
        navigate('/frameworks/new');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 py-10">
      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-8 max-w-lg w-full space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Create your Daprova account</h1>
          <p className="text-sm text-slate-500 mt-1">Set up your organisation and start measuring outcomes.</p>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">Organisation</legend>
          <Field label="Organisation name" value={orgName} onChange={setOrgName} required />
          <SelectField label="Organisation type" value={orgType} onChange={setOrgType} options={ORG_TYPES} />
          <Field label="CAC registration number" value={cacNumber} onChange={setCacNumber} required />
          <Field label="Website or social media link (optional)" value={website} onChange={setWebsite} type="url" />
          <Field label="Physical address / state" value={address} onChange={setAddress} />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">Admin account</legend>
          <Field label="Full name" value={adminFullName} onChange={setAdminFullName} required />
          <Field label="Role/title" value={adminTitle} onChange={setAdminTitle} placeholder="e.g. Program Manager" />
          <Field label="Email address" value={adminEmail} onChange={setAdminEmail} type="email" required />
          <Field label="Phone number" value={adminPhone} onChange={setAdminPhone} type="tel" />
          <Field label="Password" value={password} onChange={setPassword} type="password" required minLength={8} />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">Intended usage</legend>
          <SelectField label="Primary use case" value={useCase} onChange={setUseCase} options={USE_CASES} />
          <Field
            label="Expected number of students in your first cohort"
            value={expectedStudentCount}
            onChange={setExpectedStudentCount}
            type="number"
            required
            min={1}
          />
          <SelectField label="Expected cadence" value={cadence} onChange={setCadence} options={CADENCES} />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">Context</legend>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={reportsToFunder} onChange={(e) => setReportsToFunder(e.target.checked)} />
            Reporting to a funder/board/accreditation body?
          </label>
          {reportsToFunder && <Field label="Which one?" value={reportsToFunderName} onChange={setReportsToFunderName} />}
          <SelectField label="How did you hear about Daprova?" value={referralSource} onChange={setReferralSource} options={REFERRAL_SOURCES} />
        </fieldset>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting} className="w-full bg-slate-900 text-white rounded px-3 py-2 disabled:opacity-50">
          {submitting ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  minLength?: number;
  min?: number;
}) {
  return (
    <label className="block text-xs text-slate-500">
      {props.label}
      <input
        className="mt-1 block w-full border rounded px-3 py-2 text-sm text-slate-900"
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        required={props.required}
        placeholder={props.placeholder}
        minLength={props.minLength}
        min={props.min}
      />
    </label>
  );
}

function SelectField(props: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="block text-xs text-slate-500">
      {props.label}
      <select className="mt-1 block w-full border rounded px-3 py-2 text-sm text-slate-900" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
