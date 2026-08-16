/**
 * Local outage buffer for the ingestion daemon — an append-only NDJSON file, one JSON
 * object per line: `{ table, rows, onConflict, buffered_at }`.
 *
 * Deliberately the simplest possible durable queue, not a database: expected volumes are
 * small (60s cadence, a handful of tables) and outages are hours at most, not days. Reach
 * for `node:sqlite`/`better-sqlite3` only if this actually stops being enough — see the
 * architecture plan's Phase 3 notes.
 *
 * Pure filesystem I/O, no network — kept in its own module so `ingest.mjs`'s buffering
 * logic is testable without a live bridge or Supabase project.
 */

import fs from 'node:fs';
import path from 'node:path';

export function appendToBuffer(bufferPath, entry) {
  fs.mkdirSync(path.dirname(bufferPath), { recursive: true });
  fs.appendFileSync(bufferPath, JSON.stringify(entry) + '\n');
}

export function readBuffer(bufferPath) {
  if (!fs.existsSync(bufferPath)) return [];
  const text = fs.readFileSync(bufferPath, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/** Overwrites the buffer with exactly `entries` — deletes the file if `entries` is empty. */
export function writeBuffer(bufferPath, entries) {
  if (entries.length === 0) {
    if (fs.existsSync(bufferPath)) fs.rmSync(bufferPath);
    return;
  }
  fs.mkdirSync(path.dirname(bufferPath), { recursive: true });
  fs.writeFileSync(bufferPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

export function bufferCount(bufferPath) {
  return readBuffer(bufferPath).length;
}
