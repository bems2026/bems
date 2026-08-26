import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { readBuffer } from './ingestBuffer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEDULER = join(HERE, 'scheduler.mjs');
let nextPort = 21400;

/**
 * Minimal Supabase REST stand-in: serves one schedules row and collects command inserts.
 *
 * Commands are recorded and then MUTATED by the daemon's follow-up PATCH, because
 * auditedDispatch writes the row before dispatching (status 'dispatching') and attaches the
 * outcome afterwards. Applying the patch here means `state.commands[0].status` reads the
 * row's final state — a strictly stronger assertion than before, since it now proves the
 * whole record -> dispatch -> record-outcome sequence rather than just the opening insert.
 */
function startFakeSupabase(scheduleRow, dsm = { max_phase_current: null, max_total_kw: null, auto_shed: false, updated_by: null }, deviceConfig = [], failCommandInsert = false, dropCommandWrites = false) {
  return new Promise((resolve) => {
    const port = nextPort++;
    const state = { commands: [] };
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      if (req.url.startsWith('/rest/v1/schedules')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(scheduleRow ? [scheduleRow] : []));
      }
      if (req.url.startsWith('/rest/v1/dsm_thresholds')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([dsm]));
      }
      if (req.url.startsWith('/rest/v1/device_config')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(deviceConfig));
      }
      if (req.url.startsWith('/rest/v1/commands')) {
        // An OUTAGE, not a refusal: hang up the socket so `fetch` throws with no status at
        // all. Distinct from failCommandInsert's 503, which is Supabase answering, and the
        // difference decides whether the command may be buffered or must be refused.
        // Scoped to the commands routes so schedules and thresholds still load — a daemon
        // that never got its config would not reach the interesting code path.
        if (dropCommandWrites) return req.socket.destroy();
      }
      if (req.url.startsWith('/rest/v1/commands') && req.method === 'POST') {
        if (failCommandInsert) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end('{"message":"service unavailable"}');
        }
        const row = { id: `cmd-${state.commands.length + 1}`, ...JSON.parse(raw) };
        state.commands.push(row);
        // The daemon asks for `Prefer: return=representation` so it gets an id back to
        // PATCH; returning nothing here would leave it unable to record the outcome.
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([row]));
      }
      if (req.url.startsWith('/rest/v1/commands') && req.method === 'PATCH') {
        const id = decodeURIComponent((req.url.match(/id=eq\.([^&]+)/) ?? [])[1] ?? '');
        const row = state.commands.find((c) => c.id === id);
        if (row) Object.assign(row, JSON.parse(raw));
        // Real PostgREST shape for `Prefer: return=representation`: the updated rows, or an
        // empty array when nothing matched. fire() reads that count, so a fake that always
        // returned 204 would let a silently-failing update pass as healthy.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(row ? [row] : []));
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(port, () => resolve({ url: `http://127.0.0.1:${port}`, state, close: () => server.close() }));
  });
}

function startFakeLight(latest = []) {
  return new Promise((resolve) => {
    const port = nextPort++;
    const state = { requests: [], latest: [] };
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      // Same host/port serves the bridge's readings endpoint in production, so the fake has to
      // answer both or the daemon's shed pass can never run.
      if (req.url.startsWith('/api/readings/latest')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(state.latest));
      }
      state.requests.push({ url: req.url, body: raw ? JSON.parse(raw) : null, token: req.headers['x-auth-token'] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    state.latest = latest;
    server.listen(port, () => resolve({ port, state, close: () => server.close() }));
  });
}

/**
 * Blocks until enough of the current wall-clock minute remains for a due-now schedule to
 * survive it.
 *
 * `dueNowRow` pins the schedule to the minute the ROW is built in, while the daemon decides
 * due-ness from the minute its own tick runs in. Build the row at HH:MM:59 on a loaded Pi and
 * the daemon ticks in HH:MM+1 — the schedule is no longer due and the test fails for a reason
 * that has nothing to do with the code under test.
 */
async function waitForRoomInMinute(needMs = 15_000) {
  const msLeft = 60_000 - (Date.now() % 60_000);
  if (msLeft < needMs) await new Promise((r) => setTimeout(r, msLeft + 250));
}

/** A schedule whose `on` time is the minute the test runs in, so it is due immediately. */
function dueNowRow(over = {}) {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const days = new Array(7).fill('0');
  days[(now.getDay() + 6) % 7] = '1';
  return { device_id: 'l1', socket: null, rule: { on: hhmm, days: days.join('') }, enabled: true, updated_by: '11111111-1111-1111-1111-111111111111', ...over };
}

/**
 * Spawns the daemon and waits for an OUTCOME, not for a duration.
 *
 * WHY NOT A FIXED SLEEP: every test here used to spawn a real process, sleep 2500 ms, kill it
 * and assert. That passes on an idle machine and fails on a busy one — measured 2026-08-26,
 * roughly one full-suite run in two failed on the Pi under load, a different test each time,
 * never one outside this file (RM-025). Lengthening the sleep only moves the load at which it
 * breaks, and slows every run to pay for the worst case.
 *
 * So: poll for the condition the test actually cares about and stop the moment it holds. A
 * test that expects nothing to happen waits instead for `first cycle complete`, which the
 * daemon logs once it has genuinely run a tick — the only load-independent way to distinguish
 * "it did nothing" from "it had not got round to it yet".
 *
 * `timeoutMs` is generous on purpose: it is a failure ceiling, never a wait. The fast path
 * returns in tens of milliseconds.
 */
const CYCLE_DONE = /first cycle complete/;

async function run(env, scheduleRow, until = CYCLE_DONE, opts = {}) {
  const sb = await startFakeSupabase(scheduleRow, opts.dsm, opts.deviceConfig, opts.failCommandInsert, opts.dropCommandWrites);
  const light = await startFakeLight(opts.latest);
  const child = spawn(process.execPath, [SCHEDULER], {
    env: {
      ...process.env,
      SUPABASE_URL: sb.url,
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      BRIDGE_HOST: '127.0.0.1',
      BRIDGE_PORT: String(light.port),
      // ALWAYS redirected, never left at the default. A test that buffers a command row to
      // `server/data/` writes into the REAL outage queue, and `ingest.mjs` would then upload
      // a fabricated command into the production audit trail. That is not hypothetical: it
      // happened while this test file was being written, and `run()` closing the fake
      // Supabase mid-command is enough to trigger it, because a socket dying mid-request is
      // exactly the outage condition that buffers.
      SCHEDULER_AUDIT_BUFFER_PATH: join(fs.mkdtempSync(join(os.tmpdir(), 'ibems-sched-buf-')), 'audit.ndjson'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c.toString(); });
  child.stderr.on('data', (c) => { out += c.toString(); });

  const snapshot = () => ({ commands: sb.state.commands, lightRequests: light.state.requests, out });
  const holds = () => {
    const s = snapshot();
    return until instanceof RegExp ? until.test(s.out) : until(s);
  };

  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  while (Date.now() < deadline && !holds()) {
    await new Promise((r) => setTimeout(r, 50));
  }
  // Settle briefly so a follow-up write (the outcome PATCH after an insert) lands before the
  // process is killed. Bounded and small: the condition above has already happened.
  await new Promise((r) => setTimeout(r, opts.settleMs ?? 250));

  const result = snapshot();
  child.kill();
  sb.close();
  light.close();
  if (!holds() && !opts.allowTimeout) {
    throw new Error(`scheduler did not reach the expected state within ${opts.timeoutMs ?? 30_000}ms.\nDaemon output:\n${result.out}`);
  }
  return result;
}

test('with the gate closed a due schedule is audited as dry_run and never reaches the light', async () => {
  await waitForRoomInMinute();
  const r = await run({}, dueNowRow(), (s) => s.commands.length >= 1 && s.commands[0].status);
  assert.equal(r.lightRequests.length, 0, 'nothing may reach the hardware endpoint');
  assert.equal(r.commands.length, 1, 'but it must still be recorded');
  assert.equal(r.commands[0].status, 'dry_run');
  assert.equal(r.commands[0].source, 'schedule');
  assert.equal(r.commands[0].device_id, 'l1');
  assert.equal(r.commands[0].action, 'on');
});

test('the audit row is attributed to whoever saved the schedule', async () => {
  await waitForRoomInMinute();
  const r = await run({}, dueNowRow(), (s) => s.commands.length >= 1);
  assert.equal(r.commands[0].requested_by, '11111111-1111-1111-1111-111111111111');
});

test('with the gate open the command really reaches the light endpoint and is audited as dispatched', async () => {
  await waitForRoomInMinute();
  const r = await run({ HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-token' }, dueNowRow(),
    (s) => s.lightRequests.length >= 1 && s.commands[0]?.status === 'dispatched');
  assert.equal(r.lightRequests.length, 1);
  assert.equal(r.lightRequests[0].url, '/light/1');
  assert.deepEqual(r.lightRequests[0].body, { state: true });
  assert.equal(r.lightRequests[0].token, 'test-token');
  assert.equal(r.commands[0].status, 'dispatched');
});

test('a schedule that is not due fires nothing at all', async () => {
  const r = await run({}, dueNowRow({ rule: { on: '03:17', days: '1111111' } }), CYCLE_DONE);
  assert.equal(r.commands.length, 0);
  assert.equal(r.lightRequests.length, 0);
});

test('a disarmed schedule fires nothing', async () => {
  const r = await run({}, dueNowRow({ enabled: false }), CYCLE_DONE);
  assert.equal(r.commands.length, 0);
});

test('an outlet schedule now fires too, routed to its wire target rather than a light id', async () => {
  // This previously asserted the opposite: outlets were skipped because they had no dispatch
  // path, and a dry_run row would have misreported a switch Node-RED really performed. The
  // flow has a /outlet/<target> endpoint now, so they are genuinely covered.
  await waitForRoomInMinute();
  const r = await run({ HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-token' }, dueNowRow({ device_id: 'co1', socket: 1 }),
    (s) => s.lightRequests.length >= 1 && s.commands[0]?.status === 'dispatched');
  assert.equal(r.commands.length, 1);
  assert.equal(r.commands[0].device_id, 'co1');
  assert.equal(r.commands[0].status, 'dispatched');
  assert.equal(r.lightRequests[0].url, '/outlet/CO1_1');
});

test('refuses to start with the gate open and no light token', async () => {
  const r = await run({ HARDWARE_DISPATCH_ENABLED: 'true' }, dueNowRow(), /refusing to start/i);
  assert.match(r.out, /refusing to start/i);
  assert.equal(r.lightRequests.length, 0);
});

test('does not fire the same minute twice, even though it checks more often than once a minute', async () => {
  // This ran ONE tick before: the loop waits 15s between iterations and the test waited 4s, so
  // the guard it is named after was never exercised. Driving the loop at 120ms and waiting for
  // a dozen cycles makes the assertion mean what it says — and finishes sooner than the old
  // version did.
  await waitForRoomInMinute();
  const seenCycles = (s) => (s.out.match(/first cycle complete/g) || []).length;
  const r = await run({ SCHEDULE_TICK_MS: '120' }, dueNowRow(),
    (s) => s.commands.length >= 1 && seenCycles(s) >= 1 && s.out.length > 0, { settleMs: 2000 });
  assert.equal(r.commands.length, 1, 'a second tick in the same minute must not fire again');
});


// ---------------------------------------------------------------------------
// Automatic load shedding.
//
// The decision maths is exhaustively covered in shedPlan.test.mjs; these check that the
// daemon feeds it the right inputs and acts on the result through the same gate and audit
// trail as everything else.
// ---------------------------------------------------------------------------

const OVER = [
  { device_id: '_totals', total_power_w: 9000, phase_current: { red: 3, yellow: 4, blue: null } },
  { device_id: 'l1', state: 'on' },
  { device_id: 'l2', state: 'on' },
];
const UNDER = [
  { device_id: '_totals', total_power_w: 500, phase_current: { red: 1, yellow: 1, blue: null } },
  { device_id: 'l1', state: 'on' },
];
const SHED_USER = '33333333-3333-3333-3333-333333333333';
const dsmOn = { max_phase_current: null, max_total_kw: 5, auto_shed: true, updated_by: SHED_USER };

test('sheds the first tier when the building goes over its limit, audited as dry_run while the gate is closed', async () => {
  const r = await run({}, null, (s) => s.commands.some((c) => c.source === 'dsm_autoshed' && c.status), {
    dsm: dsmOn,
    deviceConfig: [{ device_id: 'l1', load_shed_group: 'group_1' }, { device_id: 'l2', load_shed_group: 'group_2' }],
    latest: OVER,
  });
  const shed = r.commands.filter((c) => c.source === 'dsm_autoshed');
  assert.ok(shed.length >= 1, 'expected a shed command');
  assert.equal(shed[0].device_id, 'l1', 'group_1 sheds before group_2');
  assert.equal(shed[0].action, 'off');
  assert.equal(shed[0].status, 'dry_run');
  assert.equal(shed[0].requested_by, SHED_USER);
  assert.match(shed[0].note, /auto-shed group_1/);
  assert.equal(r.lightRequests.length, 0, 'the gate is closed, so nothing may reach hardware');
});

test('sheds for real through the light endpoint once the gate is open', async () => {
  const r = await run({ HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-token' }, null,
    (s) => s.lightRequests.length >= 1 && s.commands.some((c) => c.source === 'dsm_autoshed' && c.status === 'dispatched'), {
    dsm: dsmOn,
    deviceConfig: [{ device_id: 'l1', load_shed_group: 'group_1' }],
    latest: OVER,
  });
  assert.ok(r.lightRequests.length >= 1);
  assert.deepEqual(r.lightRequests[0].body, { state: false }, 'shedding means off');
  assert.equal(r.commands.find((c) => c.source === 'dsm_autoshed').status, 'dispatched');
});

test('sheds nothing while the building is under its limit', async () => {
  const r = await run({}, null, CYCLE_DONE, {
    dsm: dsmOn,
    deviceConfig: [{ device_id: 'l1', load_shed_group: 'group_1' }],
    latest: UNDER,
  });
  assert.equal(r.commands.filter((c) => c.source === 'dsm_autoshed').length, 0);
});

test('sheds nothing when auto-shed is switched off, even while over the limit', async () => {
  const r = await run({}, null, /breach, no action taken/i, {
    dsm: { ...dsmOn, auto_shed: false },
    deviceConfig: [{ device_id: 'l1', load_shed_group: 'group_1' }],
    latest: OVER,
  });
  assert.equal(r.commands.filter((c) => c.source === 'dsm_autoshed').length, 0);
  assert.match(r.out, /breach, no action taken/i);
});

test('never sheds a Protected device', async () => {
  const r = await run({}, null, CYCLE_DONE, {
    dsm: dsmOn,
    deviceConfig: [{ device_id: 'l1', load_shed_group: 'never' }],
    latest: OVER,
  });
  assert.equal(r.commands.filter((c) => c.source === 'dsm_autoshed').length, 0);
});

test('never sheds a device with no tier assigned', async () => {
  const r = await run({}, null, CYCLE_DONE, {
    dsm: dsmOn,
    deviceConfig: [{ device_id: 'l1', load_shed_group: null }],
    latest: OVER,
  });
  assert.equal(r.commands.filter((c) => c.source === 'dsm_autoshed').length, 0);
});

test('sheds nothing when nobody is on record as having enabled it', async () => {
  const r = await run({}, null, CYCLE_DONE, {
    dsm: { ...dsmOn, updated_by: null },
    deviceConfig: [{ device_id: 'l1', load_shed_group: 'group_1' }],
    latest: OVER,
  });
  assert.equal(r.commands.filter((c) => c.source === 'dsm_autoshed').length, 0);
});

test('a due schedule is NOT dispatched when its audit row cannot be written', async () => {
  // The asymmetry this closes: fire() used to dispatch first and merely console.error a
  // failed audit insert, so an unattended scheduled command could move a real relay with
  // nothing in the audit trail. proxy.mjs already refused to proceed without a row; the
  // scheduler now refuses the same way, through the same shared helper.
  await waitForRoomInMinute();
  const r = await run(
    { HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-token' },
    dueNowRow(),
    /NOT fired — could not record the command/,
    { failCommandInsert: true }
  );

  assert.equal(r.lightRequests.length, 0, 'nothing may reach the hardware endpoint without an audit row');
  assert.match(r.out, /NOT fired — could not record the command/);
});

test('the audit row is opened before dispatch, so an interrupted command still leaves a trace', async () => {
  // Even in the happy path the row must exist BEFORE the light is touched. Asserting the
  // final status alone could not tell record-first from record-after.
  await waitForRoomInMinute();
  const r = await run(
    { HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-token' },
    dueNowRow(),
    (s) => s.lightRequests.length >= 1 && s.commands[0]?.status === 'dispatched',
  );
  assert.equal(r.commands.length, 1);
  assert.equal(r.commands[0].status, 'dispatched', 'the outcome is attached after dispatch');
  assert.equal(r.lightRequests.length, 1);
});

test('a due schedule STILL fires when Supabase is unreachable, recorded to the local buffer', async () => {
  // The unattended half of EX-130. Schedules live in memory and are refreshed periodically, so
  // this daemon keeps evaluating right through an internet outage — it simply could not
  // RECORD, and record-then-act therefore skipped every command. A scheduled lights-off
  // silently not happening is a real cost in a building, and it left the two callers of
  // auditedDispatch behaving differently in an outage, which is the asymmetry that helper's
  // own docblock exists to prevent.
  //
  // Note the contrast with the test above: that one returns 503 and must still REFUSE, because
  // a status code is Supabase answering. This one hangs up the socket, which is an outage.
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ibems-sched-'));
  const bufferPath = join(dir, 'scheduler-audit.ndjson');
  await waitForRoomInMinute();
  const r = await run(
    {
      HARDWARE_DISPATCH_ENABLED: 'true',
      LIGHT_API_TOKEN: 'test-token',
      SCHEDULER_AUDIT_BUFFER_PATH: bufferPath,
    },
    dueNowRow(),
    (s) => s.lightRequests.length >= 1,
    { dropCommandWrites: true },
  );

  assert.equal(r.lightRequests.length, 1, 'the schedule must still reach the hardware');
  assert.equal(r.commands.length, 0, 'and Supabase must have received nothing, since it was down');

  const rows = readBuffer(bufferPath).map((e) => e.rows[0]);
  assert.equal(rows.length, 1, 'the command has to be recorded durably, or it must not fire');
  assert.equal(rows[0].device_id, dueNowRow().device_id);
  assert.equal(rows[0].status, 'dispatched', 'the outcome is amended into the buffered row');
});

test('the scheduler buffers to its OWN file, never the proxy\'s', async () => {
  // Both processes amend their entries after dispatch, which is a read-modify-write. Two
  // processes doing that to one file race: writeBuffer rewrites the whole thing, so a
  // concurrent reader can see a partial file and the loser silently discards the other's rows.
  // One file per writer removes the race rather than narrowing it.
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ibems-sched-'));
  const schedulerPath = join(dir, 'scheduler-audit.ndjson');
  const proxyPath = join(dir, 'proxy-audit.ndjson');
  await waitForRoomInMinute();
  await run(
    {
      HARDWARE_DISPATCH_ENABLED: 'true',
      LIGHT_API_TOKEN: 'test-token',
      SCHEDULER_AUDIT_BUFFER_PATH: schedulerPath,
      COMMAND_AUDIT_BUFFER_PATH: proxyPath,
    },
    dueNowRow(),
    (s) => s.lightRequests.length >= 1,
    { dropCommandWrites: true },
  );

  assert.equal(readBuffer(schedulerPath).length, 1);
  assert.equal(readBuffer(proxyPath).length, 0, "the proxy's buffer must be untouched");
});
