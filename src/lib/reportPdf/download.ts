import { buildDocDefinition, type PdfReport } from './docDefinition';

/**
 * The only file in this codebase that knows pdfmake exists.
 *
 * DYNAMICALLY IMPORTED, so the two megabytes it costs never touch a first paint. The kiosk boots
 * on a Raspberry Pi and spends most of its life on the Overview page; a reader who never exports
 * a report should never pay for the ability to. Same posture as the 3D pack (RM-032), and
 * `vite.config.ts` gives it its own chunk so the figure stays visible in the build output rather
 * than buried in a vendor bundle.
 *
 * THREE THINGS THE SPIKE FOUND, none of them in anybody's documentation, each of which fails
 * SILENTLY — no error, no warning, no timeout, just a promise that never settles:
 *
 *   1. **pdfmake 0.3 is Promise-based.** `createPdf(def).getBlob(cb)` — the callback form in
 *      every tutorial and every LLM's memory — is the 0.2 API. On 0.3 it hangs forever.
 *   2. **Fonts must come from the font CONTAINER.** `build/fonts/Roboto.js` self-registers via
 *      `addFontContainer` and works. `build/vfs_fonts.js` registers the font FILES but no font
 *      DEFINITIONS, so `font: 'Roboto'` is unknown and rendering hangs in exactly the same way —
 *      which is how one of these bugs looks like the other.
 *   3. SVG `<text>` resolves fonts through a different path than pdfmake's own text. In the
 *      browser that resolves against the virtual filesystem and is fine; in Node it hits the
 *      real one. One more reason this never runs server-side.
 */

/** Guards against a second click while the first is still rendering — a Pi takes long enough. */
let inFlight: Promise<void> | null = null;

export function isGenerating(): boolean {
  return inFlight !== null;
}

export async function downloadReportPdf(report: PdfReport, filename: string): Promise<void> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const [{ default: pdfMake }] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      // Loaded for its side effect: the container calls `addFontContainer` on the global as soon
      // as it evaluates. Awaited alongside rather than after, because it does not depend on the
      // first — but it must have run before `createPdf`.
      import('pdfmake/build/fonts/Roboto.js'),
    ]);

    // 0.3 returns a Promise. `.download()` does the anchor dance itself, which is the one part
    // of this that is not worth hand-rolling — see `csv.ts`'s `downloadCsv` for the same three
    // DOM calls, and the same note that they are not pure and not unit-tested.
    await pdfMake.createPdf(buildDocDefinition(report)).download(filename);
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}
