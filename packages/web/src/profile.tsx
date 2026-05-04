import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getMyProfile } from './api';
import { useSession } from './session';
import type { MyProfile } from './types';

interface ProfileContextValue {
  profile: MyProfile | null;
  error: string | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<ProfileContextValue | undefined>(undefined);

/** Single source of truth for /me on the client side. Fetched once after
 * login (or session refresh); used by GdprGate, the StageBanner, the
 * Upload form (house prefill + freeze), and GalleryPhoto (freeze of
 * comment/removal forms). Pages can call refresh() if they perform an
 * action that should change the cached profile. */
export const ProfileProvider = ({ children }: { children: ReactNode }) => {
  const { session } = useSession();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setProfile(null);
      return;
    }
    setError(null);
    try {
      const p = await getMyProfile(session.idToken);
      setProfile(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente profil');
    }
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({ profile, error, refresh }), [profile, error, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useProfile = (): ProfileContextValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProfile must be used inside ProfileProvider');
  return v;
};
