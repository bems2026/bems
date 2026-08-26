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
