import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { besideMaxWidth, placeBeside } from '@/components/ui/popoverPlacement';
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
 *
 * THE TOOLTIP IS PLACED LIKE EVERY OTHER POPOVER — RM-141. It had arithmetic of its own that chose a side
 * from the value's centre and anchored at its edge, with no clamp: a share-bar segment spanning most of the
 * bar put it about 111 px off the left of a 360 px phone and 35–105 px past the right of the kiosk. It is
 * measured before paint and placed by `placeBeside`, which keeps this file's rule — beside the value, never
 * over it — inside the part of the figure that is on screen. Stepping by keyboard scrolls a phone's plot
 * so the value reached is on screen too.
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
  /** Where along the value the pointer is, in viewport px — the place to sit beside a wide one. */
  pointerX?: number;
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
  const drawn = (): DOMRect | null => {
    const s = plotRef.current?.querySelector('svg')?.getBoundingClientRect();
    return s && s.width > 0 && s.height > 0 ? s : null;
  };

  const read = (index: number | null, via: Reading['via'], pointerX?: number) => {
    setReading(index === null ? null : { scene, index, via, pointerX });
  };

  /**
   * Beside the value and inside the part of the figure on screen — measured before paint, so the reader
   * never sees it land somewhere first. Nothing laid out (a test's layout, a hidden tab) leaves it where
   * the stylesheet puts it; the live region still speaks.
   */
  const tipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const figure = figureRef.current;
    const s = drawn();
    if (!tip || !figure || !s || !current) return;
    const h = hits[current.index];
    const kx = s.width / scene.width;
    const ky = s.height / scene.height;
    const anchor = { left: s.left + h.x * kx, right: s.left + (h.x + h.w) * kx, top: s.top + h.y * ky, bottom: s.top + (h.y + h.h) * ky };
    const f = figure.getBoundingClientRect();
    const viewWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewHeight = document.documentElement.clientHeight || window.innerHeight;
    const bounds = { left: Math.max(0, f.left), right: Math.min(viewWidth, f.right), top: 0, bottom: viewHeight };
    // Capped first, so the height measured is the height at the width it will have.
    tip.style.maxWidth = `${besideMaxWidth(bounds)}px`;
    const p = placeBeside({ anchor, bounds, width: tip.offsetWidth, height: tip.offsetHeight, point: current.pointerX ?? (anchor.left + anchor.right) / 2 });
    tip.style.maxHeight = `${p.maxHeight}px`;
    tip.style.left = `${p.left - f.left - figure.clientLeft}px`;
    tip.style.top = `${p.top - f.top - figure.clientTop}px`;
  });

  /** On a phone the plot scrolls; a value reached by keyboard is scrolled into view before it is read. */
  const reveal = (index: number | null) => {
    const plot = plotRef.current;
    const s = drawn();
    if (index === null || !plot || !s) return;
    const kx = s.width / scene.width;
    const [from, to] = [hits[index].x * kx, (hits[index].x + hits[index].w) * kx];
    if (from < plot.scrollLeft || to > plot.scrollLeft + plot.clientWidth) plot.scrollLeft = Math.max(0, (from + to) / 2 - plot.clientWidth / 2);
  };

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const s = drawn();
    if (!s) return;
    const index = hitAt(hits, ((e.clientX - s.left) / s.width) * scene.width, ((e.clientY - s.top) / s.height) * scene.height);
    if (current && current.via === 'pointer' && current.index === index) return;
    read(index, 'pointer', e.clientX);
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
    const next = stepHit(hits, current?.index ?? null, e.key);
    reveal(next);
    read(next, 'key');
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
        <div ref={tipRef} role="tooltip" className="chart-tooltip report-chart__tip">
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
