/**
 * pdfmake ships no types for its prebuilt browser bundle, and `@types/pdfmake` describes the
 * 0.2 API — the callback one, which on 0.3 hangs forever with no error. Typing it against that
 * package would have TypeScript vouching for the exact call that does not work.
 *
 * So: a hand-written declaration of the 0.3 surface this codebase actually uses, measured from
 * the running library rather than from documentation. Narrow on purpose — a method absent from
 * here is one nobody has checked exists.
 */
declare module 'pdfmake/build/pdfmake' {
  /** Every one of these returns a Promise in 0.3. The 0.2 callback forms are gone. */
  interface CreatedPdf {
    download(filename?: string): Promise<void>;
    getBlob(): Promise<Blob>;
    getBase64(): Promise<string>;
    open(): Promise<void>;
    print(): Promise<void>;
  }

  interface PdfMake {
    /** The document definition. Deliberately `unknown` rather than a hand-copy of pdfmake's own
     *  type: `src/lib/reportPdf/docDefinition.ts` is the authority on our document's shape, and
     *  a second partial description of it here would be a second thing to keep in step. */
    createPdf(docDefinition: unknown): CreatedPdf;
    /** Registers a font container's files and definitions. `download.ts` calls it on every export. */
    addFontContainer(container: unknown): void;
    addVirtualFileSystem(vfs: unknown): void;
    addFonts(fonts: Record<string, Record<string, string>>): void;
  }

  const pdfMake: PdfMake;
  export default pdfMake;
}

/** The Roboto container. It registers itself only if `pdfMake` is already global when it evaluates, which is
 * not guaranteed, so `download.ts` passes it to `addFontContainer` explicitly. */
declare module 'pdfmake/build/fonts/Roboto.js' {
  const fontContainer: { vfs: Record<string, string>; fonts: Record<string, Record<string, string>> };
  export default fontContainer;
}
