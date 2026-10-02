import { useState } from 'react';
import { AuthShell } from './AuthShell.jsx';

const FIELD =
  'min-h-12 w-full rounded-input border border-ink-300 bg-paper px-3 text-base font-semibold text-ink-900 ' +
  'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';

// The last step of an invite. Supabase's emailed link signs the invitee in but
// leaves them without a password, so this asks for one before anything else.
// Nothing here calls our API: the café link happens on their first request after.
export function SetPasswordScreen({ session }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    if (password !== again) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    session.setPassword(password);
  };

  const cafe = session.invitation?.restaurantName;
  return (
    <AuthShell>
      <form className="w-full max-w-sm space-y-5 rounded-card border border-ink-200 bg-paper p-8" onSubmit={submit}>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Set your password</h1>
          <p className="mt-1.5 text-sm font-semibold text-ink-600">
            {cafe ? `You've been invited to ${cafe}.` : "You've been invited."} Choose a password to finish joining.
          </p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-bold text-ink-900">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-bold text-ink-900">Type it again</span>
          <input
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            required
            autoComplete="new-password"
            className={FIELD}
          />
        </label>
        {(mismatch || session.signInError) && (
          <p className="rounded-input border border-danger-200 bg-danger-50 px-3 py-2 text-sm font-bold text-danger-700" role="alert">
            {mismatch ? "Those two passwords don't match." : session.signInError}
          </p>
        )}
        <button
          type="submit"
          disabled={session.signingIn}
          className="min-h-12 w-full rounded-card bg-brand px-6 text-base font-bold text-white transition duration-150 ease-tap hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98] disabled:opacity-60"
        >
          {session.signingIn ? 'Saving…' : 'Save and continue'}
        </button>
      </form>
    </AuthShell>
  );
}
