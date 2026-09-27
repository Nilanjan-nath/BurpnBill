import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';

// The Menu tab's data: the admin item list (includes 86'd items, unlike the
// customer menu), the café's categories, and every mutation either one needs.
// No live push here — unlike the order board, menu edits are infrequent and
// made by the person looking at this exact screen, so a refetch after each
// action is enough.
//
// Items and categories load together because the screen is never useful with
// only one of them: an item's category name comes from the item, but the form's
// picker and the whole Categories view come from the other list.
export function useMenuAdmin(token) {
  const [items, setItems] = useState(null); // null = still loading
  const [categories, setCategories] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [itemData, categoryData] = await Promise.all([staffApi.listItems(token), staffApi.listCategories(token)]);
      setItems(itemData.items);
      setCategories(categoryData.categories);
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
        const result = await action();
        await load();
        return result ?? true;
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

  // A photo is saved against an item that already exists, so creating an item
  // with one is two calls: the item, then its picture. The form does them in
  // that order and reports either failure on its own terms.
  const uploadImage = (id, file) => mutate(id, () => staffApi.uploadItemImage(token, id, file));
  const removeImage = (id) => mutate(id, () => staffApi.removeItemImage(token, id));

  const createCategory = (body) => mutate('new-category', () => staffApi.createCategory(token, body));
  const updateCategory = (id, body) => mutate(id, () => staffApi.updateCategory(token, id, body));
  const deleteCategory = (id) => mutate(id, () => staffApi.deleteCategory(token, id));

  return {
    items,
    categories,
    error,
    busyId,
    createItem,
    updateItem,
    deleteItem,
    setAvailability,
    uploadImage,
    removeImage,
    createCategory,
    updateCategory,
    deleteCategory,
    dismissError: () => setError(null),
  };
}
