import { HOUSES } from '../types';

interface Props {
  value: number[];
  onToggle: (n: number) => void;
}

export const HouseSelector = ({ value, onToggle }: Props) => {
  const selected = new Set(value);
  return (
    <div className="houses" role="group" aria-label="Hus nr.">
      {HOUSES.map((n) => (
        <button
          key={n}
          type="button"
          className={selected.has(n) ? 'on' : undefined}
          aria-pressed={selected.has(n)}
          onClick={() => onToggle(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
};
