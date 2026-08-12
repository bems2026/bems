import { useEffect, useState } from 'react';
import { LiveDemandCard } from './LiveDemandCard';
import { MainPanelHealthCard } from './MainPanelHealthCard';
import { ClimateDiagnosticsCard } from './ClimateDiagnosticsCard';
import { Hero3DCard } from './Hero3DCard';
import { MasterQuickActionsCard } from './MasterQuickActionsCard';
import { NextUpCard } from './NextUpCard';
import { EdgeBufferCard } from './EdgeBufferCard';
import { DeviceStatusCountsCard } from './DeviceStatusCountsCard';
import { MeteredVsUntrackedCard } from './MeteredVsUntrackedCard';
import { LoadShedBanner } from './LoadShedBanner';

/**
 * v4's Overview — a 3-column grid (340px / 1fr / 340px) around the 3D hero, per the Phase M
 * plan §4. The load-shed banner (M2's slot, M4's real breach logic) renders nothing until
 * Automation's DSM thresholds are both configured and genuinely exceeded — see
 * `LoadShedBanner.tsx`.
 */
export function OverviewPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">NBERIC Digital Twin</h1>
          <p className="page-sub">MMSU CARE Office · 20-node Tuya network with CHNT main-panel metering</p>
        </div>
        <Clock />
      </header>

      <LoadShedBanner />

      <div className="overview-grid">
        <div className="overview-col overview-col--left">
          <LiveDemandCard />
          <MainPanelHealthCard />
          <ClimateDiagnosticsCard />
        </div>

        <div className="overview-col overview-col--center">
          <Hero3DCard />
          <div className="overview-pair-grid">
            <MasterQuickActionsCard />
            <NextUpCard />
          </div>
        </div>

        <div className="overview-col overview-col--right">
          <EdgeBufferCard />
          <DeviceStatusCountsCard />
          <MeteredVsUntrackedCard />
        </div>
      </div>
    </>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="page-header-right">
      <div className="page-clock">{now.toLocaleTimeString('en-PH', { hour12: false })}</div>
      <div className="page-date">
        {now.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })} · Batac City
      </div>
    </div>
  );
}
