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
 * SCOPE — lights only, deliberately. `dispatchLightCommand` is the only real dispatch path
 * that exists; outlets and the ACU are still switched by Node-RED's own schedules. Emitting
 * commands for them would write `dry_run` audit rows for switching that really happened,
 * which is worse than not recording it. They move over when their dispatch path is built.
 *
 * It also runs automatic load shedding, for the same reason and through the same path:
 * when the building goes over a configured limit and auto-shed is on, it switches off the
 * lowest tier of devices an operator marked as sheddable. Shed only, never restore — see
 * shedPlan.mjs for why that asymmetry is deliberate.
 *
 *     node server/scheduler.mjs
 */

import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { dueCommands } from './schedulePlan.mjs';
import { planShed } from './shedPlan.mjs';
import { dispatchLightCommand } from './dispatchLight.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BRIDGE_HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT) || 1880;
const HARDWARE_DISPATCH_ENABLED = process.env.HARDWARE_DISPATCH_ENABLED === 'true';
const LIGHT_API_TOKEN = process.env.LIGHT_API_TOKEN || null;
const REFRESH_MS = Number(process.env.SCHEDULE_REFRESH_MS) || 60_000;

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

/** Only devices with a real dispatch path — see the SCOPE note in this file's header. */
const DISPATCHABLE_DEVICE_IDS = DEVICE_REGISTRY.filter((d) => d.class === 'switch').map((d) => d.id);

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
let stopping = false;
/** Guards against firing the same minute twice if a tick runs long or the clock jitters. */
let lastFiredMinute = null;

async function refreshSchedules() {
  const res = await sb('schedules?select=device_id,socket,rule,enabled,updated_by&socket=is.null');
  if (!res.ok) throw new Error(`schedules fetch failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  schedules = await res.json();
}

/** DSM limits plus each device's shed tier. Both are operator configuration, re-read on the
 * same cadence as schedules so a change made in the app takes effect without a restart. */
async function refreshDsmConfig() {
  const [tRes, cRes] = await Promise.all([
    sb('dsm_thresholds?select=max_phase_current,max_total_kw,auto_shed,updated_by&id=eq.1'),
    sb('device_config?select=device_id,load_shed_group'),
  ]);
  if (!tRes.ok) throw new Error(`dsm_thresholds fetch failed: HTTP ${tRes.status}`);
  if (!cRes.ok) throw new Error(`device_config fetch failed: HTTP ${cRes.status}`);
  const row = (await tRes.json())[0] ?? {};
  thresholds = {
    maxPhaseA: row.max_phase_current ?? null,
    maxTotalKw: row.max_total_kw ?? null,
    autoShed: row.auto_shed === true,
  };
  shedActor = row.updated_by ?? null;
  shedGroups = Object.fromEntries((await cRes.json()).map((r) => [r.device_id, r.load_shed_group ?? null]));
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

async function recordCommand(cmd, status, note) {
  const res = await sb('commands', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      device_id: cmd.device_id,
      socket: cmd.socket,
      action: cmd.action,
      target: null,
      requested_by: cmd.requested_by,
      accepted_at: new Date().toISOString(),
      confirmed: false,
      confirmation: 'none',
      note,
      status,
      source: cmd.source,
    }),
  });
  if (!res.ok) console.error(`[ibems-scheduler] audit insert failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
}

async function fire(cmd, reasonNote) {
  const device = DEVICE_REGISTRY.find((d) => d.id === cmd.device_id);
  if (!device) return;

  const why = reasonNote ?? 'schedule due';
  let status = 'dry_run';
  let note = `${why}; hardware dispatch closed`;
  if (HARDWARE_DISPATCH_ENABLED) {
    const result = await dispatchLightCommand(device, cmd, { bridgeHost: BRIDGE_HOST, bridgePort: BRIDGE_PORT, lightApiToken: LIGHT_API_TOKEN });
    status = result.ok ? 'dispatched' : 'failed';
    note = result.ok ? why : `${why}; dispatch failed: ${result.detail}`;
    if (!result.ok) console.error(`[ibems-scheduler] dispatch failed for ${cmd.device_id}: ${result.detail}`);
  }
  // Recorded whether it reached hardware or not — an attempted-and-failed scheduled switch is
  // exactly what an audit trail exists to capture.
  await recordCommand(cmd, status, note);
  console.log(`[ibems-scheduler] ${cmd.device_id} -> ${cmd.action} (${status})`);
}

async function tick() {
  const now = new Date();
  const minute = `${now.toDateString()} ${now.getHours()}:${now.getMinutes()}`;
  if (minute === lastFiredMinute) return;
  lastFiredMinute = minute;

  const due = dueCommands(schedules, now, { dispatchableDeviceIds: DISPATCHABLE_DEVICE_IDS });
  for (const cmd of due) {
    try {
      await fire(cmd);
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
    configs: shedGroups,
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
  for (const cmd of plan.shed) {
    try {
      await fire(cmd, `auto-shed ${plan.tier}: ${plan.reason}`);
    } catch (err) {
      console.error(`[ibems-scheduler] error shedding ${cmd.device_id}:`, String(err));
    }
  }
}

async function main() {
  console.log(
    `[ibems-scheduler] starting — dispatch=${HARDWARE_DISPATCH_ENABLED ? 'OPEN' : 'closed'} ` +
      `schedulable=${DISPATCHABLE_DEVICE_IDS.length} device(s) refresh=${REFRESH_MS}ms`,
  );
  try {
    await refreshSchedules();
    await refreshDsmConfig();
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
  }, REFRESH_MS);

  // Checked every 15s rather than once a minute so a schedule is never missed because the
  // process started mid-minute or a tick ran long; `lastFiredMinute` keeps it to once each.
  const loop = async () => {
    if (stopping) return;
    try {
      await tick();
      await shedTick();
    } catch (err) {
      console.error('[ibems-scheduler] tick error:', String(err));
    }
    if (!stopping) setTimeout(loop, 15_000);
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
