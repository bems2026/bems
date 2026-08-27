import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { SpaceNode } from '@/lib/spaceTree';

const nodes: SpaceNode[] = [
  { id: 'b', site_id: 's', parent_id: null, kind: 'building', name: 'NBERIC', sort_order: 0, attrs: {} },
  { id: 'r', site_id: 's', parent_id: 'b', kind: 'room', name: 'CARE Office', sort_order: 0, attrs: {} },
];

const fetchSpaceNodes = vi.fn();
const insertSpaceNode = vi.fn();
const renameSpaceNode = vi.fn();
const deleteSpaceNode = vi.fn();

vi.mock('@/lib/supabaseSpaceTree', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabaseSpaceTree')>('@/lib/supabaseSpaceTree');
  return {
    ...actual,
    fetchSpaceNodes: (...a: unknown[]) => fetchSpaceNodes(...a),
    insertSpaceNode: (...a: unknown[]) => insertSpaceNode(...a),
    renameSpaceNode: (...a: unknown[]) => renameSpaceNode(...a),
    deleteSpaceNode: (...a: unknown[]) => deleteSpaceNode(...a),
  };
});

// The store resolves straight to ready when Supabase is unconfigured, so the mock has to be
// truthy for the network paths to be reachable at all — and it has to carry `auth`, because
// every write asks who is acting so the row can record it. A bare `{}` here would fail inside
// the store for a reason that has nothing to do with the behaviour under test.
vi.mock('@/config/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }) } },
}));

const { useSpaceTreeStore } = await import('./spaceTreeStore');

const reset = () =>
  useSpaceTreeStore.setState({ nodes: [], status: 'idle', mutating: false, error: null });

describe('spaceTreeStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
  });
  afterEach(() => reset());

  it('loads the tree and reports ready', async () => {
    fetchSpaceNodes.mockResolvedValue(nodes);
    await useSpaceTreeStore.getState().load();
    expect(useSpaceTreeStore.getState().nodes).toEqual(nodes);
    expect(useSpaceTreeStore.getState().status).toBe('ready');
  });

  it('a failed load leaves the store ready and empty, not stuck loading', async () => {
    // The tree is metadata. A site whose tree cannot be fetched must still show its devices,
    // so this degrades to "no tree yet" rather than blocking the Devices page behind a spinner.
    fetchSpaceNodes.mockRejectedValue(new Error('offline'));
    await useSpaceTreeStore.getState().load();
    expect(useSpaceTreeStore.getState().status).toBe('ready');
    expect(useSpaceTreeStore.getState().nodes).toEqual([]);
    expect(useSpaceTreeStore.getState().error).toMatch(/offline/);
  });

  it('adds a node and keeps it without a refetch', async () => {
    fetchSpaceNodes.mockResolvedValue(nodes);
    await useSpaceTreeStore.getState().load();
    const added: SpaceNode = { id: 'n', site_id: 's', parent_id: 'r', kind: 'sub_area', name: 'Desk A', sort_order: 0, attrs: {} };
    insertSpaceNode.mockResolvedValue(added);
    await useSpaceTreeStore.getState().add({ parent_id: 'r', kind: 'sub_area', name: 'Desk A' });
    expect(useSpaceTreeStore.getState().nodes).toContainEqual(added);
    expect(fetchSpaceNodes).toHaveBeenCalledTimes(1);
    // The signed-in user reaches the row, so "who added this?" has an answer — the choice
    // device_config made and that schedules/dsm_thresholds declared and then never honoured.
    expect(insertSpaceNode).toHaveBeenCalledWith(expect.anything(), 'user-1');
  });

  it('refuses a duplicate sibling locally without calling the network', async () => {
    fetchSpaceNodes.mockResolvedValue(nodes);
    await useSpaceTreeStore.getState().load();
    await useSpaceTreeStore.getState().add({ parent_id: 'b', kind: 'room', name: 'care office' });
    expect(insertSpaceNode).not.toHaveBeenCalled();
    expect(useSpaceTreeStore.getState().error).toMatch(/already/i);
  });

  it('a failed add surfaces the error and changes nothing', async () => {
    fetchSpaceNodes.mockResolvedValue(nodes);
    await useSpaceTreeStore.getState().load();
    insertSpaceNode.mockRejectedValue(new Error('insert blew up'));
    await useSpaceTreeStore.getState().add({ parent_id: 'b', kind: 'room', name: 'Lab' });
    expect(useSpaceTreeStore.getState().nodes).toEqual(nodes);
    expect(useSpaceTreeStore.getState().error).toMatch(/insert blew up/);
  });

  it('renames in place', async () => {
    fetchSpaceNodes.mockResolvedValue(nodes);
    await useSpaceTreeStore.getState().load();
    renameSpaceNode.mockResolvedValue(undefined);
    await useSpaceTreeStore.getState().rename('r', 'Main Hall');
    expect(useSpaceTreeStore.getState().nodes.find((n) => n.id === 'r')?.name).toBe('Main Hall');
  });

  it('a failed rename leaves the old name, so the UI never shows a write that did not happen', async () => {
    fetchSpaceNodes.mockResolvedValue(nodes);
    await useSpaceTreeStore.getState().load();
    renameSpaceNode.mockRejectedValue(new Error('matched no row'));
    await useSpaceTreeStore.getState().rename('r', 'Main Hall');
    expect(useSpaceTreeStore.getState().nodes.find((n) => n.id === 'r')?.name).toBe('CARE Office');
    expect(useSpaceTreeStore.getState().error).toMatch(/matched no row/);
  });

  it('removing a node removes its whole subtree locally, matching the cascade', async () => {
    // The database cascades. If the store dropped only the clicked row, the children would
    // linger until a refetch and render as orphan roots — a tree that lies about itself.
    fetchSpaceNodes.mockResolvedValue(nodes);
    await useSpaceTreeStore.getState().load();
    deleteSpaceNode.mockResolvedValue(undefined);
    await useSpaceTreeStore.getState().remove('b');
    expect(useSpaceTreeStore.getState().nodes).toEqual([]);
  });

  it('reports that editing is possible when Supabase is configured', () => {
    expect(useSpaceTreeStore.getState().canEdit).toBe(true);
  });

  it('descendantCount reports the blast radius before a delete is confirmed', async () => {
    fetchSpaceNodes.mockResolvedValue(nodes);
    await useSpaceTreeStore.getState().load();
    expect(useSpaceTreeStore.getState().descendantCount('b')).toBe(1);
    expect(useSpaceTreeStore.getState().descendantCount('r')).toBe(0);
  });
});
