import { useEffect, useMemo } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore, pendingWrites } from '@/stores/contextStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { useDevicesFor } from '@/hooks/useDevicesFor';
import { dispatchScope } from '@/components/control/dispatchScope';
import { useHashSubRoute } from '@/lib/useHashRoute';
import { CalendarClock, ListTodo, LayoutDashboard, Gauge, Thermometer } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { InfoHint } from '@/components/ui/InfoHint';
import { Tabs, TabPanel, type TabDef } from '@/components/ui/Tabs';
import { DsmThresholdsCard } from './DsmThresholdsCard';
import { ComingSoonCard } from './ComingSoonCard';
import { TimeDrivenPanel } from './TimeDrivenPanel';
import { EventDrivenPanel } from './EventDrivenPanel';
import { AutomationOverview } from './AutomationOverview';
import { LoadShedPanel } from '@/components/devices/LoadShedPanel';

/**
 * The Automation page — organised by WHAT MAKES A RULE FIRE, which is the distinction an
 * operator actually reasons about and the one the building-automation trade already names:
 *
 *   Time-Driven    the clock            schedules
 *   State-Driven   a measured quantity  DSM thresholds and load shedding
 *   Event-Driven   a sensor reading     closed-loop aircon setpoint control
 *
 * Grouping by device, or by card type, was the alternative and it is worse: "why did the
 * lights go off?" is answered by the trigger, not by the thing that was switched.
 *
 * A strategy with no field devices installed gets a `ComingSoonCard` inside its own category
 * rather than being hidden or dumped in a separate graveyard tab — the category is what makes
 * the absence legible, and several of them are blocked on a purchase rather than on code.
 */

type TabId = 'overview' | 'time' | 'state' | 'events';
const TAB_IDS: TabId[] = ['overview', 'time', 'state', 'events'];

export function AutomationPage() {
  const devices = useDeviceStore((s) => s.devices);
  const saved = useContextStore((s) => s.saved);
  const draft = useContextStore((s) => s.draft);
  const save = useContextStore((s) => s.save);
  const saveStatus = useContextStore((s) => s.saveStatus);
  const saveError = useContextStore((s) => s.saveError);
  const lastSave = useContextStore((s) => s.lastSave);
  const dispatchClasses = useCapabilitiesStore((s) => s.dispatchClasses);

  const [tab, setTab] = useHashSubRoute('automation', TAB_IDS, 'overview');

  // Membership is the device's declared `scheduling` function, not its class — so an outlet
  // that must never be switched unattended can be taken off this page without a code change.
  const { included: schedulableDevices, excluded: notSchedulable } = useDevicesFor('scheduling');
  const schedulable = useMemo(() => [...schedulableDevices].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [schedulableDevices]);

  // Counted from the schedules themselves rather than from a per-device flag: since RM-059 a
  // device can hold five rules with three of them armed, and "how many devices have something
  // armed" stopped being the number anyone wants.
  const schedules = useScheduleStore((s) => s.schedules);
  const armedCount = schedules.filter((r) => r.enabled).length;

  const pending = pendingWrites(draft, saved);
  const pendingEntries = Object.entries(pending);
  const { ask, modalProps } = useConfirm();
  useUnsavedDraftGuard(pendingEntries.length);

  /**
   * What this page actually reaches, read from the deployment rather than asserted.
   *
   * Until RM-059 the header read "Staged, not yet dispatchable" and the save dialog said
   * "nothing on the real bridge reads these yet". Both had been false since EX-047:
   * `server/scheduler.mjs` fires these rows through the audited command path, and ROADMAP's
   * own triage tells the operator to arm real hardware shedding *from this page*. A control
   * surface that understates its reach is a safety defect, not a copy nit — it invites
   * somebody to experiment on a live building.
   *
   * `dispatchScope` is reused rather than re-derived so this page and the Control page cannot
   * disagree about whether the gate is open; `null` (not yet loaded) counts as closed there,
   * which is the right way round for a claim about hardware.
   */
  const scope = dispatchScope(schedulable, dispatchClasses);
  const dispatching = scope.state !== 'closed';

  // Gated: this flushes every staged edit at once, including anything "Arm all" just staged
  // across every schedulable device — one click here can be a lot more than the single field
  // the user was last looking at.
  const askSave = () =>
    ask(
      {
        title: 'Write to Supabase?',
        body: dispatching
          ? `This writes ${pendingEntries.length} pending key${pendingEntries.length === 1 ? '' : 's'} to Supabase. Armed rules are read by the scheduler daemon and DO switch real hardware, through the gated, audited command path.`
          : `This writes ${pendingEntries.length} pending key${pendingEntries.length === 1 ? '' : 's'} to Supabase. Hardware dispatch is closed on this deployment, so the scheduler records each firing as a dry run rather than switching anything.`,
        confirmLabel: 'Write',
        tone: dispatching ? 'red' : 'blue',
      },
      () => void save(),
    );

  if (devices.length === 0) {
    return (
      <div className="automation-page" aria-busy="true" aria-label="Loading automation">
        <p className="section-placeholder">Waiting for the device catalogue…</p>
      </div>
    );
  }

  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'time', label: 'Time-Driven', icon: CalendarClock, badge: armedCount > 0 ? armedCount : undefined },
    { id: 'state', label: 'State-Driven', icon: Gauge },
    { id: 'events', label: 'Event-Driven', icon: Thermometer },
  ];

  return (
    <>
      <PageHeader
        title="Automation"
        sub={
          <>
            {dispatching ? 'Armed rules switch real hardware' : 'Armed rules run as dry runs — dispatch is closed'}
            <InfoHint label="What this means">
              {dispatching
                ? 'Rules saved here are read by the scheduler daemon on the Pi and dispatched through the same gated, audited path the Control page uses. Every firing writes a row to the command audit trail, whether it succeeded or not.'
                : 'Rules saved here are read by the scheduler daemon and evaluated on schedule, but this deployment’s hardware-dispatch gate is closed — so each firing is recorded as a dry run in the command audit trail and no relay moves.'}
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
                ? // THE READER'S OWN CLOCK, deliberately. This is when THEY pressed save, not
                  // something that happened in the building — see `src/lib/siteTime.ts` for the
                  // distinction and why the building's facts do not use this frame.
                  `Wrote ${lastSave.count} key${lastSave.count === 1 ? '' : 's'} at ${new Date(lastSave.at).toLocaleTimeString(undefined, { hour12: false })}`
                : ''}
            </p>
            <button type="button" className="automation-write-btn" disabled={pendingEntries.length === 0 || saveStatus === 'saving'} onClick={askSave}>
              {saveStatus === 'saving' ? 'Writing…' : 'Write to Supabase'}
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

      <Tabs tabs={tabs} activeId={tab} onChange={setTab} label="Automation strategies" className="automation-tabs" />

      <TabPanel tabId="overview" activeId={tab}>
        <AutomationOverview devices={schedulable} schedules={schedules} armedCount={armedCount} dispatching={dispatching} onGoToTab={setTab} />
      </TabPanel>

      <TabPanel tabId="time" activeId={tab}>
        <TimeDrivenPanel devices={schedulable} notSchedulable={notSchedulable} />
      </TabPanel>

      <TabPanel tabId="state" activeId={tab}>
        <div className="automation-grid">
          <div className="automation-side">
            <DsmThresholdsCard />
            {/* Moved here from the Devices toolbar. The tiers are what auto-shed acts on when a
                DSM threshold above is breached, so the rule and the thing it switches now sit on
                one page — they were two clicks and a page apart, on a page about a device list. */}
            <LoadShedPanel />
          </div>
          <div className="automation-side">
            <ComingSoonCard
              title="Solar-surplus load scheduling"
              what="Move deferrable load into the hours the array is actually exporting, instead of into the hours somebody guessed."
              blockedOn="the Deye/Solarman logger, which is not on the device network — a census of the segment found no non-Tuya host but the router."
              roadmapId="RM-026"
            />
            <ComingSoonCard
              title="Duty cycling"
              what="Rotate a group of loads on and off in turn to hold a demand ceiling without ever fully dropping any one of them."
              blockedOn="per-socket runtime history, which starts accumulating once per-socket scheduling lands."
              roadmapId="RM-059"
            />
          </div>
        </div>
      </TabPanel>

      <TabPanel tabId="events" activeId={tab}>
        <EventDrivenPanel devices={devices} />
      </TabPanel>

      {/* Page-scoped, not tab-scoped: a staged edit made on one tab is still unwritten while
          you are reading another, and hiding it there is how it gets lost. */}
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
      <ConfirmModal {...modalProps} />
    </>
  );
}

/**
 * Staged edits live in `contextStore.draft` and reach Supabase only via "Write to Supabase".
 * A reload or a closed tab drops all of them, and "Arm all" can stage a dozen keys in a single
 * click, so the amount silently lost is not small. `beforeunload` is the only mechanism
 * browsers offer for that exit; the prompt shown is the browser's own generic one, as its text
 * hasn't been author-controllable for years — hence no message here.
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
 *
 * Switching TABS is not navigation and does not unmount the page, so the guard is unaffected
 * by them — which is also why the tab writes the hash with `replaceState` rather than
 * assigning it (see `useHashSubRoute`).
 */
function useUnsavedDraftGuard(pendingCount: number) {
  useEffect(() => {
    if (pendingCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [pendingCount]);
}
