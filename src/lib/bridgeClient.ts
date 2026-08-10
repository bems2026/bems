/**
 * The bridge resilience layer. Ports the only production-grade data layer of the three
 * legacy dashboards (`Bems.html:1254-1376`): AbortController timeout, an in-flight guard
 * against request stacking, exponential backoff capped at 120s, and a self-rescheduling
 * `setTimeout` chain — never `setInterval`, so a slow request can't overlap the next tick.
 *
 * Framework-agnostic and store-agnostic on purpose: this file talks to `fetch`/`WebSocket`
 * and calls plain callbacks. Nothing here imports Zustand — that wiring lives in
 * `hooks/useLiveConnection.ts`, so the resilience logic (the part worth unit-testing
 * precisely — see `bridgeClient.test.ts`) stays testable without mounting React.
 */

import { BRIDGE_HTTP_URL, BRIDGE_WS_URL } from '@/config/bridge';
import { TIMING } from './timing';
import type { Device, HistoryResponse, ReadingsLatestRow } from './types';

export class BridgeFetchError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'BridgeFetchError';
    this.status = status;
  }
}

/** GET with a 10s abort timeout. Never retries on its own — callers own retry policy. */
export async function fetchJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMING.FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BRIDGE_HTTP_URL}${path}`, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) throw new BridgeFetchError(`HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new BridgeFetchError(`request to ${path} timed out after ${TIMING.FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const getDevices = (): Promise<Device[]> => fetchJson('/devices');
export const getLatestReadings = (): Promise<ReadingsLatestRow[]> => fetchJson('/readings/latest');
export const getHistory = (deviceId: string, range: '1h' | '6h' | '24h' = '24h'): Promise<HistoryResponse> =>
  fetchJson(`/readings/history?device_id=${encodeURIComponent(deviceId)}&range=${range}`);

// ---------------------------------------------------------------------------
// Pure resilience math — the part `test/…` in the Stage 1 plan §6 calls out to unit
// test directly rather than by observation.
// ---------------------------------------------------------------------------

/**
 * Healthy: poll every 15s. Each consecutive failure doubles the delay, capped at 120s.
 * failures: 0→15s, 1→30s, 2→60s, 3→120s, 4+→120s (matches `Bems.html:1316`'s formula,
 * `min(base * 2^min(failures,4), 120000)`).
 */
export function nextPollDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return TIMING.POLL_FALLBACK_MS;
  const exponent = Math.min(consecutiveFailures, 4);
  return Math.min(TIMING.POLL_FALLBACK_MS * 2 ** exponent, TIMING.BACKOFF_CAP_MS);
}

/** A device (or the whole feed) is stale once 30s have passed since its last update. */
export function isStale(lastUpdateMs: number | null, nowMs: number = Date.now()): boolean {
  if (lastUpdateMs === null) return true;
  return nowMs - lastUpdateMs > TIMING.STALE_AFTER_MS;
}

// ---------------------------------------------------------------------------
// Live connection: WebSocket primary, HTTP-poll fallback while reconnecting.
// ---------------------------------------------------------------------------

export type ConnStatus = 'connected' | 'reconnecting' | 'polling-fallback' | 'offline';

export interface LiveHandlers {
  onData: (rows: ReadingsLatestRow[]) => void;
  onStatus: (status: ConnStatus) => void;
}

/**
 * Opens `/ws/live` and calls `onData` for every frame. If the socket drops, falls back
 * to polling `getLatestReadings()` on the same backoff schedule as `nextPollDelayMs`,
 * while a separate timer keeps retrying the WS upgrade — whichever reconnects first
 * wins, and the other path stops itself.
 *
 * Returns a disconnect function. Calling it tears down the socket and both timers;
 * nothing fires after that.
 */
export function connectLive({ onData, onStatus }: LiveHandlers): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollInFlight = false;
  let pollFailures = 0;

  const stopPolling = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    pollFailures = 0;
  };

  const pollLoop = async () => {
    if (closed) return;
    if (pollInFlight) {
      pollTimer = setTimeout(pollLoop, nextPollDelayMs(pollFailures));
      return;
    }
    pollInFlight = true;
    try {
      const rows = await getLatestReadings();
      pollInFlight = false;
      if (closed) return;
      pollFailures = 0;
      onData(rows);
      onStatus('polling-fallback');
    } catch {
      pollInFlight = false;
      if (closed) return;
      pollFailures++;
    } finally {
      if (!closed) pollTimer = setTimeout(pollLoop, nextPollDelayMs(pollFailures));
    }
  };

  const startPolling = () => {
    if (pollTimer || closed) return; // already running
    pollLoop();
  };

  const scheduleReconnect = () => {
    if (closed) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(openSocket, TIMING.POLL_FALLBACK_MS);
  };

  function openSocket() {
    if (closed) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(BRIDGE_WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      if (closed) return;
      onStatus('connected');
      stopPolling();
    };

    socket.onmessage = (ev) => {
      if (closed) return;
      try {
        const rows = JSON.parse(ev.data as string) as ReadingsLatestRow[];
        onData(rows);
      } catch {
        // malformed frame — drop it, the next one arrives in ~2s
      }
    };

    socket.onclose = () => {
      if (closed) return;
      ws = null;
      onStatus('reconnecting');
      startPolling();
      scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }

  openSocket();

  return () => {
    closed = true;
    stopPolling();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
    ws = null;
  };
}
