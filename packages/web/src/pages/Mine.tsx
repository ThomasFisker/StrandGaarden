import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getMyPhotos, movePhotoSection, swapPhotoPriority, updateHouseText } from '../api';
import { RichTextEditor } from '../components/RichTextEditor';
import { useProfile } from '../profile';
import { useSession } from '../session';
import { formatShortId, type MyPhoto } from '../types';

/** Roughly count visible characters in an HTML string by stripping tags
 * and decoding common entities. The server's authoritative validation
 * uses the same shape (strip-then-count) so the two stay in sync. */
const visibleLength = (html: string): number =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .length;

const STATUS_LABEL: Record<string, string> = {
  Uploaded: 'Afventer gennemgang',
  'In Review': 'Under gennemgang',
  Decided: 'Afgjort',
  Rejected: 'Afvist — for lille',
};

const prettyStatus = (p: MyPhoto): string => {
  if (p.status === 'Decided') {
    const parts: string[] = [];
    if (p.visibilityWeb) parts.push('Offentliggjort');
    if (p.visibilityBook) parts.push('Udvalgt til bog');
    if (parts.length === 0) return 'Afgjort — gemt';
    return parts.join(' + ');
  }
  return STATUS_LABEL[p.status] ?? p.status;
};

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

export const MinePage = () => {
  const { session } = useSession();
  const { profile, refresh: refreshProfile } = useProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [photos, setPhotos] = useState<MyPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const justUploaded = searchParams.get('justUploaded') === '1';
  const isAdmin = profile?.groups.includes('admin') ?? false;
  const frozen = profile?.stage === 2 && !isAdmin;
  const stageOneMember = profile?.stage === 1 && !isAdmin;
  const myHouse = profile?.houseNumber ?? null;
  const slotsUsed = profile?.myHouseSlotsUsed ?? null;
  const slotsMax = profile?.maxBookSlotsPerHouse ?? 7;
  const houseAtCap =
    stageOneMember && myHouse !== null && slotsUsed !== null && slotsUsed >= slotsMax;
  const [swapping, setSwapping] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const swapPriority = async (photo: MyPhoto, direction: 'up' | 'down') => {
    if (!session || swapping) return;
    setSwapping(photo.photoId);
    try {
      await swapPhotoPriority(session.idToken, photo.photoId, direction);
      // Re-fetch the user's photos so priorities reflect the swap.
      const items = await getMyPhotos(session.idToken);
      setPhotos(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke ændre rækkefølgen');
    } finally {
      setSwapping(null);
    }
  };

  const moveToHouse = async (photo: MyPhoto) => {
    if (!session || moving) return;
    setMoving(photo.photoId);
    setError(null);
    try {
      await movePhotoSection(session.idToken, photo.photoId, { target: 'house' });
      const [items] = await Promise.all([getMyPhotos(session.idToken), refreshProfile()]);
      setPhotos(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke flytte billedet');
    } finally {
      setMoving(null);
    }
  };

  const moveToOther = async (photo: MyPhoto) => {
    if (!session || moving) return;
    setMoving(photo.photoId);
    setError(null);
    try {
      await movePhotoSection(session.idToken, photo.photoId, { target: 'other' });
      const [items] = await Promise.all([getMyPhotos(session.idToken), refreshProfile()]);
      setPhotos(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke flytte billedet');
    } finally {
      setMoving(null);
    }
  };

  // House-text editor state. Initialized from profile.myHouseText once
  // the profile loads; tracked locally so we can show dirty state.
  const [houseText, setHouseText] = useState<string>('');
  const [houseTextLoaded, setHouseTextLoaded] = useState(false);
  const [savingText, setSavingText] = useState(false);
  const [textOk, setTextOk] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile || houseTextLoaded) return;
    setHouseText(profile.myHouseText ?? '');
    setHouseTextLoaded(true);
  }, [profile, houseTextLoaded]);

  const submitHouseText = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !profile || profile.houseNumber === null) return;
    setSavingText(true);
    setTextError(null);
    setTextOk(false);
    try {
      await updateHouseText(session.idToken, profile.houseNumber, houseText);
      await refreshProfile();
      setTextOk(true);
    } catch (err) {
      setTextError(err instanceof Error ? err.message : 'Kunne ikke gemme teksten');
    } finally {
      setSavingText(false);
    }
  };

  useEffect(() => {
    if (!session) return;
    let active = true;
    getMyPhotos(session.idToken)
      .then((items) => {
        if (active) setPhotos(items);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Kunne ikke hente billeder');
      });
    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (!justUploaded) return;
    const t = setTimeout(() => {
      setSearchParams({}, { replace: true });
    }, 5000);
    return () => clearTimeout(t);
  }, [justUploaded, setSearchParams]);

  // Phase-1 split: house photos (priority set) vs others. In Phase 3 we
  // render a single flat list so the page collapses back when the
  // freeze ends — no schema migration needed, just UI.
  const { housePhotos, otherPhotos } = useMemo(() => {
    if (!photos || !stageOneMember) {
      return { housePhotos: [] as MyPhoto[], otherPhotos: photos ?? [] };
    }
    const h: MyPhoto[] = [];
    const o: MyPhoto[] = [];
    for (const p of photos) {
      if (p.priority !== null) h.push(p);
      else o.push(p);
    }
    h.sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999));
    return { housePhotos: h, otherPhotos: o };
  }, [photos, stageOneMember]);

  const renderCard = (
    p: MyPhoto,
    opts: { showArrows?: { canUp: boolean; canDown: boolean }; section?: 'house' | 'other' } = {},
  ) => {
    const detailHref = `/galleri/${encodeURIComponent(p.photoId)}`;
    const isHouseSection = opts.section === 'house';
    const isOtherSection = opts.section === 'other';
    const moveBusy = moving === p.photoId;
    const showMoveToOther = !frozen && stageOneMember && isHouseSection;
    const showMoveToHouse =
      !frozen && stageOneMember && isOtherSection && myHouse !== null;
    const moveToHouseDisabled = !!houseAtCap || moveBusy;
    return (
      <article
        key={p.photoId}
        className="photo-card"
        style={
          opts.showArrows
            ? { borderLeft: '3px solid var(--copper, #b85a2a)' }
            : undefined
        }
      >
        {opts.showArrows && p.priority !== null && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.4rem 0.75rem',
              background: 'var(--paper-warm, #faf2e6)',
              borderBottom: '1px solid var(--border, #d8cfbc)',
            }}
          >
            <strong
              style={{
                display: 'inline-block',
                minWidth: '1.5rem',
                textAlign: 'center',
                color: 'var(--copper, #b85a2a)',
              }}
            >
              #{p.priority}
            </strong>
            <span className="subtle" style={{ flex: 1, fontSize: '0.9rem' }}>
              Rækkefølge i bogens hus-afsnit
            </span>
            <button
              type="button"
              aria-label="Flyt op"
              disabled={!opts.showArrows.canUp || !!swapping || frozen}
              onClick={() => swapPriority(p, 'up')}
              style={{ minWidth: '2.5rem', padding: '0.25rem 0.5rem', fontSize: '1.2rem' }}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Flyt ned"
              disabled={!opts.showArrows.canDown || !!swapping || frozen}
              onClick={() => swapPriority(p, 'down')}
              style={{ minWidth: '2.5rem', padding: '0.25rem 0.5rem', fontSize: '1.2rem' }}
            >
              ↓
            </button>
          </div>
        )}
        <div className="photo-card-row">
          <Link
            to={detailHref}
            className="thumb-wrap"
            aria-label={`Se detaljer for ${p.description || p.originalFilename}`}
            style={{ display: 'block' }}
          >
            {p.thumbnailUrl ? (
              <img
                src={p.thumbnailUrl}
                alt={p.description || p.originalFilename}
                className="thumb"
                loading="lazy"
              />
            ) : (
              <div className="thumb thumb-placeholder">
                {p.status === 'Rejected' ? 'Afvist' : p.processingError ? 'Fejl' : 'Behandles…'}
              </div>
            )}
          </Link>
          <div className="photo-card-body">
            <h3>
              <Link
                to={detailHref}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                {p.description || <em>(ingen beskrivelse)</em>}
              </Link>
            </h3>
            <div>
              <span className={`status${p.status === 'Decided' ? ' decided' : ''}`}>{prettyStatus(p)}</span>
              <span className="meta">
                {p.year ? `${p.yearApprox ? 'ca. ' : ''}${p.year} · ` : ''}
                {p.houseNumbers.length > 0
                  ? `Hus ${p.houseNumbers.join(', ')}`
                  : p.activityName
                    ? `Aktivitet: ${p.activityName}`
                    : 'Hus ukendt'}
              </span>
              {p.helpWanted && (
                <span
                  className="meta"
                  style={{
                    display: 'inline-block',
                    marginLeft: '0.4rem',
                    padding: '0.1rem 0.5rem',
                    background: 'var(--paper-warm, #faf2e6)',
                    color: 'var(--copper, #b85a2a)',
                    borderRadius: '999px',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                  }}
                  title="Du har bedt andre om hjælp til at identificere personerne"
                >
                  Hjælp søges
                </span>
              )}
            </div>
            {p.whoInPhoto && <p className="meta">{p.whoInPhoto}</p>}
            {p.persons.length > 0 && (
              <div className="person-chips">
                {p.persons.map((person) => (
                  <span
                    key={person.slug}
                    className={`person-chip${person.state === 'pending' ? ' pending' : ''}`}
                    title={person.state === 'pending' ? 'Afventer udvalgets godkendelse' : undefined}
                  >
                    {person.displayName}
                  </span>
                ))}
              </div>
            )}
            <p className="meta">
              <span className="short-id">{formatShortId(p.shortId)}</span> · Fil: {p.originalFilename} · sendt {prettyDate(p.createdAt)}
            </p>
            {p.status === 'Rejected' && p.processingError && (
              <p className="meta" style={{ color: 'var(--danger)' }}>
                <strong>Billedet kunne ikke bruges:</strong> {p.processingError}
              </p>
            )}
            {p.status !== 'Rejected' && p.processingError && (
              <p className="meta" style={{ color: 'var(--danger)' }}>
                Fejl ved billedbehandling: {p.processingError}
              </p>
            )}
            {p.qualityWarning === 'low-resolution-for-book' && p.status !== 'Rejected' && (
              <p className="meta" style={{ color: 'var(--copper, #b85a2a)' }}>
                <strong>Bemærk:</strong> billedet er lidt småt — det kan vises på siden, men er
                muligvis ikke skarpt nok til den trykte bog. Hvis du har en større original, så
                upload den gerne.
              </p>
            )}
            <div
              style={{
                marginTop: '0.75rem',
                display: 'flex',
                gap: '0.6rem',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <Link to={detailHref} className="link-muted" style={{ fontWeight: 600 }}>
                Se detaljer / rediger →
              </Link>
              {showMoveToOther && (
                <button
                  type="button"
                  onClick={() => moveToOther(p)}
                  disabled={moveBusy}
                  style={{ padding: '0.3rem 0.7rem', fontSize: '0.9rem' }}
                  title="Flyt billedet ud af dine hus-pladser, så det havner i Andre billeder"
                >
                  {moveBusy ? 'Flytter…' : 'Flyt til Andre billeder'}
                </button>
              )}
              {showMoveToHouse && (
                <button
                  type="button"
                  onClick={() => moveToHouse(p)}
                  disabled={moveToHouseDisabled}
                  style={{ padding: '0.3rem 0.7rem', fontSize: '0.9rem' }}
                  title={
                    houseAtCap
                      ? `Hus ${myHouse} har allerede ${slotsUsed} af ${slotsMax} mulige billeder.`
                      : `Flyt billedet til Mine Hus Billeder (Hus ${myHouse})`
                  }
                >
                  {moveBusy ? 'Flytter…' : `Flyt til Hus ${myHouse}`}
                  {houseAtCap && (
                    <span className="subtle" style={{ marginLeft: '0.4rem' }}>
                      ({slotsUsed}/{slotsMax})
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <main className="content">
      <p className="eyebrow">Dine bidrag</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>Mine <em>billeder</em></h1>

      {justUploaded && <div className="ok">Tak! Billedet er sendt og venter på udvalgets gennemgang.</div>}

      {profile && profile.houseNumber !== null && (
        <section
          style={{
            marginTop: '1.5rem',
            padding: '1.25rem 1.5rem',
            background: 'var(--paper-warm, #faf2e6)',
            borderLeft: '3px solid var(--copper, #b85a2a)',
          }}
        >
          <p className="eyebrow" style={{ marginTop: 0 }}>Tekst til bogen</p>
          <h2 style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
            Hus {profile.houseNumber}
          </h2>
          <p className="help" style={{ marginTop: 0 }}>
            En kort tekst som hus {profile.houseNumber} bidrager med til jubilæumsbogen — fx en hilsen,
            et minde eller et par linjer om huset gennem årene. Du kan rette teksten frem til bogen
            sendes i tryk.
          </p>
          <form onSubmit={submitHouseText} noValidate>
            <RichTextEditor
              value={houseText}
              onChange={(html) => {
                setHouseText(html);
                setTextOk(false);
                setTextError(null);
              }}
              disabled={savingText || frozen}
              placeholder="Skriv jeres tekst her…"
            />
            <div className="help" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
              <span>
                {visibleLength(houseText)}/{profile.maxHouseTextChars} tegn
              </span>
              {profile.myHouseText !== null && profile.myHouseText !== houseText && (
                <span style={{ color: 'var(--copper, #b85a2a)' }}>Ikke gemt endnu</span>
              )}
            </div>
            {textError && <div className="error" style={{ marginTop: '0.5rem' }}>{textError}</div>}
            {textOk && (
              <div className="ok" style={{ marginTop: '0.5rem' }}>
                Gemt. Tak — udvalget kan se teksten under <strong>Hustekster</strong>.
              </div>
            )}
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
              <button
                type="submit"
                className="btn-primary"
                disabled={savingText || frozen || houseText === (profile.myHouseText ?? '')}
              >
                {savingText ? 'Gemmer…' : 'Gem tekst'}
              </button>
              {frozen && (
                <span className="subtle" style={{ alignSelf: 'center' }}>
                  Låst i frys-fasen
                </span>
              )}
            </div>
          </form>
        </section>
      )}

      {error && <div className="error">{error}</div>}

      {photos === null && !error && <p>Indlæser…</p>}

      {photos && photos.length === 0 && (
        <p>
          Du har ikke sendt nogen billeder endnu. <Link to="/upload">Upload dit første billede</Link>.
        </p>
      )}

      {photos && photos.length > 0 && stageOneMember && (
        <>
          <section style={{ marginTop: '2.5rem' }}>
            <div
              style={{
                height: '4px',
                background: 'var(--copper, #b85a2a)',
                marginBottom: '0.6rem',
                borderRadius: '2px',
              }}
              aria-hidden="true"
            />
            <h2 style={{ marginBottom: '0.25rem' }}>Mine Hus Billeder</h2>
            <p className="help" style={{ marginTop: 0 }}>
              {profile && profile.houseNumber !== null ? (
                <>
                  Hus {profile.houseNumber} kan have op til {profile.maxBookSlotsPerHouse} billeder
                  med i bogen. Du har sendt {housePhotos.length}. Brug pilene til at flytte de
                  vigtigste billeder øverst — udvalget skærer fra bunden, hvis der ikke er plads til
                  alle.{' '}
                  {!frozen && (
                    <Link to="/upload?target=house" style={{ fontWeight: 600 }}>
                      Upload billede →
                    </Link>
                  )}
                </>
              ) : (
                'Du er ikke tildelt et hus endnu. Bed udvalget tildele dig et hus før du uploader til denne sektion.'
              )}
            </p>
            {housePhotos.length === 0 ? (
              <p className="subtle" style={{ margin: '0.5rem 0' }}>
                Ingen hus-billeder endnu. <Link to="/upload?target=house">Upload til dit hus</Link>.
              </p>
            ) : (
              <div className="photo-grid">
                {housePhotos.map((p, i) =>
                  renderCard(p, {
                    showArrows: { canUp: i > 0, canDown: i < housePhotos.length - 1 },
                    section: 'house',
                  }),
                )}
              </div>
            )}
          </section>

          <section style={{ marginTop: '2.5rem' }}>
            <div
              style={{
                height: '4px',
                background: 'var(--sage, #7b8a6b)',
                marginBottom: '0.6rem',
                borderRadius: '2px',
              }}
              aria-hidden="true"
            />
            <h2 style={{ marginBottom: '0.25rem' }}>Andre billeder</h2>
            <p className="help" style={{ marginTop: 0 }}>
              Aktivitetsbilleder og fælles oplevelser. Ingen rækkefølge — udvalget vælger
              selv, hvad der kommer med i bogens fællesafsnit.{' '}
              {!frozen && (
                <Link to="/upload?target=activity" style={{ fontWeight: 600 }}>
                  Upload billede →
                </Link>
              )}
            </p>
            {otherPhotos.length === 0 ? (
              <p className="subtle" style={{ margin: '0.5rem 0' }}>
                Ingen andre billeder endnu.{' '}
                <Link to="/upload?target=activity">Upload til en aktivitet</Link>.
              </p>
            ) : (
              <div className="photo-grid">
                {otherPhotos.map((p) => renderCard(p, { section: 'other' }))}
              </div>
            )}
          </section>
        </>
      )}

      {photos && photos.length > 0 && !stageOneMember && (
        <div className="photo-grid">{photos.map((p) => renderCard(p))}</div>
      )}
    </main>
  );
};
