import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';

// The Tables tab's data: the table list plus create. No rename/deactivate
// yet (already on the "after v1" list in TASKS.md) and no delete — a table
// once printed and stuck to a physical table isn't meant to disappear.
export function useTablesAdmin(token) {
  const [tables, setTables] = useState(null); // null = still loading
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await staffApi.listTables(token);
      setTables(data.tables);
      setError(null);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const createTable = useCallback(
    async (body) => {
      setCreating(true);
      setError(null);
      try {
        await staffApi.createTable(token, body);
        await load();
        return true;
      } catch (err) {
        if (!(err instanceof StaffApiError)) throw err;
        setError(err.message);
        return false;
      } finally {
        setCreating(false);
      }
    },
    [token, load],
  );

  return { tables, error, creating, createTable, dismissError: () => setError(null) };
}
