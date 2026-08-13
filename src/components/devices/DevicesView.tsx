import { useMemo, useState } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { hasSwitchableState } from '@/lib/deviceClass';
import { isReadingStale } from '@/lib/staleness';
import { countOnline } from '@/components/overview/overviewMath';
import { Skeleton } from '@/components/ui/Skeleton';
import { InfoHint } from '@/components/ui/InfoHint';
import { CLASS_ICON } from '@/lib/deviceIcons';
import type { Device, DeviceClass, Reading } from '@/lib/types';

const CLASS_ORDER: DeviceClass[] = ['outlet_dual', 'switch', 'meter', 'acu_ir', 'sensor_temp_humidity'];

const CLASS_FILTER_LABEL: Record<DeviceClass, string> = {
  outlet_dual: 'Outlets',
  switch: 'Lighting Switches',
  meter: 'Branch Meters',
  acu_ir: 'Air Conditioning',
  sensor_temp_humidity: 'Sensors',
};

const CLASS_PILL_LABEL: Record<DeviceClass, string> = {
  outlet_dual: 'outlet',
  switch: 'switch',
  meter: 'meter',
  acu_ir: 'aircon',
  sensor_temp_humidity: 'sensor',
};

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
  const readings = useDeviceStore((s) => s.latestReadings);
  const [filter, setFilter] = useState<DeviceClass | 'all'>('all');

  const filtered = useMemo(() => {
    const list = filter === 'all' ? devices : devices.filter((d) => d.class === filter);
    return [...list].sort((a, b) => CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [devices, filter]);

  const { online, total } = countOnline(devices, readings);

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
      <header className="page-header">
        <div>
          <h1 className="page-title">Fleet Status</h1>
          <p className="page-sub">{`${total} devices in the registry · ${online}/${total} reporting online right now`}</p>
        </div>
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
                {CLASS_FILTER_LABEL[cls]}
              </button>
            ))}
          </div>
          <button type="button" disabled title="Belongs to the onboarding wizard — not built in this version" className="devices-add-btn">
            + Add device (coming soon)
          </button>
        </div>
      </header>

      <div className="devices-table-card">
        {/* A scroll container needs to be keyboard-scrollable, which means focusable — and a
            focusable region needs an accessible name. Same reasoning as the `role="table"`
            below: the CSS grid layout stays exactly as it is, the semantics catch up to it. */}
        <div className="devices-table-scroll" tabIndex={0} role="region" aria-label="Device table, scrolls horizontally">
          {/*
            This is a CSS grid of <div>s, not a <table> — deliberately, because
            `.devices-table__row`'s `grid-template-columns` is what aligns the eight columns
            and real table layout would fight it. But without ARIA roles, assistive tech saw
            eight orphaned values per device with no idea which column any of them belonged
            to: "219.5V" with no "Volt" attached to it. These roles restore the row/column
            relationships at zero visual cost.
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
            </div>
            {filtered.map((d) => (
              <DeviceRow key={d.id} device={d} reading={readings[d.id]} />
            ))}
          </div>
        </div>
      </div>
      <p className="devices-watchdog-note">
        Stale after 30s idle
        <InfoHint label="Watchdog and room-assignment details">
          A device is flagged stale once its reading hasn't advanced in 30 seconds, or the bridge reports it offline outright — see <code>isReadingStale</code>. Room
          assignment is unrecorded in the live flow for every device here, not a missing field for this table alone.
        </InfoHint>
      </p>
    </>
  );
}

function DeviceRow({ device, reading }: { device: Device; reading: Reading | undefined }) {
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
        </div>
      </div>
      <span className="devices-table__class-pill" role="cell">
        {CLASS_PILL_LABEL[device.class]}
      </span>
      <span className="devices-table__num mono" role="cell">
        {typeof reading?.voltage === 'number' ? `${reading.voltage.toFixed(1)}V` : '—'}
      </span>
      <span className="devices-table__num mono" role="cell">
        {typeof reading?.current === 'number' ? `${reading.current.toFixed(2)}A` : '—'}
      </span>
      <span className="devices-table__num mono" role="cell">
        {typeof reading?.power_w === 'number' ? `${reading.power_w.toFixed(0)}W` : '—'}
      </span>
      <span className="devices-table__lastseen mono" role="cell">
        {reading ? new Date(reading.ts).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
      </span>
      <span className={`devices-table__comm ${COMM_CLASS[comm]}`} role="cell">
        {COMM_LABEL[comm]}
      </span>
      <span className={`devices-table__state ${stateClass} mono`} role="cell">
        {stateText}
      </span>
    </div>
  );
}
