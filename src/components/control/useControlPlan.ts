/**
 * Whether this deployment has a drawn Control-page plan, and what is in it — FI-016.
 *
 * SAME GATE AS THE 3D SCENE (RM-032), because it is the same claim: a drawn plan asserts that
 * this room looks like this and that these devices are here. At a site that never surveyed
 * either, drawing it is worse than drawing nothing, because it looks right.
 *
 * WHY A HOOK AND NOT A LAZY COMPONENT. `SpatialView` can `React.lazy` its pack because the pack
 * IS the rendered thing. Here the pack is DATA that two cards position their own interactive
 * controls from — the outlet puck with its two commandable halves, pending state and
 * corroboration is not something a plan module should own. So the module is imported for its
 * coordinates and the cards keep their controls.
 *
 * A site with no pack renders `null` here, and both cards fall back to a list of exactly the
 * same controls. Nothing is lost but the picture.
 */
import { useEffect, useState } from 'react';
import { SITE } from '@shared/siteConfig.mjs';

export interface ControlPlan {
  PlanShell: () => React.ReactNode;
  /** Device id -> position, 0..1 across and down. */
  OUTLET_POSITIONS: Record<string, { x: number; y: number }>;
  /** Device id -> the fixtures of that lighting circuit, 0..1. */
  LIGHT_POSITIONS: Record<string, { x: number; y: number }[]>;
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

export function useControlPlan(): ControlPlan | null {
  const [plan, setPlan] = useState<ControlPlan | null>(null);

  useEffect(() => {
    const load = SITE.scene_pack ? PLAN_PACKS[SITE.scene_pack] : undefined;
    if (!load) return;
    let cancelled = false;
    // A failed import leaves the list fallback in place rather than an error boundary. The
    // controls work either way; only the drawing is missing, and a broken picture must not take
    // the switches with it.
    load().then(
      (mod) => {
        if (!cancelled) setPlan(mod);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return plan;
}
