#!/usr/bin/env node
/**
 * `npm run site:new <slug>` — scaffold a new deployment's site directory. RM-033.
 *
 * WHY THIS EXISTS. Milestone 6 of the funded plan is "a practical step-by-step framework that
 * enables other SUCs to replicate and implement the iBEMS". Track B made a second building
 * possible; this makes the first step of it a command rather than a copy-paste of the CARE
 * office's files, which is how a new site ends up quietly carrying another building's timezone,
 * policy floor, or circuit tree.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: activate the site. `shared/siteConfig.mjs` is how a
 * deployment declares which building it is, and repointing it silently would take a RUNNING
 * building offline — every device id in the live flow would stop resolving, from a command that
 * sounds purely additive. It prints the line; a person makes the change.
 *
 * WHAT THE TEMPLATE ASSERTS: as little as possible. A new site has no hardware and no metered
 * circuits until somebody enrols them, so both lists start EMPTY rather than being seeded with
 * plausible examples — an example device would be a device the dashboard reports as offline
 * forever, and an example circuit would put a meter in a phase total that has no meter.
 * The timezone starts at UTC, which is a placeholder that also happens to be true, rather than
 * another building's timezone copied across and left to be believed.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The same rule `test/site-config.test.mjs` holds the live site's id to, and for the same three
 * reasons: it becomes a directory name, an ES module path, and a `sites.id` primary key.
 *
 * The traversal case is the one that matters operationally — the slug is interpolated into a
 * path, so `../something` would write outside the sites directory entirely.
 */
export function isSiteSlug(value) {
  return typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}

const siteTemplate = (slug) => `/**
 * Everything that varies between one deployment of iBEMS and the next.
 *
 * Scaffolded by \`npm run site:new ${slug}\`. Every TODO below is a fact about a real building
 * that this file cannot know — fill them in before this site is used for anything.
 *
 * Data only — no imports, no logic. This module is read by the frontend bundle (via the
 * \`@shared\` Vite alias), by the server daemons, and indirectly by the generated Node-RED flow,
 * so it has to be safe in all three.
 */

/** @typedef {{ acu_min_setpoint_c: number|null }} SitePolicy */

export const SITE = Object.freeze({
  id: '${slug}',

  /** TODO: the building as a person would name it. Shown in the dashboard header. */
  display_name: '${slug}',

  /**
   * TODO: this building's IANA zone, and the matching offset below.
   *
   * They are the same fact carried twice, on purpose: the payload transform runs inside a
   * Node-RED function node with no imports and no guarantee of a full-ICU build, so it needs a
   * plain number rather than a zone name. \`test/site-config.test.mjs\` measures the zone at two
   * instants six months apart and asserts they agree with the offset — which is what makes
   * carrying it twice safe rather than merely convenient.
   *
   * A site in a DST-observing zone cannot describe itself honestly with a fixed offset, and that
   * test is where it will find out.
   */
  timezone: 'UTC',
  utc_offset_minutes: 0,

  /**
   * Which 3D scene pack renders for this site. \`null\` until somebody models this building —
   * and null is a working state, not a gap: the dashboard falls back to the data-driven floor
   * plan, which draws whatever the space tree says is here.
   */
  scene_pack: null,

  /** @type {SitePolicy} Operating rules for this building. */
  policy: Object.freeze({
    /**
     * TODO, or leave null. The coldest setpoint this building permits, if it has such a rule.
     *
     * NOT the same fact as \`ACU_MIN_C\` in \`shared/commands.mjs\`: that one is what the IR
     * library has codes for — a hardware capability — while this is what the operator allows.
     * A site with no such rule leaves this null and gets the hardware bound alone.
     */
    acu_min_setpoint_c: null,
  }),
});
`;

const devicesTemplate = (slug) => `/**
 * The devices of the ${slug} deployment.
 *
 * EMPTY ON PURPOSE. A site has no hardware until somebody enrols it, and an example device here
 * would be a device the dashboard reports as permanently offline — a fault that looks like a
 * fault and is not one.
 *
 * Two ways to fill this in, and they are not equivalent:
 *   - the Devices page's "Add device" wizard, which writes \`shared/registry.enrolled.mjs\` and
 *     is the normal path;
 *   - by hand here, for hardware that must exist before the app can run at all.
 *
 * Data only: no imports, no logic. Read by the frontend bundle, by the server daemons and,
 * indirectly, by the generated Node-RED flow, so it has to be safe in all three.
 *
 * \`dps_map\` names a family in \`shared/registry.mjs\`'s \`DPS_MAPS\`. Those describe Tuya
 * firmware rather than any one building, which is why they are shared and this is not.
 *
 * \`room\` stays null: the space tree (RM-028) is where a device's location is recorded. Do not
 * invent values here.
 */

/** @typedef {import('../../registry.mjs').DeviceClass} DeviceClass */

export const BUILT_IN_DEVICES = [];
`;

const circuitsTemplate = (slug) => `/**
 * The electrical tree of the ${slug} deployment — service entrance, panels, branch circuits.
 *
 * EMPTY ON PURPOSE, and the consequence is worth knowing rather than discovering: \`PHASE_MAP\`
 * is DERIVED from this (see \`shared/circuits.mjs\`), so an empty tree yields empty phase lists
 * and the dashboard reports every phase as not metered. That is the honest state of a building
 * nobody has surveyed — never a zero, which would be a reading nobody took.
 *
 * This tree is deliberately INDEPENDENT of the space tree. Where a device is and what it is
 * wired to are two different questions, and a building answers them differently: one circuit
 * commonly crosses several rooms.
 *
 * Shape, per node: \`{ id, parent_id, kind, name, phase, meter_device_id }\` — see
 * \`shared/sites/\` for a populated example, and \`shared/circuits.mjs\` for what each field does.
 */

export const CIRCUITS = [];
`;

/**
 * Writes the directory. Pure enough to test: `root` is the repository root, so a test can hand
 * it a temporary one and assert against real files without a fixture framework.
 *
 * Throws rather than exiting, so the CLI below owns the process and the tests own the error.
 */
export function scaffoldSite({ root, slug }) {
  if (!isSiteSlug(slug)) {
    throw new Error(
      `"${slug}" is not a site slug. Lowercase letters, digits and single hyphens, up to 64 characters — ` +
        'it becomes a directory name, a module path and a database key.',
    );
  }
  const dir = join(root, 'shared', 'sites', slug);
  if (existsSync(dir)) {
    throw new Error(`shared/sites/${slug} already exists. Delete it first if that is really what you mean.`);
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'site.mjs'), siteTemplate(slug));
  writeFileSync(join(dir, 'devices.mjs'), devicesTemplate(slug));
  writeFileSync(join(dir, 'circuits.mjs'), circuitsTemplate(slug));

  return {
    slug,
    dir,
    nextStep:
      `Edit shared/siteConfig.mjs to point at the new site — three lines, all of them '${slug}':\n` +
      `    export { SITE } from './sites/${slug}/site.mjs';\n` +
      `    export { CIRCUITS } from './sites/${slug}/circuits.mjs';\n` +
      `    export { BUILT_IN_DEVICES } from './sites/${slug}/devices.mjs';`,
  };
}

// --- CLI -------------------------------------------------------------------
// `import.meta.main` is not available on Node 22, which the Pi runs, so this compares argv
// instead — the pattern the other scripts in this repo use.
if (process.argv[1] && process.argv[1].endsWith('site-new.mjs')) {
  const slug = process.argv[2];
  if (!slug) {
    // The example is deliberately not a plausible building name. `test/site-config.test.mjs`
    // fails any production module naming a real site directory, and a usage example that
    // happened to match one would be indistinguishable from a module wired to it. It caught
    // this line, with a placeholder that read exactly like a real MMSU college.
    console.error('usage: npm run site:new -- <slug>\n   lowercase letters, digits and single hyphens, e.g. a-building-slug');
    process.exit(2);
  }
  try {
    const { dir, nextStep } = scaffoldSite({ root: join(import.meta.dirname, '..'), slug });
    console.log(`created ${dir}`);
    console.log('  site.mjs      identity, timezone, policy   — every TODO in it is a real fact to fill in');
    console.log('  devices.mjs   empty; enrol hardware from the Devices page');
    console.log('  circuits.mjs  empty; until it is filled in, every phase reads "not metered"');
    console.log('');
    console.log('This did NOT activate the site — repointing a running deployment is a deliberate act.');
    console.log(nextStep);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
