import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Alert, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
      setSentEmail(email.trim().toLowerCase());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo procesar la solicitud';
      if (msg.includes('429') || msg.toLowerCase().includes('throttler') || msg.toLowerCase().includes('many requests')) {
        setError('Has realizado demasiadas solicitudes. Por seguridad, espera un minuto antes de reintentar.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setSentEmail(null);
    setEmail('');
    setError(null);
  }

  return (
    <div className="auth-wrap">
      <div className="brand-block">
        <span className="logo">
          <Icon name="shield" />
        </span>
        <div>
          <strong>Catálogo UNACH</strong>
          <span>Recuperación de contraseña</span>
        </div>
      </div>

      <div className="card">
        <h1>Recuperar contraseña</h1>

        {error && <Alert kind="error">{error}</Alert>}

        {sentEmail ? (
          <div>
            <Alert kind="ok">
              Si la cuenta <strong>{sentEmail}</strong> existe en el sistema, hemos enviado un enlace seguro para restablecer tu contraseña.
            </Alert>

            <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.9rem', margin: '1rem 0', fontSize: '0.84rem', color: 'var(--muted)' }}>
              <p style={{ margin: '0 0 0.5rem', fontWeight: 600, color: 'var(--text-strong)' }}>
                Información importante:
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <li>El enlace de recuperación tiene una validez de <strong>30 minutos</strong> y es de un solo uso.</li>
                <li>Si no recibes el correo en unos minutos, revisa tu carpeta de spam o correo no deseado.</li>
                <li>En entorno de desarrollo local, puedes ver la bandeja de correo en <strong>MailHog</strong> (<a href="http://localhost:8026" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>http://localhost:8026</a>).</li>
              </ul>
            </div>

            <div className="form-actions" style={{ marginTop: '1rem' }}>
              <button className="btn" type="button" onClick={handleReset}>
                <Icon name="chevron-left" />
                <span>Probar con otro correo</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="muted" style={{ margin: '0 0 1rem', fontSize: '0.86rem' }}>
              Ingresa el correo electrónico asociado a tu cuenta. Te enviaremos un enlace con las instrucciones para restablecer tu contraseña.
            </p>

            <div className="field">
              <label htmlFor="email">Correo electrónico registrado</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="ejemplo@unach.mx"
              />
            </div>

            <div className="form-actions" style={{ marginTop: '0.8rem' }}>
              <button className="btn cta" type="submit" disabled={busy || !email.trim()}>
                {busy ? <Spinner /> : <Icon name="check" />}
                {busy ? 'Enviando enlace…' : 'Enviar enlace de recuperación'}
              </button>
            </div>
          </form>
        )}

        <p className="muted" style={{ marginTop: '1.25rem' }}>
          <Link to="/login">← Volver al inicio de sesión</Link>
        </p>
      </div>
    </div>
  );
}
