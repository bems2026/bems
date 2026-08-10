import { useEffect } from 'react';
import { connectLive, getDevices } from '@/lib/bridgeClient';
import { useDeviceStore } from '@/stores/deviceStore';
import { useConnectionStore } from '@/stores/connectionStore';

/**
 * Mounts the live data pipeline once for the app's lifetime: fetches the static device
 * catalogue, opens `/ws/live` (falling back to HTTP polling per `bridgeClient`), and
 * wires both into the Zustand stores. Call this exactly once, at the app root.
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

    const disconnect = connectLive({
      onData: (rows) => {
        useDeviceStore.getState().ingestReadings(rows);
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
