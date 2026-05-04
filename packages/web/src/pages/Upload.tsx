import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { HouseSelector } from '../components/HouseSelector';
import { PersonTagInput } from '../components/PersonTagInput';
import { listActivities, putToS3, requestUploadUrl } from '../api';
import { useProfile } from '../profile';
import { useSession } from '../session';
import {
  ACCEPTED_MIME,
  BOOK_MIN_LONG_EDGE,
  MAX_UPLOAD_BYTES,
  MIN_LONG_EDGE,
  type Activity,
  type PersonTagInput as PersonTagValue,
} from '../types';

const ACCEPT_ATTR = Object.keys(ACCEPTED_MIME).join(',');
const CURRENT_YEAR = new Date().getFullYear();

/** Best-effort client-side pixel-dimension probe. Browsers can decode JPEG
 * and PNG natively; HEIC/HEIF/TIFF can't be decoded without a heavy WASM
 * library, so we skip the check for those and rely on the server's
 * authoritative check in `process-image.ts`. */
const probeDimensions = async (
  f: File,
): Promise<{ longEdge: number } | null> => {
  if (f.type !== 'image/jpeg' && f.type !== 'image/png') return null;
  try {
    const bmp = await createImageBitmap(f);
    const longEdge = Math.max(bmp.width, bmp.height);
    if (typeof bmp.close === 'function') bmp.close();
    return { longEdge };
  } catch {
    return null;
  }
};

export const UploadPage = () => {
  const { session } = useSession();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const isAdmin = profile?.groups.includes('admin') ?? false;
  const frozen = profile?.stage === 2 && !isAdmin;
  const stageOneNonAdmin = profile?.stage === 1 && !isAdmin;
  const myHouse = profile?.houseNumber ?? null;
  const slotsUsed = profile?.myHouseSlotsUsed ?? null;
  const slotsMax = profile?.maxBookSlotsPerHouse ?? 7;
  const houseAtCap =
    stageOneNonAdmin && myHouse !== null && slotsUsed !== null && slotsUsed >= slotsMax;

  const [file, setFile] = useState<File | null>(null);
  const [dimensionWarning, setDimensionWarning] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [whoInPhoto, setWhoInPhoto] = useState('');
  const [yearText, setYearText] = useState('');
  const [yearApprox, setYearApprox] = useState(false);
  const [houseNumbers, setHouseNumbers] = useState<number[]>([]);
  const [housesTouched, setHousesTouched] = useState(false);
  const [personTags, setPersonTags] = useState<PersonTagValue[]>([]);
  const [target, setTarget] = useState<'house' | 'activity'>('house');
  const [activityKey, setActivityKey] = useState<string>('');
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const toggleHouse = useCallback((n: number) => {
    setHousesTouched(true);
    setHouseNumbers((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => a - b),
    );
  }, []);

  // Stage-1 only: load the activity list once for the "Til en aktivitet"
  // dropdown. Cheap query — gated so we don't fetch in Stage 3 or for
  // admins (who keep free-form house choice).
  useEffect(() => {
    if (!session || !stageOneNonAdmin) return;
    let active = true;
    listActivities(session.idToken)
      .then((list) => {
        if (active) setActivities(list);
      })
      .catch(() => {
        if (active) setActivities([]);
      });
    return () => {
      active = false;
    };
  }, [session, stageOneNonAdmin]);

  // If a non-admin in Stage 1 has their own house at cap, default the
  // target to "activity" so the form is usable out of the gate.
  useEffect(() => {
    if (houseAtCap) setTarget('activity');
  }, [houseAtCap]);

  // Prefill house from the user's assigned house (set by admin on
  // /admin/users). Profile comes from ProfileProvider so this fires once
  // when the cached profile arrives. We only write if the user hasn't
  // already touched the selector.
  useEffect(() => {
    if (!profile || profile.houseNumber === null) return;
    setHouseNumbers((prev) =>
      !housesTouched && prev.length === 0 ? [profile.houseNumber as number] : prev,
    );
    // housesTouched intentionally excluded — guards against undoing a manual deselect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);
  const [consent, setConsent] = useState(false);
  const [helpWanted, setHelpWanted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedYear = useMemo<number | null>(() => {
    const trimmed = yearText.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isInteger(n) ? n : NaN;
  }, [yearText]);

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(null);
    setDimensionWarning(null);
    if (!f) {
      setError(null);
      return;
    }
    if (!ACCEPTED_MIME[f.type]) {
      setError(`Filen skal være en af: ${Object.values(ACCEPTED_MIME).join(', ')}`);
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(`Filen er for stor (maks ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`);
      return;
    }
    setError(null);
    const dim = await probeDimensions(f);
    if (dim) {
      if (dim.longEdge < MIN_LONG_EDGE) {
        setError(
          `Billedet er for lille (${dim.longEdge} pixel på den længste side). ` +
            `Mindst ${MIN_LONG_EDGE} pixel kræves. Brug originalen fra kameraet eller ` +
            `mobilen — ikke et lille billede modtaget på SMS eller Messenger.`,
        );
        return;
      }
      if (dim.longEdge < BOOK_MIN_LONG_EDGE) {
        setDimensionWarning(
          `Billedet er ${dim.longEdge} pixel på den længste side. Det kan godt vises på siden, ` +
            `men er muligvis ikke skarpt nok til den trykte bog. Hvis du har en større original, ` +
            `så upload den gerne i stedet.`,
        );
      }
    }
    setFile(f);
  };

  const validate = (): string | null => {
    if (!file) return 'Vælg en fil først.';
    if (!description.trim()) return 'Skriv en beskrivelse.';
    if (parsedYear !== null && (Number.isNaN(parsedYear) || parsedYear < 1800 || parsedYear > CURRENT_YEAR)) {
      return `År skal være et helt tal mellem 1800 og ${CURRENT_YEAR} (eller lad feltet være tomt).`;
    }
    if (stageOneNonAdmin) {
      if (target === 'house') {
        if (myHouse === null) return 'Du er ikke tildelt et hus. Bed udvalget om at tildele dig et — eller vælg en aktivitet.';
        if (houseAtCap) return `Hus ${myHouse} er fyldt op (${slotsUsed}/${slotsMax}). Vælg en aktivitet, eller bed udvalget fjerne et billede først.`;
      } else {
        if (!activityKey) return 'Vælg en aktivitet.';
      }
    } else {
      if (houseNumbers.length === 0) return 'Vælg mindst ét hus nr.';
    }
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
      const useActivity = stageOneNonAdmin && target === 'activity';
      const payloadHouses =
        stageOneNonAdmin
          ? useActivity
            ? []
            : myHouse !== null
              ? [myHouse]
              : []
          : houseNumbers;
      const { uploadUrl } = await requestUploadUrl(session.idToken, {
        filename: file!.name,
        contentType: file!.type,
        description: description.trim(),
        whoInPhoto: whoInPhoto.trim(),
        year: parsedYear === null || Number.isNaN(parsedYear) ? null : parsedYear,
        yearApprox,
        houseNumbers: payloadHouses,
        activityKey: useActivity ? activityKey : null,
        consent,
        taggedPersons: personTags,
        helpWanted,
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

  if (frozen) {
    return (
      <main className="content">
        <p className="eyebrow">Bidrag til arkivet</p>
        <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
          Upload <em>billede</em>
        </h1>
        <p className="lede">
          Siden er i frys-fase mens udvalget arbejder på bogen. Du kan se det du allerede har
          uploadet på <a href="/mine">Mine billeder</a>, men nye uploads er ikke mulige indtil
          videre.
        </p>
      </main>
    );
  }

  return (
    <main className="content">
      <p className="eyebrow">Bidrag til arkivet</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>Upload <em>billede</em></h1>
      <p className="lede">
        Udfyld så meget du kan. Udvalget kigger billederne igennem, før de vises på siden eller kommer med i bogen.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="file">Billedfil</label>
          <input id="file" type="file" accept={ACCEPT_ATTR} onChange={onFileChange} required />
          <div className="help">
            <p style={{ margin: '0 0 0.4rem' }}>
              <strong>Brug originalen</strong> fra kameraet eller mobilen — ikke et lille billede du har
              modtaget på SMS, Messenger eller WhatsApp. Sådanne billeder er ofte gjort meget små
              undervejs og kan ikke bruges i den trykte bog.
            </p>
            <p style={{ margin: '0 0 0.4rem' }}>
              <strong>iPhone-billeder (.HEIC) er fint</strong> — vi laver dem automatisk om til JPEG, så
              du behøver ikke konvertere noget selv. Live Photos uploades som det almindelige stillbillede;
              den korte videoklip følger ikke med.
            </p>
            <p style={{ margin: 0 }}>
              Tilladt: JPEG, PNG, TIFF, HEIC. Mindst {MIN_LONG_EDGE} pixel på den længste side
              ({BOOK_MIN_LONG_EDGE}+ anbefales for at komme med i bogen). Maks{' '}
              {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.
            </p>
          </div>
          {file && (
            <div className="help" style={{ marginTop: '0.4rem' }}>
              Valgt: <strong>{file.name}</strong> ({Math.round(file.size / 1024)} KB)
            </div>
          )}
          {dimensionWarning && (
            <div
              style={{
                marginTop: '0.5rem',
                padding: '0.5rem 0.75rem',
                background: 'var(--paper-warm, #faf2e6)',
                borderLeft: '3px solid var(--copper, #b85a2a)',
                color: 'var(--copper, #b85a2a)',
                fontSize: '0.95rem',
              }}
            >
              {dimensionWarning}
            </div>
          )}
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

        {stageOneNonAdmin ? (
          <div className="field">
            <label>Hvor hører billedet til?</label>
            <div className="help" style={{ marginBottom: '0.6rem' }}>
              I fase 1 uploader hvert hus til sin egen del af bogen, og fælles aktiviteter lægges
              under et nøgleord (Sankt Hans, generalforsamling osv.).
            </div>
            <div className="checkbox-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.4rem' }}>
              <label>
                <input
                  type="radio"
                  name="upload-target"
                  value="house"
                  checked={target === 'house'}
                  onChange={() => setTarget('house')}
                  disabled={myHouse === null || houseAtCap}
                />{' '}
                <strong>Til mit hus</strong>
                {myHouse !== null ? ` (Hus ${myHouse})` : ' — du er ikke tildelt et hus endnu'}
                {myHouse !== null && slotsUsed !== null && (
                  <span className="subtle"> · {slotsUsed} af {slotsMax} pladser brugt</span>
                )}
              </label>
              <label>
                <input
                  type="radio"
                  name="upload-target"
                  value="activity"
                  checked={target === 'activity'}
                  onChange={() => setTarget('activity')}
                />{' '}
                <strong>Til en aktivitet</strong>
                <span className="subtle"> (fælles afsnit i bogen)</span>
              </label>
            </div>
            {target === 'activity' && (
              <div style={{ marginTop: '0.6rem' }}>
                <select
                  value={activityKey}
                  onChange={(e) => setActivityKey(e.target.value)}
                  aria-label="Aktivitet"
                >
                  <option value="">— Vælg aktivitet —</option>
                  {(activities ?? []).map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.displayName}
                    </option>
                  ))}
                </select>
                {activities !== null && activities.length === 0 && (
                  <div className="help" style={{ marginTop: '0.4rem' }}>
                    Udvalget har ikke oprettet aktiviteter endnu.
                  </div>
                )}
              </div>
            )}
            {houseAtCap && (
              <div
                style={{
                  marginTop: '0.6rem',
                  padding: '0.5rem 0.75rem',
                  background: 'var(--paper-warm, #faf2e6)',
                  borderLeft: '3px solid var(--copper, #b85a2a)',
                  fontSize: '0.95rem',
                }}
              >
                Hus {myHouse} har allerede {slotsUsed} af {slotsMax} mulige billeder. Bed udvalget
                fjerne et billede først, eller upload til en aktivitet i stedet.
              </div>
            )}
          </div>
        ) : (
          <div className="field">
            <label>Hus nr.</label>
            <div className="help" style={{ marginBottom: '0.5rem' }}>Vælg de huse billedet hører til. Mindst ét.</div>
            <HouseSelector value={houseNumbers} onToggle={toggleHouse} />
          </div>
        )}

        <div className="field">
          <div className="checkbox-row">
            <input
              id="helpWanted"
              type="checkbox"
              checked={helpWanted}
              onChange={(e) => setHelpWanted(e.target.checked)}
            />
            <label htmlFor="helpWanted">
              Jeg kender ikke alle på billedet — bed gerne andre om hjælp
            </label>
          </div>
          <div className="help">
            Sæt hak hvis der er personer du ikke kan sætte navn på. Andre besøgende ser et lille
            <em> Hjælp søges</em> mærke på billedet og kan sende en kommentar til udvalget.
          </div>
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

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting
            ? progress !== null
              ? `Sender… ${Math.round(progress * 100)}%`
              : 'Sender…'
            : <>Send billede <span className="arrow">→</span></>}
        </button>
      </form>
    </main>
  );
};
