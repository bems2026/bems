import { PageHeader } from '@/components/layout/PageHeader';
import { SITE } from '@shared/siteConfig.mjs';
import { WEATHER_PLACE } from '@/config/weather';
import { LiveDemandCard } from './LiveDemandCard';
import { MainPanelHealthCard } from './MainPanelHealthCard';
import { EnergyBreakdownCard } from './EnergyBreakdownCard';
import { Hero3DCard } from './Hero3DCard';
import { useSiteUiStore } from '@/stores/siteUiStore';
import { EnergyFlowCard } from './EnergyFlowCard';
import { DeviceStatusCountsCard } from './DeviceStatusCountsCard';
import { MasterQuickActionsCard } from './MasterQuickActionsCard';
import { NextUpCard } from './NextUpCard';
import { ClimateDiagnosticsCard } from './ClimateDiagnosticsCard';
import { WeatherStatusCard } from '@/components/weather/WeatherStatusCard';
import { useNowTick } from '@/lib/useNowTick';

/**
 * Overview as one bento grid (`.overview-bento`, `grid-template-areas` in index.css), laid
 * out to the supplied wireframe:
 *
 *   Live Demand           |            | Weather Status
 *   Electrical Parameters |  3D MODEL  | Energy Flow (graph)
 *   Energy Breakdown      |            |
 *   ------------------------------------------------------
 *   Device Status | Quick Control | Active Schedules | Climate Diagnostic
 *
 * One grid, not two matched by eye: the bottom row is the SAME grid's `status`/`trio` areas,
 * which is what makes Device Status align to the left column's exact edges — a separate
 * 4-equal-column grid (the previous attempt) has no way to know the left column isn't 1/4 of
 * the total width. `status` is exactly as wide as the left column; `trio` splits the
 * centre+right span into 3, matching the wireframe's measured proportions.
 *
 * Dropped in this revision because the wireframe has no slot for them:
 *   - The 24 h edge-buffer chart (Analytics carries the same series at a readable size).
 *   - The metered-vs-untracked card (Energy Flow — now a real total-power-vs-time chart,
 *     see EnergyFlowCard.tsx — covers the same territory).
 *   - Two of the three weather cards (Weather Status is the one that remains).
 *   - The load-shed banner, per explicit instruction — DSM thresholds stay configurable on
 *     Automation; a breach is no longer announced here.
 */
export function OverviewPage() {
  const showSceneCard = useSiteUiStore((s) => s.prefs.overviewSceneCard);
  return (
    <>
      <PageHeader title="Intelligent BEMS" sub={`Building Energy Management System · ${SITE.display_name}`} actions={<Clock />} />

      <div className="overview-bento">
        <div className="overview-col overview-col--left">
          <LiveDemandCard />
          <MainPanelHealthCard />
          <EnergyBreakdownCard />
        </div>

        {/* RM-035. The 3D hero renders a scene pack built for one office (`SITE.scene_pack`);
            a site without one, or with one that does not match, can turn it off. It reports no
            reading and drives no control, so hiding it costs nothing but the picture — the
            column simply closes up. */}
        {showSceneCard && (
          <div className="overview-col overview-col--center">
            <Hero3DCard />
          </div>
        )}

        <div className="overview-col overview-col--right">
          <WeatherStatusCard />
          <EnergyFlowCard />
        </div>

        <div className="overview-status">
          <DeviceStatusCountsCard />
        </div>

        <div className="overview-trio">
          <MasterQuickActionsCard />
          <NextUpCard />
          <ClimateDiagnosticsCard />
        </div>
      </div>
    </>
  );
}

function Clock() {
  // The one place that wants the tick's VALUE rather than just the re-render it causes.
  const now = new Date(useNowTick());

  return (
    <div className="page-header-right">
      {/* THE BUILDING'S CLOCK, NOT THE VIEWER'S. Neither call passed a `timeZone`, so this
          rendered whatever time the reader's own machine was in — beside the building's place
          name. Measured 2026-08-31: a viewer in New York saw 00:20 while the building read
          12:20, presented as the building's own. A kiosk in the room was right by coincidence.
          The locale stays the reader's (formatting is presentation); the instant is the
          building's (that is a fact about the building). The place label is dropped rather than
          defaulted when a site has not set a location. */}
      <div className="page-clock">{now.toLocaleTimeString(undefined, { hour12: false, timeZone: SITE.timezone })}</div>
      <div className="page-date">
        {now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: SITE.timezone })}
        {WEATHER_PLACE ? ` · ${WEATHER_PLACE}` : ''}
      </div>
    </div>
  );
}
