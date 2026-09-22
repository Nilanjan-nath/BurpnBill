// A kitchen tablet's clock can be wrong by minutes — GET /orders sends back
// its own server_time alongside every response specifically so age displays
// don't trust the device's clock. skewMs = (device time) - (server time) at
// the moment a response arrived; subtracting it from Date.now() gives a
// running estimate of the server's current time without asking again.
export const skewFromServerTime = (serverTimeIso) => Date.now() - Date.parse(serverTimeIso);

const WARN_AFTER_MIN = 5;
const DANGER_AFTER_MIN = 10;

export function ageMinutes(sinceIso, skewMs) {
  const serverNow = Date.now() - skewMs;
  return Math.max(0, Math.floor((serverNow - Date.parse(sinceIso)) / 60_000));
}

export const ageLabel = (minutes) => (minutes < 1 ? 'just now' : `${minutes}m`);

// null = normal, 'warn' = amber, 'danger' = red. Deliberately simple
// thresholds, easy to retune once a real kitchen has an opinion.
export function stuckLevel(minutes) {
  if (minutes >= DANGER_AFTER_MIN) return 'danger';
  if (minutes >= WARN_AFTER_MIN) return 'warn';
  return null;
}
