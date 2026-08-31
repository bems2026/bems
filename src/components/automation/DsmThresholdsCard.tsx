import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import { readDsmThresholds, maxPhaseNow, totalKwNow } from '@/lib/dsm';
import { isReadingExpired } from '@/lib/staleness';

const MAX_PHASE_KEY = 'global.dsm.max_phase_a';
const MAX_TOTAL_KEY = 'global.dsm.max_total_kw';
const AUTO_SHED_KEY = 'global.dsm.auto_shed';

const STATUS_LABEL = {
  breached: 'BREACHED',
  ok: 'OK',
  'no-limit': 'NO LIMIT SET',
  'no-reading': 'NO READING',
} as const;

const STATUS_CLASS = {
  breached: 'automation-dsm-field__breach',
  ok: 'automation-dsm-field__ok',
  'no-limit': 'automation-dsm-field__unknown',
  'no-reading': 'automation-dsm-field__unknown',
} as const;

/** These thresholds no longer drive an Overview banner (removed per the bento-grid
 * revision — DSM breach is not in the current Overview design), but stay configurable and
 * saved here regardless: they're a real building parameter Automation owns independent of
 * whether anything currently displays a breach. Live readout is real: the same `_totals`
 * reading Overview's Electrical Parameters card shows. */
export function DsmThresholdsCard() {
  const totals = useDeviceStore((s) => s.totals);
  const saved = useContextStore((s) => s.saved);
  const draft = useContextStore((s) => s.draft);
  const setDraft = useContextStore((s) => s.setDraft);

  const effective = (key: string) => draft[key] ?? saved[key] ?? '';
  const thresholds = readDsmThresholds({ ...saved, ...draft });

  /**
   * A reading past its expiry is not evidence of anything — `staleness.ts`'s rule, and it matters
   * more here than anywhere else in the app. This is the page where someone decides whether to
   * arm a mechanism that cuts power to a working building unattended, and the two things it can
   * get wrong are symmetrical: a breach flagged from a ten-minute-old row is a false alarm, and
   * `OK` from that same row is a false all-clear. Both are claims about *now*.
   */
  const live = isReadingExpired(totals) ? null : totals;
  const phaseNow = maxPhaseNow(live);
  const kwNow = totalKwNow(live);

  /**
   * Four states, not two. `OK` was standing in for three different situations: within the limit,
   * no limit configured, and no reading to judge. Only the first is reassuring, and a green word
   * carries reassurance whichever one produced it.
   *
   * The two absences are kept apart because they are fixed by different people doing different
   * things — one is a missing threshold on this very form, the other is a bridge that has stopped
   * reporting. Conflating them was caught by looking at the page: the live readout said
   * `13.9 A max phase` while the status beside it said NO READING.
   */
  const status = (limit: number | null, now: number | null): 'breached' | 'ok' | 'no-limit' | 'no-reading' => {
    if (now === null) return 'no-reading';
    if (limit === null) return 'no-limit';
    return now > limit ? 'breached' : 'ok';
  };
  const phaseStatus = status(thresholds.maxPhaseA, phaseNow);
  const powerStatus = status(thresholds.maxTotalKw, kwNow);
  const autoShedDraftValue = effective(AUTO_SHED_KEY) === 'true';

  return (
    <div className="card automation-dsm-card">
      <h3 className="card-title">DSM Thresholds</h3>
      <p className="card-sub">
        Saved thresholds for demand-side management. Live: {phaseNow !== null ? `${phaseNow.toFixed(1)} A` : '—'} max phase,{' '}
        {kwNow !== null ? `${kwNow.toFixed(2)} kW` : '—'} total.
      </p>

      <ThresholdField
        id="dsm-max-phase"
        label="MAX PHASE CURRENT (A)"
        status={phaseStatus}
        value={effective(MAX_PHASE_KEY)}
        step={0.1}
        onChange={(v) => setDraft(MAX_PHASE_KEY, v)}
      />
      <ThresholdField
        id="dsm-max-total"
        label="MAX TOTAL DRAW (kW)"
        status={powerStatus}
        value={effective(MAX_TOTAL_KEY)}
        step={0.01}
        onChange={(v) => setDraft(MAX_TOTAL_KEY, v)}
      />

      <div className="automation-shed-mode">
        <div className="automation-shed-mode__body">
          <p className="automation-shed-mode__title" id="dsm-auto-shed-label">
            On breach: {autoShedDraftValue ? 'arm automatic shed' : 'warn and wait for manual override'}
          </p>
          <p className="automation-shed-mode__sub">Auto-shed is a decision point — confirm before anything cuts power unattended.</p>
        </div>
        {/*
          Was a plain button labelled "Switch" — a verb with no object, which told you neither
          what it would change nor what the current state was, and announced nothing about
          being a toggle. It's the same on/off state `ScheduleRow`'s arm control carries, so
          it gets the same primitive and the same `role="switch"` + `aria-checked`.
        */}
        <button
          type="button"
          role="switch"
          aria-checked={autoShedDraftValue}
          aria-labelledby="dsm-auto-shed-label"
          className={`quick-toggle${autoShedDraftValue ? ' quick-toggle--on' : ''}`}
          onClick={() => setDraft(AUTO_SHED_KEY, String(!autoShedDraftValue))}
        >
          <span className="quick-toggle__knob" />
        </button>
      </div>
    </div>
  );
}

/**
 * One threshold input with its label properly associated.
 *
 * The visible caption used to be a bare `<span>` in a flex row, so neither input had a label,
 * an `aria-label`, or any other accessible name — a screen reader announced two unlabelled
 * number fields on a card that writes real load-shedding limits. `ScheduleRow` already gets
 * this right via `aria-label`; a real `<label for>` is better still here because the caption
 * is on screen anyway, and it makes the caption click-to-focus.
 *
 * `inputMode="decimal"` brings up the numeric keypad on the kiosk touchscreen instead of the
 * full QWERTY, and `min={0}` states what was always true — neither a current limit nor a
 * power cap can be negative.
 */
function ThresholdField({
  id,
  label,
  status,
  value,
  step,
  onChange,
}: {
  id: string;
  label: string;
  status: 'breached' | 'ok' | 'no-limit' | 'no-reading';
  value: string;
  step: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="automation-dsm-field">
      <div className="automation-dsm-field__head">
        <label htmlFor={id}>{label}</label>
        <span className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</span>
      </div>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        className="automation-number-input"
        value={value}
        placeholder="not set"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
