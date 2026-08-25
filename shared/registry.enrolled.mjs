/**
 * Devices added through enrolment, rather than hand-written into `registry.mjs`.
 *
 * WHY A SEPARATE MODULE: `registry.mjs` is imported by the mock bridge, the flow generator, the
 * proxy and the ingest daemon, and its tests run with no network and no filesystem. Reading
 * enrolled devices from JSON at runtime would put `fs` in a module the frontend's own test
 * imports; appending them into `registry.mjs` would mean a script editing hand-written code.
 * A generated data module is neither: plain ESM, committed, and safe to import anywhere.
 *
 * **Generated. Do not hand-edit** — `npm run enroll:pi` rewrites this file. Editing it by hand
 * works right up until the next enrolment silently discards the change.
 *
 * Entries here are ordinary registry entries and are appended to `DEVICE_REGISTRY` in order.
 * Removing a device means deleting its entry and regenerating the flow; its history in
 * `readings` is keyed by `device_id` and survives, which is why removal is a deletion here
 * rather than a `status: 'retired'` flag nothing else reads.
 */

export const ENROLLED_DEVICES = [];
