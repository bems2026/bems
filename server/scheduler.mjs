#!/usr/bin/env node
/**
 * ibems-scheduler — fires the Automation page's schedules.
 *
 * Until now the two halves of scheduling never met. The Automation page wrote schedules to
 * Supabase, which nothing read; Node-RED ran its own schedules from flow context, which the
 * app could not write. This daemon is the missing half: it reads the app's schedules and
 * acts on them.
 *
 * It goes through the SAME gate and the SAME audit trail as a person clicking in the app —
 * `HARDWARE_DISPATCH_ENABLED` decides whether anything reaches a relay, and every attempt
 * writes a `commands` row. That is the whole reason this lives here rather than inside the
 * flow: Node-RED's own cron schedules bypass both, and always have.
 *
 * SCOPE — every class with a real dispatch path, which is now lights, outlets and the aircon.
 * Derived from `DISPATCH_CLASSES` rather than listed again here, so this can never claim to
 * cover a class the dispatcher cannot actually reach.
 *
 * It also runs automatic load shedding, for the same reason and through the same path:
 * when the building goes over a configured limit and auto-shed is on, it switches off the
 * lowest tier of devices an operator marked as sheddable. Shed only, never restore — see
 * shedPlan.mjs for why that asymmetry is deliberate.
 *
 *     node server/scheduler.mjs
 */

import { DEVICE_REGISTRY, SITE } from '../shared/registry.mjs';
import { resolveDue, unfireableRows } from './schedulePlan.mjs';
import { planShed } from './shedPlan.mjs';
import { planSetpoint } from './acuLoopPlan.mjs';
import { createNotifier } from './notify.mjs';
import { dispatchCommand, DISPATCH_CLASSES } from './dispatchLight.mjs';
import { auditedDispatch } from './auditedDispatch.mjs';
import { createBufferedAudit } from './auditQueue.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BRIDGE_HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT) || 1880;
const HARDWARE_DISPATCH_ENABLED = process.env.HARDWARE_DISPATCH_ENABLED === 'true';
const LIGHT_API_TOKEN = process.env.LIGHT_API_TOKEN || null;
const REFRESH_MS = Number(process.env.SCHEDULE_REFRESH_MS) || 60_000;
// Tunable for the same reason REFRESH_MS is: a test that has to wait out a real 15s loop
// either takes minutes or, far worse, asserts after a single iteration and quietly stops
// testing the thing it is named after. `does not fire the same minute twice` did exactly
// that — at 15s a 4s test ran ONE tick, so the once-a-minute guard it exists to prove was
// never exercised.
const TICK_MS = Number(process.env.SCHEDULE_TICK_MS) || 15_000;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[ibems-scheduler] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required — see server/.env.example');
  process.exit(1);
}
// Same fail-fast as proxy.mjs: believing it can dispatch while having no way to authenticate
// to the light endpoint is a dangerous half-configuration, not a safe degraded mode.
if (HARDWARE_DISPATCH_ENABLED && !LIGHT_API_TOKEN) {
  console.error('[ibems-scheduler] HARDWARE_DISPATCH_ENABLED=true but LIGHT_API_TOKEN is unset — refusing to start.');
  process.exit(1);
}

/** Devices with a real dispatch path, derived from the same list the proxy advertises rather
 * than a second hardcoded copy — so schedules and shedding automatically cover a class the
 * moment its endpoint exists, and never claim to cover one that does not. */
const DISPATCHABLE_DEVICE_IDS = DEVICE_REGISTRY.filter((d) => DISPATCH_CLASSES.includes(d.class)).map((d) => d.id);

/** The registry keyed by id, built once. `resolveDue` needs each device's class and socket list
 * to expand a whole-outlet rule and to refuse a socket the device does not have; a linear
 * `find()` per command was fine for one row per device and is not for a stack. */
const DEVICE_BY_ID = new Map(DEVICE_REGISTRY.map((d) => [d.id, d]));

const sb = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(8000),
  });

let schedules = [];
let thresholds = { maxPhaseA: null, maxTotalKw: null, autoShed: false };
let shedActor = null;
let shedGroups = {};
/** device id -> { [socket]: tier }. RM-060: an outlet is two relays and one may be a fridge
 * while the other is a kettle. `shedGroups` above stays as the device-level fallback. */
let socketShedGroups = {};

/**
 * RM-062's closed-loop aircon controller.
 *
 * `acuState` is the AUTHORITATIVE copy for the life of the process, seeded from `acu_loop_state`
 * at startup and written through on every step. Read once rather than per tick for the same
 * reason `livePolicy` is: a controller that stops deciding because Supabase blinked is worse
 * than one deciding from a value a minute old.
 *
 * A rule whose state could NOT be read at startup is seeded with `last_step_at = process start`,
 * not null. That makes the loop wait one full interval before its first step, which is strictly
 * safer than assuming it has never stepped and strictly better than refusing to control at all
 * during an outage.
 */
let acuRules = [];
let acuState = {};
/** Newest non-loop command per aircon, for the manual/schedule hold. */
let acuRecentCommands = {};
const PROCESS_STARTED_AT = new Date().toISOString();
const notify = createNotifier(process.env);
let stopping = false;
/** Guards against firing the same minute twice if a tick runs long or the clock jitters. */
let lastFiredMinute = null;

async function refreshSchedules() {
  // No `&socket=is.null` any more: RM-059 made the socket meaningful, so filtering it out here
  // would hide every per-socket rule the Automation page writes. No `enabled` filter either,
  // deliberately — the startup line reports the true row count, and `unfireableRows` below can
  // only report on rows it can see.
  const res = await sb('schedules?select=id,device_id,socket,rule,enabled,updated_by,label');
  if (!res.ok) throw new Error(`schedules fetch failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  schedules = await res.json();

  /**
   * Armed rules that can never fire, counted out loud.
   *
   * Every one of these skips predates RM-059 and each was survivable when a device held ONE
   * row: an unattributed schedule meant a whole device went quiet and somebody noticed. In a
   * stack of five it is one rule of five, which nobody does. This line is the whole of that
   * failure's voice on the Pi; the Automation page renders the same reasons per rule.
   */
  const dead = unfireableRows(schedules, { deviceById: DEVICE_BY_ID, dispatchableDeviceIds: DISPATCHABLE_DEVICE_IDS });
  if (dead.length > 0) {
    const byReason = {};
    for (const d of dead) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
    const summary = Object.entries(byReason).map(([r, n]) => `${r}=${n}`).join(', ');
    console.warn(`[ibems-scheduler] ${dead.length} armed rule(s) can never fire: ${summary}`);
  }
}

/** DSM limits plus each device's shed tier. Both are operator configuration, re-read on the
 * same cadence as schedules so a change made in the app takes effect without a restart. */
async function refreshDsmConfig() {
  const [tRes, cRes, sRes] = await Promise.all([
    // RM-027: by site, not by the id=1 the singleton constraint used to guarantee. That
    // constraint is gone; `unique (site_id)` replaced it, and this is the matching read.
    sb(`dsm_thresholds?select=max_phase_current,max_total_kw,auto_shed,updated_by&site_id=eq.${SITE.id}`),
    sb('device_config?select=device_id,load_shed_group'),
    sb('socket_config?select=device_id,socket,load_shed_group'),
  ]);
  if (!tRes.ok) throw new Error(`dsm_thresholds fetch failed: HTTP ${tRes.status}`);
  if (!cRes.ok) throw new Error(`device_config fetch failed: HTTP ${cRes.status}`);
  // A deployment that has not applied phase34 yet answers 404 here. That is not a reason to
  // stop shedding: `shedTargets` falls back to the device-level tier for any socket with no
  // row, which is exactly the pre-RM-060 behaviour. Logged once per refresh, never fatal.
  if (!sRes.ok) console.warn(`[ibems-scheduler] socket_config unreadable (HTTP ${sRes.status}) — falling back to device-level shed tiers`);
  const row = (await tRes.json())[0] ?? {};
  thresholds = {
    maxPhaseA: row.max_phase_current ?? null,
    maxTotalKw: row.max_total_kw ?? null,
    autoShed: row.auto_shed === true,
  };
  shedActor = row.updated_by ?? null;
  shedGroups = Object.fromEntries((await cRes.json()).map((r) => [r.device_id, r.load_shed_group ?? null]));

  const socketRows = sRes.ok ? await sRes.json() : [];
  socketShedGroups = {};
  for (const r of socketRows) {
    (socketShedGroups[r.device_id] ??= {})[r.socket] = r.load_shed_group ?? null;
  }
}

/**
 * The aircon rules and what the controller remembers about each — RM-062.
 *
 * A deployment that has not applied phase36 answers 404 for both. That is not fatal and not even
 * noteworthy on most sites: no rules means no loop, which is exactly what a site without the
 * migration should get. Logged once per refresh so it is not silent.
 */
async function refreshAcuRules() {
  const [rRes, sRes] = await Promise.all([
    sb('acu_rules?select=id,acu_device_id,sensor_device_id,target_c,deadband_c,step_c,min_step_interval_s,manual_hold_s,days,window_start,window_end,enabled,label,override_reason,updated_by'),
    sb('acu_loop_state?select=rule_id,commanded_c,last_step_at,last_direction,alert_kind,alert_since'),
  ]);

  if (!rRes.ok) {
    if (acuRules.length > 0) console.warn(`[ibems-scheduler] acu_rules unreadable (HTTP ${rRes.status}) — keeping the ${acuRules.length} rule(s) already loaded`);
    return;
  }
  acuRules = await rRes.json();
  if (acuRules.length === 0) return;

  const rows = sRes.ok ? await sRes.json() : [];
  const seen = new Map(rows.map((r) => [r.rule_id, r]));
  const next = {};
  for (const rule of acuRules) {
    const row = seen.get(rule.id);
    next[rule.id] = row
      ? {
          commanded_c: row.commanded_c ?? null,
          last_step_at: row.last_step_at ?? null,
          last_direction: row.last_direction ?? null,
          alert_kind: row.alert_kind ?? null,
          // Carried forward: a write that failed earlier in this process must keep holding the
          // rule until one succeeds, and a config refresh is not evidence that it will.
          writable: acuState[rule.id]?.writable !== false,
        }
      : {
          commanded_c: acuState[rule.id]?.commanded_c ?? null,
          // Process start, NOT null. See the note on `acuState`.
          last_step_at: acuState[rule.id]?.last_step_at ?? PROCESS_STARTED_AT,
          last_direction: acuState[rule.id]?.last_direction ?? null,
          alert_kind: acuState[rule.id]?.alert_kind ?? null,
          writable: acuState[rule.id]?.writable !== false,
        };
  }
  acuState = next;

  // The newest command per aircon, whatever asked for it. One query for every rule rather than
  // one per rule, and only the aircons any rule names.
  const acuIds = [...new Set(acuRules.map((r) => r.acu_device_id))];
  if (acuIds.length > 0) {
    const list = acuIds.map((id) => `"${id}"`).join(',');
    const cRes = await sb(`commands?select=device_id,source,requested_at&device_id=in.(${list})&order=requested_at.desc&limit=50`);
    if (cRes.ok) {
      const rows2 = await cRes.json();
      const newest = {};
      for (const row of rows2) if (!newest[row.device_id]) newest[row.device_id] = row;
      acuRecentCommands = newest;
    }
  }
}

/** Persists one rule's controller state. Best-effort, but a FAILURE IS REMEMBERED: a step that
 * was not recorded is a step that would be repeated after the next restart, so the rule holds on
 * `state_unwritable` until a write succeeds. */
async function writeAcuState(ruleId, patch) {
  const body = { rule_id: ruleId, ...patch, updated_at: new Date().toISOString() };
  try {
    const res = await sb('acu_loop_state?on_conflict=rule_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    acuState[ruleId] = { ...acuState[ruleId], ...patch, writable: true };
    return true;
  } catch (err) {
    console.error(`[ibems-scheduler] could not record acu loop state for ${ruleId}: ${String(err)}`);
    acuState[ruleId] = { ...acuState[ruleId], writable: false };
    return false;
  }
}

/** The live reading, straight from the bridge rather than via Supabase — shedding should react
 * to what the building is drawing now, not to a row written up to a minute ago. */
async function fetchLatest() {
  const res = await fetch(`http://${BRIDGE_HOST}:${BRIDGE_PORT}/api/readings/latest`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`readings fetch failed: HTTP ${res.status}`);
  const rows = await res.json();
  const totals = rows.find((r) => r.device_id === '_totals') ?? null;
  const readings = Object.fromEntries(rows.filter((r) => r.device_id !== '_totals').map((r) => [r.device_id, r]));
  return { totals, readings };
}

/**
 * Its OWN buffer file, not the proxy's.
 *
 * Both processes record commands, and both amend an entry after dispatch with the outcome —
 * a read-modify-write. Two processes doing that to one file is a genuine race: `writeBuffer`
 * rewrites the whole file, so a concurrent reader can see a partial one, and the loser of the
 * interleaving silently discards the other's rows. One file per writer removes the race
 * outright rather than narrowing it, and costs nothing: `ingest.mjs` drains a list.
 */
const COMMAND_BUFFER_PATH =
  process.env.SCHEDULER_AUDIT_BUFFER_PATH ||
  join(dirname(fileURLToPath(import.meta.url)), 'data', 'command-audit-buffer-scheduler.ndjson');

/** Insert one `commands` row, asking PostgREST for the id back so the outcome can be
 * attached to it once dispatch has been attempted. */
async function insertAuditRemote(row) {
  let res;
  try {
    res = await sb('commands', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...row, accepted_at: new Date().toISOString(), confirmed: false, confirmation: 'none', target: null }),
    });
  } catch (err) {
    // No answer was obtained. Only this may be buffered — see auditQueue.mjs. A status code
    // below is Supabase ANSWERING, and an answer of "no" stays a refusal even out here where
    // this daemon writes with the service-role key and RLS does not apply to it.
    return { ok: false, unreachable: true, detail: String(err) };
  }
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status} ${await res.text().catch(() => '')}` };
  const body = await res.json().catch(() => null);
  return { ok: true, id: Array.isArray(body) ? body[0]?.id : body?.id };
}

async function updateAuditRemote(id, patch) {
  let res;
  try {
    res = await sb(`commands?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      // `return=representation` so the affected-row count can be checked: PostgREST reports a
      // policy-blocked UPDATE as a success with an empty result, the trap 2e4c0c2 fixed on
      // the schedule-save path. This daemon writes with the service-role key so RLS does not
      // apply to it, but "the write reported 200 and changed nothing" is not a failure mode
      // worth leaving detectable in only one of the two callers.
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
  } catch (err) {
    return { ok: false, unreachable: true, detail: String(err) };
  }
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status} ${await res.text().catch(() => '')}` };
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, detail: 'update affected no rows' };
  return { ok: true };
}

/**
 * The unattended half of EX-130. Schedules and DSM thresholds are held in memory and refreshed
 * periodically, so this daemon keeps evaluating through an internet outage — it simply could
 * not RECORD, and record-then-act therefore skipped every command. A scheduled lights-off
 * silently not happening is a real cost in a building, and it was inconsistent with the manual
 * path, which is the asymmetry auditedDispatch's own docblock exists to prevent.
 *
 * Same rules as the proxy: a refusal still refuses, only an outage is buffered, and nothing
 * moves without a durable record first.
 */
const audit = createBufferedAudit({
  bufferPath: COMMAND_BUFFER_PATH,
  insert: insertAuditRemote,
  update: updateAuditRemote,
});

async function fire(cmd, reasonNote) {
  const device = DEVICE_REGISTRY.find((d) => d.id === cmd.device_id);
  if (!device) return;

  const why = reasonNote ?? 'schedule due';
  // Record-then-act, via the same helper proxy.mjs uses. This function used to dispatch
  // first and merely console.error a failed audit insert, so an unattended scheduled or
  // auto-shed command could move a real relay with nothing in the audit trail — on the one
  // path where the trail is the only record that anything happened at all.
  const result = await auditedDispatch({
    device,
    cmd,
    note: HARDWARE_DISPATCH_ENABLED ? why : `${why}; hardware dispatch closed`,
    auditRow: {
      device_id: cmd.device_id,
      socket: cmd.socket,
      action: cmd.action,
      requested_by: cmd.requested_by,
      source: cmd.source,
      // phase36. `target` resolves to the literal 'AC_POWER' for an aircon, so without this a
      // setpoint change has no field saying which setpoint — and for a loop writing dozens of
      // rows a day that is the whole content of the row. Sent unconditionally: on a database
      // that lacks the column PostgREST refuses the insert, `auditedDispatch` refuses to
      // dispatch what it could not record, and the loop is inert and loud. That is the correct
      // failure direction, and it is why this is NOT covered by the drop-the-column retry.
      ...(cmd.target_c === undefined ? {} : { target_c: cmd.target_c }),
    },
    dispatchEnabled: HARDWARE_DISPATCH_ENABLED,
    dispatchClasses: DISPATCH_CLASSES,
    // No `cloud` opt: scheduled and auto-shed commands have always been local-only in practice,
    // because this daemon never built a vendor client. The policy is passed anyway so the
    // failure detail says WHY there was no fallback, rather than leaving the reader to infer it
    // from a missing credential.
    dispatch: (d, c) => dispatchCommand(d, c, { bridgeHost: BRIDGE_HOST, bridgePort: BRIDGE_PORT, lightApiToken: LIGHT_API_TOKEN, policy: SITE.policy?.dispatch ?? 'local-first' }),
    insertAudit: audit.insertAudit,
    updateAudit: audit.updateAudit,
    log: (msg) => console.error(`[ibems-scheduler] ${msg}`),
  });

  if (result.auditFailure) {
    console.error(`[ibems-scheduler] ${cmd.device_id} NOT fired — could not record the command: ${result.auditFailure}`);
    // `false`, not undefined: the aircon loop must not stamp a step it did not take.
    return false;
  }
  console.log(`[ibems-scheduler] ${cmd.device_id} -> ${cmd.action} (${result.status})`);
  return true;
}

async function tick() {
  const now = new Date();
  const minute = `${now.toDateString()} ${now.getHours()}:${now.getMinutes()}`;
  if (minute === lastFiredMinute) return;
  lastFiredMinute = minute;

  /**
   * The fan-out used to happen HERE, as `due.flatMap(fanOutCommand)`. It moved inside
   * `resolveDue` because the ORDER matters and a caller must not be able to get it wrong:
   * match -> fan out -> collapse per (device_id, socket). Collapsing before the expansion
   * leaves a legacy `socket: null` outlet row and its two migrated siblings as three distinct
   * keys, which then expand into four dispatches for two relays — idempotent at the relay, but
   * it lies in the audit trail and doubles traffic to a fleet whose inbound socket-table
   * exhaustion is a documented fault. See `resolveDue`'s docblock and its two regression tests.
   *
   * Each socket still gets its own `fire()`, so each gets its own audit row and a partial
   * failure reads as one socket dispatched and one failed rather than as one ambiguous result.
   */
  const due = resolveDue(schedules, now, { dispatchableDeviceIds: DISPATCHABLE_DEVICE_IDS, deviceById: DEVICE_BY_ID });
  for (const cmd of due) {
    try {
      await fire(cmd, cmd.schedule_id ? `schedule ${cmd.schedule_id} due` : 'schedule due');
    } catch (err) {
      console.error(`[ibems-scheduler] error firing ${cmd.device_id}:`, String(err));
    }
  }
}

/** Runs every loop rather than once a minute: an overload should not have to wait out the rest
 * of a minute. Naturally self-limiting — planShed only ever targets devices that are currently
 * on, so each pass sheds strictly less than the last until the breach clears. */
async function shedTick() {
  if (!thresholds.autoShed && thresholds.maxPhaseA === null && thresholds.maxTotalKw === null) return;

  let latest;
  try {
    latest = await fetchLatest();
  } catch (err) {
    console.error('[ibems-scheduler] could not read totals for load shedding:', String(err));
    return;
  }

  const plan = planShed({
    thresholds,
    totals: latest.totals,
    devices: DEVICE_REGISTRY,
    configs: shedGroups,
    socketConfigs: socketShedGroups,
    readings: latest.readings,
    dispatchableDeviceIds: DISPATCHABLE_DEVICE_IDS,
    actorUserId: shedActor,
  });

  if (plan.breached && plan.shed.length === 0) {
    // Over the limit and doing nothing about it is a state an operator needs to be able to
    // see, whether the cause is auto-shed being off, nobody on record as having enabled it,
    // or nothing left that is allowed to be shed.
    console.warn(`[ibems-scheduler] DSM breach, no action taken: ${plan.reason}`);
    return;
  }
  if (plan.shed.length === 0) return;

  console.warn(`[ibems-scheduler] DSM breach — shedding ${plan.tier}: ${plan.reason}`);
  // Same fan-out as the schedule path above, and this is the half that mattered more: every one
  // of the seven outlets sits in shed tier group_2 or group_3, together 61% of metered demand.
  // With `socket: null` the whole escalation ladder below the lighting tier was refusals.
  // NO `fanOutCommand` HERE ANY MORE. Since RM-060 `planShed` enumerates targets per socket and
  // every command it emits already names one, so expanding again would be a no-op today and a
  // second place that can double a target tomorrow. The scheduling path lost its own copy for
  // exactly the same reason; the expansion now happens in precisely one place per path.
  for (const cmd of plan.shed) {
    try {
      await fire(cmd, `auto-shed ${plan.tier}: ${plan.reason}`);
    } catch (err) {
      console.error(`[ibems-scheduler] error shedding ${cmd.device_id}:`, String(err));
    }
  }
}

/**
 * The closed-loop aircon pass — RM-062.
 *
 * Runs inside this daemon rather than as a second service, and that is a decision rather than
 * convenience. This process already polls `/api/readings/latest` every cycle, already owns its
 * own audit buffer (one file per writer is non-negotiable — see the note on
 * SCHEDULER_AUDIT_BUFFER_PATH), and already wires `auditedDispatch`. Decisively: the controller
 * and the schedule loop INTERACT — a schedule that switches the ACU off must stop the loop
 * stepping — and in one process that is a variable, while across two it is a race with no way to
 * order it. A second systemd unit is also one more thing that is silently not enabled after a
 * rebuild.
 *
 * Its own try/catch at the call site, like `shedTick`, so a fault here cannot take the schedule
 * loop down with it.
 */
async function acuTick() {
  if (acuRules.length === 0) return;

  let latest;
  try {
    latest = await fetchLatest();
  } catch (err) {
    console.error('[ibems-scheduler] could not read latest for the aircon loop:', String(err));
    return;
  }

  const now = new Date();
  const plan = planSetpoint({
    rules: acuRules,
    readings: latest.readings,
    now,
    state: acuState,
    policy: SITE.policy,
    deviceById: DEVICE_BY_ID,
    dispatchableDeviceIds: DISPATCHABLE_DEVICE_IDS,
    recentCommands: acuRecentCommands,
  });

  // An observed setpoint that is not the one we commanded is ADOPTED as the new base rather than
  // stepped from — otherwise the next step moves the room from a number that is no longer true.
  for (const h of plan.holds) {
    if (h.reason === 'setpoint_changed_externally') {
      const observed = Number(String(h.detail).match(/observed (\d+)/)?.[1]);
      if (Number.isFinite(observed)) await writeAcuState(h.rule_id, { commanded_c: observed, last_step_at: now.toISOString(), last_direction: null });
    }
  }

  for (const alert of plan.alerts) {
    // Edge-triggered by the planner, so this fires once per transition rather than every tick.
    if (alert.transition === 'raised') console.warn(`[ibems-scheduler] acu loop alert: ${alert.message}`);
    else console.log(`[ibems-scheduler] acu loop alert cleared: ${alert.kind} (rule ${alert.rule_id})`);
    await writeAcuState(alert.rule_id, {
      alert_kind: alert.transition === 'raised' ? alert.kind : null,
      alert_since: alert.transition === 'raised' ? now.toISOString() : null,
    });
    if (alert.transition === 'raised') notify(alert.message);
  }

  for (const action of plan.actions) {
    try {
      const result = await fire(
        { device_id: action.device_id, socket: null, action: 'on', target_c: action.target_c, requested_by: action.requested_by, source: 'acu_loop' },
        `acu loop rule ${action.rule_id}: room ${action.room_c}C vs target — setpoint ${action.from_c}->${action.target_c}C`,
      );
      // Recorded ONLY when the command was really accepted. Stamping `last_step_at` for a step
      // that never dispatched would rate-limit the retry of a step that never happened.
      if (result !== false) {
        await writeAcuState(action.rule_id, {
          commanded_c: action.target_c,
          last_step_at: now.toISOString(),
          last_direction: action.direction,
          last_reason: null,
          last_evaluated_at: now.toISOString(),
        });
      }
    } catch (err) {
      console.error(`[ibems-scheduler] error stepping ${action.device_id}:`, String(err));
    }
  }

  // Why each idle rule is idle, so "configured and nothing is happening" is never
  // indistinguishable from a bug. Written through, not logged per tick.
  for (const h of plan.holds) {
    if (acuState[h.rule_id]?.last_reason === h.reason) continue;
    await writeAcuState(h.rule_id, { last_reason: h.reason, last_evaluated_at: now.toISOString() });
  }
}

async function main() {
  console.log(
    `[ibems-scheduler] starting — dispatch=${HARDWARE_DISPATCH_ENABLED ? 'OPEN' : 'closed'} ` +
      `schedulable=${DISPATCHABLE_DEVICE_IDS.length} device(s) refresh=${REFRESH_MS}ms tick=${TICK_MS}ms`,
  );
  try {
    await refreshSchedules();
    await refreshDsmConfig();
    await refreshAcuRules();
    const tiered = Object.values(shedGroups).filter((g) => g && g !== 'never').length;
    console.log(
      `[ibems-scheduler] loaded ${schedules.length} schedule row(s); auto-shed ${thresholds.autoShed ? 'ON' : 'off'}, ` +
        `${tiered} device(s) assigned a shed tier`,
    );
  } catch (err) {
    console.error('[ibems-scheduler] initial schedule load failed (will retry):', String(err));
  }

  setInterval(() => {
    refreshSchedules().catch((err) => console.error('[ibems-scheduler] schedule refresh failed:', String(err)));
    refreshDsmConfig().catch((err) => console.error('[ibems-scheduler] DSM config refresh failed:', String(err)));
    refreshAcuRules().catch((err) => console.error('[ibems-scheduler] acu rule refresh failed:', String(err)));
  }, REFRESH_MS);

  // Checked every 15s rather than once a minute so a schedule is never missed because the
  // process started mid-minute or a tick ran long; `lastFiredMinute` keeps it to once each.
  let announcedFirstCycle = false;
  const loop = async () => {
    if (stopping) return;
    try {
      await tick();
      await shedTick();
      await acuTick();
    } catch (err) {
      console.error('[ibems-scheduler] tick error:', String(err));
    }
    // Once, on the first completed cycle. "Started" and "actually running its loop" are
    // different claims, and only the second one means a due schedule would have fired — so
    // this is the line to look for on the Pi when a schedule did not happen. It is also the
    // only load-independent way to assert that a cycle ran and did NOTHING: waiting a fixed
    // number of milliseconds and hoping is what made these tests fail on a busy Pi.
    if (!announcedFirstCycle) {
      announcedFirstCycle = true;
      console.log('[ibems-scheduler] first cycle complete');
    }
    if (!stopping) setTimeout(loop, TICK_MS);
  };
  loop();
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[ibems-scheduler] received ${sig}, shutting down`);
    stopping = true;
    process.exit(0);
  });
}

main();
