import { useEffect, useMemo, useState } from 'react';
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

export const AdminBookPage = () => {
  const { session } = useSession();
  const [photos, setPhotos] = useState<BookPhoto[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<BookExportResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

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
    setSelected(new Set(photos.filter((p) => p.bookReady).map((p) => p.photoId)));
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
          <div className="book-actions">
            <div className="book-actions-row">
              <button type="button" onClick={selectAll} disabled={exporting}>
                Vælg alle ({photos.filter((p) => p.bookReady).length})
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

          <div className="book-grid">
            {photos.map((p) => {
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
                      {p.houseNumbers.length > 0 ? `Hus ${p.houseNumbers.join(' · ')} · ` : ''}
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
        </>
      )}
    </main>
  );
};
