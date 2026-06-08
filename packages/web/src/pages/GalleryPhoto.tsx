import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  deletePhoto,
  getGalleryPhoto,
  listActivities,
  movePhotoSection,
  postComment,
  postRemovalRequest,
  setHelpWanted,
  updatePhoto,
} from '../api';
import { PersonTagInput as PersonTagInputField } from '../components/PersonTagInput';
import { useProfile } from '../profile';
import { useSession } from '../session';
import {
  formatShortId,
  HOUSES,
  type Activity,
  type GalleryDetail,
  type PersonTagInput,
} from '../types';

const COMMENT_MAX = 2000;
const REMOVAL_REASON_MAX = 1000;
const DESCRIPTION_MAX = 2000;

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
  const callerSub = session?.claims.sub ?? null;
  const isUploader =
    !!callerSub && photo !== null && photo.uploaderSub === callerSub;
  const canEdit = isAdmin || isUploader;
  const frozen = profile?.stage === 2 && !isAdmin;
  // "Hjælp søges" and "Anmod om fjernelse" only belong in the public
  // phase (3). In phase 1 members delete their own photos directly; in
  // phase 2 everything is frozen. Admins keep the help-wanted toggle in
  // any phase.
  const stageThree = profile?.stage === 3;
  const [editOpen, setEditOpen] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [editYear, setEditYear] = useState<string>('');
  const [editYearApprox, setEditYearApprox] = useState(false);
  const [editHouses, setEditHouses] = useState<number[]>([]);
  const [editPersons, setEditPersons] = useState<PersonTagInput[]>([]);
  const [editActivityKey, setEditActivityKey] = useState<string>('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [helpSaving, setHelpSaving] = useState(false);
  const [helpError, setHelpError] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[] | null>(null);

  // Members editing a kategori-photo (priority null) get a category
  // dropdown in the edit form. Fetch the activity list once when that
  // condition first holds so the form has options ready.
  const photoIsKategori =
    photo !== null && (photo.priority ?? null) === null;
  const memberKategoriEdit = isUploader && !isAdmin && photoIsKategori;
  useEffect(() => {
    if (!session || activities !== null || !memberKategoriEdit) return;
    let active = true;
    listActivities(session.idToken)
      .then((list) => {
        if (active) setActivities(list);
      })
      .catch(() => {
        if (active) setActivities([]);
      });
    return () => {
      active = false;
    };
  }, [session, activities, memberKategoriEdit]);

  const openEdit = () => {
    if (!photo) return;
    setEditDesc(photo.description);
    setEditYear(photo.year === null ? '' : String(photo.year));
    setEditYearApprox(photo.yearApprox);
    setEditHouses(photo.houseNumbers.slice());
    setEditPersons(photo.persons.map((p) => ({ slug: p.slug })));
    setEditActivityKey(photo.activityKey ?? '');
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
    // House chips are only editable by admins. Members keep whatever the
    // photo already had — the server ignores the field for non-admins.
    if (isAdmin && editHouses.length === 0) {
      setEditError('Vælg mindst ét hus.');
      return;
    }
    const yearNum = editYear.trim() ? Number(editYear) : null;
    // Category change for kategori-photo uploaders: if they picked a
    // different activity than the photo currently has, run the section
    // move first so the activityKey is in place before the metadata
    // patch refetches.
    const categoryChanged =
      memberKategoriEdit &&
      editActivityKey !== '' &&
      editActivityKey !== (photo.activityKey ?? '');
    setEditSaving(true);
    setEditError(null);
    try {
      if (categoryChanged) {
        await movePhotoSection(session.idToken, photo.photoId, {
          target: 'activity',
          activityKey: editActivityKey,
        });
      }
      await updatePhoto(session.idToken, photo.photoId, {
        description: desc,
        year: yearNum,
        yearApprox: editYearApprox,
        houseNumbers: isAdmin ? editHouses : photo.houseNumbers,
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

  const toggleHelpWanted = async () => {
    if (!session || !photo || helpSaving) return;
    const next = !photo.helpWanted;
    setHelpSaving(true);
    setHelpError(null);
    setPhoto({ ...photo, helpWanted: next });
    try {
      await setHelpWanted(session.idToken, photo.photoId, next);
    } catch (err) {
      // roll back on failure
      setPhoto((prev) => (prev ? { ...prev, helpWanted: !next } : prev));
      setHelpError(err instanceof Error ? err.message : 'Kunne ikke opdatere flag');
    } finally {
      setHelpSaving(false);
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
            {photo.houseNumbers.length > 0 ? (
              <>
                <span className="sep">/</span>
                Hus {photo.houseNumbers.join(' · ')}
              </>
            ) : photo.activityName ? (
              <>
                <span className="sep">/</span>
                {photo.activityName}
              </>
            ) : null}
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
              {canEdit && !editOpen && !frozen && (
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
              {photo.houseNumbers.length > 0
                ? `Hus ${photo.houseNumbers.join(' · ')}`
                : photo.activityName
                  ? `Kategori: ${photo.activityName}`
                  : 'Hus ukendt'}
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
                {isAdmin ? (
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
                ) : memberKategoriEdit ? (
                  <div className="field">
                    <label htmlFor="edit-category">Kategori</label>
                    <select
                      id="edit-category"
                      value={editActivityKey}
                      onChange={(e) => setEditActivityKey(e.target.value)}
                      disabled={editSaving || activities === null}
                    >
                      <option value="">— Vælg kategori —</option>
                      {(activities ?? []).map((a) => (
                        <option key={a.key} value={a.key}>
                          {a.displayName}
                        </option>
                      ))}
                    </select>
                    <p className="help" style={{ marginTop: '0.4rem' }}>
                      Vælg hvilken kategori billedet hører til (Sct. Hans, vejdag, …).
                      Hører billedet til dit hus i stedet, så gå til{' '}
                      <Link to="/mine">Mine Hus Billeder</Link> og brug{' '}
                      <em>Flyt til Hus</em>-knappen.
                    </p>
                  </div>
                ) : (
                  <div className="field">
                    <label>Hus</label>
                    <p className="help" style={{ marginTop: 0 }}>
                      {photo.houseNumbers.length > 0
                        ? `Hus ${photo.houseNumbers.join(', ')}`
                        : photo.activityName
                          ? `Kategori: ${photo.activityName}`
                          : 'Ingen tag'}{' '}
                      — brug knapperne på <Link to="/mine">Mine billeder</Link> for at flytte billedet
                      mellem dit hus og Mine Kategori Billeder.
                    </p>
                  </div>
                )}
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
                  {isAdmin && (!confirmDelete ? (
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
                  ))}
                </div>
              </form>
            ) : (
              <>
                {photo.description && <p className="photo-desc">{photo.description}</p>}

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

            {canEdit && (stageThree || isAdmin) && (
              <div className="photo-section">
                <p className="photo-section-title">Hjælp søges</p>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                    cursor: helpSaving ? 'wait' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={photo.helpWanted}
                    disabled={helpSaving}
                    onChange={toggleHelpWanted}
                    style={{ marginTop: '0.25rem' }}
                  />
                  <span style={{ fontSize: '0.95rem' }}>
                    <strong>Hjælp søges</strong> — bed andre om hjælp til at identificere personerne.
                    Et lille mærke vises på billedet, og besøgende kan sende en kommentar til
                    udvalget.
                  </span>
                </label>
                {helpError && (
                  <div className="error" style={{ marginTop: '0.5rem' }}>
                    {helpError}
                  </div>
                )}
              </div>
            )}

            <div className="photo-actions">
              {photo.downloadUrl && (
                <a href={photo.downloadUrl} className="btn-primary">
                  Hent billedet <span className="arrow">↓</span>
                </a>
              )}
              {stageThree && !removalOpen && !removalSent && (
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

            {stageThree && removalOpen && !removalSent && (
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
