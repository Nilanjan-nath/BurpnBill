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
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

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

  // Creating the account for someone the owner has invited. The invite itself
  // is just a pre-authorised email (see server/src/middleware/auth.js) — it
  // doesn't create a login, so without this there is no way in.
  //
  // Whether this signs them straight in depends on Supabase's "Confirm email"
  // setting: with it on, signUp returns a user but NO session until they click
  // the link Supabase emails them, so the caller has to say so rather than
  // look like it hung. With it off, a session comes back and
  // onAuthStateChange takes over exactly as it does for sign-in.
  const signUp = useCallback(
    async (email, password) => {
      setSigningIn(true);
      setSignInError(null);
      setAwaitingConfirmation(false);
      const { data, error } = await authClient.auth.signUp({ email, password });
      setSigningIn(false);
      if (error) {
        setSignInError(error.message);
        return;
      }
      if (!data?.session) setAwaitingConfirmation(true);
    },
    [authClient],
  );

  const signOut = useCallback(() => authClient.auth.signOut(), [authClient]);

  return {
    token,
    signingIn,
    signInError,
    awaitingConfirmation,
    clearNotices: () => {
      setSignInError(null);
      setAwaitingConfirmation(false);
    },
    signIn,
    signUp,
    signOut,
  };
}
