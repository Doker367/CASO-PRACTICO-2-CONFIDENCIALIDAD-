import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { RequireAuth, RequirePermission } from './auth/RequireAuth';
import { Icon, IconName } from './components/Icon';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ProductsPage from './pages/ProductsPage';
import UsersPage from './pages/UsersPage';
import RolesPage from './pages/RolesPage';
import AuditPage from './pages/AuditPage';
import ChangePasswordPage from './pages/ChangePasswordPage';

const TITLES: Record<string, string> = {
  '/products': 'Catálogo de productos',
  '/admin/users': 'Usuarios registrados',
  '/admin/roles': 'Roles y permisos',
  '/admin/audit': 'Registro de auditoría',
  '/account': 'Mi cuenta',
};

export default function App() {
  const { user, logout, has } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawer]);

  const initials = (user?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const nav: { to: string; label: string; icon: IconName; perm?: string }[] = [
    { to: '/products', label: 'Productos', icon: 'package' },
    { to: '/admin/users', label: 'Usuarios', icon: 'users', perm: 'users:read' },
    { to: '/admin/roles', label: 'Roles y permisos', icon: 'shield', perm: 'roles:manage' },
    { to: '/admin/audit', label: 'Auditoría', icon: 'scroll', perm: 'audit:read' },
    { to: '/account', label: 'Mi cuenta', icon: 'key' },
  ];

  if (!user) {
    return (
      <main>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </main>
    );
  }

  const visibleNav = nav.filter((item) => !item.perm || has(item.perm));
  const title = TITLES[location.pathname] ?? 'Catálogo UNACH';

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>

      {drawer && (
        <button
          type="button"
          className="backdrop"
          aria-label="Cerrar menú"
          onClick={() => setDrawer(false)}
        />
      )}

      <aside className={`sidebar${drawer ? ' open' : ''}`} aria-label="Navegación principal">
        <Link to="/products" className="sidebar-brand">
          <span className="logo">
            <Icon name="shield" />
          </span>
          <span>Catálogo UNACH</span>
        </Link>
        <nav>
          <span className="section-label">Menú</span>
          {visibleNav.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
          {has('roles:manage') && (
            <>
              <span className="section-label">Seguridad</span>
              <div className="sidebar-foot" style={{ border: 0, padding: '0.35rem 0.55rem' }}>
                Sesión protegida con JWT · acceso con mínimo privilegio
              </div>
            </>
          )}
        </nav>
        <div className="sidebar-foot">Seguridad en Cómputo · UNACH</div>
      </aside>

      <div className="shell">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-label="Abrir menú"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            <Icon name="menu" />
          </button>
          <h1>{title}</h1>
          <div className="topbar-right">
            <div className="user-chip">
              <span className="avatar" aria-hidden="true">
                {initials}
              </span>
              <span className="meta">
                <strong>{user.name}</strong>
                <span>{user.roles.join(' · ')}</span>
              </span>
            </div>
            <button
              type="button"
              className="icon-btn"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              <Icon name="logout" />
            </button>
          </div>
        </header>

        <main id="main">
          <Routes>
            <Route
              path="/products"
              element={
                <RequireAuth>
                  <ProductsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/account"
              element={
                <RequireAuth>
                  <ChangePasswordPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/users"
              element={
                <RequirePermission permission="users:read">
                  <UsersPage />
                </RequirePermission>
              }
            />
            <Route
              path="/admin/roles"
              element={
                <RequirePermission permission="roles:manage">
                  <RolesPage />
                </RequirePermission>
              }
            />
            <Route
              path="/admin/audit"
              element={
                <RequirePermission permission="audit:read">
                  <AuditPage />
                </RequirePermission>
              }
            />
            <Route path="*" element={<Navigate to="/products" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
