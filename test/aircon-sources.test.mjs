/**
 * The Aircon tab's generated function-node sources, EXECUTED rather than pattern-matched.
 *
 * Each source runs here the way Node-RED runs a function node: as a function body with `msg`,
 * `flow`, `context` and `env` in scope and a top-level `return`. A regex over the source can agree
 * with a comment while the code does something else; running it cannot.
 *
 * The IR library used is the one read off the live flow on 2026-09-17
 * (`test/fixtures/aircon-tab-live-2026-09-17.json`), so these tests also prove extraction keeps
 * every code byte-identical.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  hubParserSource,
  STATE_MANAGER_SOURCE,
  acMasterLogicSource,
  ACU_AUTH_FN,
  HUB_POLL_GATE_SOURCE,
  extractIrLibrary,
  AC_DASH_STATE_KEYS,
} from '../node-red-bridge/airconSources.mjs';
import { LOCAL_LIBRARY_STATE } from '../shared/acState.mjs';
import { buildLatest } from '../shared/buildLatest.mjs';
import { DEVICE_REGISTRY, PHASE_MAP } from '../shared/registry.mjs';

const LIVE_TAB = JSON.parse(readFileSync(new URL('./fixtures/aircon-tab-live-2026-09-17.json', import.meta.url), 'utf8'));
const liveMaster = LIVE_TAB.find((n) => n.type === 'function' && n.name === 'AC Master Logic');

/** Runs a function-node body. `flow`/`context` are Maps so a test can read what was written. */
function run(source, msg, { flow = new Map(), context = new Map(), env = {} } = {}) {
  const store = (m) => ({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v) });
  const fn = new Function('msg', 'flow', 'context', 'env', source);
  return fn(msg, store(flow), store(context), { get: (k) => env[k] });
}

// --- the IR library ---------------------------------------------------------------------------

test('the live IR library is extracted whole: OFF and every degree 16..30', () => {
  const lib = extractIrLibrary(liveMaster.func);
  assert.ok(lib, 'extraction failed on the live node');
  assert.match(lib.head, /^[0-9a-f]+$/);
  assert.deepEqual(Object.keys(lib.library).sort(), ['16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', 'OFF'].sort());
});

test('regenerating AC Master Logic cannot change a single code', () => {
  const lib = extractIrLibrary(liveMaster.func);
  assert.deepEqual(extractIrLibrary(acMasterLogicSource(lib)), lib);
});

test('extraction refuses rather than guesses when the library is not there', () => {
  assert.equal(extractIrLibrary('const head = "abc"; msg.payload = 1;'), null);
  assert.equal(extractIrLibrary(''), null);
});

// --- the hub parser ---------------------------------------------------------------------------

test('the hub parser decodes the two sensors exactly as the cloud shadow read them', () => {
  const flow = new Map();
  const [out, learned] = run(hubParserSource(), { payload: { data: { dps: { 101: 286, 102: 59 } } } }, { flow });
  assert.equal(out.topic, 'acu_hub');
  assert.equal(out.payload.health, true);
  assert.equal(out.payload.temp_current, 28.6);
  assert.equal(out.payload.humidity_value, 59);
  assert.equal(typeof out.payload.sensedAt, 'number');
  assert.equal(learned, null);
  assert.equal(flow.get('acu_hub_health'), true);
});

test('a disconnect is carried as health with no sensed time', () => {
  const flow = new Map([['acu_hub_health', true]]);
  const [out] = run(hubParserSource(), { payload: 'DISCONNECTED' }, { flow });
  assert.equal(out.payload.health, false);
  assert.equal('sensedAt' in out.payload, false);
  assert.equal(flow.get('acu_hub_health'), false);
});

test('a value outside the vendor range is dropped, never clamped', () => {
  const [out] = run(hubParserSource(), { payload: { dps: { 101: 9999, 102: 150 } } });
  assert.equal('temp_current' in out.payload, false);
  assert.equal('humidity_value' in out.payload, false);
  assert.equal('sensedAt' in out.payload, false, 'nothing valid was sensed');
});

test('a learned IR code leaves on the second output', () => {
  const [, learned] = run(hubParserSource(), { payload: { dps: { 202: 'AAECAwQ=' } } });
  assert.equal(learned.topic, 'acu_ir_learned');
  assert.equal(learned.payload.code, 'AAECAwQ=');
});

// --- the state manager ------------------------------------------------------------------------

test('the state manager writes every key buildLatest reads, and the result reads correctly', () => {
  const flow = new Map();
  const context = new Map();
  run(STATE_MANAGER_SOURCE, { topic: 'acu_hub', payload: { health: true, temp_current: 28.6, humidity_value: 59, sensedAt: Date.now() } }, { flow, context });
  run(STATE_MANAGER_SOURCE, { topic: 'ac_command', payload: { power: true, setpoint_c: 24, mode: 'cool', fan: 'auto', swing: false, at: Date.now(), via: 'local' } }, { flow, context });
  const state = flow.get('ac_dash_state');
  for (const key of AC_DASH_STATE_KEYS) assert.ok(key in state, `ac_dash_state is missing ${key}`);

  const rows = buildLatest({ energy: { meters: {}, totals: {} }, outlet: { meters: {}, state: { status: {} } }, switch: {}, aircon: { state } }, DEVICE_REGISTRY, PHASE_MAP, Date.now());
  const acu = rows.find((r) => r.device_id === 'acu_main');
  assert.deepEqual([acu.online, acu.state, acu.setpoint_c, acu.room_temp_c, acu.ac_mode, acu.command_via], [true, 'on', 24, 28.6, 'cool', 'local']);
  // Never installed, never fed: still offline with nothing borrowed from the hub.
  const outside = rows.find((r) => r.device_id === 'sens_outside_temp');
  assert.equal(outside.online, false);
  assert.equal('humidity_pct' in outside, false);
});

test('a hub disconnect reaches the state and takes the aircon offline, last values kept', () => {
  const flow = new Map();
  run(STATE_MANAGER_SOURCE, { topic: 'acu_hub', payload: { health: true, temp_current: 28.6, sensedAt: Date.now() } }, { flow });
  run(STATE_MANAGER_SOURCE, { topic: 'acu_hub', payload: { health: false } }, { flow });
  const state = flow.get('ac_dash_state');
  assert.equal(state.hubHealth, false);
  const rows = buildLatest({ energy: { meters: {}, totals: {} }, outlet: { meters: {}, state: { status: {} } }, switch: {}, aircon: { state } }, DEVICE_REGISTRY, PHASE_MAP, Date.now());
  const acu = rows.find((r) => r.device_id === 'acu_main');
  assert.equal(acu.online, false);
  assert.equal(acu.room_temp_c, 28.6);
});

test('an OFF command keeps the last setpoint, mode and fan on record', () => {
  const flow = new Map();
  run(STATE_MANAGER_SOURCE, { topic: 'ac_command', payload: { power: true, setpoint_c: 22, mode: 'dry', fan: 'high', swing: true, at: 1, via: 'cloud' } }, { flow });
  run(STATE_MANAGER_SOURCE, { topic: 'ac_command', payload: { power: false, at: 2, via: 'local' } }, { flow });
  const s = flow.get('ac_dash_state');
  assert.deepEqual([s.power, s.setTemp, s.mode, s.fan, s.swing, s.commandVia], [false, 22, 'dry', 'high', true, 'local']);
});

test('the Outside Temp path is unchanged', () => {
  const flow = new Map();
  run(STATE_MANAGER_SOURCE, { topic: 'Breaker_Ambient_Temp', payload: 31.8 }, { flow });
  assert.equal(flow.get('ac_dash_state').outTemp, 31.8);
});

test('a learned code is kept out of the public state object', () => {
  const flow = new Map();
  const context = new Map();
  run(STATE_MANAGER_SOURCE, { topic: 'acu_ir_learned', payload: { code: 'AAECAwQ=', at: 5 } }, { flow, context });
  assert.equal(JSON.stringify(flow.get('ac_dash_state')).includes('AAECAwQ='), false);
  assert.equal(context.get('last_learned').code, 'AAECAwQ=');
});

// --- AC Master Logic --------------------------------------------------------------------------

const LIB = extractIrLibrary(liveMaster.func);
const master = acMasterLogicSource(LIB);
const healthy = () => new Map([['acu_hub_health', true]]);
const httpMsg = (payload) => ({ payload, req: {}, res: { _res: {} } });

test('a state the library holds is sent over the LAN with the live code, recorded, and answered 200', () => {
  const [ir, rec, reply] = run(master, httpMsg({ power: 'on', setpoint_c: 24, ...LOCAL_LIBRARY_STATE }), { flow: healthy() });
  assert.equal(ir.payload.dps, 201);
  const set = JSON.parse(ir.payload.set);
  assert.deepEqual([set.control, set.head, set.key1], ['send_ir', LIB.head, LIB.library['24']]);
  assert.equal(rec.topic, 'ac_command');
  assert.deepEqual([rec.payload.power, rec.payload.setpoint_c, rec.payload.via], [true, 24, 'local']);
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.payload.sent, 'local');
});

test('OFF uses the OFF code', () => {
  const [ir] = run(master, httpMsg({ power: 'off' }), { flow: healthy() });
  assert.equal(JSON.parse(ir.payload.set).key1, LIB.library.OFF);
});

test('a state the library cannot express sends nothing and answers 422, so the proxy can try the cloud', () => {
  const [ir, rec, reply] = run(master, httpMsg({ power: 'on', mode: 'dry', setpoint_c: 24, fan: 'high', swing: true }), { flow: healthy() });
  assert.equal(ir, null);
  assert.equal(rec, null);
  assert.equal(reply.statusCode, 422);
  assert.equal(reply.payload.error, 'no_local_code');
});

test('a disconnected hub sends nothing and answers 409 instead of a hollow 200', () => {
  const [ir, rec, reply] = run(master, httpMsg({ power: 'off' }), { flow: new Map([['acu_hub_health', false]]) });
  assert.equal(ir, null);
  assert.equal(rec, null);
  assert.equal(reply.statusCode, 409);
  assert.equal(reply.payload.error, 'device_offline');
});

test('record_only records what the cloud carried and sends no IR', () => {
  const [ir, rec, reply] = run(master, httpMsg({ power: 'on', mode: 'dry', setpoint_c: 26, fan: 'high', swing: true, record_only: true }), { flow: new Map() });
  assert.equal(ir, null);
  assert.deepEqual([rec.payload.mode, rec.payload.setpoint_c, rec.payload.via], ['dry', 26, 'cloud']);
  assert.equal(reply.statusCode, 200);
});

test('the legacy bare key still works, and a message with no HTTP request gets no reply', () => {
  const [ir, rec, reply] = run(master, { payload: '25' }, { flow: healthy() });
  assert.equal(JSON.parse(ir.payload.set).key1, LIB.library['25']);
  assert.equal(rec.payload.mode, LOCAL_LIBRARY_STATE.mode);
  assert.equal(reply, null);
});

// --- /acu auth and validation -----------------------------------------------------------------

const auth = (payload, token = 'secret') =>
  run(ACU_AUTH_FN, { payload, req: { headers: { 'x-auth-token': token } } }, { env: { LIGHT_API_TOKEN: 'secret' } });

test('an unauthenticated caller is refused with 401', () => {
  const [ok, refused] = auth({ state: { power: 'off' } }, 'wrong');
  assert.equal(ok, null);
  assert.equal(refused.statusCode, 401);
});

test('a full on-state passes through as an object, and record_only is carried', () => {
  const [ok] = auth({ state: { power: 'on', mode: 'dry', setpoint_c: 24, fan: 'high', swing: true }, record_only: true });
  assert.deepEqual(ok.payload, { power: 'on', mode: 'dry', setpoint_c: 24, fan: 'high', swing: true, record_only: true });
});

test('an incomplete or out-of-vocabulary on-state is refused with 400', () => {
  for (const state of [
    { power: 'on', mode: 'turbo', setpoint_c: 24, fan: 'auto', swing: false },
    { power: 'on', mode: 'cool', setpoint_c: 31, fan: 'auto', swing: false },
    { power: 'on', mode: 'cool', setpoint_c: 24, fan: 'max', swing: false },
    { power: 'on', mode: 'cool', setpoint_c: 24, fan: 'auto' },
    { power: 'toggle' },
  ]) {
    const [ok, refused] = auth({ state });
    assert.equal(ok, null, JSON.stringify(state));
    assert.equal(refused.statusCode, 400);
  }
});

test('the legacy body still passes for one release', () => {
  assert.equal(auth({ mode: 'OFF' })[0].payload, 'OFF');
  assert.equal(auth({ mode: '16' })[0].payload, '16');
  assert.equal(auth({ mode: '31' })[1].statusCode, 400);
});

// --- the poll gate ----------------------------------------------------------------------------

test('the hub poll skips a known-dead session and asks otherwise', () => {
  assert.equal(run(HUB_POLL_GATE_SOURCE, {}, { flow: new Map([['acu_hub_health', false]]) }), null);
  assert.deepEqual(run(HUB_POLL_GATE_SOURCE, {}, { flow: new Map() }).payload, { operation: 'GET' });
});
