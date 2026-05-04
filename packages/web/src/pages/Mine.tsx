import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getMyPhotos, setHelpWanted, updateHouseText } from '../api';
import { RichTextEditor } from '../components/RichTextEditor';
import { useProfile } from '../profile';
import { useSession } from '../session';
import { formatShortId, type MyPhoto } from '../types';

/** Roughly count visible characters in an HTML string by stripping tags
 * and decoding common entities. The server's authoritative validation
 * uses the same shape (strip-then-count) so the two stay in sync. */
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
  const { profile, refresh: refreshProfile } = useProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [photos, setPhotos] = useState<MyPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingHelp, setSavingHelp] = useState<Record<string, boolean>>({});
  const justUploaded = searchParams.get('justUploaded') === '1';
  const isAdmin = profile?.groups.includes('admin') ?? false;
  const frozen = profile?.stage === 2 && !isAdmin;

  // House-text editor state. Initialized from profile.myHouseText once
  // the profile loads; tracked locally so we can show dirty state.
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

      {profile && profile.houseNumber !== null && (
        <section
          style={{
            marginTop: '1.5rem',
            padding: '1.25rem 1.5rem',
            background: 'var(--paper-warm, #faf2e6)',
            borderLeft: '3px solid var(--copper, #b85a2a)',
          }}
        >
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
      )}

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
