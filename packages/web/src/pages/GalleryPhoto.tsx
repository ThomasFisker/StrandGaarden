import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  deletePhoto,
  getGalleryPhoto,
  postComment,
  postRemovalRequest,
  updatePhoto,
} from '../api';
import { PersonTagInput as PersonTagInputField } from '../components/PersonTagInput';
import { useProfile } from '../profile';
import { useSession } from '../session';
import {
  formatShortId,
  HOUSES,
  type GalleryDetail,
  type PersonTagInput,
} from '../types';

const COMMENT_MAX = 2000;
const REMOVAL_REASON_MAX = 1000;
const DESCRIPTION_MAX = 2000;
const WHO_IN_PHOTO_MAX = 1000;

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
  const [removalOpen, setRemovalOpen] = useState(false);
  const [removalReason, setRemovalReason] = useState('');
  const [removalSubmitting, setRemovalSubmitting] = useState(false);
  const [removalSent, setRemovalSent] = useState(false);
  const [removalError, setRemovalError] = useState<string | null>(null);

  const { profile } = useProfile();
  const isAdmin = session?.claims.groups.includes('admin') ?? false;
  const frozen = profile?.stage === 2 && !isAdmin;
  const [editOpen, setEditOpen] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [editWho, setEditWho] = useState('');
  const [editYear, setEditYear] = useState<string>('');
  const [editYearApprox, setEditYearApprox] = useState(false);
  const [editHouses, setEditHouses] = useState<number[]>([]);
  const [editPersons, setEditPersons] = useState<PersonTagInput[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openEdit = () => {
    if (!photo) return;
    setEditDesc(photo.description);
    setEditWho(photo.whoInPhoto);
    setEditYear(photo.year === null ? '' : String(photo.year));
    setEditYearApprox(photo.yearApprox);
    setEditHouses(photo.houseNumbers.slice());
    setEditPersons(photo.persons.map((p) => ({ slug: p.slug })));
    setEditError(null);
    setEditOpen(true);
  };

  const toggleEditHouse = (h: number) => {
    setEditHouses((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h].sort((a, b) => a - b)));
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !photo) return;
    const desc = editDesc.trim();
    if (!desc) {
      setEditError('Beskrivelse må ikke være tom.');
      return;
    }
    if (editHouses.length === 0) {
      setEditError('Vælg mindst ét hus.');
      return;
    }
    const yearNum = editYear.trim() ? Number(editYear) : null;
    setEditSaving(true);
    setEditError(null);
    try {
      await updatePhoto(session.idToken, photo.photoId, {
        description: desc,
        whoInPhoto: editWho.trim(),
        year: yearNum,
        yearApprox: editYearApprox,
        houseNumbers: editHouses,
        taggedPersons: editPersons,
      });
      // Refetch so the rendered meta column reflects server-resolved persons.
      const fresh = await getGalleryPhoto(session.idToken, photo.photoId);
      setPhoto(fresh);
      setEditOpen(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Kunne ikke gemme ændringerne');
    } finally {
      setEditSaving(false);
    }
  };

  const submitDelete = async () => {
    if (!session || !photo) return;
    setDeleting(true);
    try {
      await deletePhoto(session.idToken, photo.photoId);
      navigate('/galleri', { replace: true });
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Kunne ikke slette billedet');
      setDeleting(false);
    }
  };

  const submitRemoval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !photo) return;
    const reason = removalReason.trim();
    if (!reason) {
      setRemovalError('Skriv en kort begrundelse.');
      return;
    }
    setRemovalSubmitting(true);
    setRemovalError(null);
    try {
      await postRemovalRequest(session.idToken, photo.photoId, reason);
      setRemovalReason('');
      setRemovalSent(true);
    } catch (err) {
      setRemovalError(err instanceof Error ? err.message : 'Kunne ikke sende anmodningen');
    } finally {
      setRemovalSubmitting(false);
    }
  };

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
            <p className="eyebrow">
              Strandgaardens arkiv <span className="short-id">· {formatShortId(photo.shortId)}</span>
              {isAdmin && !editOpen && (
                <button
                  type="button"
                  className="edit-pencil"
                  onClick={openEdit}
                  title="Rediger billedets oplysninger"
                  aria-label="Rediger billede"
                >
                  ✎ Rediger
                </button>
              )}
            </p>
            <p className="photo-year">
              {photo.yearApprox && photo.year && <em>ca.</em>}
              {photo.year ?? '—'}
            </p>
            <p className="photo-meta-line">
              {photo.houseNumbers.length > 0 ? `Hus ${photo.houseNumbers.join(' · ')}` : 'Hus ukendt'}
              {photo.width && photo.height ? ` — ${photo.width}×${photo.height}px` : ''}
            </p>

            {editOpen ? (
              <form className="photo-edit-form" onSubmit={submitEdit}>
                <div className="field">
                  <label htmlFor="edit-desc">Beskrivelse</label>
                  <textarea
                    id="edit-desc"
                    rows={4}
                    maxLength={DESCRIPTION_MAX}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    disabled={editSaving}
                  />
                  <div className="help">{editDesc.length}/{DESCRIPTION_MAX} tegn</div>
                </div>
                <div className="field">
                  <label htmlFor="edit-who">Hvem er på billedet (fritekst)</label>
                  <textarea
                    id="edit-who"
                    rows={2}
                    maxLength={WHO_IN_PHOTO_MAX}
                    value={editWho}
                    onChange={(e) => setEditWho(e.target.value)}
                    disabled={editSaving}
                  />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="edit-year">År</label>
                    <input
                      id="edit-year"
                      type="number"
                      value={editYear}
                      onChange={(e) => setEditYear(e.target.value)}
                      disabled={editSaving}
                      placeholder="f.eks. 1972"
                    />
                  </div>
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={editYearApprox}
                      onChange={(e) => setEditYearApprox(e.target.checked)}
                      disabled={editSaving}
                    />
                    <span>ca.</span>
                  </label>
                </div>
                <div className="field">
                  <label>Hus</label>
                  <div className="house-chips">
                    {HOUSES.map((h) => (
                      <label
                        key={h}
                        className={`house-chip${editHouses.includes(h) ? ' selected' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={editHouses.includes(h)}
                          onChange={() => toggleEditHouse(h)}
                          disabled={editSaving}
                        />
                        <span>{h}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>Personer på billedet</label>
                  <PersonTagInputField value={editPersons} onChange={setEditPersons} disabled={editSaving} />
                </div>
                {editError && <div className="error">{editError}</div>}
                <div className="photo-edit-actions">
                  <button type="submit" className="btn-primary" disabled={editSaving}>
                    {editSaving ? 'Gemmer…' : 'Gem ændringer'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditOpen(false); setEditError(null); }}
                    disabled={editSaving}
                  >
                    Fortryd
                  </button>
                  {!confirmDelete ? (
                    <button
                      type="button"
                      className="link-danger"
                      onClick={() => setConfirmDelete(true)}
                      disabled={editSaving || deleting}
                    >
                      Slet billede
                    </button>
                  ) : (
                    <span className="delete-confirm-inline">
                      <strong>Sikker?</strong>
                      <button
                        type="button"
                        className="danger"
                        onClick={submitDelete}
                        disabled={deleting}
                      >
                        {deleting ? 'Sletter…' : 'Ja, slet permanent'}
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                        Nej
                      </button>
                    </span>
                  )}
                </div>
              </form>
            ) : (
              <>
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
              </>
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
              {!frozen && !removalOpen && !removalSent && (
                <button
                  type="button"
                  className="link-muted"
                  onClick={() => setRemovalOpen(true)}
                >
                  Anmod om fjernelse
                </button>
              )}
            </div>

            {removalSent && (
              <div className="removal-thanks">
                <p>
                  <strong>Tak.</strong> Anmodningen er sendt til udvalget. Du får besked når der er truffet
                  en beslutning.
                </p>
              </div>
            )}

            {!frozen && removalOpen && !removalSent && (
              <form className="removal-form" onSubmit={submitRemoval}>
                <p className="removal-intro">
                  <strong>Anmod udvalget om at fjerne billedet.</strong> Skriv en kort begrundelse (f.eks.
                  at en person på billedet har bedt om det). Udvalget ser anmodningen igennem.
                  Hvis godkendt, slettes billedet permanent.
                </p>
                <div className="field">
                  <label htmlFor="removal-reason" className="sr-only">Begrundelse</label>
                  <textarea
                    id="removal-reason"
                    rows={4}
                    maxLength={REMOVAL_REASON_MAX}
                    value={removalReason}
                    onChange={(e) => setRemovalReason(e.target.value)}
                    placeholder="Kort begrundelse til udvalget."
                    disabled={removalSubmitting}
                  />
                  <div className="help">{removalReason.length}/{REMOVAL_REASON_MAX} tegn</div>
                </div>
                {removalError && <div className="error">{removalError}</div>}
                <div className="removal-actions">
                  <button type="submit" className="danger" disabled={removalSubmitting}>
                    {removalSubmitting ? 'Sender…' : 'Send anmodning'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRemovalOpen(false);
                      setRemovalReason('');
                      setRemovalError(null);
                    }}
                    disabled={removalSubmitting}
                  >
                    Fortryd
                  </button>
                </div>
              </form>
            )}
          </aside>
        </div>
      )}

      {photo && !frozen && (
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
