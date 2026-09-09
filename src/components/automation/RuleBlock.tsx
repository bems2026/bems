import type { ReactNode } from 'react';
import { Clock3, Thermometer, Gauge, Zap } from 'lucide-react';

/**
 * The IF/THEN frame every automation rule is drawn in — RM-071.
 *
 * WHY IT EXISTS. Every rule on this page used to be a flat run of controls: `AcuRuleCard` put a
 * text input, two selects, two number inputs, two time inputs, a textarea, seven day chips and a
 * switch in one row with nothing between them. Every control looked equally important, and
 * nothing said which of them was the CONDITION and which was the CONSEQUENCE. That distinction is
 * the whole content of a rule — "when this, do that" — and it was the one thing the layout did
 * not encode.
 *
 * WHAT IT ENCODES, and why it is grouping rather than decoration. The two zones are separated by
 * proximity, a shared background, and a coloured rail (Gestalt common-region). The rail's colour
 * says what KIND of trigger fires the rule — clock, sensor, or demand limit — so a person
 * scanning a page of rules can sort them without reading any of them.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. Each zone also carries a word (WHEN / THEN) and the trigger
 * carries an icon. A reader who cannot separate amber from blue loses nothing: the rail is a
 * fourth cue, not the first. This is the `color-not-only` rule, and on a page that switches real
 * relays it is not a formality.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It holds no state, owns no controls and knows nothing about
 * schedules or setpoints — callers put their own inputs inside it. A primitive that reached into
 * the stores would have to be rewritten for the second rule type that used it, and there are
 * already two.
 */

/** What fires the rule. Decides the rail colour and the icon in the WHEN zone. */
export type RuleTrigger = 'time' | 'sensor' | 'demand';

const TRIGGER_ICON = {
  time: Clock3,
  sensor: Thermometer,
  demand: Gauge,
} as const;

/**
 * Read by screen readers as part of the zone label, so the trigger type survives when the rail
 * and the icon do not — a `<span>` of visible text would be redundant beside the icon for sighted
 * users, and its absence would be a real loss for everyone else.
 */
const TRIGGER_LABEL = {
  time: 'time trigger',
  sensor: 'sensor trigger',
  demand: 'demand trigger',
} as const;

export function RuleBlock({
  trigger,
  children,
  className = '',
}: {
  trigger: RuleTrigger;
  children: ReactNode;
  className?: string;
}) {
  return <div className={`rule-block rule-block--${trigger} ${className}`.trim()}>{children}</div>;
}

/**
 * The condition. Takes the trigger so the icon and the accessible label stay with the thing they
 * describe rather than being passed twice.
 */
export function RuleWhen({ trigger, children }: { trigger: RuleTrigger; children: ReactNode }) {
  const Icon = TRIGGER_ICON[trigger];
  return (
    <div className="rule-block__zone rule-block__zone--when">
      <span className="rule-block__zone-label">
        <Icon size={12} aria-hidden="true" />
        When
        <span className="sr-only"> ({TRIGGER_LABEL[trigger]})</span>
      </span>
      <div className="rule-block__zone-body">{children}</div>
    </div>
  );
}

/** The consequence. One icon for every rule type — the action is always "something gets switched". */
export function RuleThen({ children }: { children: ReactNode }) {
  return (
    <div className="rule-block__zone rule-block__zone--then">
      <span className="rule-block__zone-label">
        <Zap size={12} aria-hidden="true" />
        Then
      </span>
      <div className="rule-block__zone-body">{children}</div>
    </div>
  );
}
