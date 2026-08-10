import { useEffect, useState, type ReactNode } from 'react';
import { NavSidebar } from './NavSidebar';
import { ConnectionStatus } from '@/components/common/ConnectionStatus';

const COLLAPSE_KEY = 'ibems_sidebar_collapsed';
const MOBILE_BREAKPOINT = 900;

interface AppShellProps {
  children: ReactNode;
}

/**
 * CSS Grid shell + collapsible/off-canvas sidebar, ported from `Bems.html:72-130` — the
 * only one of the three legacy dashboards with a working collapse + off-canvas drawer.
 * The actual grid/breakpoint rules live in `index.css`; this component only owns state.
 */
export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Resizing back to desktop width should not leave a phantom open drawer behind.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > MOBILE_BREAKPOINT) setMobileOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const shellClass = ['app-shell', collapsed && 'collapsed', mobileOpen && 'mobile-open'].filter(Boolean).join(' ');

  return (
    <div className={shellClass}>
      <NavSidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} onNavigate={() => setMobileOpen(false)} />

      {mobileOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
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
          <span className="app-title">iBEMS — Building Energy Dashboard</span>
          <ConnectionStatus />
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
