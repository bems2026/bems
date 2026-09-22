import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessDeployment, LEVELS, pollCoverage } from '../scripts/preflight.mjs';

/** A deployment where everything was checked and everything was fine. */
const healthy = () => ({
  siteId: 'somewhere-else',
  env: {
    SUPABASE_URL: 'set',
    SUPABASE_SERVICE_ROLE_KEY: 'set',
    TUYA_ACCESS_ID: 'set',
    TUYA_ACCESS_SECRET: 'set',
    TUYA_REGION: 'set',
    NODE_RED_ADMIN_USER: 'set',
    NODE_RED_ADMIN_PASS: 'set',
  },
  database: { reachable: true, siteRowFound: true },
  vendor: { authenticated: true, error: null },
  network: { distinctDevices: 6 },
  bridge: { reachable: true, deviceCount: 6, expectedCount: 6, lanExposed: false, exposedOn: null },
  services: { nodered: 'active', 'ibems-ingest': 'active' },
  host: {
    journal: { storage: 'persistent', onDisk: true },
    timers: { 'ibems-wifi-prefer.timer': 'active', 'ibems-lan-map.timer': 'active', 'ibems-fleet-recover.timer': 'active' },
    addresses: { pinned: 6, total: 6, lanMapDevices: 6, lanMapFreshestMs: 4 * 60_000 },
    polls: { total: 6, unpolled: [] },
  },
});

const find = (result, id) => result.checks.find((c) => c.id === id);

test('a fully checked, fully working deployment is ready', () => {
  const r = assessDeployment(healthy());
  assert.equal(r.ready, true);
  assert.equal(r.errors.length, 0);
});

test('a check that could not be run is never reported as fine', () => {
  // The spine of this file. "Not observed" and "observed to be working" are different facts, and
  // a preflight that rounds the first to the second is worse than no preflight: it is a green
  // light nobody earned. Running this on a workstation checks almost nothing, and it says so.
  const obs = healthy();
  obs.network.distinctDevices = null;
  const r = assessDeployment(obs);
  assert.equal(find(r, 'network_discovery').level, LEVELS.UNCHECKED);
  assert.equal(r.ready, false, 'an unchecked required item cannot leave the deployment ready');
});

test('an empty credential is a missing credential, not a configured one', () => {
  // `server/.env.example` ships every required key with an empty value, so a copied-but-unedited
  // file has all the right names and none of the answers. Presence of the key proves nothing.
  const obs = healthy();
  obs.env.SUPABASE_SERVICE_ROLE_KEY = 'empty';
  const r = assessDeployment(obs);
  assert.equal(find(r, 'env_supabase').level, LEVELS.ERROR);
  assert.match(find(r, 'env_supabase').detail, /empty/i);
});

test('a credential value handed in by mistake still never reaches the output', () => {
  // This output gets pasted into an issue or read over someone's shoulder. The observation shape
  // is meant to carry 'set' / 'empty' / 'absent' and never a value — but the guard that matters
  // is the one that holds when a future edit passes the value in anyway, or interpolates it into
  // a message. TUYA_ACCESS_SECRET reaches hardware directly and nothing scopes it.
  const obs = healthy();
  obs.env.TUYA_ACCESS_SECRET = 'tuya-secret-abc123';
  obs.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiJ9.leaked';
  const text = JSON.stringify(assessDeployment(obs));
  assert.doesNotMatch(text, /abc123/);
  assert.doesNotMatch(text, /eyJhbGciOi/);
});

test('a dependent check is skipped rather than reported as a second failure', () => {
  // Absent Tuya credentials already failed once. Reporting "vendor account did not
  // authenticate" underneath it invents a second problem out of the first, and a wall of red
  // teaches people to skip the tool.
  const obs = healthy();
  obs.env.TUYA_ACCESS_SECRET = 'absent';
  obs.vendor = { authenticated: null, error: null };
  const r = assessDeployment(obs);
  assert.equal(find(r, 'env_tuya').level, LEVELS.WARN);
  assert.equal(find(r, 'vendor_auth').level, LEVELS.SKIPPED);
  assert.equal(r.warnings.length, 1, 'one cause, one warning');
});

/**
 * The vendor cloud is optional — the operator's decision of 2026-09-17, recorded in CLAUDE.md and
 * RM-129. Keys come from a key tool's export, presence from the LAN, the aircon's states from the
 * TCL112 generator. Until 2026-09-22 this tool still called a refused console an ERROR and the
 * deployment "not ready", which contradicted the policy every day the trial stayed lapsed.
 */
test('a refused or absent vendor cloud is a warning that lists what stays cloud-only, not a failure', () => {
  const obs = healthy();
  obs.vendor = { authenticated: false, error: '7 data centre(s) tried, none accepted the credentials' };
  const r = assessDeployment(obs);
  const check = find(r, 'vendor_auth');
  assert.equal(check.level, LEVELS.WARN);
  assert.equal(r.ready, true, 'the deployment runs without the cloud');
  assert.match(check.fix, /keys:import/);
  assert.match(check.fix, /set-device-ip/);

  const none = healthy();
  none.env.TUYA_ACCESS_ID = 'absent';
  none.env.TUYA_ACCESS_SECRET = 'absent';
  none.vendor = { authenticated: null, error: null };
  const r2 = assessDeployment(none);
  assert.equal(find(r2, 'env_tuya').level, LEVELS.WARN);
  assert.equal(r2.ready, true);
});

test('seeing no device broadcasts is an error that names the 2.4 GHz trap', () => {
  // The single most expensive misdiagnosis in this project's history: on a 5 GHz SSID the Pi
  // keeps working internet and remote access while every device reads offline, which looks
  // exactly like a code fault. A day-one check that does not say this out loud wastes the day.
  const obs = healthy();
  obs.network.distinctDevices = 0;
  const r = assessDeployment(obs);
  const check = find(r, 'network_discovery');
  assert.equal(check.level, LEVELS.ERROR);
  assert.match(`${check.detail} ${check.fix}`, /2\.4 ?GHz/);
});

test('a missing sites row is an error, because nothing else will say so', () => {
  const obs = healthy();
  obs.database.siteRowFound = false;
  const r = assessDeployment(obs);
  assert.equal(find(r, 'db_site_row').level, LEVELS.ERROR);
  assert.match(find(r, 'db_site_row').detail, /somewhere-else/);
});

test('a fleet smaller than the registry is a warning, not a failure', () => {
  // Devices go offline for ordinary reasons and a deployment with three of six radios up is
  // still a working deployment. Failing here would make the command red on most real days.
  const obs = healthy();
  obs.bridge.deviceCount = 3;
  const r = assessDeployment(obs);
  assert.equal(find(r, 'bridge_fleet').level, LEVELS.WARN);
  assert.equal(r.ready, true);
});

test('a service that is not running is a warning with the unit named', () => {
  const obs = healthy();
  obs.services['ibems-ingest'] = 'inactive';
  const r = assessDeployment(obs);
  assert.equal(find(r, 'services').level, LEVELS.WARN);
  assert.match(find(r, 'services').detail, /ibems-ingest/);
});

test('an unreachable database fails and skips the row check beneath it', () => {
  const obs = healthy();
  obs.database = { reachable: false, siteRowFound: null };
  const r = assessDeployment(obs);
  assert.equal(find(r, 'db_reachable').level, LEVELS.ERROR);
  assert.equal(find(r, 'db_site_row').level, LEVELS.SKIPPED);
});

test('every check carries a next step, not only a verdict', () => {
  // A failing check that does not say what to do is a bug report addressed to nobody.
  const obs = healthy();
  obs.env.SUPABASE_URL = 'absent';
  obs.database = { reachable: null, siteRowFound: null };
  obs.network.distinctDevices = 0;
  const r = assessDeployment(obs);
  for (const check of r.checks) {
    if (check.level === LEVELS.OK) continue;
    assert.ok(check.fix && check.fix.length > 10, `${check.id} has no next step`);
  }
});

test('the check list is stable and complete whatever the observations say', () => {
  // A check that vanishes when its input is missing is a check nobody notices is gone.
  const full = assessDeployment(healthy()).checks.map((c) => c.id);
  const empty = assessDeployment({ siteId: 'x', env: {}, database: {}, vendor: {}, network: {}, bridge: {}, services: {}, host: {} }).checks.map((c) => c.id);
  assert.deepEqual(empty, full);
  assert.ok(full.length >= 8, `expected the full check list, got ${full.length}`);
});

/**
 * FI-019 — the bridge must not answer to anything but this machine.
 *
 * Node-RED serves the admin API and every http-in node on one port, and its `uiHost` default is
 * every interface. On this deployment that includes the dedicated 2.4 GHz SSID the field devices
 * sit on, so anything associated to that Wi-Fi could read `/api/devices` and
 * `/api/readings/latest` with no credential — verified by fetching both from another host on
 * 2026-09-01, before it was closed.
 *
 * The check exists because `settings.js` is not in this repository. A rebuild, a restore or a
 * package upgrade puts the permissive default back with no diff and no alarm — the same shape as
 * the tuya nodes' `findTimeout` and the MQTT broker's listener, both of which this project has
 * already been bitten by. A setting that lives only on a host needs something that notices when
 * it goes away.
 */
test('a bridge answering on a non-loopback address is reported, not passed over', () => {
  const obs = healthy();
  obs.bridge.lanExposed = true;
  obs.bridge.exposedOn = '192.168.2.190';
  const r = assessDeployment(obs);
  const check = find(r, 'bridge_not_exposed');
  assert.equal(check.level, LEVELS.WARN);
  assert.match(check.detail, /no credential/);
});

test('the exposure is a warning, not an error — the deployment does work either way', () => {
  // A day-one run on a machine nobody has hardened yet should be told this, not told it is
  // broken. Overstating it is how a real error further down the list gets skipped over.
  const obs = healthy();
  obs.bridge.lanExposed = true;
  assert.equal(assessDeployment(obs).ready, true);
});

test('a loopback-bound bridge passes', () => {
  const check = find(assessDeployment(healthy()), 'bridge_not_exposed');
  assert.equal(check.level, LEVELS.OK);
  assert.match(check.detail, /loopback/);
});

test('an unchecked exposure is unchecked, never assumed safe', () => {
  // The file's one rule, applied here: a machine with no non-loopback address at all cannot be
  // probed, and "could not look" must not render as "looked and it was fine".
  const obs = healthy();
  obs.bridge.lanExposed = null;
  assert.equal(find(assessDeployment(obs), 'bridge_not_exposed').level, LEVELS.UNCHECKED);
});

test('the remedy names the SSH tunnel, so nobody closes it by widening it back', () => {
  const obs = healthy();
  obs.bridge.lanExposed = true;
  const check = find(assessDeployment(obs), 'bridge_not_exposed');
  assert.match(check.fix, /uiHost/);
  assert.match(check.fix, /ssh -L/);
});

/**
 * RM-125 / RM-131 — three more things that live only on the host, and that the host loses with no
 * diff and no alarm: whether the journal survives a reboot, whether the recovery timers are armed,
 * and whether every tuya node has a static address. Each was a real loss before it was a check:
 * the 2026-09-19 meter flip had no witness but the database because the journal was volatile, and
 * after the 2026-09-21 outage every switch and outlet waited for a broadcast that never came.
 */
test('a volatile journal is a warning that says what is lost, with the drop-in named', () => {
  const obs = healthy();
  obs.host.journal = { storage: 'volatile', onDisk: false };
  const check = find(assessDeployment(obs), 'host_journal');
  assert.equal(check.level, LEVELS.WARN);
  assert.match(check.detail, /volatile/);
  assert.match(check.fix, /50-ibems-persistent\.conf/);
  assert.match(check.fix, /Storage=persistent/);
});

test('a persistent journal passes only when the journal is actually on disk', () => {
  const obs = healthy();
  obs.host.journal = { storage: 'persistent', onDisk: false };
  assert.equal(find(assessDeployment(obs), 'host_journal').level, LEVELS.WARN, 'configured but not yet written is not persistent');
  obs.host.journal = { storage: 'auto', onDisk: true };
  assert.equal(find(assessDeployment(obs), 'host_journal').level, LEVELS.OK, 'Storage=auto with the directory present is persistent');
  obs.host.journal = { storage: null, onDisk: null };
  assert.equal(find(assessDeployment(obs), 'host_journal').level, LEVELS.UNCHECKED);
});

test('a recovery timer that is not running is a warning that names it and the runbook', () => {
  const obs = healthy();
  obs.host.timers['ibems-fleet-recover.timer'] = 'inactive';
  const check = find(assessDeployment(obs), 'host_timers');
  assert.equal(check.level, LEVELS.WARN);
  assert.match(check.detail, /ibems-fleet-recover\.timer is inactive/);
  assert.match(check.fix, /outage-recovery\.md/);
  assert.match(check.fix, /enable --now/);
  obs.host.timers = {};
  assert.equal(find(assessDeployment(obs), 'host_timers').level, LEVELS.UNCHECKED);
});

test('a node without a static address is a warning that counts them and points at the LAN map', () => {
  const obs = healthy();
  obs.host.addresses = { pinned: 4, total: 6, lanMapDevices: 6, lanMapFreshestMs: 3 * 60_000 };
  const check = find(assessDeployment(obs), 'host_addresses');
  assert.equal(check.level, LEVELS.WARN);
  assert.match(check.detail, /4 of 6/);
  assert.match(check.detail, /6 device\(s\) in the LAN map, freshest 3 min ago/);
  assert.match(check.fix, /--from-lan-map/);
});

test('every node pinned passes, and says so without claiming the LAN map is fresh', () => {
  const obs = healthy();
  obs.host.addresses = { pinned: 6, total: 6, lanMapDevices: 0, lanMapFreshestMs: null };
  const check = find(assessDeployment(obs), 'host_addresses');
  assert.equal(check.level, LEVELS.OK);
  assert.match(check.detail, /all 6 node\(s\) have a static address/);
  assert.match(check.detail, /nothing in the LAN map yet/);
});

test('an unreadable flow leaves the address check unchecked, never passed', () => {
  const obs = healthy();
  obs.host.addresses = { pinned: null, total: null, lanMapDevices: 6, lanMapFreshestMs: 60_000 };
  const check = find(assessDeployment(obs), 'host_addresses');
  assert.equal(check.level, LEVELS.UNCHECKED);
  assert.match(check.fix, /NODE_RED_ADMIN/);
});

// --- flow_polls (RM-134) -------------------------------------------------------------------------

test('every enabled tuya node fed a GET poll passes', () => {
  const check = find(assessDeployment(healthy()), 'flow_polls');
  assert.equal(check.level, LEVELS.OK);
  assert.match(check.detail, /all 6 node\(s\) are fed a GET poll/);
});

test('a node no poll reaches is an error that names it and the command that fixes it', () => {
  // The tuya node never reads state on connect, so an unpolled device shows its last PUSHED value
  // forever — L.O Yellow held 39.8 W for hours on 2026-09-22. A restored flows.json drops a poller
  // with no diff, which is why this is checked rather than remembered.
  const obs = healthy();
  obs.host.polls = { total: 6, unpolled: ['C.O yellow', 'L.O red'] };
  const r = assessDeployment(obs);
  const check = find(r, 'flow_polls');
  assert.equal(check.level, LEVELS.ERROR);
  assert.match(check.detail, /2 of 6/);
  assert.match(check.detail, /C\.O yellow, L\.O red/);
  assert.match(check.fix, /poll-meters:pi/);
  assert.equal(r.ready, false);
});

test('an unreadable flow leaves the poll check unchecked, never passed', () => {
  const obs = healthy();
  obs.host.polls = null;
  assert.equal(find(assessDeployment(obs), 'flow_polls').level, LEVELS.UNCHECKED);
});

test('pollCoverage counts enabled tuya nodes and names the ones no GET reaches', () => {
  const tuya = (id, name, extra = {}) => ({ id, type: 'tuya-smart-device', deviceName: name, wires: [[]], ...extra });
  const fn = (id, func, targets) => ({ id, type: 'function', func, wires: targets.map((t) => [t]) });
  const flows = [
    tuya('m', 'C.O yellow'),
    tuya('o', 'CO1'),
    tuya('s', 'Light Switch 1'),
    tuya('h', 'NBRIC IR Blaster'),
    tuya('q', 'Outside Temp', { disableAutoStart: true }),
    fn('op', "const poll = { operation: 'GET' };", ['o']),
    fn('sp', "const poll = { operation: 'GET' };", ['s']),
    fn('gate', 'return { payload: { operation: "GET" } };', ['h']),
    fn('cmd', "msg.payload = { dps: 1, set: true }; return msg;", ['m']),
  ];
  assert.deepEqual(pollCoverage(flows), { total: 4, unpolled: ['C.O yellow'] }, 'a command formatter is not a poll; a quiesced node is not counted');
});
