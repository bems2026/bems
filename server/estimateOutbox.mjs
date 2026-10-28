/**
 * Held-meter estimates on their way to the cloud — RM-165.
 *
 * An estimate is made the moment a meter resumes, which is the moment the internet has just returned: the link
 * is at its slowest, and phase57 may not be applied yet. So the rows wait in a file (`pending`) until an upsert
 * takes them, and every row ever made is also appended to a record (`record`) that nothing truncates: the edge's
 * own copy, from which the cloud table can always be rebuilt. One writer: ingest (or the backfill, with ingest's
 * agreement that it only appends).
 */
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const parseLines = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch { return []; }
    })
    : [];

export function createEstimateOutbox({ pending, record }) {
  return {
    /** Queue rows for upload and keep them on record. */
    add(rows) {
      if (rows.length === 0) return;
      const lines = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
      appendFileSync(record, lines);
      appendFileSync(pending, lines);
    },
    count() {
      return parseLines(pending).length;
    },
    /**
     * Upsert what is pending; the file is emptied only once the upsert is taken. `upsert` throws on failure.
     * @returns {Promise<{ sent: number, error: string|null }>}
     */
    async flush(upsert) {
      const rows = parseLines(pending);
      if (rows.length === 0) return { sent: 0, error: null };
      try {
        await upsert(rows);
      } catch (err) {
        return { sent: 0, error: String(err?.message ?? err) };
      }
      const tmp = `${pending}.tmp`;
      writeFileSync(tmp, '');
      renameSync(tmp, pending);
      return { sent: rows.length, error: null };
    },
  };
}
