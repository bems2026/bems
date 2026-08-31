import { Box } from 'lucide-react';
import { InfoHint } from '@/components/ui/InfoHint';
import { SpatialView } from './SpatialView';
import { SITE } from '@shared/siteConfig.mjs';

/**
 * v4's 3D hero card chrome (title, subtitle) wrapping `SpatialView`. No link to Control from
 * here — "Switch a row"/"Open controls" (this card's own and `OfficeScene3D`'s) were removed
 * so Quick Control's header link is the single place to navigate to Control from
 * Overview, not three buttons saying the same thing. The overlay chips (lit count, ACU
 * state), the auto-rotate/top-down/reset-view controls, and the Edit Layout toolbar all live
 * inside `OfficeScene3D` itself — that's where the container ref and device-derived state
 * already are.
 *
 * The legend strip that used to sit below `SpatialView` ("CEILING PANEL LIT"/"PANEL
 * OFF"/luminaire count) is gone per explicit instruction — `SpatialView`'s `flex: 1` means
 * the model itself grows to fill the height that freed, not a blank gap.
 */
export function Hero3DCard() {
  return (
    <div className="hero-3d-card">
      <div className="hero-3d-head">
        <div>
          <h3 className="hero-3d-title">
            <Box size={16} className="title-icon" aria-hidden="true" />
            {SITE.display_name}
          </h3>
          <p className="hero-3d-sub">
            Live 3D model
            <InfoHint label="How to move around">Drag to orbit, scroll to zoom — otherwise it rotates on its own.</InfoHint>
          </p>
        </div>
      </div>
      <SpatialView />
    </div>
  );
}
