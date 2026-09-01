/**
 * Whether this deployment has a Control-page plan, where it came from, and what is in it —
 * FI-016, RM-037.
 *
 * THREE SOURCES, IN THIS ORDER.
 *
 *   1. **What somebody drew.** Positions and lamps from `device_config`, for the room the card is
 *      showing (`src/lib/controlPlanData.ts`). This is the one that works at any site.
 *   2. **The build-time pack.** `SITE.scene_pack` → `carePlan.ts`, hand-surveyed coordinates for
 *      one office. Kept ON PURPOSE AND TEMPORARILY: deleting it in the same change would leave
 *      the CARE office with no plan between this deploy and the moment somebody draws its room.
 *      Once that room is drawn and verified, the pack and its coordinates go — that deletion is
 *      the close of FI-016's remaining half and of the last hard-coded building geometry in the
 *      frontend.
 *   3. **Nothing**, and both cards say so and fall back to a list of the same controls.
 *
 * SAME GATE AS THE 3D SCENE (RM-032), because it is the same claim: a drawn plan asserts that
 * this room looks like this and that these devices are here. At a site that surveyed neither,
 * drawing it is worse than drawing nothing, because it looks right.
 *
 * WHY A HOOK AND NOT A LAZY COMPONENT. `SpatialView` can `React.lazy` its pack because the pack
 * IS the rendered thing. Here the plan is DATA that two cards position their own interactive
 * controls from — the outlet puck with its two commandable halves, pending state and
 * corroboration is not something a plan module should own. So the plan is consumed for its
 * coordinates and the cards keep their controls.
 */
import { useEffect, useMemo, useState } from 'react';
import { SITE } from '@shared/siteConfig.mjs';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import { drawnRooms, dataPlanFor, type DrawnRoom } from '@/lib/controlPlanData';
import { DataPlanShell } from './plans/DataPlanShell';

export interface ControlPlan {
  PlanShell: () => React.ReactNode;
  /** Device id -> position, 0..1 across and down. */
  OUTLET_POSITIONS: Record<string, { x: number; y: number }>;
  /** Device id -> the fixtures of that lighting circuit, 0..1. */
  LIGHT_POSITIONS: Record<string, { x: number; y: number }[]>;
}

export interface ControlPlanState {
  plan: ControlPlan | null;
  /** Where `plan` came from. The cards use it to say which room they are showing — a picker over
   * the pack would be a picker with nothing to pick. */
  source: 'data' | 'pack' | null;
  /** Rooms with something drawn in them. Empty unless `source` is `'data'`. */
  rooms: DrawnRoom[];
  roomId: string | null;
  setRoomId: (id: string) => void;
}

/** Packs this build carries. A site naming one that was never built degrades to the list rather
 * than throwing on an import that cannot resolve — a mistake in a site directory must not take
 * the Control page down, which is the surface an operator reaches for when something is wrong. */
const PLAN_PACKS: Record<string, () => Promise<ControlPlan>> = {
  // Two imports because the pack's data and its shell live in separate modules: a file exporting
  // both a component and constants breaks fast refresh. They resolve together, so the card never
  // sees a half-loaded pack.
  care: async () => {
    const [data, shell] = await Promise.all([import('./plans/carePlan'), import('./plans/PlanShell')]);
    return { ...data, PlanShell: shell.PlanShell };
  },
};

export function useControlPlan(): ControlPlanState {
  const [pack, setPack] = useState<ControlPlan | null>(null);
  const saved = useDeviceConfigStore((s) => s.saved);
  const nodes = useSpaceTreeStore((s) => s.nodes);

  const rooms = useMemo(() => drawnRooms(saved, nodes), [saved, nodes]);
  const [chosen, setChosen] = useState<string | null>(null);
  // A room the operator picked, unless it stopped being drawn — then the first drawn one, so the
  // card never shows an empty frame because a device moved out of the room being displayed.
  const roomId = chosen !== null && rooms.some((r) => r.id === chosen) ? chosen : (rooms[0]?.id ?? null);

  const data = useMemo(() => dataPlanFor(saved, roomId), [saved, roomId]);
  const shape = useMemo(() => nodes.find((n) => n.id === roomId)?.attrs, [nodes, roomId]);

  useEffect(() => {
    const load = SITE.scene_pack ? PLAN_PACKS[SITE.scene_pack] : undefined;
    if (!load) return;
    let cancelled = false;
    // A failed import leaves the list fallback in place rather than an error boundary. The
    // controls work either way; only the drawing is missing, and a broken picture must not take
    // the switches with it.
    load().then(
      (mod) => {
        if (!cancelled) setPack(mod);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const plan = useMemo<ControlPlan | null>(() => {
    if (data) {
      const attrs = shape as { plan?: unknown } | undefined;
      return { ...data, PlanShell: () => DataPlanShell({ plan: attrs?.plan }) };
    }
    return pack;
  }, [data, shape, pack]);

  return {
    plan,
    source: data ? 'data' : plan ? 'pack' : null,
    rooms: data ? rooms : [],
    roomId: data ? roomId : null,
    setRoomId: setChosen,
  };
}
