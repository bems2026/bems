import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useReportNotesStore, noteKey } from './reportNotesStore';
import * as api from '@/lib/supabaseReportNotes';

/** RM-164: notes on the Reports page, saved one at a time, each with its own state. */

vi.mock('@/config/supabase', () => ({ supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) } } }));
vi.mock('@/lib/supabaseReportNotes', async (orig) => ({
  ...(await orig<typeof import('@/lib/supabaseReportNotes')>()),
  fetchReportNotes: vi.fn(),
  saveReportNote: vi.fn(),
}));

beforeEach(() => {
  useReportNotesStore.setState({ notes: {}, saveState: {}, unavailable: null, error: null, loadedRange: null });
  vi.mocked(api.fetchReportNotes).mockReset();
  vi.mocked(api.saveReportNote).mockReset();
});

describe('reportNotesStore', () => {
  it('loads a period\'s notes in one request, keyed by kind and day', async () => {
    vi.mocked(api.fetchReportNotes).mockResolvedValue([
      { kind: 'day', start: '2026-09-23', note: 'Seminar: both aircons all day' },
      { kind: 'month', start: '2026-09-01', note: 'September remarks' },
    ]);
    await useReportNotesStore.getState().load('2026-09-01', '2026-09-30');
    expect(api.fetchReportNotes).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    expect(useReportNotesStore.getState().notes[noteKey('day', '2026-09-23')]).toMatch(/Seminar/);
    expect(useReportNotesStore.getState().notes[noteKey('month', '2026-09-01')]).toBe('September remarks');
  });

  it('saves one note under the signed-in account and says it saved', async () => {
    vi.mocked(api.saveReportNote).mockResolvedValue('Holiday');
    await useReportNotesStore.getState().save('day', '2026-09-13', 'Holiday');
    expect(api.saveReportNote).toHaveBeenCalledWith('day', '2026-09-13', 'Holiday', 'u1');
    expect(useReportNotesStore.getState().saveState[noteKey('day', '2026-09-13')]).toBe('saved');
  });

  it('a failed save keeps what was typed and says it did not save', async () => {
    vi.mocked(api.saveReportNote).mockRejectedValue(new Error('network'));
    await useReportNotesStore.getState().save('day', '2026-09-13', 'Typed offline');
    const s = useReportNotesStore.getState();
    expect(s.notes[noteKey('day', '2026-09-13')]).toBe('Typed offline');
    expect(s.saveState[noteKey('day', '2026-09-13')]).toBe('failed');
  });

  it('trying again after a failed save sends the same text again', async () => {
    vi.mocked(api.saveReportNote).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('Typed offline');
    await useReportNotesStore.getState().save('day', '2026-09-13', 'Typed offline');
    await useReportNotesStore.getState().save('day', '2026-09-13', 'Typed offline');
    expect(api.saveReportNote).toHaveBeenCalledTimes(2);
    expect(useReportNotesStore.getState().saveState[noteKey('day', '2026-09-13')]).toBe('saved');
  });

  it('an unchanged note is not saved again', async () => {
    useReportNotesStore.setState({ notes: { [noteKey('day', '2026-09-13')]: 'Holiday' } });
    await useReportNotesStore.getState().save('day', '2026-09-13', 'Holiday ');
    expect(api.saveReportNote).not.toHaveBeenCalled();
  });

  it('a database without the table says notes need phase56, rather than an error', async () => {
    vi.mocked(api.fetchReportNotes).mockRejectedValue(new api.NotesUnavailable('Notes need supabase/phase56_report_notes.sql applied in the SQL editor.'));
    await useReportNotesStore.getState().load('2026-09-01', '2026-09-30');
    expect(useReportNotesStore.getState().unavailable).toMatch(/phase56/);
    expect(useReportNotesStore.getState().error).toBeNull();
  });
});
