import { useContextStore } from '@/stores/contextStore';
import { CLASS_ICON } from '@/lib/deviceIcons';
import { DAY_LABELS, parseDays, scheduleKey, toggleDay } from './automationMath';
import type { Device } from '@/lib/types';

/** One editable row — effective value is `draft ?? saved ?? ''` (unset, never a fabricated
 * default time). Every edit calls `setDraft`, which only stages the change; nothing reaches
 * the mock's context store until Automation's "Write to Node-RED context" is clicked. */
export function ScheduleRow({ device }: { device: Device }) {
  const saved = useContextStore((s) => s.saved);
  const draft = useContextStore((s) => s.draft);
  const setDraft = useContextStore((s) => s.setDraft);

  const effective = (field: 'on' | 'off' | 'days' | 'armed') => {
    const key = scheduleKey(device.id, field);
    return draft[key] ?? saved[key];
  };

  const onVal = effective('on') ?? '';
  const offVal = effective('off') ?? '';
  const days = parseDays(effective('days'));
  const armed = effective('armed') === 'true';
  const Icon = CLASS_ICON[device.class];

  return (
    <div className="automation-sched-row">
      <div className="automation-sched-row__device">
        <span className="automation-sched-row__icon" aria-hidden="true">
          <Icon size={14} />
        </span>
        <div>
          <div className="automation-sched-row__name">{device.display_name}</div>
          <div className="automation-sched-row__id mono">{device.id}</div>
        </div>
      </div>
      <input
        type="time"
        className="automation-time-input"
        value={onVal}
        aria-label={`${device.display_name} on time`}
        onChange={(e) => setDraft(scheduleKey(device.id, 'on'), e.target.value)}
      />
      <input
        type="time"
        className="automation-time-input"
        value={offVal}
        aria-label={`${device.display_name} off time`}
        onChange={(e) => setDraft(scheduleKey(device.id, 'off'), e.target.value)}
      />
      <div className="automation-day-chips">
        {DAY_LABELS.map((label, i) => (
          <button
            key={i}
            type="button"
            className={`automation-day-chip${days[i] ? ' automation-day-chip--on' : ''}`}
            aria-pressed={days[i]}
            aria-label={`${device.display_name} ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}`}
            onClick={() => setDraft(scheduleKey(device.id, 'days'), toggleDay(effective('days'), i))}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="automation-sched-row__arm">
        <button
          type="button"
          role="switch"
          aria-checked={armed}
          aria-label={`Arm ${device.display_name}'s schedule`}
          className={`quick-toggle${armed ? ' quick-toggle--on' : ''}`}
          onClick={() => setDraft(scheduleKey(device.id, 'armed'), String(!armed))}
        >
          <span className="quick-toggle__knob" />
        </button>
      </div>
    </div>
  );
}
