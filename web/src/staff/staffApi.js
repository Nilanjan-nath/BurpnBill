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

export async function request(method, path, { token, body } = {}) {
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
    // The API's blanket "Invalid request" hides the useful part: WHICH field and
    // why (e.g. "GSTIN should be 15 characters"). Say that instead.
    const reasons = Array.isArray(err.issues) ? err.issues.map((i) => i.message).filter(Boolean) : [];
    const message = reasons.length ? reasons.join('. ') : err.message;
    throw new StaffApiError(res.status, err.code ?? 'unknown', message ?? 'Something went wrong. Please try again.', err);
  }
  return data;
}

// The photo upload is the one call that doesn't send JSON — it PUTs the file's
// own bytes with its own content type, which is what the server reads. Sharing
// request() would mean teaching it about bodies it otherwise never sees.
async function upload(path, { token, file }) {
  // The bytes, not the File object: the server reads the body raw and takes the
  // format from Content-Type, so the filename and the wrapper carry nothing —
  // and a File doesn't survive every fetch implementation this runs under.
  const bytes = await file.arrayBuffer();

  let res;
  try {
    res = await fetch(BASE + path, {
      method: 'PUT',
      headers: { 'Content-Type': file.type, ...(token && { Authorization: `Bearer ${token}` }) },
      body: bytes,
    });
  } catch {
    throw new StaffApiError(0, 'network', "Can't reach the server. Check your connection and try again.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new StaffApiError(res.status, err.code ?? 'unknown', err.message ?? 'That photo could not be uploaded.', err);
  }
  return data;
}

export const staffApi = {
  me: (token) => request('GET', '/me', { token }),
  listOrders: (token) => request('GET', '/orders', { token }),
  updateStatus: (token, orderId, status) => request('PATCH', `/orders/${orderId}/status`, { token, body: { status } }),
  orderDetail: (token, orderId) => request('GET', `/orders/${orderId}`, { token }),
  // Either a whole café day ({ day: 'today' | 'yesterday' }, with the
  // browser's own zone so the boundary is the café's) or a rolling window
  // ({ hours }). The API refuses both at once, so this sends whichever it was
  // given rather than filling in the other.
  recentOrders: (token, { day, hours } = {}) => {
    const query = day
      ? `?day=${day}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`
      : hours
        ? `?hours=${hours}`
        : '';
    return request('GET', `/orders/recent${query}`, { token });
  },
  listItems: (token) => request('GET', '/items', { token }),
  createItem: (token, body) => request('POST', '/items', { token, body }),
  updateItem: (token, itemId, body) => request('PATCH', `/items/${itemId}`, { token, body }),
  deleteItem: (token, itemId) => request('DELETE', `/items/${itemId}`, { token }),
  setItemAvailability: (token, itemId, isAvailable) =>
    request('PATCH', `/items/${itemId}/availability`, { token, body: { is_available: isAvailable } }),
  uploadItemImage: (token, itemId, file) => upload(`/items/${itemId}/image`, { token, file }),
  removeItemImage: (token, itemId) => request('DELETE', `/items/${itemId}/image`, { token }),
  listCategories: (token) => request('GET', '/categories', { token }),
  createCategory: (token, body) => request('POST', '/categories', { token, body }),
  updateCategory: (token, categoryId, body) => request('PATCH', `/categories/${categoryId}`, { token, body }),
  deleteCategory: (token, categoryId) => request('DELETE', `/categories/${categoryId}`, { token }),
  listTables: (token) => request('GET', '/tables', { token }),
  createTable: (token, body) => request('POST', '/tables', { token, body }),
  updateTable: (token, tableId, body) => request('PATCH', `/tables/${tableId}`, { token, body }),
  deleteTable: (token, tableId) => request('DELETE', `/tables/${tableId}`, { token }),
  // Signing up a café. The one call here made by someone who is signed in but
  // not yet staff anywhere — it is what makes them staff.
  createRestaurant: (token, body) => request('POST', '/restaurants', { token, body }),
  getRestaurant: (token) => request('GET', '/restaurant', { token }),
  updateRestaurant: (token, body) => request('PATCH', '/restaurant', { token, body }),
  updateOwnProfile: (token, body) => request('PATCH', '/me', { token, body }),
  getFloor: (token) => request('GET', '/floor', { token }),
  placeStaffOrder: (token, body) => request('POST', '/staff/orders', { token, body }),
  getDashboardSummary: (token, tz) =>
    request('GET', `/dashboard/summary${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`, { token }),
  listStaff: (token) => request('GET', '/staff', { token }),
  inviteStaff: (token, body) => request('POST', '/staff/invites', { token, body }),
  resendInvite: (token, inviteId) => request('POST', `/staff/invites/${inviteId}/resend`, { token }),
  revokeInvite: (token, inviteId) => request('DELETE', `/staff/invites/${inviteId}`, { token }),
  updateStaffRole: (token, userId, role) => request('PATCH', `/staff/${userId}`, { token, body: { role } }),
  removeStaff: (token, userId) => request('DELETE', `/staff/${userId}`, { token }),
  getPendingOrders: (token) => request('GET', '/orders/pending', { token }),
  approveOrder: (token, orderId) => request('POST', `/orders/${orderId}/approve`, { token }),
  rejectOrder: (token, orderId) => request('POST', `/orders/${orderId}/reject`, { token }),
  getTableBill: (token, tableId) => request('GET', `/tables/${tableId}/bill`, { token }),
  // idempotencyKey is the client's: a double-tapped Confirm must settle once.
  checkoutTable: (token, tableId, { method, idempotencyKey, amountTendered }) =>
    request('POST', `/tables/${tableId}/checkout`, {
      token,
      body: { method, idempotency_key: idempotencyKey, amount_tendered: amountTendered },
    }),
  getBill: (token, billId) => request('GET', `/bills/${billId}`, { token }),
};
