import type { Stage } from '../types';

const COPY: Record<Stage, { eyebrow: string; body: string } | null> = {
  1: {
    eyebrow: 'Fase 1 — Indsamling til bog',
    body:
      'Vi samler billeder ind til jubilæumsbogen. Galleriet åbner først senere — for nu er det udvalget der gennemgår de indsendte billeder.',
  },
  2: {
    eyebrow: 'Frys — udvalget arbejder på bogen',
    body:
      'Siden er låst i denne periode. Du kan se det du allerede har uploadet, men ikke uploade nye, kommentere eller anmode om fjernelse. Vi åbner igen efter bog-deadline.',
  },
  3: null,
};

export const StageBanner = ({ stage }: { stage: Stage }) => {
  const copy = COPY[stage];
  if (!copy) return null;
  return (
    <div
      role="note"
      style={{
        background: 'var(--paper-warm, #faf2e6)',
        borderLeft: '4px solid var(--copper, #b85a2a)',
        padding: '0.85rem 1.25rem',
        margin: '0 0 0',
      }}
    >
      <p
        className="eyebrow"
        style={{ margin: 0, color: 'var(--copper, #b85a2a)' }}
      >
        {copy.eyebrow}
      </p>
      <p style={{ margin: '0.25rem 0 0', fontSize: '0.97rem' }}>{copy.body}</p>
    </div>
  );
};
