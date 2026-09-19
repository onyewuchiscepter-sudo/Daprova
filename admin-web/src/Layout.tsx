import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { DaprovaMark } from './components/Logo';
import Announcements from './components/Announcements';

const NAV = [
  { to: '/home', label: 'Home' },
  { to: '/courses', label: 'Courses' },
  { to: '/cohorts', label: 'Cohorts' },
  { to: '/frameworks', label: 'Frameworks' },
  { to: '/billing', label: 'Billing', adminOnly: true },
  { to: '/team', label: 'Settings' },
];

// The app shell is deliberately quieter than the landing page: same palette
// and type, but jade appears only on the active nav item and primary actions.
// These screens get looked at daily, and personality wears thin fast.
export default function Layout() {
  const { user, org, memberships, switchOrg, signOut, impersonation, endImpersonation } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  async function handleEndImpersonation() {
    await endImpersonation();
    navigate('/login');
  }

  async function handleSwitchOrg(e: React.ChangeEvent<HTMLSelectElement>) {
    const orgId = e.target.value;
    if (orgId && orgId !== org?.id) await switchOrg(orgId);
  }

  return (
    <div className="min-h-screen bg-ground">
      {/* docs/org-onboarding-spec.md §7.3 point 4 — persistent, unmissable,
          and visibly different by mode so there's never ambiguity about
          which capability level is active. This is the one place loud colour
          is correct: the cost of not noticing it is high. */}
      {impersonation && (
        <div
          className={`px-6 py-2 text-sm font-medium flex items-center justify-between gap-4 ${
            impersonation.mode === 'write' ? 'bg-flag text-white' : 'bg-amber text-white'
          }`}
        >
          <span>
            {impersonation.mode === 'write'
              ? `Acting as ${impersonation.orgName} / ${impersonation.targetEmail} — every action is logged`
              : `Viewing as ${impersonation.orgName} / ${impersonation.targetEmail} (read-only)`}
          </span>
          <button onClick={handleEndImpersonation} className="underline shrink-0 hover:no-underline">
            End impersonation
          </button>
        </div>
      )}

      {/* Self-serve signups start 'pending' until a platform admin reviews
          the registration — the org can still use the product (frameworks,
          courses, cohorts) in the meantime, so this is informational, not a
          blocker. Team-management routes enforce the actual restriction
          server-side (middleware/orgVerification.ts). */}
      {org?.verification_status === 'pending' && (
        <div className="bg-amber-wash text-amber border-b border-amber/20 px-6 py-2 text-sm text-center">
          Your organisation is awaiting verification. You can keep building courses and frameworks — inviting or managing team
          members opens once a Daprova admin reviews your registration.
        </div>
      )}

      <header className="bg-paper border-b border-rule">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-6">
          <div className="flex items-center gap-7 min-w-0">
            <span className="inline-flex items-center gap-2 font-mono font-semibold text-[15px] tracking-[0.02em] text-ink shrink-0">
              <DaprovaMark size={22} />
              <span>
                daprova<span className="text-gain">.</span>
              </span>
            </span>
            <nav className="flex items-center gap-6">
              {NAV.filter((item) => !('adminOnly' in item) || user?.role === 'admin').map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `text-sm transition-colors ${isActive ? 'text-ink font-medium' : 'text-ink-soft hover:text-ink'}`
                  }
                >
                  {({ isActive }) => (
                    <span className="relative block py-[18px]">
                      {item.label}
                      {isActive && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-gain" />}
                    </span>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-4 text-sm min-w-0">
            {memberships.length > 1 ? (
              <select
                value={org?.id ?? ''}
                onChange={handleSwitchOrg}
                className="border border-rule rounded px-2 py-1 text-sm text-ink bg-paper focus:border-gain focus:outline-none"
                aria-label="Switch organisation"
              >
                {memberships.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-ink truncate">{org?.name}</span>
            )}
            <span className="text-ink-soft truncate hidden sm:inline" title={user?.email}>
              {user?.email}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-sage border border-rule rounded px-1.5 py-0.5 shrink-0">
              {user?.role}
            </span>
            <button onClick={handleSignOut} className="text-ink-soft hover:text-ink underline shrink-0">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <Announcements />

      <main className="max-w-6xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
