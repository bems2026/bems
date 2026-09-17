import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The fonts are registered by the export itself, before the document is created — never left to the
 * font file's side effect.
 *
 * `pdfmake/build/fonts/Roboto.js` registers itself only if `pdfMake` is already on the global when it
 * evaluates, and pdfmake puts itself there only when ITS module evaluates. The export imports both at once,
 * so which runs first is the bundler's choice. On 2026-09-17 a rebuild changed it: every PDF on the kiosk
 * failed with "File 'Roboto-Medium.ttf' not found in virtual file system" — the first bold text asking for
 * a font nobody had registered — while the same export had worked that morning on the build before.
 */

const addFontContainer = vi.fn();
const download = vi.fn(async () => undefined);
const createPdf = vi.fn(() => ({ download }));
const CONTAINER = { vfs: { 'Roboto-Medium.ttf': 'AAEA' }, fonts: { Roboto: { bold: 'Roboto-Medium.ttf' } } };

vi.mock('pdfmake/build/pdfmake', () => ({ default: { addFontContainer, createPdf } }));
// Deliberately registers nothing on import: the order that broke the kiosk.
vi.mock('pdfmake/build/fonts/Roboto.js', () => ({ default: CONTAINER }));
vi.mock('./docDefinition', () => ({ buildDocDefinition: vi.fn(() => ({ content: [] })) }));

const { downloadReportPdf } = await import('./download');

beforeEach(() => {
  addFontContainer.mockClear();
  createPdf.mockClear();
  download.mockClear();
});

describe('downloadReportPdf', () => {
  it('registers the font container itself, before it creates the document', async () => {
    await downloadReportPdf({} as never, 'report.pdf');
    expect(addFontContainer).toHaveBeenCalledWith(CONTAINER);
    expect(createPdf).toHaveBeenCalledTimes(1);
    expect(addFontContainer.mock.invocationCallOrder[0]).toBeLessThan(createPdf.mock.invocationCallOrder[0]);
    expect(download).toHaveBeenCalledWith('report.pdf');
  });

  it('registers them again on the next export, so a failed or reloaded chunk cannot leave them missing', async () => {
    await downloadReportPdf({} as never, 'a.pdf');
    await downloadReportPdf({} as never, 'b.pdf');
    expect(addFontContainer).toHaveBeenCalledTimes(2);
  });
});
