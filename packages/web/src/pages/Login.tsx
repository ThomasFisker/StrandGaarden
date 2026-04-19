import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../session';

export const LoginPage = () => {
  const { session, signIn, loading } = useSession();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <main className="content"><p>Indlæser…</p></main>;
  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/upload';
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
    <main className="content">
      <h1>Log ind</h1>
      <p className="subtle">
        Velkommen til Strandgaardens jubilæumsside. Indtast din e-mail og adgangskode for at uploade billeder.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
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
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Logger ind…' : 'Log ind'}
        </button>
      </form>
    </main>
  );
};
