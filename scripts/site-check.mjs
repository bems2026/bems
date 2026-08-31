#!/usr/bin/env node
/**
 * `npm run site:check` — does this deployment's site directory hold together? RM-033.
 *
 * WHY THIS EXISTS. The three test suites in this repository are the CARE office's REGRESSION
 * suite, not a conformance suite: they assert that this building's seven outlets round-trip a
 * command and that this panel derives to these four meters. Measured on 2026-08-31, a freshly
 * scaffolded site fails 68 bridge tests and 30 server tests on fixtures naming hardware it does
 * not have. So a new institution gets a wall of red that means nothing — and, worse, nothing at
 * all that tells them their own site is right.
 *
 * This knows nothing about any particular building and everything about what a coherent site
 * looks like. It is the check a second deployment runs, and the one this one runs too.
 *
 * ERRORS VERSUS WARNINGS IS THE WHOLE DESIGN. A scaffolded site has no devices and no circuits,
 * and that is a legitimate state — it is precisely what `site:new` writes on purpose. If empty
 * failed, the command would be broken at the moment it is most needed, and the first thing anyone
 * would learn is to ignore it. **Empty is a warning. Wrong is an error.**
 *
 * THE ERRORS WORTH KNOWING ABOUT ARE THE QUIET ONES. A circuit naming a meter that does not
 * exist does not crash: `PHASE_MAP` is derived from that tree, so the phase total silently omits
 * a meter and nothing on screen looks wrong. Two devices sharing a context prefix overwrite each
 * other's readings in the flow's context store, and the dashboard shows one of them twice
 * without saying so. Neither is visible by looking at the app.
 */
import { DEVICE_CLASSES, DPS_MAPS } from '../shared/registry.mjs';
import { PHASES, MAX_CIRCUIT_DEPTH } from '../shared/circuits.mjs';

/** Same rule `scripts/site-new.mjs` applies: the id is a directory name, a module path and a
 * database primary key. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Offset of a zone at an instant, in minutes east of UTC. */
function offsetAt(timeZone, date) {
  const local = new Date(date.toLocaleString('en-US', { timeZone }));
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local - utc) / 60000);
}

/**
 * @param {{ slug: string, site: Record<string, any>, devices: readonly any[], circuits: readonly any[] }} input
 * @returns {{ ok: boolean, errors: {code: string, message: string}[], warnings: {code: string, message: string}[] }}
 *
 * Everything is passed in rather than imported, so this can check a site that is not the active
 * one — and so the tests can hand it shapes no real directory would ever contain.
 */
export function checkSite({ slug, site, devices, circuits }) {
  const errors = [];
  const warnings = [];
  const err = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });

  const list = Array.isArray(devices) ? devices : [];
  const tree = Array.isArray(circuits) ? circuits : [];

  // --- identity ------------------------------------------------------------
  if (!site || typeof site !== 'object') {
    err('site_missing', 'the site module exports no SITE object');
    return { ok: false, errors, warnings };
  }
  if (!SLUG.test(String(site.id ?? ''))) {
    err('id_not_slug', `id "${site.id}" is not a slug — lowercase letters, digits and single hyphens`);
  }
  if (slug && site.id !== slug) {
    // Silently wrong: the database row is keyed by one and the module path by the other, so
    // every site-scoped write lands under an id nothing else uses.
    err('id_directory_mismatch', `site.id is "${site.id}" but the deployment points at "${slug}"`);
  }
  if (!Object.isFrozen(site)) {
    err('site_not_frozen', 'SITE is not frozen — a deployment-wide fact must not be mutable at runtime');
  }
  if (typeof site.display_name !== 'string' || site.display_name.trim() === '') {
    err('display_name_missing', 'display_name is empty — it is what the dashboard header shows');
  } else if (site.display_name === site.id) {
    warn('display_name_is_slug', `display_name is still the slug ("${site.id}") — the header will show it verbatim`);
  }
  if (site.scene_pack !== null && typeof site.scene_pack !== 'string') {
    err('scene_pack_invalid', 'scene_pack must be a pack name or null');
  }
  // Where the building is. Null is legitimate; a half-described one is not, and neither is a
  // coordinate off the earth. This exists because `src/config/weather.ts` used to fall back to
  // the CARE office's own coordinates, so an unlocated deployment showed somebody else's city's
  // weather labelled as its own.
  if (site.location != null) {
    const l = site.location;
    const bad =
      typeof l !== 'object' ||
      typeof l.place !== 'string' ||
      l.place.trim() === '' ||
      !Number.isFinite(l.lat) ||
      !Number.isFinite(l.lon) ||
      l.lat < -90 || l.lat > 90 ||
      l.lon < -180 || l.lon > 180;
    if (bad) {
      err('location_invalid', 'location must be { place, lat, lon } with lat in -90..90 and lon in -180..180, or null');
    }
  } else {
    warn('no_location', 'no location set — the weather card will say it is unconfigured rather than borrow another city');
  }

  if (!site.policy || typeof site.policy !== 'object') {
    err('policy_missing', 'policy must be an object, even if every rule in it is null');
  } else if (site.policy.acu_min_setpoint_c !== null && typeof site.policy.acu_min_setpoint_c !== 'number') {
    err('policy_acu_floor_invalid', 'policy.acu_min_setpoint_c must be a number or null');
  }

  // --- timezone: one fact, carried twice, and it has to stay one fact ------
  const tz = site.timezone;
  let tzKnown = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format();
    tzKnown = true;
  } catch {
    err('timezone_unknown', `timezone "${tz}" is not a zone this runtime recognises`);
  }
  if (tzKnown) {
    if (!Number.isInteger(site.utc_offset_minutes)) {
      err('offset_not_integer', 'utc_offset_minutes must be a whole number of minutes');
    } else {
      // Two instants six months apart. A zone that answers differently cannot be described by
      // one fixed number, which is a real limitation of this design and not a typo — so it is
      // reported as its own thing rather than as a mismatch.
      const jan = offsetAt(tz, new Date('2026-01-15T00:00:00Z'));
      const jul = offsetAt(tz, new Date('2026-07-15T00:00:00Z'));
      if (jan !== jul) {
        err(
          'timezone_observes_dst',
          `${tz} shifts between ${jan} and ${jul} minutes across the year; a single utc_offset_minutes cannot describe it`,
        );
      } else if (jan !== site.utc_offset_minutes) {
        err('offset_disagrees_with_timezone', `${tz} is ${jan} minutes from UTC, but utc_offset_minutes is ${site.utc_offset_minutes}`);
      }
    }
  }

  // --- devices -------------------------------------------------------------
  if (list.length === 0) {
    warn('no_devices', 'no devices described yet — enrol them from the Devices page, or add them to devices.mjs');
  }
  const seenId = new Set();
  const seenCtx = new Map();
  const seenStateKey = new Map();
  for (const d of list) {
    const id = d?.id;
    if (typeof id !== 'string' || id.trim() === '') {
      err('device_id_missing', 'a device has no id');
      continue;
    }
    if (seenId.has(id)) err('duplicate_device_id', `two devices share the id "${id}"`);
    seenId.add(id);

    if (!DEVICE_CLASSES.includes(d.class)) {
      err('unknown_device_class', `${id} has class "${d.class}", which this build cannot handle (known: ${DEVICE_CLASSES.join(', ')})`);
    }
    if (d.dps_map != null && !Object.hasOwn(DPS_MAPS, d.dps_map)) {
      err('unknown_dps_map', `${id} names DPS family "${d.dps_map}", which is not in DPS_MAPS`);
    }
    if (d.class === 'outlet_dual' && (!Array.isArray(d.sockets) || d.sockets.length < 2)) {
      err('outlet_missing_sockets', `${id} is an outlet_dual but does not name two socket keys`);
    }
    if (d.class === 'switch' && (typeof d.state_key !== 'string' || d.state_key === '')) {
      err('switch_missing_state_key', `${id} is a switch with no state_key — nothing could address it`);
    }
    // Both of these are addresses into the live flow's context store. Two devices sharing one
    // means each overwrites the other's reading, and the dashboard shows one of them twice.
    if (typeof d.ctx === 'string' && d.ctx !== '') {
      if (seenCtx.has(d.ctx)) err('duplicate_ctx', `${id} and ${seenCtx.get(d.ctx)} share the context prefix "${d.ctx}"`);
      else seenCtx.set(d.ctx, id);
    }
    if (typeof d.state_key === 'string' && d.state_key !== '') {
      if (seenStateKey.has(d.state_key)) err('duplicate_state_key', `${id} and ${seenStateKey.get(d.state_key)} share the state key "${d.state_key}"`);
      else seenStateKey.set(d.state_key, id);
    }
    if (d.room != null) {
      warn('device_carries_room', `${id} has a hardcoded room ("${d.room}") — the space tree records location now (RM-028)`);
    }
  }

  // --- circuits ------------------------------------------------------------
  if (tree.length === 0) {
    warn('no_circuits', 'no electrical tree yet — every phase will report "not metered", which is honest but blank');
  }
  const byCircuitId = new Map();
  for (const c of tree) {
    if (typeof c?.id !== 'string' || c.id === '') {
      err('circuit_id_missing', 'a circuit has no id');
      continue;
    }
    if (byCircuitId.has(c.id)) err('duplicate_circuit_id', `two circuits share the id "${c.id}"`);
    byCircuitId.set(c.id, c);
  }
  const meterClaims = new Map();
  for (const c of byCircuitId.values()) {
    if (c.parent_id != null && !byCircuitId.has(c.parent_id)) {
      err('circuit_parent_missing', `circuit "${c.id}" names parent "${c.parent_id}", which does not exist`);
    }
    if (c.phase != null && !PHASES.includes(c.phase)) {
      err('circuit_phase_invalid', `circuit "${c.id}" declares phase "${c.phase}" (known: ${PHASES.join(', ')})`);
    }
    if (c.meter_device_id != null) {
      const device = list.find((d) => d?.id === c.meter_device_id);
      if (!device) {
        // The quiet one. PHASE_MAP is derived from this tree, so a typo does not fail — the
        // phase total silently omits a meter and nothing on screen looks wrong.
        err('circuit_meter_unknown', `circuit "${c.id}" is metered by "${c.meter_device_id}", which is not in the device list`);
      } else if (device.class !== 'meter') {
        err('circuit_meter_not_a_meter', `circuit "${c.id}" is metered by "${c.meter_device_id}", which is a ${device.class}`);
      }
      meterClaims.set(c.meter_device_id, (meterClaims.get(c.meter_device_id) ?? 0) + 1);
    }
  }

  // Cycles. `parent_id` is hand-written, and a walk that met one would recurse until the stack
  // gave out — the same reason `spaceTree.ts` and `space_subtree` are both depth-capped.
  for (const start of byCircuitId.values()) {
    let node = start;
    for (let depth = 0; node?.parent_id != null; depth++) {
      if (depth > MAX_CIRCUIT_DEPTH) {
        err('circuit_cycle', `circuit "${start.id}" never reaches a root — the tree contains a cycle`);
        break;
      }
      node = byCircuitId.get(node.parent_id);
      if (!node) break; // already reported as circuit_parent_missing
    }
  }

  for (const [meterId, count] of meterClaims) {
    if (count > 1) err('meter_claimed_twice', `meter "${meterId}" is claimed by ${count} circuits — it would be counted twice`);
  }
  for (const d of list) {
    if (d?.class === 'meter' && !meterClaims.has(d.id)) {
      warn('meter_unclaimed', `meter "${d.id}" is claimed by no circuit — its readings reach no phase total`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// --- CLI ---------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('site-check.mjs')) {
  const { SITE, CIRCUITS, BUILT_IN_DEVICES } = await import('../shared/siteConfig.mjs');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  // Which directory the deployment actually points at, read from the pointer rather than assumed
  // from SITE.id — the whole point of one of the checks is that those two can disagree.
  const pointer = readFileSync(join(import.meta.dirname, '..', 'shared', 'siteConfig.mjs'), 'utf8');
  const slug = pointer.match(/\.\/sites\/([^/]+)\/site\.mjs/)?.[1] ?? '';

  const { ok, errors, warnings } = checkSite({ slug, site: SITE, devices: BUILT_IN_DEVICES, circuits: CIRCUITS });

  console.log(`site: ${SITE.id}  (shared/sites/${slug}/)`);
  console.log(`      ${BUILT_IN_DEVICES.length} device(s), ${CIRCUITS.length} circuit(s)\n`);
  for (const w of warnings) console.log(`  \x1b[33mwarn\x1b[0m  ${w.message}`);
  for (const e of errors) console.log(`  \x1b[31mERROR\x1b[0m ${e.message}`);

  if (ok && warnings.length === 0) {
    console.log('\n\x1b[32mThis site is coherent.\x1b[0m');
  } else if (ok) {
    console.log(`\n\x1b[32mNo errors.\x1b[0m ${warnings.length} warning(s) — incomplete, not wrong.`);
  } else {
    console.log(`\n\x1b[31m${errors.length} error(s).\x1b[0m This site will not behave correctly until they are fixed.`);
  }
  // A warning must not fail a build: a scaffolded site has warnings by design, and a command
  // that goes red on day one is a command people learn to skip.
  process.exit(ok ? 0 : 1);
}
