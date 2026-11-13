import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Alert, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,72}$/;

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialToken = (params.get('token') ?? '').trim();

  const [token, setToken] = useState(initialToken);
  const [manualToken, setManualToken] = useState(!initialToken);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  // Validaciones en tiempo real
  const hasLength = newPassword.length >= 8 && newPassword.length <= 72;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);
  const hasSymbol = /[^\w\s]/.test(newPassword);
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const isFormValid =
    token.trim().length >= 20 &&
    PASSWORD_RULE.test(newPassword) &&
    passwordsMatch;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token.trim()) {
      setError('Debes ingresar un token de recuperación válido.');
      return;
    }

    if (!PASSWORD_RULE.test(newPassword)) {
      setError('La contraseña debe cumplir con todos los requisitos de seguridad.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden. Verifica e intenta de nuevo.');
      return;
    }

    setBusy(true);
    try {
      await api.post('/auth/reset-password', {
        token: token.trim(),
        newPassword,
      });
      setOk(true);
      setTimeout(() => navigate('/login'), 2200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo restablecer la contraseña';
      if (msg.toLowerCase().includes('inválido') || msg.toLowerCase().includes('expiró')) {
        setError('El enlace de recuperación es inválido o ha expirado. Por seguridad, solicita uno nuevo.');
      } else {
        setError(msg);
      }
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

        {ok && (
          <Alert kind="ok">
            ¡Contraseña actualizada con éxito! Tus sesiones activas se han revocado por seguridad. Redirigiendo al inicio de sesión…
          </Alert>
        )}

        {error && <Alert kind="error">{error}</Alert>}

        {!initialToken && !ok && (
          <div className="field">
            <Alert kind="info">
              No detectamos un token en la dirección web. Si abriste esta página manualmente, escribe el token recibido o{' '}
              <Link to="/forgot-password" style={{ textDecoration: 'underline' }}>
                solicita un enlace nuevo aquí
              </Link>.
            </Alert>
          </div>
        )}

        {initialToken && !manualToken && !ok && (
          <div className="token-badge">
            <Icon name="check" />
            <span>Token de recuperación vinculado desde el correo</span>
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: '#0369a1', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.75rem', marginLeft: 'auto' }}
              onClick={() => setManualToken(true)}
            >
              Editar
            </button>
          </div>
        )}

        {!ok && (
          <form onSubmit={onSubmit} noValidate>
            {manualToken && (
              <div className="field">
                <label htmlFor="token">Token de recuperación</label>
                <input
                  id="token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Pega el token recibido aquí"
                  required
                  className="mono"
                  autoComplete="off"
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="newPassword">Nueva contraseña</label>
              <div className="input-with-action">
                <input
                  id="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  maxLength={72}
                  autoComplete="new-password"
                  placeholder="Ingresa tu nueva contraseña"
                />
                <button
                  type="button"
                  className="action-btn"
                  title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <Icon name={showPassword ? 'eye-off' : 'eye'} />
                </button>
              </div>
            </div>

            {/* Checklist de requisitos de seguridad */}
            <div className="pwd-requirements" aria-live="polite">
              <p>Requisitos de la contraseña:</p>
              <ul>
                <li className={hasLength ? 'valid' : 'invalid'}>
                  <Icon name={hasLength ? 'check' : 'alert'} />
                  <span>Entre 8 y 72 caracteres ({newPassword.length}/72)</span>
                </li>
                <li className={hasUpper ? 'valid' : 'invalid'}>
                  <Icon name={hasUpper ? 'check' : 'alert'} />
                  <span>Al menos una letra mayúscula (A-Z)</span>
                </li>
                <li className={hasLower ? 'valid' : 'invalid'}>
                  <Icon name={hasLower ? 'check' : 'alert'} />
                  <span>Al menos una letra minúscula (a-z)</span>
                </li>
                <li className={hasNumber ? 'valid' : 'invalid'}>
                  <Icon name={hasNumber ? 'check' : 'alert'} />
                  <span>Al menos un número (0-9)</span>
                </li>
                <li className={hasSymbol ? 'valid' : 'invalid'}>
                  <Icon name={hasSymbol ? 'check' : 'alert'} />
                  <span>Al menos un símbolo o carácter especial (!@#$%...)</span>
                </li>
              </ul>
            </div>

            <div className="field">
              <label htmlFor="confirmPassword">Confirmar nueva contraseña</label>
              <div className="input-with-action">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="Repite la nueva contraseña"
                />
                <button
                  type="button"
                  className="action-btn"
                  title={showConfirmPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  aria-label={showConfirmPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  <Icon name={showConfirmPassword ? 'eye-off' : 'eye'} />
                </button>
              </div>
              {confirmPassword.length > 0 && !passwordsMatch && (
                <span className="field-error">Las contraseñas aún no coinciden.</span>
              )}
            </div>

            <div className="form-actions" style={{ marginTop: '1rem' }}>
              <button className="btn cta" type="submit" disabled={busy || !isFormValid}>
                {busy ? <Spinner /> : <Icon name="check" />}
                {busy ? 'Guardando contraseña…' : 'Guardar nueva contraseña'}
              </button>
            </div>
          </form>
        )}

        <p className="muted" style={{ marginTop: '1.25rem' }}>
          <Link to="/login">← Volver al inicio de sesión</Link>
          {' · '}
          <Link to="/forgot-password">Solicitar otro enlace</Link>
        </p>
      </div>
    </div>
  );
}
