import { useCallback, useEffect, useState } from 'react';
import { decidePhoto, getReviewQueue } from '../api';
import { useSession } from '../session';
import type { ReviewPhoto } from '../types';

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

const initialDraft = (p: ReviewPhoto): DraftFlags => ({
  web: p.visibilityWeb,
  book: p.visibilityBook,
  saving: false,
  saved: false,
  error: null,
});

export const ReviewPage = () => {
  const { session } = useSession();
  const [photos, setPhotos] = useState<ReviewPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftFlags>>({});

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const items = await getReviewQueue(session.idToken);
      setPhotos(items);
      setDrafts(Object.fromEntries(items.map((p) => [p.photoId, initialDraft(p)])));
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
                        Hus {p.houseNumbers.join(', ')}
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
                      Sendt af {p.uploaderEmail ?? 'ukendt'} · fil {p.originalFilename} · {prettyDate(p.processedAt ?? p.createdAt)}
                      {p.width && p.height ? <> · {p.width}×{p.height}px</> : null}
                    </p>

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

                      <div className="review-actions">
                        <button className="primary" disabled={d.saving} onClick={() => save(p)}>
                          {d.saving ? 'Gemmer…' : d.saved ? 'Opdatér beslutning' : 'Gem beslutning'}
                        </button>
                        {d.saved && <span className="ok-inline">Gemt</span>}
                      </div>

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
