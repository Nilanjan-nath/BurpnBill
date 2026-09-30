import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ApiError } from './api.js';
import { useOrderStatus, FAST_MS, SLOW_MS, SLOW_AFTER_MS } from './useOrderStatus.js';

// The polling rules, on fake timers with a fake fetcher — the rules are what
// keep this cheap on a small free-tier database, so they are pinned here rather
// than trusted to a real-time test that would take fifteen seconds a step.

const snapshot = (...stages) => ({
  service_mode: 'table',
  orders: stages.map((stage, i) => ({ id: `o${i}`, order_number: 1000 + i, stage })),
});

let hidden;
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});
afterEach(() => {
  vi.useRealTimers();
  delete document.hidden;
});

const run = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const setVisible = (visible) => {
  hidden = !visible;
  return act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
};

describe('useOrderStatus', () => {
  test('asks at once, then every 15 seconds while something is unfinished', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(snapshot('preparing'));
    const { result } = renderHook(() => useOrderStatus(fetchStatus));

    await run(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(result.current.status.orders[0].stage).toBe('preparing');

    await run(FAST_MS - 1);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await run(1);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    await run(FAST_MS);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  test('slows to every 30 seconds once it has been going for five minutes', async () => {
    const at = [];
    const fetchStatus = vi.fn(async () => { at.push(Date.now()); return snapshot('preparing'); });
    renderHook(() => useOrderStatus(fetchStatus));

    await run(SLOW_AFTER_MS + 2 * SLOW_MS);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    expect(gaps[0]).toBe(FAST_MS); // it began fast…
    expect(gaps.at(-1)).toBe(SLOW_MS); // …and ended slow
    expect(new Set(gaps)).toEqual(new Set([FAST_MS, SLOW_MS]));
  });

  test('stops for good once every order is served or cancelled', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(snapshot('served', 'cancelled'));
    renderHook(() => useOrderStatus(fetchStatus));

    await run(10 * 60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  test('keeps going while any one order is still unfinished', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(snapshot('served', 'ready'));
    renderHook(() => useOrderStatus(fetchStatus));

    await run(FAST_MS * 3);
    expect(fetchStatus.mock.calls.length).toBeGreaterThan(2);
  });

  test('does not poll at all when there is nothing to track', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(snapshot());
    renderHook(() => useOrderStatus(fetchStatus));

    await run(5 * 60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  test('pauses while the tab is hidden and checks the moment it comes back', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(snapshot('preparing'));
    renderHook(() => useOrderStatus(fetchStatus));
    await run(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    hidden = true;
    await run(5 * 60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1); // a phone in a pocket asks nothing

    await setVisible(true);
    expect(fetchStatus).toHaveBeenCalledTimes(2); // and doesn't wait out the timer on return
  });

  test('Refresh asks again, and restarts polling that had stopped', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(snapshot('served'));
    const { result } = renderHook(() => useOrderStatus(fetchStatus));
    await run(60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1); // stopped

    fetchStatus.mockResolvedValue(snapshot('preparing'));
    act(() => result.current.refresh());
    await run(0);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status.orders[0].stage).toBe('preparing');

    await run(FAST_MS);
    expect(fetchStatus).toHaveBeenCalledTimes(3); // polling is back
  });

  test('a dropped connection keeps the last answer on screen and tries again', async () => {
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce(snapshot('accepted'))
      .mockRejectedValueOnce(new ApiError(0, 'network', 'offline'))
      .mockResolvedValue(snapshot('preparing'));
    const { result } = renderHook(() => useOrderStatus(fetchStatus));

    await run(0);
    expect(result.current.failed).toBe(false);

    await run(FAST_MS);
    expect(result.current.failed).toBe(true);
    expect(result.current.status.orders[0].stage).toBe('accepted'); // not blanked

    await run(FAST_MS);
    expect(result.current.failed).toBe(false);
    expect(result.current.status.orders[0].stage).toBe('preparing');
  });

  test('an expired session ends it — asking again cannot fix that', async () => {
    const fetchStatus = vi.fn().mockRejectedValue(new ApiError(401, 'guest_session_expired', 'expired'));
    renderHook(() => useOrderStatus(fetchStatus));

    await run(5 * 60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  test('unmounting stops it', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(snapshot('preparing'));
    const { unmount } = renderHook(() => useOrderStatus(fetchStatus));
    await run(0);
    unmount();

    await run(5 * 60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });
});
