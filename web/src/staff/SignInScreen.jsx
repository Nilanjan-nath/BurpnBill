import { useState } from 'react';

export function SignInScreen({ session }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e) => {
    e.preventDefault();
    session.signIn(email, password);
  };

  return (
    <main className="staff-centered">
      <form className="staff-signin" onSubmit={submit}>
        <h1>Staff sign in</h1>
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
            autoComplete="current-password"
          />
        </label>
        {session.signInError && (
          <p className="staff-error" role="alert">
            {session.signInError}
          </p>
        )}
        <button type="submit" disabled={session.signingIn}>
          {session.signingIn ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
