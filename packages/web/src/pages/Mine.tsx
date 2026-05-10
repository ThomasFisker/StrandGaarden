import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { getMyPhotos, movePhotoSection, swapPhotoPriority, updateHouseText } from '../api';
import { RichTextEditor } from '../components/RichTextEditor';
import { useProfile } from '../profile';
import { useSession } from '../session';
import { formatShortId, type MyPhoto } from '../types';

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

type Tab = 'hus' | 'kategori';

export const MinePage = () => {
  const { session } = useSession();
  const { profile, refresh: refreshProfile } = useProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
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
  const activeTab: Tab = location.pathname === '/mine/kategori' ? 'kategori' : 'hus';

  // /mine/kategori only makes sense in Stage-1 member context. For other
  // callers we collapse back to /mine where the page renders a flat list.
  useEffect(() => {
    if (!profile) return;
    if (location.pathname === '/mine/kategori' && !stageOneMember) {
      navigate('/mine', { replace: true });
    }
  }, [location.pathname, stageOneMember, profile, navigate]);

  const swapPriority = async (photo: MyPhoto, direction: 'up' | 'down') => {
    if (!session || swapping) return;
    setSwapping(photo.photoId);
    try {
      await swapPhotoPriority(session.idToken, photo.photoId, direction);
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

  // Stage-1 split: house photos (priority set) vs others. In Stage 3 we
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
    const statusClass = p.status === 'Decided' ? ' decided' : '';
    return (
      <article
        key={p.photoId}
        className={`mine-card${opts.showArrows ? ' mine-card-house' : ''}`}
      >
        {opts.showArrows && p.priority !== null && (
          <div className="mine-card-priority">
            <strong className="mine-card-priority-num">#{p.priority}</strong>
            <span className="mine-card-priority-label">Rækkefølge i bogens hus-afsnit</span>
            <button
              type="button"
              aria-label="Flyt op"
              className="mine-card-arrow"
              disabled={!opts.showArrows.canUp || !!swapping || frozen}
              onClick={() => swapPriority(p, 'up')}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Flyt ned"
              className="mine-card-arrow"
              disabled={!opts.showArrows.canDown || !!swapping || frozen}
              onClick={() => swapPriority(p, 'down')}
            >
              ↓
            </button>
          </div>
        )}
        <div className="mine-card-row">
          <div className="mine-card-thumb">
            <Link
              to={detailHref}
              aria-label={`Se detaljer for ${p.description || p.originalFilename}`}
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
            <p className="mine-card-id">{formatShortId(p.shortId)}</p>
          </div>
          <div className="mine-card-body">
            <h3 className="mine-card-title">
              <Link to={detailHref}>{p.description || <em>(ingen beskrivelse)</em>}</Link>
            </h3>
            <p className="mine-card-status">
              <span className={`status${statusClass}`}>{prettyStatus(p)}</span>
            </p>
            <p className="mine-card-meta">
              {p.year ? `${p.yearApprox ? 'ca. ' : ''}${p.year} · ` : ''}
              {p.houseNumbers.length > 0
                ? `Hus ${p.houseNumbers.join(', ')}`
                : p.activityName
                  ? `Aktivitet: ${p.activityName}`
                  : 'Hus ukendt'}
            </p>
            {p.whoInPhoto && <p className="mine-card-meta">{p.whoInPhoto}</p>}
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
            {p.status === 'Rejected' && p.processingError && (
              <p className="mine-card-meta" style={{ color: 'var(--danger)' }}>
                <strong>Billedet kunne ikke bruges:</strong> {p.processingError}
              </p>
            )}
            {p.status !== 'Rejected' && p.processingError && (
              <p className="mine-card-meta" style={{ color: 'var(--danger)' }}>
                Fejl ved billedbehandling: {p.processingError}
              </p>
            )}
            {p.qualityWarning === 'low-resolution-for-book' && p.status !== 'Rejected' && (
              <p className="mine-card-meta" style={{ color: 'var(--copper, #b85a2a)' }}>
                <strong>Bemærk:</strong> billedet er lidt småt — det kan vises på siden, men er
                muligvis ikke skarpt nok til den trykte bog.
              </p>
            )}
          </div>
        </div>
        <div className="mine-card-actions">
          <Link to={detailHref} className="btn-card btn-card-primary">
            Se detaljer / rediger
          </Link>
          {showMoveToOther && (
            <button
              type="button"
              className="btn-card"
              onClick={() => moveToOther(p)}
              disabled={moveBusy}
              title="Flyt billedet ud af dine hus-pladser, så det havner i Mine Kategori Billeder"
            >
              {moveBusy ? 'Flytter…' : 'Flyt til Kategori'}
            </button>
          )}
          {showMoveToHouse && (
            <button
              type="button"
              className="btn-card"
              onClick={() => moveToHouse(p)}
              disabled={moveToHouseDisabled}
              title={
                houseAtCap
                  ? `Hus ${myHouse} har allerede ${slotsUsed} af ${slotsMax} mulige billeder.`
                  : `Flyt billedet til Mine Hus Billeder (Hus ${myHouse})`
              }
            >
              {moveBusy ? 'Flytter…' : `Flyt til Hus ${myHouse}`}
              {houseAtCap && (
                <span className="subtle"> ({slotsUsed}/{slotsMax})</span>
              )}
            </button>
          )}
        </div>
      </article>
    );
  };

  const houseTextEditor = profile && profile.houseNumber !== null && (
    <section className="mine-housetext">
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
  );

  const tabStrip = stageOneMember && (
    <nav className="mine-tabs" aria-label="Skift mellem hus og kategori billeder">
      <NavLink
        to="/mine"
        end
        className={({ isActive }) => `mine-tab${isActive ? ' active' : ''}`}
      >
        Mine Hus Billeder
        {housePhotos.length > 0 && (
          <span className="mine-tab-count">{housePhotos.length}</span>
        )}
      </NavLink>
      <NavLink
        to="/mine/kategori"
        className={({ isActive }) => `mine-tab${isActive ? ' active' : ''}`}
      >
        Mine Kategori Billeder
        {otherPhotos.length > 0 && (
          <span className="mine-tab-count">{otherPhotos.length}</span>
        )}
      </NavLink>
    </nav>
  );

  // ——— Stage-1 member: Mine Hus Billeder tab ———
  if (stageOneMember && activeTab === 'hus') {
    return (
      <main className="content">
        <p className="eyebrow">Dine bidrag</p>
        <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
          Mine <em>Hus Billeder</em>
        </h1>
        {justUploaded && (
          <div className="ok">Tak! Billedet er sendt og venter på udvalgets gennemgang.</div>
        )}
        {tabStrip}

        <div className="mine-section-intro">
          <p className="lede" style={{ margin: 0 }}>
            {profile && profile.houseNumber !== null ? (
              <>
                Hus <strong>{profile.houseNumber}</strong> kan have op til{' '}
                <strong>{profile.maxBookSlotsPerHouse}</strong> billeder med i bogen. Du har
                sendt <strong>{housePhotos.length}</strong>. Brug pilene til at flytte de
                vigtigste billeder øverst — udvalget skærer fra bunden, hvis der ikke er plads
                til alle.
              </>
            ) : (
              'Du er ikke tildelt et hus endnu. Bed udvalget tildele dig et hus før du uploader til denne sektion.'
            )}
          </p>
          <p className="help" style={{ margin: '0.6rem 0 0' }}>
            Hører billedet ikke til selve huset — fx Sankt Hans, Vejdag eller
            generalforsamling? Så lægger du det under{' '}
            <Link to="/mine/kategori">Mine Kategori Billeder</Link>.
          </p>
          {!frozen && (
            <Link to="/upload?target=house" className="btn-primary mine-upload-btn">
              Upload billede til mit hus <span className="arrow">→</span>
            </Link>
          )}
        </div>

        {error && <div className="error">{error}</div>}
        {photos === null && !error && <p>Indlæser…</p>}

        <div className="mine-twocol">
          {houseTextEditor && <div className="mine-twocol-left">{houseTextEditor}</div>}
          <div className="mine-twocol-right">
            {photos && photos.length === 0 && (
              <p className="subtle">
                Du har ikke sendt nogen billeder endnu.{' '}
                <Link to="/upload?target=house">Upload dit første billede</Link>.
              </p>
            )}
            {photos && photos.length > 0 && housePhotos.length === 0 && (
              <p className="subtle">
                Ingen hus-billeder endnu. Brug knappen ovenfor til at uploade dit første hus-billede.
              </p>
            )}
            {housePhotos.length > 0 && (
              <div className="photo-grid">
                {housePhotos.map((p, i) =>
                  renderCard(p, {
                    showArrows: { canUp: i > 0, canDown: i < housePhotos.length - 1 },
                    section: 'house',
                  }),
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ——— Stage-1 member: Mine Kategori Billeder tab ———
  if (stageOneMember && activeTab === 'kategori') {
    return (
      <main className="content">
        <p className="eyebrow">Dine bidrag</p>
        <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
          Mine <em>Kategori Billeder</em>
        </h1>
        {justUploaded && (
          <div className="ok">Tak! Billedet er sendt og venter på udvalgets gennemgang.</div>
        )}
        {tabStrip}

        <div className="mine-section-intro">
          <p className="lede" style={{ margin: 0 }}>
            Billeder fra fælles aktiviteter — Sankt Hans, vejdag, generalforsamling og andre
            begivenheder — kommer med i bogens fællesafsnit. Ingen rækkefølge: udvalget vælger
            selv, hvad der kommer med.
          </p>
          {!frozen && (
            <Link to="/upload?target=activity" className="btn-primary mine-upload-btn">
              Upload billede til en kategori <span className="arrow">→</span>
            </Link>
          )}
        </div>

        {error && <div className="error">{error}</div>}
        {photos === null && !error && <p>Indlæser…</p>}

        {photos && otherPhotos.length === 0 && (
          <p className="subtle">
            Ingen kategori-billeder endnu. Brug knappen ovenfor til at uploade dit første.
          </p>
        )}
        {otherPhotos.length > 0 && (
          <div className="photo-grid">
            {otherPhotos.map((p) => renderCard(p, { section: 'other' }))}
          </div>
        )}
      </main>
    );
  }

  // ——— Stage 3 / admin / non-stage-1: flat list ———
  return (
    <main className="content">
      <p className="eyebrow">Dine bidrag</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Mine <em>billeder</em>
      </h1>
      {justUploaded && (
        <div className="ok">Tak! Billedet er sendt og venter på udvalgets gennemgang.</div>
      )}
      {!frozen && (
        <Link to="/upload" className="btn-primary mine-upload-btn">
          Upload billede <span className="arrow">→</span>
        </Link>
      )}
      {houseTextEditor}
      {error && <div className="error">{error}</div>}
      {photos === null && !error && <p>Indlæser…</p>}
      {photos && photos.length === 0 && (
        <p>
          Du har ikke sendt nogen billeder endnu. <Link to="/upload">Upload dit første billede</Link>.
        </p>
      )}
      {photos && photos.length > 0 && (
        <div className="photo-grid">{photos.map((p) => renderCard(p))}</div>
      )}
    </main>
  );
};
