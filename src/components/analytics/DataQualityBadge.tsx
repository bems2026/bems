import { Badge } from '@/components/ui/Badge';
import { formatAge, syncSummary, type SyncStatus } from '@/lib/dataQuality';
import { useConnectionStore } from '@/stores/connectionStore';
import { useNowTick } from '@/lib/useNowTick';
import type { SlotQuality } from '@/lib/timeseries';

/**
 * One row above a chart: whether what it draws is current, and how much of it was measured —
 * RM-076. The first badge is always there (Live / Syncing… / Cached · 3 min old / History
 * unavailable); the rest appear only when there is something to say, so a clean chart stays quiet.
 * The wording lives in `lib/dataQuality.ts`.
 */
export function DataQualityBadge({
  sync,
  quality,
  gapCount = 0,
  frozenNames = [],
  stepMs,
}: {
  sync: SyncStatus;
  quality?: Record<SlotQuality, number>;
  gapCount?: number;
  frozenNames?: string[];
  stepMs: number;
}) {
  const wsStatus = useConnectionStore((s) => s.wsStatus);
  const now = useNowTick();
  const summary = syncSummary(sync, wsStatus, now);
  const interpolated = quality?.interpolated ?? 0;

  return (
    <div className="data-quality" role="group" aria-label="Data quality">
      <span title={summary.detail}>
        <Badge tone={summary.tone} dot>
          {summary.text}
        </Badge>
      </span>
      {interpolated > 0 && <Badge tone="neutral">{`Interpolated · ${formatAge(interpolated * stepMs)}`}</Badge>}
      {gapCount > 0 && <Badge tone="warn">{`Offline · ${gapCount} ${gapCount === 1 ? 'window' : 'windows'}`}</Badge>}
      {frozenNames.length > 0 && <Badge tone="warn">{`Frozen · ${frozenNames.join(', ')}`}</Badge>}
      <span className="sr-only">{summary.detail}</span>
    </div>
  );
}
