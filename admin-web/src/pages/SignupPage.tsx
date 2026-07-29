import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { apiFetch } from '../api';
import { useAuth } from '../auth';
import AuthShell, { Field, Fieldset, FormError, SelectField, SubmitButton } from '../components/AuthShell';

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
        navigate('/courses/new');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      wide
      eyebrow="Get started"
      title="Create your organisation"
      intro="Free to start, no card required. We review new registrations before team invites open."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="text-ink underline hover:text-gain">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-7">
        <Fieldset legend="Organisation">
          <Field label="Organisation name" value={orgName} onChange={setOrgName} required />
          <SelectField label="Organisation type" value={orgType} onChange={setOrgType} options={ORG_TYPES} />
          <Field label="CAC registration number" value={cacNumber} onChange={setCacNumber} required />
          <Field label="Website or social link" value={website} onChange={setWebsite} type="url" placeholder="Optional" />
          <Field label="Address or state" value={address} onChange={setAddress} placeholder="Optional" />
        </Fieldset>

        <Fieldset legend="Your account">
          <Field label="Full name" value={adminFullName} onChange={setAdminFullName} required autoComplete="name" />
          <Field label="Role or title" value={adminTitle} onChange={setAdminTitle} placeholder="e.g. Programme Manager" />
          <Field label="Email" value={adminEmail} onChange={setAdminEmail} type="email" required autoComplete="email" />
          <Field label="Phone" value={adminPhone} onChange={setAdminPhone} type="tel" placeholder="Optional" />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            hint="At least 8 characters."
          />
        </Fieldset>

        <Fieldset legend="How you'll use it">
          <SelectField label="Primary use case" value={useCase} onChange={setUseCase} options={USE_CASES} />
          <Field
            label="Expected students in your first cohort"
            value={expectedStudentCount}
            onChange={setExpectedStudentCount}
            type="number"
            required
            min={1}
            hint="Sets your starting plan. You can change it later."
          />
          <SelectField label="How often you run cohorts" value={cadence} onChange={setCadence} options={CADENCES} />
        </Fieldset>

        <Fieldset legend="Context">
          <label className="flex items-center gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={reportsToFunder}
              onChange={(e) => setReportsToFunder(e.target.checked)}
              className="accent-gain w-4 h-4"
            />
            We report to a funder, board, or accreditation body
          </label>
          {reportsToFunder && <Field label="Which one?" value={reportsToFunderName} onChange={setReportsToFunderName} />}
          <SelectField label="How did you hear about Daprova?" value={referralSource} onChange={setReferralSource} options={REFERRAL_SOURCES} />
        </Fieldset>

        {error && <FormError>{error}</FormError>}
        <SubmitButton disabled={submitting}>{submitting ? 'Creating your organisation…' : 'Create organisation'}</SubmitButton>
      </form>
    </AuthShell>
  );
}
