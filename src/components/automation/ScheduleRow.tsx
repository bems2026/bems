import { Sunrise, Sunset } from 'lucide-react';
import { useId } from 'react';
import { useContextStore } from '@/stores/contextStore';
import { CLASS_ICON } from '@/lib/deviceIcons';
import { DAY_LABELS, parseDays, scheduleKey, toggleDay, scheduleProblems, SCHEDULE_PROBLEM_TEXT } from './automationMath';
import type { Device } from '@/lib/types';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** One editable row — effective value is `draft ?? saved ?? ''` (unset, never a fabricated
 * default time). Every edit calls `setDraft`, which only stages the change; nothing reaches
 * Supabase until Automation's "Write to Supabase" is clicked. */
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
  const rawDays = effective('days');
  const days = parseDays(rawDays);
  const armed = effective('armed') === 'true';
  const Icon = CLASS_ICON[device.class];

  const problems = scheduleProblems({ armed, on: onVal || undefined, off: offVal || undefined, days: rawDays });
  const problemId = useId();

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

      <TimeField
        kind="on"
        value={onVal}
        label={`${device.display_name} on time`}
        onChange={(v) => setDraft(scheduleKey(device.id, 'on'), v)}
      />
      <TimeField
        kind="off"
        value={offVal}
        label={`${device.display_name} off time`}
        onChange={(v) => setDraft(scheduleKey(device.id, 'off'), v)}
      />

      <div className="automation-day-chips">
        {DAY_LABELS.map((label, i) => (
          <button
            key={i}
            type="button"
            className={`automation-day-chip${days[i] ? ' automation-day-chip--on' : ''}`}
            aria-pressed={days[i]}
            aria-label={`${device.display_name} ${DAY_NAMES[i]}`}
            onClick={() => setDraft(scheduleKey(device.id, 'days'), toggleDay(rawDays, i))}
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
          // The note below describes THIS control: two of its three cases are literally "armed
          // without X", and the third only matters once the row is armed. Wiring it here is what
          // gives a screen reader user the reason when they reach the switch.
          aria-describedby={problems.length > 0 ? problemId : undefined}
          className={`quick-toggle${armed ? ' quick-toggle--on' : ''}`}
          onClick={() => setDraft(scheduleKey(device.id, 'armed'), String(!armed))}
        >
          <span className="quick-toggle__knob" />
        </button>
      </div>

      {/*
        Inline, on the row that is wrong, rather than collected into a summary elsewhere — the same
        rule this app applies to failed writes. Spans the full five-column grid so it cannot disturb
        the columns.

        DELIBERATELY NOT A LIVE REGION, and that is the second version of this. "Arm all" stages
        `armed = true` for every filtered device in one click, so a dozen rows can start warning
        simultaneously — as `role="status"` that was a dozen polite announcements a screen reader
        user can neither act on nor skip. The count is announced once, by the summary on
        `AutomationPage`; this note describes the arm switch beside it, and is read when focus
        reaches that switch.
      */}
      {problems.length > 0 && (
        <p className="automation-sched-row__problem" id={problemId}>
          {problems.map((code) => SCHEDULE_PROBLEM_TEXT[code]).join(' ')}
        </p>
      )}
    </div>
  );
}

/**
 * One clock, saying which one it is.
 *
 * THE DEFECT THIS FIXES. The column captions live in `.automation-sched-row--head`, which is
 * `display: none` below 720px — the CARE kiosk and every phone. Below that width the two
 * `type="time"` inputs were visually identical and adjacent, and the only thing distinguishing
 * them was an `aria-label` a sighted operator never hears. Putting the office lights' ON time
 * into the OFF field is a silent, plausible mistake that then fires at the wrong hour.
 *
 * THREE CHANNELS, NOT ONE. A caption in words, a glyph (sunrise/sunset), and a coloured rail.
 * Colour is never the only carrier — that would fail for a colour-blind operator and under
 * `prefers-contrast: high`, and this row configures a building's lighting.
 *
 * The caption is `aria-hidden`: the input already carries "<device> on time" as its accessible
 * name, and announcing "ON" again in front of it would just be a stutter.
 */
function TimeField({
  kind,
  value,
  label,
  onChange,
}: {
  kind: 'on' | 'off';
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const Glyph = kind === 'on' ? Sunrise : Sunset;
  return (
    <div className={`automation-time-field automation-time-field--${kind}`}>
      <span className="automation-time-field__cap" aria-hidden="true">
        <Glyph size={11} />
        {kind === 'on' ? 'ON' : 'OFF'}
      </span>
      <input
        type="time"
        className="automation-time-input"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
