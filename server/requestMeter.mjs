/**
 * Counting this process's requests to Supabase — RM-159.
 *
 * WHY. Every request to the hosted project is a line in its log, and the Free plan's log ingestion
 * (1 GB a month) is the quota this project keeps running into: 0.97 GB on 2026-09-30 (RM-149), 1.10 GB
 * on 2026-10-04 (RM-158, RM-159). Until now the only way to see where the lines came from was the
 * dashboard's Logs view — and reading logs is itself metered (log query, 100 GB), which went from 2 to
 * 30 GB while RM-158 was being checked. A request counted where it is made costs nothing to read.
 *
 * WHAT. `installRequestMeter` wraps this process's `fetch`, so every call to the project's URL is
 * counted by kind — whoever makes it, now or in code not yet written. Each daemon logs a ten-minute
 * summary line (when there was anything to count) and keeps the day's counts, and the day before's, in
 * `server/data/request-meter/<daemon>.json`, which `npm run preflight` reads (`request_budget`). One
 * writer per file: each daemon its own.
 *
 * Browser requests are not counted here; RM-159 took the browser's timed reads off the project
 * (`src/lib/requestBudget.test.ts` pins that), leaving only what a person does.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KINDS = Object.freeze(['rest', 'rpc', 'auth', 'storage', 'other']);

/** Which kind of request a URL under the project is. */
export function requestKind(url, base) {
  const p = String(url).slice(String(base).replace(/\/+$/, '').length);
  if (p.startsWith('/rest/v1/rpc/')) return 'rpc';
  if (p.startsWith('/rest/v1/')) return 'rest';
  if (p.startsWith('/auth/v1/')) return 'auth';
  if (p.startsWith('/storage/v1/')) return 'storage';
  return 'other';
}

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const zero = () => Object.fromEntries([...KINDS, 'total'].map((k) => [k, 0]));

/**
 * @param {{ daemon: string, file: string|null, now?: () => number }} opts
 */
export function createRequestMeter({ daemon, file, now = Date.now }) {
  let day = utcDay(now());
  let counts = zero();
  let previous = null;
  let window = zero();
  /**
   * When counting began for `day` — its midnight if this process was counting then, else the moment it
   * started (or null when an older file did not say). A day is a FULL day only if this is its midnight:
   * a day counted from 23:20 is not a day's budget, and preflight must not judge it as one.
   */
  let from = new Date(now()).toISOString();

  // A restart keeps the day's count: a daemon restarted at 15:00 has not made no requests today.
  if (file) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved?.day === day && saved.counts) {
        counts = { ...zero(), ...saved.counts };
        from = saved.from ?? null;
      } else if (saved?.day && saved.counts) {
        previous = { day: saved.day, from: saved.from ?? null, counts: { ...zero(), ...saved.counts } };
      }
      if (saved?.previous && saved.previous.day !== day && !previous) previous = { from: null, ...saved.previous };
    } catch {
      // No file yet, or a torn write: start the day at zero, which only undercounts.
    }
  }

  function rollOver() {
    const today = utcDay(now());
    if (today === day) return;
    previous = { day, from, counts };
    day = today;
    // This process was counting across midnight, so the new day is counted from its start.
    from = `${today}T00:00:00.000Z`;
    counts = zero();
  }

  return {
    count(kind) {
      rollOver();
      const k = KINDS.includes(kind) ? kind : 'other';
      counts[k] += 1;
      counts.total += 1;
      window[k] += 1;
      window.total += 1;
    },
    /** The counts since the last call, then zeroed — for the summary line. */
    takeWindow() {
      const out = window;
      window = zero();
      return out;
    },
    snapshot() {
      rollOver();
      return { daemon, day, from, counts: { ...counts }, previous, updated_at: new Date(now()).toISOString() };
    },
    /** Writes the snapshot whole (temp file, then rename), so a reader never sees half of one. */
    save() {
      if (!file) return;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.snapshot()));
        fs.renameSync(tmp, file);
      } catch {
        // The count is advisory; failing to keep it must never touch the daemon's real work.
      }
    },
  };
}

/** `rest ×3, rpc ×1` — the kinds that occurred, in a fixed order. */
export function describeCounts(c) {
  return KINDS.filter((k) => c[k] > 0).map((k) => `${k} ×${c[k]}`).join(', ');
}

/**
 * Counts every request this process makes to `supabaseUrl`, from now on. Returns the meter, or null
 * when there is no project to count requests to.
 */
export function installRequestMeter({
  daemon,
  supabaseUrl = process.env.SUPABASE_URL,
  dir = process.env.REQUEST_METER_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'request-meter'),
  summaryMs = Number(process.env.REQUEST_METER_SUMMARY_MS) || 10 * 60_000,
  log = (line) => console.log(line),
} = {}) {
  if (!supabaseUrl || typeof globalThis.fetch !== 'function') return null;
  const base = supabaseUrl.replace(/\/+$/, '');
  const meter = createRequestMeter({ daemon, file: path.join(dir, `${daemon}.json`) });
  const inner = globalThis.fetch;
  globalThis.fetch = function meteredFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (typeof url === 'string' && url.startsWith(base)) meter.count(requestKind(url, base));
    return inner.call(this, input, init);
  };
  setInterval(() => {
    const w = meter.takeWindow();
    if (w.total > 0) {
      log(`[${daemon}] ${w.total} Supabase request(s) in the last ${Math.round(summaryMs / 60_000)} min: ${describeCounts(w)} (today ${meter.snapshot().counts.total})`);
    }
    meter.save();
  }, summaryMs).unref();
  // A clean stop (each daemon's SIGTERM handler calls process.exit) keeps the minutes since the last save;
  // without this a restart lost up to ten minutes of the day's count.
  process.once('exit', () => meter.save());
  return meter;
}
