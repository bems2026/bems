import { useMemo } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { NAV_ITEMS } from '@/components/layout/navItems';
import { useHashRoute } from '@/lib/useHashRoute';
import { useLiveConnection } from '@/hooks/useLiveConnection';
import { OverviewPage } from '@/components/overview/OverviewPage';
import { DevicesView } from '@/components/devices/DevicesView';
import { OutletsView } from '@/components/outlets/OutletsView';
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
      {activeId === 'devices' && <DevicesPage />}
      {activeId === 'automation' && <AutomationPage />}
    </AppShell>
  );
}

/**
 * Overview is fully rebuilt (M2) — `OverviewPage` owns its own header and 3-column grid.
 * Devices/Control/Analytics/Automation below are still the Phase M1 bridge: Phase L page
 * bodies reused under the new shell, restyled for free by the token flip, standing in until
 * M3 (Control/Devices) and M4 (Analytics/Automation) rebuild each to the v4 design.
 */
function DevicesPage() {
  const devices = useDeviceStore((s) => s.devices);
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Devices</h1>
          <p className="page-sub">{devices.length ? `${devices.length} devices in the registry` : 'Waiting for the device catalogue…'}</p>
        </div>
      </header>
      <DevicesView />
    </>
  );
}

/** Stands in for the v4 "Control" tab until M3 rebuilds it as the spatial plan + IR
 * command center — same outlet control surface Phase L shipped, just under the new nav. */
function ControlPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Control</h1>
          <p className="page-sub">Outlet control — full spatial plan + IR HVAC command center land in M3</p>
        </div>
      </header>
      <OutletsView />
    </>
  );
}

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
