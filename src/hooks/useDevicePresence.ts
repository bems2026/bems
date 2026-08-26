import { useEffect, useState } from 'react';
import { fetchDevicePresence, EMPTY_PRESENCE, type DevicePresence } from '@/lib/devicePresence';

/**
 * Faster than `useCloudFleet` because this answer is more perishable: the on-segment/absent
 * split moved twice inside one hour on 2026-08-26, and it is what decides whether somebody
 * drives to the office. Still minutes, not seconds — it costs a vendor cloud round trip.
 */
const REFRESH_MS = 60_000;

export function useDevicePresence(): DevicePresence {
  const [presence, setPresence] = useState<DevicePresence>(EMPTY_PRESENCE);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const next = await fetchDevicePresence();
      if (cancelled) return;
      // Unlike the cloud fleet, a failed refresh does NOT keep the last good answer. This one
      // names devices as absent from the network, and a stale copy of that would go on telling
      // somebody to drive to the office after the device had already come back — which is
      // exactly the failure mode the entry it serves keeps warning about.
      setPresence(next);
      if (!cancelled) timer = setTimeout(load, REFRESH_MS);
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return presence;
}
