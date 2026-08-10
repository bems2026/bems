import { lazy, Suspense, useEffect, useState } from 'react';
import { FloorPlanView } from '@/components/floorplan/FloorPlanView';

// Lazy: OfficeScene3D pulls in the `three` chunk (~600KB), which shouldn't block Overview's
// first paint for anyone who never opens the 3D view.
const OfficeScene3D = lazy(() => import('@/components/scene3d/OfficeScene3D').then((m) => ({ default: m.OfficeScene3D })));

const VIEW_KEY = 'ibems_spatial_view';
type ViewMode = '2d' | '3d';

/**
 * The 2D/3D toggle for the CARE office view. 3D is the default — it's the headline
 * feature — with 2D kept one click away since it's still the denser read for scanning all
 * 14 sockets at once, and it's the fallback `OfficeScene3D` renders itself if WebGL isn't
 * available, so this component never needs its own fallback-handling logic.
 *
 * `FloorPlanView` doubles as the Suspense fallback while the `three` chunk loads — so
 * switching to 3D for the first time shows the already-loaded 2D plan for a moment rather
 * than a blank spinner, then swaps in once ready.
 */
export function SpatialView() {
  const [mode, setMode] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) === '2d' ? '2d' : '3d'));

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, mode);
  }, [mode]);

  return (
    <div>
      <div className="spatial-toggle" role="group" aria-label="Floor plan view">
        <ToggleButton active={mode === '3d'} onClick={() => setMode('3d')}>
          3D
        </ToggleButton>
        <ToggleButton active={mode === '2d'} onClick={() => setMode('2d')}>
          2D
        </ToggleButton>
      </div>
      {mode === '3d' ? (
        <Suspense fallback={<FloorPlanView />}>
          <OfficeScene3D />
        </Suspense>
      ) : (
        <FloorPlanView />
      )}
    </div>
  );
}

/**
 * A plain pressed-toggle button, not `role="tab"`. Using the ARIA tabs pattern without its
 * required keyboard behavior (arrow-key roving focus, a linked `role="tabpanel"`) is worse
 * for screen reader users than not using it at all — it announces affordances that don't
 * work. `aria-pressed` is the correct, fully-supported semantic for a 2-state toggle.
 */
function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`spatial-toggle__btn${active ? ' spatial-toggle__btn--active' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
