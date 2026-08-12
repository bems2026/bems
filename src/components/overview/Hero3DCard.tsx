import { Box } from 'lucide-react';
import { InfoHint } from '@/components/ui/InfoHint';
import { SpatialView } from './SpatialView';

/**
 * v4's 3D hero card chrome (title, subtitle, legend strip) wrapping `SpatialView`. No link
 * to Control from here — "Switch a row"/"Open controls" (this card's own and
 * `OfficeScene3D`'s) were removed so Quick Control's "Open controls ↗" is the single place
 * to navigate to Control from Overview, not three buttons saying the same thing. The overlay
 * chips (lit count, ACU state) and the auto-rotate toggle still live inside `OfficeScene3D`
 * itself — that's where the container ref and device-derived state already are.
 */
export function Hero3DCard() {
  return (
    <div className="hero-3d-card">
      <div className="hero-3d-head">
        <div>
          <h3 className="hero-3d-title">
            <Box size={16} className="title-icon" aria-hidden="true" />
            NBERIC · CARE office
          </h3>
          <p className="hero-3d-sub">
            Live 3D model
            <InfoHint label="How to move around">Drag to orbit, scroll to zoom — otherwise it rotates on its own.</InfoHint>
          </p>
        </div>
      </div>
      <SpatialView />
      <div className="hero-3d-legend">
        <span>
          <span className="hero-3d-legend__swatch" style={{ background: 'var(--accent)' }} aria-hidden="true" />
          CEILING PANEL LIT
        </span>
        <span>
          <span className="hero-3d-legend__swatch" style={{ background: 'var(--faint)' }} aria-hidden="true" />
          PANEL OFF
        </span>
        <span className="hero-3d-legend__spacer">21 luminaires · 3 per row · 7 row switches</span>
      </div>
    </div>
  );
}
