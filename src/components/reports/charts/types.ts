/**
 * A chart is a SCENE, not a picture — a flat list of resolved drawing primitives that two
 * serializers turn into two things: React elements for the page, and an SVG string for the PDF.
 *
 * WHY NOT JUST RETURN AN SVG STRING. It would be one renderer instead of two, and the PDF and
 * the page could not possibly disagree. But putting a string into the DOM means
 * `dangerouslySetInnerHTML`, which appears **nowhere in this codebase**, and the first use of it
 * would be for chart labels built partly from operator-editable device names — the same names
 * `src/lib/csv.ts` already treats as untrusted input for the spreadsheet-formula case. Going
 * through real React elements means React escapes text for us, by construction, in the consumer
 * that has a scripting engine attached. `sceneToSvg` escapes by hand because pdfmake's parser
 * does not, and its `escapeXml` is tested against the payloads that matter.
 *
 * The cost of two serializers is drift, and it is paid for the way this project pays for every
 * duplicated value: one guard test renders the same scene through both and asserts they agree.
 * The geometry itself is computed exactly once, in the generator, so there is nothing for the
 * two to disagree ABOUT except how they spell it.
 *
 * WHAT A GENERATOR MAY NOT DO. Generators are pure: no DOM, no `useId`, no `Date.now`, no
 * `Math.random`. The same input must produce the same scene, because the page and the document
 * are two renderings of one claim about a building.
 */

/**
 * The subset of SVG that survives pdfmake's renderer. Deliberately small.
 *
 * Excluded on purpose, having been measured or reasoned about rather than guessed:
 * `foreignObject`, `mask`, `filter`, and `clipPath` in objectBoundingBox units (unsupported);
 * `dominant-baseline` (patchy — the failure is a silently mis-set label, so text carries an
 * explicit `dy` in user units instead); CSS classes and `<style>` blocks (there is no
 * stylesheet inside a PDF).
 */
export type Mark =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string; opacity?: number; rx?: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width?: number; dash?: string; opacity?: number }
  | { kind: 'path'; d: string; fill?: string; stroke?: string; width?: number; opacity?: number }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      fill: string;
      size: number;
      anchor?: 'start' | 'middle' | 'end';
      weight?: 400 | 500 | 600;
      /** Vertical nudge in user units. Explicit, because `dominant-baseline` is not portable. */
      dy?: number;
    };

/**
 * Reusable paint servers. The only reason `<defs>` exists here is that the two marks that say
 * "this was not observed" and "this is a filled series" need one — a hatch cannot be a colour
 * and a gradient cannot be a mark.
 */
export type Def =
  /** Diagonal hatch. THE mark for an unobserved bucket — never a zero-height bar. */
  | { kind: 'hatch'; id: string; stroke: string; width?: number; gap?: number }
  | { kind: 'linearGradient'; id: string; from: string; to: string; fromOpacity?: number; toOpacity?: number };

export interface Scene {
  width: number;
  height: number;
  /**
   * The namespace every id in this scene carries — the generator's `ChartSpec.idPrefix`,
   * recorded here so both serializers mint the same `<title>`/`<desc>` ids and the equivalence
   * guard has something to compare. `sceneInvariants` asserts every def id starts with it.
   */
  idPrefix: string;
  /** Becomes `<title>`; the accessible name. State the finding, not the chart type. */
  title: string;
  /** Becomes `<desc>`; says shape, range, and how many buckets were unobserved. */
  desc: string;
  defs: Def[];
  marks: Mark[];
}

export interface ChartPalette {
  /** Axis rules and any mark whose job is structure rather than data. */
  ink: string;
  text: string;
  textMuted: string;
  grid: string;
  surface: string;
  /** Categorical, in order. Four is not an accident: this building has four branch meters. */
  series: readonly string[];
  good: string;
  warn: string;
  bad: string;
  /** The hatch stroke that means "nobody was watching". */
  gap: string;
  /** The DSM ceiling. Always drawn dashed as well as coloured — shape, not just hue. */
  threshold: string;
  /** Sequential ramp, least to most. The only ordered scale in the palette. */
  heat: readonly string[];
  fontFamily: string;
}

export interface ChartSpec {
  width: number;
  height: number;
  palette: ChartPalette;
  /**
   * Namespace for every id minted inside this scene. REQUIRED, and deliberately without a
   * default: two copies of one chart in one document sharing a gradient id is a silent,
   * order-dependent rendering bug, and the PDF embeds the same charts the page is showing.
   */
  idPrefix: string;
  title: string;
  desc: string;
}

export type ChartGenerator<T> = (data: T, spec: ChartSpec) => Scene;
