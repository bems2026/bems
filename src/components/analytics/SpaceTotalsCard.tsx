/**
 * "How much did the lab use?" — RM-030, the question this system could not answer.
 *
 * `readings` is per device and `building_totals` is per building, with nothing in between,
 * because nothing knew what a lab was. RM-028 gave spaces structure and `node_totals`
 * (phase22) makes them add up; this is where an operator actually asks.
 *
 * A SEPARATE CARD RATHER THAN A THIRD AXIS ON THE PAGE'S EXISTING CONTROLS. AnalyticsPage
 * already carries a `Scope` (which device group), a param, and a per-scope selection, all
 * interacting. Spatial scope is a different question asked of a different data source, and
 * threading it through that machinery would couple two things that have no reason to move
 * together.
 *
 * EVERY FIGURE HERE CAN BE A LIE IF IT IS RENDERED CARELESSLY. `node_totals` returns NULL for a
 * scope it did not observe, and this is the last place that NULL can be turned into a zero —
 * which would report a reading nobody took, the failure shape RM-024 and EX-107 exist to
 * prevent. Coverage sits beside the figures for the same reason the Reports page shows it
 * (EX-033): a number alone cannot tell a quiet room from an unplugged one.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { Boxes } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { InfoHint } from '@/components/ui/InfoHint';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import { flattenForPicker } from '@/lib/spaceTree';
import { fetchNodeTotals, coverageOf, type NodeTotals } from '@/lib/nodeTotals';
import { formatNumber } from '@/lib/format';
import type { AnalyticsRange } from './useAnalyticsHistory';

/** How far back each of the page's ranges reaches, in hours. Keyed by `AnalyticsRange`, so a
 * range added without a window here is a type error rather than a silently empty card. */
const RANGE_HOURS: Record<AnalyticsRange, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '1y': 24 * 365 };

export function SpaceTotalsCard({ range }: { range: AnalyticsRange }) {
  const nodes = useSpaceTreeStore((s) => s.nodes);
  const configured = useSpaceTreeStore((s) => s.canEdit);
  const [nodeId, setNodeId] = useState<string>('');
  const selectId = useId();

  const options = useMemo(() => flattenForPicker(nodes), [nodes]);

  /**
   * One piece of state carrying WHAT IT ANSWERS, not just the answer.
   *
   * The obvious shape — separate `totals`/`error`/`loading`, cleared at the top of the effect —
   * needs three synchronous `setState` calls inside the effect, which cascades renders and is
   * what eslint's react-hooks rule objects to. It is also procedural: "remember to clear the old
   * figures" is a rule someone has to keep following.
   *
   * Tagging the result with the request that produced it makes the same guarantee structural.
   * A result for a different space or range simply is not the current one, so the previous
   * space's numbers CANNOT be rendered under a new heading, and a stale response arriving late
   * cannot overwrite a newer one. Loading and staleness are then derived rather than tracked.
   */
  const [result, setResult] = useState<{ key: string; totals?: NodeTotals; error?: string } | null>(null);
  const requestKey = `${nodeId}|${range}`;

  useEffect(() => {
    if (!nodeId || !configured) return;
    let cancelled = false;
    const since = new Date(Date.now() - RANGE_HOURS[range] * 3600_000);
    fetchNodeTotals(nodeId, since)
      .then((t) => {
        if (!cancelled) setResult({ key: requestKey, totals: t });
      })
      .catch((e: unknown) => {
        if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, nodeId, range, configured]);

  // A result from an earlier request is not "old data to keep showing" — it is an answer to a
  // question no longer being asked, so it is ignored entirely.
  const current = result !== null && result.key === requestKey ? result : null;
  const totals = current?.totals ?? null;
  const error = current?.error ?? null;
  const loading = nodeId !== '' && configured && current === null;

  const coverage = totals ? coverageOf(totals) : null;
  const observedNothing = totals !== null && totals.onlineSampleCount === 0;

  return (
    <Card className="space-totals-card">
      <div className="space-totals-card__head">
        <h3 className="card-title">
          <Boxes size={16} className="title-icon" aria-hidden="true" />
          By space
          <InfoHint label="What a space total counts">
            Totals for a space <strong>and everything inside it</strong> — a floor includes its
            rooms. Only readings a device actually reported are counted: a meter that went quiet
            contributes nothing rather than its last known value, so a space with no readings
            shows <strong>—</strong> rather than zero.
          </InfoHint>
        </h3>
      </div>

      {!configured && (
        <p className="space-totals-card__note">
          Supabase is not configured for this deployment, so per-space totals are unavailable here.
        </p>
      )}

      {configured && options.length === 0 && (
        <p className="space-totals-card__note">
          No spaces defined yet. Add them from Spaces on the Devices page, then place devices into
          them — this card totals whatever is placed.
        </p>
      )}

      {configured && options.length > 0 && (
        <>
          <label className="space-totals-card__field" htmlFor={selectId}>
            Space
          </label>
          <select
            id={selectId}
            className="space-totals-card__select"
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
          >
            {/* No default selection. Picking the first node would answer a question nobody
                asked, and on a site with several buildings the first is arbitrary. */}
            <option value="">Choose a space</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.path}
              </option>
            ))}
          </select>

          {error && (
            <p className="space-totals-card__error" role="alert">
              {error}
            </p>
          )}

          {loading && !error && <p className="space-totals-card__note">Reading…</p>}

          {totals && !error && (
            <>
              <div className="space-totals-card__figures" data-testid="space-totals-figures">
                <Figure label="Average" value={totals.avgPowerW} />
                <Figure label="Peak" value={totals.peakPowerW} />
              </div>
              <p className="space-totals-card__meta">
                {totals.deviceCount} device{totals.deviceCount === 1 ? '' : 's'} placed
                {totals.deviceCount > 0 && `, ${totals.reportingCount} reporting`}
                {/* The dash needs its reason next to it, or it reads as a bug rather than as an
                    answer. "No readings" is the answer. */}
                {observedNothing && ' · no readings in this range'}
                {coverage !== null && coverage > 0 && coverage < 1 && ` · ${Math.round(coverage * 100)}% of samples observed`}
              </p>
            </>
          )}
        </>
      )}
    </Card>
  );
}

/** `formatNumber` already renders missing as `—` and never as 0 — the project's one rule for
 * this, in one place (`src/lib/format.ts`). Reimplementing it here is how the rule erodes. */
function Figure({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="space-totals-card__figure">
      <span className="metric-label">{label}</span>
      <span className="space-totals-card__value">
        {formatNumber(value ?? undefined, 1)}
        {value !== null && <span className="space-totals-card__unit"> W</span>}
      </span>
    </div>
  );
}
