import { BatteryCharging } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { InfoHint } from '@/components/ui/InfoHint';
import type { Device } from '@/lib/types';

/**
 * Building energy consumed, over the three windows the bridge actually counts.
 *
 * Today/week/month come from the edge buffer's own running counters (`_totals`), not from
 * anything summed client-side — they're the same three figures Overview's `LiveDemandCard`
 * shows, read from one source so the two pages can't disagree. Each is rendered as "No
 * data" when the bridge reports null rather than as 0: an uncounted period and a period
 * that genuinely consumed nothing are different facts.
 *
 * The per-branch split below is deliberately TODAY-only. Each CT reports its own
 * `energy_kwh_today`, but there is no per-branch week or month counter anywhere in the
 * data model — so a week/month breakdown would have to be invented, and isn't offered.
 * Each branch's share is computed against the sum of the branches shown, not against the
 * building total: the two agree in practice, but only the former is true by construction.
 */
export function EnergySection({ branchDevices }: { branchDevices: Device[] }) {
  const totals = useDeviceStore((s) => s.totals);
  const readings = useDeviceStore((s) => s.latestReadings);

  const branches = branchDevices
    .map((d) => ({ id: d.id, name: d.display_name, kwh: readings[d.id]?.energy_kwh_today }))
    .filter((b): b is { id: string; name: string; kwh: number } => typeof b.kwh === 'number')
    .sort((a, b) => b.kwh - a.kwh);
  const branchSum = branches.reduce((sum, b) => sum + b.kwh, 0);

  return (
    <div className="analytics-cards-section">
      <div className="analytics-cards-section__head">
        <span className="analytics-cards-section__title">
          <BatteryCharging size={14} className="title-icon" aria-hidden="true" />
          Energy
          <InfoHint label="Where these energy figures come from">
            Today, this week, and this month are the edge buffer's own running kWh counters, read straight from the bridge — the same figures Overview reports. The split is each branch
            meter's own daily counter; no per-branch week or month counter exists, so none is shown.
          </InfoHint>
        </span>
        <span className="analytics-cards-section__tag">CONSUMED · kWh</span>
      </div>

      <div className="analytics-energy-grid">
        <EnergyTile label="TODAY" kwh={totals?.energy_kwh_today ?? null} accent />
        <EnergyTile label="THIS WEEK" kwh={totals?.energy_kwh_week ?? null} />
        <EnergyTile label="THIS MONTH" kwh={totals?.energy_kwh_month ?? null} />
      </div>

      {branches.length > 0 && (
        <div className="card analytics-energy-split">
          <div className="analytics-energy-split__head">
            <span className="analytics-energy-split__title">By branch · today</span>
            <span className="analytics-energy-split__sum mono">{branchSum.toFixed(2)} kWh</span>
          </div>
          {branches.map((b) => {
            const share = branchSum > 0 ? (b.kwh / branchSum) * 100 : 0;
            return (
              <div className="analytics-energy-row" key={b.id}>
                <span className="analytics-energy-row__name">{b.name}</span>
                <span className="analytics-energy-row__track" aria-hidden="true">
                  <span className="analytics-energy-row__fill" style={{ width: `${share.toFixed(1)}%` }} />
                </span>
                <span className="analytics-energy-row__pct mono">{share.toFixed(0)}%</span>
                <span className="analytics-energy-row__kwh mono">{b.kwh.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EnergyTile({ label, kwh, accent = false }: { label: string; kwh: number | null; accent?: boolean }) {
  return (
    <div className={`analytics-energy-tile${accent ? ' analytics-energy-tile--accent' : ''}`}>
      <div className="analytics-energy-tile__label">{label}</div>
      {kwh === null ? (
        <div className="analytics-energy-tile__empty">No data</div>
      ) : (
        <div className="analytics-energy-tile__value-row">
          <span className="analytics-energy-tile__value mono">{kwh.toFixed(2)}</span>
          <span className="analytics-energy-tile__unit">kWh</span>
        </div>
      )}
    </div>
  );
}
