import { Zap } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { isStale } from '@/lib/bridgeClient';
import { isReadingStale, measured } from '@/lib/staleness';
import { CardLink } from '@/components/ui/CardLink';
import { MetricValue } from '@/components/ui/MetricValue';
import { InfoHint } from '@/components/ui/InfoHint';
import { useNowTick } from '@/lib/useNowTick';

/**
 * v4's "Live Demand" card, bound to real data throughout. Its own spec has TODAY render a
 * real number and WEEK/MONTH always render "No data" — but `_totals` really does serve
 * `energy_kwh_week`/`energy_kwh_month` (see `shared/buildLatest.mjs`), so faking the "No
 * data" state here would be the opposite of this app's own rule: render what the bridge
 * actually reports, missing only when it's genuinely missing.
 */
export function LiveDemandCard() {
  const totals = useDeviceStore((s) => s.totals);
  const wsStatus = useConnectionStore((s) => s.wsStatus);
  const lastMessageAt = useConnectionStore((s) => s.lastMessageAt);

  // Staleness is a function of elapsed time, not just store writes. One shared app-wide
  // tick — see useNowTick.
  useNowTick();

  /**
   * Two different facts, and the pill used to report only the first — FI-006.
   *
   * `linkStale` is the websocket: no message of any kind for 30s. `readingStale` is this card's
   * own row: `_totals` stopped advancing while other traffic carried on, so the link looks
   * perfect and the number above the pill is a minute old. A reader looking at "1.23 kW" is
   * asking about the building, not about the socket, so the pill answers both.
   */
  const linkStale = isStale(lastMessageAt ? Date.parse(lastMessageAt) : null);
  const readingStale = isReadingStale(totals);
  const stale = linkStale || readingStale;
  const linkOk = wsStatus === 'connected' && !stale;

  /**
   * Past five minutes a reading stops being a measurement and becomes a memory, so the figures
   * go to `—` rather than standing there looking current. This is the `co5` rule at building
   * scale: that outlet rendered `514 W` beside an OFFLINE badge, values of unknown age presented
   * as present. The pill changing to RECONNECTING is not the same statement — it describes the
   * link, and the big number describes the building.
   */
  const live = <T,>(value: T) => measured(value, totals);
  const watts = live(totals?.total_power_w);

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">
          <Zap size={14} className="title-icon" aria-hidden="true" />
          Live Demand
          <InfoHint label="Where these totals come from">Today/week/month are the edge buffer's own running totals — the same figures Analytics reads.</InfoHint>
        </h3>
        <CardLink to="analytics" label="View live demand details on Analytics" />
      </div>
      <div className="live-demand-hero">
        <span className="live-demand-value">{watts != null ? (watts / 1000).toFixed(2) : '—'}</span>
        <span className="live-demand-unit">kW</span>
        <span className={`live-demand-pill${linkOk ? '' : ' nav-live-pill--warn'}`} role="status" aria-live="polite">{linkOk ? 'LIVE' : stale ? 'STALE' : 'RECONNECTING'}</span>
      </div>
      <div className="live-demand-stats">
        <div>
          <span className="live-demand-stat-label">Today</span>
          <div className="live-demand-stat-value">
            <MetricValue value={live(totals?.energy_kwh_today)} unit="kWh" digits={2} size="sm" />
          </div>
        </div>
        <div>
          <span className="live-demand-stat-label">Week</span>
          <div className="live-demand-stat-value">
            <MetricValue value={live(totals?.energy_kwh_week)} unit="kWh" digits={1} size="sm" />
          </div>
        </div>
        <div>
          <span className="live-demand-stat-label">Month</span>
          <div className="live-demand-stat-value">
            <MetricValue value={live(totals?.energy_kwh_month)} unit="kWh" digits={1} size="sm" />
          </div>
        </div>
      </div>
    </div>
  );
}
