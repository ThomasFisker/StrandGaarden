import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { acceptGdpr, getGdprText, getMyProfile } from '../api';
import { useSession } from '../session';
import type { GdprText, MyProfile } from '../types';

/** Blocks every protected route until the caller has accepted the
 * current GDPR version. The text is fetched lazily — only when the
 * consent screen actually needs to render — so the common
 * already-accepted case stays a single /me round trip. */
export const GdprGate = ({ children }: { children: ReactNode }) => {
  const { session } = useSession();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [text, setText] = useState<GdprText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setError(null);
    getMyProfile(session.idToken)
      .then((p) => {
        if (active) setProfile(p);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Kunne ikke hente profil');
      });
    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (!session || !profile?.gdprNeedsAcceptance) return;
    let active = true;
    getGdprText(session.idToken)
      .then((t) => {
        if (active) setText(t);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Kunne ikke hente samtykke-tekst');
      });
    return () => {
      active = false;
    };
  }, [profile?.gdprNeedsAcceptance, session]);

  const onAccept = useCallback(async () => {
    if (!session || !text) return;
    setSubmitting(true);
    setError(null);
    try {
      await acceptGdpr(session.idToken, text.version);
      const updated = await getMyProfile(session.idToken);
      setProfile(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke gemme samtykke');
    } finally {
      setSubmitting(false);
    }
  }, [session, text]);

  if (error && !profile) {
    return (
      <main className="content">
        <div className="error">{error}</div>
      </main>
    );
  }
  if (!profile) {
    return (
      <main className="content">
        <p>Indlæser…</p>
      </main>
    );
  }
  if (!profile.gdprNeedsAcceptance) return <>{children}</>;
  if (!text) {
    return (
      <main className="content">
        <p>Indlæser samtykke…</p>
      </main>
    );
  }

  return (
    <main className="content">
      <p className="eyebrow">Samtykke</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Læs og <em>accepter</em>
      </h1>
      <p className="lede">
        Inden du bruger jubilæumsarkivet, beder vi dig læse og acceptere samtykket. Du
        behøver kun gøre dette én gang — eller igen, hvis udvalget opdaterer teksten.
      </p>
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          fontFamily: 'inherit',
          fontSize: '1.05rem',
          lineHeight: 1.55,
          background: 'var(--paper-warm, #faf2e6)',
          padding: '1.5rem 1.75rem',
          borderLeft: '3px solid var(--copper, #b85a2a)',
          margin: '1.5rem 0',
          maxHeight: '55vh',
          overflow: 'auto',
        }}
      >
        {text.text}
      </pre>
      {error && <div className="error">{error}</div>}
      <button
        type="button"
        className="btn-primary"
        onClick={onAccept}
        disabled={submitting}
        style={{ marginTop: '0.5rem' }}
      >
        {submitting ? 'Gemmer…' : 'Accepter'}
      </button>
    </main>
  );
};
