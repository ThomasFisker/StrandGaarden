import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteDocument, listDocCategories, listDocuments, listMeetings } from '../api';
import { DocumentUploadForm } from '../components/DocumentUploadForm';
import { useSession } from '../session';
import type { DocCategoryRow, DocumentListItem, Meeting } from '../types';

export const BestyrelsenDocumentsPage = () => {
  const { session } = useSession();
  const [docs, setDocs] = useState<DocumentListItem[] | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [categories, setCategories] = useState<DocCategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const [d, m, c] = await Promise.all([
        listDocuments(session.idToken),
        listMeetings(session.idToken),
        listDocCategories(session.idToken),
      ]);
      setDocs(d.items);
      setMeetings(m);
      setCategories(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente dokumenter');
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <main className="content">
      <p>
        <Link to="/bestyrelse">← Tilbage til Bestyrelsen</Link>
      </p>
      <p className="eyebrow">Bestyrelsen</p>
      <h1>Dokumenter</h1>
      <p className="lede">
        Upload selvstændige dokumenter (sange, historiske dokumenter osv.). Dokumenter knyttet til
        et bestemt møde uploades fra mødets side.
      </p>

      {error && <div className="error">{error}</div>}

      <div style={{ marginTop: '1.5rem' }}>
        <DocumentUploadForm meetings={meetings} categories={categories} onUploaded={load} />
      </div>

      <h2 style={{ marginTop: '2rem' }}>Alle dokumenter</h2>
      {docs === null && <p>Indlæser…</p>}
      {docs && docs.length === 0 && (
        <p style={{ color: 'var(--ink-soft)' }}>Ingen dokumenter endnu.</p>
      )}
      {docs && docs.length > 0 && (
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
                    {d.year !== null && <span>· {d.year}</span>}
                    {d.meetingId && (
                      <span>· tilknyttet møde</span>
                    )}
                  </span>
                  {d.summary && (
                    <span className="doc-summary-excerpt">
                      {d.summary.length > 180
                        ? `${d.summary.slice(0, 180).trimEnd()}…`
                        : d.summary}
                    </span>
                  )}
                </Link>
                <button type="button" className="btn-card" onClick={() => onDelete(d)}>
                  Slet
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
};
