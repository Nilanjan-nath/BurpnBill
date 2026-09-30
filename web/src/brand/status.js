// One place for what each order status looks like, so the board, the detail
// drawer, Recent, POS's Ongoing list and the landing mockups cannot drift into
// five slightly different ambers. The pairs are the brand system's own
// (docs/design.md, "Order-status semantics"); contrast is asserted in
// brand.test.js. Colour is never the only signal — every use sits next to the
// status's label (StatusPill draws a dot AND the word).
//
// Full class strings, not built from parts: Tailwind finds classes by scanning
// for whole names, so `bg-${name}` would silently generate nothing.
export const STATUS = {
  placed: {
    label: 'Placed',
    pill: 'bg-placed text-placed-ink',
    text: 'text-placed-ink',
    bar: 'bg-placed-ink',
    edge: 'border-l-placed-ink',
  },
  preparing: {
    label: 'Preparing',
    pill: 'bg-prep text-prep-ink',
    text: 'text-prep-ink',
    bar: 'bg-prep-ink',
    edge: 'border-l-prep-ink',
  },
  ready: {
    label: 'Ready',
    pill: 'bg-ready text-ready-ink',
    text: 'text-ready-ink',
    bar: 'bg-ready-ink',
    edge: 'border-l-ready-ink',
  },
  served: {
    label: 'Served',
    pill: 'bg-served text-served-ink',
    text: 'text-served-ink',
    bar: 'bg-served-ink',
    edge: 'border-l-served-ink',
  },
  // Muted ink with a strikethrough, never red: red is danger, and a cancelled
  // order is a fact, not an error.
  cancelled: {
    label: 'Cancelled',
    pill: 'bg-cancelled text-cancelled-ink line-through',
    text: 'text-cancelled-ink',
    bar: 'bg-cancelled-ink',
    edge: 'border-l-cancelled-ink',
  },
};
