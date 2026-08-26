/**
 * The audit trail, made durable locally so that losing the internet does not mean losing
 * control of the building.
 *
 * WHAT THIS DOES NOT CHANGE: `auditedDispatch` still refuses to touch hardware unless the
 * command was recorded first. That contract is the reason "hardware moved with no audit row"
 * is unrepresentable, and it stays exactly as it is. What changes is the meaning of *recorded*
 * — it was "written to Supabase", and it becomes "durably written somewhere we control".
 *
 * WHY IT WAS WORTH CHANGING: the Tuya fleet is local. The devices sit on the Pi's own L2
 * segment and answer local keys; commanding them needs no internet at all. But the audit
 * insert did, so a WAN outage removed every command in the building while the device layer sat
 * there working perfectly. The safety property was never the problem — its implementation just
 * happened to live on the far side of a link that goes down.
 *
 * THE DISTINCTION THE WHOLE FILE TURNS ON: a 4xx from Supabase is an ANSWER — this caller may
 * not write that row — and must still refuse, or an authorization failure would be laundered
 * into a local queue entry and a relay would move on the strength of it. Only a *connectivity*
 * failure may be buffered. This is the same distinction `verifySupabaseSession` already draws
 * between "unreachable" and "invalid token", for the same reason.
 *
 * ROTATE, DO NOT TRUNCATE. Two processes touch this file: the proxy appends, and the drainer
 * uploads. Read-then-truncate would silently drop anything appended in between — a lost audit
 * row for a relay that really did move, which is precisely the outcome the trail exists to
 * make impossible. `rename` is atomic on one filesystem, so a concurrent append lands in a
 * fresh file and is drained next time round.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendToBuffer, readBuffer, writeBuffer } from './ingestBuffer.mjs';

/** Marks an id as living in the local buffer rather than in Supabase. */
export const BUFFERED_ID_PREFIX = 'buffered:';

/** The rotated-aside file a drain is working through. */
const draining = (bufferPath) => `${bufferPath}.draining`;

/**
 * Wraps a remote insert/update pair with a durable local fallback.
 *
 * @param insert  (row) => {ok, id?, detail?, unreachable?}   `unreachable` distinguishes an
 *                outage from a refusal; without it every failure would have to be treated as
 *                a refusal, which is the safe default but gives up the whole feature.
 * @param update  (id, patch) => {ok, detail?}
 */
export function createBufferedAudit({ insert, update, bufferPath, now = () => new Date().toISOString() }) {
  return {
    async insertAudit(row) {
      const res = await insert(row);
      if (res.ok) return res;
      // A refusal, not an outage. Pass it through so auditedDispatch declines to dispatch.
      if (!res.unreachable) return res;

      // Identity for the entry, so its outcome can be written back to the right row when two
      // people are pressing buttons during the same outage. Reuses the caller's correlation id
      // when there is one rather than inventing a second identifier for the same command.
      const commandId = row.command_id || `local-${crypto.randomUUID()}`;
      const buffered = { ...row, command_id: commandId };
      appendToBuffer(bufferPath, { table: 'commands', rows: [buffered], onConflict: null, buffered_at: now() });
      return { ok: true, id: `${BUFFERED_ID_PREFIX}${commandId}`, buffered: true, detail: res.detail };
    },

    async updateAudit(id, patch) {
      if (!String(id).startsWith(BUFFERED_ID_PREFIX)) return update(id, patch);

      // Never a network call: the outcome patch would otherwise fail during the very outage
      // that produced the entry, leaving every buffered row stuck at `dispatching`.
      const commandId = String(id).slice(BUFFERED_ID_PREFIX.length);
      const entries = readBuffer(bufferPath);
      const hit = entries.find((e) => e.rows?.[0]?.command_id === commandId);
      if (!hit) {
        // The drainer rotated the file between insert and update. The row is already on its
        // way up carrying `dispatching`, which the existing design documents as an honest
        // outcome — "we tried and do not know how it went" — so this is reported, not fatal.
        return { ok: false, detail: 'buffered audit row was already taken for upload; outcome not recorded' };
      }
      hit.rows[0] = { ...hit.rows[0], ...patch };
      writeBuffer(bufferPath, entries);
      return { ok: true };
    },
  };
}

/**
 * Atomically claims everything currently buffered. Returns `{entries, from}`; `from` is the
 * rotated path the caller must acknowledge through `restoreUndrained`.
 *
 * A rotated-but-unacknowledged file from a previous crash is picked up first, so rows that
 * were claimed and never uploaded are not stranded.
 */
export function takeBufferedCommands(bufferPath) {
  const from = draining(bufferPath);
  // Left over from a drain that died mid-flight. Those rows exist nowhere else.
  if (!fs.existsSync(from) && fs.existsSync(bufferPath)) {
    try {
      fs.renameSync(bufferPath, from);
    } catch {
      return { entries: [], from };
    }
  }
  return { entries: readBuffer(from), from };
}

/**
 * Acknowledges a drain. Anything still unsent is put back at the FRONT of the live buffer so
 * order is preserved, matching how `ingest.mjs` re-persists the remainder at the first failure
 * rather than reordering around a stuck entry.
 */
export function restoreUndrained(bufferPath, taken, remaining = []) {
  const from = taken?.from ?? draining(bufferPath);
  if (remaining.length) {
    const live = readBuffer(bufferPath);
    fs.mkdirSync(path.dirname(bufferPath), { recursive: true });
    writeBuffer(bufferPath, [...remaining, ...live]);
  }
  try {
    if (fs.existsSync(from)) fs.rmSync(from);
  } catch {
    // Leaving it costs a duplicate upload attempt next round, which the drain tolerates;
    // throwing here would lose the successful uploads that just happened.
  }
}
