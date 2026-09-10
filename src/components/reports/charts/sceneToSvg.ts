import { escapeXml } from './escapeXml';
import { sceneToNodes, type SvgNode } from './sceneNodes';
import type { ChartPalette, Scene } from './types';

/**
 * A scene as an SVG string, for pdfmake.
 *
 * Everything interesting happened in `sceneToNodes`. This walks the tree it produced and
 * concatenates, escaping as it goes — attribute values as well as text, because a device name
 * can reach a `<title>` and an axis label alike.
 *
 * Deterministic by construction: no ids are minted here, no dates are read, and every number
 * was already turned into a string upstream. `serializers.test.tsx` asserts it, because that
 * determinism is what makes the page and the PDF two renderings of one claim.
 */

function serialize(node: SvgNode): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join('');
  const inner = node.text !== undefined
    ? escapeXml(node.text)
    : (node.children ?? []).map(serialize).join('');
  // Self-closing when empty: `<line …/>` rather than `<line …></line>`. Both parse; one is
  // half the bytes in a heatmap with 744 of them.
  return inner === '' ? `<${node.tag}${attrs}/>` : `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

export function sceneToSvg(scene: Scene, palette: ChartPalette): string {
  return serialize(sceneToNodes(scene, palette));
}
