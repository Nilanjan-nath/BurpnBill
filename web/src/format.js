// Amounts arrive from the API as strings ("30.00") because the server does all
// the money maths. The app only ever formats them; the one exception is the
// live total on the add-to-cart button, computed in whole paise so it can't
// drift by a fraction.

export function formatMoney(amount, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(Number(amount));
}

export function lineTotal(price, quantity) {
  return (Math.round(Number(price) * 100) * quantity) / 100;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
