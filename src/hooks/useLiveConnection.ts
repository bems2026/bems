import { useEffect } from 'react';
import { connectLive, getDevices, nextPollDelayMs } from '@/lib/bridgeClient';
import { useDeviceStore } from '@/stores/deviceStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useCommandStore } from '@/stores/commandStore';
import { useContextStore } from '@/stores/contextStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';

/**
 * Mounts the live data pipeline once for the app's lifetime: fetches the static device
 * catalogue, opens `/ws/live` (falling back to HTTP polling per `bridgeClient`), loads the
 * Node-RED context store, and wires all of it into the Zustand stores. Call this exactly
 * once, at the app root.
 */
export function useLiveConnection(): void {
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // Retries on the same backoff schedule the WS-polling fallback already uses
    // (`nextPollDelayMs`) — a transient failure here (a proxy restart mid-request, one
    // dropped packet) used to leave `deviceStore.devices` empty forever: every page reads
    // its loading state off `devices.length`, so nothing ever recovered even after the WS
    // itself reconnected on its own and the header kept reporting "LIVE". Confirmed the
    // hard way during a Phase 5 proxy redeploy — see the architecture plan's incident notes.
    let attempt = 0;
    const loadDevices = () => {
      getDevices({
        // The default TIMING.FETCH_TIMEOUT_MS (10s) is tuned for a same-LAN bridge call —
        // this one-time bootstrap fetch can cross a real network hop (Tailscale, from a
        // remote device) plus the Phase 5 proxy hop that didn't exist before. A one-time
        // bootstrap fetch can afford to wait longer than a snappy read the UI is blocking on.
        timeoutMs: 30000,
      })
        .then((devices) => {
          if (cancelled) return;
          useDeviceStore.getState().setDevices(devices);
        })
        .catch(() => {
          if (cancelled) return;
          attempt++;
          retryTimer = setTimeout(loadDevices, nextPollDelayMs(attempt));
        });
    };
    loadDevices();

    // Loaded here, not lazily on Automation's mount — Overview's Active Schedules card
    // reads the schedule keys regardless of which page is currently active.
    void useContextStore.getState().load();

    // Loaded here, not lazily on Control's mount, so the dispatch banner's very first
    // render is already accurate instead of defaulting open for one frame.
    void useCapabilitiesStore.getState().load();

    const disconnect = connectLive({
      onData: (rows) => {
        useDeviceStore.getState().ingestReadings(rows);
        // Must run after ingest — reconcile reads the just-updated readings via the row
        // array it's given directly, but the ordering documents the dependency.
        useCommandStore.getState().reconcile(rows);
        useConnectionStore.getState().markMessage();
      },
      onStatus: (status) => useConnectionStore.getState().setWsStatus(status),
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      disconnect();
    };
  }, []);
}
