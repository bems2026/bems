/**
 * Tuya OpenAPI client — signing and requests, with no external dependencies.
 *
 * WHY THIS EXISTS:
 * Two problems this project has been carrying separately turn out to share an answer.
 *
 *   1. Enrolling a device means extracting its id and local key by hand from the Tuya IoT
 *      console (FI-001, sized L largely because of that manual step). The cloud API returns
 *      both, so the wizard can stop asking a human to copy secrets between browser tabs.
 *   2. When a device is unreachable on the LAN, nothing here can tell "the device is off" from
 *      "the device is fine and the network is in the way" (RM-013). Tuya's cloud has its own
 *      view of whether a device is online, arrived at over the internet rather than the local
 *      subnet. Disagreement between the two is the diagnosis.
 *
 * SECURITY — read before adding a caller:
 * `TUYA_ACCESS_SECRET` grants full control of every device in the project. It is the most
 * sensitive credential in this system, ahead of the Supabase service-role key, because it
 * reaches hardware directly and is not scoped by RLS.
 *   - It lives ONLY in `server/.env` on the Pi. This repository is public.
 *   - Every call in this module is server-side. Nothing here may be imported by `src/`; the
 *     browser bundle carries the Supabase anon key and nothing else, on purpose.
 *   - `describeDevice()` returns a local key. Callers must treat it the way
 *     `redactFlow.mjs` treats one: never logged, never rendered, never committed.
 *
 * The signing scheme is Tuya's own and is fiddly in ways that fail as a bare `sign invalid`:
 * the token request and a business request sign different strings, and the body hash is of the
 * raw body text — an empty body hashes to the SHA-256 of the empty string, not to nothing.
 */

import crypto from 'node:crypto';

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Data-centre host. Tuya projects are bound to one region and a call to the wrong host fails
 * authentication rather than redirecting, which reads as a bad secret. Configurable because
 * this is a property of the account, not of the code.
 */
export const TUYA_HOSTS = {
  cn: 'https://openapi.tuyacn.com',
  us: 'https://openapi.tuyaus.com',
  'us-east': 'https://openapi-ueaz.tuyaus.com',
  eu: 'https://openapi.tuyaeu.com',
  'eu-west': 'https://openapi-weaz.tuyaeu.com',
  in: 'https://openapi.tuyain.com',
  sg: 'https://openapi-sg.iotbing.com',
};

/**
 * Which host a project answers on is not reliably derivable from the region name shown in the
 * console — Tuya has added data centres on a different domain (`iotbing.com`) without renaming
 * the older ones, and a call to the wrong host fails as `sign invalid` rather than redirecting.
 * That failure is indistinguishable from a wrong secret, which is exactly the confusion this
 * exists to prevent: probe rather than guess, then write the answer down.
 *
 * Returns the first host whose token request succeeds, or null. Read-only — a token request
 * creates nothing and changes nothing.
 */
export async function probeTuyaHost({ accessId, accessSecret, fetchImpl = fetch, hosts = TUYA_HOSTS }) {
  const attempts = [];
  for (const [region, host] of Object.entries(hosts)) {
    try {
      const client = createTuyaClient({ accessId, accessSecret, host, fetchImpl });
      await client.ensureToken();
      return { region, host, attempts };
    } catch (e) {
      attempts.push({ region, host, error: String(e.message).slice(0, 90) });
    }
  }
  return { region: null, host: null, attempts };
}

/** HMAC-SHA256, uppercase hex — Tuya rejects lowercase. */
function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex').toUpperCase();
}

/**
 * Tuya's canonical string. `method` is upper-case, the body hash is of the raw text, the
 * optional signature headers block is empty here (we send none), and `path` includes the query
 * string exactly as sent — reordering the query breaks the signature.
 */
function stringToSign(method, path, body) {
  return `${method.toUpperCase()}\n${sha256(body ?? '')}\n\n${path}`;
}

export function createTuyaClient({ accessId, accessSecret, host, fetchImpl = fetch, now = Date.now }) {
  if (!accessId || !accessSecret) throw new Error('Tuya access id and secret are required');
  if (!host) throw new Error('Tuya host is required — the data centre is account-specific');

  let token = null;
  let tokenExpiresAt = 0;

  async function call(method, path, { body, useToken = true } = {}) {
    const t = String(now());
    const raw = body === undefined ? '' : JSON.stringify(body);
    // The token request signs client_id + t + nonce; a business request inserts the access
    // token between them. Getting this wrong returns "sign invalid" with no hint which half
    // was wrong, which is why the two paths are spelled out rather than parameterised.
    const prefix = useToken ? `${accessId}${token}${t}` : `${accessId}${t}`;
    const headers = {
      client_id: accessId,
      sign: sign(accessSecret, prefix + stringToSign(method, path, raw)),
      t,
      sign_method: 'HMAC-SHA256',
    };
    if (useToken) headers.access_token = token;
    if (raw) headers['Content-Type'] = 'application/json';

    const res = await fetchImpl(`${host}${path}`, { method, headers, body: raw || undefined });
    const json = await res.json().catch(() => null);
    if (!json || json.success !== true) {
      // Tuya reports failures as HTTP 200 with success:false — the same shape as PostgREST's
      // silent truncation and its RLS-blocked writes. Never infer success from a 200.
      const code = json?.code ?? res.status;
      throw new Error(`Tuya ${method} ${path} failed (code ${code}): ${json?.msg ?? 'no message'}`);
    }
    return json.result;
  }

  async function ensureToken() {
    // 60s of slack: a token that expires mid-flight fails as an auth error, which is
    // indistinguishable from a wrong secret at the call site.
    if (token && now() < tokenExpiresAt - 60_000) return;
    const result = await call('GET', '/v1.0/token?grant_type=1', { useToken: false });
    token = result.access_token;
    tokenExpiresAt = now() + Number(result.expire_time ?? 7200) * 1000;
  }

  return {
    /** Devices in the cloud project, with the cloud's own view of online state. */
    async listDevices({ pageSize = 100 } = {}) {
      await ensureToken();
      const result = await call('GET', `/v1.0/iot-01/associated-users/devices?size=${pageSize}`);
      return result?.devices ?? [];
    },

    /**
     * One device's detail, INCLUDING its `local_key`. Never log or render the result whole.
     */
    async describeDevice(deviceId) {
      await ensureToken();
      return call('GET', `/v1.0/devices/${encodeURIComponent(deviceId)}`);
    },

    /** Exposed for tests and for callers that need a path this module does not wrap yet. */
    call,
    ensureToken,
  };
}
