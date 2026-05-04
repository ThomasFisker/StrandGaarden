import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { confirmForgotPassword, requestForgotPasswordCode } from '../auth';

type Step = 'request' | 'confirm' | 'done';

export const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRequest = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Skriv din e-mail.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await requestForgotPasswordCode(email.trim());
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke sende kode');
    } finally {
      setSubmitting(false);
    }
  };

  const onConfirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Skriv den 6-cifrede kode fra e-mailen.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Adgangskoden skal være mindst 8 tegn.');
      return;
    }
    if (!/\d/.test(newPassword)) {
      setError('Adgangskoden skal indeholde mindst ét tal.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('De to adgangskoder er ikke ens.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await confirmForgotPassword(email.trim(), code.trim(), newPassword);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke bekræfte koden');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-split">
      <aside className="login-hero">
        <img src="/bg/hero-beach.jpg" alt="" aria-hidden="true" />
        <div className="hero-content">
          <div className="hero-top">
            <p className="eyebrow">Strandgaarden Interessentskab</p>
            <p className="hero-quote">Et album for fællesskabet ved havet — samlet gennem hundrede somre.</p>
          </div>
          <div className="hero-bottom">
            <span className="hero-mark"><em>100</em></span>
            <span className="hero-span">1927 &nbsp;·&nbsp; 2027</span>
          </div>
        </div>
      </aside>
      <section className="login-panel">
        <div className="login-card">
          <p className="eyebrow">Adgangskode</p>
          <h1>Glemt adgangskode</h1>

          {step === 'request' && (
            <>
              <p className="login-lede">
                Skriv din e-mail. Vi sender en 6-cifret kode, som du bruger til at vælge en
                ny adgangskode.
              </p>
              <form onSubmit={onRequest} noValidate>
                <div className="field">
                  <label htmlFor="email">E-mail</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="dit.navn@eksempel.dk"
                  />
                </div>
                {error && <div className="error">{error}</div>}
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Sender…' : 'Send kode'} <span className="arrow">→</span>
                </button>
              </form>
            </>
          )}

          {step === 'confirm' && (
            <>
              <p className="login-lede">
                Vi har sendt en 6-cifret kode til <strong>{email}</strong>. Hvis du ikke
                modtager den inden for et par minutter, så tjek spam-mappen.
              </p>
              <form onSubmit={onConfirm} noValidate>
                <div className="field">
                  <label htmlFor="code">Kode fra e-mailen</label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="6 cifre"
                    maxLength={6}
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
                  />
                  <div className="help">Mindst 8 tegn og mindst 1 tal.</div>
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
                  />
                </div>
                {error && <div className="error">{error}</div>}
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Gemmer…' : 'Bekræft'} <span className="arrow">→</span>
                </button>
                <p className="reset-hint">
                  <button
                    type="button"
                    className="link-muted"
                    onClick={() => {
                      setStep('request');
                      setCode('');
                      setError(null);
                    }}
                  >
                    Send en ny kode
                  </button>
                </p>
              </form>
            </>
          )}

          {step === 'done' && (
            <>
              <div className="ok">
                Klar! Din adgangskode er ændret. Du kan nu logge ind med den nye.
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => navigate('/login')}
                style={{ marginTop: '1rem' }}
              >
                Log ind <span className="arrow">→</span>
              </button>
            </>
          )}

          <p className="reset-hint">
            <Link to="/login">Tilbage til log ind</Link>
          </p>
        </div>
      </section>
    </main>
  );
};
