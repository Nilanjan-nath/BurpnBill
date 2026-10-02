import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';

// Staff management (step 6 slice 5) — owner only. No live push: the team
// changes about as often as the menu does, and whoever is changing it is
// looking at this exact screen. Same call as useMenuAdmin/useTablesAdmin.
export function useStaffAdmin(token) {
  const [members, setMembers] = useState(null); // null = still loading
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null); // what happened to an invite's email
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

  // What the server did about the invitee's email, in words the owner can act on.
  const describeEmail = (email, status) => {
    if (status === 'sent') return { tone: 'ok', text: `Invite sent to ${email}. They click the link and choose a password.` };
    if (status === 'has_account') {
      return { tone: 'ok', text: `${email} already has a BurpnBill login. Nothing was emailed. Tell them to sign in and they will join automatically.` };
    }
    return { tone: 'warn', text: `${email} is on the invite list, but the email could not be sent. Try Resend in a minute.` };
  };

  return {
    members,
    invites,
    error,
    notice,
    dismissNotice: () => setNotice(null),
    busyId,
    dismissError: () => setError(null),
    invite: (body) =>
      run('new-invite', async () => {
        const res = await staffApi.inviteStaff(token, body);
        setNotice(describeEmail(res.invite.email, res.email));
      }),
    resend: (invite) =>
      run(invite.id, async () => {
        const res = await staffApi.resendInvite(token, invite.id);
        setNotice(describeEmail(invite.email, res.email));
      }),
    revokeInvite: (inviteId) => run(inviteId, () => staffApi.revokeInvite(token, inviteId)),
    setRole: (userId, role) => run(userId, () => staffApi.updateStaffRole(token, userId, role)),
    remove: (userId) => run(userId, () => staffApi.removeStaff(token, userId)),
  };
}
