import { Clock3 } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * A control strategy this building cannot run yet, and the specific reason.
 *
 * "COMING SOON" ON ITS OWN IS NOT ACCEPTABLE HERE. Every one of these is blocked on something
 * nameable — a device that was never paired, a logger that is not on the network, a sensor
 * nobody has decided to buy — and an operator reading this page is exactly the person who can
 * unblock some of them. A card that says only "coming soon" converts a solvable procurement
 * question into a wait, which is the opposite of useful. So `blockedOn` is required, and the
 * roadmap id is rendered beside it so the claim can be checked rather than believed.
 *
 * The same reasoning `LoadShedPanel` applies to devices it refuses to offer a tier for: say
 * why, out loud, rather than leaving a gap that reads as an oversight.
 */
export function ComingSoonCard({
  title,
  what,
  blockedOn,
  roadmapId,
}: {
  title: string;
  /** What the strategy would do, in one sentence, so the value of unblocking it is legible. */
  what: ReactNode;
  /** The specific thing that is missing. Never "development time". */
  blockedOn: ReactNode;
  /** e.g. `RM-026`. Omitted when nothing tracks it yet — and then say so in `blockedOn`. */
  roadmapId?: string;
}) {
  return (
    <section className="card coming-soon-card">
      <div className="coming-soon-card__head">
        <h3 className="card-title">
          <Clock3 size={14} className="title-icon" aria-hidden="true" />
          {title}
        </h3>
        <span className="coming-soon-card__pill">NOT INSTALLED</span>
      </div>
      <p className="coming-soon-card__what">{what}</p>
      <p className="coming-soon-card__blocked">
        <span className="coming-soon-card__blocked-label">Blocked on</span> {blockedOn}
        {roadmapId && <span className="coming-soon-card__id mono">{roadmapId}</span>}
      </p>
    </section>
  );
}
