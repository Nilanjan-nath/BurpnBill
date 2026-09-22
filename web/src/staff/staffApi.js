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
};
