import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';

// Seating Plan's data: the table list, plus create, update and retire.
//
// Retiring is a SOFT delete server-side, because orders.table_id cascades —
// see deleteTable in services/tables.js. Pausing (is_active) stays the answer
// to "this table is out of service tonight"; retiring is "this table is gone".
export function useTablesAdmin(token) {
  const [tables, setTables] = useState(null); // null = still loading
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      // /floor, not /tables: it returns everything /tables does plus live
      // occupancy, which the plan colours tables by. One request, not two.
      const data = await staffApi.getFloor(token);
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

  const updateTable = useCallback(
    async (tableId, body) => {
      setBusyId(tableId);
      setError(null);
      try {
        await staffApi.updateTable(token, tableId, body);
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
    [token, load],
  );

  const deleteTable = useCallback(
    async (tableId) => {
      setBusyId(tableId);
      setError(null);
      try {
        await staffApi.deleteTable(token, tableId);
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
    [token, load],
  );

  return { tables, error, creating, busyId, createTable, updateTable, deleteTable, dismissError: () => setError(null) };
}
