import { FormEvent, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';

export default function ChangePasswordPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setOk(true);
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Mi cuenta</h1>
        <p>
          {user?.name} · {user?.email} · {user?.roles.join(', ')}
        </p>
      </div>
      <div className="card" style={{ maxWidth: 480 }}>
        <h2>Cambiar contraseña</h2>
        {ok && <Alert kind="ok">Contraseña actualizada. Tus sesiones abiertas se cerraron.</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="currentPassword">Contraseña actual</label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
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
          <p className="hint">Mínimo 8 caracteres con mayúscula, minúscula, número y símbolo.</p>
          <div className="form-actions">
            <button className="btn cta" type="submit">
              {busy ? <Spinner /> : <Icon name="key" />}
              {busy ? 'Actualizando…' : 'Actualizar'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
