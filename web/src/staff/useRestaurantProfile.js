import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';

// Settings → Restaurant Profile. Read by anyone signed in (the currency alone
// decides how every price on their screen is formatted); written by the owner.
//
// Unlike the menu or the board, this is one record behind one form, so there
// is no list to keep in step — a save returns the row it wrote and that is
// what the form then holds.
export function useRestaurantProfile(token) {
  const [restaurant, setRestaurant] = useState(null); // null = still loading
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    staffApi
      .getRestaurant(token)
      .then((data) => !cancelled && setRestaurant(data.restaurant))
      .catch((err) => {
        if (!(err instanceof StaffApiError)) throw err;
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const save = useCallback(
    async (body) => {
      setSaving(true);
      setError(null);
      try {
        const data = await staffApi.updateRestaurant(token, body);
        setRestaurant(data.restaurant);
        setSavedAt(Date.now());
        return true;
      } catch (err) {
        if (!(err instanceof StaffApiError)) throw err;
        setError(err.message);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [token],
  );

  return { restaurant, error, saving, savedAt, save, dismissError: () => setError(null) };
}
