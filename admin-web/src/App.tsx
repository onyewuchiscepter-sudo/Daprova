import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Layout from './Layout';
import LoginPage from './pages/LoginPage';
import FrameworksListPage from './pages/FrameworksListPage';
import NewFrameworkPage from './pages/NewFrameworkPage';
import FrameworkDetailPage from './pages/FrameworkDetailPage';

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
        <Route path="/" element={<Navigate to="/frameworks" replace />} />
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
