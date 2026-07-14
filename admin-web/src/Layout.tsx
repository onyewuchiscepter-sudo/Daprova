import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';

export default function Layout() {
  const { user, org, memberships, switchOrg, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  async function handleSwitchOrg(e: React.ChangeEvent<HTMLSelectElement>) {
    const orgId = e.target.value;
    if (orgId && orgId !== org?.id) await switchOrg(orgId);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-slate-900">Daprova Admin</span>
          <Link to="/courses" className="text-sm text-slate-600 hover:text-slate-900">
            Courses
          </Link>
          <Link to="/frameworks" className="text-sm text-slate-600 hover:text-slate-900">
            Frameworks
          </Link>
          <Link to="/team" className="text-sm text-slate-600 hover:text-slate-900">
            Team
          </Link>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          {memberships.length > 1 ? (
            <select
              value={org?.id ?? ''}
              onChange={handleSwitchOrg}
              className="border rounded px-2 py-1 text-sm text-slate-700 bg-white"
              aria-label="Switch organisation"
            >
              {memberships.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <span>{org?.name}</span>
          )}
          <span>
            {user?.email} ({user?.role})
          </span>
          <button onClick={handleSignOut} className="text-slate-500 hover:text-slate-900 underline">
            Sign out
          </button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
