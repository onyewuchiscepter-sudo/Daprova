import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';

export default function Layout() {
  const { user, org, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-slate-900">Daprova Admin</span>
          <Link to="/frameworks" className="text-sm text-slate-600 hover:text-slate-900">
            Frameworks
          </Link>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <span>
            {org?.name} — {user?.email} ({user?.role})
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
