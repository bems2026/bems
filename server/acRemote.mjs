/**
 * The aircon's virtual remote in the vendor cloud, found by listing rather than by recorded id.
 *
 * The IR hub re-paired on 2026-09-17 carries the aircon as a VIRTUAL remote — "Air", category
 * `infrared_ac`, `sub: true` — which is the only thing the vendor cloud will compose an aircon IR
 * frame for. It has no network presence, so it has no node in the flow, and the flow is where every
 * other vendor id this system uses is read from (`cloudDispatchConfig.mjs`). This repository is
 * public, so its id cannot be written here either.
 *
 * So it is resolved: the project's one `infrared_ac` device. Zero or several is a REASON, never a
 * pick — commanding the wrong remote would point one room's aircon at another's. A site with more
 * than one aircon needs the pairing recorded somewhere first; that is a backlog item, not a guess.
 *
 * Tuya's own IR hub API (`/v2.0/infrareds/{hub}/remotes`) would name the hub's remotes directly, and
 * is NOT subscribed on this project (code 28841101, measured 2026-09-17). The device listing is.
 */

const TTL_MS = 10 * 60_000;
const FAILURE_TTL_MS = 30_000;

/**
 * @param client  a `createTuyaClient` instance, or null
 * @param now     injectable clock
 * @returns () => Promise<{ok: true, id: string} | {ok: false, reason: string}>
 */
export function createAcRemoteResolver({ client, now = Date.now } = {}) {
  let cached = null;

  return async function resolveAcRemote() {
    if (!client) return { ok: false, reason: 'the vendor cloud is not configured on this deployment' };
    if (cached && now() - cached.at < cached.ttl) return cached.result;

    let result;
    let ttl = TTL_MS;
    try {
      const devices = await client.listDevices();
      const remotes = devices.filter((d) => d?.category === 'infrared_ac');
      if (remotes.length === 1) result = { ok: true, id: remotes[0].id };
      else if (remotes.length === 0) result = { ok: false, reason: 'no aircon remote (infrared_ac) in the cloud project' };
      else result = { ok: false, reason: `${remotes.length} aircon remotes in the cloud project — cannot tell which one commands this aircon` };
    } catch (err) {
      // The upstream message can name the data centre; keep it short and never echo it to a browser.
      result = { ok: false, reason: `could not list cloud devices: ${String(err?.message ?? err).slice(0, 80)}` };
      ttl = FAILURE_TTL_MS;
    }
    cached = { at: now(), ttl, result };
    return result;
  };
}
