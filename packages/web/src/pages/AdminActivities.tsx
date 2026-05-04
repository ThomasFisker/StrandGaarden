import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createActivity, deleteActivity, listActivities, updateActivity } from '../api';
import { useSession } from '../session';
import type { Activity } from '../types';

export const AdminActivitiesPage = () => {
  const { session } = useSession();
  const [items, setItems] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newOrder, setNewOrder] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingOrder, setEditingOrder] = useState<number | ''>('');
  const [pending, setPending] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const list = await listActivities(session.idToken);
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente aktiviteter');
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setError(null);
    setCreating(true);
    try {
      await createActivity(session.idToken, {
        displayName: newName.trim(),
        displayOrder: newOrder === '' ? undefined : Number(newOrder),
      });
      setNewName('');
      setNewOrder('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke oprette aktivitet');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (a: Activity) => {
    setEditingKey(a.key);
    setEditingName(a.displayName);
    setEditingOrder(a.displayOrder);
  };
  const cancelEdit = () => {
    setEditingKey(null);
    setEditingName('');
    setEditingOrder('');
  };
  const saveEdit = async (a: Activity) => {
    if (!session) return;
    setPending((p) => ({ ...p, [a.key]: 'Gemmer…' }));
    try {
      await updateActivity(session.idToken, a.key, {
        displayName: editingName.trim() || undefined,
        displayOrder: editingOrder === '' ? undefined : Number(editingOrder),
      });
      cancelEdit();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke gemme');
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[a.key];
        return next;
      });
    }
  };

  const onDelete = async (a: Activity) => {
    if (!session) return;
    if (!confirm(`Slet aktiviteten "${a.displayName}"? Dette kan ikke fortrydes.`)) return;
    setPending((p) => ({ ...p, [a.key]: 'Sletter…' }));
    try {
      await deleteActivity(session.idToken, a.key);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke slette aktivitet');
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[a.key];
        return next;
      });
    }
  };

  return (
    <main className="content">
      <p className="eyebrow">Administration</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Aktiviteter
      </h1>
      <p className="lede">
        Nøgleord til aktiviteter (Sankt Hans, Vejdag, Generalforsamling …) — bruges i fase 1, når
        medlemmer uploader billeder til bogens almene afsnit. Sortering: lavest tal først.
      </p>

      <section className="admin-invite">
        <h2>Opret ny aktivitet</h2>
        <form onSubmit={onCreate} noValidate>
          <div className="field">
            <label htmlFor="new-name">Navn</label>
            <input
              id="new-name"
              type="text"
              required
              maxLength={80}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="F.eks. Sankt Hans"
            />
          </div>
          <div className="field">
            <label htmlFor="new-order">Sortering</label>
            <input
              id="new-order"
              type="number"
              value={newOrder}
              onChange={(e) => setNewOrder(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Lavest tal først (valgfri)"
            />
          </div>
          <button type="submit" disabled={creating || !newName.trim()}>
            {creating ? 'Opretter…' : 'Opret'}
          </button>
        </form>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Eksisterende aktiviteter</h2>
        {error && <div className="error">{error}</div>}
        {items === null && !error && <p>Indlæser…</p>}
        {items && items.length === 0 && <p>Ingen aktiviteter endnu.</p>}
        {items && items.length > 0 && (
          <table className="user-table">
            <thead>
              <tr>
                <th>Sortering</th>
                <th>Navn</th>
                <th>Nøgle</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const p = pending[a.key];
                const isEditing = editingKey === a.key;
                return (
                  <tr key={a.key}>
                    <td style={{ width: '6rem' }}>
                      {isEditing ? (
                        <input
                          type="number"
                          value={editingOrder}
                          onChange={(e) =>
                            setEditingOrder(e.target.value === '' ? '' : Number(e.target.value))
                          }
                          style={{ width: '5rem' }}
                        />
                      ) : (
                        a.displayOrder
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingName}
                          maxLength={80}
                          autoFocus
                          onChange={(e) => setEditingName(e.target.value)}
                        />
                      ) : (
                        a.displayName
                      )}
                    </td>
                    <td><code>{a.key}</code></td>
                    <td className="user-actions">
                      {p ? (
                        <span className="subtle">{p}</span>
                      ) : isEditing ? (
                        <span style={{ display: 'inline-flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button type="button" onClick={() => saveEdit(a)}>Gem</button>
                          <button type="button" onClick={cancelEdit}>Fortryd</button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button type="button" onClick={() => startEdit(a)}>Rediger</button>
                          <button type="button" className="danger" onClick={() => onDelete(a)}>
                            Slet
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
};
