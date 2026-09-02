/**
 * Whether this deployment has a Control-page plan, where it came from, and what is in it —
 * FI-016, RM-037.
 *
 * TWO SOURCES NOW.
 *
 *   1. **What somebody drew.** Positions and lamps from `device_config`, for the room the card is
 *      showing (`src/lib/controlPlanData.ts`). This is the one that works at any site.
 *   2. **Nothing**, and both cards say so and fall back to a list of the same controls.
 *
 * THERE USED TO BE A THIRD, between them: a build-time pack of hand-surveyed coordinates for one
 * office, loaded when `SITE.scene_pack` named it. It was kept only until that office was actually
 * drawn, and on 2026-09-02 it was — 7 outlets positioned and 7 circuits of 3 lamps each, in the
 * `CARE Office` node. The coordinates were not thrown away: they became the `care-office` preset
 * (`src/lib/planPresets.ts`, RM-044), which anyone can apply to any room and then edit. That is
 * the close of FI-016's remaining half, and of the last hard-coded building geometry here.
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
import { parseAspect } from '@/lib/roomShape';

/** Room shells this build carries — see `siteShell` below. A site naming one that was never
 * built falls back to the sketched outline rather than throwing on an unresolvable import. */
const SHELL_PACKS: Record<string, () => Promise<() => React.ReactNode>> = {
  care: async () => (await import('./plans/CarePlanShell')).CarePlanShell,
};

export interface ControlPlan {
  PlanShell: () => React.ReactNode;
  /** Device id -> position, 0..1 across and down. */
  OUTLET_POSITIONS: Record<string, { x: number; y: number }>;
  /** Device id -> the fixtures of that lighting circuit, 0..1. */
  LIGHT_POSITIONS: Record<string, { x: number; y: number }[]>;
}

export interface ControlPlanState {
  plan: ControlPlan | null;
  /** The room's width over its height, or null when nobody has said. The card uses it so a tall
   * narrow room is not drawn as a square — RM-044. */
  aspect: number | null;
  /** `'data'` when a room is drawn, `null` when none is. Kept as a named source rather than
   * folded into `plan !== null` because the cards read it to decide whether to offer a room
   * picker at all, and because a third source existed until 2026-09-02 and may again. */
  source: 'data' | null;
  /** Rooms with something drawn in them. Empty unless `source` is `'data'`. */
  rooms: DrawnRoom[];
  roomId: string | null;
  setRoomId: (id: string) => void;
}

export function useControlPlan(): ControlPlanState {
  const saved = useDeviceConfigStore((s) => s.saved);
  const nodes = useSpaceTreeStore((s) => s.nodes);

  const rooms = useMemo(() => drawnRooms(saved, nodes), [saved, nodes]);
  const [chosen, setChosen] = useState<string | null>(null);
  // A room the operator picked, unless it stopped being drawn — then the first drawn one, so the
  // card never shows an empty frame because a device moved out of the room being displayed.
  const roomId = chosen !== null && rooms.some((r) => r.id === chosen) ? chosen : (rooms[0]?.id ?? null);

  const data = useMemo(() => dataPlanFor(saved, roomId), [saved, roomId]);
  const shape = useMemo(() => nodes.find((n) => n.id === roomId)?.attrs, [nodes, roomId]);
  const aspect = useMemo(() => parseAspect((shape as { plan?: unknown } | undefined)?.plan), [shape]);

  /**
   * A site's own room shell, if it has one — RM-044.
   *
   * `DataPlanShell` draws whatever outline was sketched and nothing else, which is right for any
   * site and lost this office its glazed partition and sliding door. Those are facts about a
   * building, so they live in a pack: loaded only when `SITE.scene_pack` names it, drawing no
   * device and knowing no device id. A replicated deployment gets the sketched outline.
   */
  const [siteShell, setSiteShell] = useState<(() => React.ReactNode) | null>(null);
  useEffect(() => {
    const load = SITE.scene_pack ? SHELL_PACKS[SITE.scene_pack] : undefined;
    if (!load) return;
    let cancelled = false;
    // A failed import leaves the sketched outline in place rather than an error boundary: the
    // controls work either way and a missing decoration must not take the switches with it.
    load().then(
      (Shell) => {
        if (!cancelled) setSiteShell(() => Shell);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const plan = useMemo<ControlPlan | null>(() => {
    if (!data) return null;
    const attrs = shape as { plan?: unknown } | undefined;
    return { ...data, PlanShell: siteShell ?? (() => DataPlanShell({ plan: attrs?.plan })) };
  }, [data, shape, siteShell]);

  return {
    plan,
    aspect,
    source: data ? 'data' : null,
    rooms: data ? rooms : [],
    roomId: data ? roomId : null,
    setRoomId: setChosen,
  };
}
