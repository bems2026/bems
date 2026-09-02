import { describe, it, expect } from 'vitest';
import { toRoomFrame } from './planPresets';
import { PLAN } from '@/components/scene3d/geometry';
import { VB_W, VB_H } from '@/components/control/planGeometry';

/**
 * RM-044. The machinery every deployment gets. The LAYOUTS live in
 * `src/components/control/plans/`, which is where a building may name its own devices — see
 * `carePreset.test.ts` for those.
 *
 * The trap these exist for is a change of frame. The pack's numbers are normalised against the
 * 320x550 **viewBox**; `plan_x`/`plan_y` mean "where in this ROOM", and the room is inset 10px
 * on every side. Copying one into the other looks right — every value is still a plausible
 * 0..1 — and puts every device a few percent out, consistently, in a way nothing would flag.
 */

describe('toRoomFrame', () => {
  it('re-bases a viewBox coordinate onto the room rectangle', () => {
    // co1 sat at px=25 of 320. Against the room (10..310) that is 15/300, not 25/320.
    expect(toRoomFrame(25 / VB_W, 470 / VB_H)).toEqual({
      x: (25 - PLAN.x0) / (PLAN.x1 - PLAN.x0),
      y: (470 - PLAN.y0) / (PLAN.y1 - PLAN.y0),
    });
  });

  it('puts the room corners exactly on the frame corners', () => {
    expect(toRoomFrame(PLAN.x0 / VB_W, PLAN.y0 / VB_H)).toEqual({ x: 0, y: 0 });
    expect(toRoomFrame(PLAN.x1 / VB_W, PLAN.y1 / VB_H)).toEqual({ x: 1, y: 1 });
  });

  it('is not the identity, which is the whole point', () => {
    // If this ever became a no-op the preset would still apply and still look plausible.
    const p = toRoomFrame(25 / VB_W, 470 / VB_H);
    expect(p.x).not.toBeCloseTo(25 / VB_W, 5);
  });
});
