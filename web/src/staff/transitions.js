// Mirrors ORDER_TRANSITIONS in server/src/services/staffOrders.js — keep the
// two in sync if either changes. This copy decides only what buttons to
// SHOW; the server is still the one true source of what's actually allowed,
// and rejects anything else with 409 regardless of what the UI offered.
const NEXT_STATUS = { placed: 'preparing', preparing: 'ready', ready: 'served' };
const NEXT_LABEL = { placed: 'Start preparing', preparing: 'Mark ready', ready: 'Mark served' };
const CAN_CANCEL = new Set(['placed', 'preparing']);

export const nextStatus = (status) => NEXT_STATUS[status] ?? null;
export const nextStatusLabel = (status) => NEXT_LABEL[status] ?? null;
export const canCancel = (status) => CAN_CANCEL.has(status);
