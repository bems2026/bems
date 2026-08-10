import { useEffect, useRef, useState } from 'react';
import { SpatialView } from './SpatialView';
import { EnergyRing } from './EnergyRing';
import { PhaseBalance } from './PhaseBalance';
import { DeviceStatusList } from './DeviceStatusList';
import { ComfortCard } from './ComfortCard';

/**
 * The hero card: the CARE Office 3D/2D view flanked by energy and status cards, per the
 * approved reference layout (images 2 and 5 both make the room render the centerpiece of
 * Overview). `.hero-grid`'s three columns collapse to a single stack below 1200px, with
 * the spatial view first — see the `grid-template-areas` swap in index.css.
 *
 * The fullscreen button is a thin wrapper over the standard Fullscreen API.
 * `isFullscreen` is driven only by the `fullscreenchange` event, not an optimistic local
 * toggle — the Fullscreen API is inherently display-dependent (headless/automated contexts
 * commonly deny it outright), so this stays correct in a real browser without pretending
 * to have toggled something a permission denial silently blocked.
 */
export function OverviewHero() {
  const heroRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === heroRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      heroRef.current?.requestFullscreen?.().catch(() => {});
    }
  };

  return (
    <div ref={heroRef} className={`hero-card${isFullscreen ? ' hero-card--fullscreen' : ''}`}>
      <div className="hero-card__head">
        <h3 className="card-title">CARE Office</h3>
        <button
          type="button"
          className="hero-expand-btn"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Expand to fullscreen'}
        >
          {isFullscreen ? '⤡' : '⤢'}
        </button>
      </div>
      <div className="hero-grid">
        <div className="hero-col hero-col--left">
          <EnergyRing />
          <PhaseBalance />
        </div>
        <div className="hero-col hero-col--center">
          <SpatialView />
        </div>
        <div className="hero-col hero-col--right">
          <DeviceStatusList />
          <ComfortCard />
        </div>
      </div>
    </div>
  );
}
