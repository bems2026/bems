import { useId, useMemo, useState } from 'react';
import { siteDateTime, siteTimeShort } from '@/lib/siteTime';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { SplitSquareVertical } from 'lucide-react';
import { useDeviceStore, historyFor } from '@/stores/deviceStore';
import { sumHistories } from '@/components/overview/totalPowerSeries';
import { downsampleTrend } from '@/components/trends/chartSummary';
import { InfoHint } from '@/components/ui/InfoHint';
import { alignTotalAndMetered } from './analyticsMath';

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

  const last = data[data.length - 1];
  const gapKw = Math.max(0, (last.totalKw ?? 0) - (last.meteredKw ?? 0));

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
        <span className="analytics-untracked-gap">{gapKw.toFixed(2)} kW untracked now</span>
      </div>
      <div
        className={`chart-frame chart-frame--axes-visible${revealed ? ' chart-frame--revealed' : ''}`}
        role="img"
        aria-label={`Panel total ${last.totalKw?.toFixed(2)} kW, outlet-metered ${last.meteredKw?.toFixed(2)} kW, gap ${gapKw.toFixed(2)} kW.`}
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

function downsamplePaired(paired: { ts: string; total: number; metered: number }[], maxPoints: number) {
  const asTotal = paired.map((p) => ({ ts: p.ts, power_w: p.total }));
  const asMetered = paired.map((p) => ({ ts: p.ts, power_w: p.metered }));
  const totalDown = downsampleTrend(asTotal, maxPoints);
  const meteredDown = downsampleTrend(asMetered, maxPoints);
  const length = Math.min(totalDown.length, meteredDown.length);
  return Array.from({ length }, (_, i) => ({
    t: Date.parse(totalDown[i].ts),
    totalKw: totalDown[i].power_w / 1000,
    meteredKw: meteredDown[i].power_w / 1000,
  }));
}

function formatTick(t: number): string {
  return siteTimeShort(t);
}
