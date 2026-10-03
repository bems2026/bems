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
 * Whether an HTTP status from Supabase is an ANSWER about this caller or this row — the only kind
 * of failure that must refuse. 402 is how a project over its plan's quota is restricted, 408/425/429
 * are the service declining to answer yet, and 5xx is the service failing: none of them says the
 * command may not be recorded, so each is treated like a connection that never got through.
 *
 * The line matters more since RM-157. Log ingestion went over the Free plan's 1 GB on 2026-10-03,
 * and a restricted project answers every request 402: read as a refusal, that would have stopped
 * every scheduled command in the building while the devices sat on the LAN, working.
 */
export function isRefusal(status) {
  if (status === 402 || status === 408 || status === 425 || status === 429) return false;
  return status >= 400 && status < 500;
}

/** Marks an id as a record still on the edge, not yet in Supabase. */
export const INFLIGHT_ID_PREFIX = 'inflight:';

/** Appends one line and flushes it to the card: this record has to survive a power cut. */
function appendDurably(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, JSON.stringify(entry) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Rewrites the file whole, flushed. Removes it when nothing is left. */
function rewriteDurably(file, entries) {
  if (entries.length === 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

const commandIdOf = (id) => String(id).slice(INFLIGHT_ID_PREFIX.length);

/**
 * A person's command, recorded on the edge first and in Supabase after — RM-157.
 *
 * WHY. Record-then-act asked Supabase twice for every click: the row before the relay moved, and
 * the outcome after. Measured from the edge on 2026-10-03, one request takes about 0.43 s (0.86 s on
 * a cold connection, and a 5 s timeout on a bad evening — 2026-10-02, 1.5 to 3.2 s), so a switch sat
 * in its amber "Switching" pulse for one to two seconds before the relay was even asked. And a
 * project restricted for going over a quota answers 402, which `createBufferedAudit` read as a
 * refusal: every command in the building refused while the devices worked.
 *
 * WHAT DOES NOT CHANGE. Nothing reaches hardware unrecorded: `insertAudit` returns only once the
 * record is flushed to the edge's own card, and a record that cannot be written refuses the command.
 * "Recorded" already meant "durably written somewhere we control" (see the top of this file); this
 * makes the edge the first place rather than the fallback.
 *
 * WHO MAY COMMAND is not weakened. The row was written with the caller's own token, and the rule it
 * met was `auth.role() = 'authenticated'`. The proxy has already asked Supabase's auth service about
 * that token before it gets here — a stricter question, since it also sees a sign-out.
 *
 * AFTER THE ANSWER, `settle` uploads one row carrying the outcome. On any failure it hands the
 * record to the outage queue (`bufferPath`), which `ingest.mjs` drains every minute with the
 * service key. A relay that moved is never forgotten because the database said no afterwards.
 *
 * The in-flight file belongs to this one process, and every read-modify-write of it is synchronous,
 * so two commands in flight cannot overwrite each other's record.
 */
export function createLocalFirstAudit({ inflightPath, bufferPath, upload, now = () => new Date().toISOString() }) {
  const entriesOf = () => readBuffer(inflightPath);
  const find = (entries, commandId) => entries.find((e) => e.rows?.[0]?.command_id === commandId);

  return {
    async insertAudit(row) {
      const commandId = row.command_id || `local-${crypto.randomUUID()}`;
      try {
        appendDurably(inflightPath, { table: 'commands', rows: [{ ...row, command_id: commandId }], onConflict: null, recorded_at: now() });
      } catch (err) {
        return { ok: false, detail: `could not record the command on the edge: ${err.message}` };
      }
      return { ok: true, id: `${INFLIGHT_ID_PREFIX}${commandId}` };
    },

    async updateAudit(id, patch) {
      const entries = entriesOf();
      const hit = find(entries, commandIdOf(id));
      if (!hit) return { ok: false, detail: 'no record on the edge for this command' };
      hit.rows[0] = { ...hit.rows[0], ...patch };
      rewriteDurably(inflightPath, entries);
      return { ok: true };
    },

    /** Uploads the finished record, or hands it to the outage queue. Never throws. */
    async settle(id) {
      const commandId = commandIdOf(id);
      const record = find(entriesOf(), commandId);
      if (!record) return { uploaded: false, detail: 'no record on the edge for this command' };
      let res;
      try {
        res = await upload(record.rows[0]);
      } catch (err) {
        res = { ok: false, detail: String(err?.message ?? err) };
      }
      // Re-read after the await: other commands may have written their records meanwhile.
      const remaining = entriesOf().filter((e) => e.rows?.[0]?.command_id !== commandId);
      if (!res?.ok) {
        appendToBuffer(bufferPath, { table: 'commands', rows: record.rows, onConflict: null, buffered_at: now() });
      }
      rewriteDurably(inflightPath, remaining);
      return res?.ok ? { uploaded: true } : { uploaded: false, detail: res?.detail ?? 'upload failed' };
    },
  };
}

/**
 * Hands every record a previous run left on the edge to the outage queue, as it stood: a record
 * still `dispatching` is a command whose outcome nobody saw, and is uploaded as exactly that.
 * Returns how many were handed over. Called once, when the proxy starts.
 */
export function recoverInflight(inflightPath, bufferPath, now = () => new Date().toISOString()) {
  if (!fs.existsSync(inflightPath)) return 0;
  const entries = readBuffer(inflightPath);
  for (const entry of entries) appendToBuffer(bufferPath, { ...entry, buffered_at: now() });
  fs.rmSync(inflightPath, { force: true });
  return entries.length;
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
