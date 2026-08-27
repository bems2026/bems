import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * RM-032 — the 3D scene is one site's scene, and only that site should load it.
 *
 * `scene3d/` is ~83 KB describing the CARE office; `geometry.ts`'s own header says so. It is
 * good work and genuinely site-specific, so the fix is to gate it rather than generalise it.
 *
 * WHY THE FALLBACK IS NOT `FloorPlanView`. That would be the obvious choice and it is wrong:
 * the 2D plan pins `co1..co7` to literal SVG coordinates, so it is CARE-specific too. Rendering
 * it at another site would draw that site's devices into this site's room. Until RM-031 makes
 * the plan data-driven, the honest answer is to say no spatial view is configured.
 */
const scene = vi.hoisted(() => ({ pack: 'care' as string | null }));
vi.mock('@shared/siteConfig.mjs', () => ({
  get SITE() {
    return { id: 'test-site', display_name: 'Test', timezone: 'UTC', utc_offset_minutes: 0, scene_pack: scene.pack, policy: {} };
  },
}));

// The real scene needs WebGL, which jsdom has none of. This asserts WHETHER it is reached, not
// what it draws — that is `officeScene`'s own business.
vi.mock('@/components/scene3d/OfficeScene3D', () => ({
  OfficeScene3D: () => <div data-testid="office-scene" />,
}));

const { SpatialView } = await import('./SpatialView');

describe('SpatialView', () => {
  beforeEach(() => {
    cleanup();
    scene.pack = 'care';
  });

  it('renders the scene when this site declares that pack', async () => {
    render(<SpatialView />);
    expect(await screen.findByTestId('office-scene')).toBeInTheDocument();
  });

  it('renders no scene at all when the site declares none', () => {
    scene.pack = null;
    render(<SpatialView />);
    expect(screen.queryByTestId('office-scene')).not.toBeInTheDocument();
  });

  it('says why there is nothing to see, rather than leaving an empty frame', () => {
    // A blank hero is indistinguishable from a scene that failed to load. Naming the reason is
    // what tells an operator at a new site that this is expected rather than broken.
    scene.pack = null;
    render(<SpatialView />);
    expect(screen.getByText(/no 3d view/i)).toBeInTheDocument();
  });

  it('does not fall back to the 2D floor plan, which is also built for one office', () => {
    // FloorPlanView pins co1..co7 to fixed coordinates. At another site it would draw that
    // site's devices into this site's room, which is worse than drawing nothing.
    scene.pack = null;
    const { container } = render(<SpatialView />);
    expect(container.querySelector('.floorplan-grid')).toBeNull();
    expect(container.querySelector('.floorplan-svg')).toBeNull();
  });

  it('ignores a pack name this build does not carry', () => {
    // A site directory naming a pack that was never built must degrade to "no view" rather than
    // throwing on a dynamic import that cannot resolve.
    scene.pack = 'some-other-building';
    render(<SpatialView />);
    expect(screen.queryByTestId('office-scene')).not.toBeInTheDocument();
    expect(screen.getByText(/no 3d view/i)).toBeInTheDocument();
  });
});
