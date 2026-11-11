import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { Alert, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import type { TwoFactorChallenge } from '../types';

export default function LoginPage() {
  const { login, verifyTwoFactor } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const destination = location.state?.from ?? '/products';

  async function onSubmitCredentials(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await login(email, password);
      if (res.mfaRequired) {
        setChallenge(res);
        setCode('');
        return;
      }
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await verifyTwoFactor(challenge.challengeToken, code);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Código inválido o expirado');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!challenge) return;
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ message: string; email: string }>('/auth/2fa/resend', {
        challengeToken: challenge.challengeToken,
      });
      setNotice(`Código reenviado a ${res.email}. Revisa tu correo.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reenviar el código');
    }
  }

  function backToCredentials() {
    setChallenge(null);
    setCode('');
    setError(null);
    setNotice(null);
  }

  if (challenge) {
    return (
      <div className="auth-wrap">
        <div className="brand-block">
          <span className="logo">
            <Icon name="shield" />
          </span>
          <div>
            <strong>Catálogo UNACH</strong>
            <span>Verificación en dos pasos</span>
          </div>
        </div>
        <div className="card">
          <h1>Revisa tu correo</h1>
          <p className="muted">
            Enviamos un código de 6 dígitos a <strong>{challenge.email}</strong>. Vence en{' '}
            {Math.round(challenge.expiresInSeconds / 60)} minutos.
          </p>
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="info">{notice}</Alert>}
          <form onSubmit={onSubmitCode} noValidate>
            <div className="field">
              <label htmlFor="code">Código de verificación</label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                autoFocus
                style={{ letterSpacing: '0.4em', fontSize: '1.25rem', textAlign: 'center' }}
              />
            </div>
            <div className="form-actions">
              <button className="btn cta" type="submit" disabled={code.length !== 6}>
                {busy ? <Spinner /> : <Icon name="lock" />}
                {busy ? 'Verificando…' : 'Verificar y entrar'}
              </button>
            </div>
          </form>
          <div className="form-actions" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn ghost" onClick={resend}>
              Reenviar código
            </button>
            <button type="button" className="btn ghost" onClick={backToCredentials}>
              Volver
            </button>
          </div>
        </div>
      </div>
    );
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
        <form onSubmit={onSubmitCredentials} noValidate>
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
