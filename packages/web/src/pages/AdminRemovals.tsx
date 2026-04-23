import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { decideRemoval, listPendingRemovals } from '../api';
import { useSession } from '../session';
import { formatShortId, type AdminRemovalRow } from '../types';

type RowMode = 'idle' | 'approving' | 'rejecting' | 'saving';

interface RowState {
  mode: RowMode;
  note: string;
  error: string | null;
}

const prettyDate = (iso: string): string => {
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

const displayRequestor = (row: AdminRemovalRow): string =>
  row.requestorLoginName || row.requestorEmail || 'ukendt';

export const AdminRemovalsPage = () => {
  const { session } = useSession();
  const [rows, setRows] = useState<AdminRemovalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, RowState>>({});

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const items = await listPendingRemovals(session.idToken);
      setRows(items);
      setStates((prev) => {
        const next: Record<string, RowState> = {};
        for (const r of items) next[r.removalId] = prev[r.removalId] ?? { mode: 'idle', note: '', error: null };
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente anmodninger');
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (id: string, p: Partial<RowState>) => {
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
  };

  const approve = async (row: AdminRemovalRow) => {
    if (!session) return;
    const s = states[row.removalId];
    patch(row.removalId, { mode: 'saving', error: null });
    try {
      await decideRemoval(session.idToken, row.photoId, row.removalId, {
        approved: true,
        note: s?.note.trim() || undefined,
      });
      setRows((prev) => (prev ? prev.filter((x) => x.removalId !== row.removalId) : prev));
    } catch (e) {
      patch(row.removalId, {
        mode: 'approving',
        error: e instanceof Error ? e.message : 'Sletning mislykkedes',
      });
    }
  };

  const reject = async (row: AdminRemovalRow) => {
    if (!session) return;
    const s = states[row.removalId];
    patch(row.removalId, { mode: 'saving', error: null });
    try {
      await decideRemoval(session.idToken, row.photoId, row.removalId, {
        approved: false,
        note: s?.note.trim() || undefined,
      });
      setRows((prev) => (prev ? prev.filter((x) => x.removalId !== row.removalId) : prev));
    } catch (e) {
      patch(row.removalId, {
        mode: 'rejecting',
        error: e instanceof Error ? e.message : 'Afvisning mislykkedes',
      });
    }
  };

  return (
    <main className="content wide">
      <p className="eyebrow">Udvalgets gennemgang</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Anmodninger om <em>fjernelse</em>
      </h1>
      <p className="lede">
        Anmodninger om at fjerne billeder fra arkivet. <strong>Godkendelse sletter billedet permanent</strong>
        {' '}— original, web-kopi, miniature og alle historik-spor. En top-niveau audit-linje bevarer dog
        grunden til sletningen.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <button type="button" className="btn-ghost" onClick={load}>Hent igen</button>
      </div>

      {error && <div className="error">{error}</div>}
      {rows === null && !error && <p>Indlæser…</p>}
      {rows && rows.length === 0 && <p>Ingen åbne anmodninger.</p>}

      {rows && rows.length > 0 && (
        <div className="comment-queue">
          {rows.map((row) => {
            const s = states[row.removalId];
            if (!s) return null;
            return (
              <article key={row.removalId} className="comment-row">
                <div className="comment-row-head">
                  {row.thumbnailUrl ? (
                    <Link to={`/galleri/${row.photoId}`} target="_blank" rel="noreferrer">
                      <img src={row.thumbnailUrl} alt="" className="thumb" loading="lazy" />
                    </Link>
                  ) : (
                    <div className="thumb thumb-placeholder">Intet billede</div>
                  )}
                  <div className="comment-row-context">
                    <p className="photo-meta-line">
                      <span className="short-id">{formatShortId(row.photoShortId)}</span>
                      {row.photoExists ? (
                        <>
                          {' · '}
                          {row.photoYear ? `${row.photoYearApprox ? 'ca. ' : ''}${row.photoYear} · ` : ''}
                          {row.photoHouseNumbers.length > 0
                            ? `Hus ${row.photoHouseNumbers.join(' · ')}`
                            : 'Uden hus'}
                        </>
                      ) : (
                        <em> — billedet findes ikke længere</em>
                      )}
                    </p>
                    {row.photoExists && (
                      <p className="photo-desc" style={{ marginTop: '0.25rem' }}>
                        {row.photoDescription || <em>(ingen beskrivelse)</em>}
                      </p>
                    )}
                  </div>
                </div>

                <blockquote className="comment-body">
                  {row.reason}
                  <footer className="attribution">
                    — anmodet af {displayRequestor(row)} ({row.requestorRole}), {prettyDate(row.createdAt)}
                  </footer>
                </blockquote>

                {s.mode === 'idle' && (
                  <div className="comment-actions">
                    <button type="button" className="danger" onClick={() => patch(row.removalId, { mode: 'approving', error: null })}>
                      Godkend — slet for altid
                    </button>
                    <button type="button" onClick={() => patch(row.removalId, { mode: 'rejecting', error: null })}>
                      Afvis anmodning
                    </button>
                    {s.error && <div className="error" style={{ flex: '1 0 100%' }}>{s.error}</div>}
                  </div>
                )}

                {(s.mode === 'approving' || s.mode === 'rejecting') && (
                  <div className="removal-decide">
                    {s.mode === 'approving' ? (
                      <p>
                        <strong>Godkend og slet billedet?</strong> Original, web-kopi og miniature fjernes
                        permanent. En audit-linje bevarer grunden.
                      </p>
                    ) : (
                      <p><strong>Afvis anmodningen?</strong> Billedet bevares; afvisningen gemmes med din note.</p>
                    )}
                    <div className="field">
                      <label htmlFor={`note-${row.removalId}`}>Note (valgfrit)</label>
                      <textarea
                        id={`note-${row.removalId}`}
                        rows={2}
                        maxLength={1000}
                        value={s.note}
                        onChange={(e) => patch(row.removalId, { note: e.target.value })}
                        placeholder="Kort begrundelse til audit-logs."
                      />
                    </div>
                    {s.error && <div className="error">{s.error}</div>}
                    <div className="comment-actions">
                      {s.mode === 'approving' ? (
                        <button type="button" className="danger" onClick={() => approve(row)}>
                          Ja, slet for altid
                        </button>
                      ) : (
                        <button type="button" className="primary" onClick={() => reject(row)}>
                          Ja, afvis
                        </button>
                      )}
                      <button type="button" onClick={() => patch(row.removalId, { mode: 'idle', error: null })}>
                        Fortryd
                      </button>
                    </div>
                  </div>
                )}

                {s.mode === 'saving' && <p className="subtle">Gemmer…</p>}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
};
