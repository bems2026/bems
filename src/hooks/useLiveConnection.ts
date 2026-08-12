import { useEffect } from 'react';
import { connectLive, getDevices } from '@/lib/bridgeClient';
import { useDeviceStore } from '@/stores/deviceStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useCommandStore } from '@/stores/commandStore';
import { useContextStore } from '@/stores/contextStore';

/**
 * Mounts the live data pipeline once for the app's lifetime: fetches the static device
 * catalogue, opens `/ws/live` (falling back to HTTP polling per `bridgeClient`), loads the
 * Node-RED context store, and wires all of it into the Zustand stores. Call this exactly
 * once, at the app root.
 */
export function useLiveConnection(): void {
  useEffect(() => {
    let cancelled = false;

    getDevices()
      .then((devices) => {
        if (!cancelled) useDeviceStore.getState().setDevices(devices);
      })
      .catch(() => {
        // The device catalogue is static; a transient failure here just leaves it empty
        // until the next mount. The live feed below still drives readings independently.
      });

    // Loaded here, not lazily on Automation's mount — Overview's load-shed banner reads
    // the DSM keys regardless of which page is currently active.
    void useContextStore.getState().load();

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
      disconnect();
    };
  }, []);
}
