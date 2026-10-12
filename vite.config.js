import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' + relative API calls let the app run at any path (e.g. behind Acme's hub).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8080' } },
  // three.js (~176 KB gzipped) is its own lazily loaded chunk, so its size is expected.
  build: { chunkSizeWarningLimit: 800 },
});
