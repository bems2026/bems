/**
 * Minimal Supabase REST (PostgREST) client — upsert, a narrow read, and RPC.
 *
 * Deliberately not the `@supabase/supabase-js` package: this server-side ingestion daemon
 * only ever does one operation (upsert rows with a service-role key), and native `fetch`
 * covers that in a dozen lines with zero added dependencies — matching this repo's existing
 * house style (`mock-bridge/server.mjs` is zero-dependency by the same reasoning). The
 * frontend's Phase 4/5 browser-side Supabase Auth/reads are a different context and may
 * reasonably use the real client library there.
 *
 * `select` and `rpc` were added for Phase 9's retention pass (`server/retention.mjs`),
 * which needs to ask how old the oldest reading is and to call
 * `roll_up_and_prune_readings`. They share this module's auth/timeout/error handling rather
 * than hand-rolling a second fetch wrapper next door.
 */

/**
 * @param {{ url: string, serviceRoleKey: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 */
export function makeSupabaseClient({ url, serviceRoleKey, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!url || !serviceRoleKey) {
    throw new Error('makeSupabaseClient requires both url and serviceRoleKey');
  }
  const base = url.replace(/\/+$/, '');

  /** Shared request plumbing — one place that knows about auth headers, the abort timeout,
   * and how PostgREST reports a failure. */
  async function request(endpoint, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(endpoint, {
        ...init,
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Supabase ${init.method} ${endpoint.replace(base, '')} -> ${res.status}: ${text.slice(0, 300)}`);
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Upsert `rows` into `table`. `onConflict` names the column(s) PostgREST should treat as
   * the conflict target (comma-separated for composite keys, e.g. `"device_id,ts"`) — must
   * match the table's actual primary key/unique constraint or Supabase rejects the request.
   */
  async function upsert(table, rows, { onConflict } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return;

    const endpoint = `${base}/rest/v1/${table}${onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : ''}`;
    await request(endpoint, {
      method: 'POST',
      // merge-duplicates = upsert; return=minimal = don't pay for echoing rows back.
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
  }


  /**
   * `GET /rest/v1/<table>?<query>`, returning the parsed array.
   *
   * Callers must pass their own `limit` — PostgREST silently caps at `db-max-rows` and
   * gives no signal that it did, which is exactly the failure
   * `supabase/phase9_history_buckets.sql` documents at length. An explicit limit makes
   * "this is all of it" a claim the caller has actually made.
   */
  async function select(table, query) {
    const res = await request(`${base}/rest/v1/${table}?${query}`, { method: 'GET' });
    return res.json();
  }

  /** `POST /rest/v1/rpc/<fn>`, returning the parsed body. */
  async function rpc(fn, args = {}) {
    const res = await request(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      body: JSON.stringify(args),
    });
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return { upsert, select, rpc };
}
