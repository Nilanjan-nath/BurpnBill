import { useState } from 'react';
import { Coins, LayoutGrid, LogOut, Store, UserCircle } from 'lucide-react';
import { staffApi, StaffApiError } from './staffApi.js';
import { CURRENCIES } from './RestaurantProfile.jsx';
import { AuthShell } from './AuthShell.jsx';

const FIELD =
  'min-h-12 w-full rounded-input border border-ink-300 bg-paper py-2.5 pl-10 pr-3 text-base font-semibold text-ink-900 ' +
  'placeholder:font-normal placeholder:text-ink-500 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';
const LABEL = 'mb-1.5 block text-sm font-bold text-ink-900';

// Where a self-signup lands. Signing up creates a Supabase account and nothing
// else — an invite is a pre-authorised email, not an account (ARCHITECTURE §6)
// — so someone who arrives with no invite waiting has a login that belongs to
// no café. That used to be a dead end reading "ask the owner to add you in
// Supabase", which is no help at all to the owner themselves.
//
// The tables are asked for here rather than left for later because the first
// open of the seating plan should be a room to arrange, not an empty grid and a
// button. Same reasoning the layout migration used when it placed every
// existing table instead of leaving them unplaced.
export function CreateCafeScreen({ token, onCreated, onSignOut }) {
  const [form, setForm] = useState({ name: '', currency_code: 'INR', table_count: '6', display_name: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { staff } = await staffApi.createRestaurant(token, {
        name: form.name.trim(),
        currency_code: form.currency_code,
        table_count: Number(form.table_count) || 0,
        ...(form.display_name.trim() && { display_name: form.display_name.trim() }),
      });
      onCreated(staff);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <AuthShell>
      <form onSubmit={submit} className="w-full max-w-lg overflow-hidden rounded-card border border-ink-200 bg-paper">
        <div className="border-b border-ink-200 bg-ink-50 p-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Create your café</h1>
          <p className="text-sm font-semibold text-ink-600">
            Your account is ready. Tell us about the café and it's yours — you can change any of this later in
            Settings.
          </p>
        </div>

        {error && (
          <p
            className="m-6 mb-0 rounded-input border border-danger-200 bg-danger-50 px-3 py-2 text-sm font-bold text-danger-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="space-y-4 p-6">
          <Field id="new-cafe-name" label="Café name" Icon={Store}>
            <input
              id="new-cafe-name"
              type="text"
              value={form.name}
              onChange={set('name')}
              maxLength={120}
              required
              autoFocus
              placeholder="What's on the sign outside"
              className={FIELD}
            />
          </Field>

          {/* The note explains the tables field, so it is grouped with it —
              loose in the column it reads as a preamble to "Your name". */}
          <div className="space-y-1.5">
            <div className="grid gap-4 sm:grid-cols-2">
            <Field id="new-cafe-tables" label="How many tables" Icon={LayoutGrid}>
              <input
                id="new-cafe-tables"
                type="number"
                min="0"
                max="48"
                value={form.table_count}
                onChange={set('table_count')}
                className={FIELD}
              />
            </Field>

            <Field id="new-cafe-currency" label="Currency" Icon={Coins}>
              <select id="new-cafe-currency" value={form.currency_code} onChange={set('currency_code')} className={FIELD}>
                {CURRENCIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} — {name}
                  </option>
                ))}
              </select>
            </Field>
            </div>

            <p className="text-xs font-semibold text-ink-600">
              We'll put them on your floor plan as T1, T2, T3 — drag them into the shape of your room, rename them,
              and print their QR codes from Settings.
            </p>
          </div>

          <Field id="new-cafe-owner" label="Your name" Icon={UserCircle}>
            <input
              id="new-cafe-owner"
              type="text"
              value={form.display_name}
              onChange={set('display_name')}
              maxLength={80}
              placeholder="Shown on orders you handle"
              className={FIELD}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink-200 bg-ink-50 px-6 py-4">
          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-1.5 text-sm font-bold text-ink-700 hover:text-ink-900"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
          </button>
          <button
            type="submit"
            disabled={saving || !form.name.trim()}
            className="min-h-12 rounded-card bg-brand px-6 text-base font-bold text-white transition duration-150 ease-tap hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create café'}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}

function Field({ id, label, Icon, children }) {
  return (
    <div>
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
