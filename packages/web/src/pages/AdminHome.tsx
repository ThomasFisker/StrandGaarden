import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getConfig,
  getReviewQueue,
  listActivities,
  listBookPhotos,
  listPendingComments,
  listPendingRemovals,
  listPersons,
} from '../api';
import { useSession } from '../session';
import type { Stage } from '../types';

interface Counts {
  review: number | null;
  comments: number | null;
  removals: number | null;
  book: number | null;
  personsPending: number | null;
  activities: number | null;
  stage: Stage | null;
}

const EMPTY: Counts = {
  review: null,
  comments: null,
  removals: null,
  book: null,
  personsPending: null,
  activities: null,
  stage: null,
};

interface Card {
  to: string;
  title: string;
  description: string;
  badge: number | null;
  badgeLabel: string;
}

export const AdminHomePage = () => {
  const { session } = useSession();
  const [counts, setCounts] = useState<Counts>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let active = true;
    (async () => {
      try {
        const [review, comments, removals, book, persons, activities, config] = await Promise.all([
          getReviewQueue(session.idToken).catch(() => null),
          listPendingComments(session.idToken).catch(() => null),
          listPendingRemovals(session.idToken).catch(() => null),
          listBookPhotos(session.idToken).catch(() => null),
          listPersons(session.idToken).catch(() => null),
          listActivities(session.idToken).catch(() => null),
          getConfig(session.idToken).catch(() => null),
        ]);
        if (!active) return;
        setCounts({
          review: review ? review.length : null,
          comments: comments ? comments.length : null,
          removals: removals ? removals.length : null,
          book: book ? book.length : null,
          personsPending: persons ? persons.items.filter((p) => p.state === 'pending').length : null,
          activities: activities ? activities.length : null,
          stage: config ? config.stage : null,
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
      to: '/admin/fase',
      title: 'Fase',
      description: 'Sæt fasen for siden (1: indsamling, 2: frys, 3: offentlig). Rediger GDPR-tekst og tærskler.',
      badge: counts.stage,
      badgeLabel: 'aktuel fase',
    },
    {
      to: '/review',
      title: 'Gennemgang',
      description: 'Nye billeder til godkendelse — beslut om de skal på web og/eller i bogen.',
      badge: counts.review,
      badgeLabel: 'afventer',
    },
    {
      to: '/admin/kommentarer',
      title: 'Kommentarer',
      description: 'Tilføjelser fra læsere — flet ind i beskrivelsen, vis som citat, eller afvis.',
      badge: counts.comments,
      badgeLabel: 'afventer',
    },
    {
      to: '/admin/fjernelser',
      title: 'Fjernelser',
      description: 'GDPR-anmodninger om at slette et billede — godkend eller afvis.',
      badge: counts.removals,
      badgeLabel: 'afventer',
    },
    {
      to: '/admin/bog',
      title: 'Bog',
      description: 'Billeder udvalgt til jubilæumsbogen. Eksportér JPEG (<2 MB) enkeltvis eller som ZIP.',
      badge: counts.book,
      badgeLabel: 'udvalgt',
    },
    {
      to: '/admin/aktiviteter',
      title: 'Aktiviteter',
      description: 'Nøgleord til aktiviteter (Sankt Hans, Vejdag, Generalforsamling …) — bruges i fase 1 til at gruppere billeder uden hus-tilknytning.',
      badge: counts.activities,
      badgeLabel: 'i listen',
    },
    {
      to: '/admin/personer',
      title: 'Personer',
      description: 'Godkend foreslåede navne, omdøb eller slet personer fra billedarkivet.',
      badge: counts.personsPending,
      badgeLabel: 'foreslået',
    },
    {
      to: '/admin/hustekster',
      title: 'Hustekster',
      description: 'Hver hus kan skrive en kort tekst til bogen. Aktiveres i fase 1.',
      badge: null,
      badgeLabel: '',
    },
    {
      to: '/admin/users',
      title: 'Brugere',
      description: 'Opret nye medlemmer, administrér adgang, navne, kodeord og hus-nummer.',
      badge: null,
      badgeLabel: '',
    },
  ];

  return (
    <main className="content">
      <p className="eyebrow">Udvalget</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Udvalgs<em>arbejde</em>
      </h1>
      <p className="lede">
        Alt redaktionsarbejde samlet ét sted. Klik på en boks for at se afventende opgaver.
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
