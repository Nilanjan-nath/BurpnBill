import { useState } from 'react';
import { Minus, Pause, Pencil, Play, Plus, Printer, QrCode, Table2, Trash2 } from 'lucide-react';
import { useTablesAdmin } from './useTablesAdmin.js';
import { TableForm } from './TableForm.jsx';
import { TableQrDialog } from './TableQrDialog.jsx';
import { FloorPlanCanvas, FloorPlanLegend } from './FloorPlanCanvas.jsx';
import { tableUrl, useQrDataUrls } from './qr.js';

// Settings → Seating Plan: arrange the room, then manage the tables in it.
//
// The plan on top is the room; the list underneath is the paperwork. Both read
// the same records, and the arrangement is not decorative — POS's floor map
// draws itself from these same positions, so the till shows the room the way
// it actually is.
const IS_LOCAL_ORIGIN = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

const FIELD =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 ' +
  'placeholder:font-normal placeholder:text-gray-500 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600';

export function SeatingPlan({ token }) {
  const admin = useTablesAdmin(token);
  const [label, setLabel] = useState('');
  const [seats, setSeats] = useState(4);
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [qrFor, setQrFor] = useState(null);
  const [confirmRetire, setConfirmRetire] = useState(null);
  const qrDataUrls = useQrDataUrls(admin.tables);

  if (admin.tables === null && !admin.error) {
    return <p className="p-10 text-center text-sm font-semibold text-gray-700">Loading the floor…</p>;
  }

  const tables = admin.tables ?? [];
  const paused = tables.filter((t) => !t.is_active).length;

  const add = async (e) => {
    e.preventDefault();
    if (await admin.createTable({ label: label.trim(), seats: Number(seats) })) setLabel('');
  };

  return (
    <div className="space-y-4">
      {admin.error && (
        <div
          className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800"
          role="alert"
        >
          <span>{admin.error}</span>
          <button type="button" onClick={admin.dismissError} aria-label="Dismiss" className="text-lg leading-none">
            ×
          </button>
        </div>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4 print:hidden">
        <div className="min-w-[12rem] flex-1">
          <label className="mb-1.5 block text-sm font-bold text-gray-900" htmlFor="new-table-label">
            Table name
          </label>
          <input
            id="new-table-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            required
            placeholder="e.g. T7, or Window booth"
            className={FIELD}
          />
        </div>
        <div className="w-28">
          <label className="mb-1.5 block text-sm font-bold text-gray-900" htmlFor="new-table-seats">
            Capacity
          </label>
          <input
            id="new-table-seats"
            type="number"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            min="1"
            max="99"
            className={FIELD}
          />
        </div>
        <button
          type="submit"
          disabled={admin.creating || label.trim() === ''}
          className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> {admin.creating ? 'Adding…' : 'Add table'}
        </button>
      </form>

      <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Floor plan</h3>
            <p className="text-sm font-semibold text-gray-600">
              Drag a table to move it, or focus one and use the arrow keys. {tables.length}{' '}
              {tables.length === 1 ? 'table' : 'tables'}
              {paused > 0 && ` · ${paused} paused`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            <Printer className="h-4 w-4" aria-hidden="true" /> Print QR sheet
          </button>
        </div>

        <FloorPlanCanvas
          tables={tables}
          busyId={admin.busyId}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMove={(id, pos_x, pos_y) => admin.updateTable(id, { pos_x, pos_y })}
        />

        <FloorPlanLegend />
      </div>

      {/* The QR codes encode whatever origin this page is open on (see qr.js),
          so a sheet printed from localhost is a page of dead links. Worth
          saying before someone prints twenty of them. */}
      {tables.length > 0 && IS_LOCAL_ORIGIN && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 print:hidden">
          These codes point at <code className="font-bold">{window.location.origin}</code>, which a phone can't open. Open this
          page on the café's network address before printing them.
        </p>
      )}

      {tables.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center print:hidden">
          <Table2 className="mx-auto mb-2 h-8 w-8 text-gray-400" aria-hidden="true" />
          <p className="text-sm font-bold text-gray-900">No tables yet</p>
          <p className="text-sm font-semibold text-gray-600">
            Each table gets its own QR code. That code is how an order knows which table it came from.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white print:hidden">
          <table className="w-full">
            <caption className="sr-only">Tables, their capacity and their QR codes</caption>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th scope="col" className="px-4 py-3 text-sm font-bold text-gray-900">
                  Table
                </th>
                <th scope="col" className="px-4 py-3 text-sm font-bold text-gray-900">
                  Capacity
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-bold text-gray-900">
                  Ordering
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-bold text-gray-900">
                  QR
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-bold text-gray-900">
                  Remove
                </th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <TableRow
                  key={t.id}
                  table={t}
                  selected={selectedId === t.id}
                  onSelect={() => setSelectedId(selectedId === t.id ? null : t.id)}
                  busy={admin.busyId === t.id}
                  confirming={confirmRetire === t.id}
                  onRename={() => setEditing(t)}
                  onSeats={(next) => admin.updateTable(t.id, { seats: next })}
                  onTogglePause={() => admin.updateTable(t.id, { is_active: !t.is_active })}
                  onShowQr={() => setQrFor(t)}
                  onAskRetire={() => setConfirmRetire(t.id)}
                  onCancelRetire={() => setConfirmRetire(null)}
                  onRetire={async () => {
                    await admin.deleteTable(t.id);
                    setConfirmRetire(null);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TableForm
          table={editing}
          busy={admin.busyId === editing.id}
          error={admin.error}
          onSave={(body) => admin.updateTable(editing.id, body)}
          onClose={() => setEditing(null)}
        />
      )}

      {qrFor && <TableQrDialog table={qrFor} dataUrl={qrDataUrls[qrFor.id]} onClose={() => setQrFor(null)} />}

      {/* Printable sheet: every code at a size worth taping to a table, hidden
          on screen. The plan and the list above are for arranging; this is for
          the roll of tape. */}
      <div className="hidden print:grid print:grid-cols-2 print:gap-6">
        {tables.map((t) => (
          <div key={t.id} className="break-inside-avoid text-center">
            <div className="text-lg font-bold">{t.label}</div>
            {t.seats != null && <div className="text-sm">{t.seats} seats</div>}
            {qrDataUrls[t.id] && <img src={qrDataUrls[t.id]} alt="" className="mx-auto w-full max-w-[220px]" />}
            <div className="break-all text-[10px]">{tableUrl(t.qr_token)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TableRow({
  table,
  selected,
  onSelect,
  busy,
  confirming,
  onRename,
  onSeats,
  onTogglePause,
  onShowQr,
  onAskRetire,
  onCancelRetire,
  onRetire,
}) {
  const seats = table.seats ?? 0;
  return (
    // Selecting links the two halves of this screen: pick a table on the plan
    // and its row lights up, and the other way round. Without it, finding
    // "the one in the far corner" in a list of twenty is a guessing game.
    <tr className={`border-b border-gray-200 last:border-b-0 ${selected ? 'bg-teal-50' : ''}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            aria-label={`Find ${table.label} on the plan`}
            className="rounded text-sm font-bold text-gray-900 hover:text-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            {table.label}
          </button>
          <button
            type="button"
            onClick={onRename}
            aria-label={`Edit ${table.label}`}
            className="rounded-lg p-1 text-gray-600 hover:bg-gray-100 hover:text-teal-700"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {!table.is_active && <div className="text-xs font-bold text-gray-600">Paused</div>}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || seats <= 1}
            onClick={() => onSeats(seats - 1)}
            aria-label={`Fewer seats at ${table.label}`}
            className="rounded-lg border border-gray-300 p-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <span className="min-w-[1.5rem] text-center text-sm font-bold text-gray-900">{table.seats ?? '—'}</span>
          <button
            type="button"
            disabled={busy || seats >= 99}
            onClick={() => onSeats(seats + 1)}
            aria-label={`More seats at ${table.label}`}
            className="rounded-lg border border-gray-300 p-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          disabled={busy}
          onClick={onTogglePause}
          aria-label={table.is_active ? `Pause ${table.label}` : `Resume ${table.label}`}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {table.is_active ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
          {table.is_active ? 'Pause' : 'Resume'}
        </button>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={onShowQr}
          aria-label={`Show the QR code for ${table.label}`}
          className="ml-auto flex items-center gap-1.5 rounded-lg p-2 text-sm font-bold text-teal-700 hover:bg-teal-50"
        >
          <QrCode className="h-4 w-4" aria-hidden="true" /> QR
        </button>
      </td>
      <td className="px-4 py-3 text-right">
        {confirming ? (
          <div className="flex items-center justify-end gap-2">
            {/* Says what actually happens: the table goes, its orders stay. */}
            <span className="text-xs font-bold text-gray-900">Remove {table.label}? Its past orders stay.</span>
            <button
              type="button"
              onClick={onCancelRetire}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-800 hover:bg-gray-50"
            >
              Keep
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onRetire}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAskRetire}
            aria-label={`Remove ${table.label}`}
            className="ml-auto flex rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-red-700"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </td>
    </tr>
  );
}
