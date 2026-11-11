import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Alert, EmptyState, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import type { CryptoInfo, SecureNote } from '../types';

interface VerifyResult {
  ok: boolean;
  message: string;
}

export default function SecureNotesPage() {
  const [notes, setNotes] = useState<SecureNote[]>([]);
  const [info, setInfo] = useState<CryptoInfo | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyResult>>({});

  async function load() {
    setLoading(true);
    try {
      const [noteList, cryptoInfo] = await Promise.all([
        api.get<SecureNote[]>('/secure-notes'),
        api.get<CryptoInfo>('/secure-notes/crypto-info'),
      ]);
      setNotes(noteList);
      setInfo(cryptoInfo);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las notas');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const totals = useMemo(
    () => ({
      count: notes.length,
      signed: notes.filter((n) => n.signature.valid).length,
      bytes: notes.reduce((acc, n) => acc + n.stored.value.length, 0),
    }),
    [notes],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2 || body.trim().length < 2) {
      setError('El título y el contenido deben tener al menos 2 caracteres.');
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api.post<SecureNote>('/secure-notes', { title, body });
      setTitle('');
      setBody('');
      setOk('Nota cifrada y firmada. Revisa abajo el dato tal como quedó en PostgreSQL.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la nota');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(note: SecureNote) {
    setVerifying(note.id);
    try {
      const result = await api.get<{
        decryptionOk: boolean;
        signatureValid: boolean;
        message: string;
      }>(`/secure-notes/${note.id}/verify`);
      setVerifyResults((prev) => ({
        ...prev,
        [note.id]: {
          ok: result.signatureValid && result.decryptionOk,
          message: result.message,
        },
      }));
    } catch (err) {
      setVerifyResults((prev) => ({
        ...prev,
        [note.id]: {
          ok: false,
          message: err instanceof Error ? err.message : 'No se pudo verificar la firma',
        },
      }));
    } finally {
      setVerifying(null);
    }
  }

  async function onCopy(note: SecureNote) {
    try {
      await navigator.clipboard.writeText(note.stored.value);
      setOk('Criptograma copiado. Es exactamente lo que ve un DBA en PostgreSQL.');
    } catch {
      setError('El navegador no permitió copiar al portapapeles.');
    }
  }

  async function onDelete(note: SecureNote) {
    if (!window.confirm(`¿Eliminar la nota "${note.title}"?`)) return;
    setBusy(true);
    try {
      await api.del(`/secure-notes/${note.id}`);
      setOk('Nota eliminada');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Datos cifrados y firmados</h1>
        <p>
          El cuerpo de cada nota viaja en claro, se cifra con AES-256-GCM antes de guardarse y se
          descifra al leerlo. Además, cada nota se firma con RSA-PSS para verificar su integridad.
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      <div className="flow" aria-label="Flujo del dato">
        <span className="flow-step">Texto claro</span>
        <span className="flow-arrow">→</span>
        <span className="flow-step strong">AES-256-GCM</span>
        <span className="flow-arrow">→</span>
        <span className="flow-step">PostgreSQL (cifrado)</span>
        <span className="flow-arrow">→</span>
        <span className="flow-step strong">Descifrado</span>
        <span className="flow-arrow">→</span>
        <span className="flow-step">Usuario</span>
      </div>

      <div className="crypto-info-grid">
        <article className="card crypto-info-card">
          <div className="pill-row">
            <span className="badge mono">AES-256-GCM</span>
            <span className="badge ok">cifrado simétrico</span>
          </div>
          <h2>Cifrado del campo de la base de datos</h2>
          <p className="muted">
            La API cifra el cuerpo <strong>antes</strong> de escribir en PostgreSQL. La llave de 32
            bytes no está en el código: vive en un archivo protegido o en una variable de entorno.
          </p>
          <dl className="key-facts">
            <div>
              <dt>keyId</dt>
              <dd className="mono">{info?.encryption.keyId ?? '…'}</dd>
            </div>
            <div>
              <dt>Origen de la llave</dt>
              <dd className="mono">
                {info
                  ? info.encryption.keySource === 'file'
                    ? `archivo protegido`
                    : 'variable de entorno'
                  : '…'}
              </dd>
            </div>
            <div>
              <dt>Modo</dt>
              <dd className="mono">GCM · IV 96 bits · tag 128 bits</dd>
            </div>
          </dl>
        </article>

        <article className="card crypto-info-card">
          <div className="pill-row">
            <span className="badge mono">RSA-PSS · SHA-256</span>
            <span className="badge ok">firma asimétrica</span>
          </div>
          <h2>Firma digital del documento</h2>
          <p className="muted">
            Cada nota se firma con la llave privada RSA-{info?.signing.modulusLength ?? 3072}. La
            llave pública permite verificar la firma sin poder crearla.
          </p>
          <dl className="key-facts">
            <div>
              <dt>keyId de firma</dt>
              <dd className="mono">{info?.signing.keyId ?? '…'}</dd>
            </div>
            <div>
              <dt>Llave privada</dt>
              <dd className="mono">archivo 600 · solo backend</dd>
            </div>
          </dl>
          {info && (
            <details className="public-key">
              <summary>Ver llave pública (SPKI PEM)</summary>
              <pre>{info.signing.publicKeyPem}</pre>
            </details>
          )}
        </article>
      </div>

      <div className="card">
        <h2>Nueva nota privada</h2>
        <p className="muted">
          Escribe algo sensible. Al guardar, el navegador envía texto claro por HTTPS; la API lo
          cifra, lo firma y solo persiste el criptograma.
        </p>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="n-title">Título (visible en la lista)</label>
            <input
              id="n-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Credenciales del servidor de laboratorio"
              maxLength={120}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="n-body">Contenido sensible (se guarda cifrado)</label>
            <textarea
              id="n-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Ej. usuario: admin / contraseña: S3cr3t!2026"
              rows={3}
              maxLength={5000}
              required
            />
          </div>
          <div className="form-actions">
            <button className="btn cta" type="submit" disabled={busy}>
              {busy ? <Spinner /> : <Icon name="lock" />}
              Cifrar y guardar
            </button>
            <span className="muted">AES-256-GCM + firma RSA-PSS en una sola operación</span>
          </div>
        </form>
      </div>

      <div className="toolbar">
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Notas almacenadas</h2>
        <span className="muted spacer">
          {totals.count} nota(s) · {totals.signed} con firma válida · {totals.bytes} caracteres
          cifrados
        </span>
        <button className="btn ghost sm" onClick={() => void load()} disabled={loading}>
          <Icon name="scroll" />
          Actualizar
        </button>
      </div>

      {loading ? (
        <div className="center">Cargando notas…</div>
      ) : notes.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Sin notas todavía"
            hint="Crea una nota arriba para ver el antes/después del cifrado."
          />
        </div>
      ) : (
        notes.map((note) => (
          <article key={note.id} className="card note-card">
            <div className="note-head">
              <div>
                <h2>{note.title}</h2>
                <span className="muted">
                  {new Date(note.createdAt).toLocaleString()} · id {note.id.slice(0, 8)}…
                </span>
              </div>
              <div className="pill-row">
                <span className={`badge ${note.status === 'ok' ? 'ok' : 'off'}`}>
                  {note.status === 'ok' ? 'descifrada' : 'error de integridad'}
                </span>
                <span className={`badge ${note.signature.valid ? 'ok' : 'off'}`}>
                  {note.signature.valid ? 'firma válida' : 'firma inválida'}
                </span>
              </div>
            </div>

            <div className="crypto-columns">
              <section className="crypto-panel plain">
                <h3>Lo que ve el usuario</h3>
                <span className="muted">Respuesta descifrada por la API</span>
                <p className="note-body">{note.body ?? note.error ?? '—'}</p>
              </section>
              <section className="crypto-panel stored">
                <h3>Lo que hay en PostgreSQL</h3>
                <span className="mono muted">{note.stored.column}</span>
                <pre>{note.stored.value}</pre>
                {note.stored.decoded && (
                  <details>
                    <summary>Parámetros del criptograma</summary>
                    <dl className="key-facts compact">
                      <div>
                        <dt>alg</dt>
                        <dd className="mono">{note.stored.decoded.alg}</dd>
                      </div>
                      <div>
                        <dt>keyId</dt>
                        <dd className="mono">{note.stored.decoded.keyId}</dd>
                      </div>
                      <div>
                        <dt>iv (base64)</dt>
                        <dd className="mono break">{note.stored.decoded.iv}</dd>
                      </div>
                      <div>
                        <dt>tag GCM</dt>
                        <dd className="mono break">{note.stored.decoded.tag}</dd>
                      </div>
                    </dl>
                  </details>
                )}
                <details>
                  <summary>Firma RSA-PSS ({note.signature.hash})</summary>
                  <pre>{note.signature.value}</pre>
                  <span className="muted mono">keyId {note.signature.keyId}</span>
                </details>
              </section>
            </div>

            {verifyResults[note.id] && (
              <Alert kind={verifyResults[note.id].ok ? 'ok' : 'error'}>
                {verifyResults[note.id].message}
              </Alert>
            )}

            <div className="note-actions">
              <button
                className="btn sm ghost"
                onClick={() => void onVerify(note)}
                disabled={verifying === note.id}
              >
                {verifying === note.id ? <Spinner /> : <Icon name="check" />}
                Verificar firma
              </button>
              <button className="btn sm ghost" onClick={() => void onCopy(note)}>
                <Icon name="scroll" />
                Copiar dato cifrado
              </button>
              <button
                className="btn sm danger"
                onClick={() => void onDelete(note)}
                disabled={busy}
              >
                <Icon name="trash" />
                Eliminar
              </button>
            </div>
          </article>
        ))
      )}
    </>
  );
}
