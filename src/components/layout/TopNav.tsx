import { Zap, Moon, Sun } from 'lucide-react';
import { NAV_ITEMS } from './navItems';
import { AlertsPopover } from './AlertsPopover';
import { AccountMenu } from './AccountMenu';
import { useConnectionStore } from '@/stores/connectionStore';
import { useThemeStore } from '@/stores/themeStore';
import { isStale } from '@/lib/bridgeClient';
import type { ConnStatus } from '@/lib/bridgeClient';
import { useEffect, useRef } from 'react';
import { useNowTick } from '@/lib/useNowTick';
import { SITE } from '@shared/siteConfig.mjs';

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
 * Publishes the nav's real rendered height onto `--nav-h-live` (a NEW custom property,
 * deliberately not `--nav-h` — that token already feeds `.top-nav`'s own `min-height`, so
 * writing the measured height back into it would create a feedback loop). CSS reads this
 * to keep the sticky nav from covering whatever it's sitting on top of (route-change
 * scroll targets, the skip link) — see index.css's `scroll-padding-top`/`scroll-margin-top`.
 *
 * A live measurement, not the static --nav-h constant, because the nav is NOT one height:
 * below the 860px breakpoint it wraps to a second row and roughly doubles (measured ~64px
 * desktop vs ~127px at 375px — see index.css's `@media (max-width: 860px)` block). A fixed
 * offset sized for desktop would under-clear the wrapped mobile nav.
 */
function useNavHeight(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // getBoundingClientRect(), not ResizeObserver's own contentRect — contentRect excludes
    // border, and the nav has a 1px border-bottom (see index.css's .top-nav), so the
    // border-box measurement is the one that actually matches what covers the page below it.
    const publish = () => document.documentElement.style.setProperty('--nav-h-live', `${el.getBoundingClientRect().height}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

/**
 * Sticky glass top nav — replaces Phase L's collapsible sidebar. Three zones: brand (left,
 * fixed width), pill tabs (centre, flexes and scrolls horizontally rather than wrapping),
 * live status + alerts (right, fixed width).
 */
export function TopNav({ activeId }: { activeId: string }) {
  const wsStatus = useConnectionStore((s) => s.wsStatus);
  const lastMessageAt = useConnectionStore((s) => s.lastMessageAt);

  // Staleness is a function of elapsed time, not just store writes. This used to be one of
  // five separate 1s intervals saying "same pattern as X"; they now share one.
  useNowTick();

  const navRef = useRef<HTMLElement>(null);
  useNavHeight(navRef);

  const stale = isStale(lastMessageAt ? Date.parse(lastMessageAt) : null);
  const tone = stale && wsStatus === 'connected' ? '--warn' : livePillTone(wsStatus);

  return (
    <nav ref={navRef} className="top-nav" aria-label="Main">
      <a className="nav-brand" href="#overview">
        <span className="nav-brand-mark" aria-hidden="true">
          <Zap size={15} strokeWidth={2.5} />
        </span>
        <span className="nav-brand-name">iBEMS</span>
        {/* The building this deployment serves, from the site module. It was a literal until
            2026-08-31, so every deployment displayed the CARE office's name in its header. */}
        <span className="nav-site-chip">{SITE.display_name}</span>
      </a>

      {/*
        Links, not `role="tab"` buttons. The previous markup declared the full ARIA tab
        contract — `role="tablist"`, `role="tab"`, `aria-selected` — while implementing none
        of what that contract obliges: there is no `tabpanel`, no `aria-controls`, and no
        arrow-key roving focus, so a screen reader user was promised a widget that doesn't
        behave like one. These are five URLs, and `aria-current="page"` is the pattern that
        actually describes them. Bonus: middle-click, ⌘-click, and "copy link address" now
        work on the app's primary navigation, which they never did on a <button>.
      */}
      <div className="nav-tabs">
        {NAV_ITEMS.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={item.id === activeId ? 'page' : undefined}
            className={`nav-tab${item.id === activeId ? ' nav-tab--active' : ''}`}
          >
            {item.label}
          </a>
        ))}
      </div>

      <div className="nav-right">
        <span className={`nav-live-pill${tone}`} role="status" aria-live="polite">
          <span className="nav-live-dot" aria-hidden="true" />
          {LIVE_LABEL[wsStatus]}
        </span>
        <ThemeToggle />
        <AlertsPopover />
        <AccountMenu activeId={activeId} />
      </div>
    </nav>
  );
}

/** Manual light/dark toggle — see themeStore.ts's header for why this is manual rather
 * than following the OS's prefers-color-scheme (a 24/7 kiosk, not a personal device). */
function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const dark = theme === 'dark';

  return (
    <button type="button" className="nav-theme-toggle" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={dark} onClick={toggle}>
      {dark ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
    </button>
  );
}

