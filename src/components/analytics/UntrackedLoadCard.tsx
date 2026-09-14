import { useId, useMemo, useState } from 'react';
import { siteDate, siteDateTime, siteTimeShort } from '@/lib/siteTime';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { SplitSquareVertical } from 'lucide-react';
import { useDeviceStore, historyFor } from '@/stores/deviceStore';
import { InfoHint } from '@/components/ui/InfoHint';
import { useNowTick } from '@/lib/useNowTick';
import { describeSlot, sourceLabel, type SyncStatus } from '@/lib/dataQuality';
import { GRID_STEP_MS } from '@/lib/timeseries';
import { pairTotalAndMetered, type PairedModel, type SlotMeta } from './analyticsMath';
import { DataQualityBadge } from './DataQualityBadge';
import type { AnalyticsRange } from './useAnalyticsHistory';

const MAX_POINTS = 120;

/**
 * The real version of v4's dead `panelLine`/`meterArea`/`gapArea` computeds — the outlets' metered
 * draw stacked against the CHNT panel total, with the gap between them labelled.
 *
 * RM-076: THE TWO SIDES ARE PAIRED BY MINUTE. They used to be summed and then paired by array
 * position, right-aligned to the shorter side, which put readings from different minutes into one
 * "moment" whenever a device had a sample more or fewer than its neighbours. Each side is now summed
 * on the shared time grid (`analyticsMath.pairTotalAndMetered`), and still suppressed independently:
 * an offline outlet leaves a gap in the metered line, never in the panel total.
 */
export function UntrackedLoadCard({ branchIds, outletIds, range, sync }: { branchIds: string[]; outletIds: string[]; range: AnalyticsRange; sync: SyncStatus }) {
  const historyMap = useDeviceStore((s) => s.history);
  const minute = Math.floor(useNowTick() / 60_000) * 60_000;
  const model = useMemo(
    () =>
      pairTotalAndMetered(
        branchIds.map((id) => historyFor(historyMap, id, range)),
        outletIds.map((id) => historyFor(historyMap, id, range)),
        { range, nowMs: minute, maxPoints: MAX_POINTS },
      ),
    [branchIds, outletIds, historyMap, range, minute],
  );
  const data = model.rows;
  const totalGradientId = `untracked-total-${useId()}`;
  const meteredGradientId = `untracked-metered-${useId()}`;
  const [revealed, setRevealed] = useState(false);
  const revealHandlers = { onMouseEnter: () => setRevealed(true), onMouseLeave: () => setRevealed(false), onTouchStart: () => setRevealed(true) };

  if (data.length === 0) {
    return (
      <div className="card analytics-untracked-card">
        <h3 className="card-title">
          <SplitSquareVertical size={14} className="title-icon" aria-hidden="true" />
          Metered vs total
        </h3>
        <p className="section-placeholder">History unavailable right now — the buffer fills at 1 point/min.</p>
      </div>
    );
  }

  // The newest point where BOTH sides are known. `?? 0` used to say "0.00 kW untracked" whenever
  // either side was missing — the most reassuring possible reading of a state where the figure is
  // simply not computable.
  const lastComplete = [...data].reverse().find((p) => p.totalKw !== undefined && p.meteredKw !== undefined);
  const gapKw = lastComplete ? lastComplete.totalKw! - lastComplete.meteredKw! : undefined;
  const quality = { ...model.quality.total, interpolated: model.quality.total.interpolated + model.quality.metered.interpolated };
  const gapCount = model.gaps.total.length + model.gaps.metered.length;
  const longSpan = data[data.length - 1].t - data[0].t > 36 * 3_600_000;
  const formatTick = (t: number) => (longSpan ? siteDate(t, { month: 'short', day: 'numeric' }) : siteTimeShort(t));

  return (
    <div className="card analytics-untracked-card">
      <div className="card-head">
        <div>
          <h3 className="card-title">
            <SplitSquareVertical size={14} className="title-icon" aria-hidden="true" />
            Metered vs total
            <InfoHint label="What the gap between these lines is">The outlets' own meters against the CHNT panel total — the gap is hardwired lighting, the ACU, and anything else off-outlet.</InfoHint>
          </h3>
        </div>
        <span className="analytics-untracked-gap">
          {gapKw === undefined
            ? 'not computable right now'
            : gapKw < 0
              // Negative is a real, informative state, not an error to clamp away: the outlets
              // are metering more than their branch. It should be visible rather than smoothed.
              ? `outlets exceed the panel by ${Math.abs(gapKw).toFixed(2)} kW`
              : `${gapKw.toFixed(2)} kW untracked now`}
        </span>
      </div>
      <div className="analytics-chart-card__quality">
        <DataQualityBadge
          sync={sync}
          quality={quality}
          gapCount={gapCount}
          frozenNames={model.quality.total.frozen + model.quality.metered.frozen > 0 ? ['a contributing meter'] : []}
          stepMs={GRID_STEP_MS[range]}
        />
      </div>
      <div
        className={`chart-frame chart-frame--axes-visible${revealed ? ' chart-frame--revealed' : ''}`}
        role="img"
        aria-label={
          lastComplete
            ? `Panel total ${lastComplete.totalKw!.toFixed(2)} kW, outlet-metered ${lastComplete.meteredKw!.toFixed(2)} kW, gap ${gapKw!.toFixed(2)} kW.`
            : 'No point in this range has both a panel total and an outlet-metered figure, so the untracked load cannot be stated.'
        }
        {...revealHandlers}
      >
        <ResponsiveContainer width="100%" height={360}>
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={totalGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--faint)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--faint)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={meteredGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--blue-bright)" stopOpacity={0.45} />
                <stop offset="95%" stopColor="var(--blue-bright)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatTick} stroke="var(--muted)" fontSize={11} tickLine={false} />
            <YAxis stroke="var(--muted)" fontSize={11} width={44} tickLine={false} />
            <Tooltip content={<PairTooltip model={model} sync={sync} />} />
            <Area type="monotone" dataKey="totalKw" name="totalKw" stroke="var(--faint)" strokeWidth={1.6} fill={`url(#${totalGradientId})`} dot={false} isAnimationActive={false} connectNulls={false} />
            <Area type="monotone" dataKey="meteredKw" name="meteredKw" stroke="var(--blue-bright)" strokeWidth={1.2} fill={`url(#${meteredGradientId})`} dot={false} isAnimationActive={false} connectNulls={false} />
            {/* A contributing meter froze: the held sum, dotted and muted, never a solid measurement. */}
            <Area type="linear" dataKey="totalFrozenKw" name="totalFrozenKw" stroke="var(--muted)" strokeWidth={1.4} strokeDasharray="1 3" fill="none" dot={false} isAnimationActive={false} connectNulls={false} />
            <Area type="linear" dataKey="meteredFrozenKw" name="meteredFrozenKw" stroke="var(--muted)" strokeWidth={1.2} strokeDasharray="1 3" fill="none" dot={false} isAnimationActive={false} connectNulls={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="analytics-untracked-legend">
        <span>
          <span className="analytics-untracked-legend__swatch analytics-untracked-legend__swatch--total" /> Panel total
        </span>
        <span>
          <span className="analytics-untracked-legend__swatch analytics-untracked-legend__swatch--metered" /> Outlet-metered
        </span>
      </div>
    </div>
  );
}

function PairLine({ name, kw, meta }: { name: string; kw: number | undefined; meta: SlotMeta }) {
  return (
    <div className="chart-tooltip__series">
      <div className="chart-tooltip__head">
        <span className="chart-tooltip__name">{name}</span>
        <span className="chart-tooltip__value mono">{kw !== undefined ? `${kw.toFixed(3)} kW` : '—'}</span>
      </div>
      <div className={`chart-tooltip__quality chart-tooltip__quality--${meta.quality}`}>{describeSlot(meta, 'power')}</div>
    </div>
  );
}

function PairTooltip({ active, label, model, sync }: { active?: boolean; label?: number | string; model: PairedModel; sync: SyncStatus }) {
  const now = useNowTick();
  if (!active || label === undefined) return null;
  const i = model.rows.findIndex((r) => r.t === Number(label));
  if (i === -1) return null;
  const row = model.rows[i];
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__time mono">{siteDateTime(row.t)}</div>
      <PairLine name="Panel total" kw={row.totalKw ?? row.totalFrozenKw} meta={model.meta[i].total} />
      <PairLine name="Outlet-metered" kw={row.meteredKw ?? row.meteredFrozenKw} meta={model.meta[i].metered} />
      <div className="chart-tooltip__source">{sourceLabel(sync, 'measured', now)}</div>
    </div>
  );
}
