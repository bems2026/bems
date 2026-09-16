/**
 * The electrical tree — RM-029.
 *
 * A SECOND TREE, NOT A BRANCH OF THE SPATIAL ONE. Where a device *is* and what it is *wired to*
 * are independent: a lighting circuit crosses rooms, and a room is fed by several circuits.
 * RM-028 gave the first structure; this gives the second structure. A device has one parent in
 * each, and neither tree is a parent of the other.
 *
 * WHAT THIS REPLACES: `PHASE_MAP` was a constant naming four specific meters — the most direct
 * statement in the codebase that this building's panel is the only panel that will ever exist.
 * It is now derived from a description of the panel, which is a thing a second site can write.
 *
 * Pure and import-free, like `buildLatest.mjs`, so it stays safe to reason about and cheap to
 * test. Unlike `buildLatest.mjs` it is NOT inlined into the Node-RED flow: the flow receives the
 * derived map as JSON, already flattened, so the derivation runs at build time and never on
 * the Pi.
 */

/**
 * The three phases of a 3-phase supply, in the conventional order.
 *
 * Every phase is always a key in the derived map, even with nothing wired to it. `PHASE_MAP.blue`
 * has always been empty here — no Blue-phase meter is installed — and the UI's job is to render
 * that as "not metered" rather than as a real zero. An ABSENT key and an EMPTY one are different
 * facts to every consumer downstream, and `buildLatest` reads `PHASE_MAP.blue` directly.
 */
export const PHASES = ['red', 'yellow', 'blue'];

/**
 * @typedef {object} Circuit
 * @property {string} id
 * @property {string|null} parent_id      null for the service entrance
 * @property {string} kind                'service_entrance' | 'panel' | 'branch'
 * @property {string} name
 * @property {string|null} phase          which supply phase this branch sits on; null above branch level
 * @property {string|null} meter_device_id the registry device measuring it, if any
 * @property {'lighting'|'aircon'|'other'} [load] what the circuit carries — RM-092. A circuit without
 *           one takes the nearest circuit above it's; a building meter with none is a site:check warning.
 */

/**
 * What a branch circuit carries — RM-092. The operator reads reports by what the energy was FOR, and a
 * panel schedule names circuits by colour and phase. Three categories, in the order reports list them.
 * A site declares one per branch in its own circuits.mjs, because which circuit feeds the lights is
 * wiring, and wiring is written down rather than inferred.
 */
export const LOADS = Object.freeze(['lighting', 'aircon', 'other']);

export const LOAD_LABELS = Object.freeze({ lighting: 'Lighting', aircon: 'Aircon', other: 'Others' });

/** The same cap the spatial tree uses, for the same reason: `parent_id` is editable and a walk
 * over a cycle would otherwise not terminate. */
export const MAX_CIRCUIT_DEPTH = 32;

/** Circuits that actually measure something. Panels and service entrances carry no meter, and a
 * null slipping into a phase list would be looked up as a device id and silently contribute
 * nothing — or worse, `undefined`. */
export function meteredCircuits(circuits) {
  return circuits.filter((c) => typeof c.meter_device_id === 'string' && c.meter_device_id.length > 0);
}

/**
 * `{ red: [...meterIds], yellow: [...], blue: [...] }` — exactly the shape `buildLatest` expects,
 * derived rather than declared.
 *
 * An unrecognised phase is ignored rather than becoming a new key: `buildLatest` reads the three
 * it knows by name, so an invented key would be silently unread, which is a worse outcome than
 * a circuit visibly contributing to nothing.
 */
export function derivePhaseMap(circuits) {
  const map = {};
  for (const phase of PHASES) map[phase] = [];
  for (const circuit of meteredCircuits(circuits)) {
    if (Object.prototype.hasOwnProperty.call(map, circuit.phase)) {
      map[circuit.phase].push(circuit.meter_device_id);
    }
  }
  return map;
}

/**
 * The chain from the service entrance down to `id`, inclusive — the order an electrician says it
 * in. Empty for an unknown id, so "not in this panel" and "not recorded" read identically.
 */
export function circuitPath(circuits, id) {
  if (!id) return [];
  const byId = new Map(circuits.map((c) => [c.id, c]));
  const chain = [];
  const seen = new Set();
  let cursor = byId.get(id);
  while (cursor && !seen.has(cursor.id) && chain.length <= MAX_CIRCUIT_DEPTH) {
    seen.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return chain.reverse();
}

/**
 * A circuit's load category: its own, else the nearest circuit above it's. `null` when nothing on its
 * path declares one this build knows — never a guess, because a guessed category puts a circuit's
 * energy into a report about something it does not carry. Walks `circuitPath`, so it is cycle-safe.
 */
export function loadOf(circuits, id) {
  const path = circuitPath(circuits, id);
  for (let i = path.length - 1; i >= 0; i--) {
    if (LOADS.includes(path[i].load)) return path[i].load;
  }
  return null;
}

/**
 * The building meters grouped by load category, in `LOADS` order, each group in site order — RM-092.
 *
 * Only BUILDING meters, from `buildingMeterIds`: a sub-meter is detail inside a branch already counted,
 * so an outlet can never be added to the outlet branch's own figure. A meter whose circuit has no
 * category is left out of every group — site:check warns about it — rather than filed under "other",
 * which would be a statement about wiring nobody made.
 */
export function buildingMetersByLoad(circuits) {
  const groups = new Map();
  for (const meterId of buildingMeterIds(circuits)) {
    const circuit = circuits.find((c) => c.meter_device_id === meterId);
    const load = circuit ? loadOf(circuits, circuit.id) : null;
    if (load === null) continue;
    if (!groups.has(load)) groups.set(load, []);
    groups.get(load).push(meterId);
  }
  return LOADS.filter((load) => groups.has(load)).map((load) => ({ load, meterIds: groups.get(load) }));
}

/**
 * The meters whose readings ADD UP TO THE WHOLE BUILDING — RM-057.
 *
 * The topmost metered circuits: every metered circuit that has no metered ancestor. That single
 * rule is what makes the sum a total rather than an over-count, and this building shows why it
 * cannot be "every device of class meter". `co_yellow` is the convenience-outlets branch and the
 * seven outlet devices plug into it, so a set chosen by hardware class would count the same
 * watt-hours at the branch and again at the socket. What may be added together is a fact about
 * WIRING, and wiring is what this file describes.
 *
 * A metered sub-panel is therefore counted once, at the sub-panel, and the branches beneath it
 * are left out — they are detail within a figure already counted, not extra load.
 *
 * Derived rather than declared, so a second site gets its building total by writing its own
 * `circuits.mjs` and changing nothing else. That is the same move `derivePhaseMap` made, and it
 * retires the last thing the hand-built `Calculate 3-Phase Totals` node knew that this
 * repository did not.
 *
 * An orphan — a metered circuit whose parent is not in the tree — is KEPT. A tree mid-edit is
 * the likely cause, and dropping the meter would quietly shrink the building total with nothing
 * to show for it; keeping it is visible, and visible is recoverable.
 */
export function buildingMeterIds(circuits) {
  const byId = new Map(circuits.map((c) => [c.id, c]));
  const metered = (c) => typeof c?.meter_device_id === 'string' && c.meter_device_id.length > 0;
  const out = [];
  for (const circuit of meteredCircuits(circuits)) {
    let cursor = circuit.parent_id ? byId.get(circuit.parent_id) : undefined;
    // `seen` and the depth cap are the same guard `circuitPath` carries: a cycle in hand-written
    // data must not hang a function the bridge calls on every read.
    const seen = new Set([circuit.id]);
    let covered = false;
    let depth = 0;
    while (cursor && !seen.has(cursor.id) && depth <= MAX_CIRCUIT_DEPTH) {
      if (metered(cursor)) { covered = true; break; }
      seen.add(cursor.id);
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
      depth++;
    }
    if (!covered) out.push(circuit.meter_device_id);
  }
  return out;
}
