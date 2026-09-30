import { useEffect, useState } from 'react';
import { Check, Coins, ConciergeBell, MapPin, Phone, Save, Store } from 'lucide-react';
import { useRestaurantProfile } from './useRestaurantProfile.js';

const FIELD =
  'min-h-12 w-full rounded-input border border-ink-300 bg-paper py-2.5 pl-10 pr-3 text-base font-semibold text-ink-900 ' +
  'placeholder:font-normal placeholder:text-ink-500 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 ' +
  'disabled:bg-ink-50 disabled:text-ink-700';
const LABEL = 'mb-1.5 block text-sm font-bold text-ink-900';

// The currencies this is plausibly used in. The column takes any ISO 4217
// code, so this list is a convenience rather than a constraint — it exists so
// nobody has to remember that the code for dirhams is AED.
export const CURRENCIES = [
  ['INR', 'Indian Rupee'],
  ['USD', 'US Dollar'],
  ['EUR', 'Euro'],
  ['GBP', 'Pound Sterling'],
  ['AED', 'UAE Dirham'],
  ['SGD', 'Singapore Dollar'],
  ['LKR', 'Sri Lankan Rupee'],
  ['NPR', 'Nepalese Rupee'],
  ['BDT', 'Bangladeshi Taka'],
];

export function RestaurantProfile({ token, isOwner, onRenamed }) {
  const profile = useRestaurantProfile(token);
  const [form, setForm] = useState(null);

  // The loaded record seeds the form once. After that the form is the source
  // of truth for what's on screen, so typing isn't overwritten by a refetch.
  useEffect(() => {
    if (profile.restaurant && form === null) {
      setForm({
        name: profile.restaurant.name ?? '',
        address: profile.restaurant.address ?? '',
        phone: profile.restaurant.phone ?? '',
        currency_code: profile.restaurant.currency_code ?? 'INR',
        service_mode: profile.restaurant.service_mode ?? 'table',
      });
    }
  }, [profile.restaurant, form]);

  if (profile.restaurant === null && !profile.error) {
    return <p className="p-10 text-center text-sm font-semibold text-ink-700">Loading the profile…</p>;
  }
  if (!form) return null;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    // Every field, every time — this form is a full replace, not a patch. A
    // blank address or phone is a cleared one: validate.js turns "" into null,
    // so one place decides what empty means rather than two disagreeing.
    const name = form.name.trim();
    const saved = await profile.save({
      name,
      address: form.address.trim(),
      phone: form.phone.trim(),
      currency_code: form.currency_code,
      service_mode: form.service_mode,
    });
    // The sidebar names the café you are signed in to, and it reads that from
    // the identity fetched at sign-in — so a rename has to reach it, or the
    // screen keeps showing the old name until someone reloads. Same reason
    // renaming yourself updates it (UserAccount).
    if (saved) onRenamed?.(name);
  };

  const changed =
    form.name !== (profile.restaurant.name ?? '') ||
    form.address !== (profile.restaurant.address ?? '') ||
    form.phone !== (profile.restaurant.phone ?? '') ||
    form.currency_code !== profile.restaurant.currency_code ||
    form.service_mode !== profile.restaurant.service_mode;

  return (
    <form onSubmit={submit} className="overflow-hidden rounded-card border border-ink-200 bg-paper">
      <div className="border-b border-ink-200 bg-ink-50 p-6">
        <h3 className="text-lg font-bold text-ink-900">Business identity</h3>
        <p className="text-sm font-semibold text-ink-600">
          What a customer sees when they scan a table, and what goes on their bill.
        </p>
      </div>

      {profile.error && (
        <p className="m-6 mb-0 rounded-card border border-danger-200 bg-danger-50 px-3 py-2 text-sm font-bold text-danger-700" role="alert">
          {profile.error}
        </p>
      )}

      <div className="space-y-4 p-6">
        <Field id="cafe-name" label="Restaurant name" Icon={Store}>
          <input
            id="cafe-name"
            type="text"
            value={form.name}
            onChange={set('name')}
            maxLength={120}
            required
            disabled={!isOwner}
            className={FIELD}
          />
        </Field>

        <Field id="cafe-address" label="Physical address" Icon={MapPin}>
          <input
            id="cafe-address"
            type="text"
            value={form.address}
            onChange={set('address')}
            maxLength={200}
            disabled={!isOwner}
            placeholder="Street, area, town"
            className={FIELD}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="cafe-phone" label="Phone number" Icon={Phone}>
            <input
              id="cafe-phone"
              type="tel"
              value={form.phone}
              onChange={set('phone')}
              maxLength={40}
              disabled={!isOwner}
              placeholder="For the bill"
              className={FIELD}
            />
          </Field>

          <Field id="cafe-currency" label="Operational currency" Icon={Coins}>
            <select id="cafe-currency" value={form.currency_code} onChange={set('currency_code')} disabled={!isOwner} className={FIELD}>
              {CURRENCIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {code} — {name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <Field id="cafe-service" label="How does food reach the customer?" Icon={ConciergeBell}>
            <select id="cafe-service" value={form.service_mode} onChange={set('service_mode')} disabled={!isOwner} className={FIELD}>
              <option value="table">Brought to the table</option>
              <option value="counter">Collected at the counter</option>
            </select>
          </Field>
          <p className="mt-1.5 text-xs font-semibold text-ink-600">
            Decides what a customer's phone says when their order is ready — "on its way to your table" or "please
            collect it from the counter". Pick the one that is true; a promise nobody keeps is worse than none.
          </p>
        </div>

        <p className="text-xs font-semibold text-ink-600">
          The currency changes how every price is shown, here and on the customer's menu. It does not convert any
          price you have already set.
        </p>
      </div>

      {isOwner && (
        <div className="flex items-center justify-end gap-3 border-t border-ink-200 bg-ink-50 px-6 py-4">
          {profile.savedAt && !changed && (
            <span className="flex items-center gap-1.5 text-sm font-bold text-ready-ink">
              <Check className="h-4 w-4" aria-hidden="true" /> Saved
            </span>
          )}
          <button
            type="submit"
            disabled={profile.saving || !changed}
            className="flex items-center gap-1.5 min-h-12 rounded-card bg-brand px-4 text-sm font-bold text-white transition duration-150 ease-tap hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {profile.saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      )}
    </form>
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
