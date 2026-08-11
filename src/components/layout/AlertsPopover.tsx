import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { isReadingStale } from '@/lib/staleness';

/**
 * The nav's alerts bell — fed by real device staleness, not v4's sample
 * `"Switch 07 in COMM FAULT"` copy. Every device whose reading is stale (per
 * `isReadingStale`, the same 30s rule `StaleDataBadge`/`DevicesView` use) is a real alert;
 * there is nothing else in this app's data model to alert on yet.
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

  const staleDevices = useMemo(
    () => devices.filter((d) => isReadingStale(latestReadings[d.id])),
    [devices, latestReadings],
  );

  const visible = staleDevices.filter((d) => !acked.has(d.id));

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
              {visible.map((d) => (
                <li className="alerts-popover__row" key={d.id}>
                  <div>
                    <p className="alerts-popover__title">{d.display_name} in COMM FAULT</p>
                    <p className="alerts-popover__body">No reading in the last 30 seconds.</p>
                    <p className="alerts-popover__meta">{d.id} · watchdog</p>
                  </div>
                  <button type="button" className="alerts-popover__ack" onClick={() => setAcked((s) => new Set(s).add(d.id))}>
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
