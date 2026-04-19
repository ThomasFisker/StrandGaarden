import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getGallery } from '../api';
import { useSession } from '../session';
import type { GalleryList } from '../types';

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

  // Keep the URL in sync with the person filter so it is shareable.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (personSlug) next.set('person', personSlug);
    else next.delete('person');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [personSlug, searchParams, setSearchParams]);

  return (
    <main className="content wide">
      <h1>Galleri</h1>
      <p className="subtle">
        Udvalgte billeder fra Strandgaardens historie. Klik på et billede for at se det i fuld størrelse.
      </p>

      <div className="filter-row">
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
        {(year !== null || house !== null || personSlug !== null) && (
          <button
            type="button"
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
      {data === null && !error && <p>Indlæser…</p>}
      {data && data.items.length === 0 && (
        <p>
          Ingen billeder matcher det valgte filter.
          {(year !== null || house !== null) && ' Prøv at nulstille filtret.'}
        </p>
      )}

      {data && data.items.length > 0 && (
        <div className="gallery-grid">
          {data.items.map((p) => (
            <Link key={p.photoId} to={`/galleri/${p.photoId}`} className="gallery-tile">
              {p.thumbnailUrl ? (
                <img src={p.thumbnailUrl} alt={p.description} loading="lazy" />
              ) : (
                <div className="thumb-placeholder" style={{ width: '100%', height: 200 }}>
                  Ingen miniature
                </div>
              )}
              <div className="gallery-caption">
                <strong>{p.description || <em>(uden beskrivelse)</em>}</strong>
                <span className="meta">
                  {p.year ? `${p.yearApprox ? 'ca. ' : ''}${p.year} · ` : ''}
                  Hus {p.houseNumbers.join(', ')}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
};
