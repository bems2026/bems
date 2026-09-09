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
function startFakeSupabase(scheduleRows, dsm = { max_phase_current: null, max_total_kw: null, auto_shed: false, updated_by: null }, deviceConfig = [], failCommandInsert = false, dropCommandWrites = false, socketConfig = null, acuRules = null, acuState = []) {
  return new Promise((resolve) => {
    const port = nextPort++;
    const state = { commands: [], acuStateWrites: [] };
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      if (req.url.startsWith('/rest/v1/schedules')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // RM-059: a device holds MANY rows, so this takes an array. A single row is still
        // accepted and wrapped, so the twenty-one tests written before stacking existed did
        // not all have to grow a pair of brackets to keep meaning what they meant.
        const rows = Array.isArray(scheduleRows) ? scheduleRows : scheduleRows ? [scheduleRows] : [];
        return res.end(JSON.stringify(rows));
      }
      if (req.url.startsWith('/rest/v1/dsm_thresholds')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([dsm]));
      }
      if (req.url.startsWith('/rest/v1/device_config')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(deviceConfig));
      }
      if (req.url.startsWith('/rest/v1/acu_rules')) {
        // `null` means the table does not exist — a deployment that has not applied phase36.
        // No rules is the right outcome there, and it must not be fatal.
        if (acuRules === null) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end('{"message":"relation does not exist"}');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(acuRules));
      }
      if (req.url.startsWith('/rest/v1/acu_loop_state')) {
        if (req.method === 'POST') {
          state.acuStateWrites.push(JSON.parse(raw));
          res.writeHead(201, { 'Content-Type': 'application/json' });
          return res.end('[]');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(acuState));
      }
      if (req.url.startsWith('/rest/v1/socket_config')) {
        // `null` means the table does not exist — a deployment that has not applied phase34.
        // The daemon must fall back to device-level tiers rather than stop shedding, so the
        // default here is deliberately the un-migrated case.
        if (socketConfig === null) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end('{"message":"relation \\"socket_config\\" does not exist"}');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(socketConfig));
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

/** The minute the test is running in, as the app stores it. */
function nowHhmm() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Today, as the app's 7-char Mon..Sun day mask. */
function todayMask() {
  const days = new Array(7).fill('0');
  days[(new Date().getDay() + 6) % 7] = '1';
  return days.join('');
}

/** A schedule whose `on` time is the minute the test runs in, so it is due immediately. */
function dueNowRow(over = {}) {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const days = new Array(7).fill('0');
  days[(now.getDay() + 6) % 7] = '1';
  // `id` is load-bearing since RM-059: the daemon puts it in the audit note so a firing can be
  // traced back to one rule out of a stack of five.
  return { id: 'sched-1', device_id: 'l1', socket: null, rule: { on: hhmm, days: days.join('') }, enabled: true, updated_by: '11111111-1111-1111-1111-111111111111', ...over };
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
  const sb = await startFakeSupabase(scheduleRow, opts.dsm, opts.deviceConfig, opts.failCommandInsert, opts.dropCommandWrites, opts.socketConfig ?? null, opts.acuRules ?? null, opts.acuState ?? []);
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

  const snapshot = () => ({ commands: sb.state.commands, lightRequests: light.state.requests, acuStateWrites: sb.state.acuStateWrites, out });
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

/**
 * THE SHAPE THE APPLICATION ACTUALLY PRODUCES, which the test above does not.
 *
 * The test above passes `socket: 1`. `dueNowRow`'s own default is `socket: null`, and null is what
 * the Automation page writes for EVERY schedule — `src/lib/supabaseConfig.ts` reads and writes
 * `.is('socket', null)` exclusively and has no socket concept at all. So that test asserted a
 * scenario the app cannot create: it was green while outlet scheduling was broken for all seven
 * outlets, and stayed green for as long as nobody scheduled a real one.
 *
 * Reported from the building 2026-09-07: Light Switch 7's schedule fired, Outlet 5's never did.
 * `socket: null` resolves to `state_key` for a switch and is refused `socket_required` for an
 * outlet.
 */
test('a device-level outlet schedule — what the UI writes — fans out to both sockets', async () => {
  await waitForRoomInMinute();
  const r = await run(
    { HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-token' },
    dueNowRow({ device_id: 'co1' }), // socket defaults to null, exactly as the UI writes it
    (s) => s.lightRequests.length >= 2 && s.commands.length >= 2,
  );
  assert.equal(r.commands.length, 2, 'one audit row per socket, not one ambiguous row per device');
  assert.deepEqual(r.commands.map((c) => c.socket).sort(), [1, 2]);
  for (const c of r.commands) assert.equal(c.status, 'dispatched');
  assert.deepEqual(
    r.lightRequests.map((q) => q.url).sort(),
    ['/outlet/CO1_1', '/outlet/CO1_2'],
    'both sockets must reach the wire',
  );
});

test('a device-level SWITCH schedule still fires exactly once — the case that already worked', async () => {
  // l7 is the control case: it passed all six of its tests on real hardware. The fan-out must not
  // touch it.
  await waitForRoomInMinute();
  const r = await run(
    { HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-token' },
    dueNowRow({ device_id: 'l7' }),
    (s) => s.lightRequests.length >= 1 && s.commands[0]?.status === 'dispatched',
  );
  assert.equal(r.commands.length, 1);
  assert.equal(r.lightRequests[0].url, '/light/7');
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

/* ===========================================================================
 * RM-059 — stackable, per-socket schedules, at daemon level.
 *
 * The pure resolution is covered exhaustively in `resolveDue.test.mjs`. These spawn the real
 * process, because the defect they guard against was never in the maths — it was in the
 * daemon fanning out a second time after the planner had already done it.
 * ======================================================================== */

const OPEN = { HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-token' };

test('two stacked rules colliding in one minute produce exactly ONE command, and it is off', async () => {
  await waitForRoomInMinute();
  const hhmm = nowHhmm();
  const days = todayMask();
  const stack = [
    dueNowRow({ id: 'a', rule: { on: hhmm, days } }),
    dueNowRow({ id: 'b', rule: { off: hhmm, days } }),
  ];
  const r = await run(OPEN, stack, (s) => s.commands.length >= 1 && s.commands[0].status);

  assert.equal(r.commands.length, 1, `one target, one command — got ${JSON.stringify(r.commands.map((c) => c.action))}`);
  assert.equal(r.commands[0].action, 'off', 'off fails safe, so off wins across rows as well as within one');
  assert.equal(r.lightRequests.length, 1);
  assert.deepEqual(r.lightRequests[0].body, { state: false });
});

test('a per-socket outlet schedule hits that socket and never the other one', async () => {
  await waitForRoomInMinute();
  const row = dueNowRow({ id: 's2', device_id: 'co5', socket: 2 });
  const r = await run(OPEN, [row], (s) => s.lightRequests.length >= 1);

  assert.equal(r.lightRequests.length, 1, 'one socket named, one relay touched');
  assert.equal(r.lightRequests[0].url, '/outlet/CO5_2');
  assert.equal(r.commands.length, 1);
  assert.equal(r.commands[0].socket, 2);
});

test('two per-socket rules on one outlet each get their own wire target and audit row', async () => {
  await waitForRoomInMinute();
  const hhmm = nowHhmm();
  const days = todayMask();
  const rows = [
    dueNowRow({ id: 's1', device_id: 'co5', socket: 1, rule: { on: hhmm, days } }),
    dueNowRow({ id: 's2', device_id: 'co5', socket: 2, rule: { off: hhmm, days } }),
  ];
  const r = await run(OPEN, rows, (s) => s.lightRequests.length >= 2);

  assert.deepEqual(r.lightRequests.map((q) => q.url).sort(), ['/outlet/CO5_1', '/outlet/CO5_2']);
  // The sockets genuinely move in opposite directions — the whole point of per-socket rules.
  const byUrl = Object.fromEntries(r.lightRequests.map((q) => [q.url, q.body]));
  assert.deepEqual(byUrl['/outlet/CO5_1'], { state: true });
  assert.deepEqual(byUrl['/outlet/CO5_2'], { state: false });
  assert.deepEqual(r.commands.map((c) => c.socket).sort(), [1, 2]);
});

test('REGRESSION: a legacy whole-outlet row beside its two migrated children fires TWICE, not four times', async () => {
  // The exact shape an interrupted phase33 migration, a restored backup, or a hand edit leaves
  // behind. Before the fan-out moved inside `resolveDue`, the daemon expanded the null row
  // AFTER any collapse and sent four commands to two relays: idempotent at the relay, but the
  // audit trail then claims four commands the operator never configured, and it doubles
  // traffic to a fleet whose inbound socket-table exhaustion is a documented fault.
  await waitForRoomInMinute();
  const hhmm = nowHhmm();
  const days = todayMask();
  const rows = [
    dueNowRow({ id: 'legacy', device_id: 'co5', socket: null, rule: { off: hhmm, days } }),
    dueNowRow({ id: 'child1', device_id: 'co5', socket: 1, rule: { off: hhmm, days } }),
    dueNowRow({ id: 'child2', device_id: 'co5', socket: 2, rule: { off: hhmm, days } }),
  ];
  const r = await run(OPEN, rows, (s) => s.lightRequests.length >= 2, { settleMs: 900 });

  assert.equal(r.lightRequests.length, 2, `two relays, two requests — got ${JSON.stringify(r.lightRequests.map((q) => q.url))}`);
  assert.equal(r.commands.length, 2, 'and two audit rows, not four');
  assert.deepEqual(r.commands.map((c) => c.socket).sort(), [1, 2]);
});

test('a legacy whole-outlet row on its own still fans out — code ahead of the migration must not go inert', async () => {
  await waitForRoomInMinute();
  const r = await run(OPEN, [dueNowRow({ id: 'legacy', device_id: 'co5', socket: null })], (s) => s.lightRequests.length >= 2);
  assert.deepEqual(r.lightRequests.map((q) => q.url).sort(), ['/outlet/CO5_1', '/outlet/CO5_2']);
});

test('one unattributed rule in a stack does not silence its sibling', async () => {
  await waitForRoomInMinute();
  const hhmm = nowHhmm();
  const days = todayMask();
  const rows = [
    dueNowRow({ id: 'dead', updated_by: null, rule: { on: hhmm, days } }),
    dueNowRow({ id: 'live', rule: { on: hhmm, days } }),
  ];
  const r = await run(OPEN, rows, (s) => s.lightRequests.length >= 1, { settleMs: 900 });

  assert.equal(r.commands.length, 1, 'exactly the attributed one');
  assert.equal(r.commands[0].requested_by, '11111111-1111-1111-1111-111111111111');
});

test('names the rule in the audit note, so a firing traces back to one rule out of five', async () => {
  await waitForRoomInMinute();
  const r = await run({}, [dueNowRow({ id: 'rule-xyz' })], (s) => s.commands.length >= 1 && s.commands[0].status);
  assert.match(r.commands[0].note, /rule-xyz/);
});

test('counts armed rules that can never fire, out loud, at every refresh', async () => {
  // In a stack, a dead rule is one of five rather than a whole device going quiet — so it needs
  // a voice. Two faults here: no attribution, and a socket the outlet does not have.
  const rows = [
    dueNowRow({ id: 'a', updated_by: null }),
    dueNowRow({ id: 'b', device_id: 'co5', socket: 3 }),
  ];
  const r = await run({}, rows, /can never fire/, { allowTimeout: true });
  assert.match(r.out, /2 armed rule\(s\) can never fire/);
  assert.match(r.out, /no_attribution=1/);
  assert.match(r.out, /socket_not_on_device=1/);
});

test('a rule that is no longer served stops firing — the in-memory list is replaced, not merged', async () => {
  // The delete path's daemon-side proof: removing a row from `schedules` must actually stop it.
  const r = await run({}, [], CYCLE_DONE);
  assert.equal(r.commands.length, 0);
  assert.equal(r.lightRequests.length, 0);
});


/* ===========================================================================
 * RM-060 — per-socket load shedding, at daemon level.
 * ======================================================================== */

const OVER_LIMIT = { max_phase_current: 1, max_total_kw: 0.1, auto_shed: true, updated_by: '22222222-2222-2222-2222-222222222222' };
const TOTALS_OVER = { device_id: '_totals', total_power_w: 9000, phase_current: { red: 10, yellow: 12, blue: null } };
const bothSocketsOn = (id) => ({ device_id: id, socket_states: { 1: 'on', 2: 'on' } });

test('sheds ONE socket when only that socket carries the tier', async () => {
  const r = await run({ ...OPEN }, [], (s) => s.lightRequests.length >= 1, {
    dsm: OVER_LIMIT,
    socketConfig: [{ device_id: 'co1', socket: 2, load_shed_group: 'group_1' }],
    latest: [TOTALS_OVER, bothSocketsOn('co1')],
    settleMs: 900,
  });
  assert.deepEqual(r.lightRequests.map((q) => q.url), ['/outlet/CO1_2'], 'socket 1 must not be touched');
  assert.equal(r.commands.length, 1);
  assert.equal(r.commands[0].socket, 2);
  assert.equal(r.commands[0].source, 'dsm_autoshed');
});

test('a DEVICE-level tier still sheds both sockets when socket_config has no rows for it', async () => {
  const r = await run({ ...OPEN }, [], (s) => s.lightRequests.length >= 2, {
    dsm: OVER_LIMIT,
    deviceConfig: [{ device_id: 'co1', load_shed_group: 'group_1' }],
    socketConfig: [],
    latest: [TOTALS_OVER, bothSocketsOn('co1')],
    settleMs: 900,
  });
  assert.deepEqual(r.lightRequests.map((q) => q.url).sort(), ['/outlet/CO1_1', '/outlet/CO1_2']);
  assert.deepEqual(r.commands.map((c) => c.socket).sort(), [1, 2]);
});

test('an un-migrated deployment (no socket_config table) still sheds on device-level tiers', async () => {
  // phase34 may land after the code. Falling back is correct; going silent is not.
  const r = await run({ ...OPEN }, [], (s) => s.lightRequests.length >= 2, {
    dsm: OVER_LIMIT,
    deviceConfig: [{ device_id: 'co1', load_shed_group: 'group_1' }],
    socketConfig: null,
    latest: [TOTALS_OVER, bothSocketsOn('co1')],
    settleMs: 900,
  });
  assert.deepEqual(r.lightRequests.map((q) => q.url).sort(), ['/outlet/CO1_1', '/outlet/CO1_2']);
  assert.match(r.out, /socket_config unreadable/, 'and says so once per refresh rather than failing quietly');
});

test('every shed audit row for an outlet names a socket — none carries socket: null', async () => {
  const r = await run({ ...OPEN }, [], (s) => s.commands.length >= 2, {
    dsm: OVER_LIMIT,
    socketConfig: [
      { device_id: 'co1', socket: 1, load_shed_group: 'group_1' },
      { device_id: 'co1', socket: 2, load_shed_group: 'group_1' },
    ],
    latest: [TOTALS_OVER, bothSocketsOn('co1')],
    settleMs: 900,
  });
  assert.ok(r.commands.length >= 2);
  assert.ok(r.commands.every((c) => c.socket === 1 || c.socket === 2), JSON.stringify(r.commands.map((c) => c.socket)));
});

test('a Protected socket is never shed even while its neighbour is', async () => {
  const r = await run({ ...OPEN }, [], (s) => s.lightRequests.length >= 1, {
    dsm: OVER_LIMIT,
    socketConfig: [
      { device_id: 'co1', socket: 1, load_shed_group: 'group_1' },
      { device_id: 'co1', socket: 2, load_shed_group: 'never' },
    ],
    latest: [TOTALS_OVER, bothSocketsOn('co1')],
    settleMs: 900,
  });
  assert.deepEqual(r.lightRequests.map((q) => q.url), ['/outlet/CO1_1']);
});


/* ===========================================================================
 * RM-062 — the closed-loop aircon controller, at daemon level.
 *
 * The decision logic is covered exhaustively in `acuLoopPlan.test.mjs`, which is where it has
 * to be: `acu_main` has never been paired (RM-016), so none of it can be exercised on this
 * site's hardware. These spawn the real process and check the wiring — that a step reaches the
 * bridge as an IR setpoint, that it is audited with its degrees, and that a failed audit does
 * not leave the rate limiter thinking a step happened.
 * ======================================================================== */

const ACU_USER = '33333333-3333-3333-3333-333333333333';

/** A rule whose window is open right now, whatever time the suite runs at. */
const acuRule = (over = {}) => ({
  id: 'acu-r1',
  acu_device_id: 'acu_main',
  sensor_device_id: 'acu_main',
  target_c: 24,
  deadband_c: 0.5,
  step_c: 1,
  min_step_interval_s: 600,
  manual_hold_s: 600,
  days: '1111111',
  window_start: '00:00',
  window_end: '23:59',
  enabled: true,
  label: null,
  override_reason: null,
  updated_by: ACU_USER,
  ...over,
});

/** The aircon on, at a known setpoint, reporting a room that is too warm. */
const acuHot = (setpoint = 25, room = 27) => ({
  device_id: 'acu_main',
  ts: new Date().toISOString(),
  online: true,
  state: 'on',
  setpoint_c: setpoint,
  room_temp_c: room,
});

test('a hot room steps the setpoint DOWN, reaching the bridge as an IR degree', async () => {
  const r = await run({ ...OPEN }, [], (s) => s.lightRequests.length >= 1, {
    acuRules: [acuRule()],
    acuState: [{ rule_id: 'acu-r1', commanded_c: 25, last_step_at: null, last_direction: null, alert_kind: null }],
    latest: [acuHot(25, 27)],
    settleMs: 900,
  });
  assert.equal(r.lightRequests[0].url, '/acu');
  assert.deepEqual(r.lightRequests[0].body, { mode: '24' }, 'one degree down from 25');
});

test('the audit row records WHICH setpoint, the source, and who the rule belongs to', async () => {
  // `target` resolves to the literal AC_POWER for an aircon, so without `target_c` a row saying
  // "the loop changed the setpoint" would not say to what.
  const r = await run({ ...OPEN }, [], (s) => s.commands.length >= 1 && s.commands[0].status, {
    acuRules: [acuRule()],
    acuState: [{ rule_id: 'acu-r1', commanded_c: 25 }],
    latest: [acuHot(25, 27)],
    settleMs: 900,
  });
  assert.equal(r.commands[0].target_c, 24);
  assert.equal(r.commands[0].source, 'acu_loop');
  assert.equal(r.commands[0].requested_by, ACU_USER);
  assert.equal(r.commands[0].action, 'on');
  assert.match(r.commands[0].note, /acu loop rule acu-r1/);
});

test('it records the step it took, so a restart cannot re-arm the rate limiter', async () => {
  const r = await run({ ...OPEN }, [], (s) => s.acuStateWrites.some((w) => w.last_step_at), {
    acuRules: [acuRule()],
    acuState: [{ rule_id: 'acu-r1', commanded_c: 25 }],
    latest: [acuHot(25, 27)],
    settleMs: 900,
  });
  const step = r.acuStateWrites.find((w) => w.last_step_at);
  assert.equal(step.rule_id, 'acu-r1');
  assert.equal(step.commanded_c, 24);
  assert.equal(step.last_direction, 'down');
});

test('a step whose audit row cannot be written does NOT stamp last_step_at', async () => {
  // Rate-limiting the retry of a step that never happened would leave the room hot for ten
  // minutes because of a database blip.
  const r = await run({ ...OPEN }, [], /NOT fired/, {
    acuRules: [acuRule()],
    acuState: [{ rule_id: 'acu-r1', commanded_c: 25 }],
    latest: [acuHot(25, 27)],
    failCommandInsert: true,
    allowTimeout: true,
    settleMs: 900,
  });
  assert.equal(r.lightRequests.length, 0, 'and nothing reached the hardware');
  assert.equal(r.acuStateWrites.some((w) => w.last_step_at && w.commanded_c === 24), false);
});

test('an aircon that reports OFF is left alone, and the reason is recorded', async () => {
  const r = await run({ ...OPEN }, [], (s) => s.acuStateWrites.some((w) => w.last_reason), {
    acuRules: [acuRule()],
    acuState: [{ rule_id: 'acu-r1', commanded_c: 25 }],
    latest: [{ ...acuHot(25, 30), state: 'off' }],
    settleMs: 900,
  });
  assert.equal(r.lightRequests.length, 0);
  assert.equal(r.acuStateWrites.find((w) => w.last_reason).last_reason, 'acu_off');
});

test('an OFFLINE aircon holds — the branch this site actually reaches today', async () => {
  const r = await run({ ...OPEN }, [], (s) => s.acuStateWrites.some((w) => w.last_reason), {
    acuRules: [acuRule()],
    acuState: [{ rule_id: 'acu-r1', commanded_c: 25 }],
    latest: [{ ...acuHot(25, 30), online: false }],
    settleMs: 900,
  });
  assert.equal(r.lightRequests.length, 0);
  assert.equal(r.acuStateWrites.find((w) => w.last_reason).last_reason, 'acu_offline');
});

test('a disabled rule does nothing at all', async () => {
  const r = await run({ ...OPEN }, [], CYCLE_DONE, {
    acuRules: [acuRule({ enabled: false })],
    latest: [acuHot(25, 30)],
    settleMs: 700,
  });
  assert.equal(r.lightRequests.length, 0);
  assert.equal(r.commands.length, 0);
});

test('a deployment without phase36 runs the scheduler normally and never mentions the loop', async () => {
  await waitForRoomInMinute();
  const r = await run({ ...OPEN }, [dueNowRow()], (s) => s.lightRequests.length >= 1, { acuRules: null });
  assert.equal(r.lightRequests[0].url, '/light/1', 'the schedule still fires');
  assert.equal(r.commands.every((c) => c.source !== 'acu_loop'), true);
});

test('at the 16C floor it holds, warns once, and records the alert', async () => {
  const r = await run({ ...OPEN }, [], /acu loop alert/, {
    acuRules: [acuRule()],
    acuState: [{ rule_id: 'acu-r1', commanded_c: 16, alert_kind: null }],
    latest: [acuHot(16, 30)],
    settleMs: 900,
  });
  assert.equal(r.lightRequests.length, 0, 'it does not keep trying below the floor');
  assert.match(r.out, /floor/i);
  assert.equal(r.acuStateWrites.some((w) => w.alert_kind === 'floor_reached'), true);
});
