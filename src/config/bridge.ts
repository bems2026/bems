/**
 * The only place a bridge URL appears anywhere in the frontend. Everything else
 * imports `BRIDGE_HTTP_URL` / `BRIDGE_WS_URL` from here — see the Stage 1 plan's
 * "standing guardrail" on not duplicating config.
 *
 * Both env vars are optional overrides. Unset — the default for BOTH dev and a
 * production build with no `.env` override — derives the bridge address from how the
 * page itself was reached, not a value baked in at build time:
 *
 *   - `npm run dev`: relative paths (`/api`, same-origin `/ws/live`), proxied by Vite's
 *     dev server to the mock or a configured target. Zero CORS, works against
 *     `npm run mock` out of the box.
 *   - a production build (`vite build`, served statically — e.g. by `serve`, no dev
 *     proxy exists): `window.location.hostname` + port 1880, Node-RED's fixed port.
 *     This is what makes ONE build correct from every address a viewer might use to
 *     reach the Pi — LAN IP, Tailscale IP, eventually a real hostname — since the
 *     dashboard's static server and Node-RED always run on the same physical host.
 *
 *     A hardcoded absolute VITE_BRIDGE_HTTP_URL/VITE_BRIDGE_WS_URL only works for the
 *     ONE address it was baked in for. Confirmed the hard way: a build baked with the
 *     Pi's LAN IP left every Tailscale-only viewer stuck on "Reconnecting" — every
 *     fetch/WS call targeted an address their network path couldn't reach, even though
 *     the bridge itself was healthy and reachable from where THEY were. Setting these
 *     env vars is for the genuinely different case of a dev machine's `npm run dev`
 *     pointed at a bridge running on a different host than the one serving the page —
 *     not for a same-host production deployment, which should leave them unset.
 *
 * Phase 5: a production build now targets `server/proxy.mjs` instead of talking to
 * Node-RED directly on 1880 — the proxy is the one thing allowed to reach the bridge, and
 * it's what actually enforces "no unauthenticated access to 1880" instead of leaving that
 * a documentation-only convention. Only kicks in when Supabase is actually configured
 * (`@/config/supabase`'s `supabase !== null`); with no Supabase project set up, production
 * falls back to the pre-Phase-5 direct-to-bridge behavior unchanged.
 *
 * Two different ways to reach the proxy, and the page's own protocol says which:
 *   - `http:` — direct LAN access. The proxy really does listen on its own port
 *     (`PROXY_PORT`), so this needs `:PROXY_PORT` in the URL, same shape as the pre-Phase-5
 *     `:BRIDGE_PORT` default.
 *   - `https:` — reached via `tailscale serve`, which path-routes `/api` and `/ws` to the
 *     proxy *at the edge* (see `tailscale serve status` on the Pi) — port 443 only, no
 *     other port is exposed on the tailnet at all. So this is a same-origin relative path,
 *     exactly like dev mode's Vite proxy — appending `:PROXY_PORT` here would try to reach
 *     a port that plain doesn't exist from outside the Pi and fail every request.
 */

import { supabase } from './supabase';

const envHttp = import.meta.env.VITE_BRIDGE_HTTP_URL?.trim();
const envWs = import.meta.env.VITE_BRIDGE_WS_URL?.trim();

/** Node-RED's fixed port on the Pi — see docs/bridge-contract.md. Not configurable
 * per-deployment (there's only ever one bridge instance per Pi); if that ever changes,
 * this is the one constant to update. */
const BRIDGE_PORT = 1880;

/** `server/proxy.mjs`'s fixed port — see `server/.env.example`'s `PROXY_PORT`. Only
 * reachable directly over plain `http:` (LAN); `https:` access goes through
 * `tailscale serve`'s path routing instead — see the module doc comment above. */
const PROXY_PORT = 8080;

export const BRIDGE_HTTP_URL = envHttp ? envHttp.replace(/\/+$/, '') : defaultHttpUrl();

export const BRIDGE_WS_URL = envWs || defaultWsUrl();

function defaultHttpUrl(): string {
  if (import.meta.env.DEV) return '/api';
  if (supabase === null) return `${window.location.protocol}//${window.location.hostname}:${BRIDGE_PORT}/api`;
  if (window.location.protocol === 'https:') return '/api'; // tailscale serve path routing
  return `${window.location.protocol}//${window.location.hostname}:${PROXY_PORT}/api`;
}

function defaultWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  if (import.meta.env.DEV) return `${proto}://${window.location.host}/ws/live`;
  if (supabase === null) return `${proto}://${window.location.hostname}:${BRIDGE_PORT}/ws/live`;
  if (window.location.protocol === 'https:') return `${proto}://${window.location.host}/ws/live`; // tailscale serve
  return `${proto}://${window.location.hostname}:${PROXY_PORT}/ws/live`;
}
