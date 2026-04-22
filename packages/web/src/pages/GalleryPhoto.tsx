import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getGalleryPhoto } from '../api';
import { useSession } from '../session';
import type { GalleryDetail } from '../types';

export const GalleryPhotoPage = () => {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<GalleryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            <p className="eyebrow">Strandgaardens arkiv</p>
            <p className="photo-year">
              {photo.yearApprox && photo.year && <em>ca.</em>}
              {photo.year ?? '—'}
            </p>
            <p className="photo-meta-line">
              {photo.houseNumbers.length > 0 ? `Hus ${photo.houseNumbers.join(' · ')}` : 'Hus ukendt'}
              {photo.width && photo.height ? ` — ${photo.width}×${photo.height}px` : ''}
            </p>
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

            <div className="photo-actions">
              {photo.downloadUrl && (
                <a href={photo.downloadUrl} className="btn-primary">
                  Hent billedet <span className="arrow">↓</span>
                </a>
              )}
              <span className="link-muted" style={{ cursor: 'default' }}>
                Anmod om fjernelse — kommer snart
              </span>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
};
