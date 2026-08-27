import { describe, it, expect } from 'vitest';
import { rowToSpaceNode, spaceNodeToRow, validateNewNode } from './supabaseSpaceTree';

/**
 * The mappers and the validator only. The network half needs a live project and is covered by
 * the schema guards and the rehearsal instead — the same split `supabaseDeviceConfig.ts` draws.
 */

describe('rowToSpaceNode', () => {
  it('passes a well-formed row through unchanged', () => {
    const row = { id: 'a', site_id: 's', parent_id: null, kind: 'room', name: 'Lab', sort_order: 2, attrs: { area_m2: 30 } };
    expect(rowToSpaceNode(row)).toEqual(row);
  });

  it('coerces an unknown kind to zone rather than throwing or passing it through', () => {
    // The CHECK constraint makes this unreachable from a healthy database, so the ways it can
    // arrive are a hand-edited row or a migration not yet applied. A dropped-to-default value
    // renders; an unknown one leaks into a `<select>` as a blank-but-set option.
    const row = { id: 'a', site_id: 's', parent_id: null, kind: 'basement', name: 'X', sort_order: 0, attrs: {} };
    expect(rowToSpaceNode(row).kind).toBe('zone');
  });

  it('defaults a null sort_order and a null attrs, so arithmetic and spreads stay safe', () => {
    const row = { id: 'a', site_id: 's', parent_id: null, kind: 'room', name: 'X', sort_order: null, attrs: null };
    const node = rowToSpaceNode(row);
    expect(node.sort_order).toBe(0);
    expect(node.attrs).toEqual({});
  });
});

describe('spaceNodeToRow', () => {
  it('carries the actor, so "who renamed the lab?" has an answer', () => {
    const row = spaceNodeToRow(
      { id: 'a', site_id: 's', parent_id: null, kind: 'room', name: 'Lab', sort_order: 0, attrs: {} },
      'user-1',
    );
    expect(row.updated_by).toBe('user-1');
    expect(typeof row.updated_at).toBe('string');
  });

  it('trims the name, so a stray space cannot create a second room that looks identical', () => {
    const row = spaceNodeToRow(
      { id: 'a', site_id: 's', parent_id: null, kind: 'room', name: '  Lab  ', sort_order: 0, attrs: {} },
      null,
    );
    expect(row.name).toBe('Lab');
  });
});

describe('validateNewNode', () => {
  const existing = [
    { id: 'f', site_id: 's', parent_id: null, kind: 'floor' as const, name: 'Ground', sort_order: 0, attrs: {} },
    { id: 'r', site_id: 's', parent_id: 'f', kind: 'room' as const, name: 'Lab', sort_order: 0, attrs: {} },
  ];

  it('accepts a well-formed new node', () => {
    expect(validateNewNode({ parent_id: 'f', kind: 'room', name: 'Office' }, existing)).toEqual({ ok: true });
  });

  it('refuses an empty name before the database has to', () => {
    expect(validateNewNode({ parent_id: 'f', kind: 'room', name: '   ' }, existing).ok).toBe(false);
  });

  it('refuses a name longer than the column allows', () => {
    const r = validateNewNode({ parent_id: null, kind: 'room', name: 'x'.repeat(61) }, existing);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/60/);
  });

  it('refuses a duplicate sibling case-insensitively, matching the unique index', () => {
    // Caught here so the operator gets a sentence rather than a Postgres 23505. The index is
    // still the authority — this is a nicer first line, not a replacement for it.
    const r = validateNewNode({ parent_id: 'f', kind: 'room', name: 'lab' }, existing);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/already/i);
  });

  it('allows the same name under a different parent, which is the normal case', () => {
    expect(validateNewNode({ parent_id: null, kind: 'room', name: 'Lab' }, existing).ok).toBe(true);
  });

  it('refuses a parent that does not exist', () => {
    expect(validateNewNode({ parent_id: 'gone', kind: 'room', name: 'Office' }, existing).ok).toBe(false);
  });
});
