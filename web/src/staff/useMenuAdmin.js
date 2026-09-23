import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';

// The Menu tab's data: the admin item list (includes 86'd items, unlike the
// customer menu), plus create/update/delete/toggle. No live push here —
// unlike the order board, menu edits are infrequent and made by the person
// looking at this exact screen, so a refetch after each action is enough.
export function useMenuAdmin(token) {
  const [items, setItems] = useState(null); // null = still loading
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await staffApi.listItems(token);
      setItems(data.items);
      setError(null);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Every mutation follows the same shape: mark busy, try the call, surface
  // a StaffApiError as `error` (re-thrown otherwise), always reload after so
  // the list can never drift from what the server actually has, then clear busy.
  const mutate = useCallback(
    async (id, action) => {
      setBusyId(id);
      setError(null);
      try {
        await action();
        await load();
        return true;
      } catch (err) {
        if (!(err instanceof StaffApiError)) throw err;
        setError(err.message);
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const createItem = (body) => mutate('new', () => staffApi.createItem(token, body));
  const updateItem = (id, body) => mutate(id, () => staffApi.updateItem(token, id, body));
  const deleteItem = (id) => mutate(id, () => staffApi.deleteItem(token, id));
  const setAvailability = (id, isAvailable) => mutate(id, () => staffApi.setItemAvailability(token, id, isAvailable));

  return { items, error, busyId, createItem, updateItem, deleteItem, setAvailability, dismissError: () => setError(null) };
}
