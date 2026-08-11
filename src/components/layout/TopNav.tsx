import { Zap } from 'lucide-react';
import { NAV_ITEMS } from './navItems';
import { AlertsPopover } from './AlertsPopover';
import { navigateTo } from '@/lib/useHashRoute';
import { useConnectionStore } from '@/stores/connectionStore';
import { isStale } from '@/lib/bridgeClient';
import type { ConnStatus } from '@/lib/bridgeClient';
import { useEffect, useState } from 'react';

const LIVE_LABEL: Record<ConnStatus, string> = {
  connected: 'LIVE',
  'polling-fallback': 'LIVE (POLL)',
  reconnecting: 'RECONNECTING',
  offline: 'OFFLINE',
};

/** v4's nav shows a pausable "LIVE"/"HELD" pill over a client-simulated tick — this app has
 * no tick to pause; the pill instead reflects the real WS/poll connection state, which is
 * the honest equivalent (a held/paused feed and a degraded connection read the same to the
 * person looking at the dashboard, and only one of them is real here). */
function livePillTone(status: ConnStatus): '' | '--warn' | '--bad' {
  if (status === 'connected') return '';
  if (status === 'offline') return '--bad';
  return '--warn';
}

/**
 * Sticky glass top nav — replaces Phase L's collapsible sidebar. Three zones: brand (left,
 * fixed width), pill tabs (centre, flexes and scrolls horizontally rather than wrapping),
 * live status + alerts (right, fixed width).
 */
export function TopNav({ activeId }: { activeId: string }) {
  const wsStatus = useConnectionStore((s) => s.wsStatus);
  const lastMessageAt = useConnectionStore((s) => s.lastMessageAt);

  // Same "re-render on wall-clock time" pattern as StaleDataBadge/AlertsPopover — staleness
  // is a function of elapsed time, not just store writes.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const stale = isStale(lastMessageAt ? Date.parse(lastMessageAt) : null);
  const tone = stale && wsStatus === 'connected' ? '--warn' : livePillTone(wsStatus);

  return (
    <nav className="top-nav" aria-label="Main">
      <a className="nav-brand" href="#overview">
        <span className="nav-brand-mark" aria-hidden="true">
          <Zap size={15} strokeWidth={2.5} />
        </span>
        <span className="nav-brand-name">iBEMS</span>
        <span className="nav-site-chip">MMSU CARE Office · NBERIC</span>
      </a>

      <div className="nav-tabs" role="tablist" aria-label="Pages">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === activeId}
            className={`nav-tab${item.id === activeId ? ' nav-tab--active' : ''}`}
            onClick={() => navigateTo(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="nav-right">
        <span className={`nav-live-pill${tone}`} role="status" aria-live="polite">
          <span className="nav-live-dot" aria-hidden="true" />
          {LIVE_LABEL[wsStatus]}
        </span>
        <AlertsPopover />
      </div>
    </nav>
  );
}
