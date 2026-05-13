import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getDocument } from '../api';
import { useSession } from '../session';
import type { DocumentDetail as DocDetail } from '../types';

const MEETING_KIND_LABEL: Record<string, string> = {
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

const formatDateTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleString('da-DK', { dateStyle: 'long', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

export const DocumentDetailPage = () => {
  const { session } = useSession();
  const { id } = useParams();
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !id) return;
    setError(null);
    try {
      setDoc(await getDocument(session.idToken, id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente dokumentet');
    }
  }, [session, id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <main className="content">
        <p>
          <Link to="/dokumenter">← Tilbage til dokumenter</Link>
        </p>
        <h1>Dokument</h1>
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      </main>
    );
  }
  if (!doc) {
    return (
      <main className="content">
        <p>Indlæser…</p>
      </main>
    );
  }

  return (
    <main className="content">
      <p>
        <Link to="/dokumenter">← Tilbage til dokumenter</Link>
      </p>

      <p className="eyebrow">{doc.category}</p>
      <h1>{doc.title}</h1>

      <dl className="doc-meta-list">
        {doc.year !== null && (
          <>
            <dt>År</dt>
            <dd>{doc.year}</dd>
          </>
        )}
        {doc.meeting && (
          <>
            <dt>Møde</dt>
            <dd>
              {MEETING_KIND_LABEL[doc.meeting.kind] ?? doc.meeting.kind}: {doc.meeting.title} ({formatDate(doc.meeting.date)})
            </dd>
          </>
        )}
        {doc.tags.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd>{doc.tags.join(', ')}</dd>
          </>
        )}
        {doc.note && (
          <>
            <dt>Note</dt>
            <dd>{doc.note}</dd>
          </>
        )}
        <dt>Filnavn</dt>
        <dd>{doc.originalFilename}</dd>
        <dt>Uploadet</dt>
        <dd>{formatDateTime(doc.uploadedAt)}{doc.uploadedByEmail ? ` af ${doc.uploadedByEmail}` : ''}</dd>
      </dl>

      <div style={{ marginTop: '1.5rem' }}>
        <a className="btn-primary" href={doc.downloadUrl} target="_blank" rel="noreferrer">
          Hent dokument
        </a>
        <p className="help" style={{ marginTop: '0.5rem' }}>
          Linket er gyldigt i {Math.round(doc.downloadExpiresIn / 60)} minutter. Genindlæs siden hvis det udløber.
        </p>
      </div>
    </main>
  );
};
