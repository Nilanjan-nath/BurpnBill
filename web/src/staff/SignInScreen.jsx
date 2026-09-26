import { useState } from 'react';

// Two modes on one screen. Sign-up exists because an invite is only a
// pre-authorised email (server/src/services/staffAdmin.js) — it deliberately
// creates no login and sends no mail, so an invited person needs somewhere to
// make their own account. Joining the cafe then happens by itself on their
// first authenticated request.
export function SignInScreen({ session }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const signingUp = mode === 'signup';

  const submit = (e) => {
    e.preventDefault();
    if (signingUp) session.signUp(email, password);
    else session.signIn(email, password);
  };

  const switchTo = (next) => {
    setMode(next);
    setPassword('');
    session.clearNotices();
  };

  return (
    <main className="staff-centered">
      <form className="staff-signin" onSubmit={submit}>
        <h1>{signingUp ? 'Create your account' : 'Staff sign in'}</h1>
        {signingUp && (
          <p className="staff-muted">Use the email address your café invited.</p>
        )}
        <label>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={signingUp ? 6 : undefined}
            autoComplete={signingUp ? 'new-password' : 'current-password'}
          />
        </label>
        {session.signInError && (
          <p className="staff-error" role="alert">
            {session.signInError}
          </p>
        )}
        {session.awaitingConfirmation && (
          <p className="staff-muted" role="status">
            Account created. Check your email for a confirmation link, then sign in.
          </p>
        )}
        <button type="submit" disabled={session.signingIn}>
          {session.signingIn
            ? signingUp
              ? 'Creating…'
              : 'Signing in…'
            : signingUp
              ? 'Create account'
              : 'Sign in'}
        </button>
        <button type="button" className="link" onClick={() => switchTo(signingUp ? 'signin' : 'signup')}>
          {signingUp ? 'Already have an account? Sign in' : 'Been invited? Create your account'}
        </button>
      </form>
    </main>
  );
}
