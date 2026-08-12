/**
 * Node-RED global-context write contract — Stage 2's second write path, mock-bridge only,
 * same posture as `shared/commands.mjs` (see that file's header for why the split exists
 * between what's real device control and what's just a stored value).
 *
 * Automation's schedules, ambient trigger setpoints, and DSM thresholds have nowhere real
 * to land today: the live flow's schedule subflow reads `global.schedule.*`,
 * `global.trigger.*`, `global.dsm.*` keys that nothing currently writes. This is that write
 * path — pure validation only, no I/O, imported by the mock and the tests ONLY, never by
 * `node-red-bridge/build-flow.mjs`. The Pi deployment stays read-only until a real write
 * path is built and verified on site, exactly as `shared/commands.mjs` already established.
 *
 * A context write has no observable device effect this app can await the way a command's
 * relay state can be polled back — it is a value sitting in Node-RED's global context until
 * the (already-existing) schedule subflow reads it on its own cycle. So the honesty
 * contract here is even flatter than commands': 202 + confirmed:false, always, because
 * there is nothing to confirm, ever — not "not yet", never.
 */

import { iso8 } from './buildLatest.mjs';

export const CONTEXT_ROUTE = '/api/context';
export const CONTEXT_ACCEPTED_STATUS = 202;

const SCHEDULE_FIELDS = new Set(['on', 'off', 'days', 'armed']);
const DSM_KEYS = new Set(['max_phase_a', 'max_total_kw', 'auto_shed']);
/** Only one IR-commandable unit exists in the registry (`acu_main`) — see the Phase M
 * plan's data-model table — so there is exactly one real trigger key, not v4's mockup pair. */
const TRIGGER_KEYS = new Set(['care_acu_on']);

const NOT_SCHEDULABLE_CLASSES = new Set(['meter', 'sensor_temp_humidity']);

/** Validates one `global.*` key against the real namespaces Automation writes. `registry`
 * guards `global.schedule.<device>.*` — the device must actually have switchable state. */
function validateKey(key, registry) {
  if (typeof key !== 'string' || key.length === 0) {
    return { ok: false, error: 'key must be a non-empty string' };
  }
  const parts = key.split('.');
  if (parts[0] !== 'global') return { ok: false, error: `unrecognized context namespace: ${key}` };

  if (parts[1] === 'schedule') {
    if (parts.length !== 4) return { ok: false, error: `malformed schedule key: ${key}` };
    const [, , deviceId, field] = parts;
    if (!SCHEDULE_FIELDS.has(field)) return { ok: false, error: `unknown schedule field: ${field}` };
    const device = registry.find((d) => d.id === deviceId);
    if (!device) return { ok: false, error: `unknown device_id in schedule key: ${deviceId}` };
    if (NOT_SCHEDULABLE_CLASSES.has(device.class)) return { ok: false, error: `${deviceId} has no schedulable state` };
    return { ok: true };
  }

  if (parts[1] === 'trigger') {
    if (parts.length !== 3 || !TRIGGER_KEYS.has(parts[2])) return { ok: false, error: `unknown trigger key: ${key}` };
    return { ok: true };
  }

  if (parts[1] === 'dsm') {
    if (parts.length !== 3 || !DSM_KEYS.has(parts[2])) return { ok: false, error: `unknown dsm key: ${key}` };
    return { ok: true };
  }

  return { ok: false, error: `unrecognized context namespace: ${key}` };
}

/**
 * Pure validation for a bulk write — `{writes: {key: value, ...}}`. Bulk, not one key per
 * request like `validateCommand`: Automation's "Write to Node-RED context" flushes every
 * pending edit in the queue at once, and splitting that into N requests would make a
 * partial failure ambiguous about which of N keys actually landed.
 *
 * Returns `{ok:true, writes}` or `{ok:false, status, code, error}` — never throws.
 */
export function validateContextWrite(body, registry) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, code: 'invalid_body', error: 'request body must be a JSON object' };
  }
  const { writes } = body;
  if (writes === null || typeof writes !== 'object' || Array.isArray(writes)) {
    return { ok: false, status: 400, code: 'invalid_writes', error: 'writes must be a JSON object of {key: value}' };
  }
  const keys = Object.keys(writes);
  if (keys.length === 0) {
    return { ok: false, status: 400, code: 'empty_writes', error: 'writes must contain at least one key' };
  }
  for (const key of keys) {
    const v = validateKey(key, registry);
    if (!v.ok) return { ok: false, status: 400, code: 'invalid_key', error: v.error };
  }
  return { ok: true, writes };
}

/** The write ack — 202 and `confirmed: false` always, per this file's header. */
export function buildContextAck(writes, atMs) {
  return {
    keys: Object.keys(writes),
    accepted_at: iso8(atMs),
    confirmed: false,
    note: 'written to the mock context store only — nothing reads this back on the real bridge',
  };
}
