import { useState } from 'react';
import { Trash2, AlertTriangle, Thermometer, Activity } from 'lucide-react';
import { DAY_LABELS, DAY_NAMES, toggleDay, parseDays } from '@shared/scheduleDays.mjs';
import { measuresFor } from '@shared/temperatureSources.mjs';
import { useAcuRuleStore } from '@/stores/acuRuleStore';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { ACU_TEXT } from '@shared/acuLoopVocabulary.mjs';
import type { AcuRule, AcuLoopState } from '@/lib/supabaseAcuRules';
import type { Device } from '@/lib/types';

/**
 * One closed-loop aircon rule, and what the controller is currently doing about it.
 *
 * THE STATUS STRIP IS NOT DECORATION. On this site every rule holds on `acu_offline`, because
 * `acu_main` and `sens_outside_temp` have never been paired (RM-016). Without a rendered reason,
 * "I configured a rule and nothing happens" is indistinguishable from a bug — and the person
 * reading this page is the one who can get the devices paired.
 */
export function AcuRuleCard({
  rule,
  state,
  acus,
  sensors,
  roomFloorC,
}: {
  rule: AcuRule;
  state: AcuLoopState | undefined;
  acus: Device[];
  sensors: Device[];
  roomFloorC: number | null;
}) {
  const save = useAcuRuleStore((s) => s.save);
  const setEnabled = useAcuRuleStore((s) => s.setEnabled);
  const remove = useAcuRuleStore((s) => s.remove);
  const busy = useAcuRuleStore((s) => s.busy[rule.id]);
  const error = useAcuRuleStore((s) => s.rowError[rule.id]);
  const { ask, modalProps } = useConfirm();

  const [targetDraft, setTargetDraft] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState<string | null>(null);

  const days = parseDays(rule.days);
  const name = rule.label || 'Aircon rule';
  const sensor = sensors.find((d) => d.id === rule.sensorDeviceId);
  const measures = sensor ? measuresFor(sensor) : null;

  const patch = (over: Partial<AcuRule>) =>
    void save({
      id: rule.id,
      acuDeviceId: over.acuDeviceId ?? rule.acuDeviceId,
      sensorDeviceId: over.sensorDeviceId ?? rule.sensorDeviceId,
      targetC: over.targetC ?? rule.targetC,
      deadbandC: over.deadbandC ?? rule.deadbandC,
      stepC: over.stepC ?? rule.stepC,
      minStepIntervalS: over.minStepIntervalS ?? rule.minStepIntervalS,
      manualHoldS: over.manualHoldS ?? rule.manualHoldS,
      days: over.days ?? rule.days,
      windowStart: over.windowStart ?? rule.windowStart,
      windowEnd: over.windowEnd ?? rule.windowEnd,
      enabled: over.enabled ?? rule.enabled,
      label: over.label !== undefined ? over.label : rule.label,
      overrideReason: over.overrideReason !== undefined ? over.overrideReason : rule.overrideReason,
    });

  const target = Number(targetDraft ?? rule.targetC);
  const belowPolicy = roomFloorC !== null && target < roomFloorC;

  const askDelete = () =>
    ask(
      {
        title: 'Delete this aircon rule?',
        body: `${name}. The controller stops adjusting this unit immediately. What it has already commanded stays in the command audit trail.`,
        confirmLabel: 'Delete',
        tone: 'red',
      },
      () => void remove(rule.id),
    );

  return (
    <section className={`card acu-rule${rule.enabled ? '' : ' acu-rule--disarmed'}`}>
      <div className="acu-rule__head">
        <input
          type="text"
          className="schedule-rule__label"
          placeholder="Name this rule"
          defaultValue={rule.label ?? ''}
          aria-label={`Name for ${name}`}
          maxLength={60}
          onBlur={(e) => {
            const next = e.target.value.trim() || null;
            if (next !== rule.label) patch({ label: next });
          }}
        />
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`Arm ${name}`}
          className={`quick-toggle${rule.enabled ? ' quick-toggle--on' : ''}`}
          disabled={busy}
          onClick={() => void setEnabled(rule.id, !rule.enabled)}
        >
          <span className="quick-toggle__knob" />
        </button>
        <button type="button" className="schedule-rule__delete" aria-label={`Delete ${name}`} disabled={busy} onClick={askDelete}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>

      <AcuStatusStrip state={state} rule={rule} />

      <div className="acu-rule__grid">
        <label className="acu-rule__field">
          <span>Aircon to command</span>
          <select value={rule.acuDeviceId} onChange={(e) => patch({ acuDeviceId: e.target.value })}>
            {acus.map((d) => (
              <option key={d.id} value={d.id}>
                {d.display_name}
              </option>
            ))}
          </select>
        </label>

        <label className="acu-rule__field">
          <span>Sensor to read</span>
          <select value={rule.sensorDeviceId} onChange={(e) => patch({ sensorDeviceId: e.target.value })}>
            {sensors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.display_name}
              </option>
            ))}
          </select>
        </label>

        <label className="acu-rule__field">
          <span>Room target</span>
          <span className="acu-rule__inline">
            <input
              type="number"
              min={16}
              max={30}
              step={0.5}
              value={targetDraft ?? rule.targetC}
              aria-label={`Room temperature target for ${name}`}
              onChange={(e) => setTargetDraft(e.target.value)}
              onBlur={(e) => {
                setTargetDraft(null);
                const next = Number(e.target.value);
                if (Number.isFinite(next) && next !== rule.targetC) patch({ targetC: next });
              }}
            />
            <span className="acu-rule__unit">°C</span>
          </span>
        </label>

        <label className="acu-rule__field">
          <span>Step every</span>
          <span className="acu-rule__inline">
            <input
              type="number"
              min={1}
              max={120}
              value={Math.round(rule.minStepIntervalS / 60)}
              aria-label={`Minutes between steps for ${name}`}
              onChange={(e) => {
                const mins = Number(e.target.value);
                if (Number.isFinite(mins) && mins >= 1) patch({ minStepIntervalS: Math.round(mins * 60) });
              }}
            />
            <span className="acu-rule__unit">min</span>
          </span>
        </label>
      </div>

      {/* The measurement caveat, where the choice is made rather than after it goes wrong. */}
      {measures?.caveat && (
        <p className="acu-rule__caveat" role="status">
          <AlertTriangle size={12} aria-hidden="true" />
          <span>
            <strong>{measures.label}.</strong> {measures.caveat}
          </span>
        </p>
      )}

      <div className="acu-rule__window">
        <span className="acu-rule__window-label">Active</span>
        <div className="schedule-rule__days">
          {DAY_LABELS.map((day, i) => (
            <button
              key={i}
              type="button"
              className={`automation-day-chip${days[i] ? ' automation-day-chip--on' : ''}`}
              aria-pressed={days[i]}
              aria-label={`${DAY_NAMES[i]} for ${name}`}
              onClick={() => patch({ days: toggleDay(rule.days, i) })}
            >
              {day}
            </button>
          ))}
        </div>
        <label className="schedule-rule__time">
          <span className="schedule-rule__time-label">FROM</span>
          <input type="time" defaultValue={rule.windowStart} aria-label={`Window start for ${name}`} onBlur={(e) => e.target.value !== rule.windowStart && patch({ windowStart: e.target.value })} />
        </label>
        <label className="schedule-rule__time">
          <span className="schedule-rule__time-label">TO</span>
          <input type="time" defaultValue={rule.windowEnd} aria-label={`Window end for ${name}`} onBlur={(e) => e.target.value !== rule.windowEnd && patch({ windowEnd: e.target.value })} />
        </label>
      </div>

      {/* A target below the building's policy needs a written reason, and the reason IS the
          audit. Shown only when it applies, so an in-policy rule is not asked to justify itself. */}
      {belowPolicy && (
        <div className="acu-rule__override">
          <p className="acu-rule__override-head">
            <AlertTriangle size={12} aria-hidden="true" />
            {target}°C is below this building&apos;s {roomFloorC}°C room-comfort policy. Record why, and the rule may run.
          </p>
          <textarea
            className="acu-rule__override-input"
            rows={2}
            maxLength={500}
            placeholder="Why this room needs a lower target — at least 10 characters"
            aria-label={`Reason for the below-policy target on ${name}`}
            value={reasonDraft ?? rule.overrideReason ?? ''}
            onChange={(e) => setReasonDraft(e.target.value)}
            onBlur={(e) => {
              setReasonDraft(null);
              const next = e.target.value.trim() || null;
              if (next !== rule.overrideReason) patch({ overrideReason: next });
            }}
          />
        </div>
      )}

      {error && (
        <p className="schedule-rule__error" role="alert">
          {error}
        </p>
      )}
      <ConfirmModal {...modalProps} />
    </section>
  );
}

/** What the daemon last decided. Reads `acu_loop_state`, which only the daemon writes. */
function AcuStatusStrip({ state, rule }: { state: AcuLoopState | undefined; rule: AcuRule }) {
  if (!rule.enabled) {
    return (
      <p className="acu-status acu-status--idle">
        <Activity size={12} aria-hidden="true" />
        Disarmed — the controller ignores this rule.
      </p>
    );
  }
  if (!state || (!state.lastReason && state.commandedC === null)) {
    return (
      <p className="acu-status acu-status--idle">
        <Activity size={12} aria-hidden="true" />
        Armed. The controller has not reported on this rule yet.
      </p>
    );
  }

  const stepped = state.lastStepAt ? new Date(state.lastStepAt) : null;
  const holdText = state.lastReason ? ((ACU_TEXT as Record<string, string>)[state.lastReason] ?? state.lastReason) : null;

  return (
    <div className={`acu-status${state.alertKind ? ' acu-status--alert' : ''}`}>
      <p className="acu-status__line">
        <Thermometer size={12} aria-hidden="true" />
        {state.commandedC !== null ? (
          <>
            Setpoint <strong>{state.commandedC}°C</strong>
          </>
        ) : (
          <>Setpoint not yet known</>
        )}
        {stepped && (
          <span className="acu-status__when">
            {' '}
            · last stepped {state.lastDirection === 'down' ? 'down' : 'up'} at{' '}
            {stepped.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </p>
      {holdText && <p className="acu-status__reason">{holdText}</p>}
      {state.alertKind && (
        <p className="acu-status__alert" role="status">
          <AlertTriangle size={12} aria-hidden="true" />
          {(ACU_TEXT as Record<string, string>)[state.alertKind] ?? state.alertKind}
          {state.alertSince && ` since ${new Date(state.alertSince).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' })}`}
        </p>
      )}
    </div>
  );
}
