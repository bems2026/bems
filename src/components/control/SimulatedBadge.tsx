/**
 * Marks a control card whose commands are validated and audit-logged but never reach
 * hardware. Shown whenever that class does not dispatch — a partly open gate, or a fully
 * closed one.
 *
 * This replaced a page-level dispatch banner (2026-08-25). A banner sits at the top while the
 * card someone scrolls straight to may be well below the fold, and on a fully-dispatching site
 * it degenerated into a paragraph announcing that nothing was wrong. Attaching the fact to the
 * control it constrains keeps it closer to the click and silent when there is nothing to say.
 */
export function SimulatedBadge() {
  return (
    <span className="control-simulated-badge" title="Commands here are recorded but do not reach hardware">
      not dispatched
    </span>
  );
}
