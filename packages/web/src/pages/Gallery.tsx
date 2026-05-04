import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getGallery } from '../api';
import { useProfile } from '../profile';
import { useSession } from '../session';
import { formatShortId, type GalleryItem, type GalleryList } from '../types';

export const GalleryPage = () => {
  const { session } = useSession();
  const { profile } = useProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<GalleryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [house, setHouse] = useState<number | null>(null);
  const [personSlug, setPersonSlug] = useState<string | null>(searchParams.get('person'));
  const [activityKey, setActivityKey] = useState<string | null>(searchParams.get('activity'));
  const [showAll, setShowAll] = useState<boolean>(searchParams.get('all') === '1');

  const isAdmin = profile?.groups.includes('admin') ?? false;
  const galleryHidden = profile !== null && !isAdmin && profile.stage !== 3;

  const load = useCallback(async () => {
    if (!session || galleryHidden) return;
    setError(null);
    try {
      const result = await getGallery(session.idToken, {
        year,
        house,
        person: personSlug,
        activity: activityKey,
        all: isAdmin && showAll,
      });
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente billeder');
    }
  }, [session, year, house, personSlug, activityKey, showAll, isAdmin, galleryHidden]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (personSlug) next.set('person', personSlug);
    else next.delete('person');
    if (activityKey) next.set('activity', activityKey);
    else next.delete('activity');
    if (isAdmin && showAll) next.set('all', '1');
    else next.delete('all');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [personSlug, activityKey, showAll, isAdmin, searchParams, setSearchParams]);

  const hasFilter =
    year !== null || house !== null || personSlug !== null || activityKey !== null;

  const yearRange = useMemo(() => {
    if (!data || data.filters.years.length === 0) return '';
    const ys = [...data.filters.years].sort((a, b) => a - b);
    return ys.length === 1 ? String(ys[0]) : `${ys[0]}–${ys[ys.length - 1]}`;
  }, [data]);

  const renderTile = (p: GalleryItem, isFeature: boolean) => {
    const adminOnly = showAll && p.visibilityWeb === false;
    return (
      <Link
        key={p.photoId}
        to={`/galleri/${p.photoId}`}
        className={`tile${isFeature ? ' feature' : ''}${p.helpWanted ? ' help-wanted' : ''}`}
      >
        {p.thumbnailUrl ? (
          <div className="frame">
            <img src={p.thumbnailUrl} alt={p.description || 'Strandgaarden billede'} loading="lazy" />
            {p.helpWanted && <span className="help-wanted-ribbon">Hjælp søges</span>}
            {adminOnly && (
              <span
                className="help-wanted-ribbon"
                style={{
                  background: 'var(--ink, #1a3548)',
                  color: 'var(--paper, #fafaf5)',
                  top: 'auto',
                  bottom: '0.5rem',
                }}
              >
                Kun bog
              </span>
            )}
            <span className="tile-short-id">{formatShortId(p.shortId)}</span>
          </div>
        ) : (
          <div className="thumb-placeholder">Behandles…</div>
        )}
        <div className="caption">
          <span className="year">
            {p.yearApprox && p.year && <small>ca.</small>}
            {p.year ?? '—'}
          </span>
          <span className="house">
            {p.houseNumbers.length > 0
              ? `Hus ${p.houseNumbers.join(' · ')}`
              : p.activityName
                ? p.activityName
                : '—'}
          </span>
        </div>
        {isFeature && p.description && <p className="desc">{p.description}</p>}
      </Link>
    );
  };

  if (galleryHidden) {
    const stage = profile?.stage ?? 3;
    return (
      <main className="content">
        <p className="eyebrow">{stage === 1 ? 'Fase 1 — Indsamling' : 'Frys'}</p>
        <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
          {stage === 1 ? <>Vi <em>samler</em> billeder</> : <>Galleriet er <em>på pause</em></>}
        </h1>
        <p className="lede">
          {stage === 1
            ? 'Galleriet åbner først når jubilæumsbogen er klar. Imens samler vi billederne ind — bidrag du har sendt finder du på Mine billeder, og du kan uploade flere via Upload billede.'
            : 'Udvalget arbejder på den trykte bog. Når vi åbner igen, finder du galleriet her. Imens kan du stadig se det du selv har uploadet.'}
        </p>
        <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link to="/mine" className="btn-primary">
            Mine billeder <span className="arrow">→</span>
          </Link>
          {stage === 1 && (
            <Link to="/upload" className="btn-ghost">
              Upload billede
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="horizon"><span>Arkivet</span></div>
      <main className="content feature">
        <p className="eyebrow">
          {data ? `${data.items.length} billeder${yearRange ? ` · ${yearRange}` : ''}` : 'Samling'}
        </p>
        <h1 className="display">Et <em>galleri</em> af hundrede somre</h1>
        <p className="lede">
          Klik på et billede for at se det i fuld størrelse, læse historien bag, og downloade. Filtrér efter
          årstal, hus eller person.
        </p>

        <div className="filters">
          <span className="filter-label">Filtrér —</span>
          <label>
            År
            <select
              value={year ?? ''}
              onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Alle år</option>
              {data?.filters.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label>
            Hus
            <select
              value={house ?? ''}
              onChange={(e) => setHouse(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Alle huse</option>
              {data?.filters.houses.map((h) => (
                <option key={h} value={h}>
                  Hus {h}
                </option>
              ))}
            </select>
          </label>
          <label>
            Person
            <select value={personSlug ?? ''} onChange={(e) => setPersonSlug(e.target.value || null)}>
              <option value="">Alle personer</option>
              {data?.filters.persons.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
          {data?.filters.activities && data.filters.activities.length > 0 && (
            <label>
              Aktivitet
              <select
                value={activityKey ?? ''}
                onChange={(e) => setActivityKey(e.target.value || null)}
              >
                <option value="">Alle aktiviteter</option>
                {data.filters.activities.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {hasFilter && (
            <button
              type="button"
              className="reset"
              onClick={() => {
                setYear(null);
                setHouse(null);
                setPersonSlug(null);
                setActivityKey(null);
              }}
            >
              Nulstil filter
            </button>
          )}
        </div>

        {isAdmin && (
          <div
            style={{
              margin: '0.5rem 0 0.75rem',
              padding: '0.6rem 0.85rem',
              background: 'var(--paper-warm, #faf2e6)',
              borderLeft: '3px solid var(--ink, #1a3548)',
              fontSize: '0.95rem',
            }}
          >
            <label style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              <span>
                <strong>Vis alle billeder</strong> (også dem udvalgt kun til bogen, som
                medlemmerne ikke kan se)
              </span>
            </label>
          </div>
        )}

        {error && <div className="error">{error}</div>}
        {data === null && !error && <p className="subtle">Indlæser…</p>}
        {data && data.items.length === 0 && (
          <p className="subtle">
            Ingen billeder matcher det valgte filter.
            {hasFilter && ' Prøv at nulstille filtret.'}
          </p>
        )}

        {data && data.items.length > 0 && (
          <div className="gallery-grid">
            {data.items.map((p, i) => {
              // Feature tile pattern: every 10th photo when no filter is applied, to break the grid rhythm.
              const isFeature = !hasFilter && (i === 0 || i === 9);
              return renderTile(p, isFeature);
            })}
          </div>
        )}
      </main>
    </>
  );
};
