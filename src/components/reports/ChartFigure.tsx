import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { SceneSvg } from './charts/sceneToJsx';
import { ReportTable } from './ReportTable';
import { SCREEN_PALETTE } from './charts/palette';
import { hitAt, isHitKey, stepHit } from './charts/hitNavigation';
import type { Hit, Scene } from './charts/types';

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
 *
 * READING A VALUE OFF THE PICTURE — RM-084. Pointing at a day, an hour, a cell or a circuit shows
 * its value; so does stepping through them with the arrow keys, from ONE tab stop — a month's
 * heatmap is 744 cells, and 744 tab stops would be a trap rather than a feature. A live region
 * says each value the keyboard lands on, and says nothing on hover, where it would only chatter.
 * The tooltip leads with the value, because the reader already knows which chart they are on.
 *
 * It enhances and never gates: every value is still in the table. The hits come from the scene,
 * so the page and the PDF cannot draw different charts; the PDF simply has nothing to point with.
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

interface Reading {
  /** The scene the index belongs to. A reading taken on another period's chart is not shown. */
  scene: Scene;
  index: number;
  via: 'pointer' | 'key';
  /** Where the tooltip anchors, in px from the figure's padding box. */
  left: number;
  top: number;
  /** Anchored on the left of the value rather than the right, or above rather than below. */
  before: boolean;
  above: boolean;
}

interface Measured {
  svg: DOMRect;
  originX: number;
  originY: number;
  halfWidth: number;
}

const NO_HITS: readonly Hit[] = [];
const pct = (value: number, of: number) => `${(value / of) * 100}%`;

export function ChartFigure({ scene, table, caption, summaryLabel = 'Show the numbers' }: Props) {
  const text = caption ?? scene.desc;
  /**
   * The caption is hidden from assistive technology when it merely repeats the scene's own
   * `<desc>`, which the image is already labelled by. Without this a screen reader reads the
   * same sentence twice in a row — once as the image's description, once as the caption under
   * it. A caller-supplied caption says something the chart cannot know, so that one is exposed.
   */
  const duplicatesDesc = text === scene.desc;

  const hits = scene.hits ?? NO_HITS;
  const figureRef = useRef<HTMLElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  // Derived rather than reset in an effect: new data is a new scene, and the old index simply lapses.
  const current = reading && reading.scene === scene && reading.index < hits.length ? reading : null;
  const hit = current ? hits[current.index] : null;

  /** The drawn plot's box, which scales with the column — so scene units are converted, not assumed. */
  const measure = (): Measured | null => {
    const svg = plotRef.current?.querySelector('svg');
    const figure = figureRef.current;
    if (!svg || !figure) return null;
    const s = svg.getBoundingClientRect();
    const f = figure.getBoundingClientRect();
    if (s.width <= 0 || s.height <= 0) return null;
    return { svg: s, originX: s.left - f.left - figure.clientLeft, originY: s.top - f.top - figure.clientTop, halfWidth: figure.clientWidth / 2 };
  };

  const read = (index: number | null, via: Reading['via'], m: Measured | null) => {
    if (index === null) {
      setReading(null);
      return;
    }
    const h = hits[index];
    if (!m) {
      // Nothing laid out to anchor to. The live region still speaks; the tooltip sits at the corner.
      setReading({ scene, index, via, left: 0, top: 0, before: false, above: false });
      return;
    }
    const kx = m.svg.width / scene.width;
    const ky = m.svg.height / scene.height;
    // Beside the value, on whichever side has more room, so the tooltip never covers what it describes.
    const before = m.originX + (h.x + h.w / 2) * kx > m.halfWidth;
    const above = (h.y + h.h / 2) / scene.height > 0.5;
    setReading({
      scene,
      index,
      via,
      left: m.originX + (before ? h.x : h.x + h.w) * kx,
      top: m.originY + (above ? h.y + h.h : h.y) * ky,
      before,
      above,
    });
  };

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const m = measure();
    if (!m) return;
    const index = hitAt(hits, ((e.clientX - m.svg.left) / m.svg.width) * scene.width, ((e.clientY - m.svg.top) / m.svg.height) * scene.height);
    if (current && current.via === 'pointer' && current.index === index) return;
    read(index, 'pointer', m);
  };

  // A finger lifting is not the reader leaving: on the kiosk a tapped value stays until the next tap.
  const onPointerLeave = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') setReading(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      if (current) {
        e.preventDefault();
        setReading(null);
      }
      return;
    }
    if (!isHitKey(e.key)) return;
    e.preventDefault();
    read(stepHit(hits, current?.index ?? null, e.key), 'key', measure());
  };

  const svg = <SceneSvg scene={scene} palette={SCREEN_PALETTE} />;

  return (
    <figure className="report-chart" ref={figureRef}>
      <div className="report-chart__plot" ref={plotRef}>
        {hits.length > 0 ? (
          <div
            className="report-chart__explore"
            role="group"
            tabIndex={0}
            aria-label={`Explore the values in ${scene.title}. Use the arrow keys to move between them.`}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={onPointerLeave}
            onKeyDown={onKeyDown}
            onBlur={() => setReading(null)}
          >
            {svg}
            {hit ? (
              <span
                className="report-chart__focus"
                aria-hidden="true"
                style={{ left: pct(hit.x, scene.width), top: pct(hit.y, scene.height), width: pct(hit.w, scene.width), height: pct(hit.h, scene.height) }}
              />
            ) : null}
          </div>
        ) : (
          svg
        )}
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
      {hit && current ? (
        <div
          role="tooltip"
          className={`chart-tooltip report-chart__tip${current.before ? ' report-chart__tip--before' : ''}${current.above ? ' report-chart__tip--above' : ''}`}
          style={{ left: current.left, top: current.top }}
        >
          {/* Text children only: a label can be an operator-edited circuit name. */}
          <span className="chart-tooltip__value">{hit.value}</span>
          <span className="chart-tooltip__time">{hit.label}</span>
          {hit.note ? <span className="chart-tooltip__note">{hit.note}</span> : null}
        </div>
      ) : null}
      {hits.length > 0 ? (
        <p className="sr-only" role="status">
          {hit && current?.via === 'key' ? `${hit.value}, ${hit.label}${hit.note ? `. ${hit.note}` : ''}` : ''}
        </p>
      ) : null}
    </figure>
  );
}
