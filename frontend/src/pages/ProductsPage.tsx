import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, EmptyState, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import type { Category, Product } from '../types';

const emptyForm = {
  name: '',
  sku: '',
  description: '',
  price: '',
  stock: '0',
  categoryId: '',
};

export default function ProductsPage() {
  const { has } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const canWrite = has('products:create') || has('products:update');
  const canDelete = has('products:delete');

  async function load() {
    setLoading(true);
    try {
      const [prods, cats] = await Promise.all([
        api.get<Product[]>(`/products${search ? `?search=${encodeURIComponent(search)}` : ''}`),
        has('categories:read') ? api.get<Category[]>('/categories') : Promise.resolve([] as Category[]),
      ]);
      setProducts(prods);
      setCategories(cats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar productos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const kpis = useMemo(() => {
    const total = products.length;
    const stock = products.reduce((acc, p) => acc + p.stock, 0);
    const value = products.reduce((acc, p) => acc + Number(p.price) * p.stock, 0);
    const low = products.filter((p) => p.stock <= 5).length;
    return { total, stock, value, low };
  }, [products]);

  function startCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFieldErrors({});
    setShowForm(true);
  }

  function startEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      sku: p.sku,
      description: p.description ?? '',
      price: String(p.price),
      stock: String(p.stock),
      categoryId: p.categoryId ?? '',
    });
    setFieldErrors({});
    setShowForm(true);
  }

  function validate() {
    const errs: Record<string, string> = {};
    if (form.name.trim().length < 2) errs.name = 'Mínimo 2 caracteres';
    if (form.sku.trim().length < 2) errs.sku = 'Mínimo 2 caracteres';
    if (form.price === '' || Number(form.price) < 0 || Number.isNaN(Number(form.price))) {
      errs.price = 'Precio inválido (≥ 0)';
    }
    if (form.stock === '' || Number(form.stock) < 0 || !Number.isInteger(Number(form.stock))) {
      errs.stock = 'Stock inválido (entero ≥ 0)';
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const payload = {
      name: form.name,
      sku: form.sku,
      description: form.description || undefined,
      price: Number(form.price),
      stock: Number(form.stock),
      categoryId: form.categoryId || undefined,
    };
    try {
      if (editing) {
        await api.patch(`/products/${editing.id}`, payload);
        setOk('Producto actualizado');
      } else {
        await api.post('/products', payload);
        setOk('Producto creado');
      }
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(p: Product) {
    if (!confirm(`¿Eliminar el producto ${p.sku}? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    try {
      await api.del(`/products/${p.id}`);
      setOk(`Producto ${p.sku} eliminado`);
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
        <h1>Catálogo de productos</h1>
        {canWrite && (
          <button className="btn cta" onClick={startCreate}>
            <Icon name="plus" />
            Nuevo producto
          </button>
        )}
        <p>Gestión de contenidos con permisos de lectura, escritura y eliminación.</p>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="label">Productos</div>
          <div className="value">{kpis.total}</div>
          <div className="hint">en catálogo</div>
        </div>
        <div className="kpi">
          <div className="label">Stock total</div>
          <div className="value">{kpis.stock}</div>
          <div className="hint">unidades</div>
        </div>
        <div className="kpi">
          <div className="label">Valor inventario</div>
          <div className="value">${kpis.value.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</div>
          <div className="hint">precio × stock</div>
        </div>
        <div className="kpi">
          <div className="label">Stock bajo</div>
          <div className="value">{kpis.low}</div>
          <div className="hint">≤ 5 unidades</div>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      {showForm && (
        <div className="card">
          <h2>{editing ? `Editar ${editing.sku}` : 'Nuevo producto'}</h2>
          <form onSubmit={onSubmit}>
            <div className="form-row">
              <div className="field">
                <label htmlFor="p-name">Nombre</label>
                <input
                  id="p-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  minLength={2}
                  aria-invalid={!!fieldErrors.name}
                />
                {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
              </div>
              <div className="field">
                <label htmlFor="p-sku">SKU</label>
                <input
                  id="p-sku"
                  className="mono"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  required
                  minLength={2}
                  aria-invalid={!!fieldErrors.sku}
                />
                {fieldErrors.sku && <span className="field-error">{fieldErrors.sku}</span>}
              </div>
            </div>
            <div className="field">
              <label htmlFor="p-desc">Descripción</label>
              <textarea
                id="p-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
              />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="p-price">Precio (MXN)</label>
                <input
                  id="p-price"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  required
                  aria-invalid={!!fieldErrors.price}
                />
                {fieldErrors.price && <span className="field-error">{fieldErrors.price}</span>}
              </div>
              <div className="field">
                <label htmlFor="p-stock">Stock</label>
                <input
                  id="p-stock"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  required
                  aria-invalid={!!fieldErrors.stock}
                />
                {fieldErrors.stock && <span className="field-error">{fieldErrors.stock}</span>}
              </div>
            </div>
            {categories.length > 0 && (
              <div className="field">
                <label htmlFor="p-cat">Categoría</label>
                <select
                  id="p-cat"
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                >
                  <option value="">Sin categoría</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-actions">
              <button className="btn cta" type="submit">
                {busy ? <Spinner /> : <Icon name="check" />}
                {editing ? 'Guardar cambios' : 'Crear producto'}
              </button>
              <button type="button" className="btn ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Buscar por nombre o SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar productos"
          />
        </div>
        <span className="muted spacer">{products.length} resultado(s)</span>
      </div>

      {loading ? (
        <div className="center">Cargando productos…</div>
      ) : products.length === 0 ? (
        <div className="card">
          <EmptyState title="Sin productos" hint="Ajusta la búsqueda o crea un producto nuevo." />
        </div>
      ) : (
        <div className="grid">
          {products.map((p) => (
            <article key={p.id} className="product-card">
              <span className="sku">{p.sku}</span>
              <h3>{p.name}</h3>
              <p className="desc">{p.description ?? '—'}</p>
              <span className="price">${Number(p.price).toFixed(2)}</span>
              <span className="meta">
                Stock: {p.stock} {p.category ? `· ${p.category.name}` : ''}
                {p.stock <= 5 && <span className="badge warn" style={{ marginLeft: 6 }}>stock bajo</span>}
              </span>
              {(has('products:update') || canDelete) && (
                <div className="row-actions">
                  {has('products:update') && (
                    <button className="btn sm ghost" onClick={() => startEdit(p)}>
                      <Icon name="pencil" />
                      Editar
                    </button>
                  )}
                  {canDelete && (
                    <button className="btn sm danger" onClick={() => void onDelete(p)} disabled={busy}>
                      <Icon name="trash" />
                      Eliminar
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
