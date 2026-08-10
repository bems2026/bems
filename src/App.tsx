import { AppShell } from '@/components/layout/AppShell';
import { useLiveConnection } from '@/hooks/useLiveConnection';
import { SystemGauges } from '@/components/overview/SystemGauges';
import { EnergyTotals } from '@/components/overview/EnergyTotals';

/**
 * `floorplan` (FloorPlanView) and `trends` (TrendChart) are built in Phase E — this
 * phase only establishes the shell, nav anchors, and live data pipeline they mount into.
 */
export function App() {
  useLiveConnection();

  return (
    <AppShell>
      <section id="overview" className="app-section">
        <h2>Overview</h2>
        <SystemGauges />
        <EnergyTotals />
      </section>
      <section id="floorplan" className="app-section">
        <h2>Floor Plan</h2>
        <p className="section-placeholder">Read-only 2D floor plan — Phase E.</p>
      </section>
      <section id="trends" className="app-section">
        <h2>Trends</h2>
        <p className="section-placeholder">24h trend charts — Phase E.</p>
      </section>
    </AppShell>
  );
}
