import { useDeviceStore } from '@/stores/deviceStore';
import { useContextStore } from '@/stores/contextStore';
import { readDsmThresholds, maxPhaseNow, totalKwNow } from '@/lib/dsm';

const MAX_PHASE_KEY = 'global.dsm.max_phase_a';
const MAX_TOTAL_KEY = 'global.dsm.max_total_kw';
const AUTO_SHED_KEY = 'global.dsm.auto_shed';

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
  const phaseNow = maxPhaseNow(totals);
  const kwNow = totalKwNow(totals);

  const phaseBreached = thresholds.maxPhaseA !== null && phaseNow !== null && phaseNow > thresholds.maxPhaseA;
  const powerBreached = thresholds.maxTotalKw !== null && kwNow !== null && kwNow > thresholds.maxTotalKw;
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
        breached={phaseBreached}
        value={effective(MAX_PHASE_KEY)}
        step={0.1}
        onChange={(v) => setDraft(MAX_PHASE_KEY, v)}
      />
      <ThresholdField
        id="dsm-max-total"
        label="MAX TOTAL DRAW (kW)"
        breached={powerBreached}
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
  breached,
  value,
  step,
  onChange,
}: {
  id: string;
  label: string;
  breached: boolean;
  value: string;
  step: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="automation-dsm-field">
      <div className="automation-dsm-field__head">
        <label htmlFor={id}>{label}</label>
        <span className={breached ? 'automation-dsm-field__breach' : 'automation-dsm-field__ok'}>{breached ? 'BREACHED' : 'OK'}</span>
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
