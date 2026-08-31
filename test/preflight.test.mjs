import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessDeployment, LEVELS } from '../scripts/preflight.mjs';

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
  assert.equal(find(r, 'env_tuya').level, LEVELS.ERROR);
  assert.equal(find(r, 'vendor_auth').level, LEVELS.SKIPPED);
  assert.equal(r.errors.length, 1, 'one cause, one error');
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
  const empty = assessDeployment({ siteId: 'x', env: {}, database: {}, vendor: {}, network: {}, bridge: {}, services: {} }).checks.map((c) => c.id);
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
