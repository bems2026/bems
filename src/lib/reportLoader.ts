/**
 * Loading a report without trusting the network to behave — RM-081.
 *
 * The Reports page used to fire its queries with no timeout, no retry and no memory. A request
 * that hung (`report_hour_matrix` timed out on a month before RM-072f hoisted its resolution call)
 * left a page with nothing on it and nothing saying why; a request that failed once blanked every
 * figure until somebody reloaded a kiosk nobody was standing at; and stepping back to the month
 * just read fired every query again. These are the three primitives the page loads through now.
 *
 * NONE OF THIS KNOWS WHAT A REPORT IS. It takes functions and keys, so each rule is testable on
 * its own and the page's honesty rules stay where they already live.
 */

/** A request that did not answer in time. Named, so the page can say "did not answer" rather than
 *  printing whatever an aborted fetch happens to call itself in that browser. */
export class ReportTimeoutError extends Error {
  readonly label: string;
  readonly ms: number;

  constructor(label: string, ms: number) {
    super(`${label} did not answer within ${ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`}`);
    this.name = 'ReportTimeoutError';
    this.label = label;
    this.ms = ms;
  }
}

/** What PostgREST hands back beside the rows when a query fails — the shape of `PostgrestError`. */
export interface QueryFailure {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * A query the database answered with an error, KEEPING what it said.
 *
 * Every loader used to rethrow `new Error(\`${fn} failed: ${error.message}\`)`, which kept the words
 * and dropped the SQLSTATE. On 2026-09-22 the Circuits tab said "readings_archive failed for
 * mtr_arec_acu: canceling statement due to statement timeout" on the first attempt, and Retry drew
 * the chart: the database's own timeout is a successful HTTP answer carrying 57014, `isTransient`
 * had nothing to classify but English, and so it never asked again. The message is unchanged — the
 * page has always shown `context: what the database said` — and the code now travels with it.
 */
export class ReportQueryError extends Error {
  readonly code: string | null;
  readonly details: string | null;
  readonly hint: string | null;
  /** The HTTP status of the answer, when the caller had one: a gateway timeout carries no code. */
  readonly status: number | null;

  constructor(context: string, failure: QueryFailure, status: number | null = null) {
    super(`${context}: ${failure.message}`);
    this.name = 'ReportQueryError';
    this.code = failure.code || null;
    this.details = failure.details ?? null;
    this.hint = failure.hint ?? null;
    this.status = status;
  }
}

/**
 * Runs `run` with a deadline. On expiry the signal handed to `run` is ABORTED as well as the wait
 * being abandoned: a timeout that only stops waiting leaves the query running against the database
 * and its answer crossing the Pi's uplink for nobody.
 */
export function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number, label: string): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new ReportTimeoutError(label, ms);
      controller.abort(err);
      reject(err);
    }, ms);
  });
  let started: Promise<T>;
  try {
    started = run(controller.signal);
  } catch (err) {
    clearTimeout(timer);
    return Promise.reject(err);
  }
  return Promise.race([started, expired]).finally(() => clearTimeout(timer));
}

/** How each browser words "the request never reached anything". Chrome, Firefox, Safari. */
const NETWORK_FAILURE = /Failed to fetch|NetworkError|Load failed/i;

/**
 * SQLSTATEs, and PostgREST's own codes, that say "not now" rather than "no".
 *
 * 57014 is the one this exists for: a statement cancelled by the database's timeout. Measured from
 * the Pi on 2026-09-22, the FIRST read of a week's `readings_archive` took 0.9–5.4 s a meter and the
 * second read of the same week 0.42–0.56 s, whether the four meters went at once, two at a time or
 * one by one — a cold cache, not contention. So the first attempt is the one that crosses the
 * signed-in statement timeout, and the second finds the pages warm. 53300 (too many connections),
 * 55P03 (lock not available) and the 08xxx connection failures clear the same way; PGRST000–002 are
 * PostgREST failing to reach the database at all.
 */
const TRANSIENT_CODES = new Set(['57014', '53300', '55P03', '08000', '08003', '08006', 'PGRST000', 'PGRST001', 'PGRST002']);

/** A gateway that gave up upstream answers with a status and often no code at all. */
const TRANSIENT_STATUS = new Set([502, 503, 504]);

/**
 * Whether asking again could produce a different answer.
 *
 * Only a timeout, a network failure or a database answer whose CODE says "not now" qualifies. A
 * permission refusal, a truncated result or a missing function will say exactly the same thing on
 * the second try, and retrying them only delays the page saying so. A caller that cancelled is not a
 * failure at all. A database error is classified by its code and never by its words, which are
 * localisable and change between versions.
 */
export function isTransient(err: unknown): boolean {
  if (err instanceof ReportTimeoutError) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return false;
  if (err instanceof ReportQueryError) {
    if (err.code !== null && TRANSIENT_CODES.has(err.code)) return true;
    if (err.status !== null && TRANSIENT_STATUS.has(err.status)) return true;
  }
  return NETWORK_FAILURE.test(err.message);
}

export interface RetryOptions {
  /** Attempts after the first. */
  retries?: number;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retries a transient failure with exponential backoff and jitter, and nothing else. The jitter is
 * a factor between 0.5 and 1.5, so a kiosk and a laptop that lost the network together do not come
 * back in lockstep.
 */
export async function retryTransient<T>(
  run: () => Promise<T>,
  { retries = 2, baseMs = 600, sleep = realSleep, random = Math.random }: RetryOptions = {}
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= retries || !isTransient(err)) throw err;
      await sleep(baseMs * 2 ** attempt * (0.5 + random()));
    }
  }
}

export interface ReportCache<T> {
  /** The cached answer, the request already on its way, or a new request — in that order. */
  get(key: string, load: () => Promise<T>): Promise<T>;
  /** The cached answer if there is a fresh one, synchronously; never a request in flight. */
  peek(key: string): T | undefined;
  invalidate(key: string): void;
  clear(): void;
}

export interface ReportCacheOptions {
  max?: number;
  /** Stored reports are not immutable: a week is added every Monday-plus-grace, and an old
   *  period's resolution decays as rows are rolled up. Ten minutes keeps browsing instant without
   *  letting a kiosk left on the page miss a week that settled overnight. */
  ttlMs?: number;
  now?: () => number;
}

/**
 * A small least-recently-used cache that de-duplicates requests in flight and never keeps a
 * failure — a remembered failure is a Retry button that cannot work.
 *
 * Owned per page mount by its caller rather than held in module scope: a module-level cache would
 * carry one test's fixtures into the next, and one signed-in session's answers into another's.
 */
export function createReportCache<T>({ max = 12, ttlMs = 10 * 60_000, now = Date.now }: ReportCacheOptions = {}): ReportCache<T> {
  // Map iteration order is insertion order, so re-inserting on access keeps the oldest first.
  const values = new Map<string, { value: T; at: number }>();
  const inflight = new Map<string, Promise<T>>();

  const fresh = (key: string) => {
    const entry = values.get(key);
    if (!entry) return undefined;
    if (now() - entry.at >= ttlMs) {
      values.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    get(key, load) {
      const hit = fresh(key);
      if (hit) {
        values.delete(key);
        values.set(key, hit);
        return Promise.resolve(hit.value);
      }
      const pending = inflight.get(key);
      if (pending) return pending;

      let started: Promise<T>;
      try {
        started = load();
      } catch (err) {
        return Promise.reject(err);
      }
      const request = started.then(
        (value) => {
          inflight.delete(key);
          values.set(key, { value, at: now() });
          while (values.size > max) {
            const oldest = values.keys().next().value;
            if (oldest === undefined) break;
            values.delete(oldest);
          }
          return value;
        },
        (err: unknown) => {
          inflight.delete(key);
          throw err;
        }
      );
      inflight.set(key, request);
      return request;
    },
    peek(key) {
      return fresh(key)?.value;
    },
    invalidate(key) {
      values.delete(key);
      inflight.delete(key);
    },
    clear() {
      values.clear();
      inflight.clear();
    },
  };
}
