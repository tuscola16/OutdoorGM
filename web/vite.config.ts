import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// `@`        → web/src (this app's own code)
// `@shared`  → repo root (shared TypeScript types/constants reused from the
//              React Native app, e.g. `@shared/types`, `@shared/constants/colors`).
//              `server.fs.allow: ['..']` lets Vite read those files in dev.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('..', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    fs: { allow: ['..'] },
  },
});
