// Thin client for the staff-facing part of the API. Mirrors ../api.js: every
// failure becomes a StaffApiError, so screens only ever handle one kind —
// the difference is a login token (Authorization: Bearer) instead of a
// guest session header.

const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`;

export class StaffApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, { token, body } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new StaffApiError(0, 'network', "Can't reach the server. Check your connection and try again.");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body; handled below.
  }

  if (!res.ok) {
    const err = data?.error ?? {};
    throw new StaffApiError(res.status, err.code ?? 'unknown', err.message ?? 'Something went wrong. Please try again.', err);
  }
  return data;
}

export const staffApi = {
  me: (token) => request('GET', '/me', { token }),
  listOrders: (token) => request('GET', '/orders', { token }),
  updateStatus: (token, orderId, status) => request('PATCH', `/orders/${orderId}/status`, { token, body: { status } }),
  orderDetail: (token, orderId) => request('GET', `/orders/${orderId}`, { token }),
  recentOrders: (token, hours) => request('GET', `/orders/recent${hours ? `?hours=${hours}` : ''}`, { token }),
  listItems: (token) => request('GET', '/items', { token }),
  createItem: (token, body) => request('POST', '/items', { token, body }),
  updateItem: (token, itemId, body) => request('PATCH', `/items/${itemId}`, { token, body }),
  deleteItem: (token, itemId) => request('DELETE', `/items/${itemId}`, { token }),
  setItemAvailability: (token, itemId, isAvailable) =>
    request('PATCH', `/items/${itemId}/availability`, { token, body: { is_available: isAvailable } }),
  listTables: (token) => request('GET', '/tables', { token }),
  createTable: (token, body) => request('POST', '/tables', { token, body }),
  getFloor: (token) => request('GET', '/floor', { token }),
  placeStaffOrder: (token, body) => request('POST', '/staff/orders', { token, body }),
  listStaff: (token) => request('GET', '/staff', { token }),
  inviteStaff: (token, body) => request('POST', '/staff/invites', { token, body }),
  revokeInvite: (token, inviteId) => request('DELETE', `/staff/invites/${inviteId}`, { token }),
  updateStaffRole: (token, userId, role) => request('PATCH', `/staff/${userId}`, { token, body: { role } }),
  removeStaff: (token, userId) => request('DELETE', `/staff/${userId}`, { token }),
  getPendingOrders: (token) => request('GET', '/orders/pending', { token }),
  approveOrder: (token, orderId) => request('POST', `/orders/${orderId}/approve`, { token }),
  rejectOrder: (token, orderId) => request('POST', `/orders/${orderId}/reject`, { token }),
  getTableBill: (token, tableId) => request('GET', `/tables/${tableId}/bill`, { token }),
  // idempotencyKey is the client's: a double-tapped Confirm must settle once.
  checkoutTable: (token, tableId, { method, idempotencyKey }) =>
    request('POST', `/tables/${tableId}/checkout`, {
      token,
      body: { method, idempotency_key: idempotencyKey },
    }),
};
