import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { tableUrl } from './qr.js';

// Same two traps as every other dialog here: m-auto, because Tailwind's
// preflight kills the margin a modal <dialog> centres itself with, and an
// explicit bg/text so it can't fall back to the UA's dark canvas colour.
const PANEL = 'm-auto w-[min(26rem,92vw)] rounded-card bg-paper p-0 text-ink-900 shadow-pop backdrop:bg-ink-900/50';

// One table's code, big enough to check by eye before it goes on a table, and
// downloadable in both the format that prints and the format that pastes.
export function TableQrDialog({ table, dataUrl, onClose }) {
  const dialog = useRef(null);
  const [pngError, setPngError] = useState(null);
  const url = tableUrl(table.qr_token);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  // SVG is what qr.js already produced, so this is the original — it prints
  // crisp at any size, which a raster copy of a 220px image would not.
  const svgName = `${slug(table.label)}-qr.svg`;

  const downloadPng = async () => {
    setPngError(null);
    try {
      await svgUrlToPng(dataUrl, `${slug(table.label)}-qr.png`);
    } catch {
      setPngError('Couldn’t make a PNG here — the SVG downloads fine and prints better.');
    }
  };

  return (
    <dialog
      ref={dialog}
      className={PANEL}
      aria-label={`QR code for ${table.label}`}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <div className="p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-ink-900">{table.label}</h2>
            <p className="text-sm font-semibold text-ink-600">
              {table.seats != null ? `${table.seats} seats · ` : ''}Stick this on the table.
            </p>
          </div>
          <button
            type="button"
            onClick={() => dialog.current.close()}
            aria-label="Close"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-input text-ink-600 hover:bg-ink-100"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {dataUrl && (
          <img src={dataUrl} alt={`QR code for table ${table.label}`} className="mx-auto mb-3 h-auto w-full max-w-[16rem]" />
        )}

        <p className="mb-4 break-all rounded-input bg-ink-50 px-3 py-2 text-center font-mono text-xs font-semibold text-ink-700">{url}</p>

        {pngError && (
          <p className="mb-3 rounded-input border border-butter-500 bg-butter-100 px-3 py-2 text-sm font-semibold text-ink-900" role="alert">
            {pngError}
          </p>
        )}

        <div className="flex gap-2">
          <a
            href={dataUrl ?? '#'}
            download={svgName}
            className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-card bg-brand px-4 text-sm font-bold text-white transition duration-150 ease-tap hover:bg-brand-700 active:scale-[0.98]"
          >
            <Download className="h-4 w-4" aria-hidden="true" /> Download SVG
          </a>
          <button
            type="button"
            onClick={downloadPng}
            className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-card border-2 border-ink-300 px-4 text-sm font-bold text-ink-700 transition duration-150 ease-tap hover:bg-ink-50 active:scale-[0.98]"
          >
            <Download className="h-4 w-4" aria-hidden="true" /> Download PNG
          </button>
        </div>
        <p className="mt-2 text-center text-xs font-semibold text-ink-600">SVG prints sharp at any size; PNG pastes anywhere.</p>
      </div>
    </dialog>
  );
}

const slug = (label) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'table';

// Rasterise the SVG we already have at a size worth printing. Done here rather
// than asking the server for a PNG: the code is generated in this browser in
// the first place (see qr.js), so a round trip would only move the same work.
function svgUrlToPng(svgDataUrl, filename, size = 1024) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no 2d context'));
      // White behind it: a transparent QR on a dark background is unscannable.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(image, 0, 0, size, size);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('no blob'));
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(href);
        resolve();
      }, 'image/png');
    };
    image.onerror = () => reject(new Error('could not load the svg'));
    image.src = svgDataUrl;
  });
}
