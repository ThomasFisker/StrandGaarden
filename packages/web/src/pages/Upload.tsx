import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { HouseSelector } from '../components/HouseSelector';
import { PersonTagInput } from '../components/PersonTagInput';
import { putToS3, requestUploadUrl } from '../api';
import { useSession } from '../session';
import { ACCEPTED_MIME, MAX_UPLOAD_BYTES, type PersonTagInput as PersonTagValue } from '../types';

const ACCEPT_ATTR = Object.keys(ACCEPTED_MIME).join(',');
const CURRENT_YEAR = new Date().getFullYear();

export const UploadPage = () => {
  const { session } = useSession();
  const navigate = useNavigate();

  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [whoInPhoto, setWhoInPhoto] = useState('');
  const [yearText, setYearText] = useState('');
  const [yearApprox, setYearApprox] = useState(false);
  const [houseNumbers, setHouseNumbers] = useState<number[]>([]);
  const [personTags, setPersonTags] = useState<PersonTagValue[]>([]);
  const toggleHouse = useCallback((n: number) => {
    setHouseNumbers((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => a - b),
    );
  }, []);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedYear = useMemo<number | null>(() => {
    const trimmed = yearText.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isInteger(n) ? n : NaN;
  }, [yearText]);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (f && !ACCEPTED_MIME[f.type]) {
      setError(`Filen skal være en af: ${Object.values(ACCEPTED_MIME).join(', ')}`);
      setFile(null);
      return;
    }
    if (f && f.size > MAX_UPLOAD_BYTES) {
      setError(`Filen er for stor (maks ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`);
      setFile(null);
      return;
    }
    setError(null);
    setFile(f);
  };

  const validate = (): string | null => {
    if (!file) return 'Vælg en fil først.';
    if (!description.trim()) return 'Skriv en beskrivelse.';
    if (parsedYear !== null && (Number.isNaN(parsedYear) || parsedYear < 1800 || parsedYear > CURRENT_YEAR)) {
      return `År skal være et helt tal mellem 1800 og ${CURRENT_YEAR} (eller lad feltet være tomt).`;
    }
    if (houseNumbers.length === 0) return 'Vælg mindst ét hus nr.';
    if (!consent) return 'Du skal bekræfte samtykket før billedet kan sendes.';
    return null;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSubmitting(true);
    setProgress(0);
    try {
      const { uploadUrl } = await requestUploadUrl(session.idToken, {
        filename: file!.name,
        contentType: file!.type,
        description: description.trim(),
        whoInPhoto: whoInPhoto.trim(),
        year: parsedYear === null || Number.isNaN(parsedYear) ? null : parsedYear,
        yearApprox,
        houseNumbers,
        consent,
        taggedPersons: personTags,
      });
      await putToS3(uploadUrl, file!, (p) => setProgress(p));
      navigate('/mine?justUploaded=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload mislykkedes');
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <main className="content">
      <h1>Upload billede</h1>
      <p className="subtle">
        Udfyld så meget du kan. Udvalget kigger billederne igennem, før de vises på siden eller kommer med i bogen.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="file">Billedfil</label>
          <input id="file" type="file" accept={ACCEPT_ATTR} onChange={onFileChange} required />
          <div className="help">
            Tilladt: JPEG, PNG, TIFF, HEIC. Maks {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.
            {file && <> Valgt: <strong>{file.name}</strong> ({Math.round(file.size / 1024)} KB)</>}
          </div>
        </div>

        <div className="field">
          <label htmlFor="description">Beskrivelse</label>
          <textarea
            id="description"
            required
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Hvad viser billedet?"
          />
        </div>

        <div className="field">
          <label htmlFor="who">Hvem er på billedet?</label>
          <textarea
            id="who"
            maxLength={1000}
            value={whoInPhoto}
            onChange={(e) => setWhoInPhoto(e.target.value)}
            placeholder="F.eks.: Fra venstre: Hans Jensen, Ida Jensen"
          />
          <div className="help">Valgfrit. Skriv fra venstre mod højre.</div>
        </div>

        <div className="field">
          <label htmlFor="year">År</label>
          <input
            id="year"
            type="number"
            inputMode="numeric"
            min={1800}
            max={CURRENT_YEAR}
            value={yearText}
            onChange={(e) => setYearText(e.target.value)}
            placeholder="f.eks. 1975"
          />
          <div className="checkbox-row">
            <input
              id="yearApprox"
              type="checkbox"
              checked={yearApprox}
              onChange={(e) => setYearApprox(e.target.checked)}
            />
            <label htmlFor="yearApprox">Ca. — året er kun omtrentligt</label>
          </div>
        </div>

        <div className="field">
          <label>Tag personer på billedet</label>
          <PersonTagInput value={personTags} onChange={setPersonTags} disabled={submitting} />
          <div className="help">
            Valgfrit. Tags gør det nemmere at finde billedet senere. Vælg fra listen, eller skriv et nyt navn
            og klik <em>Foreslå</em>; udvalget godkender nye navne.
          </div>
        </div>

        <div className="field">
          <label>Hus nr.</label>
          <div className="help" style={{ marginBottom: '0.5rem' }}>Vælg de huse billedet hører til. Mindst ét.</div>
          <HouseSelector value={houseNumbers} onToggle={toggleHouse} />
        </div>

        <div className="field">
          <div className="checkbox-row">
            <input
              id="consent"
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <label htmlFor="consent">
              Jeg bekræfter, at billedet må offentliggøres, og at de personer der er på billedet er indforståede med det.
            </label>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <button type="submit" disabled={submitting}>
          {submitting
            ? progress !== null
              ? `Sender… ${Math.round(progress * 100)}%`
              : 'Sender…'
            : 'Send billede'}
        </button>
      </form>
    </main>
  );
};
