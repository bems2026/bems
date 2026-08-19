import { useEffect, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { NAV_ITEMS } from '@/components/layout/navItems';
import { useHashRoute } from '@/lib/useHashRoute';
import { useLiveConnection } from '@/hooks/useLiveConnection';
import { OverviewPage } from '@/components/overview/OverviewPage';
import { DevicesView } from '@/components/devices/DevicesView';
import { ControlPage } from '@/components/control/ControlPage';
import { AnalyticsPage } from '@/components/analytics/AnalyticsPage';
import { AutomationPage } from '@/components/automation/AutomationPage';
import { LoginPage } from '@/components/auth/LoginPage';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/config/supabase';

const ROUTE_IDS = NAV_ITEMS.map((n) => n.id);

/**
 * Auth gate — Phase 5 of the architecture plan. Only active when Supabase is configured
 * (`supabase !== null`); with no Supabase project set up, this renders `AuthenticatedApp`
 * unconditionally, so every phase before Phase 5 keeps working exactly as it did. See
 * `authStore.ts`'s `init()` for the matching fallback.
 */
export function App() {
  const authRequired = supabase !== null;
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (authRequired) useAuthStore.getState().init();
  }, [authRequired]);

  if (!authRequired) return <AuthenticatedApp />;
  if (status === 'checking') return null; // brief — avoids a login-page flash while a persisted session is checked
  if (status !== 'authenticated') return <LoginPage />;
  return <AuthenticatedApp />;
}

/** Every page is now fully rebuilt to the v4 design and owns its own header — Overview
 * (M2), Control + Devices (M3), Analytics + Automation (M4). */
function AuthenticatedApp() {
  useLiveConnection();
  const activeId = useHashRoute(ROUTE_IDS, 'overview');
  useRouteAnnouncement(activeId);

  return (
    <AppShell activeId={activeId}>
      {activeId === 'overview' && <OverviewPage />}
      {activeId === 'analytics' && <AnalyticsPage />}
      {activeId === 'control' && <ControlPage />}
      {activeId === 'devices' && <DevicesView />}
      {activeId === 'automation' && <AutomationPage />}
    </AppShell>
  );
}

/**
 * Three things a real page navigation does that swapping a component out doesn't.
 *
 * Title: every route shared one browser-tab title, so five open tabs (or five history
 * entries) were indistinguishable.
 *
 * Scroll: a real navigation starts the new page at its own top. This one didn't — React
 * swaps `<OverviewPage>` for `<DevicesView>` in place while the window keeps whatever
 * scrollY the old page had, so a route change from partway down a long page landed with
 * the new page's title scrolled hundreds of pixels above the viewport, invisible under the
 * sticky nav. `window.scrollTo({ top: 0 })` is the fix — `behavior: 'auto'`, not `'smooth'`,
 * because the content already changed instantly; animating the scroll after the fact reads
 * as a glitch, not a transition.
 *
 * Focus: React replaces the page's subtree while focus stays wherever it was — on the nav
 * link that was just clicked. A sighted mouse user doesn't notice; a keyboard or screen
 * reader user is left outside the content that just changed, with the whole nav to Tab back
 * through. Moving focus to the `<main>` landmark (already `tabIndex={-1}` in AppShell for
 * exactly this, via the skip link) both announces the new page and puts the next Tab inside
 * it. `preventScroll: true` because the browser's default post-focus behavior is to scroll
 * the focused element flush to the viewport top — which lands it right under the sticky
 * nav, re-introducing the exact hidden-title problem the scrollTo above just fixed; the
 * explicit scrollTo() is the single source of truth for scroll position here.
 *
 * Deliberately skipped on first mount: a cold load or a deep link hasn't navigated from
 * anywhere, and resetting scroll/stealing focus there would jar a freshly-opened page for
 * no reason (a deep link to `#automation` should open scrolled to the top it's already at,
 * not be treated as a navigation away from something).
 */
function useRouteAnnouncement(activeId: string) {
  const isFirstRender = useRef(true);

  useEffect(() => {
    const label = NAV_ITEMS.find((n) => n.id === activeId)?.label ?? 'Overview';
    document.title = `${label} · iBEMS`;

    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [activeId]);
}
