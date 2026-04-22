import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PersonTagInput } from '../components/PersonTagInput';
import { listPendingComments, listPersons, mergeComment, rejectComment } from '../api';
import { useSession } from '../session';
import type { AdminCommentRow, AdminPerson, PersonTagInput as PersonTagValue } from '../types';

type RowMode = 'idle' | 'editing' | 'shown' | 'rejecting' | 'saving' | 'done';

interface RowState {
  mode: RowMode;
  description: string;
  tags: PersonTagValue[];
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

const displayAuthor = (row: AdminCommentRow): string =>
  row.authorLoginName || row.authorEmail || 'ukendt';

export const AdminCommentsPage = () => {
  const { session } = useSession();
  const [rows, setRows] = useState<AdminCommentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personCatalog, setPersonCatalog] = useState<AdminPerson[]>([]);
  const [states, setStates] = useState<Record<string, RowState>>({});

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const [items, personList] = await Promise.all([
        listPendingComments(session.idToken),
        listPersons(session.idToken),
      ]);
      setRows(items);
      setPersonCatalog(personList.items);
      setStates((prev) => {
        const next: Record<string, RowState> = {};
        for (const r of items) {
          next[r.commentId] = prev[r.commentId] ?? {
            mode: 'idle',
            description: r.photoDescription,
            tags: r.photoPersonSlugs.map((slug) => ({ slug })),
            error: null,
          };
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente kommentarer');
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const catalogBySlug = useMemo(() => {
    const m = new Map<string, AdminPerson>();
    for (const p of personCatalog) m.set(p.slug, p);
    return m;
  }, [personCatalog]);

  const patchState = (commentId: string, patch: Partial<RowState>) => {
    setStates((prev) => ({ ...prev, [commentId]: { ...prev[commentId], ...patch } }));
  };

  const startMerge = (row: AdminCommentRow) => {
    patchState(row.commentId, {
      mode: 'editing',
      description: states[row.commentId]?.description ?? row.photoDescription,
      tags:
        states[row.commentId]?.tags ??
        row.photoPersonSlugs.map((slug) => ({ slug })),
      error: null,
    });
  };

  const cancelMerge = (row: AdminCommentRow) => {
    patchState(row.commentId, {
      mode: 'idle',
      description: row.photoDescription,
      tags: row.photoPersonSlugs.map((slug) => ({ slug })),
      error: null,
    });
  };

  const saveMerge = async (row: AdminCommentRow, keepAsAddendum: boolean) => {
    if (!session) return;
    const s = states[row.commentId];
    if (!s) return;
    patchState(row.commentId, { mode: 'saving', error: null });
    try {
      await mergeComment(session.idToken, row.photoId, row.commentId, {
        description: s.description.trim(),
        taggedPersons: s.tags,
        keepAsAddendum,
      });
      setRows((prev) => (prev ? prev.filter((x) => x.commentId !== row.commentId) : prev));
    } catch (e) {
      patchState(row.commentId, {
        mode: 'editing',
        error: e instanceof Error ? e.message : 'Handlingen mislykkedes',
      });
    }
  };

  const showAsAddendum = async (row: AdminCommentRow) => {
    if (!session) return;
    patchState(row.commentId, { mode: 'saving', error: null });
    try {
      await mergeComment(session.idToken, row.photoId, row.commentId, {
        description: row.photoDescription,
        taggedPersons: row.photoPersonSlugs.map((slug) => ({ slug })),
        keepAsAddendum: true,
      });
      setRows((prev) => (prev ? prev.filter((x) => x.commentId !== row.commentId) : prev));
    } catch (e) {
      patchState(row.commentId, {
        mode: 'idle',
        error: e instanceof Error ? e.message : 'Handlingen mislykkedes',
      });
    }
  };

  const confirmReject = async (row: AdminCommentRow) => {
    if (!session) return;
    patchState(row.commentId, { mode: 'saving', error: null });
    try {
      await rejectComment(session.idToken, row.photoId, row.commentId);
      setRows((prev) => (prev ? prev.filter((x) => x.commentId !== row.commentId) : prev));
    } catch (e) {
      patchState(row.commentId, {
        mode: 'rejecting',
        error: e instanceof Error ? e.message : 'Handlingen mislykkedes',
      });
    }
  };

  return (
    <main className="content wide">
      <p className="eyebrow">Udvalgets gennemgang</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Indkomne <em>kommentarer</em>
      </h1>
      <p className="lede">
        Kommentarer fra medlemmer og kiggere — fletter ind i beskrivelsen, vises som tilføjelse, eller afvises.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <button type="button" className="btn-ghost" onClick={load}>Hent igen</button>
      </div>

      {error && <div className="error">{error}</div>}
      {rows === null && !error && <p>Indlæser…</p>}
      {rows && rows.length === 0 && <p>Ingen kommentarer venter på behandling.</p>}

      {rows && rows.length > 0 && (
        <div className="comment-queue">
          {rows.map((row) => {
            const s = states[row.commentId];
            if (!s) return null;
            const existingNames = row.photoPersonSlugs.map((slug) => catalogBySlug.get(slug)?.displayName ?? slug);
            return (
              <article key={row.commentId} className="comment-row">
                <div className="comment-row-head">
                  {row.thumbnailUrl ? (
                    <Link to={`/galleri/${row.photoId}`} target="_blank" rel="noreferrer">
                      <img src={row.thumbnailUrl} alt="" className="thumb" loading="lazy" />
                    </Link>
                  ) : (
                    <div className="thumb thumb-placeholder">Ingen miniature</div>
                  )}
                  <div className="comment-row-context">
                    <p className="photo-meta-line">
                      {row.photoYear ? `${row.photoYearApprox ? 'ca. ' : ''}${row.photoYear} · ` : ''}
                      {row.photoHouseNumbers.length > 0 ? `Hus ${row.photoHouseNumbers.join(' · ')}` : 'Uden hus'}
                    </p>
                    <p className="photo-desc" style={{ marginTop: '0.25rem' }}>
                      {row.photoDescription || <em>(ingen beskrivelse)</em>}
                    </p>
                    {existingNames.length > 0 && (
                      <p className="meta" style={{ marginTop: '0.25rem' }}>
                        Personer: {existingNames.join(', ')}
                      </p>
                    )}
                  </div>
                </div>

                <blockquote className="comment-body">
                  {row.body}
                  <footer className="attribution">
                    — {displayAuthor(row)} ({row.authorRole}), {prettyDate(row.createdAt)}
                  </footer>
                </blockquote>

                {s.mode === 'idle' && (
                  <div className="comment-actions">
                    <button type="button" className="primary" onClick={() => startMerge(row)}>
                      Flet ind i beskrivelsen
                    </button>
                    <button type="button" onClick={() => showAsAddendum(row)}>
                      Vis som tilføjelse
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => patchState(row.commentId, { mode: 'rejecting', error: null })}
                    >
                      Afvis
                    </button>
                    {s.error && <div className="error" style={{ flex: '1 0 100%' }}>{s.error}</div>}
                  </div>
                )}

                {s.mode === 'editing' && (
                  <div className="comment-editor">
                    <div className="field">
                      <label htmlFor={`desc-${row.commentId}`}>Beskrivelse</label>
                      <textarea
                        id={`desc-${row.commentId}`}
                        rows={5}
                        maxLength={2000}
                        value={s.description}
                        onChange={(e) => patchState(row.commentId, { description: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>Personer på billedet</label>
                      <PersonTagInput
                        value={s.tags}
                        onChange={(next) => patchState(row.commentId, { tags: next })}
                      />
                    </div>
                    {s.error && <div className="error">{s.error}</div>}
                    <div className="comment-actions">
                      <button type="button" className="primary" onClick={() => saveMerge(row, false)}>
                        Gem — flet ind i beskrivelse
                      </button>
                      <button type="button" onClick={() => saveMerge(row, true)}>
                        Gem — vis som tilføjelse
                      </button>
                      <button type="button" onClick={() => cancelMerge(row)}>
                        Fortryd
                      </button>
                    </div>
                  </div>
                )}

                {s.mode === 'rejecting' && (
                  <div className="comment-reject-confirm">
                    <p>
                      <strong>Afvis kommentaren?</strong> Den slettes og vises ikke på billedet.
                    </p>
                    <div className="comment-actions">
                      <button type="button" className="danger" onClick={() => confirmReject(row)}>
                        Ja, afvis
                      </button>
                      <button
                        type="button"
                        onClick={() => patchState(row.commentId, { mode: 'idle', error: null })}
                      >
                        Fortryd
                      </button>
                    </div>
                    {s.error && <div className="error">{s.error}</div>}
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
