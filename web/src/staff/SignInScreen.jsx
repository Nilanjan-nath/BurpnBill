import { useState } from 'react';
import { AuthShell } from './AuthShell.jsx';

const FIELD =
  'min-h-12 w-full rounded-input border border-ink-300 bg-paper px-3 text-base font-semibold text-ink-900 ' +
  'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';

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
    <AuthShell>
      <form
        className="w-full max-w-sm space-y-5 rounded-card border border-ink-200 bg-paper p-8"
        onSubmit={submit}
      >
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">
            {signingUp ? 'Create your account' : 'Staff sign in'}
          </h1>
          {signingUp && (
            <p className="mt-1.5 text-sm font-semibold text-ink-600">Use the email address your café invited.</p>
          )}
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-bold text-ink-900">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-bold text-ink-900">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={signingUp ? 6 : undefined}
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            className={FIELD}
          />
        </label>
        {session.signInError && (
          <p
            className="rounded-input border border-danger-200 bg-danger-50 px-3 py-2 text-sm font-bold text-danger-700"
            role="alert"
          >
            {session.signInError}
          </p>
        )}
        {session.awaitingConfirmation && (
          <p
            className="rounded-input border border-butter-500 bg-butter-100 px-3 py-2 text-sm font-semibold text-ink-900"
            role="status"
          >
            Account created. Check your email for a confirmation link, then sign in.
          </p>
        )}
        <button
          type="submit"
          disabled={session.signingIn}
          className="min-h-12 w-full rounded-card bg-brand px-6 text-base font-bold text-white transition duration-150 ease-tap hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98] disabled:opacity-60"
        >
          {session.signingIn
            ? signingUp
              ? 'Creating…'
              : 'Signing in…'
            : signingUp
              ? 'Create account'
              : 'Sign in'}
        </button>
        <button
          type="button"
          className="block w-full rounded-input py-1 text-center text-sm font-bold text-brand underline-offset-2 hover:text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          onClick={() => switchTo(signingUp ? 'signin' : 'signup')}
        >
          {signingUp ? 'Already have an account? Sign in' : 'Been invited? Create your account'}
        </button>
      </form>
    </AuthShell>
  );
}
