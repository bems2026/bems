import { useMemo } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { useLiveConnection } from '@/hooks/useLiveConnection';
import { KpiRow } from '@/components/overview/KpiRow';
import { OverviewHero } from '@/components/overview/OverviewHero';
import { EnergyByDevice } from '@/components/overview/EnergyByDevice';
import { DevicesView } from '@/components/devices/DevicesView';
import { OutletsView } from '@/components/outlets/OutletsView';
import { TrendChart } from '@/components/trends/TrendChart';
import { useDeviceStore } from '@/stores/deviceStore';

export function App() {
  useLiveConnection();
  // Deriving via useMemo off the stable `devices` reference, rather than filtering inside
  // the Zustand selector, is load-bearing: a selector returning a new array each call makes
  // useSyncExternalStore see a changed snapshot every render — an infinite loop.
  const devices = useDeviceStore((s) => s.devices);
  const meters = useMemo(() => devices.filter((d) => d.class === 'meter'), [devices]);

  return (
    <AppShell>
      <section id="overview" className="app-section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Overview</h2>
            <p className="section-sub">Live building energy at a glance</p>
          </div>
        </div>
        <div className="overview-stack">
          <KpiRow />
          <OverviewHero />
          <EnergyByDevice />
        </div>
      </section>

      <section id="devices" className="app-section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Devices</h2>
            <p className="section-sub">
              {devices.length ? `${devices.length} devices in the registry` : 'Waiting for the device catalogue…'}
            </p>
          </div>
        </div>
        <DevicesView />
      </section>

      <section id="outlets" className="app-section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Outlets</h2>
            <p className="section-sub">Control the 7 dual-socket convenience outlets</p>
          </div>
        </div>
        <OutletsView />
      </section>

      <section id="trends" className="app-section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Trends</h2>
            <p className="section-sub">24-hour power draw per branch meter</p>
          </div>
        </div>
        {meters.length === 0 ? (
          <p className="section-placeholder">Waiting for the device catalogue…</p>
        ) : (
          <div className="trends-grid">
            {meters.map((d) => (
              <TrendChart key={d.id} deviceId={d.id} title={d.display_name} />
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
