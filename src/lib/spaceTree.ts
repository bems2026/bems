/**
 * The spatial hierarchy — RM-028. Pure, and deliberately so.
 *
 * `supabaseSpaceTree.ts` owns the row shape and the network; this file owns the shape the UI
 * thinks in. The same split `deviceConfig.ts` has from `supabaseDeviceConfig.ts`, and it is what
 * lets every rule below be tested with plain objects and no mocks.
 *
 * WHY A FLAT LIST IS THE INPUT: the tree is fetched as rows and is small (tens of nodes at a
 * site, not thousands). Nesting it here rather than asking the database for nested JSON keeps
 * the query trivial, keeps RLS doing the filtering, and means a caller that only needs a label
 * never pays to build a tree at all.
 *
 * EVERY WALK IS DEPTH-CAPPED. `parent_id` is user-editable and nothing in a self-referencing
 * table prevents A -> B -> A. The database caps its own recursive walk (see
 * `supabase/phase21_space_tree.sql`), but that protects the database, not this bundle — a client
 * building a tree from a flat list would recurse until the stack gave out. Two guards, because
 * they fail in different places and only one of them is reachable from a browser.
 */

/** Mirrors `space_nodes` in `supabase/phase21_space_tree.sql`, minus the audit columns the UI
 * does not read. Ordered coarse-to-fine as a reading aid; NOTHING enforces that a room sits
 * inside a floor, because a lab inside somebody else's building is a real site. */
export type SpaceKind = 'building' | 'floor' | 'wing' | 'zone' | 'room' | 'sub_area';

export interface SpaceNode {
  id: string;
  site_id: string;
  parent_id: string | null;
  kind: SpaceKind;
  name: string;
  sort_order: number;
  attrs: Record<string, unknown>;
}

export interface SpaceTreeNode extends SpaceNode {
  children: SpaceTreeNode[];
}

/** The same cap `space_subtree` uses. Far past any real building, and cheap to raise in both
 * places at once — they are one decision, so a mismatch would mean the UI and the database
 * disagreed about what exists. */
export const MAX_TREE_DEPTH = 32;

/** Separator for a full path. Spaced, because `A/B` reads as one token and `A / B` does not. */
const SEP = ' / ';

/** Siblings order by the operator's `sort_order`, then by name so equal ranks are stable rather
 * than arbitrary — an unstable list reorders itself under the cursor on every refetch. */
function compareSiblings(a: SpaceNode, b: SpaceNode): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

/**
 * Nests a flat list into roots.
 *
 * A node whose parent is missing from the list becomes a root rather than being dropped. That
 * happens on a partial fetch, or a delete racing a read; surfacing it at the top is visibly odd
 * and therefore fixable, whereas discarding it makes a room disappear with no symptom at all.
 */
export function buildTree(nodes: readonly SpaceNode[]): SpaceTreeNode[] {
  const byId = new Map<string, SpaceTreeNode>();
  for (const node of nodes) byId.set(node.id, { ...node, children: [] });

  const roots: SpaceTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id === null ? undefined : byId.get(node.parent_id);
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  // A cycle leaves every node in it parented, so none of them reaches `roots` and the cycle is
  // simply absent from the output — which is correct: it is unreachable from any root, and the
  // alternative is inventing a root that does not exist. The prune below is what stops a cycle
  // that hangs off a real root from recursing forever.
  const prune = (list: SpaceTreeNode[], depth: number, seen: Set<string>) => {
    for (const node of list) {
      if (depth >= MAX_TREE_DEPTH || seen.has(node.id)) {
        node.children = [];
        continue;
      }
      node.children.sort(compareSiblings);
      prune(node.children, depth + 1, new Set(seen).add(node.id));
    }
  };
  roots.sort(compareSiblings);
  prune(roots, 1, new Set());
  return roots;
}

/**
 * The chain from the root down to `id`, inclusive. Empty when the id is unknown, so a caller can
 * treat "not placed" and "placed somewhere I cannot see" identically — from the UI's side they
 * are the same fact.
 */
export function nodePath(nodes: readonly SpaceNode[], id: string | null | undefined): SpaceNode[] {
  if (!id) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: SpaceNode[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(id);
  while (cursor && !seen.has(cursor.id) && chain.length <= MAX_TREE_DEPTH) {
    seen.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return chain.reverse();
}

/** "NBERIC / Ground / CARE Office" — coarse to fine, which is the order someone says it in. */
export function pathLabel(nodes: readonly SpaceNode[], id: string | null | undefined): string {
  return nodePath(nodes, id)
    .map((node) => node.name)
    .join(SEP);
}

export interface PickerOption {
  id: string;
  name: string;
  kind: SpaceKind;
  /** Nesting level, for indenting an option list. */
  depth: number;
  /** Full path — two rooms named "Lab" are only distinguishable by this. */
  path: string;
}

/**
 * The tree as a flat, depth-annotated list in reading order, for a `<select>`.
 *
 * Carries `path` as well as `name` because a picker showing bare names is ambiguous the moment a
 * site has two rooms called the same thing on different floors — which is normal, not a corner
 * case, and is exactly why `space_nodes` only enforces sibling-level uniqueness.
 */
export function flattenForPicker(nodes: readonly SpaceNode[]): PickerOption[] {
  const out: PickerOption[] = [];
  const walk = (list: SpaceTreeNode[], depth: number, prefix: string) => {
    for (const node of list) {
      const path = prefix ? prefix + SEP + node.name : node.name;
      out.push({ id: node.id, name: node.name, kind: node.kind, depth, path });
      walk(node.children, depth + 1, path);
    }
  };
  walk(buildTree(nodes), 0, '');
  return out;
}

/**
 * Every place a device can be put, by full path, sorted.
 *
 * This is what replaces `knownRooms()` in `deviceConfig.ts`. That function derived the room list
 * from whatever strings operators had already typed, so it could only ever offer places that
 * were already in use — a room with nothing in it yet was unofferable, and a typo became a
 * permanent second room. The tree is declared instead of inferred, which is the whole point.
 */
export function knownSpaceLabels(nodes: readonly SpaceNode[]): string[] {
  return flattenForPicker(nodes)
    .map((option) => option.path)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Ids of `root` and everything beneath it.
 *
 * Lived in `spaceTreeStore` until RM-031 needed it too — a store is not where a pure tree walk
 * belongs, and two copies of a depth-guarded traversal is exactly how the two would drift.
 *
 * Depth-guarded for the same reason everything else here is: `parent_id` is user-editable and a
 * cycle would otherwise loop forever. The bound is the node count rather than `MAX_TREE_DEPTH`
 * because this widens a set rather than descending, and it stops as soon as a pass adds nothing.
 */
export function subtreeIds(nodes: readonly SpaceNode[], root: string): Set<string> {
  const ids = new Set<string>([root]);
  for (let pass = 0; pass < nodes.length; pass++) {
    let grew = false;
    for (const node of nodes) {
      if (node.parent_id && ids.has(node.parent_id) && !ids.has(node.id)) {
        ids.add(node.id);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return ids;
}
