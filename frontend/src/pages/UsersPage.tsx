import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, EmptyState } from '../components/ui';
import type { Role, UserRow } from '../types';

export default function UsersPage() {
  const { user, has, refreshMe } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const canManage = has('users:manage');

  async function load() {
    try {
      const data = await api.get<UserRow[]>('/users');
      setUsers(data);
      if (canManage) setRoles(await api.get<Role[]>('/roles'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar usuarios');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleRole(u: UserRow, roleId: string) {
    const current = u.roles.map((r) => r.role.id);
    const next = current.includes(roleId)
      ? current.filter((id) => id !== roleId)
      : [...current, roleId];
    if (next.length === 0) {
      setError('Un usuario debe conservar al menos un rol');
      return;
    }
    setBusyId(u.id);
    try {
      await api.patch(`/users/${u.id}/roles`, { roleIds: next });
      setOk(`Roles actualizados para ${u.email}`);
      setError(null);
      await load();
      if (u.id === user?.id) await refreshMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar roles');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleStatus(u: UserRow) {
    const action = u.isActive ? 'desactivar' : 'activar';
    if (u.isActive && !confirm(`¿${action} a ${u.email}? Se cerrarán sus sesiones.`)) return;
    setBusyId(u.id);
    try {
      await api.patch(`/users/${u.id}/status`, { isActive: !u.isActive });
      setOk(`${u.email} ${u.isActive ? 'desactivado' : 'activado'}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Usuarios registrados</h1>
        <p>Asigna o revoca roles. Cada rol define qué acciones puede realizar el usuario.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Roles</th>
              <th>Estado</th>
              {canManage && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name}</strong>
                  {u.id === user?.id && <span className="badge" style={{ marginLeft: 6 }}>tú</span>}
                </td>
                <td className="mono">{u.email}</td>
                <td>
                  {canManage ? (
                    <div className="checks">
                      {roles.map((r) => (
                        <label key={r.id}>
                          <input
                            type="checkbox"
                            checked={u.roles.some((ur) => ur.role.id === r.id)}
                            onChange={() => void toggleRole(u, r.id)}
                            disabled={busyId === u.id}
                          />
                          {r.name}
                        </label>
                      ))}
                    </div>
                  ) : (
                    u.roles.map((ur) => (
                      <span key={ur.role.id} className="badge" style={{ marginRight: 4 }}>
                        {ur.role.name}
                      </span>
                    ))
                  )}
                </td>
                <td>
                  <span className={`badge ${u.isActive ? 'ok' : 'off'}`}>{u.isActive ? 'Activo' : 'Inactivo'}</span>
                  {u.lockedUntil && (
                    <div className="muted">Bloqueado hasta {new Date(u.lockedUntil).toLocaleString()}</div>
                  )}
                </td>
                {canManage && (
                  <td>
                    <button
                      className="btn sm ghost"
                      disabled={u.id === user?.id || busyId === u.id}
                      onClick={() => void toggleStatus(u)}
                    >
                      {u.isActive ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState title="Sin usuarios" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
