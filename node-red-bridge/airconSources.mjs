/**
 * The Aircon tab's function-node sources, as one module both writers import.
 *
 * Two scripts put these nodes on the live flow: `aircon-flow.mjs` refactors the tab that already
 * exists, and `add-device-endpoints.mjs` builds the `/acu` endpoint on a flow that has none. If each
 * carried its own copy, a fresh install and a refactored one would disagree about what the
 * endpoint accepts — which is exactly the kind of drift nothing notices until a command is refused.
 */

/** How often the IR hub is asked for its dps. `STALE_AFTER_MS_BY_CLASS.acu_ir` is held above it. */
export const HUB_POLL_INTERVAL_S = 60;
