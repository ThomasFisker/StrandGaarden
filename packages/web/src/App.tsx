import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CognitoUserSession } from 'amazon-cognito-identity-js';
import { claimsFromSession, getCurrentSession, signIn, signOut } from './auth';
import { putToS3, requestUploadUrl, whoami } from './api';

export const App = () => {
  const [session, setSession] = useState<CognitoUserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [apiResult, setApiResult] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  useEffect(() => {
    getCurrentSession().then((s) => {
      setSession(s);
      setLoading(false);
    });
  }, []);

  const handleLogin = useCallback(async (email: string, password: string) => {
    setLoginError(null);
    try {
      const s = await signIn(email, password);
      setSession(s);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleLogout = () => {
    signOut();
    setSession(null);
    setApiResult(null);
    setUploadStatus(null);
  };

  const callWhoami = async () => {
    if (!session) return;
    setApiResult('…');
    try {
      const r = await whoami(session.getIdToken().getJwtToken());
      setApiResult(JSON.stringify(r, null, 2));
    } catch (e) {
      setApiResult(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleUpload = async (file: File) => {
    if (!session) return;
    setUploadStatus(`Requesting upload URL for ${file.name}…`);
    try {
      const idToken = session.getIdToken().getJwtToken();
      const { uploadUrl, photoId, s3Key } = await requestUploadUrl(idToken, file.name, file.type);
      setUploadStatus(`Uploading to S3 (photoId=${photoId})…`);
      await putToS3(uploadUrl, file);
      setUploadStatus(`✓ uploaded. photoId=${photoId}\ns3Key=${s3Key}`);
    } catch (e) {
      setUploadStatus(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (loading) return <main style={styles.main}><p>Indlæser…</p></main>;

  if (!session) {
    return (
      <main style={styles.main}>
        <LoginForm onSubmit={handleLogin} error={loginError} />
      </main>
    );
  }

  const claims = claimsFromSession(session);

  return (
    <main style={styles.main}>
      <h1>Strandgaarden – smoke test</h1>

      <section style={styles.section}>
        <h2>Logget ind</h2>
        <p><strong>email:</strong> {claims.email ?? '—'}</p>
        <p><strong>sub:</strong> {claims.sub}</p>
        <p><strong>groups:</strong> {claims.groups.join(', ') || '(ingen)'}</p>
        <button onClick={handleLogout}>Log ud</button>
      </section>

      <section style={styles.section}>
        <h2>GET /whoami</h2>
        <button onClick={callWhoami}>Kald /whoami</button>
        {apiResult && <pre style={styles.pre}>{apiResult}</pre>}
      </section>

      <section style={styles.section}>
        <h2>POST /upload-url → PUT to S3</h2>
        <input
          type="file"
          accept="image/jpeg,image/png,image/tiff,image/heic,image/heif"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
          }}
        />
        {uploadStatus && <pre style={styles.pre}>{uploadStatus}</pre>}
      </section>
    </main>
  );
};

const LoginForm = ({
  onSubmit,
  error,
}: {
  onSubmit: (email: string, password: string) => void;
  error: string | null;
}) => {
  const [email, setEmail] = useState('thomas.madsen@secondepic.com');
  const [password, setPassword] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(email, password);
      }}
      style={styles.form}
    >
      <h1>Log ind</h1>
      <label style={styles.label}>
        E-mail
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          autoComplete="username"
          required
          style={styles.input}
        />
      </label>
      <label style={styles.label}>
        Adgangskode
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="current-password"
          required
          style={styles.input}
        />
      </label>
      <button type="submit">Log ind</button>
      {error && <p style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{error}</p>}
    </form>
  );
};

const styles: Record<string, CSSProperties> = {
  main: { fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '2rem auto', padding: '0 1rem', fontSize: 16 },
  section: { marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid #ddd' },
  pre: { background: '#f4f4f4', padding: '1rem', borderRadius: 4, overflow: 'auto', fontSize: 12 },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  input: { padding: '0.5rem', fontSize: 16 },
};
