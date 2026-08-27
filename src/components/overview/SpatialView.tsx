import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { SITE } from '@shared/siteConfig.mjs';

/**
 * The site's spatial hero — RM-032.
 *
 * `scene3d/` is ~83 KB describing the CARE office, and `geometry.ts`'s own header says so
 * ("Spatial layout for the CARE office 3D scene"). It is good work and genuinely site-specific,
 * so this gates it on the site's declared pack rather than trying to generalise it. Generic,
 * data-driven 3D is a separate phase with no dependency on this one.
 *
 * WHAT "SHIPS NONE OF THE GEOMETRY" ACTUALLY MEANS HERE, stated precisely because it would be
 * easy to overclaim: the chunk is still BUILT — the import below is in the module graph — but it
 * is never FETCHED unless a matching pack renders. A site with no pack downloads none of it,
 * which is the cost that matters. Removing it from the build too would mean the site directory
 * owning the import, which is a larger restructure than this phase needs.
 *
 * WHY THE FALLBACK IS NOT `FloorPlanView`, which would be the obvious choice: the 2D plan pins
 * `co1..co7` to literal SVG coordinates, so it is CARE-specific in exactly the same way. At
 * another site it would draw that site's devices into this site's room — worse than drawing
 * nothing, because it looks right. Until RM-031 makes the plan data-driven, the honest answer is
 * to say no view is configured. (`OfficeScene3D` still uses `FloorPlanView` as its own
 * WebGL-unavailable fallback, which is a capability check within one site and stays correct.)
 */

/** Packs this build actually carries. A site naming something else degrades to "no view" rather
 * than throwing on an import that cannot resolve — a mistake in a site directory should not take
 * the Overview page down. */
const SCENE_PACKS: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  care: lazy(() => import('@/components/scene3d/OfficeScene3D').then((m) => ({ default: m.OfficeScene3D }))),
};

export function SpatialView() {
  const Scene = SITE.scene_pack ? SCENE_PACKS[SITE.scene_pack] : undefined;

  if (!Scene) {
    return (
      <div className="spatial-view spatial-view--none">
        <p className="spatial-view__note">
          No 3D view is configured for this site. The model is built per building; until one
          exists here, device status is on the Devices and Control pages.
        </p>
      </div>
    );
  }

  return (
    <div className="spatial-view">
      {/* Lazy so the scene does not block Overview's first paint while `three` loads. */}
      <Suspense fallback={<Skeleton className="scene3d-container" height="100%" />}>
        <Scene />
      </Suspense>
    </div>
  );
}
