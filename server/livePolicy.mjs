/**
 * This building's operating policy, as it is RIGHT NOW rather than as it was at build time —
 * RM-038.
 *
 * WHAT CHANGED AND WHY. `policy.acu_min_setpoint_c` is the coldest aircon setpoint the building
 * permits, and it comes from the university's energy-efficiency policy. It lived in
 * `shared/sites/<id>/site.mjs`, compiled into both the bundle and this process, so changing an
 * administrative decision meant editing a source file, rebuilding and redeploying. It is now
 * also a column-of-a-column in the database, writable through `set_acu_min_setpoint`
 * (supabase/phase26_policy_setpoint.sql), and this module is what the proxy reads it through.
 *
 * THE FALLBACK IS THE BUILD, AND THAT DIRECTION MATTERS. A database that cannot be reached must
 * not mean "no policy": it means the last value we successfully read, or failing that the value
 * this deployment was built with. A floor that quietly disappeared during an outage would let
 * through exactly the commands the policy exists to refuse, and nothing on any screen would say
 * so.
 *
 * THE DATABASE WINS WHEN IT IS READABLE, including when it is more permissive. That is the
 * point: an operator lowering the floor is making the decision the function exists to let them
 * make. The HARDWARE bound in `shared/commands.mjs` is applied afterwards regardless, so nothing
 * written here can ask for a code the IR library does not have.
 *
 * STALE-WHILE-REVALIDATE, NOT READ-PER-COMMAND. A command must not wait on a round trip to
 * Supabase to be validated, and a policy floor does not change between two presses of a button.
 * The cache is refreshed in the background and read synchronously.
 */

/** How long a successfully read policy is trusted before a refresh is attempted. */
export const POLICY_TTL_MS = 60_000;

/**
 * @param {object} opts
 * @param {object} opts.buildPolicy   `SITE.policy` — the fallback, and the shape everything else expects.
 * @param {string} opts.siteId
 * @param {string|null} opts.supabaseUrl
 * @param {string|null} opts.supabaseKey
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {() => number} [opts.now]
 */
export function createLivePolicy({ buildPolicy, siteId, supabaseUrl, supabaseKey, fetchImpl = fetch, now = Date.now }) {
  /** The last value read from the database, or null if one never has been. */
  let fromDb = null;
  let readAt = 0;
  let inFlight = null;
  let lastError = null;

  const configured = Boolean(supabaseUrl && supabaseKey);

  /** Build policy first, database on top — so a key the database does not carry keeps whatever
   * the site file declared, rather than becoming undefined. Only the keys somebody has actually
   * changed are overridden. */
  const merged = () => ({ ...buildPolicy, ...(fromDb ?? {}) });

  async function readOnce() {
    const url = `${supabaseUrl}/rest/v1/sites?select=policy&id=eq.${encodeURIComponent(siteId)}`;
    const res = await fetchImpl(url, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
    if (!res.ok) throw new Error(`sites read failed: HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`no sites row for ${siteId}`);
    const policy = rows[0]?.policy;
    // A row whose policy is not an object is corrupt, not empty. Keeping the previous value is
    // the same call the outage case makes, and for the same reason.
    if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
      throw new Error('sites.policy is not an object');
    }
    return policy;
  }

  /**
   * Attempts a refresh if the cached value is older than the TTL. Never throws and never
   * rejects: a failed read leaves the last good value in place, which is the whole design.
   * Concurrent callers share one request.
   */
  async function refresh(force = false) {
    if (!configured) return merged();
    if (!force && fromDb !== null && now() - readAt < POLICY_TTL_MS) return merged();
    if (inFlight) return inFlight;
    inFlight = readOnce()
      .then((policy) => {
        fromDb = policy;
        readAt = now();
        lastError = null;
        return merged();
      })
      .catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
        // Deliberately NOT stamping `readAt`: a failed read must not buy another TTL of not
        // trying again.
        return merged();
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    /** The policy to validate against, synchronously. Kick `refresh()` off separately. */
    current: merged,
    refresh,
    /** For the capabilities endpoint: where the value in force came from, and what went wrong. */
    status: () => ({
      source: fromDb === null ? 'build' : 'database',
      read_at: fromDb === null ? null : readAt,
      error: lastError,
    }),
  };
}
