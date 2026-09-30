import { useEffect, useRef, useState } from 'react';

// The room, as the owner arranges it. Positions are grid CELLS (see the
// table_layout migration), so the same plan reads identically on a laptop, a
// till screen and a printed sheet.
export const GRID_COLS = 12;
export const GRID_ROWS = 8;

// Status colour is the only thing communicating state here, per docs/design.md.
// Three states, because three are all this app can honestly know: free and
// occupied come from real orders (GET /floor), paused is a real column. There
// is no "dirty", "waiting" or "reserved" — nothing records them.
const STATUS = {
  free: { ring: 'border-ready-ink/40 bg-ready', text: 'text-ready-ink', label: 'Available' },
  // A crimson tint, the same as POS's floor: a busy table is not the brand's danger red.
  occupied: { ring: 'border-brand-300 bg-brand-50', text: 'text-brand-700', label: 'Occupied' },
  paused: { ring: 'border-ink-400 bg-ink-100', text: 'text-ink-700', label: 'Paused' },
};

export const statusOf = (table) => (!table.is_active ? 'paused' : table.status === 'occupied' ? 'occupied' : 'free');

const clamp = (v, max) => Math.max(0, Math.min(max, v));

export function FloorPlanCanvas({ tables, busyId, selectedId, onSelect, onMove }) {
  const gridRef = useRef(null);
  // While a table is being dragged: where the pointer started, where it is
  // now, and which cell it is currently over. Held together because the card
  // has to follow the cursor and the target cell has to light up in step.
  const [drag, setDrag] = useState(null);

  const occupied = new Map(tables.filter((t) => t.pos_x !== null).map((t) => [`${t.pos_x},${t.pos_y}`, t.id]));
  const blockedFor = (id, x, y) => {
    const taken = occupied.get(`${x},${y}`);
    return Boolean(taken && taken !== id);
  };

  // One shared move, whether it came from a pointer or the keyboard — so the
  // two can never drift apart, and neither can drop a table onto another.
  const moveTo = (table, x, y) => {
    const cx = clamp(x, GRID_COLS - 1);
    const cy = clamp(y, GRID_ROWS - 1);
    if (cx === table.pos_x && cy === table.pos_y) return;
    if (blockedFor(table.id, cx, cy)) return;
    onMove(table.id, cx, cy);
  };

  // Escape abandons a drag wherever the cursor happens to be. On window,
  // because a mouse drag may have taken focus off the card it started on.
  useEffect(() => {
    if (!drag) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrag(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag]);

  const cellAt = (rect, clientX, clientY) => ({
    x: clamp(Math.floor(((clientX - rect.left) / rect.width) * GRID_COLS), GRID_COLS - 1),
    y: clamp(Math.floor(((clientY - rect.top) / rect.height) * GRID_ROWS), GRID_ROWS - 1),
  });

  // Where the CARD's centre is now, not where the cursor is. Grab a card by
  // its corner and the two are half a cell apart — and the square that lights
  // up has to be the one the card is sitting over, because that is what the
  // eye is reading. Computed from the table's own cell rather than measured
  // off the DOM, so it needs no layout of its own.
  const cellUnderCard = (rect, table, dx, dy) =>
    cellAt(rect, rect.left + ((table.pos_x ?? 0) + 0.5) * (rect.width / GRID_COLS) + dx, rect.top + ((table.pos_y ?? 0) + 0.5) * (rect.height / GRID_ROWS) + dy);

  const onPointerDown = (e, table) => {
    // Primary button / single touch only; anything else is a context menu or
    // a two-finger scroll and shouldn't drag the furniture.
    if (e.button !== 0) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return; // nothing to measure against
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id: table.id, rect, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, ...cellUnderCard(rect, table, 0, 0) });
  };

  const onPointerMove = (e, table) => {
    if (drag?.id !== table.id) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setDrag({ ...drag, dx, dy, ...cellUnderCard(drag.rect, table, dx, dy) });
  };

  // Lands on the cell the outline was drawn on, not on a freshly measured one.
  // Recomputing here gave the same answer in practice and could differ in
  // principle — and a table landing somewhere the preview never showed is the
  // one thing this whole interaction exists to rule out.
  const onPointerUp = (e, table) => {
    if (drag?.id !== table.id) return;
    const { x, y } = drag;
    setDrag(null);
    moveTo(table, x, y);
  };

  const onKeyDown = (e, table) => {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!delta) return;
    e.preventDefault();
    moveTo(table, (table.pos_x ?? 0) + delta[0], (table.pos_y ?? 0) + delta[1]);
  };

  const dropBlocked = drag ? blockedFor(drag.id, drag.x, drag.y) : false;

  return (
    // A plan has a minimum legible size: squeezed into a narrow column, twelve
    // cells are ~20px each and the table names disappear, which is worse than
    // scrolling. So the grid keeps a floor of ~64px per cell and the room
    // scrolls sideways instead of shrinking out of usefulness.
    <div className="overflow-x-auto">
      <div
        ref={gridRef}
        data-testid="floor-plan"
        className="relative w-full min-w-[48rem] select-none rounded-card border border-ink-200 bg-ink-50 p-0"
        style={{
          aspectRatio: `${GRID_COLS} / ${GRID_ROWS}`,
          // The dotted grid is the affordance: it says "things go on squares"
          // without a legend explaining it.
          backgroundImage: 'radial-gradient(circle, rgb(201 190 195) 1px, transparent 1px)',
          backgroundSize: `${100 / GRID_COLS}% ${100 / GRID_ROWS}%`,
          backgroundPosition: `${50 / GRID_COLS}% ${50 / GRID_ROWS}%`,
        }}
      >
        {/* Where it would land, shown while the card is still in the air.
            Without this a refused drop looks like a bug: you let go and
            nothing happens, with no hint that the square was taken. */}
        {drag && (
          <div
            data-testid="drop-target"
            data-blocked={dropBlocked ? 'true' : 'false'}
            aria-hidden="true"
            className={`pointer-events-none absolute rounded-card border-2 border-dashed transition-colors ${
              dropBlocked ? 'border-danger-500 bg-danger-100/70' : 'border-brand bg-brand-100/60'
            }`}
            style={{
              left: pct(drag.x / GRID_COLS),
              top: pct(drag.y / GRID_ROWS),
              width: pct(1 / GRID_COLS),
              height: pct(1 / GRID_ROWS),
            }}
          />
        )}

        {tables.map((table) => {
          const s = STATUS[statusOf(table)];
          const x = table.pos_x ?? 0;
          const y = table.pos_y ?? 0;
          const lifted = drag?.id === table.id;
          return (
            <button
              key={table.id}
              type="button"
              // A real button, so it is reachable and movable by keyboard —
              // arrow keys nudge it a cell at a time. A plan you can only
              // arrange with a mouse is a plan half the people here can't use.
              aria-label={`${table.label}, ${s.label}${table.seats != null ? `, ${table.seats} seats` : ''}. Arrow keys move it.`}
              aria-pressed={selectedId === table.id}
              onPointerDown={(e) => onPointerDown(e, table)}
              onPointerMove={(e) => onPointerMove(e, table)}
              onPointerUp={(e) => onPointerUp(e, table)}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => onKeyDown(e, table)}
              onClick={() => onSelect?.(table.id)}
              disabled={busyId === table.id}
              className={`absolute flex touch-none flex-col items-center justify-center rounded-card border-2 p-1 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60 ${s.ring} ${
                lifted
                  ? // The lift's scale lives in the inline transform below, NOT in a
                    // `scale-110` class: Tailwind v4 compiles that to the standalone
                    // `scale` property, which composes AFTER `transform` and so
                    // multiplies the drag translation by 1.1 — the card drifts away
                    // from the square it says it is going to land on.
                    'z-20 cursor-grabbing '
                  : 'cursor-grab  transition-[transform,box-shadow] hover:-translate-y-0.5 '
              } ${selectedId === table.id ? 'ring-2 ring-brand ring-offset-2' : ''}`}
              style={{
                left: pct(x / GRID_COLS),
                top: pct(y / GRID_ROWS),
                width: pct(1 / GRID_COLS),
                height: pct(1 / GRID_ROWS),
                // The card follows the cursor rather than jumping on release.
                // As a transform, so `left`/`top` stay the table's actual cell
                // and nothing downstream has to know a drag is in progress.
                ...(lifted && { transform: `translate(${drag.dx}px, ${drag.dy}px) scale(1.1)` }),
              }}
            >
              <span className={`truncate text-xs font-bold ${s.text}`}>{table.label}</span>
              {table.seats != null && (
                <span className={`text-[10px] font-semibold ${s.text} opacity-80`}>{table.seats} seats</span>
              )}
            </button>
          );
        })}

        {drag && (
          <p
            // Pinned to the BOTTOM of the plan: a room fills from the top, so a
            // banner across the top row sits on top of the tables you are
            // trying to look at.
            className="pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2 rounded-full bg-ink-900/85 px-3 py-1 text-xs font-bold text-white"
            role="status"
          >
            {dropBlocked ? 'That square is taken' : `Drop in row ${drag.y + 1}, column ${drag.x + 1}`} · Esc to cancel
          </p>
        )}

        {tables.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-ink-600">
            Add a table and it appears here.
          </p>
        )}
      </div>
    </div>
  );
}

// Four decimals is finer than any screen can render, and keeps 1/12 out of
// the DOM as 8.333333333333332%.
const pct = (fraction) => `${(fraction * 100).toFixed(4)}%`;

export function FloorPlanLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm font-semibold text-ink-700">
      {['free', 'occupied', 'paused'].map((key) => (
        <span key={key} className="flex items-center gap-1.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              key === 'free' ? 'bg-ready-ink' : key === 'occupied' ? 'bg-brand-400' : 'bg-ink-400'
            }`}
            aria-hidden="true"
          />
          {STATUS[key].label}
        </span>
      ))}
    </div>
  );
}
