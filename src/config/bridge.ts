/**
 * The only place a bridge URL appears anywhere in the frontend. Everything else
 * imports `BRIDGE_HTTP_URL` / `BRIDGE_WS_URL` from here — see the Stage 1 plan's
 * "standing guardrail" on not duplicating config.
 *
 * Both env vars are optional. Unset (the local-dev default, matching `.env.example`)
 * means "go through the Vite dev proxy" — relative paths, no CORS to think about, works
 * against `npm run mock` out of the box. Set (Phase F, pointed at the Pi) means talk to
 * the bridge directly; that path requires `httpNodeCors` enabled on the Pi.
 */

const envHttp = import.meta.env.VITE_BRIDGE_HTTP_URL?.trim();
const envWs = import.meta.env.VITE_BRIDGE_WS_URL?.trim();

export const BRIDGE_HTTP_URL = envHttp ? envHttp.replace(/\/+$/, '') : '/api';

export const BRIDGE_WS_URL = envWs || defaultWsUrl();

function defaultWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws/live`;
}
