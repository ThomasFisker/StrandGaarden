import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getDocument,
  listDocCategories,
  listMeetings,
  updateDocument,
} from '../api';
import { canManageDocs } from '../permissions';
import { useSession } from '../session';
import type { DocCategoryRow, DocumentDetail as DocDetail, Meeting } from '../types';

const MEETING_KIND_LABEL: Record<string, string> = {
  board: 'Bestyrelsesmøde',
  assembly: 'Generalforsamling',
};

const CURRENT_YEAR = new Date().getUTCFullYear();

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

interface EditState {
  title: string;
  category: string;
  year: string;
  meetingId: string;
  note: string;
  tagsRaw: string;
}

export const DocumentDetailPage = () => {
  const { session } = useSession();
  const { id } = useParams();
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [categories, setCategories] = useState<DocCategoryRow[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canEdit = session ? canManageDocs(session.claims) : false;

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

  const openEdit = async () => {
    if (!session || !doc) return;
    setEditError(null);
    try {
      // Lazy-load meetings + categories the first time edit is opened, so
      // the read-only path stays a single fetch.
      const [m, c] = await Promise.all([
        listMeetings(session.idToken),
        listDocCategories(session.idToken),
      ]);
      setMeetings(m);
      setCategories(c);
      setEdit({
        title: doc.title,
        category: doc.category,
        year: doc.year !== null ? String(doc.year) : String(CURRENT_YEAR),
        meetingId: doc.meetingId ?? '',
        note: doc.note ?? '',
        tagsRaw: doc.tags.join(', '),
      });
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Kunne ikke åbne redigering');
    }
  };

  const cancelEdit = () => {
    setEdit(null);
    setEditError(null);
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !doc || !edit) return;
    const title = edit.title.trim();
    if (!title) {
      setEditError('Titel skal udfyldes.');
      return;
    }
    if (!edit.category) {
      setEditError('Vælg en kategori.');
      return;
    }
    const yearNum = Number(edit.year);
    if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > CURRENT_YEAR + 1) {
      setEditError(`År skal være mellem 1900 og ${CURRENT_YEAR + 1}.`);
      return;
    }
    const tags = edit.tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    setSaving(true);
    setEditError(null);
    try {
      await updateDocument(session.idToken, doc.docId, {
        title,
        category: edit.category,
        year: yearNum,
        meetingId: edit.meetingId || null,
        note: edit.note.trim() || undefined,
        tags,
      });
      setEdit(null);
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Kunne ikke gemme ændringerne');
    } finally {
      setSaving(false);
    }
  };

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

      {!edit ? (
        <>
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

          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <a className="btn-primary" href={doc.downloadUrl} target="_blank" rel="noreferrer">
              Hent dokument
            </a>
            {canEdit && (
              <button type="button" className="btn-card" onClick={openEdit}>
                ✎ Rediger
              </button>
            )}
          </div>
          {editError && <div className="error" style={{ marginTop: '0.5rem' }}>{editError}</div>}
          <p className="help" style={{ marginTop: '0.5rem' }}>
            Hent-linket er gyldigt i {Math.round(doc.downloadExpiresIn / 60)} minutter. Genindlæs siden hvis det udløber.
          </p>
        </>
      ) : (
        <form onSubmit={onSave} className="card" style={{ marginTop: '1rem', padding: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>Rediger dokument</h2>
          {editError && <div className="error">{editError}</div>}
          <div className="field">
            <label htmlFor="edit-title">Titel</label>
            <input
              id="edit-title"
              type="text"
              value={edit.title}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              maxLength={200}
              required
              disabled={saving}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-cat">Kategori</label>
            <select
              id="edit-cat"
              value={edit.category}
              onChange={(e) => setEdit({ ...edit, category: e.target.value })}
              disabled={saving || categories.length === 0}
            >
              {/* If the current value isn't in the catalog (deleted
                  category), surface it as a one-off option so the user
                  doesn't lose context. */}
              {!categories.some((c) => c.displayName === edit.category) && edit.category && (
                <option value={edit.category}>{edit.category} (slettet kategori)</option>
              )}
              {categories.map((c) => (
                <option key={c.key} value={c.displayName}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="edit-year">År</label>
            <input
              id="edit-year"
              type="number"
              min={1900}
              max={CURRENT_YEAR + 1}
              value={edit.year}
              onChange={(e) => setEdit({ ...edit, year: e.target.value })}
              disabled={saving}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="edit-meeting">Tilknyt møde (valgfri)</label>
            <select
              id="edit-meeting"
              value={edit.meetingId}
              onChange={(e) => setEdit({ ...edit, meetingId: e.target.value })}
              disabled={saving}
            >
              <option value="">— intet møde —</option>
              {meetings.map((m) => (
                <option key={m.meetingId} value={m.meetingId}>
                  {MEETING_KIND_LABEL[m.kind] ?? m.kind}: {m.title} ({m.date})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="edit-tags">Tags (komma-separeret)</label>
            <input
              id="edit-tags"
              type="text"
              value={edit.tagsRaw}
              onChange={(e) => setEdit({ ...edit, tagsRaw: e.target.value })}
              placeholder="f.eks. økonomi, vedtægter"
              disabled={saving}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-note">Note (valgfri)</label>
            <input
              id="edit-note"
              type="text"
              value={edit.note}
              onChange={(e) => setEdit({ ...edit, note: e.target.value })}
              maxLength={500}
              disabled={saving}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Gemmer…' : 'Gem'}
            </button>
            <button type="button" className="btn-card" onClick={cancelEdit} disabled={saving}>
              Annullér
            </button>
          </div>
        </form>
      )}

      {!edit && doc.contentType === 'application/pdf' && (
        <div className="doc-viewer" style={{ marginTop: '1.5rem' }}>
          <iframe
            src={doc.viewUrl}
            title={doc.title}
            style={{
              width: '100%',
              height: '75vh',
              minHeight: '500px',
              border: '1px solid var(--line)',
              background: 'var(--paper-lifted)',
            }}
          />
          <p className="help" style={{ marginTop: '0.5rem' }}>
            Vises dokumentet ikke? Brug <em>Hent dokument</em>-knappen ovenfor.
          </p>
        </div>
      )}
    </main>
  );
};
