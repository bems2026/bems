/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The bridge (real Node-RED on the Pi, or `npm run mock` locally) has no CORS headers
// by default — see docs/bridge-contract.md §Deployment. Proxying /api and /ws through
// the dev server sidesteps that entirely without touching bridge config. Override the
// target for a session via `VITE_BRIDGE_PROXY_TARGET=http://<pi-ip>:1880 npm run dev`.
// 127.0.0.1, not `localhost`. THE SAME TRAP THIS PROJECT ALREADY PAID FOR ON THE BROKER
// (docs/pi-session-brief.md: "localhost is two addresses, and binding one of them silently
// locks out the other"). `npm run mock` binds IPv4 only; Node resolves `localhost` to ::1
// first on Windows, so the dev proxy answered 502 while curl to 127.0.0.1 returned 200 —
// which reads as a broken app rather than a name-resolution mismatch. Measured 2026-08-27.
const BRIDGE_PROXY_TARGET = process.env.VITE_BRIDGE_PROXY_TARGET ?? 'http://127.0.0.1:1880';

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
    // three.js's own chunk is ~520KB minified — expected for a 3D library and no longer
    // actionable once it's already split out and lazy-loaded (see manualChunks below);
    // raised so the build's warning output stays meaningful for chunks that actually
    // indicate a code-splitting gap, rather than re-flagging this one every build.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Recharts and three.js each alone push the default bundle past Vite's 500kB
        // warning; splitting them into their own chunks keeps the initial load lean
        // without needing route-level code-splitting this single-page layout otherwise
        // has no use for. three is additionally behind React.lazy() at the call site
        // (OfficeScene3D isn't imported until the Overview hero mounts it), so this chunk
        // isn't fetched at all on a first paint that never reaches the 3D view.
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts';
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/lucide-react')) return 'icons';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    css: false,
  },
});
