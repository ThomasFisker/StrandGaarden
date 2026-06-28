import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listDocCategories, listDocuments, listMeetings } from '../api';
import { isAdministrator } from '../permissions';
import { useSession } from '../session';

interface Counts {
  meetings: number | null;
  documents: number | null;
  categories: number | null;
}

const EMPTY: Counts = { meetings: null, documents: null, categories: null };

interface Card {
  to: string;
  title: string;
  description: string;
  badge: number | null;
  badgeLabel: string;
}

export const BestyrelsenPage = () => {
  const { session } = useSession();
  const [counts, setCounts] = useState<Counts>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = session ? isAdministrator(session.claims) : false;

  useEffect(() => {
    if (!session) return;
    let active = true;
    (async () => {
      try {
        const [meetings, documents, categories] = await Promise.all([
          listMeetings(session.idToken).catch(() => null),
          listDocuments(session.idToken).catch(() => null),
          listDocCategories(session.idToken).catch(() => null),
        ]);
        if (!active) return;
        setCounts({
          meetings: meetings ? meetings.length : null,
          documents: documents ? documents.items.length : null,
          categories: categories ? categories.length : null,
        });
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Kunne ikke hente tal');
      }
    })();
    return () => {
      active = false;
    };
  }, [session]);

  const cards: Card[] = [
    {
      to: '/bestyrelse/hjaelp',
      title: 'Hjælp',
      description: 'Vejledning til møder, dokumenter, brugere og roller — og hvad du skal være opmærksom på før upload.',
      badge: null,
      badgeLabel: '',
    },
    {
      to: '/bestyrelse/moder',
      title: 'Møder',
      description:
        'Bestyrelsesmøder og generalforsamlinger. Opret et møde og knyt referater, indkaldelser og bilag.',
      badge: counts.meetings,
      badgeLabel: 'møder',
    },
    {
      to: '/bestyrelse/dokumenter',
      title: 'Dokumenter',
      description:
        'Upload selvstændige dokumenter (sange, historiske dokumenter osv.) eller redigér eksisterende.',
      badge: counts.documents,
      badgeLabel: 'i alt',
    },
    {
      to: '/admin/users',
      title: 'Brugere',
      description: 'Opret nye medlemmer, administrér roller, navne, kodeord og hus-nummer.',
      badge: null,
      badgeLabel: '',
    },
    ...(isAdmin
      ? [
          {
            to: '/bestyrelse/dokument-kategorier',
            title: 'Dokument-kategorier',
            description:
              'Administrator-værktøj: tilføj, omdøb eller slet kategorier på dokument-uploadformularen.',
            badge: counts.categories,
            badgeLabel: 'kategorier',
          } satisfies Card,
        ]
      : []),
  ];

  return (
    <main className="content">
      <p className="eyebrow">Bestyrelsen</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Bestyrelses<em>arbejde</em>
      </h1>
      <p className="lede">
        Møder, dokumenter og brugeradministration. Alt det der ikke handler om billeder.
      </p>

      {error && <div className="error">{error}</div>}

      <div className="admin-hub-grid">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} className="admin-hub-card">
            <div className="admin-hub-card-head">
              <h2 className="admin-hub-title">{c.title}</h2>
              {c.badge !== null && c.badge > 0 && (
                <span className="admin-hub-badge" title={c.badgeLabel}>
                  {c.badge}
                </span>
              )}
            </div>
            <p className="admin-hub-desc">{c.description}</p>
            <p className="admin-hub-cta">
              Åbn <span aria-hidden>→</span>
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
};
