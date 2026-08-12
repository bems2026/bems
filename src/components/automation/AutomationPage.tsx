import { useMemo, useState } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import { hasSwitchableState } from '@/lib/deviceClass';
import { pendingWrites } from '@/stores/contextStore';
import { ScheduleRow } from './ScheduleRow';
import { DsmThresholdsCard } from './DsmThresholdsCard';
import type { DeviceClass } from '@/lib/types';

const TRIGGER_KEY = 'global.trigger.care_acu_on';

type SchedFilter = 'All' | 'Lighting' | 'Outlets' | 'ACU';
const FILTER_CLASS: Record<Exclude<SchedFilter, 'All'>, DeviceClass> = { Lighting: 'switch', Outlets: 'outlet_dual', ACU: 'acu_ir' };

export function AutomationPage() {
  const devices = useDeviceStore((s) => s.devices);
  const saved = useContextStore((s) => s.saved);
  const draft = useContextStore((s) => s.draft);
  const setDraft = useContextStore((s) => s.setDraft);
  const save = useContextStore((s) => s.save);
  const saveStatus = useContextStore((s) => s.saveStatus);
  const saveError = useContextStore((s) => s.saveError);

  const [schedFilter, setSchedFilter] = useState<SchedFilter>('All');

  const schedulable = useMemo(() => devices.filter((d) => hasSwitchableState(d.class)).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [devices]);
  const filtered = schedFilter === 'All' ? schedulable : schedulable.filter((d) => d.class === FILTER_CLASS[schedFilter]);

  const armedCount = schedulable.filter((d) => (draft[`global.schedule.${d.id}.armed`] ?? saved[`global.schedule.${d.id}.armed`]) === 'true').length;

  const armAll = () => {
    for (const d of filtered) setDraft(`global.schedule.${d.id}.armed`, 'true');
  };

  const pending = pendingWrites(draft, saved);
  const pendingEntries = Object.entries(pending);

  const triggerValue = Number(draft[TRIGGER_KEY] ?? saved[TRIGGER_KEY] ?? 24);

  if (devices.length === 0) {
    return (
      <div className="automation-page" aria-busy="true" aria-label="Loading automation">
        <p className="section-placeholder">Waiting for the device catalogue…</p>
      </div>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">DSM &amp; Schedule Management</h1>
          <p className="page-sub">Values write to Node-RED global context. The existing schedule subflow acts on them — no separate rule engine.</p>
        </div>
        <button type="button" className="automation-write-btn" disabled={pendingEntries.length === 0 || saveStatus === 'saving'} onClick={() => void save()}>
          {saveStatus === 'saving' ? 'Writing…' : 'Write to Node-RED context'}
        </button>
      </header>
      {saveStatus === 'error' && <p className="automation-save-error">{saveError}</p>}

      <div className="automation-grid">
        <div className="card automation-schedules-card">
          <div className="automation-schedules-head">
            <span className="card-title">Device Schedules</span>
            <span className="automation-armed-count mono">{armedCount} ARMED</span>
            <div className="automation-filter-group">
              {(['All', 'Lighting', 'Outlets', 'ACU'] as SchedFilter[]).map((f) => (
                <button key={f} type="button" className={`automation-filter-chip${schedFilter === f ? ' automation-filter-chip--active' : ''}`} onClick={() => setSchedFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
            <button type="button" className="automation-arm-all-btn" onClick={armAll}>
              Arm all
            </button>
          </div>
          <p className="automation-schedules-sub">
            Every relay and the IR unit. Writes <code className="mono">global.schedule.&lt;device&gt;</code>.
          </p>

          <div className="automation-sched-scroll">
            <div className="automation-sched-table">
              <div className="automation-sched-row automation-sched-row--head">
                <span>DEVICE</span>
                <span>ON</span>
                <span>OFF</span>
                <span>DAYS</span>
                <span className="automation-sched-row__arm-label">ARM</span>
              </div>
              {filtered.map((d) => (
                <ScheduleRow key={d.id} device={d} />
              ))}
            </div>
          </div>

          <h3 className="automation-section-title">Ambient Trigger Setpoints</h3>
          <p className="automation-schedules-sub">IR blaster rules driven by the paired climate sensor.</p>
          <div className="automation-trigger-card">
            <div className="automation-trigger-card__head">
              <span>Transmit CARE ACU ON above</span>
              <span className="automation-trigger-card__value mono">{triggerValue}°C</span>
            </div>
            <input
              type="range"
              min={20}
              max={32}
              step={0.5}
              value={triggerValue}
              onChange={(e) => setDraft(TRIGGER_KEY, e.target.value)}
              className="automation-trigger-card__slider"
              aria-label="CARE ACU ambient trigger setpoint"
            />
            <div className="automation-trigger-card__scale">
              <span>20 °C</span>
              <span>{TRIGGER_KEY}</span>
              <span>32 °C</span>
            </div>
          </div>
        </div>

        <div className="automation-side">
          <DsmThresholdsCard />

          <div className="card automation-pending-card">
            <h3 className="card-title">Pending context writes</h3>
            {pendingEntries.length === 0 ? (
              <p className="automation-pending-empty">Nothing changed since the last write</p>
            ) : (
              <ul className="automation-pending-list">
                {pendingEntries.map(([key, value]) => (
                  <li className="automation-pending-row" key={key}>
                    <span className="automation-pending-row__key mono">{key}</span>
                    <span className="automation-pending-row__value mono">{value}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
