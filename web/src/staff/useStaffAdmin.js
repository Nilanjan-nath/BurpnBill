import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';

// Staff management (step 6 slice 5) — owner only. No live push: the team
// changes about as often as the menu does, and whoever is changing it is
// looking at this exact screen. Same call as useMenuAdmin/useTablesAdmin.
export function useStaffAdmin(token) {
  const [members, setMembers] = useState(null); // null = still loading
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null); // user_id or invite id mid-request

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await staffApi.listStaff(token);
      setMembers(data.members);
      setInvites(data.invites);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Returns the error message on failure so a form can show it inline rather
  // than closing over a banner the user may not be looking at.
  const run = async (id, fn) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await load();
      return null;
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
      return err.message;
    } finally {
      setBusyId(null);
    }
  };

  return {
    members,
    invites,
    error,
    busyId,
    dismissError: () => setError(null),
    invite: (body) => run('new-invite', () => staffApi.inviteStaff(token, body)),
    revokeInvite: (inviteId) => run(inviteId, () => staffApi.revokeInvite(token, inviteId)),
    setRole: (userId, role) => run(userId, () => staffApi.updateStaffRole(token, userId, role)),
    remove: (userId) => run(userId, () => staffApi.removeStaff(token, userId)),
  };
}
