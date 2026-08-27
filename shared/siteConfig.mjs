/**
 * Which site this deployment is.
 *
 * ONE LINE, deliberately. Standing up iBEMS for another building is: add a sibling directory
 * under `shared/sites/`, then change the path below.
 *
 * A static re-export rather than a runtime lookup because this module is bundled for the
 * browser by Vite and reached, indirectly, by the generated Node-RED flow — neither tolerates a
 * computed import path. It is also not read from an environment variable: a browser bundle has
 * no `process.env`, and a site is a build-time fact here, not a runtime one.
 */
export { SITE } from './sites/mmsu-nberic-care/site.mjs';

/**
 * The same site's electrical tree, re-exported through the same pointer — RM-033.
 *
 * It used to be imported directly by `shared/registry.mjs`, which made the "one line" above a
 * lie: a second building needed two edits, and the one nobody would remember is the one that
 * wires a site to another building's circuits. `PHASE_MAP` is derived from this, so a missed
 * edit would not fail — it would report the wrong phase totals, confidently.
 *
 * `test/site-config.test.mjs` now fails any production module outside this file and
 * `shared/sites/` that names a site directory, so the claim is enforced rather than asserted.
 */
export { CIRCUITS } from './sites/mmsu-nberic-care/circuits.mjs';

/**
 * ...and the same site's hardware - RM-033 / FI-017.
 *
 * `shared/registry.mjs` held these 21 devices inline, so a second building meant editing shared
 * code to describe hardware it does not have. The registry still composes
 * `[...BUILT_IN_DEVICES, ...ENROLLED_DEVICES]`; what moved is the half that belongs to a place.
 */
export { BUILT_IN_DEVICES } from './sites/mmsu-nberic-care/devices.mjs';
