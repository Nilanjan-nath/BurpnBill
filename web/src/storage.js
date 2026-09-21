// localStorage keeps the guest session so a page refresh keeps the same cart
// and the same bill. Storage can be blocked or full (private windows, strict
// settings), so every access is guarded and the app works without it — you
// just lose the "survives a refresh" convenience.

const sessionKey = (qrToken) => `petuk.session.${qrToken}`;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore: the app just won't remember across refreshes.
  }
}

export const storage = {
  getSession: (qrToken) => read(sessionKey(qrToken))?.id ?? null,
  saveSession: (qrToken, id) => write(sessionKey(qrToken), { id }),
  clearSession: (qrToken) => write(sessionKey(qrToken), null),
};
