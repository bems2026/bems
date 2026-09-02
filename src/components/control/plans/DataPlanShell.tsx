/**
 * The room a drawn Control plan is drawn inside — RM-037.
 *
 * It draws whatever shape the operator sketched for the room and nothing else. Partitions, doors
 * and desks are facts about a building, and inventing them here would be exactly the hard-coded
 * geometry this replaced — `PlanShell`, deleted 2026-09-02, drew the CARE office's own outline,
 * glazed partitions and sliding door at every deployment that named its pack.
 *
 * A room nobody has shaped falls back to the full frame — `parseShape`'s default — which is what
 * every plan looked like before shapes existed. An undrawn room is unchanged, not empty.
 *
 * `preserveAspectRatio="none"` because the frame is normalised space, not a survey: a 0..1
 * position means "three quarters of the way down", whatever the real room measures.
 */
import { parseShape, shapeToPath } from '@/lib/roomShape';

export function DataPlanShell({ plan }: { plan: unknown }) {
  return (
    <svg
      className="control-outlet-plan__shape"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={shapeToPath(parseShape(plan))} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
