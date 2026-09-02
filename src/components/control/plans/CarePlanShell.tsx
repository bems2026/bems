/**
 * The CARE office's own room shell — outline, glazed partition, sliding door.
 *
 * WHY IT CAME BACK. RM-044 replaced this with `DataPlanShell`, which draws whatever outline the
 * operator sketched and nothing else. That is right for any site — but for THIS one it lost the
 * partition and the door, and the Control plan became a bare rectangle. A room with a glazed
 * wall across it and a sliding door in the middle is a fact about this building, and the plan is
 * easier to read with it than without.
 *
 * SO IT IS A PACK, and that is the whole point of the arrangement: it lives in `plans/`, loads
 * only when `SITE.scene_pack` names it, and a replicated deployment never sees it. It draws no
 * device and knows no device id — positions come from `device_config` like everywhere else.
 * This is the building's ARCHITECTURE, not its inventory.
 *
 * IN THE ROOM'S FRAME, 0..1. The original drew in the 320x550 viewBox with the room inset 10px
 * on each side; the pins beside it are now room-relative, so a shell in the old frame would sit
 * a few percent off from every device on it. Re-expressed here rather than converted at render
 * time, so there is one frame on this card and no arithmetic to get wrong twice.
 */
import { CARE_PARTITION_Y, CARE_DOORWAY_HALF } from './carePreset';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export function CarePlanShell() {
  return (
    <>
      {/* The room itself fills the frame — the frame IS the room now, which is what makes the
          0..1 positions land where they were drawn. */}
      <div className="control-outlet-plan__outline" style={{ inset: 0 }} />
      <div
        className="control-outlet-plan__partition control-outlet-plan__partition--glass"
        style={{ top: pct(CARE_PARTITION_Y), left: 0, width: pct(0.5 - CARE_DOORWAY_HALF) }}
      />
      <div
        className="control-outlet-plan__partition control-outlet-plan__partition--glass"
        style={{ top: pct(CARE_PARTITION_Y), left: pct(0.5 + CARE_DOORWAY_HALF), width: pct(0.5 - CARE_DOORWAY_HALF) }}
      />
      {/* The sliding door fills the gap the two glass panels leave — the same doorway the 3D
          shell's `addGlazedPartition` cuts. */}
      <div
        className="control-outlet-plan__door"
        style={{ top: pct(CARE_PARTITION_Y), left: pct(0.5 - CARE_DOORWAY_HALF), width: pct(CARE_DOORWAY_HALF * 2) }}
      />
    </>
  );
}
