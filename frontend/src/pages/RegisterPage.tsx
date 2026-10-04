import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Alert, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await api.post<{ message: string }>('/auth/register', { name, email, password });
      setOk(res.message ?? 'Registro procesado. Inicia sesión para continuar.');
      setTimeout(() => navigate('/login'), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar');
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
          <span>Crea tu cuenta</span>
        </div>
      </div>
      <div className="card">
        <h1>Registro</h1>
        {error && <Alert kind="error">{error}</Alert>}
        {ok && <Alert kind="ok">{ok}</Alert>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="name">Nombre</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="email">Correo</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <p className="hint">Mínimo 8 caracteres con mayúscula, minúscula, número y símbolo.</p>
          <div className="form-actions">
            <button className="btn cta" type="submit">
              {busy ? <Spinner /> : <Icon name="plus" />}
              {busy ? 'Creando…' : 'Crear cuenta'}
            </button>
          </div>
        </form>
        <p className="muted">
          ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
        </p>
      </div>
    </div>
  );
}
