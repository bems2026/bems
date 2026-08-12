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
import type { CommandAck, CommandRequest, ContextAck, ContextMap, Device, HistoryResponse, ReadingsLatestRow } from './types';

export class BridgeFetchError extends Error {
  readonly status?: number;
  /** Machine-readable reason from the bridge's `{error, code}` body (e.g. `unknown_device`,
   * `invalid_action`) — added for the command path, where the rejection *reason* is the
   * whole point: "that socket doesn't exist" and "the bridge is unreachable" must not look
   * identical to the UI. `undefined` for older error shapes that carry no `code`. */
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'BridgeFetchError';
    this.status = status;
    this.code = code;
  }
}

async function bridgeError(res: Response): Promise<BridgeFetchError> {
  let detail = '';
  let code: string | undefined;
  try {
    const body = (await res.json()) as { error?: unknown; code?: unknown };
    if (typeof body?.error === 'string') detail = body.error;
    if (typeof body?.code === 'string') code = body.code;
  } catch {
    // Non-JSON error body (a proxy 502, say) — the status is all there is.
  }
  return new BridgeFetchError(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`, res.status, code);
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
}

/** GET (or POST, with a body) with an abort timeout. Never retries — callers own retry policy. */
export async function fetchJson<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = TIMING.FETCH_TIMEOUT_MS } = opts;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BRIDGE_HTTP_URL}${path}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!res.ok) throw await bridgeError(res);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new BridgeFetchError(`request to ${path} timed out after ${timeoutMs}ms`);
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

/**
 * `POST /api/command` — mock-bridge only (Stage 2, Phase L). Shorter timeout than a read:
 * a toggle that spins for 10s is worse than one that fails at 5s and invites a retry, and
 * unlike a poll, nothing else is waiting on this particular request.
 */
export const sendCommand = (cmd: CommandRequest): Promise<CommandAck> =>
  fetchJson<CommandAck>('/command', { method: 'POST', body: cmd, timeoutMs: TIMING.COMMAND_TIMEOUT_MS });

/** `GET /api/context` — mock-bridge only (Stage 2, Phase M4). Empty on a fresh mock; no
 * fabricated default schedules or thresholds ever come back from this. */
export const getContext = (): Promise<ContextMap> => fetchJson('/context');

/** `POST /api/context` — mock-bridge only. Same short timeout as `sendCommand` and for the
 * same reason: nothing else on the page is waiting on this particular request. */
export const saveContext = (writes: ContextMap): Promise<ContextAck> =>
  fetchJson<ContextAck>('/context', { method: 'POST', body: { writes }, timeoutMs: TIMING.COMMAND_TIMEOUT_MS });

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
