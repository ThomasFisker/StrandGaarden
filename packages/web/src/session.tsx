import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { CognitoUserSession } from 'amazon-cognito-identity-js';
import { claimsFromSession, getCurrentSession, signIn as cognitoSignIn, signOut as cognitoSignOut } from './auth';
import type { Claims } from './auth';

export interface Session {
  raw: CognitoUserSession;
  claims: Claims;
  idToken: string;
}

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
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

  useEffect(() => {
    getCurrentSession().then((raw) => {
      setSession(raw ? toSession(raw) : null);
      setLoading(false);
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const raw = await cognitoSignIn(email, password);
    setSession(toSession(raw));
  }, []);

  const signOut = useCallback(() => {
    cognitoSignOut();
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, loading, signIn, signOut }), [session, loading, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useSession = (): SessionContextValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
};
