import { useState } from 'react';
import { Crown, ChefHat, Mail, Plus, UserMinus, X, Clock } from 'lucide-react';
import { useStaffAdmin } from './useStaffAdmin.js';

// Three roles, and what each one actually opens — the description is the point
// of this screen, so it's on the picker itself rather than in a help doc.
const ROLES = [
  { id: 'owner', label: 'Owner', Icon: Crown, blurb: 'Everything, including the menu, tables and this screen', chip: 'bg-amber-100 text-amber-900' },
  { id: 'staff', label: 'Staff', Icon: Mail, blurb: 'Order board, 86 items, and the till — POS, QR orders, checkout', chip: 'bg-teal-100 text-teal-800' },
  { id: 'kitchen', label: 'Kitchen', Icon: ChefHat, blurb: 'Order board and 86 items only', chip: 'bg-gray-200 text-gray-800' },
];
const roleChip = (role) => ROLES.find((r) => r.id === role)?.chip ?? 'bg-gray-200 text-gray-800';
const roleLabel = (role) => ROLES.find((r) => r.id === role)?.label ?? role;

export function StaffTab({ token }) {
  const admin = useStaffAdmin(token);
  const [inviting, setInviting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);

  if (admin.members === null) {
    return <p className="p-10 text-center text-sm font-semibold text-gray-700">Loading the team…</p>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        {admin.error && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800" role="alert">
            <span>{admin.error}</span>
            <button type="button" onClick={admin.dismissError} aria-label="Dismiss" className="text-lg leading-none">
              ×
            </button>
          </div>
        )}

        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Your team</h2>
            <p className="text-sm font-semibold text-gray-600">
              {admin.members.length} {admin.members.length === 1 ? 'person' : 'people'}
              {admin.invites.length > 0 && ` · ${admin.invites.length} invited`}
            </p>
          </div>
          {!inviting && (
            <button
              type="button"
              onClick={() => setInviting(true)}
              className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Invite someone
            </button>
          )}
        </div>

        {inviting && <InviteForm admin={admin} onDone={() => setInviting(false)} />}

        <div className="rounded-2xl border border-gray-200 bg-white">
          {admin.members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 border-b border-gray-200 p-4 last:border-b-0">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">
                {(m.display_name ?? roleLabel(m.role)).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-gray-900">{m.display_name ?? 'Unnamed'}</div>
                <div className="text-xs font-semibold text-gray-600">Joined {new Date(m.created_at).toLocaleDateString()}</div>
              </div>

              {confirmRemove === m.user_id ? (
                // Inline, not window.confirm — same pattern as the board's
                // Cancel, and it keeps the person's name on screen while you
                // decide.
                <div className="flex flex-none items-center gap-2">
                  <span className="text-sm font-bold text-gray-900">Remove {m.display_name ?? 'them'}?</span>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(null)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-800 hover:bg-gray-50"
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    disabled={admin.busyId === m.user_id}
                    onClick={async () => {
                      await admin.remove(m.user_id);
                      setConfirmRemove(null);
                    }}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex flex-none items-center gap-2">
                  <label className="sr-only" htmlFor={`role-${m.user_id}`}>
                    Role for {m.display_name ?? 'this person'}
                  </label>
                  <select
                    id={`role-${m.user_id}`}
                    value={m.role}
                    disabled={admin.busyId === m.user_id}
                    onChange={(e) => admin.setRole(m.user_id, e.target.value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold ${roleChip(m.role)} disabled:opacity-50`}
                  >
                    {ROLES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove ${m.display_name ?? 'this person'}`}
                    onClick={() => setConfirmRemove(m.user_id)}
                    className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-red-700"
                  >
                    <UserMinus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {admin.invites.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">Waiting to sign up</h3>
            <div className="rounded-2xl border border-gray-200 bg-white">
              {admin.invites.map((i) => (
                <div key={i.id} className="flex items-center gap-3 border-b border-gray-200 p-4 last:border-b-0">
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-amber-100">
                    <Mail className="h-4 w-4 text-amber-900" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-gray-900">{i.email}</div>
                    <div className="flex items-center gap-1 text-xs font-semibold text-gray-600">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {i.expired ? 'Expired — invite again' : `Expires ${new Date(i.expires_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  <span className={`flex-none rounded-full px-3 py-1.5 text-xs font-bold ${roleChip(i.role)}`}>
                    {roleLabel(i.role)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Revoke invite for ${i.email}`}
                    disabled={admin.busyId === i.id}
                    onClick={() => admin.revokeInvite(i.id)}
                    className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-red-700 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InviteForm({ admin, onDone }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('staff');
  const [problem, setProblem] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setProblem(null);
    const failed = await admin.invite({
      email,
      role,
      ...(displayName.trim() && { display_name: displayName.trim() }),
    });
    if (failed) setProblem(failed);
    else onDone();
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-white p-5">
      <h3 className="text-base font-bold text-gray-900">Invite someone</h3>
      {/* No email is sent — see server/src/services/staffAdmin.js. Saying so
          here stops anyone waiting for a message that never comes. */}
      <p className="mt-1 text-sm font-semibold text-gray-600">
        No email is sent. They sign up with this address themselves and join automatically.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="invite-email" className="text-xs font-bold uppercase tracking-wide text-gray-600">
            Email address
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="priya@example.com"
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none placeholder:font-medium placeholder:text-gray-500 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <div>
          <label htmlFor="invite-name" className="text-xs font-bold uppercase tracking-wide text-gray-600">
            Name <span className="font-semibold normal-case text-gray-500">(optional)</span>
          </label>
          <input
            id="invite-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Priya"
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none placeholder:font-medium placeholder:text-gray-500 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="text-xs font-bold uppercase tracking-wide text-gray-600">Role</legend>
        <div className="mt-2 space-y-2">
          {ROLES.map(({ id, label, Icon, blurb }) => (
            <label
              key={id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                role === id ? 'border-teal-600 bg-teal-50' : 'border-gray-300 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="role"
                value={id}
                checked={role === id}
                onChange={() => setRole(id)}
                className="mt-1 accent-teal-600"
              />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                  <Icon className="h-4 w-4" aria-hidden="true" /> {label}
                </span>
                <span className="block text-xs font-semibold text-gray-600">{blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {problem && <p className="mt-3 text-sm font-bold text-red-700">{problem}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-bold text-gray-800 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={admin.busyId === 'new-invite'}
          className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50"
        >
          {admin.busyId === 'new-invite' ? 'Adding…' : 'Add to team'}
        </button>
      </div>
    </form>
  );
}
