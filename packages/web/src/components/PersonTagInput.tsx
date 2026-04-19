import { useEffect, useMemo, useRef, useState } from 'react';
import { listPersons } from '../api';
import { useSession } from '../session';
import type { PersonTag, PersonTagInput as TagInput } from '../types';

interface Props {
  value: TagInput[];
  onChange: (next: TagInput[]) => void;
  disabled?: boolean;
}

interface Option {
  kind: 'existing';
  person: PersonTag;
}

interface ProposeOption {
  kind: 'propose';
  displayName: string;
}

type DropdownRow = Option | ProposeOption;

const isProposal = (t: TagInput): t is { proposedName: string } =>
  'proposedName' in t && typeof t.proposedName === 'string';

export const PersonTagInput = ({ value, onChange, disabled }: Props) => {
  const { session } = useSession();
  const [catalog, setCatalog] = useState<PersonTag[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [focus, setFocus] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!session) return;
    let active = true;
    listPersons(session.idToken)
      .then((r) => {
        if (active) setCatalog(r.items);
      })
      .catch((e) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Kunne ikke hente personer');
      });
    return () => {
      active = false;
    };
  }, [session]);

  const selectedSlugs = useMemo(
    () => new Set(value.filter((t) => 'slug' in t && t.slug).map((t) => (t as { slug: string }).slug)),
    [value],
  );
  const selectedProposedLower = useMemo(
    () => new Set(value.filter(isProposal).map((t) => t.proposedName.trim().toLowerCase())),
    [value],
  );

  const catalogBySlug = useMemo(() => {
    const m = new Map<string, PersonTag>();
    for (const p of catalog) m.set(p.slug, p);
    return m;
  }, [catalog]);

  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  const dropdownRows: DropdownRow[] = useMemo(() => {
    if (!focus) return [];
    const matches = catalog
      .filter((p) => !selectedSlugs.has(p.slug))
      .filter((p) => !lower || p.displayName.toLowerCase().includes(lower))
      .slice(0, 8)
      .map<DropdownRow>((p) => ({ kind: 'existing', person: p }));

    const exactExisting = catalog.some((p) => p.displayName.toLowerCase() === lower);
    const alreadyProposed = selectedProposedLower.has(lower);
    const rows: DropdownRow[] = [...matches];
    if (trimmed && !exactExisting && !alreadyProposed) {
      rows.push({ kind: 'propose', displayName: trimmed });
    }
    return rows;
  }, [catalog, focus, lower, selectedProposedLower, selectedSlugs, trimmed]);

  useEffect(() => {
    setActiveIdx(0);
  }, [dropdownRows.length]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setFocus(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addExisting = (person: PersonTag) => {
    onChange([...value, { slug: person.slug }]);
    setInput('');
  };
  const addProposal = (displayName: string) => {
    onChange([...value, { proposedName: displayName }]);
    setInput('');
  };
  const removeAt = (idx: number) => {
    const next = value.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  const selectRow = (row: DropdownRow) => {
    if (row.kind === 'existing') addExisting(row.person);
    else addProposal(row.displayName);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(dropdownRows.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && dropdownRows[activeIdx]) {
      e.preventDefault();
      selectRow(dropdownRows[activeIdx]);
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeAt(value.length - 1);
    } else if (e.key === 'Escape') {
      setFocus(false);
    }
  };

  return (
    <div className="person-tag-input" ref={containerRef}>
      <div className={`chips${disabled ? ' disabled' : ''}`}>
        {value.map((t, idx) => {
          if ('slug' in t && t.slug) {
            const p = catalogBySlug.get(t.slug);
            const pending = p?.state === 'pending';
            const label = p?.displayName ?? t.slug;
            return (
              <span key={`s-${t.slug}`} className={`chip${pending ? ' chip-pending' : ''}`}>
                {label}
                {pending && <span className="chip-note">afventer godkendelse</span>}
                <button
                  type="button"
                  aria-label={`Fjern ${label}`}
                  onClick={() => removeAt(idx)}
                  disabled={disabled}
                >
                  ×
                </button>
              </span>
            );
          }
          if (isProposal(t)) {
            return (
              <span key={`p-${idx}-${t.proposedName}`} className="chip chip-pending">
                {t.proposedName}
                <span className="chip-note">nyt navn — afventer godkendelse</span>
                <button type="button" aria-label={`Fjern ${t.proposedName}`} onClick={() => removeAt(idx)} disabled={disabled}>
                  ×
                </button>
              </span>
            );
          }
          return null;
        })}
        <input
          type="text"
          value={input}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocus(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? 'Skriv et navn…' : ''}
          className="chip-input"
        />
      </div>

      {loadError && <div className="error">{loadError}</div>}

      {focus && dropdownRows.length > 0 && (
        <ul className="tag-dropdown" role="listbox">
          {dropdownRows.map((row, idx) => {
            if (row.kind === 'existing') {
              const pending = row.person.state === 'pending';
              return (
                <li
                  key={`r-${row.person.slug}`}
                  className={`tag-option${idx === activeIdx ? ' active' : ''}${pending ? ' tag-option-pending' : ''}`}
                  role="option"
                  aria-selected={idx === activeIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectRow(row);
                  }}
                >
                  {row.person.displayName}
                  {pending && <span className="tag-option-note">afventer godkendelse</span>}
                </li>
              );
            }
            return (
              <li
                key="r-propose"
                className={`tag-option tag-option-propose${idx === activeIdx ? ' active' : ''}`}
                role="option"
                aria-selected={idx === activeIdx}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectRow(row);
                }}
              >
                + Foreslå "{row.displayName}" som nyt navn
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
