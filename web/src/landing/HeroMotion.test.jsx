import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { HeroStage, HeroStrip } from './HeroMotion.jsx';

// The hero's scene is a timer stepping one number, `data-s`, that the CSS turns
// into a choreography. What is worth pinning is the number: that it walks the
// five scenes in order, loops, settles on ₹140, and holds still (finished) for
// someone who has asked their machine not to move things.

const stage = () => document.querySelector('.hm-stage');
const HOLD = [2400, 2200, 1700, 1700, 3200];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the hero scene', () => {
  test('is one described image, with the drawing itself hidden from a screen reader', () => {
    render(<HeroStage />);
    expect(screen.getByRole('img', { name: /guest scans the table.s QR code/ })).toBeInTheDocument();
    expect(stage()).toHaveAttribute('aria-hidden', 'true');
  });

  test('walks scan, order, approve, ready, settle in order, then loops', () => {
    vi.useFakeTimers();
    render(<HeroStage />);
    const seen = [stage().dataset.s];
    for (const ms of HOLD) {
      act(() => vi.advanceTimersByTime(ms));
      seen.push(stage().dataset.s);
    }
    expect(seen).toEqual(['0', '1', '2', '3', '4', '0']);
    // The current step is the one that is lit.
    expect(document.querySelector('.hm-steps .on')).toHaveTextContent('1 Scan');
  });

  test('counts the bill up to exactly ₹140 when it is settled, and resets on the next loop', () => {
    vi.useFakeTimers();
    render(<HeroStage />);
    expect(document.querySelector('.hm-bill .t')).toHaveTextContent('₹0');
    act(() => vi.advanceTimersByTime(HOLD[0] + HOLD[1] + HOLD[2] + HOLD[3]));
    expect(stage().dataset.s).toBe('4');
    act(() => vi.advanceTimersByTime(1100));
    expect(document.querySelector('.hm-bill .t')).toHaveTextContent('₹140');
    act(() => vi.advanceTimersByTime(HOLD[4]));
    expect(stage().dataset.s).toBe('0');
    expect(document.querySelector('.hm-bill .t')).toHaveTextContent('₹0');
  });

  test('holds on the finished scene, and never loops, when reduced motion is asked for', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<HeroStage />);
    expect(stage().dataset.s).toBe('4');
    expect(document.querySelector('.hm-bill .t')).toHaveTextContent('₹140');
    act(() => vi.advanceTimersByTime(20000));
    expect(stage().dataset.s).toBe('4');
  });

  test('stops its timers when it is unmounted', () => {
    vi.useFakeTimers();
    const { unmount } = render(<HeroStage />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the hero ticker', () => {
  test('is decorative: hidden from a screen reader, and long enough to loop without a gap', () => {
    const { container } = render(<HeroStrip />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    // Two identical halves, so translating by -50% lands exactly on the start.
    expect(container.querySelectorAll('span').length % 2).toBe(0);
  });
});
