import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { RoomShapeEditor } from './RoomShapeEditor';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import type { SpaceNode } from '@/lib/spaceTree';

const room = (attrs: Record<string, unknown> = {}): SpaceNode => ({
  id: 'n1',
  site_id: 's',
  parent_id: null,
  kind: 'room',
  name: 'CARE Office',
  sort_order: 0,
  attrs,
});

const setup = (attrs: Record<string, unknown> = {}, over: Partial<{ canEdit: boolean; mutating: boolean }> = {}) => {
  const setShape = vi.fn();
  useSpaceTreeStore.setState({ nodes: [room(attrs)], setShape, canEdit: true, mutating: false, ...over });
  render(<RoomShapeEditor nodeId="n1" nodeName="CARE Office" />);
  return { setShape };
};

afterEach(() => {
  // vite.config.ts sets `globals: false`, so RTL's automatic cleanup never registers.
  cleanup();
  vi.restoreAllMocks();
});

describe('RoomShapeEditor', () => {
  it('shows a rectangle for a room nobody has drawn, so an undrawn room is unchanged rather than blank', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads back the shape that was stored, rather than resetting to a preset', () => {
    // The reason a descriptor is stored instead of a rendered path: reopening the editor on an
    // existing room must offer more than "start again".
    setup({ plan: { kind: 'l', notch: 'bl', nw: 0.3, nh: 0.6 } });
    expect(screen.getByRole('button', { name: 'L-shape' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/Notch corner/)).toHaveValue('bl');
    expect(screen.getByLabelText(/Notch width/)).toHaveValue(30);
  });

  it('saves immediately when a preset is chosen', () => {
    // Same rule as `placeOnPlan`: an outline on screen that the database does not have is a
    // drawing of a room nobody agreed to.
    const { setShape } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Round' }));
    expect(setShape).toHaveBeenCalledWith('n1', { kind: 'circle' });
  });

  it('offers the notch controls only for the shape that has a notch', () => {
    setup({ plan: { kind: 'circle' } });
    expect(screen.queryByLabelText(/Notch corner/)).not.toBeInTheDocument();
  });

  it('ejects a preset onto a grid, and the cells are the preset rasterised rather than a blank grid', () => {
    const { setShape } = setup({ plan: { kind: 'rect' } });
    fireEvent.click(screen.getByRole('button', { name: /Adjust on a grid/ }));
    const [, shape] = setShape.mock.calls[0];
    expect(shape.kind).toBe('cells');
    // A rectangle fills its grid. Ejecting to an empty grid would throw away the outline the
    // operator had just chosen.
    expect(shape.on).toHaveLength(shape.cols * shape.rows);
  });

  it('warns that ejecting is one-way, because the data cannot honour a round trip', () => {
    setup({ plan: { kind: 'rect' } });
    expect(screen.getByText(/cannot be turned back into a preset/i)).toBeInTheDocument();
  });

  it('toggles one cell off without disturbing the others', () => {
    const { setShape } = setup({ plan: { kind: 'cells', cols: 2, rows: 2, on: [0, 1, 2, 3] } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cell column 1, row 1' }));
    expect(setShape).toHaveBeenCalledWith('n1', { kind: 'cells', cols: 2, rows: 2, on: [1, 2, 3] });
  });

  it('toggles a cell back on', () => {
    const { setShape } = setup({ plan: { kind: 'cells', cols: 2, rows: 2, on: [1, 2, 3] } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cell column 1, row 1' }));
    expect(setShape).toHaveBeenCalledWith('n1', { kind: 'cells', cols: 2, rows: 2, on: [0, 1, 2, 3] });
  });

  it('every cell is reachable and toggleable from the keyboard', () => {
    // The whole reason this is tap-to-toggle rather than drag: a room nobody can shape from a
    // keyboard is a regression, not a nicety foregone.
    const { setShape } = setup({ plan: { kind: 'cells', cols: 2, rows: 2, on: [] } });
    const cell = screen.getByRole('checkbox', { name: 'Cell column 2, row 2' });
    expect(cell).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(setShape).toHaveBeenCalledWith('n1', { kind: 'cells', cols: 2, rows: 2, on: [3] });
  });

  it('resizing the grid re-rasterises the outline rather than reindexing the old cells', () => {
    // Reindexing would move walls the operator drew — the same reasoning that keeps device
    // fixtures as points rather than as cell indices.
    const { setShape } = setup({ plan: { kind: 'cells', cols: 2, rows: 2, on: [0, 1, 2, 3] } });
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '4' } });
    const [, shape] = setShape.mock.calls[0];
    expect(shape).toEqual({ kind: 'cells', cols: 4, rows: 2, on: [0, 1, 2, 3, 4, 5, 6, 7] });
  });

  it('disables every control when Supabase is not configured, and says nothing — the page already did', () => {
    setup({}, { canEdit: false });
    expect(screen.getByRole('button', { name: 'Round' })).toBeDisabled();
    // Repeating the page's own explanation on every sub-panel is the noise that trains people to
    // ignore the flag.
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
  });

  it('does not fire a second save while one is in flight', () => {
    const { setShape } = setup({}, { mutating: true });
    fireEvent.click(screen.getByRole('button', { name: 'Round' }));
    expect(setShape).not.toHaveBeenCalled();
  });

  it('renders a rectangle rather than throwing when the stored shape is nonsense', () => {
    // `attrs.plan` is operator-editable jsonb. A render that throws takes the page down, which
    // is far worse than a room that looks rectangular.
    setup({ plan: { kind: 'hexagon', sides: 6 } });
    expect(screen.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true');
  });
});
