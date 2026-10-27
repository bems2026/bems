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
 *   2. **Fonts must come from the font CONTAINER.** `build/vfs_fonts.js` registers the font FILES but
 *      no font DEFINITIONS, so `font: 'Roboto'` is unknown and rendering hangs in exactly the same way —
 *      which is how one of these bugs looks like the other. And the container must be REGISTERED HERE,
 *      not trusted to register itself: `build/fonts/Roboto.js` calls `addFontContainer` only if `pdfMake`
 *      is already on the global when it evaluates, and pdfmake puts itself there only when its own
 *      module evaluates. Both are imported at once, so the order is the bundler's. On 2026-09-17 a
 *      rebuild flipped it and every export on the kiosk failed with "File 'Roboto-Medium.ttf' not found
 *      in virtual file system" — the first bold text asking for a font nobody had registered.
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
    const [{ default: pdfMake }, { default: roboto }] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/fonts/Roboto.js'),
    ]);
    // Every export, explicitly — see (2) above. Registering twice only rewrites the same four files.
    pdfMake.addFontContainer(roboto);

    // 0.3 returns a Promise. `.download()` does the anchor dance itself, which is the one part
    // of this that is not worth hand-rolling — see `csv.ts`'s `downloadCsv` for the same three
    // DOM calls, and the same note that they are not pure and not unit-tested.
    await pdfMake.createPdf(buildDocDefinition(report)).download(filename);
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * RM-164: the same document, shown rather than saved — in `tab`, which the press opened before the build began
 * (a tab opened after an await is a pop-up, and browsers block it). Resolves false when there is no tab to show
 * it in, so the caller can say so instead of appearing to do nothing.
 */
export async function previewReportPdf(report: PdfReport, tab: Window | null): Promise<boolean> {
  if (!tab || tab.closed) return false;
  const [{ default: pdfMake }, { default: roboto }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/fonts/Roboto.js'),
  ]);
  pdfMake.addFontContainer(roboto);
  const blob = await pdfMake.createPdf(buildDocDefinition(report)).getBlob();
  const url = URL.createObjectURL(blob);
  // Not revoked: the browser's PDF viewer reads it again for its own Download and Print, at any later time.
  // One document per preview press, freed with the page.
  tab.location.href = url;
  return true;
}
