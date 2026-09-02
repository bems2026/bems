#!/usr/bin/env node
/**
 * `npm run tuya:spec` — read the vendor's live device model and check the committed capability
 * catalogue still describes it.
 *
 * Read-only. It fetches, compares and prints; it never writes to a device, to the flow, or to
 * this repository. Run it after any firmware change, after replacing a unit, and before trusting
 * `shared/deviceCapabilities.mjs` for anything new.
 *
 * Exit codes: 0 clean (warnings allowed), 1 drift found, 2 could not check.
 *
 * Usage:
 *   npm run tuya:spec              summary
 *   npm run tuya:spec -- --verbose every capability, matched or not
 */
import { createTuyaClient, TUYA_HOSTS, probeTuyaHost } from './tuyaCloud.mjs';
import { CAPABILITY_PROFILES, CAPABILITY_PROFILE_IDS } from '../shared/deviceCapabilities.mjs';
import { matchProfiles, diffProfile, diffWritability, hasDrift } from './tuyaSpecDiff.mjs';

const verbose = process.argv.includes('--verbose');

const accessId = process.env.TUYA_ACCESS_ID;
const accessSecret = process.env.TUYA_ACCESS_SECRET;
if (!accessId || !accessSecret) {
  console.error('Missing TUYA_ACCESS_ID / TUYA_ACCESS_SECRET — this reads server/.env, so run it');
  console.error('as `node --env-file=server/.env server/tuya-spec.mjs` or via `npm run tuya:spec`.');
  process.exit(2);
}

const region = (process.env.TUYA_REGION ?? 'us').toLowerCase();
let host = TUYA_HOSTS[region];
if (!host) {
  console.log(`TUYA_REGION="${process.env.TUYA_REGION}" is not a known code. Probing...`);
  const found = await probeTuyaHost({ accessId, accessSecret });
  if (!found.host) {
    console.error('No data centre answered a business call. Cannot check the catalogue.');
    process.exit(2);
  }
  host = found.host;
  console.log(`Using ${found.region}. Set TUYA_REGION=${found.region} to skip this probe.\n`);
}

const client = createTuyaClient({ accessId, accessSecret, host });

/** A thing-model property -> the same shape the catalogue uses, so the two can be compared. */
function toCapability(prop) {
  const spec = prop.typeSpec ?? {};
  return {
    code: prop.code,
    dp: Number(prop.abilityId),
    access: prop.accessMode === 'rw' ? 'rw' : 'ro',
    kind: spec.type,
    scale: spec.scale,
    unit: spec.unit,
    range: spec.range,
  };
}

let devices;
try {
  devices = await client.listDevices();
} catch (e) {
  console.error(`Could not list devices: ${e.message}`);
  process.exit(2);
}

// One representative per product. The device id is used only to fetch the model and is never
// printed — this repository is public and those ids are paired with local keys elsewhere.
const reps = [];
const seen = new Set();
for (const d of devices) {
  if (seen.has(d.product_id)) continue;
  seen.add(d.product_id);
  reps.push(d);
}

const products = [];
for (const [index, rep] of reps.entries()) {
  try {
    const res = await client.call('GET', `/v2.0/cloud/thing/${rep.id}/model`);
    const model = JSON.parse(res.model);
    const props = (model.services ?? []).flatMap((s) => s.properties ?? []);
    products.push({
      // Index, not category: both CT meters are category `cz`, and keying on that made the
      // second one look like a product some other profile had already claimed.
      key: `p${index}`,
      label: `${rep.category} / ${rep.product_name}`,
      capabilities: props.map(toCapability),
    });
  } catch (e) {
    console.error(`! could not read the model for a ${rep.category} device: ${e.message}`);
  }
}

const profiles = CAPABILITY_PROFILE_IDS.map((id) => CAPABILITY_PROFILES[id]);
const { matched, unmatched } = matchProfiles(profiles, products);

let errors = 0;
let warnings = 0;

for (const { profile, product, score } of matched) {
  const findings = [...diffProfile(profile, product), ...diffWritability(profile, product)];
  const bad = findings.filter((f) => f.severity === 'error');
  const meh = findings.filter((f) => f.severity === 'warn');
  errors += bad.length;
  warnings += meh.length;

  const mark = bad.length ? 'DRIFT' : meh.length ? 'ok*' : 'ok';
  console.log(`\n[${mark}] ${profile.id}  <-  ${product.label}  (${score}/${profile.capabilities.length} dps agree)`);
  for (const f of bad) console.log(`   ERROR  ${f.code}: ${f.detail}`);
  for (const f of meh) console.log(`   warn   ${f.code}: ${f.detail}`);
  if (verbose) {
    for (const c of profile.capabilities) {
      console.log(`     · dp ${String(c.dp).padStart(3)}  ${c.code.padEnd(20)} ${c.access} ${c.kind}${c.writable ? '  [writable]' : ''}`);
    }
  }
}

for (const profile of unmatched) {
  errors += 1;
  console.log(`\n[DRIFT] ${profile.id}: no product in the cloud project fingerprints to this profile.`);
  console.log('        Either the device was removed from the project, or its model changed enough');
  console.log('        that no dp->code pair still matches. Neither is safe to assume away.');
}

const checked = matched.length;
console.log(`\n${checked}/${profiles.length} profiles matched · ${errors} error(s) · ${warnings} warning(s)`);

if (hasDrift([{ severity: errors ? 'error' : 'warn' }])) {
  console.log('\nThe catalogue no longer describes the hardware. Fix shared/deviceCapabilities.mjs');
  console.log('before trusting any parsed value, and re-run the bridge suite afterwards.');
  process.exit(1);
}
console.log('The catalogue matches the vendor device model.');
