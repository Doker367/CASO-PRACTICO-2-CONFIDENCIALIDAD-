import { Navigate, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from './AuthContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center">Cargando…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const { user, loading, has } = useAuth();
  if (loading) return <div className="center">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!has(permission)) {
    return (
      <div className="card">
        <h2>Acceso restringido</h2>
        <p className="muted">
          No tienes permiso <code className="mono">{permission}</code> para acceder a esta sección. Tu rol actual no
          incluye este recurso (principio de mínimo privilegio).
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
