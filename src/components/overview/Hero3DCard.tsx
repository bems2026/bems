import { navigateTo } from '@/lib/useHashRoute';
import { SpatialView } from './SpatialView';

/**
 * v4's 3D hero card chrome (title, subtitle, "Switch a row ↗" link, legend strip) wrapping
 * the existing `SpatialView` (2D/3D toggle) unchanged. The overlay chips (lit count, ACU
 * state), the auto-rotate toggle, and "Open controls" live inside `OfficeScene3D` itself —
 * that's where the container ref and device-derived state already are, so they're layered
 * there rather than re-plumbed through this wrapper.
 */
export function Hero3DCard() {
  return (
    <div className="hero-3d-card">
      <div className="hero-3d-head">
        <div>
          <h3 className="hero-3d-title">NBERIC · CARE office</h3>
          <p className="hero-3d-sub">Live 3D model · drag to orbit, scroll to zoom, otherwise it rotates on its own</p>
        </div>
        <button type="button" className="hero-3d-link-btn" onClick={() => navigateTo('control')}>
          Switch a row ↗
        </button>
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
