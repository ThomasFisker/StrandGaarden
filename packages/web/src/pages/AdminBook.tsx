import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { deletePhoto, exportBookZip, listBookPhotos } from '../api';
import { useSession } from '../session';
import { formatShortId, type BookExportResponse, type BookPhoto } from '../types';

const fmtBytes = (n: number | null): string => {
  if (n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)} kB`;
  return `${n} B`;
};

const fmtYear = (p: BookPhoto): string => {
  if (p.year === null) return 'ukendt år';
  return p.yearApprox ? `ca. ${p.year}` : String(p.year);
};

type ViewMode = 'id' | 'house' | 'activity';

interface Group {
  key: string;
  label: string;
  /** Sort key — numeric for houses, lowercase displayName for activities. */
  sortKey: number | string;
  photos: BookPhoto[];
}

/** Compute the bucket key for a photo under the chosen view mode. The
 * book editor works house-by-house or activity-by-activity, so we want
 * each photo to land in exactly one bucket per view. */
const bucketFor = (p: BookPhoto, mode: ViewMode): { key: string; label: string; sortKey: number | string } => {
  if (mode === 'house') {
    if (p.houseNumbers.length > 0) {
      const primary = p.houseNumbers[0];
      return { key: `h:${primary}`, label: `Hus ${primary}`, sortKey: primary };
    }
    if (p.activityName) {
      return { key: `a:${p.activityKey ?? p.activityName}`, label: `Aktivitet: ${p.activityName}`, sortKey: 9000 };
    }
    return { key: 'unset', label: 'Uden hus eller aktivitet', sortKey: 9999 };
  }
  if (mode === 'activity') {
    if (p.activityKey) {
      return { key: `a:${p.activityKey}`, label: p.activityName ?? p.activityKey, sortKey: (p.activityName ?? p.activityKey).toLowerCase() };
    }
    if (p.houseNumbers.length > 0) {
      return { key: 'house-only', label: 'Husbidrag (uden aktivitet)', sortKey: 'zzhouse' };
    }
    return { key: 'unset', label: 'Uden hus eller aktivitet', sortKey: 'zzunset' };
  }
  return { key: 'all', label: '', sortKey: 0 };
};

export const AdminBookPage = () => {
  const { session } = useSession();
  const [photos, setPhotos] = useState<BookPhoto[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<BookExportResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('id');
  const [groupFilter, setGroupFilter] = useState<string>('');

  useEffect(() => {
    if (!session) return;
    let active = true;
    listBookPhotos(session.idToken)
      .then((items) => {
        if (!active) return;
        setPhotos(items);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Kunne ikke hente bog-billeder');
      });
    return () => {
      active = false;
    };
  }, [session]);

  const totalBytes = useMemo(() => {
    if (!photos) return 0;
    let sum = 0;
    for (const p of photos) if (selected.has(p.photoId) && p.bookBytes) sum += p.bookBytes;
    return sum;
  }, [photos, selected]);

  // Group + sort + apply the optional single-bucket filter.
  const groups: Group[] = useMemo(() => {
    if (!photos) return [];
    if (viewMode === 'id') {
      return [{ key: 'all', label: '', sortKey: 0, photos }];
    }
    const map = new Map<string, Group>();
    for (const p of photos) {
      const b = bucketFor(p, viewMode);
      if (!map.has(b.key)) {
        map.set(b.key, { key: b.key, label: b.label, sortKey: b.sortKey, photos: [] });
      }
      map.get(b.key)!.photos.push(p);
    }
    const list = Array.from(map.values()).sort((a, b) => {
      if (typeof a.sortKey === 'number' && typeof b.sortKey === 'number') return a.sortKey - b.sortKey;
      return String(a.sortKey).localeCompare(String(b.sortKey), 'da');
    });
    for (const g of list) {
      g.photos.sort((a, b) => {
        const sa = a.shortId ?? 9_999_999;
        const sb = b.shortId ?? 9_999_999;
        return sa - sb;
      });
    }
    return groupFilter ? list.filter((g) => g.key === groupFilter) : list;
  }, [photos, viewMode, groupFilter]);

  // Reset the filter dropdown whenever the view mode changes — its keys
  // are mode-specific (h:1, a:foo, etc.) so a stale value from another
  // mode would silently hide everything.
  useEffect(() => {
    setGroupFilter('');
  }, [viewMode]);

  const visiblePhotos = useMemo(() => groups.flatMap((g) => g.photos), [groups]);

  const toggle = (photoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const selectAll = () => {
    if (!photos) return;
    // Respect the active view + filter so "Vælg alle" inside a single
    // house or activity selects only that group.
    setSelected(new Set(visiblePhotos.filter((p) => p.bookReady).map((p) => p.photoId)));
  };

  const clearAll = () => setSelected(new Set());

  const runDelete = async (photoId: string) => {
    if (!session) return;
    setError(null);
    setDeleting(photoId);
    try {
      await deletePhoto(session.idToken, photoId);
      setPhotos((prev) => (prev ? prev.filter((p) => p.photoId !== photoId) : prev));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke slette billedet');
    } finally {
      setDeleting(null);
    }
  };

  const runExport = async () => {
    if (!session || selected.size === 0) return;
    setError(null);
    setExporting(true);
    setLastExport(null);
    try {
      const res = await exportBookZip(session.idToken, Array.from(selected));
      setLastExport(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eksport fejlede');
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="content">
      <p className="eyebrow">Udvalget · Bog-eksport</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Billeder til <em>jubilæumsbogen</em>
      </h1>
      <p className="lede">
        Her er alle billeder, der er markeret til bogen (<code>Udvalgt til bog</code>). Hvert billede
        eksporteres som JPEG under 2 MB sammen med en tekstfil med beskrivelse og personer.
        Vælg dem du vil have med i en samlet ZIP — eller hent et enkelt med knappen ved billedet.
      </p>

      {error && <div className="error">{error}</div>}
      {photos === null && !error && <p>Indlæser…</p>}

      {photos && photos.length === 0 && (
        <p>
          Ingen billeder er endnu markeret til bogen. Gå til <a href="/review">Gennemgang</a> og sæt flueben
          ved "Udvalgt til bog" for de billeder der skal med.
        </p>
      )}

      {photos && photos.length > 0 && (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem 1.25rem',
              alignItems: 'center',
              margin: '1rem 0 0.75rem',
            }}
          >
            <span className="filter-label">Sortér —</span>
            <div role="radiogroup" aria-label="Visning" style={{ display: 'inline-flex', gap: '0.5rem' }}>
              {([
                ['id', 'Efter ID'],
                ['house', 'Efter hus'],
                ['activity', 'Efter aktivitet'],
              ] as Array<[ViewMode, string]>).map(([mode, label]) => (
                <label
                  key={mode}
                  style={{
                    padding: '0.25rem 0.7rem',
                    border:
                      viewMode === mode
                        ? '2px solid var(--ink, #1a3548)'
                        : '1px solid var(--border, #d8cfbc)',
                    borderRadius: '0.3rem',
                    cursor: 'pointer',
                    background:
                      viewMode === mode ? 'var(--paper-warm, #faf2e6)' : 'transparent',
                    fontSize: '0.95rem',
                  }}
                >
                  <input
                    type="radio"
                    name="book-view"
                    value={mode}
                    checked={viewMode === mode}
                    onChange={() => setViewMode(mode)}
                    style={{ marginRight: '0.4rem' }}
                  />
                  {label}
                </label>
              ))}
            </div>
            {viewMode !== 'id' && groups.length > 1 && (
              <label>
                Vis kun{' '}
                <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                  <option value="">— alle —</option>
                  {groups
                    .slice()
                    .sort((a, b) => {
                      if (typeof a.sortKey === 'number' && typeof b.sortKey === 'number')
                        return a.sortKey - b.sortKey;
                      return String(a.sortKey).localeCompare(String(b.sortKey), 'da');
                    })
                    .map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.label} ({g.photos.length})
                      </option>
                    ))}
                </select>
              </label>
            )}
            {(viewMode !== 'id' || groupFilter) && (
              <span className="subtle" style={{ fontSize: '0.9rem' }}>
                {visiblePhotos.length} af {photos.length} billeder vist
              </span>
            )}
          </div>

          <div className="book-actions">
            <div className="book-actions-row">
              <button type="button" onClick={selectAll} disabled={exporting}>
                Vælg alle ({visiblePhotos.filter((p) => p.bookReady).length})
              </button>
              <button type="button" onClick={clearAll} disabled={exporting || selected.size === 0}>
                Ryd
              </button>
              <span className="book-actions-info">
                {selected.size} valgt · anslået {fmtBytes(totalBytes)} ukomprimeret
              </span>
            </div>
            <button
              type="button"
              className="primary"
              onClick={runExport}
              disabled={exporting || selected.size === 0}
            >
              {exporting
                ? `Pakker ${selected.size} billeder…`
                : `Eksportér ${selected.size || ''} valgte som ZIP`}
            </button>
          </div>

          {lastExport && (
            <div className="ok">
              Klar! {lastExport.photoCount} billeder er pakket som ZIP.{' '}
              <a href={lastExport.downloadUrl} target="_blank" rel="noopener noreferrer">
                Hent ZIP-filen
              </a>
              . Linket er gyldigt i 7 dage.
            </div>
          )}

          {groups.map((group) => (
            <section key={group.key} style={{ marginTop: '1.5rem' }}>
              {group.label && (
                <h2
                  style={{
                    fontSize: '1.15rem',
                    margin: '0 0 0.5rem',
                    paddingBottom: '0.25rem',
                    borderBottom: '1px solid var(--border, #d8cfbc)',
                  }}
                >
                  {group.label}{' '}
                  <span className="subtle" style={{ fontWeight: 400 }}>
                    ({group.photos.length})
                  </span>
                </h2>
              )}
              <div className="book-grid">
                {group.photos.map((p) => {
                  const isSel = selected.has(p.photoId);
                  return (
                    <article
                      key={p.photoId}
                  className={`book-card${isSel ? ' selected' : ''}${!p.bookReady ? ' not-ready' : ''}`}
                >
                  <label className="book-card-check">
                    <input
                      type="checkbox"
                      checked={isSel}
                      disabled={!p.bookReady}
                      onChange={() => toggle(p.photoId)}
                    />
                  </label>
                  <div className="book-card-thumb">
                    {p.thumbnailUrl ? (
                      <img src={p.thumbnailUrl} alt={p.description || 'Billede'} loading="lazy" />
                    ) : (
                      <div className="thumb-placeholder">Behandles…</div>
                    )}
                    <span className="tile-short-id">{formatShortId(p.shortId)}</span>
                  </div>
                  <div className="book-card-body">
                    <p className="book-card-year">{fmtYear(p)}</p>
                    <p className="book-card-desc">
                      {p.description || <em>(ingen beskrivelse)</em>}
                    </p>
                    <p className="meta">
                      {p.houseNumbers.length > 0
                        ? `Hus ${p.houseNumbers.join(' · ')} · `
                        : p.activityName
                          ? `Aktivitet: ${p.activityName} · `
                          : ''}
                      {fmtBytes(p.bookBytes)}
                    </p>
                    {p.persons.length > 0 && (
                      <div className="person-chips">
                        {p.persons.map((person) => (
                          <span key={person.slug} className="person-chip">
                            {person.displayName}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="book-card-actions">
                      {p.bookReady && p.bookUrl ? (
                        <a
                          href={p.bookUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="book-download"
                        >
                          Hent enkelt JPEG
                        </a>
                      ) : (
                        <span className="meta" style={{ color: 'var(--danger)' }}>
                          Bog-version mangler — billedet skal behandles igen
                        </span>
                      )}
                      <Link to={`/galleri/${p.photoId}`} className="book-download">
                        Rediger / se detaljer
                      </Link>
                      {confirmDelete !== p.photoId && (
                        <button
                          type="button"
                          className="book-delete"
                          onClick={() => setConfirmDelete(p.photoId)}
                          disabled={deleting !== null}
                        >
                          Slet billede
                        </button>
                      )}
                    </div>
                    {confirmDelete === p.photoId && (
                      <div className="book-delete-confirm">
                        <p>
                          <strong>Slet billede permanent?</strong> Billedet og al historik forsvinder —
                          kan ikke fortrydes.
                        </p>
                        <div className="book-delete-actions">
                          <button
                            type="button"
                            className="danger"
                            onClick={() => runDelete(p.photoId)}
                            disabled={deleting === p.photoId}
                          >
                            {deleting === p.photoId ? 'Sletter…' : 'Ja, slet'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(null)}
                            disabled={deleting === p.photoId}
                          >
                            Fortryd
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
};
