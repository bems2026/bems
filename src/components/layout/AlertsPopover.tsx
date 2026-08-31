import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, AlertTriangle, X } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useAnomaliesStore } from '@/stores/anomaliesStore';
import { useCommandStore } from '@/stores/commandStore';
import { isReadingStale, staleWindowLabel } from '@/lib/staleness';
import { latestAnomalyPerDevice, isAnomalyCurrent } from '@/lib/anomalies';
import { useNowTick } from '@/lib/useNowTick';
import { useDeviceConnectivity } from '@/hooks/useDeviceConnectivity';
import { fleetStuck, isFleetStuck } from '@/lib/deviceConnectivity';

/** One row in the bell — either source (staleness watchdog, anomaly detection) is shaped
 * into this before rendering, so the render/ack logic below only ever deals with one shape
 * regardless of how many alert sources feed it. */
interface AlertItem {
  deviceId: string;
  title: string;
  body: string;
  meta: string;
  kind: 'watchdog' | 'anomaly' | 'fleet' | 'cloud';
}

/**
 * The nav's alerts bell — fed by real device staleness (per `isReadingStale`, the same
 * per-device rule `StaleDataBadge`/`DevicesView` use) and, as of architecture plan Phase 8, real
 * rolling-window power anomalies (`useAnomaliesStore`, server-computed in
 * `server/ingest.mjs`). Both sources reduce to the same `AlertItem` shape and the same
 * per-device-id ack Set below — no new branching in render or the ack handler.
 *
 * "Ack" is a local, per-device dismiss for this session — it hides that device from the
 * list without touching the underlying reading. Deliberately NOT auto-cleared when a
 * device recovers: doing that reactively needs either a setState-in-effect (React flags it
 * as a cascading-render anti-pattern) or the "adjust state during render" workaround, and
 * the payoff — re-surfacing an alert for a device that flaps fault/recovered/fault within
 * one session — is a rare enough case that the extra mechanism isn't worth it here. A
 * fresh page load clears every ack.
 */
export function AlertsPopover() {
  const devices = useDeviceStore((s) => s.devices);
  const latestReadings = useDeviceStore((s) => s.latestReadings);
  const anomalyRows = useAnomaliesStore((s) => s.rows);
  const { rows: connectivity } = useDeviceConnectivity(24);
  const cloudRecoveries = useCommandStore((s) => s.cloudRecoveries);
  const [open, setOpen] = useState(false);
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  // Re-render once a second so a device crossing the 30s stale threshold appears without
  // waiting for its next store write — via the one shared app-wide tick.
  useNowTick();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const staleItems: AlertItem[] = useMemo(
    () =>
      devices
        .filter((d) => isReadingStale(latestReadings[d.id]))
        .map((d) => ({
          deviceId: d.id,
          title: `${d.display_name} in COMM FAULT`,
          body: `No reading in the last ${staleWindowLabel(latestReadings[d.id])}.`,
          meta: `${d.id} · watchdog`,
          kind: 'watchdog' as const,
        })),
    [devices, latestReadings],
  );

  // A device can't realistically be both stale and anomalous at once — a stale reading has
  // no fresh value to evaluate for anomaly in the first place — but this guard is cheap
  // insurance against exactly that overlap rather than relying purely on that reasoning.
  const anomalyItems: AlertItem[] = useMemo(() => {
    const staleIds = new Set(staleItems.map((i) => i.deviceId));
    const latest = latestAnomalyPerDevice(anomalyRows);
    const items: AlertItem[] = [];
    for (const row of Object.values(latest)) {
      if (staleIds.has(row.device_id) || !isAnomalyCurrent(row)) continue;
      const device = devices.find((d) => d.id === row.device_id);
      items.push({
        deviceId: row.device_id,
        title: `${device?.display_name ?? row.device_id} reading abnormal power`,
        body: `${row.value.toFixed(0)}W vs. its usual ~${row.baseline_mean.toFixed(0)}W recently.`,
        meta: `${row.device_id} · anomaly · z=${row.z_score.toFixed(1)}`,
        kind: 'anomaly' as const,
      });
    }
    return items;
  }, [anomalyRows, devices, staleItems]);

  /**
   * One fleet-level row rather than N per-device ones — and it carries the REMEDY, which is the
   * part that was missing. On 2026-08-25 a Node-RED restart recovered five devices that a
   * written diagnosis had called a hardware fault; the fix was cheap and remote, and nothing on
   * screen suggested it. `fleetStuck` excludes devices never seen online in the window, so the
   * two permanently-quiesced ones cannot hold this on forever.
   *
   * Listed FIRST because it reframes the per-device rows beneath it: eight separate COMM FAULTs
   * read as eight problems, when they are usually one.
   */
  const fleetItems: AlertItem[] = useMemo(() => {
    const result = fleetStuck(connectivity);
    if (!isFleetStuck(result)) return [];
    return [
      {
        deviceId: '__fleet__',
        title: `${result.stuck.length} devices dropped together`,
        body:
          'Each was reporting earlier today. Devices often stop answering because the bridge nodes gave up rather than because the hardware failed — restarting Node-RED on the Pi has recovered exactly this before. If they stay dark afterwards, they need power cycling.',
        meta: `${result.stuck.join(', ')} · fleet`,
        kind: 'fleet' as const,
      },
    ];
  }, [connectivity]);

  /**
   * A command that only landed through the vendor cloud. It SUCCEEDED — the relay moved and the
   * operator saw a normal confirmation — while meaning the device has stopped answering on the
   * LAN. That is the earliest warning this system has that a device is going bad, and until now
   * it appeared only in a database column nobody has open.
   *
   * Not time-limited: a session is short, and a device that needed the cloud an hour ago still
   * needs attention. Acking it is how it goes away.
   */
  const cloudItems: AlertItem[] = useMemo(
    () =>
      Object.keys(cloudRecoveries).map((deviceId) => {
        const device = devices.find((d) => d.id === deviceId);
        return {
          deviceId: `cloud:${deviceId}`,
          title: `${device?.display_name ?? deviceId} answered only through the vendor cloud`,
          body: 'The command worked, but the device did not respond on the local network — it was reached over the internet instead. That is how a device looks shortly before it stops responding altogether.',
          meta: `${deviceId} · cloud fallback`,
          kind: 'fleet' as const,
        };
      }),
    [cloudRecoveries, devices],
  );

  const allItems = useMemo(
    () => [...fleetItems, ...cloudItems, ...staleItems, ...anomalyItems],
    [fleetItems, cloudItems, staleItems, anomalyItems],
  );
  const visible = allItems.filter((item) => !acked.has(item.deviceId));

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="nav-icon-btn"
        aria-label={`Alerts${visible.length ? `, ${visible.length} unacknowledged` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={16} aria-hidden="true" />
        {visible.length > 0 && (
          <span className="nav-icon-btn__badge" aria-hidden="true">
            {visible.length > 9 ? '9+' : visible.length}
          </span>
        )}
      </button>
      {open && (
        <div className="alerts-popover" role="dialog" aria-label="Alerts">
          <div className="alerts-popover__head">
            <span>Alerts</span>
            <button type="button" className="alerts-popover__close" onClick={() => setOpen(false)} aria-label="Close">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          {visible.length === 0 ? (
            <p className="alerts-popover__empty">Nothing outstanding</p>
          ) : (
            <ul className="alerts-popover__list">
              {visible.map((item) => (
                <li className="alerts-popover__row" key={item.deviceId}>
                  <div>
                    <p className="alerts-popover__title">
                      {/* A fleet drop earns the triangle for the same reason an anomaly does:
                          both need a judgement, where a single COMM FAULT is just a fact. */}
                      {item.kind === 'watchdog' ? <Bell size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
                      {item.title}
                    </p>
                    <p className="alerts-popover__body">{item.body}</p>
                    <p className="alerts-popover__meta">{item.meta}</p>
                  </div>
                  <button type="button" className="alerts-popover__ack" onClick={() => setAcked((s) => new Set(s).add(item.deviceId))}>
                    Ack
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
