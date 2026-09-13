import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { SITE } from '@shared/siteConfig.mjs';
import { NOT_SAID } from '@shared/reportProse.mjs';
import { PRINT_PALETTE } from './charts/palette';
import { sceneToSvg } from './charts/sceneToSvg';
import { dailyEnergyChart } from './charts/dailyEnergyChart';
import { loadProfileChart } from './charts/loadProfileChart';
import { circuitBreakdownChart } from './charts/circuitBreakdownChart';
import { demandHeatmapChart } from './charts/demandHeatmapChart';
import { durationCurveChart } from './charts/durationCurveChart';
import { toDailyPoints, toDurationPoints, toHeatCells, toHourPoints } from '@/lib/reportSeries';
import { CONTENT_WIDTH, type PdfChart, type PdfReport } from '@/lib/reportPdf/docDefinition';
import { coverageOf, type PeriodBuildingReport, type PeriodDeviceReport, type ReportPeriod } from '@/lib/supabaseReports';
import { siteDateTime } from '@/lib/siteTime';
import { bootedScript } from '@/lib/buildVersion';
import { isQuotable } from '@/lib/supabaseReports';
import { provenanceLines, type Carboned, type Costed } from '@/lib/energyCost';
import type { ChartsData } from './ReportCharts';

/**
 * Exporting the report as a document.
 *
 * THE CHARTS ARE GENERATED TWICE, ON PURPOSE. The page's copies are built against
 * `SCREEN_PALETTE`, whose values are `var(--…)` and follow the theme toggle. These are built
 * against `PRINT_PALETTE` — concrete hex, mirroring the light theme — because **paper is white**
 * whatever the kiosk happens to be set to, and a reader in dark mode should not get a document
 * they cannot print. Same scenes, same numbers, different ink.
 *
 * pdfmake is not imported here. `src/lib/reportPdf/download.ts` is the only file that touches it,
 * dynamically, so this button costs nothing until it is pressed.
 */

interface Props {
  period: ReportPeriod;
  periodLabel: string;
  building: PeriodBuildingReport | null;
  rows: readonly PeriodDeviceReport[] | null;
  charts: ChartsData | null;
  cost: Costed;
  carbon: Carboned;
  nameOf: (id: string) => string;
}

const f = (v: number | null, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v.toFixed(digits);

export function ExportPdfButton({ period, periodLabel, building, rows, charts, cost, carbon, nameOf }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = charts !== null && rows !== null;

  const run = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const buildingCoverage = building ? coverageOf(building.online_sample_count, building.expected_sample_count) : null;
      const spec = (idPrefix: string, height: number, title: string) => ({
        width: CONTENT_WIDTH,
        height,
        palette: PRINT_PALETTE,
        idPrefix,
        title,
        desc: '',
      });

      const scenes = [
        dailyEnergyChart(toDailyPoints(charts.daily), spec('pdf-de', 220, 'Energy per day')),
        loadProfileChart(toHourPoints(charts.hours), spec('pdf-lp', 210, 'Demand by hour of the day')),
        circuitBreakdownChart(charts.segments, spec('pdf-cb', 100, 'Where the energy went'), { untracked: charts.untracked }),
        demandHeatmapChart(toHeatCells(charts.matrix), spec('pdf-hm', charts.daily.length > 10 ? 300 : 190, 'Demand by day and hour')),
        durationCurveChart(toDurationPoints(charts.curve), spec('pdf-dc', 210, 'Load duration'), { thresholdW: charts.ceilingW }),
      ];

      const tables: PdfChart['table'][] = [
        {
          headers: ['Day', 'Energy (kWh)', 'Peak (W)', 'Readings'],
          rows: charts.daily.map((d) => [
            d.local_day,
            d.usable_sample_count > 0 ? f(d.energy_kwh) : null,
            f(d.peak_power_w, 0),
            `${d.usable_sample_count} of ${d.sample_count}`,
          ]),
        },
        {
          headers: ['Hour', 'Samples', 'Median (W)', 'p95 (W)', 'Peak (W)'],
          rows: toHourPoints(charts.hours).map((h) => [
            `${String(h.hour).padStart(2, '0')}:00`,
            String(h.n),
            f(h.p50, 0),
            f(h.p95, 0),
            f(h.max, 0),
          ]),
        },
        {
          headers: ['Circuit', 'Energy (kWh)'],
          rows: charts.segments.map((s) => [s.label, f(s.kwh)]),
        },
        // The heatmap's 744 cells are not a table anyone reads; the hour profile above already
        // carries the per-hour numbers, so this one rolls up to the day.
        {
          headers: ['Day', 'Hours with readings'],
          rows: charts.daily.map((d) => [
            d.local_day,
            String(charts.matrix.filter((c) => c.local_day.slice(0, 10) === d.local_day.slice(0, 10) && c.usable_sample_count > 0).length),
          ]),
        },
        {
          headers: ['Share of period', 'At or above (W)'],
          rows: toDurationPoints(charts.curve)
            .filter((_, i) => i % 10 === 0)
            .map((p) => [`${p.pct}%`, f(p.w, 0)]),
        },
      ];

      const report: PdfReport = {
        title: 'Energy report',
        siteName: SITE.display_name,
        timezone: SITE.timezone,
        generatedAt: siteDateTime(Date.now()),
        periodLabel,
        buildId: bootedScript(),
        summary: charts.summary ?? null,
        observedDays: charts.daily.filter((d) => d.usable_sample_count > 0).length,
        completeDays: charts.daily.filter((d) => d.expected_samples > 0 && d.usable_sample_count / d.expected_samples >= 0.95).length,
        energyKwh: building?.energy_kwh ?? null,
        // The same qualifier the energy carries. A figure qualified on screen and bare in the
        // document is worse than one that was never qualified at all.
        cost:
          cost.total === null
            ? null
            : { text: `${cost.total.toFixed(2)} ${cost.currency ?? ''}`.trim(), qualified: !isQuotable(buildingCoverage) },
        carbon:
          carbon.total === null ? null : { text: `${carbon.total.toFixed(1)} kgCO2e`, qualified: !isQuotable(buildingCoverage) },
        provenance: provenanceLines(cost, carbon),
        charts: scenes.map((scene, i) => ({
          title: scene.title,
          svg: sceneToSvg(scene, PRINT_PALETTE),
          desc: scene.desc,
          table: tables[i],
        })),
        deviceRows: rows.map((r) => {
          const c = coverageOf(r.online_sample_count, r.expected_sample_count);
          return {
            name: nameOf(r.device_id),
            energyKwh: f(r.energy_kwh),
            peakW: f(r.peak_power_w, 0),
            avgW: f(r.avg_power_w, 0),
            coverage: c ? `${Math.round(c.ratio * 100)}%` : '—',
          };
        }),
        caveats: NOT_SAID,
      };

      const { downloadReportPdf } = await import('@/lib/reportPdf/download');
      await downloadReportPdf(report, `ibems-${period}-report-${periodLabel.replace(/\s+/g, '-').toLowerCase()}.pdf`);
    } catch (err) {
      // Surfaced rather than swallowed. A button that silently does nothing on a kiosk gets
      // pressed again, and the second press is how you get two documents.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="devices-add-btn"
        onClick={run}
        disabled={!ready || busy}
        aria-busy={busy || undefined}
      >
        <FileDown size={16} aria-hidden="true" /> {busy ? 'Building PDF…' : 'Download PDF'}
      </button>
      {error ? (
        <p className="reports-note reports-note--error" role="alert">
          The PDF could not be built: {error}
        </p>
      ) : null}
    </>
  );
}
