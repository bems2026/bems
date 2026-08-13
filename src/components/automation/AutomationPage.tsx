import { useEffect, useMemo, useState } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import { hasSwitchableState } from '@/lib/deviceClass';
import { pendingWrites } from '@/stores/contextStore';
import { CalendarClock, Thermometer, ListTodo } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { InfoHint } from '@/components/ui/InfoHint';
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
  const lastSave = useContextStore((s) => s.lastSave);

  const [schedFilter, setSchedFilter] = useState<SchedFilter>('All');

  const schedulable = useMemo(() => devices.filter((d) => hasSwitchableState(d.class)).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [devices]);
  const filtered = schedFilter === 'All' ? schedulable : schedulable.filter((d) => d.class === FILTER_CLASS[schedFilter]);

  const armedCount = schedulable.filter((d) => (draft[`global.schedule.${d.id}.armed`] ?? saved[`global.schedule.${d.id}.armed`]) === 'true').length;

  const armAll = () => {
    for (const d of filtered) setDraft(`global.schedule.${d.id}.armed`, 'true');
  };

  const pending = pendingWrites(draft, saved);
  const pendingEntries = Object.entries(pending);
  const { ask, modalProps } = useConfirm();
  useUnsavedDraftGuard(pendingEntries.length);

  // Gated: this flushes every staged edit at once, including anything "Arm all" just
  // staged across every schedulable device — one click here can be a lot more than the
  // single field the user was last looking at.
  const askSave = () =>
    ask(
      {
        title: 'Write to Node-RED context?',
        body: `This writes ${pendingEntries.length} pending key${pendingEntries.length === 1 ? '' : 's'} to the mock's Node-RED global context store — schedules, trigger setpoints, and DSM thresholds the schedule subflow will act on.`,
        confirmLabel: 'Write context',
        tone: 'blue',
      },
      () => void save(),
    );

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
          <p className="page-sub">
            Node-RED context values
            <InfoHint label="How these values are used">The existing schedule subflow acts on them directly — no separate rule engine.</InfoHint>
          </p>
        </div>
        <div className="automation-write-group">
          <button type="button" className="automation-write-btn" disabled={pendingEntries.length === 0 || saveStatus === 'saving'} onClick={askSave}>
            {saveStatus === 'saving' ? 'Writing…' : 'Write to Node-RED context'}
          </button>
          {/* Confirmation that the write landed. `role="status"` (polite) rather than an
              alert: it's good news, so it should wait its turn rather than interrupt. */}
          <p className="automation-write-confirm" role="status">
            {saveStatus === 'idle' && lastSave
              ? `Wrote ${lastSave.count} key${lastSave.count === 1 ? '' : 's'} at ${new Date(lastSave.at).toLocaleTimeString('en-PH', { hour12: false })}`
              : ''}
          </p>
        </div>
      </header>
      {/* role="alert" so a failed write is announced. Without it a screen reader user got no
          signal at all — the button simply re-enabled and the pending list stayed put. */}
      {saveStatus === 'error' && (
        <p className="automation-save-error" role="alert">
          {saveError}
        </p>
      )}

      <div className="automation-grid">
        <div className="card automation-schedules-card">
          <div className="automation-schedules-head">
            <span className="card-title">
              <CalendarClock size={14} className="title-icon" aria-hidden="true" />
              Device Schedules
            </span>
            <span className="automation-armed-count mono">{armedCount} ARMED</span>
            <div className="automation-filter-group">
              {(['All', 'Lighting', 'Outlets', 'ACU'] as SchedFilter[]).map((f) => (
                <button key={f} type="button" className={`automation-filter-chip${schedFilter === f ? ' automation-filter-chip--active' : ''}`} aria-pressed={schedFilter === f} onClick={() => setSchedFilter(f)}>
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

          {/* Focusable so the horizontal scroll is reachable from the keyboard, named so that
              focus stop means something. Same treatment as Devices' table scroller. */}
          <div className="automation-sched-scroll" tabIndex={0} role="region" aria-label="Device schedules, scrolls horizontally">
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

          <h3 className="automation-section-title">
            <Thermometer size={14} className="title-icon" aria-hidden="true" />
            Ambient Trigger Setpoints
          </h3>
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
            <h3 className="card-title">
              <ListTodo size={14} className="title-icon" aria-hidden="true" />
              Pending writes
            </h3>
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
      <ConfirmModal {...modalProps} />
    </>
  );
}

/**
 * Staged edits live in `contextStore.draft` and reach Node-RED only via "Write to Node-RED
 * context". A reload or a closed tab drops all of them, and "Arm all" can stage a dozen keys
 * in a single click, so the amount silently lost is not small. `beforeunload` is the only
 * mechanism browsers offer for that exit; the prompt shown is the browser's own generic one,
 * as its text hasn't been author-controllable for years — hence no message here.
 *
 * Scoped to reload/close on purpose, and NOT extended to in-app navigation, for two reasons
 * found while testing this:
 *
 *  1. There is nothing to guard. `contextStore` is a module-level zustand store, not
 *     component state, so leaving Automation and coming back preserves every pending write
 *     intact — verified. A confirm() on nav would be a false alarm, and false alarms teach
 *     people to dismiss the real one.
 *  2. It could not have worked anyway. `hashchange` fires after the URL has already changed,
 *     and `App.tsx`'s own listener — registered first, since App mounts first — flushes the
 *     route change synchronously, unmounting this page and removing any listener it had
 *     added *before that listener is ever invoked*. Measured: the handler ran zero times on
 *     the real navigation path.
 */
function useUnsavedDraftGuard(pendingCount: number) {
  useEffect(() => {
    if (pendingCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [pendingCount]);
}
