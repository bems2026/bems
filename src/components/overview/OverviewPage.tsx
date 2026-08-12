import { useEffect, useState } from 'react';
import { LiveDemandCard } from './LiveDemandCard';
import { MainPanelHealthCard } from './MainPanelHealthCard';
import { EnergyBreakdownCard } from './EnergyBreakdownCard';
import { Hero3DCard } from './Hero3DCard';
import { EnergyFlowCard } from './EnergyFlowCard';
import { DeviceStatusCountsCard } from './DeviceStatusCountsCard';
import { MasterQuickActionsCard } from './MasterQuickActionsCard';
import { NextUpCard } from './NextUpCard';
import { ClimateDiagnosticsCard } from './ClimateDiagnosticsCard';
import { LoadShedBanner } from './LoadShedBanner';
import { WeatherStatusCard } from '@/components/weather/WeatherStatusCard';

/**
 * Overview as a bento grid, laid out to the supplied wireframe:
 *
 *   Live Demand           |            | Weather Status
 *   Electrical Parameters |  3D MODEL  | Energy Flow
 *   Energy Breakdown      |            |
 *   ------------------------------------------------------
 *   Device Status | Quick Control | Active Schedules | Climate Diagnostic
 *
 * The bottom row spans all three columns rather than sitting inside the centre column, which
 * is what makes the four cards line up with the outer edges of the left and right stacks.
 *
 * Dropped in this revision because the wireframe has no slot for them: the 24 h edge-buffer
 * chart (Analytics carries the same series at a readable size) and the metered-vs-untracked
 * card (its split now reads as a tier of Energy Flow, and Analytics' Energy section has the
 * detailed version). The three separate weather cards collapsed into one Weather Status.
 *
 * `LoadShedBanner` is kept despite not being in the wireframe: it isn't a card — it renders
 * nothing at all until Automation's DSM thresholds are both configured and genuinely
 * breached, and silently removing a safety annunciator to match a layout sketch would be the
 * wrong trade.
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
          <EnergyBreakdownCard />
        </div>

        <div className="overview-col overview-col--center">
          <Hero3DCard />
        </div>

        <div className="overview-col overview-col--right">
          <WeatherStatusCard />
          <EnergyFlowCard />
        </div>
      </div>

      <div className="overview-bottom-row">
        <DeviceStatusCountsCard />
        <MasterQuickActionsCard />
        <NextUpCard />
        <ClimateDiagnosticsCard />
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
