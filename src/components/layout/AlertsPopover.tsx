import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertOctagon, AlertTriangle, Bell, Check, Info, X } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useAnomaliesStore } from '@/stores/anomaliesStore';
import { useCapabilityTroubleStore } from '@/stores/capabilityTroubleStore';
import { describeIncident, episodeWhen, toIncidents, type AlertSeverity, type CapabilityEpisode } from '@/lib/capabilityEpisodes';
import { useCommandStore } from '@/stores/commandStore';
import { isReadingStale, staleWindowLabel } from '@/lib/staleness';
import { latestAnomalyPerDevice, isAnomalyCurrent } from '@/lib/anomalies';
import { useNowTick } from '@/lib/useNowTick';
import { useDeviceConnectivity } from '@/hooks/useDeviceConnectivity';
import { fleetStuck, isFleetStuck } from '@/lib/deviceConnectivity';
import { useAnchoredPopover } from '@/components/ui/useAnchoredPopover';
import { isSeen, LIVE_SEEN_MS, readSeen, writeSeen, type SeenMap } from '@/lib/alertSeen';

/**
 * One row in the bell. Every source is shaped into this before rendering, so the list and its
 * actions deal with one shape however many sources feed it.
 */
interface AlertItem {
  /** Stable for the life of the condition: the list's React key and the "seen" identity. */
  id: string;
  /** What "seen" covers: an episode's start or end, or `live` for an alert with no episode. */
  stamp: string;
  /** For `live` alerts: "seen" lapses after this, so a problem that lasts comes back. */
  ttlMs?: number;
  severity: AlertSeverity;
  title: string;
  body: string;
  /** Where the alert comes from, in two or three words: "From the meter", "Watchdog". */
  source: string;
  /** The circuit or load it is on, from the registry. */
  circuit?: string | null;
  /** The device to open, and the raw id shown in the details. */
  deviceId?: string;
  /** Older episodes of the same incident, newest first. */
  history?: CapabilityEpisode[];
  /** Anything a technician wants and an operator does not, shown under "Details". */
  detail?: string;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, notice: 2 };
const SEVERITY_LABEL: Record<AlertSeverity, string> = { critical: 'Critical', warning: 'Warning', notice: 'Notice' };

function SeverityChip({ severity }: { severity: AlertSeverity }) {
  const Icon = severity === 'critical' ? AlertOctagon : severity === 'warning' ? AlertTriangle : Info;
  return (
    <span className={`alerts-popover__sev alerts-popover__sev--${severity}`}>
      <Icon size={12} aria-hidden="true" />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

const watts = (w: number) => `${Math.round(w).toLocaleString(undefined)} W`;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The nav's alerts bell — RM-152.
 *
 * TWO LISTS, NOT ONE. "Needs attention" is what is wrong now, and only it is counted on the badge.
 * "Earlier this week" is what a device reported and has stopped reporting, one row per device and
 * kind, with its older episodes one click away. Before this, every episode of the week sat in one
 * list, counted as outstanding, keyed by a start time that the week's sliding edge kept moving, so a
 * warning that ended a week ago came back every five minutes with a new "for X min".
 *
 * "MARK AS SEEN" AND "DISMISS", NOT "ACK". Seen hides a current alert until it changes (a new episode,
 * or for a live alert, twelve hours on). Dismiss hides a past one until there is a newer one. Both are
 * remembered by this browser (`src/lib/alertSeen.ts`), where Ack was forgotten on every reload, and
 * both can be undone for a few seconds, said in a line at the top rather than a toast, which this app
 * does not use.
 */
export function AlertsPopover() {
  const devices = useDeviceStore((s) => s.devices);
  const latestReadings = useDeviceStore((s) => s.latestReadings);
  const anomalyRows = useAnomaliesStore((s) => s.rows);
  const troubleEpisodes = useCapabilityTroubleStore((s) => s.episodes);
  const { rows: connectivity } = useDeviceConnectivity(24);
  const cloudRecoveries = useCommandStore((s) => s.cloudRecoveries);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<SeenMap>(() => readSeen());
  const [lastAction, setLastAction] = useState<{ key: string; before: SeenMap[string] | undefined; label: string; title: string } | null>(null);
  const dismiss = useCallback(() => setOpen(false), []);
  // Portaled and viewport-clamped, like every other popover in the app. `align: 'end'` keeps it
  // opening inward from the nav. Taller than it was, but never past 80% of the screen.
  const maxHeight = typeof window === 'undefined' ? 560 : Math.min(560, Math.round(window.innerHeight * 0.8));
  const { anchorRef, popRef, style } = useAnchoredPopover({ open, onDismiss: dismiss, preferredWidth: 340, align: 'end', fallbackHeight: maxHeight, preferredMaxHeight: maxHeight });

  // Re-render once a second so a device crossing its staleness budget appears without waiting for
  // its next store write, and an incident moves from current to past on time.
  const now = useNowTick();

  useEffect(() => {
    if (!lastAction) return;
    const timer = setTimeout(() => setLastAction(null), 6000);
    return () => clearTimeout(timer);
  }, [lastAction]);

  const deviceOf = useCallback((id: string) => devices.find((d) => d.id === id), [devices]);
  const nameOf = useCallback((id: string) => deviceOf(id)?.display_name ?? id, [deviceOf]);

  const staleItems: AlertItem[] = useMemo(
    () =>
      devices
        .filter((d) => isReadingStale(latestReadings[d.id]))
        .map((d) => ({
          id: d.id,
          stamp: 'live',
          ttlMs: LIVE_SEEN_MS,
          severity: 'warning' as const,
          title: `${d.display_name}: not reporting`,
          body: `No reading in the last ${staleWindowLabel(latestReadings[d.id])}.`,
          source: 'Watchdog',
          circuit: d.description ?? null,
          deviceId: d.id,
        })),
    [devices, latestReadings],
  );

  // A stale device has no fresh value to judge, so its anomaly row is left out.
  const anomalyItems: AlertItem[] = useMemo(() => {
    const staleIds = new Set(staleItems.map((i) => i.id));
    const latest = latestAnomalyPerDevice(anomalyRows);
    const items: AlertItem[] = [];
    for (const row of Object.values(latest)) {
      if (staleIds.has(row.device_id) || !isAnomalyCurrent(row)) continue;
      const device = deviceOf(row.device_id);
      items.push({
        id: `anomaly:${row.device_id}`,
        stamp: 'live',
        ttlMs: LIVE_SEEN_MS,
        severity: 'warning',
        title: `${device?.display_name ?? row.device_id}: unusual power`,
        body: `${watts(row.value)} against its usual ~${watts(row.baseline_mean)} recently.`,
        source: 'This system’s check',
        circuit: device?.description ?? null,
        deviceId: row.device_id,
        detail: `z = ${row.z_score.toFixed(1)}`,
      });
    }
    return items;
  }, [anomalyRows, deviceOf, staleItems]);

  /**
   * One fleet-level row rather than N per-device ones, and it carries the REMEDY. On 2026-08-25 a
   * Node-RED restart recovered five devices that a written diagnosis had called a hardware fault.
   * `fleetStuck` excludes devices never seen online in the window, so the two permanently quiesced
   * ones cannot hold this on forever.
   */
  const fleetItems: AlertItem[] = useMemo(() => {
    const result = fleetStuck(connectivity);
    if (!isFleetStuck(result)) return [];
    return [
      {
        id: '__fleet__',
        stamp: 'live',
        ttlMs: LIVE_SEEN_MS,
        severity: 'critical',
        title: `${result.stuck.length} devices dropped together`,
        body:
          'Each was reporting earlier today. Devices often stop answering because the bridge nodes gave up rather than because the hardware failed — restarting Node-RED on the Pi has recovered exactly this before. If they stay dark afterwards, they need power cycling.',
        source: 'Fleet watch',
        detail: result.stuck.map((id) => nameOf(id)).join(', '),
      },
    ];
  }, [connectivity, nameOf]);

  /**
   * A command that only landed through the vendor cloud. It SUCCEEDED while meaning the device has
   * stopped answering on the LAN: the earliest warning this system has that a device is going bad.
   */
  const cloudItems: AlertItem[] = useMemo(
    () =>
      Object.keys(cloudRecoveries).map((deviceId) => {
        const device = deviceOf(deviceId);
        return {
          id: `cloud:${deviceId}`,
          stamp: 'live',
          ttlMs: LIVE_SEEN_MS,
          severity: 'warning' as const,
          title: `${device?.display_name ?? deviceId}: answered only through the vendor cloud`,
          body: 'The command worked, but the device did not respond on the local network — it was reached over the internet instead. That is how a device looks shortly before it stops responding altogether.',
          source: 'Command path',
          circuit: device?.description ?? null,
          deviceId,
        };
      }),
    [cloudRecoveries, deviceOf],
  );

  /**
   * What a device SAID about itself (phase28's stored columns), as incidents: one per device and kind,
   * current or past. Different in kind from the rows above, which are this system's inferences; the
   * source label says so in three words.
   */
  const incidents = useMemo(() => toIncidents(troubleEpisodes, now), [troubleEpisodes, now]);
  const incidentItems = useMemo(
    () =>
      incidents.map((incident) => {
        const d = describeIncident(incident, nameOf(incident.device_id), now);
        const item: AlertItem & { active: boolean } = {
          id: incident.key,
          // A current incident is seen per episode (its start); a past one is dismissed up to its end.
          stamp: incident.active ? incident.latest.from : incident.latest.to,
          severity: d.severity,
          title: d.title,
          body: d.body,
          source: d.source,
          circuit: deviceOf(incident.device_id)?.description ?? null,
          deviceId: incident.device_id,
          history: incident.history,
          active: incident.active,
        };
        return item;
      }),
    [incidents, nameOf, deviceOf, now],
  );

  const attention = useMemo(
    () =>
      [...fleetItems, ...cloudItems, ...staleItems, ...anomalyItems, ...incidentItems.filter((i) => i.active)]
        .filter((item) => !isSeen(seen, item.id, item.stamp, now, item.ttlMs))
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [fleetItems, cloudItems, staleItems, anomalyItems, incidentItems, seen, now],
  );
  const earlier = useMemo(
    () => incidentItems.filter((i) => !i.active && !isSeen(seen, `ended:${i.id}`, i.stamp, now)),
    [incidentItems, seen, now],
  );

  const mark = (key: string, stamp: string, label: string, title: string) => {
    setLastAction({ key, before: seen[key], label, title });
    const next = { ...seen, [key]: { stamp, at: now } };
    setSeen(next);
    writeSeen(next);
  };
  const undo = () => {
    if (!lastAction) return;
    const next = { ...seen };
    if (lastAction.before) next[lastAction.key] = lastAction.before;
    else delete next[lastAction.key];
    setSeen(next);
    writeSeen(next);
    setLastAction(null);
  };

  const row = (item: AlertItem, past: boolean) => {
    const more = (item.history?.length ?? 0) > 0 || item.detail || item.deviceId;
    return (
      <li className={`alerts-popover__row alerts-popover__row--${item.severity}`} key={item.id}>
        <div className="alerts-popover__main">
          <SeverityChip severity={item.severity} />
          <p className="alerts-popover__title">{item.title}</p>
          {item.circuit ? <p className="alerts-popover__circuit">{item.circuit}</p> : null}
          <p className="alerts-popover__body">{item.body}</p>
          <p className="alerts-popover__meta">
            {item.source}
            {item.deviceId ? (
              <>
                {' · '}
                <a className="alerts-popover__link" href={`#devices/${item.deviceId}`} onClick={() => setOpen(false)}>
                  Open device
                </a>
              </>
            ) : null}
          </p>
          {more ? (
            <details className="alerts-popover__more">
              <summary>{item.history?.length ? `${item.history.length} earlier this week` : 'Details'}</summary>
              {item.history?.length ? (
                <ul className="alerts-popover__history">
                  {item.history.map((e) => (
                    <li key={e.from}>
                      {capitalise(episodeWhen(e, false, now))}
                      {e.peakW ? `, peak ${watts(e.peakW)}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              {item.detail ? <p className="alerts-popover__detail">{item.detail}</p> : null}
              {item.deviceId ? <p className="alerts-popover__detail">Device id: {item.deviceId}</p> : null}
            </details>
          ) : null}
        </div>
        <button
          type="button"
          className="alerts-popover__ack"
          onClick={() =>
            past
              ? mark(`ended:${item.id}`, item.stamp, 'Dismissed', item.title)
              : mark(item.id, item.stamp, 'Marked as seen', item.title)
          }
        >
          {past ? 'Dismiss' : 'Mark as seen'}
        </button>
      </li>
    );
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={anchorRef as React.RefObject<HTMLButtonElement>}
        type="button"
        className="nav-icon-btn"
        aria-label={`Alerts${attention.length ? `, ${attention.length} need${attention.length === 1 ? 's' : ''} attention` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={16} aria-hidden="true" />
        {attention.length > 0 && (
          <span className="nav-icon-btn__badge" aria-hidden="true">
            {attention.length > 9 ? '9+' : attention.length}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div ref={popRef as React.RefObject<HTMLDivElement>} className="alerts-popover" role="dialog" aria-label="Alerts" style={style}>
            <div className="alerts-popover__head">
              <span>Alerts</span>
              <button type="button" className="alerts-popover__close" onClick={() => setOpen(false)} aria-label="Close">
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            {lastAction ? (
              <p className="alerts-popover__done" role="status">
                <Check size={12} aria-hidden="true" /> {lastAction.label}: {lastAction.title}.{' '}
                <button type="button" className="alerts-popover__undo" onClick={undo}>
                  Undo
                </button>
              </p>
            ) : null}
            {attention.length === 0 ? (
              <p className="alerts-popover__empty">Nothing needs attention right now.</p>
            ) : (
              <section aria-label="Needs attention">
                <h3 className="alerts-popover__section">Needs attention</h3>
                <ul className="alerts-popover__list">{attention.map((item) => row(item, false))}</ul>
              </section>
            )}
            {earlier.length > 0 ? (
              <section aria-label="Earlier this week">
                <h3 className="alerts-popover__section">Earlier this week</h3>
                <ul className="alerts-popover__list">{earlier.map((item) => row(item, true))}</ul>
              </section>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
}
