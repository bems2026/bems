/**
 * The site's spatial tree — RM-028.
 *
 * Deliberately simpler than `deviceConfigStore`: that one carries a draft/saved split because a
 * device's metadata is a form with several fields edited together and saved once. A tree node is
 * a name and a parent, and every action here is a single committed edit, so a draft layer would
 * be machinery with nothing to hold.
 *
 * WHY MUTATIONS UPDATE IN PLACE RATHER THAN REFETCHING: the write already tells us what changed,
 * and a refetch after every keystroke-sized edit turns a tree editor into a network waterfall on
 * a Pi kiosk. The store mirrors the database's own cascade rules — see `remove`.
 */
import { create } from 'zustand';
import { supabase } from '@/config/supabase';
import {
  fetchSpaceNodes,
  insertSpaceNode,
  renameSpaceNode,
  deleteSpaceNode,
  validateNewNode,
  type NewNode,
} from '@/lib/supabaseSpaceTree';
import { subtreeIds, type SpaceNode } from '@/lib/spaceTree';

interface SpaceTreeState {
  nodes: SpaceNode[];
  /**
   * Whether writes are possible at all — i.e. whether Supabase is configured.
   *
   * Separate from `error` because it is a permanent property of the deployment, not a failure:
   * local dev against `npm run mock` has no Supabase and never will, and a panel that offers
   * Add there is promising something it cannot do. Found in a browser, not by a test — the unit
   * tests mock the client as present, so this path was invisible to them.
   */
  canEdit: boolean;
  status: 'idle' | 'loading' | 'ready';
  /** A write is in flight. Separate from `status` so the tree stays visible while it saves. */
  mutating: boolean;
  error: string | null;

  load: () => Promise<void>;
  add: (node: NewNode) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** How many nodes would go with `id` — the blast radius of a delete, which is invisible from
   * the row being clicked. */
  descendantCount: (id: string) => number;
  clearError: () => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const useSpaceTreeStore = create<SpaceTreeState>((set, get) => ({
  nodes: [],
  canEdit: supabase !== null,
  status: 'idle',
  mutating: false,
  error: null,

  /**
   * A failed load resolves to ready-and-empty rather than retrying or staying in `loading`.
   *
   * The tree is metadata: a site whose tree cannot be fetched must still show its devices,
   * their readings and their controls. Blocking the Devices page behind a spinner because a
   * room list did not load would trade a real capability for a cosmetic one. The error is kept
   * so the panel can say so rather than silently showing an empty tree.
   */
  load: async () => {
    set({ status: 'loading', error: null });
    if (!supabase) {
      // Not transient — local dev against the mock with no Supabase configured. Resolving
      // straight to empty is correct; retrying would never succeed.
      set({ nodes: [], status: 'ready' });
      return;
    }
    try {
      set({ nodes: await fetchSpaceNodes(), status: 'ready' });
    } catch (err) {
      set({ nodes: [], status: 'ready', error: message(err) });
    }
  },

  /** Validated locally first, so the common mistakes cost no round trip and read as sentences
   * rather than Postgres error codes. The constraints remain the authority. */
  add: async (node) => {
    if (!supabase) {
      set({ error: 'Supabase is not configured for this deployment, so spaces cannot be edited here.' });
      return;
    }
    const check = validateNewNode(node, get().nodes);
    if (!check.ok) {
      set({ error: check.error });
      return;
    }
    set({ mutating: true, error: null });
    try {
      const actorUserId = (await supabase.auth.getSession()).data.session?.user.id ?? null;
      const created = await insertSpaceNode(node, actorUserId);
      set((s) => ({ nodes: [...s.nodes, created], mutating: false }));
    } catch (err) {
      set({ mutating: false, error: message(err) });
    }
  },

  /** The local name changes only after the write returns. Optimism here would show a rename
   * that did not happen — and `renameSpaceNode` exists partly because PostgREST reports an RLS
   * miss as a plain 200, so "no error" is not the same as "it was written". */
  rename: async (id, name) => {
    if (!supabase) {
      set({ error: 'Supabase is not configured for this deployment, so spaces cannot be edited here.' });
      return;
    }
    set({ mutating: true, error: null });
    try {
      const actorUserId = (await supabase.auth.getSession()).data.session?.user.id ?? null;
      await renameSpaceNode(id, name, actorUserId);
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, name: name.trim() } : n)),
        mutating: false,
      }));
    } catch (err) {
      set({ mutating: false, error: message(err) });
    }
  },

  /**
   * Drops the whole subtree locally, mirroring `on delete cascade`.
   *
   * Removing only the clicked row would leave its children in the store until the next refetch,
   * where `buildTree` would surface them as roots — a tree confidently displaying nodes that no
   * longer exist. Matching the database's rule is what keeps the two honest between fetches.
   */
  remove: async (id) => {
    if (!supabase) {
      set({ error: 'Supabase is not configured for this deployment, so spaces cannot be edited here.' });
      return;
    }
    set({ mutating: true, error: null });
    try {
      await deleteSpaceNode(id);
      const doomed = subtreeIds(get().nodes, id);
      set((s) => ({ nodes: s.nodes.filter((n) => !doomed.has(n.id)), mutating: false }));
    } catch (err) {
      set({ mutating: false, error: message(err) });
    }
  },

  descendantCount: (id) => subtreeIds(get().nodes, id).size - 1,

  clearError: () => set({ error: null }),
}));
