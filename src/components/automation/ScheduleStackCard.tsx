import { useMemo, useState } from 'react';
import { Plus, Trash2, AlertTriangle, Info, X } from 'lucide-react';
import { DAY_LABELS, DAY_NAMES, toggleDay, parseDays, anyDaySet } from '@shared/scheduleDays.mjs';
import { useScheduleStore, CREATING } from '@/stores/scheduleStore';
import { ruleProblem, explainProblem, stackConflicts, acuWindowConflicts, type ScheduleTarget } from '@/lib/scheduleStack';
import { useAcuRuleStore } from '@/stores/acuRuleStore';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { RuleBlock, RuleWhen, RuleThen } from './RuleBlock';
import { WeekTimeline } from './WeekTimeline';
import type { Schedule } from '@/lib/supabaseSchedules';

/**
 * One target's stack of rules — the list this whole change exists to make possible.
 *
 * WHAT IT REPLACES. A single row per device with one ON, one OFF and one day mask, backed by a
 * database constraint that made writing a second window silently overwrite the first. An
 * operator who set 08:00–12:00 and then 13:00–17:00 ended up with only the second, with nothing
 * on screen to say the first had gone.
 *
 * SAVES ON CHANGE, not behind a page-level button. A list you add to and delete from is the
 * wrong shape for staged writes: a queued deletion reads as already done. Discrete controls
 * (day chips, the arm switch) commit on click; the time fields commit on blur, so a
 * half-typed `0` never reaches the database.
 */
export function ScheduleStackCard({
  target,
  stack,
  dispatchableIds,
}: {
  target: ScheduleTarget;
  stack: Schedule[];
  dispatchableIds: Set<string>;
}) {
  const create = useScheduleStore((s) => s.create);
  const creating = useScheduleStore((s) => s.busy[CREATING]);
  const createError = useScheduleStore((s) => s.rowError[CREATING]);
  const clearRowError = useScheduleStore((s) => s.clearRowError);
  const { ask, modalProps } = useConfirm();

  // Two sources, one list. A stack-internal collision and a schedule that silences the aircon
  // loop are both "this fires, but not the way it reads", and splitting them into two lists would
  // make the operator check two places for the same class of surprise.
  const acuRules = useAcuRuleStore((s) => s.rules);
  const conflicts = useMemo(
    () => [...stackConflicts(stack), ...acuWindowConflicts(stack, acuRules, target)],
    [stack, acuRules, target],
  );
  const armedCount = stack.filter((r) => r.enabled).length;

  /*
   * A rule nobody has filled in yet. A new one is created blank, and `phase33`'s dedupe index
   * keys on (device, socket, on, off, days) — so a SECOND blank rule is an exact duplicate of
   * the first and the insert is refused every time.
   *
   * PREVENTED RATHER THAN EXPLAINED. The old behaviour fired the doomed insert and printed the
   * Postgres constraint name, which is a poor trade: the operator learns nothing, and the thing
   * they should be looking at — the empty rule already on screen — is not what the message
   * points at. Now the button says why it is waiting, and nothing is sent.
   */
  const blankRule = stack.find((r) => !r.on && !r.off && !anyDaySet(r.days ?? undefined));

  const addRule = () => {
    if (blankRule) return;
    void create({
      deviceId: target.device.id,
      socket: target.socket,
      // Deliberately blank rather than a plausible default. A fabricated 09:00–17:00 would be a
      // schedule nobody chose, and this project's rule everywhere else is that an unset value
      // stays unset — `parseDays` refuses to invent an every-day default for the same reason.
      on: null,
      off: null,
      days: '0000000',
      enabled: false,
      label: null,
    });
  };

  return (
    <section className="card schedule-stack">
      <div className="schedule-stack__head">
        <div>
          <h3 className="card-title">{target.name}</h3>
          <p className="schedule-stack__sub">
            {stack.length === 0 ? 'No rules yet' : `${stack.length} rule${stack.length === 1 ? '' : 's'}, ${armedCount} armed`}
            {target.device.branch_circuit ? ` · ${target.device.branch_circuit}` : ''}
          </p>
        </div>
        <button
          type="button"
          className="schedule-stack__add"
          onClick={addRule}
          disabled={creating || Boolean(blankRule)}
          // The reason travels with the control rather than only in a message elsewhere, so it is
          // there on hover and read out by a screen reader when the button is reached.
          title={blankRule ? 'Finish the empty rule below first' : undefined}
        >
          <Plus size={14} aria-hidden="true" />
          {creating ? 'Adding…' : 'Add schedule'}
        </button>
      </div>

      {/* Why the button is waiting, next to the button. `role="status"` (polite) because it is
          guidance about a control the reader just looked at, not a failure that interrupted them. */}
      {blankRule && !createError && (
        <p className="schedule-stack__hint" role="status">
          <Info size={12} aria-hidden="true" />
          Give the empty rule below a time and a day, and Add schedule comes back.
        </p>
      )}

      {/*
       * DISMISSIBLE, which it was not. This message used to sit until the next SUCCESSFUL create,
       * so a reader who understood it and moved on kept looking at a stale failure — and the one
       * error that fires most often here is now prevented above, which means anything that does
       * appear is worth reading once and clearing.
       */}
      {createError && (
        <p className="schedule-stack__error schedule-stack__error--dismissable" role="alert">
          <span>{createError}</span>
          <button
            type="button"
            className="schedule-stack__error-dismiss"
            aria-label="Dismiss this message"
            onClick={() => clearRowError(CREATING)}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </p>
      )}

      {stack.length === 0 ? (
        <p className="schedule-stack__empty">
          Nothing scheduled for {target.name}. Add a rule and arm it; until it is armed the scheduler ignores it.
        </p>
      ) : (
        <ul className="schedule-stack__list">
          {stack.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              target={target}
              dispatchableIds={dispatchableIds}
              conflicted={conflicts.some((c) => c.kind === 'collision' && c.ruleIds.includes(rule.id))}
              onAskDelete={ask}
            />
          ))}
        </ul>
      )}

      {conflicts.length > 0 && (
        <ul className="schedule-stack__conflicts">
          {conflicts.map((c, i) => (
            <li key={i} className={`schedule-stack__conflict schedule-stack__conflict--${c.kind}`} role="status">
              {c.kind === 'collision' || c.kind === 'acu-window' ? <AlertTriangle size={12} aria-hidden="true" /> : <Info size={12} aria-hidden="true" />}
              {c.message}
            </li>
          ))}
        </ul>
      )}

      <WeekTimeline stack={stack} label={target.name} />
      <ConfirmModal {...modalProps} />
    </section>
  );
}

type AskFn = ReturnType<typeof useConfirm>['ask'];

function RuleRow({
  rule,
  target,
  dispatchableIds,
  conflicted,
  onAskDelete,
}: {
  rule: Schedule;
  target: ScheduleTarget;
  dispatchableIds: Set<string>;
  conflicted: boolean;
  onAskDelete: AskFn;
}) {
  const patch = useScheduleStore((s) => s.patch);
  const remove = useScheduleStore((s) => s.remove);
  const busy = useScheduleStore((s) => s.busy[rule.id]);
  const error = useScheduleStore((s) => s.rowError[rule.id]);

  // Times are edited locally and committed on blur: `<input type="time">` fires onChange for
  // every intermediate value, and writing "0" then "08" then "08:0" would be three pointless
  // round trips and three chances to persist a half-typed time.
  const [onDraft, setOnDraft] = useState<string | null>(null);
  const [offDraft, setOffDraft] = useState<string | null>(null);

  const days = parseDays(rule.days ?? undefined);
  const problem = ruleProblem(rule, target.device, dispatchableIds);
  const name = rule.label || `${rule.on ?? '—'} to ${rule.off ?? '—'}`;

  const commit = (field: 'on' | 'off', value: string) => {
    const next = value === '' ? null : value;
    if (next === rule[field]) return;
    void patch(rule.id, { [field]: next });
  };

  const askDelete = () =>
    onAskDelete(
      {
        title: 'Delete this schedule?',
        body: `${target.name} — ${name}. This removes the rule permanently. What it has already fired stays in the command audit trail.`,
        confirmLabel: 'Delete',
        tone: 'red',
      },
      () => void remove(rule.id),
    );

  return (
    <li className={`schedule-rule${rule.enabled ? '' : ' schedule-rule--disarmed'}${conflicted ? ' schedule-rule--conflicted' : ''}`}>
      {/* Rule identity and its arm/delete controls sit ABOVE the logic, not inside it. Neither is
          part of the condition or the action — a name is not a trigger, and putting the arm switch
          in one of the zones would suggest it was. */}
      <div className="schedule-rule__head">
        <input
          type="text"
          className="schedule-rule__label"
          placeholder="Name this rule"
          defaultValue={rule.label ?? ''}
          aria-label={`Name for the ${name} rule on ${target.name}`}
          maxLength={60}
          onBlur={(e) => {
            const next = e.target.value.trim() || null;
            if (next !== rule.label) void patch(rule.id, { label: next });
          }}
        />

        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`Arm ${name} on ${target.name}`}
          className={`quick-toggle${rule.enabled ? ' quick-toggle--on' : ''}`}
          disabled={busy}
          onClick={() => void patch(rule.id, { enabled: !rule.enabled })}
        >
          <span className="quick-toggle__knob" />
        </button>

        <button type="button" className="schedule-rule__delete" aria-label={`Delete ${name} on ${target.name}`} disabled={busy} onClick={askDelete}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>

      {/*
       * THE DAYS ARE THE CONDITION AND THE TIMED SWITCH IS THE ACTION, which is the reading that
       * survives being said out loud: "when Mon–Fri, turn it on at 08:00 and off at 18:00."
       *
       * The tempting alternative — times in WHEN, "turns on/off" in THEN — is mushier than it
       * looks, because one rule carries TWO edges. Its THEN could only say "on, and also off",
       * which is not an action anybody performs. Splitting on days keeps each zone a single
       * unambiguous statement.
       */}
      <RuleBlock trigger="time">
        <RuleWhen trigger="time">
          <div className="schedule-rule__days">
            {DAY_LABELS.map((day, i) => (
              <button
                key={i}
                type="button"
                className={`automation-day-chip${days[i] ? ' automation-day-chip--on' : ''}`}
                aria-pressed={days[i]}
                aria-label={`${DAY_NAMES[i]} for ${name} on ${target.name}`}
                onClick={() => void patch(rule.id, { days: toggleDay(rule.days ?? undefined, i) })}
              >
                {day}
              </button>
            ))}
          </div>
        </RuleWhen>

        <RuleThen>
          <label className="schedule-rule__time">
            <span className="schedule-rule__time-label">On at</span>
            <input
              type="time"
              value={onDraft ?? rule.on ?? ''}
              aria-label={`${target.name} ${name} on time`}
              onChange={(e) => setOnDraft(e.target.value)}
              onBlur={(e) => {
                setOnDraft(null);
                commit('on', e.target.value);
              }}
            />
          </label>

          <label className="schedule-rule__time">
            <span className="schedule-rule__time-label">Off at</span>
            <input
              type="time"
              value={offDraft ?? rule.off ?? ''}
              aria-label={`${target.name} ${name} off time`}
              onChange={(e) => setOffDraft(e.target.value)}
              onBlur={(e) => {
                setOffDraft(null);
                commit('off', e.target.value);
              }}
            />
          </label>
        </RuleThen>
      </RuleBlock>

      {/* A rule that is armed and can never fire says so where it is, in words. In a stack of
          five this is the difference between one dead rule being noticed and it being invisible. */}
      {problem && (
        <p className="schedule-rule__problem" role="status">
          <AlertTriangle size={12} aria-hidden="true" />
          Armed but will never fire — {explainProblem(problem)}.
        </p>
      )}

      {error && (
        <p className="schedule-rule__error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
