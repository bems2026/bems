/**
 * The Pi's permanent raw archive — RM-148, the cold tier.
 *
 * WHY IT EXISTS. Supabase's Free plan turns read-only above 500 MB, and on 2026-09-29 this
 * project stood at 409 MB with `readings` nearly all of it. Raw minute data older than the
 * retention window existed nowhere: retention deleted it and `backup.mjs` skipped it. This file
 * is the one place that keeps every raw row for good, on the host that produced it, so the
 * hosted database can keep only a short hot window.
 *
 * LOCAL FIRST. `server/ingest.mjs` commits each tick here BEFORE anything is sent anywhere, and
 * an uploader (`server/archiveUpload.mjs`) drains rows past a per-stream cursor to Supabase. A
 * WAN outage therefore accumulates rows here and syncs them on reconnect; nothing is held in
 * memory and nothing is rewritten non-atomically, which is what the NDJSON outage buffer did.
 *
 * WHY SQLITE, AND WHY `node:sqlite`. The server has no npm dependencies by rule, and Node 22 and
 * 24 — the two runtimes CI tests — ship SQLite built in. One file, one writer (the ingest
 * daemon), any number of read-only readers (the proxy), WAL so they never block each other.
 *
 * WHAT A ROW IS. Exactly the row the cloud receives, stored typed: `ts` as epoch milliseconds,
 * `online` as 0/1, the vendor `capabilities` JSON through a dictionary (`capability_sets`) because
 * a light switch sends the same set 1,440 times a day. `pending()` rebuilds the cloud row from
 * these columns, so the archive and the cloud cannot hold different shapes — and a field this
 * file does not know about REFUSES the whole tick rather than vanishing from both copies.
 *
 * ORIGIN. Rows written by ingest (and rows recovered from the old NDJSON buffer) are uploaded.
 * Rows copied down from the cloud, or imported from old export files, are kept but never
 * uploaded: the cloud already has the first, and the second are older than its window.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ARCHIVE_SCHEMA_VERSION = 2;

/** Where a row came from. Stored as a small integer; the names are the contract. */
export const ORIGIN = Object.freeze({ ingest: 0, buffer: 1, cloud: 2, import: 3 });
const UPLOADABLE = [ORIGIN.ingest, ORIGIN.buffer];

/**
 * The three streams, their cloud tables and conflict targets, and each column's storage kind.
 * The column lists ARE the cloud row shape: `pending()` rebuilds exactly these keys.
 */
export const STREAMS = Object.freeze({
  readings: {
    onConflict: 'device_id,ts',
    columns: {
      device_id: 'text', ts: 'ts', voltage: 'real', current: 'real', power_w: 'real', energy_kwh_today: 'real',
      online: 'bool', total_energy_kwh: 'real', warn_power_w: 'real', power_type: 'text', net_state: 'text',
      fault: 'int', capabilities: 'json',
    },
  },
  building_totals: {
    onConflict: 'ts',
    columns: {
      ts: 'ts', site_id: 'text', energy_kwh_today: 'real', energy_kwh_week: 'real', energy_kwh_month: 'real',
      energy_kwh_today_integrated: 'real', energy_kwh_week_integrated: 'real', energy_kwh_month_integrated: 'real',
      total_power_w: 'real', avg_voltage: 'real', phase_current_red: 'real', phase_current_yellow: 'real',
      phase_current_blue: 'real',
    },
  },
  anomalies: {
    onConflict: 'device_id,ts,metric',
    columns: {
      device_id: 'text', ts: 'ts', metric: 'text', value: 'real', baseline_mean: 'real', baseline_stddev: 'real',
      z_score: 'real', iqr_lower: 'real', iqr_upper: 'real', method: 'text', sample_count: 'int',
    },
  },
});

const SQL_TYPE = { text: 'TEXT', ts: 'INTEGER NOT NULL', real: 'REAL', bool: 'INTEGER NOT NULL', int: 'INTEGER' };

/** The stored column for a cloud column: `capabilities` lives in the dictionary, as `cap_id`. */
const storedName = (col, kind) => (kind === 'json' ? 'cap_id' : col);

function createTableSql(stream, unique) {
  const cols = Object.entries(STREAMS[stream].columns).map(([col, kind]) =>
    kind === 'json' ? 'cap_id INTEGER REFERENCES capability_sets(id)' : `${col} ${SQL_TYPE[kind]}`);
  return `CREATE TABLE ${stream} (
    id INTEGER PRIMARY KEY,
    ${cols.join(',\n    ')},
    origin INTEGER NOT NULL DEFAULT 0,
    UNIQUE (${unique})
  ) STRICT;`;
}

/** Ordered migrations; index + 1 is the schema version each one produces. */
const MIGRATIONS = [
  `CREATE TABLE capability_sets (id INTEGER PRIMARY KEY, json TEXT NOT NULL UNIQUE) STRICT;
   ${createTableSql('readings', 'ts, device_id')}
   ${createTableSql('building_totals', 'ts')}
   ${createTableSql('anomalies', 'device_id, ts, metric')}
   CREATE TABLE upload_cursor (stream TEXT PRIMARY KEY, through_id INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
   CREATE TABLE upload_rejects (stream TEXT NOT NULL, row_id INTEGER NOT NULL, reason TEXT, at INTEGER NOT NULL,
                                PRIMARY KEY (stream, row_id)) STRICT;`,
  // 2 — RM-148 Stage 4: each UTC day, per stream, sealed into a file and copied off the edge.
  `CREATE TABLE sealed_days (
     day TEXT NOT NULL, stream TEXT NOT NULL, rows INTEGER NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
     path TEXT NOT NULL, sealed_at INTEGER NOT NULL, uploaded_at INTEGER, storage_path TEXT,
     PRIMARY KEY (day, stream)) STRICT;`,
];

function toStored(kind, value, col) {
  if (value === undefined || value === null) {
    if (kind === 'ts' || kind === 'bool') throw new Error(`archive: ${col} is required`);
    return null;
  }
  switch (kind) {
    case 'ts': {
      const ms = Date.parse(value);
      if (Number.isNaN(ms)) throw new Error(`archive: unparseable ${col} ${JSON.stringify(value)}`);
      return ms;
    }
    case 'bool': return value ? 1 : 0;
    case 'int': return Math.trunc(Number(value));
    case 'real': return Number(value);
    case 'text': return String(value);
    default: throw new Error(`archive: no storage for ${col}`);
  }
}

function fromStored(kind, value) {
  if (value === null || value === undefined) return kind === 'bool' ? false : null;
  switch (kind) {
    case 'ts': return new Date(value).toISOString();
    case 'bool': return value === 1;
    default: return value;
  }
}

/**
 * @param {string} file
 * @param {{ readOnly?: boolean, targetVersion?: number }} [opts]  `targetVersion` is for tests of the
 *   migrations themselves: it builds an archive as an older release would have left it.
 */
export function openArchive(file, { readOnly = false, targetVersion = ARCHIVE_SCHEMA_VERSION } = {}) {
  if (!readOnly) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { readOnly });
  db.exec('PRAGMA busy_timeout = 5000');

  if (!readOnly) {
    // WAL: the proxy reads while ingest writes, and neither waits. FULL: one fsync a minute is
    // nothing, and a tick that returned is a tick that survives a power cut.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA journal_size_limit = 67108864');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, targetVersion);
  } else if (userVersion(db) < ARCHIVE_SCHEMA_VERSION) {
    db.close();
    throw new Error(`archive at ${file} is not initialised (schema ${ARCHIVE_SCHEMA_VERSION} expected) — the ingest daemon creates it`);
  }

  const statements = new Map();
  const prepare = (sql) => {
    let s = statements.get(sql);
    if (!s) statements.set(sql, (s = db.prepare(sql)));
    return s;
  };

  function capabilityId(value) {
    const json = JSON.stringify(value);
    prepare('INSERT OR IGNORE INTO capability_sets (json) VALUES (?)').run(json);
    return prepare('SELECT id FROM capability_sets WHERE json = ?').get(json).id;
  }

  function assertKnownKeys(stream, rows) {
    const known = STREAMS[stream].columns;
    for (const row of rows) {
      const unknown = Object.keys(row).filter((k) => !(k in known));
      if (unknown.length) {
        throw new Error(`archive: ${stream} row carries field(s) the archive cannot hold: ${unknown.join(', ')} — extend STREAMS and add a migration`);
      }
    }
  }

  function insertRows(stream, rows, origin) {
    const entries = Object.entries(STREAMS[stream].columns);
    const names = entries.map(([col, kind]) => storedName(col, kind));
    const sql = `INSERT OR IGNORE INTO ${stream} (${names.join(', ')}, origin) VALUES (${names.map(() => '?').join(', ')}, ?)`;
    let inserted = 0;
    for (const row of rows) {
      const values = entries.map(([col, kind]) =>
        kind === 'json' ? (row[col] === null || row[col] === undefined ? null : capabilityId(row[col])) : toStored(kind, row[col], col));
      inserted += Number(prepare(sql).run(...values, origin).changes);
    }
    return inserted;
  }

  /**
   * One tick, in one transaction: all of it is kept or none of it is.
   * @param {{ readings?: object[], totals?: object|null, anomalies?: object[] }} batch
   * @param {{ origin?: number }} [opts]
   */
  function insertTick({ readings = [], totals = null, anomalies = [] }, { origin = ORIGIN.ingest } = {}) {
    const byStream = { readings, building_totals: totals ? [totals] : [], anomalies };
    for (const [stream, rows] of Object.entries(byStream)) assertKnownKeys(stream, rows);
    const counts = { readings: 0, building_totals: 0, anomalies: 0 };
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [stream, rows] of Object.entries(byStream)) counts[stream] = insertRows(stream, rows, origin);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* the failure below is the one worth reporting */ }
      throw err;
    }
    return counts;
  }

  /**
   * Takes in what the pre-RM-148 NDJSON outage buffer was holding (`{ table, rows }` entries).
   * Those rows never reached the cloud, so they go in as `buffer` rows the uploader still owes.
   * Anything not a telemetry stream is counted as skipped, not guessed at.
   */
  function importBufferEntries(entries) {
    const counts = { readings: 0, building_totals: 0, anomalies: 0, skipped: 0 };
    for (const entry of entries) {
      if (!(entry?.table in STREAMS)) {
        counts.skipped += 1;
        continue;
      }
      counts[entry.table] += insertStreamRows(entry.table, Array.isArray(entry.rows) ? entry.rows : [], { origin: ORIGIN.buffer });
    }
    return counts;
  }

  /** Rows of one stream in one transaction — the backfill's and the importers' way in. */
  function insertStreamRows(stream, rows, { origin = ORIGIN.ingest } = {}) {
    if (!(stream in STREAMS)) throw new Error(`archive: ${stream} is not a stream (${Object.keys(STREAMS).join(', ')})`);
    assertKnownKeys(stream, rows);
    db.exec('BEGIN IMMEDIATE');
    try {
      const n = insertRows(stream, rows, origin);
      db.exec('COMMIT');
      return n;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* reported below */ }
      throw err;
    }
  }

  /** Rows held for `[sinceMs, untilMs)`, whatever their origin; optionally one device's only. */
  function countRange(stream, { sinceMs, untilMs, deviceId }) {
    if (!(stream in STREAMS)) throw new Error(`archive: ${stream} is not a stream`);
    const byDevice = deviceId !== undefined && 'device_id' in STREAMS[stream].columns;
    return prepare(`SELECT count(*) AS n FROM ${stream} WHERE ts >= ? AND ts < ?${byDevice ? ' AND device_id = ?' : ''}`)
      .get(sinceMs, untilMs, ...(byDevice ? [deviceId] : [])).n;
  }

  const cursorOf = (stream) => prepare('SELECT through_id FROM upload_cursor WHERE stream = ?').get(stream)?.through_id ?? 0;
  const uploadable = `origin IN (${UPLOADABLE.join(', ')})`;

  /** `SELECT` list and join that rebuild a stream's cloud columns from the stored ones. */
  function cloudSelect(stream) {
    const entries = Object.entries(STREAMS[stream].columns);
    return {
      entries,
      select: entries.map(([col, kind]) => (kind === 'json' ? 'c.json AS capabilities' : `t.${col}`)).join(', '),
      join: entries.some(([, kind]) => kind === 'json') ? 'LEFT JOIN capability_sets c ON c.id = t.cap_id' : '',
    };
  }

  function toCloudRow(entries, r) {
    const row = {};
    for (const [col, kind] of entries) {
      row[col] = kind === 'json' ? (r[col] === null ? null : JSON.parse(r[col])) : fromStored(kind, r[col]);
    }
    return row;
  }

  /** The next rows to upload for one stream, oldest first, as `{ id, row }` with `row` in the cloud's shape. */
  function pending(stream, limit) {
    const { entries, select, join } = cloudSelect(stream);
    const rows = prepare(`SELECT t.id AS _id, ${select} FROM ${stream} t ${join}
                          WHERE t.id > ? AND t.${uploadable} ORDER BY t.id LIMIT ?`).all(cursorOf(stream), limit);
    return rows.map((r) => ({ id: r._id, row: toCloudRow(entries, r) }));
  }

  /** Rows still owed to the cloud with a timestamp before `beforeMs`. The janitor's first gate. */
  function pendingBefore(stream, beforeMs) {
    return prepare(`SELECT count(*) AS n FROM ${stream} WHERE id > ? AND ${uploadable} AND ts < ?`).get(cursorOf(stream), beforeMs).n;
  }

  /**
   * Rows per device and hour in `[sinceMs, untilMs)`, keyed `${device_id}|${hourStartMs}` — the shape of the
   * cloud's `readings_manifest`. A stream without devices keys on `|${hourStartMs}`.
   */
  function countsByDeviceHour(stream, { sinceMs, untilMs }) {
    const device = 'device_id' in STREAMS[stream].columns ? 'device_id' : "''";
    const rows = prepare(`SELECT ${device} AS d, (ts / 3600000) * 3600000 AS h, count(*) AS n FROM ${stream}
                          WHERE ts >= ? AND ts < ? GROUP BY 1, 2`).all(sinceMs, untilMs);
    return new Map(rows.map((r) => [`${r.d}|${r.h}`, r.n]));
  }

  /** Every row in `[sinceMs, untilMs)`, whatever its origin, in a fixed order, with `origin` added. */
  function* rowsBetween(stream, { sinceMs, untilMs }) {
    const { entries, select, join } = cloudSelect(stream);
    const order = ['ts', 'device_id', 'metric'].filter((c) => c in STREAMS[stream].columns).map((c) => `t.${c}`).join(', ');
    const it = prepare(`SELECT t.origin AS _origin, ${select} FROM ${stream} t ${join}
                        WHERE t.ts >= ? AND t.ts < ? ORDER BY ${order}`).iterate(sinceMs, untilMs);
    for (const r of it) yield { ...toCloudRow(entries, r), origin: r._origin };
  }

  /** A day sealed into a file (again, if its rows changed): not uploaded until `markUploaded` says so. */
  function recordSeal({ day, stream, rows, sha256, bytes, path: file }) {
    prepare(`INSERT OR REPLACE INTO sealed_days (day, stream, rows, sha256, bytes, path, sealed_at, uploaded_at, storage_path)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`).run(day, stream, rows, sha256, bytes, file, Date.now());
  }

  function markUploaded(day, stream, storagePath) {
    prepare('UPDATE sealed_days SET uploaded_at = ?, storage_path = ? WHERE day = ? AND stream = ?').run(Date.now(), storagePath, day, stream);
  }

  /** The oldest and newest instant a stream holds, or nulls when it holds nothing. */
  function span(stream) {
    const r = prepare(`SELECT min(ts) AS o, max(ts) AS n FROM ${stream}`).get();
    return { oldestMs: r.o ?? null, newestMs: r.n ?? null };
  }

  const sealOf = (day, stream) => prepare('SELECT * FROM sealed_days WHERE day = ? AND stream = ?').get(day, stream) ?? null;
  const seals = () => prepare('SELECT * FROM sealed_days ORDER BY day, stream').all();

  /** Marks everything up to and including `throughId` as uploaded. Never moves backwards. */
  function advance(stream, throughId) {
    prepare(`INSERT INTO upload_cursor (stream, through_id, updated_at) VALUES (?, ?, ?)
             ON CONFLICT (stream) DO UPDATE SET through_id = max(through_id, excluded.through_id), updated_at = excluded.updated_at`)
      .run(stream, throughId, Date.now());
  }

  /** Rows still waiting to reach the cloud, per stream. */
  function lag() {
    const out = {};
    for (const stream of Object.keys(STREAMS)) {
      out[stream] = prepare(`SELECT count(*) AS n FROM ${stream} WHERE id > ? AND ${uploadable}`).get(cursorOf(stream)).n;
    }
    return out;
  }

  /** Quarantines one row the cloud refused for good, so it cannot block the rows behind it. */
  function reject(stream, rowId, reason) {
    prepare('INSERT OR REPLACE INTO upload_rejects (stream, row_id, reason, at) VALUES (?, ?, ?, ?)')
      .run(stream, rowId, String(reason).slice(0, 500), Date.now());
  }

  const rejects = () => prepare('SELECT stream, row_id, reason, at FROM upload_rejects ORDER BY at').all();

  function stats() {
    const count = (table) => prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    const span = prepare('SELECT min(ts) AS oldest, max(ts) AS newest FROM readings').get();
    const pageBytes = prepare('PRAGMA page_count').get().page_count * prepare('PRAGMA page_size').get().page_size;
    return {
      readings: count('readings'),
      building_totals: count('building_totals'),
      anomalies: count('anomalies'),
      capability_sets: count('capability_sets'),
      oldest: span.oldest === null ? null : new Date(span.oldest).toISOString(),
      newest: span.newest === null ? null : new Date(span.newest).toISOString(),
      bytes: pageBytes,
    };
  }

  return {
    file,
    insertTick,
    importBufferEntries,
    insertRows: insertStreamRows,
    pendingBefore,
    countsByDeviceHour,
    rowsBetween,
    recordSeal,
    markUploaded,
    sealOf,
    seals,
    span,
    countRange,
    pending,
    advance,
    lag,
    reject,
    rejects,
    stats,
    schemaVersion: () => userVersion(db),
    journalMode: () => prepare('PRAGMA journal_mode').get().journal_mode,
    close: () => db.close(),
  };
}

function userVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

function migrate(db, targetVersion = MIGRATIONS.length) {
  const from = userVersion(db);
  for (let v = from; v < Math.min(targetVersion, MIGRATIONS.length); v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* reported below */ }
      throw err;
    }
  }
}
