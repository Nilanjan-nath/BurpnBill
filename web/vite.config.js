import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev: the browser talks to this server only, and /api is forwarded to the
// Express API, so there is no CORS to deal with. Port 5173 is fixed because
// APP_BASE_URL in .env (which the API's CORS allow-list uses) points at it.
// `host: true` also serves on your LAN so a phone can open the app.
// Tailwind's CSS is only ever imported from within staff/ (see tailwind.css),
// so — same as staff.css already does — it ends up in the lazy-loaded /staff
// chunk only. A customer scanning a table's QR code never downloads it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: { '/api': 'http://localhost:4000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globalSetup: ['./src/test/globalSetup.js'],
    // globalSetup runs once and every test file shares its server + database
    // (see globalSetup.js) — Vitest's default is to still run FILES in
    // parallel, though, which raced two files' tests against that one
    // shared database (a customer-app test counting *all* orders could see
    // ones a concurrently-running staff test had just placed). Each file's
    // own tests were always sequential and safe; only cross-file
    // concurrency was the problem.
    fileParallelism: false,
  },
});
