import { useCallback, useEffect, useState } from 'react';

// Wraps a Supabase Auth client — the real one in production, a stubbed one
// in tests (see StaffApp.test.jsx) — into just what the dashboard needs: a
// current access token, and sign-in/sign-out. Supabase's own client persists
// the session (localStorage) and refreshes the token before it expires; this
// hook only has to listen for whichever session is current right now.
//
//   token: undefined while the very first check is in flight, null when
//   signed out, a string once signed in.
export function useStaffSession(authClient) {
  const [token, setToken] = useState(undefined);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    authClient.auth.getSession().then(({ data }) => {
      if (!cancelled) setToken(data.session?.access_token ?? null);
    });

    const { data } = authClient.auth.onAuthStateChange((_event, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [authClient]);

  const signIn = useCallback(
    async (email, password) => {
      setSigningIn(true);
      setSignInError(null);
      const { error } = await authClient.auth.signInWithPassword({ email, password });
      setSigningIn(false);
      if (error) setSignInError(error.message);
      // On success, onAuthStateChange above is what actually sets the token
      // — signInWithPassword's own resolved session is not relied on here,
      // so both code paths always go through the exact same state update.
    },
    [authClient],
  );

  const signOut = useCallback(() => authClient.auth.signOut(), [authClient]);

  return { token, signingIn, signInError, signIn, signOut };
}
