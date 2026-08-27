import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SpaceTotalsCard } from './SpaceTotalsCard';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import type { SpaceNode } from '@/lib/spaceTree';

const fetchNodeTotals = vi.fn();
vi.mock('@/lib/nodeTotals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/nodeTotals')>();
  return { ...actual, fetchNodeTotals: (...a: unknown[]) => fetchNodeTotals(...a) };
});

const nodes: SpaceNode[] = [
  { id: 'b', site_id: 's', parent_id: null, kind: 'building', name: 'NBERIC', sort_order: 0, attrs: {} },
  { id: 'f', site_id: 's', parent_id: 'b', kind: 'floor', name: 'Ground', sort_order: 0, attrs: {} },
  { id: 'lab', site_id: 's', parent_id: 'f', kind: 'room', name: 'Lab', sort_order: 0, attrs: {} },
];

const seed = (over: Partial<ReturnType<typeof useSpaceTreeStore.getState>> = {}) =>
  useSpaceTreeStore.setState({ nodes, status: 'ready', mutating: false, error: null, canEdit: true, ...over });

const totals = (over = {}) => ({
  deviceCount: 3, reportingCount: 3, sampleCount: 100, onlineSampleCount: 100,
  avgPowerW: 212.5, peakPowerW: 940, ...over,
});

describe('SpaceTotalsCard', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    seed();
  });

  it('offers every space by full path, so two rooms with one name stay distinguishable', () => {
    render(<SpaceTotalsCard range="24h" />);
    const options = [...screen.getByRole('combobox').querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['Choose a space', 'NBERIC', 'NBERIC / Ground', 'NBERIC / Ground / Lab']);
  });

  it('asks nothing until a space is chosen, rather than guessing one', () => {
    // Defaulting to the first node would silently answer a question nobody asked, and on a site
    // with several buildings the first is arbitrary.
    render(<SpaceTotalsCard range="24h" />);
    expect(fetchNodeTotals).not.toHaveBeenCalled();
  });

  it('reads the chosen space over the page range', async () => {
    fetchNodeTotals.mockResolvedValue(totals());
    render(<SpaceTotalsCard range="24h" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lab' } });
    await waitFor(() => expect(fetchNodeTotals).toHaveBeenCalled());
    expect(fetchNodeTotals.mock.calls[0][0]).toBe('lab');
    await screen.findByText(/212\.5/);
    expect(screen.getByText(/940/)).toBeInTheDocument();
  });

  it('renders unobserved power as a dash, never as zero', async () => {
    // The whole honesty rule, carried to the last place it can be broken. `node_totals` returns
    // NULL for a scope it did not observe, and a 0 here would be a reading nobody took.
    fetchNodeTotals.mockResolvedValue(totals({ avgPowerW: null, peakPowerW: null, onlineSampleCount: 0, sampleCount: 0 }));
    render(<SpaceTotalsCard range="24h" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lab' } });
    await waitFor(() => expect(fetchNodeTotals).toHaveBeenCalled());
    const card = await screen.findByTestId('space-totals-figures');
    expect(card.textContent).not.toMatch(/\b0(\.0)?\s*W/);
    expect(card.textContent).toMatch(/—/);
  });

  it('says nothing was observed rather than leaving the dash unexplained', async () => {
    fetchNodeTotals.mockResolvedValue(totals({ avgPowerW: null, peakPowerW: null, onlineSampleCount: 0, sampleCount: 0 }));
    render(<SpaceTotalsCard range="24h" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lab' } });
    expect(await screen.findByText(/no readings/i)).toBeInTheDocument();
  });

  it('reports partial coverage rather than quoting the figure bare', async () => {
    // EX-033's rule: a number without its coverage cannot distinguish a quiet room from an
    // unplugged one. 40 of 100 samples observed is a fact the operator needs beside the average.
    fetchNodeTotals.mockResolvedValue(totals({ sampleCount: 100, onlineSampleCount: 40 }));
    render(<SpaceTotalsCard range="24h" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lab' } });
    expect(await screen.findByText(/40%/)).toBeInTheDocument();
  });

  it('says so when no tree exists, instead of an empty picker', () => {
    seed({ nodes: [] });
    render(<SpaceTotalsCard range="24h" />);
    expect(screen.getByText(/no spaces defined/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('says so when Supabase is not configured, instead of offering a control that always fails', () => {
    // Learned from SpaceTreePanel, where this exact case shipped as a raw TypeError because the
    // unit tests mock the client as present. Covered here from the start rather than after.
    seed({ canEdit: false });
    render(<SpaceTotalsCard range="24h" />);
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
    expect(fetchNodeTotals).not.toHaveBeenCalled();
  });

  it('surfaces a failed read instead of showing stale figures under a new space', async () => {
    fetchNodeTotals.mockResolvedValueOnce(totals()).mockRejectedValueOnce(new Error('boom'));
    render(<SpaceTotalsCard range="24h" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lab' } });
    await screen.findByText(/212\.5/);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'f' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/);
    expect(screen.queryByText(/212\.5/)).not.toBeInTheDocument();
  });
});
