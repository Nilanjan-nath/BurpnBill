import { useEffect, useState } from 'react';
import { Check, ChefHat, Crown, KeyRound, Mail, User } from 'lucide-react';
import { staffApi, StaffApiError } from './staffApi.js';

const FIELD =
  'w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-10 pr-3 text-sm font-semibold text-gray-900 ' +
  'placeholder:font-normal placeholder:text-gray-500 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 ' +
  'disabled:bg-gray-50 disabled:text-gray-700';
const LABEL = 'mb-1.5 block text-sm font-bold text-gray-900';

const ROLES = {
  owner: { label: 'Owner', Icon: Crown, chip: 'bg-amber-100 text-amber-900', blurb: 'Everything, including the menu, tables and settings' },
  staff: { label: 'Staff', Icon: User, chip: 'bg-teal-100 text-teal-800', blurb: 'Order board, 86 items, and the till' },
  kitchen: { label: 'Kitchen', Icon: ChefHat, chip: 'bg-gray-200 text-gray-800', blurb: 'Order board and 86 items only' },
};

// Settings → User Account: you, not the team. The Staff tab is where an owner
// changes someone else's name or role; this is the only place to change your
// own, and it can never touch a role — the server refuses one here outright.
export function UserAccount({ token, identity, auth, onIdentityChange }) {
  const [name, setName] = useState(identity.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState(null);
  const [email, setEmail] = useState(null);

  // The email belongs to the Supabase session, not to staff_members — the API
  // never sees it except when claiming an invite.
  useEffect(() => {
    let cancelled = false;
    auth?.auth
      ?.getSession?.()
      .then(({ data }) => !cancelled && setEmail(data?.session?.user?.email ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [auth]);

  const role = ROLES[identity.role] ?? { label: identity.role, Icon: User, chip: 'bg-gray-200 text-gray-800', blurb: '' };
  const nameChanged = name.trim() !== (identity.displayName ?? '');

  const saveName = async (e) => {
    e.preventDefault();
    setSavingName(true);
    setNameError(null);
    try {
      const { staff } = await staffApi.updateOwnProfile(token, { display_name: name.trim() });
      // The sidebar shows this, so the whole app is told rather than just this
      // form — otherwise you'd rename yourself and still see the old name.
      onIdentityChange(staff);
      setNameSaved(true);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setNameError(err.message);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={saveName} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 bg-gray-50 p-6">
          <h3 className="text-lg font-bold text-gray-900">Your account</h3>
          <p className="text-sm font-semibold text-gray-600">Your name is what the order timeline records against anything you do.</p>
        </div>

        <div className="space-y-4 p-6">
          <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-4">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-teal-600 text-base font-bold text-white">
              {(identity.displayName ?? role.label).slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-gray-900">{identity.displayName ?? 'Unnamed'}</div>
              <div className="text-xs font-semibold text-gray-600">{role.blurb}</div>
            </div>
            <span className={`flex flex-none items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${role.chip}`}>
              <role.Icon className="h-3.5 w-3.5" aria-hidden="true" /> {role.label}
            </span>
          </div>

          <div>
            <label className={LABEL} htmlFor="account-name">
              Display name
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input
                id="account-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameSaved(false);
                }}
                maxLength={80}
                required
                className={FIELD}
              />
            </div>
          </div>

          <div>
            <label className={LABEL} htmlFor="account-email">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input id="account-email" type="email" value={email ?? ''} readOnly disabled className={FIELD} />
            </div>
            <p className="mt-1.5 text-xs font-semibold text-gray-600">
              This is your sign-in, and it's how an invite found you. Changing it isn't something Petuk can do — it lives in
              your login, not in the café's records.
            </p>
          </div>

          {nameError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">
              {nameError}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4">
          {nameSaved && !nameChanged && (
            <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-700">
              <Check className="h-4 w-4" aria-hidden="true" /> Saved
            </span>
          )}
          <button
            type="submit"
            disabled={savingName || !nameChanged || name.trim() === ''}
            className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50"
          >
            {savingName ? 'Saving…' : 'Save name'}
          </button>
        </div>
      </form>

      <PasswordCard auth={auth} />
    </div>
  );
}

// The password never touches Petuk's API: the browser's own Supabase client
// holds the session and changes it directly, so no password is ever sent to a
// server we wrote or logged by one.
function PasswordCard({ auth }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (password !== confirm) return setError("Those two don't match.");
    if (password.length < 6) return setError('Use at least 6 characters.');

    setBusy(true);
    const { error: authError } = (await auth?.auth?.updateUser?.({ password })) ?? {
      error: new Error('Changing your password is not available here.'),
    };
    setBusy(false);
    if (authError) return setError(authError.message);

    setPassword('');
    setConfirm('');
    setDone(true);
  };

  return (
    <form onSubmit={submit} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50 p-6">
        <h3 className="text-lg font-bold text-gray-900">Password</h3>
        <p className="text-sm font-semibold text-gray-600">Changed with your login directly — it never passes through Petuk.</p>
      </div>

      <div className="grid gap-4 p-6 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="account-password">
            New password
          </label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input
              id="account-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setDone(false);
              }}
              autoComplete="new-password"
              className={FIELD}
            />
          </div>
        </div>
        <div>
          <label className={LABEL} htmlFor="account-password-confirm">
            Confirm new password
          </label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input
              id="account-password-confirm"
              type="password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setDone(false);
              }}
              autoComplete="new-password"
              className={FIELD}
            />
          </div>
        </div>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800 sm:col-span-2" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4">
        {done && (
          <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-700">
            <Check className="h-4 w-4" aria-hidden="true" /> Password changed
          </span>
        )}
        <button
          type="submit"
          disabled={busy || password === ''}
          className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50"
        >
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}
