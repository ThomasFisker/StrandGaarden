import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ackFirstLogin } from '../api';
import { changeOwnPassword } from '../auth';
import { useProfile } from '../profile';
import { useSession } from '../session';

/** First-protected-route block that offers the user the choice to
 * either keep the password the committee assigned them, or set their
 * own. Voluntary — both paths dismiss the prompt for all future
 * logins via /me/first-login-ack. */
export const FirstLoginPrompt = ({ children }: { children: ReactNode }) => {
  const { session } = useSession();
  const { profile, refresh } = useProfile();
  const [open, setOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile || profile.firstLoginAcked) return <>{children}</>;

  const onKeep = async () => {
    if (!session) return;
    setSubmitting(true);
    setError(null);
    try {
      await ackFirstLogin(session.idToken);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke gemme valget');
    } finally {
      setSubmitting(false);
    }
  };

  const onChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    if (newPassword.length < 8) {
      setError('Den nye adgangskode skal være mindst 8 tegn.');
      return;
    }
    if (!/\d/.test(newPassword)) {
      setError('Den nye adgangskode skal indeholde mindst ét tal.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('De to nye adgangskoder er ikke ens.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await changeOwnPassword(oldPassword, newPassword);
      await ackFirstLogin(session.idToken);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke ændre adgangskoden');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="content">
      <p className="eyebrow">Velkommen</p>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)' }}>
        Vil du <em>vælge</em> din egen adgangskode?
      </h1>
      <p className="lede">
        Udvalget har givet dig en adgangskode, så du kan logge ind. Du må gerne beholde den —
        eller du kan vælge en, du selv kan huske. Du kan også springe over nu og ændre den
        senere.
      </p>

      <div
        style={{
          marginTop: '1.25rem',
          padding: '1rem 1.25rem',
          background: 'var(--paper-warm, #faf2e6)',
          borderLeft: '3px solid var(--copper, #b85a2a)',
          fontSize: '0.95rem',
        }}
      >
        Krav til adgangskoden: mindst <strong>8 tegn</strong> og mindst <strong>1 tal</strong>.
        Bogstaver og specialtegn må gerne være med, men er ikke nødvendige.
      </div>

      {!open ? (
        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setOpen(true)}
            disabled={submitting}
          >
            Sæt min egen adgangskode <span className="arrow">→</span>
          </button>
          <button type="button" onClick={onKeep} disabled={submitting}>
            {submitting ? 'Gemmer…' : 'Behold den jeg fik'}
          </button>
        </div>
      ) : (
        <form onSubmit={onChange} noValidate style={{ marginTop: '1.5rem' }}>
          <div className="field">
            <label htmlFor="old-pw">Nuværende adgangskode (den udvalget gav dig)</label>
            <input
              id="old-pw"
              type="password"
              autoComplete="current-password"
              required
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="field">
            <label htmlFor="new-pw">Ny adgangskode</label>
            <input
              id="new-pw"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="field">
            <label htmlFor="confirm-pw">Gentag ny adgangskode</label>
            <input
              id="confirm-pw"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={submitting}
            />
          </div>
          {error && <div className="error">{error}</div>}
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Gemmer…' : 'Gem ny adgangskode'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={submitting}
            >
              Tilbage
            </button>
          </div>
        </form>
      )}

      {error && !open && <div className="error" style={{ marginTop: '1rem' }}>{error}</div>}
    </main>
  );
};
