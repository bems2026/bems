import { ArrowUpRight } from 'lucide-react';
import { navigateTo } from '@/lib/useHashRoute';

interface CardLinkProps {
  /** Route id, matching `navItems.ts` — e.g. `analytics`, `devices`, `control`, `automation`. */
  to: string;
  /** The accessible name. Required, not optional: this control shows no text, so without it a
   * screen reader announces only "button", and there is no way to recover the meaning. */
  label: string;
}

/**
 * The "go to the full page for this card" affordance in a card header.
 *
 * Previously each card spelled out its own text link ("View details ↗", "Details ↗", "Fleet
 * status ↗", "Open controls ↗") — four different labels for one identical action, each eating
 * header width that the card's own title needs. This is the single icon-only version.
 *
 * `label` is a required prop rather than optional-with-a-default precisely because removing the
 * visible text removes the accessible name with it. Making it required means a new call site
 * cannot forget; a default would let one silently ship as "button". `title` mirrors it so
 * pointer users get the same wording on hover.
 */
export function CardLink({ to, label }: CardLinkProps) {
  return (
    <button type="button" className="card-head-link" onClick={() => navigateTo(to)} aria-label={label} title={label}>
      <ArrowUpRight size={16} aria-hidden="true" />
    </button>
  );
}
