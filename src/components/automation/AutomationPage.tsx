import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { useDevicesFor } from '@/hooks/useDevicesFor';
import { DEVICE_CLASS_CATALOG, classesWhere } from '@/lib/deviceClassCatalog';
import { pendingWrites } from '@/stores/contextStore';
import { CalendarClock, ListTodo } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useConfirm } from '@/components/ui/useConfirm';
import { InfoHint } from '@/components/ui/InfoHint';
import { ScheduleRow } from './ScheduleRow';
import { brokenScheduleCount } from './automationMath';
import { DsmThresholdsCard } from './DsmThresholdsCard';
import { LoadShedPanel } from '@/components/devices/LoadShedPanel';
import type { DeviceClass } from '@/lib/types';

/**
 * What saving actually causes, READ from the live gate rather than asserted.
 *
 * This page used to state, in two places, that "nothing on the real bridge reads or acts on
 * these yet; hardware dispatch is still gated closed". That was true when it was written and is
 * now false — `HARDWARE_DISPATCH_ENABLED` is `true` and `ibems-scheduler` logs `dispatch=OPEN`
 * at boot. The page that arms unattended load shedding was telling the operator it was inert,
 * which is the most expensive sentence in the app to get wrong.
 *
 * `null` is not "closed". It is an unanswered capability probe, and this says so rather than
 * guessing — the same distinction `dispatchScope` and `capabilitiesStore` already keep.
 */
function dispatchConsequence(open: boolean | null): string {
  if (open === true) return 'Saved rules switch real hardware here.';
  if (open === false) return 'Saved rules do not reach any hardware on this deployment.';
  return 'Whether saved rules reach hardware has not been confirmed yet.';
}

/**
 * The chips are derived from the catalog rather than hand-listed, so a new switchable class
 * gets a filter without anyone editing this page. The failure it replaces was silent: a
 * missing chip simply means those devices can never be filtered to.
 */
type SchedFilter = 'All' | DeviceClass;
const SCHED_FILTERS: SchedFilter[] = ['All', ...classesWhere('switchable')];
const filterLabel = (f: SchedFilter) => (f === 'All' ? 'All' : DEVICE_CLASS_CATALOG[f].label);

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
  const dispatchOpen = useCapabilitiesStore((s) => s.hardwareDispatchEnabled);
  const consequence = dispatchConsequence(dispatchOpen);

  // Membership is the device's declared `scheduling` function, not its class — so an outlet
  // that must never be switched unattended can be taken off this page without a code change.
  const { included: schedulableDevices, excluded: notSchedulable } = useDevicesFor('scheduling');
  const schedulable = useMemo(() => [...schedulableDevices].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [schedulableDevices]);
  const filtered = schedFilter === 'All' ? schedulable : schedulable.filter((d) => d.class === schedFilter);

  const armedCount = schedulable.filter((d) => (draft[`global.schedule.${d.id}.armed`] ?? saved[`global.schedule.${d.id}.armed`]) === 'true').length;
  // Counted over the EFFECTIVE context — draft on top of saved — so the summary reflects what is
  // on screen, not what was last written. Same `{...saved, ...draft}` reading `DsmThresholdsCard`
  // uses for its own live status.
  const brokenCount = brokenScheduleCount(schedulable, { ...saved, ...draft });

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
        title: 'Save these changes?',
        body: `This saves ${pendingEntries.length} change${pendingEntries.length === 1 ? '' : 's'} — schedules, the demand limits — and records them against your account. ${consequence}`,
        confirmLabel: 'Save',
        tone: 'blue',
      },
      () => void save(),
    );


  // Skeletons rather than a sentence, matching what Devices already does one tab away. This is
  // the genuine pre-catalogue state (`devices.length === 0`) that `Skeleton.tsx` reserves itself
  // for — not a device that HAS loaded and has no reading yet, which stays a real "—".
  if (devices.length === 0) {
    return (
      <div className="automation-page" aria-busy="true" aria-label="Loading automation">
        {Array.from({ length: 5 }, (_, i) => (
          <div className="automation-sched-skeleton-row" key={i}>
            <Skeleton height="14px" width="55%" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="DSM & Schedule Management"
        sub={
          <>
            Changes are staged until you save —{' '}
            {/* ON THE PAGE, not behind the ⓘ. "Saved rules switch real hardware here" is the most
                consequential sentence on this screen; a hint you have to open is where you put a
                footnote, not where you put the warning. */}
            <strong className={`automation-dispatch-note automation-dispatch-note--${dispatchOpen === true ? 'open' : dispatchOpen === false ? 'closed' : 'unknown'}`}>
              {consequence}
            </strong>
            <InfoHint label="What saving does">
              Your edits stay on this page until you press <strong>Save changes</strong>. Saving records them
              against your account for the audit trail, and the scheduler picks the new rules up within a
              minute.
            </InfoHint>
          </>
        }
        actions={
          <div className="automation-write-group">
            {/* Confirmation that the write landed, to the LEFT of the button — was stacked
                below it, which is what inflated this block to 53.2px tall and made it the
                one page whose actions row didn't line up with the other four (see
                index.css's `.page-header` comment). `role="status"` (polite) rather than an
                alert: it's good news, so it should wait its turn rather than interrupt. */}
            <p className="automation-write-confirm" role="status">
              {saveStatus === 'idle' && lastSave
                // THE READER'S OWN CLOCK, deliberately. This is when THEY pressed save, not
                // something that happened in the building — see `src/lib/siteTime.ts` for the
                // distinction and why the building's facts do not use this frame.
                ? `Saved ${lastSave.count} change${lastSave.count === 1 ? '' : 's'} at ${new Date(lastSave.at).toLocaleTimeString(undefined, { hour12: false })}`
                : ''}
            </p>
            <button type="button" className="automation-write-btn" disabled={pendingEntries.length === 0 || saveStatus === 'saving'} onClick={askSave}>
              {saveStatus === 'saving' ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        }
      />
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
              {SCHED_FILTERS.map((f) => (
                <button key={f} type="button" className={`automation-filter-chip${schedFilter === f ? ' automation-filter-chip--active' : ''}`} aria-pressed={schedFilter === f} onClick={() => setSchedFilter(f)}>
                  {filterLabel(f)}
                </button>
              ))}
            </div>
            <button type="button" className="automation-arm-all-btn" onClick={armAll}>
              Arm all
            </button>
          </div>
          {/*
            ONE live region for the whole card, and the reason is `Arm all` directly above it: that
            button stages `armed = true` across every filtered device in a single click, so a dozen
            rows can start warning at once. Each row announcing itself was a dozen simultaneous
            polite announcements; this says the fact once and the rows keep their own notes as the
            arm switch's description. Omitted entirely at zero — a counter that is almost always
            zero trains people to stop reading the line (the same rule as the unstable-device count
            on Devices).
          */}
          {brokenCount > 0 && (
            <p className="automation-schedules-broken" role="status">
              {brokenCount} schedule{brokenCount === 1 ? '' : 's'} cannot run as configured — see the
              note on {brokenCount === 1 ? 'that row' : 'those rows'}.
            </p>
          )}
          <p className="automation-schedules-sub">
            {schedulable.length} device{schedulable.length === 1 ? '' : 's'} declared for scheduling.
            {notSchedulable.length > 0 && (
              <>
                {' '}
                <InfoHint label={`Why ${notSchedulable.length} devices are not listed`}>
                  {notSchedulable.map((d) => d.display_name).join(', ')} — these have no{' '}
                  <strong>scheduling</strong> function set. That is configuration, not an omission: change it on the
                  Devices page, under Edit.
                </InfoHint>
              </>
            )}
          </p>

          {/* Focusable so the horizontal scroll is reachable from the keyboard, named so that
              focus stop means something. Same treatment as Devices' table scroller. */}
          <div className="automation-sched-scroll" tabIndex={0} role="region" aria-label="Device schedules, scrolls horizontally">
            <div className="automation-sched-table">
              <div className="automation-sched-row automation-sched-row--head">
                {/* Read across, a row is a rule: this device, on at, off at, on these days,
                    armed or not. The captions say that; they used to be five bare nouns. Note
                    each clock now repeats its own ON/OFF caption inline — deliberately, because
                    this header row is `display: none` below 720px and the fields have to stay
                    self-describing when it goes. */}
                <span>DEVICE</span>
                <span>ON</span>
                <span>OFF</span>
                <span>ON THESE DAYS</span>
                <span className="automation-sched-row__arm-label">ARMED</span>
              </div>
              {filtered.map((d) => (
                <ScheduleRow key={d.id} device={d} />
              ))}
            </div>
          </div>

        </div>

        <div className="automation-side">
          <DsmThresholdsCard />

          {/* Moved here from the Devices toolbar. The tiers are what auto-shed acts on when a
              DSM threshold above is breached, so the rule and the thing it switches now sit on
              one page — they were two clicks and a page apart, on a page about a device list. */}
          <LoadShedPanel />

          <div className="card automation-pending-card">
            <h3 className="card-title">
              <ListTodo size={14} className="title-icon" aria-hidden="true" />
              Unsaved changes
            </h3>
            {pendingEntries.length === 0 ? (
              <p className="automation-pending-empty">Nothing changed since the last save</p>
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
