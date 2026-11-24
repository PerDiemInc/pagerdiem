// Whether this phone is signed in, and the API client for its server. Any 401 from the server
// (signed out from the web, or removed from the team) signs the phone out on the spot.
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { createClient, type Api, type Me } from '@/lib/api';
import { clearSession, loadSession, saveSession, type Session } from '@/lib/session';

type State =
  | { status: 'loading' }
  | { status: 'signedOut'; revoked?: boolean }
  | { status: 'signedIn'; session: Session; api: Api };

/** What pairing or signing up returns: the token, and who you are on which team. */
type SignedIn = { server: string; token: string; me?: Me };
type Value = State & { signIn: (s: SignedIn) => Promise<void>; signOut: (revoked?: boolean) => Promise<void> };

const SessionContext = createContext<Value | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>({ status: 'loading' });

  const signOut = useCallback(async (revoked = false) => {
    await clearSession();
    queryClient.clear();
    setState({ status: 'signedOut', revoked });
  }, [queryClient]);

  const signedIn = useCallback((session: Session): State => ({
    status: 'signedIn', session, api: createClient({ ...session, onUnauthorized: () => { signOut(true); } }),
  }), [signOut]);

  const signIn = useCallback(async ({ server, token, me }: SignedIn) => {
    // Signed in somewhere already (another server, or another person): that sign-in stops ringing.
    if (state.status === 'signedIn') await state.api.post('/api/app/signout').catch(() => null);
    const session: Session = { server, token, publicUrl: me?.team?.publicUrl, timezone: me?.team?.timezone };
    await saveSession(session);
    setState(signedIn(session));
  }, [signedIn, state]);

  useEffect(() => {
    loadSession().then((s) => setState(s ? signedIn(s) : { status: 'signedOut' }));
  }, [signedIn]);

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession needs <SessionProvider>');
  return value;
}

/** The API client of a signed-in phone. Screens behind the sign-in gate can rely on it. */
export function useApi() {
  const s = useSession();
  if (s.status !== 'signedIn') throw new Error('Not signed in');
  return s.api;
}
