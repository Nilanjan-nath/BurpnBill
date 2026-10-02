import { useEffect, useState } from 'react';
import { createStaffAuthClient } from './supabaseClient.js';
import { useStaffSession } from './useStaffSession.js';
import { useBoard } from './useBoard.js';
import { staffApi, StaffApiError } from './staffApi.js';
import { SignInScreen } from './SignInScreen.jsx';
import { SetPasswordScreen } from './SetPasswordScreen.jsx';
import { Board } from './Board.jsx';
import { CreateCafeScreen } from './CreateCafeScreen.jsx';
import { AuthShell } from './AuthShell.jsx';
import './tailwind.css';

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
  if (session.invitation) return <SetPasswordScreen session={session} />;
  return <SignedIn key={session.token} token={session.token} auth={auth} onSignOut={session.signOut} />;
}

// Being logged into Supabase and being LINKED to a café are two different
// things — a login can exist without a staff_members row (see
// docs/TASKS.md's housekeeping item). GET /me is what tells them apart, and
// a 403 there means "sign in worked, but this account isn't staff anywhere".
function SignedIn({ token, auth, onSignOut }) {
  const [identity, setIdentity] = useState(undefined); // undefined = checking, null = not linked
  const [error, setError] = useState(null);
  const board = useBoard(identity ? token : null, identity?.role);

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
        <button
          type="button"
          onClick={onSignOut}
          className="min-h-12 rounded-card border-2 border-brand px-5 text-base font-bold text-brand transition duration-150 ease-tap hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98]"
        >
          Sign out and try again
        </button>
      </Centered>
    );
  }
  if (identity === undefined) return <Centered>Loading…</Centered>;
  // Signed in, but belonging to no café — either someone who signed up on their
  // own, or an invitee whose invite has expired or been revoked. Both get the
  // same offer: make a café of your own. It used to be a dead end telling them
  // to ask an owner, which is no help to the person who IS the owner.
  if (identity === null) {
    return <CreateCafeScreen token={token} onCreated={setIdentity} onSignOut={onSignOut} />;
  }
  // setIdentity, so renaming yourself in Settings updates the sidebar too
  // rather than only the form you typed it into.
  return (
    <Board
      identity={identity}
      board={board}
      token={token}
      auth={auth}
      onIdentityChange={setIdentity}
      onSignOut={onSignOut}
    />
  );
}

function Centered({ children }) {
  return (
    <AuthShell>
      <div className="flex flex-col items-center gap-4 text-center text-base font-semibold text-ink-700">{children}</div>
    </AuthShell>
  );
}
