/**
 * Minimal Supabase REST (PostgREST) client — upsert only, nothing else.
 *
 * Deliberately not the `@supabase/supabase-js` package: this server-side ingestion daemon
 * only ever does one operation (upsert rows with a service-role key), and native `fetch`
 * covers that in a dozen lines with zero added dependencies — matching this repo's existing
 * house style (`mock-bridge/server.mjs` is zero-dependency by the same reasoning). The
 * frontend's Phase 4/5 browser-side Supabase Auth/reads are a different context and may
 * reasonably use the real client library there.
 */

/**
 * @param {{ url: string, serviceRoleKey: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 */
export function makeSupabaseClient({ url, serviceRoleKey, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!url || !serviceRoleKey) {
    throw new Error('makeSupabaseClient requires both url and serviceRoleKey');
  }
  const base = url.replace(/\/+$/, '');

  /**
   * Upsert `rows` into `table`. `onConflict` names the column(s) PostgREST should treat as
   * the conflict target (comma-separated for composite keys, e.g. `"device_id,ts"`) — must
   * match the table's actual primary key/unique constraint or Supabase rejects the request.
   */
  async function upsert(table, rows, { onConflict } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return;

    const endpoint = `${base}/rest/v1/${table}${onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : ''}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          // merge-duplicates = upsert; return=minimal = don't pay for echoing rows back.
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(rows),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Supabase upsert ${table} -> ${res.status}: ${text.slice(0, 300)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return { upsert };
}
