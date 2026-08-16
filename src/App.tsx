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
 * Two things a real page navigation does that swapping a component out doesn't.
 *
 * Title: every route shared one browser-tab title, so five open tabs (or five history
 * entries) were indistinguishable.
 *
 * Focus: React replaces the page's subtree while focus stays wherever it was — on the nav
 * link that was just clicked. A sighted mouse user doesn't notice; a keyboard or screen
 * reader user is left outside the content that just changed, with the whole nav to Tab back
 * through. Moving focus to the `<main>` landmark (already `tabIndex={-1}` in AppShell for
 * exactly this, via the skip link) both announces the new page and puts the next Tab inside
 * it.
 *
 * Deliberately skipped on first mount: a cold load or a deep link hasn't navigated from
 * anywhere, and stealing focus there would scroll a freshly-opened page for no reason.
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
    document.getElementById('main-content')?.focus();
  }, [activeId]);
}
