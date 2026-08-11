import { useMemo } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { NAV_ITEMS } from '@/components/layout/navItems';
import { useHashRoute } from '@/lib/useHashRoute';
import { useLiveConnection } from '@/hooks/useLiveConnection';
import { KpiRow } from '@/components/overview/KpiRow';
import { OverviewHero } from '@/components/overview/OverviewHero';
import { EnergyByDevice } from '@/components/overview/EnergyByDevice';
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
 * Phase M1 delivers the shell (tokens, top nav, routing) and reuses each existing Phase L
 * page body as-is underneath it, restyled for free by the token flip — the visual
 * composition each page uses is what M2 (Overview), M3 (Control/Devices), and M4
 * (Analytics/Automation) actually rebuild to the v4 design. Every page still needs the M1
 * shell's own `.page-header` treatment, which these wrappers add now so the nav doesn't
 * ship above four different ad-hoc headers.
 */
function OverviewPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">Live building energy at a glance</p>
        </div>
      </header>
      <div className="overview-stack">
        <KpiRow />
        <OverviewHero />
        <EnergyByDevice />
      </div>
    </>
  );
}

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
