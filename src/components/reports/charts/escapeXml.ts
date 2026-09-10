/**
 * XML-escape a string bound for an SVG text node or attribute.
 *
 * WHY THIS EXISTS. `sceneToSvg` builds markup by concatenation, for pdfmake, which parses it
 * with its own XML reader. Nothing in that path escapes anything. The strings passing through
 * it include device display names, and those are **operator-editable** — `src/lib/csv.ts`
 * already carries `neutralise()` because the same names reach a spreadsheet, where the payload
 * is a formula rather than a tag. Same untrusted input, different sink, so it needs its own
 * refusal rather than assuming the other one ran.
 *
 * The React serializer does not use this: `sceneToJsx` emits real elements and React escapes
 * text itself, by construction. That asymmetry is the whole reason the scene has two renderers
 * rather than one string — the consumer with a scripting engine attached never sees hand-rolled
 * markup at all.
 *
 * `&` IS REPLACED FIRST and that is not stylistic. Replacing `<` first turns it into `&lt;`,
 * and the later `&` pass then turns that into `&amp;lt;` — which renders as the literal text
 * "&lt;". Not a security hole, so nobody goes looking for it; just a label that is quietly
 * wrong in a document going to a university.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
