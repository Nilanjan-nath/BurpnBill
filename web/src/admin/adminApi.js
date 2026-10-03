import { request } from '../staff/staffApi.js';

// Thin client for /api/admin (the platform owner's area). Same error type and
// same token header as the café dashboard's client; only the paths differ.
const q = (month) => (month ? `?month=${encodeURIComponent(month)}` : '');

export const adminApi = {
  me: (token) => request('GET', '/admin/me', { token }),
  overview: (token) => request('GET', '/admin/overview', { token }),
  report: (token, month) => request('GET', `/admin/report${q(month)}`, { token }),
  restaurants: (token) => request('GET', '/admin/restaurants', { token }),
  restaurant: (token, id, month) => request('GET', `/admin/restaurants/${id}${q(month)}`, { token }),
  recordPayment: (token, id, body) => request('POST', `/admin/restaurants/${id}/payments`, { token, body }),
  extendTrial: (token, id, days) => request('POST', `/admin/restaurants/${id}/extend-trial`, { token, body: { days } }),
  invoice: (token, paymentId) => request('GET', `/admin/payments/${paymentId}/invoice`, { token }),
};
