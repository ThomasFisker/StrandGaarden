import { useEffect, useState } from 'react';
import { listHouseTexts } from '../api';
import { useSession } from '../session';
import type { AdminHouseTextRow } from '../types';

const prettyDate = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('da-DK', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
};

export const AdminHouseTextsPage = () => {
  const { session } = useSession();
  const [items, setItems] = useState<AdminHouseTextRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let active = true;
    listHouseTexts(session.idToken)
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Kunne ikke hente teksterne');
      });
    return () => {
      active = false;
    };
  }, [session]);

  const written = items ? items.filter((r) => r.body && r.body.trim().length > 0).length : 0;

  return (
    <main className="content">
      <p className="eyebrow">Administration</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Hus<em>tekster</em>
      </h1>
      <p className="lede">
        Hvert hus skriver et kort afsnit til bogen. Medlemmer redigerer teksten på siden{' '}
        <strong>Mine billeder</strong>; her ser udvalget alle 23 huse samlet.
        {items && (
          <>
            {' '}
            <span className="subtle">
              ({written} af {items.length} huse har skrevet noget.)
            </span>
          </>
        )}
      </p>

      {error && <div className="error">{error}</div>}
      {items === null && !error && <p>Indlæser…</p>}

      {items && (
        <div style={{ marginTop: '1.5rem', display: 'grid', gap: '0.75rem' }}>
          {items.map((row) => {
            const hasBody = row.body && row.body.trim().length > 0;
            return (
              <article
                key={row.houseNumber}
                style={{
                  padding: '1rem 1.25rem',
                  background: hasBody ? 'var(--paper-warm, #faf2e6)' : 'transparent',
                  border: hasBody
                    ? '1px solid transparent'
                    : '1px dashed var(--border, #d8cfbc)',
                  borderLeft: hasBody ? '3px solid var(--copper, #b85a2a)' : undefined,
                }}
              >
                <header
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: '1rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong>Hus {row.houseNumber}</strong>
                  <span className="subtle" style={{ fontSize: '0.9rem' }}>
                    {hasBody ? (
                      <>
                        Senest redigeret {prettyDate(row.lastEditedAt)}
                        {row.lastEditedByLoginName ? ` af ${row.lastEditedByLoginName}` : ''}
                      </>
                    ) : (
                      <em>Ikke skrevet endnu</em>
                    )}
                  </span>
                </header>
                {hasBody && (
                  <p
                    style={{
                      margin: '0.5rem 0 0',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                    }}
                  >
                    {row.body}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
};
