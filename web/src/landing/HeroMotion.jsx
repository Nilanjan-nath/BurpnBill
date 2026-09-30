import { useEffect, useMemo, useRef, useState } from 'react';

// The hero's animated scene, from the owner's "BurpnBill motion" template: a
// guest scans a table's QR code and places an order on their phone, the order
// is approved and walks across a board — Placed, Preparing, Ready — and the
// table's bill is settled. The CSS (landing-tailwind.css, `.hm-*`) is the whole
// choreography and is driven by a single number, `data-s`, which this steps on
// a timer. Nothing else here animates.
//
// It is a drawing, not a recording: the café, table and prices are illustrative
// (the same figures the POS mockup further down uses, so the page doesn't
// contradict itself), and nothing on it is a claim about real customers.
//
// For a screen reader it is ONE image with a sentence, not a soup of table
// numbers — the same rule ProductMockups follows.

const STEPS = ['1 Scan', '2 Order', '3 Approve', '4 Ready', '5 Settle'];

// How long each scene holds, in ms. The last one is longest: it is the payoff,
// and it is where the total counts up.
const HOLD = [2400, 2200, 1700, 1700, 3200];
const TOTAL = 140; // 2× Masala Chai ₹60 + 1× Veg Sandwich ₹80

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// A fixed pseudo-random QR pattern (the three finder squares always drawn), so
// the picture is identical on every render and on every visit.
function qrCells() {
  let seed = 7;
  return Array.from({ length: 121 }, (_, i) => {
    seed = (seed * 9301 + 49297) % 233280;
    const r = Math.floor(i / 11);
    const c = i % 11;
    const corner = (r < 3 && c < 3) || (r < 3 && c > 7) || (r > 7 && c < 3);
    return corner || seed / 233280 > 0.48;
  });
}

export function HeroStage() {
  const reduced = useMemo(prefersReducedMotion, []);
  const [step, setStep] = useState(reduced ? 4 : 0);
  const [total, setTotal] = useState(reduced ? TOTAL : 0);
  const stage = useRef(null);
  const cells = useMemo(qrCells, []);

  // Step through the scenes, forever, unless the visitor has asked their
  // machine not to move things — then it holds on the finished scene.
  useEffect(() => {
    if (reduced) return undefined;
    let timer;
    const go = (n) => {
      setStep(n);
      timer = setTimeout(() => go((n + 1) % STEPS.length), HOLD[n]);
    };
    go(0);
    return () => clearTimeout(timer);
  }, [reduced]);

  // The total counts up when the bill lands, and resets when the loop restarts.
  // Time-based rather than frame-based: a hidden tab stops requestAnimationFrame
  // but not timers, and a total stuck at ₹0 on a settled bill would be worse than
  // no animation. The final value is also set by a timeout of its own.
  useEffect(() => {
    if (reduced) return undefined;
    if (step !== 4) {
      setTotal(0);
      return undefined;
    }
    const start = Date.now();
    const tick = setInterval(() => {
      const p = Math.min((Date.now() - start) / 900, 1);
      setTotal(Math.round(TOTAL * (1 - (1 - p) ** 3)));
      if (p >= 1) clearInterval(tick);
    }, 30);
    const done = setTimeout(() => setTotal(TOTAL), 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [step, reduced]);

  // A little parallax under the pointer. Written straight to the element rather
  // than through state, so moving the mouse never re-renders the scene.
  const tilt = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width - 0.5;
    const y = (e.clientY - box.top) / box.height - 0.5;
    if (stage.current) stage.current.style.transform = `rotateY(${x * 8}deg) rotateX(${-y * 6}deg)`;
  };
  const untilt = () => {
    if (stage.current) stage.current.style.transform = '';
  };

  return (
    <div
      id="stage"
      className="hm-wrap"
      onMouseMove={tilt}
      onMouseLeave={untilt}
      role="img"
      aria-label="An animation of an order's life: a guest scans the table's QR code and orders on their phone, the order is approved and moves through preparing to ready on the board, and the table's bill is settled."
    >
      <div ref={stage} className="hm-stage" data-s={step} aria-hidden="true">
        <div className="hm-card hm-phone">
          <div className="hm-ph-h">Chai Point · Table 7</div>
          <div className="hm-scr hm-s0">
            <div className="hm-qr">
              {cells.map((on, i) => (
                <i key={i} className={on ? '' : 'o'} />
              ))}
            </div>
            <div className="hm-cap">SCAN TO ORDER</div>
          </div>
          <div className="hm-scr hm-s1">
            <div className="hm-it">
              <span>2× Masala Chai</span>
              <b>₹60</b>
            </div>
            <div className="hm-it">
              <span>1× Veg Sandwich</span>
              <b>₹80</b>
            </div>
            <div className="hm-it">
              <span>Note: less sugar</span>
              <b />
            </div>
            <div className="hm-pb">
              <span className="a">Place order</span>
              <span className="b">Placed ✓</span>
            </div>
          </div>
        </div>

        <div className="hm-card hm-board">
          <div className="hm-cols">
            <div>APPROVE</div>
            <div>COOKING</div>
            <div>READY</div>
          </div>
          <div className="hm-tk">
            <b>T7 · QR</b>
            <small>2× Masala Chai</small>
            <small>1× Veg Sandwich</small>
            <span className="hm-pill hm-p1">Placed</span>
            <span className="hm-pill hm-p2">Preparing</span>
            <span className="hm-pill hm-p3">Ready</span>
          </div>
        </div>

        <div className="hm-card hm-bill">
          <div className="hm-stamp">Settled ✓</div>
          <div className="r">
            <span>2× Masala Chai</span>
            <span>₹60</span>
          </div>
          <div className="r">
            <span>1× Veg Sandwich</span>
            <span>₹80</span>
          </div>
          <div className="t">
            <span style={{ font: '700 13px var(--font-sans)', color: 'var(--color-ink-500)' }}>Total</span>
            <span>₹{total}</span>
          </div>
        </div>
      </div>

      <div className="hm-steps" aria-hidden="true">
        {STEPS.map((label, i) => (
          <span key={label} className={i === step ? 'on' : ''}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// The ticker along the bottom of the hero. Decorative: the same five states an
// order walks through, repeated so the marquee never shows a gap.
export function HeroStrip() {
  const run = 'TABLE 7 · PLACED → PREPARING → READY → SERVED → SETTLED ✦';
  return (
    <div
      className="hm-strip overflow-hidden whitespace-nowrap border-t border-butter-300/25 py-3.5 font-mono text-[13px] font-bold tracking-[0.08em] text-butter-300"
      aria-hidden="true"
    >
      <div>
        {Array.from({ length: 16 }, (_, i) => (
          <span key={i} className="mx-5">
            {run}
          </span>
        ))}
      </div>
    </div>
  );
}
