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
  bridge: { reachable: true, deviceCount: 6, expectedCount: 6 },
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
