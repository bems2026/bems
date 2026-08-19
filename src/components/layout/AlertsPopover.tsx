import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, AlertTriangle, X } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useAnomaliesStore } from '@/stores/anomaliesStore';
import { isReadingStale } from '@/lib/staleness';
import { latestAnomalyPerDevice, isAnomalyCurrent } from '@/lib/anomalies';

/** One row in the bell — either source (staleness watchdog, anomaly detection) is shaped
 * into this before rendering, so the render/ack logic below only ever deals with one shape
 * regardless of how many alert sources feed it. */
interface AlertItem {
  deviceId: string;
  title: string;
  body: string;
  meta: string;
  kind: 'watchdog' | 'anomaly';
}

/**
 * The nav's alerts bell — fed by real device staleness (per `isReadingStale`, the same 30s
 * rule `StaleDataBadge`/`DevicesView` use) and, as of architecture plan Phase 8, real
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
  const [open, setOpen] = useState(false);
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  // Re-render once a second so a device crossing the 30s stale threshold appears without
  // waiting for its next store write — same pattern as StaleDataBadge/ConnectionStatus.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

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
          body: 'No reading in the last 30 seconds.',
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

  const allItems = useMemo(() => [...staleItems, ...anomalyItems], [staleItems, anomalyItems]);
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
                      {item.kind === 'anomaly' ? <AlertTriangle size={12} aria-hidden="true" /> : <Bell size={12} aria-hidden="true" />}
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
