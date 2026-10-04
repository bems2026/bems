/**
 * `net_state` values that mean something is wrong — see `src/lib/supabaseCapabilityHistory.ts` for why
 * `local_net` and `cloud_net` are not among them.
 *
 * Shared since RM-159, when the edge began answering the same question the cloud query asks
 * (`GET /api/archive/trouble` in `server/proxy.mjs`): one list, so the two cannot disagree about what
 * counts as trouble.
 */
export const DEGRADED_NET_STATES = Object.freeze(['no_net']);
