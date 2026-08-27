import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { SpaceTreePanel } from './SpaceTreePanel';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import type { SpaceNode } from '@/lib/spaceTree';

const nodes: SpaceNode[] = [
  { id: 'b', site_id: 's', parent_id: null, kind: 'building', name: 'NBERIC', sort_order: 0, attrs: {} },
  { id: 'f', site_id: 's', parent_id: 'b', kind: 'floor', name: 'Ground', sort_order: 0, attrs: {} },
  { id: 'r', site_id: 's', parent_id: 'f', kind: 'room', name: 'CARE Office', sort_order: 0, attrs: {} },
];

const add = vi.fn();
const remove = vi.fn();
const rename = vi.fn();

function seed(overrides: Partial<ReturnType<typeof useSpaceTreeStore.getState>> = {}) {
  useSpaceTreeStore.setState({
    nodes,
    status: 'ready',
    mutating: false,
    error: null,
    add,
    remove,
    rename,
    canEdit: true,
    load: vi.fn(),
    ...overrides,
  });
}

describe('SpaceTreePanel', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    seed();
  });

  it('renders the tree indented, coarse to fine', () => {
    render(<SpaceTreePanel onClose={() => {}} />);
    expect(screen.getByText('NBERIC')).toBeInTheDocument();
    expect(screen.getByText('Ground')).toBeInTheDocument();
    expect(screen.getByText('CARE Office')).toBeInTheDocument();
  });

  it('says what to do when the tree is empty rather than showing a blank box', () => {
    // A fresh site has no tree. An empty frame is indistinguishable from a failed load.
    seed({ nodes: [] });
    render(<SpaceTreePanel onClose={() => {}} />);
    expect(screen.getByText(/no spaces yet/i)).toBeInTheDocument();
  });

  it('surfaces a load error instead of pretending the site has no rooms', () => {
    seed({ nodes: [], error: 'Supabase space_nodes fetch failed: offline' });
    render(<SpaceTreePanel onClose={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/offline/);
  });

  it('adds a child under the node whose Add button was pressed', () => {
    render(<SpaceTreePanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add inside ground/i }));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Store Room' } });
    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'room' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(add).toHaveBeenCalledWith({ parent_id: 'f', kind: 'room', name: 'Store Room' });
  });

  it('adds a root when Add space is used, not a child of whatever was last touched', () => {
    render(<SpaceTreePanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add top-level space/i }));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Annex' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ parent_id: null, name: 'Annex' }));
  });

  it('a delete states its blast radius and does nothing until confirmed', async () => {
    render(<SpaceTreePanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /delete ground/i }));
    // Deleting a floor takes its rooms. That is invisible from the row being clicked, so the
    // count has to be in the prompt — this is the one destructive action in the panel.
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/1 space inside/i);
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /delete space/i }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('f'));
  });

  it('a leaf delete does not claim to take anything with it', () => {
    render(<SpaceTreePanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /delete care office/i }));
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent(/inside/i);
  });

  it('explains itself instead of offering controls that cannot work', () => {
    // Found in a real browser, not by these tests: with Supabase unconfigured the add button
    // was enabled and clicking it produced "Cannot read properties of null (reading 'auth')".
    // The unit tests mock supabase as truthy, so they could never have caught it.
    seed({ canEdit: false, nodes: [] });
    render(<SpaceTreePanel onClose={() => {}} />);
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add top-level space/i })).toBeDisabled();
  });

  it('disables the controls while a write is in flight', () => {
    seed({ mutating: true });
    render(<SpaceTreePanel onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /add top-level space/i })).toBeDisabled();
  });
});
