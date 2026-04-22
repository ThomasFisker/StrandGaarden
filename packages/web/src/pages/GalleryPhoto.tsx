import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getGalleryPhoto, postComment } from '../api';
import { useSession } from '../session';
import type { GalleryDetail } from '../types';

const COMMENT_MAX = 2000;

const prettyMonth = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('da-DK', { month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
};

export const GalleryPhotoPage = () => {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<GalleryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentSent, setCommentSent] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !photo) return;
    const body = commentBody.trim();
    if (!body) {
      setCommentError('Skriv en kommentar først.');
      return;
    }
    setCommentSubmitting(true);
    setCommentError(null);
    try {
      await postComment(session.idToken, photo.photoId, body);
      setCommentBody('');
      setCommentSent(true);
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'Kunne ikke sende kommentaren');
    } finally {
      setCommentSubmitting(false);
    }
  };

  useEffect(() => {
    if (!session || !id) return;
    let active = true;
    setPhoto(null);
    setError(null);
    getGalleryPhoto(session.idToken, id)
      .then((p) => {
        if (active) setPhoto(p);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Kunne ikke hente billedet');
      });
    return () => {
      active = false;
    };
  }, [session, id]);

  return (
    <main className="content feature">
      <p className="crumb">
        <Link to="/galleri">Galleri</Link>
        {photo && (
          <>
            <span className="sep">/</span>
            {photo.year ? (photo.yearApprox ? `ca. ${photo.year}` : photo.year) : 'Uden år'}
            {photo.houseNumbers.length > 0 && (
              <>
                <span className="sep">/</span>
                Hus {photo.houseNumbers.join(' · ')}
              </>
            )}
          </>
        )}
      </p>

      {error && <div className="error">{error}</div>}
      {!photo && !error && <p className="subtle">Indlæser…</p>}

      {photo && (
        <div className="photo-layout">
          <figure className="photo-frame">
            {photo.helpWanted && (
              <div className="help-wanted-banner" role="note">
                <strong>Hjælp søges —</strong>
                <span> uploaderen kender ikke alle på billedet. Kender du nogen? Skriv gerne en kommentar nedenfor.</span>
              </div>
            )}
            {photo.webUrl ? (
              <img
                src={photo.webUrl}
                alt={photo.description || 'Strandgaarden billede'}
                className="gallery-full"
                width={photo.width ?? undefined}
                height={photo.height ?? undefined}
              />
            ) : (
              <div className="photo-frame-placeholder">Billedet behandles</div>
            )}
          </figure>

          <aside className="photo-meta">
            <p className="eyebrow">Strandgaardens arkiv</p>
            <p className="photo-year">
              {photo.yearApprox && photo.year && <em>ca.</em>}
              {photo.year ?? '—'}
            </p>
            <p className="photo-meta-line">
              {photo.houseNumbers.length > 0 ? `Hus ${photo.houseNumbers.join(' · ')}` : 'Hus ukendt'}
              {photo.width && photo.height ? ` — ${photo.width}×${photo.height}px` : ''}
            </p>
            {photo.description && <p className="photo-desc">{photo.description}</p>}

            {photo.whoInPhoto && (
              <div className="photo-section">
                <p className="photo-section-title">Hvem er på billedet</p>
                <p style={{ margin: 0, color: 'var(--ink-soft)' }}>{photo.whoInPhoto}</p>
              </div>
            )}

            {photo.persons.length > 0 && (
              <div className="photo-section">
                <p className="photo-section-title">Personer på billedet</p>
                <div className="person-chips">
                  {photo.persons.map((p) => (
                    <button
                      key={p.slug}
                      type="button"
                      className="person-chip"
                      onClick={() => navigate(`/galleri?person=${encodeURIComponent(p.slug)}`)}
                      title={`Vis alle billeder af ${p.displayName}`}
                    >
                      {p.displayName}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {photo.approvedComments.length > 0 && (
              <div className="photo-section">
                <p className="photo-section-title">Tilføjelser fra andre</p>
                <ul className="comment-addenda">
                  {photo.approvedComments.map((c) => (
                    <li key={c.commentId} className="comment-addendum">
                      <p>{c.body}</p>
                      <p className="attribution">
                        — {c.authorLoginName || 'ukendt'}, {prettyMonth(c.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="photo-actions">
              {photo.downloadUrl && (
                <a href={photo.downloadUrl} className="btn-primary">
                  Hent billedet <span className="arrow">↓</span>
                </a>
              )}
              <span className="link-muted" style={{ cursor: 'default' }}>
                Anmod om fjernelse — kommer snart
              </span>
            </div>
          </aside>
        </div>
      )}

      {photo && (
        <section className="comment-card">
          <p className="eyebrow">Del din viden</p>
          <h2 className="comment-heading">
            Kender du <em>nogen</em> på billedet? Har du en historie?
          </h2>
          <p className="lede comment-lede">
            Skriv en kommentar — udvalget kigger den igennem og kan tilføje den til billedet.
          </p>
          {commentSent ? (
            <div className="comment-thanks">
              <p><strong>Tak!</strong> Din kommentar er sendt til udvalget.</p>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setCommentSent(false);
                  setCommentBody('');
                }}
              >
                Skriv en kommentar til
              </button>
            </div>
          ) : (
            <form onSubmit={submitComment}>
              <div className="field">
                <label htmlFor="comment-body" className="sr-only">Kommentar</label>
                <textarea
                  id="comment-body"
                  rows={5}
                  maxLength={COMMENT_MAX}
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="F.eks. 'Manden med pibe er min farfar Hans Jensen.' eller en historie om billedet."
                  disabled={commentSubmitting}
                />
                <div className="help">{commentBody.length}/{COMMENT_MAX} tegn</div>
              </div>
              {commentError && <div className="error">{commentError}</div>}
              <button type="submit" className="btn-primary" disabled={commentSubmitting}>
                {commentSubmitting ? 'Sender…' : <>Send til udvalget <span className="arrow">→</span></>}
              </button>
            </form>
          )}
        </section>
      )}
    </main>
  );
};
