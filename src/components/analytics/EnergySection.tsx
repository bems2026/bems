import { useState } from 'react';
import { AlertTriangle, BatteryCharging } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { InfoHint } from '@/components/ui/InfoHint';
import type { Totals } from '@/lib/types';
import { formatKwh, formatNumber } from '@/lib/format';
import { describeFrozen, frozenHeadline, describeShortfalls, type EnergyPeriod } from '@/lib/branchEnergy';
import { useBranchEnergy } from '@/lib/useBranchEnergy';

const PERIODS: { id: EnergyPeriod; label: string; tile: string; totalsKey: keyof Totals }[] = [
  { id: 'today', label: 'Today', tile: 'TODAY', totalsKey: 'energy_kwh_today' },
  { id: 'week', label: 'Week', tile: 'THIS WEEK', totalsKey: 'energy_kwh_week' },
  { id: 'month', label: 'Month', tile: 'THIS MONTH', totalsKey: 'energy_kwh_month' },
];

/**
 * Building energy consumed, over the three windows the bridge actually counts.
 *
 * THE TILES AND THE SPLIT ARE ONE NUMBER — RM-057. Both are the sum of the building's branch
 * meters: the tiles read `_totals`, which the bridge computes as exactly that sum
 * (`shared/buildLatest.mjs`), and the rows below are the same meters listed out.
 *
 * AND THE SPLIT IS OVERVIEW'S SPLIT — RM-078. The rows, their rounding and every notice come from
 * `lib/branchEnergy.ts` through `useBranchEnergy`, which Overview's Energy Breakdown calls too. This
 * card used to take its branches as a prop filtered by each device's `monitoring` function while
 * Overview took every `meter`; the operator saw L.O Red read differently on the two pages. The
 * membership is now the bridge's own `BUILDING_METER_IDS`, so the split also adds up to the tile.
 *
 * Each tile renders "No data" when the bridge reports null rather than as 0: an uncounted period
 * and a period that genuinely consumed nothing are different facts. The per-branch week/month are
 * accumulated by the bridge (`ACCUMULATE_ENERGY`), so a fresh bridge has nothing to show for them
 * until whole days have rolled over — an explicit "not counted yet", never zeroes.
 *
 * WHAT IS STILL COMPARED. `_totals` also carries `energy_kwh_*_integrated`, the legacy integration
 * of the same circuits and the only independent measurement of them; `lib/energyDisagreement.ts`
 * compares the split against it. RM-077 takes out of that second opinion whatever the integrator
 * counted from a meter that had frozen, which is what made L.O Red look like it was losing energy.
 */
export function EnergySection() {
  const totals = useDeviceStore((s) => s.totals);
  const [period, setPeriod] = useState<EnergyPeriod>('today');
  const active = PERIODS.find((p) => p.id === period)!;
  const { rows, totalKwh, disagreement, shortfalls, frozen } = useBranchEnergy(period);
  const shortfall = shortfalls.length > 0 ? describeShortfalls(shortfalls, frozen) : null;

  return (
    <div className="analytics-cards-section">
      <div className="analytics-cards-section__head">
        <span className="analytics-cards-section__title">
          <BatteryCharging size={14} className="title-icon" aria-hidden="true" />
          Energy
          <InfoHint label="Where these energy figures come from">
            The three totals are the sum of this building's branch meters — the same meters listed below, added up by the bridge, so the headline and the split are one figure and
            not two that have to be reconciled. Overview reports the same number, from the same calculation. Each meter's week and month are accumulated by the bridge from its
            daily counter, since no meter reports a longer period, so a period reads "not counted yet" until every branch has one. The building's own power integration measures
            the same circuits a second, independent way; if the two drift further apart than they can explain, or a meter stops updating, the split below says so.
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
          {totalKwh !== null && <span className="analytics-energy-split__sum mono">{formatKwh(totalKwh)}</span>}
        </div>
        {disagreement && (
          <p className="energy-disagreement" role="status">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>
              <strong>Two measurements of the same circuits disagree.</strong> The branches below add up to {formatKwh(disagreement.branchSum)} for
              {' '}{active.tile.toLowerCase()}, while the building's own power integration over those same circuits gives {formatKwh(disagreement.total)}
              {disagreement.ratio !== null && ` — ${disagreement.ratio.toFixed(1)}x less`}. They are measured differently and need not match exactly, but
              a gap this size means one of the two is wrong.
            </span>
          </p>
        )}
        {period === 'today' &&
          frozen.map((f) => (
            <p className="energy-disagreement" role="status" key={`${f.id}-${f.fromMs}`}>
              <AlertTriangle size={15} aria-hidden="true" />
              <span>
                <strong>{frozenHeadline(f)}</strong> {describeFrozen(f)}
              </span>
            </p>
          ))}
        {shortfall && (
          <p className="energy-disagreement" role="status">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>
              <strong>{shortfall.headline}</strong> {shortfall.detail}
            </span>
          </p>
        )}
        {rows.length === 0 ? (
          <p className="analytics-energy-empty">
            {period === 'today'
              ? 'No branch readings yet.'
              : `Not counted yet — the bridge accumulates ${active.label.toLowerCase()}ly totals one completed day at a time, so this fills in as days roll over.`}
          </p>
        ) : (
          rows.map((b) => (
            <div className={`analytics-energy-row${b.stale ? ' analytics-energy-row--stale' : ''}`} key={b.id}>
              <span className="analytics-energy-row__name">
                {b.name}
                {b.stale && <span className="sr-only"> (last reading expired; this is its last reported count)</span>}
              </span>
              <span className="analytics-energy-row__track" aria-hidden="true">
                <span className="analytics-energy-row__fill" style={{ width: `${b.share.toFixed(1)}%` }} />
              </span>
              <span className="analytics-energy-row__pct mono">{b.share.toFixed(0)}%</span>
              <span className="analytics-energy-row__kwh mono">{formatNumber(b.kwh, 2)}</span>
            </div>
          ))
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
