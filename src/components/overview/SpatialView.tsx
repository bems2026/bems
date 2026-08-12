import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';

// Lazy: OfficeScene3D pulls in the `three` chunk (~600KB), which shouldn't block Overview's
// first paint while it loads.
const OfficeScene3D = lazy(() => import('@/components/scene3d/OfficeScene3D').then((m) => ({ default: m.OfficeScene3D })));

/**
 * The CARE office view — 3D only. This used to also offer a 2D floor plan behind a toggle;
 * removed per explicit instruction to keep the Overview hero focused on the 3D model alone.
 * `FloorPlanView` isn't dead code from this change — `OfficeScene3D` still renders it as its
 * own fallback when WebGL genuinely isn't available (see that file), which is a capability
 * check, not a user choice, so it stays out of this component entirely.
 */
export function SpatialView() {
  return (
    <div className="spatial-view">
      <Suspense fallback={<Skeleton className="scene3d-container" height="100%" />}>
        <OfficeScene3D />
      </Suspense>
    </div>
  );
}
