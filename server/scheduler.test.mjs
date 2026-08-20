import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEDULER = join(HERE, 'scheduler.mjs');
let nextPort = 21400;

/** Minimal Supabase REST stand-in: serves one schedules row and collects command inserts. */
function startFakeSupabase(scheduleRow, dsm = { max_phase_current: null, max_total_kw: null, auto_shed: false, updated_by: null }, deviceConfig = []) {
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
      if (req.url.startsWith('/rest/v1/commands') && req.method === 'POST') {
        state.commands.push(JSON.parse(raw));
        res.writeHead(201);
        return res.end();
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

/** A schedule whose `on` time is the minute the test runs in, so it is due immediately. */
function dueNowRow(over = {}) {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const days = new Array(7).fill('0');
  days[(now.getDay() + 6) % 7] = '1';
  return { device_id: 'l1', socket: null, rule: { on: hhmm, days: days.join('') }, enabled: true, updated_by: '11111111-1111-1111-1111-111111111111', ...over };
}

async function run(env, scheduleRow, waitMs = 2500, opts = {}) {
  const sb = await startFakeSupabase(scheduleRow, opts.dsm, opts.deviceConfig);
  const light = await startFakeLight(opts.latest);
  const child = spawn(process.execPath, [SCHEDULER], {
    env: {
      ...process.env,
      SUPABASE_URL: sb.url,
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      BRIDGE_HOST: '127.0.0.1',
      BRIDGE_PORT: String(light.port),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c.toString(); });
  child.stderr.on('data', (c) => { out += c.toString(); });
  await new Promise((r) => setTimeout(r, waitMs));
  child.kill();
  sb.close();
  light.close();
  return { commands: sb.state.commands, lightRequests: light.state.requests, out };
}

test('with the gate closed a due schedule is audited as dry_run and never reaches the light', async () => {
  const r = await run({}, dueNowRow());
  assert.equal(r.lightRequests.length, 0, 'nothing may reach the hardware endpoint');
  assert.equal(r.commands.length, 1, 'but it must still be recorded');
  assert.equal(r.commands[0].status, 'dry_run');
  assert.equal(r.commands[0].source, 'schedule');
  assert.equal(r.commands[0].device_id, 'l1');
  assert.equal(r.commands[0].action, 'on');
});

test('the audit row is attributed to whoever saved the schedule', async () => {
  const r = await run({}, dueNowRow());
  assert.equal(r.commands[0].requested_by, '11111111-1111-1111-1111-111111111111');
});

test('with the gate open the command really reaches the light endpoint and is audited as dispatched', async () => {
  const r = await run({ HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-token' }, dueNowRow());
  assert.equal(r.lightRequests.length, 1);
  assert.equal(r.lightRequests[0].url, '/light/1');
  assert.deepEqual(r.lightRequests[0].body, { state: true });
  assert.equal(r.lightRequests[0].token, 'test-token');
  assert.equal(r.commands[0].status, 'dispatched');
});

test('a schedule that is not due fires nothing at all', async () => {
  const r = await run({}, dueNowRow({ rule: { on: '03:17', days: '1111111' } }));
  assert.equal(r.commands.length, 0);
  assert.equal(r.lightRequests.length, 0);
});

test('a disarmed schedule fires nothing', async () => {
  const r = await run({}, dueNowRow({ enabled: false }));
  assert.equal(r.commands.length, 0);
});

test('an outlet schedule now fires too, routed to its wire target rather than a light id', async () => {
  // This previously asserted the opposite: outlets were skipped because they had no dispatch
  // path, and a dry_run row would have misreported a switch Node-RED really performed. The
  // flow has a /outlet/<target> endpoint now, so they are genuinely covered.
  const r = await run({ HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-token' }, dueNowRow({ device_id: 'co1', socket: 1 }));
  assert.equal(r.commands.length, 1);
  assert.equal(r.commands[0].device_id, 'co1');
  assert.equal(r.commands[0].status, 'dispatched');
  assert.equal(r.lightRequests[0].url, '/outlet/CO1_1');
});

test('refuses to start with the gate open and no light token', async () => {
  const r = await run({ HARDWARE_DISPATCH_ENABLED: 'true' }, dueNowRow(), 1200);
  assert.match(r.out, /refusing to start/i);
  assert.equal(r.lightRequests.length, 0);
});

test('does not fire the same minute twice, even though it checks more often than once a minute', async () => {
  const r = await run({}, dueNowRow(), 4000); // several 15s-loop iterations' worth of checks
  assert.equal(r.commands.length, 1);
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
  const r = await run({}, null, 2500, {
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
  const r = await run({ HARDWARE_DISPATCH_ENABLED: 'true', LIGHT_API_TOKEN: 'test-token' }, null, 2500, {
    dsm: dsmOn,
    deviceConfig: [{ device_id: 'l1', load_shed_group: 'group_1' }],
    latest: OVER,
  });
  assert.ok(r.lightRequests.length >= 1);
  assert.deepEqual(r.lightRequests[0].body, { state: false }, 'shedding means off');
  assert.equal(r.commands.find((c) => c.source === 'dsm_autoshed').status, 'dispatched');
});

test('sheds nothing while the building is under its limit', async () => {
  const r = await run({}, null, 2500, {
    dsm: dsmOn,
    deviceConfig: [{ device_id: 'l1', load_shed_group: 'group_1' }],
    latest: UNDER,
  });
  assert.equal(r.commands.filter((c) => c.source === 'dsm_autoshed').length, 0);
});

test('sheds nothing when auto-shed is switched off, even while over the limit', async () => {
  const r = await run({}, null, 2500, {
    dsm: { ...dsmOn, auto_shed: false },
    deviceConfig: [{ device_id: 'l1', load_shed_group: 'group_1' }],
    latest: OVER,
  });
  assert.equal(r.commands.filter((c) => c.source === 'dsm_autoshed').length, 0);
  assert.match(r.out, /breach, no action taken/i);
});

test('never sheds a Protected device', async () => {
  const r = await run({}, null, 2500, {
    dsm: dsmOn,
    deviceConfig: [{ device_id: 'l1', load_shed_group: 'never' }],
    latest: OVER,
  });
  assert.equal(r.commands.filter((c) => c.source === 'dsm_autoshed').length, 0);
});

test('never sheds a device with no tier assigned', async () => {
  const r = await run({}, null, 2500, {
    dsm: dsmOn,
    deviceConfig: [{ device_id: 'l1', load_shed_group: null }],
    latest: OVER,
  });
  assert.equal(r.commands.filter((c) => c.source === 'dsm_autoshed').length, 0);
});

test('sheds nothing when nobody is on record as having enabled it', async () => {
  const r = await run({}, null, 2500, {
    dsm: { ...dsmOn, updated_by: null },
    deviceConfig: [{ device_id: 'l1', load_shed_group: 'group_1' }],
    latest: OVER,
  });
  assert.equal(r.commands.filter((c) => c.source === 'dsm_autoshed').length, 0);
});
