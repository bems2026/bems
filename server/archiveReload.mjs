/**
 * Refilling the cloud's hot window from the archive — the last step of RM-148's one-time reset.
 *
 * WHY A RESET AT ALL. Pruning deletes rows but never shrinks a table's files; `VACUUM FULL` would,
 * but it builds a whole new copy beside the old one, and at 392 of 500 MB that peak could put the
 * Free plan's database into read-only mode in the middle of the operation. So the space is given
 * back the other way: with ingest paused (it keeps archiving), the operator empties the two raw
 * tables with `TRUNCATE` (instant, and it keeps the tables, their policies, grants and functions),
 * and this puts the hot window back from the archive, slimmed as live rows now are.
 *
 * Every origin goes back up, including rows first copied DOWN from the cloud by the backfill: the
 * TRUNCATE removed those from the cloud too. Upserts on the tables' own keys, so running it twice is
 * harmless, and a failure stops it where it is, to be run again.
 */

import { STREAMS } from './archiveDb.mjs';
import { readingsForCloud } from './cloudCapabilities.mjs';

/**
 * @param {{ archive: object, send: (stream: string, rows: object[], onConflict: string) => Promise<void>,
 *           stream: 'readings'|'building_totals', sinceMs: number, untilMs: number, batchSize?: number }} args
 * @returns {Promise<{ sent: number, batches: number }>}
 */
export async function reloadWindow({ archive, send, stream, sinceMs, untilMs, batchSize = 2000 }) {
  const { onConflict } = STREAMS[stream];
  const shape = stream === 'readings' ? readingsForCloud : (rows) => rows;
  let batch = [];
  let sent = 0;
  let batches = 0;
  const flush = async () => {
    if (!batch.length) return;
    await send(stream, shape(batch), onConflict);
    sent += batch.length;
    batches += 1;
    batch = [];
  };
  for (const row of archive.rowsBetween(stream, { sinceMs, untilMs })) {
    const { origin: _origin, ...cloudRow } = row;
    batch.push(cloudRow);
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  return { sent, batches };
}
