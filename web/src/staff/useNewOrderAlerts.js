import { useCallback, useEffect, useRef, useState } from 'react';
import { primeAudio, chime } from './chime.js';

const BASE_TITLE = 'Petuk staff — Order board';
const FLASH_MS = 1000;

// New-order alerts: a sound (once armed by a click — see chime.js for why)
// and a flashing tab title with the count, so a busy kitchen notices an
// order even with the dashboard out of view or in a background tab. Both
// clear themselves the moment the tab is actually looked at again.
//
//   newOrderCount — how many order_created events have arrived since the
//                   tab was last looked at (owned by useBoard)
//   onAcknowledge — called to reset that count once the tab regains focus
export function useNewOrderAlerts(newOrderCount, onAcknowledge) {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const previousCount = useRef(0);

  const enableSound = useCallback(() => {
    if (primeAudio()) setSoundEnabled(true);
  }, []);

  // Only chime for orders that arrived AFTER sound was turned on — enabling
  // it must never play a burst of dings for orders already on the board.
  useEffect(() => {
    if (soundEnabled && newOrderCount > previousCount.current) chime();
    previousCount.current = newOrderCount;
  }, [newOrderCount, soundEnabled]);

  useEffect(() => {
    if (newOrderCount === 0) {
      document.title = BASE_TITLE;
      return undefined;
    }
    const label = `(${newOrderCount}) New order${newOrderCount === 1 ? '' : 's'}`;
    let showingLabel = true;
    document.title = label;
    const id = setInterval(() => {
      showingLabel = !showingLabel;
      document.title = showingLabel ? label : BASE_TITLE;
    }, FLASH_MS);
    return () => {
      clearInterval(id);
      document.title = BASE_TITLE;
    };
  }, [newOrderCount]);

  useEffect(() => {
    if (newOrderCount === 0) return undefined;
    const clearOnFocus = () => {
      if (document.visibilityState === 'visible') onAcknowledge();
    };
    document.addEventListener('visibilitychange', clearOnFocus);
    window.addEventListener('focus', clearOnFocus);
    return () => {
      document.removeEventListener('visibilitychange', clearOnFocus);
      window.removeEventListener('focus', clearOnFocus);
    };
  }, [newOrderCount, onAcknowledge]);

  return { soundEnabled, enableSound };
}
