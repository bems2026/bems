import { useState } from 'react';
import { BatteryCharging } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { InfoHint } from '@/components/ui/InfoHint';
import type { Device, Reading, Totals } from '@/lib/types';

type Period = 'today' | 'week' | 'month';

const PERIODS: { id: Period; label: string; tile: string; totalsKey: keyof Totals; deviceKey: keyof Reading }[] = [
  { id: 'today', label: 'Today', tile: 'TODAY', totalsKey: 'energy_kwh_today', deviceKey: 'energy_kwh_today' },
  { id: 'week', label: 'Week', tile: 'THIS WEEK', totalsKey: 'energy_kwh_week', deviceKey: 'energy_kwh_week' },
  { id: 'month', label: 'Month', tile: 'THIS MONTH', totalsKey: 'energy_kwh_month', deviceKey: 'energy_kwh_month' },
];

/**
 * Building energy consumed, over the three windows the bridge actually counts.
 *
 * Today/week/month come from the edge buffer's own running counters (`_totals`), not from
 * anything summed client-side — they're the same three figures Overview's `LiveDemandCard`
 * shows, read from one source so the two pages can't disagree. Each is rendered as "No
 * data" when the bridge reports null rather than as 0: an uncounted period and a period
 * that genuinely consumed nothing are different facts.
 *
 * The per-branch split is accumulated by the bridge itself (`ACCUMULATE_ENERGY` in
 * build-flow.mjs), because a meter only ever reports a daily counter. On a freshly
 * deployed bridge the week and month accumulators are empty until whole days have rolled
 * over, so those periods legitimately have nothing to show — that renders as an explicit
 * "not counted yet", never as zeroes.
 *
 * Each branch's share is computed against the sum of the branches shown, not against the
 * building total. Only the former is true by construction: the building's counters come
 * from its own legacy flow, whose week/month boundaries aren't knowable from here.
 */
export function EnergySection({ branchDevices }: { branchDevices: Device[] }) {
  const totals = useDeviceStore((s) => s.totals);
  const readings = useDeviceStore((s) => s.latestReadings);
  const [period, setPeriod] = useState<Period>('today');
  const active = PERIODS.find((p) => p.id === period)!;

  const branches = branchDevices
    .map((d) => ({ id: d.id, name: d.display_name, kwh: readings[d.id]?.[active.deviceKey] }))
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
            The three totals are the building's own running kWh counters, read straight from the bridge — the same figures Overview reports. The per-branch split is accumulated
            separately by this bridge from each meter's daily counter, since no meter reports a longer period. The two come from different sources, so they need not agree exactly.
          </InfoHint>
        </span>
        <span className="analytics-cards-section__tag">CONSUMED · kWh</span>
      </div>

      <div className="analytics-energy-grid">
        {PERIODS.map((p) => (
          <EnergyTile key={p.id} label={p.tile} kwh={(totals?.[p.totalsKey] as number | null | undefined) ?? null} accent={p.id === period} />
        ))}
      </div>

      <div className="card analytics-energy-split">
        <div className="analytics-energy-split__head">
          <span className="analytics-energy-split__title">By branch</span>
          <div className="analytics-energy-periods" role="group" aria-label="Energy period">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`analytics-energy-period${p.id === period ? ' analytics-energy-period--active' : ''}`}
                aria-pressed={p.id === period}
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {branches.length > 0 && <span className="analytics-energy-split__sum mono">{branchSum.toFixed(2)} kWh</span>}
        </div>
        {branches.length === 0 ? (
          <p className="analytics-energy-empty">
            {period === 'today'
              ? 'No branch readings yet.'
              : `Not counted yet — the bridge accumulates ${active.label.toLowerCase()}ly totals one completed day at a time, so this fills in as days roll over.`}
          </p>
        ) : (
          branches.map((b) => {
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
          })
        )}
      </div>
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
