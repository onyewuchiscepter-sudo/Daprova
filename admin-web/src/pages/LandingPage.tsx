import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth';

const FEATURES = [
  {
    title: 'Pre/post assessment, done right',
    body: 'Share a link, learners take a short competency test before and after your program — no accounts, no app to install.',
  },
  {
    title: 'Real learning-gains analytics',
    body: 'Mean gain, effect size, and a competency-level breakdown, computed automatically the moment scores come in.',
  },
  {
    title: 'Equity built in, not bolted on',
    body: "See outcomes broken out by gender, age, location, and disability — so you know who's actually benefiting.",
  },
  {
    title: 'Funder-ready reports in one click',
    body: 'Export a polished PDF or Word report formatted for MasterCard Foundation, Tony Elumelu, GIZ/USAID, or your own template.',
  },
];

const STEPS = [
  { n: '1', title: 'Build your framework', body: 'Define the competency areas and questions for what you teach — or start from a template.' },
  { n: '2', title: 'Share pre/post links', body: 'Send each cohort a link before training starts and another once it ends.' },
  { n: '3', title: 'Get your report', body: 'Watch scores, gains, and equity breakdowns update live, then export for your funder.' },
];

export default function LandingPage() {
  const { user, restoring } = useAuth();

  // A returning, already-signed-in admin doesn't need the pitch again.
  if (!restoring && user) return <Navigate to="/courses" replace />;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="font-semibold text-lg">Daprova</span>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/login" className="text-slate-600 hover:text-slate-900">
              Log in
            </Link>
            <Link to="/signup" className="bg-slate-900 text-white rounded px-4 py-2 hover:bg-slate-800">
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-balance">Measure what your training actually changes.</h1>
        <p className="mt-5 text-lg text-slate-600 max-w-2xl mx-auto text-balance">
          Daprova is a pre/post competency measurement platform built for African EdTechs, training academies, and NGOs — so you can prove
          impact to funders with real data, not anecdotes.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to="/signup" className="bg-slate-900 text-white rounded px-6 py-3 text-sm font-medium hover:bg-slate-800">
            Sign up your organisation
          </Link>
          <Link to="/login" className="border rounded px-6 py-3 text-sm font-medium hover:bg-slate-50">
            Log in
          </Link>
        </div>
      </section>

      <section className="bg-slate-50 border-y">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="grid sm:grid-cols-2 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white rounded-lg shadow-sm border p-6">
                <h3 className="font-medium text-slate-900 mb-1.5">{f.title}</h3>
                <p className="text-sm text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-xl font-semibold text-center mb-10">How it works</h2>
        <div className="grid sm:grid-cols-3 gap-8">
          {STEPS.map((s) => (
            <div key={s.n} className="text-center">
              <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center text-sm font-medium mx-auto mb-3">
                {s.n}
              </div>
              <h3 className="font-medium text-slate-900 mb-1.5">{s.title}</h3>
              <p className="text-sm text-slate-600">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t">
        <div className="max-w-5xl mx-auto px-6 py-16 text-center">
          <h2 className="text-2xl font-semibold mb-3">Ready to see your real impact?</h2>
          <p className="text-slate-600 mb-6">Free to start — no credit card required.</p>
          <Link to="/signup" className="inline-block bg-slate-900 text-white rounded px-6 py-3 text-sm font-medium hover:bg-slate-800">
            Sign up your organisation
          </Link>
        </div>
      </section>

      <footer className="border-t">
        <div className="max-w-5xl mx-auto px-6 py-8 text-sm text-slate-400 flex items-center justify-between">
          <span>© {new Date().getFullYear()} Daprova</span>
          <Link to="/login" className="hover:text-slate-600">
            Log in
          </Link>
        </div>
      </footer>
    </div>
  );
}
