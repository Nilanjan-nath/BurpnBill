import { useEffect, useState } from 'react';

// Forces the calling component to re-render every `intervalMs`, so a live
// "7m" age label or a stuck-order highlight keeps advancing even though
// nothing about the order itself has changed. Each card manages its own
// tick, so one order ageing past a threshold doesn't re-render the rest of
// the board.
export function useNowTick(intervalMs = 15_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
