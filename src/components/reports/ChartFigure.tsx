import { SceneSvg } from './charts/sceneToJsx';
import { ReportTable } from './ReportTable';
import { SCREEN_PALETTE } from './charts/palette';
import type { Scene } from './charts/types';

/**
 * A chart, its finding in prose, and the numbers behind it.
 *
 * `Sparkline.tsx` is `aria-hidden` and that is right for what it is — a decoration beside a
 * numeric stat that carries the same value. These are not that. A heatmap or a duration curve
 * has no number sitting next to it, so hiding it from a screen reader removes the finding rather
 * than de-duplicating it. The scene names itself instead: `role="img"` with `<title>`/`<desc>`,
 * wired up by `sceneToNodes`.
 *
 * THE TABLE IS NOT A FALLBACK, IT IS THE SAME CLAIM. It is collapsed because a sighted reader
 * has the picture, but it is the only form in which an exact figure can be read off — and it is
 * what makes an em dash for an unobserved bucket visible as an em dash rather than as an absence
 * in a drawing. Every chart in this folder can lose a value; none of them may lose it silently.
 */

export interface ChartTable {
  headers: readonly string[];
  /** `null` renders as an em dash. Never as 0 — that is the rule the whole page rests on. */
  rows: readonly (readonly (string | number | null)[])[];
}

interface Props {
  scene: Scene;
  table: ChartTable;
  /** Defaults to the scene's own description; override when the page has more context. */
  caption?: string;
  summaryLabel?: string;
}

export function ChartFigure({ scene, table, caption, summaryLabel = 'Show the numbers' }: Props) {
  const text = caption ?? scene.desc;
  /**
   * The caption is hidden from assistive technology when it merely repeats the scene's own
   * `<desc>`, which the image is already labelled by. Without this a screen reader reads the
   * same sentence twice in a row — once as the image's description, once as the caption under
   * it. A caller-supplied caption says something the chart cannot know, so that one is exposed.
   */
  const duplicatesDesc = text === scene.desc;

  return (
    <figure className="report-chart">
      <div className="report-chart__plot">
        <SceneSvg scene={scene} palette={SCREEN_PALETTE} />
      </div>
      <figcaption className="report-chart__caption" aria-hidden={duplicatesDesc || undefined}>
        {text}
      </figcaption>
      <details className="report-chart__data">
        <summary>{summaryLabel}</summary>
        {/* RM-082: the shared report table, so these numbers right-align like every other figure. */}
        <ReportTable
          columns={table.headers.map((header, i) => ({
            id: `${i}-${header}`,
            header,
            numeric: i > 0,
            cell: (row: readonly (string | number | null)[]) => row[i],
          }))}
          rows={table.rows}
          rowKey={(row, i) => `${String(row[0])}-${i}`}
          label={`The numbers behind ${scene.title}`}
        />
      </details>
    </figure>
  );
}
