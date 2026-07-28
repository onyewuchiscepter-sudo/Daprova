import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import './LandingPage.css';

// Real figures from a generated Digital Skills cohort report (n=245) rather
// than invented marketing numbers — the plot on this page is the product's
// actual output, so it should be the product's actual arithmetic.
const AREAS = [
  { name: 'Computer & Device Basics', pre: 40.27, post: 55.71 },
  { name: 'Internet & Email Literacy', pre: 42.45, post: 55.1 },
  { name: 'Productivity Tools', pre: 39.73, post: 58.64 },
  { name: 'Online Safety', pre: 41.7, post: 54.9 },
  { name: 'Social & Comms Tools', pre: 39.18, post: 55.92 },
];

// Headroom above the highest post-score so the tallest bar doesn't crowd the
// delta label sitting above it.
const PLOT_CEILING = 70;

const EQUITY = [
  { label: 'Female', n: 129, gain: 15.01 },
  { label: 'Male', n: 108, gain: 15.9 },
  { label: 'Prefer not to say', n: 4, gain: 15.84 },
  { label: 'Other', n: 4, gain: 13.34 },
];
const EQUITY_CEILING = 20;

const CAPABILITIES = [
  {
    eyebrow: 'Collection',
    title: 'No accounts, no app, no data plan burned',
    body: 'Share one link before training and one after. Learners answer on any phone — the page is a few kilobytes and keeps working when the signal drops, syncing when it returns.',
  },
  {
    eyebrow: 'Analysis',
    title: 'The statistics funders ask for, computed for you',
    body: "Mean gain, Cohen's d, pass rates and a competency-level breakdown — calculated the moment scores land, so you're never exporting to a spreadsheet to answer a question.",
  },
  {
    eyebrow: 'Equity',
    title: 'Disaggregated by default',
    body: 'Every result splits by gender, age band, location and disability without extra setup. Subgroups under five learners are flagged, not quietly averaged away.',
  },
  {
    eyebrow: 'Reporting',
    title: 'Formatted for the funder who asked',
    body: 'Export to PDF or Word in the shape MasterCard Foundation, Tony Elumelu, or GIZ/USAID expect — or a generic donor template when it is your own board asking.',
    amber: true,
  },
];

const STEPS = [
  {
    n: 'Step 01',
    title: 'Build the framework',
    body: 'Set the competency areas and questions for what you teach. Start from a template and edit, or upload your question bank as a CSV.',
  },
  {
    n: 'Step 02',
    title: 'Send the links',
    body: 'Each cohort gets a pre-assessment link at intake and a post-assessment link at the end. A separate link collects satisfaction feedback.',
  },
  {
    n: 'Step 03',
    title: 'Export the evidence',
    body: 'Watch gains and equity breakdowns update as responses arrive, then generate the funder report when the cohort closes.',
  },
];

export default function LandingPage() {
  const { user, restoring } = useAuth();

  // A returning, already-signed-in admin doesn't need the pitch again.
  if (!restoring && user) return <Navigate to="/courses" replace />;

  const meanPre = AREAS.reduce((s, a) => s + a.pre, 0) / AREAS.length;
  const meanPost = AREAS.reduce((s, a) => s + a.post, 0) / AREAS.length;

  return (
    <div className="dp-root">
      <header className="dp-header">
        <div className="dp-wrap dp-header-inner">
          <span className="dp-mark">
            daprova<span>.</span>
          </span>
          <nav className="dp-nav">
            <Link to="/login" className="dp-link">
              Log in
            </Link>
            <Link to="/signup" className="dp-btn">
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      <div className="dp-wrap">
        <section className="dp-hero">
          <div>
            <p className="dp-eyebrow">Pre / post competency measurement</p>
            <h1 className="dp-h1">
              Prove what your training <em>actually changed</em>.
            </h1>
            <p className="dp-lede">
              Daprova measures the same learners before and after your programme, then turns the difference into the evidence African
              EdTechs, training academies and NGOs are asked to produce.
            </p>
            <div className="dp-cta-row">
              <Link to="/signup" className="dp-btn dp-btn-lg">
                Sign up your organisation
              </Link>
              <Link to="/login" className="dp-btn dp-btn-ghost dp-btn-lg">
                Log in
              </Link>
            </div>
          </div>

          {/* Signature element: the product's own output. Bars rise from the
              baseline rule; what floats above each is the gain, not the score. */}
          <figure className="dp-plot">
            <figcaption className="dp-plot-head">
              <span>
                <span className="dp-plot-title">Digital Skills · Cohort 1</span>
                <span className="dp-eyebrow dp-plot-n">n = 245 learners</span>
              </span>
              {/* These figures come from a synthetic validation cohort, not a
                  real customer's results — say so on the page rather than let
                  a visitor assume otherwise. */}
              <span className="dp-tag">Sample data</span>
            </figcaption>

            <div className="dp-bars">
              {AREAS.map((a, i) => {
                const postH = (a.post / PLOT_CEILING) * 100;
                const preH = (a.pre / a.post) * 100;
                return (
                  <div className="dp-bar-col" key={a.name}>
                    <span className="dp-delta">+{(a.post - a.pre).toFixed(1)}</span>
                    <div className="dp-bar" style={{ height: `${postH}%`, animationDelay: `${i * 80}ms` }}>
                      <div className="dp-bar-pre" style={{ height: `${preH}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="dp-baseline" />

            <div className="dp-plot-labels">
              {AREAS.map((a) => (
                <span className="dp-plot-label" key={a.name}>
                  {a.name}
                </span>
              ))}
            </div>

            <div className="dp-plot-foot">
              <div>
                <span className="dp-stat-k">Mean pre</span>
                <span className="dp-stat-v">{meanPre.toFixed(1)}%</span>
              </div>
              <div>
                <span className="dp-stat-k">Mean post</span>
                <span className="dp-stat-v">{meanPost.toFixed(1)}%</span>
              </div>
              <div>
                <span className="dp-stat-k">Mean gain</span>
                <span className="dp-stat-v" style={{ color: 'var(--gain)' }}>
                  +{(meanPost - meanPre).toFixed(1)}
                </span>
              </div>
              <div>
                <span className="dp-stat-k">Pass rate</span>
                <span className="dp-stat-v">49.8%</span>
              </div>
            </div>
          </figure>
        </section>
      </div>

      <section className="dp-stakes">
        <div className="dp-wrap dp-stakes-inner">
          <h2>Funders stopped accepting “the training went well.”</h2>
          <p>
            They ask by how much, for whom, and measured against what. Attendance sheets and satisfaction scores answer none of those.
            A pre/post design does — and it is the difference between reporting activity and reporting impact.
          </p>
        </div>
      </section>

      <div className="dp-wrap">
        <section className="dp-section">
          <div className="dp-section-head">
            <p className="dp-eyebrow">What you get</p>
            <h2 className="dp-h2">Built around one measurement, done properly.</h2>
          </div>
          <div className="dp-panels">
            {CAPABILITIES.map((c) => (
              <article className={`dp-panel${c.amber ? ' dp-panel-amber' : ''}`} key={c.title}>
                <p className="dp-eyebrow">{c.eyebrow}</p>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="dp-section">
          <div className="dp-equity">
            <div className="dp-eq-rows">
              {EQUITY.map((e) => (
                <div className="dp-eq-row" key={e.label}>
                  <div className="dp-eq-top">
                    <span className="dp-eq-label">
                      {e.label}{' '}
                      <span className="dp-eq-n">
                        n={e.n}
                        {e.n < 5 ? ' · small sample' : ''}
                      </span>
                    </span>
                    <span className="dp-eq-gain">+{e.gain.toFixed(2)}</span>
                  </div>
                  <div className="dp-eq-track">
                    <div className="dp-eq-fill" style={{ width: `${(e.gain / EQUITY_CEILING) * 100}%`, opacity: e.n < 5 ? 0.4 : 1 }} />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <p className="dp-eyebrow">Equity</p>
              <h2 className="dp-h2">Averages hide the learners you set out to reach.</h2>
              <p className="dp-sub">
                A single cohort mean can look healthy while one group gains nothing. Daprova splits every result by gender, age band,
                location and disability status as standard, and marks any subgroup under five learners as too small to draw a
                conclusion from — because reporting a confident number off four responses is how programmes get misled.
              </p>
            </div>
          </div>
        </section>

        <section className="dp-section">
          <div className="dp-section-head">
            <p className="dp-eyebrow">How it works</p>
            <h2 className="dp-h2">Three steps, in this order.</h2>
          </div>
          <div className="dp-steps">
            {STEPS.map((s) => (
              <article className="dp-step" key={s.n}>
                <span className="dp-step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="dp-close">
          <h2 className="dp-h2">Measure your next cohort.</h2>
          <p className="dp-sub">Free to start. No card required. Your first framework takes about ten minutes to set up.</p>
          <Link to="/signup" className="dp-btn dp-btn-lg">
            Sign up your organisation
          </Link>
        </section>

        <footer className="dp-footer">
          <span>© {new Date().getFullYear()} Daprova</span>
          <Link to="/login" className="dp-link">
            Log in
          </Link>
        </footer>
      </div>
    </div>
  );
}
