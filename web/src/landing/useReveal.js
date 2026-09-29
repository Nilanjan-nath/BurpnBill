import { useEffect, useRef, useState } from 'react';

// Fades a section up as it comes into view, once. Motion here is meant to make
// the page feel alive under the thumb, not to perform: 400ms, 12px, and it
// never runs twice on the same element.
//
// Deliberately a scroll listener re-checking position, and NOT an
// IntersectionObserver. An observer only reports a CHANGE in intersection, so
// a section that is jumped past — a deep link to #pricing, a scrollbar drag, a
// Find-in-page — can be left at opacity 0 with real content inside it. That
// was not hypothetical: sweeping the page in steps left several sections blank
// on screen. This re-evaluates on every scroll, so it cannot get stuck; the
// cost is a rect read per section per frame, and there are nine of them.
//
// It also fails open. Anyone who has asked their machine to stop animating,
// and any environment without the APIs (jsdom, in the tests), gets the
// finished state immediately — a decoration must never be able to hide the
// page it decorates.
export function useReveal() {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    const stillMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!el || stillMotion || typeof window.addEventListener !== 'function') {
      setShown(true);
      return;
    }

    let done = false;

    const check = () => {
      if (done) return;
      // Slightly before the fold, so a section has finished arriving by the
      // time it is comfortably on screen rather than fading in under the eye.
      if (el.getBoundingClientRect().top < window.innerHeight * 1.15) {
        done = true;
        setShown(true);
      }
    };
    // Called straight from the listener rather than through
    // requestAnimationFrame: rAF is throttled hard in a hidden or background
    // tab, which is exactly when a page can be scrolled and then looked at.
    // Browsers already coalesce scroll events to one a frame, and this reads
    // one rect for one element, so there is nothing to save by deferring.
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check, { passive: true });
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  return [ref, shown];
}
