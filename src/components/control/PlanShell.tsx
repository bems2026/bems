import { PLAN } from '@/components/scene3d/geometry';
import { VB_W, VB_H, pct, DOORWAY_HALF_PX } from './planGeometry';

/**
 * The room shell both Control plans draw: outline, the two glazed partition panels, and the
 * sliding door filling the gap between them. Shared rather than copied into each card so
 * the lighting and outlet plans can't drift into showing different rooms — the same reason
 * `LIGHT_PLAN` is the single source of the light grid for both the 2D and 3D views.
 */
export function PlanShell() {
  const midX = (PLAN.x0 + PLAN.x1) / 2;
  return (
    <>
      <div
        className="control-outlet-plan__outline"
        style={{ left: pct(PLAN.x0, VB_W), top: pct(PLAN.y0, VB_H), right: pct(VB_W - PLAN.x1, VB_W), bottom: pct(VB_H - PLAN.y1, VB_H) }}
      />
      <div
        className="control-outlet-plan__partition control-outlet-plan__partition--glass"
        style={{ top: pct(PLAN.partitionY, VB_H), left: pct(PLAN.x0, VB_W), width: pct(midX - DOORWAY_HALF_PX - PLAN.x0, VB_W) }}
      />
      <div
        className="control-outlet-plan__partition control-outlet-plan__partition--glass"
        style={{ top: pct(PLAN.partitionY, VB_H), left: pct(midX + DOORWAY_HALF_PX, VB_W), width: pct(PLAN.x1 - (midX + DOORWAY_HALF_PX), VB_W) }}
      />
      {/* The sliding door fills the gap the two glass panels leave — same doorway gap the
          3D shell's `addGlazedPartition` cuts. */}
      <div
        className="control-outlet-plan__door"
        style={{ top: pct(PLAN.partitionY, VB_H), left: pct(midX - DOORWAY_HALF_PX, VB_W), width: pct(DOORWAY_HALF_PX * 2, VB_W) }}
      />
    </>
  );
}
