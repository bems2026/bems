import { useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { CLASS_ICON } from '@/lib/deviceIcons';
import { DEVICE_CLASS_CATALOG, classesWhere } from '@/lib/deviceClassCatalog';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { scheduleTargets, stackFor, ruleProblem } from '@/lib/scheduleStack';
import { InfoHint } from '@/components/ui/InfoHint';
import { ScheduleStackCard } from './ScheduleStackCard';
import { ComingSoonCard } from './ComingSoonCard';
import type { Device, DeviceClass } from '@/lib/types';

type SchedFilter = 'All' | DeviceClass;
const SCHED_FILTERS: SchedFilter[] = ['All', ...classesWhere('switchable')];
const filterLabel = (f: SchedFilter) => (f === 'All' ? 'All' : DEVICE_CLASS_CATALOG[f].label);

/**
 * Time-driven automation: pick a target, edit its stack.
 *
 * TARGETS, NOT DEVICES. An outlet appears twice — "Outlet 3 · S1" and "Outlet 3 · S2" — because
 * its two sockets are independent relays and always have been at the hardware. The Control page
 * has shown them that way since it was written; this page could not, because the schedules table
 * held one row per device and the client filtered `socket` out of existence on both read and
 * write. That is the gap RM-066 closes.
 *
 * A master/detail split rather than one long table: a stack needs vertical room for its rules,
 * its conflicts and its week strip, and twenty of those stacked down one page is unreadable.
 */
export function TimeDrivenPanel({ devices, notSchedulable }: { devices: Device[]; notSchedulable: Device[] }) {
  const schedules = useScheduleStore((s) => s.schedules);
  const status = useScheduleStore((s) => s.status);
  const loadError = useScheduleStore((s) => s.loadError);
  const dispatchClasses = useCapabilitiesStore((s) => s.dispatchClasses);

  const [filter, setFilter] = useState<SchedFilter>('All');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const targets = useMemo(() => scheduleTargets(devices), [devices]);
  const shown = filter === 'All' ? targets : targets.filter((t) => t.device.class === filter);

  const dispatchableIds = useMemo(() => {
    const classes = new Set(dispatchClasses ?? []);
    return new Set(devices.filter((d) => classes.has(d.class)).map((d) => d.id));
  }, [devices, dispatchClasses]);

  const selected = shown.find((t) => t.key === selectedKey) ?? shown[0];
  const stack = useMemo(() => (selected ? stackFor(schedules, selected) : []), [schedules, selected]);

  const armedTotal = schedules.filter((s) => s.enabled).length;
  const deadTotal = schedules.filter((s) => ruleProblem(s, devices.find((d) => d.id === s.deviceId), dispatchableIds) !== null).length;

  return (
    <div className="time-driven">
      <div className="card time-driven__targets">
        <div className="time-driven__head">
          <span className="card-title">
            <CalendarClock size={14} className="title-icon" aria-hidden="true" />
            Targets
          </span>
          <span className="automation-armed-count mono">{armedTotal} ARMED</span>
        </div>

        <div className="automation-filter-group time-driven__filters">
          {SCHED_FILTERS.map((f) => (
            <button key={f} type="button" className={`automation-filter-chip${filter === f ? ' automation-filter-chip--active' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {filterLabel(f)}
            </button>
          ))}
        </div>

        <p className="automation-schedules-sub">
          {targets.length} target{targets.length === 1 ? '' : 's'} — an outlet counts twice, because its two sockets are
          separate relays.
          {notSchedulable.length > 0 && (
            <>
              {' '}
              <InfoHint label={`Why ${notSchedulable.length} devices are not listed`}>
                {notSchedulable.map((d) => d.display_name).join(', ')} — these have no <strong>scheduling</strong>{' '}
                function set. That is configuration, not an omission: change it on the Devices page, under Edit.
              </InfoHint>
            </>
          )}
        </p>

        {deadTotal > 0 && (
          <p className="time-driven__dead" role="status">
            {deadTotal} armed rule{deadTotal === 1 ? '' : 's'} can never fire. Open the target to see why.
          </p>
        )}

        {loadError && (
          <p className="schedule-stack__error" role="alert">
            {loadError}
          </p>
        )}

        <ul className="time-driven__list">
          {shown.map((t) => {
            const count = stackFor(schedules, t);
            const armed = count.filter((r) => r.enabled).length;
            const dead = count.some((r) => ruleProblem(r, t.device, dispatchableIds) !== null);
            const Icon = CLASS_ICON[t.device.class];
            const active = selected?.key === t.key;
            return (
              <li key={t.key}>
                <button type="button" className={`time-driven__target${active ? ' time-driven__target--active' : ''}`} aria-current={active ? 'true' : undefined} onClick={() => setSelectedKey(t.key)}>
                  <span className="time-driven__target-icon" aria-hidden="true">
                    <Icon size={14} />
                  </span>
                  <span className="time-driven__target-name">{t.name}</span>
                  {dead && (
                    <span className="time-driven__target-dead" title="An armed rule here can never fire">
                      !
                    </span>
                  )}
                  <span className="time-driven__target-count mono">
                    {count.length === 0 ? '—' : `${armed}/${count.length}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="time-driven__detail">
        {status === 'loading' && schedules.length === 0 ? (
          <p className="section-placeholder">Reading the schedules…</p>
        ) : selected ? (
          <ScheduleStackCard target={selected} stack={stack} dispatchableIds={dispatchableIds} />
        ) : (
          <p className="section-placeholder">No schedulable targets match this filter.</p>
        )}

        <ComingSoonCard
          title="Holiday and exception calendar"
          what="Suspend every schedule on named dates — public holidays, semester breaks — without disarming and re-arming each rule by hand."
          blockedOn="nothing physical. It needs a date table and one screen, and nothing tracks it yet."
        />
        <ComingSoonCard
          title="Optimum start and stop"
          what="Start the aircon early enough to reach its target by opening time, and stop it early enough to coast to closing, learned from how fast this room actually responds."
          blockedOn="a room-temperature history, which needs the IR blaster and an ambient sensor to be paired first."
          roadmapId="RM-016"
        />
      </div>
    </div>
  );
}
