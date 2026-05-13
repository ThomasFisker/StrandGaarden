import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FormEvent } from 'react';
import { createMeeting, deleteMeeting, listMeetings, updateMeeting } from '../api';
import { useSession } from '../session';
import type { Meeting, MeetingKind } from '../types';

const KIND_LABEL: Record<string, string> = {
  board: 'Bestyrelsesmøde',
  assembly: 'Generalforsamling',
};

const today = (): string => new Date().toISOString().slice(0, 10);

const formatDate = (iso: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y}`;
  }
  return iso;
};

interface EditState {
  meetingId: string | null;
  kind: MeetingKind;
  date: string;
  title: string;
  description: string;
}

const EMPTY_EDIT: EditState = { meetingId: null, kind: 'board', date: today(), title: '', description: '' };

export const BestyrelsenMeetingsPage = () => {
  const { session } = useSession();
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      setMeetings(await listMeetings(session.idToken));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente møder');
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => setEdit({ ...EMPTY_EDIT, date: today() });
  const openEdit = (m: Meeting) =>
    setEdit({
      meetingId: m.meetingId,
      kind: (m.kind === 'board' || m.kind === 'assembly' ? m.kind : 'board') as MeetingKind,
      date: m.date,
      title: m.title,
      description: m.description ?? '',
    });
  const cancel = () => setEdit(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !edit) return;
    const title = edit.title.trim();
    if (!title) {
      setError('Titel skal udfyldes.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        kind: edit.kind,
        date: edit.date,
        title,
        description: edit.description.trim() || undefined,
      };
      if (edit.meetingId) await updateMeeting(session.idToken, edit.meetingId, body);
      else await createMeeting(session.idToken, body);
      setEdit(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke gemme mødet');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (m: Meeting) => {
    if (!session) return;
    if (!confirm(`Slet "${m.title}"? Tilknyttede dokumenter bliver IKKE slettet, kun frakoblet.`)) return;
    try {
      await deleteMeeting(session.idToken, m.meetingId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke slette mødet');
    }
  };

  return (
    <main className="content">
      <p>
        <Link to="/bestyrelse">← Tilbage til Bestyrelsen</Link>
      </p>
      <p className="eyebrow">Bestyrelsen</p>
      <h1>Møder</h1>
      <p className="lede">Bestyrelsesmøder og generalforsamlinger.</p>

      {error && <div className="error">{error}</div>}

      {!edit && (
        <button type="button" className="btn-primary" onClick={openCreate} style={{ marginTop: '1rem' }}>
          + Nyt møde
        </button>
      )}

      {edit && (
        <form onSubmit={onSubmit} className="card" style={{ marginTop: '1rem', padding: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>{edit.meetingId ? 'Redigér møde' : 'Nyt møde'}</h2>
          <div className="field">
            <label htmlFor="m-kind">Type</label>
            <select
              id="m-kind"
              value={edit.kind}
              onChange={(e) => setEdit({ ...edit, kind: e.target.value as MeetingKind })}
              disabled={saving}
            >
              <option value="board">Bestyrelsesmøde</option>
              <option value="assembly">Generalforsamling</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-date">Dato</label>
            <input
              id="m-date"
              type="date"
              value={edit.date}
              onChange={(e) => setEdit({ ...edit, date: e.target.value })}
              disabled={saving}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="m-title">Titel</label>
            <input
              id="m-title"
              type="text"
              value={edit.title}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              placeholder="F.eks. Ordinær generalforsamling 2026"
              disabled={saving}
              maxLength={200}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="m-desc">Beskrivelse (valgfri)</label>
            <textarea
              id="m-desc"
              rows={3}
              value={edit.description}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
              maxLength={1000}
              disabled={saving}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Gemmer…' : 'Gem'}
            </button>
            <button type="button" className="btn-card" onClick={cancel} disabled={saving}>
              Annullér
            </button>
          </div>
        </form>
      )}

      <section style={{ marginTop: '1.5rem' }}>
        {meetings === null && <p>Indlæser…</p>}
        {meetings && meetings.length === 0 && (
          <p style={{ color: 'var(--ink-soft)' }}>Ingen møder oprettet endnu.</p>
        )}
        {meetings && meetings.length > 0 && (
          <ul className="doc-list">
            {meetings.map((m) => (
              <li key={m.meetingId} className="doc-row">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.9rem 0.2rem', gap: '1rem', flexWrap: 'wrap' }}>
                  <Link to={`/bestyrelse/moder/${m.meetingId}`} className="doc-link" style={{ padding: 0, flex: 1 }}>
                    <span className="doc-title">{m.title}</span>
                    <span className="doc-meta">
                      <span className="doc-pill">{KIND_LABEL[m.kind] ?? m.kind}</span>
                      <span>· {formatDate(m.date)}</span>
                    </span>
                  </Link>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button type="button" className="btn-card" onClick={() => openEdit(m)}>
                      Redigér
                    </button>
                    <button type="button" className="btn-card" onClick={() => onDelete(m)}>
                      Slet
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
};
