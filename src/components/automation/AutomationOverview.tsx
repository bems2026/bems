import { CalendarClock, Gauge, Thermometer, ShieldCheck, ShieldAlert } from 'lucide-react';
import { CLASS_ICON } from '@/lib/deviceIcons';
import { nextUpSchedules } from './automationMath';
import { AutomationActivityCard } from './AutomationActivityCard';
import { useAcuRuleStore } from '@/stores/acuRuleStore';
import type { Schedule } from '@/lib/supabaseSchedules';
import type { Device } from '@/lib/types';

/**
 * The landing tab: what is armed, and what fires next.
 *
 * The page had no answer to "is anything actually going to happen?" — you had to read a table
 * of twenty rows and hold the armed ones in your head. That mattered more than it sounds,
 * because the same page had spent months claiming nothing it saved reached hardware.
 *
 * Reads only what has actually been written. A rule that never reached Supabase is a rule the
 * scheduler daemon cannot see, so it is not "next" — the same rule Overview's own card applies.
 */
export function AutomationOverview({
  devices,
  schedules,
  armedCount,
  dispatching,
  onGoToTab,
}: {
  devices: Device[];
  schedules: Schedule[];
  armedCount: number;
  dispatching: boolean;
  onGoToTab: (id: string) => void;
}) {
  const nextUp = nextUpSchedules(devices, schedules, new Date(), 5);
  const acuRules = useAcuRuleStore((s) => s.rules);
  const acuArmed = acuRules.filter((r) => r.enabled).length;

  return (
    <div className="automation-overview">
      <div className="automation-overview__tiles">
        <StrategyTile
          icon={CalendarClock}
          label="Time-Driven"
          value={`${armedCount} armed`}
          detail={`${schedules.length} rule${schedules.length === 1 ? '' : 's'} across ${devices.length} devices`}
          onClick={() => onGoToTab('time')}
        />
        <StrategyTile icon={Gauge} label="State-Driven" value="Load shedding" detail="thresholds and tiers" onClick={() => onGoToTab('state')} />
        <StrategyTile
          icon={Thermometer}
          label="Event-Driven"
          value={acuRules.length === 0 ? 'No rules' : `${acuArmed} armed`}
          detail={acuRules.length === 0 ? 'aircon room-temperature control' : `of ${acuRules.length} aircon rule${acuRules.length === 1 ? '' : 's'}`}
          onClick={() => onGoToTab('events')}
        />
      </div>

      <section className={`card automation-overview__reach automation-overview__reach--${dispatching ? 'live' : 'closed'}`}>
        <h3 className="card-title">
          {dispatching ? <ShieldAlert size={14} className="title-icon" aria-hidden="true" /> : <ShieldCheck size={14} className="title-icon" aria-hidden="true" />}
          {dispatching ? 'This page switches real hardware' : 'Dispatch is closed — firings are dry runs'}
        </h3>
        <p className="automation-overview__reach-body">
          {dispatching
            ? 'The scheduler daemon reads armed rules and dispatches them through the same gated, audited path the Control page uses. Every firing writes a command audit row whether it succeeded or not.'
            : 'The scheduler daemon still reads and evaluates armed rules on schedule, but this deployment’s hardware-dispatch gate is closed, so each firing is recorded as a dry run and no relay moves.'}
        </p>
      </section>

      <section className="card automation-overview__next">
        <h3 className="card-title">
          <CalendarClock size={14} className="title-icon" aria-hidden="true" />
          Next to fire
        </h3>
        {nextUp.length === 0 ? (
          <p className="automation-pending-empty">
            Nothing is armed with a saved on-time. A schedule that was never armed, or never given a time, does not fire
            and is not counted here.
          </p>
        ) : (
          <ul className="automation-overview__next-list">
            {nextUp.map((entry) => {
              const Icon = CLASS_ICON[entry.deviceClass];
              return (
                <li key={`${entry.ruleId}-${entry.action}-${entry.inMinutes}`} className="automation-overview__next-row">
                  <span className="automation-overview__next-icon" aria-hidden="true">
                    <Icon size={14} />
                  </span>
                  <span className="automation-overview__next-name">
                    {entry.name} <span className="automation-overview__next-action">{entry.action}</span>
                  </span>
                  <span className="automation-overview__next-time mono">{entry.time}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AutomationActivityCard devices={devices} />
    </div>
  );
}

function StrategyTile({
  icon: Icon,
  label,
  value,
  detail,
  onClick,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="card automation-overview__tile" onClick={onClick}>
      <span className="automation-overview__tile-label">
        <Icon size={14} className="title-icon" aria-hidden="true" />
        {label}
      </span>
      <span className="automation-overview__tile-value">{value}</span>
      <span className="automation-overview__tile-detail">{detail}</span>
    </button>
  );
}
