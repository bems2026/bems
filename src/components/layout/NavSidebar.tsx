import { useConnectionStore } from '@/stores/connectionStore';
import type { ConnStatus } from '@/lib/bridgeClient';
import { NAV_ITEMS } from './navItems';

/** Matches the off-canvas breakpoint in `index.css`, ported from Bems.html:115-130. */
const MOBILE_BREAKPOINT = 900;

interface NavSidebarProps {
  collapsed: boolean;
  activeId: string;
  onToggleCollapse: () => void;
  /** Called when a nav item is clicked on a narrow viewport, to auto-close the drawer. */
  onNavigate: () => void;
}

const STATUS_LABEL: Record<ConnStatus, string> = {
  connected: 'Live',
  'polling-fallback': 'Live (polling)',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

export function NavSidebar({ collapsed, activeId, onToggleCollapse, onNavigate }: NavSidebarProps) {
  const wsStatus = useConnectionStore((s) => s.wsStatus);

  const handleNavClick = () => {
    if (window.innerWidth <= MOBILE_BREAKPOINT) onNavigate();
  };

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-header">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⌁
          </span>
          <span className="sidebar-title">iBEMS</span>
        </span>
        <button
          id="sidebarToggle"
          type="button"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>

      <div className="nav-group">Monitoring</div>
      <ul className="nav-list">
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <a
              className={`nav-item${item.id === activeId ? ' nav-item--active' : ''}`}
              href={`#${item.id}`}
              onClick={handleNavClick}
              aria-current={item.id === activeId ? 'true' : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="nav-label">{item.label}</span>
            </a>
          </li>
        ))}
      </ul>

      <div className="sidebar-footer">
        <span className={`status-dot status-dot--${wsStatus}`} aria-hidden="true" />
        <span className="sidebar-status-text">{STATUS_LABEL[wsStatus]}</span>
      </div>
    </aside>
  );
}
