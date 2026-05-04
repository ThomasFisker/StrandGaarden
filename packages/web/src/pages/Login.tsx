import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../session';

export const LoginPage = () => {
  const { session, signIn, loading } = useSession();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <main className="content">
        <p className="subtle">Indlæser…</p>
      </main>
    );
  }
  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/galleri';
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login mislykkedes');
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
          <p className="eyebrow">Jubilæumsarkiv</p>
          <h1>Log ind</h1>
          <p className="login-lede">
            Velkommen tilbage. Indtast din e-mail og adgangskode for at uploade og finde billeder.
          </p>
          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="dit.navn@eksempel.dk"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="password">Adgangskode</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="··········"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <div className="error">{error}</div>}
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Logger ind…' : 'Log ind'} <span className="arrow">→</span>
            </button>
          </form>
          <p className="reset-hint">
            <Link to="/glemt-adgangskode">Glemt adgangskode?</Link>
          </p>
        </div>
      </section>
    </main>
  );
};
