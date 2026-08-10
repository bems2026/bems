import { useMemo } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { useLiveConnection } from '@/hooks/useLiveConnection';
import { SystemGauges } from '@/components/overview/SystemGauges';
import { EnergyTotals } from '@/components/overview/EnergyTotals';
import { FloorPlanView } from '@/components/floorplan/FloorPlanView';
import { TrendChart } from '@/components/trends/TrendChart';
import { useDeviceStore } from '@/stores/deviceStore';

export function App() {
  useLiveConnection();
  // Trend charts are generated from the live catalogue, not a hardcoded id list — the
  // branch meters are what a facilities view actually needs trended; individual outlets
  // can get their own chart from a future device detail view without touching this.
  //
  // Deriving `meters` via useMemo off the stable `devices` reference, rather than
  // filtering inside the Zustand selector itself, is load-bearing: a selector that
  // returns a new array on every call (`s.devices.filter(...)`) makes
  // useSyncExternalStore see a "changed" snapshot on every render, which is an infinite
  // render loop, not a style preference.
  const devices = useDeviceStore((s) => s.devices);
  const meters = useMemo(() => devices.filter((d) => d.class === 'meter'), [devices]);

  return (
    <AppShell>
      <section id="overview" className="app-section">
        <h2>Overview</h2>
        <SystemGauges />
        <EnergyTotals />
      </section>
      <section id="floorplan" className="app-section">
        <h2>Floor Plan</h2>
        <FloorPlanView />
      </section>
      <section id="trends" className="app-section">
        <h2>Trends</h2>
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
