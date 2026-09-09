import { useEffect, useMemo } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore, pendingWrites } from '@/stores/contextStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { useDevicesFor } from '@/hooks/useDevicesFor';
import { useHashSubRoute } from '@/lib/useHashRoute';
import { CalendarClock, ListTodo, LayoutDashboard, Gauge, Thermometer } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Skeleton } from '@/components/ui/Skeleton';
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

/**
 * What saving actually causes, READ from the live gate rather than asserted — RM-062.
 *
 * `null` is not "closed". It is an unanswered capability probe, and this says so rather than
 * guessing — the same distinction `dispatchScope` and `capabilitiesStore` already keep.
 */
function dispatchConsequence(open: boolean | null): string {
  if (open === true) return 'Saved rules switch real hardware here.';
  if (open === false) return 'Saved rules do not reach any hardware on this deployment.';
  return 'Whether saved rules reach hardware has not been confirmed yet.';
}

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

  const [tab, setTab] = useHashSubRoute('automation', TAB_IDS, 'overview');

  // Membership is the device's declared `scheduling` function, not its class — so an outlet
  // that must never be switched unattended can be taken off this page without a code change.
  const { included: schedulableDevices, excluded: notSchedulable } = useDevicesFor('scheduling');
  const schedulable = useMemo(() => [...schedulableDevices].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [schedulableDevices]);

  // Counted from the schedules themselves rather than from a per-device flag: since RM-066 a
  // device can hold five rules with three of them armed, and "how many devices have something
  // armed" stopped being the number anyone wants.
  const schedules = useScheduleStore((s) => s.schedules);
  const armedCount = schedules.filter((r) => r.enabled).length;

  const pending = pendingWrites(draft, saved);
  const pendingEntries = Object.entries(pending);
  const { ask, modalProps } = useConfirm();
  useUnsavedDraftGuard(pendingEntries.length);

  /**
   * What saving actually causes, READ from the live gate rather than asserted — RM-062.
   *
   * The page used to state in two places that "nothing on the real bridge reads or acts on these
   * yet; hardware dispatch is still gated closed". That was true when written and false by the
   * time anyone read it: `HARDWARE_DISPATCH_ENABLED` is `true` on the Pi and `ibems-scheduler`
   * logs `dispatch=OPEN` at boot. The page that arms unattended load shedding was telling the
   * operator it was inert, which is the most expensive sentence in this app to get wrong.
   *
   * THREE STATES, NOT TWO. `null` is an unanswered capability probe, not a closed gate, and
   * saying so is more honest than the safe-looking collapse into "closed" — that collapse states
   * something the page does not know. The confirm dialog below still treats unknown as
   * not-confirmed rather than as open, which is the direction that matters for a warning.
   */
  const dispatchOpen = useCapabilitiesStore((s) => s.hardwareDispatchEnabled);
  const consequence = dispatchConsequence(dispatchOpen);
  const dispatching = dispatchOpen === true;

  // Gated: this flushes every staged edit at once, including anything "Arm all" just staged
  // across every schedulable device — one click here can be a lot more than the single field
  // the user was last looking at.
  const askSave = () =>
    ask(
      {
        title: 'Save these changes?',
        // The consequence sentence is the SAME string the page shows, deliberately: a dialog that
        // rephrased it would be a second place for the two to disagree about what saving does.
        body: `${pendingEntries.length} change${pendingEntries.length === 1 ? '' : 's'} will be saved and recorded against your account. ${consequence}`,
        confirmLabel: 'Save',
        // Red only when it is confirmed that this reaches hardware. Unknown is not open.
        tone: dispatching ? 'red' : 'blue',
      },
      () => void save(),
    );

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
            {/* ON THE PAGE, not behind the ⓘ. "Saved rules switch real hardware here" is the most
                consequential sentence on this screen; a hint you have to open is where you put a
                footnote, not where you put the warning. */}
            <strong className={`automation-dispatch-note automation-dispatch-note--${dispatchOpen === true ? 'open' : dispatchOpen === false ? 'closed' : 'unknown'}`}>
              {consequence}
            </strong>
            <InfoHint label="What this means">
              Rules saved here are read by the scheduler daemon on the Pi and dispatched through the same gated,
              audited path the Control page uses. Every firing writes a row to the command audit trail, whether it
              succeeded or not — and whether it moved a relay or was recorded as a dry run.
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
                  `Saved ${lastSave.count} change${lastSave.count === 1 ? '' : 's'} at ${new Date(lastSave.at).toLocaleTimeString(undefined, { hour12: false })}`
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

      <Tabs tabs={tabs} activeId={tab} onChange={setTab} label="Automation strategies" className="automation-tabs" />

      <TabPanel tabId="overview" activeId={tab}>
      {/* EACH PANEL CARRIES THE SECTION HEADING, screen-reader only.
       *
       * `Card`'s contract is page h1 -> section h2 -> card h3, and this page had NO h2 at all:
       * it went straight from the "Automation" h1 to the cards' h3s, so a screen reader's
       * heading outline showed a skipped level and four tabs' worth of cards with nothing
       * naming the section they belonged to.
       *
       * Hidden rather than drawn because the tab strip already states this visually — the
       * heading is for the outline, which is how many screen-reader users navigate a page.
       */}
        <h2 className="sr-only">Overview</h2>
        <AutomationOverview devices={schedulable} schedules={schedules} armedCount={armedCount} dispatching={dispatching} onGoToTab={setTab} />
      </TabPanel>

      <TabPanel tabId="time" activeId={tab}>
        <h2 className="sr-only">Time-Driven automation</h2>
        <TimeDrivenPanel devices={schedulable} notSchedulable={notSchedulable} />
      </TabPanel>

      <TabPanel tabId="state" activeId={tab}>
        <h2 className="sr-only">State-Driven automation</h2>
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
              blockedOn="enough per-socket runtime history to rotate against. The relays became individually schedulable on 2026-09-09, so it is accumulating now; nothing yet tracks the duty cycler itself."
            />
          </div>
        </div>
      </TabPanel>

      <TabPanel tabId="events" activeId={tab}>
        <h2 className="sr-only">Event-Driven automation</h2>
        <EventDrivenPanel devices={devices} />
      </TabPanel>

      {/* Page-scoped, not tab-scoped: a staged edit made on one tab is still unwritten while
          you are reading another, and hiding it there is how it gets lost. */}
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
      <ConfirmModal {...modalProps} />
    </>
  );
}

/**
 * Staged edits live in `contextStore.draft` and reach the store only via "Save changes".
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
