import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CognitoUserSession } from 'amazon-cognito-identity-js';
import { claimsFromSession, getCurrentSession, signIn as cognitoSignIn, signOut as cognitoSignOut } from './auth';
import type { Claims } from './auth';
import { setUnauthorizedHandler } from './api';

export interface Session {
  raw: CognitoUserSession;
  claims: Claims;
  idToken: string;
}

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  /** Set when the session expired and the user was signed out — drives the
   * "din session udløb, log ind igen" banner on the login page. */
  expired: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<SessionContextValue | undefined>(undefined);

const toSession = (raw: CognitoUserSession): Session => ({
  raw,
  claims: claimsFromSession(raw),
  idToken: raw.getIdToken().getJwtToken(),
});

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  // Guards against a burst of parallel 401s all kicking off refreshes.
  const recovering = useRef(false);

  useEffect(() => {
    getCurrentSession().then((raw) => {
      setSession(raw ? toSession(raw) : null);
      setLoading(false);
    });
  }, []);

  // When any API call returns 401 (the stored idToken expired after ~1h),
  // try to renew it silently with Cognito's refresh token. If that works
  // the user never notices — their next click just succeeds. If the
  // refresh token is gone too, sign out cleanly and flag `expired` so the
  // login page can explain why.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (recovering.current) return;
      recovering.current = true;
      getCurrentSession()
        .then((raw) => {
          if (raw) {
            setSession(toSession(raw));
          } else {
            cognitoSignOut();
            setSession(null);
            setExpired(true);
          }
        })
        .finally(() => {
          recovering.current = false;
        });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const raw = await cognitoSignIn(email, password);
    setExpired(false);
    setSession(toSession(raw));
  }, []);

  const signOut = useCallback(() => {
    cognitoSignOut();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, loading, expired, signIn, signOut }),
    [session, loading, expired, signIn, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useSession = (): SessionContextValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
};
