import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { isStale } from '@/lib/bridgeClient';
import { navigateTo } from '@/lib/useHashRoute';
import { MetricValue } from '@/components/ui/MetricValue';
import { InfoHint } from '@/components/ui/InfoHint';

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

  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const stale = isStale(lastMessageAt ? Date.parse(lastMessageAt) : null);
  const linkOk = wsStatus === 'connected' && !stale;

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">
          <Zap size={14} className="title-icon" aria-hidden="true" />
          Live Demand
          <InfoHint label="Where these totals come from">Today/week/month are the edge buffer's own running totals — the same figures Analytics reads.</InfoHint>
        </h3>
        <button type="button" className="card-head-link" onClick={() => navigateTo('analytics')}>
          View details ↗
        </button>
      </div>
      <div className="live-demand-hero">
        <span className="live-demand-value">{totals?.total_power_w != null ? (totals.total_power_w / 1000).toFixed(2) : '—'}</span>
        <span className="live-demand-unit">kW</span>
        <span className={`live-demand-pill${linkOk ? '' : ' nav-live-pill--warn'}`}>{linkOk ? 'LIVE' : stale ? 'STALE' : 'RECONNECTING'}</span>
      </div>
      <div className="live-demand-stats">
        <div>
          <span className="live-demand-stat-label">Today</span>
          <div className="live-demand-stat-value">
            <MetricValue value={totals?.energy_kwh_today} unit="kWh" digits={2} size="sm" />
          </div>
        </div>
        <div>
          <span className="live-demand-stat-label">Week</span>
          <div className="live-demand-stat-value">
            <MetricValue value={totals?.energy_kwh_week} unit="kWh" digits={1} size="sm" />
          </div>
        </div>
        <div>
          <span className="live-demand-stat-label">Month</span>
          <div className="live-demand-stat-value">
            <MetricValue value={totals?.energy_kwh_month} unit="kWh" digits={1} size="sm" />
          </div>
        </div>
      </div>
    </div>
  );
}
