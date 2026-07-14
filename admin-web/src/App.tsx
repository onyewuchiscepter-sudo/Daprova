import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Layout from './Layout';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ContactSalesPage from './pages/ContactSalesPage';
import FrameworksListPage from './pages/FrameworksListPage';
import NewFrameworkPage from './pages/NewFrameworkPage';
import FrameworkDetailPage from './pages/FrameworkDetailPage';
import CoursesListPage from './pages/CoursesListPage';
import NewCoursePage from './pages/NewCoursePage';
import CourseDetailPage from './pages/CourseDetailPage';
import CohortDashboardPage from './pages/CohortDashboardPage';
import TeamPage from './pages/TeamPage';
import AcceptInvitePage from './pages/AcceptInvitePage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, restoring } = useAuth();
  if (restoring) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/signup/contact-sales" element={<ContactSalesPage />} />
      <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/frameworks" element={<FrameworksListPage />} />
        <Route path="/frameworks/new" element={<NewFrameworkPage />} />
        <Route path="/frameworks/:id" element={<FrameworkDetailPage />} />
        <Route path="/courses" element={<CoursesListPage />} />
        <Route path="/courses/new" element={<NewCoursePage />} />
        <Route path="/courses/:id" element={<CourseDetailPage />} />
        <Route path="/cohorts/:id" element={<CohortDashboardPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/" element={<Navigate to="/courses" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
