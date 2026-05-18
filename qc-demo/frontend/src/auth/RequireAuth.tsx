import { Navigate } from 'react-router-dom';
import { loadAuth } from '../api/client';

export function RequireAuth({
  children,
  roles,
}: {
  children: React.ReactNode;
  roles?: string[];
}) {
  const auth = loadAuth();
  if (!auth) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(auth.role)) {
    const home = auth.role === 'manager' ? '/admin' : '/qc';
    return <Navigate to={home} replace />;
  }
  return <>{children}</>;
}
