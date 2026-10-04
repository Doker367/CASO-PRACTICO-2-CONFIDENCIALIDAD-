import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Alert, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword });
      setOk(true);
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo restablecer la contraseña');
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
          <span>Nueva contraseña</span>
        </div>
      </div>
      <div className="card">
        <h1>Restablecer contraseña</h1>
        {ok && <Alert kind="ok">Contraseña actualizada. Redirigiendo al login…</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="token">Token de recuperación</label>
            <input id="token" value={token} onChange={(e) => setToken(e.target.value)} required className="mono" />
          </div>
          <div className="field">
            <label htmlFor="newPassword">Nueva contraseña</label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="form-actions">
            <button className="btn cta" type="submit">
              {busy ? <Spinner /> : <Icon name="check" />}
              {busy ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </div>
        </form>
        <p className="muted">
          <Link to="/login">Volver al login</Link>
        </p>
      </div>
    </div>
  );
}
