// Thin client for the Petuk API. Every failure — including "the phone has no
// signal" — surfaces as an ApiError, so screens handle one kind of error.
//   status 0  = the request never reached the server (safe to retry)
//   code      = the API's error code, e.g. 'items_unavailable'

const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`;

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isSessionProblem() {
    return this.status === 401 && this.code.startsWith('guest_session');
  }
}

async function request(method, path, { session, body } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(session && { 'X-Guest-Session': session }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', "Can't reach the server. Check your connection and try again.");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page); handled below.
  }

  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'unknown', err.message ?? 'Something went wrong. Please try again.', err);
  }
  return data;
}

export const api = {
  openMenu: (qrToken, session) => request('GET', `/menu/${encodeURIComponent(qrToken)}`, { session }),
  getCart: (session) => request('GET', '/cart', { session }),
  addItem: (session, item) => request('POST', '/cart/items', { session, body: item }),
  updateItem: (session, lineId, changes) => request('PATCH', `/cart/items/${lineId}`, { session, body: changes }),
  removeItem: (session, lineId) => request('DELETE', `/cart/items/${lineId}`, { session }),
  getBill: (session) => request('GET', '/bill', { session }),
  placeOrder: (session, cartId) => request('POST', '/orders', { session, body: { cart_id: cartId } }),
};
