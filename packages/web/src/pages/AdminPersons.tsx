import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createPerson, deletePerson, listPersons, updatePerson } from '../api';
import { useSession } from '../session';
import type { AdminPerson } from '../types';

const prettyDate = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('da-DK', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

export const AdminPersonsPage = () => {
  const { session } = useSession();
  const [persons, setPersons] = useState<AdminPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingByPerson, setPendingByPerson] = useState<Record<string, string>>({});

  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editing, setEditing] = useState<{ slug: string; value: string } | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const r = await listPersons(session.idToken);
      setPersons(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente personer');
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const markPending = (slug: string, msg: string) =>
    setPendingByPerson((prev) => ({ ...prev, [slug]: msg }));
  const clearPending = (slug: string) =>
    setPendingByPerson((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setCreateError(null);
    setCreating(true);
    try {
      await createPerson(session.idToken, newName.trim());
      setNewName('');
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Oprettelse mislykkedes');
    } finally {
      setCreating(false);
    }
  };

  const onApprove = async (p: AdminPerson) => {
    if (!session) return;
    markPending(p.slug, 'Godkender…');
    try {
      await updatePerson(session.idToken, p.slug, { state: 'approved' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Godkendelse mislykkedes');
    } finally {
      clearPending(p.slug);
    }
  };

  const onReject = async (p: AdminPerson) => {
    if (!session) return;
    if (!confirm(`Afvis forslaget "${p.displayName}"? Navnet fjernes også fra alle billeder der bruger det.`)) return;
    markPending(p.slug, 'Afviser…');
    try {
      await deletePerson(session.idToken, p.slug);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Afvisning mislykkedes');
    } finally {
      clearPending(p.slug);
    }
  };

  const onDelete = async (p: AdminPerson) => {
    if (!session) return;
    if (
      !confirm(
        `Slet "${p.displayName}" fra navnelisten? Navnet fjernes også fra alle billeder der er tagget med det.`,
      )
    )
      return;
    markPending(p.slug, 'Sletter…');
    try {
      await deletePerson(session.idToken, p.slug);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sletning mislykkedes');
    } finally {
      clearPending(p.slug);
    }
  };

  const onSaveRename = async (p: AdminPerson) => {
    if (!session || !editing || editing.slug !== p.slug) return;
    const target = editing.value.trim();
    if (!target || target === p.displayName) {
      setEditing(null);
      return;
    }
    markPending(p.slug, 'Gemmer…');
    try {
      await updatePerson(session.idToken, p.slug, { displayName: target });
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Omdøbning mislykkedes');
    } finally {
      clearPending(p.slug);
    }
  };

  const pending = (persons ?? []).filter((p) => p.state === 'pending');
  const approved = (persons ?? []).filter((p) => p.state === 'approved');

  return (
    <main className="content wide">
      <p className="eyebrow">Administration</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>Personer</h1>
      <p className="lede">
        Den godkendte navneliste bruges af uploadformen og galleriets person-filter. Medlemmer kan foreslå nye
        navne, som udvalget godkender eller afviser her.
      </p>

      <section className="admin-invite">
        <h2>Tilføj godkendt navn</h2>
        <form onSubmit={onCreate} noValidate>
          <div className="field">
            <label htmlFor="new-person">Fulde navn</label>
            <input
              id="new-person"
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="f.eks. Hans Jensen"
            />
          </div>
          {createError && <div className="error">{createError}</div>}
          <button type="submit" disabled={creating || !newName.trim()}>
            {creating ? 'Opretter…' : 'Tilføj navn'}
          </button>
        </form>
      </section>

      {error && <div className="error">{error}</div>}
      {persons === null && !error && <p>Indlæser…</p>}

      {persons && (
        <>
          <section style={{ marginTop: '1.5rem' }}>
            <h2>Foreslåede navne ({pending.length})</h2>
            {pending.length === 0 ? (
              <p className="subtle">Ingen forslag afventer godkendelse.</p>
            ) : (
              <table className="user-table">
                <thead>
                  <tr>
                    <th>Navn</th>
                    <th>Foreslået af</th>
                    <th>Dato</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p) => (
                    <tr key={p.slug}>
                      <td>{p.displayName}</td>
                      <td>{p.proposedByEmail ?? p.proposedBy ?? '—'}</td>
                      <td>{prettyDate(p.proposedAt)}</td>
                      <td className="user-actions">
                        {pendingByPerson[p.slug] ? (
                          <span className="subtle">{pendingByPerson[p.slug]}</span>
                        ) : (
                          <>
                            <button className="primary" onClick={() => onApprove(p)} style={{ marginRight: '0.5rem' }}>
                              Godkend
                            </button>
                            <button className="danger" onClick={() => onReject(p)}>
                              Afvis
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section style={{ marginTop: '2rem' }}>
            <h2>Godkendte navne ({approved.length})</h2>
            {approved.length === 0 ? (
              <p className="subtle">Ingen godkendte navne endnu.</p>
            ) : (
              <table className="user-table">
                <thead>
                  <tr>
                    <th>Navn</th>
                    <th>Godkendt</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {approved.map((p) => (
                    <tr key={p.slug}>
                      <td>
                        {editing && editing.slug === p.slug ? (
                          <input
                            value={editing.value}
                            autoFocus
                            onChange={(e) => setEditing({ slug: p.slug, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') onSaveRename(p);
                              if (e.key === 'Escape') setEditing(null);
                            }}
                          />
                        ) : (
                          p.displayName
                        )}
                      </td>
                      <td>{prettyDate(p.approvedAt)}</td>
                      <td className="user-actions">
                        {pendingByPerson[p.slug] ? (
                          <span className="subtle">{pendingByPerson[p.slug]}</span>
                        ) : editing && editing.slug === p.slug ? (
                          <>
                            <button className="primary" onClick={() => onSaveRename(p)} style={{ marginRight: '0.5rem' }}>
                              Gem
                            </button>
                            <button onClick={() => setEditing(null)}>Annullér</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => setEditing({ slug: p.slug, value: p.displayName })} style={{ marginRight: '0.5rem' }}>
                              Omdøb
                            </button>
                            <button className="danger" onClick={() => onDelete(p)}>
                              Slet
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </main>
  );
};
