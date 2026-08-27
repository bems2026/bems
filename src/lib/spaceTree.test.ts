import { describe, it, expect } from 'vitest';
import { buildTree, nodePath, pathLabel, flattenForPicker, knownSpaceLabels, MAX_TREE_DEPTH } from './spaceTree';
import type { SpaceNode } from './spaceTree';

/** Terse fixture builder — the tests are about structure, so the noise should not be. */
const n = (id: string, parent_id: string | null, kind: SpaceNode['kind'], name: string, sort_order = 0): SpaceNode => ({
  id,
  site_id: 's',
  parent_id,
  kind,
  name,
  sort_order,
  attrs: {},
});

const SITE: SpaceNode[] = [
  n('b', null, 'building', 'NBERIC'),
  n('f1', 'b', 'floor', 'Ground', 1),
  n('f2', 'b', 'floor', 'Second', 2),
  n('r1', 'f1', 'room', 'CARE Office'),
  n('r2', 'f1', 'room', 'Lab'),
];

describe('buildTree', () => {
  it('nests children under their parents', () => {
    const roots = buildTree(SITE);
    expect(roots.map((r) => r.id)).toEqual(['b']);
    expect(roots[0].children.map((c) => c.id)).toEqual(['f1', 'f2']);
    expect(roots[0].children[0].children.map((c) => c.id)).toEqual(['r1', 'r2']);
  });

  it('supports several roots, because a site need not have exactly one building', () => {
    const roots = buildTree([n('a', null, 'room', 'Lab A'), n('b2', null, 'room', 'Lab B')]);
    expect(roots.map((r) => r.id)).toEqual(['a', 'b2']);
  });

  it('sorts siblings by sort_order, then by name for a stable order', () => {
    const roots = buildTree([
      n('p', null, 'floor', 'F'),
      n('z', 'p', 'room', 'Zebra', 1),
      n('a', 'p', 'room', 'Alpha', 1),
      n('first', 'p', 'room', 'Whatever', 0),
    ]);
    expect(roots[0].children.map((c) => c.name)).toEqual(['Whatever', 'Alpha', 'Zebra']);
  });

  it('treats a node whose parent is missing as a root rather than dropping it', () => {
    // A partial fetch, or a delete racing a read, must not make a room vanish from the UI.
    // Showing it at the top is visibly odd; silently discarding it is not visible at all.
    const roots = buildTree([n('orphan', 'gone', 'room', 'Stranded')]);
    expect(roots.map((r) => r.id)).toEqual(['orphan']);
  });

  it('does not hang on a cycle', () => {
    // The database caps its own walk, but the client builds a tree from a flat list and would
    // happily recurse forever. Two guards, because they fail in different places.
    const roots = buildTree([n('a', 'b', 'zone', 'A'), n('b', 'a', 'zone', 'B')]);
    expect(Array.isArray(roots)).toBe(true);
  });

  it('never nests deeper than the cap the database enforces', () => {
    const deep: SpaceNode[] = [n('n0', null, 'zone', 'n0')];
    for (let i = 1; i < MAX_TREE_DEPTH + 10; i++) deep.push(n(`n${i}`, `n${i - 1}`, 'zone', `n${i}`));
    let depth = 0;
    let cur = buildTree(deep)[0];
    while (cur?.children.length) {
      depth++;
      cur = cur.children[0];
    }
    expect(depth).toBeLessThanOrEqual(MAX_TREE_DEPTH);
  });
});

describe('nodePath', () => {
  it('returns the chain from the root down to the node itself', () => {
    expect(nodePath(SITE, 'r1').map((x) => x.name)).toEqual(['NBERIC', 'Ground', 'CARE Office']);
  });

  it('returns just the node for a root', () => {
    expect(nodePath(SITE, 'b').map((x) => x.name)).toEqual(['NBERIC']);
  });

  it('returns empty for an id that is not in the list', () => {
    expect(nodePath(SITE, 'nope')).toEqual([]);
  });

  it('terminates on a cycle instead of looping', () => {
    const cyclic = [n('a', 'b', 'zone', 'A'), n('b', 'a', 'zone', 'B')];
    expect(nodePath(cyclic, 'a').length).toBeLessThanOrEqual(MAX_TREE_DEPTH + 1);
  });
});

describe('pathLabel', () => {
  it('reads coarse to fine, which is how someone says where a thing is', () => {
    expect(pathLabel(SITE, 'r1')).toBe('NBERIC / Ground / CARE Office');
  });

  it('is empty for an unplaced device, so a caller can fall back to the room text', () => {
    expect(pathLabel(SITE, null)).toBe('');
    expect(pathLabel(SITE, 'nope')).toBe('');
  });
});

describe('flattenForPicker', () => {
  it('returns a depth-annotated flat list in the order the tree reads', () => {
    expect(flattenForPicker(SITE).map((o) => `${o.depth}:${o.name}`)).toEqual([
      '0:NBERIC',
      '1:Ground',
      '2:CARE Office',
      '2:Lab',
      '1:Second',
    ]);
  });

  it('carries the full path, so two rooms with the same name stay distinguishable', () => {
    const dup = [...SITE, n('r3', 'f2', 'room', 'Lab')];
    const labs = flattenForPicker(dup).filter((o) => o.name === 'Lab');
    expect(labs).toHaveLength(2);
    expect(new Set(labs.map((l) => l.path)).size).toBe(2);
  });
});

describe('knownSpaceLabels', () => {
  it('replaces knownRooms: every placeable node, by full path, sorted', () => {
    expect(knownSpaceLabels(SITE)).toEqual([
      'NBERIC',
      'NBERIC / Ground',
      'NBERIC / Ground / CARE Office',
      'NBERIC / Ground / Lab',
      'NBERIC / Second',
    ]);
  });

  it('is empty for a site whose tree has not been built yet', () => {
    expect(knownSpaceLabels([])).toEqual([]);
  });
});
