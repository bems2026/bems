import { useEffect, useMemo, useState } from 'react';
import { loadBaselineDays } from '@shared/siteConfig.mjs';
import { SITE_BASELINE, type Holiday } from '@/lib/baselineCompare';
import { projectPeriod, type BaselineDays, type ProjectedPeriod } from '@/lib/baselineProjection';
import type { ReportPeriod } from '@/lib/supabaseReports';
import type { Section } from './useReportData';

/**
 * The baseline for a period, as the Reports page reads it — RM-154.
 *
 * NO FETCH. The baseline is committed with the site (`baseline.mjs`), and the recorded days behind it are a
 * second module the browser loads on first use (`loadBaselineDays`): about 12 kB compressed, so the main bundle
 * does not carry it for a reader who never picks Baseline. Everything else is arithmetic over that file.
 *
 * `holidays` turns each into a closed day: the comparison asks for that, the baseline view does not.
 */

export interface BaselineReport {
  status: Section<unknown>['status'];
  error: string | null;
  /** The days module, once loaded — `null` when this site has none. */
  days: BaselineDays | null;
  projected: ProjectedPeriod | null;
}

let loaded: Promise<BaselineDays | null> | null = null;
/** Once per page load: the module is static, and a second import would only ask the cache. */
function loadDays(): Promise<BaselineDays | null> {
  loaded ??= loadBaselineDays().then((m) => (m.BASELINE_DAYS as unknown as BaselineDays | null) ?? null);
  return loaded;
}

export function useBaselineReport(period: ReportPeriod, start: string | null, enabled: boolean, holidays: readonly Holiday[] = []): BaselineReport {
  const [days, setDays] = useState<BaselineDays | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || days !== undefined || SITE_BASELINE === null) return;
    let cancelled = false;
    loadDays().then(
      (d) => !cancelled && setDays(d),
      (e: unknown) => {
        // Let a later attempt try the import again rather than remembering the failure.
        loaded = null;
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, days]);

  const projected = useMemo(
    () => (enabled && SITE_BASELINE && days && start ? projectPeriod(SITE_BASELINE, days, period, start, { holidays }) : null),
    [enabled, days, period, start, holidays]
  );

  if (!enabled) return { status: 'idle', error: null, days: days ?? null, projected: null };
  if (SITE_BASELINE === null) return { status: 'ready', error: null, days: null, projected: null };
  if (error !== null) return { status: 'error', error, days: null, projected: null };
  if (days === undefined) return { status: 'loading', error: null, days: null, projected: null };
  return { status: 'ready', error: null, days, projected };
}

/** A projected series as the page's sections, every one ready at once. */
export function readySection<T>(data: T | null, status: Section<unknown>['status'], error: string | null = null): Section<T> {
  return { status, data, error, retry: () => {} };
}
