import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getGallery } from '../api';
import { useSession } from '../session';
import { formatShortId, type GalleryItem, type GalleryList } from '../types';

export const GalleryPage = () => {
  const { session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<GalleryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [house, setHouse] = useState<number | null>(null);
  const [personSlug, setPersonSlug] = useState<string | null>(searchParams.get('person'));

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const result = await getGallery(session.idToken, { year, house, person: personSlug });
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente billeder');
    }
  }, [session, year, house, personSlug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (personSlug) next.set('person', personSlug);
    else next.delete('person');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [personSlug, searchParams, setSearchParams]);

  const hasFilter = year !== null || house !== null || personSlug !== null;

  const yearRange = useMemo(() => {
    if (!data || data.filters.years.length === 0) return '';
    const ys = [...data.filters.years].sort((a, b) => a - b);
    return ys.length === 1 ? String(ys[0]) : `${ys[0]}–${ys[ys.length - 1]}`;
  }, [data]);

  const renderTile = (p: GalleryItem, isFeature: boolean) => (
    <Link
      key={p.photoId}
      to={`/galleri/${p.photoId}`}
      className={`tile${isFeature ? ' feature' : ''}${p.helpWanted ? ' help-wanted' : ''}`}
    >
      {p.thumbnailUrl ? (
        <div className="frame">
          <img src={p.thumbnailUrl} alt={p.description || 'Strandgaarden billede'} loading="lazy" />
          {p.helpWanted && <span className="help-wanted-ribbon">Hjælp søges</span>}
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
          {p.houseNumbers.length > 0 ? `Hus ${p.houseNumbers.join(' · ')}` : '—'}
        </span>
      </div>
      {isFeature && p.description && <p className="desc">{p.description}</p>}
    </Link>
  );

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
          {hasFilter && (
            <button
              type="button"
              className="reset"
              onClick={() => {
                setYear(null);
                setHouse(null);
                setPersonSlug(null);
              }}
            >
              Nulstil filter
            </button>
          )}
        </div>

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
