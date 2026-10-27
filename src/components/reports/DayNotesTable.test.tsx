import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DayNotesTable } from './DayNotesTable';
import { useReportNotesStore, noteKey } from '@/stores/reportNotesStore';
import * as api from '@/lib/supabaseReportNotes';

/** RM-164: a note beside each day of the period, typed in place and saved on leaving the field. */

vi.mock('@/config/supabase', () => ({ supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) } } }));
vi.mock('@/lib/supabaseReportNotes', async (orig) => ({
  ...(await orig<typeof import('@/lib/supabaseReportNotes')>()),
  fetchReportNotes: vi.fn(),
  saveReportNote: vi.fn(),
}));

const day = (d: string, kwh: number) => ({ local_day: `2026-09-${d}`, energy_kwh: kwh, peak_power_w: 1500, usable_sample_count: 1440 });
// Weekdays in September 2026; the 14th is well above the usual.
const days = [...['01', '02', '03', '04', '07', '08', '09', '10'].map((d) => day(d, 12)), day('14', 30)];

afterEach(cleanup);

beforeEach(() => {
  useReportNotesStore.setState({ notes: {}, saveState: {}, unavailable: null, error: null, loadedRange: null });
  vi.mocked(api.saveReportNote).mockReset();
});

describe('DayNotesTable', () => {
  it('shows each day with its saved note, and marks a day well above the usual', () => {
    useReportNotesStore.setState({ notes: { [noteKey('day', '2026-09-02')]: 'Seminar' } });
    render(<DayNotesTable days={days} label="September 2026" readOnly={false} />);
    expect(screen.getByLabelText('Note for 2026-09-02')).toHaveValue('Seminar');
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByLabelText('Note for 2026-09-14')).toHaveAttribute('placeholder', 'Why was this day high?');
  });

  it('saves a note when the field is left, and says so', async () => {
    vi.mocked(api.saveReportNote).mockResolvedValue('Both aircons on for a visit');
    render(<DayNotesTable days={days} label="September 2026" readOnly={false} />);
    const field = screen.getByLabelText('Note for 2026-09-14');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'Both aircons on for a visit' } });
    fireEvent.blur(field);
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(api.saveReportNote).toHaveBeenCalledWith('day', '2026-09-14', 'Both aircons on for a visit', 'u1');
  });

  it('a failed save keeps the text and offers to try again', async () => {
    vi.mocked(api.saveReportNote).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('Power cut');
    render(<DayNotesTable days={days} label="September 2026" readOnly={false} />);
    const field = screen.getByLabelText('Note for 2026-09-03');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'Power cut' } });
    fireEvent.blur(field);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(field).toHaveValue('Power cut');
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  it('cannot be typed in without an account, and says why', () => {
    render(<DayNotesTable days={days} label="September 2026" readOnly />);
    expect(screen.getByLabelText('Note for 2026-09-01')).toHaveAttribute('readonly');
    expect(screen.getByText(/Sign in with an account/)).toBeInTheDocument();
  });

  it('says notes need phase56 when the table is missing', () => {
    useReportNotesStore.setState({ unavailable: 'Notes need supabase/phase56_report_notes.sql applied in the SQL editor.' });
    render(<DayNotesTable days={days} label="September 2026" readOnly={false} />);
    expect(screen.getByText(/phase56/)).toBeInTheDocument();
    expect(screen.getByLabelText('Note for 2026-09-01')).toHaveAttribute('readonly');
  });
});
