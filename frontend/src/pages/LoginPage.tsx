import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Alert, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(location.state?.from ?? '/products', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="brand-block">
        <span className="logo">
          <Icon name="shield" />
        </span>
        <div>
          <strong>Catálogo UNACH</strong>
          <span>Acceso con roles y permisos</span>
        </div>
      </div>
      <div className="card">
        <h1>Iniciar sesión</h1>
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">Correo</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              placeholder="usuario@unach.mx"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="form-actions">
            <button className="btn cta" type="submit">
              {busy ? <Spinner /> : <Icon name="lock" />}
              {busy ? 'Validando…' : 'Entrar'}
            </button>
            <Link to="/forgot-password" className="muted">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
        </form>
        <p className="muted">
          ¿No tienes cuenta? <Link to="/register">Regístrate</Link>
        </p>
      </div>
    </div>
  );
}
