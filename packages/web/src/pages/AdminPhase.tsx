import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { getConfig, updateConfig } from '../api';
import { useSession } from '../session';
import type { AppConfig, Stage } from '../types';

const STAGE_LABEL: Record<Stage, string> = {
  1: 'Fase 1 — Indsamling til bog',
  2: 'Fase 2 — Frys',
  3: 'Fase 3 — Offentlig (galleri åbent)',
};

const STAGE_DESC: Record<Stage, string> = {
  1: 'Medlemmer kan uploade billeder til deres hus eller en aktivitet. Galleriet er ikke synligt. Sektion A er begrænset til 7 billeder pr. hus.',
  2: 'Ingen uploads, ingen ændringer. Udvalget arbejder på bogen. Medlemmer ser en informationsside.',
  3: 'Galleriet er åbent for alle. Uploads tilladt uden bog-relateret valg. Dette svarer til den tidligere drift.',
};

export const AdminPhasePage = () => {
  const { session } = useSession();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [stage, setStage] = useState<Stage>(3);
  const [maxBookSlots, setMaxBookSlots] = useState<number>(7);
  const [maxHouseTextChars, setMaxHouseTextChars] = useState<number>(900);
  const [gdprText, setGdprText] = useState<string>('');
  const [bumpVersion, setBumpVersion] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const c = await getConfig(session.idToken);
      setConfig(c);
      setStage(c.stage);
      setMaxBookSlots(c.maxBookSlotsPerHouse);
      setMaxHouseTextChars(c.maxHouseTextChars);
      setGdprText(c.gdprText);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente konfiguration');
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !config) return;
    setError(null);
    setOkMsg(null);
    setSaving(true);
    try {
      const next = await updateConfig(session.idToken, {
        stage,
        maxBookSlotsPerHouse: maxBookSlots,
        maxHouseTextChars,
        gdprText,
        bumpGdprVersion: bumpVersion,
      });
      setConfig(next);
      setBumpVersion(false);
      setOkMsg(
        bumpVersion
          ? 'Gemt. Ny version — alle brugere bedes acceptere igen ved næste login.'
          : 'Gemt.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke gemme');
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    config !== null &&
    (stage !== config.stage ||
      maxBookSlots !== config.maxBookSlotsPerHouse ||
      maxHouseTextChars !== config.maxHouseTextChars ||
      gdprText !== config.gdprText ||
      bumpVersion);

  return (
    <main className="content">
      <p className="eyebrow">Administration</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Fase &amp; <em>tekster</em>
      </h1>
      <p className="lede">
        Styr hvilken fase siden er i, juster tærskler, og rediger GDPR-teksten som vises ved første login.
      </p>

      {error && <div className="error">{error}</div>}
      {config === null && !error && <p>Indlæser…</p>}

      {config !== null && (
        <form onSubmit={onSubmit} noValidate>
          <section style={{ marginTop: '1rem' }}>
            <h2>Fase</h2>
            <div role="radiogroup" aria-label="Fase">
              {([1, 2, 3] as Stage[]).map((s) => (
                <label
                  key={s}
                  style={{
                    display: 'block',
                    padding: '0.75rem 1rem',
                    margin: '0.4rem 0',
                    border: stage === s ? '2px solid var(--ink, #1a3548)' : '1px solid var(--border, #d8cfbc)',
                    borderRadius: '0.4rem',
                    cursor: 'pointer',
                    background: stage === s ? 'var(--paper-warm, #faf2e6)' : 'transparent',
                    textTransform: 'none',
                    fontSize: '1rem',
                    letterSpacing: 'normal',
                    color: 'inherit',
                  }}
                >
                  <input
                    type="radio"
                    name="stage"
                    value={s}
                    checked={stage === s}
                    onChange={() => setStage(s)}
                    style={{ marginRight: '0.6rem' }}
                  />
                  <strong>{STAGE_LABEL[s]}</strong>
                  <div style={{ marginLeft: '1.6rem', marginTop: '0.3rem', color: 'var(--ink-mute)' }}>
                    {STAGE_DESC[s]}
                  </div>
                </label>
              ))}
            </div>
          </section>

          <section style={{ marginTop: '1.5rem' }}>
            <h2>Tærskler</h2>
            <div className="field">
              <label htmlFor="max-slots">Maks. billeder pr. hus i fase 1 (sektion A)</label>
              <input
                id="max-slots"
                type="number"
                min={1}
                max={50}
                value={maxBookSlots}
                onChange={(e) => setMaxBookSlots(Number(e.target.value))}
              />
              <div className="help">Standard: 7. Hvert hus kan kun uploade så mange billeder til bogen.</div>
            </div>
            <div className="field">
              <label htmlFor="max-chars">Maks. tegn i hustekst</label>
              <input
                id="max-chars"
                type="number"
                min={100}
                max={10000}
                value={maxHouseTextChars}
                onChange={(e) => setMaxHouseTextChars(Number(e.target.value))}
              />
              <div className="help">Standard: 900. Gælder hvert hus' indlæg til bogen.</div>
            </div>
          </section>

          <section style={{ marginTop: '1.5rem' }}>
            <h2>GDPR-tekst (vises ved første login)</h2>
            <p className="help" style={{ marginBottom: '0.5rem' }}>
              Aktuel version: <code>{config.gdprVersion}</code>. Hvis du ændrer betydningen, skal alle
              brugere acceptere igen — sæt hak nedenfor.
            </p>
            <div className="field">
              <textarea
                value={gdprText}
                maxLength={50000}
                onChange={(e) => setGdprText(e.target.value)}
                style={{ minHeight: '20rem', fontFamily: 'inherit', whiteSpace: 'pre-wrap' }}
              />
              <div className="help">{gdprText.length} tegn.</div>
            </div>
            <div className="checkbox-row">
              <input
                id="bump"
                type="checkbox"
                checked={bumpVersion}
                onChange={(e) => setBumpVersion(e.target.checked)}
              />
              <label htmlFor="bump">
                Bed alle brugere om at acceptere igen ved næste login (ny version-stempel)
              </label>
            </div>
          </section>

          {okMsg && <div className="ok" style={{ marginTop: '1rem' }}>{okMsg}</div>}

          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
            <button type="submit" className="btn-primary" disabled={saving || !dirty}>
              {saving ? 'Gemmer…' : 'Gem'}
            </button>
            <button type="button" onClick={load} disabled={saving}>
              Hent igen
            </button>
          </div>
        </form>
      )}
    </main>
  );
};
