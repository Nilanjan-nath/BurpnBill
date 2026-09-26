import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

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
//
// Shared by the Tables tab (printable QR sheet) and POS's own QR tab, which
// shows one table's code at the counter without leaving the till.
export function useQrDataUrls(tables) {
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
