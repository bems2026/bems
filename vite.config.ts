/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The bridge (real Node-RED on the Pi, or `npm run mock` locally) has no CORS headers
// by default — see docs/bridge-contract.md §Deployment. Proxying /api and /ws through
// the dev server sidesteps that entirely without touching bridge config. Override the
// target for a session via `VITE_BRIDGE_PROXY_TARGET=http://<pi-ip>:1880 npm run dev`.
const BRIDGE_PROXY_TARGET = process.env.VITE_BRIDGE_PROXY_TARGET ?? 'http://localhost:1880';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5183, // deliberately not 5173 — avoids shadowing any other Vite project's default port
    strictPort: true, // fail loudly on a collision instead of silently binding elsewhere
    host: true, // bind 0.0.0.0 — Stage 1's DoD requires reachability from another LAN device
    proxy: {
      '/api': { target: BRIDGE_PROXY_TARGET, changeOrigin: true },
      '/ws': { target: BRIDGE_PROXY_TARGET.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    css: false,
  },
});
