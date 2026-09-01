/**
 * `space_nodes` reads and writes — RM-028. Reads and writes Supabase directly from the browser
 * (RLS-gated to `authenticated`, same pattern as `supabaseDeviceConfig.ts` and
 * `supabaseConfig.ts` — no general CRUD backend needed for this).
 *
 * Row <-> model translation and validation live here, pure and exported, so they can be unit
 * tested without a live project. The same split `supabaseDeviceConfig.ts` draws between its
 * mappers and its network calls.
 */

import { supabase } from '@/config/supabase';
import { SITE } from '@shared/siteConfig.mjs';
import type { SpaceKind, SpaceNode } from './spaceTree';

/** Exactly the values `space_nodes.kind`'s CHECK constraint accepts. The list and the constraint
 * are one fact in two places, and this comment is the reminder to change both. */
export const SPACE_KINDS: ReadonlyArray<{ value: SpaceKind; label: string }> = [
  { value: 'building', label: 'Building' },
  { value: 'floor', label: 'Floor' },
  { value: 'wing', label: 'Wing' },
  { value: 'zone', label: 'Zone' },
  { value: 'room', label: 'Room' },
  { value: 'sub_area', label: 'Sub-area' },
];

/** Matches `check (char_length(name) between 1 and 60)`. */
export const MAX_NAME_LENGTH = 60;

interface SpaceNodeRow {
  id: string;
  site_id: string;
  parent_id: string | null;
  kind: string;
  name: string;
  sort_order: number | null;
  attrs: Record<string, unknown> | null;
}

/**
 * An unknown `kind` becomes `zone` rather than throwing or passing through. The CHECK makes it
 * unreachable from a healthy database, so the ways it can arrive are a hand-edited row or a
 * migration not yet applied — and a value that renders beats one that leaks into a `<select>`
 * as a blank-but-set option. Same reasoning as `coerceCategory` in `deviceConfig.ts`.
 */
export function rowToSpaceNode(row: SpaceNodeRow): SpaceNode {
  const kind = SPACE_KINDS.some((k) => k.value === row.kind) ? (row.kind as SpaceKind) : 'zone';
  return {
    id: row.id,
    site_id: row.site_id,
    parent_id: row.parent_id,
    kind,
    name: row.name,
    sort_order: row.sort_order ?? 0,
    attrs: row.attrs ?? {},
  };
}

/** `updated_by` is written, unlike `schedules` and `dsm_thresholds` which declare it and never
 * do — so "who renamed the lab?" has an answer. Same choice `device_config` made. */
export function spaceNodeToRow(node: SpaceNode, actorUserId: string | null) {
  return {
    id: node.id,
    site_id: node.site_id,
    parent_id: node.parent_id,
    kind: node.kind,
    // Trimmed at save, not per keystroke: trimming on every change makes a space un-typable
    // mid-word. Matters here because a trailing space would slip past the unique index and
    // create a second room visually identical to the first.
    name: node.name.trim(),
    sort_order: node.sort_order,
    attrs: node.attrs,
    updated_by: actorUserId,
    updated_at: new Date().toISOString(),
  };
}

export type NewNode = { parent_id: string | null; kind: SpaceKind; name: string };
export type Validation = { ok: true } | { ok: false; error: string };

/**
 * Checks what the database would check, first, so the operator gets a sentence instead of a
 * Postgres error code.
 *
 * The constraints remain the authority — this is a nicer first line, not a replacement. A race
 * between two tabs can still land a 23505, and that is fine: the index is what makes it
 * impossible, this is what makes it rare and legible.
 */
export function validateNewNode(node: NewNode, existing: readonly SpaceNode[]): Validation {
  const name = node.name.trim();
  if (name.length === 0) return { ok: false, error: 'A name is required.' };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `A name can be at most ${MAX_NAME_LENGTH} characters.` };
  }
  if (node.parent_id !== null && !existing.some((n) => n.id === node.parent_id)) {
    return { ok: false, error: 'That parent no longer exists — reload and try again.' };
  }
  // Case-insensitive, matching `space_nodes_sibling_name`. Two rooms called "Lab" under one
  // floor are indistinguishable to whoever has to pick one from a list.
  const clash = existing.some(
    (n) => n.parent_id === node.parent_id && n.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (clash) return { ok: false, error: `Something here is already called "${name}".` };
  return { ok: true };
}

/** Throws rather than returning null, so a caller cannot silently treat "no Supabase" as "no
 * tree" — the same choice `supabaseDeviceConfig.ts` makes. */
function requireSupabase() {
  if (supabase === null) throw new Error('Supabase is not configured — the space tree needs it.');
  return supabase;
}

/**
 * Every node for this site. Not `space_subtree`: that RPC exists for asking about one branch,
 * and the whole site is tens of rows, so fetching it flat and nesting in the browser
 * (`buildTree`) is both simpler and fewer round trips.
 */
export async function fetchSpaceNodes(): Promise<SpaceNode[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('space_nodes')
    .select('id,site_id,parent_id,kind,name,sort_order,attrs')
    .eq('site_id', SITE.id);
  if (error) throw new Error(`Supabase space_nodes fetch failed: ${error.message}`);
  return (data ?? []).map(rowToSpaceNode);
}

export async function insertSpaceNode(node: NewNode, actorUserId: string | null): Promise<SpaceNode> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('space_nodes')
    .insert({
      site_id: SITE.id,
      parent_id: node.parent_id,
      kind: node.kind,
      name: node.name.trim(),
      updated_by: actorUserId,
    })
    .select('id,site_id,parent_id,kind,name,sort_order,attrs')
    .single();
  if (error) throw new Error(`Supabase space_nodes insert failed: ${error.message}`);
  return rowToSpaceNode(data);
}

export async function renameSpaceNode(id: string, name: string, actorUserId: string | null): Promise<void> {
  const client = requireSupabase();
  // `.select()` and a row count are load-bearing, not decoration: PostgREST reports an RLS
  // policy matching zero rows as a plain 200 with an EMPTY array, so `{error}` stays null even
  // when nothing was written. This codebase has a scar from exactly that.
  const { data, error } = await client
    .from('space_nodes')
    .update({ name: name.trim(), updated_by: actorUserId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`Supabase space_nodes rename failed: ${error.message}`);
  if ((data?.length ?? 0) !== 1) {
    throw new Error('That rename matched no row — check you are signed in with a real Supabase session, not a break-glass one.');
  }
}

/**
 * Replaces one node's `attrs` — RM-036's room shape lives at `attrs.plan`.
 *
 * The WHOLE object, not a JSON patch. `attrs` is small and the caller has just read it, so a
 * merge here would be a second place for the merge rule to live; `RoomShapeEditor` composes the
 * new object from the node it is editing. Postgres has no partial-jsonb UPDATE that is any safer
 * against a concurrent writer than this is, and there is one operator.
 *
 * Same affected-row check as `renameSpaceNode`, for the same reason: PostgREST reports an
 * RLS-blocked UPDATE as a 200 with an empty array, so `{error}` alone would call a refused write
 * a success.
 */
export async function updateSpaceNodeAttrs(id: string, attrs: Record<string, unknown>, actorUserId: string | null): Promise<void> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('space_nodes')
    .update({ attrs, updated_by: actorUserId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`Supabase space_nodes attrs update failed: ${error.message}`);
  if ((data?.length ?? 0) !== 1) {
    throw new Error('That change matched no row — check you are signed in with a real Supabase session, not a break-glass one.');
  }
}

/**
 * Deleting a node takes its subtree with it — `on delete cascade` on `parent_id`. Callers must
 * say so before asking: this is the one destructive action in the tree editor, and the blast
 * radius is invisible from the row being clicked.
 *
 * Devices placed in the deleted nodes keep their metadata; `device_config.space_node_id` is
 * `on delete set null` precisely so a restructure cannot discard a load-shed tier.
 */
export async function deleteSpaceNode(id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('space_nodes').delete().eq('id', id);
  if (error) throw new Error(`Supabase space_nodes delete failed: ${error.message}`);
}
