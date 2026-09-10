import { createElement, type ReactElement } from 'react';
import { sceneToNodes, type SvgNode } from './sceneNodes';
import type { ChartPalette, Scene } from './types';

/**
 * A scene as React elements, for the page.
 *
 * The point of this file is what it does NOT do: it never builds markup. Text arrives as a
 * React child, so React escapes it — which is why an operator who names a device
 * `</svg><script>…` gets a device with a silly name rather than a script. The string
 * serializer needs `escapeXml` precisely because it has no such guarantee; this one is safe by
 * construction, and that asymmetry is the reason the scene has two renderers instead of one.
 *
 * Attribute names come through in SVG's own kebab-case (`stroke-width`, `font-size`). React
 * passes unrecognised hyphenated attributes to the DOM verbatim, which is exactly what is
 * wanted here: `sceneNodes` is the authority on spelling, and re-camelCasing on this side
 * would be a second vocabulary for the equivalence test to reconcile.
 */

function toElement(node: SvgNode, key: number): ReactElement {
  const children = node.text !== undefined
    ? node.text
    : (node.children ?? []).map(toElement);
  return createElement(node.tag, { ...node.attrs, key }, children);
}

export function SceneSvg({ scene, palette }: { scene: Scene; palette: ChartPalette }): ReactElement {
  return toElement(sceneToNodes(scene, palette), 0);
}
