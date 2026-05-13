import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FormEvent } from 'react';
import {
  createDocCategory,
  deleteDocCategory,
  listDocCategories,
  updateDocCategory,
} from '../api';
import { useSession } from '../session';
import type { DocCategoryRow } from '../types';

interface EditState {
  key: string;
  displayName: string;
  displayOrder: number;
}

export const BestyrelsenDocCategoriesPage = () => {
  const { session } = useSession();
  const [categories, setCategories] = useState<DocCategoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newDisplayOrder, setNewDisplayOrder] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      setCategories(await listDocCategories(session.idToken));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente kategorier');
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    const name = newDisplayName.trim();
    if (!name) {
      setError('Navn skal udfyldes.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const order = newDisplayOrder.trim() ? Number(newDisplayOrder) : undefined;
      await createDocCategory(session.idToken, {
        displayName: name,
        displayOrder: Number.isFinite(order) ? (order as number) : undefined,
      });
      setNewDisplayName('');
      setNewDisplayOrder('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke oprette kategori');
    } finally {
      setCreating(false);
    }
  };

  const onSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !edit) return;
    const name = edit.displayName.trim();
    if (!name) {
      setError('Navn skal udfyldes.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateDocCategory(session.idToken, edit.key, {
        displayName: name,
        displayOrder: edit.displayOrder,
      });
      setEdit(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke gemme ændringen');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (c: DocCategoryRow) => {
    if (!session) return;
    if (
      !confirm(
        `Slet kategorien "${c.displayName}"? Eksisterende dokumenter med denne kategori beholder værdien, men nye dokumenter kan ikke længere vælge den.`,
      )
    )
      return;
    try {
      await deleteDocCategory(session.idToken, c.key);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke slette kategori');
    }
  };

  return (
    <main className="content">
      <p>
        <Link to="/bestyrelse">← Tilbage til Bestyrelsen</Link>
      </p>
      <p className="eyebrow">Bestyrelsen · Administrator</p>
      <h1>Dokument-kategorier</h1>
      <p className="lede">
        Kategorier driver dropdown-listen på upload-formularen. Tilføj nye efter behov,
        omdøb hvis du har lavet en stavefejl, eller slet ubrugte. Eksisterende dokumenter
        beholder altid den tekst de blev uploadet med.
      </p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={onCreate} className="card" style={{ marginTop: '1.5rem', padding: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Ny kategori</h2>
        <div className="field">
          <label htmlFor="dc-name">Navn</label>
          <input
            id="dc-name"
            type="text"
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
            placeholder="F.eks. Husorden"
            maxLength={80}
            disabled={creating}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="dc-order">Rækkefølge (lav værdi = øverst, valgfri)</label>
          <input
            id="dc-order"
            type="number"
            value={newDisplayOrder}
            onChange={(e) => setNewDisplayOrder(e.target.value)}
            placeholder="1000"
            disabled={creating}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={creating}>
          {creating ? 'Opretter…' : '+ Opret kategori'}
        </button>
      </form>

      <h2 style={{ marginTop: '2rem' }}>Eksisterende</h2>
      {categories === null && <p>Indlæser…</p>}
      {categories && categories.length === 0 && (
        <p style={{ color: 'var(--ink-soft)' }}>
          Ingen kategorier oprettet. Tilføj mindst én før der kan uploades dokumenter.
        </p>
      )}
      {categories && categories.length > 0 && (
        <ul className="doc-list">
          {categories.map((c) =>
            edit && edit.key === c.key ? (
              <li key={c.key} className="doc-row">
                <form onSubmit={onSaveEdit} style={{ padding: '0.9rem 0.2rem' }}>
                  <div className="field">
                    <label htmlFor={`edit-name-${c.key}`}>Navn</label>
                    <input
                      id={`edit-name-${c.key}`}
                      type="text"
                      value={edit.displayName}
                      onChange={(ev) => setEdit({ ...edit, displayName: ev.target.value })}
                      maxLength={80}
                      disabled={saving}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`edit-order-${c.key}`}>Rækkefølge</label>
                    <input
                      id={`edit-order-${c.key}`}
                      type="number"
                      value={edit.displayOrder}
                      onChange={(ev) =>
                        setEdit({ ...edit, displayOrder: Number(ev.target.value) || 0 })
                      }
                      disabled={saving}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="submit" className="btn-primary" disabled={saving}>
                      {saving ? 'Gemmer…' : 'Gem'}
                    </button>
                    <button
                      type="button"
                      className="btn-card"
                      onClick={() => setEdit(null)}
                      disabled={saving}
                    >
                      Annullér
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={c.key} className="doc-row">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.9rem 0.2rem',
                    gap: '1rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <span className="doc-title">{c.displayName}</span>
                    <span className="doc-meta">
                      <span>rækkefølge {c.displayOrder}</span>
                      <span>· nøgle {c.key}</span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      type="button"
                      className="btn-card"
                      onClick={() =>
                        setEdit({
                          key: c.key,
                          displayName: c.displayName,
                          displayOrder: c.displayOrder,
                        })
                      }
                    >
                      Redigér
                    </button>
                    <button type="button" className="btn-card" onClick={() => onDelete(c)}>
                      Slet
                    </button>
                  </div>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </main>
  );
};
