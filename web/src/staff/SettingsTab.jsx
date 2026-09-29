import { useState } from 'react';
import { LayoutGrid, Store, UserCircle } from 'lucide-react';
import { RestaurantProfile } from './RestaurantProfile.jsx';
import { SeatingPlan } from './SeatingPlan.jsx';
import { UserAccount } from './UserAccount.jsx';

// Settings, for everyone — but not the same settings.
//
// Restaurant Profile and Seating Plan are the café's, so they are the owner's.
// User Account is your own name and password, which every role needs and no
// role should need to ask the owner for. A kitchen login therefore opens
// straight onto User Account and never sees the other two exist.
const VIEWS = [
  { id: 'profile', label: 'Restaurant profile', Icon: Store, ownerOnly: true },
  { id: 'seating', label: 'Seating plan', Icon: LayoutGrid, ownerOnly: true },
  { id: 'account', label: 'User account', Icon: UserCircle, ownerOnly: false },
];

export function SettingsTab({ token, identity, auth, onIdentityChange }) {
  const isOwner = identity.role === 'owner';
  const views = VIEWS.filter((v) => isOwner || !v.ownerOnly);
  const [view, setView] = useState(views[0].id);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 print:hidden">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">Settings</h2>
          <p className="text-sm font-semibold text-gray-600">
            {isOwner ? 'Your café’s details, its tables, and your own account.' : 'Your own account.'}
          </p>
        </div>

        {views.length > 1 && (
          <div className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 print:hidden" role="tablist">
            {views.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold ${
                  view === id ? 'bg-teal-600 text-white shadow-sm' : 'text-gray-700 hover:bg-white'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
        )}

        {view === 'profile' && isOwner && (
          <RestaurantProfile
            token={token}
            isOwner={isOwner}
            onRenamed={(restaurantName) => onIdentityChange({ ...identity, restaurantName })}
          />
        )}
        {view === 'seating' && isOwner && <SeatingPlan token={token} />}
        {view === 'account' && (
          <UserAccount token={token} identity={identity} auth={auth} onIdentityChange={onIdentityChange} />
        )}
      </div>
    </div>
  );
}
