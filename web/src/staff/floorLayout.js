// Turn floor-plan cells into a grid POS can draw full-size cards on.
//
// The seating plan's grid is 12x8 so the owner has room to arrange a room.
// POS's cards carry a running total and how long a table has been sitting —
// they can't shrink to one-twelfth of a panel and still say that. So the used
// columns and rows are COMPACTED: a plan using columns 0, 3 and 7 becomes
// three columns side by side.
//
// What survives is what matters at a till: which tables are next to each
// other, and which row they're in. What's dropped is the empty space between
// them, which is a property of the room, not of the service.
//
// `maxColumns` is the honest limit. POS's floor panel is about a third of the
// screen, so past two or three columns the cards stop being readable — and an
// unreadable card at a till is worse than a less literal plan. Over the cap,
// the cards simply flow, which is still layout order (GET /floor sorts by
// position), so the room still reads left to right, front to back — it is just
// wrapped rather than drawn.
export function compactLayout(tables, { maxColumns = Infinity } = {}) {
  const placed = tables.filter((t) => t.pos_x !== null && t.pos_y !== null);
  const flow = (columns) => ({ columns, cellOf: () => null, placed: false });
  if (placed.length === 0) return flow(Math.min(2, maxColumns));

  const rank = (values) => {
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    return new Map(sorted.map((v, i) => [v, i + 1])); // CSS grid lines are 1-based
  };
  const cols = rank(placed.map((t) => t.pos_x));
  const rows = rank(placed.map((t) => t.pos_y));

  if (cols.size > maxColumns) return flow(maxColumns);

  return {
    columns: cols.size,
    placed: true,
    cellOf: (table) =>
      table.pos_x === null || table.pos_y === null
        ? null
        : { column: cols.get(table.pos_x), row: rows.get(table.pos_y) },
  };
}
