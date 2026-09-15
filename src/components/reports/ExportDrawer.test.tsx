import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ExportDrawer } from './ExportDrawer';

/**
 * RM-083b — choosing what to take away.
 *
 * The reader picks a format and, for the PDF, the sections. Two sections cannot be unticked:
 * coverage, and what the report does not say (operator decision, 2026-09-15). What these tests pin is
 * that the choice reaches the export intact, that a second press while the first is working exports
 * nothing more, and that the outcome is said where the reader is looking.
 */

const STORAGE_KEY = 'ibems.reportExport.v1';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

const draw = (props: Partial<Parameters<typeof ExportDrawer>[0]> = {}) => {
  const onExport = props.onExport ?? vi.fn(async () => 'Saved');
  const utils = render(<ExportDrawer periodLabel="August 2026" onClose={() => {}} onExport={onExport} {...props} />);
  return { ...utils, onExport };
};

describe('ExportDrawer', () => {
  it('names the period it exports, and offers the PDF first', () => {
    draw();
    expect(screen.getByRole('dialog', { name: 'Export August 2026' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /PDF/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Simple CSV/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Per-device CSV/ })).not.toBeChecked();
  });

  it('lists every section, with coverage and the refusals locked and saying why', () => {
    draw();
    for (const name of ['Coverage', 'What this report does not say']) {
      const box = screen.getByRole('checkbox', { name });
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
      expect(box).toHaveAccessibleDescription(/Always included/);
    }
    expect(screen.getByRole('checkbox', { name: 'Energy per day' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Energy per day' })).toBeEnabled();
  });

  it('says under a section when its chart could not be loaded and will be left out', () => {
    draw({ sectionNotes: { durationCurve: 'Could not be loaded, so it will be left out of the PDF.' } });
    expect(screen.getByRole('checkbox', { name: 'Load duration' })).toHaveAccessibleDescription(/left out of the PDF/);
  });

  it('will not let a locked section be unticked', () => {
    draw();
    const coverage = screen.getByRole('checkbox', { name: 'Coverage' });
    fireEvent.click(coverage);
    expect(coverage).toBeChecked();
  });

  it('exports the sections chosen, with the locked ones, in the order the document reads', async () => {
    const { onExport } = draw();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Energy per day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    const [format, sections] = vi.mocked(onExport).mock.calls[0];
    expect(format).toBe('pdf');
    expect(sections[0]).toBe('coverage');
    expect(sections[sections.length - 1]).toBe('notSaid');
    expect(sections).not.toContain('dailyEnergy');
    expect(sections).toContain('heatmap');
  });

  it('exports once on a double press, and says what it did when it is done', async () => {
    let finish!: (message: string) => void;
    const onExport = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    draw({ onExport });

    const generate = screen.getByRole('button', { name: 'Generate PDF' });
    fireEvent.click(generate);
    fireEvent.click(generate);
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /Preparing/ })).toBeDisabled();

    finish('PDF saved · 7 pages');
    expect(await screen.findByRole('status')).toHaveTextContent('PDF saved · 7 pages');
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('says a failure in words beside the button, rather than doing nothing', async () => {
    draw({ onExport: vi.fn(async () => { throw new Error('the PDF library could not be loaded'); }) });
    fireEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the PDF library could not be loaded');
  });

  it('offers no sections for a CSV, and says what the file holds instead', async () => {
    const { onExport } = draw();
    fireEvent.click(screen.getByRole('radio', { name: /Simple CSV/ }));
    expect(screen.queryByRole('checkbox', { name: 'Energy per day' })).toBeNull();
    expect(screen.getByText(/one row per day/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith('daily-csv', expect.any(Array)));
  });

  it('says why an export cannot run now, and will not start it', () => {
    draw({ unavailable: { 'device-csv': 'No per-device rows were stored for this period.' } });
    const radio = screen.getByRole('radio', { name: /Per-device CSV/ });
    expect(radio).toBeDisabled();
    expect(radio).toHaveAccessibleDescription('No per-device rows were stored for this period.');
  });

  it('remembers the last choice for this viewer', () => {
    const { unmount } = draw();
    fireEvent.click(screen.getByRole('radio', { name: /Simple CSV/ }));
    unmount();

    draw();
    expect(screen.getByRole('radio', { name: /Simple CSV/ })).toBeChecked();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('still opens on the defaults when the browser refuses storage', () => {
    // Private windows and locked-down kiosks throw on access. A convenience must not break the export.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    draw();
    expect(screen.getByRole('radio', { name: /PDF/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Simple CSV/ }));
    expect(screen.getByRole('radio', { name: /Simple CSV/ })).toBeChecked();
  });

  it('ignores a remembered choice from an older build that names sections this one does not have', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ format: 'pdf', sections: ['sankey', 'devices'] }));
    draw();
    expect(screen.getByRole('checkbox', { name: 'By device' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Energy per day' })).not.toBeChecked();
  });
});
