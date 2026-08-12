import { AppShell } from '@/components/layout/AppShell';
import { NAV_ITEMS } from '@/components/layout/navItems';
import { useHashRoute } from '@/lib/useHashRoute';
import { useLiveConnection } from '@/hooks/useLiveConnection';
import { OverviewPage } from '@/components/overview/OverviewPage';
import { DevicesView } from '@/components/devices/DevicesView';
import { ControlPage } from '@/components/control/ControlPage';
import { AnalyticsPage } from '@/components/analytics/AnalyticsPage';
import { AutomationPage } from '@/components/automation/AutomationPage';

const ROUTE_IDS = NAV_ITEMS.map((n) => n.id);

/** Every page is now fully rebuilt to the v4 design and owns its own header — Overview
 * (M2), Control + Devices (M3), Analytics + Automation (M4). */
export function App() {
  useLiveConnection();
  const activeId = useHashRoute(ROUTE_IDS, 'overview');

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
