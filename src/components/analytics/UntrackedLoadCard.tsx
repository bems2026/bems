import { useId, useMemo, useState } from 'react';
import { siteDateTime, siteTimeShort } from '@/lib/siteTime';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { SplitSquareVertical } from 'lucide-react';
import { useDeviceStore, historyFor } from '@/stores/deviceStore';
import { sumHistories } from '@/components/overview/totalPowerSeries';
import { downsampleTrend } from '@/components/trends/chartSummary';
import { InfoHint } from '@/components/ui/InfoHint';
import { alignTotalAndMetered, type UntrackedPoint } from './analyticsMath';
import { pointValue } from './chartParams';

const MAX_POINTS = 120;

/**
 * The real version of v4's dead `panelLine`/`meterArea`/`gapArea` computeds — the written
 * spec (§3, "Sub-Metered Granularity") asks for exactly this: the 7 outlets' metered draw
 * stacked against the CHNT panel total, with the gap between them labelled. v4 computes the
 * shape but never renders it (see the Phase M plan §6.2); this is that chart, built from
 * real summed history instead of the fabricated wave the rest of that Analytics tab uses.
 */
export function UntrackedLoadCard({ branchIds, outletIds, range }: { branchIds: string[]; outletIds: string[]; range: string }) {
  const historyMap = useDeviceStore((s) => s.history);

  const totalSeries = useMemo(() => sumHistories(branchIds.map((id) => historyFor(historyMap, id, range))), [branchIds, historyMap, range]);
  const meteredSeries = useMemo(() => sumHistories(outletIds.map((id) => historyFor(historyMap, id, range))), [outletIds, historyMap, range]);
  const paired = useMemo(() => alignTotalAndMetered(totalSeries, meteredSeries), [totalSeries, meteredSeries]);

  const data = downsamplePaired(paired, MAX_POINTS);
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

  // The newest point where BOTH sides are known. `data[data.length - 1]` with `?? 0` said
  // "0.00 kW untracked" whenever either side was missing — the most reassuring possible reading
  // of a state where the figure is simply not computable. With `co5` frozen at 513.9 W the
  // subtraction also went negative and `Math.max(0, …)` clamped it to the same 0.00, so the one
  // number on this card was hiding the contradiction it existed to reveal.
  const lastComplete = [...data].reverse().find((p) => p.totalKw !== undefined && p.meteredKw !== undefined);
  const gapKw = lastComplete ? lastComplete.totalKw! - lastComplete.meteredKw! : undefined;

  return (
    <div className="card analytics-untracked-card">
      <div className="card-head">
        <div>
          <h3 className="card-title">
            <SplitSquareVertical size={14} className="title-icon" aria-hidden="true" />
            Metered vs total
            <InfoHint label="What the gap between these lines is">The 7 outlets' own meters against the CHNT panel total — the gap is hardwired lighting, the ACU, and anything else off-outlet.</InfoHint>
          </h3>
        </div>
        <span className="analytics-untracked-gap">
          {gapKw === undefined
            ? 'not computable right now'
            : gapKw < 0
              // Negative is a real, informative state, not an error to clamp away: the outlets
              // are metering more than their branch. It means a meter is mis-assigned or a
              // reading is not what it claims, and it should be visible rather than smoothed.
              ? `outlets exceed the panel by ${Math.abs(gapKw).toFixed(2)} kW`
              : `${gapKw.toFixed(2)} kW untracked now`}
        </span>
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
            <Tooltip
              labelFormatter={(t) => siteDateTime(t as number)}
              formatter={(v, name) => [`${Number(v).toFixed(2)} kW`, name === 'totalKw' ? 'Panel total' : 'Outlet-metered']}
              contentStyle={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 8 }}
            />
            <Area type="monotone" dataKey="totalKw" name="totalKw" stroke="var(--faint)" strokeWidth={1.6} fill={`url(#${totalGradientId})`} dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="meteredKw" name="meteredKw" stroke="var(--blue-bright)" strokeWidth={1.2} fill={`url(#${meteredGradientId})`} dot={false} isAnimationActive={false} />
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

/**
 * Downsamples each side and converts to kW, carrying "not known" through as `undefined`.
 *
 * `downsampleTrend` averages a bucket, and an average that silently treats a missing value as 0
 * would reintroduce exactly the fabrication the gap exists to avoid — so an unknown point is
 * marked `online: false` on the way in and read back through `pointValue` on the way out, using
 * the same suppression rule as every other chart rather than a second one invented here.
 */
function downsamplePaired(paired: UntrackedPoint[], maxPoints: number) {
  const side = (pick: (p: UntrackedPoint) => number | undefined) =>
    downsampleTrend(
      paired.map((p) => {
        const v = pick(p);
        return v === undefined ? { ts: p.ts, power_w: 0, online: false } : { ts: p.ts, power_w: v, online: true };
      }),
      maxPoints,
    );

  const totalDown = side((p) => p.total);
  const meteredDown = side((p) => p.metered);
  const length = Math.min(totalDown.length, meteredDown.length);
  const kw = (v: number | undefined) => (v === undefined ? undefined : v / 1000);
  return Array.from({ length }, (_, i) => ({
    t: Date.parse(totalDown[i].ts),
    totalKw: kw(pointValue(totalDown[i], 'power')),
    meteredKw: kw(pointValue(meteredDown[i], 'power')),
  }));
}

function formatTick(t: number): string {
  return siteTimeShort(t);
}
