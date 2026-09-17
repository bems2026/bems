import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useAnchoredPopover } from '@/components/ui/useAnchoredPopover';
import type { ScopeOption } from '@/lib/circuitBreakdown';

/**
 * Narrowing the report to a use or to one branch — one button since RM-102.
 *
 * RM-082c put a labelled `<select>` in the control bar, RM-093 grouped it, and RM-096's Circuits tab
 * grew a row of chips for the same state. Two controls, one value, and on the 800x480 kiosk the bar
 * they sat in wrapped to three lines. This is one button that reads what the report is narrowed to,
 * and behind it the two questions in the order the operator asks them: what the energy was FOR —
 * pills, because there are at most three uses and the whole building — and which ONE circuit, a
 * list, because a panel can have any number of branches and a second site's panel is not this one's.
 *
 * The button's accessible name is "Circuit" plus the choice — the visible text is inside it, which is
 * what lets a voice user say what they see — so a screen reader knows what the button does before it
 * knows what it says. Choosing closes the dialog and hands focus back.
 */

interface Props {
  scopes: readonly ScopeOption[];
  /** The encoded value chosen — `all`, `load:<id>` or `circuit:<id>`. */
  scope: string;
  onChange: (value: string) => void;
}

export function ScopePicker({ scopes, scope, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const dismiss = useCallback(() => setOpen(false), []);
  const { anchorRef, popRef, style } = useAnchoredPopover({
    open,
    onDismiss: dismiss,
    // Wide enough for the four use pills on one row; the hook clamps it to a phone's viewport.
    preferredWidth: 380,
    fallbackHeight: 280,
    preferredMaxHeight: 400,
  });

  const whole = scopes.find((s) => s.group === null);
  const uses = scopes.filter((s) => s.group === 'use');
  const circuits = scopes.filter((s) => s.group === 'circuit');
  const current = scopes.find((s) => s.value === scope) ?? whole;

  // A choice closes the dialog and hands focus back to the button that opened it — in an effect,
  // because the ref is read after the render that removed the dialog, not during one.
  const [chosen, setChosen] = useState(0);
  useEffect(() => {
    if (chosen > 0) anchorRef.current?.focus();
  }, [chosen, anchorRef]);

  const choose = (value: string) => {
    onChange(value);
    setOpen(false);
    setChosen((n) => n + 1);
  };

  const pill = (s: ScopeOption, label: string) => (
    <button
      key={s.value}
      type="button"
      className={`analytics-scope-btn${scope === s.value ? ' analytics-scope-btn--active' : ''}`}
      aria-pressed={scope === s.value}
      onClick={() => choose(s.value)}
    >
      {label}
    </button>
  );

  const item = (s: ScopeOption) => (
    <button
      key={s.value}
      type="button"
      className={`report-scope__item${scope === s.value ? ' report-scope__item--current' : ''}`}
      aria-current={scope === s.value ? 'true' : undefined}
      onClick={() => choose(s.value)}
    >
      {s.label}
    </button>
  );

  return (
    <div className="report-scope">
      <button
        ref={anchorRef as React.RefObject<HTMLButtonElement>}
        type="button"
        className="report-scope__current"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Circuit ${current?.label ?? '—'}`}
        onClick={() => setOpen((o) => !o)}
      >
        {current?.label ?? '—'}
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef as React.RefObject<HTMLDivElement>}
            className="report-scope__pop"
            role="dialog"
            aria-label="Narrow the report"
            style={style}
          >
            {uses.length > 0 && whole ? (
              <div role="group" aria-label="By use" className="report-scope__group">
                <p className="report-scope__legend" aria-hidden="true">
                  By use
                </p>
                <div className="report-chips">
                  {pill(whole, 'All')}
                  {uses.map((s) => pill(s, s.label))}
                </div>
              </div>
            ) : null}
            <div role="group" aria-label="One circuit" className="report-scope__group">
              <p className="report-scope__legend" aria-hidden="true">
                One circuit
              </p>
              {/* With no uses to choose between, the whole building is the first item of this list
                  rather than a lone pill above it. */}
              {uses.length === 0 && whole ? item(whole) : null}
              {circuits.map(item)}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
