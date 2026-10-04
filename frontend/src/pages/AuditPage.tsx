import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Alert, EmptyState } from '../components/ui';
import { Icon } from '../components/Icon';
import type { AuditRow } from '../types';

interface AuditPageData {
  items: AuditRow[];
  total: number;
  page: number;
  limit: number;
}

export default function AuditPage() {
  const [data, setData] = useState<AuditPageData | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setData(await api.get<AuditPageData>(`/audit?page=${page}&limit=50`));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar auditoría');
      }
    })();
  }, [page]);

  const rows = (data?.items ?? []).filter((row) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      row.action.toLowerCase().includes(q) ||
      (row.email ?? '').toLowerCase().includes(q) ||
      (row.detail ?? '').toLowerCase().includes(q) ||
      row.ipAddress.includes(q)
    );
  });

  return (
    <>
      <div className="page-head">
        <h1>Registro de auditoría</h1>
        <p>Solo lectura · usuario, fecha, IP y acción. No puede modificarse desde la aplicación.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Filtrar por acción, usuario, IP…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filtrar auditoría"
          />
        </div>
        <span className="muted spacer">{data?.total ?? 0} registro(s)</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Detalle</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(row.createdAt).toLocaleString()}</td>
                <td className="mono">{row.email ?? '—'}</td>
                <td>
                  <span className="badge mono">{row.action}</span>
                </td>
                <td>
                  {row.resource ? `${row.resource}${row.resourceId ? ` · ${row.resourceId.slice(0, 8)}` : ''}` : ''}
                  {row.detail ? ` — ${row.detail}` : ''}
                </td>
                <td className="mono">{row.ipAddress}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState title="Sin registros" hint="Ajusta el filtro o realiza acciones en el sistema." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          <Icon name="chevron-left" />
          Anterior
        </button>
        <span className="muted">
          Página {data?.page ?? 1} de {Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit || 50)))}
        </span>
        <button
          className="btn ghost sm"
          disabled={!!data && data.page * data.limit >= data.total}
          onClick={() => setPage(page + 1)}
        >
          Siguiente
          <Icon name="chevron-right" />
        </button>
      </div>
    </>
  );
}
