import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Alert, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setMessage('Si el correo existe, recibirás un enlace de recuperación.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar la solicitud');
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
          <span>Recuperación de contraseña</span>
        </div>
      </div>
      <div className="card">
        <h1>Recuperar contraseña</h1>
        {message && <Alert kind="ok">{message}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Correo registrado</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="form-actions">
            <button className="btn cta" type="submit">
              {busy ? <Spinner /> : <Icon name="check" />}
              {busy ? 'Enviando…' : 'Enviar enlace'}
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
