import { useEffect, useState, type ReactNode } from 'react';
import { NavSidebar } from './NavSidebar';
import { NAV_ITEMS } from './navItems';
import { ConnectionStatus } from '@/components/common/ConnectionStatus';
import { pickActiveSection } from '@/lib/scrollSpy';

const COLLAPSE_KEY = 'ibems_sidebar_collapsed';
const MOBILE_BREAKPOINT = 900;

interface AppShellProps {
  children: ReactNode;
}

/**
 * CSS Grid shell + collapsible/off-canvas sidebar. Layout behaviour is ported from
 * `Bems.html:72-130` — the only one of the three legacy dashboards with a working collapse
 * and drawer. Grid/breakpoint rules live in `index.css`; this component owns state only.
 */
export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeId, setActiveId] = useState(NAV_ITEMS[0].id);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Resizing back to desktop shouldn't leave a phantom open drawer behind.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > MOBILE_BREAKPOINT) setMobileOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Scroll-spy. Two deliberate choices, both for the same reason:
  //   - a scroll listener rather than IntersectionObserver (see `lib/scrollSpy.ts`), and
  //   - a timer throttle rather than requestAnimationFrame.
  // Both IO and rAF deliver on the rendering lifecycle, which is silent in non-compositing
  // environments — verified in this project's headless pane, where rAF, scroll events, IO
  // and RO all fire zero times while setTimeout works normally. A timer throttle behaves
  // identically for a 3-section nav and stays observable. 100ms is well below the
  // threshold where a nav highlight feels laggy.
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;

    const measure = () => {
      pending = null;
      const rects = NAV_ITEMS.map((i) => {
        const el = document.getElementById(i.id);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { id: i.id, top: r.top, bottom: r.bottom };
      }).filter((r): r is { id: string; top: number; bottom: number } => !!r);

      const next = pickActiveSection(rects, window.innerHeight);
      if (next) setActiveId((prev) => (prev === next ? prev : next));
    };

    const onScroll = () => {
      if (!pending) pending = setTimeout(measure, 100);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (pending) clearTimeout(pending);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const shellClass = ['app-shell', collapsed && 'collapsed', mobileOpen && 'mobile-open'].filter(Boolean).join(' ');

  return (
    <div className={shellClass}>
      <NavSidebar
        collapsed={collapsed}
        activeId={activeId}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        onNavigate={() => setMobileOpen(false)}
      />

      {mobileOpen && (
        <button type="button" className="sidebar-scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
      )}

      <div className="app-main">
        <header className="app-topbar">
          <button
            id="mobileMenuBtn"
            type="button"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            ☰
          </button>
          {/* The page's only <h1> — was a plain <span>; every page needs exactly one. */}
          <h1 className="app-title">CARE Office</h1>
          <ConnectionStatus />
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
