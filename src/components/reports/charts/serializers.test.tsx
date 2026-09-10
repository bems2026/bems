import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { escapeXml } from './escapeXml';
import { sceneToSvg } from './sceneToSvg';
import { SceneSvg } from './sceneToJsx';
import { PRINT_PALETTE } from './palette';
import type { Scene } from './types';

/**
 * The drift guard for the two-serializer design.
 *
 * A chart generator computes geometry once and returns a scene; one serializer turns it into
 * React elements for the page, another into an SVG string for the PDF. That buys React's own
 * text escaping on the consumer that has a scripting engine attached — this codebase contains
 * no `dangerouslySetInnerHTML` and the first use of it should not be for labels built from
 * operator-editable device names. The price is that two renderers can disagree, and this file
 * is what makes that impossible to do quietly: one scene through both, compared node for node.
 *
 * It is deliberately NOT a snapshot. A snapshot would go green on `npm test -u` after a change
 * that broke the equivalence, which is the whole property being defended.
 */

/** Tag + attributes (sorted, so serializer attribute order is not the thing under test) +
 *  text, in document order. Two renderings that agree on this draw the same picture. */
function shape(root: Element): string[] {
  const out: string[] = [];
  const walk = (el: Element) => {
    const attrs = Array.from(el.attributes)
      .map((a) => `${a.name}=${a.value}`)
      .sort()
      .join(' ');
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join('');
    out.push(`${el.tagName.toLowerCase()}[${attrs}]${text ? `#${text}` : ''}`);
    Array.from(el.children).forEach(walk);
  };
  walk(root);
  return out;
}

function parseSvg(markup: string): Element {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`the SVG string is not well-formed XML: ${err.textContent}`);
  return doc.documentElement;
}

/** Deliberately exercises every Mark and Def kind — an unexercised variant is an unguarded one. */
const SCENE: Scene = {
  width: 300,
  height: 120,
  idPrefix: 'p',
  title: 'Daily energy for August 2026',
  desc: 'Nine days, one of them unobserved.',
  defs: [
    { kind: 'hatch', id: 'p-gap', stroke: PRINT_PALETTE.gap },
    { kind: 'linearGradient', id: 'p-area', from: PRINT_PALETTE.series[0], to: PRINT_PALETTE.series[0], fromOpacity: 0.35, toOpacity: 0 },
  ],
  marks: [
    { kind: 'rect', x: 10, y: 20, w: 30, h: 80, fill: PRINT_PALETTE.series[0] },
    { kind: 'rect', x: 50, y: 20, w: 30, h: 80, fill: 'url(#p-gap)', opacity: 0.5, rx: 2 },
    { kind: 'line', x1: 0, y1: 40, x2: 300, y2: 40, stroke: PRINT_PALETTE.threshold, width: 1.5, dash: '5 3' },
    { kind: 'line', x1: 0, y1: 60, x2: 300, y2: 60, stroke: PRINT_PALETTE.grid, opacity: 0.6 },
    { kind: 'path', d: 'M 0 120 L 60 40 L 300 120 Z', fill: 'url(#p-area)' },
    { kind: 'path', d: 'M 0 10 L 300 10', stroke: PRINT_PALETTE.ink, width: 2, opacity: 0.9 },
    { kind: 'text', x: 12, y: 16, text: 'Outlet & Bench <CO5>', fill: PRINT_PALETTE.text, size: 11 },
    { kind: 'text', x: 150, y: 60, text: 'no data', fill: PRINT_PALETTE.textMuted, size: 8, anchor: 'middle', weight: 600, dy: 3 },
  ],
};

describe('escapeXml', () => {
  it('neutralises every character that can end an attribute or open a tag', () => {
    expect(escapeXml('<')).toBe('&lt;');
    expect(escapeXml('>')).toBe('&gt;');
    expect(escapeXml('&')).toBe('&amp;');
    expect(escapeXml('"')).toBe('&quot;');
    expect(escapeXml("'")).toBe('&apos;');
  });

  it('escapes the ampersand first, so an escape is never itself re-escaped', () => {
    // Getting this order wrong turns `<` into `&amp;lt;`, which renders as the literal
    // text "&lt;" — visible, wrong, and not a security hole, so nobody looks for it.
    expect(escapeXml('a<b')).toBe('a&lt;b');
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
  });

  it('defuses a CDATA terminator', () => {
    expect(escapeXml(']]>')).toBe(']]&gt;');
  });

  it('defuses a device name that tries to close the chart and open a script', () => {
    // Device display names are operator-editable. `src/lib/csv.ts` already treats them as
    // untrusted for the spreadsheet-formula case; this is the same input, different sink.
    const hostile = '</svg><script>alert(1)</script>';
    const out = escapeXml(hostile);
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).toContain('&lt;/svg&gt;');
  });

  it('leaves ordinary text, units and non-ASCII alone', () => {
    expect(escapeXml('14.01 kWh · 08:00–20:28 — ₱1,039.20')).toBe('14.01 kWh · 08:00–20:28 — ₱1,039.20');
  });
});

describe('sceneToSvg', () => {
  it('produces well-formed XML with the attributes pdfmake needs', () => {
    const el = parseSvg(sceneToSvg(SCENE, PRINT_PALETTE));
    expect(el.tagName.toLowerCase()).toBe('svg');
    // pdfmake's parser wants an explicit namespace and an intrinsic size to fit against.
    expect(el.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(el.getAttribute('width')).toBe('300');
    expect(el.getAttribute('height')).toBe('120');
    expect(el.getAttribute('viewBox')).toBe('0 0 300 120');
  });

  it('escapes hostile text rather than emitting it', () => {
    const hostile: Scene = { ...SCENE, marks: [{ kind: 'text', x: 0, y: 0, text: '</svg><script>alert(1)</script>', fill: '#000', size: 10 }] };
    const svg = sceneToSvg(hostile, PRINT_PALETTE);
    expect(svg).not.toContain('<script');
    expect(() => parseSvg(svg)).not.toThrow();
  });

  it('carries the title and desc as elements, not attributes', () => {
    const el = parseSvg(sceneToSvg(SCENE, PRINT_PALETTE));
    expect(el.querySelector('title')?.textContent).toBe(SCENE.title);
    expect(el.querySelector('desc')?.textContent).toBe(SCENE.desc);
  });

  it('is deterministic — the same scene twice is the same string', () => {
    // This is what lets the page and the document be two renderings of one claim rather than
    // two claims. A generator reaching for Date.now() or Math.random() fails here.
    expect(sceneToSvg(SCENE, PRINT_PALETTE)).toBe(sceneToSvg(SCENE, PRINT_PALETTE));
  });

  it('emits none of the SVG features pdfmake cannot render', () => {
    // The compatibility contract, enforced mechanically rather than by comment. Each of these
    // fails silently in a PDF — a mis-set label or a missing shape, never an error.
    const svg = sceneToSvg(SCENE, PRINT_PALETTE);
    ['dominant-baseline', 'alignment-baseline', 'foreignObject', 'clipPath', 'filter=', 'class=', '<style'].forEach((banned) =>
      expect(svg).not.toContain(banned)
    );
  });
});

describe('SceneSvg renders the same picture as sceneToSvg', () => {
  it('agrees node for node, attribute for attribute', () => {
    const { container } = render(<SceneSvg scene={SCENE} palette={PRINT_PALETTE} />);
    const fromJsx = container.querySelector('svg');
    expect(fromJsx).not.toBeNull();
    expect(shape(fromJsx as Element)).toEqual(shape(parseSvg(sceneToSvg(SCENE, PRINT_PALETTE))));
  });

  it('renders a hostile device name as text, never as markup', () => {
    const hostile: Scene = { ...SCENE, marks: [{ kind: 'text', x: 0, y: 0, text: '</svg><script>alert(1)</script>', fill: '#000', size: 10 }] };
    const { container } = render(<SceneSvg scene={hostile} palette={PRINT_PALETTE} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('is an image to assistive technology, named by its own title and desc', () => {
    // Not aria-hidden. Sparkline.tsx is aria-hidden because a number sits beside it; a
    // heatmap or a duration curve has no such number, so the chart has to name itself.
    const { container } = render(<SceneSvg scene={SCENE} palette={PRINT_PALETTE} />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    const labelledBy = (svg.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    expect(labelledBy).toHaveLength(2);
    labelledBy.forEach((id) => expect(container.querySelector(`#${id}`)).not.toBeNull());
    expect(labelledBy.every((id) => id.startsWith(`${SCENE.idPrefix}-`))).toBe(true);
  });
});
