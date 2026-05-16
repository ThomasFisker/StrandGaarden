import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listDocuments, listMeetings } from '../api';
import { useSession } from '../session';
import type { DocumentList, DocumentListItem, Meeting } from '../types';

const MEETING_KIND_LABEL: Record<string, string> = {
  board: 'Bestyrelsesmøde',
  assembly: 'Generalforsamling',
};

const formatDate = (iso: string): string => {
  // YYYY-MM-DD → DD-MM-YYYY (Danish convention)
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y}`;
  }
  return iso;
};

export const DocumentsPage = () => {
  const { session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<DocumentList | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(() => {
    const v = searchParams.get('year');
    return v ? Number(v) : null;
  });
  const [category, setCategory] = useState<string>(() => searchParams.get('category') ?? '');
  const [meetingId, setMeetingId] = useState<string>(() => searchParams.get('meetingId') ?? '');
  const [q, setQ] = useState<string>(() => searchParams.get('q') ?? '');

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const [docs, mts] = await Promise.all([
        listDocuments(session.idToken, {
          year: year ?? undefined,
          category: category || undefined,
          meetingId: meetingId || undefined,
          q: q || undefined,
        }),
        listMeetings(session.idToken),
      ]);
      setData(docs);
      setMeetings(mts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente dokumenter');
    }
  }, [session, year, category, meetingId, q]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (year !== null) next.set('year', String(year));
    if (category) next.set('category', category);
    if (meetingId) next.set('meetingId', meetingId);
    if (q) next.set('q', q);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [year, category, meetingId, q, searchParams, setSearchParams]);

  const meetingMap = useMemo(() => {
    const m = new Map<string, Meeting>();
    for (const x of meetings) m.set(x.meetingId, x);
    return m;
  }, [meetings]);

  const clearFilters = () => {
    setYear(null);
    setCategory('');
    setMeetingId('');
    setQ('');
  };

  const hasFilter = year !== null || category !== '' || meetingId !== '' || q !== '';

  if (error) {
    return (
      <main className="content">
        <h1>Dokumenter</h1>
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      </main>
    );
  }

  return (
    <main className="content">
      <p className="eyebrow">Strandgaarden</p>
      <h1>Dokumenter</h1>
      <p className="lede">
        Referater, mødeindkaldelser, årsregnskaber og historiske dokumenter fra fællesskabet.
      </p>

      <section className="gallery-filters" style={{ marginTop: '1.5rem' }}>
        <div className="filter-row">
          <label>
            <span>Søg</span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Titel, tag eller note…"
            />
          </label>
          <label>
            <span>År</span>
            <select
              value={year === null ? '' : String(year)}
              onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Alle år</option>
              {data?.filters.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Kategori</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Alle kategorier</option>
              {data?.filters.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Møde</span>
            <select value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
              <option value="">Alle møder</option>
              {meetings.map((m) => (
                <option key={m.meetingId} value={m.meetingId}>
                  {MEETING_KIND_LABEL[m.kind] ?? m.kind}: {m.title} ({formatDate(m.date)})
                </option>
              ))}
            </select>
          </label>
          {hasFilter && (
            <button type="button" className="btn-card" onClick={clearFilters}>
              Nulstil
            </button>
          )}
        </div>
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        {data === null && <p>Indlæser…</p>}
        {data && data.items.length === 0 && (
          <p style={{ color: 'var(--ink-soft)' }}>
            {hasFilter
              ? 'Ingen dokumenter matcher det valgte filter.'
              : 'Der er ikke uploadet nogen dokumenter endnu.'}
          </p>
        )}
        {data && data.items.length > 0 && (
          <ul className="doc-list">
            {data.items.map((d: DocumentListItem) => {
              const m = d.meetingId ? meetingMap.get(d.meetingId) : null;
              return (
                <li key={d.docId} className="doc-row">
                  <Link to={`/dokumenter/${d.docId}`} className="doc-link">
                    <span className="doc-title">{d.title}</span>
                    <span className="doc-meta">
                      <span className="doc-pill">{d.category}</span>
                      {d.year !== null && <span>· {d.year}</span>}
                      {m && (
                        <span>
                          · {MEETING_KIND_LABEL[m.kind] ?? m.kind}: {m.title}
                        </span>
                      )}
                      {d.tags.length > 0 && <span>· {d.tags.join(', ')}</span>}
                    </span>
                    {d.summary && (
                      <span className="doc-summary-excerpt">
                        {d.summary.length > 180
                          ? `${d.summary.slice(0, 180).trimEnd()}…`
                          : d.summary}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
};
