/**
 * Each UTC day of the archive, sealed into a file and copied off the edge — RM-148, Stage 4.
 *
 * WHY. The archive is the only copy of raw minute data older than the cloud's 14 days, and it
 * lives on a 2018 consumer SD card. ADR-001 turned down a second store on the edge for exactly that
 * reason. The answer is not to trust the card: every complete day is written as one gzip CSV per
 * stream and uploaded to the project's private file storage, and the janitor prunes a cloud day only
 * after its sealed copy is there (`sealGate`). Losing the card then costs at most the days not yet
 * sealed, and those are still in the cloud.
 *
 * THE FILE. CSV, because anyone can open it and any database can load it. The header names the
 * cloud's columns plus `origin`. Text and JSON are always quoted and anything else never is, so an
 * unquoted empty field is NULL and `""` is an empty string. A restore gets back exactly what went in,
 * and `rowsFromCsv` is that restore. Rows are in a fixed order, so the same rows give the same file
 * and the same sha256.
 *
 * WHEN. A day is sealed an hour after it ends (UTC), so a late row is not left out. A day whose row
 * count changes afterwards, from a backfill or an import, is sealed and copied again.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { STREAMS } from './archiveDb.mjs';

const DAY_MS = 86_400_000;
export const SEAL_GRACE_MS = 60 * 60 * 1000;
/** Days sealed in one pass — the first pass meets weeks of backfilled history, and a pass runs inside ingest. */
export const SEAL_DAYS_PER_PASS = 7;

export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const dayStartMs = (day) => Date.parse(`${day}T00:00:00Z`);
const dayFloor = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

/** Where a sealed day lives in the bucket. The site comes first, so one bucket can hold several. */
export function storagePathFor({ siteId, day, stream }) {
  return `${siteId}/raw/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.${stream}.csv.gz`;
}

const localPathFor = (dir, day, stream) => path.join(dir, day.slice(0, 4), day.slice(5, 7), `${day}.${stream}.csv.gz`);

const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;

function encodeValue(kind, value) {
  if (value === null || value === undefined) return '';
  switch (kind) {
    case 'json': return quote(JSON.stringify(value));
    case 'text': return quote(value);
    case 'bool': return value ? 'true' : 'false';
    default: return String(value);
  }
}

/** Rows (as `rowsBetween` yields them, `origin` included) -> CSV text with a header line. */
export function encodeCsv(stream, rows) {
  const entries = Object.entries(STREAMS[stream].columns);
  const lines = [[...entries.map(([c]) => c), 'origin'].join(',')];
  for (const row of rows) {
    lines.push([...entries.map(([col, kind]) => encodeValue(kind, row[col])), String(row.origin)].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** RFC 4180 records, each field `{ value, quoted }`. Newlines inside quotes are data. */
function parseRecords(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
      quoted = true;
    } else if (ch === ',') {
      record.push({ value: field, quoted });
      field = '';
      quoted = false;
    } else if (ch === '\n') {
      record.push({ value: field, quoted });
      records.push(record);
      record = [];
      field = '';
      quoted = false;
    } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || quoted || record.length) {
    record.push({ value: field, quoted });
    records.push(record);
  }
  return records;
}

function decodeValue(kind, { value, quoted }) {
  if (!quoted && value === '') return kind === 'bool' ? false : null;
  switch (kind) {
    case 'json': return JSON.parse(value);
    case 'text': case 'ts': return value;
    case 'bool': return value === 'true';
    default: return Number(value);
  }
}

/** The restore: a sealed day's CSV back into rows, typed as the archive stores them, `origin` included. */
export function rowsFromCsv(stream, text) {
  const [header, ...records] = parseRecords(text);
  const columns = STREAMS[stream].columns;
  const names = header.map((f) => f.value);
  for (const name of Object.keys(columns)) {
    if (!names.includes(name)) throw new Error(`sealed ${stream} file has no ${name} column`);
  }
  return records.map((fields) => {
    const row = {};
    names.forEach((name, i) => {
      if (name === 'origin') row.origin = Number(fields[i].value);
      else if (name in columns) row[name] = decodeValue(columns[name], fields[i]);
    });
    return row;
  });
}

/** One stream's UTC day, as CSV, gzip and a content hash. */
export function sealDay({ archive, stream, day }) {
  const start = dayStartMs(day);
  const rows = [...archive.rowsBetween(stream, { sinceMs: start, untilMs: start + DAY_MS })];
  const csv = encodeCsv(stream, rows);
  return {
    csv,
    gz: zlib.gzipSync(Buffer.from(csv, 'utf8'), { level: 9 }),
    rows: rows.length,
    sha256: crypto.createHash('sha256').update(csv).digest('hex'),
  };
}

function writeAtomically(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
}

/**
 * Seals whatever complete days need it, then copies unsent seals off the edge. Never throws for a
 * failed upload: that is reported in `errors`, the seal stays, and the next pass tries again.
 *
 * @param {{ archive: object, storage: { upload: Function }|null, bucket: string, siteId: string,
 *           dir: string, nowMs?: number, maxDays?: number }} args
 */
export async function sealPass({ archive, storage, bucket, siteId, dir, nowMs = Date.now(), maxDays = SEAL_DAYS_PER_PASS }) {
  const sealed = [];
  const uploaded = [];
  const errors = [];
  const lastDue = dayFloor(nowMs - SEAL_GRACE_MS) - DAY_MS;
  const oldest = Math.min(...Object.keys(STREAMS).map((s) => archive.span(s).oldestMs ?? Infinity));

  const days = new Set();
  if (Number.isFinite(oldest)) {
    for (let start = dayFloor(oldest); start <= lastDue; start += DAY_MS) {
      const day = utcDay(start);
      for (const stream of Object.keys(STREAMS)) {
        const current = archive.countRange(stream, { sinceMs: start, untilMs: start + DAY_MS });
        if (current === 0) continue;
        const seal = archive.sealOf(day, stream);
        const onDisk = seal && fs.existsSync(path.join(dir, seal.path));
        if (seal && seal.rows === current && onDisk) continue;
        if (!days.has(day) && days.size >= maxDays) continue;
        days.add(day);
        const s = sealDay({ archive, stream, day });
        const relative = path.relative(dir, localPathFor(dir, day, stream));
        writeAtomically(path.join(dir, relative), s.gz);
        archive.recordSeal({ day, stream, rows: s.rows, sha256: s.sha256, bytes: s.gz.length, path: relative });
        sealed.push(`${day} ${stream}`);
      }
    }
  }

  const unsent = archive.seals().filter((s) => !s.uploaded_at);
  if (unsent.length && !storage) {
    errors.push(`no file storage configured: ${unsent.length} sealed day(s) are on the edge only`);
  } else {
    for (const seal of unsent) {
      const storagePath = storagePathFor({ siteId, day: seal.day, stream: seal.stream });
      try {
        await storage.upload(bucket, storagePath, fs.readFileSync(path.join(dir, seal.path)));
        archive.markUploaded(seal.day, seal.stream, storagePath);
        uploaded.push(`${seal.day} ${seal.stream}`);
      } catch (err) {
        errors.push(`${seal.day} ${seal.stream}: ${String(err?.message ?? err)}`);
        break; // most likely the network; the next pass tries again, oldest first
      }
    }
  }
  return { sealed, uploaded, errors };
}

/**
 * The janitor's third gate: may the cloud's rows for `[fromMs, toMs)` be pruned? Only if every UTC
 * day in the range that the archive holds rows for is sealed with its current row count and has
 * been copied off the edge.
 */
export function sealGate({ archive }) {
  return (stream, fromMs, toMs) => {
    for (let start = dayFloor(fromMs); start < toMs; start += DAY_MS) {
      const day = utcDay(start);
      const current = archive.countRange(stream, { sinceMs: start, untilMs: start + DAY_MS });
      if (current === 0) continue;
      const seal = archive.sealOf(day, stream);
      if (!seal) return { sealed: false, reason: `${day} ${stream} is not sealed yet` };
      if (seal.rows !== current) return { sealed: false, reason: `${day} ${stream} changed since it was sealed (${seal.rows} -> ${current} rows)` };
      if (!seal.uploaded_at) return { sealed: false, reason: `${day} ${stream} is sealed but not yet copied off the edge` };
    }
    return { sealed: true, reason: null };
  };
}
