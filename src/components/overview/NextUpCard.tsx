import { CalendarClock } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { nextUpSchedules, armedScheduleCount } from '@/components/automation/automationMath';
import { CLASS_ICON } from '@/lib/deviceIcons';
import { CardLink } from '@/components/ui/CardLink';

/** "in 4 h", "in 25 min", "now" — a relative label, because "07:30" alone does not say whether
 * that is in ten minutes or in six days. */
function relative(minutes: number): string {
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 1440) return `in ${Math.round(minutes / 60)} h`;
  const days = Math.round(minutes / 1440);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * v4's "Active Schedules" card, retitled "Next up" per the Phase M plan — v3's
 * chronologically-sorted "what happens next" is a more useful frame than v4's unsorted
 * "what's currently armed".
 *
 * Reads the saved `schedules` rows, never an unsaved edit: an Automation change that has not
 * been written is not something the scheduler daemon can see, so it is not really next.
 */
export function NextUpCard() {
  const devices = useDeviceStore((s) => s.devices);
  const schedules = useScheduleStore((s) => s.schedules);
  const entries = nextUpSchedules(devices, schedules, new Date());
  const armed = armedScheduleCount(schedules);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">
            <CalendarClock size={14} className="title-icon" aria-hidden="true" />
            Active Schedules
          </h3>
          <p className="card-sub">{armed > 0 ? `${armed} armed rule${armed === 1 ? '' : 's'}` : 'Nothing armed'}</p>
        </div>
        <CardLink to="automation" label="Open schedules on Automation" />
      </div>
      {entries.length === 0 ? (
        <p className="section-placeholder">No schedules armed — No data</p>
      ) : (
        entries.map((e) => {
          const Icon = CLASS_ICON[e.deviceClass];
          return (
            <div className="next-up-row" key={`${e.ruleId}-${e.action}-${e.inMinutes}`}>
              <Icon size={14} aria-hidden="true" />
              <p className="next-up-name">
                {e.name} <span className="next-up-action">{e.action}</span>
              </p>
              <span className="next-up-window mono" title={relative(e.inMinutes)}>
                {e.time}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
