import { useMemo } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { NAV_ITEMS } from '@/components/layout/navItems';
import { useHashRoute } from '@/lib/useHashRoute';
import { useLiveConnection } from '@/hooks/useLiveConnection';
import { OverviewPage } from '@/components/overview/OverviewPage';
import { DevicesView } from '@/components/devices/DevicesView';
import { ControlPage } from '@/components/control/ControlPage';
import { TrendChart } from '@/components/trends/TrendChart';
import { useDeviceStore } from '@/stores/deviceStore';

const ROUTE_IDS = NAV_ITEMS.map((n) => n.id);

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

/**
 * Overview (M2) and Control + Devices (M3) are fully rebuilt and own their own headers.
 * Analytics/Automation below are still the Phase M1 bridge: Phase L page bodies reused
 * under the new shell, restyled for free by the token flip, standing in until M4 rebuilds
 * each to the v4 design.
 */

/** Stands in for the v4 "Analytics" tab until M4 rebuilds it with the param/scope toggles,
 * branch/outlet grids, and the untracked-load chart. */
function AnalyticsPage() {
  const devices = useDeviceStore((s) => s.devices);
  const meters = useMemo(() => devices.filter((d) => d.class === 'meter'), [devices]);
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-sub">24-hour power draw per branch meter — the full v4 layout lands in M4</p>
        </div>
      </header>
      {meters.length === 0 ? (
        <p className="section-placeholder">Waiting for the device catalogue…</p>
      ) : (
        <div className="trends-grid">
          {meters.map((d) => (
            <TrendChart key={d.id} deviceId={d.id} title={d.display_name} />
          ))}
        </div>
      )}
    </>
  );
}

function AutomationPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Automation</h1>
          <p className="page-sub">DSM & schedule management</p>
        </div>
      </header>
      <p className="section-placeholder">Schedules, trigger setpoints, and DSM thresholds land in M4 — No data yet.</p>
    </>
  );
}
