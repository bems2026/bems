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
import { WeatherNowCard } from '@/components/weather/WeatherNowCard';
import { WeatherDetailsCard } from '@/components/weather/WeatherDetailsCard';
import { WeatherHourlyCard } from '@/components/weather/WeatherHourlyCard';

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
          <WeatherNowCard />
          <MainPanelHealthCard />
          <ClimateDiagnosticsCard />
        </div>

        <div className="overview-col overview-col--center">
          <Hero3DCard />
          {/* The bento's bottom row — the hourly strip sits alongside the two action cards
              so the weather set brackets the 3D model on three sides (left, right, below). */}
          <div className="overview-pair-grid overview-pair-grid--trio">
            <MasterQuickActionsCard />
            <NextUpCard />
            <WeatherHourlyCard />
          </div>
        </div>

        <div className="overview-col overview-col--right">
          <EdgeBufferCard />
          <WeatherDetailsCard />
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
