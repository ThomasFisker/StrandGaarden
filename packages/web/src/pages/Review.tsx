import { useCallback, useEffect, useState } from 'react';
import { decidePhoto, deletePhoto, getReviewQueue, setHelpWanted } from '../api';
import { useSession } from '../session';
import { formatShortId, type ReviewPhoto } from '../types';

const prettyDate = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('da-DK', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

interface DraftFlags {
  web: boolean;
  book: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

interface DeleteState {
  confirming: boolean;
  deleting: boolean;
  error: string | null;
}

const initialDraft = (p: ReviewPhoto): DraftFlags => ({
  web: p.visibilityWeb,
  book: p.visibilityBook,
  saving: false,
  saved: false,
  error: null,
});

const initialDelete = (): DeleteState => ({ confirming: false, deleting: false, error: null });

export const ReviewPage = () => {
  const { session } = useSession();
  const [photos, setPhotos] = useState<ReviewPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftFlags>>({});
  const [deletes, setDeletes] = useState<Record<string, DeleteState>>({});
  const [savingHelp, setSavingHelp] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const items = await getReviewQueue(session.idToken);
      setPhotos(items);
      setDrafts(Object.fromEntries(items.map((p) => [p.photoId, initialDraft(p)])));
      setDeletes(Object.fromEntries(items.map((p) => [p.photoId, initialDelete()])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente køen');
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const setFlag = (photoId: string, key: 'web' | 'book', value: boolean) => {
    setDrafts((prev) => ({
      ...prev,
      [photoId]: { ...prev[photoId], [key]: value, saved: false, error: null },
    }));
  };

  const save = async (photo: ReviewPhoto) => {
    if (!session) return;
    const draft = drafts[photo.photoId];
    if (!draft) return;
    setDrafts((prev) => ({ ...prev, [photo.photoId]: { ...prev[photo.photoId], saving: true, error: null } }));
    try {
      await decidePhoto(session.idToken, photo.photoId, {
        visibilityWeb: draft.web,
        visibilityBook: draft.book,
      });
      setDrafts((prev) => ({
        ...prev,
        [photo.photoId]: { ...prev[photo.photoId], saving: false, saved: true, error: null },
      }));
    } catch (e) {
      setDrafts((prev) => ({
        ...prev,
        [photo.photoId]: {
          ...prev[photo.photoId],
          saving: false,
          error: e instanceof Error ? e.message : 'Fejl ved lagring',
        },
      }));
    }
  };

  const toggleHelpWanted = async (photo: ReviewPhoto) => {
    if (!session) return;
    const next = !photo.helpWanted;
    setPhotos((prev) => prev?.map((p) => (p.photoId === photo.photoId ? { ...p, helpWanted: next } : p)) ?? prev);
    setSavingHelp((prev) => ({ ...prev, [photo.photoId]: true }));
    try {
      await setHelpWanted(session.idToken, photo.photoId, next);
    } catch (e) {
      setPhotos((prev) => prev?.map((p) => (p.photoId === photo.photoId ? { ...p, helpWanted: !next } : p)) ?? prev);
      setError(e instanceof Error ? e.message : 'Kunne ikke opdatere flag');
    } finally {
      setSavingHelp((prev) => {
        const copy = { ...prev };
        delete copy[photo.photoId];
        return copy;
      });
    }
  };

  const askDelete = (photoId: string) => {
    setDeletes((prev) => ({ ...prev, [photoId]: { confirming: true, deleting: false, error: null } }));
  };
  const cancelDelete = (photoId: string) => {
    setDeletes((prev) => ({ ...prev, [photoId]: { confirming: false, deleting: false, error: null } }));
  };
  const confirmDelete = async (photoId: string) => {
    if (!session) return;
    setDeletes((prev) => ({ ...prev, [photoId]: { confirming: true, deleting: true, error: null } }));
    try {
      await deletePhoto(session.idToken, photoId);
      setPhotos((prev) => (prev ? prev.filter((p) => p.photoId !== photoId) : prev));
      setDeletes((prev) => {
        const next = { ...prev };
        delete next[photoId];
        return next;
      });
    } catch (e) {
      setDeletes((prev) => ({
        ...prev,
        [photoId]: {
          confirming: true,
          deleting: false,
          error: e instanceof Error ? e.message : 'Sletning mislykkedes',
        },
      }));
    }
  };

  return (
    <main className="content">
      <p className="eyebrow">Udvalgets gennemgang</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>Bedøm <em>bidrag</em></h1>
      <p className="lede">
        Billeder der afventer udvalgets beslutning. Marker hvilke der må vises på siden og hvilke der kommer i bogen,
        og klik <em>Gem beslutning</em>.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <button type="button" className="btn-ghost" onClick={load}>Hent igen</button>
      </div>

      {error && <div className="error">{error}</div>}
      {photos === null && !error && <p>Indlæser…</p>}
      {photos && photos.length === 0 && <p>Ingen billeder afventer gennemgang.</p>}

      {photos && photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((p) => {
            const d = drafts[p.photoId];
            const del = deletes[p.photoId] ?? initialDelete();
            if (!d) return null;
            return (
              <article key={p.photoId} className="photo-card">
                <div className="photo-card-row">
                  <div className="thumb-wrap review-thumb-wrap">
                    {p.thumbnailUrl ? (
                      <a href={p.webUrl ?? undefined} target="_blank" rel="noreferrer" title="Se i fuld størrelse">
                        <img src={p.thumbnailUrl} alt={p.description || p.originalFilename} className="thumb review-thumb" loading="lazy" />
                      </a>
                    ) : (
                      <div className="thumb thumb-placeholder">Ingen miniature</div>
                    )}
                  </div>
                  <div className="photo-card-body">
                    <h3>{p.description || <em>(ingen beskrivelse)</em>}</h3>
                    <div>
                      <span className="meta">
                        {p.year ? `${p.yearApprox ? 'ca. ' : ''}${p.year} · ` : ''}
                        {p.houseNumbers.length > 0
                          ? `Hus ${p.houseNumbers.join(', ')}`
                          : p.activityName
                            ? `Aktivitet: ${p.activityName}`
                            : 'Hus ukendt'}
                      </span>
                    </div>
                    {p.whoInPhoto && <p className="meta">{p.whoInPhoto}</p>}
                    {p.persons.length > 0 && (
                      <div className="person-chips">
                        {p.persons.map((person) => (
                          <span
                            key={person.slug}
                            className={`person-chip${person.state === 'pending' ? ' pending' : ''}`}
                            title={
                              person.state === 'pending'
                                ? 'Afventer godkendelse — tryk på "Brugere" for at godkende'
                                : undefined
                            }
                          >
                            {person.displayName}
                            {person.state === 'pending' && ' (afventer)'}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="meta">
                      <span className="short-id">{formatShortId(p.shortId)}</span> · Sendt af {p.uploaderEmail ?? 'ukendt'} · fil {p.originalFilename} · {prettyDate(p.processedAt ?? p.createdAt)}
                      {p.width && p.height ? <> · {p.width}×{p.height}px</> : null}
                    </p>
                    {p.qualityWarning === 'low-resolution-for-book' && (
                      <p
                        className="meta"
                        style={{
                          color: 'var(--copper, #b85a2a)',
                          background: 'var(--paper-warm, #faf2e6)',
                          padding: '0.4rem 0.6rem',
                          borderLeft: '3px solid var(--copper, #b85a2a)',
                          margin: '0.4rem 0',
                        }}
                      >
                        <strong>For lille til bog</strong> — billedet er under 1500 pixel på den længste
                        side. Det kan godt vises på siden, men vil sandsynligvis ikke være skarpt nok til
                        den trykte bog.
                      </p>
                    )}

                    <div className="review-controls">
                      <div className="checkbox-row">
                        <input
                          id={`web-${p.photoId}`}
                          type="checkbox"
                          checked={d.web}
                          disabled={d.saving}
                          onChange={(e) => setFlag(p.photoId, 'web', e.target.checked)}
                        />
                        <label htmlFor={`web-${p.photoId}`}>Vis på hjemmesiden</label>
                      </div>
                      <div className="checkbox-row">
                        <input
                          id={`book-${p.photoId}`}
                          type="checkbox"
                          checked={d.book}
                          disabled={d.saving}
                          onChange={(e) => setFlag(p.photoId, 'book', e.target.checked)}
                        />
                        <label htmlFor={`book-${p.photoId}`}>Med i jubilæumsbogen</label>
                      </div>
                      <div className="checkbox-row">
                        <input
                          id={`help-${p.photoId}`}
                          type="checkbox"
                          checked={p.helpWanted}
                          disabled={!!savingHelp[p.photoId]}
                          onChange={() => toggleHelpWanted(p)}
                        />
                        <label htmlFor={`help-${p.photoId}`}>Hjælp søges — bed andre om at identificere</label>
                      </div>

                      <div className="review-actions">
                        <button className="primary" disabled={d.saving || del.deleting} onClick={() => save(p)}>
                          {d.saving ? 'Gemmer…' : d.saved ? 'Opdatér beslutning' : 'Gem beslutning'}
                        </button>
                        {d.saved && <span className="ok-inline">Gemt</span>}
                        {!del.confirming && (
                          <button
                            type="button"
                            className="danger"
                            disabled={d.saving || del.deleting}
                            onClick={() => askDelete(p.photoId)}
                            style={{ marginLeft: 'auto' }}
                          >
                            Slet billede
                          </button>
                        )}
                      </div>

                      {del.confirming && (
                        <div
                          className="delete-confirm"
                          style={{
                            marginTop: '0.75rem',
                            padding: '0.75rem 1rem',
                            background: 'var(--paper-warm)',
                            borderLeft: '3px solid var(--danger, #b23a3a)',
                          }}
                        >
                          <p style={{ margin: '0 0 0.5rem' }}>
                            <strong>Slet billedet for altid?</strong> Original, web-kopi, miniature og
                            alle historik-spor fjernes. Handlingen kan ikke fortrydes.
                          </p>
                          <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="danger"
                              disabled={del.deleting}
                              onClick={() => confirmDelete(p.photoId)}
                            >
                              {del.deleting ? 'Sletter…' : 'Ja, slet for altid'}
                            </button>
                            <button
                              type="button"
                              disabled={del.deleting}
                              onClick={() => cancelDelete(p.photoId)}
                            >
                              Fortryd
                            </button>
                          </div>
                          {del.error && (
                            <div className="error" style={{ marginTop: '0.5rem' }}>{del.error}</div>
                          )}
                        </div>
                      )}

                      {d.error && <div className="error" style={{ marginTop: '0.5rem' }}>{d.error}</div>}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
};
