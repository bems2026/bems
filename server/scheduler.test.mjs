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
function startFakeSupabase(scheduleRow) {
  return new Promise((resolve) => {
    const port = nextPort++;
    const state = { commands: [] };
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      if (req.url.startsWith('/rest/v1/schedules')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([scheduleRow]));
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

function startFakeLight() {
  return new Promise((resolve) => {
    const port = nextPort++;
    const state = { requests: [] };
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      state.requests.push({ url: req.url, body: raw ? JSON.parse(raw) : null, token: req.headers['x-auth-token'] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
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

async function run(env, scheduleRow, waitMs = 2500) {
  const sb = await startFakeSupabase(scheduleRow);
  const light = await startFakeLight();
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

test('an outlet schedule is left alone — Node-RED still owns those, and a dry_run row would misreport a switch that really happened', async () => {
  const r = await run({}, dueNowRow({ device_id: 'co1' }));
  assert.equal(r.commands.length, 0);
  assert.equal(r.lightRequests.length, 0);
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
