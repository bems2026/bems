import { useEffect, useState, type ReactNode } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { isReadingStale } from '@/lib/staleness';

interface StaleDataBadgeProps {
  /** Omit to badge the building `_totals` row instead of a single device. */
  deviceId?: string;
  /** Human-readable name for the accessible description, e.g. "Outlet 3". Falls back to a generic label if omitted. */
  label?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Dims its children once the underlying reading is stale — 30s with no update, or the
 * bridge explicitly reporting the device offline. Self-contained on purpose: drop it
 * around any per-device or building-level display and it subscribes to the right slice
 * of `deviceStore` itself, per the Stage 1 plan's "applied per-device wherever a reading
 * is shown."
 *
 * This is data freshness, not connection health — `ConnectionStatus` covers the bridge
 * link as a whole; this covers one reading going quiet while the link stays up (e.g. a
 * dead sensor whose own `_last_time` stopped advancing).
 *
 * The flag is a live region (`role="status" aria-live="polite"`): a device *going* stale
 * is arguably the single most important state change on a monitoring dashboard, and it
 * previously announced nothing — its only explanation was a `title` attribute, which
 * isn't reliably exposed to screen readers and is unreachable by keyboard or touch at all.
 * `aria-label` carries the full sentence; the visible text stays the short "stale" — the
 * accessible name takes precedence over visible text when both are present, so screen
 * readers get the fuller description without changing what's shown on screen.
 */
export function StaleDataBadge({ deviceId, label, children, className }: StaleDataBadgeProps) {
  const reading = useDeviceStore((s) => (deviceId ? s.latestReadings[deviceId] : s.totals));

  // Staleness is a function of wall-clock time, not just store writes — without this
  // tick, a device that simply stops sending updates would never visibly go stale.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const stale = isReadingStale(reading);
  const subject = label ?? (deviceId ? 'This device' : 'Building totals');

  return (
    <div className={`stale-wrap${stale ? ' stale-wrap--stale' : ''}${className ? ` ${className}` : ''}`}>
      {children}
      {stale && (
        <span className="stale-flag" role="status" aria-live="polite" aria-label={`${subject}: no reading in the last 30 seconds`}>
          stale
        </span>
      )}
    </div>
  );
}
