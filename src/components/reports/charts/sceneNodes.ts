import type { ChartPalette, Def, Mark, Scene } from './types';

/**
 * The scene's single rendering pass.
 *
 * Both serializers consume THIS, not the scene. `sceneToSvg` turns the tree into a string for
 * pdfmake; `sceneToJsx` turns it into React elements for the page. Neither makes a decision —
 * every tag, every attribute name and every formatted number is chosen once, here.
 *
 * That is what makes the two-renderer design safe. The equivalence test still exists, but it
 * now guards two functions of roughly fifteen lines each rather than two independent
 * translations of a drawing model. There is almost nothing left for them to disagree about.
 */

export interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  /** Text content. Escaped by the string serializer; handed to React as a child by the other. */
  text?: string;
  children?: SvgNode[];
}

/**
 * Numbers become strings exactly once, here, so the two renderers cannot format them
 * differently. Three decimals: enough that a 744-cell heatmap's grid does not visibly drift,
 * few enough that the markup stays readable and the output stays byte-identical run to run.
 * `-0` is folded to `0` — it renders the same and compares differently.
 */
function n(value: number): string {
  const r = Math.round(value * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}

/** Drops absent optionals rather than emitting empty attributes, which the two renderers
 *  would otherwise be free to spell differently (`opacity=""` vs no attribute at all). */
function attrs(pairs: Record<string, string | number | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'number' ? n(v) : v;
  }
  return out;
}

function defNode(def: Def): SvgNode {
  if (def.kind === 'hatch') {
    const gap = def.gap ?? 6;
    return {
      tag: 'pattern',
      attrs: attrs({
        id: def.id,
        width: gap,
        height: gap,
        patternUnits: 'userSpaceOnUse',
        // 45° so the hatch cannot be mistaken for a gridline or a series rule, both of which
        // are axis-aligned. The mark that means "no data" has to be unlike every mark that
        // means data.
        patternTransform: 'rotate(45)',
      }),
      children: [
        {
          tag: 'line',
          attrs: attrs({ x1: 0, y1: 0, x2: 0, y2: gap, stroke: def.stroke, 'stroke-width': def.width ?? 1.5 }),
        },
      ],
    };
  }
  return {
    tag: 'linearGradient',
    attrs: attrs({ id: def.id, x1: 0, y1: 0, x2: 0, y2: 1 }),
    children: [
      { tag: 'stop', attrs: attrs({ offset: '5%', 'stop-color': def.from, 'stop-opacity': def.fromOpacity ?? 1 }) },
      { tag: 'stop', attrs: attrs({ offset: '95%', 'stop-color': def.to, 'stop-opacity': def.toOpacity ?? 0 }) },
    ],
  };
}

function markNode(mark: Mark, palette: ChartPalette): SvgNode {
  switch (mark.kind) {
    case 'rect':
      return {
        tag: 'rect',
        attrs: attrs({ x: mark.x, y: mark.y, width: mark.w, height: mark.h, fill: mark.fill, opacity: mark.opacity, rx: mark.rx }),
      };
    case 'line':
      return {
        tag: 'line',
        attrs: attrs({
          x1: mark.x1,
          y1: mark.y1,
          x2: mark.x2,
          y2: mark.y2,
          stroke: mark.stroke,
          'stroke-width': mark.width,
          'stroke-dasharray': mark.dash,
          opacity: mark.opacity,
        }),
      };
    case 'path':
      return {
        tag: 'path',
        attrs: attrs({
          d: mark.d,
          // An omitted fill on a <path> defaults to black, which is never what a chart wants;
          // saying `none` is the difference between an axis rule and a filled blob.
          fill: mark.fill ?? 'none',
          stroke: mark.stroke,
          'stroke-width': mark.width,
          opacity: mark.opacity,
        }),
      };
    case 'text':
      return {
        tag: 'text',
        attrs: attrs({
          x: mark.x,
          y: mark.y,
          fill: mark.fill,
          'font-size': mark.size,
          'font-family': palette.fontFamily,
          'text-anchor': mark.anchor,
          'font-weight': mark.weight,
          // Explicit, because `dominant-baseline` is not portable to pdfmake and its failure
          // is a label that is silently a few points off rather than an error.
          dy: mark.dy,
        }),
        text: mark.text,
      };
  }
}

export function sceneToNodes(scene: Scene, palette: ChartPalette): SvgNode {
  const titleId = `${scene.idPrefix}-title`;
  const descId = `${scene.idPrefix}-desc`;
  const children: SvgNode[] = [
    { tag: 'title', attrs: { id: titleId }, text: scene.title },
    { tag: 'desc', attrs: { id: descId }, text: scene.desc },
  ];
  if (scene.defs.length > 0) {
    children.push({ tag: 'defs', attrs: {}, children: scene.defs.map(defNode) });
  }
  children.push(...scene.marks.map((m) => markNode(m, palette)));

  return {
    tag: 'svg',
    attrs: {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${n(scene.width)} ${n(scene.height)}`,
      width: n(scene.width),
      height: n(scene.height),
      /**
       * A chart in a report is DATA, so it names itself. `Sparkline.tsx` is `aria-hidden`
       * for the opposite and correct reason — a numeric stat sits right beside it. A
       * heatmap or a duration curve has no such number, so hiding it would remove the
       * finding rather than de-duplicate it.
       *
       * pdfmake ignores role/aria and the title/desc ids; carrying them in both renderings
       * anyway is what lets the equivalence test compare the trees without exceptions.
       */
      role: 'img',
      'aria-labelledby': `${titleId} ${descId}`,
    },
    children,
  };
}
