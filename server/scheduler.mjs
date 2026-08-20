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
 *     node server/scheduler.mjs
 */

import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { dueCommands } from './schedulePlan.mjs';
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
let stopping = false;
/** Guards against firing the same minute twice if a tick runs long or the clock jitters. */
let lastFiredMinute = null;

async function refreshSchedules() {
  const res = await sb('schedules?select=device_id,socket,rule,enabled,updated_by&socket=is.null');
  if (!res.ok) throw new Error(`schedules fetch failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  schedules = await res.json();
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

async function fire(cmd) {
  const device = DEVICE_REGISTRY.find((d) => d.id === cmd.device_id);
  if (!device) return;

  let status = 'dry_run';
  let note = 'schedule due; hardware dispatch closed';
  if (HARDWARE_DISPATCH_ENABLED) {
    const result = await dispatchLightCommand(device, cmd, { bridgeHost: BRIDGE_HOST, bridgePort: BRIDGE_PORT, lightApiToken: LIGHT_API_TOKEN });
    status = result.ok ? 'dispatched' : 'failed';
    note = result.ok ? 'schedule due' : `schedule due; dispatch failed: ${result.detail}`;
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

async function main() {
  console.log(
    `[ibems-scheduler] starting — dispatch=${HARDWARE_DISPATCH_ENABLED ? 'OPEN' : 'closed'} ` +
      `schedulable=${DISPATCHABLE_DEVICE_IDS.length} device(s) refresh=${REFRESH_MS}ms`,
  );
  try {
    await refreshSchedules();
    console.log(`[ibems-scheduler] loaded ${schedules.length} schedule row(s)`);
  } catch (err) {
    console.error('[ibems-scheduler] initial schedule load failed (will retry):', String(err));
  }

  setInterval(() => {
    refreshSchedules().catch((err) => console.error('[ibems-scheduler] schedule refresh failed:', String(err)));
  }, REFRESH_MS);

  // Checked every 15s rather than once a minute so a schedule is never missed because the
  // process started mid-minute or a tick ran long; `lastFiredMinute` keeps it to once each.
  const loop = async () => {
    if (stopping) return;
    try {
      await tick();
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
