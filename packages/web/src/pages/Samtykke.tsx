import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getGdprText } from '../api';
import { useProfile } from '../profile';
import { useSession } from '../session';
import type { GdprText } from '../types';

const prettyDate = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('da-DK', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
};

export const SamtykkePage = () => {
  const { session } = useSession();
  const { profile } = useProfile();
  const [text, setText] = useState<GdprText | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let active = true;
    getGdprText(session.idToken)
      .then((t) => {
        if (active) setText(t);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Kunne ikke hente samtykket');
      });
    return () => {
      active = false;
    };
  }, [session]);

  const accepted =
    profile && profile.gdprAcceptedAt && profile.gdprAcceptedVersion === text?.version;
  const acceptedOlder =
    profile && profile.gdprAcceptedAt && profile.gdprAcceptedVersion !== text?.version;

  return (
    <main className="content">
      <p className="eyebrow">Samtykke</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Vilkår &amp; <em>samtykke</em>
      </h1>
      <p className="lede">
        Her kan du genlæse det samtykke du accepterede ved første login. Det styrer, hvad
        billederne i jubilæumsarkivet må bruges til.
      </p>

      {error && <div className="error">{error}</div>}
      {!text && !error && <p>Indlæser…</p>}

      {profile && profile.gdprAcceptedAt && (
        <div
          className="ok"
          style={{ marginTop: '1rem' }}
        >
          {accepted ? (
            <>
              Du accepterede den nuværende version den{' '}
              <strong>{prettyDate(profile.gdprAcceptedAt)}</strong>.
            </>
          ) : acceptedOlder ? (
            <>
              Du accepterede en tidligere version den{' '}
              <strong>{prettyDate(profile.gdprAcceptedAt)}</strong>. Du bliver bedt om at
              acceptere igen næste gang du åbner siden.
            </>
          ) : null}
        </div>
      )}

      {text && (
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
          }}
        >
          {text.text}
        </pre>
      )}

      <p className="help">
        Aktuel version: <code>{text?.version ?? '—'}</code>. Hvis udvalget opdaterer teksten,
        bliver du bedt om at acceptere den nye version ved næste login.{' '}
        <Link to="/mine">Tilbage til Mine billeder</Link>.
      </p>
    </main>
  );
};
