import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getMyPhotos, setHelpWanted } from '../api';
import { useProfile } from '../profile';
import { useSession } from '../session';
import { formatShortId, type MyPhoto } from '../types';

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
  const { profile } = useProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [photos, setPhotos] = useState<MyPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingHelp, setSavingHelp] = useState<Record<string, boolean>>({});
  const justUploaded = searchParams.get('justUploaded') === '1';
  const isAdmin = profile?.groups.includes('admin') ?? false;
  const frozen = profile?.stage === 2 && !isAdmin;

  const toggleHelpWanted = async (photo: MyPhoto) => {
    if (!session) return;
    const next = !photo.helpWanted;
    setPhotos((prev) => prev?.map((p) => (p.photoId === photo.photoId ? { ...p, helpWanted: next } : p)) ?? prev);
    setSavingHelp((prev) => ({ ...prev, [photo.photoId]: true }));
    try {
      await setHelpWanted(session.idToken, photo.photoId, next);
    } catch (e) {
      // roll back
      setPhotos((prev) => prev?.map((p) => (p.photoId === photo.photoId ? { ...p, helpWanted: !next } : p)) ?? prev);
      setError(e instanceof Error ? e.message : 'Kunne ikke opdatere flag');
    } finally {
      setSavingHelp((prev) => {
        const copy = { ...prev };
        delete copy[photo.photoId];
        return copy;
      });
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

  return (
    <main className="content">
      <p className="eyebrow">Dine bidrag</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>Mine <em>billeder</em></h1>

      {justUploaded && <div className="ok">Tak! Billedet er sendt og venter på udvalgets gennemgang.</div>}

      {error && <div className="error">{error}</div>}

      {photos === null && !error && <p>Indlæser…</p>}

      {photos && photos.length === 0 && (
        <p>
          Du har ikke sendt nogen billeder endnu. <Link to="/upload">Upload dit første billede</Link>.
        </p>
      )}

      {photos && photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((p) => (
            <article key={p.photoId} className="photo-card">
              <div className="photo-card-row">
                <div className="thumb-wrap">
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
                </div>
                <div className="photo-card-body">
                  <h3>{p.description || <em>(ingen beskrivelse)</em>}</h3>
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
                  {p.status !== 'Rejected' && (
                    <div className="help-wanted-toggle">
                      <label>
                        <input
                          type="checkbox"
                          checked={p.helpWanted}
                          disabled={!!savingHelp[p.photoId] || frozen}
                          onChange={() => toggleHelpWanted(p)}
                        />
                        <span>
                          <strong>Hjælp søges</strong> — bed andre om hjælp til at identificere personerne
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
};
