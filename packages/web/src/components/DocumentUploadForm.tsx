import { useState } from 'react';
import type { FormEvent } from 'react';
import { requestDocumentUploadUrl } from '../api';
import { useSession } from '../session';
import {
  DOC_ACCEPTED_MIME,
  DOC_CATEGORIES,
  DOC_MAX_UPLOAD_BYTES,
  type DocCategory,
  type Meeting,
} from '../types';

interface Props {
  meetings: Meeting[];
  fixedMeetingId?: string | null;
  onUploaded: () => void;
}

const CURRENT_YEAR = new Date().getUTCFullYear();

const KIND_LABEL: Record<string, string> = {
  board: 'Bestyrelsesmøde',
  assembly: 'Generalforsamling',
};

const putToS3 = (url: string, file: File): Promise<void> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 PUT failed (HTTP ${xhr.status}): ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error('S3 PUT network error'));
    xhr.send(file);
  });

export const DocumentUploadForm = ({ meetings, fixedMeetingId, onUploaded }: Props) => {
  const { session } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocCategory>('Andet');
  const [year, setYear] = useState<string>(String(CURRENT_YEAR));
  const [meetingId, setMeetingId] = useState<string>(fixedMeetingId ?? '');
  const [note, setNote] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setTitle('');
    setCategory('Andet');
    setYear(String(CURRENT_YEAR));
    setNote('');
    setTagsRaw('');
    if (!fixedMeetingId) setMeetingId('');
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    if (!file) {
      setError('Vælg en fil først.');
      return;
    }
    if (!(file.type in DOC_ACCEPTED_MIME)) {
      setError(`Filtype ikke understøttet. Brug ${Object.values(DOC_ACCEPTED_MIME).join(' eller ')}.`);
      return;
    }
    if (file.size > DOC_MAX_UPLOAD_BYTES) {
      setError(`Filen er for stor (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max 25 MB.`);
      return;
    }
    if (!title.trim()) {
      setError('Titel skal udfyldes.');
      return;
    }
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > CURRENT_YEAR + 1) {
      setError(`År skal være mellem 1900 og ${CURRENT_YEAR + 1}.`);
      return;
    }
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    setSubmitting(true);
    setError(null);
    try {
      const { uploadUrl } = await requestDocumentUploadUrl(session.idToken, {
        filename: file.name,
        contentType: file.type,
        title: title.trim(),
        category,
        year: yearNum,
        meetingId: meetingId || null,
        note: note.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });
      await putToS3(uploadUrl, file);
      reset();
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fejlede');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="card" style={{ padding: '1rem' }}>
      <h2 style={{ marginTop: 0 }}>Upload dokument</h2>
      {error && <div className="error">{error}</div>}

      <div className="field">
        <label htmlFor="d-file">Fil (PDF eller DOCX, max 25 MB)</label>
        <input
          id="d-file"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={submitting}
        />
        {file && (
          <div className="help">
            {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="d-title">Titel</label>
        <input
          id="d-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="F.eks. Referat fra generalforsamling 2026"
          maxLength={200}
          required
          disabled={submitting}
        />
      </div>

      <div className="field">
        <label htmlFor="d-cat">Kategori</label>
        <select
          id="d-cat"
          value={category}
          onChange={(e) => setCategory(e.target.value as DocCategory)}
          disabled={submitting}
        >
          {DOC_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="d-year">År</label>
        <input
          id="d-year"
          type="number"
          min={1900}
          max={CURRENT_YEAR + 1}
          value={year}
          onChange={(e) => setYear(e.target.value)}
          disabled={submitting}
          required
        />
      </div>

      {!fixedMeetingId && (
        <div className="field">
          <label htmlFor="d-meeting">Tilknyt møde (valgfri)</label>
          <select
            id="d-meeting"
            value={meetingId}
            onChange={(e) => setMeetingId(e.target.value)}
            disabled={submitting}
          >
            <option value="">— intet møde —</option>
            {meetings.map((m) => (
              <option key={m.meetingId} value={m.meetingId}>
                {KIND_LABEL[m.kind] ?? m.kind}: {m.title} ({m.date})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="d-tags">Tags (valgfri, komma-separeret)</label>
        <input
          id="d-tags"
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="f.eks. økonomi, vedtægter"
          disabled={submitting}
        />
      </div>

      <div className="field">
        <label htmlFor="d-note">Note (valgfri)</label>
        <input
          id="d-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='F.eks. "v2 — fjernet personoplysninger jf. GDPR-anmodning"'
          maxLength={500}
          disabled={submitting}
        />
        <div className="help">Brug ved rettelser, så læsere kan se hvorfor en version er erstattet.</div>
      </div>

      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting ? 'Uploader…' : 'Upload'}
      </button>
    </form>
  );
};
