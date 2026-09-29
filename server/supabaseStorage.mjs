/**
 * Minimal client for the project's file storage — RM-148's off-edge copy of each sealed day.
 *
 * The same reasoning as `supabaseRest.mjs`: four calls, native `fetch`, no dependency. It keeps the
 * sealed days in a PRIVATE bucket, reached only with the service role that already lives in
 * `server/.env` on the edge. The files cost the Free plan's 1 GB of file storage, not its 500 MB of
 * database, and uploading is ingress, which the plan does not meter.
 */

/**
 * @param {{ url: string, serviceRoleKey: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 */
export function makeStorageClient({ url, serviceRoleKey, fetchImpl = fetch, timeoutMs = 60_000 }) {
  if (!url || !serviceRoleKey) throw new Error('makeStorageClient requires both url and serviceRoleKey');
  const base = `${url.replace(/\/+$/, '')}/storage/v1`;

  async function request(method, pathname, { body, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${pathname}`, {
        method,
        body,
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, ...headers },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw Object.assign(new Error(`Storage ${method} ${pathname} -> ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  const objectPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  return {
    /** Writes (or overwrites) one object. */
    async upload(bucket, path, bytes, contentType = 'application/gzip') {
      await request('POST', `/object/${encodeURIComponent(bucket)}/${objectPath(path)}`, {
        body: bytes,
        headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
      });
    },
    async download(bucket, path) {
      const res = await request('GET', `/object/${encodeURIComponent(bucket)}/${objectPath(path)}`);
      return Buffer.from(await res.arrayBuffer());
    },
    /** The bucket, or `null` when it does not exist. Storage answers a missing bucket with 400 or 404. */
    async getBucket(id) {
      try {
        const res = await request('GET', `/bucket/${encodeURIComponent(id)}`);
        return await res.json();
      } catch (err) {
        if ((err.status === 400 || err.status === 404) && /not found/i.test(err.message)) return null;
        throw err;
      }
    },
    async createBucket(id) {
      await request('POST', '/bucket', {
        body: JSON.stringify({ id, name: id, public: false }),
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}
