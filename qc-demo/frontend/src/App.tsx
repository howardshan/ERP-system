import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { loadAuth } from './api/client';
import { LoginPage } from './pages/LoginPage';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { HoldsPage } from './pages/admin/HoldsPage';
import { TracePage } from './pages/admin/TracePage';
import { QcHome } from './pages/qc/QcHome';
import { LotsList } from './pages/qc/LotsList';
import { LotDetail } from './pages/qc/LotDetail';
import { PendingQueue } from './pages/qc/PendingQueue';
import { InspectPage } from './pages/qc/InspectPage';

function HomeRedirect() {
  const auth = loadAuth();
  if (!auth) return <Navigate to="/login" replace />;
  return <Navigate to={auth.role === 'manager' ? '/admin' : '/qc'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<HomeRedirect />} />

      <Route
        path="/qc"
        element={
          <RequireAuth roles={['qc', 'manager']}>
            <QcHome />
          </RequireAuth>
        }
      />
      <Route
        path="/qc/lots"
        element={
          <RequireAuth roles={['qc', 'manager']}>
            <LotsList />
          </RequireAuth>
        }
      />
      <Route
        path="/qc/lots/:id"
        element={
          <RequireAuth roles={['qc', 'manager']}>
            <LotDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/qc/pending"
        element={
          <RequireAuth roles={['qc', 'manager']}>
            <PendingQueue />
          </RequireAuth>
        }
      />
      <Route
        path="/qc/inspect/:subLotId"
        element={
          <RequireAuth roles={['qc', 'manager']}>
            <InspectPage />
          </RequireAuth>
        }
      />

      <Route
        path="/admin"
        element={
          <RequireAuth roles={['manager']}>
            <AdminDashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/holds"
        element={
          <RequireAuth roles={['manager']}>
            <HoldsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/trace/:lotId"
        element={
          <RequireAuth roles={['manager']}>
            <TracePage />
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
