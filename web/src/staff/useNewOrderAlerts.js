import { useCallback, useEffect, useRef, useState } from 'react';
import { primeAudio, chime } from './chime.js';

const BASE_TITLE = 'BurpnBill staff — Order board';
const FLASH_MS = 1000;
const PREF_KEY = 'burpnbill.sound';

// Whether sound was left on last time. A browser still insists on a real tap
// before any page may make noise, so this only lets the app arm itself on the
// first tap anywhere after a reload — nobody has to find the button again.
const readPref = () => {
  try {
    return localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
};
const writePref = (on) => {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // private window / blocked storage: sound still works for this visit
  }
};

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

  // Arming from the button also plays the chime once: the only way to know the
  // speakers are on and loud enough is to hear it.
  const enableSound = useCallback(() => {
    if (!primeAudio()) return;
    setSoundEnabled(true);
    writePref(true);
    chime();
  }, []);

  const disableSound = useCallback(() => {
    setSoundEnabled(false);
    writePref(false);
  }, []);

  // Sound was on last visit: arm quietly on the first tap or key press.
  useEffect(() => {
    if (!readPref()) return undefined;
    const arm = () => {
      if (primeAudio()) setSoundEnabled(true);
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    return cleanup;
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

  return { soundEnabled, enableSound, disableSound };
}
