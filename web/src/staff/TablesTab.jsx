import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useTablesAdmin } from './useTablesAdmin.js';
import { TableForm } from './TableForm.jsx';

// A table's QR code encodes {origin}/t/{qr_token} — the same path App.jsx's
// qrTokenFromPath parses. The web app is served at APP_BASE_URL itself, so
// the browser's own origin is that base; no env var needed on this side.
export function tableUrl(qrToken) {
  return `${window.location.origin}/t/${encodeURIComponent(qrToken)}`;
}

// Renders each table's QR code client-side as SVG (the `qrcode` package's
// pure-JS string renderer — no canvas, so it needs no native/browser-only
// API and no server-side image generation, per ARCHITECTURE.md's decision).
// Wrapped as a data URL so it can sit in a plain <img> like any other image.
function useQrDataUrls(tables) {
  const [dataUrls, setDataUrls] = useState({});

  useEffect(() => {
    if (!tables) return;
    let cancelled = false;
    Promise.all(
      tables.map(async (t) => {
        const svg = await QRCode.toString(tableUrl(t.qr_token), { type: 'svg', margin: 1, width: 220 });
        return [t.id, `data:image/svg+xml;base64,${btoa(svg)}`];
      }),
    ).then((entries) => {
      if (!cancelled) setDataUrls(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [tables]);

  return dataUrls;
}

// Owner only (see Board.jsx) — staff have no need to add tables or print QR
// sheets. Add-only for now: renaming/deactivating an existing table is on
// the "after v1" list.
export function TablesTab({ token }) {
  const admin = useTablesAdmin(token);
  const [adding, setAdding] = useState(false);
  const qrDataUrls = useQrDataUrls(admin.tables);

  if (admin.tables === null && !admin.error) return <p className="staff-loading">Loading tables…</p>;

  return (
    <div className="staff-tables-tab">
      {admin.error && (
        <div className="staff-banner staff-banner-error" role="alert">
          <span>{admin.error}</span>
          <button type="button" onClick={admin.dismissError} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="staff-tables-toolbar staff-print-hide">
        <button type="button" className="primary" onClick={() => setAdding(true)}>
          + Add table
        </button>
        {admin.tables?.length > 0 && (
          <button type="button" onClick={() => window.print()}>
            Print QR sheet
          </button>
        )}
      </div>

      <div className="staff-qr-sheet">
        {admin.tables?.map((t) => (
          <div key={t.id} className="staff-qr-card">
            <div className="staff-qr-card-label">{t.label}</div>
            {t.seats != null && <div className="staff-muted">{t.seats} seats</div>}
            {qrDataUrls[t.id] && <img src={qrDataUrls[t.id]} alt={`QR code for table ${t.label}`} width={220} height={220} />}
            <div className="staff-qr-card-url">{tableUrl(t.qr_token)}</div>
            {!t.is_active && <div className="staff-qr-card-inactive">Inactive</div>}
          </div>
        ))}
      </div>

      {admin.tables?.length === 0 && <p className="staff-empty">No tables yet.</p>}

      {adding && (
        <TableForm
          busy={admin.creating}
          error={admin.error}
          onSave={admin.createTable}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
