import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { deleteDocument, listDocCategories, listDocuments, listMeetings } from '../api';
import { DocumentUploadForm } from '../components/DocumentUploadForm';
import { useSession } from '../session';
import type { DocCategoryRow, DocumentListItem, Meeting } from '../types';

const KIND_LABEL: Record<string, string> = {
  board: 'Bestyrelsesmøde',
  assembly: 'Generalforsamling',
};

const formatDate = (iso: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y}`;
  }
  return iso;
};

export const BestyrelsenMeetingDetailPage = () => {
  const { session } = useSession();
  const { id } = useParams();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [docs, setDocs] = useState<DocumentListItem[]>([]);
  const [categories, setCategories] = useState<DocCategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !id) return;
    setError(null);
    try {
      const [m, d, c] = await Promise.all([
        listMeetings(session.idToken),
        listDocuments(session.idToken, { meetingId: id }),
        listDocCategories(session.idToken),
      ]);
      setMeetings(m);
      setDocs(d.items);
      setCategories(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente mødet');
    }
  }, [session, id]);

  useEffect(() => {
    load();
  }, [load]);

  const meeting = useMemo(() => meetings.find((m) => m.meetingId === id) ?? null, [meetings, id]);

  const onDelete = async (d: DocumentListItem) => {
    if (!session) return;
    if (!confirm(`Slet "${d.title}"? Filen forsvinder permanent.`)) return;
    try {
      await deleteDocument(session.idToken, d.docId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke slette dokumentet');
    }
  };

  if (error) {
    return (
      <main className="content">
        <p>
          <Link to="/bestyrelse/moder">← Tilbage til møder</Link>
        </p>
        <h1>Møde</h1>
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      </main>
    );
  }
  if (!meeting) {
    return (
      <main className="content">
        <p>Indlæser…</p>
      </main>
    );
  }

  return (
    <main className="content">
      <p>
        <Link to="/bestyrelse/moder">← Tilbage til møder</Link>
      </p>

      <p className="eyebrow">{KIND_LABEL[meeting.kind] ?? meeting.kind}</p>
      <h1>{meeting.title}</h1>
      <dl className="doc-meta-list">
        <dt>Dato</dt>
        <dd>{formatDate(meeting.date)}</dd>
        {meeting.description && (
          <>
            <dt>Beskrivelse</dt>
            <dd>{meeting.description}</dd>
          </>
        )}
      </dl>

      <h2 style={{ marginTop: '2rem' }}>Dokumenter</h2>
      {docs.length === 0 && (
        <p style={{ color: 'var(--ink-soft)' }}>Ingen dokumenter knyttet til dette møde endnu.</p>
      )}
      {docs.length > 0 && (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.docId} className="doc-row">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.9rem 0.2rem',
                  gap: '1rem',
                  flexWrap: 'wrap',
                }}
              >
                <Link to={`/dokumenter/${d.docId}`} className="doc-link" style={{ padding: 0, flex: 1 }}>
                  <span className="doc-title">{d.title}</span>
                  <span className="doc-meta">
                    <span className="doc-pill">{d.category}</span>
                    {d.note && <span>· {d.note}</span>}
                  </span>
                </Link>
                <button type="button" className="btn-card" onClick={() => onDelete(d)}>
                  Slet
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: '2rem' }}>
        <DocumentUploadForm
          meetings={meetings}
          categories={categories}
          fixedMeetingId={meeting.meetingId}
          onUploaded={load}
        />
      </div>
    </main>
  );
};
