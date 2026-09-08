import { useState } from 'react';
import { AlertTriangle, BatteryCharging } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { InfoHint } from '@/components/ui/InfoHint';
import type { Device, Reading, Totals } from '@/lib/types';
import { formatKwh, shareOfTotal } from '@/lib/format';
import { energyDisagreement } from '@/lib/energyDisagreement';

type Period = 'today' | 'week' | 'month';

const PERIODS: { id: Period; label: string; tile: string; totalsKey: keyof Totals; integratedKey: keyof Totals; deviceKey: keyof Reading }[] = [
  { id: 'today', label: 'Today', tile: 'TODAY', totalsKey: 'energy_kwh_today', integratedKey: 'energy_kwh_today_integrated', deviceKey: 'energy_kwh_today' },
  { id: 'week', label: 'Week', tile: 'THIS WEEK', totalsKey: 'energy_kwh_week', integratedKey: 'energy_kwh_week_integrated', deviceKey: 'energy_kwh_week' },
  { id: 'month', label: 'Month', tile: 'THIS MONTH', totalsKey: 'energy_kwh_month', integratedKey: 'energy_kwh_month_integrated', deviceKey: 'energy_kwh_month' },
];

/**
 * Building energy consumed, over the three windows the bridge actually counts.
 *
 * THE TILES AND THE SPLIT ARE ONE NUMBER NOW — RM-057. Both are the sum of the building's
 * branch meters: the tiles read `_totals`, which the bridge computes as exactly that sum
 * (`shared/buildLatest.mjs`), and the rows below are the same meters listed out. They cannot
 * disagree, because it is the same arithmetic done once. Until RM-057 the tiles came from the
 * legacy flow's own two-second integration instead, and the operator reported the two figures
 * as out of sync three times before that was read as a design fault rather than a bug.
 *
 * Each is rendered as "No data" when the bridge reports null rather than as 0: an uncounted
 * period and a period that genuinely consumed nothing are different facts. A period is null
 * whenever ANY branch is missing its figure — a building total short by a whole circuit, with
 * nothing on screen saying so, is the shape of every energy fault this project has had.
 *
 * The per-branch week/month are accumulated by the bridge itself (`ACCUMULATE_ENERGY` in
 * build-flow.mjs), because a meter only ever reports a daily counter. On a freshly deployed
 * bridge those accumulators are empty until whole days have rolled over, so both the tile and
 * the split legitimately have nothing to show — an explicit "not counted yet", never zeroes.
 *
 * Each branch's share is computed against the sum of the branches shown, which is now the same
 * denominator as the tile.
 *
 * WHAT IS STILL COMPARED, and why it is not the tile. `_totals` also carries
 * `energy_kwh_*_integrated`: the legacy integration of the same circuits, the only INDEPENDENT
 * measurement of them this system has. `lib/energyDisagreement.ts` compares the split against
 * that, which is what keeps the RM-053 guard meaningful — comparing the split to the tile would
 * now be comparing a number with itself.
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
  // Against THIS period's INTEGRATED counter, not the tile — RM-057. The tile is now the sum of
  // these same branches, so comparing the split to it would compare a number with itself and the
  // check could never fire. The legacy two-second integration is the only independent
  // measurement of the same circuits, and the period must be the matching one: comparing the
  // wrong period's figures would manufacture a disagreement out of two correct numbers.
  const disagreement = energyDisagreement(branchSum, (totals?.[active.integratedKey] as number | null | undefined) ?? null);

  return (
    <div className="analytics-cards-section">
      <div className="analytics-cards-section__head">
        <span className="analytics-cards-section__title">
          <BatteryCharging size={14} className="title-icon" aria-hidden="true" />
          Energy
          <InfoHint label="Where these energy figures come from">
            The three totals are the sum of this building's branch meters — the same meters listed below, added up by the bridge, so the headline and the split are one figure and
            not two that have to be reconciled. Overview reports the same number. Each meter's week and month are accumulated by the bridge from its daily counter, since no meter
            reports a longer period, so a period reads "not counted yet" until every branch has one. The building's own power integration measures the same circuits a second,
            independent way; if the two ever drift further apart than they can explain, the split below says so rather than leaving it to be noticed.
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
        {branches.length === 0 ? (
          <p className="analytics-energy-empty">
            {period === 'today'
              ? 'No branch readings yet.'
              : `Not counted yet — the bridge accumulates ${active.label.toLowerCase()}ly totals one completed day at a time, so this fills in as days roll over.`}
          </p>
        ) : (
          branches.map((b) => {
            const share = shareOfTotal(b.kwh, branchSum);
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
