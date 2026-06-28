import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { listHouseTexts } from '../api';
import { useSession } from '../session';
import type { AdminHouseTextRow } from '../types';

const ALLOWED_TAGS = ['p', 'br', 'b', 'strong', 'i', 'em', 'h2'];
const renderBody = (raw: string): string =>
  DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR: [] });

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
  const ready = items ? items.filter((r) => r.bookReady).length : 0;

  return (
    <main className="content">
      <p className="eyebrow">Administration</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Hus<em>tekster</em>
      </h1>
      <p className="lede">
        Hvert hus skriver et kort afsnit til bogen og kan melde sig <strong>klar</strong>, når
        de er færdige. Medlemmer gør begge dele på siden <strong>Mine billeder</strong>; her ser
        redaktionen alle 23 huse samlet.
        {items && (
          <>
            {' '}
            <span className="subtle">
              ({ready} af {items.length} huse er meldt klar · {written} har skrevet tekst.)
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
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <strong>Hus {row.houseNumber}</strong>
                    {row.bookReady ? (
                      <span
                        style={{
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          color: 'var(--sage, #6b8f71)',
                          border: '1px solid var(--sage, #6b8f71)',
                          borderRadius: '999px',
                          padding: '0.05rem 0.55rem',
                          whiteSpace: 'nowrap',
                        }}
                        title={
                          row.bookReadyAt
                            ? `Meldt klar ${prettyDate(row.bookReadyAt)}${
                                row.bookReadyByLoginName ? ` af ${row.bookReadyByLoginName}` : ''
                              }`
                            : 'Meldt klar'
                        }
                      >
                        ✓ Klar til bogen
                      </span>
                    ) : (
                      <span className="subtle" style={{ fontSize: '0.8rem' }}>
                        Ikke meldt klar
                      </span>
                    )}
                  </span>
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
                  <div
                    style={{ marginTop: '0.5rem', fontFamily: 'inherit' }}
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: renderBody(row.body!) }}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
};
