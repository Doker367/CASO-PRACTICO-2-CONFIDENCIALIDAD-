import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import type { TwoFactorStatus } from '../types';

export default function ChangePasswordPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [setupSent, setSetupSent] = useState<{ email: string; expiresInSeconds: number } | null>(
    null,
  );
  const [code, setCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [tfError, setTfError] = useState<string | null>(null);
  const [tfOk, setTfOk] = useState<string | null>(null);
  const [tfBusy, setTfBusy] = useState(false);

  async function loadStatus() {
    try {
      setStatus(await api.get<TwoFactorStatus>('/auth/2fa/status'));
    } catch {
      setStatus(null);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

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

  async function startSetup() {
    setTfError(null);
    setTfOk(null);
    setTfBusy(true);
    try {
      const res = await api.post<{ message: string; email: string; expiresInSeconds: number }>(
        '/auth/2fa/setup',
      );
      setSetupSent({ email: res.email, expiresInSeconds: res.expiresInSeconds });
      setCode('');
      setTfOk('Código enviado. Revisa tu correo para confirmar la activación.');
    } catch (err) {
      setTfError(err instanceof Error ? err.message : 'No se pudo iniciar la activación');
    } finally {
      setTfBusy(false);
    }
  }

  async function confirmSetup(e: FormEvent) {
    e.preventDefault();
    setTfError(null);
    setTfOk(null);
    setTfBusy(true);
    try {
      await api.post('/auth/2fa/confirm', { code });
      setSetupSent(null);
      setCode('');
      await loadStatus();
      setTfOk(
        'Verificación en dos pasos activada. Las demás sesiones se cerraron; la próxima vez se pedirá un código.',
      );
    } catch (err) {
      setTfError(err instanceof Error ? err.message : 'Código inválido o expirado');
    } finally {
      setTfBusy(false);
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setTfError(null);
    setTfOk(null);
    setTfBusy(true);
    try {
      await api.post('/auth/2fa/disable', { password: disablePassword });
      setDisablePassword('');
      setSetupSent(null);
      await loadStatus();
      setTfOk('Verificación en dos pasos desactivada.');
    } catch (err) {
      setTfError(err instanceof Error ? err.message : 'No se pudo desactivar');
    } finally {
      setTfBusy(false);
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

      <div className="card" style={{ maxWidth: 520 }}>
        <div className="card-head">
          <h2>Verificación en dos pasos</h2>
          {status && (
            <span className={`badge ${status.enabled ? 'ok' : 'off'}`}>
              {status.enabled ? 'Activa' : 'Inactiva'}
            </span>
          )}
        </div>
        <p className="muted">
          Además de tu contraseña, se envía un código de 6 dígitos a tu correo. El código se
          guarda como HMAC-SHA-256, vence en 10 minutos y admite 5 intentos.
        </p>
        {tfOk && <Alert kind="ok">{tfOk}</Alert>}
        {tfError && <Alert kind="error">{tfError}</Alert>}

        {!status && <p className="muted">Consultando estado…</p>}

        {status && status.enabled && (
          <>
            <p>
              <strong>Método:</strong> código por correo a <code>{status.email}</code>
            </p>
            <form onSubmit={disable}>
              <div className="field">
                <label htmlFor="disablePassword">Confirma tu contraseña para desactivar</label>
                <input
                  id="disablePassword"
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <div className="form-actions">
                <button className="btn danger" type="submit" disabled={tfBusy}>
                  {tfBusy ? <Spinner /> : <Icon name="lock" />}
                  {tfBusy ? 'Desactivando…' : 'Desactivar 2FA'}
                </button>
              </div>
            </form>
          </>
        )}

        {status && !status.enabled && !setupSent && (
          <div className="form-actions">
            <button className="btn cta" type="button" onClick={startSetup} disabled={tfBusy}>
              {tfBusy ? <Spinner /> : <Icon name="shield" />}
              {tfBusy ? 'Enviando…' : 'Activar 2FA por correo'}
            </button>
          </div>
        )}

        {status && !status.enabled && setupSent && (
          <form onSubmit={confirmSetup}>
            <p className="muted">
              Enviamos un código a <strong>{setupSent.email}</strong>. Vence en{' '}
              {Math.round(setupSent.expiresInSeconds / 60)} minutos.
            </p>
            <div className="field">
              <label htmlFor="setupCode">Código de verificación</label>
              <input
                id="setupCode"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                style={{ letterSpacing: '0.4em', textAlign: 'center' }}
              />
            </div>
            <div className="form-actions">
              <button className="btn cta" type="submit" disabled={tfBusy || code.length !== 6}>
                {tfBusy ? <Spinner /> : <Icon name="check" />}
                {tfBusy ? 'Confirmando…' : 'Confirmar y activar'}
              </button>
              <button className="btn ghost" type="button" onClick={startSetup} disabled={tfBusy}>
                Reenviar código
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  setSetupSent(null);
                  setCode('');
                  setTfOk(null);
                  setTfError(null);
                }}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="card" style={{ maxWidth: 480, marginTop: '1rem' }}>
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
