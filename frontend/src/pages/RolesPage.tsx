import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Alert, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import type { Permission, Role } from '../types';

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const byArea = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of permissions) {
      const list = map.get(p.area) ?? [];
      list.push(p);
      map.set(p.area, list);
    }
    return Array.from(map.entries());
  }, [permissions]);

  async function load() {
    try {
      const [r, p] = await Promise.all([api.get<Role[]>('/roles'), api.get<Permission[]>('/permissions')]);
      setRoles(r);
      setPermissions(p);
      const map: Record<string, string[]> = {};
      for (const role of r) map[role.id] = role.permissions.map((rp) => rp.permission.id);
      setSelected(map);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar roles');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/roles', { name, description: description || undefined });
      setName('');
      setDescription('');
      setOk('Rol creado');
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el rol');
    } finally {
      setCreating(false);
    }
  }

  function togglePermission(roleId: string, permId: string) {
    setSelected((prev) => {
      const current = prev[roleId] ?? [];
      const next = current.includes(permId) ? current.filter((id) => id !== permId) : [...current, permId];
      return { ...prev, [roleId]: next };
    });
  }

  async function savePermissions(roleId: string) {
    setBusyId(roleId);
    try {
      await api.put(`/roles/${roleId}/permissions`, { permissionIds: selected[roleId] ?? [] });
      setOk('Permisos actualizados. Los usuarios verán el cambio al renovar su token.');
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar permisos');
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(role: Role) {
    if (!confirm(`¿Eliminar el rol ${role.name}?`)) return;
    setBusyId(role.id);
    try {
      await api.del(`/roles/${role.id}`);
      setOk(`Rol ${role.name} eliminado`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el rol');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Roles y permisos</h1>
        <p>Asignación dinámica de permisos por área y acción (lectura, escritura, eliminación).</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      <div className="card">
        <h2>Crear rol</h2>
        <form onSubmit={onCreate}>
          <div className="form-row">
            <div className="field">
              <label htmlFor="r-name">Nombre</label>
              <input id="r-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </div>
            <div className="field">
              <label htmlFor="r-desc">Descripción</label>
              <input id="r-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn cta" type="submit">
              {creating ? <Spinner /> : <Icon name="plus" />}
              {creating ? 'Creando…' : 'Crear rol'}
            </button>
          </div>
        </form>
      </div>

      {roles.map((role) => (
        <div className="card" key={role.id}>
          <div className="toolbar">
            <h2 style={{ margin: 0 }}>
              {role.name} {role.isSystem && <span className="badge">sistema</span>}
            </h2>
            <span className="muted spacer">{role._count?.users ?? 0} usuario(s)</span>
            {!role.isSystem && (
              <button className="btn sm danger" onClick={() => void onDelete(role)} disabled={busyId === role.id}>
                <Icon name="trash" />
                Eliminar
              </button>
            )}
          </div>
          {role.description && <p className="muted">{role.description}</p>}
          {byArea.map(([area, perms]) => (
            <div className="perm-group" key={area}>
              <h3>{area}</h3>
              <div className="checks">
                {perms.map((p) => (
                  <label key={p.id} title={p.description ?? p.code}>
                    <input
                      type="checkbox"
                      checked={(selected[role.id] ?? []).includes(p.id)}
                      onChange={() => togglePermission(role.id, p.id)}
                    />
                    <span className="mono">{p.code}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="form-actions">
            <button className="btn" onClick={() => void savePermissions(role.id)} disabled={busyId === role.id}>
              {busyId === role.id ? <Spinner /> : <Icon name="check" />}
              Guardar permisos
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
