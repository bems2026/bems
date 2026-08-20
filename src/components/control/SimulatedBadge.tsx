/**
 * Marks a control card whose commands are validated and audit-logged but never reach
 * hardware, while OTHER controls on the same page do. Only shown in that mixed state — see
 * `ControlPage.tsx`'s `flagSimulated` for why it stays off when nothing dispatches at all.
 *
 * The page banner says the same thing, but a banner sits at the top and this card may be
 * well below the fold; someone scrolling straight to the outlets they want to switch would
 * otherwise never see it.
 */
export function SimulatedBadge() {
  return (
    <span className="control-simulated-badge" title="Commands here are recorded but do not reach hardware">
      not dispatched
    </span>
  );
}
