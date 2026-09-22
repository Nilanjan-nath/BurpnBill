import { useEffect, useState } from 'react';
import { createStaffAuthClient } from './supabaseClient.js';
import { useStaffSession } from './useStaffSession.js';
import { useBoard } from './useBoard.js';
import { staffApi, StaffApiError } from './staffApi.js';
import { SignInScreen } from './SignInScreen.jsx';
import { Board } from './Board.jsx';
import './staff.css';

// The real Supabase Auth client is only ever constructed once this component
// actually mounts — not at module load time — so a missing/misconfigured
// VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY becomes an ordinary, catchable
// render-time message instead of an uncaught exception blanking the page the
// instant the lazy staff chunk loads. Tests skip this entirely by passing
// their own fake client via the `auth` prop.
export default function StaffApp({ auth }) {
  const [client] = useState(() => {
    if (auth) return { ready: auth };
    try {
      return { ready: createStaffAuthClient() };
    } catch (err) {
      return { failed: err.message };
    }
  });

  if (client.failed) {
    return (
      <Centered>
        <p>{client.failed}</p>
      </Centered>
    );
  }
  return <Authenticated auth={client.ready} />;
}

function Authenticated({ auth }) {
  const session = useStaffSession(auth);

  if (session.token === undefined) return <Centered>Loading…</Centered>;
  if (session.token === null) return <SignInScreen session={session} />;
  return <SignedIn key={session.token} token={session.token} onSignOut={session.signOut} />;
}

// Being logged into Supabase and being LINKED to a café are two different
// things — a login can exist without a staff_members row (see
// docs/TASKS.md's housekeeping item). GET /me is what tells them apart, and
// a 403 there means "sign in worked, but this account isn't staff anywhere".
function SignedIn({ token, onSignOut }) {
  const [identity, setIdentity] = useState(undefined); // undefined = checking, null = not linked
  const [error, setError] = useState(null);
  const board = useBoard(identity ? token : null);

  useEffect(() => {
    let cancelled = false;
    staffApi
      .me(token)
      .then(({ staff }) => {
        if (!cancelled) setIdentity(staff);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof StaffApiError && err.status === 403) setIdentity(null);
        else setError(err instanceof StaffApiError ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <Centered>
        <p>{error}</p>
        <button type="button" onClick={onSignOut}>
          Sign out and try again
        </button>
      </Centered>
    );
  }
  if (identity === undefined) return <Centered>Loading…</Centered>;
  if (identity === null) {
    return (
      <Centered>
        <p>This login isn't linked to a café yet. Ask the owner to add you in Supabase.</p>
        <button type="button" onClick={onSignOut}>
          Sign out
        </button>
      </Centered>
    );
  }
  return <Board identity={identity} board={board} onSignOut={onSignOut} />;
}

function Centered({ children }) {
  return (
    <main className="staff-centered">
      <p>{children}</p>
    </main>
  );
}
