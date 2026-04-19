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
    <main className="content wide">
      <p>
        <Link to="/galleri">← Tilbage til galleriet</Link>
      </p>

      {error && <div className="error">{error}</div>}
      {!photo && !error && <p>Indlæser…</p>}

      {photo && (
        <article>
          {photo.webUrl && (
            <img
              src={photo.webUrl}
              alt={photo.description || 'Strandgaarden billede'}
              className="gallery-full"
              width={photo.width ?? undefined}
              height={photo.height ?? undefined}
            />
          )}
          <h1>{photo.description || <em>(uden beskrivelse)</em>}</h1>
          <p className="meta">
            {photo.year ? `${photo.yearApprox ? 'ca. ' : ''}${photo.year} · ` : ''}
            Hus {photo.houseNumbers.join(', ')}
            {photo.width && photo.height ? ` · ${photo.width}×${photo.height}px` : ''}
          </p>
          {photo.whoInPhoto && (
            <p>
              <strong>Hvem er på billedet:</strong> {photo.whoInPhoto}
            </p>
          )}
          {photo.persons.length > 0 && (
            <div style={{ margin: '0.5rem 0' }}>
              <strong style={{ marginRight: '0.5rem' }}>Tags:</strong>
              <div className="person-chips" style={{ display: 'inline-flex', margin: 0 }}>
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
          {photo.downloadUrl && (
            <p style={{ marginTop: '1rem' }}>
              <a href={photo.downloadUrl} className="download-btn">
                Hent billedet (JPEG)
              </a>
            </p>
          )}
        </article>
      )}
    </main>
  );
};
