import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev: the browser talks to this server only, and /api is forwarded to the
// Express API, so there is no CORS to deal with. Port 5173 is fixed because
// APP_BASE_URL in .env (which the API's CORS allow-list uses) points at it.
// `host: true` also serves on your LAN so a phone can open the app.
export default defineConfig({
  plugins: [react()],
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
  },
});
