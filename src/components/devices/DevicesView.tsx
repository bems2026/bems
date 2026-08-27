import { memo, useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useDeviceStore } from '@/stores/deviceStore';
import { useShallow } from 'zustand/react/shallow';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { hasSwitchableState } from '@/lib/deviceClass';
import { isReadingStale, measured } from '@/lib/staleness';
import { countOnline } from '@/components/overview/overviewMath';
import { Skeleton } from '@/components/ui/Skeleton';
import { InfoHint } from '@/components/ui/InfoHint';
import { CLASS_ICON } from '@/lib/deviceIcons';
import { DEVICE_CLASS_CATALOG, DEVICE_CLASS_ORDER } from '@/lib/deviceClassCatalog';
import { useDeviceConnectivity } from '@/hooks/useDeviceConnectivity';
import { flapSeverity, type ConnectivityRow } from '@/lib/deviceConnectivity';
import { metaSummary, type DeviceConfig } from '@/lib/deviceConfig';
import { DeviceMetaEditor } from './DeviceMetaEditor';
import { EnrollWizard } from './EnrollWizard';
import { RemoveDevicePanel } from './RemoveDevicePanel';
import { SpaceTreePanel } from './SpaceTreePanel';
import { SpacePlanPanel } from '@/components/spatial/SpacePlanPanel';
import { SegmentPresenceNote } from './SegmentPresenceNote';
import { ENROLLED_DEVICES } from '@shared/registry.enrolled.mjs';
import type { Device, DeviceClass, Reading } from '@/lib/types';
import { formatVolts, formatAmps, formatWithUnit } from '@/lib/format';

const CLASS_ORDER: DeviceClass[] = DEVICE_CLASS_ORDER;

const CLASS_FILTER_LABEL = (cls: DeviceClass) => DEVICE_CLASS_CATALOG[cls].label;

const CLASS_PILL_LABEL = (cls: DeviceClass) => DEVICE_CLASS_CATALOG[cls].pill;

type CommState = 'no-data' | 'offline' | 'stale' | 'live';

function commState(reading: Reading | undefined): CommState {
  if (!reading) return 'no-data';
  if (reading.online === false) return 'offline';
  if (isReadingStale(reading)) return 'stale';
  return 'live';
}

const COMM_LABEL: Record<CommState, string> = { 'no-data': 'NO DATA', offline: 'OFFLINE', stale: 'STALE', live: 'LIVE' };
const COMM_CLASS: Record<CommState, string> = {
  'no-data': 'devices-table__comm--muted',
  offline: 'devices-table__comm--bad',
  stale: 'devices-table__comm--warn',
  live: 'devices-table__comm--good',
};

/**
 * The full fleet, one row per device, v4's flat CSS-grid table restyled to real data —
 * replacing Phase L's class-grouped card grid. `VOLT`/`CURRENT` are salvaged from v3 (v4
 * dropped them for no stated reason; they're the two numbers an electrician actually wants
 * beside a relay) alongside v4's own LAST SEEN/COMMUNICATION columns, which v3 didn't have.
 */
export function DevicesView() {
  const devices = useDeviceStore((s) => s.devices);
  // Two scalars, shallow-compared, instead of the whole latestReadings map. The map is
  // rebuilt on every WS frame (~2s) and every row carries a fresh `ts`, so selecting it
  // here re-rendered the entire view — filter chips, sort, prose and all ~18 rows — twice a
  // minute times thirty, forever, on a screen nobody is touching. The online count changes
  // only when a device actually appears or drops.
  const { online, total } = useDeviceStore(useShallow((s) => countOnline(s.devices, s.latestReadings)));
  const configs = useDeviceConfigStore((s) => s.saved);
  const { rows: connectivity } = useDeviceConnectivity(24);
  const unstable = Object.values(connectivity).filter((r) => flapSeverity(r) !== 'steady' && flapSeverity(r) !== 'unknown');
  const [filter, setFilter] = useState<DeviceClass | 'all'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingSpaces, setEditingSpaces] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const removingDevice = removingId ? (devices.find((d) => d.id === removingId) ?? null) : null;
  // Only enrolled devices can be removed. The built-in ones are hand-written in registry.mjs,
  // and no button is shown for them at all — a disabled control invites a click and then
  // explains itself, which is worse than an absent one for something irreversible-looking.
  const enrolledIds = useMemo(() => new Set((ENROLLED_DEVICES as { id: string }[]).map((d) => d.id)), []);
  const editingDevice = editingId ? (devices.find((d) => d.id === editingId) ?? null) : null;

  const filtered = useMemo(() => {
    const list = filter === 'all' ? devices : devices.filter((d) => d.class === filter);
    return [...list].sort((a, b) => CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [devices, filter]);


  if (devices.length === 0) {
    return (
      <div className="devices-table-card" aria-busy="true" aria-label="Loading device catalogue">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="devices-table-skeleton-row" key={i}>
            <Skeleton height="14px" width="60%" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Fleet Status"
        // The unstable count replaces a banner that said the same thing at four times the
        // length. Omitted entirely when nothing is flapping, so a healthy fleet reads as two
        // facts rather than three with a zero in it.
        sub={`${total} devices · ${online} online${unstable.length > 0 ? ` · ${unstable.length} unstable today` : ''}`}
        actions={
          <div className="devices-toolbar">
            <div className="devices-filter-group" role="group" aria-label="Filter by class">
              <button type="button" className={`devices-filter-chip${filter === 'all' ? ' devices-filter-chip--active' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                All
              </button>
              {CLASS_ORDER.map((cls) => (
                <button
                  key={cls}
                  type="button"
                  className={`devices-filter-chip${filter === cls ? ' devices-filter-chip--active' : ''}`}
                  aria-pressed={filter === cls}
                  onClick={() => setFilter(cls)}
                >
                  {CLASS_FILTER_LABEL(cls)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="devices-add-btn"
              onClick={() => setEditingSpaces(true)}
            >
              Spaces
            </button>
            <button
              type="button"
              className="devices-add-btn"
              onClick={() => setEditingPlan(true)}
            >
              Floor plan
            </button>
            <button
              type="button"
              className="devices-add-btn"
              onClick={() => setEnrolling(true)}
            >
              + Add device
            </button>
          </div>
        }
      />

      {editingDevice && <DeviceMetaEditor device={editingDevice} onClose={() => setEditingId(null)} />}
      {editingSpaces && <SpaceTreePanel onClose={() => setEditingSpaces(false)} />}
      {editingPlan && <SpacePlanPanel onClose={() => setEditingPlan(false)} />}
      {enrolling && <EnrollWizard onClose={() => setEnrolling(false)} />}
      {removingDevice && (
        <RemoveDevicePanel
          key={removingDevice.id}
          device={removingDevice}
          onClose={() => setRemovingId(null)}
          // Nothing to refetch here: the fleet list is polled from the bridge, which reads the
          // flow that was just written, so the row clears itself on the next poll. The panel
          // stays open on purpose so its "Removed." result and the redeploy note stay readable.
          onRemoved={() => {}}
        />
      )}

      <div className="devices-table-card">
        {/* A scroll container needs to be keyboard-scrollable, which means focusable — and a
            focusable region needs an accessible name. Same reasoning as the `role="table"`
            below: the CSS grid layout stays exactly as it is, the semantics catch up to it. */}
        <div className="devices-table-scroll" tabIndex={0} role="region" aria-label="Device table">
          {/*
            This is a CSS grid of <div>s, not a <table> — deliberately, because
            `.devices-table__row`'s `grid-template-columns` is what aligns the nine columns
            and real table layout would fight it. But without ARIA roles, assistive tech saw
            nine orphaned values per device with no idea which column any of them belonged
            to: "219.5V" with no "Volt" attached to it. These roles restore the row/column
            relationships at zero visual cost.

            The columnheader count here and DeviceRow's role="cell" count below must stay in
            sync with `.devices-table__row`'s grid-template-columns in index.css — a test
            (DevicesView.test.tsx) asserts the two match so this can't silently drift again.
          */}
          <div className="devices-table" role="table" aria-label="Device fleet" aria-rowcount={filtered.length + 1}>
            <div className="devices-table__row devices-table__row--head" role="row">
              <span role="columnheader">Device</span>
              <span role="columnheader">Class</span>
              <span role="columnheader">Volt</span>
              <span role="columnheader">Current</span>
              <span role="columnheader">Power</span>
              <span role="columnheader">Last seen</span>
              <span role="columnheader">Comm</span>
              <span role="columnheader">State</span>
              <span role="columnheader">Edit</span>
            </div>
            {filtered.map((d) => (
              <DeviceRow key={d.id} device={d} config={configs[d.id]} conn={connectivity[d.id]} onEdit={() => setEditingId(d.id)} onRemove={enrolledIds.has(d.id) ? () => setRemovingId(d.id) : undefined} />
            ))}
          </div>
        </div>
      </div>
      <SegmentPresenceNote />
      <p className="devices-watchdog-note">
        Stale after 30s idle
        <InfoHint label="Watchdog and metadata details">
          A device is flagged stale once its reading hasn't advanced in 30 seconds, or the bridge reports it offline outright — see <code>isReadingStale</code>. Room,
          category, load-shed group, and notes are recorded per device via each row's Edit button, not read from the live flow — the bridge itself still reports every
          device's <code>room</code> as unset.
        </InfoHint>
      </p>
    </>
  );
}

/**
 * `memo` plus a per-device selector: each row subscribes to its own reading, so the parent
 * no longer has to hold the whole map to hand rows their data, and a row re-renders for its
 * own device rather than for any device.
 */
const DeviceRow = memo(function DeviceRow({ device, config, conn, onEdit, onRemove }: { device: Device; config: DeviceConfig | undefined; conn: ConnectivityRow | undefined; onEdit: () => void; onRemove?: () => void }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const switchable = hasSwitchableState(device.class);
  const comm = commState(reading);
  const Icon = CLASS_ICON[device.class];
  const stateText = switchable ? (reading?.state ?? 'unknown') : device.class === 'meter' ? 'metering' : '—';
  const stateClass = switchable
    ? reading?.state === 'on'
      ? 'devices-table__state--good'
      : reading?.state === 'off'
        ? 'devices-table__state--neutral'
        : 'devices-table__state--warn'
    : 'devices-table__state--neutral';

  return (
    <div className="devices-table__row" role="row">
      <div className="devices-table__device" role="cell">
        <span className="devices-table__icon" aria-hidden="true">
          <Icon size={14} />
        </span>
        <div>
          <div className="devices-table__name">{device.display_name}</div>
          <div className="devices-table__id mono">{device.id}</div>
          {metaSummary(config) && <div className="devices-table__meta">{metaSummary(config)}</div>}
          {conn && <ConnectivityNote row={conn} />}
        </div>
      </div>
      <span className="devices-table__class-pill" role="cell">
        {CLASS_PILL_LABEL(device.class)}
      </span>
      <span className="devices-table__num mono" role="cell" data-label="Volt">
        {formatVolts(measured(reading?.voltage, reading))}
      </span>
      <span className="devices-table__num mono" role="cell" data-label="Current">
        {formatAmps(measured(reading?.current, reading))}
      </span>
      <span className="devices-table__num mono" role="cell" data-label="Power">
        {formatWithUnit(measured(reading?.power_w, reading), 'W', 0)}
      </span>
      <span className="devices-table__lastseen mono" role="cell" data-label="Last seen">
        {reading ? new Date(reading.ts).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
      </span>
      <span className={`devices-table__comm ${COMM_CLASS[comm]}`} role="cell">
        {COMM_LABEL[comm]}
      </span>
      <span className={`devices-table__state ${stateClass} mono`} role="cell" data-label="State">
        {stateText}
      </span>
      <span className="devices-table__edit-cell" role="cell">
        <button type="button" className="devices-table__edit-btn" onClick={onEdit}>
          Edit
        </button>
        {onRemove && (
          <button type="button" className="devices-table__remove-btn" onClick={onRemove}>
            Remove
          </button>
        )}
      </span>
    </div>
  );
});


/**
 * A device's 24h uptime and how many times it changed state, on the meta line rather than in a
 * new column — the table's nine columns and their phone layout were hard-won (EX-038), and this
 * is supporting detail, not a tenth measurement.
 *
 * Renders nothing at all for a steady device. A line that appears on every row is furniture;
 * one that appears only when something is wrong is a signal.
 */
function ConnectivityNote({ row }: { row: ConnectivityRow }) {
  const severity = flapSeverity(row);
  if (severity === 'steady' || severity === 'unknown') return null;
  const drops = Number(row.transitions);
  return (
    <div className={`devices-table__flap devices-table__flap--${severity}`}>
      {drops} drop{drops === 1 ? '' : 's'} today
    </div>
  );
}