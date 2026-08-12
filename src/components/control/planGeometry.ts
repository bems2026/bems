/** The 2D plan's own coordinate space — the same 320x550 viewBox `FloorPlanView` draws in. */
export const VB_W = 320;
export const VB_H = 550;

export const pct = (px: number, total: number) => `${((px / total) * 100).toFixed(2)}%`;

/** The glazed partition's real doorway gap (`officeScene.ts`'s `addGlazedPartition`)
 * mirrored here in plan-space — 1.6m centered on the room's x-midpoint, converted at the
 * same 1 SVG unit = 2cm scale `geometry.ts` uses. */
export const DOORWAY_HALF_PX = 40;
