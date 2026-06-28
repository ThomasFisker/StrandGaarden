import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  deletePhoto,
  friendlyApiMessage,
  getHousePhotos,
  getMyPhotos,
  movePhotoSection,
  setHouseBookReady,
  swapPhotoPriority,
  updateHouseText,
} from '../api';
import { RichTextEditor } from '../components/RichTextEditor';
import { useProfile } from '../profile';
import { useSession } from '../session';
import { formatShortId, type HousePhoto, type MyPhoto } from '../types';

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

type Tab = 'hus' | 'kategori' | 'tekst';

export const MinePage = () => {
  const { session } = useSession();
  const { profile, refresh: refreshProfile } = useProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<MyPhoto[] | null>(null);
  const [houseSiblings, setHouseSiblings] = useState<HousePhoto[] | null>(null);
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const activeTab: Tab =
    location.pathname === '/mine/kategori'
      ? 'kategori'
      : location.pathname === '/mine/tekst'
        ? 'tekst'
        : 'hus';

  // The /mine/kategori and /mine/tekst sub-routes only make sense in
  // Stage-1 member context. For other callers we collapse back to
  // /mine where the page renders a flat list. /mine/tekst also
  // requires the user to be assigned a house — otherwise there's
  // nothing to edit.
  useEffect(() => {
    if (!profile) return;
    const isSubroute =
      location.pathname === '/mine/kategori' || location.pathname === '/mine/tekst';
    if (isSubroute && !stageOneMember) {
      navigate('/mine', { replace: true });
      return;
    }
    if (location.pathname === '/mine/tekst' && profile.houseNumber === null) {
      navigate('/mine', { replace: true });
    }
  }, [location.pathname, stageOneMember, profile, navigate]);

  const reloadPhotos = async (token: string) => {
    const [own, house] = await Promise.all([
      getMyPhotos(token),
      getHousePhotos(token).catch(() => ({ items: [], houseNumber: null })),
    ]);
    setPhotos(own);
    setHouseSiblings(house.items);
  };

  const swapPriority = async (photo: MyPhoto, direction: 'up' | 'down') => {
    if (!session || swapping) return;
    setSwapping(photo.photoId);
    try {
      await swapPhotoPriority(session.idToken, photo.photoId, direction);
      await reloadPhotos(session.idToken);
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
      await Promise.all([reloadPhotos(session.idToken), refreshProfile()]);
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
      await Promise.all([reloadPhotos(session.idToken), refreshProfile()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke flytte billedet');
    } finally {
      setMoving(null);
    }
  };

  const deleteCard = async (photo: MyPhoto) => {
    if (!session || deletingId) return;
    setDeletingId(photo.photoId);
    setError(null);
    try {
      await deletePhoto(session.idToken, photo.photoId);
      setConfirmDeleteId(null);
      // Refresh the profile too — deleting a house photo frees a slot.
      await Promise.all([reloadPhotos(session.idToken), refreshProfile()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke slette billedet');
    } finally {
      setDeletingId(null);
    }
  };

  const [markingReady, setMarkingReady] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);

  const setHouseReady = async (ready: boolean) => {
    if (!session || !profile || profile.houseNumber === null || markingReady) return;
    setMarkingReady(true);
    setReadyError(null);
    try {
      await setHouseBookReady(session.idToken, profile.houseNumber, ready);
      await refreshProfile();
    } catch (e) {
      setReadyError(friendlyApiMessage(e));
    } finally {
      setMarkingReady(false);
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
    Promise.all([
      getMyPhotos(session.idToken),
      getHousePhotos(session.idToken).catch(() => ({ items: [], houseNumber: null })),
    ])
      .then(([own, house]) => {
        if (!active) return;
        setPhotos(own);
        setHouseSiblings(house.items);
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
    opts: {
      showArrows?: { canUp: boolean; canDown: boolean };
      section?: 'house' | 'other';
      isMine?: boolean;
      uploaderName?: string;
    } = {},
  ) => {
    const isMine = opts.isMine !== false;
    const detailHref = `/galleri/${encodeURIComponent(p.photoId)}`;
    const isHouseSection = opts.section === 'house';
    const isOtherSection = opts.section === 'other';
    const moveBusy = moving === p.photoId;
    // Only the uploader can rearrange / move / open the editor; other
    // members of the same house see their houseSiblings cards as
    // read-only.
    const showMoveToOther = !frozen && stageOneMember && isHouseSection && isMine;
    const showMoveToHouse =
      !frozen && stageOneMember && isOtherSection && myHouse !== null && isMine;
    const moveToHouseDisabled = !!houseAtCap || moveBusy;
    // Stage-1 members may delete their own photos directly (no need to ask
    // redaktionen). In stage 2 the page is frozen; in stage 3 deletion goes
    // through the removal-request flow on the detail page instead.
    const showDelete = !frozen && stageOneMember && isMine;
    const deleteBusy = deletingId === p.photoId;
    const statusClass = p.status === 'Decided' ? ' decided' : '';
    // Arrow row stays visible on every house card so the priority
    // number is always shown — but the ↑↓ buttons are only enabled on
    // the caller's own photos.
    const showPriorityRow = !!opts.showArrows && p.priority !== null;
    return (
      <article
        key={p.photoId}
        className={`mine-card${opts.showArrows ? ' mine-card-house' : ''}${isMine ? '' : ' mine-card-sibling'}`}
      >
        {showPriorityRow && (
          <div className="mine-card-priority">
            <strong className="mine-card-priority-num">#{p.priority}</strong>
            <span className="mine-card-priority-label">Rækkefølge i bogens hus-afsnit</span>
            {isMine && opts.showArrows && (
              <>
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
              </>
            )}
          </div>
        )}
        <div className="mine-card-row">
          <div className="mine-card-thumb">
            {isMine ? (
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
            ) : p.thumbnailUrl ? (
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
            <p className="mine-card-id">{formatShortId(p.shortId)}</p>
          </div>
          <div className="mine-card-body">
            <h3 className="mine-card-title">
              {isMine ? (
                <Link to={detailHref}>{p.description || <em>(ingen beskrivelse)</em>}</Link>
              ) : (
                <span>{p.description || <em>(ingen beskrivelse)</em>}</span>
              )}
            </h3>
            {!isMine && opts.uploaderName && (
              <p className="mine-card-meta" style={{ fontStyle: 'italic' }}>
                Uploadet af {opts.uploaderName}
              </p>
            )}
            <p className="mine-card-status">
              <span className={`status${statusClass}`}>{prettyStatus(p)}</span>
            </p>
            <p className="mine-card-meta">
              {p.year ? `${p.yearApprox ? 'ca. ' : ''}${p.year} · ` : ''}
              {p.houseNumbers.length > 0
                ? `Hus ${p.houseNumbers.join(', ')}`
                : p.activityName
                  ? `Kategori: ${p.activityName}`
                  : 'Hus ukendt'}
            </p>
            {p.persons.length > 0 && (
              <div className="person-chips">
                {p.persons.map((person) => (
                  <span
                    key={person.slug}
                    className={`person-chip${person.state === 'pending' ? ' pending' : ''}`}
                    title={person.state === 'pending' ? 'Afventer redaktionens godkendelse' : undefined}
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
        {isMine && (
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
          {showDelete &&
            (confirmDeleteId === p.photoId ? (
              <span className="delete-confirm-inline">
                <strong>Er du sikker?</strong>
                <button
                  type="button"
                  className="danger"
                  onClick={() => deleteCard(p)}
                  disabled={deleteBusy}
                >
                  {deleteBusy ? 'Sletter…' : 'Ja, slet'}
                </button>
                <button
                  type="button"
                  className="btn-card"
                  onClick={() => setConfirmDeleteId(null)}
                  disabled={deleteBusy}
                >
                  Nej
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="btn-card btn-card-danger"
                onClick={() => setConfirmDeleteId(p.photoId)}
                title="Slet billedet permanent — fil og oplysninger fjernes"
              >
                Slet billede
              </button>
            ))}
          </div>
        )}
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
        Hver husstand får tre sider i jubilæumsbogen til både billeder og tekst. Da huset allerede
        er beskrevet i 75-års bogen, er dette tænkt som en opdatering — et tilbageblik på de seneste
        15 år.
      </p>
      <details className="housetext-inspiration">
        <summary>Inspiration: hvad kan teksten handle om?</summary>
        <ul>
          <li>
            <strong>Menneskene i huset:</strong> Hvem bor her i dag? Er der kommet en ny generation
            til — børn eller børnebørn, fødsler, bryllupper, runde fødselsdage holdt i sommerhuset.
            Og dem, vi har mistet i årenes løb, som stadig hører til stedet.
          </li>
          <li>
            <strong>Huset selv:</strong> Ombygninger eller renoveringer — nyt tag, en tilbygning, et
            køkken eller en terrasse, der har ændret hverdagen. Eller modsat: det, I bevidst har
            bevaret. Historien bag, hvis huset har skiftet hænder i familien eller fået nye ejere.
          </li>
          <li>
            <strong>Livet ved stranden:</strong> En tradition, der er jeres egen — morgenbadet, en
            bestemt ret om sommeren, et tilbagevendende besøg, stormen der tog noget med sig, eller
            bare året hvor alle var samlet. Små øjeblikke som er med til at danne minder.
          </li>
        </ul>
        <p style={{ fontStyle: 'italic' }}>
          Det behøver hverken være langt eller højtideligt — bare ægte linjer om det der virkelig
          betyder noget for jer.
        </p>
      </details>
      <p className="help" style={{ marginTop: '0.4rem', fontStyle: 'italic' }}>
        Teksten er <strong>fælles for hele hus {profile.houseNumber}</strong> — er I flere medlemmer
        i huset, deles I om den, og det er den sidst gemte version der står. Snak gerne sammen,
        inden I skriver. Du kan rette teksten frem til den 31. oktober 2026.
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
            Gemt. Tak — redaktionen kan se teksten under <strong>Hustekster</strong>.
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

  // "Meld huset klar til bogen" — self-declaration toggle so the
  // redaktionen can start a finished house's chapter early. Shown to a
  // Stage-1 member who has a house. Re-openable.
  const houseReadyCard = profile && profile.houseNumber !== null && !frozen && (
    <div
      style={{
        margin: '0 0 1.25rem',
        padding: '1rem 1.25rem',
        background: 'var(--paper-warm, #faf2e6)',
        borderLeft: `3px solid ${
          profile.myHouseBookReady ? 'var(--sage, #6b8f71)' : 'var(--copper, #b85a2a)'
        }`,
      }}
    >
      {profile.myHouseBookReady ? (
        <>
          <p style={{ margin: '0 0 0.3rem', fontWeight: 600 }}>
            ✓ Hus {profile.houseNumber} er meldt klar til bogen
            {profile.myHouseBookReadyAt
              ? ` (${new Date(profile.myHouseBookReadyAt).toLocaleDateString('da-DK', {
                  day: 'numeric',
                  month: 'long',
                })})`
              : ''}
            .
          </p>
          <p className="help" style={{ margin: '0 0 0.6rem' }}>
            Redaktionen kan nu gå i gang med jeres kapitel. Kommer I i tanke om flere billeder
            eller rettelser, kan I åbne huset igen.
          </p>
          <button
            type="button"
            className="btn-card"
            onClick={() => setHouseReady(false)}
            disabled={markingReady}
          >
            {markingReady ? 'Et øjeblik…' : 'Åbn huset igen'}
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 0.3rem', fontWeight: 600 }}>
            Er I færdige med hus {profile.houseNumber}?
          </p>
          <p className="help" style={{ margin: '0 0 0.6rem' }}>
            Når I har uploadet de billeder, I vil have med, og skrevet husets tekst, kan I melde
            huset klar. Så ved redaktionen, at de kan gå i gang med jeres kapitel — også selvom
            der er tid til fristen endnu. I kan altid åbne igen.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setHouseReady(true)}
            disabled={markingReady}
          >
            {markingReady ? 'Et øjeblik…' : 'Meld huset klar til bogen'}
          </button>
        </>
      )}
      {readyError && <div className="error" style={{ marginTop: '0.6rem' }}>{readyError}</div>}
    </div>
  );

  const tabStrip = stageOneMember && (
    <nav className="mine-tabs" aria-label="Skift mellem hus, kategori og tekst">
      <NavLink
        to="/mine"
        end
        className={({ isActive }) => `mine-tab${isActive ? ' active' : ''}`}
      >
        Mine Hus Billeder
        {houseSiblings && houseSiblings.length > 0 && (
          <span className="mine-tab-count">{houseSiblings.length}</span>
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
      {profile && profile.houseNumber !== null && (
        <NavLink
          to="/mine/tekst"
          className={({ isActive }) => `mine-tab${isActive ? ' active' : ''}`}
        >
          Min Hus Tekst
        </NavLink>
      )}
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
          <div className="ok">Tak! Billedet er sendt og venter på redaktionens gennemgang.</div>
        )}
        {tabStrip}

        <div className="mine-section-intro">
          <p className="lede" style={{ margin: 0 }}>
            {profile && profile.houseNumber !== null ? (
              <>
                Hus <strong>{profile.houseNumber}</strong> kan have op til{' '}
                <strong>{profile.maxBookSlotsPerHouse}</strong> billeder med i bogen. Indtil nu
                har hus {profile.houseNumber} sendt{' '}
                <strong>{houseSiblings?.length ?? slotsUsed ?? housePhotos.length}</strong>{' '}
                i alt
                {houseSiblings &&
                  housePhotos.length > 0 &&
                  housePhotos.length < houseSiblings.length && (
                    <> (heraf <strong>{housePhotos.length}</strong> fra dig)</>
                  )}
                . Tallet gælder hele huset — hvis I er flere fra samme hus, deles I om de{' '}
                {profile.maxBookSlotsPerHouse} pladser. Brug pilene på dine egne billeder til at
                flytte de vigtigste øverst — redaktionen skærer fra bunden, hvis der ikke er plads
                til alle.
              </>
            ) : (
              'Du er ikke tildelt et hus endnu. Bed redaktionen tildele dig et hus før du uploader til denne sektion.'
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

        {houseReadyCard}

        {error && <div className="error">{error}</div>}
        {(photos === null || houseSiblings === null) && !error && <p>Indlæser…</p>}

        {houseSiblings && houseSiblings.length === 0 && (
          <p className="subtle">
            Ingen hus-billeder endnu i hus {profile?.houseNumber}. Brug knappen ovenfor til at
            uploade det første.
          </p>
        )}
        {houseSiblings && houseSiblings.length > 0 && (
          <div className="photo-grid">
            {houseSiblings.map((p) => {
              // Arrow gating is over the shared priority space — slotsUsed
              // is the house-wide count from /me, which == the highest
              // assigned priority (slots are filled contiguously). The
              // swap operates on whoever holds the adjacent priority,
              // including other members of the house.
              const total = slotsUsed ?? houseSiblings.length;
              const myPri = p.priority ?? 0;
              return renderCard(p, {
                showArrows: { canUp: myPri > 1, canDown: myPri < total },
                section: 'house',
                isMine: p.isMine,
                uploaderName: p.uploaderDisplayName,
              });
            })}
          </div>
        )}
      </main>
    );
  }

  // ——— Stage-1 member: Min Hus Tekst tab ———
  if (stageOneMember && activeTab === 'tekst') {
    return (
      <main className="content">
        <p className="eyebrow">Bidrag til bogen</p>
        <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
          Min Hus <em>Tekst</em>
        </h1>
        {tabStrip}
        {houseTextEditor}
        {houseReadyCard}
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
          <div className="ok">Tak! Billedet er sendt og venter på redaktionens gennemgang.</div>
        )}
        {tabStrip}

        <div className="mine-section-intro">
          <p className="lede" style={{ margin: 0 }}>
            Billeder fra fælles kategorier — Sct. Hans, Vejdag & skovdag, Fællesskabet og andre
            — kommer med i bogens fællesafsnit. Ingen rækkefølge: redaktionen vælger selv, hvad der
            kommer med.
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
        <div className="ok">Tak! Billedet er sendt og venter på redaktionens gennemgang.</div>
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
